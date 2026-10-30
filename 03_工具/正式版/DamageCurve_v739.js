// DamageCurve_v739.js —— 伤害阶梯：逐手统计“每个象限的独占色被消掉多少”
// 独占色 = 只出现在该象限的颜色（共享色会污染判定，故排除）
// 用法：node DamageCurve_v739.js <关卡.json> [--json out.json]
'use strict';
const fs = require('fs');
const B = require('./Build006Thickness_v688');
const REF = (() => { const i = process.argv.indexOf('--ref'); return i > 0 ? process.argv[i + 1] : 'ring'; })();
const A = B.loadSolver(REF);
const Sim = A.Simulator;
const args = process.argv.slice(2);
const FILE = args[0];
const OUT = (() => { const i = args.indexOf('--json'); return i > 0 ? args[i + 1] : null; })();

function quadrantOf(y, x, R, C) {
  const hy = R / 2, hx = C / 2;
  return (y < hy ? '上' : '下') + (x < hx ? '左' : '右');
}
const g = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const lv = A.parseLevel(A.fromGameFormat(g));
const R = lv.rows, C = lv.cols;
const blocks = lv.blocks;

// 每色在哪些象限出现
const colorQuad = {};
for (let y = 0; y < R; y++) for (let x = 0; x < C; x++) {
  const c = blocks[y][x];
  if (!c || c <= 0) continue;
  (colorQuad[c] = colorQuad[c] || new Set()).add(quadrantOf(y, x, R, C));
}
// 独占色（只在一个象限出现）
const exclusive = {};
for (const c in colorQuad) if (colorQuad[c].size === 1) {
  const q = [...colorQuad[c]][0];
  (exclusive[q] = exclusive[q] || new Set()).add(+c);
}
const QUADS = ['上左', '上右', '下左', '下右'];
const total = {}, byColor = {};
for (const q of QUADS) {
  total[q] = 0; byColor[q] = 0;
  const set = exclusive[q] || new Set();
  for (let y = 0; y < R; y++) for (let x = 0; x < C; x++) if (set.has(blocks[y][x])) total[q]++;
}

const o = A.Solver.runSolver(lv, 0, 1, false, false, { capturePreviewStats: true, instantChain: false });
const order = o.pickOrder || [];
const s = Sim.createState(lv, { useSlotStart: true, bottomOnly: false, instantChain: false });
const cross = {};
const rows = [];
for (let i = 0; i < order.length; i++) {
  Sim.applyPick(s, order[i].r, order[i].c);
  const hit = {};
  for (const q of QUADS) {
    let n = 0; const set = exclusive[q] || new Set();
    for (let y = 0; y < R; y++) for (let x = 0; x < C; x++) if (s.eliminated[y][x] && set.has(blocks[y][x])) n++;
    hit[q] = total[q] ? Math.round(n / total[q] * 100) : 0;
    if (total[q] && cross[q] === undefined && hit[q] >= 10) cross[q] = i + 1;
  }
  rows.push({ step: i + 1, color: order[i].color, hit });
}
console.log(`文件：${FILE}（${R}×${C}，7×${'?'} 棋盘行数 ${g.maprow}）`);
console.log('独占色统计:', QUADS.map(q => `${q}:${[...(exclusive[q]||[])].join('/')}(${total[q]}px)`).join('  '));
console.log('\n步 | ' + QUADS.map(q => q.padStart(5)).join(' '));
for (const r of rows) {
  if (r.step > 30) break;
  console.log(String(r.step).padStart(2) + ' | ' + QUADS.map(q => (r.hit[q] + '%').padStart(5)).join(' '));
}
console.log('\n各象限「内部被消 ≥10%」的步数:', JSON.stringify(cross));
const steps = QUADS.map(q => cross[q] || 999).sort((a, b) => a - b);
console.log('阶梯:', steps.join(' → '), '| 最大跨度:', steps[steps.length - 1] - steps[0]);
if (OUT) fs.writeFileSync(OUT, JSON.stringify({ file: FILE, cross, rows }, null, 2));
