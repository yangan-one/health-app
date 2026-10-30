import { db, DEFAULT_USER_ID, getCurrentUser } from '../db.js';
import { round, todayLocal } from './util.js';
import {
  ageFromBirthDate,
  computeBmi,
  computeBmr,
  computeTdee,
  GOAL_TYPES,
  ACTIVITY_FACTORS,
  suggestCalorieGoal,
  waistHipRatio,
} from './body.js';

const ACTIVITY_LABELS = {
  sedentary: '久坐（几乎不运动）',
  light: '轻度运动（每周 1-3 次）',
  moderate: '中度运动（每周 3-5 次）',
  active: '高强度运动（每周 6-7 次）',
  very_active: '极高强度（体力劳动/一天两练）',
};

const MEAL_LABELS = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
  snack: '加餐',
};

const GENDER_LABELS = { male: '男', female: '女', other: '其他' };

/** 三大营养素目标，与看板口径保持一致：蛋白 1.5g/kg、脂肪 25% 热量、碳水占剩余 */
function macroGoals(goalCalories, weightKg) {
  const w = weightKg > 0 ? weightKg : 70;
  const protein_g = Math.round(w * 1.5);
  const fat_g = Math.round((goalCalories * 0.25) / 9);
  const carbs_g = Math.max(0, Math.round((goalCalories - protein_g * 4 - fat_g * 9) / 4));
  return { protein_g, fat_g, carbs_g };
}

function dayLabel(dateStr) {
  if (dateStr === todayLocal()) return `${dateStr}（今天）`;
  return dateStr;
}

/**
 * 把用户健康数据压成一段给大模型看的「上下文」。
 *
 * 设计取舍：
 * - 不塞原始 JSON（几千 token 且模型读不懂冗余字段），改成人类可读的短句，
 *   模型对「摄入 1580 kcal，目标 1650 kcal」这种表述最敏感。
 * - 只取近期窗口：今天 + 近 3 天饮食 + 近 7 天运动 + 近 14 天身体数据。
 *   再往前对「今天该怎么吃」几乎没有增量信息，只是浪费 token。
 * - 数据缺失要显式写出来（「无记录」），否则模型容易把 0 当成「没吃」。
 */
