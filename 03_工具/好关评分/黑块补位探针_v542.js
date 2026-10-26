#!/usr/bin/env node
/** v542：7×9上只比较blackPercent=10 vs 0，判断黑块是否由补位造成。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '完整主bin快照_20261012', 'bin', 'js');
const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js',
  'playersim.js', 'analysis.js', 'car-sequencer.js', 'solver-analysis.js', 'experience-goal.js',
  'capacity-tuner.js', 'instant-playout.js', 'generator.js', 'source-preflight.js'];
const IMAGE = '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_007.txt';
const SEEDS = [1001, 1002];
const OUT = path.resolve(ROOT, '03_工具/好关评分/黑块补位探针_v542.json');
function load() {
  const sb = { console: { log() {}, warn() {}, error() {} }, module: { exports: {} },
    WeakMap, Map, Set, Date, Math, JSON, setTimeout, clearTimeout, Infinity };
  vm.createContext(sb);
  for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BIN, f), 'utf8'), sb, { filename: f });
  return sb.AntSolver;
}
function hash(x) { return crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex'); }
function cfgFor(G, blocks, seed, blackPercent) {
  const band = G.deriveCapacityBand(blocks);
  return {
    seed, ruleMode: 'instantChain', generatorFlow: 'new_fixed',
    boxSizeMin: band.band[0], boxSizeMax: band.band[1],
    capNormMin: band.band[0], capNormMax: band.band[1],
    boardRowsMin: 7, boardRowsMax: 7, boardColsMin: 9, boardColsMax: 9,
    boardHardRange: true, boardAuto: false, boardAllowSquare: true, boardFitGuard: 'warn',
    p7BaseCount: 0, p7Repair: false, trapPost: false, pool: 1,
    instantPlanPolicy: 'targetBuffer', instantPlanTargetBuffer: 4,
    instantPlanMaxDebt: 40, instantPlanBranchCount: 2,
    instantPlanBranchDebtRoots: true, instantPlanBranchPrefixDebts: 8,
    blackPercent
  };
}
function blackCount(level) {
  let n = 0;
  for (const row of level.board.cells) for (const x of row) if (x && x.t === 'black') n++;
  return n;
}
function run(A, seed, blackPercent) {
  const G = A.Generator;
  const blocks = G.blocksFromTXT(fs.readFileSync(path.join(ROOT, IMAGE), 'utf8'));
  const cfg = cfgFor(G, blocks, seed, blackPercent);
  const t0 = Date.now();
  let r = null;
  try { r = G.produceFixed(blocks, cfg); }
  catch (e) { r = { level: null, valid: false, error: String((e && e.message) || e) }; }
  const level = r && r.level || null;
  let black = 0, cells = 0, boxes = 0;
  if (level) for (const row of level.board.cells) for (const x of row) {
    cells++;
    if (x && x.t === 'black') black++;
    if (x && x.t === 'box') boxes++;
  }
  const q = level ? A.Quality.fromGeneration(r) : null;
  const ca = level ? A.Quality.capacityEvidence(level, r.config || cfg) : null;
  const hidden = r && r.blackStat || null;
  const rec = {
    seed, blackPercent, wallMs: Date.now() - t0, valid: !!(r && r.valid),
    black, cells, blackPct: cells ? +(black / cells * 100).toFixed(1) : null,
    boxes, blackStat: hidden && {
      plannedTotal: hidden.plannedTotal, actualTotal: hidden.actualTotal,
      surplusFilled: hidden.surplusFilled, wallBlacks: hidden.wallBlacks,
      missing: hidden.missing
    },
    struct: !!(r && r.level && G.goalStructPass(r)),
    freeRunMax: r && r.goodV3 && r.goodV3.fillCurve ? r.goodV3.fillCurve.freeRunMax : null,
    capacity: ca && {
      conserved: ca.conserved, aboveMax: ca.aboveMax, belowMin: ca.belowMin,
      microCars: ca.microCars, boardFloorPass: ca.boardFloorPass
    },
    hash: level ? hash(level) : null
  };
  console.log(JSON.stringify(rec));
  return rec;
}
const A = load();
const rows = [];
for (const seed of SEEDS) for (const p of [10, 0]) rows.push(run(A, seed, p));
const pairs = SEEDS.map(seed => {
  const a = rows.find(x => x.seed === seed && x.blackPercent === 10);
  const b = rows.find(x => x.seed === seed && x.blackPercent === 0);
  return {
    seed,
    blackPct: [a.blackPct, b.blackPct],
    black: [a.black, b.black],
    surplus: [a.blackStat && a.blackStat.surplusFilled, b.blackStat && b.blackStat.surplusFilled],
    freeRun: [a.freeRunMax, b.freeRunMax],
    capacityOk: !!(b.capacity && b.capacity.conserved && b.capacity.aboveMax === 0 &&
      (!b.capacity.microCars || b.capacity.microCars.length === 0)),
    blackPass: b.blackPct != null && b.blackPct <= 17.9
  };
});
const summary = {
  image: '007', seeds: SEEDS, rows: rows.length,
  blackPass: pairs.filter(x => x.blackPass).length,
  blackPct: pairs.map(x => ({ seed: x.seed, from: x.blackPct[0], to: x.blackPct[1] })),
  surplusUnchanged: pairs.filter(x => x.surplus[0] === x.surplus[1]).length,
  capacityRegressions: pairs.filter(x => !x.capacityOk).map(x => x.seed),
  decision: pairs.some(x => x.blackPass)
    ? 'blackPercent=0出现黑块保护信号，需扩大样本后再验证。'
    : 'blackPercent=0未能压到17.9%以下，黑块主要是棋盘补位，回到P0容量/棋盘可行性。'
};
const report = { schema: 'black-fill-probe-v1', date: '2026-10-26',
  preregistration: '黑块补位探针_预登记_v542.md', summary, pairs, rows };
fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ summary, pairs }, null, 2));
if (summary.capacityRegressions.length) process.exitCode = 1;
