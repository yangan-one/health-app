/**
 * 生成演示数据（示例数据，仅供前端联调）。
 * 用法: node scripts/seed-demo.js [天数，默认 14]
 * 可重复执行：会先删掉 note='demo' 的运动记录，再重新生成。
 */
import { db, DEFAULT_USER_ID, DB_PATH } from '../src/db.js';
import { todayLocal } from '../src/lib/util.js';
import { caloriesFromMet } from '../src/lib/met.js';

const DAYS = Math.min(Math.max(Number(process.argv[2]) || 14, 3), 90);

const upsertMetric = db.prepare(`
  INSERT INTO body_metrics
    (user_id, record_date, weight_kg, body_fat_pct, neck_cm, shoulder_cm,
     chest_cm, arm_cm, waist_cm, hip_cm, thigh_cm, calf_cm, note)
  VALUES (@user_id, @record_date, @weight_kg, @body_fat_pct, @neck_cm, @shoulder_cm,
          @chest_cm, @arm_cm, @waist_cm, @hip_cm, @thigh_cm, @calf_cm, 'demo')
  ON CONFLICT (user_id, record_date) DO UPDATE SET
    weight_kg = excluded.weight_kg,
    body_fat_pct = excluded.body_fat_pct,
    neck_cm = excluded.neck_cm,
    shoulder_cm = excluded.shoulder_cm,
    chest_cm = excluded.chest_cm,
    arm_cm = excluded.arm_cm,
    waist_cm = excluded.waist_cm,
    hip_cm = excluded.hip_cm,
    thigh_cm = excluded.thigh_cm,
    calf_cm = excluded.calf_cm,
    note = 'demo'
`);

const insertExercise = db.prepare(`
  INSERT INTO exercise_records
    (user_id, record_date, exercise_type_code, exercise_type_name, met,
     duration_min, distance_km, weight_kg, calories_burned, note)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'demo')
`);

db.prepare("DELETE FROM exercise_records WHERE user_id = ? AND note = 'demo'").run(DEFAULT_USER_ID);
db.prepare("DELETE FROM body_metrics WHERE user_id = ? AND note = 'demo'").run(DEFAULT_USER_ID);

const types = Object.fromEntries(
  db.prepare('SELECT * FROM exercise_types').all().map((t) => [t.code, t])
);

let exerciseCount = 0;
const round1 = (n) => Math.round(n * 10) / 10;

for (let i = DAYS - 1; i >= 0; i -= 1) {
  const d = new Date();
  d.setDate(d.getDate() - i);
  const date = todayLocal(d);

  // 体重从 74.5 缓慢降到 72.4，加一点确定性的小波动（不用随机数，保证可复现）
  const progress = (DAYS - 1 - i) / (DAYS - 1);
  const weight = round1(74.5 - 2.1 * progress + (i % 3 === 0 ? 0.3 : -0.1));
  const bodyFat = round1(21.8 - 3.2 * progress);

  upsertMetric.run({
    user_id: DEFAULT_USER_ID,
    record_date: date,
    weight_kg: weight,
    body_fat_pct: bodyFat,
    neck_cm: round1(38.2 - 0.4 * progress),
    shoulder_cm: round1(46.5 - 0.5 * progress),
    chest_cm: round1(98.6 - 1.4 * progress),
    arm_cm: round1(33.4 - 0.6 * progress),
    waist_cm: round1(84.0 - 2.0 * progress),
    hip_cm: round1(96.5 - 1.1 * progress),
    thigh_cm: round1(56.8 - 0.9 * progress),
    calf_cm: round1(37.6 - 0.3 * progress),
  });

  // 隔天安排一次运动
  if (i % 2 === 0) {
    const plan = [
      { code: 'running_8', duration: 30, distance: 4 },
      { code: 'jump_rope', duration: 15, distance: null },
      { code: 'cycling_16', duration: 45, distance: 12 },
      { code: 'strength', duration: 40, distance: null },
      { code: 'walking_5', duration: 50, distance: 4.2 },
    ][Math.floor(i / 2) % 5];

    const t = types[plan.code];
    insertExercise.run(
      DEFAULT_USER_ID,
      date,
      t.code,
      t.name,
      t.met,
      plan.duration,
      plan.distance,
      weight,
      caloriesFromMet(t.met, weight, plan.duration)
    );
    exerciseCount += 1;
  }
}

const metrics = db.prepare('SELECT COUNT(*) AS c FROM body_metrics').get().c;
console.log(`\n演示数据已写入: ${DB_PATH}`);
console.log(`  身体记录 ${metrics} 条 / 运动记录 ${exerciseCount} 条（近 ${DAYS} 天）`);
console.log('  提示：这些是示例数据，note 字段标记为 demo，可直接删除\n');
db.close();
