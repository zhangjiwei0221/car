#!/usr/bin/env node
/**
 * v560 M1：生产棋盘尺寸偏好 A/B（只读探针）。
 *
 * 预登记：
 *   假设：在相同图、seed、容量、消除规则、目标预算与候选数下，只开启
 *   `boardPrefer7`，可在不降低结构与目标通过的前提下，提高行列都 >=7 的实际占比。
 *
 *   A：v558 行为，boardPrefer7=false。
 *   B：只增加 boardPrefer7=true；由生成器按候选与目标轮次轮换 7+ 尺寸。
 *
 *   固定：006/010/007、seed 1001/1002/88001/32677、target 模式、
 *   10 秒单轮、15 秒总预算、最多 2 轮、candidateCount=3、容量带自动推导。
 *
 *   通过：
 *   - 成功关卡容量守恒率 100%，aboveMax=0；
 *   - B 的首选尺寸实际命中率可观察；
 *   - B 结构通过数不低于 A；
 *   - B 目标通过数不低于 A；
 *   - 已知 9×7/1002、32677 成功不回退。
 *
 * 只读取生成器并写本工具输出，不写生产输出目录，不修改客户端。
 */
'use strict';

const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const BASE = path.join(ROOT, '02_工程', '游戏主bin');
const BIN = path.join(BASE, 'bin', 'js');
const DEFAULT_OUT = path.join(__dirname, '生产尺寸偏好AB_v560.json');
const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js',
  'playersim.js', 'analysis.js', 'car-sequencer.js', 'solver-analysis.js', 'experience-goal.js',
  'capacity-tuner.js', 'instant-playout.js', 'generator.js', 'source-preflight.js'];
const IMAGE_MAP = {
  '006': '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_006.txt',
  '010': '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_010.txt',
  '007': '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_007.txt'
};

function arg(name, def) {
  const pref = '--' + name + '=';
  const eqArg = process.argv.find(function(x) { return x.indexOf(pref) === 0; });
  if (eqArg != null) return eqArg.slice(pref.length);
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return (v == null || v.startsWith('--')) ? true : v;
}

const IMAGES = String(arg('images', '006,010,007')).split(',').filter(Boolean);
const SEEDS = String(arg('seeds', '1001,1002,88001,32677')).split(',').map(Number);
const ROUND_MS = parseInt(arg('round-ms', '10000'), 10) || 10000;
const MAX_MS = parseInt(arg('max-ms', '15000'), 10) || 15000;
const MAX_ROUNDS = parseInt(arg('max-rounds', '2'), 10) || 2;
const CAND = parseInt(arg('cand', '3'), 10) || 3;
const TUNE_MS = parseInt(arg('tune', '3000'), 10);
const FORCE = arg('force', '0') === '1';
const OUT_ARG = arg('out', '');
const OUT = OUT_ARG === '' ? DEFAULT_OUT : path.resolve(ROOT, String(OUT_ARG));
const LOCK = OUT + '.lock';

let A = null, lockFd = null, lockReleased = false;

function load() {
  const sb = {
    console: { log() { }, warn() { }, error() { } }, module: { exports: {} },
    WeakMap, Map, Set, Date, Math, JSON, setTimeout, clearTimeout, Infinity
  };
  vm.createContext(sb);
  for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BIN, f), 'utf8'), sb, { filename: f });
  A = sb.AntSolver;
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (e) { return e && e.code === 'EPERM'; }
}

function releaseLock() {
  if (lockReleased) return;
  lockReleased = true;
  if (lockFd != null) { try { fs.closeSync(lockFd); } catch (e) { } lockFd = null; }
  try { fs.unlinkSync(LOCK); } catch (e) { }
}

function acquireLock() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      lockFd = fs.openSync(LOCK, 'wx');
      fs.writeFileSync(lockFd, JSON.stringify({ pid: process.pid, out: OUT }) + '\n');
      return;
    } catch (e) {
      if (!e || e.code !== 'EEXIST') throw e;
      let holder = null;
      try { holder = Number(JSON.parse(fs.readFileSync(LOCK, 'utf8')).pid); } catch (readErr) { }
      if (pidAlive(holder)) throw new Error('[guard] 输出正在被进程 ' + holder + ' 写入：' + OUT);
      try { fs.unlinkSync(LOCK); } catch (unlinkErr) { }
    }
  }
  throw new Error('[guard] 无法取得输出锁：' + LOCK);
}

