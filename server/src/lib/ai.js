import { deflateSync } from 'node:zlib';
import { db, DEFAULT_USER_ID } from '../db.js';
import { currentUserId } from './context.js';
import { ApiError } from './util.js';
import { sanitizeApiKey, describeKeyProblem } from './apiKey.js';

/** app_settings 里用到的键 */
export const SETTING_KEYS = {
  apiKey: 'ai_api_key',
  baseUrl: 'ai_base_url',
  model: 'ai_model',
  visionModel: 'ai_vision_model',
  visionBaseUrl: 'ai_vision_base_url',
  // 视觉功能常常用另一家厂商（比如 DeepSeek 做文本 + 智谱做图片），
  // 所以允许单独存一个 Key；留空就复用文本那个 Key。
  visionApiKey: 'ai_vision_api_key',
  visionFake: 'ai_vision_fake',
};

export const AI_DEFAULTS = {
  base_url: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  // 视觉模型没有默认值：DeepSeek 官方 API 目前只有文本模型，
  // 拍照识别必须由用户显式指定一个「OpenAI 兼容的多模态接口」。
  vision_model: '',
};

/**
 * 常见视觉模型预设（都是真实的 OpenAI 兼容接口）。
 * 放在服务端是为了让前端只做展示，避免两处硬编码漂移。
 */
export const VISION_PRESETS = [
  {
    id: 'zhipu',
    label: '智谱 GLM-4V',
    base_url: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4v-flash',
    note: '有免费额度，中文食物识别效果好',
  },
  {
    id: 'dashscope',
    label: '通义千问 VL',
    base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-vl-max',
    note: '阿里云百炼，中文菜系识别稳',
  },
  {
    id: 'openai',
    label: 'OpenAI GPT-4o',
    base_url: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    note: '英文/西餐识别更准',
  },
  {
    id: 'custom',
    label: '自定义（OpenAI 兼容）',
    base_url: '',
    model: '',
    note: '任何支持 /chat/completions + image_url 的服务',
  },
];

/** 读一条设置，没有就返回 null */
export function getSetting(key) {
  const row = db
    .prepare('SELECT value FROM app_settings WHERE user_id = ? AND key = ?')
    .get(currentUserId(DEFAULT_USER_ID), key);
  return row?.value ?? null;
}

/** 写一条设置（空值等价于删除） */
export function setSetting(key, value) {
  if (value === null || value === undefined || String(value).trim() === '') {
    db.prepare('DELETE FROM app_settings WHERE user_id = ? AND key = ?').run(currentUserId(DEFAULT_USER_ID), key);
    return;
  }
  db.prepare(
    `INSERT INTO app_settings (user_id, key, value) VALUES (@user_id, @key, @value)
     ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value,
       updated_at = datetime('now', 'localtime')`
  ).run({ user_id: currentUserId(DEFAULT_USER_ID), key, value: String(value).trim() });
}

/** 读文本模型的原始配置（不含「复用视觉 Key」的兜底），避免 getVisionConfig ↔ getAiConfig 循环调用 */
function textConfigRaw() {
  const dbKeyRes = sanitizeApiKey(getSetting(SETTING_KEYS.apiKey));
  const dbKey = dbKeyRes.value;
  const envKeyRes = sanitizeApiKey(process.env.AI_API_KEY);
  const envKey = envKeyRes.value;
  const dbBase = getSetting(SETTING_KEYS.baseUrl);
  const envBase = process.env.AI_BASE_URL || '';
  const dbModel = getSetting(SETTING_KEYS.model);
  const envModel = process.env.AI_MODEL || '';
  const explicitBase = dbBase || envBase || '';
  return {
    api_key: dbKey || envKey || '',
    key_source: dbKey ? 'db' : envKey ? 'env' : 'none',
    explicit_base: explicitBase,
    base_url: (explicitBase || AI_DEFAULTS.base_url).replace(/\/+$/, ''),
    model_raw: dbModel || envModel || '',
    // 环境变量里填了不可用的 Key（典型：原样粘了中文占位说明）时，这里带一句人话
    env_key_invalid:
      envKeyRes.reason && envKeyRes.reason !== 'empty'
        ? describeKeyProblem(envKeyRes, { name: 'AI_API_KEY' })
        : null,
  };
}

