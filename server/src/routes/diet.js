import { Router } from 'express';
import { db, DEFAULT_USER_ID } from '../db.js';
import { currentUserId } from '../lib/context.js';
import { ApiError, parseDate, requireObject, round, todayLocal } from '../lib/util.js';
import { analyzeFoodImage, guessMealType, MEAL_LABELS } from '../lib/vision.js';
import { listFoods, matchFood, resolveItemNutrition, sumItems } from '../lib/foods.js';
import { parseImageDataUrl, removeImage, saveImage } from '../lib/images.js';
import { aiDailyGuard, aiGuard, RATE_RULES } from '../lib/ratelimit.js';

const router = Router();
const MEAL_TYPES = Object.keys(MEAL_LABELS);

function normalizeMealType(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const v = String(raw).trim();
  if (!MEAL_TYPES.includes(v)) {
    throw new ApiError(400, `meal_type 只能是：${MEAL_TYPES.join(' / ')}`);
  }
  return v;
}

/** 明细校验 + 营养换算。模型给的数值只是备份，能对上营养库就以库为准。 */
function normalizeItems(rawItems, { foods, forceAiValues = false } = {}) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new ApiError(400, '至少需要一项食物明细');
  }
  if (rawItems.length > 20) {
    throw new ApiError(400, '一次最多保存 20 项食物，请拆成多餐记录');
  }
  return rawItems.map((raw, i) => {
    const name = String(raw?.food_name ?? raw?.name ?? '').trim();
    if (!name) throw new ApiError(400, `第 ${i + 1} 项缺少食物名称`);
    if (name.length > 40) throw new ApiError(400, `第 ${i + 1} 项名称太长（最多 40 字）`);

    const weight = Number(String(raw?.estimated_weight_g ?? raw?.weight_g ?? '').replace(/[^\d.]/g, ''));
    if (!Number.isFinite(weight) || weight <= 0) {
      throw new ApiError(400, `第 ${i + 1} 项（${name}）的重量必须大于 0 克`);
    }
    if (weight > 3000) throw new ApiError(400, `第 ${i + 1} 项（${name}）重量超过 3000 克，请检查`);

    return resolveItemNutrition(
      {
        food_name: name,
        // 烹饪方式决定要不要额外加油糖，必须一起传下来
        cooking_method: raw?.cooking_method ?? raw?.cooking ?? raw?.method,
        estimated_weight_g: weight,
        calories: raw?.calories,
        protein: raw?.protein,
        fat: raw?.fat,
        carbs: raw?.carbs,
        confidence: raw?.confidence,
      },
      { foods, forceAiValues }
    );
  });
}

/** 读取一条记录 + 它的明细 */
function getRecord(id) {
  const row = db
    .prepare(
      `SELECT id, record_date, meal_type, image_path, source, status,
              total_calories, total_protein, total_fat, total_carbs, note, created_at
         FROM diet_records WHERE id = ? AND user_id = ?`
    )
    .get(id, currentUserId(DEFAULT_USER_ID));
  if (!row) return null;
  const items = db
    .prepare(
      `SELECT id, food_id, food_name, estimated_weight_g, calories, protein, fat,
              carbs, confidence, is_manual
         FROM diet_record_items WHERE diet_record_id = ? ORDER BY id`
    )
    .all(id);
  return { ...row, items };
}

/**
 * POST /api/diet/analyze
 * body: { image: "data:image/jpeg;base64,...", meal_type?, record_date?, hint? }
 *
 * 只识别、不入库 —— 用户可以先改克重再保存，避免模型估算有误差时污染数据。
 */
