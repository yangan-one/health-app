import { Router } from 'express';
import { db, DEFAULT_USER_ID, ensureOwnerAccount, publicUser } from '../db.js';
import { ApiError } from '../lib/util.js';
import {
  PASSWORD_MAX,
  PASSWORD_MIN,
  USERNAME_RULE,
  clearFailures,
  grantSession,
  hashPassword,
  readSession,
  recordFailure,
  revokeSession,
  tooManyFailures,
  verifyPassword,
} from '../lib/auth.js';

const router = Router();

/** 注册邀请码：设了 REGISTER_CODE 就必须填对，防止陌生人乱注册占资源 */
const REGISTER_CODE = (process.env.REGISTER_CODE || '').trim();

function findByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username);
}

function checkUsername(raw) {
  const username = String(raw ?? '').trim();
  if (!USERNAME_RULE.test(username)) {
    throw new ApiError(400, '用户名要 2-20 位，只能用中英文、数字、下划线、点或横线');
  }
  return username;
}

function checkPassword(raw) {
  const password = String(raw ?? '');
  if (password.length < PASSWORD_MIN) throw new ApiError(400, `密码至少 ${PASSWORD_MIN} 位`);
  if (password.length > PASSWORD_MAX) throw new ApiError(400, `密码最长 ${PASSWORD_MAX} 位`);
  return password;
}

/** 前端启动时问一句：要不要登录？我现在是谁？ */
router.get('/auth/status', (req, res) => {
  const session = readSession(req);
  const user = session ? db.prepare('SELECT * FROM users WHERE id = ?').get(session.userId) : null;
  res.json({
    ok: true,
    data: {
      required: true,
      authed: Boolean(user),
      register_code_required: REGISTER_CODE.length > 0,
      user: user ? publicUser(user) : null,
    },
  });
});

/** 当前登录用户（给「我的」页展示） */
router.get('/auth/me', (req, res) => {
  const session = readSession(req);
  const user = session ? db.prepare('SELECT * FROM users WHERE id = ?').get(session.userId) : null;
  if (!user) throw new ApiError(401, '需要登录');
  res.json({ ok: true, data: publicUser(user) });
});

router.post('/auth/register', (req, res) => {
  if (tooManyFailures(req)) {
    return res.status(429).json({ ok: false, message: '尝试次数过多，请 10 分钟后再试' });
  }
  try {
    const username = checkUsername(req.body?.username);
    const password = checkPassword(req.body?.password);
    if (REGISTER_CODE && String(req.body?.code ?? '').trim() !== REGISTER_CODE) {
      recordFailure(req);
      throw new ApiError(403, '邀请码不对');
    }
    if (findByUsername(username)) throw new ApiError(409, '这个用户名已经被用了，换一个');

    // 先保证老板账号（id=1，历史数据都挂在它下面）存在，避免 id 冲突
    ensureOwnerAccount();

    const info = db
      .prepare(
        `INSERT INTO users (username, nickname, password_hash, gender, height_cm, activity_level, goal_type)
         VALUES (?, ?, ?, NULL, NULL, 'light', 'maintain')`
      )
      .run(username, username, hashPassword(password));

    const userId = Number(info.lastInsertRowid);
    clearFailures(req);
    grantSession(req, res, userId);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    res.status(201).json({ ok: true, data: { authed: true, user: publicUser(user) } });
  } catch (err) {
    if (String(err.code || '').startsWith('SQLITE_CONSTRAINT')) {
      throw new ApiError(409, '这个用户名已经被用了，换一个');
    }
    throw err;
  }
});

router.post('/auth/login', (req, res) => {
  if (tooManyFailures(req)) {
    return res.status(429).json({ ok: false, message: '密码试错次数过多，请 10 分钟后再试' });
  }
  ensureOwnerAccount(); // 旧库第一次登录时自动建出老板账号

  const username = String(req.body?.username ?? '').trim();
  const password = String(req.body?.password ?? '');
  if (!username || !password) {
    recordFailure(req);
    return res.status(401).json({ ok: false, message: '用户名或密码不对' });
  }

  const user = findByUsername(username);
  if (!user || !verifyPassword(password, user.password_hash)) {
    recordFailure(req);
    // 不区分「用户不存在」和「密码错」，避免被枚举账号
    return res.status(401).json({ ok: false, message: '用户名或密码不对' });
  }

  clearFailures(req);
  grantSession(req, res, user.id);
  res.json({ ok: true, data: { authed: true, user: publicUser(user) } });
});

router.post('/auth/logout', (req, res) => {
  revokeSession(req, res);
  res.json({ ok: true, data: { authed: false } });
});

/** 修改自己的密码（登录后可用） */
router.post('/auth/password', (req, res) => {
  const session = readSession(req);
  const user = session ? db.prepare('SELECT * FROM users WHERE id = ?').get(session.userId) : null;
  if (!user) throw new ApiError(401, '需要登录');

  const current = String(req.body?.current_password ?? '');
  if (!verifyPassword(current, user.password_hash)) throw new ApiError(400, '当前密码不对');
  const next = checkPassword(req.body?.new_password);
  db.prepare('UPDATE users SET password_hash = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?').run(
    hashPassword(next),
    user.id
  );
  res.json({ ok: true, data: { updated: true } });
});

/**
 * 注销自己的账号：连带删除该账号的所有健康数据（表上都是 ON DELETE CASCADE）。
 * 主账号不允许注销 —— 它是实例的基础账号，AI 配置也挂在它名下。
 * 需要带当前密码，避免手机被别人拿去时被恶意清空。
 */
router.delete('/auth/account', (req, res) => {
  const session = readSession(req);
  const user = session ? db.prepare('SELECT * FROM users WHERE id = ?').get(session.userId) : null;
  if (!user) throw new ApiError(401, '需要登录');
  if (user.id === DEFAULT_USER_ID) {
    throw new ApiError(400, '主账号不能注销：AI 配置与默认数据都挂在它上面');
  }
  const password = String(req.body?.password ?? '');
  if (!verifyPassword(password, user.password_hash)) throw new ApiError(400, '密码不对，无法注销');

  db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
  revokeSession(req, res);
  res.json({ ok: true, data: { deleted: true } });
});

export default router;
