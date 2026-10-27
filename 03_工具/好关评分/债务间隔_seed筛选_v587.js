#!/usr/bin/env node
/** v587：同配置四个seed，筛选真实债务候选最接近的7×7基底。 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '完整主bin快照_20261012', 'bin', 'js');
const INPUT = path.join(ROOT, '关卡', '关卡00199_原图039-056-023-038_分图3色_40x40.txt');
const OUT = path.join(__dirname, '债务间隔_seed筛选_v587.json');
const LEVEL_DIR = path.join(__dirname, '债务间隔_seed筛选_v587.levels');
const SEEDS = [1001, 1002, 32677, 88001];
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
  for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BIN, f), 'utf8'), sb, { filename: f });
  return sb.AntSolver;
}

const A = load();
const blocks = A.Generator.blocksFromTXT(fs.readFileSync(INPUT, 'utf8'));

function configFor(seed) {
  return {
    seed, generatorFlow: 'new_fixed', ruleMode: 'instantChain', instantChain: true,
    bottomOnly: false, elimOrder: 'instant', instantPlanPolicy: 'targetBuffer',
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
function reach(state, color, blocks) {
  const slot = leftmostFreeSlot(state);
  if (slot < 0) return null;
  const start = slotStartCoord(slot, state.rows, state.cols, state.bufferLimit);
  const scratch = state.eliminated.map(row => row.slice());
  try {
    return A.Simulator.instantChainEliminate(
      scratch, blocks, state.rows, state.cols, color, Infinity, null, start, null
    );
  } catch (e) { return null; }
}

function scanDebtWindows(level, solveResult) {
  const parsed = A.parseLevel(level);
  const state = A.Simulator.createState(parsed, {
    useSlotStart: true, bottomOnly: false, instantChain: true, capturePreviewStats: false
  });
  const actions = A.SolverAnalysis.normalizeActions(solveResult && solveResult.pickOrder);
  const windows = [], candidates = {}, seenCell = {};
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    const progress = state.totalPixels ? state.eliminatedPixels / state.totalPixels : 0;
    const moves = A.Simulator.listMoves(state).filter(m => !m.blocked);
    const opts = moves.map(m => {
      const color = m.antBox ? m.antBox.color : m.color;
      const cap = m.antBox ? m.antBox.count : m.count;
      const rr = reach(state, color, level.blocks);
      return { r: m.r, c: m.c, color, capacity: cap, actualReach: rr,
        actualDebt: rr == null ? null : cap - rr, canConsume: !!m.canConsume };
    });
    const debts = opts.filter(o => o.actualDebt >= 2 && o.actualDebt <= 4 &&
      !o.canConsume && progress >= 0.2 && progress <= 0.8);
    if (debts.length) {
      windows.push({ step: i + 1, progress: +progress.toFixed(4), buffer: state.buffer.length,
        fullSupplyCount: opts.filter(o => o.canConsume).length, debts,
        chosen: opts.find(o => o.r === a.r && o.c === a.c) });
      for (const d of debts) {
        const k = d.r + ',' + d.c;
        if (!seenCell[k]) {
          seenCell[k] = 1;
          candidates[k] = Object.assign({ firstStep: i + 1, progress: +progress.toFixed(4) }, d);
        }
      }
    }
    A.Simulator.applyPick(state, a.r, a.c);
  }
  const list = Object.keys(candidates).map(k => candidates[k]).sort((x, y) =>
    x.firstStep - y.firstStep || x.r - y.r || x.c - y.c);
  let minGap = null, pair = null;
  for (let i = 1; i < list.length; i++) {
    const gap = list[i].firstStep - list[i - 1].firstStep;
    if (minGap == null || gap < minGap) { minGap = gap; pair = [list[i - 1], list[i]]; }
  }
  return { windows, candidates: list, minGap, pair };
}

const rows = [];
for (const seed of SEEDS) {
  const cfg = configFor(seed);
  const t0 = Date.now();
  const r = A.Generator.produceFixed(blocks, cfg);
  const raw = r && r.level || null;
  const parsed = raw ? A.parseLevel(raw) : null;
  const q = raw ? A.Quality.fromGeneration(r) : null;
  const curve = r && r.goodV3 && r.goodV3.fillCurve || null;
  let exp = null;
  if (raw && r.solveResult) {
    try {
      exp = A.ExperienceGoal.evaluate(raw, {
        solveResult: r.solveResult, decision: true, instantChain: true,
        maxDecisionStates: 8, stateSampleMode: 'midStratified', minReleaseAmplitude: 2
      });
    } catch (e) { exp = { error: String(e && e.message || e) }; }
  }
  const debt = raw && r.solveResult ? scanDebtWindows(raw, r.solveResult) : null;
  const rec = {
    seed, valid: !!(r && r.valid && raw), failReason: r && r.lastFailReason || null,
    board: raw ? raw.board.rows + 'x' + raw.board.cols : null,
    cars: parsed ? parsed.totalBoxes : null, debt,
    quality: q ? { gatePass: !!q.gatePass, gateReasons: q.gateReasons || [] } : null,
    curve: curve ? {
      freeLowPct: curve.freeLowPct, freeRunMax: curve.freeRunMax,
      fullMedian2: curve.fullMedian2, selectMedian: curve.selectMedian,
      pressurePct3: curve.pressurePct3, pressurePeak: curve.pressurePeak
    } : null,
    maxBuffer: exp && exp.metrics ? exp.metrics.maxBuffer : null,
    elapsedMs: Date.now() - t0
  };
  rows.push(rec);
  if (raw) {
    fs.mkdirSync(LEVEL_DIR, { recursive: true });
    fs.writeFileSync(path.join(LEVEL_DIR, seed + '.json'), JSON.stringify(raw, null, 2) + '\n');
    fs.writeFileSync(path.join(LEVEL_DIR, seed + '.route.json'),
      JSON.stringify(r.solveResult && r.solveResult.pickOrder || [], null, 2) + '\n');
  }
  console.log('[v587]', seed, 'valid=' + rec.valid, 'board=' + rec.board,
    'debtCandidates=' + (debt ? debt.candidates.length : 0),
    'minGap=' + (debt ? debt.minGap : null),
    'freeLow=' + (curve && curve.freeLowPct),
    'freeRun=' + (curve && curve.freeRunMax),
    'maxBuffer=' + rec.maxBuffer,
    'ms=' + rec.elapsedMs);
}
const report = {
  schema: 'debt-gap-seed-screen-v587', date: '2026-10-27', seeds: SEEDS, rows,
  summary: {
    valid: rows.filter(x => x.valid).length,
    bySeed: rows.map(x => ({ seed: x.seed, minGap: x.debt && x.debt.minGap,
      debtCandidates: x.debt && x.debt.candidates.length, maxBuffer: x.maxBuffer,
      freeLowPct: x.curve && x.curve.freeLowPct, freeRunMax: x.curve && x.curve.freeRunMax })),
    gapWithin5: rows.filter(x => x.debt && x.debt.minGap != null && x.debt.minGap <= 5)
      .map(x => x.seed)
  }
};
fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ out: path.relative(ROOT, OUT), summary: report.summary }, null, 2));
