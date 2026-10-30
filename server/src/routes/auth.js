import { Router } from 'express';
import {
  AUTH_ENABLED,
  clearFailures,
  grantSession,
  isAuthed,
  passwordMatches,
  recordFailure,
  revokeSession,
  tooManyFailures,
} from '../lib/auth.js';

const router = Router();

/** 前端启动时先问一句：这个站要不要登录？我现在是登录状态吗？ */
router.get('/auth/status', (req, res) => {
  res.json({
    ok: true,
    data: { required: AUTH_ENABLED, authed: isAuthed(req) },
  });
});

router.post('/auth/login', (req, res) => {
  if (!AUTH_ENABLED) {
    return res.json({ ok: true, data: { authed: true, required: false } });
  }
  if (tooManyFailures(req)) {
    return res.status(429).json({
      ok: false,
      message: '密码试错次数过多，请 10 分钟后再试',
    });
  }
  const password = req.body?.password;
  if (!passwordMatches(password)) {
    recordFailure(req);
    return res.status(401).json({ ok: false, message: '密码不对，再试一次' });
  }
  clearFailures(req);
  grantSession(req, res);
  res.json({ ok: true, data: { authed: true, required: true } });
});

router.post('/auth/logout', (req, res) => {
  revokeSession(req, res);
  res.json({ ok: true, data: { authed: false } });
});

export default router;
