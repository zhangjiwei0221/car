#!/usr/bin/env node
/** v563：在v562唯一fullMedian=3诊断关上只搜索第二对交换。 */
'use strict';

const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '游戏主bin', 'bin', 'js');
const IMAGE = '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_007.txt';
const SEED = parseInt((process.argv.find(function(x) { return x.indexOf('--seed=') === 0; }) || '--seed=1001')
  .slice('--seed='.length), 10) || 1001;
const DIAG = path.join(__dirname, '满载中位局部交换_v562.levels', '007_7x9_' + SEED + '_diagnostic_best.json');
const OUT_ARG = (process.argv.find(function(x) { return x.indexOf('--out=') === 0; }) || '').slice('--out='.length);
const OUT = OUT_ARG ? path.resolve(ROOT, OUT_ARG) : path.join(__dirname, SEED === 1001 ? '满载中位二次交换_v563.json' : '满载中位二次交换_v563_seed' + SEED + '.json');
const LEVEL_OUT = path.join(__dirname, '满载中位二次交换_v563.levels');
const MAX_VARIANTS = parseInt((process.argv.find(function(x) { return x.indexOf('--max-variants=') === 0; }) || '--max-variants=1000')
  .slice('--max-variants='.length), 10) || 1000;
const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js',
  'playersim.js', 'analysis.js', 'car-sequencer.js', 'solver-analysis.js', 'experience-goal.js',
  'capacity-tuner.js', 'instant-playout.js', 'generator.js', 'source-preflight.js'];

function load() {
  const sb = {
    console: { log() { }, warn() { }, error() { } }, module: { exports: {} },
    WeakMap, Map, Set, Date, Math, JSON, setTimeout, clearTimeout, Infinity
  };
  vm.createContext(sb);
  for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BIN, f), 'utf8'), sb, { filename: f });
  return sb.AntSolver;
}

function hash(x) {
  return crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
}

function clone(x) {
  return JSON.parse(JSON.stringify(x));
}

