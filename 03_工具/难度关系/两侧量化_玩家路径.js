#!/usr/bin/env node
/**
 * 两侧量化 v3：在【玩家真实路径】上验证"错配累积 = 暂存压力"
 *
 *   node 两侧量化_玩家路径.js <关卡json> [--runs 10]
 *
 * 只读：不改生产代码、不写 输出文件/。
 *
 * 做法：
 *   1. 跑 N 局 PlayerSim（不同 seed）→ 每局 pickOrder + pressureSamples(done→buf)
 *   2. 按 pickOrder 回放，每步算：
 *        full  = 可点车里"该色可消量 ≥ 车容量"的辆数（选择余地）
 *        spill = 实际点的车"吃不下多少"（这笔攒票）
 *   3. 与真实 buf 对比：spill 累积能否预测 buffer
 *   4. 跨局记录每辆车的 release 分布（回答"释放步到底有多不稳"）
 */
'use strict';
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const BASE = path.join(__dirname, '..', '..', '02_工程', '完整主bin快照_20261012');
const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js', 'playersim.js', 'analysis.js', 'generator.js'];
const sandbox = { console: { log() {}, warn() {}, error() {} }, module: { exports: {} }, WeakMap, Map, Set, setTimeout, clearTimeout, Infinity, Math, JSON, Date };
vm.createContext(sandbox);
for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BASE, 'bin/js', f), 'utf8'), sandbox, { filename: f });
const A = sandbox.AntSolver;
const Sim = A.Simulator;

const file = process.argv[2];
if (!file) { console.error('用法：node 两侧量化_玩家路径.js <关卡json> [--runs 10]'); process.exit(1); }
const ri = process.argv.indexOf('--runs');
const N = ri > 0 ? (parseInt(process.argv[ri + 1], 10) || 10) : 10;

const j = JSON.parse(fs.readFileSync(file, 'utf8'));
const parsed = A.parseLevel({ blocks: j.blocks, bufferLimit: j.bufferLimit || 5, board: j.board });
const realHist = (j.solve && j.solve.stepBufferHistory) || [];
const gv = (j.generationEval && j.generationEval.goodV3) || {};

function mean(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : 0; }
function median(a) { if (!a.length) return null; const b = a.slice().sort(function (x, y) { return x - y; }); return b[Math.floor(b.length / 2)]; }
function pearson(a, b) {
  const n = Math.min(a.length, b.length); if (n < 3) return null;
  const ma = mean(a.slice(0, n)), mb = mean(b.slice(0, n));
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
  return (da && db) ? num / Math.sqrt(da * db) : null;
}
function f(x, d) { return x == null ? '-' : x.toFixed(d == null ? 2 : d); }

const runs = [];
const releaseByCar = {};
for (let i = 0; i < N; i++) {
  const seed = 7 + i * 13;
  let r;
  try { r = A.PlayerSim.run(parsed, { seed: seed, useItems: false, capturePreviewStats: true, reviveCap: 2 }); }
  catch (e) { console.log('  第 ' + i + ' 局 PlayerSim 失败：' + (e && e.message)); continue; }
  const ps = (r.pressureSamples || []).map(function (s) { return { done: s.done, buf: s.buf }; });
  const order = (r.pickOrder || []).slice().sort(function (a, b) { return (a.step || 0) - (b.step || 0); });
  const st = Sim.createState(parsed, { useSlotStart: true });
  const hist = [];
  let okAll = true;
  for (const p of order) {
    if (p.chainIndex > 0) continue;
    let pv;
    try { pv = Sim.previewNextEliminationOrder(st); } catch (e) { okAll = false; break; }
    const D = {};
    for (const k in pv.byColor) D[+k] = pv.byColor[k].reachable;
    const moves = Sim.listMoves(st).filter(function (m) { return !m.blocked; });
    let full = 0;
    for (const m of moves) {
      const b = st.cells[m.r][m.c];
      if ((D[b.color] || 0) >= b.count) full++;
      const key = m.r + ',' + m.c;
      releaseByCar[key] = releaseByCar[key] || [];
      if (releaseByCar[key].indexOf(hist.length) < 0) releaseByCar[key].push(hist.length);
    }
    const cell = st.cells[p.r] && st.cells[p.r][p.c];
    const spill = cell ? Math.max(0, cell.count - (D[cell.color] || 0)) : 0;
    const ok = Sim.applyPick(st, p.r, p.c);
    hist.push({ done: st.completedBoxes, buf: st.buffer.length, full: full, spill: spill, avail: moves.length, won: !!r.won });
    if (!ok) { okAll = false; break; }
  }
  runs.push({ i: i, seed: seed, r: r, ps: ps, hist: hist, okAll: okAll });
}

