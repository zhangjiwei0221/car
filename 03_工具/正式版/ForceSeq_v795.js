#!/usr/bin/env node
'use strict';
/**
 * ForceSeq_v795 —— 强制车序的爬山（用引擎当裁判）
 *
 * 前提：1 格宽内部通道 → 取车顺序被完全强制（实测 r0..rN 一步不跳）
 * 做法：直接在"车序"上做局部搜索（交换任意两辆），目标是用引擎跑出来的曲线。
 *
 * 用法：node ForceSeq_v795.js <图.txt> --cells 60 --iters 300
 */
const fs = require('fs');
const B = require('./Build006Thickness_v688');
const A = B.loadSolver('corner');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const IMG = process.argv[2];
const CELLS = Number(arg('--cells', 60));
const ITERS = Number(arg('--iters', 300));
const WIDTH = Number(arg('--width', 1));

const m = fs.readFileSync(IMG, 'utf8').trim().split(/\r?\n/).slice(1).map(l => l.trim().split(/\s+/).map(Number));
const H = m.length, W = m[0].length, TOT = H * W;
const px = {};
for (const r of m) for (const v of r) px[v] = (px[v] || 0) + 1;
const colors = Object.keys(px).map(Number);
const CAP = TOT / CELLS;

function makePool() {
  const pool = [];
  for (const c of colors) {
    const n = Math.max(1, Math.floor(px[c] / CAP));
    const base = Math.floor(px[c] / n); let rest = px[c] - base * n;
    for (let j = 0; j < n; j++) pool.push({ id: c, count: base + (j >= n - rest ? 1 : 0) });
  }
  while (pool.length < CELLS) {
    pool.sort((a, b) => b.count - a.count); const big = pool.shift();
    if (big.count < 2) { pool.push(big); break; }
    const h = Math.floor(big.count / 2);
    pool.push({ id: big.id, count: h }, { id: big.id, count: big.count - h });
  }
  while (pool.length > CELLS) pool.pop();
  return pool;
}

function build(seq) {
  const N = Math.ceil(seq.length / WIDTH) + 4, COL = Math.floor((N - WIDTH) / 2);
  const spools = Array.from({ length: N }, () => Array(N).fill(null));
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) spools[r][c] = { id: -1, type: 0, param: 0, count: 0 };
  for (let k = 0; k < seq.length; k++) {
    const r = Math.floor(k / WIDTH), c = COL + (k % WIDTH);
    spools[r][c] = { id: seq[k].id, type: 0, param: 0, count: seq[k].count };
  }
  return { toprow: H, blocks: m, maprow: N, mapcol: N, spools };
}

function score(seq) {
  const g = build(seq);
  const o = A.Solver.runSolver(A.parseLevel(A.fromGameFormat(g)), 0, 1, false, false, { capturePreviewStats: true, instantChain: false });
  const buf = (o.pressureSamples || []).map(s => s.buf || 0);
  const L = buf.length;
  if (!o.completed) return { sc: -1e6 + L * 10, won: false, L, a3: 0, a4: 0, peak: 0, buf };
  const eN = Math.max(1, Math.round(L * 0.2)), tN = Math.floor(L * 0.8);
  let a3 = 0, a4 = 0;
  for (const v of buf) { if (v >= 3) a3++; if (v >= 4) a4++; }
  const e4 = buf.slice(0, eN).filter(v => v >= 4).length;
  const t3 = buf.slice(tN).filter(v => v >= 3).length;
  const peak = Math.max(0, ...buf);
  // 目标：中段 at3 高、峰值 4、前段不爆、后段有压、且必须通关
  const sc = 2000 + a3 * 8 + a4 * 3 - e4 * 200 + t3 * 10 + (peak === 4 ? 200 : -300);
  return { sc, won: true, L, a3, a4, peak, e4, t3, buf };
}

