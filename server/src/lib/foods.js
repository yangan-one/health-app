import { db } from '../db.js';
import { round } from './util.js';
import { cookingAdjustment, normalizeCookingMethod } from './cooking.js';

/**
 * 食物营养库匹配层。
 *
 * 为什么要有这一层：多模态模型给的克重通常还行，但「热量/蛋白/脂肪/碳水」经常随口给，
 * 同一道菜两次识别能差 30%。所以只要能在本地 foods 表里对上名字，就用表里的
 * per-100g 数据重算一遍，模型的数值只作为「对不上时」的兜底。
 */

/** 全量营养库（只有几十条，直接放内存里做匹配足够快） */
export function listFoods() {
  return db
    .prepare(
      `SELECT id, name, alias, category, calories_per_100g, protein_per_100g,
              fat_per_100g, carbs_per_100g, is_verified
         FROM foods ORDER BY category, name`
    )
    .all();
}

/** 名字归一化：去空格/括号内容/常见修饰词，方便「白米饭」对上「米饭」 */
export function normalizeFoodName(raw) {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[（(].*?[）)]/g, '') // 去掉 (熟) (小份) 这类补充说明
    .replace(/[\s·・]+/g, '')
    .replace(/^(一份|半碗|一碗|一盘|一大碗)/, '')
    .replace(/(左右|大概|约)$/, '');
}

const STOP_WORDS = ['米饭', '白饭', '主食', '配菜', '炒', '炸', '烤', '蒸', '煮', '红烧', '清炒'];

/**
 * 在营养库里找最像的一条。
 * 匹配顺序：完全相等 > 别名命中 > 互相包含（取更长的匹配）> 去掉做法词后再比。
 * @returns {{ food: object, matched_by: string } | null}
 */
export function matchFood(name, foods = null) {
  const target = normalizeFoodName(name);
  if (!target) return null;
  const pool = foods ?? listFoods();

  // 1. 完全相等
  const exact = pool.find((f) => normalizeFoodName(f.name) === target);
  if (exact) return { food: exact, matched_by: 'name' };

  // 2. 别名（alias 用逗号分隔多个）
  for (const f of pool) {
    const aliases = String(f.alias ?? '')
      .split(/[,，、/|]/)
      .map(normalizeFoodName)
      .filter(Boolean);
    if (aliases.includes(target)) return { food: f, matched_by: 'alias' };
  }

  // 3. 互相包含：菜名里含库里的名字，或库里的名字含菜名（都要求长度 >= 2，避免「肉」碰一切）
  let best = null;
  for (const f of pool) {
    const fn = normalizeFoodName(f.name);
    if (fn.length < 2) continue;
    if (target.includes(fn) || fn.includes(target)) {
      const score = Math.min(fn.length, target.length);
      if (!best || score > best.score) best = { food: f, matched_by: 'contains', score };
    }
  }
  if (best) return { food: best.food, matched_by: best.matched_by };

  // 4. 去掉做法/形容词再试一次（「红烧牛肉」-> 「牛肉」）
  const stripped = STOP_WORDS.reduce((acc, w) => acc.replaceAll(w, ''), target);
  if (stripped && stripped !== target && stripped.length >= 2) {
    const again = pool.find((f) => {
      const fn = normalizeFoodName(f.name);
      return fn.length >= 2 && (stripped.includes(fn) || fn.includes(stripped));
    });
    if (again) return { food: again, matched_by: 'stripped' };
  }

  return null;
}

/** 按 per-100g 数据换算一份食物的营养素 */
export function macrosForWeight(food, weightG) {
  const k = Number(weightG) / 100;
  return {
    calories: round(Number(food.calories_per_100g) * k, 0),
    protein: round(Number(food.protein_per_100g) * k, 1),
    fat: round(Number(food.fat_per_100g) * k, 1),
    carbs: round(Number(food.carbs_per_100g) * k, 1),
  };
}

const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

