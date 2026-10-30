#!/usr/bin/env node
/** v596：验证 debtEvery 在 shortDebt/mixedDebt 下的接线，并比较 3/5。 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '游戏主bin', 'bin', 'js');
const INPUT = path.join(ROOT, '关卡', '关卡00199_原图039-056-023-038_分图3色_40x40.txt');
const OUT = path.join(__dirname, '债务间隔_v596.json');
const LEVEL_DIR = path.join(__dirname, '债务间隔_v596.levels');
const FILES = [
  'utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js',
  'playersim.js', 'analysis.js', 'car-sequencer.js', 'solver-analysis.js',
  'experience-goal.js', 'capacity-tuner.js', 'instant-playout.js', 'generator.js',
  'source-preflight.js'
];

function load() {
  const sb = {
    console: { log() {}, warn() {}, error() {} },
    module: { exports: {} },
    WeakMap, Map, Set, Date, Math, JSON, setTimeout, clearTimeout, Infinity
  };
  vm.createContext(sb);
  for (const f of FILES) {
    vm.runInContext(fs.readFileSync(path.join(BIN, f), 'utf8'), sb, { filename: f });
  }
  return sb.AntSolver;
}

const A = load();
const G = A.Generator;
const blocks = G.blocksFromTXT(fs.readFileSync(INPUT, 'utf8'));
const ARMS = [
  { id: 'shortDebt-d3', policy: 'shortDebt', debtEvery: 3 },
  { id: 'shortDebt-d5', policy: 'shortDebt', debtEvery: 5 },
  { id: 'mixedDebt-d3', policy: 'mixedDebt', debtEvery: 3 },
  { id: 'mixedDebt-d5', policy: 'mixedDebt', debtEvery: 5 }
];

function configFor(arm) {
  return {
    seed: 1001, generatorFlow: 'new_fixed', ruleMode: 'instantChain', instantChain: true,
    bottomOnly: false, elimOrder: 'instant', instantPlanPolicy: arm.policy,
    instantPlanTargetBuffer: 3, instantPlanMaxDebt: 40, instantPlanDebtEvery: arm.debtEvery,
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
    pipeFloorCount: 0, pipeFloorDepth: 0, candidateCount: 1, chokeBranches: 1,
    rounds: 0, maxRetries: 1, boardRowsMin: 7, boardRowsMax: 7,
    boardColsMin: 7, boardColsMax: 7, boardHardRange: true, boardAuto: false,
    boardAllowSquare: true, boardExpandOnOverflow: false, boardFirst: true,
    boardFitGuard: 'warn', boardPrefer7: false, hardBlackMaxPct: 30,
    p7BaseCount: 0, p7Repair: false, trapPost: false, pool: 1,
    semanticObstacles: false, usableSpaceTarget: 0, blackPercent: 0,
    blackAsCapOnly: true, blackPercentCapPct: 0, narrowPath: false,
    icePercent: 0, iceSchedule: false, chainCount: 0, questionPercent: 0,
    experienceGoal: false, acceptMode: 'time', timeBudgetMs: 30000,
    localSwapRepair: false, capacityTuneMs: 0,
    maxDecisionStates: 8, stateSampleMode: 'midStratified', minReleaseAmplitude: 2
  };
}

function leftmostFreeSlot(s) {
  const used = {};
  for (const b of s.buffer || []) if (b.slot != null) used[b.slot] = 1;
  for (let i = 0; i < s.bufferLimit; i++) if (!used[i]) return i;
  return -1;
}

function slotStartCoord(slot, rows, cols, bufferLimit) {
  return { r: rows - 1, c: Math.min(cols - 1, Math.floor(slot / bufferLimit * cols)) };
}

function reach(state, color) {
  const slot = leftmostFreeSlot(state);
  if (slot < 0) return null;
  const start = slotStartCoord(slot, state.rows, state.cols, state.bufferLimit);
  const scratch = state.eliminated.map(row => row.slice());
  try {
    return A.Simulator.instantChainEliminate(
      scratch, state.blocks, state.rows, state.cols, color, Infinity, null, start, null
    );
  } catch (e) {
    return null;
  }
}

function scanDebtWindows(level, solveResult) {
  const parsed = A.parseLevel(level);
  const state = A.Simulator.createState(parsed, {
    useSlotStart: true, bottomOnly: false, instantChain: true, capturePreviewStats: false
  });
  const actions = A.SolverAnalysis.normalizeActions(solveResult && solveResult.pickOrder);
  const windows = [], candidates = {}, seenCell = {};
  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    const progress = state.totalPixels ? state.eliminatedPixels / state.totalPixels : 0;
    const moves = A.Simulator.listMoves(state).filter(m => !m.blocked);
    const opts = moves.map(m => {
      const color = m.antBox ? m.antBox.color : m.color;
      const capacity = m.antBox ? m.antBox.count : m.count;
      const actualReach = reach(state, color);
      return {
        r: m.r, c: m.c, color, capacity, actualReach,
        actualDebt: actualReach == null ? null : capacity - actualReach,
        canConsume: !!m.canConsume
      };
    });
    const debts = opts.filter(o => o.actualDebt >= 2 && o.actualDebt <= 4 &&
      !o.canConsume && progress >= 0.2 && progress <= 0.8);
    if (debts.length) {
      windows.push({
        step: i + 1, progress: +progress.toFixed(4), buffer: state.buffer.length,
        fullSupplyCount: opts.filter(o => o.canConsume).length, debts,
        chosen: opts.find(o => o.r === action.r && o.c === action.c)
      });
      for (const debt of debts) {
        const key = debt.r + ',' + debt.c;
        if (!seenCell[key]) {
          seenCell[key] = 1;
          candidates[key] = Object.assign({ firstStep: i + 1, progress: +progress.toFixed(4) }, debt);
        }
      }
    }
    A.Simulator.applyPick(state, action.r, action.c);
  }
  const list = Object.keys(candidates).map(k => candidates[k]).sort((a, b) =>
    a.firstStep - b.firstStep || a.r - b.r || a.c - b.c);
  let minGap = null, pair = null;
  for (let i = 1; i < list.length; i++) {
    const gap = list[i].firstStep - list[i - 1].firstStep;
    if (minGap == null || gap < minGap) {
      minGap = gap;
      pair = [list[i - 1], list[i]];
    }
  }
  return { windows, candidates: list, minGap, pair };
}

function legacySamples(parsed, order) {
  const state = A.Simulator.enter(parsed, { useSlotStart: true });
  const samples = [];
  let lastDone = state.completedBoxes || 0;
  for (const pick of order || []) {
    if (!pick || pick.r == null) continue;
    A.Simulator.applyPick(state, pick.r, pick.c);
    if (state.completedBoxes !== lastDone) {
      lastDone = state.completedBoxes;
      samples.push({ done: lastDone, buf: state.buffer.length });
    }
    if (state.gameOver) break;
  }
  return samples;
}

function auditLevel(level, solveResult) {
  const parsed = A.parseLevel(level);
  const ps = A.PlayerSim.run(parsed, { seed: 7, instantChain: true });
  const omniSamples = legacySamples(parsed, solveResult && solveResult.pickOrder || []);
  const v2 = G.chokeV2Of(parsed, {
    pickOrder: solveResult && solveResult.pickOrder || [],
    pressureSamples: omniSamples
  }, {
    pickOrder: ps && ps.pickOrder || [],
    pressureSamples: ps && ps.pressureSamples || []
  }, true);
  return {
    player: {
      won: !!(ps && ps.won),
      coveragePct: ps && ps.coveragePct,
      pads: ps && ps.pads
    },
    choke: v2,
    violations: v2 ? G.chokeV2Violations(v2.worst) : ['无指标']
  };
}

function obstacleStats(level) {
  return A.Analysis && A.Analysis.obstacleStats
    ? A.Analysis.obstacleStats(A.parseLevel(level)) : null;
}

fs.mkdirSync(LEVEL_DIR, { recursive: true });
const rows = [];
for (const arm of ARMS) {
  const t0 = Date.now();
  const result = G.produceFixed(blocks, configFor(arm));
  const level = result && result.level || null;
  const parsed = level ? A.parseLevel(level) : null;
  const quality = level ? A.Quality.fromGeneration(result) : null;
  const curve = result && result.goodV3 && result.goodV3.fillCurve || null;
  let experience = null;
  if (level && result.solveResult) {
    try {
      experience = A.ExperienceGoal.evaluate(level, {
        solveResult: result.solveResult, decision: true, instantChain: true,
        maxDecisionStates: 8, stateSampleMode: 'midStratified', minReleaseAmplitude: 2
      });
    } catch (e) {
      experience = { error: String(e && e.message || e) };
    }
  }
  const debt = level && result.solveResult ? scanDebtWindows(level, result.solveResult) : null;
  const audit = level && result.solveResult ? auditLevel(level, result.solveResult) : null;
  const levelText = level ? JSON.stringify(level, null, 2) + '\n' : '';
  const levelFile = path.join(LEVEL_DIR, arm.id + '.json');
  const routeFile = path.join(LEVEL_DIR, arm.id + '.route.json');
  if (level) {
    fs.writeFileSync(levelFile, levelText);
    fs.writeFileSync(routeFile, JSON.stringify(result.solveResult && result.solveResult.pickOrder || [], null, 2) + '\n');
  }
  const capacities = [];
  if (parsed) {
    for (const row of parsed.board.cells || []) {
      for (const cell of row || []) {
        if (cell && cell.t === 'box' && cell.count != null) capacities.push(cell.count);
      }
    }
  }
  const row = {
    id: arm.id,
    policy: arm.policy,
    debtEvery: arm.debtEvery,
    valid: !!(result && result.valid && level),
    failReason: result && result.lastFailReason || null,
    board: parsed ? parsed.board.rows + 'x' + parsed.board.cols : null,
    cars: parsed ? parsed.totalBoxes : null,
    capacityMin: capacities.length ? Math.min(...capacities) : null,
    capacityMax: capacities.length ? Math.max(...capacities) : null,
    obstacles: level ? obstacleStats(level) : null,
    levelHash: level ? crypto.createHash('sha256').update(levelText).digest('hex') : null,
    levelFile: level ? path.relative(ROOT, levelFile) : null,
    routeFile: level ? path.relative(ROOT, routeFile) : null,
    debt,
    quality: quality ? { gatePass: !!quality.gatePass, gateReasons: quality.gateReasons || [] } : null,
    curve: curve ? {
      freeLowPct: curve.freeLowPct,
      freeRunMax: curve.freeRunMax,
      fullMedian2: curve.fullMedian2,
      selectMedian: curve.selectMedian,
      pressurePct3: curve.pressurePct3,
      pressurePeak: curve.pressurePeak
    } : null,
    experience: experience && experience.metrics ? {
      maxBuffer: experience.metrics.maxBuffer,
      midBuffer34Pct: experience.metrics.midBuffer34Pct,
      significantReleaseCount: experience.metrics.significantReleaseCount,
      pass: !!experience.pass,
      releaseStatus: experience.releaseDecision && experience.releaseDecision.status || null
    } : null,
    audit,
    elapsedMs: Date.now() - t0
  };
  rows.push(row);
  console.log('[v596]', arm.id, 'valid=' + row.valid,
    'hash=' + (row.levelHash || '').slice(0, 12),
    'debt=' + (debt ? debt.candidates.length : 0),
    'gap=' + (debt ? debt.minGap : null),
    'maxBuffer=' + (row.experience && row.experience.maxBuffer),
    'violations=' + (audit ? audit.violations.join('|') : '-'),
    'ms=' + row.elapsedMs);
}

function arm(id) {
  return rows.find(x => x.id === id) || null;
}
function compactRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    policy: row.policy,
    debtEvery: row.debtEvery,
    valid: row.valid,
    levelHash: row.levelHash,
    board: row.board,
    cars: row.cars,
    obstacles: row.obstacles,
    debtCandidates: row.debt ? row.debt.candidates.length : null,
    firstDebtProgress: row.debt && row.debt.candidates.length ? row.debt.candidates[0].progress : null,
    minGap: row.debt && row.debt.minGap,
    maxBuffer: row.experience && row.experience.maxBuffer,
    midBuffer34Pct: row.experience && row.experience.midBuffer34Pct,
    significantReleaseCount: row.experience && row.experience.significantReleaseCount,
    releaseStatus: row.experience && row.experience.releaseStatus,
    curve: row.curve,
    violations: row.audit && row.audit.violations
  };
}

const s3 = arm('shortDebt-d3'), s5 = arm('shortDebt-d5');
const m3 = arm('mixedDebt-d3'), m5 = arm('mixedDebt-d5');
const report = {
  schema: 'debt-every-wiring-v596',
  date: '2026-10-27',
  input: path.relative(ROOT, INPUT),
  seed: 1001,
  scope: 'only instantPlanPolicy/instantPlanDebtEvery changed; no obstacles',
  summary: {
    valid: rows.filter(x => x.valid).length,
    shortDebtSameHash: !!(s3 && s5 && s3.levelHash && s3.levelHash === s5.levelHash),
    mixedDebtSameHash: !!(m3 && m5 && m3.levelHash && m3.levelHash === m5.levelHash),
    hashes: rows.map(x => ({ id: x.id, hash: x.levelHash })),
    arms: rows.map(compactRow),
    bestByMaxBuffer: compactRow(rows.slice().sort((a, b) =>
      ((b.experience && b.experience.maxBuffer) || 0) -
      ((a.experience && a.experience.maxBuffer) || 0))[0] || null),
    earliestDebt: rows.map(x => ({
      id: x.id,
      firstProgress: x.debt && x.debt.candidates.length ? x.debt.candidates[0].progress : null,
      minGap: x.debt && x.debt.minGap,
      candidates: x.debt ? x.debt.candidates.length : null
    }))
  },
  rows
};

fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ out: path.relative(ROOT, OUT), summary: report.summary }, null, 2));
