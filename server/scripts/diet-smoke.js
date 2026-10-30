/**
 * 第四步接口冒烟：拍照识别 → 保存 → 看板 → 删除 的完整链路。
 *
 * 前置条件：
 *   1) 先启动后端，且用离线演示模式启动（不调真实模型，节省 token）：
 *        PowerShell:  $env:VISION_FAKE='1'; npm start
 *   2) 再另开终端执行：npm run smoke:diet
 *
 * 如果你已经配了真实视觉模型，也可以不加 VISION_FAKE 直接跑，
 * 脚本会发送一张 1x1 的纯色 PNG —— 真实模型多半识别不出食物，
 * 那样 analyze 会返回 422，属于预期，脚本会提示你改用演示模式。
 */
import assert from 'node:assert/strict';

import { installTestAuth } from './lib/test-auth.js';

const BASE = process.env.API_BASE || 'http://127.0.0.1:3001';
// 服务端配了 APP_PASSWORD 时自动登录（否则接口全 401）
await installTestAuth(BASE);
// 1x1 透明 PNG，够小，不会占用带宽
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

const results = [];
let createdIds = [];

async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, json };
}

async function check(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    results.push(true);
  } catch (err) {
    console.log(`  ✗ ${name}\n      ${err.message}`);
    results.push(false);
  }
}

const today = new Date();
const pad = (n) => String(n).padStart(2, '0');
const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

console.log(`\n第四步冒烟 -> ${BASE}\n`);

// 先记录今天的基线，最后用来验证删除后能回到原样
const baseline = await call('GET', `/api/dashboard?date=${todayStr}`);
const baseIntake = baseline.json?.data?.intake?.calories ?? 0;
console.log(`（今日基线摄入 ${baseIntake} kcal）\n`);

const settings = await call('GET', '/api/settings');
const fakeBefore = settings.json?.data?.ai?.vision?.fake === true;
// 脚本自己打开离线演示模式（跑完再恢复），这样不需要记着用 VISION_FAKE=1 启动服务
if (!fakeBefore) {
  const r = await call('PUT', '/api/settings/ai', { vision_fake: true });
  if (r.status !== 200) console.log('  ! 无法开启离线演示模式：', r.json?.message);
}
const fakeMode = true;
console.log(fakeMode ? '（已启用离线演示模式，不会调用真实模型）\n' : '\n');

await check('GET /api/diet/meal-types 返回 4 个餐次', async () => {
  const r = await call('GET', '/api/diet/meal-types');
  assert.equal(r.status, 200);
  assert.equal(r.json.data.meal_types.length, 4);
  assert.ok(r.json.data.meal_types.some((m) => m.value === 'lunch'));
});

await check('GET /api/diet/foods 返回营养库并支持搜索', async () => {
  const all = await call('GET', '/api/diet/foods');
  assert.ok(all.json.data.foods.length >= 58, `只有 ${all.json.data.foods.length} 条`);
  const q = await call('GET', '/api/diet/foods?q=' + encodeURIComponent('白米饭'));
  assert.equal(q.json.data.matched?.name, '米饭', '别名搜索应命中米饭');
  assert.ok(q.json.data.foods.length >= 1);
});

await check('缺少图片时 analyze 返回 400', async () => {
  const r = await call('POST', '/api/diet/analyze', { meal_type: 'lunch' });
  assert.equal(r.status, 400);
  assert.match(r.json.message, /图片/);
});

await check('非法 meal_type 返回 400', async () => {
  const r = await call('POST', '/api/diet/analyze', { image: TINY_PNG, meal_type: 'brunch' });
  assert.equal(r.status, 400);
  assert.match(r.json.message, /meal_type/);
});

let analyze;
// 期望合计（演示数据 + 烹饪用油修正）：米饭 174 + 鸡胸肉(煎) 268 + 西兰花(清炒) 77
const EXPECTED_TOTAL = 519;
await check('POST /api/diet/analyze 识别出 3 项并落盘图片', async () => {
  const r = await call('POST', '/api/diet/analyze', { image: TINY_PNG, meal_type: 'lunch' });
  assert.equal(r.status, 200, JSON.stringify(r.json).slice(0, 300));
  analyze = r.json.data;
  assert.equal(analyze.items.length, 3);
  assert.equal(analyze.meal_type, 'lunch');
  assert.match(analyze.image_path, /^\/uploads\/\d{4}-\d{2}-\d{2}\/.+\.png$/);
  // 三项都能对上营养库 → 用 per-100g 重算
  assert.ok(analyze.items.every((it) => it.source === 'food_db'), '应全部命中营养库');
  // 演示数据：米饭 150g 蒸 / 鸡胸肉 120g 煎 / 西兰花 80g 清炒
  // 煎与清炒会按烹饪方式补油（10g / 7g 每 100g），所以合计比"裸食材"的 361 高
  assert.ok(analyze.items.every((it) => it.cooking_method), '每项都应带烹饪方式');
  assert.equal(analyze.totals.calories, EXPECTED_TOTAL, `合计 ${analyze.totals.calories} != ${EXPECTED_TOTAL}`);
});

await check('图片可通过 /uploads 静态访问', async () => {
  const res = await fetch(`${BASE}${analyze.image_path}`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /image\/png/);
});