/**
 * 没显式配模型名时按 base_url 猜一个文本模型。
 * 为什么需要：用户常常只配了视觉模型（智谱一个 Key 同时能调文本和视觉），
 * 这时文本模型的默认名不能沿用 DeepSeek 的，否则一定 404。
 */
export function guessTextModel(baseUrl) {
  const b = String(baseUrl || '').toLowerCase();
  if (b.includes('bigmodel')) return 'glm-4-flash';
  if (b.includes('dashscope')) return 'qwen-plus';
  if (b.includes('openai.com')) return 'gpt-4o-mini';
  if (b.includes('siliconflow')) return 'Qwen/Qwen2.5-72B-Instruct';
  return AI_DEFAULTS.model;
}

/**
 * 视觉模型配置：优先用专门的视觉 Key/Base URL，没有就复用文本模型那一套。
 * 很多人会直接用同一个 Key 调用不同厂商，所以「复用」是默认行为。
 *
 * 优先级（越靠前越优先）：
 *   1. 数据库设置（仅 API 调用时写入，界面上已不再暴露输入框）
 *   2. .env 里的 AI_VISION_API_KEY / AI_VISION_BASE_URL / AI_VISION_MODEL
 *   3. .env 里的 AI_API_KEY / AI_BASE_URL / AI_MODEL（文本那一套）
 */
export function getVisionConfig() {
  const text = textConfigRaw();
  const dbVisionModel = getSetting(SETTING_KEYS.visionModel);
  const model = dbVisionModel || process.env.AI_VISION_MODEL || AI_DEFAULTS.vision_model;
  const dbVisionKey = sanitizeApiKey(getSetting(SETTING_KEYS.visionApiKey)).value;
  const envVisionKeyRes = sanitizeApiKey(process.env.AI_VISION_API_KEY);
  const envVisionKey = envVisionKeyRes.value;
  const dedicatedKey = dbVisionKey || envVisionKey;
  const apiKey = dedicatedKey || text.api_key;
  const baseUrl =
    getSetting(SETTING_KEYS.visionBaseUrl) ||
    process.env.AI_VISION_BASE_URL ||
    text.explicit_base ||
    AI_DEFAULTS.base_url;
  const keySource = dbVisionKey
    ? 'db:vision'
    : envVisionKey
      ? 'env:vision'
      : text.key_source;
  return {
    api_key: apiKey,
    key_source: keySource,
    base_url: baseUrl.replace(/\/+$/, ''),
    model,
    configured: Boolean(apiKey && model),
    // 离线演示：环境变量（临时）或设置里勾选（持久），用于没有 Key 时先把链路跑通
    fake: process.env.VISION_FAKE === '1' || getSetting(SETTING_KEYS.visionFake) === '1',
    // 视觉 Key 的环境变量填坏了（常见：粘了中文占位符）时给出可读原因
    env_key_invalid:
      envVisionKeyRes.reason && envVisionKeyRes.reason !== 'empty'
        ? describeKeyProblem(envVisionKeyRes, { name: 'AI_VISION_API_KEY' })
        : null,
  };
}

/** 从 base_url 判断是哪家厂商 */
function providerOfBase(baseUrl) {
  const b = String(baseUrl || '').toLowerCase();
  if (b.includes('bigmodel')) return 'bigmodel';
  if (b.includes('dashscope')) return 'dashscope';
  if (b.includes('openai.com')) return 'openai';
  if (b.includes('siliconflow')) return 'siliconflow';
  if (b.includes('deepseek')) return 'deepseek';
  return null;
}

