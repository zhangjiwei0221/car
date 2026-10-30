#!/usr/bin/env node
/**
 * v562 M3：7×9 满载中位局部同色容量转移。
 *
 * 只改同一颜色两辆车的容量分配，棋盘/车序/债务/障碍/容量区间不变；
 * 每个变体重解。先做结构快筛，结构+容量通过后才做完整释放评价。
 */
'use strict';

const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '游戏主bin', 'bin', 'js');
const IMAGE = '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_007.txt';
const SEEDS = String(process.argv.find(function(x) { return x.indexOf('--seeds=') === 0; }) || '--seeds=1001,1002,32677')
  .slice('--seeds='.length).split(',').map(Number);
const MAX_VARIANTS = parseInt((process.argv.find(function(x) { return x.indexOf('--max-variants=') === 0; }) || '--max-variants=36')
  .slice('--max-variants='.length), 10) || 36;
const MODE = (process.argv.find(function(x) { return x.indexOf('--mode=') === 0; }) || '--mode=all')
  .slice('--mode='.length);
const OUT = path.join(__dirname, '满载中位局部交换_v562.json');
const LEVEL_DIR = path.join(__dirname, '满载中位局部交换_v562.levels');
const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js',
  'playersim.js', 'analysis.js', 'car-sequencer.js', 'solver-analysis.js', 'experience-goal.js',
  'capacity-tuner.js', 'instant-playout.js', 'generator.js', 'source-preflight.js'];

function load() {
  const sb = {
    console: { log() { }, warn() { }, error() { } }, module: { exports: {} },
    WeakMap, Map, Set, Date, Math, JSON, setTimeout, clearTimeout, Infinity
  };
  vm.createContext(sb);
  for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BIN, f), 'utf8'), sb, { filename: f });
  return sb.AntSolver;
}

function hash(x) {
  return crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
}

function pickSignature(sr) {
  if (!sr || !sr.pickOrder) return null;
  return hash(sr.pickOrder.map(function(p) {
    return [p.r, p.c, p.color, p.count, p.step];
  }));
}

function clone(x) {
  return JSON.parse(JSON.stringify(x));
}

function cfgFor(seed) {
  return {
    seed, ruleMode: 'instantChain', generatorFlow: 'new_fixed',
    boxSizeMin: 20, boxSizeMax: 40, capNormMin: 20, capNormMax: 40,
    boardRowsMin: 7, boardRowsMax: 7, boardColsMin: 9, boardColsMax: 9,
    boardHardRange: true, boardAuto: false, boardAllowSquare: true, boardFitGuard: 'warn',
    p7BaseCount: 0, p7Repair: false, trapPost: false, pool: 1,
    instantPlanPolicy: 'shortDebt', instantPlanTargetBuffer: 4,
    instantPlanMaxDebt: 40, instantPlanDebtEvery: 2,
    instantPlanBranchCount: 2, instantPlanBranchDebtRoots: true,
    instantPlanBranchPrefixDebts: 12,
    targetCarCount: 52, blackPercent: 10,
    experienceGoal: true, instantReleaseRoute: false,
    goalPerRoundMs: 20000, goalMaxMs: 30000, goalMaxRounds: 2,
    goalSharedBudget: true, candidateCount: 1, acceptMode: 'target',
    targetBand3Min: 0, targetBand4Min: 0, targetPlayerPassMin: 0,
    capacityTuneMs: 2000, capacityTuneCars: 4, capacityTuneVariants: 12
  };
}

function compactReasons(q) {
  return q && q.gateReasons || [];
}

