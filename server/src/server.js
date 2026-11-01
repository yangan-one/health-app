import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { DB_PATH } from './db.js';
import { sanitizeApiKey, describeKeyProblem } from './lib/apiKey.js';

const PORT = Number(process.env.PORT || 3001);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = path.resolve(__dirname, '..', '..', 'web', 'dist');
const HAS_WEB_DIST = fs.existsSync(path.join(WEB_DIST, 'index.html'));

/** 列出本机局域网 IP，方便手机连同一个 Wi-Fi 时直接扫码/输入 */
function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const item of list || []) {
      if (item.family === 'IPv4' && !item.internal) out.push(item.address);
    }
  }
  return out;
}

/**
 * 启动时检查环境变量里的 Key 是不是干净的 ASCII。
 * 云平台控制台最容易出的错：把「填 49 字符的 Key 到这里」这类说明文字
 * 原样粘进了变量值，运行时只在发请求那一刻炸出一句 ByteString 报错。
 */
function keyWarnings() {
  const out = [];
  for (const name of ['AI_API_KEY', 'AI_VISION_API_KEY']) {
    const res = sanitizeApiKey(process.env[name]);
    if (res.reason && res.reason !== 'empty') out.push(describeKeyProblem(res, { name }));
  }
  return out;
}

const server = createApp().listen(PORT, '0.0.0.0', () => {
  console.log('--------------------------------------------------');
  console.log('  个人健康管理 · 服务已启动');
  console.log(`  本机:      http://127.0.0.1:${PORT}`);
  for (const ip of lanAddresses()) console.log(`  局域网:    http://${ip}:${PORT}  （手机连同一 Wi-Fi 可用）`);
  console.log(`  健康检查:  http://127.0.0.1:${PORT}/api/health`);
  console.log(`  数据库:    ${DB_PATH}`);
  console.log(`  前端页面:  ${HAS_WEB_DIST ? `${WEB_DIST}（已同源托管，直接打开上面的地址即可）` : '未构建 → 开发模式请访问 Vite 的 5173'}`);
  console.log(`  登录方式:  多账号（用户名 + 密码），注册邀请码 ${process.env.REGISTER_CODE ? '已开启' : '未设置（任何人都能注册）'}`);
  for (const line of keyWarnings()) console.log(`  注意:      ${line}`);
  console.log('--------------------------------------------------');
});

// 优雅退出，避免 WAL 文件残留
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`\n收到 ${sig}，正在关闭服务...`);
    server.close(() => process.exit(0));
  });
}
