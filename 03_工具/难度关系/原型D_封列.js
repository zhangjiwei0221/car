#!/usr/bin/env node
/**
 * 实验 D：拓扑封入口 —— 第 0 行只留 t 个入口（其余黑块），测压力是否随入口数单调
 *
 *   node 原型D_封列.js <关卡json> [--runs 3]
 *
 * 盘固定 6×7=42 格；车单沿用关卡（30 辆）；黑块 11 个；管道 1 个（空队列）。
 *   · 第 0 行：t 个车格 + (7-t) 黑块
 *   · 第 5 行：min(7, 4+t) 黑块；第 4 行：剩余黑块
 *   · 其余空格按行优先填车
 *
 * 两组：
 *   D 晚票入口：第 0 行 t 辆取 τ 最大的
 *   R 随机入口：第 0 行 t 辆随机取
 *
 * 只读：不改生产代码、不写 输出文件/。
 */
'use strict';
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const BASE = path.join(__dirname, '..', '..', '02_工程', '完整主bin快照_20261012');
const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js', 'playersim.js', 'analysis.js', 'generator.js'];
const sandbox = { console: { log() {}, warn() {}, error() {} }, module: { exports: {} }, WeakMap, Map, Set, setTimeout, clearTimeout, Infinity, Math, JSON, Date };
vm.createContext(sandbox);
for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BASE, 'bin/js', f), 'utf8'), sandbox, { filename: f });
const A = sandbox.AntSolver;
const G = A.Generator;

const file = process.argv[2];
if (!file) { console.error('用法：node 原型D_封列.js <关卡json> [--runs 3]'); process.exit(1); }
const ri = process.argv.indexOf('--runs'); const RUNS = ri > 0 ? (parseInt(process.argv[ri + 1], 10) || 3) : 3;

const j = JSON.parse(fs.readFileSync(file, 'utf8'));
const blocks = j.blocks;
const dc = G.demandCurveOf(blocks);
const R = 6, C = 7, BLACK = 11;

const cars = [];
for (let r = 0; r < j.board.rows; r++) for (let c = 0; c < j.board.cols; c++) {
  const cell = j.board.cells[r][c];
  if (cell.t === 'box') cars.push({ color: cell.color, count: cell.count });
  else if (cell.t === 'pipe') for (const q of (cell.queue || [])) cars.push({ color: q.color, count: q.count });
}
for (const car of cars) car.tau = G.demandAt(dc, car.color, car.count);

function lcg(seed) { let s = (seed >>> 0) || 1; return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

/** 构造 6×7 骨架：返回 cells（黑块/管道/空格），以及第 0 行车格坐标 */
function skeleton(t) {
  const cells = [];
  for (let r = 0; r < R; r++) { cells.push([]); for (let c = 0; c < C; c++) cells[r].push(null); }
  for (let c = 0; c < C; c++) if (c >= t) cells[0][c] = { t: 'black' };
  let blackLeft = BLACK - (C - t);
  for (let c = 0; c < C && blackLeft > 0; c++) { cells[5][c] = { t: 'black' }; blackLeft--; }
  for (let c = 0; c < C && blackLeft > 0; c++) { cells[4][c] = { t: 'black' }; blackLeft--; }
  // 管道：第 4 行第一个空格（从左到右）
  let pipeSet = false;
  for (let r = 4; r <= 5 && !pipeSet; r++) for (let c = 0; c < C; c++) {
    if (!cells[r][c]) { cells[r][c] = { t: 'pipe', dir: 12, queue: [] }; pipeSet = true; break; }
  }
  return cells;
}

function buildBoard(cells, order) {
  const out = cells.map(function (row) { return row.map(function (c) { return c ? JSON.parse(JSON.stringify(c)) : null; }); });
  const slots = [];
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) if (!out[r][c]) slots.push([r, c]);
  slots.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i], car = order[i];
    out[s[0]][s[1]] = { t: 'box', color: car.color, count: car.count, chain: 0, q: false, numice: 0 };
  }
  return { rows: R, cols: C, cells: out };
}