function evaluate(A, level, cfg, fullExperience, knownSolve, knownCurve) {
  const G = A.Generator, EG = A.ExperienceGoal;
  const parsed = A.parseLevel(level);
  const t0 = Date.now();
  const sr = knownSolve || A.Solver.solve(parsed, { capturePreviewStats: true, instantChain: true, bottomOnly: false });
  const cur = knownCurve || (sr && sr.completed ? G.choiceCurve(parsed, sr) : null);
  const q = cur ? A.Quality.fromGeneration({
    level: level, valid: true, solveResult: sr,
    goodV3: { fillCurve: cur, persist: {} }
  }) : null;
  const cap = A.Quality.capacityEvidence(level, cfg);
  const expCfg = Object.assign({}, cfg, {
    maxDecisionStates: 8,
    stateSampleMode: 'midStratified',
    minReleaseAmplitude: 2
  });
  const ev = fullExperience && sr && sr.completed
    ? EG.evaluate(level, {
      solveResult: sr, decision: true, instantChain: true,
      maxDecisionStates: 8, stateSampleMode: 'midStratified', minReleaseAmplitude: 2
    })
    : null;
  const release = ev && ev.releaseDecision || null;
  const significantRelease = !!(release && release.status === 'found' &&
    release.evidence && release.evidence.releaseAmplitude >= 2 &&
    release.evidence.finalReplayValid === true);
  return {
    solved: !!(sr && sr.completed),
    elapsedMs: Date.now() - t0,
    structurePass: !!(q && q.gatePass),
    structureReasons: compactReasons(q),
    freeRunMax: cur ? cur.freeRunMax : null,
    freeLowPct: cur ? cur.freeLowPct : null,
    fullMedian2: cur ? cur.fullMedian2 : null,
    fullHistogram: cur ? cur.fullHistogram : null,
    midBuffer34Pct: ev && ev.metrics ? ev.metrics.midBuffer34Pct : null,
    maxBuffer: ev && ev.metrics ? ev.metrics.maxBuffer : null,
    experiencePass: !!(ev && ev.pass),
    experienceReasons: ev && ev.reasons || [],
    releaseStatus: release && release.status || null,
    releaseAmplitude: release && release.evidence ? release.evidence.releaseAmplitude : null,
    finalReplayValid: !!(release && release.evidence && release.evidence.finalReplayValid),
    significantRelease: significantRelease,
    fillCurve: cur,
    capacity: {
      conserved: !!cap.conserved,
      perColorConserved: cap.perColorConserved === true,
      boardFloorPass: !!cap.boardFloorPass,
      minCap: cap.minCap, maxCap: cap.maxCap,
      belowMin: cap.belowMin, aboveMax: cap.aboveMax
    },
    solveResult: sr
  };
}

function routeDetails(A, level, evaluated) {
  const order = (evaluated.solveResult.pickOrder || []).filter(function(x) {
    return x.chainIndex == null || x.chainIndex === 0;
  }).slice().sort(function(a, b) { return (a.step || 0) - (b.step || 0); });
  const cur = evaluated.fillCurve;
  const steps = cur && cur.steps || [];
  return steps.map(function(s, i) {
    const p = order[i] || {};
    const box = p.r == null ? null : level.board.cells[p.r] && level.board.cells[p.r][p.c];
    return {
      index: i,
      step: p.step,
      r: p.r, c: p.c,
      color: box ? box.color : p.color,
      count: box ? box.count : p.count,
      full: s.full,
      free: s.free,
      progress: s.prog
    };
  });
}

function capacityOk(v) {
  return !!(v.capacity.conserved && v.capacity.perColorConserved &&
    v.capacity.boardFloorPass && v.capacity.aboveMax === 0 &&
    v.capacity.minCap >= 20 && v.capacity.maxCap <= 40);
}

