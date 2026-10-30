/**
 * 接口冒烟测试：不依赖任何测试框架，直接 node scripts/smoke.js
 * 前提：服务已启动（npm run dev）
 */
import { installTestAuth } from './lib/test-auth.js';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3001';
// 服务端配了 APP_PASSWORD 时自动登录（否则接口全 401）
await installTestAuth(BASE);

let pass = 0;
let fail = 0;
const failures = [];

function check(name, cond, actual) {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    failures.push(name);
    console.log(`  ✗ ${name}  实际值: ${JSON.stringify(actual)}`);
  }
}

async function req(method, url, body) {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

console.log(`\n冒烟测试 -> ${BASE}\n`);

// 1. 健康检查
const health = await req('GET', '/api/health');
check('GET /api/health 返回 200 且 ok=true', health.status === 200 && health.json.ok === true, health.json);
const TODAY = health.json.today;

// 2. 用户资料
const profile = await req('GET', '/api/profile');
check('GET /api/profile 有 BMI / TDEE 派生值', profile.status === 200 && 'bmi' in profile.json.data, profile.json.data);

// 3. 身体数据：全量录入
const full = await req('POST', '/api/body-metrics', {
  record_date: TODAY,
  weight_kg: 72.4,
  body_fat_pct: 18.6,
  neck_cm: 38,
  shoulder_cm: 46,
  chest_cm: 98,
  arm_cm: 33,
  waist_cm: 82,
  hip_cm: 96,
  thigh_cm: 56,
  calf_cm: 37,
});
check('POST /api/body-metrics 返回 201', full.status === 201, full.json);
check('BMI 计算正确 (72.4 / 1.75² ≈ 23.6)', full.json.data?.bmi === 23.6, full.json.data?.bmi);
check('腰臀比计算正确 (82 / 96 ≈ 0.85)', full.json.data?.waist_hip_ratio === 0.85, full.json.data?.waist_hip_ratio);

// 4. 同一天只提交体重 -> 其余字段保持原值（PATCH 语义）
const patch = await req('POST', '/api/body-metrics', { record_date: TODAY, weight_kg: 73 });
check('同日重复提交为覆盖更新 (201)', patch.status === 201, patch.json);
check('未提交的字段保持不变 (waist_cm 仍为 82)', patch.json.data?.waist_cm === 82, patch.json.data?.waist_cm);
check('已提交的字段被更新 (weight_kg=73)', patch.json.data?.weight_kg === 73, patch.json.data?.weight_kg);

// 5. 非法数据拦截
const bad = await req('POST', '/api/body-metrics', { weight_kg: 9999 });
check('体重 9999 被拒绝 (400)', bad.status === 400, bad.status);
const empty = await req('POST', '/api/body-metrics', { record_date: TODAY });
check('空提交被拒绝 (400)', empty.status === 400, empty.status);

// 6. 趋势数据
const trend = await req('GET', '/api/body-metrics/trend?days=30');
check('GET /api/body-metrics/trend 有数据点', trend.json.data?.points?.length >= 1, trend.json.data?.points?.length);

// 7. 运动类型字典
const types = await req('GET', '/api/exercise-types');
check('GET /api/exercise-types 返回 11 条', types.json.data?.length === 11, types.json.data?.length);

// 8. 试算：8.3 MET × 73kg × 30min = 8.3 × 3.5 × 73 / 200 × 30 ≈ 318.2
const calc = await req('POST', '/api/exercises/calc', { type_code: 'running_8', duration_min: 30 });
const expected = Math.round(((8.3 * 3.5 * 73) / 200) * 30 * 10) / 10;
check('试算接口取到最近体重 73kg', calc.json.data?.weight_kg === 73, calc.json.data?.weight_kg);
check(`试算卡路里 = ${expected}`, calc.json.data?.calories_burned === expected, calc.json.data?.calories_burned);

// 9. 落库
const created = await req('POST', '/api/exercises', {
  type_code: 'running_8',
  duration_min: 30,
  distance_km: 4,
  record_date: TODAY,
  note: '冒烟测试',
});
check('POST /api/exercises 返回 201', created.status === 201, created.json);
check('落库卡路里与试算一致', created.json.data?.calories_burned === expected, created.json.data?.calories_burned);

// 10. 当日列表
const list = await req('GET', `/api/exercises?date=${TODAY}`);
check('GET /api/exercises?date 含新记录', list.json.data?.some((r) => r.id === created.json.data?.id), list.json.summary);

// 11. 清理
const del = await req('DELETE', `/api/exercises/${created.json.data?.id}`);
check('DELETE /api/exercises/:id 成功', del.status === 200, del.status);

// 12. 未知类型
const unknown = await req('POST', '/api/exercises', { type_code: 'flying', duration_min: 10 });
check('未知运动类型被拒绝 (400)', unknown.status === 400, unknown.status);

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
if (fail > 0) {
  console.log(`失败项:\n - ${failures.join('\n - ')}`);
  process.exit(1);
}
