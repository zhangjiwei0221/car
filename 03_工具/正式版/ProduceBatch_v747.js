// ProduceBatch_v747.js —— 批量产关（并行）
// 每张图：切车 → 基础障碍 →（可选）障碍分配 → 指标/验收
// 用法：
//   node ProduceBatch_v747.js --glob "关卡0004*.txt" --limit 4 --out 输出/批次A --jobs 4 [--plan] [--rows 7 --cols 7]
'use strict';
const fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const ROOT = path.resolve(__dirname, '../..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const has = k => process.argv.includes(k);

const DIR = arg('--dir', '关卡');
const GLOB = arg('--glob', '*.txt');
const LIMIT = Number(arg('--limit', '4'));
const OUT = arg('--out', '输出/批次_' + Date.now());
const JOBS = Number(arg('--jobs', '4'));
const ROWS = arg('--rows', '7'), COLS = arg('--cols', '7');
const ROUNDS = arg('--rounds', '3'), SAMPLES = arg('--samples', '120');
const REF = arg('--ref', 'corner');
const PLAN = has('--plan');
const SEED = arg('--seed', '20261030');

// 简易 glob → regex
const rx = new RegExp('^' + GLOB.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
let files = fs.readdirSync(path.join(ROOT, DIR)).filter(f => rx.test(f)).sort().slice(0, LIMIT);
if (!files.length) { console.error('没有匹配的图：' + GLOB); process.exit(1); }
fs.mkdirSync(path.join(ROOT, OUT), { recursive: true });

console.log(`批量产关：${files.length} 张，并行 ${JOBS}，输出 ${OUT}`);
const results = [];
let running = 0, idx = 0;

function launch(f) {
  const target = path.join(DIR, f);
  const outdir = path.join(OUT, f.replace(/\.txt$/, ''));
  const args = ['03_工具/正式版/_ProduceOne_v747.js', '--target', target, '--outdir', outdir,
    '--rows', ROWS, '--cols', COLS, '--rounds', ROUNDS, '--samples', SAMPLES, '--ref', REF, '--seed', SEED];
  if (PLAN) args.push('--plan');
  const t0 = Date.now();
  const ch = spawn('node', args, { cwd: ROOT });
  let buf = '';
  ch.stdout.on('data', d => { buf += d; process.stdout.write(`[${f}] ${d}`); });
  ch.stderr.on('data', d => { buf += d; });
  ch.on('close', () => {
    const m = /RESULT (\{.*\})/.exec(buf);
    const r = m ? JSON.parse(m[1]) : { target, ok: false, stage: 'crash' };
    r.file = f; r.wall = Math.round((Date.now() - t0) / 1000);
    results.push(r);
    running--; next();
  });
}
function next() {
  if (idx < files.length && running < JOBS) { launch(files[idx++]); running++; next(); }
  else if (running === 0) finish();
}
function finish() {
  results.sort((a, b) => (b.at4 || 0) - (a.at4 || 0));
  const ok = results.filter(r => r.ok);
  console.log(`\n=== 批次结果：${ok.length}/${results.length} 成功 ===`);
  console.log('图'.padEnd(30) + 'at4  run4 late4 峰值 首手落点'.padEnd(24) + '容量 用时');
  for (const r of results) {
    if (!r.ok) { console.log(`${r.file.slice(0, 28).padEnd(30)} ❌ ${r.stage}`); continue; }
    console.log(`${r.file.slice(0, 28).padEnd(30)} ${String(r.at4).padStart(3)} ${String(r.run4).padStart(4)} ${String(r.late4).padStart(5)} ${String(r.peak).padStart(4)}  ${String(r.firstQuad).padEnd(22)} ${r.capacityOK ? '✅' : '❌'} ${r.wall}s`);
  }
  const lines = results.map(r => r.ok
    ? `| ${r.file} | ${r.at4} | ${r.run4} | ${r.late4} | ${r.peak} | ${r.firstQuad} | ${r.capacityOK ? '✅' : '❌'} | ${r.wall}s |`
    : `| ${r.file} | ❌ ${r.stage} | - | - | - | - | - | ${r.wall}s |`);
  const md = `# 批次 ${path.basename(OUT)}\n\n` +
    `参数：rows=${ROWS} cols=${COLS} rounds=${ROUNDS} samples=${SAMPLES} ref=${REF} plan=${PLAN} seed=${SEED}\n\n` +
    `| 图 | at4 | run4 | late4 | 峰值 | 首手落点 | 容量 | 用时 |\n|---|---|---|---|---|---|---|---|\n` + lines.join('\n') + '\n';
  fs.writeFileSync(path.join(ROOT, OUT, '报告.md'), md);
  fs.writeFileSync(path.join(ROOT, OUT, 'results.json'), JSON.stringify(results, null, 2));
  console.log(`\n报告：${OUT}/报告.md`);
}
next();
