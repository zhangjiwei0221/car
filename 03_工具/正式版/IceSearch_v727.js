// IceSearch_v727.js —— 冰自动搜索：候选车 × param → 逐个求解 → 贪心取最优
// 用法：node IceSearch_v727.js <关卡.json> --out <输出.json> [--candidates 30] [--params 8,14,20,26,32] [--rounds 3]
'use strict';
const fs = require('fs');
const B = require('./Build006Thickness_v688');
const A = B.loadSolver();
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const FILE = process.argv[2];
const OUT = arg('--out', '/tmp/icesearch.json');
const NCAND = Number(arg('--candidates', 30));
const PARAMS = String(arg('--params', '8,14,20,26,32')).split(',').map(Number);
const ROUNDS = Number(arg('--rounds', 3));

function evalLv(g) {
  const lv = A.parseLevel(A.fromGameFormat(g));
  const o = A.Solver.runSolver(lv, 0, 1, false, false, { capturePreviewStats: true, instantChain: true });
  const buf = (o.pressureSamples || []).map(s => s.buf || 0);
  const n = buf.length;
  let at4 = 0, run4 = 0, cur = 0, lowRun = 0, curLow = 0;
  for (const v of buf) { if (v >= 4) { cur++; at4++; run4 = Math.max(run4, cur); curLow = 0; } else { cur = 0; curLow++; lowRun = Math.max(lowRun, curLow); } }
  const a = Math.floor(n * 0.4), b = Math.floor(n * 0.8);
  let midLate4 = 0; for (let i = a; i < b; i++) if (buf[i] >= 4) midLate4++;
  return { won: !!o.completed, peak: Math.max(0, ...buf), at4, run4, lowRun, midLate4, steps: n };
}

const base = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const R = base.spools.length, C = base.spools[0].length;
const b0 = evalLv(base);
console.log(`基线：步${b0.steps} 峰值${b0.peak} at4=${b0.at4} run4=${b0.run4} midLate4=${b0.midLate4} 低压段=${b0.lowRun}`);

const plains = [];
for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
  const x = base.spools[r][c];
  if (x.id > 0 && (x.type === 0 || x.type === '0')) plains.push({ r, c, id: x.id, count: x.count });
}
// 优先“小色/晚解锁”的车：按同色总容量升序
const capOf = {};
for (const row of base.spools) for (const x of row) if (x.id > 0) capOf[x.id] = (capOf[x.id] || 0) + x.count;
plains.sort((a, b) => (capOf[a.id] - capOf[b.id]) || (a.count - b.count));
const cands = plains.slice(0, NCAND);

let cur = base, curE = b0, applied = [];
for (let round = 0; round < ROUNDS; round++) {
  let bestE = null, bestApply = null;
  for (const cand of cands) {
    const cell = cur.spools[cand.r][cand.c];
    if (!(cell.id > 0) || !(cell.type === 0 || cell.type === '0')) continue;
    for (const p of PARAMS) {
      const h = JSON.parse(JSON.stringify(cur));
      h.spools[cand.r][cand.c].type = 7; h.spools[cand.r][cand.c].param = p;
      let e; try { e = evalLv(h); } catch (err) { continue; }
      if (!e.won || e.peak > 4) continue;
      const gain = (e.at4 - curE.at4) + (e.midLate4 - curE.midLate4) * 0.5;
      if (gain <= 0) continue;
      if (!bestE || gain > bestE._gain) { bestE = { ...e, _gain: gain }; bestApply = { r: cand.r, c: cand.c, color: cand.id, param: p }; }
    }
  }
  if (!bestApply) { console.log(`第${round + 1}轮：无改进`); break; }
  cur = JSON.parse(JSON.stringify(cur));
  cur.spools[bestApply.r][bestApply.c].type = 7; cur.spools[bestApply.r][bestApply.c].param = bestApply.param;
  curE = bestE; applied.push(bestApply);
  console.log(`第${round + 1}轮：冰 ${bestApply.r},${bestApply.c} 色${bestApply.color} param=${bestApply.param} → at4=${curE.at4} run4=${curE.run4} midLate4=${curE.midLate4} 峰值=${curE.peak}`);
}
fs.writeFileSync(OUT, JSON.stringify(cur, null, 2));
console.log(`\n终局：at4=${curE.at4} run4=${curE.run4} midLate4=${curE.midLate4} 峰值=${curE.peak}`);
console.log('冰块：', applied.map(a => `${a.r},${a.c}(色${a.color},p${a.param})`).join(' ') || '无');
console.log('已写出：' + OUT);
