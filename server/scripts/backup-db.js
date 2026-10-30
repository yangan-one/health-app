/**
 * 备份 SQLite 数据库：npm run backup
 *
 * 用 `VACUUM INTO` 生成一份干净的快照（不是直接拷文件，WAL 里的最新数据也会带上），
 * 默认保留最近 14 份，旧的自动删掉。备份放在 server/backups/。
 */
import fs from 'node:fs';
import path from 'node:path';
import { db, DB_PATH } from '../src/db.js';

const BACKUP_DIR = process.env.BACKUP_DIR
  ? path.resolve(process.env.BACKUP_DIR)
  : path.resolve(path.dirname(DB_PATH), '..', 'backups');
const KEEP = Number(process.env.BACKUP_KEEP || 14);

if (!fs.existsSync(DB_PATH)) {
  console.error(`✗ 数据库不存在：${DB_PATH}`);
  process.exit(1);
}

fs.mkdirSync(BACKUP_DIR, { recursive: true });

const stamp = new Date()
  .toLocaleString('sv-SE') // sv-SE 刚好是 YYYY-MM-DD HH:mm:ss
  .replace(/[-: ]/g, '')
  .slice(0, 14);
const file = path.join(BACKUP_DIR, `health-${stamp}.db`);

db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);

const size = (fs.statSync(file).size / 1024).toFixed(1);
console.log(`✓ 已备份到 ${file}（${size} KB）`);

// 只保留最近 KEEP 份
const all = fs
  .readdirSync(BACKUP_DIR)
  .filter((n) => /^health-\d{14}\.db$/.test(n))
  .sort()
  .reverse();
for (const old of all.slice(KEEP)) {
  fs.rmSync(path.join(BACKUP_DIR, old));
  console.log(`- 删除旧备份 ${old}`);
}
console.log(`  当前共 ${Math.min(all.length, KEEP)} 份备份，目录：${BACKUP_DIR}`);
