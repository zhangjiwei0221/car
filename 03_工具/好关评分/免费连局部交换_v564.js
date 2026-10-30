#!/usr/bin/env node
/** v564 M4：9×7/1001只交换一对车，把最长免费连从7降到≤6。 */
'use strict';

const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '游戏主bin', 'bin', 'js');
const IMAGE = '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_007.txt';
const SEED = parseInt((process.argv.find(function(x) { return x.indexOf('--seed=') === 0; }) || '--seed=1001')
  .slice('--seed='.length), 10) || 1001;
const MAX_VARIANTS = parseInt((process.argv.find(function(x) { return x.indexOf('--max-variants=') === 0; }) || '--max-variants=2000')
  .slice('--max-variants='.length), 10) || 2000;
const OUT = path.join(__dirname, SEED === 1001 ? '免费连局部交换_v564.json' : '免费连局部交换_v564_seed' + SEED + '.json');
const LEVEL_DIR = path.join(__dirname, '免费连局部交换_v564.levels');
const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js',
  'playersim.js', 'analysis.js', 'car-sequencer.js', 'solver-analysis.js', 'experience-goal.js',
  'capacity-tuner.js', 'instant-playout.js', 'generator.js', 'source-preflight.js'];

function load() {
  const sb = { console: { log() { }, warn() { }, error() { } }, module: { exports: {} },
    WeakMap, Map, Set, Date, Math, JSON, setTimeout, clearTimeout, Infinity };
  vm.createContext(sb);
  for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BIN, f), 'utf8'), sb, { filename: f });
  return sb.AntSolver;
}
function clone(x) { return JSON.parse(JSON.stringify(x)); }
function hash(x) { return crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex'); }
function cfgFor(seed) {
  return {
    seed: seed, ruleMode: 'instantChain', generatorFlow: 'new_fixed',
    boxSizeMin: 20, boxSizeMax: 40, capNormMin: 20, capNormMax: 40,
    boardRowsMin: 9, boardRowsMax: 9, boardColsMin: 7, boardColsMax: 7,
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
    targetBand3Min: 0, targetBand4Min: 0, targetPlayerPassMin: 0,
    capacityTuneMs: 2000, capacityTuneCars: 4, capacityTuneVariants: 12
  };
}
function evaluateRoute(A, level, cfg, baseSolve, fullExperience) {
  const replay = A.SolverAnalysis.replay(level, baseSolve, { instantChain: true, bottomOnly: false });
  const cap = A.Quality.capacityEvidence(level, cfg);
  const capacity = {
    conserved: !!cap.conserved, perColorConserved: cap.perColorConserved === true,
    boardFloorPass: !!cap.boardFloorPass, minCap: cap.minCap, maxCap: cap.maxCap,
    belowMin: cap.belowMin, aboveMax: cap.aboveMax
  };
  if (!replay.completed) {
    return {
      routeReplay: replay, curve: null, capacity: capacity, structurePass: false,
      structureReasons: ['planned_route_replay_failed:' + (replay.reason || 'incomplete')],
      experiencePass: false, experienceReasons: ['planned_route_replay_failed'],
      significantRelease: false, finalReplayValid: false
    };
  }
  const sr = Object.assign({}, baseSolve, {
    completed: true, pickOrder: baseSolve.pickOrder, steps: replay.steps,
    maxBuffer: replay.maxBuffer, avgBuffer: replay.avgBuffer,
    eliminatedPixels: replay.eliminatedPixels, totalPixels: replay.totalPixels,
    completedBoxes: replay.state ? replay.state.completedBoxes : null,
    totalBoxes: replay.state ? replay.state.totalBoxes : null
  });
  const curve = A.Generator.choiceCurve(A.parseLevel(level), sr);
  const q = curve ? A.Quality.fromGeneration({
    level: level, valid: true, solveResult: sr,
    goodV3: { fillCurve: curve, persist: {} }
  }) : null;
  const ev = fullExperience ? A.ExperienceGoal.evaluate(level, {
    solveResult: sr, decision: true, instantChain: true,
    maxDecisionStates: 8, stateSampleMode: 'midStratified', minReleaseAmplitude: 2
  }) : null;
  const rd = ev && ev.releaseDecision || null;
  return {
    routeReplay: replay, curve: curve, capacity: capacity,
    structurePass: !!(q && q.gatePass), structureReasons: q && q.gateReasons || [],
    experiencePass: !!(ev && ev.pass), experienceReasons: ev && ev.reasons || [],
    releaseStatus: rd && rd.status || null,
    releaseAmplitude: rd && rd.evidence ? rd.evidence.releaseAmplitude : null,
    finalReplayValid: !!(rd && rd.evidence && rd.evidence.finalReplayValid),
    significantRelease: !!(rd && rd.status === 'found' && rd.evidence &&
      rd.evidence.releaseAmplitude >= 2 && rd.evidence.finalReplayValid === true),
    midBuffer34Pct: ev && ev.metrics ? ev.metrics.midBuffer34Pct : null,
    maxBuffer: ev && ev.metrics ? ev.metrics.maxBuffer : null
  };
}
function freeRuns(curve) {
  const steps = curve && curve.steps || [], runs = [];
  let start = null;
  for (let i = 0; i <= steps.length; i++) {
    const free = i < steps.length && steps[i].full >= 2 && steps[i].free >= 3;
    if (free && start == null) start = i;
    if (!free && start != null) {
      const part = steps.slice(start, i);
      runs.push({
        start: start, end: i - 1, length: part.length,
        picks: part.map(function(x) { return x.pick; }),
        steps: part.map(function(x) { return { prog: x.prog, full: x.full, free: x.free, pick: x.pick }; })
      });
      start = null;
    }
  }
  return runs.sort(function(a, b) { return b.length - a.length; });
}
function makeVariants(level, runs) {
  const hot = {};
  for (const run of runs.slice(0, 2)) for (const p of run.picks) hot[p.r + ',' + p.c] = true;
  const boxes = [];
  for (let r = 0; r < level.board.rows; r++) for (let c = 0; c < level.board.cols; c++) {
    const x = level.board.cells[r][c];
    if (x && x.t === 'box' && !(x.chain > 0) && !x.q) boxes.push({ r: r, c: c, box: x });
  }
  const hotBoxes = boxes.filter(function(x) { return hot[x.r + ',' + x.c]; });
  const out = [], seen = {};
  for (const h of hotBoxes) {
    const others = boxes.slice().sort(function(a, b) {
      const ah = hot[a.r + ',' + a.c] ? 1 : 0, bh = hot[b.r + ',' + b.c] ? 1 : 0;
      return ah - bh || b.r - a.r || a.box.count - b.box.count;
    });
    for (const d of others) {
      if ((d.r === h.r && d.c === h.c) || d.box.color === h.box.color) continue;
      const key = h.r + ',' + h.c + '/' + d.r + ',' + d.c;
      if (seen[key]) continue;
      seen[key] = true;
      const lv = clone(level), a = lv.board.cells[h.r][h.c], b = lv.board.cells[d.r][d.c];
      const ac = a.color, an = a.count;
      a.color = b.color; a.count = b.count;
      b.color = ac; b.count = an;
      out.push({
        id: 'free-swap/' + key,
        target: { r: h.r, c: h.c, colorBefore: h.box.color, countBefore: h.box.count, colorAfter: a.color, countAfter: a.count },
        donor: { r: d.r, c: d.c, colorBefore: d.box.color, countBefore: d.box.count, colorAfter: b.color, countAfter: b.count },
        level: lv
      });
      if (out.length >= MAX_VARIANTS) return out;
    }
  }
  return out;
}
function better(a, b) {
  if (!b) return true;
  function tuple(x) {
    return [x.structurePass ? 0 : 1, x.curve && x.curve.freeRunMax != null ? x.curve.freeRunMax : 99,
      x.curve && x.curve.fullMedian2 != null ? x.curve.fullMedian2 : 99,
      x.curve && x.curve.freeLowPct != null ? x.curve.freeLowPct : 99];
  }
  const av = tuple(a), bv = tuple(b);
  for (let i = 0; i < av.length; i++) if (av[i] !== bv[i]) return av[i] < bv[i];
  return false;
}
function main() {
  const A = load(), G = A.Generator, cfg = cfgFor(SEED);
  const blocks = G.blocksFromTXT(fs.readFileSync(path.join(ROOT, IMAGE), 'utf8'));
  const r = G.produceGoal(blocks, cfg);
  if (!r || !r.level || !r.valid) throw new Error('9×7/' + SEED + ' 无法生成基线');
  fs.mkdirSync(LEVEL_DIR, { recursive: true });
  fs.writeFileSync(path.join(LEVEL_DIR, 'base_' + SEED + '.json'), JSON.stringify(r.level) + '\n');
  const base = evaluateRoute(A, r.level, cfg, r.solveResult, true);
  const runs = freeRuns(base.curve);
  const variants = makeVariants(r.level, runs);
  const tested = [];
  let best = null, bestCand = null, chosen = null, chosenCand = null;
  for (const v of variants) {
    const ev = evaluateRoute(A, v.level, cfg, r.solveResult, false);
    const item = {
      id: v.id, target: v.target, donor: v.donor,
      routeReplay: ev.routeReplay ? { completed: !!ev.routeReplay.completed, reason: ev.routeReplay.reason || null, steps: ev.routeReplay.steps } : null,
      structurePass: ev.structurePass, structureReasons: ev.structureReasons,
      fullMedian2: ev.curve ? ev.curve.fullMedian2 : null,
      freeRunMax: ev.curve ? ev.curve.freeRunMax : null,
      freeLowPct: ev.curve ? ev.curve.freeLowPct : null,
      capacity: ev.capacity
    };
    if (better(ev, best)) { best = ev; bestCand = v; }
    if (!chosen && ev.structurePass && ev.capacity.conserved && ev.capacity.perColorConserved &&
        ev.capacity.boardFloorPass && ev.capacity.aboveMax === 0 &&
        ev.curve.fullMedian2 <= 3 && ev.curve.freeRunMax <= 6) {
      const full = evaluateRoute(A, v.level, cfg, r.solveResult, true);
      Object.assign(item, {
        midBuffer34Pct: full.midBuffer34Pct, maxBuffer: full.maxBuffer,
        experiencePass: full.experiencePass, experienceReasons: full.experienceReasons,
        releaseStatus: full.releaseStatus, releaseAmplitude: full.releaseAmplitude,
        finalReplayValid: full.finalReplayValid, significantRelease: full.significantRelease
      });
      chosen = full;
      chosenCand = v;
    }
    tested.push(item);
  }
  if (bestCand) fs.writeFileSync(path.join(LEVEL_DIR, 'best_' + SEED + '.json'), JSON.stringify(bestCand.level) + '\n');
  if (chosenCand) fs.writeFileSync(path.join(LEVEL_DIR, 'chosen_' + SEED + '.json'), JSON.stringify(chosenCand.level) + '\n');
  const report = {
    schema: 'free-run-local-swap-v564',
    date: '2026-10-26',
    preregistration: '免费连局部交换_预登记_v564.md',
    config: { seed: SEED, rows: 9, cols: 7, maxVariants: MAX_VARIANTS },
    baseline: {
      hash: hash(r.level), structurePass: base.structurePass,
      structureReasons: base.structureReasons,
      freeRunMax: base.curve && base.curve.freeRunMax,
      fullMedian2: base.curve && base.curve.fullMedian2,
      freeLowPct: base.curve && base.curve.freeLowPct,
      midBuffer34Pct: base.midBuffer34Pct, maxBuffer: base.maxBuffer,
      experiencePass: base.experiencePass, significantRelease: base.significantRelease,
      capacity: base.capacity, freeRuns: runs
    },
    variantsTested: tested,
    bestDiagnostic: bestCand ? {
      id: bestCand.id, target: bestCand.target, donor: bestCand.donor,
      structurePass: best.structurePass, structureReasons: best.structureReasons,
      fullMedian2: best.curve && best.curve.fullMedian2,
      freeRunMax: best.curve && best.curve.freeRunMax,
      freeLowPct: best.curve && best.curve.freeLowPct,
      capacity: best.capacity,
      routeReplay: best.routeReplay ? { completed: !!best.routeReplay.completed, reason: best.routeReplay.reason || null, steps: best.routeReplay.steps } : null
    } : null,
    chosen: chosenCand ? {
      id: chosenCand.id, target: chosenCand.target, donor: chosenCand.donor,
      hash: hash(chosenCand.level), structurePass: chosen.structurePass,
      structureReasons: chosen.structureReasons,
      fullMedian2: chosen.curve.fullMedian2, freeRunMax: chosen.curve.freeRunMax,
      freeLowPct: chosen.curve.freeLowPct,
      midBuffer34Pct: chosen.midBuffer34Pct, maxBuffer: chosen.maxBuffer,
      experiencePass: chosen.experiencePass, experienceReasons: chosen.experienceReasons,
      releaseStatus: chosen.releaseStatus, releaseAmplitude: chosen.releaseAmplitude,
      finalReplayValid: chosen.finalReplayValid, significantRelease: chosen.significantRelease,
      capacity: chosen.capacity
    } : null
  };
  report.summary = {
    tested: tested.length,
    routeReplayFailed: tested.filter(function(x) { return !x.routeReplay || !x.routeReplay.completed; }).length,
    fullMedianAtMost3: tested.filter(function(x) { return x.fullMedian2 != null && x.fullMedian2 <= 3; }).length,
    freeRunAtMost6: tested.filter(function(x) { return x.freeRunMax != null && x.freeRunMax <= 6; }).length,
    structurePass: tested.filter(function(x) { return x.structurePass; }).length,
    completePass: chosen && chosen.experiencePass && chosen.significantRelease && chosen.finalReplayValid ? 1 : 0,
    decision: chosen ? '单对交换命中免费连修复和完整目标；需检查1002/32677保护。' : '单对交换未同时满足freeRun≤6、fullMedian≤3、结构和完整目标；不叠第二对，转全局组合。'
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ summary: report.summary, baseline: report.baseline, best: report.bestDiagnostic, chosen: report.chosen }, null, 2));
}
main();
