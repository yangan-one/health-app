/**
 * 多账号登录：账号 + 密码 + HMAC 签名 Cookie。
 *
 * 这里只做「密码学 + Cookie」，不碰数据库（避免 db.js ↔ auth.js 循环依赖）。
 * 用户查询、注册写库都在 routes/auth.js 里做。
 *
 * Cookie 结构：v2.<userId>.<过期毫秒>.<签名>
 *   - 签名对 `${userId}.${过期}` 做 HMAC-SHA256，改任何一位都会验签失败
 *   - 换 SESSION_SECRET 可以让所有已登录设备立刻掉线
 *
 * 密码存储：scrypt（node 内置，不引依赖），格式 scrypt$N$r$p$salt$hash
 */
import crypto from 'node:crypto';

const COOKIE_NAME = 'hp_session';
const MAX_AGE_SEC = 30 * 24 * 60 * 60; // 30 天免登录（个人应用，别天天输密码）
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_FAILS = 10;

export const USERNAME_RULE = /^[\w\u4e00-\u9fa5.-]{2,20}$/; // 字母数字下划线、中文、点、横线
export const PASSWORD_MIN = 6;
export const PASSWORD_MAX = 72;

/** 签名密钥：部署时设一个随机值；没设就从常量派生（重启不掉线） */
const SECRET =
  process.env.SESSION_SECRET?.trim() ||
  crypto.createHash('sha256').update('health-app:multi-user:v1').digest('hex');

const SCRYPT = { N: 16384, r: 8, p: 1 };
const KEY_LEN = 64;

function sign(payload) {
  return crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}

/** 生成密码哈希 */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, KEY_LEN, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

/** 校验密码，恒定时间比较，避免按耗时猜 */
export function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;
  if (!stored.startsWith('scrypt$')) {
    // 兼容：手工用 sha256 写过密码的老库
    const a = crypto.createHash('sha256').update(String(password ?? '')).digest();
    const b = crypto.createHash('sha256').update(stored).digest();
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  try {
    const [algo, N, r, p, saltB, hashB] = stored.split('$');
    if (algo !== 'scrypt') return false;
    const salt = Buffer.from(saltB, 'base64url');
    const expected = Buffer.from(hashB, 'base64url');
    const actual = crypto.scryptSync(String(password ?? ''), salt, expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
    });
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** 读 Cookie → { userId, exp }，签名/过期不对返回 null */
export function readSession(req) {
  const raw = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (!raw) return null;
  const [version, uid, exp, sig] = raw.split('.');
  if (version !== 'v2' || !uid || !exp || !sig) return null;

  const expected = sign(`${uid}.${exp}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (Number(exp) <= Date.now()) return null;

  const userId = Number(uid);
  if (!Number.isInteger(userId) || userId <= 0) return null;
  return { userId, exp: Number(exp) };
}

function cookieFlags(req) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  return `Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

/** 登录/注册成功后写入 Cookie */
export function grantSession(req, res, userId) {
  const exp = String(Date.now() + MAX_AGE_SEC * 1000);
  const payload = `${userId}.${exp}`;
  const value = `v2.${payload}.${sign(payload)}`;
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${encodeURIComponent(value)}; Max-Age=${MAX_AGE_SEC}; ${cookieFlags(req)}`
  );
}

export function revokeSession(req, res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Max-Age=0; ${cookieFlags(req)}`);
}

/** 按 IP 限速，防止有人拿脚本撞库 */
const fails = new Map();

export function tooManyFailures(req) {
  const key = req.ip || 'unknown';
  const item = fails.get(key);
  if (!item || Date.now() - item.firstAt > LOGIN_WINDOW_MS) return false;
  return item.count >= LOGIN_MAX_FAILS;
}

export function recordFailure(req) {
  const key = req.ip || 'unknown';
  const item = fails.get(key);
  if (!item || Date.now() - item.firstAt > LOGIN_WINDOW_MS) fails.set(key, { count: 1, firstAt: Date.now() });
  else item.count += 1;
}

export function clearFailures(req) {
  fails.delete(req.ip || 'unknown');
}

/** 不需要登录就能访问：登录/注册接口自己、健康检查 */
const PUBLIC_PREFIXES = ['/api/auth/', '/api/health'];

export function isPublicPath(pathname) {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
}

/** 统一 401，带 code 让前端能跳登录页 */
export function requireAuth(req, res) {
  res.status(401).json({ ok: false, message: '需要登录', code: 'AUTH_REQUIRED' });
}
