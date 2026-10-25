#!/usr/bin/env node
/**
 * 产线对比：old（produce）vs new_fixed（produceFixed），只读，不写生产代码。
 *
 * 用法（仓库根目录）：
 *   node 03_工具/好关评分/产线对比.js [--seed-list 1001,1002,1003] [--out 前缀]
 *
 * 口径（与 UI 同源的参数，其余用 DEFAULT_CONFIG）：
 *   - 容量：deriveCapacityBand(blocks).band，即 UI「自动（带）」
 *   - 切法：前沿均值 2~4.5 → exposeCut，否则 layerCut2（UI auto 规则；本批无路线）
 *   - 候选/预算：candidateCount 3 × 20s，fullTime（同 v494 的 006 基准）
 *   - acceptMode:'target' 但门槛沿用 UI（峰窗 3.2~4.8、稳健 0~100、玩家≥25%），
 *     只为让 首通/学会后/前瞻/T/R/U 有数；结构门另由 AntSolver.Quality 判。
 *
 * 产物：
 *   产线对比_<日期>.jsonl      每 run 一行（含 hash / capacityAudit / 质量）
 *   产线对比汇总_<日期>.json   汇总
 *
 * 注意：本脚本只做 A/B 观测，不改 app.js 的 generatorFlow，也不改默认产线。
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const BASE = path.join(ROOT, '02_工程', '完整主bin快照_20261012');
const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js', 'playersim.js', 'analysis.js', 'generator.js'];
const sandbox = { console: { log() { }, warn() { }, error() { } }, module: { exports: {} }, WeakMap, Map, Set, setTimeout, clearTimeout, Infinity, Math, JSON, Date };
vm.createContext(sandbox);
for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BASE, 'bin/js', f), 'utf8'), sandbox, { filename: f });
const A = sandbox.AntSolver, G = A.Generator;

const DEFAULT_IMAGES = [
  { id: '006', file: '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_006.txt' },
  { id: '好图', file: '实验关/好图_35x35_碎块_20261023.txt' },
  { id: '推荐', file: '实验关/推荐_35x35_碎块_20261023.txt' }
];
// --images "id:相对路径,id2:路径" 可替换图集（默认上面三张，用于回看基准）
const IMAGES = (function () {
  const i = process.argv.indexOf('--images');
  if (i < 0) return DEFAULT_IMAGES;
  return process.argv[i + 1].split(',').map(function (s) {
    const k = s.indexOf(':');
    return { id: s.slice(0, k), file: s.slice(k + 1) };
  });
})();
// --flows old,new_fixed 可只跑一条线（默认两条都跑）
const FLOWS = (function () {
  const i = process.argv.indexOf('--flows');
  return i > 0 ? process.argv[i + 1].split(',') : ['old', 'new_fixed'];
})();
const SEEDS = (function () {
  const i = process.argv.indexOf('--seed-list');
  return i > 0 ? process.argv[i + 1].split(',').map(Number) : [1001, 1002, 1003];
})();
const OUT_PREFIX = (function () {
  const i = process.argv.indexOf('--out');
  return i > 0 ? process.argv[i + 1] : path.join(__dirname, '产线对比_20261025');
})();
// --dump-levels <dir>：把未过结构门的关卡导成客户端 JSON，供只读归因（双时间线/债务/压力）复用
const DUMP_DIR = (function () {
  const i = process.argv.indexOf('--dump-levels');
  return i > 0 ? path.resolve(process.argv[i + 1]) : '';
})();
const JSONL = OUT_PREFIX + '.jsonl';
const SUMMARY = path.join(path.dirname(OUT_PREFIX), '产线对比汇总_' + path.basename(OUT_PREFIX).replace(/^产线对比_/, '') + '.json');

function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function round1(x) { return x == null ? null : Math.round(x * 10) / 10; }
function median(arr) {
  const a = arr.filter(x => x != null && !isNaN(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function loadImage(img) {
  const blocks = G.blocksFromTXT(fs.readFileSync(path.join(ROOT, img.file), 'utf8'));
  const band = G.deriveCapacityBand(blocks) || {};
  const bandArr = band.band || [null, null];
  const avg = band.frontier && band.frontier.avg;
  const cutMode = (avg != null && avg >= 2 && avg <= 4.5) ? 'exposeCut' : 'layerCut2';
  return { blocks, band, bandLo: bandArr[0], bandHi: bandArr[1], cutMode, frontierAvg: avg };
}

function configOf(env, flow, seed) {
  return {
    seed: seed,
    generatorFlow: flow,
    boxSizeMin: env.bandLo, boxSizeMax: env.bandHi,
    cutMode: env.cutMode,
    candidateCount: 3, timeBudgetMs: 20000, fullTime: true, portfolioK: 1,
    acceptMode: 'target', targetPeakMin: 3.2, targetPeakMax: 4.8,
    targetSteadyMin: 0, targetSteadyMax: 100,
    targetBand3Min: 0, targetBand4Min: 0, targetPlayerPassMin: 0.25
  };
}

function recordOf(env, img, flow, seed, r, ms) {
  if (!r) return { image: img.id, flow, seed, error: 'produce 返回 null' };
  const q = A.Quality ? A.Quality.fromGeneration(r) : null;
  const fc = (r.goodV3 && r.goodV3.fillCurve) || {};
  const p = (r.goodV3 && r.goodV3.persist) || {};
  const ce = r.capacityAudit || null;
  const b = (r.level && r.level.board) || {};
  return {
    image: img.id, flow: flow, seed: seed,
    valid: !!r.valid,
    solverCompleted: !!(r.solveResult && r.solveResult.completed),
    outFlow: r.flow || flow,
    board: { rows: b.rows, cols: b.cols },
    boardFloorPass: ce ? ce.boardFloorPass : null,
    capacity: ce ? {
      cars: ce.cars, sum: ce.capacitySum, pixels: ce.pixels, conserved: ce.conserved,
      minCap: ce.minCap, maxCap: ce.maxCap, belowMin: ce.belowMin, aboveMax: ce.aboveMax,
      microCount: ce.microCount, rangeExactFeasible: ce.rangeExactFeasible,
      row0Cars: ce.row0Cars, row0Colors: ce.row0Colors, row0MaxSameColor: ce.row0MaxSameColor
    } : null,
    band: [env.bandLo, env.bandHi], cutMode: env.cutMode, frontierAvg: round1(env.frontierAvg),
    gatePass: q ? !!q.gatePass : null,
    gateReasons: q ? q.gateReasons : null,
    gateDistance: q && q.gateDistance != null ? q.gateDistance : null,
    label: q ? q.label : null,
    quality: {
      freeLowPct: fc.freeLowPct == null ? null : fc.freeLowPct,
      freeRunMax: fc.freeRunMax == null ? null : fc.freeRunMax,
      freePct: fc.freePct == null ? null : fc.freePct,
      selectMedian: fc.selectMedian == null ? null : fc.selectMedian,
      fullMedian2: fc.fullMedian2 == null ? null : fc.fullMedian2,
      forcedPct: fc.forcedPct == null ? null : fc.forcedPct,
      partialStepPct: fc.partialStepPct == null ? null : fc.partialStepPct,
      playerPassPct: p.playerPassPct == null ? null : p.playerPassPct,
      learnedPassPct: p.learnedPassPct == null ? null : p.learnedPassPct,
      lookaheadPassPct: p.lookaheadPassPct == null ? null : p.lookaheadPassPct,
      T: p.quality && p.quality.T != null ? p.quality.T : null,
      R: p.quality && p.quality.R != null ? p.quality.R : null,
      U: p.quality && p.quality.U != null ? p.quality.U : null,
      peak: p.peak == null ? null : p.peak,
      band3Pct: p.band3Pct == null ? null : p.band3Pct
    },
    elapsedMs: ms,
    levelMs: r.elapsedMs == null ? null : r.elapsedMs,
    hash: sha256(JSON.stringify(r.level))
  };
}

function summarize(rows) {
  const out = { runs: rows.length, flows: {} };
  for (const flow of FLOWS) {
    const rs = rows.filter(x => x.flow === flow && !x.error);
    const f = {
      runs: rs.length,
      valid: rs.filter(x => x.valid).length,
      gatePass: rs.filter(x => x.gatePass).length,
      boardFloorPass: rs.filter(x => x.boardFloorPass).length,
      capacityConserved: rs.filter(x => x.capacity && x.capacity.conserved).length,
      capacityInRange: rs.filter(x => x.capacity && x.capacity.belowMin === 0 && x.capacity.aboveMax === 0).length,
      capacityOutOfRangeRuns: rs.filter(x => x.capacity && (x.capacity.belowMin > 0 || x.capacity.aboveMax > 0)).length,
      boards: rs.map(x => (x.board && x.board.rows != null) ? (x.board.rows + 'x' + x.board.cols) : null),
      freeLowMedian: median(rs.map(x => x.quality.freeLowPct)),
      freeRunMedian: median(rs.map(x => x.quality.freeRunMax)),
      firstPassMedian: median(rs.map(x => x.quality.playerPassPct)),
      learnedMedian: median(rs.map(x => x.quality.learnedPassPct)),
      lookMedian: median(rs.map(x => x.quality.lookaheadPassPct)),
      TMedian: median(rs.map(x => x.quality.T)),
      RMedian: median(rs.map(x => x.quality.R)),
      elapsedMedianMs: median(rs.map(x => x.elapsedMs)),
      elapsedMaxMs: Math.max.apply(null, rs.map(x => x.elapsedMs).filter(x => x != null)),
      timedOut: rs.filter(x => x.elapsedMs != null).length
    };
    out.flows[flow] = f;
  }
  return out;
}

function main() {
  fs.writeFileSync(JSONL, '');
  const rows = [];
  const envs = {};
  for (const img of IMAGES) envs[img.id] = loadImage(img);
  console.log('[env] ' + Object.keys(envs).map(id => id + '=' + envs[id].bandLo + '~' + envs[id].bandHi + '/' + envs[id].cutMode).join('  '));
  for (const img of IMAGES) {
    for (const flow of FLOWS) {
      for (const seed of SEEDS) {
        const t0 = Date.now();
        let r = null, err = null;
        try { r = G.produce(envs[img.id].blocks, configOf(envs[img.id], flow, seed)); }
        catch (e) { err = e && e.message; }
        const ms = Date.now() - t0;
        const rec = err ? { image: img.id, flow: flow, seed: seed, error: err, elapsedMs: ms }
          : recordOf(envs[img.id], img, flow, seed, r, ms);
        if (DUMP_DIR && rec.gatePass === false && r && r.level) {
          try {
            fs.mkdirSync(DUMP_DIR, { recursive: true });
            const cf = A.toGameFormat(r.level);
            const lf = path.join(DUMP_DIR, rec.image + '_' + flow + '_s' + seed + '.json');
            fs.writeFileSync(lf, JSON.stringify(cf));
            rec.levelFile = path.relative(ROOT, lf);
          } catch (e) { rec.levelDumpError = String(e && e.message || e); }
        }
        rows.push(rec);
        fs.appendFileSync(JSONL, JSON.stringify(rec) + '\n');
        console.log('[' + rec.image + '] ' + flow + ' seed' + seed + ' => '
          + (rec.error ? ('ERR ' + rec.error)
            : ('valid=' + rec.valid + ' gate=' + rec.gatePass + ' board=' + rec.board.rows + 'x' + rec.board.cols
              + ' cap=' + (rec.capacity ? (rec.capacity.minCap + '~' + rec.capacity.maxCap + ' out:' + rec.capacity.belowMin + '/' + rec.capacity.aboveMax) : '?')
              + ' freeLow=' + rec.quality.freeLowPct + ' freeRun=' + rec.quality.freeRunMax
              + ' pass=' + rec.quality.playerPassPct + ' ' + Math.round(ms / 1000) + 's')));
      }
    }
  }
  const sum = summarize(rows);
  sum.generatedAt = new Date().toISOString();
  sum.images = IMAGES.map(x => x.id);
  sum.seeds = SEEDS;
  sum.jsonl = path.relative(ROOT, JSONL);
  fs.writeFileSync(SUMMARY, JSON.stringify(sum, null, 2) + '\n');
  console.log('\n[summary] ' + JSON.stringify(sum.flows, null, 1));
  console.log('[out] ' + path.relative(ROOT, JSONL) + '\n[out] ' + path.relative(ROOT, SUMMARY));
}

main();
