/**
 * SQLite 驱动适配层。
 *
 * 优先使用 better-sqlite3（如果装了）；否则退回 Node 22.13+ 内置的 node:sqlite。
 * 两者对外的 prepare()/get()/all()/run()/exec() 用法一致，所以业务代码不需要区分。
 *
 * 为什么要这层：
 *   better-sqlite3 在部分 Node 版本上没有预编译包，会回退到源码编译，
 *   要求本机装有 Python + VS 生成工具。内置 node:sqlite 没有任何原生依赖，
 *   对“只想装一套环境”的项目更稳。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function loadBetterSqlite() {
  try {
    const mod = require('better-sqlite3');
    return mod.default ?? mod;
  } catch {
    return null;
  }
}

function loadNativeSqlite() {
  try {
    return require('node:sqlite').DatabaseSync ?? null;
  } catch {
    return null;
  }
}

const BetterSqlite = loadBetterSqlite();
const NativeDatabaseSync = loadNativeSqlite();

export const DRIVER = BetterSqlite
  ? 'better-sqlite3'
  : NativeDatabaseSync
    ? 'node:sqlite'
    : 'none';

export function openDatabase(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });

  let db;
  if (BetterSqlite) {
    db = new BetterSqlite(file);
  } else if (NativeDatabaseSync) {
    db = new NativeDatabaseSync(file);
  } else {
    throw new Error(
      '没有可用的 SQLite 驱动：请把 Node 升级到 22.13 及以上（内置 node:sqlite），' +
        '或执行 npm install better-sqlite3'
    );
  }

  db.exec('PRAGMA journal_mode = WAL'); // 读写并发更好
  db.exec('PRAGMA foreign_keys = ON'); // SQLite 默认不校验外键，必须手动打开
  return db;
}
