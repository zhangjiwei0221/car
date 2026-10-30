// LockCoreBuild_v727.js —— 锁芯构造器：为“中后期长平台”造一个晚解锁的色
// 思路：选一个 ≥2 辆车的颜色 → 该色几辆成链（一次欠 2-3 倍）+ 其余同色车上冰（晚解冻）
//      → 让中后段 buffer 长时间 ≥4（midLate4 上升）
// 用法：node LockCoreBuild_v727.js <关卡.json> --out <输出.json> [--target-mid 12] [--rounds 3]
'use strict';
const fs = require('fs');
const B = require('./Build006Thickness_v688');
const A = B.loadSolver();
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const FILE = process.argv[2];
const OUT = arg('--out', '/tmp/lockcore.json');
const TARGET = Number(arg('--target-mid', 12));
const ROUNDS = Number(arg('--rounds', 3));

function evalLv(g) {
  const lv = A.parseLevel(A.fromGameFormat(g));
  const o = A.Solver.runSolver(lv, 0, 1, false, false, { capturePreviewStats: true, instantChain: true });
  const buf = (o.pressureSamples || []).map(s => s.buf || 0);
  const n = buf.length;
  let at4 = 0, run4 = 0, cur = 0, lowRun = 0, curLow = 0;
  for (const v of buf) { if (v >= 4) { cur++; at4++; run4 = Math.max(run4, cur); curLow = 0; } else { cur = 0; curLow++; lowRun = Math.max(lowRun, curLow); } }
  const a = Math.floor(n * 0.4), b = Math.floor(n * 0.8);
  let midLate4 = 0;
  for (let i = a; i < b && i < n; i++) if (buf[i] >= 4) midLate4++;
  return { won: !!o.completed, peak: Math.max(0, ...buf), at4, run4, lowRun, midLate4, steps: n, buf };
}

const base = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const R = base.spools.length, C = base.spools[0].length;
const b0 = evalLv(base);
console.log(`基线：步${b0.steps} 峰值${b0.peak} at4=${b0.at4} run4=${b0.run4} midLate4=${b0.midLate4} 最长低压段=${b0.lowRun}`);
if (!b0.won) { console.log('基线不可解，终止'); process.exit(1); }

// 每色车辆清单
function carsByColor(g) {
  const m = {};
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    const x = g.spools[r][c];
    if (x.id > 0 && (x.type === 0 || x.type === '0')) (m[x.id] = m[x.id] || []).push({ r, c, count: x.count });
  }
  return m;
}
const CAP_OF = {};
for (const row of base.spools) for (const x of row) if (x.id > 0) CAP_OF[x.id] = (CAP_OF[x.id] || 0) + x.count;

const mid = Math.floor(b0.steps * 0.65);   // 冰解冻点：约 65% 步数
let best = { e: b0, actions: [] };
let cur = base, curE = b0, actions = [];

for (let round = 0; round < ROUNDS; round++) {
  const byColor = carsByColor(cur);
  const cands = [];
  for (const col of Object.keys(byColor)) {
    const cars = byColor[col];
    if (cars.length < 2) continue;
    if ((CAP_OF[col] || 0) < 40) continue;
    // 方案 A：两辆成链
    cands.push({ type: 'chain2', col: +col, cars: cars.slice(0, 2) });
    // 方案 B：两辆成链 + 其余上冰
    if (cars.length >= 3) cands.push({ type: 'chain2+ice', col: +col, cars: cars.slice(0, 2), iced: cars.slice(2) });
    // 方案 C：三辆成链
    if (cars.length >= 3) cands.push({ type: 'chain3', col: +col, cars: cars.slice(0, 3) });
  }
  let bestMove = null, bestE = null;
  for (const cand of cands) {
    const h = JSON.parse(JSON.stringify(cur));
    let maxChain = 0;
    for (const row of h.spools) for (const cell of row) {
      const ts = Array.isArray(cell.type) ? cell.type : [cell.type || 0];
      if (ts.includes(5)) { const ps = Array.isArray(cell.param) ? cell.param : [cell.param]; const v = Number(ps[ts.indexOf(5)]); if (v > maxChain) maxChain = v; }
    }
    const cid = maxChain + 1;
    for (const c of cand.cars) { h.spools[c.r][c.c].type = 5; h.spools[c.r][c.c].param = cid; }
    if (cand.iced) for (const c of cand.iced) { h.spools[c.r][c.c].type = 7; h.spools[c.r][c.c].param = mid; }
    let e; try { e = evalLv(h); } catch (err) { continue; }
    if (!e.won || e.peak > 4) continue;
    if (!bestE || e.midLate4 > bestE.midLate4 || (e.midLate4 === bestE.midLate4 && e.at4 > bestE.at4)) { bestE = e; bestMove = { cand, level: h }; }
  }
  if (!bestMove || bestE.midLate4 <= curE.midLate4) { console.log(`第${round + 1}轮：无改进（midLate4 停在 ${curE.midLate4}）`); break; }
  cur = bestMove.level; curE = bestE;
  actions.push(bestMove.cand);
  console.log(`第${round + 1}轮：${bestMove.cand.type} 色${bestMove.cand.col} → midLate4=${curE.midLate4} at4=${curE.at4} run4=${curE.run4} 峰值=${curE.peak}`);
  if (curE.midLate4 >= TARGET) { console.log(`达到目标 midLate4=${TARGET}`); break; }
}

fs.writeFileSync(OUT, JSON.stringify(cur, null, 2));
console.log(`\n终局：midLate4=${curE.midLate4} at4=${curE.at4} run4=${curE.run4} 峰值=${curE.peak} 低压段=${curE.lowRun}`);
console.log('动作：', actions.map(a => `${a.type}(色${a.col})`).join(' → ') || '无');
console.log('已写出：' + OUT);
