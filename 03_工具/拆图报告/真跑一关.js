#!/usr/bin/env node
/**
 * 真跑一关：用生产自己的 generate 链路（Generator.produce）跑一张目标图，
 * 再把体检那一套数字打出来 —— 用来验证"深色储备 → 峰窗"是不是在生产里也成立。
 *
 *   node 真跑一关.js <目标图.txt> [更多图…]
 *
 * 参数取当前方案（方案_v120四方向低管道去微棋盘.json）的 config，只把候选数/轮数/时限压低，
 * 让一两分钟能出结果；口径（审核、卡点 v2、玩 18 遍）与生产同一套函数。
 *
 * 只读：不写 输出文件/，结果只打在屏幕上。
 */
'use strict';
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const BIN = path.join(HERE, '..', '..', '02_工程', '完整主bin快照_20261012', 'bin');
const DEFAULT_SCHEME = path.join(HERE, '..', '..', '02_工程', '完整主bin快照_20261012', '方案文件夹', '方案_v120四方向低管道去微棋盘.json');
const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js',
               'playersim.js', 'analysis.js', 'generator.js'];

const SEED0 = parseInt(process.env.SEED || '20261018', 10) >>> 0;
let _rng = SEED0;
const seededMath = Object.create(Math);
seededMath.random = function () { _rng = (_rng * 1664525 + 1013904223) >>> 0; return _rng / 4294967296; };
const NO_GLOBAL_RNG = process.argv.includes('--no-global-rng');   // 测"生成器自己的 config.seed"
const sandbox = {
  console: { log() {}, warn() {}, error() {} }, module: { exports: {} },
  WeakMap, Map, Set, setTimeout, clearTimeout, Infinity, Math: NO_GLOBAL_RNG ? Math : seededMath, JSON
};
vm.createContext(sandbox);
for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BIN, 'js', f), 'utf8'), sandbox, { filename: f });
const A = sandbox.AntSolver;
const G = A.Generator;

const argv = process.argv.slice(2);
let schemePath = DEFAULT_SCHEME;
const files = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--scheme') { schemePath = path.resolve(argv[++i] || DEFAULT_SCHEME); continue; }
  if (argv[i].startsWith('--')) continue;
  files.push(argv[i]);
}
const base = JSON.parse(fs.readFileSync(schemePath, 'utf8')).config || {};
const CFG = Object.assign({}, base, {
  candidateCount: 4,
  difficultyRounds: 2,
  timeBudgetMs: 60000,
  requireHardPass: false,
  seed: parseInt(process.env.SEED || '20261018', 10)
});

const CUT_ONLY = process.argv.includes('--cut-only');
if (CUT_ONLY) Object.assign(CFG, {          // 只看"切球层"：关掉一切障碍与可用空间闸门
  usableSpaceTarget: 0,
  icePercent: 0, icePercentMin: 0, icePercentMax: 0,
  chainCount: 0, chainCountMin: 0, chainCountMax: 0,
  questionPercent: 0,
  blackPercent: 0, blackPercentMin: 0, blackPercentMax: 0,
  minPipes: 0, narrowPath: false,
  boxSizeMin: 14, boxSizeMax: 30
});

