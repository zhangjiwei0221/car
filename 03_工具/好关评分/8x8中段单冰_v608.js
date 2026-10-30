#!/usr/bin/env node
/** v608：在v607 8x8关的中段长免费段上只加一个数字冰。 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '游戏主bin', 'bin', 'js');
const BASE_LEVEL = path.join(__dirname, '8x8分段封堵_v607.levels', 'v607_best.json');
const OUT = path.join(__dirname, '8x8中段单冰_v608.json');
const LEVEL_DIR = path.join(__dirname, '8x8中段单冰_v608.levels');
const SEEDS = [7, 1009, 2027];
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

function evaluate(level, id) {
  const t0 = Date.now();
  const ev = G.evaluateLevel(level, CFG);
  if (!ev || !ev.valid || !ev.level || !ev.solveResult) {
    return { id, valid: false, reason: ev && ev.lastFailReason || 'invalid' };
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

const baseEv = G.evaluateLevel(raw, CFG);
const baseParsed = A.parseLevel(baseEv.level);
const baseCurve = A.Generator.choiceCurve(baseParsed, {
  completed: true, pickOrder: baseEv.solveResult.pickOrder
}, { instantChain: true, bottomOnly: false });
let start = null, bestRun = null;
for (let i = 0; i <= baseCurve.steps.length; i++) {
  const s = baseCurve.steps[i], free = s && s.full >= 2 && s.free >= 3;
  if (free && start == null) start = i;
  if (!free && start != null) {
    const run = { start: start + 1, end: i, len: i - start };
    if (!bestRun || run.len > bestRun.len) bestRun = run;
    start = null;
  }
}
if (!bestRun) throw new Error('no free run');
const positions = [
  bestRun.start,
  bestRun.start + Math.floor((bestRun.len - 1) / 3),
  bestRun.start + Math.floor((bestRun.len - 1) / 2),
  bestRun.start + Math.floor((bestRun.len - 1) * 2 / 3)
].filter((x, i, arr) => arr.indexOf(x) === i);
const route = baseEv.solveResult.pickOrder || [];
function pickAtStep(step) {
  return route.find(p => p.step === step) || null;
}

const rows = [];
for (const step of positions) {
  const pick = pickAtStep(step);
  if (!pick) continue;
  for (const add of [2, 8, 16]) {
    const value = step + add;
    const level = A.deepClone(raw);
    const cell = level.board.cells[pick.r] && level.board.cells[pick.r][pick.c];
    if (!cell || cell.t !== 'box') continue;
    cell.numice = value;
    rows.push(evaluate(level, pick.r + '_' + pick.c + '__s' + step + '__ice' + value));
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
  console.log('[v608]', row.id,
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
for (const row of rows.slice(0, 5)) {
  if (!row.valid) continue;
  const file = path.join(LEVEL_DIR, row.id + '.json');
  fs.writeFileSync(file, JSON.stringify(row._level, null, 2) + '\n');
  saved.push({ id: row.id, levelFile: path.relative(ROOT, file) });
}
for (const row of rows) delete row._level;

const report = {
  schema: 'eight-by-eight-mid-ice-v608',
  date: '2026-10-27',
  base: path.relative(ROOT, BASE_LEVEL),
  freeRun: bestRun,
  positions,
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
