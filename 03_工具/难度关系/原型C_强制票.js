#!/usr/bin/env node
/**
 * 实验 C：第 0 行「晚需求票」比例 = 软强制
 *
 *   node 原型C_强制票.js <关卡json> [--runs 3]
 *
 * 控制变量：同图、同车单（30 辆）、同障碍（4 黑 + 1 管）、同上盘格数（25）。
 * 自变量：k = 第 0 行放几辆「τ 最大」的车（其余第 0 行放 τ 最小的）。
 *         其余 19 格按 τ 升序填；管道固定最后 5 辆（τ 最大的）。
 * 输出：band3 / 峰值 / 可解，k=0..6。
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
if (!file) { console.error('用法：node 原型C_强制票.js <关卡json> [--runs 3]'); process.exit(1); }
const ri = process.argv.indexOf('--runs'); const RUNS = ri > 0 ? (parseInt(process.argv[ri + 1], 10) || 3) : 3;

const j = JSON.parse(fs.readFileSync(file, 'utf8'));
const blocks = j.blocks;
const dc = G.demandCurveOf(blocks);
const rows = j.board.rows, cols = j.board.cols;

/* 车单 + 骨架 */
const cars = [];
let pipeR = -1, pipeC = -1, pipeCell = null;
const boxSlots = [];
for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
  const cell = j.board.cells[r][c];
  if (cell.t === 'box') { cars.push({ color: cell.color, count: cell.count }); boxSlots.push([r, c]); }
  else if (cell.t === 'pipe') { pipeR = r; pipeC = c; pipeCell = cell; for (const q of (cell.queue || [])) cars.push({ color: q.color, count: q.count }); }
}
for (const car of cars) car.tau = G.demandAt(dc, car.color, car.count);

function buildBoard(order) {
  const cells = j.board.cells.map(function (row) { return row.map(function (c) { return JSON.parse(JSON.stringify(c)); }); });
  for (const s of boxSlots) cells[s[0]][s[1]] = null;
  if (pipeCell) cells[pipeR][pipeC].queue = [];
  const sorted = boxSlots.slice().sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i], car = order[i];
    cells[s[0]][s[1]] = { t: 'box', color: car.color, count: car.count, chain: 0, q: false, numice: 0 };
  }
  if (pipeCell) for (let i = sorted.length; i < order.length; i++) cells[pipeR][pipeC].queue.push({ color: order[i].color, count: order[i].count });
  return { rows: rows, cols: cols, cells: cells };
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

function orderRow0Mix(k) {
  const arr = cars.slice().sort(function (a, b) { return a.tau - b.tau; });   // τ 升序
  const nBox = boxSlots.length;
  const pipeN = arr.length - nBox;
  const pipe = arr.slice(arr.length - pipeN);
  const rest = arr.slice(0, arr.length - pipeN);
  const n0 = boxSlots.filter(function (s) { return s[0] === 0; }).length;
  const kk = Math.max(0, Math.min(n0, Math.min(k, rest.length)));
  const late = rest.slice(rest.length - kk);          // τ 最大的 k 辆
  const early = rest.slice(0, n0 - kk);               // τ 最小的 n0-k 辆
  const used = new Set(late.concat(early));
  const mid = rest.filter(function (x) { return !used.has(x); });   // 其余按 τ 升序
  return late.concat(early, mid, pipe);
}

console.log('关卡：' + path.basename(file) + '　盘 ' + rows + 'x' + cols + '　车 ' + cars.length +
  '　第0行 ' + boxSlots.filter(function (s) { return s[0] === 0; }).length + ' 格　管 ' + (pipeCell ? pipeCell.queue.length : 0));
console.log('');
console.log('k(第0行晚票)  band3  sd   峰值  可解  ≥45');

const out = [];
for (let k = 0; k <= 6; k++) {
  const vals = [], peaks = [];
  let solved = 0;
  for (let i = 0; i < RUNS; i++) {
    const board = buildBoard(orderRow0Mix(k));
    const parsed = A.parseLevel({ blocks: blocks, bufferLimit: j.bufferLimit || 5, board: board });
    let res;
    try { res = A.Solver.solve(parsed, { capturePreviewStats: true }); } catch (e) { continue; }
    const r = band3Of(res);
    if (k === 6 && i === 0 && res.pickOrder) {
      const po = res.pickOrder.slice(0, 8).map(function (p) { return p.color + ':' + p.count; });
      const planned = orderRow0Mix(6).slice(0, 6).map(function (c) { return c.color + ':' + c.count + '(τ' + c.tau.toFixed(2) + ')'; });
      console.log('    k=6 第0行计划: ' + planned.join(' '));
      console.log('    k=6 前8步实取: ' + po.join(' '));
    }
    if (r.solved) solved++;
    if (r.band3 != null) vals.push(r.band3);
    peaks.push(r.peak);
  }
  const mean = vals.length ? vals.reduce(function (a, b) { return a + b; }, 0) / vals.length : null;
  const sd = vals.length > 1 ? Math.sqrt(vals.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / (vals.length - 1)) : 0;
  const pk = peaks.length ? peaks.reduce(function (a, b) { return a + b; }, 0) / peaks.length : null;
  const pass = vals.filter(function (x) { return x >= 45; }).length;
  out.push({ k: k, mean: mean, sd: sd, peak: pk, solved: solved, pass: pass, n: vals.length });
  console.log('  ' + String(k).padEnd(11) + (mean == null ? '-' : mean.toFixed(1)).padStart(6) + ' ' +
    sd.toFixed(1).padStart(4) + ' ' + (pk == null ? '-' : pk.toFixed(2)).padStart(5) + '  ' +
    solved + '/' + RUNS + '  ' + pass + '/' + vals.length);
}

const means = out.map(function (x) { return x.mean; }).filter(function (x) { return x != null; });
let ups = 0, downs = 0;
for (let i = 1; i < means.length; i++) { if (means[i] > means[i - 1]) ups++; else if (means[i] < means[i - 1]) downs++; }
console.log('');
console.log('单调性：' + (downs === 0 ? '单调上升' : (ups === 0 ? '单调下降' : '非单调（升 ' + ups + ' 次 / 降 ' + downs + ' 次）')));
console.log('可达范围：band3 ' + Math.min.apply(null, means).toFixed(0) + '% ~ ' + Math.max.apply(null, means).toFixed(0) + '%');
