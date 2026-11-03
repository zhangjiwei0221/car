#!/usr/bin/env node
'use strict';
/**
 * ForceSeq_v795 —— 强制车序的爬山（用引擎当裁判）
 *
 * 前提：1 格宽内部通道 → 取车顺序被完全强制（实测 r0..rN 一步不跳）
 * 做法：直接在"车序"上做局部搜索（交换任意两辆），目标是用引擎跑出来的曲线。
 *
 * 用法：node ForceSeq_v795.js <图.txt> --cells 60 --iters 300
 */
const fs = require('fs');
const B = require('./Build006Thickness_v688');
const A = B.loadSolver('corner');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const IMG = process.argv[2];
const CELLS = Number(arg('--cells', 60));
const ITERS = Number(arg('--iters', 300));

const m = fs.readFileSync(IMG, 'utf8').trim().split(/\r?\n/).slice(1).map(l => l.trim().split(/\s+/).map(Number));
const H = m.length, W = m[0].length, TOT = H * W;
const px = {};
for (const r of m) for (const v of r) px[v] = (px[v] || 0) + 1;
const colors = Object.keys(px).map(Number);
const CAP = TOT / CELLS;

function makePool() {
  const pool = [];
  for (const c of colors) {
    const n = Math.max(1, Math.floor(px[c] / CAP));
    const base = Math.floor(px[c] / n); let rest = px[c] - base * n;
    for (let j = 0; j < n; j++) pool.push({ id: c, count: base + (j >= n - rest ? 1 : 0) });
  }
  while (pool.length < CELLS) {
    pool.sort((a, b) => b.count - a.count); const big = pool.shift();
    if (big.count < 2) { pool.push(big); break; }
    const h = Math.floor(big.count / 2);
    pool.push({ id: big.id, count: h }, { id: big.id, count: big.count - h });
  }
  while (pool.length > CELLS) pool.pop();
  return pool;
}

function build(seq) {
  const N = seq.length + 4, COL = Math.floor(N / 2);
  const spools = Array.from({ length: N }, () => Array(N).fill(null));
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) spools[r][c] = { id: -1, type: 0, param: 0, count: 0 };
  for (let r = 0; r < seq.length; r++) spools[r][COL] = { id: seq[r].id, type: 0, param: 0, count: seq[r].count };
  return { toprow: H, blocks: m, maprow: N, mapcol: N, spools };
}

function score(seq) {
  const g = build(seq);
  const o = A.Solver.runSolver(A.parseLevel(A.fromGameFormat(g)), 0, 1, false, false, { capturePreviewStats: true, instantChain: false });
  const buf = (o.pressureSamples || []).map(s => s.buf || 0);
  const L = buf.length;
  if (!o.completed) return { sc: -1e6 + L * 10, won: false, L, a3: 0, a4: 0, peak: 0, buf };
  const eN = Math.max(1, Math.round(L * 0.2)), tN = Math.floor(L * 0.8);
  let a3 = 0, a4 = 0;
  for (const v of buf) { if (v >= 3) a3++; if (v >= 4) a4++; }
  const e4 = buf.slice(0, eN).filter(v => v >= 4).length;
  const t3 = buf.slice(tN).filter(v => v >= 3).length;
  const peak = Math.max(0, ...buf);
  // 目标：中段 at3 高、峰值 4、前段不爆、后段有压、且必须通关
  const sc = 2000 + a3 * 8 + a4 * 3 - e4 * 200 + t3 * 10 + (peak === 4 ? 200 : -300);
  return { sc, won: true, L, a3, a4, peak, e4, t3, buf };
}

let seq = makePool();
seq.sort((a, b) => (a.count / px[a.id]) - (b.count / px[b.id]));   // 难的在前
let cur = score(seq);
console.log('起点: 通关=' + cur.won + ' 步=' + cur.L + ' at3=' + cur.a3 + ' at4=' + cur.a4 + ' 峰值=' + cur.peak + ' → 分 ' + cur.sc.toFixed(0));

let s = 20261103;
const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
let best = { seq: seq.slice(), m: cur };
for (let it = 0; it < ITERS; it++) {
  const i = Math.floor(rnd() * seq.length), j = Math.floor(rnd() * seq.length);
  if (i === j) continue;
  const t = seq.slice();
  [t[i], t[j]] = [t[j], t[i]];
  const r = score(t);
  if (r.sc > cur.sc) {
    seq = t; cur = r;
    if (r.sc > best.m.sc) best = { seq: t.slice(), m: r };
    if (it % 25 === 0) console.log('  第' + it + '轮: at3=' + r.a3 + ' at4=' + r.a4 + ' 峰值=' + r.peak + ' 前段at4=' + r.e4 + ' 后段at3=' + r.t3);
  }
}
console.log('\n最优: 通关=' + best.m.won + ' 步=' + best.m.L + ' at3=' + best.m.a3 + ' at4=' + best.m.a4 + ' 峰值=' + best.m.peak);
console.log('曲线: ' + best.m.buf.join(','));
fs.writeFileSync('/tmp/forced_seq.json', JSON.stringify({ seq: best.seq, cells: CELLS }));
fs.writeFileSync('/tmp/forced_level.json', JSON.stringify(build(best.seq)));
