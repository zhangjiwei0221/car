#!/usr/bin/env node
'use strict';
/**
 * OrderSearch_v789 —— 在"取车顺序"这个一维空间里搜索
 *
 * 用户 2026-11-03：「用黑块把路径封一下，让每一步选择从 N 个变成两三个，
 *                    然后获取一个理想的消除车序，摆放到棋盘上」
 *
 * 做法：
 *   1. 用黑块铺 N×N 棋盘，只留一条 2 格宽的螺旋通道（每步只露 2~3 辆）
 *   2. 把图切成的车按若干种"顺序"铺到通道上
 *   3. 每种顺序跑一次求解，记录 at3 / 中段 / 收尾 / 容错
 *   4. 挑最好的
 *
 * 用法：node OrderSearch_v789.js <图.txt> [--board 16] [--cars 49]
 */
const fs = require('fs');
const B = require('./Build006Thickness_v688');
const A = B.loadSolver('corner');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const IMG = process.argv[2];
const N = Number(arg('--board', 16));
const CARS = Number(arg('--cars', 49));

const m = fs.readFileSync(IMG, 'utf8').trim().split(/\r?\n/).slice(1).map(l => l.trim().split(/\s+/).map(Number));
const H = m.length, W = m[0].length, TOT = H * W;
const px = {};
for (const r of m) for (const v of r) px[v] = (px[v] || 0) + 1;
const colors = Object.keys(px).map(Number);
const bo = {}, pc = {};
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const c = m[y][x]; pc[c] = (pc[c] || 0) + 1;
  if (y === 0 || x === 0 || y === H - 1 || x === W - 1) bo[c] = (bo[c] || 0) + 1;
}
const bf = {}; for (const c of colors) bf[c] = (bo[c] || 0) / (pc[c] || 1);
const sumd = {}; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const c = m[y][x]; sumd[c] = (sumd[c] || 0) + ((H - 1 - y) + x); }
const depth = {}; for (const c of colors) depth[c] = sumd[c] / pc[c];

// ---- 2 格宽螺旋通道 ----
const path = [];
{
  let r0 = 0, c0 = 0, r1 = N - 1, c1 = N - 1;
  const ring = [];
  while (r0 <= r1 && c0 <= c1) {
    for (let c = c0; c <= c1; c++) ring.push([r0, c]);
    for (let r = r0 + 1; r <= r1; r++) ring.push([r, c1]);
    if (r0 < r1) for (let c = c1 - 1; c >= c0; c--) ring.push([r1, c]);
    if (c0 < c1) for (let r = r1 - 1; r > r0; r--) ring.push([r, c0]);
    r0++; c0++; r1--; c1--;
  }
  for (const [r, c] of ring) {
    path.push([r, c]);
    if (path.length >= CARS) break;
  }
}
const cells = path.length;
const CAP = TOT / cells;

function cutCars() {
  const cars = [];
  for (const c of colors) {
    const n = Math.max(1, Math.floor(px[c] / CAP));
    const base = Math.floor(px[c] / n); let rest = px[c] - base * n;
    for (let j = 0; j < n; j++) cars.push({ id: c, count: base + (j >= n - rest ? 1 : 0) });
  }
  while (cars.length < cells) {
    cars.sort((a, b) => b.count - a.count); const big = cars.shift();
    if (big.count < 2) { cars.push(big); break; }
    const h = Math.floor(big.count / 2); cars.push({ id: big.id, count: h }, { id: big.id, count: big.count - h });
  }
  while (cars.length > cells) cars.pop();
  return cars;
}

function build(orderFn) {
  const cars = cutCars();
  orderFn(cars);
  const spools = Array.from({ length: N }, () => Array(N).fill(null));
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) spools[r][c] = { id: -1, type: 0, param: 0, count: 0 };
  let k = 0;
  for (const [r, c] of path) { const x = cars[k++]; if (x) spools[r][c] = { id: x.id, type: 0, param: 0, count: x.count }; }
  return { toprow: H, blocks: m, maprow: N, mapcol: N, spools };
}

