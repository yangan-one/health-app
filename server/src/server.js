import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { DB_PATH } from './db.js';
import { AUTH_ENABLED } from './lib/auth.js';

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

const server = createApp().listen(PORT, '0.0.0.0', () => {
  console.log('--------------------------------------------------');
  console.log('  个人健康管理 · 服务已启动');
  console.log(`  本机:      http://127.0.0.1:${PORT}`);
  for (const ip of lanAddresses()) console.log(`  局域网:    http://${ip}:${PORT}  （手机连同一 Wi-Fi 可用）`);
  console.log(`  健康检查:  http://127.0.0.1:${PORT}/api/health`);
  console.log(`  数据库:    ${DB_PATH}`);
  console.log(`  前端页面:  ${HAS_WEB_DIST ? `${WEB_DIST}（已同源托管，直接打开上面的地址即可）` : '未构建 → 开发模式请访问 Vite 的 5173'}`);
  console.log(`  登录口令:  ${AUTH_ENABLED ? '已开启（APP_PASSWORD）' : '未设置 APP_PASSWORD，访问无需登录'}`);
  console.log('--------------------------------------------------');
});

// 优雅退出，避免 WAL 文件残留
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`\n收到 ${sig}，正在关闭服务...`);
    server.close(() => process.exit(0));
  });
}
