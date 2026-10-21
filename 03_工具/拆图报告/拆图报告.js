#!/usr/bin/env node
/**
 * 拆图报告 —— 一张目标图的「结构」与两种切法的对照
 *
 *   node 拆图报告.js <目标图.txt> [输出.html]
 *
 * 只读：不生成关卡、不写生产目录，只输出一份 HTML 报告。
 *
 * 报告里有三张同样的图，三种看法：
 *   ① 原图色     —— 颜色号
 *   ② 层（静态） —— 谁包着谁；层 0 = 现在就够得着。只由图决定，换切法/换顺序都不变。
 *   ③ 序号（日程）—— 求解器里那个「🔢序号」= 贪心剥皮的一种走法。换一种吃法就变。
 *
 * 然后拿两种切法各切一份车单，在「纯切球层」干跑一遍（不进棋盘、不含障碍）：
 *   A 按日程切（= 现在生成器/切球规划器的口径：矿脉按轮次+颜色，按平均容量劈车）
 *   B 按层切（= 每层每色单独成车：开壳车与被包车天然分开）
 * 看两种切法各自逼出多少债、要等多久才能还、有没有颜色被埋。
 *
 * 注意：干跑不含棋盘与障碍，所以它看不到「61 那种被棋盘卡死」的死法；
 *       它只能回答「切法本身会把压力做成什么样」。
 */
'use strict';

const vm = require('vm');
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const BINJS = path.join(HERE, '..', '..', '02_工程', '完整主bin快照_20261012', 'bin', 'js');
const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js',
               'playersim.js', 'analysis.js', 'generator.js'];

function loadEngine() {
  const sandbox = {
    console: { log() {}, warn() {}, error() {} }, module: { exports: {} },
    WeakMap, Map, Set, setTimeout, clearTimeout, Infinity, Math, JSON
  };
  vm.createContext(sandbox);
  for (const f of FILES) {
    vm.runInContext(fs.readFileSync(path.join(BINJS, f), 'utf8'), sandbox, { filename: f });
  }
  return sandbox.AntSolver;
}

// ---------------------------------------------------------------- 工具
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const pct = (a, b) => (b ? (100 * a / b) : 0);
const fmt = (x, n = 1) => (Math.round(x * Math.pow(10, n)) / Math.pow(10, n)).toFixed(n);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// 色号 → 稳定色相
function colorHue(id) {
  const h = (id * 47 + 17) % 360;
  return `hsl(${h},68%,55%)`;
}
const LAYER_PAL = ['#1f6fb2', '#2fa4a8', '#6cc07a', '#d9c04a', '#e08a3c', '#c8553d', '#8e3b8e', '#5b4b8a', '#3a3a3a'];
function layerColor(lv) { return lv === 99 ? '#ff00ff' : LAYER_PAL[Math.min(lv, LAYER_PAL.length - 1)]; }

// ---------------------------------------------------------------- 载入 + 解析
const A = loadEngine();
const G = A.Generator;

if (process.argv.length < 3) {
  console.error('用法: node 拆图报告.js <目标图.txt> [输出.html]');
  process.exit(1);
}
const SRC = path.resolve(process.argv[2]);
const OUT = process.argv[3] ? path.resolve(process.argv[3])
  : path.join(HERE, '拆图报告_' + path.basename(SRC, '.txt') + '.html');

const raw = fs.readFileSync(SRC, 'utf8');
const blocks = G.blocksFromTXT(raw);
const R = blocks.length, C = blocks[0].length;
const parsed = A.parseLevel({ blocks, bufferLimit: 5 });

let P = 0; const colTot = {};
for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
  const v = blocks[r][c];
  if (v > 0) { P++; colTot[v] = (colTot[v] || 0) + 1; }
}
const COLOR_N = Object.keys(colTot).length;

// ---------------------------------------------------------------- 结构：层 + 日程
const layerInfo = G.veinLayers(parsed, {});
const eo = A.eliminationOrder(blocks, R, C, false);
const layers = layerInfo.veins.map(v => v.level);
const maxLevel = layerInfo.maxLevel;
const roundOf = (r, c) => eo.round[r][c] || 0;
const veinIdOf = (r, c) => layerInfo.id[r * C + c];

// 每层：矿脉数 / 像素 / 颜色
const levelStat = {};
for (const v of layerInfo.veins) {
  const L = v.level;
  levelStat[L] = levelStat[L] || { veins: 0, px: 0, colors: {}, colorVeins: {} };
  levelStat[L].veins++; levelStat[L].px += v.pixels;
  levelStat[L].colors[v.color] = (levelStat[L].colors[v.color] || 0) + v.pixels;
  levelStat[L].colorVeins[v.color] = (levelStat[L].colorVeins[v.color] || 0) + 1;
}
// 每轮（日程）：颜色 / 像素
const roundStat = {};
for (const o of eo.order) {
  const k = o.round;
  roundStat[k] = roundStat[k] || { colors: {}, px: 0 };
  roundStat[k].colors[o.color] = (roundStat[k].colors[o.color] || 0) + 1;
  roundStat[k].px++;
}

