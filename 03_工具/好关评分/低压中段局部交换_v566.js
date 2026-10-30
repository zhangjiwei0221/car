#!/usr/bin/env node
/** v566 P3：在010/1002上只交换一对车序，试图延长中段压力并产生显著释放。 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '游戏主bin', 'bin', 'js');
function arg(name, def) {
  const prefix = '--' + name + '=';
  const hit = process.argv.find(x => x.indexOf(prefix) === 0);
  return hit ? hit.slice(prefix.length) : def;
}
const BASE_LEVEL = path.resolve(__dirname, arg('base-level', 'P2P3归因_v566.levels/010_1002.json'));
const BASE_ROUTE = path.resolve(__dirname, arg('base-route', 'P2P3归因_v566.levels/010_1002.route.json'));
const OUT = path.resolve(__dirname, arg('out', '低压中段局部交换_v566.json'));
const LEVEL_DIR = path.resolve(__dirname, arg('levels-dir', '低压中段局部交换_v566.levels'));
const TARGET_START = parseInt(arg('target-start', '10'), 10);
const TARGET_END = parseInt(arg('target-end', '15'), 10);
const DONOR_START = parseInt(arg('donor-start', '16'), 10);
const DONOR_END = parseInt(arg('donor-end', '22'), 10);
const CAP_MIN = parseInt(arg('cap-min', '35'), 10);
const CAP_MAX = parseInt(arg('cap-max', '54'), 10);
const PREREGISTRATION = arg('preregistration', '低压中段局部交换_预登记_v566.md');
const FILES = [
  'utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js',
  'playersim.js', 'analysis.js', 'car-sequencer.js', 'solver-analysis.js',
  'experience-goal.js', 'capacity-tuner.js', 'instant-playout.js', 'generator.js',
  'source-preflight.js'
];
const CFG = {
  generatorFlow: 'new_fixed',
  ruleMode: 'instantChain',
  instantChain: true,
  bottomOnly: false,
  boxSizeMin: CAP_MIN,
  boxSizeMax: CAP_MAX,
  capNormMin: CAP_MIN,
  capNormMax: CAP_MAX,
  boardRowsMin: 6,
  boardRowsMax: 9,
  boardColsMin: 6,
  boardColsMax: 9,
  boardPrefer7: true,
  experienceGoal: true,
  acceptMode: 'target',
  maxDecisionStates: 8,
  stateSampleMode: 'midStratified',
  minReleaseAmplitude: 2
};
const SOLVE_MS = 8000;

let A = null;

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

function hash(x) {
  return crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
}

function median(xs) {
  const a = xs.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function cellOf(level, r, c) {
  return level.board && level.board.cells &&
    level.board.cells[r] && level.board.cells[r][c];
}

function plainBox(cell) {
  return !!(cell && cell.t === 'box' && !(cell.numice > 0) &&
    !(cell.chain > 0) && !cell.q);
}

function evaluate(level, sr, withDecision) {
  const replay = A.SolverAnalysis.replay(level, sr, {
    instantChain: true,
    bottomOnly: false
  });
  const curve = A.Generator.choiceCurve(level, sr);
  const q = A.Quality.fromGeneration({
    level,
    valid: !!(sr && sr.completed),
    config: CFG,
    goodV3: { fillCurve: curve, persist: {} }
  });
  const cap = A.Quality.capacityEvidence(level, CFG);
  const quick = A.ExperienceGoal.evaluate(level, Object.assign({}, CFG, {
    solveResult: sr,
    decision: false
  }));
  const full = withDecision
    ? A.ExperienceGoal.evaluate(level, Object.assign({}, CFG, {
        solveResult: sr,
        decision: true
      }))
    : null;
  const release = full && full.releaseDecision || null;
  const evidence = release && release.evidence || null;
  const hardContract = !!(cap && cap.conserved && cap.perColorConserved === true &&
    cap.boardFloorPass && cap.aboveMax === 0);
  const goalPass = !!(sr && sr.completed && replay.completed && q && q.gatePass &&
    hardContract && full && full.pass && release && release.status === 'found' &&
    evidence && evidence.finalReplayValid === true && evidence.releaseAmplitude >= 2);
  return {
    solved: !!(sr && sr.completed),
    routeReplay: !!replay.completed,
    routeSteps: replay.steps,
    structurePass: !!(q && q.gatePass),
    gateReasons: q && q.gateReasons || [],
    hardContract,
    capacity: {
      conserved: cap && cap.conserved,
      perColorConserved: cap && cap.perColorConserved,
      aboveMax: cap && cap.aboveMax,
      belowMin: cap && cap.belowMin,
      boxSizeMin: cap && cap.boxSizeMin,
      boxSizeMax: cap && cap.boxSizeMax
    },
    curve: {
      fullMedian2: curve && curve.fullMedian2,
      freeRunMax: curve && curve.freeRunMax,
      freeLowPct: curve && curve.freeLowPct,
      forcedPct: curve && curve.forcedPct,
      partialStepPct: curve && curve.partialStepPct
    },
    experience: quick && quick.metrics ? {
      pass: !!(full && full.pass),
      reasons: full && full.reasons || [],
      midBuffer34Pct: quick.metrics.midBuffer34Pct,
      maxBuffer: quick.metrics.maxBuffer,
      midBuffer5Pct: quick.metrics.midBuffer5Pct,
      significantReleaseCount: quick.metrics.significantReleaseCount,
      lateHighPressurePct: quick.metrics.lateHighPressurePct,
      distance: quick.metrics.distance
    } : null,
    release: release ? {
      status: release.status,
      decisionsTried: release.decisionsTried,
      alternativesTried: release.alternativesTried,
      unknownAlternatives: release.unknownAlternatives,
      evidence
    } : null,
    goalPass,
    routeHash: sr && sr.pickOrder ? hash(sr.pickOrder) : null,
    levelHash: hash(level)
  };
}

function playerEvidence(level) {
  try {
    const p = A.PlayerSim.run(level, {
      seed: 7,
      useItems: false,
      capturePreviewStats: true,
      instantChain: true
    });
    return {
      won: !!p.won,
      bufferPeak: p.bufferPeak,
      deathCauses: p.deathCauses || null,
      steps: p.steps,
      elapsedMs: p.elapsedMs
    };
  } catch (e) {
    return { error: String((e && e.message) || e) };
  }
}

function pairCandidates(level, actions) {
  const targets = actions.slice(TARGET_START - 1, TARGET_END);
  const donors = actions.slice(DONOR_START - 1, DONOR_END);
  const out = [];
  const seen = {};
  for (let ti = 0; ti < targets.length; ti++) {
    for (let di = 0; di < donors.length; di++) {
      const a = targets[ti], b = donors[di];
      if (!a || !b || (a.r === b.r && a.c === b.c)) continue;
      const ca = cellOf(level, a.r, a.c), cb = cellOf(level, b.r, b.c);
      if (!plainBox(ca) || !plainBox(cb) || ca.color === cb.color) continue;
      const key = a.r + ',' + a.c + '/' + b.r + ',' + b.c;
      if (seen[key]) continue;
      seen[key] = true;
      out.push({
        target: {
          step: ti + TARGET_START,
          r: a.r,
          c: a.c,
          color: ca.color,
          count: ca.count
        },
        donor: {
          step: di + DONOR_START,
          r: b.r,
          c: b.c,
          color: cb.color,
          count: cb.count
        }
      });
    }
  }
  return out;
}

function applySwap(level, p) {
  const a = cellOf(level, p.target.r, p.target.c);
  const b = cellOf(level, p.donor.r, p.donor.c);
  const color = a.color, count = a.count;
  a.color = b.color; a.count = b.count;
  b.color = color; b.count = count;
}

function main() {
  A = load();
  const rawBase = JSON.parse(fs.readFileSync(BASE_LEVEL, 'utf8'));
  const actions = JSON.parse(fs.readFileSync(BASE_ROUTE, 'utf8'));
  const base = A.parseLevel(rawBase);
  const baseSr = { completed: true, pickOrder: actions };
  const baseRec = Object.assign({ id: 'A/base' }, evaluate(base, baseSr, true));
  const pairs = pairCandidates(base, actions);
  const rows = [];
  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i];
    const t0 = Date.now();
    const level = A.deepClone(base);
    applySwap(level, p);
    const sr = A.Solver.solve(level, { timeBudgetMs: SOLVE_MS, instantChain: true });
    const quick = evaluate(level, sr, false);
    const prefilter = !!(quick.solved && quick.routeReplay && quick.structurePass &&
      quick.hardContract && quick.experience &&
      quick.experience.midBuffer34Pct >= 50 &&
      quick.experience.significantReleaseCount >= 1);
    const rec = prefilter ? evaluate(level, sr, true) : quick;
    rec.id = 'T' + p.target.step + '@' + p.target.r + ',' + p.target.c +
      '/D' + p.donor.step + '@' + p.donor.r + ',' + p.donor.c;
    rec.pair = p;
    rec.prefilterPass = prefilter;
    rec.wallMs = Date.now() - t0;
    rows.push(rec);
    if (rec.goalPass) {
      fs.mkdirSync(LEVEL_DIR, { recursive: true });
      const stem = rec.id.replace(/[+,@\/]/g, '_');
      fs.writeFileSync(path.join(LEVEL_DIR, stem + '.json'), JSON.stringify(level, null, 2) + '\n');
      fs.writeFileSync(path.join(LEVEL_DIR, stem + '.route.json'),
        JSON.stringify(sr.pickOrder || [], null, 2) + '\n');
    }
    console.log('[swap]', rec.id,
      'solved=' + rec.solved,
      'struct=' + rec.structurePass,
      'mid=' + (rec.experience && rec.experience.midBuffer34Pct),
      'sig=' + (rec.experience && rec.experience.significantReleaseCount),
      'goal=' + rec.goalPass,
      'ms=' + rec.wallMs);
  }
  const hits = rows.filter(x => x.goalPass);
  hits.sort((a, b) =>
    (b.experience.significantReleaseCount || 0) - (a.experience.significantReleaseCount || 0) ||
    (b.experience.midBuffer34Pct || 0) - (a.experience.midBuffer34Pct || 0) ||
    (a.experience.lateHighPressurePct || 0) - (b.experience.lateHighPressurePct || 0));
  const selectedHit = hits[0] || null;
  if (selectedHit) {
    const stem = selectedHit.id.replace(/[+,@\/]/g, '_');
    selectedHit.playerSim = playerEvidence(A.parseLevel(
      JSON.parse(fs.readFileSync(path.join(LEVEL_DIR, stem + '.json'), 'utf8'))
    ));
    selectedHit.ablation = {
      before: baseRec.goalPass,
      after: selectedHit.goalPass,
      base: baseRec.experience,
      afterMetrics: selectedHit.experience,
      effectDisappeared: !baseRec.goalPass
    };
  }
  const report = {
    schema: 'low-pressure-local-order-swap-v566',
    date: '2026-10-26',
    preregistration: PREREGISTRATION,
    base: baseRec,
    summary: {
      pairs: pairs.length,
      evaluated: rows.length,
      solved: rows.filter(x => x.solved).length,
      routeReplay: rows.filter(x => x.routeReplay).length,
      structurePass: rows.filter(x => x.structurePass).length,
      prefilterPass: rows.filter(x => x.prefilterPass).length,
      goalPass: hits.length,
      best: selectedHit ? {
        id: selectedHit.id,
        pair: selectedHit.pair,
        midBuffer34Pct: selectedHit.experience.midBuffer34Pct,
        maxBuffer: selectedHit.experience.maxBuffer,
        significantReleaseCount: selectedHit.experience.significantReleaseCount,
        lateHighPressurePct: selectedHit.experience.lateHighPressurePct,
        goalPass: selectedHit.goalPass
      } : null,
      hit: selectedHit,
      wallMsMedian: median(rows.map(x => x.wallMs)),
      wallMsMax: rows.length ? Math.max.apply(null, rows.map(x => x.wallMs)) : null,
      decision: hits.length
        ? '存在单对车序交换使基底完整通过；先做消融和独立样本复核，不进生产。'
        : (pairs.length + '个单对车序交换均未使基底完整通过；P3局部交换本样本否决。')
    },
    rows
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report.summary, null, 2));
}

main();
