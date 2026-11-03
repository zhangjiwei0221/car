#!/usr/bin/env node
'use strict';
/**
 * TailTune_v791 —— 后段调参：让"最后 15 步"保持"有 2~3 个可选、但最多 1 个能吃满"
 *
 * 用户 2026-11-03：统一边框_01 死亡 100% 集中在最后 40%，
 *                因为后段可选车太少，取到坏的就没有替代。
 *
 * 做法：局部搜索——把"后段被取的车"和"别处的车"交换，用
 *       （容错 + 决策度 + at3）作为评分，只保留变好的交换。
 *
 * 用法：node TailTune_v791.js <关卡.json> --out <输出.json> [--iters 300]
 */
const fs = require('fs');
const B = require('./Build006Thickness_v688');
const A = B.loadSolver('corner');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const FILE = process.argv[2];
const OUT = arg('--out', '/tmp/tailtuned.json');
const ITERS = Number(arg('--iters', 300));
const RUNS = Number(arg('--runs', 8));

const g0 = B.readJson(FILE);
const rows = g0.spools.length, cols = g0.spools[0].length;

function metrics(g, runs) {
  const lv = A.parseLevel(A.fromGameFormat(g));
  const o = A.Solver.runSolver(lv, 0, 1, false, false, { capturePreviewStats: true, instantChain: false });
  const buf = (o.pressureSamples || []).map(s => s.buf || 0);
  const L = buf.length, m0 = Math.floor(L * 0.2), m1 = Math.floor(L * 0.8);
  let a3 = 0, trailing = 0, c = 0;
  for (const v of buf) { if (v >= 3) a3++; }
  let tr = 0; c = 0;
  for (const v of buf.slice(m1)) { if (v >= 3) { c++; tr = Math.max(tr, c); } else c = 0; }
  // 容错
  let ok = 0, early = 0;
  for (let i = 0; i < runs; i++) {
    const nz = i === 0 ? 0 : 0.2 + (i % 5) * 0.2;
    const oo = A.Solver.runSolver(lv, nz, 1000 + i * 37, false, false, { capturePreviewStats: false, instantChain: false });
    if (oo.completed) ok++;
    const b2 = (oo.pressureSamples || []).map(s => s.buf || 0);
    const e1 = Math.max(1, Math.round(b2.length * 0.2));
    if (b2.slice(0, e1).every(v => v < 4)) early++;
  }
  return { won: !!o.completed, steps: L, a3, mid3: buf.slice(m0, m1).filter(v => v >= 3).length, tailRun: tr, tail3: buf.slice(m1).filter(v => v >= 3).length, tol: ok / runs, early: early / runs, buf };
}

// 决策度（好决策步数）
function decision(g) {
  const H = g.blocks.length, W = g.blocks[0].length;
  const o = A.Solver.runSolver(A.parseLevel(A.fromGameFormat(g)), 0, 1, false, false, { capturePreviewStats: true, instantChain: false });
  const col = g.blocks.map(r => r.slice());
  const gone = g.blocks.map(r => r.map(() => false));
  const reach = (y, x) => y === 0 || x === 0 || y === H - 1 || x === W - 1 ||
    gone[y - 1][x] || gone[y + 1][x] || gone[y][x - 1] || gone[y][x + 1];
  const picks = (o.pickOrder || []).filter(p => p.chainIndex === 0);
  const taken = new Set(); let good = 0, dead = 0;
  for (const p of picks) {
    const cnt = {};
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { if (gone[y][x] || !reach(y, x)) continue; const cc = col[y][x]; cnt[cc] = (cnt[cc] || 0) + 1; }
    let avail = 0, fill = 0;
    for (let r = 0; r < rows; r++) for (let c2 = 0; c2 < cols; c2++) {
      const s = g.spools[r][c2]; if (!s || !(s.id > 0) || taken.has(r + ',' + c2)) continue;
      const t = Array.isArray(s.type) ? s.type : [s.type || 0]; if (t.includes(7)) continue;
      avail++; if (!s.q && (cnt[s.id] || 0) >= s.count) fill++;
    }
    if (avail >= 3 && fill >= 1 && fill <= 2) good++;
    if (fill === 0) dead++;
    const c0 = p.color, list = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { if (gone[y][x] || col[y][x] !== c0 || !reach(y, x)) continue; list.push([(H - 1 - y) + x, y, x]); }
    list.sort((a, b) => a[0] - b[0]); let n = 0;
    for (const [d, y, x] of list) { if (n >= p.count) break; gone[y][x] = true; n++; }
    taken.add(p.r + ',' + p.c);
  }
  return { good, dead, n: picks.length };
}

function score(m, d) {
  if (!m.won) return -1e9;
  return m.tol * 300 + d.good * 14 + m.mid3 * 16 + m.tailRun * 12 - d.dead * 45 - (m.early < 0.8 ? 250 : 0) - (m.steps < 40 ? 200 : 0);
}

let cur = JSON.parse(JSON.stringify(g0));
let m = metrics(cur, RUNS), d = decision(cur), sc = score(m, d);
console.log('起点: 容错 ' + (100 * m.tol).toFixed(0) + '% 前20%容错 ' + (100 * m.early).toFixed(0) + '% 决策 ' + d.good + ' 没得选 ' + d.dead + ' at3=' + m.a3 + ' 收尾连续=' + m.tailRun + ' → 分 ' + sc.toFixed(0));

// 收集可交换的普通格
function plainCells(g) {
  const out = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const s = g.spools[r][c]; if (!s || !(s.id > 0)) continue;
    const t = Array.isArray(s.type) ? s.type : [s.type || 0];
    if (!t.includes(5) && !t.includes(7) && !s.q) out.push([r, c]);
  }
  return out;
}

let s = 1234567;
const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
let best = { g: cur, m, d, sc };

for (let it = 0; it < ITERS; it++) {
  const cells = plainCells(cur);
  if (cells.length < 4) break;
  const a = cells[Math.floor(rnd() * cells.length)];
  const b = cells[Math.floor(rnd() * cells.length)];
  if (a[0] === b[0] && a[1] === b[1]) continue;
  const g2 = JSON.parse(JSON.stringify(cur));
  const tmp = g2.spools[a[0]][a[1]];
  g2.spools[a[0]][a[1]] = g2.spools[b[0]][b[1]];
  g2.spools[b[0]][b[1]] = tmp;
  const m2 = metrics(g2, RUNS);
  if (!m2.won) { continue; }
  const d2 = decision(g2);
  const sc2 = score(m2, d2);
  if (sc2 > sc) {
    cur = g2; m = m2; d = d2; sc = sc2;
    if (sc2 > best.sc) best = { g: g2, m: m2, d: d2, sc: sc2 };
    if (it % 20 === 0) console.log('  第' + it + '轮: 容错 ' + (100 * m2.tol).toFixed(0) + '% 决策 ' + d2.good + ' 没得选 ' + d2.dead + ' at3=' + m2.a3 + ' 收尾=' + m2.tailRun);
  }
}
fs.writeFileSync(OUT, JSON.stringify(best.g));
console.log('\n最优: 容错 ' + (100 * best.m.tol).toFixed(0) + '% 前20% ' + (100 * best.m.early).toFixed(0) + '% 决策 ' + best.d.good + ' 没得选 ' + best.d.dead + ' at3=' + best.m.a3 + ' 收尾 ' + best.m.tail3 + '/' + best.m.tailRun);
console.log('曲线: ' + best.m.buf.join(','));
console.log('→ ' + OUT);