/** 从模型名判断属于哪家厂商，用来发现「模型名和接口地址不是一家」 */
function providerOfModel(model) {
  const m = String(model || '').toLowerCase();
  if (m.startsWith('glm')) return 'bigmodel';
  if (m.startsWith('qwen')) return 'dashscope';
  if (/^(gpt|o1|o3|o4)/.test(m)) return 'openai';
  if (m.startsWith('deepseek')) return 'deepseek';
  return null;
}

/**
 * 决定用哪个文本模型。
 * 典型坑：.env 里残留着 AI_MODEL=deepseek-chat（复制模板留下的），
 * 但实际生效的是智谱的视觉 Key —— 这时直接照用会 404 model not found。
 * 所以模型名和接口地址对不上时，按厂商默认名兜底。
 */
function pickTextModel(explicitModel, baseUrl) {
  if (!explicitModel) return guessTextModel(baseUrl);
  const byBase = providerOfBase(baseUrl);
  const byModel = providerOfModel(explicitModel);
  if (!byBase || !byModel || byBase === byModel) return explicitModel;
  return guessTextModel(baseUrl);
}

/**
 * 当前生效的文本模型配置：数据库优先，其次 .env；
 * 都没配文本 Key 时，复用视觉那一套（智谱/通义这类厂商一个 Key 通用）。
 */
export function getAiConfig() {
  const t = textConfigRaw();
  if (t.api_key) {
    return {
      api_key: t.api_key,
      key_source: t.key_source,
      base_url: t.base_url,
      model: pickTextModel(t.model_raw, t.base_url),
      derived_from_vision: false,
    };
  }

  const vision = getVisionConfig();
  if (vision.api_key) {
    return {
      api_key: vision.api_key,
      key_source: 'vision',
      base_url: vision.base_url,
      model: pickTextModel(t.model_raw, vision.base_url),
      derived_from_vision: true,
    };
  }

  return {
    api_key: '',
    key_source: 'none',
    base_url: t.base_url,
    model: pickTextModel(t.model_raw, t.base_url),
    derived_from_vision: false,
  };
}

/** 脱敏：sk-abc123...wxyz -> sk-ab****wxyz */export function maskKey(key) {
  if (!key) return null;
  if (key.length <= 10) return `${key.slice(0, 2)}****`;
  return `${key.slice(0, 5)}****${key.slice(-4)}`;
}

/** 给前端看的配置（绝不返回明文 Key） */
export function publicAiConfig() {
  const cfg = getAiConfig();
  const vision = getVisionConfig();
  return {
    configured: Boolean(cfg.api_key),
    masked_key: maskKey(cfg.api_key),
    key_source: cfg.key_source,
    base_url: cfg.base_url,
    model: cfg.model,
    defaults: AI_DEFAULTS,
    env_key_detected: Boolean(process.env.AI_API_KEY),
    // 环境变量里那个 Key 到底能不能用（null = 没问题）
    env_key_invalid: textConfigRaw().env_key_invalid,
    // true = 没单独配文本 Key，直接复用了视觉那一套（同一家厂商时很常见）
    derived_from_vision: cfg.derived_from_vision,
    vision: {
      configured: vision.configured,
      model: vision.model,
      base_url: vision.base_url,
      fake: vision.fake,
      masked_key: maskKey(vision.api_key),
      // true = 视觉用了单独的 Key（.env 或设置里），false = 复用上面文本模型那个 Key
      has_own_key: vision.key_source === 'db:vision' || vision.key_source === 'env:vision',
      key_source: vision.key_source,
      missing: !vision.api_key ? 'key' : !vision.model ? 'model' : null,
      env_key_detected: Boolean(process.env.AI_VISION_API_KEY),
      env_key_invalid: vision.env_key_invalid,
    },
    vision_presets: VISION_PRESETS,
    fake_mode: vision.fake,
  };
}

/**
 * 真实连通性检测：GET {base_url}/models，8 秒超时。
 * 只发一次极轻的请求，不消耗 token。
 */
