import { Router } from 'express';
import { ApiError, requireObject } from '../lib/util.js';
import { DEFAULT_USER_ID } from '../db.js';
import { currentUserId } from '../lib/context.js';
import {
  SETTING_KEYS,
  setSetting,
  publicAiConfig,
  testAiConnection,
  testVisionConnection,
} from '../lib/ai.js';
import { aiGuard, RATE_RULES } from '../lib/ratelimit.js';

const router = Router();

/**
 * AI 配置（Key / 模型 / 接口地址）是实例级共享的，写的是主账号那一行，
 * 所以只有主账号能改。否则任何一个注册用户都能把全站的 Key 换掉。
 */
function requireOwner() {
  if (currentUserId(DEFAULT_USER_ID) !== DEFAULT_USER_ID) {
    throw new ApiError(403, '只有主账号可以修改 AI 服务配置');
  }
}

/** GET /api/settings → AI 配置（Key 一律脱敏） */
router.get('/settings', (req, res) => {
  res.json({ ok: true, data: { ai: publicAiConfig() } });
});

/**
 * PUT /api/settings/ai
 * body: { api_key?, base_url?, model?, vision_model?, vision_base_url? }
 * 传空字符串 = 清除该条（回退到 .env / 默认值）
 */
router.put('/settings/ai', (req, res) => {
  requireOwner();
  const body = requireObject(req.body);

  if (body.api_key !== undefined) {
    const key = String(body.api_key ?? '').trim();
    if (key && key.length < 8) throw new ApiError(400, 'API Key 长度看起来不对，至少 8 位');
    if (key && !/^[\w.\-:]+$/.test(key)) throw new ApiError(400, 'API Key 含有不支持的字符');
    setSetting(SETTING_KEYS.apiKey, key);
  }
  if (body.base_url !== undefined) {
    const url = String(body.base_url ?? '').trim().replace(/\/+$/, '');
    if (url && !/^https?:\/\/.+/.test(url)) throw new ApiError(400, 'Base URL 需以 http:// 或 https:// 开头');
    setSetting(SETTING_KEYS.baseUrl, url);
  }
  if (body.model !== undefined) {
    setSetting(SETTING_KEYS.model, String(body.model ?? '').trim());
  }
  // 拍照识别用的视觉模型（和文本模型分开配置，因为厂商常常不同）
  if (body.vision_model !== undefined) {
    setSetting(SETTING_KEYS.visionModel, String(body.vision_model ?? '').trim());
  }
  if (body.vision_base_url !== undefined) {
    const url = String(body.vision_base_url ?? '').trim().replace(/\/+$/, '');
    if (url && !/^https?:\/\/.+/.test(url)) throw new ApiError(400, '视觉 Base URL 需以 http:// 或 https:// 开头');
    setSetting(SETTING_KEYS.visionBaseUrl, url);
  }
  // 视觉模型厂商和文本模型不同时，可以单独存一个 Key（留空 = 复用文本 Key）
  if (body.vision_api_key !== undefined) {
    const key = String(body.vision_api_key ?? '').trim();
    if (key && key.length < 8) throw new ApiError(400, '视觉 API Key 长度看起来不对，至少 8 位');
    if (key && !/^[\w.\-:]+$/.test(key)) throw new ApiError(400, '视觉 API Key 含有不支持的字符');
    setSetting(SETTING_KEYS.visionApiKey, key);
  }
  // 「没有 Key 也想先跑通流程」的离线演示开关
  if (body.vision_fake !== undefined) {
    setSetting(SETTING_KEYS.visionFake, body.vision_fake ? '1' : '');
  }

  res.json({ ok: true, data: { ai: publicAiConfig() } });
});

/**
 * POST /api/settings/ai/test
 * 同时测两条链路：文本模型（GET /models，不耗 token）和视觉模型（发一张 1x1 图，约 1 个字）。
 * body 可带 { api_key?, base_url?, vision_api_key?, vision_base_url?, vision_model? } 覆盖已保存的配置。
 */
router.post('/settings/ai/test', async (req, res, next) => {
  try {
    // 检测也要限速：视觉检测会真的发一张图上去，狂点同样是消耗
    aiGuard(req, 'ai_test', RATE_RULES.ai_test);

    const body = req.body ?? {};
    const pick = (v) => (v ? String(v).trim() : undefined);
    const [text, vision] = await Promise.all([
      testAiConnection({ api_key: pick(body.api_key), base_url: pick(body.base_url) }),
      testVisionConnection({
        api_key: pick(body.vision_api_key),
        base_url: pick(body.vision_base_url),
        model: pick(body.vision_model),
      }),
    ]);
    // 两个都 OK 才叫整体 OK；任一没配好就把真实原因带回去
    res.json({
      ok: true,
      data: {
        ok: text.ok && vision.ok,
        text,
        vision,
        // 兼容旧前端：顶层字段取「有配置的那条」的结论
        reason: vision.ok ? text.reason : vision.reason,
        status: vision.status ?? text.status,
        latency_ms: vision.latency_ms ?? text.latency_ms,
        models: text.models,
        message: vision.ok ? text.message : vision.message,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
