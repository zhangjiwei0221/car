#!/usr/bin/env node
/**
 * 实验 A3：骨架位置扫描 —— 47% 是稳定高峰还是位置巧合？
 *
 *   node 原型A3_骨架扫描.js <关卡json>
 *
 * 固定：层切车单（33 辆）、6×8=48 格、黑 14、管 1、按到期排序填盘。
 * 变量：入口列 c0（0~7）× 第 1 行封堵 k（0~6）。
 *
 * 只读：不改生产代码、不动版本号。
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
if (!file) { console.error('用法：node 原型A3_骨架扫描.js <关卡json>'); process.exit(1); }
const j = JSON.parse(fs.readFileSync(file, 'utf8'));
const blocks = j.blocks;
const R = 6, C = 8, BLACK = 14, LO = 25, HI = 70;
const DIRS = [[1,0],[-1,0],[0,1],[0,-1]];

/* 洋葱层 + 层切（与 A2 同口径） */
function onionLayers(blocks) {
  const Rr = blocks.length, Cc = blocks[0].length;
  const removed = Array.from({ length: Rr }, function () { return new Array(Cc).fill(false); });
  let total = 0;
  for (let r = 0; r < Rr; r++) for (let c = 0; c < Cc; c++) if (blocks[r][c] > 0) total++;
  let done = 0; const layers = [];
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
      let n = 0; const stack = [[r,c]]; removed[r][c] = true;
      while (stack.length) {
        const cur = stack.pop(); const x = cur[0], y = cur[1]; n++;
        for (const d of DIRS) {
          const nx = x+d[0], ny = y+d[1];
          if (nx>=0 && nx<Rr && ny>=0 && ny<Cc && !removed[nx][ny] && blocks[nx][ny] === col) {
            removed[nx][ny] = true; stack.push([nx,ny]);
          }
        }
      }
      cnt[col] = (cnt[col] || 0) + n; done += n;
    }
    layers.push(cnt);
  }
  return { layers: layers, total: total };
}

function layerCut(blocks) {
  const info = onionLayers(blocks);
  const layers = info.layers, total = info.total;
  const perColor = {};
  layers.forEach(function (L, li) { for (const c in L) (perColor[c] = perColor[c] || {})[li] = L[c]; });
  const final = layers.map(function () { return {}; });
  for (const c in perColor) {
    const d = perColor[c]; const big = {}, small = {};
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
  const layerPx = final.map(function (L) { return Object.keys(L).reduce(function (a, k) { return a + L[k]; }, 0); });
  const cumBefore = [0];
  for (let i = 0; i < layerPx.length; i++) cumBefore.push(cumBefore[i] + layerPx[i]);
  const cars = [];
  final.forEach(function (L, li) {
    for (const c of Object.keys(L).sort(function (a, b) { return L[b] - L[a]; })) {
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
  return { cars: cars, total: total };
}

function skeleton(c0, k) {
  const cells = [];
  for (let r = 0; r < R; r++) { cells.push([]); for (let c = 0; c < C; c++) cells[r].push(null); }
  for (let c = 0; c < C; c++) if (c !== c0) cells[0][c] = { t: 'black' };
  for (let i = 0; i < k; i++) cells[1][(c0 + 1 + i) % C] = { t: 'black' };
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
  let tot = 0, ge = 0;
  for (const s of ps) {
    const pr = tb ? s.done / tb : 0;
    if (pr < 0.30 || pr > 0.80) continue;
    tot++; if (s.buf >= 3) ge++;
  }
  return tot ? Math.round(ge / tot * 100) : null;
}

const L = layerCut(blocks).cars.slice().sort(function (a, b) { return a.due - b.due; });
console.log('层切车单：' + L.length + ' 辆，到期 ' + L[0].due.toFixed(2) + '~' + L[L.length-1].due.toFixed(2));
console.log('扫描：入口列 c0=0~7 × 封堵 k=0~6，共 56 种');
console.log('');
process.stdout.write('c0\\k ');
for (let k = 0; k <= 6; k++) process.stdout.write(String(k).padStart(5));
console.log();
const hits = [];
for (let c0 = 0; c0 < C; c0++) {
  process.stdout.write(' ' + String(c0).padEnd(4));
  for (let k = 0; k <= 6; k++) {
    const bd = buildBoard(skeleton(c0, k), L);
    let r = null;
    try { r = A.Solver.solve(A.parseLevel({ blocks: blocks, bufferLimit: 5, board: bd }), { capturePreviewStats: true }); } catch (e) {}
    const v = r && r.completed ? band3Of(r) : null;
    if (v != null && v >= 45) hits.push({ c0: c0, k: k, v: v });
    process.stdout.write(String(v == null ? '-' : v).padStart(5));
  }
  console.log();
}
console.log('');
console.log('≥45% 的组合：' + hits.length + '/56');
for (const h of hits.sort(function (a, b) { return b.v - a.v; }).slice(0, 12)) {
  console.log('  入口列 ' + h.c0 + '  封堵 ' + h.k + '  → ' + h.v + '%');
}
const vals = [];
for (let c0 = 0; c0 < C; c0++) for (let k = 0; k <= 6; k++) { /* 已跑过，不重复 */ }
