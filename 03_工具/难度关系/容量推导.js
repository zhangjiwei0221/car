#!/usr/bin/env node
/**
 * 容量推导：从一张目标图反推「每辆车该多大」。
 *
 * 用户问题（2026-10-22）：「容量上下限我也不确定该怎么定」。
 * 本工具把这件事算出来，不靠猜：
 *   m   = 需求块中位数（每解锁一次，新露出多少像素）
 *   下界 = 1.5m  —— 低于它，一辆车一步就装满 = 白给
 *   上界 = 4.5m  —— 高于它，一辆车要等 4 次以上解锁 = 容易死锁
 *   白给车 = Σ floor(开局该色暴露量 / 容量)；目标 ≤ 2 辆
 *
 * 若 [1.5m, 4.5m] 里找不到「白给车≤2」的容量，说明这张图开局太开，
 * 容量救不了：要么加冰冻住白给车，要么改图让开局只露 2~3 色。
 *
 * 用法：
 *   node 容量推导.js <目标图.txt | 关卡.json> [--capmin 20] [--capmax 100]
 *
 * 只读：不写 输出文件/，不改生成器。
 */
'use strict';
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const BASE = path.join(__dirname, '..', '..', '02_工程', '完整主bin快照_20261012');
const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js', 'playersim.js', 'analysis.js', 'generator.js'];
const sandbox = { console: { log() {}, warn() {}, error() {} }, module: { exports: {} }, WeakMap, Map, Set, setTimeout, clearTimeout, Infinity, Math, JSON };
vm.createContext(sandbox);
for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BASE, 'bin/js', f), 'utf8'), sandbox, { filename: f });
const G = sandbox.AntSolver.Generator;

function loadBlocks(p) {
  const raw = fs.readFileSync(p, 'utf8');
  if (/\.json$/i.test(p)) {
    const d = JSON.parse(raw);
    const b = d.blocks || (d.gameLevel && d.gameLevel.blocks) || (d.level && d.level.blocks);
    if (!b) throw new Error('JSON 里没找到 blocks');
    return b;
  }
  return G.blocksFromTXT(raw);
}

const argv = process.argv.slice(2);
const file = argv.find(a => !a.startsWith('--'));
if (!file || !fs.existsSync(file)) {
  console.error('用法：node 容量推导.js <目标图.txt|关卡.json> [--capmin 20] [--capmax 100]');
  process.exit(1);
}
const numArg = (name, def) => {
  const i = argv.indexOf('--' + name);
  if (i < 0 || !argv[i + 1]) return def;
  const v = parseFloat(argv[i + 1]);
  return isFinite(v) ? v : def;
};
const capMin = numArg('capmin', 20), capMax = numArg('capmax', 100);

const blocks = loadBlocks(file);
const R = blocks.length, C = blocks[0].length;
let total = 0;
const byColor = {};
for (const row of blocks) for (const v of row) if (v > 0) { total++; byColor[v] = (byColor[v] || 0) + 1; }

const exp = G.openingExposure(blocks, R, C, false);
const E = {};
for (const d of (exp && exp.detail) || []) E[d.color] = d.px;

const dc = G.demandCurveOf(blocks);
const incs = [];
if (dc && dc.curve) {
  for (const col of Object.keys(dc.curve)) {
    let prev = 0;
    for (const pt of dc.curve[col]) {
      const cum = pt[0];
      if (cum > prev) { incs.push(cum - prev); prev = cum; }
    }
  }
}
incs.sort((a, b) => a - b);
const med = incs.length ? incs[Math.floor(incs.length / 2)] : 0;
const q = p => incs.length ? incs[Math.min(incs.length - 1, Math.floor(p * (incs.length - 1)))] : 0;

function freeCars(cap) {
  let n = 0;
  for (const c of Object.keys(E)) n += Math.floor(E[c] / cap);
  return n;
}
function carsAt(cap) {
  let n = 0;
  for (const c of Object.keys(byColor)) n += Math.max(1, Math.round(byColor[c] / cap));
  return n;
}

