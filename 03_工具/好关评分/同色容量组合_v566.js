#!/usr/bin/env node
/** v566 P2：006/1002保持车位/障碍不变，只做同色车辆容量重组。 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '游戏主bin', 'bin', 'js');
const BASE_LEVEL = path.join(__dirname, 'P2P3归因_v566.levels', '006_1002.json');
const BASE_ROUTE = path.join(__dirname, 'P2P3归因_v566.levels', '006_1002.route.json');
const OUT = path.join(__dirname, '同色容量组合_006_1002_v566.json');
const LEVEL_DIR = path.join(__dirname, '同色容量组合_006_1002_v566.levels');
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
  boxSizeMin: 31,
  boxSizeMax: 40,
  capNormMin: 31,
  capNormMax: 40,
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
      microCount: cap && cap.microCount,
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

function main() {
  A = load();
  const rawBase = JSON.parse(fs.readFileSync(BASE_LEVEL, 'utf8'));
  const actions = JSON.parse(fs.readFileSync(BASE_ROUTE, 'utf8'));
  const base = A.parseLevel(rawBase);
  const baseSr = { completed: true, pickOrder: actions };
  const baseRec = Object.assign({ id: 'A/base' }, evaluate(base, baseSr, true));
  const made = A.CapacityTuner.variants(base, baseSr, {
    capMin: CFG.boxSizeMin,
    capMax: CFG.boxSizeMax,
    maxCars: 8,
    maxVariants: 48,
    deltas: [1, 2, 4, -1, -2, -4]
  });
  const rows = [];
  for (const v of made.variants) {
    const t0 = Date.now();
    const sr = A.Solver.solve(v.level, { timeBudgetMs: SOLVE_MS, instantChain: true });
    const quick = evaluate(v.level, sr, false);
    const protectedOk = !!(quick.hardContract &&
      (!baseRec.capacity || quick.capacity.belowMin <= baseRec.capacity.belowMin) &&
      (quick.capacity.microCount || 0) <= (baseRec.capacity.microCount || 0));
    const prefilter = !!(protectedOk && quick.solved && quick.routeReplay &&
      quick.structurePass && quick.experience &&
      quick.experience.midBuffer34Pct >= 50 &&
      quick.experience.significantReleaseCount >= 1);
    const rec = prefilter ? evaluate(v.level, sr, true) : quick;
    rec.id = 'car' + v.meta.target.r + ',' + v.meta.target.c + '/d' + v.meta.target.delta;
    rec.meta = v.meta;
    rec.protectedOk = protectedOk;
    rec.prefilterPass = prefilter;
    rec.wallMs = Date.now() - t0;
    rows.push(rec);
    if (rec.goalPass) {
      fs.mkdirSync(LEVEL_DIR, { recursive: true });
      const stem = rec.id.replace(/[+,\/]/g, '_');
      fs.writeFileSync(path.join(LEVEL_DIR, stem + '.json'), JSON.stringify(v.level, null, 2) + '\n');
      fs.writeFileSync(path.join(LEVEL_DIR, stem + '.route.json'),
        JSON.stringify(sr.pickOrder || [], null, 2) + '\n');
    }
    console.log('[variant]', rec.id,
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
    const stem = selectedHit.id.replace(/[+,\/]/g, '_');
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
    schema: 'same-color-capacity-combination-v566',
    date: '2026-10-26',
    preregistration: '同色容量组合_006_1002_预登记_v566.md',
    base: baseRec,
    keyCars: made.keyCars,
    rejected: made.rejected,
    summary: {
      legalVariants: rows.length,
      tested: rows.length,
      protected: rows.filter(x => x.protectedOk).length,
      solved: rows.filter(x => x.solved).length,
      routeReplay: rows.filter(x => x.routeReplay).length,
      structurePass: rows.filter(x => x.structurePass).length,
      prefilterPass: rows.filter(x => x.prefilterPass).length,
      goalPass: hits.length,
      hit: selectedHit,
      wallMsMedian: median(rows.map(x => x.wallMs)),
      wallMsMax: rows.length ? Math.max.apply(null, rows.map(x => x.wallMs)) : null,
      decision: rows.length === 0
        ? '当前用户容量带内没有可构造的同色转移变体；P2局部容量组合无法执行。'
        : (hits.length
          ? '存在同色容量组合目标命中；先做消融和独立样本复核，不接生产。'
          : '同色容量组合没有目标命中；保持容量合同与当前车序。')
    },
    rows
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report.summary, null, 2));
}

main();