// 初值：用"跟踪可达性"的贪心生成（参考 ColorSpread 的思路）
function designInit() {
  const pool = makePool();
  const col = m.map(r => r.slice()), gone = m.map(r => r.map(() => false));
  const reach = (y, x) => y === 0 || x === 0 || y === H - 1 || x === W - 1 ||
    gone[y - 1][x] || gone[y + 1][x] || gone[y][x - 1] || gone[y][x + 1];
  const rc = () => { const c = {}; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { if (gone[y][x] || !reach(y, x)) continue; const v = col[y][x]; c[v] = (c[v] || 0) + 1; } return c; };
  const eat = (c0, n0) => { const l = []; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { if (gone[y][x] || col[y][x] !== c0 || !reach(y, x)) continue; l.push([(H - 1 - y) + x, y, x]); } l.sort((a, b) => a[0] - b[0]); let n = 0; for (const [d, y, x] of l) { if (n >= n0) break; gone[y][x] = true; n++; } return n; };
  const buffer = [], seq = [], rest = pool.slice();
  const absorb = () => { let ch = true; while (ch) { ch = false; for (let i = 0; i < buffer.length; i++) { const b = buffer[i]; const c = rc(); const av = c[b.id] || 0; if (av > 0) { const t = Math.min(av, b.remain); eat(b.id, t); b.remain -= t; if (b.remain <= 0) { buffer.splice(i, 1); ch = true; break; } } } } };
  for (let st = 0; st < CELLS; st++) {
    const c = rc();
    const fillable = rest.filter(x => (c[x.id] || 0) >= x.count && !buffer.some(b => b.id === x.id));
    const notFill = rest.filter(x => !fillable.includes(x) && !buffer.some(b => b.id === x.id));
    let pick = null;
    if (buffer.length < 2 && notFill.length) pick = notFill[0];
    else if (fillable.length) pick = fillable[0];
    else if (notFill.length) pick = notFill[0];
    else pick = rest[0];
    if (!pick) break;
    rest.splice(rest.indexOf(pick), 1); seq.push(pick);
    const got = eat(pick.id, pick.count);
    if (got < pick.count) buffer.push({ id: pick.id, remain: pick.count - got });
    absorb();
    if (buffer.length >= 5) { /* 继续，让爬山去修 */ }
  }
  while (seq.length < CELLS) { const x = makePool()[seq.length % renderLen()]; seq.push(x); }
  return seq.slice(0, CELLS);
}
function renderLen() { return CELLS; }

let seq = designInit();
let cur = score(seq);
console.log('起点: 通关=' + cur.won + ' 步=' + cur.L + ' at3=' + cur.a3 + ' at4=' + cur.a4 + ' 峰值=' + cur.peak + ' → 分 ' + cur.sc.toFixed(0));

let s = 20261103;
const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
let best = { seq: seq.slice(), m: cur };
for (let it = 0; it < ITERS; it++) {
  const i = Math.floor(rnd() * seq.length), j = Math.floor(rnd() * seq.length);
  if (i === j) continue;
  const t = seq.slice();
  [t[i], t[j]] = [t[j], t[i]];
  const r = score(t);
  if (r.sc > cur.sc) {
    seq = t; cur = r;
    if (r.sc > best.m.sc) best = { seq: t.slice(), m: r };
    if (it % 25 === 0) console.log('  第' + it + '轮: at3=' + r.a3 + ' at4=' + r.a4 + ' 峰值=' + r.peak + ' 前段at4=' + r.e4 + ' 后段at3=' + r.t3);
  }
}
console.log('\n最优: 通关=' + best.m.won + ' 步=' + best.m.L + ' at3=' + best.m.a3 + ' at4=' + best.m.a4 + ' 峰值=' + best.m.peak);
console.log('曲线: ' + best.m.buf.join(','));
fs.writeFileSync('/tmp/forced_seq.json', JSON.stringify({ seq: best.seq, cells: CELLS }));
fs.writeFileSync('/tmp/forced_level.json', JSON.stringify(build(best.seq)));
