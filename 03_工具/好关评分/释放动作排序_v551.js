#!/usr/bin/env node
/** v551：固定状态8和搜索预算，只比较棋盘顺序与即时降压优先的备选排序。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '完整主bin快照_20261012', 'bin', 'js');
const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js',
  'playersim.js', 'analysis.js', 'car-sequencer.js', 'solver-analysis.js', 'experience-goal.js',
  'capacity-tuner.js', 'instant-playout.js', 'generator.js', 'source-preflight.js'];
const IMAGE = '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_007.txt';
const CASES = [
  { shape: '7x9', rows: 7, cols: 9, seed: 1001, expectedHash: '78055a5a03bb248a7460a6a1755c0438d50c849c4c876b4c047f6136bbb9636a', v550Status: 'found', v550Decisions: 5, v550Alternatives: 13 },
  { shape: '7x9', rows: 7, cols: 9, seed: 1002, expectedHash: '40d5a8b28ac652234c73c1058821fe11c1304932b81f8e946f7229dc1c412e8f', v550Status: 'unknown_within_budget', v550Decisions: 8, v550Alternatives: 24 },
  { shape: '7x9', rows: 7, cols: 9, seed: 32677, expectedHash: '78055a5a03bb248a7460a6a1755c0438d50c849c4c876b4c047f6136bbb9636a', v550Status: 'found', v550Decisions: 5, v550Alternatives: 13 },
  { shape: '9x7', rows: 9, cols: 7, seed: 1001, expectedHash: '0f72e44ee766c984259f16138bfa5ecde65be9d9edf28e3aed50cc429cb1132e', v550Status: 'unknown_within_budget', v550Decisions: 8, v550Alternatives: 24 },
  { shape: '9x7', rows: 9, cols: 7, seed: 1002, expectedHash: 'eeff5444341e501b56573fb996528ee7ffdd6355167bb7ffbda4bec9ee510551', v550Status: 'unknown_within_budget', v550Decisions: 8, v550Alternatives: 24 },
  { shape: '9x7', rows: 9, cols: 7, seed: 32677, expectedHash: '4e670942c6ab918a2c6c0e64bf6e00752c25db86c30477aeb59a1e5ca505c1ae', v550Status: 'unknown_within_budget', v550Decisions: 8, v550Alternatives: 24 }
];
const OUT = path.resolve(ROOT, '03_工具/好关评分/释放动作排序_v551.json');
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
function evidenceAt(A, after, futureActions, beforeBuffer, move, step, progress, source, ranked) {
  const SA = A.SolverAnalysis;
  const replayed = SA.replayFromState(after, futureActions || []);
  if (!replayed.completed) return { completed: false };
  const buffers = [after.buffer.length].concat((replayed.trace || []).slice(0, 4).map(x => x.buffer));
  const minBuffer = Math.min.apply(null, buffers), amplitude = beforeBuffer - minBuffer;
  return {
    completed: true, amplitude,
    evidence: {
      referenceStep: step, progress: +progress.toFixed(3),
      beforeBuffer, action: { r: move.r, c: move.c, color: move.antBox ? move.antBox.color : (move.color == null ? null : move.color) },
      minBufferWithinWindow: minBuffer, releaseAmplitude: amplitude, releaseWindow: 4,
      finalReplayValid: true, routeActions: (futureActions || []).length, source,
      choiceContrast: null,
      rankedAction: ranked || null
    }
  };
}
function moveMetrics(A, state, move, reference) {
  const after = A.SolverStrategy.cloneState(state);
  const beforePixels = state.eliminatedPixels, beforeBuffer = state.buffer.length;
  A.Simulator.applyPick(after, move.r, move.c);
  return {
    r: move.r, c: move.c,
    color: move.antBox ? move.antBox.color : (state.cells[move.r] && state.cells[move.r][move.c] && state.cells[move.r][move.c].color),
    count: move.antBox ? move.antBox.count : (state.cells[move.r] && state.cells[move.r][move.c] && state.cells[move.r][move.c].count),
    canConsume: !!move.canConsume,
    bufferBefore: beforeBuffer, bufferAfter: after.buffer.length,
    bufferDrop: beforeBuffer - after.buffer.length,
    immediateEliminated: after.eliminatedPixels - beforePixels,
    isReference: !!reference
  };
}
function orderedMoves(A, state, moves, reference) {
  const seen = moves.map((m, i) => ({ m, i, rank: moveMetrics(A, state, m, m.r === reference.r && m.c === reference.c) }));
  seen.sort((a, b) => {
    if (a.rank.isReference !== b.rank.isReference) return a.rank.isReference ? -1 : 1;
    if (a.rank.bufferDrop !== b.rank.bufferDrop) return b.rank.bufferDrop - a.rank.bufferDrop;
    if (a.rank.canConsume !== b.rank.canConsume) return a.rank.canConsume ? -1 : 1;
    if (a.rank.immediateEliminated !== b.rank.immediateEliminated) return b.rank.immediateEliminated - a.rank.immediateEliminated;
    return a.i - b.i;
  });
  return seen;
}
function releaseDecisionOrdered(A, level, route) {
  const Sim = A.Simulator, SA = A.SolverAnalysis, t0 = Date.now();
  const actions = SA.normalizeActions(route);
  const s = Sim.createState(level, { useSlotStart: true, instantChain: true });
  const stats = {
    status: 'not_found_within_budget', found: false, decisionsTried: 0,
    alternativesTried: 0, solvedNoRelease: 0, unknownAlternatives: 0,
    highPressureStates: 0, searchLimited: true, evidence: null, attemptedStates: []
  };
  for (let i = 0; i < actions.length; i++) {
    if (s.gameWon || s.gameOver) break;
    const a = actions[i];
    if (!Sim.isPickable(s, a.r, a.c)) { stats.status = 'invalid_reference'; stats.elapsedMs = Date.now() - t0; return stats; }
    const progress = s.totalPixels ? s.eliminatedPixels / s.totalPixels : 0;
    if (s.buffer.length >= 3 && progress >= 0.2 && progress <= 0.85 && stats.decisionsTried < 8) {
      stats.highPressureStates++;
      const beforeBuffer = s.buffer.length;
      const legal = Sim.listMoves(s).filter(m => !m.blocked);
      const ordered = orderedMoves(A, s, legal, a).slice(0, 3);
      const stateRec = {
        ordinal: stats.decisionsTried + 1, referenceStep: i + 1,
        progress: +progress.toFixed(3), buffer: beforeBuffer,
        candidates: ordered.map((x, idx) => ({ rank: idx + 1, ...x.rank })),
        foundAtRank: null
      };
      stats.decisionsTried++;
      stats.attemptedStates.push(stateRec);
      for (let oi = 0; oi < ordered.length; oi++) {
        const item = ordered[oi], m = item.m, isReference = item.rank.isReference;
        stats.alternativesTried++;
        const after = A.SolverStrategy.cloneState(s);
        Sim.applyPick(after, m.r, m.c);
        if (after.eliminatedPixels >= after.totalPixels) { after.gameWon = true; after.gameOver = true; }
        if (isReference) {
          const direct = evidenceAt(A, after, actions.slice(i + 1), beforeBuffer, m, i + 1, progress,
            'reference_action', { rank: oi + 1, ...item.rank });
          if (direct.completed && direct.amplitude >= 1) {
            stateRec.foundAtRank = oi + 1;
            stats.status = 'found'; stats.found = true; stats.evidence = direct.evidence;
            stats.elapsedMs = Date.now() - t0; return stats;
          }
        }
        const searched = SA.searchFromState(after, {
          timeBudgetMs: 350, maxNodes: 1200, beamWidth: 16,
          branchWidth: 8, maxRoutes: 1
        });
        if (!searched.routes.length) {
          if (searched.budgetExhausted) stats.unknownAlternatives++;
          continue;
        }
        const future = searched.routes[0];
        const checked = evidenceAt(A, after, future.actions, beforeBuffer, m, i + 1, progress,
          isReference ? 'reference_action_resolved' : 'alternative_action',
          { rank: oi + 1, ...item.rank });
        if (!checked.completed) continue;
        if (checked.amplitude < 1) { stats.solvedNoRelease++; continue; }
        stateRec.foundAtRank = oi + 1;
        stats.status = 'found'; stats.found = true; stats.evidence = checked.evidence;
        stats.elapsedMs = Date.now() - t0; return stats;
      }
    }
    Sim.applyPick(s, a.r, a.c);
    if (s.eliminatedPixels >= s.totalPixels) { s.gameWon = true; s.gameOver = true; }
  }
  if (!stats.highPressureStates) stats.status = 'no_high_pressure_state';
  else if (stats.unknownAlternatives > 0 && stats.solvedNoRelease === 0) stats.status = 'unknown_within_budget';
  stats.elapsedMs = Date.now() - t0;
  return stats;
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
  if (!level) return { ...spec, valid: false, error: r && r.error || null, genMs: Date.now() - t0 };
  const actualHash = hash(level);
  const q = A.Quality.fromGeneration(r);
  const curve = EG.evaluate(level, { solveResult: r.solveResult, decision: false, instantChain: true });
  const parsedLevel = A.parseLevel ? A.parseLevel(level) : level;
  const bStart = Date.now();
  const orderedRelease = releaseDecisionOrdered(A, parsedLevel, r.solveResult);
  const orderedMs = Date.now() - bStart;
  const finalReplayValid = !!(orderedRelease.evidence && orderedRelease.evidence.finalReplayValid);
  const baselineFound = spec.v550Status === 'found';
  const orderedFound = orderedRelease.status === 'found' && finalReplayValid;
  const rec = {
    shape: spec.shape, seed: spec.seed,
    expectedHash: spec.expectedHash, actualHash, hashMismatch: actualHash !== spec.expectedHash,
    valid: !!r.valid, genMs: Date.now() - t0, orderedMs,
    v550Baseline: {
      status: spec.v550Status, decisionsTried: spec.v550Decisions,
      alternativesTried: spec.v550Alternatives, found: baselineFound
    },
    orderedB: orderedRelease,
    transition: spec.v550Status + '->' + orderedRelease.status,
    newFound: !baselineFound && orderedFound,
    foundKept: !baselineFound || orderedFound,
    curvePass: !!curve.curvePass,
    significantReleaseCount: curve.metrics && curve.metrics.significantReleaseCount,
    experienceReasons: curve.reasons || [],
    structure: {
      struct: !!G.goalStructPass(r), pass: !!G.goalResultExperiencePass(r, cfg),
      gateReasons: q.gateReasons || [],
      freeRunMax: r.goodV3 && r.goodV3.fillCurve && r.goodV3.fillCurve.freeRunMax,
      fullMedian2: r.goodV3 && r.goodV3.fillCurve && r.goodV3.fillCurve.fullMedian2
    },
    hash: actualHash
  };
  console.log(JSON.stringify({
    shape: rec.shape, seed: rec.seed, hashMismatch: rec.hashMismatch,
    baseline: rec.v550Baseline.status, ordered: rec.orderedB.status,
    transition: rec.transition, newFound: rec.newFound,
    decisions: rec.orderedB.decisionsTried, alternatives: rec.orderedB.alternativesTried,
    significantReleaseCount: rec.significantReleaseCount
  }));
  return rec;
}

const A = load();
const rows = CASES.map(spec => run(A, spec));
const validRows = rows.filter(x => x.valid && !x.hashMismatch);
const newFound = rows.filter(x => x.newFound);
const foundRegressions = rows.filter(x => !x.foundKept);
const targetRelevant = newFound.filter(x => x.significantReleaseCount >= 1 && x.curvePass);
const summary = {
  rows: rows.length,
  valid: rows.filter(x => x.valid).length,
  hashMatches: validRows.length,
  statuses: rows.map(x => ({
    sample: x.shape + '/seed' + x.seed,
    baseline: x.v550Baseline && x.v550Baseline.status,
    ordered: x.orderedB && x.orderedB.status,
    significantReleaseCount: x.significantReleaseCount,
    struct: x.structure && x.structure.struct
  })),
  newFound: newFound.map(x => x.shape + '/seed' + x.seed),
  foundRegressions: foundRegressions.map(x => x.shape + '/seed' + x.seed),
  targetRelevant: targetRelevant.map(x => x.shape + '/seed' + x.seed),
  evaluationPass: validRows.length === rows.length && newFound.length >= 1 && foundRegressions.length === 0,
  targetPass: targetRelevant.length >= 1 && foundRegressions.length === 0,
  decision: validRows.length !== rows.length
    ? 'hash复现失败，停止结论。'
    : targetRelevant.length >= 1
      ? '即时降压排序找到新的显著释放；只说明P1.2有目标相关收益，仍需完整结构与目标验收。'
      : newFound.length >= 1
        ? '即时降压排序新增了evaluation found，但没有形成显著释放；不能算完整体验通过，转P1.3或释放供给分析。'
        : '即时降压排序没有新增found；动作排序不是当前主因，转P1.3分离状态/预算与关卡供给。'
};
const report = {
  schema: 'release-action-ordering-v551',
  date: '2026-10-26',
  preregistration: '释放动作排序_预登记_v551.md',
  summary, rows
};
fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ summary }, null, 2));
if (validRows.length !== rows.length || foundRegressions.length) process.exitCode = 1;