// v184 的 goodGate 实验已回退（生产代码里没有实现），这个开关目前【无效】；
// 保留它是为了能复现工作日志 41 节那次 A/B 的命令行。
const BEAT_PROPS = process.argv.includes('--beat-props');   // v187：给生产传"债务节拍"（手动档/方案也要有）
const ICE_TARGETED = process.argv.includes('--ice-targeted'); // v187：定向冰（先挂债车，再按配额补）
if (ICE_TARGETED) CFG.iceTargeted = true;
const ICE_CURE = process.argv.includes('--ice-cure');         // v188：冰挂"开壳车"（会提前打开债色的车）
if (ICE_CURE) { CFG.iceTargeted = true; CFG.iceTarget = 'cure'; }
if (process.argv.includes('--strangle')) CFG.strangleRepair = true;   // v189：被埋色的开壳车拆障碍
if (process.argv.includes('--press-band')) CFG.pressBand = true;      // v191：候选优先"峰窗落在 3.2~4.8"
if (process.argv.includes('--pressure-loop')) CFG.pressureLoop = true; // v192：收尾调压一次
if (process.argv.includes('--design')) { CFG.designDebt = true; }      // v198：设计器·把深埋车换到第 0 行
if (process.argv.includes('--design-sweep')) CFG.designSweep = true;   // v201：饥荒强度 3/2/1 扫描择优
if (process.argv.includes('--cut-layer')) CFG.cutMode = 'layerAware';  // v207：按层切车
if (process.argv.includes('--cut-component')) CFG.cutMode = 'component'; // v209：合球（色块×层）
if (process.argv.includes('--valve')) CFG.valvePlan = true;
{
  const vk = process.argv.indexOf('--valve-keep');
  if (vk > 0) CFG.valveRingShallow = parseInt(process.argv[vk + 1], 10) || 0;
  const vs = process.argv.indexOf('--valve-steps');
  if (vs > 0) CFG.valveIceSteps = parseInt(process.argv[vs + 1], 10) || 3;
}            // v211：阀门规划（数字冰压供给）
if (process.argv.includes('--chain-plan')) CFG.chainPlan = true;      // v212：定向锁链
if (process.argv.includes('--accept-solvable')) CFG.acceptMode = 'solvable';   // v214：只要求可解
if (process.argv.includes('--pressure-first')) CFG.pressureFirst = true;   // v215：压力优先（可解前提下峰窗越高越好）
if (process.argv.includes('--pressure-sweep')) { CFG.pressureSweep = true; CFG.pressureFirst = true; CFG.acceptMode = 'solvable'; }  // v215：压力扫描
if (process.argv.includes('--audit-first')) CFG.auditFirst = true;   // v216：全知线优先
if (process.argv.includes('--merge-scan')) CFG.mergeOrder = 'scan';   // v220：合球保留切球扫描顺序
if (process.argv.includes('--peel')) CFG.cutPixelOrder = 'peel';      // v221：外层优先+底→上+左→右
if (process.argv.includes('--fill-exposure')) CFG.fillOrder = 'exposure';   // v222：按暴露距离铺球
{
  const rd = process.argv.indexOf('--ring-deep');
  if (rd > 0) CFG.ringDeep = parseInt(process.argv[rd + 1], 10) || 0;
  const rs = process.argv.indexOf('--ring-shallow');
  if (rs > 0) CFG.ringShallow = parseInt(process.argv[rs + 1], 10) || 0;
  const di = process.argv.indexOf('--debt-cars');
  if (di > 0) CFG.debtCars = parseInt(process.argv[di + 1], 10) || 0;
  const dc = process.argv.indexOf('--debt-cap');
  if (dc > 0) CFG.debtCarCap = parseInt(process.argv[dc + 1], 10) || 32;
}
{
  const po = process.argv.indexOf('--place-order');
  if (po > 0) CFG.placeOrder = String(process.argv[po + 1] || '');
  const ps = process.argv.indexOf('--place-seed');
  if (ps > 0) CFG.placeSeed = parseInt(process.argv[ps + 1], 10) || 7;
}
if (process.argv.includes('--lid-sweep')) { CFG.lidSweep = true; CFG.auditFirst = true; CFG.acceptMode = 'solvable'; }  // v216：盖子强度扫描
if (process.argv.includes('--target-sweep')) { CFG.targetSweep = true; CFG.acceptMode = 'target'; }   // v224：目标扫描（峰窗3~4+稳健30~80）
if (process.argv.includes('--accept-solvable')) CFG.acceptMode = 'solvable';  // v214：只要求可解
{
  const rp = process.argv.indexOf('--ring-plan');
  if (rp > 0) CFG.ringPlan = String(process.argv[rp + 1] || '').toUpperCase();  // A/B/C：环上供给与债点配额
}
{
  const i = process.argv.indexOf('--sched-gap');
  if (i > 0) CFG.scheduleDeepGap = Math.max(1, Math.min(10, parseInt(process.argv[i + 1], 10) || 0));  // v213：每 gap 辆浅层插 1 辆深层
}
{
  const i = process.argv.indexOf('--design-count');
  if (i > 0) CFG.designDebtCount = Math.max(1, Math.min(6, parseInt(process.argv[i + 1], 10) || 4));
  const j = process.argv.indexOf('--design-target');
  if (j > 0) CFG.designRow0Target = Math.max(0, Math.min(8, parseInt(process.argv[j + 1], 10) || 3));
  const dr = process.argv.indexOf('--deep-ring');
  if (dr > 0) CFG.designDeepRing = Math.max(0, Math.min(4, parseInt(process.argv[dr + 1], 10) || 0));
  const q = process.argv.indexOf('--design-inflate');
  if (q > 0) CFG.designInflate = parseFloat(process.argv[q + 1]) || 0;
  if (j > 0) CFG.designSupplyTarget = CFG.designRow0Target;   // v204：档位含义改为"可点早车数" 
}
{
  const i = process.argv.indexOf('--portfolio');
  if (i > 0) CFG.portfolioK = Math.max(1, parseInt(process.argv[i + 1], 10) || 1);  // v194：一图多产
}
const GOOD_GATE = process.argv.includes('--gate');
if (GOOD_GATE) CFG.goodGate = true;

