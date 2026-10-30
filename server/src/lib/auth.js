/**
 * 单用户口令登录。
 *
 * 设计目标：一个人用、部署到公网后「别被陌生人翻到数据」，所以不做用户表，
 * 只认一个环境变量口令 APP_PASSWORD，登录后发一个 HMAC 签名的 Cookie。
 *
 * - 没配 APP_PASSWORD（本机开发）→ 鉴权整体关闭，行为和以前一样
 * - 配了 → 除了 /api/auth/* 、/api/health、静态资源外壳，其它请求都要带 Cookie
 */
import crypto from 'node:crypto';

const PASSWORD = (process.env.APP_PASSWORD || '').trim();
const COOKIE_NAME = 'hp_session';
const MAX_AGE_SEC = 7 * 24 * 60 * 60; // 7 天免登录
const LOGIN_WINDOW_MS = 10 * 60 * 1000; // 10 分钟内
const LOGIN_MAX_FAILS = 8; // 最多试错 8 次

/** 有口令才开启鉴权；没有就当作本机开发 */
export const AUTH_ENABLED = PASSWORD.length > 0;

/**
 * 签名用的密钥：优先 SESSION_SECRET（部署时设一个随机值），
 * 否则从口令派生 —— 这样即使没设 SESSION_SECRET，重启后 Cookie 也依然有效。
 */
const SECRET = process.env.SESSION_SECRET?.trim()
  ? process.env.SESSION_SECRET.trim()
  : crypto.createHash('sha256').update(`health-app-session:${PASSWORD}`).digest('hex');

/** 统一的失败次数记录（进程内即可，重启清零不影响安全目标） */
const fails = new Map();

function sign(payload) {
  return crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}

/** 恒定时间比较，避免通过响应耗时猜口令 */
export function passwordMatches(input) {
  if (!AUTH_ENABLED) return true;
  const a = crypto.createHash('sha256').update(String(input ?? '')).digest();
  const b = crypto.createHash('sha256').update(PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** 校验当前请求的 Cookie 是否有效 */
export function isAuthed(req) {
  if (!AUTH_ENABLED) return true;
  const raw = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (!raw) return false;
  const [version, expStr, sig] = raw.split('.');
  if (version !== 'v1' || !expStr || !sig) return false;
  const expected = sign(expStr);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  return Number(expStr) > Date.now();
}

function cookieFlags(req) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  return `Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

/** 登录成功后写入 Cookie */
export function grantSession(req, res) {
  const exp = String(Date.now() + MAX_AGE_SEC * 1000);
  const value = `v1.${exp}.${sign(exp)}`;
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${encodeURIComponent(value)}; Max-Age=${MAX_AGE_SEC}; ${cookieFlags(req)}`
  );
}

/** 退出登录：把 Cookie 立刻作废 */
export function revokeSession(req, res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Max-Age=0; ${cookieFlags(req)}`);
}

/** 登录失败限速，返回 true 表示这次请求该被拒 */
export function tooManyFailures(req) {
  const key = req.ip || 'unknown';
  const now = Date.now();
  const item = fails.get(key);
  if (!item || now - item.firstAt > LOGIN_WINDOW_MS) return false;
  return item.count >= LOGIN_MAX_FAILS;
}

export function recordFailure(req) {
  const key = req.ip || 'unknown';
  const now = Date.now();
  const item = fails.get(key);
  if (!item || now - item.firstAt > LOGIN_WINDOW_MS) fails.set(key, { count: 1, firstAt: now });
  else item.count += 1;
}

export function clearFailures(req) {
  fails.delete(req.ip || 'unknown');
}

/** 不需要登录就能访问的接口（登录页自己要调、平台健康检查要用） */
const PUBLIC_PREFIXES = ['/api/auth/', '/api/health'];

export function isPublicPath(pathname) {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
}

/** 缺失/失效时返回 401，并给前端一个可识别的标记 */
export function requireAuth(req, res, next) {
  if (isAuthed(req)) return next();
  res.status(401).json({ ok: false, message: '需要登录', code: 'AUTH_REQUIRED' });
}
