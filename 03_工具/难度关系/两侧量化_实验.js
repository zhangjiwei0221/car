#!/usr/bin/env node
/**
 * 两侧量化实验 v2：目标区需求 D(c,t) × 棋盘区"选择余地"→ 预测暂存压力
 *
 *   node 两侧量化_实验.js <关卡json> [--strategies 5]
 *
 * 只读：不改生产代码、不写 输出文件/。
 *
 * v2 修正（v1 的 P=Σmax(0,S_c−D_c) 与真实 buffer 负相关，已弃用）：
 *   · 代理指标改为 full(t) = 可点车里"该色可消量 ≥ 车容量"的辆数
 *     —— 这是"能不能舒服推进"，与 buffer 同量纲（辆数），工程里 choiceCurve 的 full 同源。
 *   · 同时记录 spill(t) = 实际点的车"吃不下多少"（= 这一笔攒票）。
 *   · 记录停止原因，区分"真通关 / 卡死 / 无可点"。
 */
'use strict';
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const BASE = path.join(__dirname, '..', '..', '02_工程', '完整主bin快照_20261012');
const FILES = ['utils.js', 'color-libs.js', 'simulator.js'];
const sandbox = { console: { log() {}, warn() {}, error() {} }, module: { exports: {} }, WeakMap, Map, Set, setTimeout, clearTimeout, Infinity, Math, JSON, Date };
vm.createContext(sandbox);
for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BASE, 'bin/js', f), 'utf8'), sandbox, { filename: f });
const A = sandbox.AntSolver;
const Sim = A.Simulator;

const file = process.argv[2];
if (!file) { console.error('用法：node 两侧量化_实验.js <关卡json> [--strategies 5]'); process.exit(1); }
const si = process.argv.indexOf('--strategies');
const K = si > 0 ? (parseInt(process.argv[si + 1], 10) || 5) : 5;

const j = JSON.parse(fs.readFileSync(file, 'utf8'));
const parsed = A.parseLevel({ blocks: j.blocks, bufferLimit: j.bufferLimit || 5, board: j.board });
const real = (j.solve && j.solve.stepBufferHistory) || [];