function evaluatePlannedRoute(A, level, cfg, baseSolve, fullExperience) {
  const replay = A.SolverAnalysis.replay(level, baseSolve, { instantChain: true, bottomOnly: false });
  const cap = A.Quality.capacityEvidence(level, cfg);
  if (!replay.completed) {
    return {
      solved: false,
      structurePass: false,
      structureReasons: ['planned_route_replay_failed:' + (replay.reason || 'incomplete')],
      freeRunMax: null,
      freeLowPct: null,
      fullMedian2: null,
      experiencePass: false,
      experienceReasons: ['planned_route_replay_failed'],
      releaseStatus: null,
      releaseAmplitude: null,
      finalReplayValid: false,
      significantRelease: false,
      capacity: {
        conserved: !!cap.conserved,
        perColorConserved: cap.perColorConserved === true,
        boardFloorPass: !!cap.boardFloorPass,
        minCap: cap.minCap, maxCap: cap.maxCap,
        belowMin: cap.belowMin, aboveMax: cap.aboveMax
      },
      plannedRouteReplay: {
        completed: false,
        reason: replay.reason || null,
        steps: replay.steps
      }
    };
  }
  const sr = Object.assign({}, baseSolve, {
    completed: true,
    pickOrder: baseSolve.pickOrder,
    steps: replay.steps,
    maxBuffer: replay.maxBuffer,
    avgBuffer: replay.avgBuffer,
    eliminatedPixels: replay.eliminatedPixels,
    totalPixels: replay.totalPixels,
    completedBoxes: replay.state ? replay.state.completedBoxes : null,
    totalBoxes: replay.state ? replay.state.totalBoxes : null
  });
  const parsed = A.parseLevel(level);
  const curve = A.Generator.choiceCurve(parsed, sr);
  const ev = fullExperience
    ? A.ExperienceGoal.evaluate(level, {
      solveResult: sr,
      decision: true,
      instantChain: true,
      maxDecisionStates: 8,
      stateSampleMode: 'midStratified',
      minReleaseAmplitude: 2
    })
    : null;
  const q = curve ? A.Quality.fromGeneration({
    level: level,
    valid: true,
    solveResult: sr,
    goodV3: { fillCurve: curve, persist: {} }
  }) : null;
  const release = ev && ev.releaseDecision || null;
  return {
    solved: true,
    structurePass: !!(q && q.gatePass),
    structureReasons: compactReasons(q),
    freeRunMax: curve ? curve.freeRunMax : null,
    freeLowPct: curve ? curve.freeLowPct : null,
    fullMedian2: curve ? curve.fullMedian2 : null,
    experiencePass: !!(ev && ev.pass),
    experienceReasons: ev && ev.reasons || [],
    releaseStatus: release && release.status || null,
    releaseAmplitude: release && release.evidence ? release.evidence.releaseAmplitude : null,
    finalReplayValid: !!(release && release.evidence && release.evidence.finalReplayValid),
    significantRelease: !!(release && release.status === 'found' && release.evidence &&
      release.evidence.releaseAmplitude >= 2 && release.evidence.finalReplayValid === true),
    capacity: {
      conserved: !!cap.conserved,
      perColorConserved: cap.perColorConserved === true,
      boardFloorPass: !!cap.boardFloorPass,
      minCap: cap.minCap, maxCap: cap.maxCap,
      belowMin: cap.belowMin, aboveMax: cap.aboveMax
    },
    plannedRouteReplay: {
      completed: true,
      steps: replay.steps,
      maxBuffer: replay.maxBuffer
    },
    solveResult: sr,
    fillCurve: curve
  };
}