// ---------------------------------------------------------------- 切法 A：按日程切（= 生产默认 solverGuidedBoxes 的确定性版）
// 生产的真实切法（generator.js solverGuidedBoxes）：反复做三件事——
//   ① 统计每种颜色"此刻可达"多少像素；② 选可达最多的那个颜色；
//   ③ 按本盒容量吃满它（吃不满就只吃这么多，盒子的 count = 实际吃到的量）。
// 所以这个切法【按定义就不会产生债】：盒子的大小永远等于它能吃到的量。
// 这里把"本盒容量"固定成平均容量（生产里是区间随机采样），并省掉 mergeSmallTailBoxes。
function buildPlanBySchedule() {
  const N0 = Math.max(40, Math.min(55, Math.round(P / 22)));
  const cap = Math.max(2, Math.round(P / N0));
  const Sim = A.Simulator;
  let eliminated = A.outsideReachSeed(blocks, R, C, false);
  const cars = [];
  let guard = R * C + 100;
  while (guard-- > 0) {
    const colors = new Set();
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
      if (!eliminated[r][c] && blocks[r][c] > 0) colors.add(blocks[r][c]);
    }
    if (!colors.size) break;
    let best = null, bestN = 0;
    for (const col of colors) {
      const scratch = eliminated.map(row => row.slice());
      const n = Sim.floodFillEliminate(scratch, blocks, R, C, col, cap, null, null, false);
      if (n > bestN) { bestN = n; best = col; }
    }
    if (best === null || bestN <= 0) break;
    const consumed = Sim.floodFillEliminate(eliminated, blocks, R, C, best, cap, null, null, false);
    if (consumed <= 0) break;
    cars.push({ color: best, cap: consumed, round: cars.length + 1 });
  }
  return { name: 'A · 按日程切（生产默认）', cars, N: cars.length,
    note: '每次选"此刻可达像素最多"的颜色，按平均容量封箱；盒子大小 = 实际吃到的量 → 按定义不产生债' };
}

// ---------------------------------------------------------------- 切法 B1：按层切 + 碎车合并
const MIN_CAR = 10;
function buildPlanByLayer(mergeSmall) {
  // 1) (层, 颜色) 分组 —— 同色连通块按依赖层归堆
  const groups = [];
  for (const v of layerInfo.veins) {
    const key = v.level + ':' + v.color;
    let g = groups.find(x => x.key === key);
    if (!g) { g = { key, level: v.level, color: v.color, size: 0 }; groups.push(g); }
    g.size += v.pixels;
  }
  // 2) 同色小片合并：<MIN_CAR 的组合并到相邻层（优先更深的一层），合并后层号取较浅的那个
  const byColor = {};
  groups.forEach(g => (byColor[g.color] = byColor[g.color] || []).push(g));
  const merged = [];
  Object.keys(byColor).forEach(k => {
    let list = byColor[k].slice().sort((a, b) => a.level - b.level);
    if (mergeSmall) {
      let guard = list.length * 4 + 10;
      while (guard-- > 0 && list.length > 1) {
        let si = -1;
        for (let i = 0; i < list.length; i++) if (list[i].size < MIN_CAR) { si = i; break; }
        if (si < 0) break;
        const ti = (si + 1 < list.length) ? si + 1 : si - 1;
        if (ti < 0) break;
        const a = list[si], b = list[ti];
        const ng = { color: +k, level: Math.max(a.level, b.level), size: a.size + b.size };
        list = list.filter((_, i) => i !== si && i !== ti);
        list.push(ng);
        list.sort((x, y) => x.level - y.level);
      }
    }
    list.forEach(g => merged.push(g));
  });
  // 3) 每组按平均容量劈车
  const N0 = Math.max(40, Math.min(55, Math.round(P / 22)));
  const avgCap = P / N0;
  const cars = [];
  merged.forEach(g => {
    const n = Math.max(1, Math.round(g.size / avgCap));
    const base = Math.floor(g.size / n), extra = g.size - base * n;
    for (let j = 0; j < n; j++) cars.push({ color: g.color, cap: base + (j < extra ? 1 : 0), level: g.level });
  });
  cars.sort((a, b) => (a.level - b.level) || (a.color - b.color) || (b.cap - a.cap));
  return {
    name: mergeSmall ? 'B1 · 按层切 + 碎车合并' : 'B0 · 按层切（不合并）',
    cars, note: mergeSmall
      ? '(层, 颜色) 成车；<10px 的碎组并到同色相邻层（层号取较浅的）'
      : '(层, 颜色) 成车，不做任何合并 —— 用来暴露"碎车"问题'
  };
}

// ---------------------------------------------------------------- 债务节拍：把"还没露脸"的颜色提前
// 生产里的"埋债"（15% / 60% / 80%）：在某个进度位置，挑一辆颜色还没出现过的车，
// 把它挪到这个位置 → 车比货早到 → 全额进暂存 → 这笔债要等该色块的层被打开才还得上。
function applyBeats(plan, positions, per) {
  per = Math.max(1, per || 1);
  const cars = plan.cars.map(c => Object.assign({}, c));
  const total = cars.reduce((a, c) => a + c.cap, 0);
  const moved = [];
  positions.forEach(p => {
    for (let q = 0; q < per; q++) {
      let acc = 0, idx = cars.length - 1;
      for (let i = 0; i < cars.length; i++) { acc += cars[i].cap; if (acc >= p / 100 * total) { idx = i; break; } }
      const seen = {};
      for (let i = 0; i <= idx; i++) seen[cars[i].color] = 1;
      let ci = -1;
      for (let i = idx + 1; i < cars.length; i++) {
        const c = cars[i];
        if (c._moved || seen[c.color]) continue;
        if ((c.level || 0) >= 1) { ci = i; break; }
      }
      if (ci < 0) {                                  // ③ 再退一步：挑最深的车（保证每笔真能挪够）
        let deepest = -1, dl = -1;
        for (let i = idx + 1; i < cars.length; i++) {
          const c = cars[i];
          if (c._moved) continue;
          const L = c.level || 0;
          if (L > dl) { dl = L; deepest = i; }
        }
        ci = deepest;
      }
      if (ci < 0) return;
      const car = cars.splice(ci, 1)[0];
      car._moved = true; car._beatPos = p;
      cars.splice(idx, 0, car);
      moved.push({ color: car.color, cap: car.cap, fromLevel: car.level, pos: p });
    }
  });
  return { name: 'D · 动态排序 + 债务节拍', cars, moved,
    note: '在 C 的干净基线上，15%/60%/80% 各把一辆"颜色还没露脸"的车提前 —— 债是故意做的' };
}

