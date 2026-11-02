#!/usr/bin/env node
'use strict';
/**
 * LayerByEdge_v754 —— 按「颜色有没有露头」给车分层，压掉开局高压、保住后段
 *
 * 原理（实测，见工作日志 §872.8）：
 *   开局唯一可达的像素 = 贴着图像边界的像素。若某辆车要的颜色在边界上一个像素都没有，
 *   这辆车一选就吃不满 → 开局就欠债 → 第 3~5 步顶到高压线。
 *   把「贴边像素 ≥ 自身容量」的车放棋盘外层（开局暴露），其余放内层，开局立刻松下来。
 *
 * 用法：
 *   node LayerByEdge_v754.js <关卡.json> --out <输出.json>
 *        [--contract 契约.json]     有契约时自动试多种子，取第一个通过契约且可通关的
 *        [--seeds 12] [--ref corner] [--mode a]
 *
 * 只改车的摆放位置：不动物色、不动容量、不改规则。
 */
const fs = require('fs');
const B = require('./Build006Thickness_v688');
const A = B.loadSolver((() => { const i = process.argv.indexOf('--ref'); return i > 0 ? process.argv[i + 1] : 'corner'; })());
const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const FILE = process.argv.slice(2).find(a => !a.startsWith('--') && !['--out', '--contract', '--seeds', '--ref', '--mode'].includes(process.argv[process.argv.indexOf(a) - 1]));
const OUT = arg('--out', '');
const CONTRACT = arg('--contract', '');
const SEEDS = Number(arg('--seeds', 12));
const MODE = arg('--mode', 'a');
if (!FILE || !OUT) { console.error('用法: node LayerByEdge_v754.js <关卡.json> --out <输出.json> [--contract 契约.json] [--seeds 12]'); process.exit(1); }

const C = CONTRACT ? JSON.parse(fs.readFileSync(CONTRACT, 'utf8')) : null;
const LINE = Number(C ? (C.bufferLine || 3) : 3);

function rng(x) { let s = x; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; }

function layered(g0, seed) {
  const R = g0.spools.length, Cc = g0.spools[0].length, H = g0.blocks.length, W = g0.blocks[0].length;
  const edge = {};
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
    if (y === 0 || x === 0 || y === H - 1 || x === W - 1) edge[g0.blocks[y][x]] = (edge[g0.blocks[y][x]] || 0) + 1;
  const cells = [], cars = [];
  for (let r = 0; r < R; r++) for (let c = 0; c < Cc; c++) {
    const s = g0.spools[r][c]; if (s && s.id > 0) { cells.push([r, c]); cars.push(JSON.parse(JSON.stringify(s))); }
  }
  const ring = (r, c) => Math.min(r, c, R - 1 - r, Cc - 1 - c);
  const outerI = [], innerI = [];
  cells.forEach(([r, c], i) => (ring(r, c) === 0 ? outerI : innerI).push(i));
  const r0 = rng(seed);
  const shuf = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r0() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const easy = cars.filter(s => (edge[s.id] || 0) >= s.count);
  const hard = cars.filter(s => (edge[s.id] || 0) < s.count);
  shuf(easy); shuf(hard);
  const assign = new Array(cells.length).fill(null);
  let ei = 0;
  for (const ci of outerI) if (ei < easy.length) assign[ci] = easy[ei++];
  const rest = [...easy.slice(ei), ...hard];
  shuf(rest);
  let ri = 0;
  for (const ci of innerI) if (assign[ci] === null && ri < rest.length) assign[ci] = rest[ri++];
  for (const ci of outerI) if (assign[ci] === null && ri < rest.length) assign[ci] = rest[ri++];
  for (let i = 0; i < assign.length; i++) if (assign[i] === null && ri < rest.length) assign[i] = rest[ri++];
  const out = JSON.parse(JSON.stringify(g0));
  cells.forEach(([r, c], i) => { out.spools[r][c] = assign[i] || { id: 0, type: 0, param: 0, count: 0 }; });
  return { out, easy: easy.length, hard: hard.length };
}

function check(g) {
  const lv = A.parseLevel(A.fromGameFormat(g));
  const r = A.Solver.runSolver(lv, 0, 1, false, false, { capturePreviewStats: true, instantChain: false });
  const buf = (r.pressureSamples || []).map(s => s.buf || 0);
  if (!r.completed) return { ok: false, why: '不可通关', won: false, buf };
  if (!C) return { ok: true, won: true, buf };
  const N = buf.length; let ok = true;
  for (const s of C.segments) {
    const a = Math.round(N * s.from), b = Math.round(N * s.to);
    const sub = buf.slice(a, b);
    let run = 0, cur = 0; for (const v of sub) { if (v >= LINE) { cur++; run = Math.max(run, cur); } else cur = 0; }
    const hit = sub.filter(v => v >= LINE).length;
    if (s.max4 != null && hit > s.max4) ok = false;
    if (s.min4 != null && hit < s.min4) ok = false;
    if (s.minRun != null && run < s.minRun) ok = false;
  }
  return { ok, won: true, buf };
}

const g0 = B.readJson(FILE);
let best = null, tried = 0, wonAny = 0;
for (let s = 1; s <= (C ? SEEDS : 1); s++) {
  tried++;
  const { out, easy } = layered(g0, s);
  const r = check(out);
  if (r.won) wonAny++;
  if (r.ok) { best = { out, seed: s, buf: r.buf, easy }; break; }
}
// 【2026-11-02】契约不通过时**不写产物**：分层会把好关的压力毁掉（实测 T3v1 22→0），
// 不能"总是替换"，否则 --layer 反而劣化结果。
if (!best) {
  console.error(`❌ 分层未通过契约（试了 ${tried} 个种子，其中 ${wonAny} 个可通关）→ 保留原关卡`);
  process.exit(1);
}
fs.writeFileSync(OUT, JSON.stringify(best.out));
const N = best.buf.length, a = Math.round(N * 0.2), b = Math.round(N * 0.8);
const c = x => x.filter(v => v >= LINE).length;
console.log(`✅ ${OUT}`);
console.log(`   seed=${best.seed} 易填车=${best.easy} 步数=${N} 高压线=${LINE}`);
console.log(`   前20%=${c(best.buf.slice(0, a))} 中60%=${c(best.buf.slice(a, b))} 后20%=${c(best.buf.slice(b))}`);
console.log(`   曲线：${best.buf.join(',')}`);