function lcg(seed) { let s = (seed >>> 0) || 1; return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

function pickGreedy(st, moves, D) {
  let best = null, bs = -1e9;
  for (const m of moves) {
    const b = st.cells[m.r][m.c], d = D[b.color] || 0;
    const score = (d >= b.count ? 1e6 : 0) + d * 10 - b.count;
    if (score > bs) { bs = score; best = m; }
  }
  return best;
}
function pickShallow(st, moves) {
  let best = moves[0];
  for (const m of moves) if (m.r < best.r || (m.r === best.r && m.c < best.c)) best = m;
  return best;
}
function pickDeep(st, moves) {
  let best = moves[0];
  for (const m of moves) if (m.r > best.r || (m.r === best.r && m.c > best.c)) best = m;
  return best;
}
function pickRandomFactory(seed) { const r = lcg(seed); return function (st, moves) { return moves[Math.floor(r() * moves.length)]; }; }

function runOne(name, choose) {
  const st = Sim.createState(parsed, { useSlotStart: true });
  const release = {}, hist = [];
  let guard = 0, stop = '结束';
  while (guard++ < 300) {
    if (st.gameOver) { stop = '死亡'; break; }
    const moves = Sim.listMoves(st).filter(function (m) { return !m.blocked; });
    if (!moves.length) { stop = '无可点'; break; }
    const pv = Sim.previewNextEliminationOrder(st);
    const D = {};
    for (const k in pv.byColor) D[+k] = pv.byColor[k].reachable;
    let full = 0;
    for (const m of moves) {
      const b = st.cells[m.r][m.c];
      if ((D[b.color] || 0) >= b.count) full++;
      const key = m.r + ',' + m.c;
      if (release[key] == null) release[key] = guard - 1;
    }
    const m = choose(st, moves, D);
    const picked = m ? st.cells[m.r][m.c] : null;
    const spill = picked ? Math.max(0, picked.count - (D[picked.color] || 0)) : 0;
    const rec = {
      step: guard, prog: (st.totalBoxes ? st.completedBoxes / st.totalBoxes : 0),
      bufBefore: st.buffer.length, full: full, avail: moves.length, spend: picked ? picked.count : 0,
      spill: spill, pick: m ? (m.r + ',' + m.c) : null, color: picked ? picked.color : null,
      bufAfter: null, done: null
    };
    const ok = m ? Sim.applyPick(st, m.r, m.c) : false;
    rec.bufAfter = st.buffer.length;
    rec.done = st.completedBoxes;
    hist.push(rec);
    if (!ok) { stop = '点击失败'; break; }
  }
  if (st.overflow) stop = '溢出';
  const leftBuf = (st.buffer || []).map(function (b) { return b.color + ':' + (b.need - b.progress); }).join(' ');
  return { name, hist, release, completed: st.completedBoxes, total: st.totalBoxes, stop, leftBuf };
}

const runs = [runOne('贪心吃满', pickGreedy), runOne('浅层优先', pickShallow), runOne('深层优先', pickDeep)];
for (let i = 0; i < Math.max(0, K - 3); i++) runs.push(runOne('随机#' + (i + 1), pickRandomFactory(7 + i * 13)));

function mean(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : 0; }
function pearson(a, b) {
  const n = Math.min(a.length, b.length); if (n < 3) return null;
  const ma = mean(a.slice(0, n)), mb = mean(b.slice(0, n));
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
  return (da && db) ? num / Math.sqrt(da * db) : null;
}
function f(x, d) { return x == null ? '-' : x.toFixed(d == null ? 2 : d); }

const st0 = j.boardStat || {}, gv = (j.generationEval && j.generationEval.goodV3) || {};
console.log('关卡：' + path.basename(file) + '　盘 ' + j.board.rows + '×' + j.board.cols + '　车 ' + (st0.boardBoxes || '?') + '+管' + (st0.hiddenBoxes || 0) + '　暂存上限 ' + (j.bufferLimit || 5));
console.log('真实：' + real.length + ' 步，buffer 峰值 ' + (real.length ? Math.max.apply(null, real) : '-') + '，band3=' + ((gv.persist || {}).band3Pct) + '%');
console.log('');
console.log('策略       步数 完成/总 停止      通关  full均值 full=0占比  buf峰值  r(full,buf)');
for (const r of runs) {
  const fulls = r.hist.map(function (h) { return h.full; });
  const bufs = r.hist.map(function (h) { return h.bufAfter; });
  const won = r.completed === r.total;
  console.log('  ' + r.name.padEnd(9) + String(r.hist.length).padStart(4) + ' ' +
    String(r.completed + '/' + r.total).padStart(7) + ' ' + r.stop.padEnd(9) + ' ' + (won ? '✓' : '✗') + '  ' +
    mean(fulls).toFixed(2).padStart(6) + '%' + String(Math.round(fulls.filter(function (x) { return x === 0; }).length / Math.max(1, fulls.length) * 100)).padStart(9) + '%  ' +
    String(Math.max.apply(null, bufs.concat([0]))).padStart(6) + '  ' + f(pearson(fulls, real), 2).padStart(11));
}

console.log('');
console.log('步 真实buf | ' + runs.map(function (r) { return r.name.slice(0, 4) + '.buf/full'; }).join(' | '));
const maxLen = Math.max.apply(null, runs.map(function (r) { return r.hist.length; }).concat([real.length]));
for (let i = 0; i < maxLen; i++) {
  let line = String(i + 1).padStart(2) + ' ' + String(real[i] != null ? real[i] : '-').padStart(6) + ' | ';
  line += runs.map(function (r) {
    const h = r.hist[i];
    return h ? String(h.bufAfter).padStart(2) + '/' + String(h.full).padStart(2) + '  ' : '-      ';
  }).join('| ');
  console.log(line);
}

const keys = Object.keys(runs[0].release);
const diffs = [];
for (const k of keys) {
  const vals = runs.map(function (r) { return r.release[k]; }).filter(function (x) { return x != null; });
  if (vals.length >= 2) diffs.push({ k: k, v: vals, range: Math.max.apply(null, vals) - Math.min.apply(null, vals) });
}
diffs.sort(function (a, b) { return b.range - a.range; });
console.log('');
console.log('release 三策略差异：共同车 ' + diffs.length + ' 辆　极差中位 ' + (diffs.length ? diffs[Math.floor(diffs.length / 2)].range : '-') + '　最大 ' + (diffs.length ? diffs[0].range : '-'));
for (const d of diffs.slice(0, 5)) console.log('    (' + d.k + ')  ' + d.v.join(' / ') + '  极差 ' + d.range);

// 滞后相关：本步 full 低 → 下一步 buffer 高
const lagG = runs[0].hist.slice(0, -1).map(function (h) { return h.full; });
const lagB = runs[0].hist.slice(1).map(function (h) { return h.bufAfter; });
console.log('');
console.log('贪心：full(t) vs buffer(t) r=' + f(pearson(runs[0].hist.map(function (h) { return h.full; }), real)) +
  '　full(t) vs buffer(t+1) r=' + f(pearson(lagG, lagB)) + '　累计spill vs buffer r=' +
  f(pearson((function () { let s = 0; return runs[0].hist.map(function (h) { s += h.spill; return s; }); })(), real)));
for (const r of runs) if (r.stop !== '结束') console.log('  ' + r.name + ' 停在：' + r.stop + '　手里[' + r.leftBuf + ']　完成 ' + r.completed + '/' + r.total);
