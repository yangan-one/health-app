/**
 * 数据迁移：把「导出 JSON」写回数据库。
 *
 * 两个入口共用这里的逻辑：
 *   - CLI：scripts/import-json.js（npm run db:import）
 *   - 网页：POST /api/admin/import（换手机/换服务器时在「我的」页点一下）
 *
 * 规则：
 *   - 身体数据按日期合并（同一天覆盖）
 *   - 运动/饮食默认跳过已存在的相同记录；replace=true 时先清空再导入
 */
import { db, DEFAULT_USER_ID } from '../db.js';
import { ApiError } from './util.js';

const BODY_COLS = ['record_date', 'weight_kg', 'body_fat_pct', 'neck_cm', 'shoulder_cm',
  'chest_cm', 'arm_cm', 'waist_cm', 'hip_cm', 'thigh_cm', 'calf_cm', 'note'];
const EX_COLS = ['record_date', 'exercise_type_code', 'exercise_type_name', 'duration_min',
  'distance_km', 'weight_kg', 'met', 'calories_burned', 'note'];
const DIET_COLS = ['record_date', 'meal_type', 'source', 'status', 'image_path',
  'ai_raw_response', 'total_calories', 'total_protein', 'total_fat', 'total_carbs', 'note'];
const ITEM_COLS = ['food_id', 'food_name', 'estimated_weight_g', 'calories', 'protein',
  'fat', 'carbs', 'confidence', 'is_manual'];
const PROFILE_COLS = ['nickname', 'gender', 'birth_date', 'height_cm', 'activity_level',
  'daily_calorie_goal', 'target_weight_kg', 'goal_type'];

const pick = (row, cols) => cols.map((c) => (row[c] === undefined ? null : row[c]));

const insertBody = db.prepare(
  `INSERT INTO body_metrics (user_id, ${BODY_COLS.join(', ')})
   VALUES (?, ${BODY_COLS.map(() => '?').join(', ')})
   ON CONFLICT (user_id, record_date) DO UPDATE SET
     ${BODY_COLS.slice(1).map((c) => `${c} = excluded.${c}`).join(', ')}`
);
const insertEx = db.prepare(
  `INSERT INTO exercise_records (user_id, ${EX_COLS.join(', ')})
   VALUES (?, ${EX_COLS.map(() => '?').join(', ')})`
);
const findEx = db.prepare(
  `SELECT id FROM exercise_records
    WHERE user_id = ? AND record_date = ? AND exercise_type_code IS ?
      AND duration_min IS ? AND calories_burned IS ?`
);
const insertDiet = db.prepare(
  `INSERT INTO diet_records (user_id, ${DIET_COLS.join(', ')})
   VALUES (?, ${DIET_COLS.map(() => '?').join(', ')})`
);
const insertItem = db.prepare(
  `INSERT INTO diet_record_items (diet_record_id, ${ITEM_COLS.join(', ')})
   VALUES (?, ${ITEM_COLS.map(() => '?').join(', ')})`
);

export function importPayload(payload, { replace = false, userId = DEFAULT_USER_ID } = {}) {
  if (!payload || typeof payload !== 'object') throw new ApiError(400, '导入内容不是对象');
  if (payload.app && payload.app !== 'health-app') {
    throw new ApiError(400, `这不是本应用导出的文件（app=${payload.app}）`);
  }

  const stats = { body: 0, exercise: 0, exercise_skipped: 0, diet: 0, diet_items: 0 };

  db.exec('BEGIN');
  try {
    // 1) 档案：只覆盖有值的字段
    const profile = payload.profile || {};
    const sets = [];
    const values = [];
    for (const col of PROFILE_COLS) {
      if (profile[col] !== undefined && profile[col] !== null) {
        sets.push(`${col} = ?`);
        values.push(profile[col]);
      }
    }
    if (sets.length) {
      db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...values, userId);
    }

    if (replace) {
      db.prepare(
        'DELETE FROM diet_record_items WHERE diet_record_id IN (SELECT id FROM diet_records WHERE user_id = ?)'
      ).run(userId);
      db.prepare('DELETE FROM diet_records WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM exercise_records WHERE user_id = ?').run(userId);
    }

    for (const row of payload.body_metrics || []) {
      insertBody.run(userId, ...pick(row, BODY_COLS));
      stats.body += 1;
    }

    for (const row of payload.exercise_records || []) {
      if (!replace) {
        const dup = findEx.get(userId, row.record_date, row.exercise_type_code ?? null,
          row.duration_min ?? null, row.calories_burned ?? null);
        if (dup) {
          stats.exercise_skipped += 1;
          continue;
        }
      }
      insertEx.run(userId, ...pick(row, EX_COLS));
      stats.exercise += 1;
    }

    for (const rec of payload.diet_records || []) {
      const info = insertDiet.run(userId, ...pick(rec, DIET_COLS));
      const recordId = Number(info.lastInsertRowid);
      stats.diet += 1;
      for (const item of rec.items || []) {
        insertItem.run(recordId, ...pick(item, ITEM_COLS));
        stats.diet_items += 1;
      }
    }

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    if (err instanceof ApiError) throw err;
    throw new ApiError(400, `导入失败：${err.message}`);
  }

  return { ...stats, replaced: replace };
}
