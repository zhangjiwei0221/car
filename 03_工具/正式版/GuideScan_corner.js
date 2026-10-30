// GuideScan_corner.js —— 按“左下角曼哈顿”规则给官方图排引导阶梯
// 用法：node GuideScan_corner.js --n 60 --ref corner --out 输出/引导候选_corner.json
'use strict';
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.resolve(__dirname, '../..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const REF = arg('--ref', 'corner');
const LIMIT = Number(arg('--n', 0));
const OUT = arg('--out', '输出/引导候选_' + REF + '.json');
const TMP = '/tmp/guidescan_' + REF;
fs.mkdirSync(TMP, { recursive: true });

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });
  return (r.stdout || '') + (r.stderr || '');
};

let files = fs.readdirSync(path.join(ROOT, '关卡')).filter(f => f.endsWith('.txt')).sort();
if (LIMIT > 0) files = files.slice(0, LIMIT);

const rows = [];
for (const f of files) {
  const base = path.basename(f, '.txt');
  const lv = path.join(TMP, base + '.json');
  if (!fs.existsSync(lv)) {
    run('node', ['03_工具/正式版/SplitLevel_v722.js', '--target', '关卡/' + f, '--out', lv, '--rows', '7', '--cols', '7']);
  }
  if (!fs.existsSync(lv)) continue;
  const out = run('node', ['03_工具/正式版/DamageCurve_v739.js', lv, '--ref', REF]);
  const m = /阶梯: ([\d →]+) \| 最大跨度: (-?\d+)/.exec(out);
  if (!m) continue;
  const steps = m[1].split('→').map(s => parseInt(s.trim(), 10));
  const real = steps.filter(s => s < 999);
  rows.push({
    file: f, steps,
    n: real.length,
    span: real.length >= 2 ? real[real.length - 1] - real[0] : null,
    second: real.length >= 2 ? real[1] : null,
  });
  process.stdout.write('.');
}
console.log('');
const full = rows.filter(r => r.n === 4 && r.span != null).sort((a, b) => b.span - a.span);
fs.writeFileSync(path.join(ROOT, OUT), JSON.stringify({ ref: REF, full, all: rows }, null, 2));
console.log(`扫 ${rows.length} 张；四象限齐全 ${full.length} 张`);
console.log('\nTop 15：');
full.slice(0, 15).forEach((r, i) => console.log(`${String(i + 1).padStart(2)}. ${r.file.slice(0, 44).padEnd(44)} ${r.steps.join('/').padEnd(18)} 跨度 ${r.span}  第二主体@${r.second}`));
console.log('\n写出：' + OUT);
