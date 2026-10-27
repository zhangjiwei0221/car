#!/usr/bin/env node
/** v602：固定两笔债务，扫描中段小容量双锁链，优先80%前释放。 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '完整主bin快照_20261012', 'bin', 'js');
const BASE_LEVEL = path.join(__dirname, '第七步债务窗口_v599.levels', 'ice11_0_2__1_5.json');
const OUT = path.join(__dirname, '小锁链位置扫描_v602.json');
const LEVEL_DIR = path.join(__dirname, '小锁链位置扫描_v602.levels');
const FORCED = { 6: { r: 1, c: 0 }, 8: { r: 2, c: 2 } };
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
const raw = JSON.parse(fs.readFileSync(BASE_LEVEL, 'utf8'));
const parsed = A.parseLevel(raw);
const CFG = {
  seed: 1001, ruleMode: 'instantChain', instantChain: true, bottomOnly: false,
  elimOrder: 'instant', boxSizeMin: 6, boxSizeMax: 40,
  capNormMin: 6, capNormMax: 40, boardRowsMin: 7, boardRowsMax: 7,
  boardColsMin: 7, boardColsMax: 7, boardHardRange: true, boardAuto: false,
  p7Repair: false, trapPost: false, localSwapRepair: false,
  experienceGoal: false, maxDecisionStates: 8, stateSampleMode: 'midStratified',
  minReleaseAmplitude: 2
};

function plain(cell) {
  return cell && cell.t === 'box' && !cell.numice && !cell.chain && !cell.q;
}

function chainCandidates() {
  const out = [];
  for (let r = 3; r < parsed.board.rows; r++) {
    for (let c = 0; c < parsed.board.cols; c++) {
      const a = raw.board.cells[r][c];
      if (!plain(a)) continue;
      for (const d of [[0, 1], [1, 0]]) {
        const rr = r + d[0], cc = c + d[1];
        if (rr >= parsed.board.rows || cc >= parsed.board.cols || rr < 3) continue;
        const b = raw.board.cells[rr][cc];
        if (!plain(b)) continue;
        if (Math.min(a.count, b.count) > 18) continue;
        out.push({
          cells: [
            { r, c, color: a.color, count: a.count },
            { r: rr, c: cc, color: b.color, count: b.count }
          ],
          bothSmall: a.count <= 18 && b.count <= 18,
          minCap: Math.min(a.count, b.count),
          sumCap: a.count + b.count
        });
      }
    }
  }
  return out;
}

function withChain(candidate, id) {
  const level = A.deepClone(raw);
  for (const cell of candidate.cells) level.board.cells[cell.r][cell.c].chain = id;
  return level;
}

function pickedEvents(ps) {
  return (ps && ps.instantEvents || []).filter(e => e && e.pick);
}

function chainEvidence(ps, candidate) {
  const cells = candidate.cells;
  const events = pickedEvents(ps);
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const picked = e.pick.picked || [];
    const hit = picked.some(x => cells.some(c => c.r === x.r && c.c === x.c)) ||
      cells.some(c => c.r === e.pick.r && c.c === e.pick.c);
    if (!hit) continue;
    const trajectory = (ps.tickTrajectory || []).find(x => x.tick === e.tick) || null;
    return {
      eventIndex: i,
      tick: e.tick,
      r: e.pick.r,
      c: e.pick.c,
      boxes: e.pick.boxes,
      chainSize: e.pick.chainSize,
      picked,
      bufferBefore: e.bufferBefore,
      bufferEnter: e.pick.bufEnter,
      bufferAfter: e.bufferAfter,
      progress: trajectory ? trajectory.progress : null
    };
  }
  return null;
}

function releaseOf(ps, chain) {
  if (!chain) return null;
  const events = pickedEvents(ps);
  for (let i = chain.eventIndex + 1; i < events.length; i++) {
    if ((events[i].bufferAfter || 0) < (chain.bufferAfter || 0)) {
      const trajectory = (ps.tickTrajectory || []).find(x => x.tick === events[i].tick) || null;
      return {
        picksAfter: i - chain.eventIndex,
        tick: events[i].tick,
        bufferAfter: events[i].bufferAfter,
        progress: trajectory ? trajectory.progress : null
      };
    }
  }
  return null;
}

function forcedEvidence(ps, force) {
  const events = pickedEvents(ps);
  return Object.keys(force).map(index => {
    const event = events[+index], target = force[index];
    return {
      index: +index,
      applied: !!(event && event.pick && event.pick.r === target.r && event.pick.c === target.c),
      observed: event && event.pick ? {
        r: event.pick.r, c: event.pick.c, color: event.pick.color,
        boxes: event.pick.boxes, bufferBefore: event.bufferBefore,
        bufferEnter: event.pick.bufEnter, bufferAfter: event.bufferAfter
      } : null
    };
  });
}

function runCandidate(candidate, seed, id) {
  const level = withChain(candidate, id);
  const ps = A.PlayerSim.run(A.parseLevel(level), {
    seed, instantChain: true, forcedPicks: FORCED
  });
  const forced = forcedEvidence(ps, FORCED);
  const chain = chainEvidence(ps, candidate);
  const release = releaseOf(ps, chain);
  return {
    seed,
    id: candidate.cells.map(x => x.r + '_' + x.c).join('__'),
    cells: candidate.cells,
    bothSmall: candidate.bothSmall,
    minCap: candidate.minCap,
    sumCap: candidate.sumCap,
    forcedApplied: forced.every(x => x.applied),
    forced,
    won: !!(ps && ps.won),
    progress: ps && ps.progress,
    picks: ps && ps.picks,
    bufferPeak: ps && ps.bufferPeak,
    chain,
    release,
    _level: level,
    _pickOrder: ps && ps.pickOrder || []
  };
}

function finalAudit(level) {
  const ev = A.Generator.evaluateLevel(level, CFG);
  if (!ev || !ev.valid || !ev.level) {
    return { valid: false, reason: ev && ev.lastFailReason || 'invalid' };
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
    valid: true,
    capacity: {
      conserved: capacity && capacity.conserved,
      perColorConserved: capacity && capacity.perColorConserved,
      aboveMax: capacity && capacity.aboveMax,
      belowMin: capacity && capacity.belowMin,
      boardFloorPass: capacity && capacity.boardFloorPass
    },
    quality: quality ? {
      gatePass: !!quality.gatePass,
      gateReasons: quality.gateReasons || []
    } : null,
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
    } : null
  };
}

const candidates = chainCandidates();
const scan = candidates.map((cand, i) => runCandidate(cand, 7, 1000 + i));
scan.sort((a, b) => {
  const aPass = a.won && a.chain && a.chain.bufferAfter > 0 && a.release && a.release.progress <= 0.82;
  const bPass = b.won && b.chain && b.chain.bufferAfter > 0 && b.release && b.release.progress <= 0.82;
  if (aPass !== bPass) return aPass ? -1 : 1;
  if (aPass && bPass) {
    if (a.release.progress !== b.release.progress) return a.release.progress - b.release.progress;
  }
  if (a.bothSmall !== b.bothSmall) return a.bothSmall ? -1 : 1;
  if (a.minCap !== b.minCap) return a.minCap - b.minCap;
  return (b.bufferPeak || 0) - (a.bufferPeak || 0);
});

const staged = scan.filter(x => x.won && x.forcedApplied && x.chain &&
  x.chain.bufferAfter > 0 && x.release && x.release.progress <= 0.82).slice(0, 6);
const validation = [];
for (const primary of staged) {
  for (const seed of [1009, 2027]) {
    validation.push(runCandidate({
      cells: primary.cells,
      bothSmall: primary.bothSmall,
      minCap: primary.minCap,
      sumCap: primary.sumCap
    }, seed, primary.id.split('_').join('') % 100000));
  }
}

for (const row of scan) {
  console.log('[scan]', row.id,
    'small=' + row.bothSmall,
    'min=' + row.minCap,
    'won=' + row.won,
    'forced=' + row.forcedApplied,
    'chainBuf=' + (row.chain && row.chain.bufferAfter),
    'chainAt=' + (row.chain && row.chain.progress),
    'releaseAt=' + (row.release && row.release.progress),
    'peak=' + row.bufferPeak);
}
for (const row of validation) {
  console.log('[verify]', row.id, row.seed,
    'won=' + row.won,
    'chainBuf=' + (row.chain && row.chain.bufferAfter),
    'releaseAt=' + (row.release && row.release.progress),
    'peak=' + row.bufferPeak);
}

const validated = staged.map(primary => {
  const checks = validation.filter(x => x.id === primary.id);
  return {
    id: primary.id,
    cells: primary.cells,
    bothSmall: primary.bothSmall,
    minCap: primary.minCap,
    sumCap: primary.sumCap,
    seed7: {
      won: primary.won,
      bufferPeak: primary.bufferPeak,
      chainBuffer: primary.chain && primary.chain.bufferAfter,
      chainProgress: primary.chain && primary.chain.progress,
      releaseProgress: primary.release && primary.release.progress
    },
    validation: checks.map(x => ({
      seed: x.seed,
      won: x.won,
      bufferPeak: x.bufferPeak,
      chainBuffer: x.chain && x.chain.bufferAfter,
      chainProgress: x.chain && x.chain.progress,
      releaseProgress: x.release && x.release.progress
    })),
    passed: checks.length === 2 && checks.every(x => x.won && x.chain &&
      x.chain.bufferAfter > 0 && x.release && x.release.progress <= 0.82)
  };
});

fs.mkdirSync(LEVEL_DIR, { recursive: true });
const saved = [];
for (const candidate of validated.filter(x => x.passed).slice(0, 5)) {
  const src = staged.find(x => x.id === candidate.id);
  const file = path.join(LEVEL_DIR, candidate.id + '.json');
  const routeFile = path.join(LEVEL_DIR, candidate.id + '.route.json');
  fs.writeFileSync(file, JSON.stringify(src._level, null, 2) + '\n');
  fs.writeFileSync(routeFile, JSON.stringify(src._pickOrder, null, 2) + '\n');
  saved.push({
    id: candidate.id,
    cells: candidate.cells,
    levelFile: path.relative(ROOT, file),
    routeFile: path.relative(ROOT, routeFile),
    finalAudit: finalAudit(src._level)
  });
}

for (const row of scan.concat(validation)) {
  delete row._level;
  delete row._pickOrder;
}
const report = {
  schema: 'small-chain-position-scan-v602',
  date: '2026-10-27',
  base: path.relative(ROOT, BASE_LEVEL),
  forced: FORCED,
  candidateCount: candidates.length,
  summary: {
    scanned: scan.length,
    seed7ChainRetained: scan.filter(x => x.chain && x.chain.bufferAfter > 0).length,
    seed7EarlyRelease: scan.filter(x => x.chain && x.chain.bufferAfter > 0 &&
      x.release && x.release.progress <= 0.82).length,
    seed7Won: scan.filter(x => x.won).length,
    stagedForValidation: staged.length,
    validatedPass: validated.filter(x => x.passed).length,
    validated
  },
  saved,
  seed7: scan,
  validation
};

fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ out: path.relative(ROOT, OUT), summary: report.summary }, null, 2));