// ---------------------------------------------------------------- 动态排序：每步挑"此刻刚好填得满"的车
// 规则（对应实机的"每层重算"）：每取一辆车之前，重算每种颜色此刻可达多少像素；
//   ① 优先挑"能填满"的车（可达 ≥ 容量）→ 不产生任何债；
//   ② 都能填满时，挑吃到的量最多的；
//   ③ 再按层号浅的优先（浅层先清，深层的门才开）。
// 这一步只改【服务顺序】，不改切法 —— 所以它是"干净基线"：压力最低能到多少。
function buildPlanDynamic(base) {
  const Sim = A.Simulator;
  const eliminated = A.outsideReachSeed(blocks, R, C, false);
  const buffer = [];
  const remaining = base.cars.map(c => Object.assign({}, c));
  const ordered = [];

  function reachOf(color) {
    const scratch = eliminated.map(row => row.slice());
    return Sim.floodFillEliminate(scratch, blocks, R, C, color, Infinity, null, null, false);
  }
  function release(stepNo) {
    for (let i = buffer.length - 1; i >= 0; i--) {
      const b = buffer[i];
      b.need -= Sim.floodFillEliminate(eliminated, blocks, R, C, b.color, b.need, null, null, false);
      if (b.need <= 0) buffer.splice(i, 1);
    }
  }

  let guard = remaining.length * 3 + 10;
  while (remaining.length && guard-- > 0) {
    const cache = {};
    const cols = {};
    remaining.forEach(c => { cols[c.color] = 1; });
    Object.keys(cols).forEach(k => { cache[k] = reachOf(+k); });
    let best = null, bestScore = -Infinity;
    for (const c of remaining) {
      const r = cache[c.color] || 0;
      const fill = Math.min(r, c.cap);
      const full = (r >= c.cap) ? 1 : 0;
      const score = full * 1e9 + fill * 1000 - (c.level || 0) * 10 - c.cap * 0.01;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    const taken = Sim.floodFillEliminate(eliminated, blocks, R, C, best.color, best.cap, null, null, false);
    if (taken < best.cap) buffer.push({ color: best.color, need: best.cap - taken, since: ordered.length });
    release(ordered.length);
    ordered.push(best);
    remaining.splice(remaining.indexOf(best), 1);
  }
  return { name: 'C · 动态排序（干净基线）', cars: ordered,
    note: '切法同 B1；顺序改成"每步重算可达量、优先能填满的车" —— 只改顺序，不改切法' };
}

const planA = buildPlanBySchedule();
const planB0 = buildPlanByLayer(false);
const planB1 = buildPlanByLayer(true);
const planC = buildPlanDynamic(planB1);
const planD = applyBeats(planC, [15, 60, 80], 1);
const planD2 = applyBeats(planC, [15, 60, 80], 2);
const planD3 = applyBeats(planC, [15, 60, 80], 3);
const planD4 = applyBeats(planC, [15, 60, 80], 4);
const planD5 = applyBeats(planC, [15, 60, 80], 5);
const KNOBS = [planD, planD2, planD3, planD4, planD5];
const PLANS = [planA, planB1, planC, planD];

// ---------------------------------------------------------------- 纯切球层干跑
// 用引擎自己的 floodFillEliminate（圈序：动态外圈→由下到上→由左到右），与求解器逐格同口径。
// 不含棋盘、不含障碍：车随时可点，只看"切法本身"会逼出多少债。
function dryRun(plan) {
  const Sim = A.Simulator;
  const eliminated = A.outsideReachSeed(blocks, R, C, false);
  const buffer = [];   // {color, need, since}
  const steps = [];
  let peakCars = 0, over = 0, totalDebtPx = 0, maxSingleDebt = 0, maxCure = 0, curedCount = 0, debtCount = 0;
  const debtByLevel = {};

  function release(stepNo) {
    for (let i = buffer.length - 1; i >= 0; i--) {
      const b = buffer[i];
      const got = Sim.floodFillEliminate(eliminated, blocks, R, C, b.color, b.need, null, null, false);
      b.need -= got;
      if (b.need <= 0) {
        buffer.splice(i, 1); curedCount++;
        const d = stepNo - b.since;
        if (d > maxCure) maxCure = d;
      }
    }
  }

  plan.cars.forEach((car, idx) => {
    const taken = Sim.floodFillEliminate(eliminated, blocks, R, C, car.color, car.cap, null, null, false);
    const debt = car.cap - taken;
    if (taken < car.cap) {
      buffer.push({ color: car.color, need: debt, since: idx }); debtCount++;
      const bl = (car.level != null) ? car.level : -1;
      debtByLevel[bl] = (debtByLevel[bl] || 0) + debt;
      totalDebtPx += debt;
      if (debt > maxSingleDebt) maxSingleDebt = debt;
    }
    release(idx);
    const bufCars = buffer.filter(b => b.need > 0).length;
    const bufPx = buffer.reduce((a, b) => a + b.need, 0);
    if (bufCars > 5) over++;
    if (bufCars > peakCars) peakCars = bufCars;
    steps.push({ i: idx, color: car.color, cap: car.cap, taken, debt, bufCars, bufPx });
  });
  release(plan.cars.length);

  const remain = {}; const reachCnt = {};
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    const v = blocks[r][c];
    if (v <= 0 || eliminated[r][c]) continue;
    remain[v] = (remain[v] || 0) + 1;
  }
  for (const k of Object.keys(remain)) {
    const scratch = eliminated.map(row => row.slice());
    reachCnt[k] = Sim.floodFillEliminate(scratch, blocks, R, C, +k, Infinity, null, null, false);
  }
  const buried = Object.keys(remain).filter(k => remain[k] > 0 && !reachCnt[k]).map(Number);
  const leftPx = Object.values(remain).reduce((a, b) => a + b, 0);
  const uncleared = buffer.filter(b => b.need > 0).map(b => ({ color: b.color, need: b.need }));

  return { steps, peakCars, over, totalDebtPx, maxSingleDebt, maxCure, buried, leftPx, uncleared, curedCount, debtCount, debtByLevel, N: plan.cars.length };
}

