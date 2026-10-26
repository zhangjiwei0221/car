#!/usr/bin/env node
/** v567：只读复现多图目标worker，比较portfolioK=1/3在完整UI参数下能否产出候选。 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '完整主bin快照_20261012', 'bin', 'js');
const OUT = path.join(__dirname, '多图目标portfolio探针_v567.json');
const FILES = [
  'utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js',
  'playersim.js', 'analysis.js', 'car-sequencer.js', 'solver-analysis.js',
  'experience-goal.js', 'capacity-tuner.js', 'instant-playout.js', 'generator.js',
  'source-preflight.js'
];
const IMAGES = {
  '006': '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_006.txt',
  '010': '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_010.txt'
};
const KS = [1, 3];

function load() {
  const sb = {
    console: { log() {}, warn() {}, error() {} },
    module: { exports: {} },
    WeakMap, Map, Set, Date, Math, JSON, setTimeout, clearTimeout, Infinity
  };
  vm.createContext(sb);
  for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BIN, f), 'utf8'), sb, { filename: f });
  return sb.AntSolver;
}

function hash(x) {
  return crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
}

function cfgFor(A, blocks, seed, K) {
  const b = A.Generator.deriveCapacityBand(blocks).band;
  return {
    seed,
    generatorFlow: 'new_fixed',
    ruleMode: 'instantChain',
    instantPlanPolicy: 'supply',
    instantPlanTargetBuffer: 4,
    instantPlanMaxDebt: 40,
    instantPlanBranchCount: 2,
    instantPlanBranchDebtRoots: true,
    instantPlanBranchPrefixDebts: 8,
    capScalePlan: [1.45, 1.15],
    boxSizeMin: b[0], boxSizeMax: b[1], capNormMin: b[0], capNormMax: b[1],
    cutMode: 'layerCut2',
    maxPipes: 2,
    chainByDemand: 4,
    iceForceSteps: 0,
    candidateCount: 14,
    portfolioK: K,
    boardRowsMin: 4, boardRowsMax: 6, boardColsMin: 6, boardColsMax: 8,
    boardHardRange: false, boardAuto: false, boardAllowSquare: true,
    boardExpandOnOverflow: true, boardFirst: true, boardFitGuard: 'warn',
    boardPrefer7: true, boardPrefer7Dims: null,
    p7BaseCount: 1, p7Repair: true, trapPost: false, pool: 1,
    semanticObstacles: true, usableSpaceTarget: 0.86,
    blackPercent: 10, narrowPath: true,
    experienceGoal: true, instantReleaseRoute: false,
    goalSharedBudget: true,
    acceptMode: 'target', targetBand3Min: 0, targetBand4Min: 0, targetPlayerPassMin: 0,
    capacityTuneMs: 5000, capacityTuneCars: 8, capacityTuneVariants: 48,
    localSwapRepair: true, localSwapRepairMaxMs: 8000,
    localSwapStage1Pairs: 32, localSwapStage1Ms: 4000,
    localSwapStage2Pairs: 64, localSwapStage2Ms: 4000,
    timeBudgetMs: 20000
  };
}

function main() {
  const A = load();
  const rows = [];
  for (const image of Object.keys(IMAGES)) {
    const blocks = A.Generator.blocksFromTXT(fs.readFileSync(path.join(ROOT, IMAGES[image]), 'utf8'));
    for (const K of KS) {
      const cfg = cfgFor(A, blocks, K === 1 ? 1001 : 1002, K);
      const t0 = Date.now();
      let r = null;
      try { r = A.Generator.produce(blocks, cfg); }
      catch (e) { r = { level: null, valid: false, error: String((e && e.message) || e) }; }
      const level = r && r.level || null;
      const q = level ? A.Quality.fromGeneration(r) : null;
      const plan = r && r.config && r.config._instantPlayoutStat || null;
      const ev = level ? A.ExperienceGoal.evaluate(level, Object.assign({}, cfg, {
        solveResult: r.solveResult, decision: false, instantChain: true
      })) : null;
      rows.push({
        image,
        portfolioK: K,
        seed: cfg.seed,
        valid: !!(r && r.valid),
        levelHash: level ? hash(level) : null,
        board: level ? level.board.rows + 'x' + level.board.cols : null,
        lastFailReason: r && r.lastFailReason || null,
        structurePass: !!(q && q.gatePass),
        gateReasons: q && q.gateReasons || [],
        planPolicy: plan && plan.policy || null,
        planOk: plan && plan.ok,
        planReason: plan && plan.reason || null,
        metrics: ev && ev.metrics || null,
        wallMs: Date.now() - t0
      });
      console.log('[probe]', image, 'K=' + K, 'valid=' + !!(r && r.valid),
        'plan=' + (plan && plan.policy), 'fail=' + (r && r.lastFailReason || '-'),
        'board=' + (level ? level.board.rows + 'x' + level.board.cols : '-'));
    }
  }
  const summary = {
    runs: rows.length,
    K1Valid: rows.filter(x => x.portfolioK === 1 && x.valid).length,
    K3Valid: rows.filter(x => x.portfolioK === 3 && x.valid).length,
    decision: rows.filter(x => x.portfolioK === 1 && x.valid).length > rows.filter(x => x.portfolioK === 3 && x.valid).length
      ? 'portfolioK=1在当前完整配置下能出关而=3不能，应进一步验证是否作为多图目标修复。'
      : '未证明portfolioK=1优于3。'
  };
  fs.writeFileSync(OUT, JSON.stringify({
    schema: 'multi-goal-portfolio-probe-v567',
    date: '2026-10-26',
    summary,
    rows
  }, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
}

main();
