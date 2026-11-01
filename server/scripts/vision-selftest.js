/**
 * 纯离线自测：不联网、不依赖运行中的服务。
 * 覆盖两件事：
 *   1) 模型返回格式五花八门时，parseVisionResponse 能不能救回来
 *   2) 菜名 → 营养库匹配 + 按克重换算是否正确
 *
 * 用法：npm run selftest:vision
 */
import assert from 'node:assert/strict';
import { parseVisionResponse } from '../src/lib/vision.js';
import { matchFood, macrosForWeight, resolveItemNutrition, sumItems } from '../src/lib/foods.js';
import { listFoods } from '../src/lib/foods.js';
import { sanitizeApiKey, describeKeyProblem } from '../src/lib/apiKey.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const okJson = JSON.stringify({
  items: [
    { food_name: '白米饭', estimated_weight_g: 150, calories: 0, protein: 0, fat: 0, carbs: 0, confidence: 0.9 },
    { food_name: '番茄炒蛋', estimated_weight_g: 200, calories: 200, protein: 10, fat: 12, carbs: 8, confidence: 0.7 },
  ],
  meal_type_hint: 'lunch',
  note: '看到餐盘和米饭',
});

test('纯 JSON 直接解析', () => {
  const r = parseVisionResponse(okJson);
  assert.equal(r.items.length, 2);
  assert.equal(r.items[0].food_name, '白米饭');
  assert.equal(r.items[0].estimated_weight_g, 150);
  assert.equal(r.meal_type_hint, 'lunch');
});

test('```json 代码块包裹也能解析', () => {
  const r = parseVisionResponse('好的，结果如下：\n```json\n' + okJson + '\n```\n希望有帮助！');
  assert.equal(r.items.length, 2);
});

test('JSON 后面多一句话也能截取', () => {
  const r = parseVisionResponse(okJson + '\n以上是根据照片的估算。');
  assert.equal(r.items.length, 2);
});

test('重量写成 "约150g" 能抽成 150', () => {
  const r = parseVisionResponse(
    JSON.stringify({ items: [{ food_name: '米饭', estimated_weight_g: '约150g' }] })
  );
  assert.equal(r.items[0].estimated_weight_g, 150);
});

test('字段名漂移（name/weight）也能吃下', () => {
  const r = parseVisionResponse(JSON.stringify({ foods: [{ name: '鸡蛋', weight: 50 }] }));
  assert.equal(r.items[0].food_name, '鸡蛋');
  assert.equal(r.items[0].estimated_weight_g, 50);
});

test('空 items 返回空数组（由调用方决定报错）', () => {
  const r = parseVisionResponse(JSON.stringify({ items: [], note: '拍到的是一张人脸' }));
  assert.equal(r.items.length, 0);
  assert.equal(r.note, '拍到的是一张人脸');
});

test('完全不是 JSON 时抛 502', () => {
  assert.throws(() => parseVisionResponse('抱歉，我无法识别这张图片。'), /没有按要求返回 JSON/);
});

test('空内容抛 502', () => {
  assert.throws(() => parseVisionResponse('   '), /空内容/);
});

test('菜名精确匹配营养库', () => {
  const m = matchFood('鸡胸肉');
  assert.equal(m.food.name, '鸡胸肉');
  assert.equal(m.matched_by, 'name');
});

test('别名匹配：白米饭 → 米饭', () => {
  const m = matchFood('白米饭');
  assert.equal(m.food.name, '米饭');
});

test('包含关系：一碗白米饭 → 米饭', () => {
  const m = matchFood('一碗白米饭');
  assert.equal(m.food.name, '米饭');
});

test('去掉做法词：红烧牛肉 → 牛肉', () => {
  const m = matchFood('红烧牛肉');
  assert.ok(m, '应该能匹配上');
  assert.equal(m.food.name, '牛肉');
});

test('匹配不到返回 null（不瞎猜）', () => {
  assert.equal(matchFood('外婆家的秘制酱'), null);
});

test('克重换算：150g 米饭 = 174 kcal', () => {
  const food = listFoods().find((f) => f.name === '米饭');
  const m = macrosForWeight(food, 150);
  assert.equal(m.calories, 174);
  assert.equal(m.protein, 3.9);
});

