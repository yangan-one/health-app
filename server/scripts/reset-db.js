/**
 * 重置数据库：删掉 db 文件（含 WAL/SHM），再按 schema.sql 重新建表 + 灌种子数据。
 * 用法: npm run db:reset
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, '..');
const dbFile = path.resolve(serverRoot, process.env.DB_PATH || './data/health.db');

for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) {
  if (fs.existsSync(f)) {
    fs.rmSync(f);
    console.log(`已删除: ${f}`);
  }
}

// 必须在删文件之后再加载 db.js，它 import 时就会打开数据库
const { db, DB_PATH } = await import('../src/db.js');

const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
  .all()
  .map((r) => r.name);
const views = db
  .prepare("SELECT name FROM sqlite_master WHERE type = 'view' ORDER BY name")
  .all()
  .map((r) => r.name);
const exerciseTypes = db.prepare('SELECT COUNT(*) AS c FROM exercise_types').get().c;
const foods = db.prepare('SELECT COUNT(*) AS c FROM foods').get().c;

console.log(`\n数据库已重建: ${DB_PATH}`);
console.log(`表(${tables.length}): ${tables.join(', ')}`);
console.log(`视图(${views.length}): ${views.join(', ')}`);
console.log(`种子数据: 运动类型 ${exerciseTypes} 条 / 食物 ${foods} 条\n`);
db.close();