function measure(g) {
  const o = A.Solver.runSolver(A.parseLevel(A.fromGameFormat(g)), 0, 1, false, false, { capturePreviewStats: true, instantChain: false });
  const buf = (o.pressureSamples || []).map(s => s.buf || 0);
  const L = buf.length, m0 = Math.floor(L * 0.2), m1 = Math.floor(L * 0.8);
  let a3 = 0, r3 = 0, c = 0, a4 = 0;
  for (const v of buf) { if (v >= 3) { a3++; c++; r3 = Math.max(r3, c); } else c = 0; if (v >= 4) a4++; }
  let tr = 0; c = 0;
  for (const v of buf.slice(m1)) { if (v >= 3) { c++; tr = Math.max(tr, c); } else c = 0; }
  let tok = 0;
  for (let i = 0; i < 10; i++) {
    const noise = i === 0 ? 0 : 0.2 + (i % 5) * 0.2;
    const oo = A.Solver.runSolver(A.parseLevel(A.fromGameFormat(g)), noise, 1000 + i * 37, false, false, { capturePreviewStats: false, instantChain: false });
    if (oo.completed) tok++;
  }
  return { won: !!o.completed, steps: L, a3, r3, a4, peak: Math.max(0, ...buf), mid3: buf.slice(m0, m1).filter(v => v >= 3).length, tail3: buf.slice(m1).filter(v => v >= 3).length, tailRun: tr, tol: tok / 10, buf };
}

const orders = [
  ['按色号升序', cs => cs.sort((a, b) => a.id - b.id)],
  ['按色号降序', cs => cs.sort((a, b) => b.id - a.id)],
  ['小色在前', cs => cs.sort((a, b) => px[a.id] - px[b.id])],
  ['大色在前', cs => cs.sort((a, b) => px[b.id] - px[a.id])],
  ['边框色在前', cs => cs.sort((a, b) => (bf[b.id] || 0) - (bf[a.id] || 0))],
  ['边框色在后', cs => cs.sort((a, b) => (bf[a.id] || 0) - (bf[b.id] || 0))],
  ['深处色在前', cs => cs.sort((a, b) => (depth[b.id] || 0) - (depth[a.id] || 0))],
  ['深处色在后', cs => cs.sort((a, b) => (depth[a.id] || 0) - (depth[b.id] || 0))],
];

console.log('图 ' + IMG.split('/').pop() + ' | 棋盘 ' + N + 'x' + N + ' | 通道 ' + cells + ' 格 | 容量 ' + CAP.toFixed(1));
console.log('序 | 可通 步 | at3 run3 | 中段at3 | 收尾at3/连续 | at4 峰值 | 容错');
let best = null;
for (const [name, fn] of orders) {
  const g = build(fn);
  const r = measure(g);
  console.log(name.padEnd(8) + ' | ' + (r.won ? '✓' : '✗') + ' ' + String(r.steps).padStart(3) + ' | ' +
    String(r.a3).padStart(2) + ' ' + String(r.r3).padStart(2) + ' | ' + String(r.mid3).padStart(2) + ' | ' +
    String(r.tail3).padStart(2) + '/' + String(r.tailRun).padStart(2) + ' | ' + String(r.a4).padStart(2) + ' ' + String(r.peak) + ' | ' + (100 * r.tol).toFixed(0) + '%');
  const score = (r.won ? 100 : 0) + r.a3 * 2 + r.mid3 * 2 + r.tailRun * 5 + r.tol * 40 - r.a4;
  if (!best || score > best.score) best = { name, g, r, score };
}
console.log('\n★ 最好: ' + best.name + ' (at3=' + best.r.a3 + ' 中段=' + best.r.mid3 + ' 收尾=' + best.r.tailRun + ' 容错=' + (100 * best.r.tol).toFixed(0) + '%)');
console.log('曲线:', best.r.buf.join(','));
fs.writeFileSync('/tmp/ordersearch.json', JSON.stringify(best.g));
