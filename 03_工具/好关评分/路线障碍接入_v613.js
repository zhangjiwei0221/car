#!/usr/bin/env node
/** v613：验证网页生产侧路线障碍开关的默认关闭保护与开启后真实出关。 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '完整主bin快照_20261012', 'bin', 'js');
const INPUT = path.join(ROOT, '关卡', '关卡00199_原图039-056-023-038_分图3色_40x40.txt');
const OUT = path.join(__dirname, '路线障碍接入_v613.json');
const LEVEL_DIR = path.join(__dirname, '路线障碍接入_v613.levels');
const FILES = [
  'utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js',
  'playersim.js', 'analysis.js', 'car-sequencer.js', 'solver-analysis.js',
  'experience-goal.js', 'capacity-tuner.js', 'instant-playout.js', 'generator.js',
  'route-obstacle-planner.js', 'source-preflight.js'
];

function load(generatorSource) {
  const sb = {
    console: { log() {}, warn() {}, error() {} },
    module: { exports: {} },
    WeakMap, Map, Set, Date, Math, JSON, setTimeout, clearTimeout, Infinity
  };
  vm.createContext(sb);
  for (const f of FILES) {
    const src = f === 'generator.js' && generatorSource
      ? generatorSource
      : fs.readFileSync(path.join(BIN, f), 'utf8');
    vm.runInContext(src, sb, { filename: f });
  }
  return sb.AntSolver;
}

function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function config(routeObstaclePlan) {
  const cfg = {
    seed: 1001, generatorFlow: 'new_fixed', ruleMode: 'instantChain', instantChain: true,
    bottomOnly: false, elimOrder: 'instant', instantPlanPolicy: 'shortDebt',
    instantPlanTargetBuffer: 3, instantPlanMaxDebt: 40, instantPlanDebtEvery: 4,
    instantPlanBranchCount: 0, boxSizeMin: 6, boxSizeMax: 40, capNormMin: 6, capNormMax: 40,
    capacityMix: {
      enabled: true, rows: 7, cols: 7, blackCells: 0,
      smallMax: 18, anchorRatio: 0.3, queueOrder: 'desc',
      gatePlan: {
        enabled: true, row: 1, anchorCars: 5, anchorMinCap: 32, minDebt: 1,
        cells: [[1,1],[1,2],[1,3],[1,4],[1,5]]
      }
    },
    targetCarCount: 49, cutMode: 'exposeCut', maxPipes: 0, minPipes: 0,
    candidateCount: 1, chokeBranches: 1, rounds: 0, maxRetries: 1,
    boardRowsMin: 7, boardRowsMax: 7, boardColsMin: 7, boardColsMax: 7,
    boardHardRange: true, boardAuto: false, boardAllowSquare: true,
    boardExpandOnOverflow: false, boardFirst: true, boardFitGuard: 'warn',
    hardBlackMaxPct: 30, p7BaseCount: 0, p7Repair: false, trapPost: false,
    semanticObstacles: false, usableSpaceTarget: 0, blackPercent: 0,
    blackAsCapOnly: true, blackPercentCapPct: 0, narrowPath: false,
    icePercent: 0, iceSchedule: false, chainCount: 0, questionPercent: 0,
    experienceGoal: false, acceptMode: 'time', timeBudgetMs: 30000,
    localSwapRepair: false, capacityTuneMs: 0, maxDecisionStates: 8,
    stateSampleMode: 'midStratified', minReleaseAmplitude: 2
  };
  if (routeObstaclePlan) {
    cfg.routeObstaclePlan = 'v1';
    cfg.routeObstaclePlanMaxAttempts = 6;
    cfg.routeObstaclePlanMaxMs = 20000;
    cfg.routeObstaclePlayerSeeds = [7, 1009, 2027];
  }
  return cfg;
}

function experienceOf(result) {
  if (!result || !result.level || !result.solveResult) return null;
  try {
    const ev = A.ExperienceGoal.evaluate(result.level, {
      solveResult: result.solveResult, decision: true, instantChain: true,
      maxDecisionStates: 8, stateSampleMode: 'midStratified', minReleaseAmplitude: 2
    });
    return {
      pass: !!ev.pass,
      reasons: ev.reasons || [],
      metrics: ev.metrics || null,
      releaseDecision: ev.releaseDecision || null
    };
  } catch (e) {
    return { error: String(e && e.message || e) };
  }
}

function summary(result) {
  if (!result || !result.level) return { valid: false, reason: result && result.lastFailReason || 'no-level' };
  const parsed = A.parseLevel(result.level);
  const q = A.Quality.fromGeneration(result);
  const curve = result.goodV3 && result.goodV3.fillCurve || null;
  const capacity = A.Quality.capacityEvidence(result.level, result.config || config(false));
  const players = [7, 1009, 2027].map(seed => {
    const ps = A.PlayerSim.run(parsed, { seed, instantChain: true });
    return { seed, won: !!(ps && ps.won), progress: ps && ps.progress, peak: ps && ps.bufferPeak };
  });
  return {
    valid: !!result.valid,
    board: parsed.board.rows + 'x' + parsed.board.cols,
    cars: parsed.totalBoxes,
    hash: hash(result.level),
    quality: q ? { gatePass: !!q.gatePass, gateReasons: q.gateReasons || [] } : null,
    curve: curve ? {
      freeLowPct: curve.freeLowPct,
      freeRunMax: curve.freeRunMax,
      fullMedian2: curve.fullMedian2,
      pressurePct3: curve.pressurePct3,
      pressurePeak: curve.pressurePeak
    } : null,
    capacity: {
      conserved: capacity && capacity.conserved,
      perColorConserved: capacity && capacity.perColorConserved,
      aboveMax: capacity && capacity.aboveMax,
      belowMin: capacity && capacity.belowMin,
      boardFloorPass: capacity && capacity.boardFloorPass
    },
    experience: experienceOf(result),
    players,
    routeObstaclePlan: result.routeObstaclePlan || null
  };
}

const PRE_INTEGRATION_REF = '74cc317';
const stableGenerator = cp.execFileSync('git', [
  'show',
  PRE_INTEGRATION_REF + ':02_工程/完整主bin快照_20261012/bin/js/generator.js'
], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const ABefore = load(stableGenerator);
const A = load();
const blocks = A.Generator.blocksFromTXT(fs.readFileSync(INPUT, 'utf8'));
fs.mkdirSync(LEVEL_DIR, { recursive: true });

const before = ABefore.Generator.produceFixed(blocks, config(false));
const off = A.Generator.produceFixed(blocks, config(false));
const on = A.Generator.produceFixed(blocks, config(true));
const offFile = path.join(LEVEL_DIR, 'off.json');
const onFile = path.join(LEVEL_DIR, 'on.json');
if (off && off.level) {
  fs.writeFileSync(offFile, JSON.stringify(off.level, null, 2) + '\n');
  fs.writeFileSync(path.join(LEVEL_DIR, 'off.route.json'), JSON.stringify(off.solveResult && off.solveResult.pickOrder || [], null, 2) + '\n');
}
if (on && on.level) {
  fs.writeFileSync(onFile, JSON.stringify(on.level, null, 2) + '\n');
  fs.writeFileSync(path.join(LEVEL_DIR, 'on.route.json'), JSON.stringify(on.solveResult && on.solveResult.pickOrder || [], null, 2) + '\n');
}

const report = {
  schema: 'route-obstacle-integration-v613',
  date: '2026-10-27',
  preIntegrationRef: PRE_INTEGRATION_REF,
  input: path.relative(ROOT, INPUT),
  off: summary(off),
  on: summary(on),
  checks: {
    offMatchesPreIntegration: !!(before && before.level && off && off.level && hash(before.level) === hash(off.level)),
    offHasNoPlanner: !(off && off.routeObstaclePlan),
    onPlannerRan: !!(on && on.routeObstaclePlan && on.routeObstaclePlan.applied),
    onAccepted: !!(on && on.routeObstaclePlan && on.routeObstaclePlan.accepted),
    hashesDiffer: !!(off && on && off.level && on.level && hash(off.level) !== hash(on.level)),
    onPlayersAllWon: !!(on && summary(on).players.every(p => p.won))
  }
};
fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ out: path.relative(ROOT, OUT), checks: report.checks,
  off: report.off, on: report.on }, null, 2));