await check('POST /api/diet/records 保存识别结果（营养素服务端重算）', async () => {
  const payload = {
    meal_type: 'lunch',
    source: 'ai_image',
    image_path: analyze.image_path,
    note: analyze.note,
    ai_raw_response: { model: analyze.meta?.model, items: analyze.items },
    items: analyze.items.map((it) => ({
      food_name: it.food_name,
      estimated_weight_g: it.estimated_weight_g,
      // 故意传错的热量，验证服务端不吃前端数值
      calories: 9999,
      cooking_method: it.cooking_method,
      confidence: it.confidence,
    })),
  };
  const r = await call('POST', '/api/diet/records', payload);
  assert.equal(r.status, 201, JSON.stringify(r.json).slice(0, 300));
  const rec = r.json.data.record;
  createdIds.push(rec.id);
  assert.equal(rec.items.length, 3);
  assert.equal(rec.total_calories, EXPECTED_TOTAL, `记录合计 ${rec.total_calories} != ${EXPECTED_TOTAL}`);
  assert.equal(rec.source, 'ai_image');
  assert.equal(rec.image_path, analyze.image_path);
  assert.equal(rec.status, 'done');
});

await check('GET /api/diet/records 当天列表与合计正确', async () => {
  const r = await call('GET', `/api/diet/records?date=${todayStr}`);
  assert.equal(r.status, 200);
  assert.ok(r.json.data.records.length >= 1);
  const mine = r.json.data.records.find((x) => x.id === createdIds[0]);
  assert.ok(mine, '列表里应有刚保存的记录');
  assert.equal(mine.items.length, 3);
  assert.ok(r.json.data.summary.by_meal.lunch >= EXPECTED_TOTAL);
});

await check('看板摄入跟着增加', async () => {
  const r = await call('GET', `/api/dashboard?date=${todayStr}`);
  const intake = r.json.data.intake.calories;
  assert.ok(intake >= baseIntake + EXPECTED_TOTAL, `看板摄入 ${intake} 没跟上`);
  assert.equal(r.json.data.meals.length >= 1, true);
});

await check('手填项目：对不上营养库时用传入数值', async () => {
  const r = await call('POST', '/api/diet/records', {
    meal_type: 'snack',
    source: 'manual',
    items: [{ food_name: '邻居家的自制饼干', estimated_weight_g: 30, calories: 150, protein: 2, fat: 7, carbs: 20 }],
  });
  assert.equal(r.status, 201);
  const rec = r.json.data.record;
  createdIds.push(rec.id);
  assert.equal(rec.total_calories, 150);
  assert.equal(rec.total_fat, 7);
});

await check('菜名里带做法也能补油（红烧牛肉 100g > 牛肉 100g）', async () => {
  const plain = await call('POST', '/api/diet/records', {
    meal_type: 'dinner',
    source: 'ai_image',
    items: [{ food_name: '牛肉', estimated_weight_g: 100 }],
  });
  const braised = await call('POST', '/api/diet/records', {
    meal_type: 'dinner',
    source: 'ai_image',
    // 故意不传 cooking_method，让后端从菜名里推断「红烧」
    items: [{ food_name: '红烧牛肉', estimated_weight_g: 100 }],
  });
  assert.equal(plain.status, 201);
  assert.equal(braised.status, 201);
  createdIds.push(plain.json.data.record.id, braised.json.data.record.id);
  assert.ok(
    braised.json.data.record.total_calories > plain.json.data.record.total_calories,
    `红烧 ${braised.json.data.record.total_calories} 应大于水煮 ${plain.json.data.record.total_calories}`
  );
});

await check('重量为 0 的明细被拒绝', async () => {
  const r = await call('POST', '/api/diet/records', {
    meal_type: 'lunch',
    items: [{ food_name: '米饭', estimated_weight_g: 0 }],
  });
  assert.equal(r.status, 400);
  assert.match(r.json.message, /重量/);
});

await check('空明细被拒绝', async () => {
  const r = await call('POST', '/api/diet/records', { meal_type: 'lunch', items: [] });
  assert.equal(r.status, 400);
});

await check('DELETE 记录时连图片一起删除', async () => {
  const r = await call('DELETE', `/api/diet/records/${createdIds[0]}`);
  assert.equal(r.status, 200);
  assert.equal(r.json.data.image_removed, true, '图片应被删除');
  const img = await fetch(`${BASE}${analyze.image_path}`);
  assert.equal(img.status, 404, '静态图片应已 404');
});

await check('删除不存在的记录返回 404', async () => {
  const r = await call('DELETE', '/api/diet/records/999999');
  assert.equal(r.status, 404);
});

await check('清理后看板回到基线', async () => {
  const leftover = await call('GET', `/api/diet/records?date=${todayStr}`);
  for (const rec of leftover.json.data.records) {
    await call('DELETE', `/api/diet/records/${rec.id}`);
  }
  const r = await call('GET', `/api/dashboard?date=${todayStr}`);
  assert.equal(r.json.data.intake.calories, baseIntake, '应回到测试前的摄入');
});

const passed = results.filter(Boolean).length;
if (!fakeBefore) {
  await call('PUT', '/api/settings/ai', { vision_fake: false });
  console.log('\n（已把离线演示模式恢复为关闭）');
}
console.log(`\n结果: ${passed} 通过 / ${results.length - passed} 失败`);
if (passed !== results.length) process.exit(1);
