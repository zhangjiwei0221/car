#!/usr/bin/env node
/** v605：组合第二段的大小两组双链，检查能否越过剩余结构门。 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '游戏主bin', 'bin', 'js');
const BASE_LEVEL = path.join(__dirname, '封堵安全绕行_v603.levels', 'C_ice11_2_1.json');
const OUT = path.join(__dirname, '双链组合_v605.json');
const LEVEL_DIR = path.join(__dirname, '双链组合_v605.levels');
const SEEDS = [7, 1009, 2027];
const CHAINS = {
  existing: { id: 1005, cells: [{ r: 4, c: 2 }, { r: 4, c: 3 }] },
  large: { id: 1201, cells: [{ r: 3, c: 0 }, { r: 4, c: 0 }] },
  small: { id: 1202, cells: [{ r: 3, c: 3 }, { r: 3, c: 4 }] }
};
const ARMS = [
  { id: 'A_existing', chains: ['existing'] },
  { id: 'B_existing_large', chains: ['existing', 'large'] },
  { id: 'C_existing_small', chains: ['existing', 'small'] },
  { id: 'D_existing_large_small', chains: ['existing', 'large', 'small'] }
];
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

function levelFor(arm) {
  const level = A.deepClone(raw);
  for (const key of arm.chains) {
    const group = CHAINS[key];
    for (const pos of group.cells) {
      const cell = level.board.cells[pos.r] && level.board.cells[pos.r][pos.c];
      if (!cell || cell.t !== 'box') throw new Error('invalid chain cell ' + key);
      cell.chain = group.id;
    }
  }
  return level;
}

function chainEvidence(ps, group) {
  const events = (ps && ps.instantEvents || []).filter(e => e && e.pick);
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const picked = e.pick.picked || [];
    const hit = picked.some(x => group.cells.some(c => c.r === x.r && c.c === x.c)) ||
      group.cells.some(c => c.r === e.pick.r && c.c === e.pick.c);
    if (!hit) continue;
    const trajectory = (ps.tickTrajectory || []).find(x => x.tick === e.tick) || null;
    let release = null;
    for (let j = i + 1; j < events.length; j++) {
      if ((events[j].bufferAfter || 0) < (e.bufferAfter || 0)) {
        const tr = (ps.tickTrajectory || []).find(x => x.tick === events[j].tick) || null;
        release = {
          picksAfter: j - i,
          progress: tr ? tr.progress : null,
          bufferAfter: events[j].bufferAfter
        };
        break;
      }
    }
    return {
      tick: e.tick,
      picked,
      bufferBefore: e.bufferBefore,
      bufferEnter: e.pick.bufEnter,
      bufferAfter: e.bufferAfter,
      progress: trajectory ? trajectory.progress : null,
      release
    };
  }
  return null;
}

function evaluateArm(arm) {
  const level = levelFor(arm);
  const t0 = Date.now();
  const ev = G.evaluateLevel(level, CFG);
  if (!ev || !ev.valid || !ev.level || !ev.solveResult) {
    return { id: arm.id, valid: false, reason: ev && ev.lastFailReason || 'invalid' };
  }
  const parsed = A.parseLevel(ev.level);
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
  const players = SEEDS.map(seed => {
    const ps = A.PlayerSim.run(parsed, { seed, instantChain: true });
    const chains = {};
    for (const key of Object.keys(CHAINS)) {
      if (arm.chains.includes(key)) chains[key] = chainEvidence(ps, CHAINS[key]);
    }
    return {
      seed,
      won: !!(ps && ps.won),
      progress: ps && ps.progress,
      peak: ps && ps.bufferPeak,
      chains
    };
  });
  return {
    id: arm.id,
    valid: true,
    arms: arm.chains,
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

const rows = ARMS.map(evaluateArm);
for (const row of rows) {
  console.log('[v605]', row.id,
    'valid=' + row.valid,
    'q=' + (row.quality && row.quality.gatePass),
    'reasons=' + (row.quality && row.quality.gateReasons.join('|')),
    'freeLow=' + (row.curve && row.curve.freeLowPct),
    'freeRun=' + (row.curve && row.curve.freeRunMax),
    'max=' + (row.experience && row.experience.maxBuffer),
    'mid=' + (row.experience && row.experience.midBuffer34Pct),
    'sig=' + (row.experience && row.experience.significantReleaseCount),
    'wins=' + (row.players ? row.players.filter(x => x.won).length : 0),
    'peaks=' + (row.players ? row.players.map(x => x.peak).join(',') : ''));
}

fs.mkdirSync(LEVEL_DIR, { recursive: true });
const saved = [];
for (const row of rows) {
  if (!row.valid) continue;
  const file = path.join(LEVEL_DIR, row.id + '.json');
  fs.writeFileSync(file, JSON.stringify(row._level, null, 2) + '\n');
  saved.push({ id: row.id, levelFile: path.relative(ROOT, file) });
}
for (const row of rows) delete row._level;

const report = {
  schema: 'dual-second-chain-combo-v605',
  date: '2026-10-27',
  base: path.relative(ROOT, BASE_LEVEL),
  chains: CHAINS,
  seeds: SEEDS,
  summary: {
    variants: rows.length,
    valid: rows.filter(x => x.valid).length,
    qGate: rows.filter(x => x.quality && x.quality.gatePass).length,
    experience: rows.filter(x => x.experience && x.experience.pass).length,
    allSeedsWin: rows.filter(x => x.players && x.players.length === SEEDS.length &&
      x.players.every(p => p.won)).length,
    best: rows.slice().sort((a, b) =>
      (b.quality && b.quality.gatePass ? 1 : 0) - (a.quality && a.quality.gatePass ? 1 : 0) ||
      (b.experience && b.experience.maxBuffer || 0) - (a.experience && a.experience.maxBuffer || 0) ||
      (b.curve && b.curve.freeLowPct != null ? 100 - b.curve.freeLowPct : 0) -
      (a.curve && a.curve.freeLowPct != null ? 100 - a.curve.freeLowPct : 0))[0] || null
  },
  saved,
  rows
};

fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ out: path.relative(ROOT, OUT), summary: report.summary }, null, 2));
