#!/usr/bin/env node
/**
 * 原型 B：按「需求时刻 τ」排车的供给顺序 vs 随机排列
 *
 *   node 原型B_摆位实验.js <关卡json> [--runs 15] [--inject 0.2]
 *
 * 控制变量：同一张目标图、同一批车（25 上盘 + 5 管）、同一障碍骨架（黑块/管道位置不变）。
 * 只改「哪辆车放在哪个格」。
 *
 *   A 随机   ：车单随机打乱，前 25 上盘、后 5 进管道
 *   B τ排序  ：按 τ（该车容量要等到进度多少才攒得够）升序，前 25 上盘、后 5 进管道
 *   B+注入 p ：在 B 的基础上，把 k=round(p*25) 辆「晚需求」车随机提前到前段（制造供给超前）
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
if (!file) { console.error('用法：node 原型B_摆位实验.js <关卡json> [--runs 15] [--inject 0.2]'); process.exit(1); }
const ri = process.argv.indexOf('--runs'); const RUNS = ri > 0 ? (parseInt(process.argv[ri + 1], 10) || 15) : 15;
const ii = process.argv.indexOf('--inject'); const INJ = ii > 0 ? (parseFloat(process.argv[ii + 1]) || 0.2) : 0.2;

const j = JSON.parse(fs.readFileSync(file, 'utf8'));
const blocks = j.blocks;
const dc = G.demandCurveOf(blocks);
if (!dc) { console.error('demandCurveOf 失败'); process.exit(1); }

/* ---- 抽取车单与骨架 ---- */
const cars = [];
let pipeCell = null, pipeR = -1, pipeC = -1;
const boxSlots = [];
const rows = j.board.rows, cols = j.board.cols;
for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
  const cell = j.board.cells[r][c];
  if (cell.t === 'box') { cars.push({ color: cell.color, count: cell.count, from: 'box' }); boxSlots.push([r, c]); }
  else if (cell.t === 'pipe') {
    pipeR = r; pipeC = c; pipeCell = cell;
    for (const q of (cell.queue || [])) cars.push({ color: q.color, count: q.count, from: 'pipe' });
  }
}
for (const car of cars) car.tau = G.demandAt(dc, car.color, car.count);
console.log('关卡：' + path.basename(file) + '　车 ' + cars.length + '（上盘 ' + boxSlots.length + ' + 管 ' + (pipeCell ? pipeCell.queue.length : 0) + '）');
console.log('τ 分布：min=' + Math.min.apply(null, cars.map(function (x) { return x.tau; })).toFixed(2) +
  ' 中位=' + cars.map(function (x) { return x.tau; }).sort(function (a, b) { return a - b; })[Math.floor(cars.length / 2)].toFixed(2) +
  ' max=' + Math.max.apply(null, cars.map(function (x) { return x.tau; })).toFixed(2));

/* ---- 建盘 ---- */
function buildBoard(order) {
  const cells = j.board.cells.map(function (row) { return row.map(function (c) { return JSON.parse(JSON.stringify(c)); }); });
  // 清空原 box
  for (const s of boxSlots) cells[s[0]][s[1]] = null;
  // 清空管道队列
  if (pipeCell) cells[pipeR][pipeC].queue = [];
  // 行优先填前 boxSlots.length 辆
  const nBox = boxSlots.length;
  const sortedSlots = boxSlots.slice().sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
  for (let i = 0; i < nBox; i++) {
    const s = sortedSlots[i], car = order[i];
    cells[s[0]][s[1]] = { t: 'box', color: car.color, count: car.count, chain: 0, q: false, numice: 0 };
  }
  // 余下进管道
  if (pipeCell) {
    for (let i = nBox; i < order.length; i++) cells[pipeR][pipeC].queue.push({ color: order[i].color, count: order[i].count });
  }
  return { rows: rows, cols: cols, cells: cells };
}

function band3Of(res) {
  const ps = res.pressureSamples || [], tb = res.totalBoxes || 0;
  let tot = 0, ge = 0, pk = 0;
  for (const s of ps) {
    const pr = tb ? s.done / tb : 0;
    if (pr < 0.30 || pr > 0.80) continue;
    tot++;
    if (s.buf >= 3) ge++;
    if (s.buf > pk) pk = s.buf;
  }
  return { band3: tot ? Math.round(ge / tot * 100) : null, peak: pk, solved: !!res.completed, steps: (res.stepBufferHistory || []).length };
}

