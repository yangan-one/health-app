import { round } from './util.js';

/** BMI = 体重(kg) / 身高(m)^2 */
export function computeBmi(weightKg, heightCm) {
  if (!(weightKg > 0) || !(heightCm > 0)) return null;
  const m = heightCm / 100;
  return round(weightKg / (m * m), 1);
}

/** 腰臀比 = 腰围 / 臀围，中心性肥胖参考值：男 >= 0.90，女 >= 0.85 */
export function waistHipRatio(waistCm, hipCm) {
  if (!(waistCm > 0) || !(hipCm > 0)) return null;
  return round(waistCm / hipCm, 2);
}

/** 由出生日期算周岁 */
export function ageFromBirthDate(birthDate, now = new Date()) {
  if (!birthDate) return null;
  const b = new Date(`${birthDate}T00:00:00`);
  if (Number.isNaN(b.getTime())) return null;
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

/** 活动系数 */
export const ACTIVITY_FACTORS = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

/**
 * 基础代谢率 BMR（Mifflin-St Jeor，比 Harris-Benedict 更准）
 *   男：10w + 6.25h - 5age + 5
 *   女：10w + 6.25h - 5age - 161
 */
export function computeBmr({ gender, weightKg, heightCm, age }) {
  if (!(weightKg > 0) || !(heightCm > 0) || age == null) return null;
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  const bmr = gender === 'female' ? base - 161 : base + 5;
  return Math.round(bmr);
}

/** 每日总消耗 TDEE = BMR × 活动系数 */
export function computeTdee(bmr, activityLevel) {
  if (!(bmr > 0)) return null;
  const factor = ACTIVITY_FACTORS[activityLevel] ?? 1.375;
  return Math.round(bmr * factor);
}

/** 目标类型：减脂 / 保持 / 增肌 */
export const GOAL_TYPES = {
  lose_fat: { label: '减脂', delta: -400 },
  maintain: { label: '保持健康', delta: 0 },
  gain_muscle: { label: '增肌', delta: 300 },
};

/**
 * 按目标类型给出建议每日热量（取整到 10 kcal，最低 1000 kcal）
 * 只做「建议」，最终以用户手动填写的 daily_calorie_goal 为准。
 */
export function suggestCalorieGoal(tdee, goalType = 'maintain') {
  if (!(tdee > 0)) return null;
  const delta = GOAL_TYPES[goalType]?.delta ?? 0;
  return Math.max(1000, Math.round((tdee + delta) / 10) * 10);
}
