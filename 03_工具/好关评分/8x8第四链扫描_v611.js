#!/usr/bin/env node
/** v611：在v610三链8x8基底的长段前部扫描第四组小链。 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '完整主bin快照_20261012', 'bin', 'js');
const BASE_LEVEL = path.join(__dirname, '8x8三段结构_v610.levels', 'low_chains.json');
const OUT = path.join(__dirname, '8x8第四链扫描_v611.json');
const LEVEL_DIR = path.join(__dirname, '8x8第四链扫描_v611.levels');
const SEEDS = [7, 1009, 2027];
const WINDOW = [24, 34];
const CHAIN_ID = 3101;
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

function plain(cell) {
  return cell && cell.t === 'box' && !cell.chain && !cell.numice && !cell.q;
}

function candidatePairs(route) {
  const seen = {};
  const out = [];
  for (const pick of (route || []).filter(p => p.step >= WINDOW[0] && p.step <= WINDOW[1])) {
    const a = raw.board.cells[pick.r][pick.c];
    for (const d of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const r = pick.r + d[0], c = pick.c + d[1];
      if (r < 0 || c < 0 || r >= 8 || c >= 8) continue;
      const b = raw.board.cells[r][c];
      if (!plain(a) || !plain(b) || (a.count > 18 && b.count > 18)) continue;
      const cells = [
        { r: pick.r, c: pick.c, color: a.color, count: a.count },
        { r, c, color: b.color, count: b.count }
      ].sort((x, y) => x.r - y.r || x.c - y.c);
      const id = cells.map(x => x.r + '_' + x.c).join('__');
      if (seen[id]) continue;
      seen[id] = 1;
      out.push({
        id,
        sourceStep: pick.step,
        cells,
        minCap: Math.min(a.count, b.count),
        sumCap: a.count + b.count
      });
    }
  }
  out.sort((a, b) => a.minCap - b.minCap || a.sumCap - b.sumCap || a.sourceStep - b.sourceStep);
  return out;
}

function build(candidate) {
  const level = A.deepClone(raw);
  for (const pos of candidate.cells) {
    const cell = level.board.cells[pos.r][pos.c];
    if (!plain(cell)) throw new Error('candidate no longer plain');
    cell.chain = CHAIN_ID;
  }
  return level;
}

function evaluate(level, candidate) {
  const t0 = Date.now();
  const ev = G.evaluateLevel(level, CFG);
  if (!ev || !ev.valid || !ev.level || !ev.solveResult) {
    return { id: candidate.id, candidate, valid: false, reason: ev && ev.lastFailReason || 'invalid' };
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
    return { seed, won: !!(ps && ps.won), progress: ps && ps.progress, peak: ps && ps.bufferPeak };
  });
  return {
    id: candidate.id,
    candidate,
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
const candidates = candidatePairs(baseEv.solveResult.pickOrder || []);
const rows = candidates.map(c => evaluate(build(c), c));
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
  const as = a.experience && a.experience.significantReleaseCount || 0;
  const bs = b.experience && b.experience.significantReleaseCount || 0;
  if (as !== bs) return bs - as;
  const ar = a.curve && a.curve.freeRunMax != null ? a.curve.freeRunMax : 999;
  const br = b.curve && b.curve.freeRunMax != null ? b.curve.freeRunMax : 999;
  return ar - br;
});
for (const row of rows) {
  console.log('[v611]', row.id,
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
  schema: 'eight-by-eight-fourth-chain-v611',
  date: '2026-10-27',
  base: path.relative(ROOT, BASE_LEVEL),
  window: WINDOW,
  seeds: SEEDS,
  summary: {
    candidates: candidates.length,
    variants: rows.length,
    valid: rows.filter(x => x.valid).length,
    allSeedsWin: rows.filter(x => x.players && x.players.every(p => p.won)).length,
    maxBuffer3Plus: rows.filter(x => x.experience && x.experience.maxBuffer >= 3).length,
    midNotWorse: rows.filter(x => x.experience && x.experience.midBuffer34Pct >= 18.2).length,
    releaseImproved: rows.filter(x => x.experience && x.experience.significantReleaseCount > 0).length,
    qGate: rows.filter(x => x.quality && x.quality.gatePass).length,
    best: rows[0] || null
  },
  saved,
  rows
};
fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ out: path.relative(ROOT, OUT), summary: report.summary }, null, 2));