function band3Of(res) {
  const ps = res.pressureSamples || [], tb = res.totalBoxes || 0;
  let tot = 0, ge = 0, pk = 0;
  for (const s of ps) {
    const pr = tb ? s.done / tb : 0;
    if (pr < 0.30 || pr > 0.80) continue;
    tot++; if (s.buf >= 3) ge++; if (s.buf > pk) pk = s.buf;
  }
  return { band3: tot ? Math.round(ge / tot * 100) : null, peak: pk, solved: !!res.completed };
}

/* 第 0 行车格：cells[0][c] 为 null 的列 */
function row0Cols(cells) { const out = []; for (let c = 0; c < C; c++) if (!cells[0][c]) out.push(c); return out; }

function orderFor(cells, t, mode, seed) {
  const arr = cars.slice().sort(function (a, b) { return a.tau - b.tau; });
  const rnd = lcg(seed);
  const row0 = [];
  if (mode === 'late') {
    for (let i = 0; i < t; i++) row0.push(arr[arr.length - 1 - i]);
  } else {
    const pool = arr.slice();
    for (let i = 0; i < t; i++) row0.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  }
  const used = new Set(row0);
  const rest = arr.filter(function (x) { return !used.has(x); });
  return row0.concat(rest);
}

console.log('关卡：' + path.basename(file) + '　车 ' + cars.length + '　盘 ' + R + 'x' + C + '　黑块 ' + BLACK + '　管道 1 空');
console.log('');
console.log('t入口  D晚票:band3 峰 可解 | R随机:band3 峰 可解');

const res = [];
for (let t = 1; t <= 7; t++) {
  const cells = skeleton(t);
  const dv = [], dp = [], rv = [], rp = [];
  let dsol = 0, rsol = 0;
  for (let i = 0; i < RUNS; i++) {
    const bd = buildBoard(cells, orderFor(cells, t, 'late', 0));
    let r1 = null;
    try { r1 = A.Solver.solve(A.parseLevel({ blocks: blocks, bufferLimit: 5, board: bd }), { capturePreviewStats: true }); } catch (e) {}
    if (r1) { const q = band3Of(r1); if (q.solved) dsol++; if (q.band3 != null) dv.push(q.band3); dp.push(q.peak); }
    const br = buildBoard(cells, orderFor(cells, t, 'rand', 1000 + i * 37));
    let r2 = null;
    try { r2 = A.Solver.solve(A.parseLevel({ blocks: blocks, bufferLimit: 5, board: br }), { capturePreviewStats: true }); } catch (e) {}
    if (r2) { const q = band3Of(r2); if (q.solved) rsol++; if (q.band3 != null) rv.push(q.band3); rp.push(q.peak); }
  }
  const m = function (a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : null; };
  const md = m(dv), mr = m(rv), pd = m(dp), pr = m(rp);
  res.push({ t: t, d: md, r: mr });
  console.log('  ' + String(t).padEnd(5) + (md == null ? '  -' : md.toFixed(0).padStart(9)) + ' ' +
    (pd == null ? '-' : pd.toFixed(1)).padStart(4) + ' ' + dsol + '/' + RUNS + ' | ' +
    (mr == null ? '  -' : mr.toFixed(0).padStart(9)) + ' ' + (pr == null ? '-' : pr.toFixed(1)).padStart(4) + ' ' + rsol + '/' + RUNS);
}
const dv = res.map(function (x) { return x.d; }).filter(function (x) { return x != null; });
let up = 0, down = 0;
for (let i = 1; i < dv.length; i++) { if (dv[i] > dv[i - 1]) up++; else if (dv[i] < dv[i - 1]) down++; }
console.log('');
console.log('D 单调性：' + (down === 0 ? '单调上升' : (up === 0 ? '单调下降' : '非单调（升 ' + up + ' 降 ' + down + '）')));
console.log('D 范围：' + Math.min.apply(null, dv).toFixed(0) + '% ~ ' + Math.max.apply(null, dv).toFixed(0) + '%');
