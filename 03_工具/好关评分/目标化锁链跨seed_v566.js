#!/usr/bin/env node
/** v566：在多个同类基底上复核“中段高压锚点 + 一组4邻接双车链”的可重复性。 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '完整主bin快照_20261012', 'bin', 'js');
const OUT = path.join(__dirname, '目标化锁链跨seed_v566.json');
const LEVEL_DIR = path.join(__dirname, '目标化锁链跨seed_v566.levels');
const FILES = [
  'utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js',
  'playersim.js', 'analysis.js', 'car-sequencer.js', 'solver-analysis.js',
  'experience-goal.js', 'capacity-tuner.js', 'instant-playout.js', 'generator.js',
  'source-preflight.js'
];
const CASES = [
  ['006', 1002, '1ed22c11f389dcf496d6710b2449488eb1316fc119b5e5c6e6aa2b1c60384530'],
  ['006', 88001, 'c7e87dda9b678f02aec28519e015274be79aeb1d6da17f2873ac8b295e607e7e'],
  ['010', 1001, 'ca5bfa1a24af0122b0eedd0ed2004621b2b8e71c0bf0bcf2196fcbc53b778cb6'],
  ['010', 1002, '12c62fab4c850d0063d2b9d7c81499e623eef848efb454b8a4a750f8a3c907b1'],
  ['010', 88001, '0063c458878748451af87bf939792abbe11244c826a706f2df855223b03644a4'],
  ['010', 32677, '5beb34f04e6cae63e39e22a51462adfb5065b408e7ee68f4c92657a4cda2b224']
].map(x => ({ image: x[0], seed: x[1], expectedHash: x[2] }));
const IMAGE_PATHS = {
  '006': '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_006.txt',
  '010': '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_010.txt'
};
const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const SOLVE_MS = 8000;
const OPTIONS = {
  instantChain: true,
  bottomOnly: false,
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

function cfgFor(blocks, seed) {
  const band = A.Generator.deriveCapacityBand(blocks) || {};
  const b = band.band || [null, null];
  const frontier = band.frontier && band.frontier.avg;
  return {
    seed,
    generatorFlow: 'new_fixed',
    ruleMode: 'instantChain',
    boxSizeMin: b[0],
    boxSizeMax: b[1],
    capNormMin: b[0],
    capNormMax: b[1],
    cutMode: (frontier != null && frontier >= 2 && frontier <= 4.5) ? 'exposeCut' : 'layerCut2',
    candidateCount: 3,
    boardRowsMin: 6,
    boardRowsMax: 9,
    boardColsMin: 6,
    boardColsMax: 9,
    boardHardRange: false,
    boardAuto: false,
    boardAllowSquare: true,
    boardExpandOnOverflow: false,
    boardFirst: true,
    boardFitGuard: 'warn',
    boardPrefer7: true,
    boardPrefer7Dims: null,
    p7BaseCount: 0,
    p7Repair: false,
    trapPost: false,
    pool: 1,
    instantPlanPolicy: 'targetBuffer',
    instantPlanTargetBuffer: 4,
    instantPlanMaxDebt: 40,
    instantPlanBranchCount: 2,
    instantPlanBranchDebtRoots: true,
    instantPlanBranchPrefixDebts: 8,
    minPipes: 0,
    blackPercent: 10,
    narrowPath: true,
    experienceGoal: true,
    instantReleaseRoute: false,
    goalPerRoundMs: 10000,
    goalMaxMs: 15000,
    goalMaxRounds: 2,
    goalSharedBudget: true,
    acceptMode: 'target',
    targetBand3Min: 0,
    targetBand4Min: 0,
    targetPlayerPassMin: 0,
    capacityTuneMs: 3000,
    capacityTuneCars: 4,
    capacityTuneVariants: 12,
    localSwapRepair: true,
    localSwapRepairMaxMs: 8000,
    localSwapStage1Pairs: 32,
    localSwapStage1Ms: 4000,
    localSwapStage2Pairs: 64,
    localSwapStage2Ms: 4000,
    maxDecisionStates: 8,
    stateSampleMode: 'midStratified',
    minReleaseAmplitude: 2
  };
}

function generateMatched(c) {
  const blocks = A.Generator.blocksFromTXT(fs.readFileSync(path.join(ROOT, IMAGE_PATHS[c.image]), 'utf8'));
  const cfg = cfgFor(blocks, c.seed);
  const attempts = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    const t0 = Date.now();
    let r = null;
    try {
      r = A.Generator.produceGoal(blocks, Object.assign({}, cfg));
    } catch (e) {
      attempts.push({ attempt, error: String((e && e.message) || e), wallMs: Date.now() - t0 });
      continue;
    }
    const actualHash = r && r.level ? hash(r.level) : null;
    const q = r && r.level ? A.Quality.fromGeneration(r) : null;
    attempts.push({
      attempt,
      hash: actualHash,
      hashMatch: actualHash === c.expectedHash,
      board: r && r.level ? r.level.board.rows + 'x' + r.level.board.cols : null,
      structurePass: !!(q && q.gatePass),
      gateReasons: q && q.gateReasons || [],
      goalPass: !!(r && r.level && A.Generator.goalResultExperiencePass(r, cfg)),
      stopReason: r && r.goalStopReason || null,
      wallMs: Date.now() - t0
    });
    console.log('[generate]', c.image + '/' + c.seed, 'attempt=' + attempt,
      'hashMatch=' + (actualHash === c.expectedHash),
      'board=' + (r && r.level ? r.level.board.rows + 'x' + r.level.board.cols : '-'),
      'ms=' + (Date.now() - t0));
    if (r && r.level && actualHash === c.expectedHash) {
      return { r, parsed: A.parseLevel(r.level), cfg, attempts, attempt };
    }
  }
  return { attempts, parsed: null };
}

function cellOf(level, r, c) {
  return level.board && level.board.cells &&
    level.board.cells[r] && level.board.cells[r][c];
}

function plainBox(cell) {
  return !!(cell && cell.t === 'box' && !(cell.numice > 0) &&
    !(cell.chain > 0) && !cell.q);
}

function traceAnchors(level, route) {
  const actions = A.SolverAnalysis.normalizeActions(route);
  const state = A.Simulator.createState(level, { useSlotStart: true, instantChain: true });
  const out = [];
  for (let i = 0; i < actions.length; i++) {
    if (state.gameWon || state.gameOver) break;
    const a = actions[i];
    if (!A.Simulator.isPickable(state, a.r, a.c)) break;
    const progress = state.totalPixels ? state.eliminatedPixels / state.totalPixels : 0;
    const beforeBuffer = state.buffer.length;
    if (progress >= 0.2 && progress <= 0.85 && beforeBuffer >= 3) {
      out.push({
        actionIndex: i,
        step: i + 1,
        r: a.r,
        c: a.c,
        progress: +progress.toFixed(4),
        beforeBuffer
      });
    }
    A.Simulator.applyPick(state, a.r, a.c);
    if (state.eliminatedPixels >= state.totalPixels) {
      state.gameWon = true;
      state.gameOver = true;
    }
  }
  return out;
}

function buildPairs(level, anchors) {
  const seen = {};
  const pairs = [];
  const sorted = anchors.slice().sort((a, b) =>
    Math.abs(a.progress - 0.5) - Math.abs(b.progress - 0.5) ||
    b.beforeBuffer - a.beforeBuffer);
  for (const anchor of sorted) {
    for (const d of DIRS) {
      const cells = [
        { r: anchor.r, c: anchor.c },
        { r: anchor.r + d[0], c: anchor.c + d[1] }
      ].sort((x, y) => (x.r - y.r) || (x.c - y.c));
      if (!plainBox(cellOf(level, cells[0].r, cells[0].c)) ||
          !plainBox(cellOf(level, cells[1].r, cells[1].c))) continue;
      const key = cells.map(p => p.r + ',' + p.c).join('/');
      if (seen[key]) continue;
      seen[key] = true;
      pairs.push({ pair: cells, sourceStep: anchor.step, anchor });
    }
  }
  return pairs;
}

function capEvidence(level, cfg) {
  return A.Quality.capacityEvidence(level, cfg);
}

function structureFor(level, solveResult, cfg) {
  const curve = A.Generator.choiceCurve(level, solveResult);
  const quality = A.Quality.fromGeneration({
    level,
    valid: !!(solveResult && solveResult.completed),
    config: cfg,
    goodV3: { fillCurve: curve, persist: {} }
  });
  return { curve, quality };
}

function evaluate(level, sr, cfg, fullDecision) {
  const replay = A.SolverAnalysis.replay(level, sr, OPTIONS);
  const st = structureFor(level, sr, cfg);
  const cap = capEvidence(level, cfg);
  const quick = A.ExperienceGoal.evaluate(level, Object.assign({}, cfg, OPTIONS, {
    solveResult: sr,
    decision: false
  }));
  const full = fullDecision
    ? A.ExperienceGoal.evaluate(level, Object.assign({}, cfg, OPTIONS, {
        solveResult: sr,
        decision: true
      }))
    : null;
  const release = full && full.releaseDecision || null;
  const evidence = release && release.evidence || null;
  const hardContract = !!(cap && cap.conserved && cap.perColorConserved === true &&
    cap.boardFloorPass && cap.aboveMax === 0);
  const goalPass = !!(sr && sr.completed && st.quality && st.quality.gatePass &&
    hardContract && full && full.pass && release && release.status === 'found' &&
    evidence && evidence.finalReplayValid === true && evidence.releaseAmplitude >= 2);
  return {
    solved: !!(sr && sr.completed),
    routeReplay: !!replay.completed,
    routeSteps: replay.steps,
    structurePass: !!(st.quality && st.quality.gatePass),
    gateReasons: st.quality && st.quality.gateReasons || [],
    hardContract,
    capacity: {
      conserved: cap && cap.conserved,
      perColorConserved: cap && cap.perColorConserved,
      aboveMax: cap && cap.aboveMax,
      belowMin: cap && cap.belowMin
    },
    curve: {
      fullMedian2: st.curve && st.curve.fullMedian2,
      freeRunMax: st.curve && st.curve.freeRunMax,
      freeLowPct: st.curve && st.curve.freeLowPct,
      forcedPct: st.curve && st.curve.forcedPct,
      partialStepPct: st.curve && st.curve.partialStepPct
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

function runCase(A, c) {
  const gen = generateMatched(c);
  if (!gen.parsed) {
    return {
      image: c.image,
      seed: c.seed,
      expectedHash: c.expectedHash,
      hashMatch: false,
      generationAttempts: gen.attempts,
      status: 'rejected_hash_mismatch'
    };
  }
  const level = gen.parsed;
  const sr = gen.r.solveResult;
  const base = evaluate(level, sr, gen.cfg, true);
  const anchors = traceAnchors(level, sr);
  const pairs = buildPairs(level, anchors);
  const chainId = 1;
  const rows = [];
  for (const pair of pairs) {
    const t0 = Date.now();
    const variant = A.deepClone(level);
    const cells = pair.pair.map(p => cellOf(variant, p.r, p.c));
    if (!plainBox(cells[0]) || !plainBox(cells[1])) continue;
    const before = pair.pair.map((p, i) => ({
      r: p.r,
      c: p.c,
      color: cells[i].color,
      count: cells[i].count
    }));
    cells[0].chain = chainId;
    cells[1].chain = chainId;
    const vsr = A.Solver.solve(variant, { timeBudgetMs: SOLVE_MS, instantChain: true });
    const quick = evaluate(variant, vsr, gen.cfg, false);
    const prefilter = !!(quick.solved && quick.routeReplay && quick.structurePass &&
      quick.hardContract && quick.experience &&
      quick.experience.midBuffer34Pct >= 50 &&
      quick.experience.significantReleaseCount >= 1);
    const full = prefilter ? evaluate(variant, vsr, gen.cfg, true) : quick;
    const rec = Object.assign({}, full, {
      id: pair.pair.map(p => p.r + ',' + p.c).join('+') + '/chain1',
      pair: before,
      sourceStep: pair.sourceStep,
      anchor: pair.anchor,
      prefilterPass: prefilter,
      wallMs: Date.now() - t0
    });
    rows.push(rec);
    if (rec.goalPass) {
      fs.mkdirSync(LEVEL_DIR, { recursive: true });
      const stem = c.image + '_' + c.seed + '_' + rec.id.replace(/[+,\/]/g, '_');
      fs.writeFileSync(path.join(LEVEL_DIR, stem + '.json'), JSON.stringify(variant, null, 2) + '\n');
      fs.writeFileSync(path.join(LEVEL_DIR, stem + '.route.json'),
        JSON.stringify(vsr.pickOrder || [], null, 2) + '\n');
    }
  }
  const hits = rows.filter(x => x.goalPass);
  hits.sort((a, b) =>
    (b.experience.significantReleaseCount || 0) - (a.experience.significantReleaseCount || 0) ||
    (b.experience.midBuffer34Pct || 0) - (a.experience.midBuffer34Pct || 0) ||
    (a.experience.lateHighPressurePct || 0) - (b.experience.lateHighPressurePct || 0));
  const bestHit = hits[0] || null;
  if (bestHit) {
    const stem = c.image + '_' + c.seed + '_' + bestHit.id.replace(/[+,\/]/g, '_');
    bestHit.playerSim = playerEvidence(A.parseLevel(
      JSON.parse(fs.readFileSync(path.join(LEVEL_DIR, stem + '.json'), 'utf8'))
    ));
    bestHit.ablation = {
      before: base.goalPass,
      after: bestHit.goalPass,
      base: base.experience,
      afterMetrics: bestHit.experience,
      effectDisappeared: !base.goalPass
    };
  }
  console.log('[case]', c.image + '/' + c.seed,
    'anchors=' + anchors.length, 'pairs=' + pairs.length,
    'hits=' + hits.length, 'best=' + (bestHit && bestHit.id || '-'));
  return {
    image: c.image,
    seed: c.seed,
    expectedHash: c.expectedHash,
    actualHash: hash(level),
    hashMatch: true,
    reproductionAttempt: gen.attempt,
    board: level.board.rows + 'x' + level.board.cols,
    generationAttempts: gen.attempts,
    status: bestHit ? 'mechanism_hit' : 'no_hit',
    base,
    anchorCount: anchors.length,
    anchors,
    pairCount: pairs.length,
    structurePassCount: rows.filter(x => x.structurePass).length,
    goalPassCount: hits.length,
    bestHit,
    rows
  };
}

function main() {
  A = load();
  fs.mkdirSync(LEVEL_DIR, { recursive: true });
  const rows = CASES.map(c => runCase(A, c));
  const reproduced = rows.filter(x => x.hashMatch);
  const hitCases = reproduced.filter(x => x.goalPassCount > 0);
  const report = {
    schema: 'targeted-chain-cross-seed-v566',
    date: '2026-10-26',
    preregistration: '目标化锁链跨seed_预登记_v566.md',
    calibration: {
      image: '006',
      seed: 1001,
      expectedHash: 'a364e7f2b5c515c70a28d5ee196175bd51bda2132439bf220ee9fd2963bc5083',
      pair: [[4, 6], [4, 7]],
      goalPass: true,
      midBuffer34Pct: 59.1,
      maxBuffer: 4,
      significantReleaseCount: 2
    },
    summary: {
      newCases: rows.length,
      reproduced: reproduced.length,
      casesWithHit: hitCases.length,
      totalVariants: reproduced.reduce((n, x) => n + x.pairCount, 0),
      totalGoalPassVariants: reproduced.reduce((n, x) => n + x.goalPassCount, 0),
      totalStructurePass: reproduced.reduce((n, x) => n + x.structurePassCount, 0),
      aboveMaxCases: reproduced.filter(x => !x.base || !x.base.capacity || x.base.capacity.aboveMax !== 0).length,
      perColorFailCases: reproduced.filter(x => !x.base || !x.base.capacity || x.base.capacity.perColorConserved !== true).length,
      wallMsMedian: median(reproduced.flatMap(x => x.rows || []).map(x => x.wallMs)),
      wallMsMax: reproduced.flatMap(x => x.rows || []).reduce((m, x) => Math.max(m, x.wallMs || 0), 0),
      decision: hitCases.length
        ? '至少一个新增同类基底可由单组链转化；结果仍只作为x/N机制复核，不接生产。'
        : '新增同类基底均无单组链目标命中；机制不能泛化，保留负结果。'
    },
    rows
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report.summary, null, 2));
}

main();
