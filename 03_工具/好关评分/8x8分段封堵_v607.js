#!/usr/bin/env node
/** v607：8x8分段贪心封堵，每轮只在当前最长免费段加一个冰或双链。 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '游戏主bin', 'bin', 'js');
const BASE_LEVEL = path.join(__dirname, '棋盘混合容量_v576.levels', 'C_8x8_1001.json');
const OUT = path.join(__dirname, '8x8分段封堵_v607.json');
const LEVEL_DIR = path.join(__dirname, '8x8分段封堵_v607.levels');
const SEEDS = [7, 1009, 2027];
const MAX_ROUNDS = 6;
const MAX_ICE = 6;
const MAX_CHAINS = 4;
const CHAIN_ID_START = 2000;
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
const CFG = {
  seed: 1001, ruleMode: 'instantChain', instantChain: true, bottomOnly: false,
  elimOrder: 'instant', boxSizeMin: 6, boxSizeMax: 40,
  capNormMin: 6, capNormMax: 40, boardRowsMin: 8, boardRowsMax: 8,
  boardColsMin: 8, boardColsMax: 8, boardHardRange: true, boardAuto: false,
  p7Repair: false, trapPost: false, localSwapRepair: false,
  experienceGoal: false, maxDecisionStates: 8, stateSampleMode: 'midStratified',
  minReleaseAmplitude: 2
};

function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function plain(cell) {
  return cell && cell.t === 'box' && !cell.numice && !cell.chain && !cell.q;
}

function findFreeRuns(level, solveResult) {
  const curve = G.choiceCurve(A.parseLevel(level), { completed: true, pickOrder: solveResult.pickOrder },
    { instantChain: true, bottomOnly: false });
  const runs = [];
  let start = null;
  for (let i = 0; i <= curve.steps.length; i++) {
    const s = curve.steps[i];
    const free = s && s.full >= 2 && s.free >= 3;
    if (free && start == null) start = i;
    if (!free && start != null) {
      runs.push({
        start,
        end: i - 1,
        len: i - start,
        steps: curve.steps.slice(start, i)
      });
      start = null;
    }
  }
  runs.sort((a, b) => b.len - a.len);
  return runs;
}

function evalLevel(level) {
  const t0 = Date.now();
  const ev = G.evaluateLevel(level, CFG);
  if (!ev || !ev.valid || !ev.level || !ev.solveResult) {
    return { valid: false, reason: ev && ev.lastFailReason || 'invalid', elapsedMs: Date.now() - t0 };
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
  const runs = findFreeRuns(ev.level, ev.solveResult);
  return {
    valid: true,
    level: ev.level,
    solveResult: ev.solveResult,
    levelHash: hash(ev.level),
    quality: quality ? { gatePass: !!quality.gatePass, gateReasons: quality.gateReasons || [] } : null,
    curve: curve ? {
      freeLowPct: curve.freeLowPct,
      freeRunMax: curve.freeRunMax,
      fullMedian2: curve.fullMedian2,
      pressurePct3: curve.pressurePct3,
      pressurePeak: curve.pressurePeak
    } : null,
    experience: exp && exp.metrics ? {
      pass: !!exp.pass,
      maxBuffer: exp.metrics.maxBuffer,
      midBuffer34Pct: exp.metrics.midBuffer34Pct,
      significantReleaseCount: exp.metrics.significantReleaseCount,
      releaseStatus: exp.releaseDecision && exp.releaseDecision.status || null
    } : null,
    capacity: {
      conserved: capacity && capacity.conserved,
      perColorConserved: capacity && capacity.perColorConserved,
      aboveMax: capacity && capacity.aboveMax,
      belowMin: capacity && capacity.belowMin,
      boardFloorPass: capacity && capacity.boardFloorPass
    },
    players,
    runs,
    elapsedMs: Date.now() - t0
  };
}

function score(rec) {
  if (!rec || !rec.valid || !rec.players || !rec.players.every(x => x.won)) return -1e9;
  const gatePass = rec.quality && rec.quality.gatePass ? 1 : 0;
  const expPass = rec.experience && rec.experience.pass ? 1 : 0;
  const freeLow = rec.curve && rec.curve.freeLowPct != null ? rec.curve.freeLowPct : 100;
  const freeRun = rec.curve && rec.curve.freeRunMax != null ? rec.curve.freeRunMax : 100;
  const maxBuffer = rec.experience && rec.experience.maxBuffer || 0;
  const mid = rec.experience && rec.experience.midBuffer34Pct || 0;
  const sig = rec.experience && rec.experience.significantReleaseCount || 0;
  return gatePass * 1e6 + expPass * 3e5 +
    (100 - freeLow) * 100 + (100 - freeRun) * 50 +
    maxBuffer * 1000 + mid * 20 + sig * 500;
}

function pickAtStep(solveResult, step) {
  return (solveResult.pickOrder || []).find(p => p.step === step) || null;
}

function iceCandidate(current, run, at) {
  const p = pickAtStep(current.solveResult, at + 1);
  if (!p) return null;
  const level = A.deepClone(current.level);
  const cell = level.board.cells[p.r] && level.board.cells[p.r][p.c];
  if (!cell || cell.t !== 'box') return null;
  const value = Math.max(4, at + 5);
  cell.numice = value;
  return {
    type: 'ice',
    target: { r: p.r, c: p.c },
    value,
    step: at + 1,
    level
  };
}

function chainCandidate(current, run, at, chainId) {
  const p = pickAtStep(current.solveResult, at + 1);
  if (!p) return null;
  const options = [];
  for (const d of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    const r = p.r + d[0], c = p.c + d[1];
    if (r < 0 || c < 0 || r >= 8 || c >= 8) continue;
    const cell = current.level.board.cells[r][c];
    if (!plain(cell)) continue;
    options.push({ r, c, color: cell.color, count: cell.count });
  }
  if (!options.length) return null;
  options.sort((a, b) => a.count - b.count || a.r - b.r || a.c - b.c);
  const other = options[0];
  const level = A.deepClone(current.level);
  const a = level.board.cells[p.r][p.c], b = level.board.cells[other.r][other.c];
  if (!plain(a) || !plain(b)) return null;
  a.chain = chainId;
  b.chain = chainId;
  return {
    type: 'chain',
    target: { r: p.r, c: p.c, partner: { r: other.r, c: other.c } },
    step: at + 1,
    level
  };
}

function candidateSpecs(current, round, iceCount, chainCount) {
  const runs = current.runs || [];
  if (!runs.length) return [];
  const run = runs[0];
  const positions = Array.from(new Set([
    run.start,
    run.start + Math.floor(Math.max(0, run.len - 1) / 2)
  ]));
  const out = [];
  if (iceCount < MAX_ICE) {
    for (const at of positions) {
      const c = iceCandidate(current, run, at);
      if (c) out.push(c);
    }
  }
  if (chainCount < MAX_CHAINS) {
    for (const at of positions) {
      const c = chainCandidate(current, run, at, CHAIN_ID_START + round * 10 + chainCount);
      if (c) out.push(c);
    }
  }
  return out;
}

const base = JSON.parse(fs.readFileSync(BASE_LEVEL, 'utf8'));
let current = evalLevel(base);
if (!current.valid) throw new Error('8x8 base invalid');
const history = [];
let iceCount = 0, chainCount = 0;

for (let round = 1; round <= MAX_ROUNDS; round++) {
  const specs = candidateSpecs(current, round, iceCount, chainCount);
  if (!specs.length) break;
  const evaluated = specs.map(spec => {
    const rec = evalLevel(spec.level);
    rec.added = {
      type: spec.type,
      target: spec.target,
      value: spec.value || null,
      step: spec.step
    };
    rec.score = score(rec);
    return rec;
  });
  evaluated.sort((a, b) => b.score - a.score);
  const currentScore = score(current);
  const best = evaluated[0];
  const improved = best && best.score > currentScore;
  history.push({
    round,
    current: {
      score: currentScore,
      freeLow: current.curve && current.curve.freeLowPct,
      freeRun: current.curve && current.curve.freeRunMax,
      maxBuffer: current.experience && current.experience.maxBuffer,
      mid34: current.experience && current.experience.midBuffer34Pct
    },
    candidates: evaluated.map(x => ({
      valid: x.valid,
      added: x.added,
      score: x.score,
      freeLow: x.curve && x.curve.freeLowPct,
      freeRun: x.curve && x.curve.freeRunMax,
      maxBuffer: x.experience && x.experience.maxBuffer,
      mid34: x.experience && x.experience.midBuffer34Pct,
      sig: x.experience && x.experience.significantReleaseCount,
      qGate: x.quality && x.quality.gatePass,
      wins: x.players ? x.players.filter(p => p.won).length : 0
    })),
    accepted: improved
  });
  console.log('[v607] round', round, 'current', currentScore,
    'best', best && best.score,
    best && best.added,
    'freeLow=' + (best && best.curve && best.curve.freeLowPct),
    'freeRun=' + (best && best.curve && best.curve.freeRunMax),
    'max=' + (best && best.experience && best.experience.maxBuffer),
    'mid=' + (best && best.experience && best.experience.midBuffer34Pct),
    'wins=' + (best && best.players ? best.players.filter(p => p.won).length : 0));
  if (!improved) break;
  current = best;
  if (best.added.type === 'ice') iceCount++;
  else chainCount++;
  if (current.quality && current.quality.gatePass && current.experience && current.experience.pass) break;
}

fs.mkdirSync(LEVEL_DIR, { recursive: true });
const file = path.join(LEVEL_DIR, 'v607_best.json');
fs.writeFileSync(file, JSON.stringify(current.level, null, 2) + '\n');
const report = {
  schema: 'eight-by-eight-segmented-block-v607',
  date: '2026-10-27',
  base: path.relative(ROOT, BASE_LEVEL),
  config: { maxRounds: MAX_ROUNDS, maxIce: MAX_ICE, maxChains: MAX_CHAINS, seeds: SEEDS },
  summary: {
    roundsCompleted: history.length,
    acceptedRounds: history.filter(x => x.accepted).length,
    iceAdded: iceCount,
    chainsAdded: chainCount,
    final: {
      score: score(current),
      qGate: current.quality && current.quality.gatePass,
      gateReasons: current.quality && current.quality.gateReasons,
      experience: current.experience,
      curve: current.curve,
      capacity: current.capacity,
      players: current.players,
      levelFile: path.relative(ROOT, file)
    }
  },
  history
};
fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ out: path.relative(ROOT, OUT), summary: report.summary }, null, 2));
