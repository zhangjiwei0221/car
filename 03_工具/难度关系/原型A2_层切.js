#!/usr/bin/env node
/**
 * 实验 A2：层切车单（33 辆）× 6×8 通道骨架
 *
 *   node 原型A2_层切.js <关卡json> [--runs 3]
 *
 * 只读：不改生产代码、不动版本号、不写 输出文件/。
 *
 * 两组对照（同一骨架、同一摆位规则，只差车单）：
 *   L 层切车单：按（依赖层 × 颜色）切，统一上限 70，小层并入同色最大层
 *   N 现值车单：直接读关卡里的 30 辆
 *
 * 骨架 6×8=48：黑 14，管 1，车格 33
 *   第 0 行：1 入口 + 7 黑
 *   第 1 行：k 黑（k = 中段封堵强度）
 *   第 5 行：剩余 6−k 黑
 *   车按「到期」升序、行优先填
 *
 * 到期 = (该层之前的累计像素 + 该层内偏移) / 总彩色像素
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
if (!file) { console.error('用法：node 原型A2_层切.js <关卡json> [--runs 3]'); process.exit(1); }
const ri = process.argv.indexOf('--runs'); const RUNS = ri > 0 ? (parseInt(process.argv[ri + 1], 10) || 3) : 3;

const j = JSON.parse(fs.readFileSync(file, 'utf8'));
const blocks = j.blocks;
const dc = G.demandCurveOf(blocks);
const R = 6, C = 8, BLACK = 14;
const LO = 25, HI = 70;

/* ---------- 洋葱层 ---------- */
function onionLayers(blocks) {
  const Rr = blocks.length, Cc = blocks[0].length;
  const removed = Array.from({ length: Rr }, function () { return new Array(Cc).fill(false); });
  let total = 0;
  for (let r = 0; r < Rr; r++) for (let c = 0; c < Cc; c++) if (blocks[r][c] > 0) total++;
  let done = 0; const layers = [];
  const DIRS = [[1,0],[-1,0],[0,1],[0,-1]];
  while (done < total && layers.length < 200) {
    const exp = [];
    for (let r = 0; r < Rr; r++) for (let c = 0; c < Cc; c++) {
      if (blocks[r][c] <= 0 || removed[r][c]) continue;
      if (r === 0 || r === Rr-1 || c === 0 || c === Cc-1) { exp.push([r,c]); continue; }
      for (const d of DIRS) {
        const nr = r+d[0], nc = c+d[1];
        if (nr>=0 && nr<Rr && nc>=0 && nc<Cc && removed[nr][nc]) { exp.push([r,c]); break; }
      }
    }
    if (!exp.length) break;
    const cnt = {};
    for (const p of exp) {
      const r = p[0], c = p[1];
      if (removed[r][c]) continue;
      const col = blocks[r][c];
      let n = 0;
      const stack = [[r, c]];
      removed[r][c] = true;
      while (stack.length) {
        const cur = stack.pop();
        const x = cur[0], y = cur[1];
        n++;
        for (const d of DIRS) {
          const nx = x + d[0], ny = y + d[1];
          if (nx >= 0 && nx < Rr && ny >= 0 && ny < Cc && !removed[nx][ny] && blocks[nx][ny] === col) {
            removed[nx][ny] = true; stack.push([nx, ny]);
          }
        }
      }
      cnt[col] = (cnt[col] || 0) + n; done += n;
    }
    layers.push(cnt);
  }
  return { layers: layers, total: total };
}

/* ---------- 层切车单 ---------- */
function layerCut(blocks) {
  const info = onionLayers(blocks);
  const layers = info.layers, total = info.total;
  // 小层并入同色最大层
  const perColor = {};
  layers.forEach(function (L, li) {
    for (const c in L) { (perColor[c] = perColor[c] || {})[li] = L[c]; }
  });
  const final = layers.map(function () { return {}; });
  for (const c in perColor) {
    const d = perColor[c];
    const big = {}, small = {};
    let tgt = -1, best = -1;
    for (const l in d) { if (d[l] >= LO) { big[l] = d[l]; if (d[l] > best) { best = d[l]; tgt = +l; } } else small[l] = d[l]; }
    if (tgt < 0) {
      let mx = -1, ml = 0;
      for (const l in d) if (d[l] > mx) { mx = d[l]; ml = +l; }
      final[ml][c] = (final[ml][c] || 0) + Object.keys(d).reduce(function (a, k) { return a + d[k]; }, 0);
      continue;
    }
    for (const l in big) final[+l][c] = (final[+l][c] || 0) + big[l];
    for (const l in small) final[tgt][c] = (final[tgt][c] || 0) + small[l];
  }
  // 累计
  const layerPx = final.map(function (L) { return Object.keys(L).reduce(function (a, k) { return a + L[k]; }, 0); });
  const cumBefore = [0];
  for (let i = 0; i < layerPx.length; i++) cumBefore.push(cumBefore[i] + layerPx[i]);
  // 切车
  const cars = [];
  final.forEach(function (L, li) {
    const cols = Object.keys(L).sort(function (a, b) { return L[b] - L[a]; });
    for (const c of cols) {
      const px = L[c];
      let n = Math.max(1, Math.ceil(px / HI));
      while (n > 1 && px / n < LO) n--;
      const base = Math.floor(px / n), rest = px - base * n;
      let off = 0;
      for (let k = 0; k < n; k++) {
        const cnt = base + (k < rest ? 1 : 0);
        off += cnt;
        cars.push({ color: +c, count: cnt, layer: li, due: (cumBefore[li] + off) / total });
      }
    }
  });
  return { cars: cars, layerCount: final.length, total: total };
}