const FIT_SMALL = process.argv.includes('--fit-small');
if (FIT_SMALL) Object.assign(CFG, {         // 小图适配：闸门放宽、盒容量按像素数落到 14~30，障碍照旧
  usableSpaceTarget: 0,
  boxSizeMin: 14, boxSizeMax: 30,
  boardRowsMin: 6, boardRowsMax: 9, boardColsMin: 7, boardColsMax: 10
});


if (!files.length) {
  console.log('用法：node 真跑一关.js <目标图.txt> [更多图…]');
  process.exit(1);
}


// ---------------------------------------------------------------- 按层切 + 动态排序（实验：forcedBoxes 直通）
// 与 拆图报告.js 同一套规则，只是把"车单"喂给生产：
//   ① (层,颜色) 成车；② <12px 的碎组并到同色相邻层（层号取更深的）；
//   ③ 容量按方案的盒容量中值劈；④ 顺序 = 每步重算可达量、优先能填满的车。
const LAYER_CUT = process.argv.includes('--layer-cut');
function buildLayerCars(blocks, R, C) {
  const parsed0 = A.parseLevel({ blocks, bufferLimit: CFG.bufferLimit || 5 });
  const li = G.veinLayers(parsed0, {});
  if (!li) return null;
  const colPx = {}; let P = 0;
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) { const v = blocks[r][c]; if (v > 0) { P++; colPx[v] = (colPx[v] || 0) + 1; } }
  // 分组
  const groups = [];
  for (const v of li.veins) {
    const key = v.level + ':' + v.color;
    let g = groups.find(x => x.key === key);
    if (!g) { g = { key, level: v.level, color: v.color, size: 0 }; groups.push(g); }
    g.size += v.pixels;
  }
  // 同色碎组合并
  const MIN = 12, byColor = {};
  groups.forEach(g => (byColor[g.color] = byColor[g.color] || []).push(g));
  const merged = [];
  Object.keys(byColor).forEach(k => {
    let list = byColor[k].slice().sort((a, b) => a.level - b.level);
    let guard = list.length * 4 + 10;
    while (guard-- > 0 && list.length > 1) {
      let si = -1;
      for (let i = 0; i < list.length; i++) if (list[i].size < MIN) { si = i; break; }
      if (si < 0) break;
      const ti = (si + 1 < list.length) ? si + 1 : si - 1;
      if (ti < 0) break;
      const a = list[si], b = list[ti];
      const ng = { color: +k, level: Math.max(a.level, b.level), size: a.size + b.size };
      list = list.filter((_, i) => i !== si && i !== ti);
      list.push(ng); list.sort((x, y) => x.level - y.level);
    }
    list.forEach(g => merged.push(g));
  });
  // 按方案的盒容量中值劈车
  const minC = CFG.boxSizeMin || 20, maxC = CFG.boxSizeMax || 32;
  const avgCap = Math.max(2, (minC + maxC) / 2);
  const cars = [];
  merged.forEach(g => {
    const n = Math.max(1, Math.round(g.size / avgCap));
    const base = Math.floor(g.size / n), extra = g.size - base * n;
    for (let j = 0; j < n; j++) cars.push({ color: g.color, count: base + (j < extra ? 1 : 0), level: g.level });
  });
  // 顺序：dynamic（默认，每步挑能填满的）/ static（按层号，B1 口径）
  const STATIC_ORDER = process.argv.includes('--order-static');
  if (STATIC_ORDER) {
    cars.sort((a, b) => (a.level - b.level) || (a.color - b.color) || (b.count - a.count));
    return cars;
  }
  // 动态排序（与报告同一规则）
  const Sim = A.Simulator;
  const eliminated = A.outsideReachSeed(blocks, R, C, false);
  const buffer = [];
  const remaining = cars.slice();
  const ordered = [];
  function reachOf(color) {
    const scratch = eliminated.map(row => row.slice());
    return Sim.floodFillEliminate(scratch, blocks, R, C, color, Infinity, null, null, false);
  }
  function release() {
    for (let i = buffer.length - 1; i >= 0; i--) {
      const b = buffer[i];
      b.need -= Sim.floodFillEliminate(eliminated, blocks, R, C, b.color, b.need, null, null, false);
      if (b.need <= 0) buffer.splice(i, 1);
    }
  }
  let guard = remaining.length * 3 + 10;
  while (remaining.length && guard-- > 0) {
    const cache = {}; const cols = {};
    remaining.forEach(c => { cols[c.color] = 1; });
    Object.keys(cols).forEach(k => { cache[k] = reachOf(+k); });
    let best = null, bestScore = -Infinity;
    for (const c of remaining) {
      const r = cache[c.color] || 0;
      const fill = Math.min(r, c.count);
      const full = (r >= c.count) ? 1 : 0;
      const score = full * 1e9 + fill * 1000 - (c.level || 0) * 10 - c.count * 0.01;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    const taken = Sim.floodFillEliminate(eliminated, blocks, R, C, best.color, best.count, null, null, false);
    if (taken < best.count) buffer.push({ color: best.color, need: best.count - taken, since: ordered.length });
    release();
    ordered.push(best);
    remaining.splice(remaining.indexOf(best), 1);
  }
  return ordered;
}