function variantCandidates(level, details) {
  const transfers = [], swaps = [], seen = {};
  const hot = details.filter(function(x) {
    return x.full === 4 && x.r != null && x.c != null;
  }).sort(function(a, b) {
    const ar = (a.progress >= 0.2 && a.progress <= 0.8) ? 0 : 1;
    const br = (b.progress >= 0.2 && b.progress <= 0.8) ? 0 : 1;
    return ar - br || Math.abs(a.progress - 0.5) - Math.abs(b.progress - 0.5);
  });
  const hotKeys = {};
  for (const h of hot) hotKeys[h.r + ',' + h.c] = true;
  const allBoxes = [];
  for (let r = 0; r < level.board.rows; r++) for (let c = 0; c < level.board.cols; c++) {
    const x = level.board.cells[r][c];
    if (x && x.t === 'box' && !(x.chain > 0) && !x.q) {
      allBoxes.push({ r: r, c: c, box: x });
    }
  }
  const cold = allBoxes.filter(function(x) {
    return !hotKeys[x.r + ',' + x.c];
  }).sort(function(a, b) {
    return b.r - a.r || a.box.count - b.box.count;
  });
  for (const h of hot) {
    const hc = level.board.cells[h.r] && level.board.cells[h.r][h.c];
    if (!hc || hc.t !== 'box') continue;

    // 对照臂：目标车与一辆深层冷车交换 color/count。
    let swapsForHot = 0;
    for (const d of cold) {
      if (d.box.color === hc.color) continue;
      const key = ['swap', h.r, h.c, d.r, d.c].join('/');
      if (seen[key]) continue;
      seen[key] = true;
      const lv = clone(level);
      const target = lv.board.cells[h.r][h.c];
      const donor = lv.board.cells[d.r][d.c];
      const tc = target.color, tn = target.count;
      target.color = donor.color; target.count = donor.count;
      donor.color = tc; donor.count = tn;
      swaps.push({
        id: key,
        target: { r: h.r, c: h.c, colorBefore: hc.color, countBefore: hc.count, colorAfter: target.color, countAfter: target.count },
        donor: { r: d.r, c: d.c, colorBefore: d.box.color, countBefore: d.box.count, colorAfter: donor.color, countAfter: donor.count },
        direction: 'swap_color_count',
        delta: 0,
        p0Full: h.full,
        p0Progress: h.progress,
        level: lv
      });
      swapsForHot++;
      if (MODE !== 'swap' && swapsForHot >= 4) break;
    }

    if (MODE === 'swap') continue;
    const donors = [];
    for (let r = 0; r < level.board.rows; r++) for (let c = 0; c < level.board.cols; c++) {
      const x = level.board.cells[r][c];
      if (!x || x.t !== 'box' || (r === h.r && c === h.c)) continue;
      if (x.color !== hc.color) continue;
      donors.push({ r: r, c: c, box: x });
    }
    donors.sort(function(a, b) {
      return Math.abs(a.box.count - hc.count) - Math.abs(b.box.count - hc.count);
    });
    for (const d of donors) {
      for (const delta of [1, 2]) {
        const ops = [];
        if (d.box.count - delta >= 20 && hc.count + delta <= 40) {
          ops.push({ direction: 'donor_to_target', delta: delta });
        }
        if (hc.count - delta >= 20 && d.box.count + delta <= 40) {
          ops.push({ direction: 'target_to_donor', delta: delta });
        }
        for (const op of ops) {
          const key = [h.r, h.c, d.r, d.c, op.direction, delta].join('/');
          if (seen[key]) continue;
          seen[key] = true;
          const lv = clone(level);
          const target = lv.board.cells[h.r][h.c];
          const donor = lv.board.cells[d.r][d.c];
          if (op.direction === 'donor_to_target') {
            target.count += delta;
            donor.count -= delta;
          } else {
            target.count -= delta;
            donor.count += delta;
          }
          transfers.push({
            id: key,
            target: { r: h.r, c: h.c, color: h.color, countBefore: hc.count, countAfter: target.count },
            donor: { r: d.r, c: d.c, color: d.box.color, countBefore: d.box.count, countAfter: donor.count },
            direction: op.direction,
            delta: delta,
            p0Full: h.full,
            p0Progress: h.progress,
            level: lv
          });
        }
      }
    }
  }
  const variants = [];
  if (MODE === 'swap') return swaps.slice(0, MAX_VARIANTS);
  const n = Math.max(transfers.length, swaps.length);
  for (let i = 0; i < n && variants.length < MAX_VARIANTS; i++) {
    if (swaps[i]) variants.push(swaps[i]);
    if (variants.length < MAX_VARIANTS && transfers[i]) variants.push(transfers[i]);
  }
  return variants;
}