console.log('关卡：' + path.basename(file) + '　盘 ' + j.board.rows + '×' + j.board.cols + '　暂存上限 ' + (j.bufferLimit || 5));
console.log('真实(全知)：' + realHist.length + ' 步，buffer 峰值 ' + (realHist.length ? Math.max.apply(null, realHist) : '-') + '，band3=' + ((gv.persist || {}).band3Pct) + '%');
console.log('');
console.log('局  seed  结果  步数/总  回放  buf峰值  spill累积  真实buf峰值  r(spill,buf)  r(full,buf)');
const rsSpill = [], rsFull = [];
for (const x of runs) {
  let spillCum = 0;
  const pred = x.hist.map(function (h) { spillCum += h.spill; return spillCum; });
  const bufs = x.hist.map(function (h) { return h.buf; });
  const realBufs = x.ps.map(function (s) { return s.buf; });
  const rsp = pearson(pred, realBufs), rfu = pearson(x.hist.map(function (h) { return h.full; }), realBufs);
  if (rsp != null) rsSpill.push(rsp);
  if (rfu != null) rsFull.push(rfu);
  console.log('  ' + String(x.i).padStart(2) + '  ' + String(x.seed).padStart(4) + '  ' + (x.r.won ? '✓通关' : '✗卡死') + '  ' +
    String(x.hist.length + '/' + (x.r.totalBoxes || '?')).padStart(8) + '  ' + (x.okAll ? '✓' : '✗') + '  ' +
    String(Math.max.apply(null, bufs.concat([0]))).padStart(6) + '  ' + String(Math.max.apply(null, pred.concat([0]))).padStart(9) + '  ' +
    String(Math.max.apply(null, realBufs.concat([0]))).padStart(10) + '  ' + f(rsp).padStart(11) + '  ' + f(rfu).padStart(10));
}
console.log('');
console.log('汇总：spill→buf 相关性中位 ' + f(median(rsSpill)) + '　full→buf 相关性中位 ' + f(median(rsFull)));
console.log('      通关 ' + runs.filter(function (x) { return x.r.won; }).length + '/' + runs.length +
  '　回放成功 ' + runs.filter(function (x) { return x.okAll; }).length + '/' + runs.length);

// release 分布（跨局：同一格第一次可点的"回放步号"）
const keys = Object.keys(releaseByCar).filter(function (k) { return releaseByCar[k].length >= 3; });
const spreads = keys.map(function (k) {
  const v = releaseByCar[k];
  return { k: k, n: v.length, min: Math.min.apply(null, v), max: Math.max.apply(null, v), range: Math.max.apply(null, v) - Math.min.apply(null, v) };
}).sort(function (a, b) { return b.range - a.range; });
console.log('');
console.log('release 跨局差异（' + keys.length + ' 辆有 ≥3 局记录）：极差中位 ' + (spreads.length ? median(spreads.map(function (s) { return s.range; })) : '-') +
  '　最大 ' + (spreads.length ? spreads[0].range : '-'));
for (const s of spreads.slice(0, 5)) console.log('    (' + s.k + ') 首次可点步 ' + s.min + '~' + s.max + '（' + s.n + ' 局）极差 ' + s.range);
