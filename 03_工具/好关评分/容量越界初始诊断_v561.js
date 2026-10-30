#!/usr/bin/env node
/** v561：推荐图/88001 aboveMax 的只读初始诊断。 */
'use strict';

const fs = require('fs'), path = require('path'), vm = require('vm'), cp = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const REL = '02_工程/游戏主bin/bin/js';
const BIN = path.join(ROOT, REL);
const OLD = 'ed468cd';
const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js',
  'playersim.js', 'analysis.js', 'car-sequencer.js', 'solver-analysis.js', 'experience-goal.js',
  'capacity-tuner.js', 'generator.js', 'source-preflight.js'];
const IMAGE = '实验关/已知不可救/推荐_35x35_碎块_20261023.txt';

function loadOld() {
  const sb = {
    console: { log() { }, warn() { }, error() { } }, module: { exports: {} },
    WeakMap, Map, Set, Date, Math, JSON, setTimeout, clearTimeout, Infinity
  };
  vm.createContext(sb);
  for (const f of FILES) {
    const source = (f === 'utils.js' || f === 'generator.js')
      ? cp.execFileSync('git', ['show', OLD + ':' + REL + '/' + f], {
        cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024
      })
      : fs.readFileSync(path.join(BIN, f), 'utf8');
    vm.runInContext(source, sb, { filename: OLD + '/' + f });
  }
  return sb.AntSolver;
}

function distribution(level) {
  const counts = [];
  const board = level && level.board;
  for (const row of (board && board.cells || [])) {
    for (const cell of row) {
      if (!cell) continue;
      if (cell.t === 'box') counts.push({ color: cell.color, count: cell.count });
      else if (cell.t === 'pipe') {
        for (const b of (cell.queue || [])) counts.push({ color: b.color, count: b.count });
      }
    }
  }
  const byCount = {};
  for (const c of counts) byCount[c.count] = (byCount[c.count] || 0) + 1;
  return {
    cars: counts.length,
    min: counts.length ? Math.min.apply(null, counts.map(function(x) { return x.count; })) : null,
    max: counts.length ? Math.max.apply(null, counts.map(function(x) { return x.count; })) : null,
    over19: counts.filter(function(x) { return x.count > 19; }),
    byCount
  };
}

function main() {
  const A = loadOld();
  const G = A.Generator;
  const blocks = G.blocksFromTXT(fs.readFileSync(path.join(ROOT, IMAGE), 'utf8'));
  const band = G.deriveCapacityBand(blocks);
  const cfg = {
    seed: 88001,
    goalPerRoundMs: 20000,
    goalMaxMs: 45000,
    goalMaxRounds: 0,
    goalSharedBudget: true,
    experienceGoal: true,
    reviewMix: true,
    generatorFlow: 'new_fixed',
    boxSizeMin: band.band[0],
    boxSizeMax: band.band[1],
    capNormMin: band.band[0],
    capNormMax: band.band[1],
    capScalePlan: [1.45, 1.15],
    cutMode: 'layerCut2',
    candidateCount: 3,
    fullTime: true,
    portfolioK: 1,
    acceptMode: 'target',
    targetPeakMin: 3.2,
    targetPeakMax: 4.8,
    targetSteadyMin: 0,
    targetSteadyMax: 100,
    targetBand3Min: 0,
    targetBand4Min: 0,
    targetPlayerPassMin: 0.25,
    boardAllowSquare: true,
    boardRowsMin: 6,
    boardRowsMax: 9,
    boardColsMin: 6,
    boardColsMax: 11,
    boardHardRange: true,
    boardAuto: false,
    capacityTuneMs: 5000,
    capacityTuneCars: 8,
    capacityTuneVariants: 48
  };

  const t0 = Date.now();
  const r = G.produceGoal(blocks, cfg);
  const wallMs = Date.now() - t0;
  const cfg2 = r && r.config || cfg;
  const evidence = r && r.level ? A.Quality.capacityEvidence(r.level, cfg2) : null;
  const out = {
    schema: 'capacity-lineage-initial-v561',
    oldCommit: OLD,
    image: IMAGE,
    seed: 88001,
    wallMs,
    valid: !!(r && r.valid),
    stop: r && r.goalStopReason || null,
    rounds: r && r.goalRounds || null,
    capScale: r && r.capScale != null ? r.capScale : null,
    config: cfg2 ? {
      boxSizeMin: cfg2.boxSizeMin,
      boxSizeMax: cfg2.boxSizeMax,
      capNormMin: cfg2.capNormMin,
      capNormMax: cfg2.capNormMax,
      userCapMin: cfg2._userCapMin,
      userCapMax: cfg2._userCapMax,
      capScale: cfg2._capScale,
      structScale: cfg2._structScale,
      cutMode: cfg2.cutMode,
      seed: cfg2.seed
    } : null,
    evidence,
    distribution: r && r.level ? distribution(r.level) : null,
    capacityTune: r && r.capacityTune || null,
    boardDiagnostics: r && r.level && r.level.board ? {
      chokeBigBox: r.level.board._chokeBigBox || null,
      chokeInflate: r.level.board._chokeInflate || null
    } : null,
    chokePlan: r && r.chokePlan || null,
    chokeStat: r && r.chokeStat || null,
    chokeMarks: r && r.chokeMarks || null,
    rescue: r && r.rescue || null,
    p7: r && r.p7 || null,
    trapPost: r && r.trapPost || null,
    usableSpaceRepair: r && r.usableSpaceRepair || null,
    fallback: r ? {
      fallback: !!r.fallback,
      tier: r.fallbackTier,
      type: r.fallbackType,
      reason: r.fallbackReason
    } : null,
    goalBudget: r && r.goalBudgetEvidence || null,
    trace: cfg2 && cfg2._trace || null
  };
  const outPath = path.join(__dirname, '容量越界初始诊断_v561.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');
  console.log(JSON.stringify(out, null, 2));
}

main();