const lo = Math.max(1, Math.ceil(med * 1.5));
const hi = Math.max(lo, Math.floor(med * 4.5));

console.log('=== 容量推导 ===');
console.log('文件      ' + path.basename(file));
console.log('目标图    ' + R + '×' + C + ' · 彩色像素 ' + total + ' · 颜色 ' + Object.keys(byColor).length);
console.log('开局暴露  ' + (exp ? exp.exposedColors : '?') + ' 色 / ' + (exp ? exp.exposedPixels : '?') + ' px' +
  (exp && exp.top ? '（最多一色 ' + exp.top.color + ':' + exp.top.px + 'px）' : ''));
console.log('需求块    m(中位) ' + med + ' px · 25/75/90 分位 ' + q(0.25) + '/' + q(0.75) + '/' + q(0.9));
console.log('理论带    [1.5m, 4.5m] = [' + lo + ', ' + hi + ']');
console.log('');

console.log('容量 → 白给车 → 车数（' + capMin + '~' + capMax + '）');
const rows = [];
for (let cap = capMin; cap <= capMax; cap += 2) rows.push({ cap, free: freeCars(cap), cars: carsAt(cap) });
for (const r of rows) {
  const mark = (r.cap >= lo && r.cap <= hi) ? '  ← 理论带' : '';
  console.log('  cap ' + String(r.cap).padStart(3) + ' → 白给 ' + String(r.free).padStart(2) + ' 辆 · 车 ' + String(r.cars).padStart(3) + mark);
}
console.log('');

const feasible = rows.filter(r => r.cap >= lo && r.cap <= hi && r.free <= 2);
let chosen = null, verdict = '';
if (feasible.length) {
  chosen = feasible[Math.floor(feasible.length / 2)].cap;
  verdict = '✅ 容量能控住';
} else {
  chosen = hi;
  verdict = '❌ 容量救不了：开局太开';
}

const freeAtChosen = freeCars(chosen);
const iceNeed = Math.max(0, freeAtChosen - 2);

console.log('=== 结论 ===');
console.log(verdict);
console.log('建议容量带  ' + (feasible.length ? (feasible[0].cap + '~' + feasible[feasible.length - 1].cap) : (lo + '~' + hi + '（仅理论带，白给车压不下来）')));
console.log('建议取值    ' + chosen + ' px/辆 → 白给车 ' + freeAtChosen + ' 辆 · 车数约 ' + carsAt(chosen));
if (iceNeed > 0) console.log('需要冰      至少 ' + iceNeed + ' 块（冻住多余的"白给车"），否则开局无压力');
else console.log('需要冰      0~1 块（开局已有 1~2 辆白给车，正好够引子）');
if (!feasible.length) {
  console.log('改图方向    让开局只露 2~3 色，且每色开局暴露 ≤ ' + Math.round(chosen * 1.5) + ' px');
}
console.log('');

console.log('=== 每色切法（按建议容量 ' + chosen + '）===');
const colors = Object.keys(byColor).map(Number).sort((a, b) => byColor[a] - byColor[b]);
let sumN = 0, sumPx = 0;
for (const c of colors) {
  const T = byColor[c], e = E[c] || 0;
  const n = Math.max(1, Math.round(T / chosen));
  const cap = Math.round(T / n);
  const freeN = cap > 0 ? Math.floor(e / cap) : 0;
  sumN += n;
  sumPx += T;
  console.log('  色 ' + String(c).padStart(2) + ' 总量 ' + String(T).padStart(4) +
    ' · 开局 ' + String(e).padStart(4) + ' · ' + n + ' 辆 × 约 ' + cap +
    (freeN > 0 ? '   ← 开局可一口吃满 ×' + freeN : ''));
}
console.log('  合计 ' + sumN + ' 辆 · ' + sumPx + ' px（应等于彩色像素 ' + total + '）');
