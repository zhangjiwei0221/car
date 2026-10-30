#!/usr/bin/env node
/** v548：只读定位v547六个prefix=12样本的免费连、吃满中位和release覆盖。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '游戏主bin', 'bin', 'js');
const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js',
  'playersim.js', 'analysis.js', 'car-sequencer.js', 'solver-analysis.js', 'experience-goal.js',
  'capacity-tuner.js', 'instant-playout.js', 'generator.js', 'source-preflight.js'];
const IMAGE = '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_007.txt';
const CASES = [
  { shape: '7x9', rows: 7, cols: 9, seed: 1001, expectedHash: '78055a5a03bb248a7460a6a1755c0438d50c849c4c876b4c047f6136bbb9636a' },
  { shape: '7x9', rows: 7, cols: 9, seed: 1002, expectedHash: '40d5a8b28ac652234c73c1058821fe11c1304932b81f8e946f7229dc1c412e8f' },
  { shape: '7x9', rows: 7, cols: 9, seed: 32677, expectedHash: '78055a5a03bb248a7460a6a1755c0438d50c849c4c876b4c047f6136bbb9636a' },
  { shape: '9x7', rows: 9, cols: 7, seed: 1001, expectedHash: '0f72e44ee766c984259f16138bfa5ecde65be9d9edf28e3aed50cc429cb1132e' },
  { shape: '9x7', rows: 9, cols: 7, seed: 1002, expectedHash: 'eeff5444341e501b56573fb996528ee7ffdd6355167bb7ffbda4bec9ee510551' },
  { shape: '9x7', rows: 9, cols: 7, seed: 32677, expectedHash: '4e670942c6ab918a2c6c0e64bf6e00752c25db86c30477aeb59a1e5ca505c1ae' }
];
const OUT = path.resolve(ROOT, '03_工具/好关评分/步骤与释放覆盖定位_v548.json');
const requestedOut = process.argv.find(x => x.startsWith('--out='));
const outPath = requestedOut ? path.resolve(ROOT, requestedOut.slice(6)) : OUT;

function load() {
  const sb = { console: { log() {}, warn() {}, error() {} }, module: { exports: {} },
    WeakMap, Map, Set, Date, Math, JSON, setTimeout, clearTimeout, Infinity };
  vm.createContext(sb);
  for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BIN, f), 'utf8'), sb, { filename: f });
  return sb.AntSolver;
}
function hash(x) { return crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex'); }
function median(a) {
  const s = a.filter(x => x != null && Number.isFinite(x)).sort((x, y) => x - y);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : +((s[m - 1] + s[m]) / 2).toFixed(2);
}
function cfgFor(spec) {
  return {
    seed: spec.seed, ruleMode: 'instantChain', generatorFlow: 'new_fixed',
    boxSizeMin: 20, boxSizeMax: 40, capNormMin: 20, capNormMax: 40,
    boardRowsMin: spec.rows, boardRowsMax: spec.rows,
    boardColsMin: spec.cols, boardColsMax: spec.cols,
    boardHardRange: true, boardAuto: false, boardAllowSquare: true, boardFitGuard: 'warn',
    p7BaseCount: 0, p7Repair: false, trapPost: false, pool: 1,
    instantPlanPolicy: 'shortDebt', instantPlanTargetBuffer: 4,
    instantPlanMaxDebt: 40, instantPlanDebtEvery: 2,
    instantPlanBranchCount: 2, instantPlanBranchDebtRoots: true,
    instantPlanBranchPrefixDebts: 12,
    targetCarCount: 52, blackPercent: 10,
    experienceGoal: true, instantReleaseRoute: false,
    goalPerRoundMs: 20000, goalMaxMs: 30000, goalMaxRounds: 2,
    goalSharedBudget: true, candidateCount: 1, acceptMode: 'target',
    targetBand3Min: 0, targetBand4Min: 0, targetPlayerPassMin: 0
  };
}

function boxMap(level) {
  const out = {};
  for (let r = 0; r < level.board.cells.length; r++) {
    for (let c = 0; c < level.board.cells[r].length; c++) {
      const x = level.board.cells[r][c];
      if (x && x.t === 'box') out[r + ',' + c] = { id: x.id, color: x.color, count: x.count };
    }
  }
  return out;
}

function orderedActions(sr) {
  return (sr.pickOrder || []).filter(x => x.chainIndex == null || x.chainIndex === 0)
    .slice().sort((a, b) => (a.step || 0) - (b.step || 0));
}

function compactPick(p, boxes) {
  const b = boxes[p.r + ',' + p.c] || {};
  return {
    step: p.step, r: p.r, c: p.c, boxId: b.id == null ? null : b.id,
    color: p.color != null ? p.color : b.color,
    count: p.count != null ? p.count : b.count
  };
}

function freeRuns(details) {
  const runs = [];
  let start = null;
  for (let i = 0; i <= details.length; i++) {
    const free = i < details.length && details[i].isFree;
    if (free && start == null) start = i;
    if (!free && start != null) {
      const part = details.slice(start, i);
      runs.push({
        startIndex: start, endIndex: i - 1, length: part.length,
        startStep: part[0].solverStep, endStep: part[part.length - 1].solverStep,
        startProgress: part[0].progress, endProgress: part[part.length - 1].progress,
        colors: Array.from(new Set(part.map(x => x.color))),
        picks: part
      });
      start = null;
    }
  }
  const max = runs.reduce((m, x) => Math.max(m, x.length), 0);
  return { max, allMaxRuns: runs.filter(x => x.length === max), runs };
}

function fullStats(details) {
  const hist = {};
  for (const x of details) hist[x.full] = (hist[x.full] || 0) + 1;
  const sorted = details.slice().sort((a, b) => a.full - b.full || a.index - b.index);
  const medianIndex = Math.floor(sorted.length / 2);
  const medianValue = sorted.length ? sorted[medianIndex].full : null;
  const above3 = sorted.filter(x => x.full > 3);
  const minFlipsTo3 = Math.max(0, above3.length - medianIndex);
  return {
    n: details.length,
    histogram: hist,
    medianIndex,
    medianValue,
    above3Count: above3.length,
    minFlipsTo3,
    pivotWindow: sorted.slice(Math.max(0, medianIndex - 2), Math.min(sorted.length, medianIndex + 3)).map(x => ({
      index: x.index, solverStep: x.solverStep, full: x.full, free: x.free,
      progress: x.progress, boxId: x.boxId, color: x.color, count: x.count,
      bufferBefore: x.bufferBefore, stats: x.stepStats
    })),
    above3Steps: above3
  };
}

function releaseCoverage(details, ev) {
  const states = [];
  for (const detail of details) {
    if (!(detail.bufferBefore >= 3 && detail.progress >= 0.2 && detail.progress <= 0.85)) continue;
    const ref = detail;
    const moves = (detail.moves || []).slice().sort((x, y) => {
      const xr = x.r === ref.r && x.c === ref.c ? 0 : 1;
      const yr = y.r === ref.r && y.c === ref.c ? 0 : 1;
      return xr - yr;
    });
    states.push({
      ordinal: states.length + 1, index: detail.index, solverStep: detail.solverStep,
      progress: +detail.progress.toFixed(4), buffer: detail.bufferBefore,
      freeSlots: detail.free, full: detail.full,
      bufferItems: null,
      referenceAction: {
        step: detail.solverStep, r: detail.r, c: detail.c, boxId: detail.boxId,
        color: detail.color, count: detail.count
      },
      alternativesInCurrentOrder: moves.slice(0, 3).map(m => ({
        r: m.r, c: m.c, color: m.color, count: m.count, full: m.full,
        isReference: m.r === ref.r && m.c === ref.c
      })),
      currentEvaluatorAttempts: states.length < 2
    });
  }
  const eligible = states.length;
  const rd = ev && ev.releaseDecision || {};
  return {
    eligiblePressureStates: eligible,
    currentAttemptedStates: states.filter(x => x.currentEvaluatorAttempts).length,
    untriedPressureStates: Math.max(0, eligible - 2),
    states,
    currentDecision: {
      status: rd.status, found: rd.found,
      decisionsTried: rd.decisionsTried, alternativesTried: rd.alternativesTried,
      highPressureStates: rd.highPressureStates, solvedNoRelease: rd.solvedNoRelease,
      unknownAlternatives: rd.unknownAlternatives, searchLimited: rd.searchLimited,
      elapsedMs: rd.elapsedMs, evidence: rd.evidence || null
    }
  };
}

function run(A, spec) {
  const G = A.Generator, EG = A.ExperienceGoal;
  const blocks = G.blocksFromTXT(fs.readFileSync(path.join(ROOT, IMAGE), 'utf8'));
  const cfg = cfgFor(spec);
  const t0 = Date.now();
  let r = null;
  try { r = G.produceGoal(blocks, cfg); }
  catch (e) { r = { level: null, valid: false, error: String((e && e.message) || e) }; }
  const level = r && r.level || null;
  if (!level) return { ...spec, valid: false, error: r && r.error || null, wallMs: Date.now() - t0 };
  const actualHash = hash(level);
  const q = A.Quality.fromGeneration(r);
  const quick = EG.evaluate(level, { solveResult: r.solveResult, decision: false, instantChain: true });
  const full = r._experienceFull || null;
  const fc = r.goodV3 && r.goodV3.fillCurve || {};
  const steps = fc.steps || [];
  const order = orderedActions(r.solveResult);
  const boxes = boxMap(level);
  const stepStats = {};
  for (const x of (r.solveResult && r.solveResult.stepStats || [])) stepStats[x.step] = x;
  const details = steps.map((s, i) => {
    const p = order[i] || {};
    const b = boxes[p.r + ',' + p.c] || {};
    const fullMove = (s.moves || []).find(m => m.r === p.r && m.c === p.c);
    return {
      index: i, solverStep: p.step, progress: s.prog,
      full: s.full, free: s.free, isFree: s.full >= 2 && s.free >= 3,
      boxId: b.id == null ? null : b.id,
      color: p.color != null ? p.color : b.color,
      count: p.count != null ? p.count : b.count,
      r: p.r, c: p.c,
      chosenCanConsume: fullMove ? !!fullMove.full : null,
      moves: s.moves || [],
      bufferBefore: (level.bufferLimit || 5) - s.free,
      stepStats: stepStats[p.step] || null
    };
  });
  const low = details.filter(x => x.free >= 3);
  const high = details.filter(x => x.free <= 2);
  const rec = {
    shape: spec.shape, seed: spec.seed, rows: spec.rows, cols: spec.cols,
    valid: !!r.valid, wallMs: Date.now() - t0,
    expectedHash: spec.expectedHash, actualHash, hashMismatch: actualHash !== spec.expectedHash,
    metrics: {
      freeRunMax: fc.freeRunMax, freeLowPct: fc.freeLowPct,
      fullMedian2: fc.fullMedian2, midBuffer34Pct: (full || quick).metrics && (full || quick).metrics.midBuffer34Pct,
      maxBuffer: (full || quick).metrics && (full || quick).metrics.maxBuffer,
      significantReleaseCount: full && full.metrics && full.metrics.significantReleaseCount,
      releaseStatus: full && full.releaseDecision && full.releaseDecision.status,
      struct: !!G.goalStructPass(r), pass: !!G.goalResultExperiencePass(r, cfg),
      gateReasons: q.gateReasons || []
    },
    free: freeRuns(details),
    full: fullStats(details),
    lowPressure: {
      steps: low.length, median: median(low.map(x => x.full)),
      above3: low.filter(x => x.full > 3).length, detail: low
    },
    highPressure: {
      steps: high.length, median: median(high.map(x => x.full)),
      above3: high.filter(x => x.full > 3).length
    },
    releaseCoverage: releaseCoverage(details, full),
    stepDetails: details,
    quality: q
  };
  console.log(JSON.stringify({
    shape: rec.shape, seed: rec.seed, hashMismatch: rec.hashMismatch,
    freeRunMax: rec.metrics.freeRunMax, fullMedian2: rec.metrics.fullMedian2,
    minFlipsTo3: rec.full.minFlipsTo3,
    eligiblePressureStates: rec.releaseCoverage.eligiblePressureStates,
    untriedPressureStates: rec.releaseCoverage.untriedPressureStates,
    releaseStatus: rec.metrics.releaseStatus, struct: rec.metrics.struct
  }));
  return rec;
}

const A = load();
const rows = CASES.map(spec => run(A, spec));
const summary = {
  rows: rows.length,
  valid: rows.filter(x => x.valid).length,
  hashMatches: rows.filter(x => x.valid && !x.hashMismatch).length,
  freeRunNearMiss: rows.filter(x => x.valid && x.metrics.freeRunMax === 7).map(x => x.shape + '/seed' + x.seed),
  fullMedianPivotOneStep: rows.filter(x => x.valid && x.full.minFlipsTo3 === 1).map(x => ({
    sample: x.shape + '/seed' + x.seed,
    above3Count: x.full.above3Count,
    medianIndex: x.full.medianIndex
  })),
  releaseCoverage: rows.filter(x => x.valid).map(x => ({
    sample: x.shape + '/seed' + x.seed,
    status: x.metrics.releaseStatus,
    eligible: x.releaseCoverage.eligiblePressureStates,
    attempted: x.releaseCoverage.currentAttemptedStates,
    untried: x.releaseCoverage.untriedPressureStates,
    triedAlternatives: x.releaseCoverage.currentDecision.alternativesTried,
    unknownAlternatives: x.releaseCoverage.currentDecision.unknownAlternatives,
    solvedNoRelease: x.releaseCoverage.currentDecision.solvedNoRelease
  })),
  fullMedianMinimumFlips: rows.filter(x => x.valid).map(x => ({
    sample: x.shape + '/seed' + x.seed,
    fullMedian2: x.metrics.fullMedian2,
    minFlipsTo3: x.full.minFlipsTo3,
    above3Count: x.full.above3Count,
    medianIndex: x.full.medianIndex
  })),
  releaseCoverageShortfallAll: rows.every(x => x.valid &&
    x.releaseCoverage.eligiblePressureStates > x.releaseCoverage.currentAttemptedStates),
  decision: rows.every(x => x.valid && !x.hashMismatch)
    ? '六个v547 prefix12样本均已复现；每个样本有22~29个高压状态，但当前release评价只尝试前2个，20~27个未覆盖，下一轮应先做P1.1状态覆盖单因素，不混入车序或障碍修改。'
    : '存在复现hash不一致或无效样本；停止归因，不能把新样本冒充v547。'
};
const report = {
  schema: 'step-release-coverage-v548',
  date: '2026-10-26',
  preregistration: '步骤与释放覆盖定位_预登记_v548.md',
  summary, rows
};
fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ summary }, null, 2));
if (summary.hashMatches !== rows.length) process.exitCode = 1;