export function buildHealthContext({ date = todayLocal() } = {}) {
  const user = getCurrentUser();
  const lines = [];
  const empty = [];

  // ---------- 1. 档案 ----------
  const latest = db
    .prepare(
      `SELECT * FROM body_metrics
       WHERE user_id = ? AND weight_kg IS NOT NULL AND record_date <= ?
       ORDER BY record_date DESC LIMIT 1`
    )
    .get(DEFAULT_USER_ID, date);

  const weight = latest?.weight_kg ?? null;
  const height = user.height_cm ?? null;
  const age = ageFromBirthDate(user.birth_date);
  const bmi = computeBmi(weight, height);
  const bmr = computeBmr({ gender: user.gender, weightKg: weight, heightCm: height, age });
  const tdee = computeTdee(bmr, user.activity_level);
  const goalType = user.goal_type || 'maintain';

  lines.push('【用户档案】');
  const profileBits = [
    user.nickname ? `昵称「${user.nickname}」` : null,
    user.gender ? GENDER_LABELS[user.gender] ?? user.gender : null,
    age ? `${age} 岁` : null,
    height ? `${height} cm` : null,
    weight ? `${weight} kg` : '体重未记录',
    bmi ? `BMI ${bmi}` : null,
  ].filter(Boolean);
  lines.push(profileBits.join(' · '));

  lines.push(
    `目标：${GOAL_TYPES[goalType]?.label ?? '保持健康'}` +
      (user.target_weight_kg ? ` · 目标体重 ${user.target_weight_kg} kg` : '') +
      (ACTIVITY_FACTORS[user.activity_level]
        ? ` · 日常活动水平：${ACTIVITY_LABELS[user.activity_level] ?? user.activity_level}`
        : '')
  );
  if (bmr && tdee) {
    lines.push(`基础代谢 BMR 约 ${bmr} kcal，日常总消耗 TDEE 约 ${tdee} kcal`);
  }
  if (!weight) empty.push('体重/BMI/BMR（还没称过体重）');
  if (!user.birth_date) empty.push('年龄与 BMR（还没填出生日期）');
  if (!height) empty.push('身高');

  // ---------- 2. 身体围度 ----------
  const measures = db
    .prepare(
      `SELECT * FROM body_metrics
       WHERE user_id = ? AND record_date <= ?
       ORDER BY record_date DESC LIMIT 1`
    )
    .get(DEFAULT_USER_ID, date);

  if (measures) {
    const parts = [];
    if (measures.body_fat_pct != null) parts.push(`体脂 ${round(measures.body_fat_pct, 1)}%`);
    if (measures.waist_cm != null) parts.push(`腰围 ${round(measures.waist_cm, 1)} cm`);
    if (measures.chest_cm != null) parts.push(`胸围 ${round(measures.chest_cm, 1)} cm`);
    if (measures.hip_cm != null) parts.push(`臀围 ${round(measures.hip_cm, 1)} cm`);
    if (measures.arm_cm != null) parts.push(`臂围 ${round(measures.arm_cm, 1)} cm`);
    if (measures.thigh_cm != null) parts.push(`大腿围 ${round(measures.thigh_cm, 1)} cm`);
    if (measures.neck_cm != null) parts.push(`颈围 ${round(measures.neck_cm, 1)} cm`);
    if (measures.shoulder_cm != null) parts.push(`肩围 ${round(measures.shoulder_cm, 1)} cm`);
    if (measures.calf_cm != null) parts.push(`小腿围 ${round(measures.calf_cm, 1)} cm`);
    const whr = waistHipRatio(measures.waist_cm, measures.hip_cm);
    if (whr) parts.push(`腰臀比 ${whr}`);
    if (parts.length) {
      lines.push(`最近一次体测（${measures.record_date}）：${parts.join(' · ')}`);
    }
  } else {
    empty.push('体脂与围度');
  }

  // ---------- 3. 身体趋势（近 14 天） ----------
  const trend = db
    .prepare(
      `SELECT record_date, weight_kg, waist_cm, body_fat_pct
       FROM body_metrics
       WHERE user_id = ? AND record_date >= date(?, '-14 days') AND record_date <= ?
       ORDER BY record_date ASC`
    )
    .all(DEFAULT_USER_ID, date, date)
    .filter((r) => r.weight_kg != null || r.waist_cm != null || r.body_fat_pct != null);

  if (trend.length >= 2) {
    const first = trend[0];
    const last = trend[trend.length - 1];
    const delta = (a, b) => (a != null && b != null ? round(b - a, 1) : null);
    const bits = [];
    const dw = delta(first.weight_kg, last.weight_kg);
    if (dw != null) bits.push(`体重 ${first.weight_kg} → ${last.weight_kg} kg（${dw > 0 ? '+' : ''}${dw}）`);
    const dW = delta(first.waist_cm, last.waist_cm);
    if (dW != null) bits.push(`腰围 ${first.waist_cm} → ${last.waist_cm} cm（${dW > 0 ? '+' : ''}${dW}）`);
    const dB = delta(first.body_fat_pct, last.body_fat_pct);
    if (dB != null) bits.push(`体脂 ${first.body_fat_pct}% → ${last.body_fat_pct}%（${dB > 0 ? '+' : ''}${dB}）`);
    lines.push(`近 14 天身体变化（${first.record_date} → ${last.record_date}）：${bits.join('；')}`);
  }

  // ---------- 4. 今天吃什么、动了多少 ----------
  const todayRow =
    db
      .prepare('SELECT * FROM v_daily_summary WHERE user_id = ? AND record_date = ?')
      .get(DEFAULT_USER_ID, date) ?? null;

  const suggested = suggestCalorieGoal(tdee, goalType);
  const goalCalories = user.daily_calorie_goal || suggested || 1800;
  const macro = macroGoals(goalCalories, weight);

  const intake = {
    calories: round(todayRow?.intake_calories ?? 0, 0),
    protein: round(todayRow?.intake_protein ?? 0, 1),
    fat: round(todayRow?.intake_fat ?? 0, 1),
    carbs: round(todayRow?.intake_carbs ?? 0, 1),
  };
  const burn = round(todayRow?.burn_calories ?? 0, 0);
  const net = round(intake.calories - burn, 0);

  lines.push('');
  lines.push(`【${dayLabel(date)}】`);
  lines.push(
    `热量目标 ${goalCalories} kcal（蛋白 ${macro.protein_g}g / 脂肪 ${macro.fat_g}g / 碳水 ${macro.carbs_g}g）`
  );

  const remaining = round(goalCalories + burn - intake.calories, 0);
  lines.push(
    `今日还可摄入 ${remaining} kcal（预算 = 目标 ${goalCalories} + 运动 ${burn} − 已摄入 ${intake.calories}）`
  );

  if (intake.calories > 0) {
    lines.push(
      `已摄入 ${intake.calories} kcal（蛋白 ${intake.protein}g · 脂肪 ${intake.fat}g · 碳水 ${intake.carbs}g）`
    );
    if (intake.protein < macro.protein_g * 0.6) {
      lines.push(`蛋白质只到目标的 ${Math.round((intake.protein / macro.protein_g) * 100)}%，明显偏少`);
    }
  } else {
    lines.push('今天还没有饮食记录（所以已摄入记为 0，不是「没吃东西」的结论，可能是还没记）');
    empty.push('今日饮食');
  }

  lines.push(burn > 0 ? `运动消耗 ${burn} kcal，净热量（摄入−消耗）${net} kcal` : '今天还没有运动记录');
  if (burn === 0) empty.push('今日运动');

  // 今日餐次明细（最多 6 条，避免刷屏）
  const todayMeals = db
    .prepare(
      `SELECT meal_type, total_calories FROM diet_records
       WHERE user_id = ? AND record_date = ? AND status = 'done' ORDER BY id ASC`
    )
    .all(DEFAULT_USER_ID, date);
  if (todayMeals.length) {
    lines.push(
      '今日餐次：' +
        todayMeals
          .map((m) => `${MEAL_LABELS[m.meal_type] ?? m.meal_type} ${round(m.total_calories, 0)} kcal`)
          .join('；')
    );
  }

  const todayExercise = db
    .prepare(
      `SELECT exercise_type_name, duration_min, distance_km, calories_burned
       FROM exercise_records WHERE user_id = ? AND record_date = ? ORDER BY id ASC`
    )
    .all(DEFAULT_USER_ID, date);
  if (todayExercise.length) {
    lines.push(
      '今日运动：' +
        todayExercise
          .map(
            (e) =>
              `${e.exercise_type_name} ${round(e.duration_min, 0)} 分钟` +
              (e.distance_km ? `/${round(e.distance_km, 1)} km` : '') +
              `（${round(e.calories_burned, 0)} kcal）`
          )
          .join('；')
    );
  }

  // ---------- 5. 近 3 天汇总 ----------
  const recent = db
    .prepare(
      `SELECT * FROM v_daily_summary
       WHERE user_id = ? AND record_date < ? AND record_date >= date(?, '-7 days')
       ORDER BY record_date DESC LIMIT 3`
    )
    .all(DEFAULT_USER_ID, date, date);

  if (recent.length) {
    lines.push('');
    lines.push('【近 3 天】（摄入 / 消耗 kcal）');
    for (const r of recent) {
      lines.push(
        `${r.record_date}：摄入 ${round(r.intake_calories, 0)} / 消耗 ${round(r.burn_calories, 0)}` +
          ` · 蛋白 ${round(r.intake_protein, 0)}g 脂肪 ${round(r.intake_fat, 0)}g 碳水 ${round(r.intake_carbs, 0)}g`
      );
    }
  }

  // ---------- 6. 近 7 天运动构成 ----------
  const recentExercise = db
    .prepare(
      `SELECT exercise_type_name, COUNT(*) AS times, SUM(duration_min) AS minutes, SUM(calories_burned) AS kcal
       FROM exercise_records
       WHERE user_id = ? AND record_date < ? AND record_date >= date(?, '-7 days')
       GROUP BY exercise_type_name ORDER BY kcal DESC`
    )
    .all(DEFAULT_USER_ID, date, date);

  if (recentExercise.length) {
    const totalKcal = recentExercise.reduce((s, e) => s + (e.kcal ?? 0), 0);
    lines.push('');
    lines.push(`【近 7 天运动】共 ${round(totalKcal, 0)} kcal`);
    lines.push(
      recentExercise
        .map((e) => `${e.exercise_type_name} ${e.times} 次 ${round(e.minutes, 0)} 分钟`)
        .join('；')
    );
  }

  // ---------- 7. 缺什么数据要明说 ----------
  if (empty.length) {
    lines.push('');
    lines.push(`【尚未记录】${empty.join('、')}`);
  }

  const text = lines.join('\n');
  return {
    text,
    date,
    hasData: Boolean(todayRow || trend.length || measures),
    missing: empty,
    stats: {
      today_intake: intake.calories,
      today_burn: burn,
      goal_calories: goalCalories,
      weight_kg: weight,
      bmi,
      days_of_records: trend.length,
    },
  };
}
