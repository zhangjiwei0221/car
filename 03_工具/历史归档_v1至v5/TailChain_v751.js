// TailChain_v751.js —— 尾段专用：把“最后 25% 才被点”的车捆成链组，制造尾段债务
// 原理：链组 2–3 辆一起进暂存、全消完才离场 → 尾段暂存占用一次性抬 2–3 格 → late4 上升
// 用法：node TailChain_v751.js <关卡.json> --ref corner [--out x.json] [--size 2,3] [--ablate]
'use strict';
const fs = require('fs');
const B = require('./Build006Thickness_v688');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const has = k => process.argv.includes(k);
const FILE = process.argv[2];
const REF = String(arg('--ref', 'ring'));
const OUT = arg('--out', '/tmp/tailchain.json');
const SIZES = String(arg('--size', '2,3')).split(',').map(Number);
const ABLATE = has('--ablate');
const A = B.loadSolver(REF);

function metrics(g) {
  const lv = A.parseLevel(A.fromGameFormat(g));
  const o = A.Solver.runSolver(lv, 0, 1, false, false, { capturePreviewStats: true, instantChain: false });
  const p = (o.pressureSamples || []).map(x => x.buf || 0);
  let at4 = 0, cur = 0, run4 = 0, late4 = 0;
  const from = Math.floor(p.length * 0.75);
  for (let i = 0; i < p.length; i++) { const v = p[i]; if (v >= 4) { cur++; at4++; run4 = Math.max(run4, cur); } else cur = 0; if (i >= from && v >= 4) late4++; }
  // 首手消除比例
  let firstRatio = 1;
  if (o.pickOrder && o.pickOrder.length) {
    const st = A.Simulator.createState(lv, { useSlotStart: true, bottomOnly: false, instantChain: false });
    A.Simulator.applyPick(st, o.pickOrder[0].r, o.pickOrder[0].c);
    let n = 0; for (let y = 0; y < lv.rows; y++) for (let x = 0; x < lv.cols; x++) if (st.eliminated[y][x]) n++;
    firstRatio = n / Math.max(1, o.pickOrder[0].count);
  }
  return { won: !!o.completed, peak: Math.max(0, ...p), at4, run4, late4, firstRatio, steps: p.length, order: o.pickOrder || [] };
}

const base = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const b0 = metrics(base);
console.log(`基线（${REF}）：at4=${b0.at4} run4=${b0.run4} late4=${b0.late4} 峰值${b0.peak} 首手${Math.round(b0.firstRatio * 100)}%`);

// 尾段候选：pickOrder 最后 25% 里出现的普通车
const n = b0.order.length;
const fromIdx = Math.floor(n * 0.75);
const tailCars = [];
for (let i = fromIdx; i < n; i++) {
  const p = b0.order[i];
  const cell = base.spools[p.r] && base.spools[p.r][p.c];
  if (!cell) continue;
  const ts = Array.isArray(cell.type) ? cell.type : [cell.type || 0];
  if (cell.id > 0 && !ts.includes(5) && !ts.includes(7) && !ts.some(t => t >= 11 && t <= 14)) {
    if (!tailCars.some(x => x.r === p.r && x.c === p.c)) tailCars.push({ r: p.r, c: p.c });
  }
}
console.log(`尾段可选普通车：${tailCars.length} 辆`);

// 找当前最大的 chain id，新链用更大值
let maxChain = 0;
for (const row of base.spools) for (const x of row) {
  const ts = Array.isArray(x.type) ? x.type : [x.type || 0];
  if (ts.includes(5)) {
    const id = Array.isArray(x.param) ? x.param[ts.indexOf(5)] : x.param;
    if (id > maxChain) maxChain = id;
  }
}
let best = null;
const combos = [];
function pick(arr, k, start, cur) {
  if (comboCount >= 300) return;
  if (cur.length === k) { comboCount++; combos.push(cur.slice()); return; }
  for (let i = start; i < arr.length; i++) { cur.push(arr[i]); pick(arr, k, i + 1, cur); cur.pop(); }
}
let comboCount = 0;
for (const k of SIZES) if (tailCars.length >= k) pick(tailCars, k, 0, []);
console.log(`候选链组：${combos.length} 个（尺寸 ${SIZES.join('/')}）`);

const { createPool } = require('./EvalPool_v749');
(async () => {
  const pool = createPool({ workers: Number(process.env.EVAL_WORKERS || 6), ref: REF, mode: 'a' });
  const batch = combos.map(cells => {
    const h = JSON.parse(JSON.stringify(base));
    const cid = maxChain + 1;
    for (const x of cells) {
      const cell = h.spools[x.r][x.c];
      cell.type = 5; cell.param = cid;
    }
    return { cells, h };
  });
  const evals = await pool.evalAll(batch.map(b => b.h));
  await pool.close();
  const rej = { err: 0, unsolv: 0, peak: 0, first: 0, at4: 0, late: 0, ok: 0 };
  for (let i = 0; i < batch.length; i++) {
    const e = evals[i]; if (!e || e.error) { rej.err++; continue; }
    if (!e.won) { rej.unsolv++; continue; }
    if (e.peak > 4) { rej.peak++; continue; }
    if (e.firstRatio < 0.8) { rej.first++; continue; }
    if (e.at4 < b0.at4 - 2) { rej.at4++; continue; }
    if (e.late4 <= b0.late4) { rej.late++; continue; }
    rej.ok++;
    const gain = (e.late4 - b0.late4) * 3 + (e.run4 - b0.run4);
    if (!best || gain > best.gain) best = { gain, cells: batch[i].cells, e, g: batch[i].h };
  }
  console.log('筛选统计:', JSON.stringify(rej));
  if (!best) { console.log('没有链组能改善尾段'); return; }
  console.log(`最佳：${best.cells.length} 连 ${best.cells.map(c => '(' + c.r + ',' + c.c + ')').join(' ')} → at4=${best.e.at4} run4=${best.e.run4} late4=${best.e.late4} 峰值${best.e.peak}`);
  if (ABLATE) {
    const dL = best.e.late4 - b0.late4, dA = best.e.at4 - b0.at4;
    console.log(`归因（回到基线）：late4 ${b0.late4}→${best.e.late4}（Δ${dL}）、at4 ${b0.at4}→${best.e.at4}（Δ${dA}）${dL >= 2 ? ' ← 有职责' : ' ← 影响较小'}`);
  }
  fs.writeFileSync(OUT, JSON.stringify(best.g, null, 2));
  console.log('已写出：' + OUT);
})();