router.post('/diet/analyze', async (req, res, next) => {
  let saved = null;
  try {
    // 冷却 + 配额：放在最前面，被拦下的请求连图片都不会落盘，更不会调用视觉模型
    aiDailyGuard('analyze');
    aiGuard(req, 'analyze', RATE_RULES.analyze);

    const body = requireObject(req.body);
    const { buffer, ext } = parseImageDataUrl(body.image);
    const recordDate = parseDate(body.record_date);
    const mealType = normalizeMealType(body.meal_type) ?? guessMealType();

    saved = saveImage(buffer, ext, recordDate);

    const result = await analyzeFoodImage(body.image, {
      mealType,
      hint: typeof body.hint === 'string' ? body.hint.slice(0, 120) : '',
    });

    const foods = listFoods();
    const items = result.items.map((it) => resolveItemNutrition(it, { foods }));

    res.json({
      ok: true,
      data: {
        image_path: saved.url,
        record_date: recordDate,
        meal_type: mealType,
        items,
        totals: sumItems(items),
        // 「为什么这么算」：识别 → 估重 → 烹饪修正 三步结论，前端可展开查看
        reasoning: result.reasoning ?? [],
        note: result.note,
        meal_type_hint: result.meal_type_hint,
        meta: result.meta,
      },
    });
  } catch (err) {
    // 识别失败就别在磁盘上留垃圾图片
    if (saved && !(err instanceof ApiError && err.status === 0)) removeImage(saved.url);
    next(err);
  }
});

/**
 * POST /api/diet/records
 * body: { record_date?, meal_type, source?, image_path?, note?, items:[...] }
 * 营养素一律由服务端重算，前端传的数值只在「营养库对不上」时作为兜底。
 */
