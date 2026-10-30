#!/usr/bin/env node
/** v604：在v603新免费段沿线扫描第二组双锁链。 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '游戏主bin', 'bin', 'js');
const BASE_LEVEL = path.join(__dirname, '封堵安全绕行_v603.levels', 'C_ice11_2_1.json');
const OUT = path.join(__dirname, '第二段锁链封堵_v604.json');
const LEVEL_DIR = path.join(__dirname, '第二段锁链封堵_v604.levels');
const WINDOW_STEPS = [13, 20];
const EXISTING_CHAIN = [{ r: 4, c: 2 }, { r: 4, c: 3 }];
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
  capNormMin: 6, capNormMax: 40, boardRowsMin: 7, boardRowsMax: 7,
  boardColsMin: 7, boardColsMax: 7, boardHardRange: true, boardAuto: false,
  p7Repair: false, trapPost: false, localSwapRepair: false,
  experienceGoal: false, maxDecisionStates: 8, stateSampleMode: 'midStratified',
  minReleaseAmplitude: 2
};

function box(level, r, c) {
  return level.board.cells[r] && level.board.cells[r][c];
}

function plainForNewChain(cell) {
  return cell && cell.t === 'box' && !cell.chain && !cell.q;
}

function candidatePairs(route) {
  const picks = (route || []).filter(p => p.step >= WINDOW_STEPS[0] && p.step <= WINDOW_STEPS[1]);
  const seen = {};
  const out = [];
  for (const pick of picks) {
    for (const d of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const r2 = pick.r + d[0], c2 = pick.c + d[1];
      if (r2 < 0 || c2 < 0 || r2 >= raw.board.rows || c2 >= raw.board.cols) continue;
      const a = box(raw, pick.r, pick.c), b = box(raw, r2, c2);
      if (!plainForNewChain(a) || !plainForNewChain(b)) continue;
      const cells = [
        { r: pick.r, c: pick.c, color: a.color, count: a.count },
        { r: r2, c: c2, color: b.color, count: b.count }
      ].sort((x, y) => x.r - y.r || x.c - y.c);
      const id = cells.map(x => x.r + '_' + x.c).join('__');
      if (seen[id]) continue;
      seen[id] = 1;
      out.push({
        id,
        sourceStep: pick.step,
        cells,
        minCap: Math.min(a.count, b.count),
        hasSmall: a.count <= 18 || b.count <= 18,
        bothSmall: a.count <= 18 && b.count <= 18
      });
    }
  }
  out.sort((a, b) =>
    (b.hasSmall ? 1 : 0) - (a.hasSmall ? 1 : 0) ||
    a.sourceStep - b.sourceStep ||
    a.minCap - b.minCap);
  return out;
}

function withChain(candidate, chainId) {
  const level = A.deepClone(raw);
  for (const pos of candidate.cells) level.board.cells[pos.r][pos.c].chain = chainId;
  return level;
}

function pickedEvents(ps) {
  return (ps && ps.instantEvents || []).filter(e => e && e.pick);
}

function chainEvidence(ps, cells) {
  const events = pickedEvents(ps);
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const picked = e.pick.picked || [];
    const hit = picked.some(x => cells.some(c => c.r === x.r && c.c === x.c)) ||
      cells.some(c => c.r === e.pick.r && c.c === e.pick.c);
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
      boxes: e.pick.boxes,
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

function evalSummary(ev) {
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
    } : null
  };
}

function runCandidate(candidate, chainId) {
  const level = withChain(candidate, chainId);
  const t0 = Date.now();
  const ev = G.evaluateLevel(level, CFG);
  if (!ev || !ev.valid || !ev.level || !ev.solveResult) {
    return { id: candidate.id, valid: false, reason: ev && ev.lastFailReason || 'invalid', elapsedMs: Date.now() - t0 };
  }
  const parsed = A.parseLevel(ev.level);
  const sum = evalSummary(ev);
  const players = SEEDS.map(seed => {
    const ps = A.PlayerSim.run(parsed, { seed, instantChain: true });
    return {
      seed,
      won: !!(ps && ps.won),
      progress: ps && ps.progress,
      peak: ps && ps.bufferPeak,
      addedChain: chainEvidence(ps, candidate.cells),
      existingChain: chainEvidence(ps, EXISTING_CHAIN)
    };
  });
  const solverSteps = {};
  for (const p of ev.solveResult.pickOrder || []) {
    for (const c of candidate.cells) if (p.r === c.r && p.c === c.c) solverSteps[p.step] = 1;
  }
  return Object.assign({
    id: candidate.id,
    valid: true,
    candidate,
    levelHash: require('crypto').createHash('sha256').update(JSON.stringify(ev.level)).digest('hex'),
    solverChain: Object.keys(solverSteps).length ? {
      step: Math.min(...Object.keys(solverSteps).map(Number))
    } : null,
    players,
    elapsedMs: Date.now() - t0,
    _level: ev.level
  }, sum);
}

const baselineEv = G.evaluateLevel(A.deepClone(raw), CFG);
if (!baselineEv || !baselineEv.valid) throw new Error('baseline invalid');
const baseline = Object.assign({
  id: 'baseline_C_ice11_2_1',
  valid: true
}, evalSummary(baselineEv));
const candidates = candidatePairs(baselineEv.solveResult.pickOrder || []);
const rows = [];
for (let i = 0; i < candidates.length; i++) {
  const rec = runCandidate(candidates[i], 1100 + i);
  rows.push(rec);
  console.log('[v604]', (i + 1) + '/' + candidates.length, rec.id,
    'valid=' + rec.valid,
    'q=' + (rec.quality && rec.quality.gatePass),
    'freeLow=' + (rec.curve && rec.curve.freeLowPct),
    'freeRun=' + (rec.curve && rec.curve.freeRunMax),
    'max=' + (rec.experience && rec.experience.maxBuffer),
    'mid=' + (rec.experience && rec.experience.midBuffer34Pct),
    'wins=' + (rec.players ? rec.players.filter(p => p.won).length : 0),
    'chain=' + !!rec.solverChain,
    'ms=' + rec.elapsedMs);
}

const bestBase = baseline.quality && baseline.quality.gatePass ? baseline : null;
rows.sort((a, b) => {
  const aq = a.quality && a.quality.gatePass ? 1 : 0;
  const bq = b.quality && b.quality.gatePass ? 1 : 0;
  if (aq !== bq) return bq - aq;
  const ae = a.experience && a.experience.pass ? 1 : 0;
  const be = b.experience && b.experience.pass ? 1 : 0;
  if (ae !== be) return be - ae;
  const af = a.curve && a.curve.freeLowPct != null ? a.curve.freeLowPct : 999;
  const bf = b.curve && b.curve.freeLowPct != null ? b.curve.freeLowPct : 999;
  if (af !== bf) return af - bf;
  const ar = a.curve && a.curve.freeRunMax != null ? a.curve.freeRunMax : 999;
  const br = b.curve && b.curve.freeRunMax != null ? b.curve.freeRunMax : 999;
  return ar - br;
});

fs.mkdirSync(LEVEL_DIR, { recursive: true });
const saved = [];
for (const rec of rows.slice(0, 8).filter(x => x.valid)) {
  const file = path.join(LEVEL_DIR, rec.id + '.json');
  fs.writeFileSync(file, JSON.stringify(rec._level, null, 2) + '\n');
  saved.push({ id: rec.id, levelFile: path.relative(ROOT, file) });
}
for (const rec of rows) delete rec._level;

const report = {
  schema: 'second-free-segment-chain-v604',
  date: '2026-10-27',
  base: path.relative(ROOT, BASE_LEVEL),
  windowSteps: WINDOW_STEPS,
  candidates: candidates.length,
  baseline,
  summary: {
    variants: rows.length,
    valid: rows.filter(x => x.valid).length,
    qGate: rows.filter(x => x.quality && x.quality.gatePass).length,
    experience: rows.filter(x => x.experience && x.experience.pass).length,
    allSeedsWin: rows.filter(x => x.players && x.players.length === SEEDS.length &&
      x.players.every(p => p.won)).length,
    chainTriggered: rows.filter(x => x.solverChain).length,
    freeLowImproved: rows.filter(x => x.curve && x.curve.freeLowPct < baseline.curve.freeLowPct).length,
    freeRunImproved: rows.filter(x => x.curve && x.curve.freeRunMax < baseline.curve.freeRunMax).length,
    best: rows[0] || null
  },
  saved,
  rows
};

fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ out: path.relative(ROOT, OUT), summary: report.summary }, null, 2));
