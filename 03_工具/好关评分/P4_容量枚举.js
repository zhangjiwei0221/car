#!/usr/bin/env node
/**
 * P4/E4：容量组合静态可行性枚举（只读，不生成关卡）。
 *
 * 目的：在"生成"之前先回答——这张图有没有任何「车数 × 容量」组合能同时满足：
 *   ① 每色可精确拆：n_c ∈ [ceil(N_c/cmax), floor(N_c/cmin)]
 *   ② 棋盘 ≥6 且黑块 ≤ 给定比例（默认 15%）
 *   ③ 开局"白给车"（Σ floor(开局暴露 / 容量)）≤ 给定上限（默认 2）
 *
 * 这三条正是最近几轮实验反复撞上的约束；静态枚举可以在不跑生成的情况下给出"无解"证据。
 *
 * 用法：
 *   node 03_工具/好关评分/P4_容量枚举.js --black 15 --free 2
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '游戏主bin', 'bin', 'js');
const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js', 'playersim.js', 'analysis.js', 'generator.js'];
const sandbox = { console: { log() { }, warn() { }, error() { } }, module: { exports: {} }, WeakMap, Map, Set, setTimeout, clearTimeout, Infinity, Math, JSON, Date };
vm.createContext(sandbox);
for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BIN, f), 'utf8'), sandbox, { filename: f });
const G = sandbox.AntSolver.Generator, A = sandbox.AntSolver;

function arg(name, def) { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : def; }
const BLACK_MAX = parseInt(arg('black', '15'), 10);
const FREE_MAX = parseInt(arg('free', '2'), 10);   // 仅写入标题，不再当硬过滤（静态白给数与 freeLow 不等价）
const OUT = arg('out', path.join(__dirname, 'P4_枚举'));

const IMAGES = [
  { id: '006', file: '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_006.txt' },
  { id: '好图', file: '实验关/好图_35x35_碎块_20261023.txt' },
  { id: '010', file: '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_010.txt' },
  { id: '007', file: '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_007.txt' }
];
// 允许的棋盘（行列 ≥6，列-行 ∈ [0,2]）
const BOARDS = [[6, 6], [6, 7], [6, 8], [7, 8], [7, 7], [8, 9]];

function colorTotals(blocks) {
  const by = {};
  for (const row of blocks) for (const v of row) if (v > 0) by[v] = (by[v] || 0) + 1;
  return by;
}
function openingExposure(blocks) {
  const R = blocks.length, C = blocks[0].length;
  const exp = G.openingExposure(blocks, R, C, false);
  const E = {};
  if (exp && exp.detail) for (const d of exp.detail) E[d.color] = d.px;
  return { E, colors: exp && exp.detail ? exp.detail.length : 0, total: exp && exp.detail ? exp.detail.reduce((s, d) => s + d.px, 0) : 0 };
}

function analyze(img) {
  const blocks = G.blocksFromTXT(fs.readFileSync(path.join(ROOT, img.file), 'utf8'));
  const by = colorTotals(blocks);
  const band = G.deriveCapacityBand(blocks);
  const lo = band.lo, hi = band.hi;
  const { E, colors: openingColors, total: openingPx } = openingExposure(blocks);
  const totals = Object.keys(by).map(k => by[k]);

  const feasible = (a, b) => totals.every(N => Math.ceil(N / b) <= Math.floor(N / a));
  const carsMin = (b) => totals.reduce((s, N) => s + Math.ceil(N / b), 0);
  const carsMax = (a) => totals.reduce((s, N) => s + Math.floor(N / a), 0);
  const freeAt = (cap) => Object.keys(E).reduce((s, c) => s + Math.floor(E[c] / cap), 0);

  const combos = [];
  for (let a = lo; a <= hi; a++) {
    for (let b = a; b <= hi; b++) {
      if (!feasible(a, b)) continue;
      const cMin = carsMin(b), cMax = carsMax(a);
      for (const [rows, cols] of BOARDS) {
        const cells = rows * cols;
        const carsNeed = Math.ceil(cells * (1 - BLACK_MAX / 100));
        if (cMax < carsNeed || cMin > cells) continue;               // 车数装不进这块板
        // 取可行车数：优先尽量多（黑块更少），但不超过格数
        const cars = Math.min(cMax, cells);
        if (cars < carsNeed) continue;
        // 白给车只作为观测量：真正的门（freeLow）必须模拟才知道，静态白给数只是参考
        const freeLo = freeAt(a), freeHi = freeAt(b);
        const black = cells - cars;
        combos.push({
          cmin: a, cmax: b, cars: cars, carsRange: [cMin, cMax],
          board: [rows, cols], cells: cells, black: black, blackPct: Math.round(black / cells * 100),
          freeAtLo: freeLo, freeAtHi: freeHi
        });
      }
    }
  }
  // 排序：黑块少 → 白给少 → 容量带窄
  combos.sort((x, y) => x.blackPct - y.blackPct || x.freeAtLo - y.freeAtLo || (x.cmax - x.cmin) - (y.cmax - y.cmin));
  // 去重（同棋盘同容量）
  const seen = {}, uniq = [];
  for (const c of combos) {
    const k = c.board.join('x') + '|' + c.cmin + '-' + c.cmax + '|' + c.cars;
    if (seen[k]) continue; seen[k] = 1; uniq.push(c);
  }
  // 在"黑块 ≤ 目标"的组合里挑"白给最少"的那个 —— 这才是真实可用的前沿
  const under = uniq.filter(c => c.blackPct <= BLACK_MAX).sort((x, y) => x.freeAtLo - y.freeAtLo || x.blackPct - y.blackPct);
  const minBlack = uniq.slice().sort((x, y) => x.blackPct - y.blackPct || x.freeAtLo - y.freeAtLo)[0] || null;
  return {
    id: img.id, m: band.m, lo: lo, hi: hi, band: band.band,
    bestFreeUnder15: under[0] || null,
    minBlackCombo: minBlack,
    colors: Object.keys(by).length, openingColors, openingPx,
    colorPx: { max: Math.max.apply(null, totals), min: Math.min.apply(null, totals) },
    // 诊断：为什么没有解
    diag: {
      anyExactSplit: (function () { for (let a = lo; a <= hi; a++) for (let b = a; b <= hi; b++) if (feasible(a, b)) return true; return false; })(),
      carsMinAtHi: carsMin(hi), carsNeedMax15: Math.ceil(36 * (1 - BLACK_MAX / 100)),
      freeAtHi: freeAt(hi), freeAtLo: freeAt(lo)
    },
    feasibleCombos: uniq.length, best: uniq.slice(0, 5)
  };
}

const rows = IMAGES.map(analyze);
fs.writeFileSync(OUT + '.json', JSON.stringify({ generatedAt: new Date().toISOString(), blackMax: BLACK_MAX, freeMax: FREE_MAX, rows: rows }, null, 2) + '\n');

const lines = ['| 图 | m | 容量搜索带 | 色数 | 开局色/px | 可行组合数 | 黑≤目标下白给最少 | 黑最少（对照） |', '|---|---:|---|---:|---|---:|---|---|'];
for (const r of rows) {
  const b = r.bestFreeUnder15;
  const bestTxt = b ? (b.cars + ' 车 · 容量 ' + b.cmin + '~' + b.cmax + ' · ' + b.board.join('×') + ' · 黑' + b.blackPct + '% · 白给' + b.freeAtLo) : '**无可行组合**';
  const mb = r.minBlackCombo;
  const mbTxt = mb ? (mb.cars + '车/黑' + mb.blackPct + '%/白给' + mb.freeAtLo) : '-';
  lines.push('| ' + r.id + ' | ' + r.m + ' | ' + r.lo + '~' + r.hi + ' | ' + r.colors + ' | ' + r.openingColors + '/' + r.openingPx + ' | ' + r.feasibleCombos + ' | ' + bestTxt + ' | ' + mbTxt + ' |');
}
const md = lines.join('\n');
fs.writeFileSync(OUT + '.md', '# P4 容量组合静态枚举（黑块 ≤' + BLACK_MAX + '%、白给 ≤' + FREE_MAX + '）\n\n' + md + '\n');
console.log(md);
for (const r of rows) console.log('[diag]', r.id, JSON.stringify(r.diag));
