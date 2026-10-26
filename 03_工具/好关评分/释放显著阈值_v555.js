#!/usr/bin/env node
/** v555：固定v554分层采样和预算，只把最小释放幅度1改为2。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '完整主bin快照_20261012', 'bin', 'js');
const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js',
  'playersim.js', 'analysis.js', 'car-sequencer.js', 'solver-analysis.js', 'experience-goal.js',
  'capacity-tuner.js', 'instant-playout.js', 'generator.js', 'source-preflight.js'];
const IMAGE = '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_007.txt';
const MIN_AMP = 2;
const CASES = [
  { shape: '9x7', rows: 9, cols: 7, seed: 1001, expectedHash: '0f72e44ee766c984259f16138bfa5ecde65be9d9edf28e3aed50cc429cb1132e', structuralPass: false, expectedStep: null },
  { shape: '9x7', rows: 9, cols: 7, seed: 1002, expectedHash: 'eeff5444341e501b56573fb996528ee7ffdd6355167bb7ffbda4bec9ee510551', structuralPass: true, expectedStep: 39 },
  { shape: '9x7', rows: 9, cols: 7, seed: 32677, expectedHash: '4e670942c6ab918a2c6c0e64bf6e00752c25db86c30477aeb59a1e5ca505c1ae', structuralPass: true, expectedStep: 39 }
];
const OUT = path.resolve(ROOT, '03_工具/好关评分/释放显著阈值_v555.json');
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
function collectStates(A, level, route) {
  const Sim = A.Simulator, SA = A.SolverAnalysis, actions = SA.normalizeActions(route);
  const st = Sim.createState(level, { useSlotStart: true, instantChain: true });
  const out = [];
  let ordinal = 0;
  for (let i = 0; i < actions.length; i++) {
    if (st.gameWon || st.gameOver || !Sim.isPickable(st, actions[i].r, actions[i].c)) break;
    const progress = st.totalPixels ? st.eliminatedPixels / st.totalPixels : 0;
    if (st.buffer.length >= 3 && progress >= 0.2 && progress <= 0.85) {
      ordinal++;
      out.push({ ordinal, actionIndex: i, step: i + 1, progress: +progress.toFixed(4), buffer: st.buffer.length,
        action: { r: actions[i].r, c: actions[i].c, color: actions[i].color, count: actions[i].count } });
    }
    Sim.applyPick(st, actions[i].r, actions[i].c);
    if (st.eliminatedPixels >= st.totalPixels) { st.gameWon = true; st.gameOver = true; }
  }
  return out;
}
function selectStates(states) {
  const bins = [[], [], [], []];
  for (const s of states) {
    let b = Math.floor((s.progress - 0.2) / 0.65 * 4);
    b = Math.max(0, Math.min(3, b));
    bins[b].push(s);
  }
  const rank = (a, b) => (b.buffer - a.buffer) || (b.progress - a.progress) || (a.actionIndex - b.actionIndex);
  const picked = [], seen = {};
  for (let b = 0; b < 4; b++) {
    bins[b].sort(rank);
    for (let i = 0; i < bins[b].length && i < 2; i++) {
      picked.push({ ...bins[b][i], bin: b }); seen[bins[b][i].actionIndex] = true;
    }
  }
  const rest = states.filter(s => !seen[s.actionIndex]).sort(rank);
  for (let i = 0; i < rest.length && picked.length < 8; i++) {
    picked.push({ ...rest[i], bin: null }); seen[rest[i].actionIndex] = true;
  }
  return picked.sort((a, b) => a.actionIndex - b.actionIndex);
}
function evidenceFromAfter(A, after, future, beforeBuffer, step, progress) {
  const replayed = A.SolverAnalysis.replayFromState(after, future || []);
  if (!replayed.completed) return { completed: false };
  const buffers = [after.buffer.length].concat((replayed.trace || []).slice(0, 4).map(x => x.buffer));
  const minBuffer = Math.min.apply(null, buffers);
  return { completed: true, amplitude: beforeBuffer - minBuffer, evidence: {
    referenceStep: step, progress: +progress.toFixed(4), beforeBuffer, minBufferWithinWindow: minBuffer,
    releaseAmplitude: beforeBuffer - minBuffer, releaseWindow: 4, finalReplayValid: true,
    routeActions: (future || []).length
  } };
}
function evaluateSelected(A, level, route, selected) {
  const Sim = A.Simulator, SA = A.SolverAnalysis, actions = SA.normalizeActions(route);
  const selectedSet = {};
  for (const s of selected) selectedSet[s.actionIndex] = true;
  const st = Sim.createState(level, { useSlotStart: true, instantChain: true });
  const attempts = [];
  let decisions = 0;
  for (let i = 0; i < actions.length; i++) {
    if (st.gameWon || st.gameOver || !Sim.isPickable(st, actions[i].r, actions[i].c)) break;
    const progress = st.totalPixels ? st.eliminatedPixels / st.totalPixels : 0;
    if (selectedSet[i] && st.buffer.length >= 3 && progress >= 0.2 && progress <= 0.85) {
      decisions++;
      const ref = actions[i], moves = Sim.listMoves(st).filter(m => !m.blocked);
      moves.sort((x, y) => {
        const xr = x.r === ref.r && x.c === ref.c ? 0 : 1;
        const yr = y.r === ref.r && y.c === ref.c ? 0 : 1;
        return xr - yr;
      });
      for (const m of moves.slice(0, 3)) {
        const before = st.buffer.length, after = A.SolverStrategy.cloneState(st);
        Sim.applyPick(after, m.r, m.c);
        if (after.eliminatedPixels >= after.totalPixels) { after.gameWon = true; after.gameOver = true; }
        const isReference = m.r === ref.r && m.c === ref.c;
        const direct = isReference ? evidenceFromAfter(A, after, actions.slice(i + 1), before, i + 1, progress) : null;
        const directAmp = direct && direct.completed ? direct.amplitude : null;
        if (directAmp != null && directAmp >= MIN_AMP) {
          attempts.push({ decision: decisions, referenceStep: i + 1, classification: 'direct_significant', evidence: direct.evidence });
          return { status: 'found', found: true, decisionsTried: decisions, alternativesTried: attempts.length,
            evidence: direct.evidence, counts: { direct_significant: 1 }, attempts };
        }
        const searched = SA.searchFromState(after, { timeBudgetMs: 350, maxNodes: 1200,
          beamWidth: 16, branchWidth: 8, maxRoutes: 1 });
        let searchedEvidence = null;
        if (searched.routes.length) searchedEvidence = evidenceFromAfter(A, after, searched.routes[0].actions, before, i + 1, progress);
        let classification = 'no_route_not_exhausted';
        if (searchedEvidence && searchedEvidence.completed && searchedEvidence.amplitude >= MIN_AMP) classification = 'search_significant';
        else if (directAmp != null && directAmp > 0) classification = 'direct_below_threshold';
        else if (searchedEvidence && searchedEvidence.completed) classification = 'search_below_threshold';
        else if (!searched.routes.length && searched.budgetExhausted) classification = 'budget_unknown';
        else if (searched.routes.length) classification = 'route_replay_failed';
        attempts.push({ decision: decisions, referenceStep: i + 1, progress: +progress.toFixed(4),
          beforeBuffer: before, isReference,
          action: { r: m.r, c: m.c, color: m.antBox ? m.antBox.color : m.color, count: m.antBox ? m.antBox.count : m.count },
          directAmplitude: directAmp,
          searchedEvidence: searchedEvidence && searchedEvidence.evidence || null,
          classification, search: { routes: searched.routes.length, budgetExhausted: !!searched.budgetExhausted } });
        if (classification === 'search_significant') {
          return { status: 'found', found: true, decisionsTried: decisions, alternativesTried: attempts.length,
            evidence: searchedEvidence.evidence, counts: { search_significant: 1 }, attempts };
        }
      }
    }
    Sim.applyPick(st, actions[i].r, actions[i].c);
    if (st.eliminatedPixels >= st.totalPixels) { st.gameWon = true; st.gameOver = true; }
  }
  const counts = {};
  for (const a of attempts) counts[a.classification] = (counts[a.classification] || 0) + 1;
  return { status: counts.budget_unknown ? 'unknown_within_budget' : 'not_found_within_budget',
    found: false, decisionsTried: decisions, alternativesTried: attempts.length, evidence: null, counts, attempts };
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
  const states = collectStates(A, parsed, r.solveResult), selected = selectStates(states);
  const start = Date.now();
  const release = evaluateSelected(A, parsed, r.solveResult, selected);
  const q = A.Quality.fromGeneration(r);
  const evidenceAmp = release.evidence && release.evidence.releaseAmplitude;
  const rec = {
    shape: spec.shape, seed: spec.seed, valid: !!r.valid,
    structuralPass: !!spec.structuralPass, expectedStep: spec.expectedStep,
    expectedHash: spec.expectedHash, actualHash, hashMismatch: actualHash !== spec.expectedHash,
    genMs: Date.now() - t0, evalMs: Date.now() - start,
    selectedStates: selected, release,
    significantFound: !!(release.status === 'found' && evidenceAmp >= MIN_AMP && release.evidence.finalReplayValid),
    expectedStepFound: !!(spec.expectedStep && release.evidence && release.evidence.referenceStep === spec.expectedStep && evidenceAmp >= MIN_AMP),
    metrics: { significantReleaseCount: curve.metrics && curve.metrics.significantReleaseCount,
      midBuffer34Pct: curve.metrics && curve.metrics.midBuffer34Pct, reasons: curve.reasons || [] },
    structure: { struct: !!G.goalStructPass(r), pass: !!G.goalResultExperiencePass(r, cfgFor(spec)),
      gateReasons: q.gateReasons || [], freeRunMax: r.goodV3 && r.goodV3.fillCurve && r.goodV3.fillCurve.freeRunMax,
      fullMedian2: r.goodV3 && r.goodV3.fillCurve && r.goodV3.fillCurve.fullMedian2 },
    hash: actualHash
  };
  console.log(JSON.stringify({ shape: rec.shape, seed: rec.seed, hashMismatch: rec.hashMismatch,
    release: rec.release.status, amplitude: evidenceAmp, step: rec.release.evidence && rec.release.evidence.referenceStep,
    significantFound: rec.significantFound, expectedStepFound: rec.expectedStepFound, counts: rec.release.counts }));
  return rec;
}

const A = load();
const rows = CASES.map(spec => run(A, spec));
const valid = rows.filter(x => x.valid && !x.hashMismatch);
const structural = rows.filter(x => x.structuralPass);
const structuralFound = structural.filter(x => x.significantFound);
const expectedFound = structural.filter(x => x.expectedStepFound);
const belowThreshold = rows.filter(x => x.release && x.release.attempts &&
  x.release.attempts.some(a => a.classification === 'direct_below_threshold'));
const summary = {
  rows: rows.length, valid: valid.length, hashMatches: valid.length,
  structuralSamples: structural.map(x => x.shape + '/seed' + x.seed),
  structuralSignificantFound: structuralFound.map(x => x.shape + '/seed' + x.seed),
  expectedStepFound: expectedFound.map(x => x.shape + '/seed' + x.seed),
  amplitude1SkippedSamples: belowThreshold.map(x => x.shape + '/seed' + x.seed),
  statuses: rows.map(x => ({ sample: x.shape + '/seed' + x.seed, status: x.release && x.release.status,
    amplitude: x.release && x.release.evidence && x.release.evidence.releaseAmplitude,
    step: x.release && x.release.evidence && x.release.evidence.referenceStep })),
  pass: valid.length === rows.length && structuralFound.length === structural.length,
  decision: valid.length !== rows.length
    ? 'hash复现失败，停止结论。'
    : structuralFound.length === structural.length
      ? 'minReleaseAmplitude=2后两个结构通过样本均找到振幅≥2且回放有效的释放，阈值修复成立。'
      : structuralFound.length > 0
        ? '仅部分结构通过样本找到显著释放，保留单样本信号，不接生产。'
        : 'minReleaseAmplitude=2后仍无结构样本显著释放，转检查释放窗口/搜索实现。'
};
const report = { schema: 'release-significant-threshold-v555', date: '2026-10-26',
  preregistration: '释放显著阈值_预登记_v555.md', summary, rows };
fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ summary }, null, 2));
if (valid.length !== rows.length) process.exitCode = 1;