// 债务节拍：把"颜色还没露脸"的车提前到 15%/60%/80% 的位置
function applyBeatsToCars(carsIn, per, positions) {
  per = Math.max(1, per || 1);
  const cars = carsIn.map(c => Object.assign({}, c));
  const total = cars.reduce((a, c) => a + c.count, 0);
  const moved = [];
  (positions || [15, 60, 80]).forEach(p => {
    for (let q = 0; q < per; q++) {
      let acc = 0, idx = cars.length - 1;
      for (let i = 0; i < cars.length; i++) { acc += cars[i].count; if (acc >= p / 100 * total) { idx = i; break; } }
      const seen = {};
      for (let i = 0; i <= idx; i++) seen[cars[i].color] = 1;
      let ci = -1;
      for (let i = idx + 1; i < cars.length; i++) {
        const c = cars[i];
        if (c._moved || seen[c.color]) continue;
        if ((c.level || 0) >= 1) { ci = i; break; }
      }
      if (ci < 0) {
        let deepest = -1, dl = -1;
        for (let i = idx + 1; i < cars.length; i++) {
          const c = cars[i]; if (c._moved) continue;
          const L = c.level || 0; if (L > dl) { dl = L; deepest = i; }
        }
        ci = deepest;
      }
      if (ci < 0) return cars;
      const car = cars.splice(ci, 1)[0];
      car._moved = true;
      cars.splice(idx, 0, car);
      moved.push({ color: car.color, count: car.count, fromLevel: car.level, pos: p });
    }
  });
  cars._movedInfo = moved;
  return cars;
}


// 【v187】债务节拍：与 app.js 的 genAutoParams 同一套（像素进度 15/60/80%，挑"还没露脸的颜色"）
function buildBeatProps(blocks, R, C) {
  var P = 0;
  for (var r = 0; r < R; r++) for (var c = 0; c < C; c++) if (blocks[r][c] > 0) P++;
  var N = Math.max(40, Math.min(55, Math.round(P / 22)));
  var beats = N >= 45 ? 3 : 2;
  var poss = beats >= 3 ? [15, 60, 80] : [15, 70];
  var eo = A.eliminationOrder(blocks, R, C, false), rd = eo.round, rounds = eo.rounds;
  var vein = [], layerTot = {};
  for (var r2 = 0; r2 < R; r2++) for (var c2 = 0; c2 < C; c2++) {
    var v2 = blocks[r2][c2]; if (v2 <= 0) continue;
    var d2 = rd[r2][c2] || 0, hit = null;
    for (var q2 = 0; q2 < vein.length; q2++) if (vein[q2].round === d2 && vein[q2].color === v2) { hit = vein[q2]; break; }
    if (!hit) { hit = { round: d2, color: v2, size: 0 }; vein.push(hit); }
    hit.size++; layerTot[d2] = (layerTot[d2] || 0) + 1;
  }
  var firstRound = {};
  vein.forEach(function (v) { if (firstRound[v.color] == null || v.round < firstRound[v.color]) firstRound[v.color] = v.round; });
  var cumAll = [], acc = 0;
  for (var d3 = 1; d3 <= rounds; d3++) { acc += (layerTot[d3] || 0); cumAll[d3] = acc; }
  var props = [];
  for (var b2 = 0; b2 < poss.length; b2++) {
    var targetPx = poss[b2] / 100 * P, rStar = 1;
    for (var d4 = 1; d4 <= rounds; d4++) if (cumAll[d4] >= targetPx) { rStar = d4; break; }
    var cand = Object.keys(firstRound).map(Number).filter(function (c) { return firstRound[c] > rStar; })
      .sort(function (a, b) { return firstRound[a] - firstRound[b]; });
    if (!cand.length) continue;
    props.push({ kind: b2 === 0 ? 'chain' : 'ice', debtColor: cand[0],
      steps: b2 === 1 ? 6 : (b2 === 2 ? 10 : 0), pos: poss[b2], round: firstRound[cand[0]] });
  }
  return props;
}