PLANS.forEach(p => { p.run = dryRun(p); });
KNOBS.forEach(p => { p.run = dryRun(p); p.stat = planStats(p); });

// ---------------------------------------------------------------- 车单统计
function planStats(plan) {
  const caps = plan.cars.map(c => c.cap);
  const s = { N: caps.length, min: caps.length ? Math.min(...caps) : 0, max: caps.length ? Math.max(...caps) : 0,
    sum: caps.reduce((a, b) => a + b, 0) };
  s.avg = s.sum / Math.max(1, caps.length);
  const perColor = {};
  for (const c of plan.cars) {
    perColor[c.color] = perColor[c.color] || { cars: 0, cap: 0 };
    perColor[c.color].cars++; perColor[c.color].cap += c.cap;
  }
  const bad = [];
  for (const k of Object.keys(colTot)) {
    if (!perColor[k] || perColor[k].cap !== colTot[k]) bad.push({ color: +k, need: colTot[k], got: perColor[k] ? perColor[k].cap : 0 });
  }
  s.perColor = perColor; s.conservationBad = bad;
  s.inRange = caps.filter(x => x >= 14 && x <= 29).length;
  s.tiny = caps.filter(x => x < MIN_CAR).length;
  return s;
}
PLANS.forEach(p => { p.stat = planStats(p); });
planB0.stat = planStats(planB0);
planB0.run = dryRun(planB0);
if (planD.moved) planD.moved = planD.moved;

// ---------------------------------------------------------------- SVG
function gridSVG(getFill) {
  const cell = 11, pad = 2;
  let out = `<svg width="${C * cell + pad * 2}" height="${R * cell + pad * 2}" viewBox="0 0 ${C * cell + pad * 2} ${R * cell + pad * 2}" shape-rendering="crispEdges">`;
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    const v = blocks[r][c];
    const x = pad + c * cell, y = pad + r * cell;
    const fill = v > 0 ? getFill(r, c, v) : '#ffffff';
    out += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="${fill}" stroke="#f0ece4" stroke-width="0.5"/>`;
  }
  return out + '</svg>';
}
const svgColor = gridSVG((r, c, v) => colorHue(v));
const svgLayer = gridSVG((r, c) => layerColor(veinIdOf(r, c) >= 0 ? layers[veinIdOf(r, c)] : 0));
const svgRound = gridSVG((r, c) => {
  const q = roundOf(r, c);
  const t = eo.rounds > 1 ? (q - 1) / (eo.rounds - 1) : 0;
  const l = 92 - 62 * t;
  return `hsl(28,${55 + 25 * t}%,${l}%)`;
});

function curveSVG(run, color, W) {
  W = W || 360;
  const H = 120, padL = 26, padB = 16, maxY = 6;
  const N = run.steps.length;
  const x = i => padL + (W - padL - 8) * (i / Math.max(1, N - 1));
  const y = v => H - padB - (H - padB - 10) * (v / maxY);
  let d = '';
  run.steps.forEach((s, i) => { d += (i ? 'L' : 'M') + fmt(x(i), 1) + ',' + fmt(y(s.bufCars), 1); });
  let g = '';
  for (let v = 0; v <= maxY; v++) {
    g += `<line x1="${padL}" y1="${fmt(y(v), 1)}" x2="${W - 8}" y2="${fmt(y(v), 1)}" stroke="#eee6d8" stroke-width="1"/>`;
    g += `<text x="${padL - 5}" y="${fmt(y(v) + 3, 1)}" font-size="9" fill="#9a8a74" text-anchor="end">${v}</text>`;
  }
  g += `<line x1="${padL}" y1="${fmt(y(5), 1)}" x2="${W - 8}" y2="${fmt(y(5), 1)}" stroke="#d9534f" stroke-width="1" stroke-dasharray="4 3"/>`;
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${g}<path d="${d}" fill="none" stroke="${color}" stroke-width="2"/>${run.steps.map((s, i) => `<circle cx="${fmt(x(i), 1)}" cy="${fmt(y(s.bufCars), 1)}" r="1.6" fill="${color}"/>`).join('')}</svg>`;
}

// ---------------------------------------------------------------- HTML 片段
const colorsList = Object.keys(colTot).map(Number).sort((a, b) => a - b);
const deepColors = colorsList.filter(c => (layerInfo.colorMinLevel[c] || 0) >= 3);
const midColors = colorsList.filter(c => (layerInfo.colorMinLevel[c] || 0) === 2);
const earlyColors = colorsList.filter(c => (layerInfo.colorMinLevel[c] || 0) <= 1);

