import { Router } from 'express';
import { db, DEFAULT_USER_ID } from '../db.js';
import { currentUserId } from '../lib/context.js';
import { ApiError, parseDate, parseNumber, requireObject } from '../lib/util.js';
import { caloriesFromMet, avgSpeedKmh } from '../lib/met.js';

const router = Router();

/** 运动类型字典（拖给前端做下拉框） */
router.get('/exercise-types', (req, res) => {
  const rows = db
    .prepare('SELECT * FROM exercise_types ORDER BY sort_order ASC')
    .all();
  res.json({ ok: true, data: rows });
});

function getType(code) {
  if (!code || typeof code !== 'string') throw new ApiError(400, '请选择运动类型 type_code');
  const type = db.prepare('SELECT * FROM exercise_types WHERE code = ?').get(code);
  if (!type) throw new ApiError(400, `未知的运动类型: ${code}`);
  return type;
}

/**
 * 解析体重：优先用请求里传的，否则回退到最近一次体测记录。
 * 返回 { weight, source }，source 用于告诉前端这个数字是怎么来的。
 */
function resolveWeight(raw) {
  const { value, error } = parseNumber(raw, '体重(kg)', { min: 10, max: 400 });
  if (error) throw new ApiError(400, error);
  if (value !== null) return { weight: value, source: 'request' };

  const row = db
    .prepare(
      `SELECT weight_kg FROM body_metrics
       WHERE user_id = ? AND weight_kg IS NOT NULL
       ORDER BY record_date DESC LIMIT 1`
    )
    .get(currentUserId(DEFAULT_USER_ID));
  if (row?.weight_kg) return { weight: row.weight_kg, source: 'latest_body_metric' };

  throw new ApiError(400, '还没有体重数据，请先录入体重，或手动传入 weight_kg');
}

/** 解析并校验运动参数（新增和试算共用） */
function readExerciseInput(body) {
  const type = getType(body.type_code);

  const dur = parseNumber(body.duration_min, '时长(分钟)', { min: 1, max: 1440 });
  if (dur.error) throw new ApiError(400, dur.error);
  if (dur.value === null) throw new ApiError(400, '请填写运动时长 duration_min');

  const dist = parseNumber(body.distance_km, '距离(km)', { min: 0, max: 1000 });
  if (dist.error) throw new ApiError(400, dist.error);

  const weight = resolveWeight(body.weight_kg);
  const calories = caloriesFromMet(type.met, weight.weight, dur.value);

  return {
    type,
    durationMin: dur.value,
    distanceKm: dist.value,
    weight: weight.weight,
    weightSource: weight.source,
    calories,
    speedKmh: avgSpeedKmh(dist.value, dur.value),
  };
}

/**
 * POST /api/exercises/calc
 * 只试算不落库 —— 前端填表时实时显示“本次消耗 xxx kcal”
 */
router.post('/exercises/calc', (req, res) => {
  const body = requireObject(req.body);
  const r = readExerciseInput(body);
  res.json({
    ok: true,
    data: {
      type_code: r.type.code,
      type_name: r.type.name,
      met: r.type.met,
      duration_min: r.durationMin,
      distance_km: r.distanceKm,
      weight_kg: r.weight,
      weight_source: r.weightSource,
      calories_burned: r.calories,
      speed_kmh: r.speedKmh,
      formula: 'kcal = MET × 3.5 × 体重(kg) / 200 × 时长(min)',
    },
  });
});

/**
 * POST /api/exercises
 * 新增一条运动记录，卡路里一律由服务端计算，不信任前端传值
 * body: { type_code, duration_min, distance_km?, weight_kg?, record_date?, note? }
 */
router.post('/exercises', (req, res) => {
  const body = requireObject(req.body);
  const r = readExerciseInput(body);
  const recordDate = parseDate(body.record_date);

  const info = db
    .prepare(
      `INSERT INTO exercise_records
         (user_id, record_date, exercise_type_code, exercise_type_name, met,
          duration_min, distance_km, weight_kg, calories_burned, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      currentUserId(DEFAULT_USER_ID),
      recordDate,
      r.type.code,
      r.type.name,
      r.type.met,
      r.durationMin,
      r.distanceKm,
      r.weight,
      r.calories,
      body.note ? String(body.note).slice(0, 500) : null
    );

  const row = db
    .prepare('SELECT * FROM exercise_records WHERE id = ?')
    .get(info.lastInsertRowid);
  res.status(201).json({ ok: true, data: row });
});

/**
 * GET /api/exercises?date=2026-10-30
 * 或 GET /api/exercises?from=...&to=...
 * 返回列表 + 合计消耗
 */
router.get('/exercises', (req, res) => {
  const date = req.query.date ? parseDate(req.query.date, 'date') : null;
  const from = req.query.from || '1970-01-01';
  const to = req.query.to || '9999-12-31';

  const rows = date
    ? db
        .prepare(
          `SELECT * FROM exercise_records
           WHERE user_id = ? AND record_date = ?
           ORDER BY id DESC`
        )
        .all(currentUserId(DEFAULT_USER_ID), date)
    : db
        .prepare(
          `SELECT * FROM exercise_records
           WHERE user_id = ? AND record_date BETWEEN ? AND ?
           ORDER BY record_date DESC, id DESC`
        )
        .all(currentUserId(DEFAULT_USER_ID), from, to);

  const total = rows.reduce((s, r) => s + r.calories_burned, 0);
  res.json({
    ok: true,
    data: rows,
    summary: {
      count: rows.length,
      total_calories: Math.round(total),
      total_duration_min: rows.reduce((s, r) => s + r.duration_min, 0),
      total_distance_km: Math.round(rows.reduce((s, r) => s + (r.distance_km || 0), 0) * 10) / 10,
    },
  });
});

/** DELETE /api/exercises/:id */
router.delete('/exercises/:id', (req, res) => {
  const info = db
    .prepare('DELETE FROM exercise_records WHERE id = ? AND user_id = ?')
    .run(req.params.id, currentUserId(DEFAULT_USER_ID));
  if (info.changes === 0) throw new ApiError(404, '记录不存在');
  res.json({ ok: true });
});

export default router;