console.log('方案：' + path.basename(schemePath) + '（候选 ' + CFG.candidateCount + ' × 轮 ' + CFG.difficultyRounds + '，单关 ' + (CFG.timeBudgetMs / 1000) + 's）'
  + (CUT_ONLY ? '  【只看切球层：障碍全关、可用空间闸门关】' : (FIT_SMALL ? '  【小图适配：闸门放宽、盒 14~30、障碍照旧】' : '  【生产默认：带障碍】')) + '\n');
const rows = [];
for (const f of files) {
  const name = path.basename(f);
  let blocks;
  try { blocks = G.blocksFromTXT(fs.readFileSync(f, 'utf8')); }
  catch (e) { console.log('✗ ' + name + ' 读不出：' + e.message); continue; }
  const R = blocks.length, C = blocks[0].length;
  console.log('━━ ' + name + '  (' + R + '×' + C + ')');

  let li = null;
  try { li = G.veinLayers(A.parseLevel({ blocks, bufferLimit: CFG.bufferLimit || 5 }), {}); } catch (e) {}
  const colPx = {}; let pix = 0;
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) { const v = blocks[r][c]; if (v > 0) { pix++; colPx[v] = (colPx[v] || 0) + 1; } }
  const deep = li ? Object.keys(colPx).map(Number).filter(c => (li.colorMinLevel[c] || 0) >= 3) : [];
  const deepPx = deep.reduce((a, c) => a + colPx[c], 0);

  const t0 = Date.now();
  let res = null, err = null;
  let forced = null;
  if (LAYER_CUT) {
    try { forced = buildLayerCars(blocks, R, C); } catch (e) { forced = null; }
    const BEATS = (function () {
      const i = process.argv.indexOf('--beats');
      return i > 0 ? parseInt(process.argv[i + 1], 10) || 0 : 0;
    })();
    const BEAT_POS = (function () {
      const i = process.argv.indexOf('--beat-pos');
      if (i < 0) return null;
      const v = String(process.argv[i + 1] || '').split(/[,\s]+/).map(Number).filter(x => x > 0 && x < 100);
      return v.length ? v : null;
    })();
    if (forced && BEATS > 0) {
      forced = applyBeatsToCars(forced, BEATS, BEAT_POS);
      console.log('   债务节拍：每笔提前 ' + BEATS + ' 辆，共 ' + (forced._movedInfo || []).length + ' 辆'
        + '（' + (forced._movedInfo || []).map(m => m.color + '号/' + m.count + 'px→' + m.pos + '%').join('，') + '）');
    }
    if (forced) console.log('   切法：按层切 + 动态排序 → ' + forced.length + ' 辆车（forcedBoxes 直通）');
    else console.log('   ⚠ 按层切失败，退回生产默认切法');
  }
  try {
    const cfgRun = Object.assign({}, CFG, { mapSize: R });
    if (forced) cfgRun.forcedBoxes = forced.map(c => ({ color: c.color, count: c.count }));
    if (BEAT_PROPS) {
      try {
        const bp = buildBeatProps(blocks, R, C);
        if (bp && bp.length) { cfgRun.beatProps = bp; console.log('   债务节拍：' + bp.map(b => b.kind + '·' + b.debtColor + '号@' + b.pos + '%').join('，')); }
      } catch (e) {}
    }
    res = G.produce(blocks, cfgRun);
  }
  catch (e) { err = e; }
  const ms = Date.now() - t0;

  if (err || !res) {
    console.log('   ✗ 生成异常：' + (err ? err.message : '无返回') + '（' + (ms / 1000).toFixed(1) + 's）\n');
    rows.push({ name, ok: false });
    continue;
  }
  if (!res.level) {
    const why = res.lastFailReason || res.fallbackReason || res.reason || res.error || (res.valid === false ? '未产出关卡结构' : '无 level');
    console.log('   ✗ 没出关：' + why + '（' + (ms / 1000).toFixed(1) + 's）'
      + ' ｜ 返回字段：' + Object.keys(res).slice(0, 14).join(',')
      + (res.structural ? ' ｜ structural=' + JSON.stringify(res.structural).slice(0, 200) : '')
      + (res.boardFit ? ' ｜ boardFit=' + JSON.stringify(res.boardFit).slice(0, 200) : ''));
    rows.push({ name, ok: false });
    continue;
  }
  const parsed = A.parseLevel(res.level);
  const sr = res.solveResult || {};
  const audit = res.audit || {};
  const v2 = (res.generationEval && res.generationEval.auditV2 && res.generationEval.auditV2.worst) || null;
  let buried = null, play = null;
  try {
    const b = G.buriedCountOf(parsed);
    buried = (b && typeof b === 'object') ? (b.buried != null ? b.buried : (b.stuck != null ? b.stuck : null)) : b;
  } catch (e) {}
  try { play = G.chokeV2PlayBatch(parsed, { n: 18 }); } catch (e) {}

  console.log('   深色 ' + deep.length + ' 个 / ' + (pix ? (deepPx / pix * 100).toFixed(1) : '0') + '%'
    + ' ｜ 生成 ' + (ms / 1000).toFixed(1) + 's ｜ 有效 ' + (res.valid ? '是' : '否')
    + ' ｜ 全知 ' + (sr.completed ? '通关' : '未通关') + ' ' + (sr.steps || '-') + ' 步');
  console.log('   审核：' + (audit.tier || '-') + ' ｜ 中后期峰窗 ' + (audit.midLateMax != null ? audit.midLateMax : '-')
    + ' ｜ 前期峰窗 ' + (audit.earlyMax != null ? audit.earlyMax : '-')
    + ' ｜ 难度 ' + (res.difficulty ? res.difficulty.score : '-') + ' [' + (res.difficulty ? res.difficulty.grade : '-') + ']');
  if (v2) console.log('   卡点v2：独木桥 ' + v2.bridges + ' / 预算判断点 ' + v2.r9 + ' / 无满解 ' + v2.noGood + ' / 70%前高压% ' + v2.hiBefore70Pct);
  // 六条 = 生产内 goodV3 的同一口径（峰窗用 18 局中位），没有标记时才就地算
  const gv = res.goodV3 || null;
  const passed = gv ? (6 - gv.fails.length) : null;
  const fails = gv ? gv.fails.slice() : [];
  if (res.pressureLoop) console.log('   [收尾调压] ' + JSON.stringify(res.pressureLoop));
  if (res.goodV3) console.log('   [生产内标记] 好关v3 ' + (res.goodV3.pass ? '✅ 6/6' : '✗ ' + res.goodV3.fails.join('、'))
    + ' · 稳健 ' + res.goodV3.steadyWonPct + '% · 峰窗 ' + res.goodV3.midLateMax + ' · 被埋 ' + res.goodV3.buried);
  console.log('   六条 ' + passed + '/6' + (fails.length ? '  ✗ ' + fails.join('、') : '  ✅ 全过'));
  console.log('   被埋 ' + (buried == null ? '-' : buried) + ' 辆'
    + (play ? ' ｜ 玩18遍：稳健 ' + play.steadyWonPct + '% · 峰窗 ' + play.lateMax.min + '~' + play.lateMax.max + '（均 ' + play.lateMax.mean + '）· 策略差 ' + play.spreadPct + ' 个点' : ''));
  console.log('');

  rows.push({ name, ok: true, deep: deep.length, deepShare: pix ? deepPx / pix : 0, ms,
    tier: audit.tier || '-', peak: audit.midLateMax, early: audit.earlyMax,
    diff: res.difficulty ? res.difficulty.score : null, buried,
    steady: play ? play.steadyWonPct : null, lateMin: play ? play.lateMax.min : null,
    lateMax: play ? play.lateMax.max : null, lateMean: play ? play.lateMax.mean : null });
}

if (rows.filter(r => r.ok).length > 1) {
  console.log('── 汇总');
  console.log('图\t深色\t深层%\t审核\t峰窗\t被埋\t难度\t稳健通关\t峰窗区间');
  rows.filter(r => r.ok).forEach(r => console.log([r.name, r.deep, (r.deepShare * 100).toFixed(1) + '%', r.tier,
    r.peak, r.buried, r.diff, r.steady + '%', r.lateMin + '~' + r.lateMax].join('\t')));
}
