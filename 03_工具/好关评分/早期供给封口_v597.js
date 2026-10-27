#!/usr/bin/env node
/** v597：在v594基底的6个开局免费供给格上，穷举2～4个数字冰组合。 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '完整主bin快照_20261012', 'bin', 'js');
const BASE_LEVEL = path.join(__dirname, '短债单车交换_第五轮_v594.levels', '3_0__3_3.json');
const BASE_ROUTE = path.join(__dirname, '短债单车交换_第五轮_v594.levels', '3_0__3_3.route.json');
const OUT = path.join(__dirname, '早期供给封口_v597.json');
const LEVEL_DIR = path.join(__dirname, '早期供给封口_v597.levels');
const ICE_VALUE = 4;
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
const baseLevel = JSON.parse(fs.readFileSync(BASE_LEVEL, 'utf8'));
const baseRoute = JSON.parse(fs.readFileSync(BASE_ROUTE, 'utf8'));
const CFG = {
  seed: 1001, ruleMode: 'instantChain', instantChain: true, bottomOnly: false,
  elimOrder: 'instant', boxSizeMin: 6, boxSizeMax: 40,
  capNormMin: 6, capNormMax: 40, boardRowsMin: 7, boardRowsMax: 7,
  boardColsMin: 7, boardColsMax: 7, boardHardRange: true, boardAuto: false,
  p7Repair: false, trapPost: false, localSwapRepair: false,
  experienceGoal: false, maxDecisionStates: 8, stateSampleMode: 'midStratified',
  minReleaseAmplitude: 2
};

function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function combinations(n, k, start, picked, out) {
  if (picked.length === k) {
    out.push(picked.slice());
    return;
  }
  for (let i = start; i < n; i++) {
    picked.push(i);
    combinations(n, k, i + 1, picked, out);
    picked.pop();
  }
}

function freeSupplyCells(level, route) {
  const parsed = A.parseLevel(level);
  const state = A.Simulator.createState(parsed, {
    useSlotStart: true, bottomOnly: false, instantChain: true
  });
  const actions = A.SolverAnalysis.normalizeActions(route);
  for (let i = 0; i < actions.length; i++) {
    if (i >= 4) break;
    const moves = A.Simulator.listMoves(state).filter(m => !m.blocked && m.canConsume);
    if (i === 0) {
      return moves.map(m => {
        const cell = state.cells[m.r][m.c];
        return {
          r: m.r, c: m.c, color: cell.color, count: cell.count,
          plain: cell.t === 'box' && !cell.numice && !cell.chain && !cell.q
        };
      });
    }
    A.Simulator.applyPick(state, actions[i].r, actions[i].c);
  }
  return [];
}

function measureLine(parsed, order) {
  const S = A.Simulator;
  if (!order || !order.length) return null;
  const state = S.enter(parsed, { useSlotStart: true, instantChain: true });
  const samples = [];
  let lastDone = state.completedBoxes || 0;
  let steps = 0, earlySteps = 0, early34 = 0, r9 = 0, noGood = 0;
  let bridges = 0, hiBefore70 = 0, stepsBefore70 = 0;
  let minPick = 99;
  try {
    for (const action of order) {
      if (!action || action.r == null) continue;
      const moves = S.listMoves(state);
      let safe = 0, good = 0, traps = 0;
      for (const move of moves) {
        if (move.blocked) continue;
        safe++;
        if (move.canConsume) good++;
        else traps++;
      }
      const progress = state.totalBoxes ? state.completedBoxes / state.totalBoxes : 0;
      const buffer = state.buffer.length;
      steps++;
      if (progress < 0.30) {
        earlySteps++;
        if (buffer >= 3 && buffer <= 4) early34++;
      }
      if (progress < 0.70) {
        stepsBefore70++;
        if (buffer >= 4) hiBefore70++;
      }
      if (moves.length < minPick) minPick = moves.length;
      if (moves.length === 1 && progress < 0.90) bridges++;
      if (moves.length >= 2 && good === 1 && traps >= 1) r9++;
      if (good === 0) noGood++;
      S.applyPick(state, action.r, action.c);
      if (state.completedBoxes !== lastDone) {
        lastDone = state.completedBoxes;
        samples.push({ done: lastDone, buf: state.buffer.length });
      }
      if (state.gameOver) break;
    }
  } catch (e) {
    return { error: String(e && e.message || e), steps, samples };
  }
  const totalBoxes = state.totalBoxes || parsed.totalBoxes || 0;
  const limit = parsed.bufferLimit || state.bufferLimit || 5;
  const audit = A.Analysis.chokepointAudit(samples, totalBoxes, limit);
  const release = A.SolverAnalysis.pressureFromSeries(samples.map(s => ({
    buffer: s.buf,
    progress: totalBoxes ? s.done / totalBoxes : 0
  })), limit);
  return {
    steps,
    won: !!(state.eliminatedPixels >= state.totalPixels || state.gameWon),
    bridges,
    r9,
    noGood,
    minPick: minPick === 99 ? 0 : minPick,
    early34Pct: earlySteps ? Math.round(early34 / earlySteps * 100) : 0,
    early34Steps: early34,
    hiBefore70Pct: stepsBefore70 ? Math.round(hiBefore70 / stepsBefore70 * 100) : 0,
    midLatePeak: audit.lateMax,
    midLateAt: audit.lateAt,
    peakBuf: audit.peakBuf,
    significantReleases: release.significantReleaseCount,
    maxReleaseAmplitude: release.releaseAmplitudes && release.releaseAmplitudes.length
      ? Math.max(...release.releaseAmplitudes) : 0
  };
}

function gateFailures(w) {
  if (!w) return ['无指标'];
  const gates = G.CHOKE_V2_GATES;
  const out = [];
  if (w.bridges > gates.bridgeMax) out.push('独木桥');
  if (w.r9 < gates.r9Min) out.push('预算判断点');
  if (w.noGood > gates.noGoodMax) out.push('无满解');
  if (w.hiBefore70Pct > gates.hiBefore70PctMax) out.push('70%前高压');
  if (w.early34Pct < gates.early34MinPct) out.push('前期限压');
  if (w.midLatePeak != null && w.midLatePeak < gates.midLatePeakMin) out.push('中后期峰窗');
  return out;
}

function worstOf(omni, player) {
  const max = key => Math.max(
    omni && omni[key] != null ? omni[key] : -Infinity,
    player && player[key] != null ? player[key] : -Infinity
  );
  const min = key => Math.min(
    omni && omni[key] != null ? omni[key] : Infinity,
    player && player[key] != null ? player[key] : Infinity
  );
  return {
    bridges: max('bridges'),
    r9: min('r9'),
    noGood: max('noGood'),
    hiBefore70Pct: max('hiBefore70Pct'),
    early34Pct: min('early34Pct'),
    midLatePeak: min('midLatePeak')
  };
}

function capacityEvidence(level) {
  const cap = A.Quality.capacityEvidence(level, CFG);
  return {
    conserved: cap && cap.conserved,
    perColorConserved: cap && cap.perColorConserved,
    aboveMax: cap && cap.aboveMax,
    belowMin: cap && cap.belowMin,
    boardFloorPass: cap && cap.boardFloorPass
  };
}

function evaluate(id, level, iceCells) {
  const t0 = Date.now();
  const ev = G.evaluateLevel(level, CFG);
  if (!ev || !ev.valid || !ev.level || !ev.solveResult) {
    return {
      id, iceCells, valid: false, error: ev && ev.lastFailReason || 'no valid level',
      elapsedMs: Date.now() - t0
    };
  }
  const parsed = A.parseLevel(ev.level);
  const omni = measureLine(parsed, ev.solveResult.pickOrder || []);
  const ps = A.PlayerSim.run(parsed, { seed: 7, instantChain: true });
  const player = ps ? measureLine(parsed, ps.pickOrder || []) : null;
  const worst = worstOf(omni, player);
  const failures = gateFailures(worst);
  const quality = A.Quality.fromGeneration(ev);
  const curve = ev.goodV3 && ev.goodV3.fillCurve || null;
  let exp = null;
  try {
    exp = A.ExperienceGoal.evaluate(ev.level, {
      solveResult: ev.solveResult, decision: true, instantChain: true,
      maxDecisionStates: 8, stateSampleMode: 'midStratified', minReleaseAmplitude: 2
    });
  } catch (e) {
    exp = { error: String(e && e.message || e) };
  }
  const rec = {
    id,
    iceCells,
    valid: true,
    levelHash: hash(ev.level),
    capacity: capacityEvidence(ev.level),
    obstacles: A.Analysis.obstacleStats(parsed),
    quality: quality ? {
      gatePass: !!quality.gatePass,
      gateReasons: quality.gateReasons || []
    } : null,
    curve: curve ? {
      freeLowPct: curve.freeLowPct,
      freeRunMax: curve.freeRunMax,
      fullMedian2: curve.fullMedian2,
      selectMedian: curve.selectMedian,
      pressurePct3: curve.pressurePct3,
      pressurePeak: curve.pressurePeak
    } : null,
    experience: exp && exp.metrics ? {
      maxBuffer: exp.metrics.maxBuffer,
      midBuffer34Pct: exp.metrics.midBuffer34Pct,
      significantReleaseCount: exp.metrics.significantReleaseCount,
      releaseStatus: exp.releaseDecision && exp.releaseDecision.status || null,
      pass: !!exp.pass
    } : null,
    player: {
      won: !!(ps && ps.won),
      coveragePct: ps && ps.coveragePct,
      pads: ps && ps.pads
    },
    omni,
    playerLine: player,
    worst,
    cardGate: {
      pass: failures.length === 0,
      failures,
      gates: G.CHOKE_V2_GATES
    },
    elapsedMs: Date.now() - t0
  };
  rec.score = (6 - failures.length) * 1000 +
    Math.min(5, Math.max(0, rec.experience && rec.experience.maxBuffer || 0)) * 30 +
    Math.max(0, worst.midLatePeak || 0) * 20 +
    Math.max(0, worst.early34Pct || 0) * 2 +
    Math.max(0, worst.r9 || 0) * 2 -
    Math.max(0, rec.curve && rec.curve.freeRunMax || 0);
  return Object.assign(rec, { _level: ev.level, _route: ev.solveResult.pickOrder || [] });
}

const supplies = freeSupplyCells(baseLevel, baseRoute);
if (!supplies.length || supplies.some(x => !x.plain)) {
  throw new Error('free supply scan failed: ' + JSON.stringify(supplies));
}
const selections = [];
for (const size of [2, 3, 4]) combinations(supplies.length, size, 0, [], selections);

const rows = [];
for (let i = 0; i < selections.length; i++) {
  const picked = selections[i].map(index => supplies[index]);
  const level = A.deepClone(baseLevel);
  for (const cell of picked) level.board.cells[cell.r][cell.c].numice = ICE_VALUE;
  const id = picked.map(x => x.r + '_' + x.c).join('__');
  const rec = evaluate(id, level, picked.map(x => ({
    r: x.r, c: x.c, color: x.color, count: x.count, numice: ICE_VALUE
  })));
  rows.push(rec);
  console.log('[v597]', (i + 1) + '/' + selections.length, id,
    'valid=' + rec.valid,
    'early=' + (rec.worst && rec.worst.early34Pct),
    'r9=' + (rec.worst && rec.worst.r9),
    'peak=' + (rec.worst && rec.worst.midLatePeak),
    'max=' + (rec.experience && rec.experience.maxBuffer),
    'freeRun=' + (rec.curve && rec.curve.freeRunMax),
    'pass=' + (rec.cardGate && rec.cardGate.pass),
    'ms=' + rec.elapsedMs);
}

const valid = rows.filter(x => x.valid);
valid.sort((a, b) => b.score - a.score);
fs.mkdirSync(LEVEL_DIR, { recursive: true });
const saved = [];
for (const rec of valid.slice(0, 12)) {
  const file = path.join(LEVEL_DIR, rec.id + '.json');
  const routeFile = path.join(LEVEL_DIR, rec.id + '.route.json');
  fs.writeFileSync(file, JSON.stringify(rec._level, null, 2) + '\n');
  fs.writeFileSync(routeFile, JSON.stringify(rec._route, null, 2) + '\n');
  saved.push({
    id: rec.id,
    levelFile: path.relative(ROOT, file),
    routeFile: path.relative(ROOT, routeFile),
    score: rec.score
  });
}
for (const rec of rows) {
  delete rec._level;
  delete rec._route;
}

const report = {
  schema: 'early-supply-ice-combo-v597',
  date: '2026-10-27',
  base: path.relative(ROOT, BASE_LEVEL),
  baseRoute: path.relative(ROOT, BASE_ROUTE),
  iceValue: ICE_VALUE,
  freeSupplyCells: supplies,
  selectionCounts: { two: 15, three: 20, four: 15, total: selections.length },
  gates: G.CHOKE_V2_GATES,
  summary: {
    variants: rows.length,
    valid: valid.length,
    earlyPressure: valid.filter(x => x.worst && x.worst.early34Pct > 0).length,
    earlyGate: valid.filter(x => x.worst && x.worst.early34Pct >= G.CHOKE_V2_GATES.early34MinPct).length,
    maxBuffer3: valid.filter(x => x.experience && x.experience.maxBuffer >= 3).length,
    peakGate: valid.filter(x => x.worst && x.worst.midLatePeak >= G.CHOKE_V2_GATES.midLatePeakMin).length,
    significantRelease: valid.filter(x => x.worst && x.worst.r9 != null &&
      x.playerLine && x.playerLine.significantReleases > 0).length,
    qGate: valid.filter(x => x.quality && x.quality.gatePass).length,
    cardGate: valid.filter(x => x.cardGate && x.cardGate.pass).length,
    best: valid.length ? {
      id: valid[0].id,
      iceCells: valid[0].iceCells,
      score: valid[0].score,
      worst: valid[0].worst,
      maxBuffer: valid[0].experience && valid[0].experience.maxBuffer,
      curve: valid[0].curve,
      failures: valid[0].cardGate.failures
    } : null
  },
  saved,
  rows
};

fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({
  out: path.relative(ROOT, OUT),
  freeSupplyCells: supplies,
  summary: report.summary
}, null, 2));
