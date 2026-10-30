#!/usr/bin/env node
/** v566 M6c：在006/1001固定基底的高压窗口，每次只加一组4-邻接双车锁链。 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '游戏主bin', 'bin', 'js');
const BASE_LEVEL = path.join(__dirname, '目标化障碍基底审计_v566.levels', '006_1001.json');
const BASE_ROUTE = path.join(__dirname, '目标化障碍基底审计_v566.levels', '006_1001.route.json');
const OUT = path.join(__dirname, '目标化锁链_v566.json');
const OUT_LEVEL_DIR = path.join(__dirname, '目标化锁链_v566.levels');
const FILES = [
  'utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js',
  'playersim.js', 'analysis.js', 'car-sequencer.js', 'solver-analysis.js',
  'experience-goal.js', 'capacity-tuner.js', 'instant-playout.js', 'generator.js',
  'source-preflight.js'
];
const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
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

function plainBox(cell) {
  return !!(cell && cell.t === 'box' && !(cell.numice > 0) &&
    !(cell.chain > 0) && !cell.q);
}

function maxChain(level) {
  let max = 0;
  for (let r = 0; r < level.board.rows; r++) {
    for (let c = 0; c < level.board.cols; c++) {
      const cell = cellOf(level, r, c);
      if (cell && cell.t === 'box') max = Math.max(max, cell.chain || 0);
    }
  }
  return max;
}

function capacity(level) {
  return A.Quality.capacityEvidence(level, CFG);
}

function structureFor(level, solveResult) {
  const curve = A.Generator.choiceCurve(level, solveResult);
  const quality = A.Quality.fromGeneration({
    level,
    valid: !!(solveResult && solveResult.completed),
    config: CFG,
    goodV3: { fillCurve: curve, persist: {} }
  });
  return { curve, quality };
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

function evaluateVariant(base, pair, chainId) {
  const t0 = Date.now();
  const level = A.deepClone(base);
  const a = cellOf(level, pair[0].r, pair[0].c);
  const b = cellOf(level, pair[1].r, pair[1].c);
  if (!plainBox(a) || !plainBox(b)) {
    return {
      id: pair.map(p => p.r + ',' + p.c).join('+'),
      candidate: pair,
      skipped: 'pair_not_plain_boxes',
      wallMs: Date.now() - t0
    };
  }
  const before = [
    { r: pair[0].r, c: pair[0].c, color: a.color, count: a.count },
    { r: pair[1].r, c: pair[1].c, color: b.color, count: b.count }
  ];
  a.chain = chainId;
  b.chain = chainId;
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
    id: pair.map(p => p.r + ',' + p.c).join('+') + '/chain' + chainId,
    candidate: { pair, before, chainId },
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
    const stem = rec.id.replace(/[+,\/]/g, '_');
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

function buildPairs(base, baseRoute) {
  const seen = {};
  const pairs = [];
  for (let step = 16; step <= 28 && step <= baseRoute.length; step++) {
    const anchor = baseRoute[step - 1];
    if (!anchor) continue;
    for (const d of DIRS) {
      const r2 = anchor.r + d[0], c2 = anchor.c + d[1];
      const cells = [
        { r: anchor.r, c: anchor.c },
        { r: r2, c: c2 }
      ].sort((x, y) => (x.r - y.r) || (x.c - y.c));
      if (!plainBox(cellOf(base, cells[0].r, cells[0].c)) ||
          !plainBox(cellOf(base, cells[1].r, cells[1].c))) continue;
      const key = cells.map(p => p.r + ',' + p.c).join('/');
      if (seen[key]) continue;
      seen[key] = true;
      pairs.push({ pair: cells, sourceStep: step });
    }
  }
  return pairs;
}

function main() {
  A = load();
  const rawBase = JSON.parse(fs.readFileSync(BASE_LEVEL, 'utf8'));
  const baseRouteActions = JSON.parse(fs.readFileSync(BASE_ROUTE, 'utf8'));
  const baseRoute = {
    completed: true,
    pickOrder: baseRouteActions
  };
  const base = A.parseLevel(rawBase);
  const baseRec = baseSummary(base, baseRoute);
  const candidates = buildPairs(base, baseRouteActions);
  const chainId = maxChain(base) + 1;
  const rows = candidates.map(c => evaluateVariant(base, c.pair, chainId));
  const valid = rows.filter(x => !x.skipped);
  const hits = valid.filter(x => x.goalPass);
  const prefilter = valid.filter(x => x.prefilterPass);
  const best = valid.slice().sort((a, b) => {
    const as0 = a.structurePass ? 1 : 0, bs0 = b.structurePass ? 1 : 0;
    if (as0 !== bs0) return bs0 - as0;
    const ac = a.experience || {}, bc = b.experience || {};
    return (bc.significantReleaseCount || 0) - (ac.significantReleaseCount || 0) ||
      (bc.midBuffer34Pct || 0) - (ac.midBuffer34Pct || 0) ||
      (ac.distance || 999) - (bc.distance || 999);
  })[0] || null;
  let selectedHit = null;
  if (hits.length) {
    const hit = best && best.goalPass ? best : hits[0];
    selectedHit = hit;
    const hitLevelPath = path.join(OUT_LEVEL_DIR, hit.id.replace(/[+,\/]/g, '_') + '.json');
    const hitLevel = A.parseLevel(JSON.parse(fs.readFileSync(hitLevelPath, 'utf8')));
    hit.playerSim = playerEvidence(hitLevel);
    hit.ablation = {
      pair: hit.candidate,
      before: baseRec.goalPass,
      after: hit.goalPass,
      baseMetrics: baseRec.experience,
      afterMetrics: hit.experience,
      effectDisappeared: !baseRec.goalPass
    };
  }
  const report = {
    schema: 'targeted-chain-single-group-v566',
    date: '2026-10-26',
    preregistration: '目标化锁链_预登记_v566.md',
    base: baseRec,
    summary: {
      focusSteps: [16, 28],
      candidates: candidates.length,
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
      hit: selectedHit ? {
        id: selectedHit.id,
        candidate: selectedHit.candidate,
        experience: selectedHit.experience,
        release: selectedHit.release,
        playerSim: selectedHit.playerSim,
        ablation: selectedHit.ablation
      } : null,
      wallMsMedian: median(valid.map(x => x.wallMs)),
      wallMsMax: valid.length ? Math.max.apply(null, valid.map(x => x.wallMs)) : null,
      decision: hits.length
        ? '存在单组锁链候选完整通过；仍需移除消融、玩家模拟和保护样本复核。'
        : (rows.length + '个单组锁链候选均不能同时保持中段≥50%与显著释放≥1；单组锁链否决。')
    },
    rows
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report.summary, null, 2));
}

main();
