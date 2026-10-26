#!/usr/bin/env node
/** v566 M6c：在006/1001固定基底上，每次只加入一个数字冰格，重解并做目标/消融验证。 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '完整主bin快照_20261012', 'bin', 'js');
const BASE_LEVEL = path.join(__dirname, '目标化障碍基底审计_v566.levels', '006_1001.json');
const BASE_ROUTE = path.join(__dirname, '目标化障碍基底审计_v566.levels', '006_1001.route.json');
const OUT = path.join(__dirname, '目标化数字冰_v566.json');
const OUT_LEVEL_DIR = path.join(__dirname, '目标化数字冰_v566.levels');
const FILES = [
  'utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js',
  'playersim.js', 'analysis.js', 'car-sequencer.js', 'solver-analysis.js',
  'experience-goal.js', 'capacity-tuner.js', 'instant-playout.js', 'generator.js',
  'source-preflight.js'
];
let CANDIDATES = [];
const ICE_DOSES = [10, 15, 20];
const SOLVE_MS = 8000;
const CFG = {
  generatorFlow: 'new_fixed',
  ruleMode: 'instantChain',
  instantChain: true,
  bottomOnly: false,
  boxSizeMin: 19,
  boxSizeMax: 38,
  capNormMin: 19,
  capNormMax: 38,
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

function capacity(level) {
  return A.Quality.capacityEvidence(level, CFG);
}

function structureFor(level, solveResult) {
  const curve = A.Generator.choiceCurve(level, solveResult);
  const q = A.Quality.fromGeneration({
    level,
    valid: !!(solveResult && solveResult.completed),
    config: CFG,
    goodV3: { fillCurve: curve, persist: {} }
  });
  return { curve, quality: q };
}

function baseSummary(level, route) {
  const t0 = Date.now();
  const replay = A.SolverAnalysis.replay(level, route, {
    instantChain: true,
    bottomOnly: false
  });
  const st = structureFor(level, route);
  const cap = capacity(level);
  const quick = A.ExperienceGoal.evaluate(level, Object.assign({}, CFG, {
    solveResult: route,
    decision: false
  }));
  const full = A.ExperienceGoal.evaluate(level, Object.assign({}, CFG, {
    solveResult: route,
    decision: true
  }));
  return summarize({
    id: 'A/base',
    candidate: null,
    level,
    solveResult: route,
    replay,
    curve: st.curve,
    quality: st.quality,
    capacity: cap,
    quick,
    full,
    wallMs: Date.now() - t0
  });
}

function summarize(o) {
  const release = o.full && o.full.releaseDecision || null;
  const evidence = release && release.evidence || null;
  const hardContract = !!(o.capacity && o.capacity.conserved &&
    o.capacity.perColorConserved === true && o.capacity.boardFloorPass &&
    o.capacity.aboveMax === 0);
  const goalPass = !!(o.solveResult && o.solveResult.completed &&
    o.quality && o.quality.gatePass && hardContract &&
    o.full && o.full.pass && release && release.status === 'found' &&
    evidence && evidence.finalReplayValid === true &&
    evidence.releaseAmplitude >= 2);
  return {
    id: o.id,
    candidate: o.candidate,
    solved: !!(o.solveResult && o.solveResult.completed),
    routeSteps: o.replay && o.replay.steps,
    routeReplay: !!(o.replay && o.replay.completed),
    structurePass: !!(o.quality && o.quality.gatePass),
    gateReasons: o.quality && o.quality.gateReasons || [],
    hardContract,
    capacity: {
      conserved: o.capacity && o.capacity.conserved,
      perColorConserved: o.capacity && o.capacity.perColorConserved,
      aboveMax: o.capacity && o.capacity.aboveMax,
      belowMin: o.capacity && o.capacity.belowMin
    },
    curve: {
      fullMedian2: o.curve && o.curve.fullMedian2,
      freeRunMax: o.curve && o.curve.freeRunMax,
      freeLowPct: o.curve && o.curve.freeLowPct,
      forcedPct: o.curve && o.curve.forcedPct,
      partialStepPct: o.curve && o.curve.partialStepPct
    },
    experience: o.quick && o.quick.metrics ? {
      pass: !!(o.full && o.full.pass),
      reasons: o.full && o.full.reasons || [],
      midBuffer34Pct: o.quick.metrics.midBuffer34Pct,
      maxBuffer: o.quick.metrics.maxBuffer,
      midBuffer5Pct: o.quick.metrics.midBuffer5Pct,
      significantReleaseCount: o.quick.metrics.significantReleaseCount,
      lateHighPressurePct: o.quick.metrics.lateHighPressurePct,
      distance: o.quick.metrics.distance
    } : null,
    release: release ? {
      status: release.status,
      decisionsTried: release.decisionsTried,
      alternativesTried: release.alternativesTried,
      unknownAlternatives: release.unknownAlternatives,
      evidence
    } : null,
    goalPass,
    routeHash: o.solveResult && o.solveResult.pickOrder ? hash(o.solveResult.pickOrder) : null,
    levelHash: hash(o.level),
    wallMs: o.wallMs
  };
}

function evaluateVariant(base, cand, dose) {
  const t0 = Date.now();
  const level = A.deepClone(base);
  const cell = cellOf(level, cand.r, cand.c);
  if (!cell || cell.t !== 'box' || cell.numice > 0 || cell.chain > 0 || cell.q) {
    return {
      id: cand.r + ',' + cand.c + '/ice' + dose,
      candidate: Object.assign({}, cand, { ice: dose }),
      skipped: 'cell_not_plain_box',
      wallMs: Date.now() - t0
    };
  }
  const before = {
    color: cell.color,
    count: cell.count,
    numice: cell.numice || 0
  };
  cell.numice = dose;
  const sr = A.Solver.solve(level, {
    timeBudgetMs: SOLVE_MS,
    instantChain: true,
    bottomOnly: false
  });
  const replay = A.SolverAnalysis.replay(level, sr, {
    instantChain: true,
    bottomOnly: false
  });
  const st = structureFor(level, sr);
  const cap = capacity(level);
  const quick = A.ExperienceGoal.evaluate(level, Object.assign({}, CFG, {
    solveResult: sr,
    decision: false
  }));
  const prefilter = !!(
    sr && sr.completed &&
    st.quality && st.quality.gatePass &&
    cap && cap.conserved && cap.perColorConserved === true &&
    cap.boardFloorPass && cap.aboveMax === 0 &&
    quick && quick.metrics &&
    quick.metrics.midBuffer34Pct >= 50 &&
    quick.metrics.significantReleaseCount >= 1
  );
  const full = prefilter
    ? A.ExperienceGoal.evaluate(level, Object.assign({}, CFG, {
        solveResult: sr,
        decision: true
      }))
    : null;
  const rec = summarize({
    id: cand.r + ',' + cand.c + '/ice' + dose,
    candidate: Object.assign({}, cand, { ice: dose, before }),
    level,
    solveResult: sr,
    replay,
    curve: st.curve,
    quality: st.quality,
    capacity: cap,
    quick,
    full,
    wallMs: Date.now() - t0
  });
  rec.prefilterPass = prefilter;
  if (rec.goalPass) {
    fs.mkdirSync(OUT_LEVEL_DIR, { recursive: true });
    const stem = '006_1001_ice_' + cand.r + '_' + cand.c + '_' + dose;
    fs.writeFileSync(path.join(OUT_LEVEL_DIR, stem + '.json'), JSON.stringify(level, null, 2) + '\n');
    fs.writeFileSync(path.join(OUT_LEVEL_DIR, stem + '.route.json'),
      JSON.stringify(sr.pickOrder || [], null, 2) + '\n');
  }
  console.log('[variant]', rec.id,
    'solved=' + rec.solved,
    'struct=' + rec.structurePass,
    'mid=' + (rec.experience && rec.experience.midBuffer34Pct),
    'sig=' + (rec.experience && rec.experience.significantReleaseCount),
    'goal=' + rec.goalPass,
    'ms=' + rec.wallMs);
  return rec;
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
      cleared: !!p.cleared,
      bufferPeak: p.bufferPeak,
      deathCauses: p.deathCauses || null,
      steps: p.steps,
      elapsedMs: p.elapsedMs
    };
  } catch (e) {
    return { error: String((e && e.message) || e) };
  }
}

function main() {
  A = load();
  const rawBase = JSON.parse(fs.readFileSync(BASE_LEVEL, 'utf8'));
  const baseRoute = JSON.parse(fs.readFileSync(BASE_ROUTE, 'utf8'));
  const base = A.parseLevel(rawBase);
  const seenCells = {};
  CANDIDATES = baseRoute.slice(0, 18).map((a, i) => {
    const cell = a && cellOf(base, a.r, a.c);
    if (!a || !cell || cell.t !== 'box' || cell.numice > 0 || cell.chain > 0 || cell.q) return null;
    const key = a.r + ',' + a.c;
    if (seenCells[key]) return null;
    seenCells[key] = true;
    return {
      r: a.r,
      c: a.c,
      sourceStep: i + 1,
      source: 'planned_route_early_supply',
      color: cell.color,
      count: cell.count
    };
  }).filter(Boolean);
  const baseRec = baseSummary(base, baseRoute);
  const rows = [];
  for (const cand of CANDIDATES) {
    for (const dose of ICE_DOSES) rows.push(evaluateVariant(base, cand, dose));
  }
  const valid = rows.filter(x => !x.skipped);
  const hits = valid.filter(x => x.goalPass);
  const prefilter = valid.filter(x => x.prefilterPass);
  const best = valid.slice().sort((a, b) => {
    const as0 = a.structurePass ? 1 : 0, bs0 = b.structurePass ? 1 : 0;
    if (as0 !== bs0) return bs0 - as0;
    const ag = a.goalPass ? 1 : 0, bg = b.goalPass ? 1 : 0;
    if (ag !== bg) return bg - ag;
    const as = (a.experience && a.experience.significantReleaseCount || 0) * 100 +
      (a.experience && a.experience.midBuffer34Pct || 0) -
      (a.experience && a.experience.distance || 999);
    const bs = (b.experience && b.experience.significantReleaseCount || 0) * 100 +
      (b.experience && b.experience.midBuffer34Pct || 0) -
      (b.experience && b.experience.distance || 999);
    return bs - as;
  })[0] || null;
  if (hits.length) {
    const hit = hits.sort((a, b) =>
      (a.candidate.ice - b.candidate.ice) ||
      ((b.experience && b.experience.midBuffer34Pct || 0) -
       (a.experience && a.experience.midBuffer34Pct || 0)))[0];
    const hitLevel = A.parseLevel(JSON.parse(fs.readFileSync(path.join(OUT_LEVEL_DIR,
      '006_1001_ice_' + hit.candidate.r + '_' + hit.candidate.c + '_' + hit.candidate.ice + '.json'), 'utf8')));
    hit.playerSim = playerEvidence(hitLevel);
    hit.ablation = {
      iceCell: hit.candidate,
      before: baseRec.goalPass,
      after: hit.goalPass,
      baseMetrics: baseRec.experience,
      afterMetrics: hit.experience,
      effectDisappeared: !baseRec.goalPass
    };
  }
  const report = {
    schema: 'targeted-numice-single-unit-v566',
    date: '2026-10-26',
    preregistration: '目标化数字冰_预登记_v566.md',
    base: baseRec,
    summary: {
      candidates: CANDIDATES.length,
      doses: ICE_DOSES,
      variants: rows.length,
      evaluated: valid.length,
      skipped: rows.length - valid.length,
      solved: valid.filter(x => x.solved).length,
      structurePass: valid.filter(x => x.structurePass).length,
      prefilterPass: prefilter.length,
      goalPass: hits.length,
      best: best && {
        id: best.id,
        structurePass: best.structurePass,
        midBuffer34Pct: best.experience && best.experience.midBuffer34Pct,
        significantReleaseCount: best.experience && best.experience.significantReleaseCount,
        distance: best.experience && best.experience.distance,
        goalPass: best.goalPass
      },
      hit: hits[0] ? {
        id: hits[0].id,
        candidate: hits[0].candidate,
        experience: hits[0].experience,
        release: hits[0].release,
        playerSim: hits[0].playerSim,
        ablation: hits[0].ablation
      } : null,
      wallMsMedian: median(valid.map(x => x.wallMs)),
      wallMsMax: valid.length ? Math.max.apply(null, valid.map(x => x.wallMs)) : null,
      decision: hits.length
        ? '存在单冰候选使参考路线满足目标；先复核移除消融、PlayerSim 与保护样本，未完成前不进生产。'
        : (rows.length + '个单冰候选均未使参考路线完整通过；数字冰单单元否决，保留为负结果。')
    },
    rows
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report.summary, null, 2));
}

main();