test('对上营养库时以库为准（覆盖模型乱给的热量）', () => {
  const it = resolveItemNutrition({
    food_name: '白米饭',
    estimated_weight_g: 150,
    calories: 9999, // 模型瞎报
    protein: 99,
    fat: 99,
    carbs: 99,
    confidence: 0.8,
  });
  assert.equal(it.source, 'food_db');
  assert.equal(it.calories, 174);
  assert.equal(it.food_db_name, '米饭');
  assert.ok(it.food_id > 0);
});

test('对不上营养库时用模型数值', () => {
  const it = resolveItemNutrition({
    food_name: '外婆家的秘制酱',
    estimated_weight_g: 30,
    calories: 120,
    protein: 2,
    fat: 9,
    carbs: 7,
  });
  assert.equal(it.source, 'ai');
  assert.equal(it.calories, 120);
  assert.equal(it.food_id, null);
});

test('求和四舍五入正确', () => {
  const t = sumItems([
    { calories: 174, protein: 3.9, fat: 0.5, carbs: 38.9 },
    { calories: 160, protein: 23.3, fat: 6, carbs: 3 },
  ]);
  assert.equal(t.calories, 334);
  assert.equal(t.protein, 27.2);
  assert.equal(t.fat, 6.5);
  assert.equal(t.carbs, 41.9);
});

test('营养库至少 58 条且有别名', () => {
  const foods = listFoods();
  assert.ok(foods.length >= 58, `只有 ${foods.length} 条`);
  assert.ok(foods.filter((f) => f.alias).length >= 10, '别名太少');
});

// ---------- API Key 清洗（云端环境变量最容易出错的地方）----------
test('干净的 Key 原样通过', () => {
  const r = sanitizeApiKey('9a62f0d7c1b24e58a3fd0c9e6b17d4a2f8e35c60ab4d');
  assert.equal(r.reason, null);
  assert.ok(r.value.startsWith('9a62f'));
});

test('首尾空白、BOM、被一起粘进来的引号会被清掉', () => {
  const r = sanitizeApiKey('\uFEFF  "9a62f0d7c1b24e58a3fd0c9e6b17d4a2f8e35c60"  ');
  assert.equal(r.reason, null);
  assert.equal(r.value, '9a62f0d7c1b24e58a3fd0c9e6b17d4a2f8e35c60');
});

test('中文占位符被判定为不可用，并指出第几个字符坏了', () => {
  const r = sanitizeApiKey('【本机 server/.env 里那行 49 字符的 Key】');
  assert.equal(r.value, '');
  assert.equal(r.reason, 'invalid_char');
  assert.equal(r.char, '【');
  assert.equal(r.position, 1);
  // 这正是线上那条报错的来源：Unicode 12304 = 全角左书中括号
  assert.equal(r.code, 12304);
});

test('中间混入全角字符也能定位（模拟半截中文说明）', () => {
  const r = sanitizeApiKey('sk-abc12（请填真实Key）');
  assert.equal(r.reason, 'invalid_char');
  assert.equal(r.char, '（');
  assert.equal(r.position, 9);
});

test('太短的 Key 判为没复制完整', () => {
  const r = sanitizeApiKey('sk-123');
  assert.equal(r.value, '');
  assert.equal(r.reason, 'too_short');
});

test('空值与纯空白判为空', () => {
  assert.equal(sanitizeApiKey('').reason, 'empty');
  assert.equal(sanitizeApiKey('   ').reason, 'empty');
  assert.equal(sanitizeApiKey(undefined).reason, 'empty');
});

test('错误提示会带上变量名且能看懂', () => {
  const r = sanitizeApiKey('【填你的 Key】');
  const text = describeKeyProblem(r, { name: 'AI_VISION_API_KEY' });
  assert.ok(text.includes('AI_VISION_API_KEY'), text);
  assert.ok(text.includes('【'), text);
  assert.ok(!/ByteString|12304/.test(text), '不该把底层报错抛给用户');
});

let passed = 0;
const failures = [];
for (const t of tests) {
  try {
    await t.fn();
    console.log(`  ✓ ${t.name}`);
    passed += 1;
  } catch (err) {
    console.log(`  ✗ ${t.name}\n      ${err.message}`);
    failures.push({ name: t.name, err });
  }
}

console.log(`\n结果: ${passed} 通过 / ${failures.length} 失败`);
if (failures.length) process.exit(1);
