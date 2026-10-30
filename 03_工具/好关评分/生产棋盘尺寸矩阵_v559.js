#!/usr/bin/env node
/**
 * v559：生产棋盘尺寸矩阵（只读探针，不改任何生产代码）。
 *
 * 目的（P0/P3 尺寸偏好矩阵的改前数字）：
 *   Part I  历史分布：扫 输出文件/unnamed-* 各批次的「生产文档/逐关记录.jsonl」，统计真实出关棋盘尺寸、
 *           有效行列范围、结构门/目标通过率，并核对「批次配置.json」记录的范围与逐关实际范围是否一致。
 *   Part II 固定尺寸矩阵：同一图/seed/规则，只把棋盘固定到某个 行×列，比较结构门、目标体验、
 *           容量合同与黑块比例，回答“换成 ≥7 的盘会不会把可行性与质量打掉”。
 *
 * 口径：
 *   - 生产参数来自 逐关记录.jsonl「容量参数」（行6~7 列6~9、new_fixed、instantChain、goal 模式）。
 *   - 容量区间取 deriveCapacityBand(blocks).band，不缩放、不拆分。
 *   - 只读：不写生产代码，不写 输出文件/，产物只落 03_工具/好关评分/。
 *
 * 用法（仓库根目录）：
 *   node 03_工具/好关评分/生产棋盘尺寸矩阵_v559.js --phase=scan
 *   node 03_工具/好关评分/生产棋盘尺寸矩阵_v559.js --phase=matrix --images=006,010,007 \
 *        --seeds=1001,1002 --dims=6x6,6x7,6x8,7x7,7x8,7x9,8x8,8x9,9x9,7x6,9x7 \
 *        --round-ms=10000 --max-ms=15000 --out=03_工具/好关评分/生产棋盘尺寸矩阵_v559.run1.json
 *   node 03_工具/好关评分/生产棋盘尺寸矩阵_v559.js --phase=all
 *
 * 并发与覆盖保护：
 *   - 每个输出文件旁会创建 `.lock`；同一输出文件只允许一个进程写入，残留锁会自动识别失效 PID。
 *   - 默认拒绝覆盖已有输出；确需覆盖时显式传 `--force=1`。
 *   - `--out` 相对路径以仓库根目录为基准，避免从不同工作目录运行时写错位置。
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const BASE = path.join(ROOT, '02_工程', '游戏主bin');
const BIN = path.join(BASE, 'bin', 'js');
const OUTDIR = path.join(BASE, '输出文件');

const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js',
  'playersim.js', 'analysis.js', 'car-sequencer.js', 'solver-analysis.js', 'experience-goal.js',
  'capacity-tuner.js', 'instant-playout.js', 'generator.js', 'source-preflight.js'];

const IMAGE_MAP = {
  '006': '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_006.txt',
  '010': '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_010.txt',
  '007': '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_007.txt'
};
const DEFAULT_DIMS = ['6x6', '6x7', '6x8', '7x7', '7x8', '7x9', '8x8', '8x9', '9x9', '7x6', '9x7'];

function arg(name, def) {
  const pref = '--' + name + '=';
  const eqArg = process.argv.find(function(x) { return x.indexOf(pref) === 0; });
  if (eqArg != null) return eqArg.slice(pref.length);
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return (v == null || v.startsWith('--')) ? true : v;
}
const PHASE = arg('phase', 'all');
const IMAGES = String(arg('images', '006,010,007')).split(',').filter(Boolean);
const SEEDS = String(arg('seeds', '1001,1002')).split(',').map(Number);
const DIMS = String(arg('dims', DEFAULT_DIMS.join(','))).split(',').filter(Boolean);
const ROUND_MS = parseInt(arg('round-ms', '10000'), 10) || 10000;
const MAX_MS = parseInt(arg('max-ms', '15000'), 10) || 15000;
const MAX_ROUNDS = parseInt(arg('max-rounds', '2'), 10) || 2;
const CAND = parseInt(arg('cand', '3'), 10) || 3;
const TUNE_MS = parseInt(arg('tune', '3000'), 10);
const EGOAL = arg('egoal', '1') !== '0';
const OUT_ARG = arg('out', '');
const DEFAULT_OUT = path.join(__dirname, '生产棋盘尺寸矩阵_v559.json');
const OUT = OUT_ARG === '' ? DEFAULT_OUT : path.resolve(ROOT, String(OUT_ARG));
const FORCE = arg('force', '0') === '1';
const LOCK = OUT + '.lock';

let lockFd = null;
let lockReleased = false;

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e && e.code === 'EPERM';
  }
}

function releaseLock() {
  if (lockReleased) return;
  lockReleased = true;
  if (lockFd != null) {
    try { fs.closeSync(lockFd); } catch (e) { }
    lockFd = null;
  }
  try { fs.unlinkSync(LOCK); } catch (e) { }
}

function acquireLock() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      lockFd = fs.openSync(LOCK, 'wx');
      fs.writeFileSync(lockFd, JSON.stringify({
        pid: process.pid,
        startedAt: new Date().toISOString(),
        out: OUT
      }) + '\n');
      return;
    } catch (e) {
      if (!e || e.code !== 'EEXIST') throw e;
      let holder = null;
      try {
        const obj = JSON.parse(fs.readFileSync(LOCK, 'utf8'));
        holder = Number(obj && obj.pid);
      } catch (readErr) { }
      if (pidAlive(holder)) {
        throw new Error('[guard] 输出文件正在被进程 ' + holder + ' 写入：' + OUT);
      }
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

process.on('exit', releaseLock);
process.on('SIGINT', function() { releaseLock(); process.exit(130); });
process.on('SIGTERM', function() { releaseLock(); process.exit(143); });

let A = null;
function load() {
  const sb = {
    console: { log() { }, warn() { }, error() { } }, module: { exports: {} },
    WeakMap, Map, Set, Date, Math, JSON, setTimeout, clearTimeout, Infinity
  };
  vm.createContext(sb);
  for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BIN, f), 'utf8'), sb, { filename: f });
  A = sb.AntSolver;
  return A;
}
function sha(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function r1(x) { return x == null ? null : Math.round(x * 10) / 10; }

// ---------------- Part I：历史分布（只读） ----------------
function scan() {
  const batches = fs.readdirSync(OUTDIR).filter(d => d.startsWith('unnamed-')).sort();
  const levels = [];
  const batchInfo = [];
  for (const b of batches) {
    const recPath = path.join(OUTDIR, b, '生产文档', '逐关记录.jsonl');
    if (!fs.existsSync(recPath)) continue;
    const lines = fs.readFileSync(recPath, 'utf8').split('\n').filter(l => l.trim());
    let cfgRange = null, cfgFileRange = null;
    const cfgPath = path.join(OUTDIR, b, '生产文档', '批次配置.json');
    if (fs.existsSync(cfgPath)) {
      try {
        const c = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
        const g = c['生成参数'] || {};
        cfgFileRange = [g.boardRowsMin, g.boardRowsMax, g.boardColsMin, g.boardColsMax, !!g.boardAuto];
      } catch (e) { }
    }
    let n = 0;
    for (const line of lines) {
      let r; try { r = JSON.parse(line); } catch (e) { continue; }
      const bs = r['棋盘结构'] || {};
      if (!bs.rows) continue;
      n++;
      const cap = r['容量参数'] || {};
      if (cap.rows && !cfgRange) cfgRange = [cap.rows, cap.cols];
      levels.push({
        batch: b,
        rows: bs.rows, cols: bs.cols,
        struct: r['结构门'] === '通过',
        structRaw: r['结构门'] == null ? null : r['结构门'],
        goal: !!(r['体验目标'] && r['体验目标'].pass),
        result: r['结果分类'] || null,
        effRange: [cap.rows || null, cap.cols || null],
        blackPct: bs.blackPct == null ? null : bs.blackPct,
        entry: r['入口模式'] || null,
        mode: r['入口模式键'] || null
      });
    }
    batchInfo.push({ batch: b, levels: n, effRange: cfgRange, cfgFileRange: cfgFileRange });
  }
  // 分布
  const dist = {};
  for (const x of levels) {
    const k = x.rows + 'x' + x.cols;
    dist[k] = dist[k] || { dims: k, levels: 0, structPass: 0, goalPass: 0, blackPct: [], batches: new Set() };
    dist[k].levels++;
    if (x.struct) dist[k].structPass++;
    if (x.goal) dist[k].goalPass++;
    if (x.blackPct != null) dist[k].blackPct.push(x.blackPct);
    dist[k].batches.add(x.batch);
  }
  const distOut = Object.values(dist).map(d => ({
    dims: d.dims, levels: d.levels, structPass: d.structPass, goalPass: d.goalPass,
    blackPctMedian: d.blackPct.length ? median(d.blackPct) : null,
    batches: d.batches.size
  })).sort((a, b) => b.levels - a.levels);
  // 范围分布
  const rangeDist = {};
  for (const x of levels) {
    const k = (x.effRange[0] || '?') + ' / ' + (x.effRange[1] || '?');
    rangeDist[k] = (rangeDist[k] || 0) + 1;
  }
  // 记录范围与逐关范围不一致的批次
  const mismatch = batchInfo.filter(b => b.cfgFileRange && b.effRange &&
    b.cfgFileRange[0] + '~' + b.cfgFileRange[1] !== b.effRange[0] &&
    String(b.cfgFileRange[0]) !== String(b.effRange[0]));
  return {
    schema: 'production-board-size-scan-v559',
    date: new Date().toISOString().slice(0, 10),
    batches: batches.length,
    levels: levels.length,
    dimsDist: distOut,
    effRangeDist: rangeDist,
    cfgFileVsRecordMismatch: mismatch.map(m => ({ batch: m.batch, cfgFile: m.cfgFileRange, perLevel: m.effRange })),
    levelsDetail: levels
  };
}
function median(arr) {
  const a = arr.filter(x => x != null && !isNaN(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// ---------------- Part II：固定尺寸矩阵 ----------------
function cutModeOf(env) {
  const avg = env.frontierAvg;
  return (avg != null && avg >= 2 && avg <= 4.5) ? 'exposeCut' : 'layerCut2';
}
function cfgFor(blocks, seed, rows, cols) {
  const band = A.Generator.deriveCapacityBand(blocks) || {};
  const b = band.band || [null, null];
  const env = { bandLo: b[0], bandHi: b[1], frontierAvg: band.frontier && band.frontier.avg };
  return {
    seed: seed, generatorFlow: 'new_fixed', ruleMode: 'instantChain',
    boxSizeMin: b[0], boxSizeMax: b[1],
    capNormMin: b[0], capNormMax: b[1],
    cutMode: cutModeOf(env), candidateCount: CAND,
    boardRowsMin: rows, boardRowsMax: rows, boardColsMin: cols, boardColsMax: cols,
    boardHardRange: true, boardAuto: false, boardAllowSquare: true,
    boardExpandOnOverflow: false, boardFirst: true, boardFitGuard: 'warn',
    p7BaseCount: 0, p7Repair: false, trapPost: false, pool: 1,
    instantPlanPolicy: 'targetBuffer', instantPlanTargetBuffer: 4,
    instantPlanMaxDebt: 40, instantPlanBranchCount: 2,
    instantPlanBranchDebtRoots: true, instantPlanBranchPrefixDebts: 8,
    minPipes: 0, blackPercent: 10, narrowPath: true,
    experienceGoal: EGOAL, instantReleaseRoute: false,
    goalPerRoundMs: ROUND_MS, goalMaxMs: MAX_MS, goalMaxRounds: MAX_ROUNDS,
    goalSharedBudget: true, acceptMode: 'target',
    targetBand3Min: 0, targetBand4Min: 0, targetPlayerPassMin: 0,
    capacityTuneMs: TUNE_MS, capacityTuneCars: 4, capacityTuneVariants: 12
  };
}

function runOne(img, seed, dimStr) {
  const m = /^(\d+)x(\d+)$/.exec(dimStr);
  const rows = +m[1], cols = +m[2];
  const blocks = A.Generator.blocksFromTXT(fs.readFileSync(path.join(ROOT, IMAGE_MAP[img]), 'utf8'));
  const cfg = cfgFor(blocks, seed, rows, cols);
  const t0 = Date.now();
  let r = null, error = null;
  try { r = A.Generator.produceGoal(blocks, cfg); } catch (e) { error = String((e && e.message) || e); }
  const ms = Date.now() - t0;
  const rec = {
    image: img, seed, reqDims: dimStr, reqRows: rows, reqCols: cols,
    error: error, elapsedMs: ms,
    ok: !!(r && r.level && r.valid)
  };
  if (!rec.ok) {
    rec.failReason = r ? (r.lastFailReason || r.goalStopReason || 'noLevel') : 'exception';
    rec.capScale = r && r.capScale != null ? r.capScale : null;
    return rec;
  }
  const b = r.level.board || {};
  rec.dims = b.rows + 'x' + b.cols;
  rec.rows = b.rows; rec.cols = b.cols;
  rec.dimsHonored = (b.rows === rows && b.cols === cols);
  const bp = r.boardPick || (r.generationEval && r.generationEval.boardPick) || null;
  rec.boardPick = bp ? { tier: bp.tier, shapeRelaxed: !!bp.shapeRelaxed, finalBlackPct: bp.finalBlackPct, boxCount: bp.boxCount, cap: bp.cap } : null;
  // 黑块
  let black = 0, total = 0;
  for (const row of (b.cells || [])) for (const c of row) { total++; if (c && c.t === 'black') black++; }
  rec.black = { cells: black, total: total, pct: total ? r1(black / total * 100) : null };
  // 容量
  const ce = A.Quality && A.Quality.capacityEvidence ? A.Quality.capacityEvidence(r.level, r.config || cfg) : null;
  rec.capacity = ce ? {
    cars: ce.cars, conserved: ce.conserved, minCap: ce.minCap, maxCap: ce.maxCap,
    belowMin: ce.belowMin, aboveMax: ce.aboveMax, microCount: ce.microCount
  } : null;
  // 结构门
  const q = A.Quality && A.Quality.fromGeneration ? A.Quality.fromGeneration(r) : null;
  rec.struct = q ? { gatePass: !!q.gatePass, reasons: q.gateReasons || null, distance: q.gateDistance == null ? null : r1(q.gateDistance), label: q.label || null } : null;
  // 目标体验
  rec.goalPass = r.goalStopReason === 'pass';
  rec.goalStopReason = r.goalStopReason || null;
  rec.goalRounds = r.goalRounds || null;
  try {
    const ev = A.ExperienceGoal.evaluate(r.level, { solveResult: r.solveResult, decision: false, instantChain: true });
    rec.experience = ev ? {
      pass: !!ev.pass, reasons: ev.reasons || null,
      midBuffer34Pct: ev.metrics && ev.metrics.midBuffer34Pct,
      maxBuffer: ev.metrics && ev.metrics.maxBuffer,
      significantReleaseCount: ev.metrics && ev.metrics.significantReleaseCount,
      releaseStatus: ev.releaseDecision && ev.releaseDecision.status,
      distance: ev.metrics && ev.metrics.distance
    } : null;
  } catch (e) { rec.experience = { error: String((e && e.message) || e) }; }
  rec.goalBudget = r.goalBudgetEvidence || null;
  rec.perf = r.perf ? {
    totalMs: r.perf.totalMs,
    stopReason: r.perf.stopReason,
    baseCandidates: r.perf.baseCandidates,
    chokeVariants: r.perf.chokeVariants,
    evaluatedPositions: r.perf.evaluatedPositions,
    boxMs: r.perf.boxMs,
    boardMs: r.perf.boardMs,
    evalMs: r.perf.evalMs
  } : null;
  rec.capacityTune = r.capacityTune ? {
    applied: !!r.capacityTune.applied,
    tested: r.capacityTune.tested || 0,
    curveCandidates: r.capacityTune.curveCandidates || 0,
    skipped: r.capacityTune.skipped || null,
    stopped: r.capacityTune.stopped || null,
    elapsedMs: r.capacityTune.elapsedMs == null ? null : r.capacityTune.elapsedMs,
    base: r.capacityTune.base || null,
    after: r.capacityTune.after || null
  } : null;
  rec.hash = sha(JSON.stringify(r.level));
  rec.goalElapsedMs = r.goalElapsedMs || null;
  return rec;
}

function matrix() {
  const rows = [];
  for (const img of IMAGES) {
    for (const seed of SEEDS) {
      for (const d of DIMS) {
        const rec = runOne(img, seed, d);
        rows.push(rec);
        console.log('[matrix]', img, seed, d, '->', rec.ok ? (rec.dims + (rec.dimsHonored ? '' : '(未守住)')) : ('FAIL ' + rec.failReason),
          'struct=' + (rec.struct ? rec.struct.gatePass : '-'), 'goal=' + rec.goalPass,
          'black=' + (rec.black ? rec.black.pct : '-'), 'ms=' + rec.elapsedMs);
        fs.writeFileSync(OUT, JSON.stringify({
          schema: 'production-board-size-matrix-v559',
          generatedAt: new Date().toISOString(),
          partial: true,
          config: {
            images: IMAGES, seeds: SEEDS, dims: DIMS, roundMs: ROUND_MS,
            maxMs: MAX_MS, maxRounds: MAX_ROUNDS, candidates: CAND,
            tuneMs: TUNE_MS, experienceGoal: EGOAL
          },
          runs: rows
        }, null, 1) + '\n');
      }
    }
  }
  // 汇总：按请求尺寸
  const by = {};
  for (const r of rows) {
    const k = r.reqDims;
    by[k] = by[k] || { reqDims: k, runs: 0, ok: 0, honored: 0, structPass: 0, goalPass: 0, aboveMax: 0, blackPct: [], elapsed: [] };
    const s = by[k];
    s.runs++; s.elapsed.push(r.elapsedMs);
    if (r.ok) {
      s.ok++;
      if (r.dimsHonored) s.honored++;
      if (r.struct && r.struct.gatePass) s.structPass++;
      if (r.goalPass) s.goalPass++;
      if (r.capacity && r.capacity.aboveMax) s.aboveMax++;
      if (r.black && r.black.pct != null) s.blackPct.push(r.black.pct);
    }
  }
  const summary = Object.values(by).map(s => ({
    reqDims: s.reqDims, runs: s.runs, ok: s.ok, honored: s.honored,
    structPass: s.structPass, goalPass: s.goalPass, aboveMax: s.aboveMax,
    blackPctMedian: s.blackPct.length ? median(s.blackPct) : null,
    elapsedMedianMs: median(s.elapsed), elapsedMaxMs: s.elapsed.length ? Math.max.apply(null, s.elapsed) : null
  }));
  return { runs: rows, summary: summary };
}

// ---------------- main ----------------
function main() {
  acquireLock();
  assertOutputWritable();
  const t0 = Date.now();
  const out = {
    schema: 'production-board-size-v559',
    generatedAt: new Date().toISOString(),
    output: OUT
  };
  if (PHASE === 'scan' || PHASE === 'all') {
    out.scan = scan();
    console.log('[scan] batches=' + out.scan.batches + ' levels=' + out.scan.levels);
    console.log('[scan] dims:', out.scan.dimsDist.map(d => d.dims + '×' + d.levels).join(' '));
    console.log('[scan] effRange:', JSON.stringify(out.scan.effRangeDist));
    console.log('[scan] 配置范围≠逐关范围批次数:', out.scan.cfgFileVsRecordMismatch.length);
  }
  if (PHASE === 'matrix' || PHASE === 'all') {
    load();
    out.matrix = matrix();
    console.log('[matrix] summary:');
    for (const s of out.matrix.summary) {
      console.log(' ', s.reqDims, 'ok=' + s.ok + '/' + s.runs, 'honored=' + s.honored,
        'struct=' + s.structPass, 'goal=' + s.goalPass, 'aboveMax=' + s.aboveMax,
        'black=' + s.blackPctMedian, 'ms≈' + s.elapsedMedianMs);
    }
  }
  out.elapsedMs = Date.now() - t0;
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
  console.log('[done] ' + OUT + '  (' + Math.round((Date.now() - t0) / 1000) + 's)');
}

try {
  main();
} finally {
  releaseLock();
}
