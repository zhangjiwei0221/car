#!/usr/bin/env node
/** v609：v607的8x8基底上同时组合2～4个中段数字冰。 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '完整主bin快照_20261012', 'bin', 'js');
const BASE_LEVEL = path.join(__dirname, '8x8分段封堵_v607.levels', 'v607_best.json');
const OUT = path.join(__dirname, '8x8多点组合冰_v609.json');
const LEVEL_DIR = path.join(__dirname, '8x8多点组合冰_v609.levels');
const SEEDS = [7, 1009, 2027];
const POINTS = [
  { step: 26, r: 3, c: 7 },
  { step: 37, r: 4, c: 3 },
  { step: 42, r: 6, c: 2 },
  { step: 48, r: 6, c: 5 }
];
const DOSES = ['low', 'high'];
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
const raw = JSON.parse(fs.readFileSync(BASE_LEVEL, 'utf8'));
const CFG = {
  seed: 1001, ruleMode: 'instantChain', instantChain: true, bottomOnly: false,
  elimOrder: 'instant', boxSizeMin: 6, boxSizeMax: 40,
  capNormMin: 6, capNormMax: 40, boardRowsMin: 8, boardRowsMax: 8,
  boardColsMin: 8, boardColsMax: 8, boardHardRange: true, boardAuto: false,
  p7Repair: false, trapPost: false, localSwapRepair: false,
  experienceGoal: false, maxDecisionStates: 8, stateSampleMode: 'midStratified',
  minReleaseAmplitude: 2
};

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

function applyCombo(indices, doseMode) {
  const level = A.deepClone(raw);
  const cells = indices.map(i => {
    const p = POINTS[i];
    const value = p.step + (doseMode === 'low' ? 2 : 8);
    const cell = level.board.cells[p.r][p.c];
    if (!cell || cell.t !== 'box') throw new Error('bad combo point');
    cell.numice = value;
    return { r: p.r, c: p.c, color: cell.color, count: cell.count, step: p.step, value };
  });
  return { level, cells };
}

function evaluate(level, id, added) {
  const t0 = Date.now();
  const ev = G.evaluateLevel(level, CFG);
  if (!ev || !ev.valid || !ev.level || !ev.solveResult) {
    return { id, added, valid: false, reason: ev && ev.lastFailReason || 'invalid', elapsedMs: Date.now() - t0 };
  }
  const quality = A.Quality.fromGeneration(ev);
  const curve = ev.goodV3 && ev.goodV3.fillCurve || null;
  const capacity = A.Quality.capacityEvidence(ev.level, CFG);
  let exp = null;
  try {
    exp = A.ExperienceGoal.evaluate(ev.level, {
      solveResult: ev.solveResult, decision: true, instantChain: true,
      maxDecisionStates: 8, stateSampleMode: 'midStratified', minReleaseAmplitude: 2
    });
  } catch (e) {
    exp = { error: String(e && e.message || e) };
  }
  const parsed = A.parseLevel(ev.level);
  const players = SEEDS.map(seed => {
    const ps = A.PlayerSim.run(parsed, { seed, instantChain: true });
    return {
      seed,
      won: !!(ps && ps.won),
      progress: ps && ps.progress,
      peak: ps && ps.bufferPeak
    };
  });
  return {
    id,
    added,
    valid: true,
    hash: crypto.createHash('sha256').update(JSON.stringify(ev.level)).digest('hex'),
    quality: quality ? { gatePass: !!quality.gatePass, gateReasons: quality.gateReasons || [] } : null,
    curve: curve ? {
      freeLowPct: curve.freeLowPct,
      freeRunMax: curve.freeRunMax,
      fullMedian2: curve.fullMedian2,
      pressurePct3: curve.pressurePct3,
      pressurePeak: curve.pressurePeak
    } : null,
    capacity: {
      conserved: capacity && capacity.conserved,
      perColorConserved: capacity && capacity.perColorConserved,
      aboveMax: capacity && capacity.aboveMax,
      belowMin: capacity && capacity.belowMin,
      boardFloorPass: capacity && capacity.boardFloorPass
    },
    experience: exp && exp.metrics ? {
      pass: !!exp.pass,
      maxBuffer: exp.metrics.maxBuffer,
      midBuffer34Pct: exp.metrics.midBuffer34Pct,
      significantReleaseCount: exp.metrics.significantReleaseCount,
      releaseStatus: exp.releaseDecision && exp.releaseDecision.status || null
    } : null,
    players,
    elapsedMs: Date.now() - t0,
    _level: ev.level
  };
}

const combos = [];
for (const size of [2, 3, 4]) combinations(POINTS.length, size, 0, [], combos);
const rows = [];
for (const doseMode of DOSES) {
  for (const indices of combos) {
    const built = applyCombo(indices, doseMode);
    const id = doseMode + '_' + indices.map(i => 's' + POINTS[i].step).join('_');
    rows.push(evaluate(built.level, id, built.cells));
  }
}
rows.sort((a, b) => {
  if ((a.valid ? 1 : 0) !== (b.valid ? 1 : 0)) return (b.valid ? 1 : 0) - (a.valid ? 1 : 0);
  const aw = a.players && a.players.every(p => p.won) ? 1 : 0;
  const bw = b.players && b.players.every(p => p.won) ? 1 : 0;
  if (aw !== bw) return bw - aw;
  const am = a.experience && a.experience.maxBuffer || 0;
  const bm = b.experience && b.experience.maxBuffer || 0;
  if (am !== bm) return bm - am;
  const amid = a.experience && a.experience.midBuffer34Pct || 0;
  const bmid = b.experience && b.experience.midBuffer34Pct || 0;
  if (amid !== bmid) return bmid - amid;
  const alp = a.curve && a.curve.freeLowPct != null ? a.curve.freeLowPct : 100;
  const blp = b.curve && b.curve.freeLowPct != null ? b.curve.freeLowPct : 100;
  return alp - blp;
});
for (const row of rows) {
  console.log('[v609]', row.id,
    'valid=' + row.valid,
    'q=' + (row.quality && row.quality.gatePass),
    'max=' + (row.experience && row.experience.maxBuffer),
    'mid=' + (row.experience && row.experience.midBuffer34Pct),
    'sig=' + (row.experience && row.experience.significantReleaseCount),
    'freeLow=' + (row.curve && row.curve.freeLowPct),
    'freeRun=' + (row.curve && row.curve.freeRunMax),
    'wins=' + (row.players ? row.players.filter(x => x.won).length : 0));
}

fs.mkdirSync(LEVEL_DIR, { recursive: true });
const saved = [];
for (const row of rows.slice(0, 8)) {
  if (!row.valid) continue;
  const file = path.join(LEVEL_DIR, row.id + '.json');
  fs.writeFileSync(file, JSON.stringify(row._level, null, 2) + '\n');
  saved.push({ id: row.id, levelFile: path.relative(ROOT, file) });
}
for (const row of rows) delete row._level;

const report = {
  schema: 'eight-by-eight-multi-ice-v609',
  date: '2026-10-27',
  base: path.relative(ROOT, BASE_LEVEL),
  points: POINTS,
  seeds: SEEDS,
  summary: {
    variants: rows.length,
    valid: rows.filter(x => x.valid).length,
    allSeedsWin: rows.filter(x => x.players && x.players.every(p => p.won)).length,
    maxBuffer3Plus: rows.filter(x => x.experience && x.experience.maxBuffer >= 3).length,
    midPressure: rows.filter(x => x.experience && x.experience.midBuffer34Pct > 0).length,
    qGate: rows.filter(x => x.quality && x.quality.gatePass).length,
    best: rows[0] || null
  },
  saved,
  rows
};
fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ out: path.relative(ROOT, OUT), summary: report.summary }, null, 2));