/* ---------- 现值车单 ---------- */
function currentCars() {
  const out = [];
  for (let r = 0; r < j.board.rows; r++) for (let c = 0; c < j.board.cols; c++) {
    const cell = j.board.cells[r][c];
    if (cell.t === 'box') out.push({ color: cell.color, count: cell.count });
    else if (cell.t === 'pipe') for (const q of (cell.queue || [])) out.push({ color: q.color, count: q.count });
  }
  for (const car of out) car.due = G.demandAt(dc, car.color, car.count);
  return out;
}

/* ---------- 骨架 + 填盘 ---------- */
function skeleton(k) {
  const cells = [];
  for (let r = 0; r < R; r++) { cells.push([]); for (let c = 0; c < C; c++) cells[r].push(null); }
  for (let c = 1; c < C; c++) cells[0][c] = { t: 'black' };
  for (let c = 1; c <= k && c < C; c++) cells[1][c] = { t: 'black' };
  let left = (BLACK - (C - 1)) - k;
  for (let c = 0; c < C && left > 0; c++) { cells[R-1][c] = { t: 'black' }; left--; }
  let pipe = false;
  for (let r = R-2; r <= R-1 && !pipe; r++) for (let c = 0; c < C; c++) {
    if (!cells[r][c]) { cells[r][c] = { t: 'pipe', dir: 12, queue: [] }; pipe = true; break; }
  }
  return cells;
}

function buildBoard(cells, order) {
  const out = cells.map(function (row) { return row.map(function (c) { return c ? JSON.parse(JSON.stringify(c)) : null; }); });
  const slots = [];
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) if (!out[r][c]) slots.push([r, c]);
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

/* ---------- 跑 ---------- */
const L = layerCut(blocks);
const N = currentCars();
console.log('关卡：' + path.basename(file) + '　盘 ' + R + 'x' + C + '　黑 ' + BLACK + '　管 1');
console.log('层切车单：' + L.cars.length + ' 辆，' + L.layerCount + ' 层，到期 ' +
  Math.min.apply(null, L.cars.map(function (x) { return x.due; })).toFixed(2) + '~' +
  Math.max.apply(null, L.cars.map(function (x) { return x.due; })).toFixed(2));
console.log('现值车单：' + N.length + ' 辆');
console.log('');
console.log('k   层切:band3 峰 可解 | 现值:band3 峰 可解');

const res = [];
for (let k = 0; k <= 6; k++) {
  const cells = skeleton(k);
  const runOne = function (cars) {
    const order = cars.slice().sort(function (a, b) { return a.due - b.due; });
    const bd = buildBoard(cells, order);
    let r = null;
    try { r = A.Solver.solve(A.parseLevel({ blocks: blocks, bufferLimit: 5, board: bd }), { capturePreviewStats: true }); } catch (e) {}
    return r ? band3Of(r) : null;
  };
  const a = runOne(L.cars), b = runOne(N);
  res.push({ k: k, a: a, b: b });
  console.log(' ' + String(k).padEnd(2) + (a ? (a.band3 + '%').padStart(8) + ' ' + a.peak.toFixed(1) + ' ' + (a.solved ? '✓' : '✗') : '     -      ') +
    ' | ' + (b ? (b.band3 + '%').padStart(8) + ' ' + b.peak.toFixed(1) + ' ' + (b.solved ? '✓' : '✗') : '     -      '));
}
const av = res.map(function (x) { return x.a && x.a.solved ? x.a.band3 : null; }).filter(function (x) { return x != null; });
const bv = res.map(function (x) { return x.b && x.b.solved ? x.b.band3 : null; }).filter(function (x) { return x != null; });
console.log('');
console.log('层切：最优 ' + (av.length ? Math.max.apply(null, av) : '-') + '%　均值 ' + (av.length ? (av.reduce(function (x,y){return x+y;},0)/av.length).toFixed(1) : '-'));
console.log('现值：最优 ' + (bv.length ? Math.max.apply(null, bv) : '-') + '%　均值 ' + (bv.length ? (bv.reduce(function (x,y){return x+y;},0)/bv.length).toFixed(1) : '-'));
