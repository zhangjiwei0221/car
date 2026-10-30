// GuideScan_v740.js —— 扫图找“能做引导关”的图：自切 → 伤害阶梯 → 按跨度排序
// 用法：node GuideScan_v740.js --dir 关卡 --n 0 --rows 7 --cols 7 --out 输出/引导候选.json
'use strict';
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.resolve(__dirname, '../..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DIR = arg('--dir', '关卡');
const LIMIT = Number(arg('--n', 0));
const ROWS = Number(arg('--rows', 7)), COLS = Number(arg('--cols', 7));
const OUT = arg('--out', '输出/引导候选.json');
const TMP = '/tmp/guidescan'; fs.mkdirSync(TMP, { recursive: true });

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });
  return (r.stdout || '') + (r.stderr || '');
}
let files = fs.readdirSync(path.join(ROOT, DIR)).filter(f => f.endsWith('.txt')).sort();
if (LIMIT > 0) files = files.slice(0, LIMIT);

const results = [];
for (const f of files) {
  const base = path.basename(f, '.txt');
  const lv = path.join(TMP, base + '.json');
  run('node', ['03_工具/正式版/SplitLevel_v722.js', '--target', path.join(DIR, f), '--out', lv, '--rows', String(ROWS), '--cols', String(COLS)]);
  if (!fs.existsSync(lv)) continue;
  const out = run('node', ['03_工具/正式版/DamageCurve_v739.js', lv, '--json', path.join(TMP, base + '_dmg.json')]);
  const m = /阶梯: ([\d →]+) \| 最大跨度: (-?\d+)/.exec(out);
  if (!m) continue;
  const steps = m[1].split('→').map(s => parseInt(s.trim(), 10));
  const real = steps.filter(s => s < 999);
  results.push({ file: f, steps, n: real.length, span: real.length >= 2 ? real[real.length - 1] - real[0] : null });
  process.stdout.write('.');
}
console.log('');
// 只保留“四象限都有独占色”的，按跨度排序
const full = results.filter(r => r.n === 4 && r.span !== null).sort((a, b) => b.span - a.span);
const partial = results.filter(r => r.n === 3 && r.span !== null).sort((a, b) => b.span - a.span);
fs.writeFileSync(path.join(ROOT, OUT), JSON.stringify({ full, partial, all: results }, null, 2));
console.log(`扫了 ${results.length} 张；四象限齐全 ${full.length} 张，三象限 ${partial.length} 张`);
console.log('\nTop 15（四象限齐全，按跨度）:');
full.slice(0, 15).forEach((r, i) => console.log(`${String(i + 1).padStart(2)}. ${r.file.slice(0, 44).padEnd(44)} ${r.steps.join('/').padEnd(18)} 跨度 ${r.span}`));
console.log('\n写出：' + OUT);
