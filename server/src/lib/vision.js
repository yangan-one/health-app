import { ApiError } from './util.js';
import { getVisionConfig } from './ai.js';
import { COOKING_METHODS, normalizeCookingMethod } from './cooking.js';

export { COOKING_METHODS, normalizeCookingMethod };

/**
 * 拍照识别食物 —— 多模态模型调用层。
 *
 * 设计要点：
 * 1. 走 OpenAI 兼容的 /chat/completions（image_url + base64 data URL），
 *    这样智谱 / 通义 / OpenAI / 本地 vLLM 都能用同一份代码。
 * 2. Prompt 强制「四步走」：识别菜名 → 估克重 → 判断烹饪方式 → 按用油用糖修正热量。
 *    烹饪方式是最容易被忽略、但对热量影响最大的变量（同样 150g 鸡肉，水煮 ~200kcal，油炸接近 400kcal）。
 * 3. 解析层做双保险（模型加了 ```json、字段漂移、`"约150g"` 都能救回来）。
 * 4. 模型只负责「是什么 + 多重 + 怎么做的」，营养素最终由 lib/foods.js 用本地营养库重算，
 *    并叠加同一张「烹饪用油/用糖表」，保证前后端算法一致。
 */

export const MEAL_LABELS = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
  snack: '加餐',
};

/** 按当前时间猜是哪一餐，省得用户每次都要点 */
export function guessMealType(d = new Date()) {
  const h = d.getHours();
  if (h < 10) return 'breakfast';
  if (h < 15) return 'lunch';
  if (h < 21) return 'dinner';
  return 'snack';
}

export const VISION_SYSTEM_PROMPT = `你是一名有十年经验的注册营养师，擅长通过照片估算中式与西式餐食的份量与热量。
用户会给你一张真实拍摄的餐食照片。你必须先在内部严格按下面四步推演，再把结论写成 JSON。

【第一步：识别菜名】
逐个说出画面里能分辨的菜品或食材，名称要具体：「白米饭」「西兰花」「番茄炒蛋」，
不要写「菜」「主食」「一份食物」这种笼统词。混合菜（青椒肉丝、番茄炒蛋、宫保鸡丁）
要拆成主要食材分别列出，例如「猪肉」「青椒」。
识别不出的部分不要硬编，直接不列。

【第二步：估算重量】
先找参照物：成年人手掌宽 8-9cm、一根筷子约 25cm、标准饭碗口径 11-12cm、
常见餐盒单格约 12x10cm、易拉罐高约 12cm、一听可乐直径 6.6cm。
用参照物推算每样食物的面积与厚度，得到体积，再按密度折算重量：
- 米饭 / 面条 / 粥（稠）：0.9-1.0 g/cm³
- 炒菜、带汁的菜：0.6-0.8 g/cm³
- 纯肉类、豆制品：0.9 g/cm³
- 熟叶菜、菌菇：0.4-0.5 g/cm³
常见锚点：一小碗米饭 130-180g，一盘炒青菜 120-180g，一个鸡蛋 50g，
一块鸡胸肉 100-150g，一杯牛奶 250g，一个苹果 180g，一根油条 60-80g。

【第三步：判断烹饪方式（最关键的一步）】
同样是 150g 鸡胸肉：水煮约 200 kcal，而油炸接近 400 kcal——差别几乎全在油上。
请为每一项单独判断 cooking_method，只能从这个列表里选一个词：
水煮 / 蒸 / 白灼 / 凉拌 / 清炒 / 炒 / 煎 / 炸 / 烤 / 红烧 / 糖醋 / 卤 / 生食 / 未知
判断依据：表面油光与油滴、是否有面衣或裹粉、边缘是否焦脆（炸/煎）、
酱汁是否浓稠发亮发黏（红烧/糖醋）、是否见汤汁或水汽（水煮/蒸）、
是否凉菜（凉拌）。看不清就填「未知」。

【第四步：按烹饪方式修正热量】
下面的表给的是「每 100g 菜品」额外加入的油和糖（营养库里的数值是生重/水煮基准）：
- 水煮、蒸、白灼、生食：不加油糖
- 清炒、炒：额外 7g 油（约 63 kcal）
- 凉拌：额外 4g 油
- 烤：额外 3g 油
- 煎：额外 10g 油（约 90 kcal）
- 炸：额外 14g 油（约 126 kcal，裹粉吸油更多）
- 红烧：额外 7g 油 + 5g 糖
- 糖醋：额外 7g 油 + 10g 糖
- 卤：额外 2g 油
换算：油 9 kcal/g，糖 4 kcal/g。加的油记进 fat，加的糖记进 carbs。
计算顺序：先按 per-100g 基础营养 × 实际克重，再加上该菜的额外油糖。

【必须遵守】
- 只输出一个 JSON 对象，不要输出解释、不要 Markdown 代码块、不要前后缀文字。
- 重量单位克（g），热量单位千卡（kcal），蛋白质/脂肪/碳水单位克（g）。
- 如果画面里没有食物（拍糊了、拍的是人或风景），items 返回空数组，并在 note 里说明看到了什么。
- 数值保留整数或一位小数，不要写区间（不要 "150-200"），必须给一个具体数。
- confidence 用 0-1 之间的小数，表示你对「种类 + 份量 + 烹饪方式」整体的把握。
- reasoning 只写三条要点（每条不超过 30 字），分别对应第一、二、三步的结论。

【输出结构】
{
  "items": [
    {
      "food_name": "食物名称（中文，尽量具体，如“白米饭”“鸡胸肉”“西兰花”）",
      "cooking_method": "列表里选一个，如“蒸”“炒”“炸”“水煮”",
      "estimated_weight_g": 150,
      "calories": 174,
      "protein": 3.9,
      "fat": 0.5,
      "carbs": 38.9,
      "confidence": 0.85
    }
  ],
  "reasoning": [
    "识别：白米饭、番茄炒蛋（拆成番茄与鸡蛋）",
    "份量：米饭一碗约 150g；鸡蛋 2 个约 100g",
    "烹饪：米饭蒸制不加油；番茄炒蛋为炒，按 +7g 油/100g 修正"
  ],
  "meal_type_hint": "根据画面推测的餐次，breakfast/lunch/dinner/snack 之一",
  "total_calories_estimate": 420,
  "note": "一句话说明识别依据或不确定性来源"
}`;

