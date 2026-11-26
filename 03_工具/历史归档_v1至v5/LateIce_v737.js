// LateIce_v737.js —— 有职责的冰：专门给“后段”造卡点
// 做法：逐辆候选 × 后段 param（如 32/36/40/44）→ 求解 → 看“后 25% 里 buffer≥4/≥3 的步数”是否变多
// 用法：node LateIce_v737.js <关卡.json> --out <输出.json> [--params 32,36,40,44] [--max 40]
'use strict';
const fs = require('fs');
const B = require('./Build006Thickness_v688');
const A = B.loadSolver();
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const FILE = process.argv[2];
const OUT = arg('--out', '/tmp/lateice.json');
const PARAMS = String(arg('--params', '32,36,40,44')).split(',').map(Number);
const MAXC = Number(arg('--max', 40));

function evalLv(g) {
  const lv = A.parseLevel(A.fromGameFormat(g));
  const o = A.Solver.runSolver(lv, 0, 1, false, false, { capturePreviewStats: true, instantChain: true });
  const buf = (o.pressureSamples || []).map(s => s.buf || 0);
  const n = buf.length;
  let at4 = 0, run4 = 0, cur = 0;
  for (const v of buf) { if (v >= 4) { cur++; at4++; run4 = Math.max(run4, cur); } else cur = 0; }
  const from = Math.floor(n * 0.75);
  let late4 = 0, late3 = 0;
  for (let i = from; i < n; i++) { if (buf[i] >= 4) late4++; if (buf[i] >= 3) late3++; }
  return { won: !!o.completed, peak: Math.max(0, ...buf), at4, run4, steps: n, late4, late3, from, buf };
}

const base = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const R = base.spools.length, C = base.spools[0].length;
const b0 = evalLv(base);
console.log(`基线：步${b0.steps} 峰值${b0.peak} at4=${b0.at4} run4=${b0.run4} 后段(第${b0.from + 1}步起) ≥4:${b0.late4} ≥3:${b0.late3}`);
console.log('后段曲线:', b0.buf.slice(b0.from).join(','));

const plains = [];
for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
  const x = base.spools[r][c];
  if (x.id > 0 && (x.type === 0 || x.type === '0')) plains.push({ r, c });
}
console.log(`候选车 ${plains.length}，params ${PARAMS.join('/')}`);

let best = null;
for (const p of plains.slice(0, MAXC)) {
  for (const param of PARAMS) {
    const h = JSON.parse(JSON.stringify(base));
    h.spools[p.r][p.c].type = 7; h.spools[p.r][p.c].param = param;
    let e; try { e = evalLv(h); } catch (err) { continue; }
    if (!e.won || e.peak > 4) continue;
    if (e.at4 < b0.at4 - 2) continue;                 // 不牺牲太多总压力
    const gain = (e.late4 - b0.late4) * 3 + (e.late3 - b0.late3);
    if (gain <= 0) continue;
    if (!best || gain > best.gain) best = { gain, r: p.r, c: p.c, param, e };
  }
}
if (!best) { console.log('没有冰块能改善后段'); process.exit(0); }
console.log(`最佳：冰 (${best.r},${best.c}) param=${best.param} → at4=${best.e.at4} run4=${best.e.run4} 后段≥4:${best.e.late4} ≥3:${best.e.late3}`);
console.log('后段曲线:', best.e.buf.slice(best.e.from).join(','));
fs.writeFileSync(OUT, JSON.stringify((() => { const h = JSON.parse(JSON.stringify(base)); h.spools[best.r][best.c].type = 7; h.spools[best.r][best.c].param = best.param; return h; })(), null, 2));
console.log('已写出：' + OUT);
