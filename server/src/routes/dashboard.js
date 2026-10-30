import { Router } from 'express';
import { db, DEFAULT_USER_ID, getCurrentUser } from '../db.js';
import { parseDate, round } from '../lib/util.js';
import {
  computeBmi,
  computeBmr,
  computeTdee,
  suggestCalorieGoal,
  ageFromBirthDate,
  GOAL_TYPES,
} from '../lib/body.js';

const router = Router();

const ZERO = {
  intake_calories: 0,
  intake_protein: 0,
  intake_fat: 0,
  intake_carbs: 0,
  burn_calories: 0,
  net_calories: 0,
};

/**
 * 三大营养素目标（简化版）：
 *   蛋白质 1.5g/kg 体重（增肌/减脂通用）
 *   脂肪   占目标热量 25%
 *   碳水   剩余热量
 */
function macroGoals(goalCalories, weightKg) {
  const w = weightKg > 0 ? weightKg : 70;
  const protein_g = Math.round(w * 1.5);
  const fat_g = Math.round((goalCalories * 0.25) / 9);
  const carbs_g = Math.max(0, Math.round((goalCalories - protein_g * 4 - fat_g * 9) / 4));
  return { protein_g, fat_g, carbs_g };
}

/**
 * GET /api/dashboard?date=YYYY-MM-DD
 * 首页一次拿全：当日摄入 / 消耗 / 净热量 / 目标 / 运动明细 / 最近体测。
 */
router.get('/dashboard', (req, res) => {
  const date = parseDate(req.query.date, 'date');
  const user = getCurrentUser();

  const row =
    db
      .prepare('SELECT * FROM v_daily_summary WHERE user_id = ? AND record_date = ?')
      .get(DEFAULT_USER_ID, date) ?? ZERO;

  const exercises = db
    .prepare(
      `SELECT id, exercise_type_name, duration_min, distance_km, calories_burned
       FROM exercise_records
       WHERE user_id = ? AND record_date = ?
       ORDER BY id DESC`
    )
    .all(DEFAULT_USER_ID, date);

  const meals = db
    .prepare(
      `SELECT id, meal_type, source, total_calories, total_protein, total_fat, total_carbs
       FROM diet_records
       WHERE user_id = ? AND record_date = ? AND status = 'done'
       ORDER BY id ASC`
    )
    .all(DEFAULT_USER_ID, date);

  const latest = db
    .prepare(
      `SELECT * FROM body_metrics
       WHERE user_id = ? AND weight_kg IS NOT NULL
       ORDER BY record_date DESC LIMIT 1`
    )
    .get(DEFAULT_USER_ID);

  const weekAgo = db
    .prepare(
      `SELECT weight_kg FROM body_metrics
       WHERE user_id = ? AND weight_kg IS NOT NULL AND record_date <= date(?, '-7 days')
       ORDER BY record_date DESC LIMIT 1`
    )
    .get(DEFAULT_USER_ID, date);

  // 目标热量：用户在「我的」页填的优先；没填就按 BMR/TDEE + 目标类型推荐
  const bmr = computeBmr({
    gender: user.gender,
    weightKg: latest?.weight_kg,
    heightCm: user.height_cm,
    age: ageFromBirthDate(user.birth_date),
  });
  const suggested = suggestCalorieGoal(computeTdee(bmr, user.activity_level), user.goal_type);
  const goalCalories = user.daily_calorie_goal || suggested || 1800;
  const goalSource = user.daily_calorie_goal ? 'user' : suggested ? 'suggested' : 'default';
  const net = round(row.intake_calories - row.burn_calories, 0);

  res.json({
    ok: true,
    data: {
      date,
      profile: {
        nickname: user.nickname,
        height_cm: user.height_cm,
        activity_level: user.activity_level,
        target_weight_kg: user.target_weight_kg,
        goal_type: user.goal_type || 'maintain',
        goal_label: GOAL_TYPES[user.goal_type || 'maintain']?.label ?? '保持健康',
      },
      goal: {
        calories: goalCalories,
        source: goalSource,
        suggested_calories: suggested,
        ...macroGoals(goalCalories, latest?.weight_kg),
      },
      intake: {
        calories: round(row.intake_calories, 0),
        protein: round(row.intake_protein, 1),
        fat: round(row.intake_fat, 1),
        carbs: round(row.intake_carbs, 1),
      },
      burn: {
        calories: round(row.burn_calories, 0),
        count: exercises.length,
        duration_min: round(
          exercises.reduce((s, e) => s + e.duration_min, 0),
          0
        ),
      },
      net: {
        calories: net,
        remaining: round(goalCalories - net, 0),
        over_goal: net > goalCalories,
      },
      exercises,
      meals,
      body: {
        latest_weight_kg: latest?.weight_kg ?? null,
        latest_date: latest?.record_date ?? null,
        bmi: computeBmi(latest?.weight_kg, user.height_cm),
        delta_7d:
          latest?.weight_kg != null && weekAgo?.weight_kg != null
            ? round(latest.weight_kg - weekAgo.weight_kg, 1)
            : null,
      },
    },
  });
});

export default router;
