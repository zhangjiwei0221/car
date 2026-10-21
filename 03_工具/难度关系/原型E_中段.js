#!/usr/bin/env node
/**
 * 实验 E：中段旋钮 —— 固定第 0 行 1 个入口，第 1 行封 k 格，测 band3 是否单调上升
 *
 *   node 原型E_中段.js <关卡json> [--runs 3]
 *
 * 盘 6×7=42，车 30，黑块 11，管道 1（空）。
 *   第 0 行：c=0 车格，c=1..6 黑（入口 = 1）
 *   第 1 行：c=1..k 黑（中段封堵强度 k）
 *   剩余 5-k 黑放第 5 行；其余空格按行优先填车（第 0 行那个格放 τ 最大的车）。
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
if (!file) { console.error('用法：node 原型E_中段.js <关卡json> [--runs 3]'); process.exit(1); }
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

function skeleton(k) {
  const cells = [];
  for (let r = 0; r < R; r++) { cells.push([]); for (let c = 0; c < C; c++) cells[r].push(null); }
  for (let c = 1; c < C; c++) cells[0][c] = { t: 'black' };
  for (let c = 1; c <= k && c < C; c++) cells[1][c] = { t: 'black' };
  let left = (BLACK - (C - 1)) - k;
  for (let c = 0; c < C && left > 0; c++) { cells[5][c] = { t: 'black' }; left--; }
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

function orderFor(t) {
  // 入口放 τ 最大的；其余按 τ 升序
  const arr = cars.slice().sort(function (a, b) { return a.tau - b.tau; });
  const first = arr[arr.length - 1];
  const rest = arr.slice(0, arr.length - 1);
  return [first].concat(rest);
}

console.log('关卡：' + path.basename(file) + '　车 ' + cars.length + '　盘 ' + R + 'x' + C + '　入口 1　黑块 ' + BLACK);
console.log('');
console.log('k(第1行封堵)  band3  sd   峰值  可解  ≥45');

const out = [];
for (let k = 0; k <= 5; k++) {
  const cells = skeleton(k);
  const vals = [], peaks = [];
  let solved = 0;
  for (let i = 0; i < RUNS; i++) {
    const bd = buildBoard(cells, orderFor(k));
    let res;
    try { res = A.Solver.solve(A.parseLevel({ blocks: blocks, bufferLimit: 5, board: bd }), { capturePreviewStats: true }); } catch (e) { continue; }
    const q = band3Of(res);
    if (q.solved) solved++;
    if (q.band3 != null) vals.push(q.band3);
    peaks.push(q.peak);
  }
  const mean = vals.length ? vals.reduce(function (a, b) { return a + b; }, 0) / vals.length : null;
  const sd = vals.length > 1 ? Math.sqrt(vals.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / (vals.length - 1)) : 0;
  const pk = peaks.length ? peaks.reduce(function (a, b) { return a + b; }, 0) / peaks.length : null;
  out.push({ k: k, mean: mean, sd: sd, pk: pk, solved: solved });
  console.log('  ' + String(k).padEnd(12) + (mean == null ? '-' : mean.toFixed(1)).padStart(6) + ' ' +
    sd.toFixed(1).padStart(4) + ' ' + (pk == null ? '-' : pk.toFixed(2)).padStart(5) + '  ' +
    solved + '/' + RUNS + '  ' + vals.filter(function (x) { return x >= 45; }).length + '/' + vals.length);
}

const means = out.map(function (x) { return x.mean; }).filter(function (x) { return x != null; });
let up = 0, down = 0;
for (let i = 1; i < means.length; i++) { if (means[i] > means[i - 1]) up++; else if (means[i] < means[i - 1]) down++; }
console.log('');
console.log('单调性：' + (down === 0 ? '单调上升' : (up === 0 ? '单调下降' : '非单调（升 ' + up + ' 降 ' + down + '）')));
console.log('范围：' + Math.min.apply(null, means).toFixed(0) + '% ~ ' + Math.max.apply(null, means).toFixed(0) + '%');
