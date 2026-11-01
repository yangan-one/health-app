import { Router } from 'express';
import { db, DEFAULT_USER_ID, getCurrentUser } from '../db.js';
import { currentUserId } from '../lib/context.js';
import { ApiError, todayLocal } from '../lib/util.js';
import { shapeProfile } from './profile.js';
import { publicAiConfig } from '../lib/ai.js';

const router = Router();

const CSV_TABLES = {
  body: {
    file: 'body-metrics',
    columns: ['id', 'record_date', 'weight_kg', 'body_fat_pct', 'neck_cm', 'shoulder_cm',
      'chest_cm', 'arm_cm', 'waist_cm', 'hip_cm', 'thigh_cm', 'calf_cm', 'note'],
    sql: `SELECT id, record_date, weight_kg, body_fat_pct, neck_cm, shoulder_cm,
                 chest_cm, arm_cm, waist_cm, hip_cm, thigh_cm, calf_cm, note
          FROM body_metrics WHERE user_id = ? ORDER BY record_date ASC, id ASC`,
  },
  exercise: {
    file: 'exercise-records',
    columns: ['id', 'record_date', 'exercise_type_code', 'exercise_type_name', 'duration_min',
      'distance_km', 'weight_kg', 'met', 'calories_burned', 'note'],
    sql: `SELECT id, record_date, exercise_type_code, exercise_type_name, duration_min,
                 distance_km, weight_kg, met, calories_burned, note
          FROM exercise_records WHERE user_id = ? ORDER BY record_date ASC, id ASC`,
  },
  diet: {
    file: 'diet-records',
    columns: ['record_id', 'record_date', 'meal_type', 'source', 'status',
      'total_calories', 'total_protein', 'total_fat', 'total_carbs',
      'food_name', 'estimated_weight_g', 'calories', 'protein', 'fat', 'carbs',
      'confidence', 'created_at'],
    sql: `SELECT d.id AS record_id, d.record_date, d.meal_type, d.source, d.status,
                 d.total_calories, d.total_protein, d.total_fat, d.total_carbs,
                 i.food_name, i.estimated_weight_g, i.calories, i.protein, i.fat,
                 i.carbs, i.confidence, d.created_at
          FROM diet_records d
          LEFT JOIN diet_record_items i ON i.diet_record_id = d.id
          WHERE d.user_id = ?
          ORDER BY d.record_date ASC, d.id ASC, i.id ASC`,
  },
};

/** CSV 单元格转义：逗号/引号/换行一律用双引号包裹 */
function csvCell(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows, columns) {
  const cols = columns ?? Object.keys(rows[0] ?? {});
  const lines = [cols.join(',')];
  for (const row of rows) lines.push(cols.map((c) => csvCell(row[c])).join(','));
  return lines.join('\r\n');
}

/** GET /api/export?format=json | csv&table=body|exercise|diet */
router.get('/export', (req, res, next) => {
  try {
    const format = String(req.query.format || 'json').toLowerCase();
    const date = todayLocal();

    if (format === 'json') {
      const user = getCurrentUser();
      const dietRecords = db
        .prepare('SELECT * FROM diet_records WHERE user_id = ? ORDER BY record_date ASC, id ASC')
        .all(currentUserId(DEFAULT_USER_ID));
      const itemsStmt = db.prepare(
        'SELECT * FROM diet_record_items WHERE diet_record_id = ? ORDER BY id ASC'
      );

      const payload = {
        exported_at: new Date().toISOString(),
        app: 'health-app',
        schema_version: '0.3',
        profile: shapeProfile(user),
        body_metrics: db
          .prepare('SELECT * FROM body_metrics WHERE user_id = ? ORDER BY record_date ASC')
          .all(currentUserId(DEFAULT_USER_ID)),
        exercise_records: db
          .prepare('SELECT * FROM exercise_records WHERE user_id = ? ORDER BY record_date ASC, id ASC')
          .all(currentUserId(DEFAULT_USER_ID)),
        diet_records: dietRecords.map((r) => ({ ...r, items: itemsStmt.all(r.id) })),
        // 导出里也不带明文 Key
        settings: { ai: publicAiConfig() },
      };

      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="health-data-${date}.json"`);
      return res.send(JSON.stringify(payload, null, 2));
    }

    if (format === 'csv') {
      const table = String(req.query.table || 'body').toLowerCase();
      const conf = CSV_TABLES[table];
      if (!conf) {
        throw new ApiError(400, `table 只能是: ${Object.keys(CSV_TABLES).join(' / ')}`);
      }
      const rows = db.prepare(conf.sql).all(currentUserId(DEFAULT_USER_ID));
      const csv = toCsv(rows, conf.columns);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${conf.file}-${date}.csv"`);
      // BOM：让 Excel 正确识别 UTF-8（中文列名/备注不乱码）
      return res.send(`\uFEFF${csv}`);
    }

    throw new ApiError(400, 'format 只能是 json / csv');
  } catch (err) {
    next(err);
  }
});

/** GET /api/export/summary → 导出前的数据量概览（前端用来显示条数） */
router.get('/export/summary', (req, res) => {
  const one = (sql) => db.prepare(sql).get(currentUserId(DEFAULT_USER_ID))?.n ?? 0;
  res.json({
    ok: true,
    data: {
      body_metrics: one('SELECT COUNT(*) AS n FROM body_metrics WHERE user_id = ?'),
      exercise_records: one('SELECT COUNT(*) AS n FROM exercise_records WHERE user_id = ?'),
      diet_records: one('SELECT COUNT(*) AS n FROM diet_records WHERE user_id = ?'),
    },
  });
});

export default router;
