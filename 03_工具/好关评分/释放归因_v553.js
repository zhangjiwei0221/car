#!/usr/bin/env node
/** v553：只读归因9x7显著释放事件、前8状态覆盖与24次动作搜索。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '游戏主bin', 'bin', 'js');
const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js',
  'playersim.js', 'analysis.js', 'car-sequencer.js', 'solver-analysis.js', 'experience-goal.js',
  'capacity-tuner.js', 'instant-playout.js', 'generator.js', 'source-preflight.js'];
const IMAGE = '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_007.txt';
const CASES = [
  { shape: '9x7', rows: 9, cols: 7, seed: 1001, expectedHash: '0f72e44ee766c984259f16138bfa5ecde65be9d9edf28e3aed50cc429cb1132e' },
  { shape: '9x7', rows: 9, cols: 7, seed: 1002, expectedHash: 'eeff5444341e501b56573fb996528ee7ffdd6355167bb7ffbda4bec9ee510551' },
  { shape: '9x7', rows: 9, cols: 7, seed: 32677, expectedHash: '4e670942c6ab918a2c6c0e64bf6e00752c25db86c30477aeb59a1e5ca505c1ae' }
];
const OUT = path.resolve(ROOT, '03_工具/好关评分/释放归因_v553.json');
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
function cloneState(A, s) { return A.SolverStrategy.cloneState(s); }
function evidenceFromAfter(A, after, futureActions, beforeBuffer, step, progress) {
  const replayed = A.SolverAnalysis.replayFromState(after, futureActions || []);
  if (!replayed.completed) return { completed: false, replayReason: replayed.reason || null };
  const buffers = [after.buffer.length].concat((replayed.trace || []).slice(0, 4).map(x => x.buffer));
  const minBuffer = Math.min.apply(null, buffers);
  return {
    completed: true, amplitude: beforeBuffer - minBuffer,
    minBufferWithinWindow: minBuffer, finalReplayValid: true,
    routeActions: (futureActions || []).length, step,
    progress: +progress.toFixed(4)
  };
}
function diagnoseSignificantEvents(A, level, route, pressure) {
  const Sim = A.Simulator, SA = A.SolverAnalysis;
  const actions = SA.normalizeActions(route);
  const state = Sim.createState(level, { useSlotStart: true, instantChain: true });
  const highStates = [], byAction = {};
  let ordinal = 0, ordinalAll = 0;
  for (let i = 0; i < actions.length; i++) {
    if (state.gameWon || state.gameOver) break;
    const a = actions[i];
    if (!Sim.isPickable(state, a.r, a.c)) break;
    const progress = state.totalPixels ? state.eliminatedPixels / state.totalPixels : 0;
    if (state.buffer.length >= 3) {
      ordinalAll++;
      const inMidRange = progress >= 0.2 && progress <= 0.85;
      if (inMidRange) ordinal++;
      const rec = {
        ordinal: inMidRange ? ordinal : null, ordinalAll,
        actionIndex: i, step: i + 1, progress: +progress.toFixed(4),
        buffer: state.buffer.length, inMidRange,
        inCurrent8: inMidRange && ordinal <= 8,
        action: { r: a.r, c: a.c, color: a.color, count: a.count }
      };
      highStates.push(rec); byAction[i] = rec;
    }
    Sim.applyPick(state, a.r, a.c);
    if (state.eliminatedPixels >= state.totalPixels) { state.gameWon = true; state.gameOver = true; }
  }
  const events = (pressure && pressure.releaseEvents || []).filter(ev => ev.amplitude >= 2).map(ev => {
    const parentIndex = ev.step - 1;
    const parent = byAction[parentIndex] || null;
    let oracle = { completed: false, reason: 'parent_not_high_pressure_or_out_of_range' };
    if (parent) {
      const st = Sim.createState(level, { useSlotStart: true, instantChain: true });
      let ok = true;
      for (let i = 0; i < parentIndex; i++) {
        if (!Sim.isPickable(st, actions[i].r, actions[i].c)) { ok = false; break; }
        Sim.applyPick(st, actions[i].r, actions[i].c);
      }
      if (ok) {
        const before = st.buffer.length, progress = st.totalPixels ? st.eliminatedPixels / st.totalPixels : 0;
        const after = cloneState(A, st);
        Sim.applyPick(after, actions[parentIndex].r, actions[parentIndex].c);
        if (after.eliminatedPixels >= after.totalPixels) { after.gameWon = true; after.gameOver = true; }
        oracle = evidenceFromAfter(A, after, actions.slice(parentIndex + 1), before, parentIndex + 1, progress);
        oracle.action = parent.action;
      } else {
        oracle = { completed: false, reason: 'reference_prefix_invalid' };
      }
    }
    return {
      event: ev, parentActionIndex: parentIndex,
      parentState: parent,
      outsideCurrent8: !parent || !parent.inCurrent8,
      outsideMidRange: !parent || !parent.inMidRange,
      oracleSuffixReplay: oracle
    };
  });
  return {
    totalHighStates: highStates.length,
    totalMidRangeHighStates: highStates.filter(x => x.inMidRange).length,
    highStates, significantEvents: events
  };
}
function auditCurrentSearch(A, level, route) {
  const Sim = A.Simulator, SA = A.SolverAnalysis;
  const actions = SA.normalizeActions(route);
  const state = Sim.createState(level, { useSlotStart: true, instantChain: true });
  const attempts = [];
  let decisions = 0;
  for (let i = 0; i < actions.length; i++) {
    if (state.gameWon || state.gameOver) break;
    const ref = actions[i];
    if (!Sim.isPickable(state, ref.r, ref.c)) break;
    const progress = state.totalPixels ? state.eliminatedPixels / state.totalPixels : 0;
    if (state.buffer.length >= 3 && progress >= 0.2 && progress <= 0.85 && decisions < 8) {
      decisions++;
      const moves = Sim.listMoves(state).filter(m => !m.blocked);
      moves.sort((x, y) => {
        const xr = x.r === ref.r && x.c === ref.c ? 0 : 1;
        const yr = y.r === ref.r && y.c === ref.c ? 0 : 1;
        return xr - yr;
      });
      for (const m of moves.slice(0, 3)) {
        const before = state.buffer.length;
        const after = cloneState(A, state);
        Sim.applyPick(after, m.r, m.c);
        if (after.eliminatedPixels >= after.totalPixels) { after.gameWon = true; after.gameOver = true; }
        const isReference = m.r === ref.r && m.c === ref.c;
        const direct = isReference ? evidenceFromAfter(A, after, actions.slice(i + 1), before, i + 1, progress) : null;
        const searched = SA.searchFromState(after, {
          timeBudgetMs: 350, maxNodes: 1200, beamWidth: 16,
          branchWidth: 8, maxRoutes: 1
        });
        let searchedEvidence = null;
        if (searched.routes.length) searchedEvidence = evidenceFromAfter(A, after, searched.routes[0].actions, before, i + 1, progress);
        let classification = 'no_route_not_exhausted';
        if (direct && direct.completed && direct.amplitude >= 1) classification = 'direct_release';
        else if (searchedEvidence && searchedEvidence.completed && searchedEvidence.amplitude >= 1) classification = 'search_release';
        else if (searchedEvidence && searchedEvidence.completed && searchedEvidence.amplitude < 1) classification = 'solved_no_release';
        else if (!searched.routes.length && searched.budgetExhausted) classification = 'budget_unknown';
        else if (searched.routes.length && (!searchedEvidence || !searchedEvidence.completed)) classification = 'route_replay_failed';
        attempts.push({
          decision: decisions, referenceStep: i + 1, progress: +progress.toFixed(4), beforeBuffer: before,
          isReference, action: { r: m.r, c: m.c, color: m.antBox ? m.antBox.color : m.color, count: m.antBox ? m.antBox.count : m.count },
          direct, search: { routes: searched.routes.length, status: searched.status, nodes: searched.nodes, budgetExhausted: !!searched.budgetExhausted, elapsedMs: searched.elapsedMs },
          searchedEvidence, classification
        });
      }
    }
    Sim.applyPick(state, ref.r, ref.c);
    if (state.eliminatedPixels >= state.totalPixels) { state.gameWon = true; state.gameOver = true; }
  }
  const counts = {};
  for (const x of attempts) counts[x.classification] = (counts[x.classification] || 0) + 1;
  return { decisions, attempts: attempts.length, counts, rows: attempts };
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
  const events = diagnoseSignificantEvents(A, parsed, r.solveResult, curve.pressure);
  const searchStart = Date.now();
  const searchAudit = auditCurrentSearch(A, parsed, r.solveResult);
  const searchMs = Date.now() - searchStart;
  const q = A.Quality.fromGeneration(r);
  const eventOutside = events.significantEvents.filter(x => x.outsideCurrent8);
  const eventOutsideMid = events.significantEvents.filter(x => x.outsideMidRange);
  const eventOutside8InMid = events.significantEvents.filter(x => !x.outsideMidRange && x.outsideCurrent8);
  const eventOracle = events.significantEvents.filter(x => x.oracleSuffixReplay && x.oracleSuffixReplay.completed && x.oracleSuffixReplay.amplitude >= 2);
  const rec = {
    shape: spec.shape, seed: spec.seed, valid: !!r.valid,
    expectedHash: spec.expectedHash, actualHash, hashMismatch: actualHash !== spec.expectedHash,
    genMs: Date.now() - t0, searchMs,
    metrics: {
      midBuffer34Pct: curve.metrics && curve.metrics.midBuffer34Pct,
      significantReleaseCount: curve.metrics && curve.metrics.significantReleaseCount,
      maxBuffer: curve.metrics && curve.metrics.maxBuffer,
      reasons: curve.reasons || []
    },
    structure: {
      struct: !!G.goalStructPass(r), pass: !!G.goalResultExperiencePass(r, cfgFor(spec)),
      gateReasons: q.gateReasons || [],
      freeRunMax: r.goodV3 && r.goodV3.fillCurve && r.goodV3.fillCurve.freeRunMax,
      fullMedian2: r.goodV3 && r.goodV3.fillCurve && r.goodV3.fillCurve.fullMedian2
    },
    highPressureCoverage: {
      total: events.totalHighStates,
      totalMidRange: events.totalMidRangeHighStates,
      current8Steps: events.highStates.filter(x => x.inCurrent8).map(x => x.step),
      significantEventCount: events.significantEvents.length,
      outsideCurrent8Count: eventOutside.length,
      outsideMidRangeCount: eventOutsideMid.length,
      outsideCurrent8WithinMidCount: eventOutside8InMid.length,
      oracleSignificantCount: eventOracle.length,
      significantEvents: events.significantEvents
    },
    searchAudit
  };
  console.log(JSON.stringify({
    shape: rec.shape, seed: rec.seed, hashMismatch: rec.hashMismatch,
    significantReleaseCount: rec.metrics.significantReleaseCount,
    totalHighStates: rec.highPressureCoverage.total,
    eventOutside8: rec.highPressureCoverage.outsideCurrent8Count,
    eventOutsideMid: rec.highPressureCoverage.outsideMidRangeCount,
    oracleSignificant: rec.highPressureCoverage.oracleSignificantCount,
    searchCounts: rec.searchAudit.counts
  }));
  return rec;
}

const A = load();
const rows = CASES.map(spec => run(A, spec));
const valid = rows.filter(x => x.valid && !x.hashMismatch);
const allEvents = [];
for (const row of valid) for (const ev of row.highPressureCoverage.significantEvents) allEvents.push({ row, ev });
const outsideCovered = allEvents.filter(x => !x.ev.outsideMidRange && x.ev.outsideCurrent8 &&
  x.ev.oracleSuffixReplay && x.ev.oracleSuffixReplay.completed && x.ev.oracleSuffixReplay.amplitude >= 2);
const outsideMid = allEvents.filter(x => x.ev.outsideMidRange);
const budgetUnknown = rows.reduce((n, x) => n + ((x.searchAudit && x.searchAudit.counts && x.searchAudit.counts.budget_unknown) || 0), 0);
const summary = {
  rows: rows.length, valid: valid.length,
  hashMatches: valid.length,
  significantEvents: allEvents.length,
  eventsOutsideCurrent8: allEvents.filter(x => x.ev.outsideCurrent8).length,
  eventsOutsideMidRange: outsideMid.length,
  eventsOutsideButOracleValid: outsideCovered.length,
  budgetUnknownActions: budgetUnknown,
  decision: valid.length !== rows.length
    ? 'hash复现失败，停止归因。'
    : outsideCovered.length > 0
      ? '至少一个中段显著释放父状态在当前前8状态之外，且参考动作+后缀可独立回放形成显著降压：首要归因为中段高压状态覆盖；24次动作搜索仍有预算unknown，但不能把它当唯一原因。'
      : budgetUnknown > 0
        ? '显著释压事件未被当前覆盖/回放解释，24个动作仍预算unknown；下一步需只读检查状态采样边界与释放门槛。'
        : '显著释压事件可由当前8状态覆盖；应回到动作排序/搜索实现归因。'
};
const report = { schema: 'release-attribution-v553', date: '2026-10-26',
  preregistration: '释放归因_预登记_v553.md', summary, rows };
fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ summary }, null, 2));
if (valid.length !== rows.length) process.exitCode = 1;