function assertOutputWritable() {
  if (fs.existsSync(OUT) && !FORCE) {
    throw new Error('[guard] 输出已存在，拒绝覆盖：' + OUT + '；如需覆盖请传 --force=1');
  }
}

function sha(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function r1(x) {
  return x == null ? null : Math.round(x * 10) / 10;
}

function median(arr) {
  const a = arr.filter(function(x) { return x != null && !isNaN(x); }).sort(function(a, b) { return a - b; });
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function cutModeOf(env) {
  const avg = env.frontierAvg;
  return (avg != null && avg >= 2 && avg <= 4.5) ? 'exposeCut' : 'layerCut2';
}

function cfgFor(blocks, seed, prefer7) {
  const band = A.Generator.deriveCapacityBand(blocks) || {};
  const b = band.band || [null, null];
  const env = { frontierAvg: band.frontier && band.frontier.avg };
  return {
    seed: seed,
    generatorFlow: 'new_fixed',
    ruleMode: 'instantChain',
    boxSizeMin: b[0],
    boxSizeMax: b[1],
    capNormMin: b[0],
    capNormMax: b[1],
    cutMode: cutModeOf(env),
    candidateCount: CAND,
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
    goalPerRoundMs: ROUND_MS,
    goalMaxMs: MAX_MS,
    goalMaxRounds: MAX_ROUNDS,
    goalSharedBudget: true,
    acceptMode: 'target',
    targetBand3Min: 0,
    targetBand4Min: 0,
    targetPlayerPassMin: 0,
    capacityTuneMs: TUNE_MS,
    capacityTuneCars: 4,
    capacityTuneVariants: 12,
    boardPrefer7: prefer7 === true
  };
}

function runOne(img, seed, arm) {
  const blocks = A.Generator.blocksFromTXT(fs.readFileSync(path.join(ROOT, IMAGE_MAP[img]), 'utf8'));
  const cfg = cfgFor(blocks, seed, arm === 'B');
  const t0 = Date.now();
  let result = null, error = null;
  try { result = A.Generator.produceGoal(blocks, cfg); }
  catch (e) { error = String((e && e.message) || e); }
  const elapsed = Date.now() - t0;
  const rec = { arm: arm, image: img, seed: seed, error: error, elapsedMs: elapsed };
  if (!result || !result.level || !result.valid) {
    rec.ok = false;
    rec.failReason = result ? (result.lastFailReason || result.goalStopReason || 'noLevel') : 'exception';
    rec.goalStopReason = result && result.goalStopReason || null;
    return rec;
  }

  rec.ok = true;
  rec.dims = result.level.board.rows + 'x' + result.level.board.cols;
  rec.rows = result.level.board.rows;
  rec.cols = result.level.board.cols;
  rec.prefer7 = !!(result.config && result.config.boardPrefer7 === true);
  rec.prefer7Dims = rec.rows >= 7 && rec.cols >= 7;
  rec.preferredPlan = result.config && result.config._boardPrefer7 || null;
  rec.boardPick = result.boardPick ? {
    tier: result.boardPick.tier,
    finalBlackPct: result.boardPick.finalBlackPct,
    prefer7: result.boardPick.prefer7 || null
  } : null;
  rec.structPass = !!A.Generator.goalStructPass(result);
  const q = A.Quality.fromGeneration ? A.Quality.fromGeneration(result) : null;
  rec.structReasons = q && q.gateReasons || null;
  rec.structDistance = q && q.gateDistance != null ? r1(q.gateDistance) : null;
  rec.goalPass = result.goalStopReason === 'pass';
  rec.goalStopReason = result.goalStopReason || null;
  rec.goalRounds = result.goalRounds || null;
  rec.goalElapsedMs = result.goalElapsedMs || null;

  let black = 0, total = 0;
  for (const row of (result.level.board.cells || [])) {
    for (const cell of row) {
      total++;
      if (cell && cell.t === 'black') black++;
    }
  }
  rec.black = { cells: black, total: total, pct: total ? r1(black / total * 100) : null };

  const ce = A.Quality.capacityEvidence(result.level, result.config || cfg);
  rec.capacity = ce ? {
    cars: ce.cars,
    conserved: ce.conserved,
    boxSizeMin: ce.boxSizeMin,
    boxSizeMax: ce.boxSizeMax,
    minCap: ce.minCap,
    maxCap: ce.maxCap,
    belowMin: ce.belowMin,
    aboveMax: ce.aboveMax,
    microCount: ce.microCount,
    rangeExactFeasible: ce.rangeExactFeasible
  } : null;

  const ev = A.ExperienceGoal && A.ExperienceGoal.evaluate
    ? A.ExperienceGoal.evaluate(result.level, {
      solveResult: result.solveResult,
      decision: false,
      instantChain: true
    })
    : null;
  rec.experience = ev ? {
    pass: !!ev.pass,
    reasons: ev.reasons || null,
    midBuffer34Pct: ev.metrics && ev.metrics.midBuffer34Pct,
    maxBuffer: ev.metrics && ev.metrics.maxBuffer,
    significantReleaseCount: ev.metrics && ev.metrics.significantReleaseCount,
    releaseStatus: ev.releaseDecision && ev.releaseDecision.status,
    distance: ev.metrics && ev.metrics.distance
  } : null;
  rec.hash = sha(JSON.stringify(result.level));
  return rec;
}

function summarize(runs) {
  const by = {};
  for (const r of runs) {
    const key = r.arm;
    const s = by[key] || (by[key] = {
      arm: key, runs: 0, ok: 0, structPass: 0, goalPass: 0, aboveMax: 0,
      noCandidate: 0, prefer7Generated: 0, blackPct: [], elapsedMs: [], dims: {}
    });
    s.runs++;
    s.elapsedMs.push(r.elapsedMs);
    if (r.ok) {
      s.ok++;
      if (r.structPass) s.structPass++;
      if (r.goalPass) s.goalPass++;
      if (r.capacity && r.capacity.aboveMax) s.aboveMax++;
      if (r.prefer7Dims) s.prefer7Generated++;
      if (r.black && r.black.pct != null) s.blackPct.push(r.black.pct);
      s.dims[r.dims] = (s.dims[r.dims] || 0) + 1;
    } else if (r.failReason === 'noCandidate') {
      s.noCandidate++;
    }
  }
  return Object.keys(by).sort().map(function(key) {
    const s = by[key];
    return {
      arm: s.arm,
      runs: s.runs,
      ok: s.ok,
      structPass: s.structPass,
      goalPass: s.goalPass,
      aboveMax: s.aboveMax,
      noCandidate: s.noCandidate,
      prefer7Generated: s.prefer7Generated,
      blackPctMedian: median(s.blackPct),
      blackPctMax: s.blackPct.length ? Math.max.apply(null, s.blackPct) : null,
      elapsedMedianMs: median(s.elapsedMs),
      elapsedMaxMs: s.elapsedMs.length ? Math.max.apply(null, s.elapsedMs) : null,
      dims: s.dims
    };
  });
}

function main() {
  acquireLock();
  assertOutputWritable();
  load();
  const out = {
    schema: 'production-board-prefer7-ab-v560',
    generatedAt: new Date().toISOString(),
    config: {
      images: IMAGES, seeds: SEEDS, roundMs: ROUND_MS, maxMs: MAX_MS,
      maxRounds: MAX_ROUNDS, candidateCount: CAND, tuneMs: TUNE_MS
    },
    runs: []
  };
  const t0 = Date.now();
  for (const img of IMAGES) {
    for (const seed of SEEDS) {
      for (const arm of ['A', 'B']) {
        const rec = runOne(img, seed, arm);
        out.runs.push(rec);
        console.log('[ab]', arm, img, seed, rec.ok ? rec.dims : 'FAIL ' + rec.failReason,
          'struct=' + (rec.structPass || false), 'goal=' + (rec.goalPass || false),
          'black=' + (rec.black ? rec.black.pct : '-'), 'ms=' + rec.elapsedMs);
        fs.writeFileSync(OUT, JSON.stringify({
          schema: out.schema,
          generatedAt: out.generatedAt,
          partial: true,
          config: out.config,
          runs: out.runs
        }, null, 1) + '\n');
      }
    }
  }
  out.summary = summarize(out.runs);
  out.elapsedMs = Date.now() - t0;
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
  console.log('[summary]');
  for (const s of out.summary) {
    console.log(' ', s.arm, 'struct=' + s.structPass + '/' + s.runs,
      'goal=' + s.goalPass + '/' + s.runs, 'prefer7=' + s.prefer7Generated,
      'aboveMax=' + s.aboveMax, 'black=' + s.blackPctMedian,
      'dims=' + JSON.stringify(s.dims));
  }
  console.log('[done]', OUT, Math.round(out.elapsedMs / 1000) + 's');
}

process.on('exit', releaseLock);
process.on('SIGINT', function() { releaseLock(); process.exit(130); });
process.on('SIGTERM', function() { releaseLock(); process.exit(143); });

try { main(); }
finally { releaseLock(); }
