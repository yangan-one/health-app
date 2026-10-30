/**
 * 把导出的 JSON 导入当前数据库（换机器 / 上云迁移用）：
 *
 *   npm run db:import -- C:\path\to\health-data-2026-10-30.json
 *   npm run db:import -- ./backup.json --replace    # 先清空身体/运动/饮食再导入
 *
 * 真正的导入逻辑在 src/lib/dataTransfer.js，和网页上的「从备份导入」共用一份，
 * 避免两处逻辑慢慢跑偏。身体数据按「日期」合并（同一天覆盖）；
 * 运动和饮食默认跳过已存在的相同记录。
 */
import fs from 'node:fs';
import path from 'node:path';
import { importPayload } from '../src/lib/dataTransfer.js';

const args = process.argv.slice(2);
const replace = args.includes('--replace');
const fileArg = args.find((a) => !a.startsWith('--'));

if (!fileArg) {
  console.error('用法：npm run db:import -- <导出的 json 文件路径> [--replace]');
  process.exit(1);
}

const file = path.resolve(fileArg);
if (!fs.existsSync(file)) {
  console.error(`✗ 文件不存在：${file}`);
  process.exit(1);
}

let payload;
try {
  payload = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (err) {
  console.error(`✗ 不是合法的 JSON：${err.message}`);
  process.exit(1);
}

let stats;
try {
  stats = importPayload(payload, { replace });
} catch (err) {
  console.error(`✗ 导入失败，已回滚：${err.message}`);
  process.exit(1);
}

console.log('--------------------------------------------------');
console.log(`✓ 导入完成：身体 ${stats.body} 条、运动 ${stats.exercise} 条` +
  (stats.exercise_skipped ? `（跳过重复 ${stats.exercise_skipped} 条）` : '') +
  `、饮食 ${stats.diet} 餐 / ${stats.diet_items} 项`);
if (replace) console.log('  （已按 --replace 清空原有运动与饮食记录）');
console.log('  提示：图片不会跟着 JSON 一起过来，历史饮食记录的缩略图会显示不出来（不影响数据）。');
console.log('--------------------------------------------------');