router.post('/diet/records', (req, res, next) => {
  try {
    const body = requireObject(req.body);
    const recordDate = parseDate(body.record_date);
    const mealType = normalizeMealType(body.meal_type) ?? guessMealType();
    const source = body.source === undefined ? 'manual' : String(body.source);
    if (!['manual', 'ai_image'].includes(source)) {
      throw new ApiError(400, 'source 只能是 manual / ai_image');
    }

    const foods = listFoods();
    const items = normalizeItems(body.items, { foods, forceAiValues: source === 'manual' });
    const totals = sumItems(items);

    const imagePath =
      typeof body.image_path === 'string' && body.image_path.startsWith('/uploads/')
        ? body.image_path.slice(0, 300)
        : null;

    const aiRaw =
      body.ai_raw_response === undefined || body.ai_raw_response === null
        ? null
        : JSON.stringify(body.ai_raw_response).slice(0, 4000);

    db.exec('BEGIN');
    let recordId;
    try {
      const info = db
        .prepare(
          `INSERT INTO diet_records
             (user_id, record_date, meal_type, image_path, source, status, ai_raw_response,
              total_calories, total_protein, total_fat, total_carbs, note)
           VALUES (@user_id, @record_date, @meal_type, @image_path, @source, 'done', @ai_raw_response,
              @total_calories, @total_protein, @total_fat, @total_carbs, @note)`
        )
        .run({
          user_id: currentUserId(DEFAULT_USER_ID),
          record_date: recordDate,
          meal_type: mealType,
          image_path: imagePath,
          source,
          ai_raw_response: aiRaw,
          total_calories: totals.calories,
          total_protein: totals.protein,
          total_fat: totals.fat,
          total_carbs: totals.carbs,
          note: typeof body.note === 'string' ? body.note.slice(0, 200) : null,
        });
      recordId = Number(info.lastInsertRowid);

      const insertItem = db.prepare(
        `INSERT INTO diet_record_items
           (diet_record_id, food_id, food_name, estimated_weight_g, calories, protein, fat, carbs, confidence, is_manual)
         VALUES (@diet_record_id, @food_id, @food_name, @estimated_weight_g, @calories, @protein, @fat, @carbs, @confidence, @is_manual)`
      );
      for (const it of items) {
        insertItem.run({
          diet_record_id: recordId,
          food_id: it.food_id,
          food_name: it.food_name,
          estimated_weight_g: it.estimated_weight_g,
          calories: it.calories,
          protein: it.protein,
          fat: it.fat,
          carbs: it.carbs,
          confidence: it.confidence,
          is_manual: body.source === 'manual' ? 1 : 0,
        });
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    res.status(201).json({ ok: true, data: { record: getRecord(recordId) } });
  } catch (err) {
    next(err);
  }
});

/** GET /api/diet/records?date=YYYY-MM-DD → 当天全部饮食记录 + 合计 */
router.get('/diet/records', (req, res, next) => {
  try {
    const date = parseDate(req.query.date);
    const rows = db
      .prepare(
        `SELECT id, record_date, meal_type, image_path, source, status,
                total_calories, total_protein, total_fat, total_carbs, note, created_at
           FROM diet_records
          WHERE user_id = ? AND record_date = ? AND status = 'done'
          ORDER BY CASE meal_type WHEN 'breakfast' THEN 1 WHEN 'lunch' THEN 2
                                  WHEN 'dinner' THEN 3 ELSE 4 END, id`
      )
      .all(currentUserId(DEFAULT_USER_ID), date);

    const itemStmt = db.prepare(
      `SELECT id, food_id, food_name, estimated_weight_g, calories, protein, fat, carbs, confidence, is_manual
         FROM diet_record_items WHERE diet_record_id = ? ORDER BY id`
    );
    const records = rows.map((r) => ({ ...r, items: itemStmt.all(r.id) }));

    const summary = {
      count: records.length,
      calories: round(records.reduce((s, r) => s + Number(r.total_calories || 0), 0), 0),
      protein: round(records.reduce((s, r) => s + Number(r.total_protein || 0), 0), 1),
      fat: round(records.reduce((s, r) => s + Number(r.total_fat || 0), 0), 1),
      carbs: round(records.reduce((s, r) => s + Number(r.total_carbs || 0), 0), 1),
      by_meal: MEAL_TYPES.reduce((acc, m) => {
        acc[m] = round(
          records.filter((r) => r.meal_type === m).reduce((s, r) => s + Number(r.total_calories || 0), 0),
          0
        );
        return acc;
      }, {}),
    };

    res.json({ ok: true, data: { date, records, summary } });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/diet/records/:id → 连同明细（FK 级联）和图片一起删 */
router.delete('/diet/records/:id', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, 'id 不合法');
    const row = db
      .prepare('SELECT image_path FROM diet_records WHERE id = ? AND user_id = ?')
      .get(id, currentUserId(DEFAULT_USER_ID));
    if (!row) throw new ApiError(404, '记录不存在');

    db.prepare('DELETE FROM diet_records WHERE id = ? AND user_id = ?').run(id, currentUserId(DEFAULT_USER_ID));
    const image_removed = removeImage(row.image_path);
    res.json({ ok: true, data: { id, deleted: true, image_removed } });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/diet/foods?q=米饭
 * 给「手动添加」做搜索用；不传 q 就返回全部营养库。
 */
router.get('/diet/foods', (req, res, next) => {
  try {
    const q = String(req.query.q ?? '').trim();
    const foods = listFoods();
    if (!q) {
      return res.json({ ok: true, data: { foods, query: '', matched: null } });
    }
    const matched = matchFood(q, foods);
    const lower = q.toLowerCase();
    const hits = foods.filter(
      (f) =>
        f.name.toLowerCase().includes(lower) ||
        String(f.alias ?? '').toLowerCase().includes(lower) ||
        String(f.category ?? '').toLowerCase().includes(lower)
    );
    res.json({
      ok: true,
      data: {
        query: q,
        foods: hits.length ? hits : matched ? [matched.food] : [],
        matched: matched ? { id: matched.food.id, name: matched.food.name, matched_by: matched.matched_by } : null,
      },
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/diet/meal-types → 餐次列表（前端渲染 chips 用，避免两边硬编码） */
router.get('/diet/meal-types', (req, res) => {
  res.json({
    ok: true,
    data: {
      meal_types: MEAL_TYPES.map((v) => ({ value: v, label: MEAL_LABELS[v] })),
      suggested: guessMealType(),
      today: todayLocal(),
    },
  });
});

export default router;