export async function testAiConnection(override = {}, { timeoutMs = 8000 } = {}) {
  const cfg = getAiConfig();
  const apiKey = override.api_key || cfg.api_key;
  const baseUrl = (override.base_url || cfg.base_url || AI_DEFAULTS.base_url).replace(/\/+$/, '');

  if (!apiKey) {
    const problem = textConfigRaw().env_key_invalid;
    return { ok: false, reason: 'missing_key', message: problem ?? '还没有配置 API Key' };
  }

  const started = Date.now();
  try {
    const res = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const latency = Date.now() - started;
    const text = await res.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }

    if (!res.ok) {
      const detail = body?.error?.message || text.slice(0, 200) || `HTTP ${res.status}`;
      return {
        ok: false,
        reason: 'http_error',
        status: res.status,
        latency_ms: latency,
        message: `连接失败（HTTP ${res.status}）：${detail}`,
      };
    }

    const models = Array.isArray(body?.data) ? body.data.map((m) => m?.id).filter(Boolean) : [];
    return {
      ok: true,
      reason: 'ok',
      status: res.status,
      latency_ms: latency,
      models,
      message: models.length ? `连接成功，可用模型 ${models.length} 个` : '连接成功',
    };
  } catch (err) {
    const latency = Date.now() - started;
    const message =
      err?.name === 'TimeoutError'
        ? `连接超时（${Math.round(timeoutMs / 1000)} 秒）`
        : err?.message || '未知错误';
    return { ok: false, reason: 'network_error', latency_ms: latency, message: `连接失败：${message}` };
  }
}

/**
 * 生成一张 size×size 的彩色块 PNG，转成 data URL。
 * 为什么要生成而不是写死一张 1x1：智谱 glm-4v 对 1×1 图直接报
 * `{"error":{"code":"1210","message":"图片输入格式/解析错误"}}`，
 * 会让「检测连接」误判成 Key 有问题。这里用 160×160 的图，各厂商都能正常解析。
 */
function makeProbePngDataUrl(size = 160) {
  const crc32 = (buf) => {
    let crc = 0xffffffff;
    for (let n = 0; n < buf.length; n++) {
      let c = (crc ^ buf[n]) & 0xff;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crc = c ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };

  const stride = 1 + size * 3;
  const raw = Buffer.alloc(size * stride);
  for (let y = 0; y < size; y++) {
    const rowStart = y * stride;
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const o = rowStart + 1 + x * 3;
      const t = ((x >> 4) + (y >> 4)) % 3;
      raw[o] = t === 0 ? 230 : t === 1 ? 250 : 120;
      raw[o + 1] = t === 0 ? 150 : t === 1 ? 250 : 200;
      raw[o + 2] = t === 0 ? 60 : t === 1 ? 250 : 110;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

/** 探针图：只用来验证「鉴权 + 模型 + 图片输入」这条链路通不通，不指望它识别出菜 */
const PROBE_PNG = makeProbePngDataUrl();

/**
 * 视觉链路检测：发一张真实可解析的 PNG + 一句话，看模型是否有响应。
 * 为什么不用 GET /models：智谱等厂商的视觉端点不一定实现 /models，用真实请求更准。
 * 消耗极小（max_tokens=8），输出 1-2 个字。
 */
export async function testVisionConnection(override = {}, { timeoutMs = 20000 } = {}) {
  const cfg = getVisionConfig();
  const apiKey = override.api_key || cfg.api_key;
  const baseUrl = (override.base_url || cfg.base_url || '').replace(/\/+$/, '');
  const model = override.model || cfg.model;

  if (!apiKey) {
    return {
      ok: false,
      reason: 'missing_key',
      message: cfg.env_key_invalid ?? '还没有配置视觉模型的 API Key（AI_VISION_API_KEY）',
    };
  }
  if (!model) {
    return { ok: false, reason: 'missing_model', message: '还没有配置视觉模型名（AI_VISION_MODEL）' };
  }

  const started = Date.now();
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: '只回复一个字：好' },
              { type: 'image_url', image_url: { url: PROBE_PNG } },
            ],
          },
        ],
        max_tokens: 8,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const latency = Date.now() - started;
    const text = await res.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }

    if (!res.ok) {
      const detail = body?.error?.message || body?.message || text.slice(0, 200) || `HTTP ${res.status}`;
      return {
        ok: false,
        reason: 'http_error',
        status: res.status,
        latency_ms: latency,
        model,
        message: `视觉模型连接失败（HTTP ${res.status}）：${detail}`,
      };
    }

    const reply = body?.choices?.[0]?.message?.content;
    return {
      ok: true,
      reason: 'ok',
      status: res.status,
      latency_ms: latency,
      model,
      reply: typeof reply === 'string' ? reply.slice(0, 40) : undefined,
      message: `视觉模型连接成功（${model}）`,
    };
  } catch (err) {
    const latency = Date.now() - started;
    const message =
      err?.name === 'TimeoutError'
        ? `连接超时（${Math.round(timeoutMs / 1000)} 秒）`
        : err?.message || '未知错误';
    return { ok: false, reason: 'network_error', latency_ms: latency, model, message: `视觉模型连接失败：${message}` };
  }
}

