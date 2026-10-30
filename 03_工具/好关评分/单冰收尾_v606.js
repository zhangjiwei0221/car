#!/usr/bin/env node
/** v606：在v605三链基底上只加一个定向冰，尝试闭掉剩余免费段。 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '游戏主bin', 'bin', 'js');
const BASE_LEVEL = path.join(__dirname, '双链组合_v605.levels', 'D_existing_large_small.json');
const OUT = path.join(__dirname, '单冰收尾_v606.json');
const LEVEL_DIR = path.join(__dirname, '单冰收尾_v606.levels');
const SEEDS = [7, 1009, 2027];
const CANDIDATES = [
  { r: 4, c: 5, baseStep: 24 },
  { r: 4, c: 4, baseStep: 25 },
  { r: 5, c: 4, baseStep: 26 },
  { r: 5, c: 2, baseStep: 28 }
];
const VALUES = [24, 28, 32];
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
  capNormMin: 6, capNormMax: 40, boardRowsMin: 7, boardRowsMax: 7,
  boardColsMin: 7, boardColsMax: 7, boardHardRange: true, boardAuto: false,
  p7Repair: false, trapPost: false, localSwapRepair: false,
  experienceGoal: false, maxDecisionStates: 8, stateSampleMode: 'midStratified',
  minReleaseAmplitude: 2
};

function configArm(cand, value) {
  const level = A.deepClone(raw);
  const cell = level.board.cells[cand.r] && level.board.cells[cand.r][cand.c];
  if (!cell || cell.t !== 'box') throw new Error('bad ice cell');
  cell.numice = value;
  return level;
}

function evidence(level, seed) {
  const parsed = A.parseLevel(level);
  const ps = A.PlayerSim.run(parsed, { seed, instantChain: true });
  return {
    seed,
    won: !!(ps && ps.won),
    progress: ps && ps.progress,
    picks: ps && ps.picks,
    peak: ps && ps.bufferPeak
  };
}

function evaluate(level, id) {
  const t0 = Date.now();
  const ev = G.evaluateLevel(level, CFG);
  if (!ev || !ev.valid || !ev.level || !ev.solveResult) {
    return { id, valid: false, reason: ev && ev.lastFailReason || 'invalid', elapsedMs: Date.now() - t0 };
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
  return {
    id,
    valid: true,
    levelHash: require('crypto').createHash('sha256').update(JSON.stringify(ev.level)).digest('hex'),
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
    players: SEEDS.map(seed => evidence(ev.level, seed)),
    elapsedMs: Date.now() - t0,
    _level: ev.level
  };
}

const rows = [];
for (const cand of CANDIDATES) {
  for (const value of VALUES) {
    rows.push(evaluate(configArm(cand, value), cand.r + '_' + cand.c + '__ice' + value));
  }
}
for (const row of rows) {
  console.log('[v606]', row.id,
    'valid=' + row.valid,
    'q=' + (row.quality && row.quality.gatePass),
    'freeLow=' + (row.curve && row.curve.freeLowPct),
    'freeRun=' + (row.curve && row.curve.freeRunMax),
    'max=' + (row.experience && row.experience.maxBuffer),
    'mid=' + (row.experience && row.experience.midBuffer34Pct),
    'sig=' + (row.experience && row.experience.significantReleaseCount),
    'wins=' + (row.players ? row.players.filter(x => x.won).length : 0));
}
rows.sort((a, b) => {
  const aq = a.quality && a.quality.gatePass ? 1 : 0;
  const bq = b.quality && b.quality.gatePass ? 1 : 0;
  if (aq !== bq) return bq - aq;
  const aePass = a.experience && a.experience.pass ? 1 : 0;
  const bePass = b.experience && b.experience.pass ? 1 : 0;
  if (aePass !== bePass) return bePass - aePass;
  const ae = a.experience && a.experience.maxBuffer || 0;
  const be = b.experience && b.experience.maxBuffer || 0;
  if (ae !== be) return be - ae;
  const alp = a.curve && a.curve.freeLowPct != null ? a.curve.freeLowPct : 999;
  const blp = b.curve && b.curve.freeLowPct != null ? b.curve.freeLowPct : 999;
  if (alp !== blp) return alp - blp;
  const ar = a.curve && a.curve.freeRunMax != null ? a.curve.freeRunMax : 999;
  const br = b.curve && b.curve.freeRunMax != null ? b.curve.freeRunMax : 999;
  return ar - br;
});

fs.mkdirSync(LEVEL_DIR, { recursive: true });
const saved = [];
for (const row of rows.slice(0, 6)) {
  if (!row.valid) continue;
  const file = path.join(LEVEL_DIR, row.id + '.json');
  fs.writeFileSync(file, JSON.stringify(row._level, null, 2) + '\n');
  saved.push({ id: row.id, levelFile: path.relative(ROOT, file) });
}
for (const row of rows) delete row._level;

const report = {
  schema: 'single-ice-close-v606',
  date: '2026-10-27',
  base: path.relative(ROOT, BASE_LEVEL),
  candidates: CANDIDATES,
  values: VALUES,
  seeds: SEEDS,
  summary: {
    variants: rows.length,
    valid: rows.filter(x => x.valid).length,
    qGate: rows.filter(x => x.quality && x.quality.gatePass).length,
    allSeedsWin: rows.filter(x => x.players && x.players.every(p => p.won)).length,
    maxBuffer3Plus: rows.filter(x => x.experience && x.experience.maxBuffer >= 3).length,
    freeLow30OrLess: rows.filter(x => x.curve && x.curve.freeLowPct <= 30).length,
    freeRun6OrLess: rows.filter(x => x.curve && x.curve.freeRunMax <= 6).length,
    best: rows[0] || null
  },
  saved,
  rows
};

fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ out: path.relative(ROOT, OUT), summary: report.summary }, null, 2));