/**
 * 把一条「原始识别结果」变成可入库的明细：
 * - 能在营养库对上的 → 用 per-100g 重算（source='food_db'），再按烹饪方式加上油糖
 * - 对不上的 → 用模型给的数值（source='ai'，模型已按同一张油糖表算过，不再重复加）
 *
 * @param {{ food_name: string, cooking_method?: string, estimated_weight_g: number,
 *           calories?: number, protein?: number, fat?: number, carbs?: number,
 *           confidence?: number }} item
 */
export function resolveItemNutrition(item, { foods = null, forceAiValues = false } = {}) {
  const name = String(item.food_name ?? '').trim();
  const weight = num(item.estimated_weight_g, 0);
  const matched = forceAiValues ? null : matchFood(name, foods);

  let macros;
  let source;
  // 每 100g 基准值（不含烹饪用油）——返回给前端，让用户改克重时能本地重算且不重复加油
  let per100;
  // 烹饪方式的来源优先级：显式传入（模型识别的）→ 从菜名里推（「红烧牛肉」「炸鸡」）
  const explicitMethod = normalizeCookingMethod(item.cooking_method);
  let cooking = {
    applied: false,
    method: explicitMethod,
    oil_g: 0,
    sugar_g: 0,
    extra_calories: 0,
    note: null,
  };

  if (matched) {
    macros = macrosForWeight(matched.food, weight);
    source = 'food_db';
    per100 = {
      calories: round(Number(matched.food.calories_per_100g), 0),
      protein: round(Number(matched.food.protein_per_100g), 1),
      fat: round(Number(matched.food.fat_per_100g), 1),
      carbs: round(Number(matched.food.carbs_per_100g), 1),
    };
    // 营养库是「生重/水煮」基准，做法不同要补油糖
    const method = explicitMethod ?? normalizeCookingMethod(name);
    const adj = cookingAdjustment(method, weight, { foodName: matched.food.name });
    cooking = adj;
    if (adj.applied) {
      macros = {
        calories: round(macros.calories + adj.extra_calories, 0),
        protein: macros.protein,
        fat: round(macros.fat + adj.oil_g, 1),
        carbs: round(macros.carbs + adj.sugar_g, 1),
      };
    }
  } else {
    macros = {
      calories: round(num(item.calories), 0),
      protein: round(num(item.protein), 1),
      fat: round(num(item.fat), 1),
      carbs: round(num(item.carbs), 1),
    };
    source = 'ai';
    cooking.note = '该菜未命中营养库，营养值由模型直接给出（已包含烹饪用油）';
    // 模型给的是「这一份」的数值，换算成每 100g 便于前端改克重
    const k = weight > 0 ? 100 / weight : 0;
    per100 = k > 0
      ? {
          calories: round(num(item.calories) * k, 0),
          protein: round(num(item.protein) * k, 1),
          fat: round(num(item.fat) * k, 1),
          carbs: round(num(item.carbs) * k, 1),
        }
      : null;
  }

  return {
    food_id: matched?.food?.id ?? null,
    food_name: name,
    food_db_name: matched?.food?.name ?? null,
    matched_by: matched?.matched_by ?? null,
    estimated_weight_g: round(weight, 0),
    ...macros,
    per_100g: per100,
    confidence: item.confidence === undefined || item.confidence === null
      ? null
      : Math.min(1, Math.max(0, num(item.confidence))),
    source,
    cooking_method: cooking.method,
    cooking_applied: cooking.applied,
    cooking_note: cooking.note,
    cooking_adjust: cooking.applied
      ? { oil_g: cooking.oil_g, sugar_g: cooking.sugar_g, extra_calories: cooking.extra_calories }
      : null,
  };
}

/** 明细求和 */
export function sumItems(items) {
  const acc = items.reduce(
    (a, it) => ({
      calories: a.calories + num(it.calories),
      protein: a.protein + num(it.protein),
      fat: a.fat + num(it.fat),
      carbs: a.carbs + num(it.carbs),
    }),
    { calories: 0, protein: 0, fat: 0, carbs: 0 }
  );
  return {
    calories: round(acc.calories, 0),
    protein: round(acc.protein, 1),
    fat: round(acc.fat, 1),
    carbs: round(acc.carbs, 1),
  };
}