function main() {
  const A = load(), G = A.Generator;
  const blocks = G.blocksFromTXT(fs.readFileSync(path.join(ROOT, IMAGE), 'utf8'));
  fs.mkdirSync(LEVEL_DIR, { recursive: true });
  const report = {
    schema: 'full-median-local-transfer-v562',
    date: '2026-10-26',
    preregistration: '满载中位局部交换_预登记_v562.md',
    config: { image: '007', rows: 7, cols: 9, seeds: SEEDS, maxVariantsPerSeed: MAX_VARIANTS },
    cases: [],
    summary: null
  };
  const tAll = Date.now();
  for (const seed of SEEDS) {
    const cfg = cfgFor(seed);
    const t0 = Date.now();
    let r = null;
    try { r = G.produceGoal(blocks, cfg); } catch (e) { r = { level: null, valid: false, error: String((e && e.message) || e) }; }
    if (!r || !r.level || !r.valid) {
      report.cases.push({ seed: seed, valid: false, error: r && r.error || r && r.lastFailReason || 'noLevel', wallMs: Date.now() - t0 });
      continue;
    }
    const baseHash = hash(r.level);
    fs.writeFileSync(path.join(LEVEL_DIR, '007_7x9_' + seed + '.json'), JSON.stringify(r.level) + '\n');
    const base = evaluate(A, r.level, cfg, true, r.solveResult, r.goodV3 && r.goodV3.fillCurve);
    const independentBase = evaluate(A, r.level, cfg, false);
    const details = routeDetails(A, r.level, base);
    const candidates = variantCandidates(r.level, details);
    const tested = [];
    let chosen = null;
    let bestDiagnostic = null;
    for (const cand of candidates) {
      const ev = evaluatePlannedRoute(A, cand.level, cfg, base.solveResult, false);
      const item = {
        id: cand.id, direction: cand.direction, delta: cand.delta,
        target: cand.target, donor: cand.donor,
        p0Full: cand.p0Full, p0Progress: cand.p0Progress,
        solved: ev.solved, structurePass: ev.structurePass,
        structureReasons: ev.structureReasons,
        freeRunMax: ev.freeRunMax, freeLowPct: ev.freeLowPct,
        fullMedian2: ev.fullMedian2, capacity: ev.capacity,
        capacityOk: capacityOk(ev),
        plannedRouteReplay: ev.plannedRouteReplay || null
      };
      const diagScore = [
        ev.structurePass ? 0 : 1,
        ev.fullMedian2 == null ? 99 : ev.fullMedian2,
        ev.freeRunMax == null ? 99 : ev.freeRunMax,
        ev.freeLowPct == null ? 99 : ev.freeLowPct
      ];
      const bestScore = bestDiagnostic ? [
        bestDiagnostic.item.structurePass ? 0 : 1,
        bestDiagnostic.item.fullMedian2 == null ? 99 : bestDiagnostic.item.fullMedian2,
        bestDiagnostic.item.freeRunMax == null ? 99 : bestDiagnostic.item.freeRunMax,
        bestDiagnostic.item.freeLowPct == null ? 99 : bestDiagnostic.item.freeLowPct
      ] : null;
      function scoreLess(a, b) {
        if (!b) return true;
        for (let si = 0; si < a.length; si++) {
          if (a[si] !== b[si]) return a[si] < b[si];
        }
        return false;
      }
      if (scoreLess(diagScore, bestScore)) {
        bestDiagnostic = { item: item, candidate: cand, evaluated: ev };
      }
      if (item.structurePass && item.capacityOk && !chosen) {
        const fullEv = evaluatePlannedRoute(A, cand.level, cfg, base.solveResult, true);
        Object.assign(item, {
          midBuffer34Pct: fullEv.midBuffer34Pct,
          maxBuffer: fullEv.maxBuffer,
          experiencePass: fullEv.experiencePass,
          experienceReasons: fullEv.experienceReasons,
          releaseStatus: fullEv.releaseStatus,
          releaseAmplitude: fullEv.releaseAmplitude,
          finalReplayValid: fullEv.finalReplayValid,
          significantRelease: fullEv.significantRelease
        });
        chosen = {
          id: cand.id,
          level: cand.level,
          metrics: fullEv,
          operation: {
            target: cand.target,
            donor: cand.donor,
            direction: cand.direction,
            delta: cand.delta
          }
        };
      }
      tested.push(item);
    }
    report.cases.push({
      seed: seed,
      valid: true,
      wallMs: Date.now() - t0,
      hash: baseHash,
      board: { rows: r.level.board.rows, cols: r.level.board.cols },
      base: {
        structurePass: base.structurePass,
        structureReasons: base.structureReasons,
        solved: base.solved,
        freeRunMax: base.freeRunMax,
        freeLowPct: base.freeLowPct,
        fullMedian2: base.fullMedian2,
        midBuffer34Pct: base.midBuffer34Pct,
        maxBuffer: base.maxBuffer,
        experiencePass: base.experiencePass,
        releaseStatus: base.releaseStatus,
        significantRelease: base.significantRelease,
        capacity: base.capacity,
        solveConsistency: {
          storedPickSignature: pickSignature(base.solveResult),
          independentPickSignature: pickSignature(independentBase.solveResult),
          samePickOrder: pickSignature(base.solveResult) === pickSignature(independentBase.solveResult),
          storedFullMedian2: base.fullMedian2,
          independentFullMedian2: independentBase.fullMedian2,
          storedFreeRunMax: base.freeRunMax,
          independentFreeRunMax: independentBase.freeRunMax
        },
        highFullSteps: details.filter(function(x) { return x.full > 3; }).map(function(x) {
          return { step: x.step, progress: +x.progress.toFixed(4), full: x.full, free: x.free, color: x.color, count: x.count, r: x.r, c: x.c };
        })
      },
      variantsTested: tested,
      diagnosticBest: bestDiagnostic ? {
        id: bestDiagnostic.candidate.id,
        operation: {
          target: bestDiagnostic.candidate.target,
          donor: bestDiagnostic.candidate.donor,
          direction: bestDiagnostic.candidate.direction,
          delta: bestDiagnostic.candidate.delta
        },
        metrics: {
          structurePass: bestDiagnostic.evaluated.structurePass,
          structureReasons: bestDiagnostic.evaluated.structureReasons,
          freeRunMax: bestDiagnostic.evaluated.freeRunMax,
          freeLowPct: bestDiagnostic.evaluated.freeLowPct,
          fullMedian2: bestDiagnostic.evaluated.fullMedian2,
          capacity: bestDiagnostic.evaluated.capacity,
          plannedRouteReplay: bestDiagnostic.evaluated.plannedRouteReplay
        },
        levelFile: bestDiagnostic ? path.basename(LEVEL_DIR + '/007_7x9_' + seed + '_diagnostic_best.json') : null
      } : null,
      firstStructuralPass: chosen ? tested.find(function(x) { return x.id === chosen.id; }) : null,
      chosen: chosen ? {
        id: chosen.id,
        operation: chosen.operation,
        hash: hash(chosen.level),
        metrics: {
          structurePass: chosen.metrics.structurePass,
          freeRunMax: chosen.metrics.freeRunMax,
          freeLowPct: chosen.metrics.freeLowPct,
          fullMedian2: chosen.metrics.fullMedian2,
          midBuffer34Pct: chosen.metrics.midBuffer34Pct,
          maxBuffer: chosen.metrics.maxBuffer,
          experiencePass: chosen.metrics.experiencePass,
          experienceReasons: chosen.metrics.experienceReasons,
          releaseStatus: chosen.metrics.releaseStatus,
          releaseAmplitude: chosen.metrics.releaseAmplitude,
          finalReplayValid: chosen.metrics.finalReplayValid,
          significantRelease: chosen.metrics.significantRelease,
          capacity: chosen.metrics.capacity
        }
      } : null
    });
    if (bestDiagnostic) {
      fs.writeFileSync(path.join(LEVEL_DIR, '007_7x9_' + seed + '_diagnostic_best.json'),
        JSON.stringify(bestDiagnostic.candidate.level) + '\n');
    }
    console.log('[case]', seed, 'base full=' + base.fullMedian2, 'struct=' + base.structurePass,
      'variants=' + tested.length, 'chosen=' + !!chosen);
  }
  const valid = report.cases.filter(function(x) { return x.valid; });
  const structural = valid.filter(function(x) { return x.chosen; });
  const complete = valid.filter(function(x) {
    return x.chosen && x.chosen.metrics.experiencePass && x.chosen.metrics.significantRelease &&
      x.chosen.metrics.finalReplayValid;
  });
  report.summary = {
    seeds: SEEDS.length,
    valid: valid.length,
    structuralConversions: structural.length,
    completeConversions: complete.length,
    cases: report.cases.map(function(x) {
      return {
        seed: x.seed,
        valid: x.valid,
        baseFull: x.valid ? x.base.fullMedian2 : null,
        chosenFull: x.valid && x.chosen ? x.chosen.metrics.fullMedian2 : null,
        structurePass: !!(x.valid && x.chosen),
        completePass: !!(x.valid && x.chosen && x.chosen.metrics.experiencePass &&
          x.chosen.metrics.significantRelease && x.chosen.metrics.finalReplayValid),
        operation: x.valid && x.chosen ? x.chosen.operation : null
      };
    }),
    decision: structural.length >= 2
      ? '同色局部容量转移至少有2个结构命中；继续验证完整目标和跨seed泛化。'
      : '同色局部容量转移未达到2/3结构命中；保留负结果，不接生产，转P2全局容量组合或车序诊断。'
  };
  report.wallMs = Date.now() - tAll;
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ summary: report.summary, wallMs: report.wallMs }, null, 2));
}

main();