// ------------------------------------------------------------
// 文本对话（第五步：AI 智能问答）
// ------------------------------------------------------------

const CHAT_TIMEOUT_MS = 90_000;

/**
 * 流式调用文本模型。
 * 统一用流式实现：非流式场景传一个空 onDelta 就行，少一套解析代码。
 * 之所以走流式：健康问答的回答常有 200-400 字，等全文要 5-10 秒，
 * 边出边显示体感差别很大。
 */
export async function chatStream({
  messages,
  temperature = 0.5,
  maxTokens = 900,
  onDelta = () => {},
  signal,
} = {}) {
  const cfg = getAiConfig();
  if (!cfg.api_key) {
    const problem = textConfigRaw().env_key_invalid;
    if (problem) {
      throw new ApiError(400, `${problem}（这是环境变量 AI_API_KEY 的问题）`);
    }
    throw new ApiError(
      400,
      '服务端还没有配置文本模型的 API Key。请在 health-app/server/.env 里填 AI_API_KEY；' +
        '如果你已经配了视觉 Key（同一家厂商），程序会自动复用它（智谱会用 glm-4-flash）。改完记得重启后端。'
    );
  }

  let res;
  try {
    res = await fetch(`${cfg.base_url}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.api_key}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: true,
      }),
      signal: signal ?? AbortSignal.timeout(CHAT_TIMEOUT_MS),
    });
  } catch (err) {
    const message =
      err?.name === 'TimeoutError'
        ? `连接超时（${Math.round(CHAT_TIMEOUT_MS / 1000)} 秒）`
        : err?.message || '未知错误';
    throw new ApiError(502, `连接 AI 服务失败：${message}`);
  }

  if (!res.ok) {
    const text = await res.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    const detail = body?.error?.message || body?.message || text.slice(0, 300) || `HTTP ${res.status}`;
    const hint =
      res.status === 404 || /model|not found/i.test(detail)
        ? `。请检查 health-app/server/.env 里的 AI_MODEL（当前是 ${cfg.model}）`
        : '';
    throw new ApiError(502, `AI 回答失败（HTTP ${res.status}）：${detail}${hint}`);
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let usage = null;

  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line || line.startsWith(':')) continue;
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      let json = null;
      try {
        json = JSON.parse(data);
      } catch {
        continue;
      }
      if (json.usage) usage = json.usage;
      const delta = json.choices?.[0]?.delta?.content;
      if (delta) {
        content += delta;
        onDelta(delta);
      }
    }
  }

  return {
    content,
    usage,
    model: cfg.model,
    key_source: cfg.key_source,
    derived_from_vision: cfg.derived_from_vision,
  };
}
