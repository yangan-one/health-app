/**
 * METs（代谢当量）运动消耗计算
 *
 * 经典 ACSM 公式：
 *   kcal/min = MET × 3.5 × 体重(kg) / 200
 *   总消耗   = kcal/min × 时长(min)
 *
 * 等价于常见的简写 kcal = MET × 体重 × 小时数 × 1.05，
 * 这里统一用 3.5 / 200 的形式，读起来更贴近教科书，误差 < 6%。
 */
export function caloriesFromMet(met, weightKg, durationMin) {
  if (!(met > 0) || !(weightKg > 0) || !(durationMin > 0)) return 0;
  const kcalPerMin = (met * 3.5 * weightKg) / 200;
  return Math.round(kcalPerMin * durationMin * 10) / 10;
}

/** 由时长与距离推算平均速度 km/h（拿来做“是不是填错了”的温和提示，不参与计算） */
export function avgSpeedKmh(distanceKm, durationMin) {
  if (!(distanceKm > 0) || !(durationMin > 0)) return null;
  return Math.round((distanceKm / (durationMin / 60)) * 10) / 10;
}
