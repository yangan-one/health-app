import { Router } from 'express';
import { db, DEFAULT_USER_ID, getCurrentUser } from '../db.js';
import { ApiError, parseNumber, requireObject } from '../lib/util.js';
import {
  computeBmi,
  computeBmr,
  computeTdee,
  suggestCalorieGoal,
  ageFromBirthDate,
  ACTIVITY_FACTORS,
  GOAL_TYPES,
} from '../lib/body.js';

const router = Router();

const PUBLIC_FIELDS = [
  'id', 'username', 'nickname', 'gender', 'birth_date', 'height_cm',
  'activity_level', 'goal_type', 'daily_calorie_goal', 'target_weight_kg',
  'created_at', 'updated_at',
];

export function shapeProfile(user) {
  const out = {};
  for (const f of PUBLIC_FIELDS) out[f] = user[f];

  const latest = db
    .prepare(
      `SELECT weight_kg, record_date FROM body_metrics
       WHERE user_id = ? AND weight_kg IS NOT NULL
       ORDER BY record_date DESC LIMIT 1`
    )
    .get(DEFAULT_USER_ID);

  const age = ageFromBirthDate(user.birth_date);
  const bmr = computeBmr({
    gender: user.gender,
    weightKg: latest?.weight_kg,
    heightCm: user.height_cm,
    age,
  });
  const tdee = computeTdee(bmr, user.activity_level);

  return {
    ...out,
    goal_type: user.goal_type || 'maintain',
    goal_label: GOAL_TYPES[user.goal_type || 'maintain']?.label ?? '保持健康',
    latest_weight_kg: latest?.weight_kg ?? null,
    latest_weight_date: latest?.record_date ?? null,
    bmi: computeBmi(latest?.weight_kg, user.height_cm),
    age,
    bmr,
    tdee,
    // 按目标给出的建议热量，供「我的」页一键填入
    suggested_calorie_goal: suggestCalorieGoal(tdee, user.goal_type || 'maintain'),
    bmr_formula: 'Mifflin-St Jeor：男 10w+6.25h-5age+5 / 女 10w+6.25h-5age-161',
  };
}

/** GET /api/profile 当前用户资料 + 派生指标 */
router.get('/profile', (req, res) => {
  res.json({ ok: true, data: shapeProfile(getCurrentUser()) });
});

/**
 * PUT /api/profile 局部更新资料
 * body: { nickname?, gender?, birth_date?, height_cm?, activity_level?, goal_type?,
 *         daily_calorie_goal?, target_weight_kg? }
 */
router.put('/profile', (req, res) => {
  const body = requireObject(req.body);
  const sets = [];
  const params = {};

  if (body.nickname !== undefined) {
    sets.push('nickname = @nickname');
    params.nickname = body.nickname ? String(body.nickname).slice(0, 30) : null;
  }
  if (body.gender !== undefined) {
    if (!['male', 'female', 'other'].includes(body.gender)) {
      throw new ApiError(400, 'gender 只能是 male / female / other');
    }
    sets.push('gender = @gender');
    params.gender = body.gender;
  }
  if (body.birth_date !== undefined) {
    if (body.birth_date && !/^\d{4}-\d{2}-\d{2}$/.test(String(body.birth_date))) {
      throw new ApiError(400, 'birth_date 格式必须是 YYYY-MM-DD');
    }
    sets.push('birth_date = @birth_date');
    params.birth_date = body.birth_date || null;
  }
  if (body.height_cm !== undefined) {
    const r = parseNumber(body.height_cm, '身高(cm)', { min: 50, max: 300 });
    if (r.error) throw new ApiError(400, r.error);
    sets.push('height_cm = @height_cm');
    params.height_cm = r.value;
  }
  if (body.activity_level !== undefined) {
    if (!Object.keys(ACTIVITY_FACTORS).includes(body.activity_level)) {
      throw new ApiError(400, `activity_level 只能是: ${Object.keys(ACTIVITY_FACTORS).join(' / ')}`);
    }
    sets.push('activity_level = @activity_level');
    params.activity_level = body.activity_level;
  }
  if (body.goal_type !== undefined) {
    if (!Object.keys(GOAL_TYPES).includes(body.goal_type)) {
      throw new ApiError(400, `goal_type 只能是: ${Object.keys(GOAL_TYPES).join(' / ')}`);
    }
    sets.push('goal_type = @goal_type');
    params.goal_type = body.goal_type;
  }
  if (body.daily_calorie_goal !== undefined) {
    const r = parseNumber(body.daily_calorie_goal, '每日热量目标', { min: 800, max: 6000, integer: true });
    if (r.error) throw new ApiError(400, r.error);
    sets.push('daily_calorie_goal = @daily_calorie_goal');
    params.daily_calorie_goal = r.value;
  }
  if (body.target_weight_kg !== undefined) {
    const r = parseNumber(body.target_weight_kg, '目标体重(kg)', { min: 10, max: 400 });
    if (r.error) throw new ApiError(400, r.error);
    sets.push('target_weight_kg = @target_weight_kg');
    params.target_weight_kg = r.value;
  }

  if (sets.length === 0) throw new ApiError(400, '没有需要更新的字段');

  params.id = DEFAULT_USER_ID;
  db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = @id`).run(params);

  res.json({ ok: true, data: shapeProfile(getCurrentUser()) });
});

export default router;