/** 拼出多模态消息；注意 image_url 用 data URL，服务端不额外托管图片给模型 */
export function buildVisionMessages(imageDataUrl, { mealType = null, hint = '' } = {}) {
  const meal = mealType && MEAL_LABELS[mealType] ? MEAL_LABELS[mealType] : '未知餐次';
  const text = [
    `这是一张${meal}的照片。请按四步推演：识别菜名 → 估算克重 → 判断烹饪方式 → 按用油用糖修正热量，然后输出 JSON。`,
    hint ? `用户补充说明：${hint}` : '',
    '提醒：炒/煎/炸的热量远高于水煮，不要漏掉烹饪用油；只输出 JSON。',
  ]
    .filter(Boolean)
    .join('\n');

  return [
    { role: 'system', content: VISION_SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        { type: 'text', text },
        // detail:low 能显著降低视觉 token 数，份量估算够用
        { type: 'image_url', image_url: { url: imageDataUrl, detail: 'low' } },
      ],
    },
  ];
}

const clampNum = (v, min, max, fallback = 0) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

/**
 * 从模型返回的文本里抠出 JSON。
 * 真实世界三种情况：纯 JSON、```json 包着、前后带一句「好的，结果如下」。
 */
export function parseVisionResponse(content) {
  if (typeof content !== 'string' || !content.trim()) {
    throw new ApiError(502, '模型返回了空内容');
  }

  let text = content.trim();
  // 去掉 ```json ... ``` 包裹
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();

  // 截取第一个 { 到最后一个 }（模型偶尔在 JSON 后面补一句话）
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new ApiError(502, '模型没有按要求返回 JSON', { preview: content.slice(0, 200) });
  }
  text = text.slice(start, end + 1);

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new ApiError(502, `模型返回的 JSON 解析失败：${err.message}`, {
      preview: text.slice(0, 200),
    });
  }

  const rawItems = Array.isArray(parsed.items)
    ? parsed.items
    : Array.isArray(parsed.foods)
      ? parsed.foods
      : Array.isArray(parsed)
        ? parsed
        : [];

  const items = rawItems
    .map((raw) => {
      const name = String(raw?.food_name ?? raw?.name ?? raw?.food ?? '').trim();
      if (!name) return null;
      return {
        food_name: name.slice(0, 40),
        // 模型可能给 "150g"、150、"约 150" —— 统一抽数字
        estimated_weight_g: clampNum(
          String(raw?.estimated_weight_g ?? raw?.weight_g ?? raw?.weight ?? '')
            .replace(/[^\d.]/g, ''),
          1,
          3000,
          100
        ),
        cooking_method: normalizeCookingMethod(
          raw?.cooking_method ?? raw?.cooking ?? raw?.method ?? ''
        ),
        calories: clampNum(raw?.calories ?? raw?.kcal, 0, 5000, 0),
        protein: clampNum(raw?.protein, 0, 500, 0),
        fat: clampNum(raw?.fat, 0, 500, 0),
        carbs: clampNum(raw?.carbs ?? raw?.carbohydrate, 0, 800, 0),
        confidence:
          raw?.confidence === undefined ? null : clampNum(raw.confidence, 0, 1, 0.5),
      };
    })
    .filter(Boolean);

  // reasoning 有的模型给数组、有的给一段字符串
  const reasoningRaw = parsed?.reasoning ?? parsed?.steps ?? null;
  const reasoning = Array.isArray(reasoningRaw)
    ? reasoningRaw.map((s) => String(s ?? '').trim()).filter(Boolean).slice(0, 5)
    : typeof reasoningRaw === 'string' && reasoningRaw.trim()
      ? reasoningRaw.split(/\n+/).map((s) => s.trim()).filter(Boolean).slice(0, 5)
      : [];

  return {
    items,
    reasoning,
    meal_type_hint: ['breakfast', 'lunch', 'dinner', 'snack'].includes(parsed?.meal_type_hint)
      ? parsed.meal_type_hint
      : null,
    note: String(parsed?.note ?? '').trim().slice(0, 300) || null,
    total_calories_estimate: Number.isFinite(Number(parsed?.total_calories_estimate))
      ? Math.round(Number(parsed.total_calories_estimate))
      : null,
  };
}