const layerRows = Object.keys(levelStat).map(Number).sort((a, b) => a - b).map(L => {
  const s = levelStat[L];
  const cols = Object.keys(s.colors).map(Number).sort((a, b) => s.colors[b] - s.colors[a])
    .map(k => `<span class="chip" style="background:${colorHue(k)}" title="${k}号色 ${s.colors[k]}px">${k}</span>`).join('');
  const carsHere = planB1.cars.filter(c => c.level === L).length;
  return `<tr><td class="num">${L}</td><td class="num">${s.veins}</td><td class="num">${s.px}</td>
    <td class="num">${Object.keys(s.colors).length}</td><td class="num">${carsHere}</td><td>${cols}</td></tr>`;
}).join('');

function carTable(plan) {
  return plan.cars.map((c, i) => {
    const lv = (c.level != null) ? c.level : (c.round != null ? '#' + c.round : '-');
    const beat = c._moved ? `<span title="债务节拍：被提前到 ${c._beatPos}% 的位置">⚡</span>` : '';
    return `<tr><td class="num">${i + 1}</td><td><span class="chip" style="background:${colorHue(c.color)}">${c.color}</span></td>
      <td class="num">${c.cap}</td><td class="num">${lv}${beat}</td></tr>`;
  }).join('');
}

function metricRow(label, key, fmtFn) {
  return `<tr><td>${label}</td>${PLANS.map(p => `<td class="num">${fmtFn ? fmtFn(p, key) : p.run[key]}</td>`).join('')}</tr>`;
}

const metricTable = `
<tr><th>指标</th><th>A 按日程切<span class="muted" style="font-weight:400;display:block">生产默认</span></th><th>B1 按层切<span class="muted" style="font-weight:400;display:block">+碎车合并</span></th><th>C 动态排序<span class="muted" style="font-weight:400;display:block">干净基线</span></th><th>D 动态+节拍<span class="muted" style="font-weight:400;display:block">设计压力</span></th></tr>
<tr><td>车辆数</td>${PLANS.map(p => `<td class="num">${p.stat.N}</td>`).join('')}</tr>
<tr><td>容量区间</td>${PLANS.map(p => `<td class="num">${p.stat.min}~${p.stat.max}</td>`).join('')}</tr>
<tr><td>碎车（&lt;${MIN_CAR}px）</td>${PLANS.map(p => `<td class="num">${p.stat.tiny}</td>`).join('')}</tr>
${metricRow('峰值暂存（辆）', 'peakCars')}
${metricRow('超过上限 5 的步数', 'over')}
${metricRow('总债（像素）', 'totalDebtPx')}
${metricRow('单笔最大债（像素）', 'maxSingleDebt')}
${metricRow('最长解锁延迟（步）', 'maxCure')}
<tr><td>结清笔数 / 总笔数</td>${PLANS.map(p => `<td class="num">${p.run.curedCount}/${p.run.debtCount}</td>`).join('')}</tr>
${metricRow('终局剩余像素', 'leftPx')}
${metricRow('被埋颜色数', 'buried', p => p.run.buried.length)}
`;

function checks(plan) {
  const st = plan.stat, run = plan.run;
  return [
    ['守恒：每色车容量和 = 图上像素', st.conservationBad.length === 0 ? ['通过', 'ok'] : ['违反', 'bad'],
      st.conservationBad.length ? st.conservationBad.map(b => `${b.color}号 差${b.need - b.got}`).join('；') : `${COLOR_N} 色全对`],
    ['不超暂存上限', run.over === 0 ? ['通过', 'ok'] : ['违反', 'bad'], `峰值 ${run.peakCars} 辆，超限 ${run.over} 步`],
    ['每笔债有解药', run.uncleared.length === 0 ? ['通过', 'ok'] : ['有未结清', 'warn'],
      run.uncleared.length ? run.uncleared.map(u => `${u.color}号 欠${u.need}`).join('；') : `最长等 ${run.maxCure} 步`],
    ['没有颜色被埋', run.buried.length === 0 ? ['通过', 'ok'] : ['被埋', 'bad'],
      run.buried.length ? run.buried.map(c => c + '号').join('、') : '终局无孤立色'],
    ['容量落在 14~29 的比例', st.inRange === st.N ? ['通过', 'ok'] : ['部分在外', 'warn'], `${st.inRange}/${st.N} 辆`],
  ].map(r => `<tr><td>${r[0]}</td><td><span class="tag ${r[1][1]}">${r[1][0]}</span></td><td class="muted">${r[2]}</td></tr>`).join('');
}

