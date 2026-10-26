#!/usr/bin/env node
/** v554：固定8状态和预算，只把高压状态选取改为中段四分层+buffer优先。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '完整主bin快照_20261012', 'bin', 'js');
const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js',
  'playersim.js', 'analysis.js', 'car-sequencer.js', 'solver-analysis.js', 'experience-goal.js',
  'capacity-tuner.js', 'instant-playout.js', 'generator.js', 'source-preflight.js'];
const IMAGE = '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_007.txt';
const CASES = [
  { shape: '9x7', rows: 9, cols: 7, seed: 1001, expectedHash: '0f72e44ee766c984259f16138bfa5ecde65be9d9edf28e3aed50cc429cb1132e', structuralPass: false, releaseStep: null },
  { shape: '9x7', rows: 9, cols: 7, seed: 1002, expectedHash: 'eeff5444341e501b56573fb996528ee7ffdd6355167bb7ffbda4bec9ee510551', structuralPass: true, releaseStep: 39 },
  { shape: '9x7', rows: 9, cols: 7, seed: 32677, expectedHash: '4e670942c6ab918a2c6c0e64bf6e00752c25db86c30477aeb59a1e5ca505c1ae', structuralPass: true, releaseStep: 39 }
];
const OUT = path.resolve(ROOT, '03_工具/好关评分/释放状态分层采样_v554.json');
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
function collectEligibleStates(A, level, route) {
  const Sim = A.Simulator, SA = A.SolverAnalysis;
  const actions = SA.normalizeActions(route);
  const state = Sim.createState(level, { useSlotStart: true, instantChain: true });
  const states = [];
  let ordinal = 0;
  for (let i = 0; i < actions.length; i++) {
    if (state.gameWon || state.gameOver) break;
    const a = actions[i];
    if (!Sim.isPickable(state, a.r, a.c)) break;
    const progress = state.totalPixels ? state.eliminatedPixels / state.totalPixels : 0;
    if (state.buffer.length >= 3 && progress >= 0.2 && progress <= 0.85) {
      ordinal++;
      states.push({
        ordinal, actionIndex: i, step: i + 1, progress: +progress.toFixed(4),
        buffer: state.buffer.length,
        action: { r: a.r, c: a.c, color: a.color, count: a.count }
      });
    }
    Sim.applyPick(state, a.r, a.c);
    if (state.eliminatedPixels >= state.totalPixels) { state.gameWon = true; state.gameOver = true; }
  }
  return states;
}
function selectStratified(states, limit) {
  const bins = [[], [], [], []];
  for (const s of states) {
    let idx = Math.floor((s.progress - 0.2) / 0.65 * 4);
    if (idx < 0) idx = 0;
    if (idx > 3) idx = 3;
    bins[idx].push(s);
  }
  function rank(a, b) {
    if (a.buffer !== b.buffer) return b.buffer - a.buffer;
    if (a.progress !== b.progress) return b.progress - a.progress;
    return a.actionIndex - b.actionIndex;
  }
  for (const b of bins) b.sort(rank);
  const picked = [];
  const pickedSet = {};
  for (let b = 0; b < bins.length; b++) {
    for (let i = 0; i < bins[b].length && i < 2; i++) {
      const s = bins[b][i];
      picked.push({ ...s, bin: b });
      pickedSet[s.actionIndex] = true;
    }
  }
  if (picked.length < limit) {
    const rest = states.filter(s => !pickedSet[s.actionIndex]).sort(rank);
    for (let i = 0; i < rest.length && picked.length < limit; i++) {
      picked.push({ ...rest[i], bin: null });
      pickedSet[rest[i].actionIndex] = true;
    }
  }
  return picked.sort((a, b) => a.actionIndex - b.actionIndex);
}
function evidenceFromAfter(A, after, futureActions, beforeBuffer, step, progress) {
  const replayed = A.SolverAnalysis.replayFromState(after, futureActions || []);
  if (!replayed.completed) return { completed: false };
  const buffers = [after.buffer.length].concat((replayed.trace || []).slice(0, 4).map(x => x.buffer));
  const minBuffer = Math.min.apply(null, buffers);
  return {
    completed: true, amplitude: beforeBuffer - minBuffer,
    evidence: {
      referenceStep: step, progress: +progress.toFixed(4),
      beforeBuffer, minBufferWithinWindow: minBuffer,
      releaseAmplitude: beforeBuffer - minBuffer, releaseWindow: 4,
      finalReplayValid: true, routeActions: (futureActions || []).length
    }
  };
}
function releaseOnSelectedStates(A, level, route, selected) {
  const Sim = A.Simulator, SA = A.SolverAnalysis;
  const actions = SA.normalizeActions(route);
  const selectedSet = {};
  for (const s of selected) selectedSet[s.actionIndex] = true;
  const state = Sim.createState(level, { useSlotStart: true, instantChain: true });
  const attempts = [];
  let decisions = 0;
  for (let i = 0; i < actions.length; i++) {
    if (state.gameWon || state.gameOver) break;
    const ref = actions[i];
    if (!Sim.isPickable(state, ref.r, ref.c)) break;
    const progress = state.totalPixels ? state.eliminatedPixels / state.totalPixels : 0;
    if (selectedSet[i] && state.buffer.length >= 3 && progress >= 0.2 && progress <= 0.85) {
      decisions++;
      const moves = Sim.listMoves(state).filter(m => !m.blocked);
      moves.sort((x, y) => {
        const xr = x.r === ref.r && x.c === ref.c ? 0 : 1;
        const yr = y.r === ref.r && y.c === ref.c ? 0 : 1;
        return xr - yr;
      });
      for (const m of moves.slice(0, 3)) {
        const before = state.buffer.length;
        const after = A.SolverStrategy.cloneState(state);
        Sim.applyPick(after, m.r, m.c);
        if (after.eliminatedPixels >= after.totalPixels) { after.gameWon = true; after.gameOver = true; }
        const isReference = m.r === ref.r && m.c === ref.c;
        const direct = isReference ? evidenceFromAfter(A, after, actions.slice(i + 1), before, i + 1, progress) : null;
        if (direct && direct.completed && direct.amplitude >= 1) {
          attempts.push({ decision: decisions, referenceStep: i + 1, action: m, classification: 'direct_release', evidence: direct.evidence });
          return {
            status: 'found', found: true, decisionsTried: decisions, alternativesTried: attempts.length,
            evidence: direct.evidence, counts: { direct_release: 1 }, attempts
          };
        }
        const searched = SA.searchFromState(after, {
          timeBudgetMs: 350, maxNodes: 1200, beamWidth: 16,
          branchWidth: 8, maxRoutes: 1
        });
        let evidence = null;
        if (searched.routes.length) evidence = evidenceFromAfter(A, after, searched.routes[0].actions, before, i + 1, progress);
        let classification = 'no_route_not_exhausted';
        if (evidence && evidence.completed && evidence.amplitude >= 1) classification = 'search_release';
        else if (evidence && evidence.completed) classification = 'solved_no_release';
        else if (!searched.routes.length && searched.budgetExhausted) classification = 'budget_unknown';
        else if (searched.routes.length) classification = 'route_replay_failed';
        attempts.push({
          decision: decisions, referenceStep: i + 1, progress: +progress.toFixed(4),
          beforeBuffer: before, isReference,
          action: { r: m.r, c: m.c, color: m.antBox ? m.antBox.color : m.color, count: m.antBox ? m.antBox.count : m.count },
          search: { routes: searched.routes.length, budgetExhausted: !!searched.budgetExhausted, nodes: searched.nodes },
          evidence, classification
        });
        if (classification === 'search_release') {
          return {
            status: 'found', found: true, decisionsTried: decisions, alternativesTried: attempts.length,
            evidence: evidence.evidence, counts: { search_release: 1 }, attempts
          };
        }
      }
    }
    Sim.applyPick(state, ref.r, ref.c);
    if (state.eliminatedPixels >= state.totalPixels) { state.gameWon = true; state.gameOver = true; }
  }
  const counts = {};
  for (const a of attempts) counts[a.classification] = (counts[a.classification] || 0) + 1;
  const status = decisions && counts.budget_unknown ? 'unknown_within_budget' : 'not_found_within_budget';
  return { status, found: false, decisionsTried: decisions, alternativesTried: attempts.length, evidence: null, counts, attempts };
}
function run(A, spec) {
  const G = A.Generator, EG = A.ExperienceGoal;
  const blocks = G.blocksFromTXT(fs.readFileSync(path.join(ROOT, IMAGE), 'utf8'));
  const t0 = Date.now();
  let r = null;
  try { r = G.produceGoal(blocks, cfgFor(spec)); }
  catch (e) { r = { level: null, valid: false, error: String((e && e.message) || e) }; }
  const level = r && r.level || null;
  if (!level) return { ...spec, valid: false, error: r && r.error || null, genMs: Date.now() - t0 };
  const actualHash = hash(level), parsed = A.parseLevel(level);
  const curve = EG.evaluate(level, { solveResult: r.solveResult, decision: false, instantChain: true });
  const eligible = collectEligibleStates(A, parsed, r.solveResult);
  const selected = selectStratified(eligible, 8);
  const start = Date.now();
  const release = releaseOnSelectedStates(A, parsed, r.solveResult, selected);
  const evalMs = Date.now() - start;
  const q = A.Quality.fromGeneration(r);
  const rec = {
    shape: spec.shape, seed: spec.seed, valid: !!r.valid,
    structuralPass: !!spec.structuralPass, expectedReleaseStep: spec.releaseStep,
    expectedHash: spec.expectedHash, actualHash, hashMismatch: actualHash !== spec.expectedHash,
    genMs: Date.now() - t0, evalMs,
    eligibleCount: eligible.length,
    selectedStates: selected,
    selectedReleaseStep: spec.releaseStep == null ? null :
      selected.some(s => s.step === spec.releaseStep),
    release,
    evidenceAtExpectedStep: !!(release.evidence && spec.releaseStep != null &&
      release.evidence.referenceStep === spec.releaseStep && release.evidence.releaseAmplitude >= 2),
    metrics: {
      significantReleaseCount: curve.metrics && curve.metrics.significantReleaseCount,
      midBuffer34Pct: curve.metrics && curve.metrics.midBuffer34Pct,
      reasons: curve.reasons || []
    },
    structure: {
      struct: !!G.goalStructPass(r), pass: !!G.goalResultExperiencePass(r, cfgFor(spec)),
      gateReasons: q.gateReasons || [],
      freeRunMax: r.goodV3 && r.goodV3.fillCurve && r.goodV3.fillCurve.freeRunMax,
      fullMedian2: r.goodV3 && r.goodV3.fillCurve && r.goodV3.fillCurve.fullMedian2
    },
    hash: actualHash
  };
  console.log(JSON.stringify({
    shape: rec.shape, seed: rec.seed, hashMismatch: rec.hashMismatch,
    eligible: rec.eligibleCount, selected: rec.selectedStates.map(x => ({ step: x.step, progress: x.progress, buffer: x.buffer, bin: x.bin })),
    selectedReleaseStep: rec.selectedReleaseStep,
    release: rec.release.status, evidenceAtExpectedStep: rec.evidenceAtExpectedStep,
    counts: rec.release.counts
  }));
  return rec;
}

const A = load();
const rows = CASES.map(spec => run(A, spec));
const valid = rows.filter(x => x.valid && !x.hashMismatch);
const structural = rows.filter(x => x.structuralPass);
const structuralFound = structural.filter(x => x.release && x.release.status === 'found' &&
  x.release.evidence && x.release.evidence.finalReplayValid === true && x.release.evidence.releaseAmplitude >= 2);
const structuralExpected = structural.filter(x => x.selectedReleaseStep && x.evidenceAtExpectedStep);
const evaluationOnlyFound = rows.filter(x => x.release && x.release.status === 'found' &&
  (!x.release.evidence || x.release.evidence.releaseAmplitude < 2));
const summary = {
  rows: rows.length, valid: valid.length, hashMatches: valid.length,
  structuralSamples: structural.map(x => x.shape + '/seed' + x.seed),
  structuralReleaseFound: structuralFound.map(x => x.shape + '/seed' + x.seed),
  structuralExpectedStepFound: structuralExpected.map(x => x.shape + '/seed' + x.seed),
  evaluationOnlyFound: evaluationOnlyFound.map(x => x.shape + '/seed' + x.seed),
  allSelected: rows.map(x => ({
    sample: x.shape + '/seed' + x.seed,
    selected: (x.selectedStates || []).map(s => ({ step: s.step, progress: s.progress, buffer: s.buffer, bin: s.bin })),
    release: x.release && x.release.status,
    evidenceAtExpectedStep: x.evidenceAtExpectedStep
  })),
  pass: valid.length === rows.length && structuralFound.length === structural.length,
  decision: valid.length !== rows.length
    ? 'hash复现失败，停止结论。'
    : structuralFound.length === structural.length
      ? '两个结构通过样本均用同一8状态分层采样找到显著释放，且最终回放有效；采样假设成立，可讨论接回评价。'
      : structuralFound.length > 0
        ? '仅部分结构通过样本找到释放，保留单样本信号，不接生产。'
        : evaluationOnlyFound.length > 0
          ? '分层采样选中了step39，但评价在前序step29以amplitude1提前返回found，未形成显著释放；下一步只把minReleaseAmplitude从1改为2，状态数和预算不变。'
          : '分层采样仍未找到显著释放；状态采样不是充分修复，转只读检查释放资格/动作搜索实现。'
};
const report = {
  schema: 'release-state-stratified-sampling-v554',
  date: '2026-10-26',
  preregistration: '释放状态分层采样_预登记_v554.md',
  summary, rows
};
fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ summary }, null, 2));
if (valid.length !== rows.length) process.exitCode = 1;
