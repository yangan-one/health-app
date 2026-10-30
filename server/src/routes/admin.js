/**
 * 运维类接口（都需要登录）：
 *   POST /api/admin/import  { replace?: boolean, payload: <导出的 JSON> }  → 导入备份
 *   GET  /api/admin/backup  → 直接下载一个 .db 快照（VACUUM INTO，比复制文件安全）
 *
 * 本机可以用 CLI（npm run backup / npm run db:import），
 * 云端没有 shell 时就用这两个接口，在网页里点一下就完成。
 */
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { db } from '../db.js';
import { importPayload } from '../lib/dataTransfer.js';
import { ApiError, todayLocal } from '../lib/util.js';

const router = express.Router();

// 导入：body 既可以是导出的完整对象，也可以是 { replace, payload }
router.post('/admin/import', (req, res) => {
  const body = req.body || {};
  const replace = body.replace === true || body.replace === 'true';
  const payload = body.payload && typeof body.payload === 'object' ? body.payload : body;
  const stats = importPayload(payload, { replace });
  res.json({ ok: true, data: stats });
});

// 下载备份：写到临时文件再发出去，发完即删（避免临时目录堆文件）
router.get('/admin/backup', (req, res, next) => {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const file = path.join(os.tmpdir(), `health-snapshot-${stamp}-${process.pid}.db`);
  try {
    if (fs.existsSync(file)) fs.rmSync(file);
    db.prepare('VACUUM INTO ?').run(file);
  } catch (err) {
    return next(new ApiError(500, `生成备份失败：${err.message}`));
  }
  return res.download(file, `health-${stamp}.db`, (err) => {
    if (err) console.error('[backup] 发送失败', err.message);
    try {
      fs.rmSync(file, { force: true });
    } catch {
      /* 忽略 */
    }
  });
});

// 简单体检：让用户/我可以随时确认数据还在、表结构正常
router.get('/admin/health-check', (req, res) => {
  const integrity = db.prepare('PRAGMA integrity_check').get();
  const counts = {
    body_metrics: db.prepare('SELECT COUNT(*) AS n FROM body_metrics').get().n,
    exercise_records: db.prepare('SELECT COUNT(*) AS n FROM exercise_records').get().n,
    diet_records: db.prepare('SELECT COUNT(*) AS n FROM diet_records').get().n,
    diet_record_items: db.prepare('SELECT COUNT(*) AS n FROM diet_record_items').get().n,
    ai_conversations: db.prepare('SELECT COUNT(*) AS n FROM ai_conversations').get().n,
    foods: db.prepare('SELECT COUNT(*) AS n FROM foods').get().n,
  };
  res.json({ ok: true, data: { today: todayLocal(), integrity: integrity.integrity_check, counts } });
});

export default router;