const css = `
*{box-sizing:border-box}body{margin:0;padding:28px 34px 80px;background:#fbf8f1;color:#3d3226;
font:13px/1.6 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:34px 0 12px;padding-bottom:6px;border-bottom:2px solid #e6dcc8}
h3{font-size:13.5px;margin:18px 0 8px}
.meta{color:#8a7a62;font-size:12px}
.card{background:#fff;border:1px solid #e8dfcd;border-radius:8px;padding:14px 16px;box-shadow:0 1px 2px rgba(0,0,0,.03)}
.views{display:flex;gap:18px;flex-wrap:wrap}
.view{background:#fff;border:1px solid #e8dfcd;border-radius:8px;padding:10px}
.view h3{margin:0 0 6px;font-size:12.5px}.view .sub{font-size:11px;color:#8a7a62;margin-top:6px;max-width:450px}
table{border-collapse:collapse;width:100%;font-size:12px}
th,td{padding:5px 8px;border-bottom:1px solid #efe8da;text-align:left}
th{background:#f6f1e6;font-weight:600;color:#6b5a44;position:sticky;top:0}
td.num{text-align:right;font-variant-numeric:tabular-nums}
.chip{display:inline-block;min-width:18px;padding:0 4px;border-radius:4px;color:#fff;font-size:10.5px;text-align:center;text-shadow:0 1px 1px rgba(0,0,0,.25)}
.tag{display:inline-block;padding:1px 7px;border-radius:9px;font-size:11px}
.tag.ok{background:#e4f2e4;color:#2f6b34}.tag.warn{background:#fdf1d8;color:#8a6100}.tag.bad{background:#fbe3e1;color:#a02a22}
.muted{color:#8a7a62}
.legend{display:flex;gap:10px;flex-wrap:wrap;margin-top:6px;font-size:11px;color:#6b5a44}
.legend i{display:inline-block;width:11px;height:11px;border-radius:2px;margin-right:4px;vertical-align:-1px}
.three{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.four{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
.four .cars{max-height:300px}
.two{display:grid;grid-template-columns:1fr 1fr;gap:20px}
.cars{max-height:320px;overflow:auto;border:1px solid #f0e8d8;border-radius:6px}
.note{background:#fff8e8;border-left:3px solid #e0b25c;padding:10px 14px;border-radius:0 6px 6px 0;font-size:12px;color:#6b5a44;margin-top:12px}
.kpi{display:flex;gap:18px;flex-wrap:wrap;margin:8px 0 6px}
.kpi div{min-width:84px}.kpi .label{font-size:11px;color:#8a7a62}.kpi .v{font-size:20px;font-weight:700}
code{background:#f3ecdd;padding:1px 5px;border-radius:4px;font-size:11.5px}
`;

const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<title>拆图报告 · ${esc(path.basename(SRC))}</title><style>${css}</style></head><body>

<h1>拆图报告 · ${esc(path.basename(SRC))}</h1>
<div class="meta">${R} × ${C} · ${P} 像素 · ${COLOR_N} 色 · ${layerInfo.count} 个同色连通块 · 最深 ${maxLevel} 层 · 贪心日程 ${eo.rounds} 轮
　|　只读报告，不改任何生成逻辑</div>

<div class="card" style="margin-top:14px"><h3 style="margin-top:0">一句话结论</h3>
<ul style="margin:4px 0 0 18px;padding:0;line-height:1.95">
<li><b>A · 按日程切（生产默认）：</b>总债 <b>${planA.run.totalDebtPx}px</b>、峰值 <b>${planA.run.peakCars} 辆</b>。
  ${planA.run.totalDebtPx === 0 ? '盒子大小永远等于它能吃到的量——<b>切球本身一点压力都不产生，紧张感全部来自后面的摆位和障碍</b>。' : ''}</li>
<li><b>B1 · 按层切 + 碎车合并：</b>总债 <b>${planB1.run.totalDebtPx}px</b>、峰值 <b>${planB1.run.peakCars} 辆</b>、最长解锁延迟 <b>${planB1.run.maxCure} 步</b>、
  碎车 <b>${planB1.stat.tiny}</b> 辆（合并前 ${planB0.stat.tiny} 辆）。<b>这些债是"排坏了"排出来的</b>，不是设计出来的。</li>
<li><b>C · 动态排序（干净基线）：</b>切法与 B1 完全相同，<b>只改服务顺序</b>——总债 <b>${planC.run.totalDebtPx}px</b>、峰值 <b>${planC.run.peakCars} 辆</b>、最长解锁延迟 <b>${planC.run.maxCure} 步</b>。
  ${planC.run.totalDebtPx === 0 ? '债被清成 <b>0</b>：说明 B1 那 ' + planB1.run.totalDebtPx + 'px 全是排序造成的，跟切法无关。' : '债从 ' + planB1.run.totalDebtPx + 'px 降到 ' + planC.run.totalDebtPx + 'px。'}</li>
<li><b>D · 动态排序 + 债务节拍：</b>在 C 的干净基线上，15%/60%/80% 各把一辆"颜色还没露脸"的车提前（${planD.moved.length} 笔）——
  总债 <b>${planD.run.totalDebtPx}px</b>、峰值 <b>${planD.run.peakCars} 辆</b>、最长解锁延迟 <b>${planD.run.maxCure} 步</b>。
  ${planD.run.over ? '<b style="color:#a02a22">有 ' + planD.run.over + ' 步超过上限 5</b>。' : '没有超上限。'}</li>
<li><b>这条链怎么读：</b>A 是"顺其自然"（零债，压力全在后端）；B1 是"按结构切但排得糙"（债是事故）；
  C 是"切法不变、把顺序理顺"（债归零，<b>这是设计压力的必要前提</b>）；D 才是"把债故意做进去"。
  <b>没有 C，就分不清哪些债是该有的、哪些是排错的。</b></li>
</ul></div>

<div class="note"><b>先看这一句。</b>下面三张图是同一张图：左=颜色，中=<b>依赖层</b>（谁包着谁，只由几何决定），
右=<b>贪心日程</b>（求解器里那个 🔢）。<b>层是唯一的，日程不是</b>——换一种吃法，序号就会变。
你说的"每个颜色选择不同、暴露顺序不同"正是这个意思；而层表不会因为你怎么选而变。</div>