/** 离线演示模式的数据（不调用任何外部接口，用于没配 Key 时跑通链路） */
const FAKE_ITEMS = [
  { food_name: '米饭', cooking_method: '蒸', estimated_weight_g: 150, calories: 174, protein: 3.9, fat: 0.5, carbs: 38.9, confidence: 0.9 },
  { food_name: '鸡胸肉', cooking_method: '煎', estimated_weight_g: 120, calories: 160, protein: 31.2, fat: 3.5, carbs: 0, confidence: 0.82 },
  { food_name: '西兰花', cooking_method: '清炒', estimated_weight_g: 80, calories: 27, protein: 2.3, fat: 0.2, carbs: 4.9, confidence: 0.88 },
];

/**
 * 调用视觉模型识别一张图。
 * @param {string} imageDataUrl data:image/jpeg;base64,...
 * @returns {Promise<{items: Array, reasoning: string[], note: string|null, meal_type_hint: string|null, meta: object}>}
 */
export async function analyzeFoodImage(imageDataUrl, { mealType = null, hint = '', timeoutMs = Number(process.env.AI_VISION_TIMEOUT) || 60000 } = {}) {
  const cfg = getVisionConfig();

  // 离线演示模式：明确标记 mode='fake'，避免误以为真调用了模型
  if (cfg.fake) {
    return {
      items: FAKE_ITEMS,
      reasoning: [
        '识别：白米饭、鸡胸肉、西兰花',
        '份量：米饭一碗 150g；鸡胸一块 120g；西兰花一小份 80g',
        '烹饪：米饭蒸；鸡胸煎（+10g 油/100g）；西兰花清炒（+7g 油/100g）',
      ],
      note: '离线演示数据：未调用任何视觉模型（在 server/.env 里设 VISION_FAKE=0 即可切回真实识别）',
      meal_type_hint: mealType,
      meta: { mode: 'fake', model: 'fake-vision', latency_ms: 0, usage: null },
    };
  }

  if (!cfg.api_key) {
    throw new ApiError(
      400,
      '服务端还没有配置视觉模型的 API Key。请在 health-app/server/.env 里填 AI_VISION_API_KEY（视觉专用）或 AI_API_KEY，保存后重启后端（npm start）。'
    );
  }
  if (!cfg.model) {
    throw new ApiError(
      400,
      '服务端还没有配置视觉模型名。请在 health-app/server/.env 里填 AI_VISION_MODEL，例如 glm-4v-flash、qwen-vl-max、gpt-4o-mini。注意：DeepSeek 官方 API 只有文本模型（deepseek-chat），没有视觉模型。'
    );
  }

  const started = Date.now();
  let res;
  try {
    res = await fetch(`${cfg.base_url}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.api_key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: buildVisionMessages(imageDataUrl, { mealType, hint }),
        temperature: 0.2,
        // 智谱 glm-4v 系列限制 max_tokens ∈ [1, 1024]，超了直接 400，所以默认给 1024；
        // 换成上限更高的模型（如 gpt-4o-mini）可以在 .env 里用 AI_VISION_MAX_TOKENS 调大。
        max_tokens: Number(process.env.AI_VISION_MAX_TOKENS) || 1024,
        stream: false,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const message =
      err?.name === 'TimeoutError'
        ? `识别超时（${Math.round(timeoutMs / 1000)} 秒），可能是图片过大或网络不稳`
        : `无法连接视觉模型：${err?.message || '未知错误'}`;
    throw new ApiError(502, message);
  }

  const latency = Date.now() - started;
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }

  if (!res.ok) {
    const detail = body?.error?.message || text.slice(0, 300) || `HTTP ${res.status}`;
    const hintText =
      res.status === 404 || /model|not found/i.test(detail)
        ? '（看起来这个 Base URL 下没有该模型，请检查 .env 里的 AI_VISION_MODEL 与 AI_VISION_BASE_URL）'
        : '';
    throw new ApiError(502, `识别失败（HTTP ${res.status}）：${detail}${hintText}`);
  }

  const message = body?.choices?.[0]?.message;
  // 少数服务把 content 拆成分段数组
  const content = Array.isArray(message?.content)
    ? message.content.map((p) => p?.text ?? '').join('')
    : message?.content;

  const parsed = parseVisionResponse(content);
  if (!parsed.items.length) {
    throw new ApiError(422, parsed.note
      ? `没有识别出食物：${parsed.note}`
      : '没有识别出食物，换一张更清晰、能看清餐盘的照片试试');
  }

  return {
    ...parsed,
    meta: {
      mode: 'ai',
      model: cfg.model,
      base_url: cfg.base_url,
      latency_ms: latency,
      usage: body?.usage ?? null,
    },
  };
}
