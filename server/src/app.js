import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DB_PATH, DEFAULT_USER_ID, DRIVER } from './db.js';
import { ApiError, todayLocal } from './lib/util.js';
import { AUTH_ENABLED, isAuthed, isPublicPath, requireAuth } from './lib/auth.js';
import { UPLOAD_DIR } from './lib/images.js';
import authRouter from './routes/auth.js';
import profileRouter from './routes/profile.js';
import bodyMetricsRouter from './routes/bodyMetrics.js';
import exercisesRouter from './routes/exercises.js';
import dashboardRouter from './routes/dashboard.js';
import settingsRouter from './routes/settings.js';
import exportRouter from './routes/export.js';
import dietRouter from './routes/diet.js';
import chatRouter from './routes/chat.js';
import adminRouter from './routes/admin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..');

/** 生产环境：同源托管前端构建产物（npm run build 出现在 web/dist） */
const WEB_DIST = process.env.WEB_DIST
  ? path.resolve(process.env.WEB_DIST)
  : path.resolve(SERVER_DIR, '..', 'web', 'dist');
const HAS_WEB_DIST = fs.existsSync(path.join(WEB_DIST, 'index.html'));
const IS_PROD = process.env.NODE_ENV === 'production';

export function createApp() {
  const app = express();

  // 部署在 PaaS/反向代理后面时，靠这个才能拿到真实协议与 IP（Cookie 的 Secure、登录限速都要用）
  app.set('trust proxy', 1);

  // 开发时前端跑在 5173（走 Vite 代理时其实是同源，这里只是兜底）
  if (!IS_PROD) app.use(cors());

  app.use(express.json({ limit: '12mb' })); // 拍照识别传 base64 图片，前端会压到 1280px 内

  // 请求日志：只打接口，静态资源不刷屏
  app.use((req, res, next) => {
    if (!req.path.startsWith('/api/')) return next();
    const start = Date.now();
    res.on('finish', () => {
      console.log(`${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - start}ms)`);
    });
    next();
  });

  // 登录相关接口（未登录也能访问）
  app.use('/api', authRouter);

  // 登录闸门：只保护「数据」——/api/* 与 /uploads/*
  // 页面外壳（index.html、js/css、manifest、图标）必须是公开的，否则登录页自己都加载不出来。
  app.use((req, res, next) => {
    if (!AUTH_ENABLED) return next();
    const p = req.path;
    const needsAuth = (p.startsWith('/api/') && !isPublicPath(p)) || p.startsWith('/uploads/');
    if (!needsAuth) return next();
    return requireAuth(req, res, next);
  });

  app.get('/api/health', (req, res) => {
    const authed = isAuthed(req);
    res.json({
      ok: true,
      service: 'health-app-server',
      version: '0.6.0',
      sqlite_driver: DRIVER,
      auth_enabled: AUTH_ENABLED,
      web_dist: HAS_WEB_DIST,
      // 只有通过鉴权才回数据库路径，避免公网泄漏服务器目录结构
      ...(authed ? { db_path: DB_PATH } : {}),
      user_id: DEFAULT_USER_ID,
      today: todayLocal(),
      server_time: new Date().toISOString(),
    });
  });

  app.use('/api', profileRouter);
  app.use('/api', bodyMetricsRouter);
  app.use('/api', exercisesRouter);
  app.use('/api', dashboardRouter);
  app.use('/api', settingsRouter);
  app.use('/api', exportRouter);
  app.use('/api', dietRouter);
  app.use('/api', chatRouter);
  app.use('/api', adminRouter);

  app.use('/uploads', express.static(UPLOAD_DIR));

  // 前端构建产物：资源带 hash 可长缓存，index.html 不缓存
  if (HAS_WEB_DIST) {
    app.use(express.static(WEB_DIST, { index: false, maxAge: '7d' }));
    app.get(/^\/(?!api\/|uploads\/).*/, (req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(WEB_DIST, 'index.html'));
    });
  }

  app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ ok: false, message: `接口不存在: ${req.method} ${req.originalUrl}` });
    }
    if (!HAS_WEB_DIST) {
      return res.status(404).send(
        '前端还没有构建。开发时请访问 Vite 的 5173 端口；部署前请先在 web/ 目录执行 npm run build。'
      );
    }
    return res.status(404).json({ ok: false, message: '页面不存在' });
  });

  // 统一错误处理：业务异常 -> JSON；其它异常 -> 500，同时打印堆栈方便排查
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    if (err instanceof ApiError) {
      return res.status(err.status).json({ ok: false, message: err.message, details: err.details });
    }
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ ok: false, message: '请求体不是合法 JSON' });
    }
    if (typeof err.code === 'string' && err.code.startsWith('SQLITE_CONSTRAINT')) {
      return res.status(400).json({ ok: false, message: `数据不满足数据库约束: ${err.message}` });
    }
    console.error('[未捕获异常]', err);
    res.status(500).json({ ok: false, message: '服务器内部错误' });
  });

  return app;
}