<h2>一、三张图</h2>
<div class="views">
  <div class="view"><h3>① 原图色</h3>${svgColor}
    <div class="legend">${colorsList.map(c => `<span><i style="background:${colorHue(c)}"></i>${c}号 ${colTot[c]}px</span>`).join('')}</div></div>
  <div class="view"><h3>② 依赖层（静态，换切法不变）</h3>${svgLayer}
    <div class="legend">${Array.from({ length: maxLevel + 1 }, (_, i) => `<span><i style="background:${layerColor(i)}"></i>第 ${i} 层</span>`).join('')}
    ${layerInfo.unreached ? `<span><i style="background:#ff00ff"></i>不可达 ${layerInfo.unreached} 块</span>` : ''}</div>
    <div class="sub">第 0 层 = 现在就够得着；第 k 层 = 必须先啃掉 ≤k−1 层。这就是"洋葱剖面"。</div></div>
  <div class="view"><h3>③ 贪心日程（会变）</h3>${svgRound}
    <div class="legend"><span><i style="background:hsl(28,55%,92%)"></i>第 1 轮</span><span><i style="background:hsl(28,80%,30%)"></i>第 ${eo.rounds} 轮</span></div>
    <div class="sub">求解器「🔢序号」标的就是这个：每轮选"当前可达像素最多"的颜色整片吃掉。它只是一种走法。</div></div>
</div>

<h2>二、层表（这张图由什么组成）</h2>
<div class="card"><table>
<tr><th>层</th><th>同色块数</th><th>像素</th><th>颜色数</th><th>B1 分到几辆车</th><th>颜色（按像素降序）</th></tr>
${layerRows}
</table>
<div class="note">"颜色数"这一列就是<b>静态的菜单宽度</b>：某层只有 1 个颜色 = 那一段只能按唯一路线走；≥3 色 = 那一段天然有得选。</div></div>

<h3>每个颜色的最浅层 —— 这是"能不能做出长期债"的天花板</h3>
<div class="card"><table>
<tr><th>色号</th>${colorsList.map(c => `<th><span class="chip" style="background:${colorHue(c)}">${c}</span></th>`).join('')}</tr>
<tr><td>最浅层</td>${colorsList.map(c => `<td class="num">${layerInfo.colorMinLevel[c]}</td>`).join('')}</tr>
<tr><td>像素</td>${colorsList.map(c => `<td class="num">${colTot[c]}</td>`).join('')}</tr>
</table>
<div class="note"><b>第 0~1 层就露脸的颜色：${earlyColors.length} 个</b>（${earlyColors.join('、')}）——
它们<b>永远做不出"长期债"</b>，因为随便什么时候取，都有一批像素够得着，债最多是"差几个"的短债。<br>
<b>第 2 层才露脸：${midColors.length} 个</b>；<b>第 3 层以后才露脸：${deepColors.length} 个</b>（${deepColors.length ? deepColors.join('、') : '没有'}）——
只有这样"藏得深"的颜色，才能承载"车比货早到很久"的长债。<br>
<b>所以：压力旋钮能拧到多大，先由图决定，而不是由切法决定。</b>这张图几乎所有颜色在第 2 层就全露脸了，长期债素材很少 ——
这也解释了为什么之前想把峰窗顶到 3~4 只能靠"墙"：墙是唯一能随时拖住任何颜色的东西。</div></div>

<h2>三、四种切法的车单</h2>
<div class="four">
${PLANS.map((p, i) => `<div class="card"><h3 style="margin-top:0">${p.name}</h3>
  <div class="muted" style="min-height:34px">${p.note}</div>
  <div class="kpi">
    <div><div class="label">车辆数</div><div class="v">${p.stat.N}</div></div>
    <div><div class="label">容量</div><div class="v">${p.stat.min}~${p.stat.max}</div></div>
    <div><div class="label">碎车</div><div class="v">${p.stat.tiny}</div></div>
  </div>
  <div class="cars"><table><tr><th>#</th><th>色</th><th>容量</th><th>层</th></tr>${carTable(p)}</table></div>
</div>`).join('')}
</div>
<div class="note">⚡ = 被债务节拍提前的车。它出现在"自己的颜色还没露脸"的位置上 → 全额进暂存 → 这笔债要等它那一层被打开才还得上。</div>

<h2>四、纯切球层干跑（不进棋盘、不含障碍）</h2>
<div class="four">
${PLANS.map((p, i) => `<div class="card"><h3 style="margin-top:0">${p.name}</h3>${curveSVG(p.run, ['#1f6fb2', '#c8553d', '#6a4c93', '#b5651d'][i], 300)}
  <div class="muted" style="font-size:11px">曲线 = 每取一辆车后，暂存里还欠着的车数（红线 = 上限 5）。</div></div>`).join('')}
</div>
<div class="card" style="margin-top:16px"><table>${metricTable}</table>
<h3 style="margin-top:18px">压力旋钮：每笔节拍挪几辆车</h3>
<table>
<tr><th>每笔挪几辆</th><th>挪动车数</th><th>峰值暂存（辆）</th><th>总债（像素）</th><th>最长解锁延迟（步）</th></tr>
${KNOBS.map((p, i) => `<tr><td>${i + 1} 辆 / 笔</td><td class="num">${p.moved.length}</td><td class="num">${p.run.peakCars}</td>
  <td class="num">${p.run.totalDebtPx}</td><td class="num">${p.run.maxCure}</td></tr>`).join('')}
