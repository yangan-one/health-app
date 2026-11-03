import { ApiError } from './util.js';

/**
 * 极简的内存限流器：滑动窗口计数 + 强制冷却。
 *
 * 为什么不用 express-rate-limit：
 *   1. 这个应用跑在单进程里（Sealos 单实例），内存计数就够，不需要 Redis；
 *   2. 我们要的是「同一个用户 15 秒内只能识别一次」这种业务级冷却，
 *      而不是「每分钟 100 次」这种泛化的 HTTP 限流，自己写更直白。
 *
 * 局限（已知，写在这里避免以后误判）：
 *   - 进程重启计数清零；
 *   - 多实例部署时各算各的（本项目单实例，不涉及）。
 */

const buckets = new Map();

/** 定期清理过期桶，避免长期运行内存只涨不降；unref 不阻止进程退出 */
const sweeper = setInterval(() => {
  const t = Date.now();
  for (const [key, b] of buckets) {
    if (b.cooldownUntil < t && b.hits.every((x) => t - x > 60 * 60 * 1000)) {
      buckets.delete(key);
    }
  }
}, 10 * 60 * 1000);
sweeper.unref?.();

function getBucket(key) {
  let b = buckets.get(key);
  if (!b) {
    b = { hits: [], cooldownUntil: 0 };
    buckets.set(key, b);
  }
  return b;
}

/**
 * 消耗一次配额。
 * @returns {{ok: true, remaining: number} | {ok: false, retryAfter: number, reason: 'cooldown'|'quota'}}
 */
export function consume(key, { windowMs, max, cooldownMs = 0 }) {
  const t = Date.now();
  const b = getBucket(key);

  if (b.cooldownUntil > t) {
    return { ok: false, reason: 'cooldown', retryAfter: Math.max(1, Math.ceil((b.cooldownUntil - t) / 1000)) };
  }

  b.hits = b.hits.filter((x) => t - x < windowMs);
  if (b.hits.length >= max) {
    const freedIn = windowMs - (t - b.hits[0]);
    return { ok: false, reason: 'quota', retryAfter: Math.max(1, Math.ceil(freedIn / 1000)) };
  }

  b.hits.push(t);
  // 冷却只在「真的发出去了」之后开始计时，失败了不该罚用户等
  if (cooldownMs > 0) b.cooldownUntil = t + cooldownMs;
  return { ok: true, remaining: max - b.hits.length };
}

function tooFast(retryAfter, reason, label) {
  const msg =
    reason === 'cooldown'
      ? `${label}太频繁了，请 ${retryAfter} 秒后再试`
      : `${label}次数已达上限，请 ${retryAfter} 秒后再试`;
  return new ApiError(429, msg, { retry_after: retryAfter, reason });
}

/**
 * AI 调用的统一闸门：同时按「账号」和「IP」两个维度限制。
 *
 * 为什么要两个维度：
 *   - 按账号：正常用户狂点按钮会被挡住；
 *   - 按 IP：拿到邀请码后批量注册小号来刷的行为，账号维度拦不住，IP 维度能兜一层。
 *
 * 被拦下来的请求**不会**继续调用上游模型，所以不会产生 token 费用。
 */
export function aiGuard(req, name, { cooldownMs, windowMs, max, label = '这个操作', ipMultiplier = 3 }) {
  const userId = req.userId ?? req.session?.userId ?? 0;
  const ip = String(req.ip || req.socket?.remoteAddress || 'unknown');

  const perUser = consume(`ai:${name}:u:${userId}`, { windowMs, max, cooldownMs });
  if (!perUser.ok) throw tooFast(perUser.retryAfter, perUser.reason, label);

  // IP 维度不设冷却（同一 Wi-Fi 下可能是多个人），只兜「短时间内海量请求」
  const perIp = consume(`ai:${name}:ip:${ip}`, { windowMs, max: max * ipMultiplier });
  if (!perIp.ok) throw tooFast(perIp.retryAfter, perIp.reason, label);
}

/** 全站每日 AI 调用总闸（防某个人换账号把额度刷穿） */
const DAILY_MAX = Number(process.env.AI_DAILY_LIMIT) || 300;

export function aiDailyGuard(name = 'ai') {
  const r = consume(`ai:global:day`, { windowMs: 24 * 60 * 60 * 1000, max: DAILY_MAX });
  if (!r.ok) {
    throw new ApiError(429, `今天全站的 AI 调用次数（${DAILY_MAX} 次）已经用完了，明天再试`, {
      retry_after: r.retryAfter,
      reason: 'daily_quota',
    });
  }
}

/** 给前端展示用：当前配置里各项闸门的值 */
export const RATE_RULES = {
  analyze: { cooldownMs: 15000, windowMs: 10 * 60 * 1000, max: 10, label: '拍照识别' },
  chat: { cooldownMs: 5000, windowMs: 10 * 60 * 1000, max: 30, label: '对话' },
  ai_test: { cooldownMs: 30000, windowMs: 10 * 60 * 1000, max: 10, label: '连接检测' },
  daily_max: DAILY_MAX,
};
