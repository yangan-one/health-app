import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase, DRIVER } from './lib/sqlite.js';
import { hashPassword } from './lib/auth.js';
import { currentUserId } from './lib/context.js';
import { ApiError } from './lib/util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const SERVER_ROOT = path.resolve(__dirname, '..');

/** 数据库文件的绝对路径 */
export const DB_PATH = path.resolve(SERVER_ROOT, process.env.DB_PATH || './data/health.db');
const SCHEMA_PATH = path.join(SERVER_ROOT, 'db', 'schema.sql');

/**
 * 历史数据的归属用户。
 * 多账号模式下，每个请求的用户由登录 Cookie 决定；
 * 只有在「没有请求上下文」的场合（CLI 脚本、首次初始化）才回退到这个 id。
 */
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
  // 用户名唯一（大小写不敏感），多账号注册靠它兜底去重
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username COLLATE NOCASE)');
  // 登录按用户名查，建索引
  db.exec('CREATE INDEX IF NOT EXISTS idx_diet_items_food ON diet_record_items(food_id)');
}

/** 对外暴露的用户信息，永远不含 password_hash */
export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    nickname: user.nickname,
    gender: user.gender,
    birth_date: user.birth_date,
    height_cm: user.height_cm,
    activity_level: user.activity_level,
    daily_calorie_goal: user.daily_calorie_goal,
    target_weight_kg: user.target_weight_kg,
    goal_type: user.goal_type,
    created_at: user.created_at,
  };
}

/**
 * 老板账号：id = DEFAULT_USER_ID（历史数据都挂在这个 id 下）。
 * 旧库第一次启动时它没有密码，这里用 OWNER_PASSWORD / APP_PASSWORD 补上，
 * 这样升级到多账号后，原来的数据还能用原来的口令登进去。
 */
export function ensureOwnerAccount() {
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(DEFAULT_USER_ID);
  const wantUsername = (process.env.OWNER_USERNAME || '').trim() || existing?.username || 'me';
  const wantPassword =
    (process.env.OWNER_PASSWORD || '').trim() || (process.env.APP_PASSWORD || '').trim() || '1234';

  if (!existing) {
    db.prepare(
      `INSERT INTO users (id, username, nickname, password_hash, gender, height_cm,
                          activity_level, daily_calorie_goal, goal_type)
       VALUES (?, ?, ?, ?, 'male', 175, 'light', 1800, 'maintain')`
    ).run(DEFAULT_USER_ID, wantUsername, wantUsername, hashPassword(wantPassword));
    console.log(`[auth] 已创建主账号：用户名 ${wantUsername}`);
    return;
  }

  if (existing.password_hash) return; // 已经有密码了，什么都不用做

  // 用户名可能和别的账号撞了，撞了就沿用自己原来的用户名
  const taken = db
    .prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE AND id <> ?')
    .get(wantUsername, DEFAULT_USER_ID);
  const username = taken ? existing.username : wantUsername;

  db.prepare('UPDATE users SET username = ?, password_hash = ? WHERE id = ?').run(
    username,
    hashPassword(wantPassword),
    DEFAULT_USER_ID
  );
  console.log(`[auth] 已为历史账号设置登录密码：用户名 ${username}`);
}

/** 当前请求的用户整行记录 */
export function getCurrentUser() {
  const id = currentUserId(DEFAULT_USER_ID);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) throw new ApiError(401, '登录状态已失效，请重新登录');
  return user;
}

initSchema();
migrate();
ensureOwnerAccount();