</table>
<div class="note">切法与顺序都不变，<b>只改"每笔提前几辆车"</b>：这就是"压力旋钮"。
1 辆/笔 → 峰值 1；2 辆/笔 → 峰值 2；<b>3 辆/笔反而掉回 1</b>——不是旋钮失灵，是<b>"没露脸的颜色"用完了</b>：这张图 13 个颜色在第 2 层就全露过脸，挪得再多也只是短债。</div>
<div class="note"><b>债是从哪一层来的：</b>${PLANS.map(p => {
  const ks = Object.keys(p.run.debtByLevel).sort((a, b) => (+a) - (+b));
  return `<b>${p.name}</b> → ` + (ks.length ? ks.map(k => (+k < 0 ? '无层号' : '第' + k + '层') + ' ' + p.run.debtByLevel[k] + 'px').join('，') : '零债');
}).join('<br>')}
<br><b>碎车 vs 债：</b>不合并（B0）只有 <b>${planB0.run.totalDebtPx}px</b> 债，但带 <b>${planB0.stat.tiny} 辆</b>碎车；
一合并（B1）碎车归 <b>0</b>，债升到 <b>${planB1.run.totalDebtPx}px</b>。
但 C 证明这<b>不是合并的必然代价，是排序没跟上</b>——切法一字不改，只把顺序换成"每步挑能填满的车"，债归 <b>${planC.run.totalDebtPx}px</b>。
所以正确的顺序是：<b>先做切法（B1），再做排序（C），最后才叠压力（D）</b>。</div></div>

<h2>五、判据</h2>
<div class="four">
${PLANS.map(p => `<div class="card"><h3 style="margin-top:0">${p.name}</h3><table><tr><th>判据</th><th>结果</th><th>说明</th></tr>${checks(p)}</table></div>`).join('')}
</div>

<h2>六、术语对照（"矿脉"到底叫什么）</h2>
<div class="card"><table>
<tr><th>我们口语里的</th><th>更专业的说法</th><th>定义</th></tr>
<tr><td>矿脉</td><td><b>同色连通域 / 色块</b>（same-color connected component）</td><td>4-连通、颜色相同的最大像素集合；<b>与怎么走、怎么切无关</b></td></tr>
<tr><td>层</td><td><b>依赖深度 / 剥离层</b>（peeling depth）</td><td>色块邻接图上，从"外部可达"出发的 BFS 层号</td></tr>
<tr><td>包壳关系</td><td><b>区域邻接图</b>（region adjacency graph）</td><td>两个色块 4-邻接，就连一条边</td></tr>
<tr><td>序号</td><td><b>贪心消除日程</b>（greedy elimination schedule）</td><td>某一条走法下的像素次序，换走法就变</td></tr>
<tr><td>债务 Δ</td><td><b>解锁延迟</b>（unlock latency）</td><td>实际轮到它的位置 − 理论最短位置</td></tr>
<tr><td>车 / 盒</td><td><b>请求</b>（demand：颜色 + 容量）</td><td>一辆车 = "我要 N 个 c 色像素"</td></tr>
<tr><td>取盒序</td><td><b>服务顺序</b>（service sequence）</td><td>这些请求被满足的先后</td></tr>
</table>
<div class="note">"矿脉"是我起的比喻，容易让人以为图里真有"脉"。它的实体就是<b>同色连通块</b>——以后报告里我用"色块 / 依赖层 / 解锁延迟"。</div></div>

<h2>七、这份报告不能告诉你什么</h2>
<div class="card"><ul style="margin:6px 0 0 18px;padding:0">
<li><b>看不到棋盘</b>：车摆在哪个格子、哪一格先解锁，会决定"这辆车此刻能不能点"。61 那种死法（暂存里 4 个颜色全被埋）是<b>切法 + 摆位</b>一起造成的。</li>
<li><b>看不到障碍</b>：冰/链/管道/墙都会改"菜单什么时候出现哪辆车"，这里一概没有。</li>
<li><b>看不到真人</b>：干跑用"圈序"（动态外圈→由下到上→由左到右）这一条固定规则；真人会挑。</li>
<li>所以它只回答一个问题：<b>这个切法本身，会把债务做成什么样</b>。棋盘与障碍是下一层的事。</li>
</ul></div>

<div class="meta" style="margin-top:26px">生成时间 ${new Date().toLocaleString('zh-CN', { hour12: false })} · 脚本 <code>03_工具/拆图报告/拆图报告.js</code></div>
</body></html>`;

fs.writeFileSync(OUT, html, 'utf8');

// ---------------------------------------------------------------- 控制台摘要
console.log('=== 拆图报告 ===');
console.log(`图: ${path.basename(SRC)}  ${R}x${C}  ${P}px  ${COLOR_N}色  色块${layerInfo.count}个  最深${maxLevel}层  日程${eo.rounds}轮`);
Object.keys(levelStat).map(Number).sort((a, b) => a - b).forEach(L => {
  const s = levelStat[L];
  console.log(`  第${L}层: ${s.veins}块 / ${s.px}px / ${Object.keys(s.colors).length}色`);
});
for (const p of PLANS) {
  const r = p.run;
  console.log(`\n${p.name}: ${p.stat.N}辆 容量${p.stat.min}~${p.stat.max} 碎车${p.stat.tiny} 峰值${r.peakCars}辆 超限${r.over}步 总债${r.totalDebtPx}px 单笔${r.maxSingleDebt}px 解锁延迟${r.maxCure}步 埋${r.buried.length}色`);
}
console.log('\nD 债务节拍: ' + planD.moved.map(m => `${m.color}号/${m.cap}px L${m.fromLevel}→${m.pos}%`).join('  '));
console.log('旋钮: ' + KNOBS.map((p, i) => `${i + 1}辆/笔 → 峰值${p.run.peakCars} 总债${p.run.totalDebtPx}px 延迟${p.run.maxCure}步`).join(' | '));
console.log('\n报告: ' + OUT);
