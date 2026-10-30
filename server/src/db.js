import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase, DRIVER } from './lib/sqlite.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const SERVER_ROOT = path.resolve(__dirname, '..');

/** 数据库文件的绝对路径 */
export const DB_PATH = path.resolve(SERVER_ROOT, process.env.DB_PATH || './data/health.db');
const SCHEMA_PATH = path.join(SERVER_ROOT, 'db', 'schema.sql');

/** 单用户免登录模式：所有请求都归属这个用户 */
export const DEFAULT_USER_ID = Number(process.env.DEFAULT_USER_ID || 1);

export { DRIVER };

export const db = openDatabase(DB_PATH);

/**
 * 执行 schema.sql。
 * 里面全是 CREATE TABLE IF NOT EXISTS + INSERT OR IGNORE，可以重复执行（幂等）。
 * 视图 v_daily_summary 每次都会 DROP 再 CREATE，保证改了视图定义后自动生效。
 */
export function initSchema() {
  db.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));
}

/**
 * 轻量迁移：schema.sql 只能 CREATE TABLE IF NOT EXISTS，
 * 对「已经存在的旧库」新增列必须显式 ALTER。ADD COLUMN 本身是幂等的加法操作，
 * 这里先用 pragma_table_info 判断列是否存在，避免重复 ALTER 报错。
 */
function migrate() {
  const userCols = db
    .prepare("SELECT name FROM pragma_table_info('users')")
    .all()
    .map((c) => c.name);
  if (!userCols.includes('goal_type')) {
    db.exec("ALTER TABLE users ADD COLUMN goal_type TEXT NOT NULL DEFAULT 'maintain'");
    console.log('[migrate] users 表新增 goal_type 列');
  }
}

export function getCurrentUser() {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(DEFAULT_USER_ID);
  if (!user) {
    throw new Error(
      `默认用户 id=${DEFAULT_USER_ID} 不存在，请先执行 npm run db:reset 初始化数据库`
    );
  }
  return user;
}

initSchema();
migrate();
