#!/usr/bin/env node
/**
 * P5：目标车数规划器（单旋钮实验）。
 *
 * 思路（用户 2026-10-25）：先定车数 N，其余全部推导——
 *   平均容量 = 总像素 / N；黑块 = 格数 − N；棋盘 = 满足 ≥6 且 格数 ≤ N/0.85 的最小合法盘。
 * 本工具只做"算规划 + 用规划生成 + 量结果"，不改生产默认。
 *
 * 用法：
 *   node 03_工具/好关评分/P5_车数规划.js [--black 15] [--seed 1001,1002]
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '完整主bin快照_20261012', 'bin', 'js');
const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js', 'playersim.js', 'analysis.js', 'generator.js'];
const sandbox = { console: { log() { }, warn() { }, error() { } }, module: { exports: {} }, WeakMap, Map, Set, setTimeout, clearTimeout, Infinity, Math, JSON, Date };
vm.createContext(sandbox);
for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BIN, f), 'utf8'), sandbox, { filename: f });
const A = sandbox.AntSolver, G = A.Generator;

function arg(name, def) { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : def; }
const BLACK_MAX = parseInt(arg('black', '15'), 10);
const SEEDS = String(arg('seed', '1001,1002')).split(',').map(Number);
const TOL = parseInt(arg('tol', '2'), 10);   // 容量允许偏离带 ±TOL（记录违规数，不隐藏）
const OUT = arg('out', path.join(__dirname, 'P5_车数规划'));

const IMAGES = [
  { id: '006', file: '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_006.txt' },
  { id: '010', file: '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_010.txt' },
  { id: '019', file: '蚂蚁图库/拼接图/拼接图图库/30x30拼接图纸_019.txt' }
];
const BOARDS = [[6, 6], [6, 7], [6, 8], [7, 8], [7, 7], [8, 9]];

function plan(blocks, blackMax) {
  const by = {};
  let P = 0;
  for (const row of blocks) for (const v of row) if (v > 0) { by[v] = (by[v] || 0) + 1; P++; }
  const band = G.deriveCapacityBand(blocks);
  const L = band.band[0], U = band.band[1];
  const colors = Object.keys(by).map(Number);
  const mid = (L + U) / 2;
  // 单旋钮：车数先由"容量带中间值"决定（N0 = P / mid）；若该车数撑不出 ≤黑块目标 的合法棋盘，再上调到最小可行车数。
  const N0 = Math.max(1, Math.round(P / mid));
  function pickBoard(N) {
    const cap = Math.floor(N / (1 - blackMax / 100));
    return BOARDS
      .map(([r, c]) => ({ r, c, cells: r * c }))
      .filter(b => b.cells >= N && b.cells <= cap)
      .sort((a, b) => a.cells - b.cells)[0] || null;
  }
  let N = N0, board = pickBoard(N);
  while (!board && N < P) { N++; board = pickBoard(N); }
  if (!board) return null;
  // 每色车数：按平均拿，再修到总和 = N
  const avg = P / N;
  const info = colors.map(c => ({ c, Pc: by[c], n: Math.max(1, Math.round(by[c] / avg)) }));
  let sum = info.reduce((s, x) => s + x.n, 0), guard = 0;
  while (sum !== N && guard++ < 400) {
    if (sum < N) {
      const cand = info.slice().sort((a, b) => (b.Pc / b.n) - (a.Pc / a.n))[0];
      cand.n++; sum++;
    } else {
      const cand = info.filter(x => x.n > 1).sort((a, b) => (a.Pc / a.n) - (b.Pc / b.n))[0];
      if (!cand) break; cand.n--; sum--;
    }
  }
  if (sum !== N) return null;
  const cars = []; let outOfBand = 0;
  for (const x of info) {
    const base = Math.floor(x.Pc / x.n), rem = x.Pc % x.n;
    for (let i = 0; i < x.n; i++) {
      const cnt = base + (i < rem ? 1 : 0);
      if (cnt < L || cnt > U) outOfBand++;
      cars.push({ color: x.c, count: cnt });
    }
  }
  return { N, N0, L, U, avg: +avg.toFixed(1), board, cars, total: P,
    black: board.cells - N, blackPct: Math.round((board.cells - N) / board.cells * 100),
    capMin: Math.min.apply(null, cars.map(x => x.count)), capMax: Math.max.apply(null, cars.map(x => x.count)),
    outOfBand };
}

const rows = [];
for (const img of IMAGES) {
  const blocks = G.blocksFromTXT(fs.readFileSync(path.join(ROOT, img.file), 'utf8'));
  const pl = plan(blocks, BLACK_MAX);
  if (!pl) { rows.push({ id: img.id, plan: null }); console.log(img.id, '无可行规划'); continue; }
  for (const seed of SEEDS) {
    const cfg = {
      seed, generatorFlow: 'new_fixed',
      boxSizeMin: pl.L, boxSizeMax: pl.U,
      forcedBoxes: pl.cars,
      boardRowsMin: pl.board.r, boardRowsMax: pl.board.r,
      boardColsMin: pl.board.c, boardColsMax: pl.board.c,
      boardHardRange: true, boardAllowSquare: true,
      // 棋盘按"车数 / 格数"的目标填充率锁死（默认 0.86 会把 35 车顶到 6×7）
      usableSpaceTarget: Math.min(0.98, +(pl.N / (pl.board.r * pl.board.c)).toFixed(3)),
      candidateCount: 1, timeBudgetMs: 12000, fullTime: true, acceptMode: 'target'
    };
    const t0 = Date.now();
    let r = null, err = null;
    try { r = G.produce(blocks, cfg); } catch (e) { err = e && e.message; }
    const ms = Date.now() - t0;
    let rec = { id: img.id, seed, plan: { N: pl.N, board: pl.board.r + 'x' + pl.board.c, blackPct: pl.blackPct, outOfBand: pl.outOfBand, L: pl.L, U: pl.U }, ms, err };
    if (r && r.level) {
      const ce = A.Quality.capacityEvidence(A.parseLevel(r.level), { boxSizeMin: pl.L, boxSizeMax: pl.U });
      const q = A.Quality.fromGeneration(r);
      let black = 0, cells = (r.level.board.rows || 0) * (r.level.board.cols || 0);
      for (let rr = 0; rr < r.level.board.rows; rr++) for (let cc = 0; cc < r.level.board.cols; cc++) {
        const cell = r.level.board.cells[rr][cc]; if (cell && cell.t === 'black') black++;
      }
      Object.assign(rec, {
        valid: !!r.valid, gate: !!q.gatePass, reasons: q.gateReasons,
        board: ce.rows + 'x' + ce.cols, cars: ce.cars,
        capMin: ce.minCap, capMax: ce.maxCap, belowMin: ce.belowMin, aboveMax: ce.aboveMax, conserved: ce.conserved,
        blackPct: cells ? Math.round(black / cells * 100) : null,
        freeLowPct: r.goodV3 && r.goodV3.fillCurve ? r.goodV3.fillCurve.freeLowPct : null,
        freeRunMax: r.goodV3 && r.goodV3.fillCurve ? r.goodV3.fillCurve.freeRunMax : null
      });
    } else {
      rec.valid = false; rec.fail = (r && r.lastFailReason) || err || 'no level';
    }
    rows.push(rec);
    console.log(JSON.stringify(rec));
  }
}
fs.writeFileSync(OUT + '.json', JSON.stringify({ generatedAt: new Date().toISOString(), blackMax: BLACK_MAX, tol: TOL, rows }, null, 2) + '\n');
console.log('[out] ' + path.relative(ROOT, OUT + '.json'));
