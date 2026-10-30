#!/usr/bin/env node
/** v550：固定六个prefix=12关卡与参考路线，只比较release状态覆盖2与8。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '游戏主bin', 'bin', 'js');
const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js',
  'playersim.js', 'analysis.js', 'car-sequencer.js', 'solver-analysis.js', 'experience-goal.js',
  'capacity-tuner.js', 'instant-playout.js', 'generator.js', 'source-preflight.js'];
const IMAGE = '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_007.txt';
const CASES = [
  { shape: '7x9', rows: 7, cols: 9, seed: 1001, expectedHash: '78055a5a03bb248a7460a6a1755c0438d50c849c4c876b4c047f6136bbb9636a', v548Eligible: 22 },
  { shape: '7x9', rows: 7, cols: 9, seed: 1002, expectedHash: '40d5a8b28ac652234c73c1058821fe11c1304932b81f8e946f7229dc1c412e8f', v548Eligible: 29 },
  { shape: '7x9', rows: 7, cols: 9, seed: 32677, expectedHash: '78055a5a03bb248a7460a6a1755c0438d50c849c4c876b4c047f6136bbb9636a', v548Eligible: 22 },
  { shape: '9x7', rows: 9, cols: 7, seed: 1001, expectedHash: '0f72e44ee766c984259f16138bfa5ecde65be9d9edf28e3aed50cc429cb1132e', v548Eligible: 24 },
  { shape: '9x7', rows: 9, cols: 7, seed: 1002, expectedHash: 'eeff5444341e501b56573fb996528ee7ffdd6355167bb7ffbda4bec9ee510551', v548Eligible: 27 },
  { shape: '9x7', rows: 9, cols: 7, seed: 32677, expectedHash: '4e670942c6ab918a2c6c0e64bf6e00752c25db86c30477aeb59a1e5ca505c1ae', v548Eligible: 29 }
];
const OUT = path.resolve(ROOT, '03_工具/好关评分/释放状态覆盖2与8_v550.json');
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
function releaseSummary(ev) {
  const d = ev && ev.releaseDecision || {};
  return {
    status: d.status || null,
    found: !!d.found,
    decisionsTried: d.decisionsTried == null ? null : d.decisionsTried,
    alternativesTried: d.alternativesTried == null ? null : d.alternativesTried,
    highPressureStates: d.highPressureStates == null ? null : d.highPressureStates,
    solvedNoRelease: d.solvedNoRelease == null ? null : d.solvedNoRelease,
    unknownAlternatives: d.unknownAlternatives == null ? null : d.unknownAlternatives,
    searchLimited: d.searchLimited,
    elapsedMs: d.elapsedMs == null ? null : d.elapsedMs,
    evidence: d.evidence || null
  };
}
function run(A, spec) {
  const G = A.Generator, EG = A.ExperienceGoal;
  const blocks = G.blocksFromTXT(fs.readFileSync(path.join(ROOT, IMAGE), 'utf8'));
  const cfg = cfgFor(spec);
  const genStart = Date.now();
  let r = null;
  try { r = G.produceGoal(blocks, cfg); }
  catch (e) { r = { level: null, valid: false, error: String((e && e.message) || e) }; }
  const level = r && r.level || null;
  if (!level) return { ...spec, valid: false, error: r && r.error || null, genMs: Date.now() - genStart };

  const actualHash = hash(level);
  const q = A.Quality.fromGeneration(r);
  const baseline = r._experienceFull;
  const bStart = Date.now();
  const expanded = EG.evaluate(level, {
    solveResult: r.solveResult, decision: true, instantChain: true,
    maxDecisionStates: 8, maxAlternativesPerState: 3,
    altTimeMs: 350, altMaxNodes: 1200, releaseWindow: 4, minReleaseAmplitude: 1
  });
  const expandedMs = Date.now() - bStart;
  const aRec = releaseSummary(baseline);
  const bRec = releaseSummary(expanded);
  const transition = (aRec.status || 'missing') + '->' + (bRec.status || 'missing');
  const finalReplayValid = !!(bRec.evidence && bRec.evidence.finalReplayValid);
  const foundNew = aRec.status !== 'found' && bRec.status === 'found' && finalReplayValid;
  const foundKept = aRec.status !== 'found' || bRec.status === 'found';
  const rec = {
    shape: spec.shape, seed: spec.seed,
    expectedHash: spec.expectedHash, actualHash, hashMismatch: actualHash !== spec.expectedHash,
    valid: !!r.valid,
    actualBoard: { rows: level.board.rows, cols: level.board.cols },
    genMs: Date.now() - genStart,
    expandedEvalMs: expandedMs,
    structure: {
      struct: !!G.goalStructPass(r), pass: !!G.goalResultExperiencePass(r, cfg),
      gateReasons: q.gateReasons || [],
      freeRunMax: r.goodV3 && r.goodV3.fillCurve && r.goodV3.fillCurve.freeRunMax,
      fullMedian2: r.goodV3 && r.goodV3.fillCurve && r.goodV3.fillCurve.fullMedian2
    },
    v548EligibleStates: spec.v548Eligible,
    baselineA: aRec,
    expandedB: bRec,
    transition, foundNew, foundKept,
    curvePassA: !!(baseline && baseline.curvePass),
    curvePassB: !!expanded.curvePass,
    expandedReasons: expanded.reasons || [],
    hash: actualHash
  };
  console.log(JSON.stringify({
    shape: rec.shape, seed: rec.seed, hashMismatch: rec.hashMismatch,
    baseline: rec.baselineA.status, expanded: rec.expandedB.status,
    transition: rec.transition, foundNew: rec.foundNew,
    decisions: [rec.baselineA.decisionsTried, rec.expandedB.decisionsTried],
    alternatives: [rec.baselineA.alternativesTried, rec.expandedB.alternativesTried]
  }));
  return rec;
}

const A = load();
const rows = CASES.map(spec => run(A, spec));
const validHashRows = rows.filter(x => x.valid && !x.hashMismatch);
const foundNew = rows.filter(x => x.foundNew);
const foundRegressions = rows.filter(x => !x.foundKept);
const baselineMismatch = rows.filter(x => x.valid && x.baselineA.status !== 'unknown_within_budget');
const summary = {
  rows: rows.length,
  valid: rows.filter(x => x.valid).length,
  hashMatches: validHashRows.length,
  baselineStatuses: rows.map(x => ({ sample: x.shape + '/seed' + x.seed, status: x.baselineA && x.baselineA.status || null })),
  expandedStatuses: rows.map(x => ({ sample: x.shape + '/seed' + x.seed, status: x.expandedB && x.expandedB.status || null })),
  transitions: rows.map(x => ({ sample: x.shape + '/seed' + x.seed, transition: x.transition })),
  foundNew: foundNew.map(x => x.shape + '/seed' + x.seed),
  foundRegressions: foundRegressions.map(x => x.shape + '/seed' + x.seed),
  baselineMismatchV548: baselineMismatch.map(x => x.shape + '/seed' + x.seed),
  expandedEvalMs: rows.map(x => x.expandedEvalMs),
  pass: validHashRows.length === rows.length && foundNew.length >= 1 &&
    foundRegressions.length === 0 && baselineMismatch.length === 0,
  decision: validHashRows.length !== rows.length
    ? 'hash复现失败，停止结论。'
    : foundNew.length >= 1
      ? '状态覆盖2→8至少救回一个unknown且回放有效；只说明评价覆盖有收益，不等于完整关卡通过。'
      : '状态覆盖2→8未找到释放；下一步只改备选动作排序（P1.2），不先修车序或障碍。'
};
const report = {
  schema: 'release-state-coverage-2-8-v550',
  date: '2026-10-26',
  preregistration: '释放状态覆盖2与8_预登记_v550.md',
  summary, rows
};
fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ summary }, null, 2));
if (validHashRows.length !== rows.length || foundRegressions.length || baselineMismatch.length) process.exitCode = 1;