function cfgFor(seed) {
  return {
    seed: seed, ruleMode: 'instantChain', generatorFlow: 'new_fixed',
    boxSizeMin: 20, boxSizeMax: 40, capNormMin: 20, capNormMax: 40,
    boardRowsMin: 7, boardRowsMax: 7, boardColsMin: 9, boardColsMax: 9,
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

function compactReasons(q) {
  return q && q.gateReasons || [];
}

function routeCurve(A, level, baseSolve) {
  const replay = A.SolverAnalysis.replay(level, baseSolve, { instantChain: true, bottomOnly: false });
  if (!replay.completed) {
    return { replay: replay, curve: null, solveResult: null };
  }
  const sr = Object.assign({}, baseSolve, {
    completed: true,
    pickOrder: baseSolve.pickOrder,
    steps: replay.steps,
    maxBuffer: replay.maxBuffer,
    avgBuffer: replay.avgBuffer,
    eliminatedPixels: replay.eliminatedPixels,
    totalPixels: replay.totalPixels,
    completedBoxes: replay.state ? replay.state.completedBoxes : null,
    totalBoxes: replay.state ? replay.state.totalBoxes : null
  });
  return {
    replay: replay,
    curve: A.Generator.choiceCurve(A.parseLevel(level), sr),
    solveResult: sr
  };
}

function evaluateWithRoute(A, level, cfg, baseSolve, fullExperience) {
  const rc = routeCurve(A, level, baseSolve);
  const cap = A.Quality.capacityEvidence(level, cfg);
  const capacity = {
    conserved: !!cap.conserved,
    perColorConserved: cap.perColorConserved === true,
    boardFloorPass: !!cap.boardFloorPass,
    minCap: cap.minCap, maxCap: cap.maxCap,
    belowMin: cap.belowMin, aboveMax: cap.aboveMax
  };
  if (!rc.curve) {
    return {
      routeReplay: rc.replay,
      curve: null,
      capacity: capacity,
      structurePass: false,
      structureReasons: ['planned_route_replay_failed:' + (rc.replay.reason || 'incomplete')],
      experiencePass: false,
      experienceReasons: ['planned_route_replay_failed'],
      significantRelease: false,
      finalReplayValid: false
    };
  }
  const q = A.Quality.fromGeneration({
    level: level, valid: true, solveResult: rc.solveResult,
    goodV3: { fillCurve: rc.curve, persist: {} }
  });
  const ev = fullExperience
    ? A.ExperienceGoal.evaluate(level, {
      solveResult: rc.solveResult,
      decision: true,
      instantChain: true,
      maxDecisionStates: 8,
      stateSampleMode: 'midStratified',
      minReleaseAmplitude: 2
    })
    : null;
  const rd = ev && ev.releaseDecision || null;
  return {
    routeReplay: rc.replay,
    curve: rc.curve,
    solveResult: rc.solveResult,
    capacity: capacity,
    structurePass: !!q.gatePass,
    structureReasons: compactReasons(q),
    experiencePass: !!(ev && ev.pass),
    experienceReasons: ev && ev.reasons || [],
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
  const steps = curve && curve.steps || [];
  const runs = [];
  let start = null;
  for (let i = 0; i <= steps.length; i++) {
    const free = i < steps.length && steps[i].full >= 2 && steps[i].free >= 3;
    if (free && start == null) start = i;
    if (!free && start != null) {
      const part = steps.slice(start, i);
      runs.push({
        start: start, end: i - 1, length: part.length,
        startProgress: part[0] && part[0].prog,
        endProgress: part[part.length - 1] && part[part.length - 1].prog,
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
  for (const run of runs.slice(0, 2)) {
    for (const p of run.picks) hot[p.r + ',' + p.c] = true;
  }
  const boxes = [];
  for (let r = 0; r < level.board.rows; r++) for (let c = 0; c < level.board.cols; c++) {
    const x = level.board.cells[r][c];
    if (x && x.t === 'box' && !(x.chain > 0) && !x.q) boxes.push({ r: r, c: c, box: x });
  }
  const hotBoxes = boxes.filter(function(x) { return hot[x.r + ',' + x.c]; });
  const out = [], seen = {};
  for (const h of hotBoxes) {
    const others = boxes.slice().sort(function(a, b) {
      const ah = hot[a.r + ',' + a.c] ? 1 : 0;
      const bh = hot[b.r + ',' + b.c] ? 1 : 0;
      return ah - bh || b.r - a.r || a.box.count - b.box.count;
    });
    for (const d of others) {
      if ((d.r === h.r && d.c === h.c) || d.box.color === h.box.color) continue;
      const key = h.r + ',' + h.c + '/' + d.r + ',' + d.c;
      if (seen[key]) continue;
      seen[key] = true;
      const lv = clone(level);
      const a = lv.board.cells[h.r][h.c], b = lv.board.cells[d.r][d.c];
      const ac = a.color, an = a.count;
      a.color = b.color; a.count = b.count;
      b.color = ac; b.count = an;
      out.push({
        id: 'second-swap/' + key,
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
  const av = [a.structurePass ? 0 : 1, a.fullMedian2 == null ? 99 : a.fullMedian2,
    a.freeRunMax == null ? 99 : a.freeRunMax, a.freeLowPct == null ? 99 : a.freeLowPct];
  const bv = [b.structurePass ? 0 : 1, b.fullMedian2 == null ? 99 : b.fullMedian2,
    b.freeRunMax == null ? 99 : b.freeRunMax, b.freeLowPct == null ? 99 : b.freeLowPct];
  for (let i = 0; i < av.length; i++) if (av[i] !== bv[i]) return av[i] < bv[i];
  return false;
}

function main() {
  const A = load(), G = A.Generator, cfg = cfgFor(SEED);
  const blocks = G.blocksFromTXT(fs.readFileSync(path.join(ROOT, IMAGE), 'utf8'));
  const baseResult = G.produceGoal(blocks, cfg);
  if (!baseResult || !baseResult.level || !baseResult.valid) throw new Error('无法复现7×9/1001基线');
  const first = clone(baseResult.level);
  const a = first.board.cells[2][4], b = first.board.cells[0][8];
  const ac = a.color, an = a.count;
  a.color = b.color; a.count = b.count;
  b.color = ac; b.count = an;
  const diagnostic = JSON.parse(fs.readFileSync(DIAG, 'utf8'));
  const firstHash = hash(first), diagnosticHash = hash(diagnostic);
  const baseEval = evaluateWithRoute(A, first, cfg, baseResult.solveResult, true);
  const runs = freeRuns(baseEval.curve);
  const variants = makeVariants(first, runs);
  const tested = [];
  let best = null, bestCand = null, chosen = null, chosenCand = null;
  for (const v of variants) {
    const ev = evaluateWithRoute(A, v.level, cfg, baseResult.solveResult, false);
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
    if (ev.structurePass && ev.capacity.conserved && ev.capacity.perColorConserved &&
        ev.capacity.boardFloorPass && ev.capacity.aboveMax === 0 &&
        ev.curve.fullMedian2 <= 3 && ev.curve.freeRunMax <= 6 &&
        !chosen) {
      const full = evaluateWithRoute(A, v.level, cfg, baseResult.solveResult, true);
      Object.assign(item, {
        midBuffer34Pct: full.midBuffer34Pct,
        maxBuffer: full.maxBuffer,
        experiencePass: full.experiencePass,
        experienceReasons: full.experienceReasons,
        releaseStatus: full.releaseStatus,
        releaseAmplitude: full.releaseAmplitude,
        finalReplayValid: full.finalReplayValid,
        significantRelease: full.significantRelease
      });
      chosen = full;
      chosenCand = v;
    }
    tested.push(item);
  }
  fs.mkdirSync(LEVEL_OUT, { recursive: true });
  const report = {
    schema: 'full-median-second-swap-v563',
    date: '2026-10-26',
    preregistration: '满载中位二次交换_预登记_v563.md',
    config: { seed: SEED, maxVariants: MAX_VARIANTS },
    baseline: {
      firstSwap: {
        target: { r: 2, c: 4, colorBefore: 34, countBefore: 20, colorAfter: a.color, countAfter: a.count },
        donor: { r: 0, c: 8, colorBefore: 31, countBefore: 29, colorAfter: b.color, countAfter: b.count }
      },
      hashMatchesDiag: firstHash === diagnosticHash,
      structurePass: baseEval.structurePass,
      structureReasons: baseEval.structureReasons,
      fullMedian2: baseEval.curve.fullMedian2,
      freeRunMax: baseEval.curve.freeRunMax,
      freeLowPct: baseEval.curve.freeLowPct,
      midBuffer34Pct: baseEval.midBuffer34Pct,
      maxBuffer: baseEval.maxBuffer,
      experiencePass: baseEval.experiencePass,
      significantRelease: baseEval.significantRelease,
      capacity: baseEval.capacity,
      freeRuns: runs.slice(0, 5)
    },
    variantsTested: tested,
    bestDiagnostic: bestCand ? {
      id: bestCand.id,
      target: bestCand.target,
      donor: bestCand.donor,
      structurePass: best.structurePass,
      structureReasons: best.structureReasons,
      fullMedian2: best.curve && best.curve.fullMedian2,
      freeRunMax: best.curve && best.curve.freeRunMax,
      freeLowPct: best.curve && best.curve.freeLowPct,
      capacity: best.capacity,
      routeReplay: best.routeReplay ? { completed: !!best.routeReplay.completed, reason: best.routeReplay.reason || null, steps: best.routeReplay.steps } : null
    } : null,
    chosen: chosenCand ? {
      id: chosenCand.id,
      target: chosenCand.target,
      donor: chosenCand.donor,
      hash: hash(chosenCand.level),
      structurePass: chosen.structurePass,
      structureReasons: chosen.structureReasons,
      fullMedian2: chosen.curve.fullMedian2,
      freeRunMax: chosen.curve.freeRunMax,
      freeLowPct: chosen.curve.freeLowPct,
      midBuffer34Pct: chosen.midBuffer34Pct,
      maxBuffer: chosen.maxBuffer,
      experiencePass: chosen.experiencePass,
      experienceReasons: chosen.experienceReasons,
      releaseStatus: chosen.releaseStatus,
      releaseAmplitude: chosen.releaseAmplitude,
      finalReplayValid: chosen.finalReplayValid,
      significantRelease: chosen.significantRelease,
      capacity: chosen.capacity
    } : null
  };
  if (bestCand) fs.writeFileSync(path.join(LEVEL_OUT, 'seed' + SEED + '_second_best.json'), JSON.stringify(bestCand.level) + '\n');
  if (chosenCand) fs.writeFileSync(path.join(LEVEL_OUT, 'seed' + SEED + '_second_chosen.json'), JSON.stringify(chosenCand.level) + '\n');
  report.summary = {
    tested: tested.length,
    routeReplayFailed: tested.filter(function(x) { return !x.routeReplay || !x.routeReplay.completed; }).length,
    fullMedianAtMost3: tested.filter(function(x) { return x.fullMedian2 != null && x.fullMedian2 <= 3; }).length,
    freeRunAtMost6: tested.filter(function(x) { return x.freeRunMax != null && x.freeRunMax <= 6; }).length,
    structurePass: tested.filter(function(x) { return x.structurePass; }).length,
    completePass: chosen && chosen.experiencePass && chosen.significantRelease && chosen.finalReplayValid ? 1 : 0,
    decision: chosen ? '第二对交换命中结构与完整目标候选，需跨seed复核。' : '第二对交换未同时满足freeRun≤6、fullMedian≤3和结构门；停止叠交换，转P2全局组合。'
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ summary: report.summary, baseline: report.baseline, best: report.bestDiagnostic, chosen: report.chosen }, null, 2));
}

main();
