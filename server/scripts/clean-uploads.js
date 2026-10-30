/**
 * 清理「没人引用」的上传图片。
 *
 * 拍照识别时图片会先落盘再调模型：
 * - 识别失败 → 接口自己删
 * - 识别成功但用户直接关掉页面 → 这张图就留在 uploads/ 里了（既没有对应饮食记录，也没人再访问）
 *
 * 所以定期跑一次这个脚本即可。默认只「报告」不删除，加 --delete 才真删。
 *
 *   npm run uploads:clean
 *   npm run uploads:clean -- --delete
 */
import { readdirSync, statSync, unlinkSync, rmdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { db } from '../src/db.js';

const DELETE = process.argv.includes('--delete');
const UPLOAD_DIR = resolve(import.meta.dirname, '..', 'uploads');

function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out; // uploads 目录还不存在
  }
  for (const name of entries) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) out.push(...walk(abs));
    else out.push(abs);
  }
  return out;
}

const used = new Set(
  db
    .prepare('SELECT image_path FROM diet_records WHERE image_path IS NOT NULL')
    .all()
    .map((r) => r.image_path.replace(/^\/uploads\//, ''))
);

const files = walk(UPLOAD_DIR);
const orphans = files.filter((abs) => !used.has(relative(UPLOAD_DIR, abs).replace(/\\/g, '/')));

console.log(`数据库引用 ${used.size} 张；磁盘上共 ${files.length} 张；孤立 ${orphans.length} 张`);
for (const abs of orphans.slice(0, 20)) {
  console.log('  - ' + relative(UPLOAD_DIR, abs));
}
if (orphans.length > 20) console.log(`  … 还有 ${orphans.length - 20} 张`);

if (!orphans.length) process.exit(0);

if (!DELETE) {
  console.log('\n只是检查。真要删除请加参数：npm run uploads:clean -- --delete');
  process.exit(0);
}

let removed = 0;
for (const abs of orphans) {
  try {
    unlinkSync(abs);
    removed += 1;
  } catch (err) {
    console.log(`  删除失败 ${relative(UPLOAD_DIR, abs)}: ${err.message}`);
  }
}

// 顺手清掉空掉的日期目录
let dirsRemoved = 0;
try {
  for (const name of readdirSync(UPLOAD_DIR)) {
    const abs = join(UPLOAD_DIR, name);
    if (statSync(abs).isDirectory() && readdirSync(abs).length === 0) {
      rmdirSync(abs);
      dirsRemoved += 1;
    }
  }
} catch {
  /* 忽略 */
}

console.log(`\n已删除 ${removed} 张图片${dirsRemoved ? `、${dirsRemoved} 个空目录` : ''}。`);
