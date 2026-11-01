import { Router } from 'express';
import { db, DEFAULT_USER_ID, getCurrentUser } from '../db.js';
import { currentUserId } from '../lib/context.js';
import { ApiError, parseDate, parseNumber, requireObject, todayLocal } from '../lib/util.js';
import { METRIC_RULES, METRIC_META } from '../lib/metrics.js';
import { computeBmi, waistHipRatio } from '../lib/body.js';

const router = Router();

/** 给前端表单用的字段定义 */
router.get('/body-metrics/fields', (req, res) => {
  res.json({ ok: true, data: METRIC_META });
});

/** 把数据库行补上派生指标（BMI、腰臀比） */
function decorate(row, user) {
  if (!row) return null;
  return {
    ...row,
    bmi: computeBmi(row.weight_kg, user?.height_cm),
    waist_hip_ratio: waistHipRatio(row.waist_cm, row.hip_cm),
  };
}

/** 只挑出白名单字段并做数值校验 */
function readMetrics(body) {
  const errors = [];
  const values = {};
  for (const [field, rule] of Object.entries(METRIC_RULES)) {
    const { value, error } = parseNumber(body[field], rule.label, {
      min: rule.min,
      max: rule.max,
    });
    if (error) errors.push(error);
    else if (value !== null) values[field] = value;
  }
  if (errors.length) throw new ApiError(400, '数据校验失败', errors);
  if (Object.keys(values).length === 0) {
    throw new ApiError(400, '请至少填写一项身体数据（体重/体脂/任一围度）');
  }
  return values;
}

/**
 * POST /api/body-metrics
 * 录入或更新“某天”的身体数据。同一天重复提交 = 覆盖已填写的那几项。
 * body: { record_date?, weight_kg?, body_fat_pct?, neck_cm?, shoulder_cm?, chest_cm?,
 *         arm_cm?, waist_cm?, hip_cm?, thigh_cm?, calf_cm?, note? }
 */
router.post('/body-metrics', (req, res) => {
  const body = requireObject(req.body);
  const recordDate = parseDate(body.record_date);
  const values = readMetrics(body);

  const cols = Object.keys(values);
  const params = { user_id: currentUserId(DEFAULT_USER_ID), record_date: recordDate, ...values };

  if (body.note !== undefined) {
    if (body.note !== null && typeof body.note !== 'string') {
      throw new ApiError(400, 'note 必须是字符串');
    }
    cols.push('note');
    params.note = body.note ? String(body.note).slice(0, 500) : null;
  }

  const insertCols = ['user_id', 'record_date', ...cols].join(', ');
  const insertVals = ['@user_id', '@record_date', ...cols.map((c) => `@${c}`)].join(', ');
  // 冲突时只覆盖本次提交的列，没提交的列保持原值（PATCH 语义）
  const updateSet = cols.map((c) => `${c} = excluded.${c}`).join(', ');

  db.prepare(
    `INSERT INTO body_metrics (${insertCols}) VALUES (${insertVals})
     ON CONFLICT (user_id, record_date) DO UPDATE SET ${updateSet}`
  ).run(params);

  const saved = db
    .prepare('SELECT * FROM body_metrics WHERE user_id = ? AND record_date = ?')
    .get(currentUserId(DEFAULT_USER_ID), recordDate);

  res.status(201).json({ ok: true, data: decorate(saved, getCurrentUser()) });
});

/**
 * GET /api/body-metrics?from=2026-01-01&to=2026-12-31&limit=30
 * 历史列表，按日期倒序
 */
router.get('/body-metrics', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 30, 365);
  const from = req.query.from || '1970-01-01';
  const to = req.query.to || '9999-12-31';
  const rows = db
    .prepare(
      `SELECT * FROM body_metrics
       WHERE user_id = ? AND record_date BETWEEN ? AND ?
       ORDER BY record_date DESC LIMIT ?`
    )
    .all(currentUserId(DEFAULT_USER_ID), from, to, limit);
  const user = getCurrentUser();
  res.json({ ok: true, data: rows.map((r) => decorate(r, user)) });
});

/** GET /api/body-metrics/latest 最近一条 */
router.get('/body-metrics/latest', (req, res) => {
  const row = db
    .prepare(
      'SELECT * FROM body_metrics WHERE user_id = ? ORDER BY record_date DESC LIMIT 1'
    )
    .get(currentUserId(DEFAULT_USER_ID));
  res.json({ ok: true, data: decorate(row, getCurrentUser()) });
});

/**
 * GET /api/body-metrics/trend?days=30
 * 折线图专用：按日期升序返回，缺测的日子直接跳过（前端用 connectNulls 连线）
 */
router.get('/body-metrics/trend', (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 30, 7), 365);
  const start = new Date();
  start.setDate(start.getDate() - (days - 1));

  const rows = db
    .prepare(
      `SELECT record_date, weight_kg, body_fat_pct, waist_cm, chest_cm, hip_cm, arm_cm, thigh_cm
       FROM body_metrics
       WHERE user_id = ? AND record_date >= ?
       ORDER BY record_date ASC`
    )
    .all(currentUserId(DEFAULT_USER_ID), todayLocal(start));

  const user = getCurrentUser();
  const points = rows.map((r) => ({
    date: r.record_date,
    weight_kg: r.weight_kg,
    body_fat_pct: r.body_fat_pct,
    waist_cm: r.waist_cm,
    chest_cm: r.chest_cm,
    hip_cm: r.hip_cm,
    arm_cm: r.arm_cm,
    thigh_cm: r.thigh_cm,
    bmi: computeBmi(r.weight_kg, user?.height_cm),
  }));

  res.json({ ok: true, data: { days, points } });
});

/** DELETE /api/body-metrics/:id */
router.delete('/body-metrics/:id', (req, res) => {
  const info = db
    .prepare('DELETE FROM body_metrics WHERE id = ? AND user_id = ?')
    .run(req.params.id, currentUserId(DEFAULT_USER_ID));
  if (info.changes === 0) throw new ApiError(404, '记录不存在');
  res.json({ ok: true });
});

export default router;
