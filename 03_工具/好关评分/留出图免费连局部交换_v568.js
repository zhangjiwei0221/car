#!/usr/bin/env node
/** v568：对008/41001与014/41003的最长免费连做单对交换，沿原计划路线回放。 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '完整主bin快照_20261012', 'bin', 'js');
const LEVEL_DIR = path.join(__dirname, 'M7独立seed留出图_v568.levels');
const OUT = path.join(__dirname, '留出图免费连局部交换_v568.json');
const HIT_DIR = path.join(__dirname, '留出图免费连局部交换_v568.levels');
const FILES = [
  'utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js',
  'playersim.js', 'analysis.js', 'car-sequencer.js', 'solver-analysis.js',
  'experience-goal.js', 'capacity-tuner.js', 'instant-playout.js', 'generator.js',
  'source-preflight.js'
];
const CASES = [
  { image: '008', seed: 41001 },
  { image: '014', seed: 41003 }
];

let A = null;

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

function hash(x) {
  return crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
}

function cellOf(level, r, c) {
  return level.board && level.board.cells &&
    level.board.cells[r] && level.board.cells[r][c];
}

function plainBox(cell) {
  return !!(cell && cell.t === 'box' && !(cell.numice > 0) &&
    !(cell.chain > 0) && !cell.q);
}

function freeRuns(curve) {
  const out = [];
  let cur = null;
  for (let i = 0; i <= curve.steps.length; i++) {
    const s = curve.steps[i];
    const yes = s && s.full >= 2 && s.free >= 3;
    if (yes) {
      if (!cur) cur = { start: i, end: i, actions: [] };
      cur.end = i;
      cur.actions.push(Object.assign({ index: i }, s));
    } else if (cur) {
      out.push(cur);
      cur = null;
    }
  }
  return out.sort((a, b) => b.actions.length - a.actions.length);
}

function makeRouteObject(route) {
  return { completed: true, pickOrder: route };
}

function evaluateLevel(level, route, cfg) {
  const replay = A.SolverAnalysis.replay(level, makeRouteObject(route), {
    instantChain: true,
    bottomOnly: false
  });
  if (!replay.completed) {
    return {
      valid: false,
      reason: replay.reason || 'planned_route_incomplete'
    };
  }
  const curve = A.Generator.choiceCurve(level, makeRouteObject(route));
  if (!curve) return { valid: false, reason: 'choice_curve_null' };
  const cap = A.Quality.capacityEvidence(level, cfg);
  const hardOk = !!(cap && cap.conserved && cap.perColorConserved === true &&
    cap.boardFloorPass && cap.aboveMax === 0);
  const q = A.Quality.fromGeneration({
    level,
    valid: true,
    config: cfg,
    goodV3: { fillCurve: curve, persist: {} }
  });
  const exp = hardOk && q.gatePass
    ? A.ExperienceGoal.evaluate(level, Object.assign({}, cfg, {
        solveResult: makeRouteObject(route),
        decision: true,
        instantChain: true
      }))
    : null;
  return {
    valid: true,
    replay,
    curve,
    capacity: cap,
    hardOk,
    structurePass: !!(q && q.gatePass),
    gateReasons: q && q.gateReasons || [],
    experience: exp,
    goalPass: !!(exp && exp.pass)
  };
}

function runCase(c) {
  const stem = c.image + '_' + c.seed;
  const raw = A.parseLevel(JSON.parse(fs.readFileSync(path.join(LEVEL_DIR, stem + '.json'), 'utf8')));
  const route = JSON.parse(fs.readFileSync(path.join(LEVEL_DIR, stem + '.route.json'), 'utf8'));
  const band = A.Generator.deriveCapacityBand(raw.blocks).band;
  const cfg = { boxSizeMin: band[0], boxSizeMax: band[1], bufferLimit: raw.bufferLimit || 5,
    instantChain: true, bottomOnly: false, maxDecisionStates: 8,
    stateSampleMode: 'midStratified', minReleaseAmplitude: 2 };
  const baseCurve = A.Generator.choiceCurve(raw, makeRouteObject(route));
  const run = freeRuns(baseCurve)[0];
  if (!run) return { image: c.image, seed: c.seed, status: 'no_free_run' };
  const hot = [], hotSeen = {};
  for (const x of run.actions) {
    if (x.full < 4 || x.pick.r == null || x.pick.c == null) continue;
    const key = x.pick.r + ',' + x.pick.c;
    if (hotSeen[key]) continue;
    hotSeen[key] = true;
    hot.push({ r: x.pick.r, c: x.pick.c, color: x.pick.color, count: x.pick.count, full: x.full, free: x.free, step: x.index + 1 });
  }
  const donors = [];
  for (let r = 0; r < raw.board.rows; r++) for (let cc = 0; cc < raw.board.cols; cc++) {
    const cell = cellOf(raw, r, cc);
    if (!plainBox(cell)) continue;
    if (hotSeen[r + ',' + cc]) continue;
    donors.push({ r, c: cc, color: cell.color, count: cell.count });
  }
  const rows = [];
  for (const h of hot) for (const d of donors) {
    if (h.color === d.color) continue;
    const level = A.deepClone(raw);
    const a = cellOf(level, h.r, h.c), b = cellOf(level, d.r, d.c);
    const color = a.color, count = a.count;
    a.color = b.color; a.count = b.count;
    b.color = color; b.count = count;
    const t0 = Date.now();
    const ev = evaluateLevel(level, route, cfg);
    const rec = {
      hot: h,
      donor: d,
      valid: !!ev.valid,
      reason: ev.reason || null,
      structurePass: !!ev.structurePass,
      gateReasons: ev.gateReasons || [],
      freeRunMax: ev.curve && ev.curve.freeRunMax,
      freeLowPct: ev.curve && ev.curve.freeLowPct,
      fullMedian2: ev.curve && ev.curve.fullMedian2,
      hardOk: !!ev.hardOk,
      capacity: ev.capacity || null,
      goalPass: !!ev.goalPass,
      metrics: ev.experience && ev.experience.metrics || null,
      experience: ev.experience || null,
      wallMs: Date.now() - t0
    };
    rec.id = 'H' + h.r + ',' + h.c + '/D' + d.r + ',' + d.c;
    rows.push(rec);
    if (rec.structurePass || rec.goalPass) {
      fs.mkdirSync(HIT_DIR, { recursive: true });
      const fileName = c.image + '_' + c.seed + '_' + rec.id.replace(/[+,\/]/g, '_');
      fs.writeFileSync(path.join(HIT_DIR, fileName + '.json'), JSON.stringify(level, null, 2) + '\n');
      fs.writeFileSync(path.join(HIT_DIR, fileName + '.route.json'), JSON.stringify(route, null, 2) + '\n');
    }
    if (rows.length % 200 === 0) {
      console.log('[progress]', stem, rows.length, 'hits=' + rows.filter(x => x.goalPass).length);
    }
  }
  const hits = rows.filter(x => x.goalPass).sort((a, b) =>
    (b.metrics && b.metrics.midBuffer34Pct || 0) - (a.metrics && a.metrics.midBuffer34Pct || 0));
  const best = rows.slice().sort((a, b) => {
    if (a.structurePass !== b.structurePass) return a.structurePass ? -1 : 1;
    return (a.gateReasons.length - b.gateReasons.length) ||
      ((a.freeRunMax || 999) - (b.freeRunMax || 999)) ||
      ((a.freeLowPct || 999) - (b.freeLowPct || 999));
  })[0] || null;
  console.log('[case]', stem, 'run=' + run.actions.length, 'hot=' + hot.length,
    'donors=' + donors.length, 'tested=' + rows.length,
    'struct=' + rows.filter(x => x.structurePass).length,
    'goal=' + hits.length);
  return {
    image: c.image,
    seed: c.seed,
    base: {
      freeRunMax: baseCurve.freeRunMax,
      freeLowPct: baseCurve.freeLowPct,
      fullMedian2: baseCurve.fullMedian2
    },
    longestFreeRun: {
      startStep: run.start + 1,
      endStep: run.end + 1,
      length: run.actions.length
    },
    hotCount: hot.length,
    donorCount: donors.length,
    tested: rows.length,
    structPassCount: rows.filter(x => x.structurePass).length,
    hardPassCount: rows.filter(x => x.hardOk).length,
    goalPassCount: hits.length,
    best,
    hit: hits[0] || null,
    rows
  };
}

function main() {
  A = load();
  const rows = CASES.map(runCase);
  const hits = rows.filter(x => x.goalPassCount > 0);
  const report = {
    schema: 'heldout-free-run-single-swap-v568',
    date: '2026-10-26',
    preregistration: '留出图免费连局部交换_预登记_v568.md',
    summary: {
      cases: rows.length,
      tested: rows.reduce((n, x) => n + x.tested, 0),
      structuralPassVariants: rows.reduce((n, x) => n + x.structPassCount, 0),
      hardContractVariants: rows.reduce((n, x) => n + (x.hardPassCount || 0), 0),
      goalPassVariants: rows.reduce((n, x) => n + x.goalPassCount, 0),
      casesWithGoalHit: hits.length,
      decision: hits.length
        ? '至少一个留出图可由单对交换修复结构/目标，进入跨seed复核。'
        : '两个代表留出图单对交换均无容量合规的目标命中；P3单对修复继续否决。'
    },
    rows
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report.summary, null, 2));
}

main();
