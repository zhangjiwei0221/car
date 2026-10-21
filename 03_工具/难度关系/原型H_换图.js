#!/usr/bin/env node
/**
 * 实验 H：换目标图，看「最优通道数」是否移动（联动的可证伪检验）
 *
 *   node 原型H_换图.js <关卡json1> <关卡json2> ...
 *
 * 每张图用各自的车单和 blocks；骨架统一：
 *   6×7=42，黑块 11，管道 1（空），30 个车格
 *   第 0 行：c=0 入口，其余黑
 *   第 1 行：c=1..k 黑（k = 封堵强度）
 *   第 5 行：剩余黑块
 *   入口放 τ 最大的车，其余按 τ 升序
 *
 * 同时算该图的需求分散度（从 demandCurveOf）：
 *   colors    = 颜色数
 *   spanAvg   = 每色需求窗口（末次-首次进度）的均值
 *   activeAvg = 30~80% 区间平均“同时在推进的颜色数”
 *
 * 只读。
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

const C = 7, BLACK = 11;   // 列固定 7（通道数可比），行按车数扩
const files = process.argv.slice(2).filter(function (x) { return /\.json$/.test(x); });
if (!files.length) { console.error('用法：node 原型H_换图.js <关卡json...>'); process.exit(1); }

function skeleton(k, R) {
  const cells = [];
  for (let r = 0; r < R; r++) { cells.push([]); for (let c = 0; c < C; c++) cells[r].push(null); }
  for (let c = 1; c < C; c++) cells[0][c] = { t: 'black' };
  for (let c = 1; c <= k && c < C; c++) cells[1][c] = { t: 'black' };
  let left = (BLACK - (C - 1)) - k;
  for (let c = 0; c < C && left > 0; c++) { cells[R - 1][c] = { t: 'black' }; left--; }
  let pipeSet = false;
  for (let r = R - 2; r <= R - 1 && !pipeSet; r++) for (let c = 0; c < C; c++) {
    if (!cells[r][c]) { cells[r][c] = { t: 'pipe', dir: 12, queue: [] }; pipeSet = true; break; }
  }
  return cells;
}

function buildBoard(cells, order, R) {
  const out = cells.map(function (row) { return row.map(function (c) { return c ? JSON.parse(JSON.stringify(c)) : null; }); });
  const slots = [];
  for (let r = 0; r < out.length; r++) for (let c = 0; c < C; c++) if (!out[r][c]) slots.push([r, c]);
  slots.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
  const n = Math.min(slots.length, order.length);
  for (let i = 0; i < n; i++) {
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

function demandStats(dc) {
  const cols = Object.keys(dc.curve || {});
  if (!cols.length) return null;
  const spans = [];
  for (const c of cols) {
    const arr = dc.curve[c]; if (!arr || !arr.length) continue;
    spans.push(arr[arr.length - 1][1] - arr[0][1]);
  }
  const B = 10, counts = new Array(B).fill(0);
  for (const c of cols) {
    const arr = dc.curve[c]; if (!arr) continue;
    for (const p of arr) {
      if (p[1] < 0.30 || p[1] > 0.80) continue;
      const b = Math.min(B - 1, Math.floor((p[1] - 0.30) / 0.50 * B));
      counts[b]++;
    }
  }
  return {
    colors: cols.length,
    spanAvg: spans.length ? spans.reduce(function (a, b) { return a + b; }, 0) / spans.length : 0,
    activeAvg: counts.reduce(function (a, b) { return a + b; }, 0) / B,
  };
}

console.log('骨架：列固定 7，行按车数扩；黑 11，管 1；第 0 行 1 入口');
console.log('');
console.log('图'.padEnd(24) + '车 色 span active | k=0   1     2     3     4     5   | 最优k');

for (const f of files) {
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  const blocks = j.blocks;
  const dc = G.demandCurveOf(blocks);
  const st = demandStats(dc);
  const cars = [];
  for (let r = 0; r < j.board.rows; r++) for (let c = 0; c < j.board.cols; c++) {
    const cell = j.board.cells[r][c];
    if (cell.t === 'box') cars.push({ color: cell.color, count: cell.count });
    else if (cell.t === 'pipe') for (const q of (cell.queue || [])) cars.push({ color: q.color, count: q.count });
  }
  for (const car of cars) car.tau = G.demandAt(dc, car.color, car.count);
  const arr = cars.slice().sort(function (a, b) { return a.tau - b.tau; });
  const first = arr[arr.length - 1];
  const order = [first].concat(arr.slice(0, arr.length - 1));
  const row = [];
  const R = Math.ceil((cars.length + BLACK + 1) / C);
  for (let k = 0; k <= 5; k++) {
    const bd = buildBoard(skeleton(k, R), order, R);
    let res; try { res = A.Solver.solve(A.parseLevel({ blocks: blocks, bufferLimit: 5, board: bd }), { capturePreviewStats: true }); } catch (e) { res = null; }
    const q = res ? band3Of(res) : null;
    row.push(q && q.solved ? q.band3 : null);
  }
  let best = -1, bestK = -1;
  row.forEach(function (v, i) { if (v != null && v > best) { best = v; bestK = i; } });
  const name = path.basename(f, '.json');
  console.log(name.padEnd(24) + String(cars.length).padStart(2) + ' ' + String(st.colors).padStart(2) + ' ' +
    st.spanAvg.toFixed(2) + ' ' + st.activeAvg.toFixed(2) + ' | ' +
    row.map(function (v) { return String(v == null ? '-' : v).padEnd(5); }).join(' ') + ' | ' + bestK + ' (' + best + '%)');
}
