#!/usr/bin/env node
/** v540：显式实验容量带[16,31]下，验证007同色容量分配；不改生产默认。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '游戏主bin', 'bin', 'js');
const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js',
  'playersim.js', 'analysis.js', 'car-sequencer.js', 'solver-analysis.js', 'experience-goal.js',
  'capacity-tuner.js', 'instant-playout.js', 'generator.js', 'source-preflight.js'];
const IMAGE = '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_007.txt';
const SEEDS = [1001, 1002, 88001, 32677];
const TUNE_MIN = 16, TUNE_MAX = 31;
const OUT = path.resolve(ROOT, '03_工具/好关评分/容量分配_松弛带_v540.json');
function load() {
  const sb = { console: { log() {}, warn() {}, error() {} }, module: { exports: {} },
    WeakMap, Map, Set, Date, Math, JSON, setTimeout, clearTimeout, Infinity };
  vm.createContext(sb);
  for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BIN, f), 'utf8'), sb, { filename: f });
  return sb.AntSolver;
}
function hash(x) { return crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex'); }
function generationConfig(G, blocks, seed) {
  const band = G.deriveCapacityBand(blocks);
  return {
    seed, ruleMode: 'instantChain', generatorFlow: 'new_fixed',
    boxSizeMin: band.band[0], boxSizeMax: band.band[1],
    capNormMin: band.band[0], capNormMax: band.band[1],
    boardRowsMin: 7, boardRowsMax: 7, boardColsMin: 8, boardColsMax: 8,
    boardHardRange: true, boardAuto: false, boardAllowSquare: true, boardFitGuard: 'warn',
    p7BaseCount: 0, p7Repair: false, trapPost: false, pool: 1,
    instantPlanPolicy: 'targetBuffer', instantPlanTargetBuffer: 4,
    instantPlanMaxDebt: 40, instantPlanBranchCount: 2,
    instantPlanBranchDebtRoots: true, instantPlanBranchPrefixDebts: 8,
    experienceGoal: true, instantReleaseRoute: false,
    goalPerRoundMs: 20000, goalMaxMs: 30000, goalMaxRounds: 2,
    goalSharedBudget: true, candidateCount: 1, acceptMode: 'target',
    targetBand3Min: 0, targetBand4Min: 0, targetPlayerPassMin: 0
  };
}
function evaluationConfig(cfg) {
  const o = Object.assign({}, cfg, {
    boxSizeMin: TUNE_MIN, boxSizeMax: TUNE_MAX,
    capNormMin: TUNE_MIN, capNormMax: TUNE_MAX
  });
  return o;
}
function metricsOf(A, level, ev, cfg, baselineCap) {
  const q = ev && ev.goodV3 ? A.Quality.fromGeneration(Object.assign({}, ev, {
    level, valid: true, config: cfg
  })) : null;
  const fc = ev && ev.goodV3 && ev.goodV3.fillCurve || {};
  const xp = ev && ev.solveResult ? A.ExperienceGoal.evaluate(level, {
    solveResult: ev.solveResult, decision: false, instantChain: true
  }) : null;
  const ca = A.Quality.capacityEvidence(level, cfg);
  return {
    valid: !!(ev && ev.valid), struct: !!(q && q.gatePass),
    gateReasons: q && q.gateReasons || [], gateDistance: q && q.gateDistance,
    freeRunMax: fc.freeRunMax != null ? fc.freeRunMax : null,
    freeLowPct: fc.freeLowPct != null ? fc.freeLowPct : null,
    fullMedian2: fc.fullMedian2 != null ? fc.fullMedian2 : null,
    midBuffer34Pct: xp && xp.metrics && xp.metrics.midBuffer34Pct,
    maxBuffer: xp && xp.metrics && xp.metrics.maxBuffer,
    significantReleaseCount: xp && xp.metrics && xp.metrics.significantReleaseCount,
    capacity: {
      conserved: ca.conserved, boardFloorPass: ca.boardFloorPass,
      aboveMax: ca.aboveMax, belowMin: ca.belowMin,
      microCars: ca.microCars, minCap: ca.minCap, maxCap: ca.maxCap
    },
    belowMinNotWorse: !baselineCap || ca.belowMin <= baselineCap.belowMin
  };
}
function protectedOk(m) {
  return !!(m.valid && m.capacity.conserved && m.capacity.boardFloorPass &&
    m.capacity.aboveMax === 0 && m.belowMinNotWorse &&
    (!m.capacity.microCars || m.capacity.microCars.length === 0));
}
function better(a, b) {
  if (!b) return true;
  if (a.struct !== b.struct) return a.struct;
  if ((a.gateReasons || []).length !== (b.gateReasons || []).length)
    return (a.gateReasons || []).length < (b.gateReasons || []).length;
  if ((a.freeRunMax || 999) !== (b.freeRunMax || 999)) return (a.freeRunMax || 999) < (b.freeRunMax || 999);
  if ((a.freeLowPct || 0) !== (b.freeLowPct || 0)) return (a.freeLowPct || 0) < (b.freeLowPct || 0);
  return (a.fullMedian2 || 99) < (b.fullMedian2 || 99);
}
function run(A, seed) {
  const G = A.Generator, EG = A.ExperienceGoal;
  const blocks = G.blocksFromTXT(fs.readFileSync(path.join(ROOT, IMAGE), 'utf8'));
  const genCfg = generationConfig(G, blocks, seed);
  const evalCfg = evaluationConfig(genCfg);
  const t0 = Date.now();
  let base = null;
  try { base = G.produceGoal(blocks, genCfg); }
  catch (e) { base = { level: null, valid: false, error: String((e && e.message) || e) }; }
  if (!base || !base.level || !base.valid) {
    return { seed, valid: false, error: base && base.error || 'no_base_level', wallMs: Date.now() - t0, variants: [] };
  }
  const baseEval = G.evaluateLevel(base.level, evalCfg);
  const baseMetrics = metricsOf(A, base.level, baseEval, evalCfg, null);
  const made = A.CapacityTuner.variants(base.level, base.solveResult, {
    capMin: TUNE_MIN, capMax: TUNE_MAX, maxCars: 8, maxVariants: 48
  });
  const out = {
    seed, valid: true, generationBand: [genCfg.boxSizeMin, genCfg.boxSizeMax],
    experimentalBand: [TUNE_MIN, TUNE_MAX], generationMs: Date.now() - t0,
    base: { hash: hash(base.level), metrics: baseMetrics }, keyCars: made.keyCars,
    rejected: made.rejected, tested: 0, protectedRejected: 0,
    variants: [], best: null, elapsedMs: 0
  };
  const variantStart = Date.now();
  for (const v of made.variants) {
    if (Date.now() - variantStart >= 20000) { out.stopped = 'variant_budget'; break; }
    const ev = G.evaluateLevel(v.level, evalCfg);
    const m = metricsOf(A, v.level, ev, evalCfg, baseMetrics.capacity);
    const row = { meta: v.meta, hash: hash(v.level), metrics: m, level: v.level };
    out.tested++; out.variants.push(row);
    if (!protectedOk(m)) { out.protectedRejected++; continue; }
    if (better(m, out.best && out.best.metrics)) out.best = row;
  }
  if (out.best) {
    const bestEv = G.evaluateLevel(out.best.level, evalCfg);
    const full = EG.evaluate(out.best.level, { solveResult: bestEv.solveResult, decision: true, instantChain: true });
    out.best.experience = full && {
      pass: full.pass, status: full.status, reasons: full.reasons,
      metrics: full.metrics, release: full.releaseDecision && full.releaseDecision.status
    };
  }
  out.elapsedMs = Date.now() - t0;
  console.log(JSON.stringify({
    seed, genBand: out.generationBand, tuneBand: out.experimentalBand,
    tested: out.tested, keyCars: made.keyCars.length,
    base: { struct: baseMetrics.struct, freeRun: baseMetrics.freeRunMax, mid: baseMetrics.midBuffer34Pct, cap: baseMetrics.capacity },
    best: out.best && { struct: out.best.metrics.struct, freeRun: out.best.metrics.freeRunMax,
      mid: out.best.metrics.midBuffer34Pct, max: out.best.metrics.maxBuffer,
      targetPass: out.best.experience && out.best.experience.pass,
      release: out.best.experience && out.best.experience.release }
  }));
  out.best && delete out.best.level;
  out.variants = out.variants.map(x => Object.assign({}, x, { level: undefined }));
  return out;
}
const A = load();
const rows = [];
for (const seed of SEEDS) rows.push(run(A, seed));
const validRows = rows.filter(x => x.valid && x.base);
const pairs = validRows.map(x => ({
  seed: x.seed,
  freeRun: [x.base.metrics.freeRunMax, x.best && x.best.metrics.freeRunMax],
  freeRunDrop2: !!(x.best && x.base.metrics.freeRunMax != null && x.best.metrics.freeRunMax <= x.base.metrics.freeRunMax - 2),
  struct: [x.base.metrics.struct, x.best && x.best.metrics.struct],
  targetPass: !!(x.best && x.best.experience && x.best.experience.pass),
  capacityOk: !x.best || protectedOk(x.best.metrics)
}));
const summary = {
  image: '007', seeds: SEEDS, rows: rows.length, valid: validRows.length,
  generationBand: '[31,31] (derived)', experimentalBand: '[16,31]',
  tested: validRows.reduce((n, x) => n + x.tested, 0),
  variantsConstructed: validRows.reduce((n, x) => n + (x.rejected ? x.rejected.length : 0) + x.tested, 0),
  protectedRejected: validRows.reduce((n, x) => n + x.protectedRejected, 0),
  freeRunDrop2: pairs.filter(x => x.freeRunDrop2).length,
  structTransitions: pairs.filter(x => !x.struct[0] && x.struct[1]).length,
  targetPasses: pairs.filter(x => x.targetPass).length,
  capacityRegressions: pairs.filter(x => !x.capacityOk).map(x => x.seed),
  decision: pairs.filter(x => x.freeRunDrop2 && x.struct[1]).length > 0
    ? '显式[16,31]下出现结构改善信号，保留候选，不进入生产默认。'
    : '显式[16,31]下没有结构改善，回退容量分配方向；[16,31]不得写回生产。'
};
const report = { schema: 'capacity-allocation-relaxed-band-v1', date: '2026-10-26',
  preregistration: '容量分配_松弛带实验_预登记_v540.md', summary, pairs, rows };
fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ summary, pairs }, null, 2));
if (summary.capacityRegressions.length) process.exitCode = 1;