function lcg(seed) { let s = (seed >>> 0) || 1; return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function shuffle(a, rnd) { for (let i = a.length - 1; i > 0; i--) { const k = Math.floor(rnd() * (i + 1)); const t = a[i]; a[i] = a[k]; a[k] = t; } return a; }

function evalOrder(order, seed) {
  const board = buildBoard(order);
  const parsed = A.parseLevel({ blocks: blocks, bufferLimit: j.bufferLimit || 5, board: board });
  let res;
  try { res = A.Solver.solve(parsed, { capturePreviewStats: true }); } catch (e) { return { err: String(e && e.message) }; }
  return band3Of(res);
}

/* ---- 三组 ---- */
function buildRandom(seed) {
  const rnd = lcg(seed);
  return shuffle(cars.slice(), rnd);
}
function buildTau() {
  return cars.slice().sort(function (a, b) { return a.tau - b.tau; });
}
function buildTauInject(seed, p) {
  const rnd = lcg(seed);
  const arr = buildTau();
  const nBox = boxSlots.length;
  const k = Math.max(0, Math.round(p * nBox));
  // 晚需求的候选：后半段
  const lateIdx = [];
  for (let i = Math.floor(nBox / 2); i < arr.length; i++) lateIdx.push(i);
  for (let t = 0; t < k && lateIdx.length; t++) {
    const li = lateIdx.splice(Math.floor(rnd() * lateIdx.length), 1)[0];
    const target = Math.floor(rnd() * Math.max(1, nBox / 2));   // 提前到前段
    const tmp = arr[target]; arr[target] = arr[li]; arr[li] = tmp;
  }
  return arr;
}

function planOrder(strength) {
  // 确定性：按 τ 升序填盘，然后【每行前 k 辆】被替换成"最晚需求"的车（从尾部取）
  // k 由行号决定：第 0 行 k=strength-1，其余行 k=strength。替换顺序确定，无随机。
  const arr = buildTau();
  const byRow = {};
  for (const s of boxSlots) (byRow[s[0]] = byRow[s[0]] || []).push(s);
  const rowsSorted = Object.keys(byRow).map(Number).sort(function (a, b) { return a - b; });
  const ordered = [];
  for (const r of rowsSorted) for (const s of byRow[r].sort(function (a, b) { return a[1] - b[1]; })) ordered.push(s);
  let take = arr.length - 1;
  for (let ri = 0; ri < rowsSorted.length; ri++) {
    const r = rowsSorted[ri];
    const k = (r === 0) ? Math.max(0, strength - 1) : strength;
    const start = ordered.findIndex(function (s) { return s[0] === r; });
    for (let i = 0; i < k; i++) {
      const idx = start + i;
      if (take > idx) { const t = arr[idx]; arr[idx] = arr[take]; arr[take] = t; take--; }
    }
  }
  return arr;
}

function runGroup(name, maker) {
  const out = [];
  for (let i = 0; i < RUNS; i++) {
    const r = evalOrder(maker(1000 + i * 37 + 7), 1000 + i * 37);
    if (r.err) { out.push(null); continue; }
    out.push(r);
  }
  const ok = out.filter(function (x) { return x && x.solved; });
  const b3 = ok.map(function (x) { return x.band3; }).filter(function (x) { return x != null; });
  const pk = ok.map(function (x) { return x.peak; });
  const mean = b3.length ? b3.reduce(function (a, b) { return a + b; }, 0) / b3.length : null;
  const sd = b3.length > 1 ? Math.sqrt(b3.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / (b3.length - 1)) : null;
  const pass = b3.filter(function (x) { return x >= 45; }).length;
  console.log('  ' + name.padEnd(12) + ' 可解 ' + ok.length + '/' + RUNS +
    '  band3 均值 ' + (mean == null ? '-' : mean.toFixed(1)) +
    '  sd ' + (sd == null ? '-' : sd.toFixed(1)) +
    '  ≥45 ' + pass + '/' + b3.length +
    '  峰 ' + (pk.length ? (pk.reduce(function (a, b) { return a + b; }, 0) / pk.length).toFixed(2) : '-'));
  return { name: name, b3: b3, mean: mean, sd: sd, pass: pass, n: b3.length };
}

console.log('');
console.log('跑 ' + RUNS + ' 次/组（同图、同车单、同障碍，只改摆位）：');
const resA = runGroup('A 随机', buildRandom);
const resB = runGroup('B τ排序', function () { return buildTau(); });
const plan = [];
for (const st of [1, 2, 3, 4, 5]) plan.push({ st: st, r: runGroup('B_plan ' + st, (function (v) { return function () { return planOrder(v); }; })(st)) });

console.log('');
console.log('结论口径：sd 越小 = 越可控；均值越高 = 压力越够。');
console.log('  A→B 的 sd 变化：' + (resA.sd != null && resB.sd != null ? (resB.sd - resA.sd).toFixed(1) : '-'));
console.log('');
console.log('确定性按行摆位（strength = 每行替换几辆晚需求车）：');
console.log('  strength  band3均值  sd     ≥45');
for (const s of plan) {
  console.log('  ' + String(s.st).padEnd(9) + ' ' + (s.r.mean == null ? '-' : s.r.mean.toFixed(1)).padStart(8) +
    ' ' + (s.r.sd == null ? '-' : s.r.sd.toFixed(1)).padStart(6) + '  ' + s.r.pass + '/' + s.r.n);
}
