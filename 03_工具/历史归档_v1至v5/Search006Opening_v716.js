#!/usr/bin/env node
'use strict';
/**
 * 开局重排搜索：只交换“非锁链格”的车，保持链组不变；
 * 目标：页面 at4 不降、run4≥6、峰值≤4、可通关，同时压短“免费前缀”（贪心免费步）。
 * 用法：node Search006Opening_v716.js --iters 200 [--level path] [--write]
 */
const B = require('./Build006Thickness_v688');
const A = B.loadSolver();
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const ITERS = Number(arg('--iters', 200));
const SRC = arg('--level', '实验关/关卡6/原型_v47/关卡_实验_006_v47.json');
const OUT = arg('--out', '实验关/关卡6/原型_v49/关卡_实验_006_v49.json');
const base = B.readJson(SRC);

function isCar(c) { if (!c) return false; const t = Array.isArray(c.type) ? c.type : [c.type || 0]; return c.id > 0 && t.every(x => x >= 11 && x <= 14 ? false : true); }
function inChain(c) { const t = Array.isArray(c.type) ? c.type : [c.type || 0]; return t.indexOf(5) >= 0; }
function hasIce(c) { const t = Array.isArray(c.type) ? c.type : [c.type || 0]; return t.indexOf(7) >= 0; }

const freeCells = [];
for (let r = 0; r < base.spools.length; r++) for (let c = 0; c < base.spools[r].length; c++) {
  const cell = base.spools[r][c];
  if (isCar(cell) && !inChain(cell) && !hasIce(cell)) freeCells.push([r, c]);
}

function pageMetrics(g) {
  const lv = A.parseLevel(A.fromGameFormat(g));
  const o = A.Solver.runSolver(lv, 0, 1, true, false, { capturePreviewStats: true, instantChain: true });
  const h = (o.pressureSamples || []).map(s => s.buf);
  let run4 = 0, cur4 = 0, at4 = 0;
  for (const v of h) { if (v >= 4) { cur4++; at4++; run4 = Math.max(run4, cur4); } else cur4 = 0; }
  return { won: !!o.completed, peak: Math.max(0, ...h), at4, run4, items: o.itemUses || 0 };
}

function freePrefix(g) {
  const lv = A.parseLevel(A.fromGameFormat(g));
  const st = A.Simulator.createState(lv, { useSlotStart: true, instantChain: true });
  st.capture = true;
  const picks = [];
  for (let step = 0; step < 12; step++) {
    if (st.gameWon) break;
    const moves = A.Simulator.listMoves(st).filter(m => !m.blocked);
    if (!moves.length) break;
    let best = null;
    for (const m of moves) {
      const p = A.Simulator.createState(lv, { useSlotStart: true, instantChain: true });
      p.capture = true;
      for (const q of picks) { p.capOps = []; A.Simulator.applyPick(p, q.r, q.c); }
      p.capOps = [];
      if (!A.Simulator.applyPick(p, m.r, m.c)) continue;
      const items = (p.buffer || []).filter(it => (it.progress || 0) < (it.need || 0));
      const debt = items.reduce((a, it) => a + (it.need - (it.progress || 0)), 0);
      if (!best || debt < best.debt) best = { r: m.r, c: m.c, debt };
    }
    if (!best || best.debt > 0) break;
    st.capOps = []; A.Simulator.applyPick(st, best.r, best.c);
    picks.push({ r: best.r, c: best.c });
  }
  return picks.length;
}

function applySwaps(swaps) {
  const g = B.clone(base);
  for (const [a, b] of swaps) {
    const ca = g.spools[a[0]][a[1]], cb = g.spools[b[0]][b[1]];
    const id = ca.id, cnt = ca.count;
    ca.id = cb.id; ca.count = cb.count; cb.id = id; cb.count = cnt;
  }
  return g;
}

let rnd = 12345;
function rand() { rnd = (rnd * 1664525 + 1013904223) >>> 0; return rnd / 4294967296; }

let best = null;
const baseM = pageMetrics(base), baseF = freePrefix(base);
console.log('基线:', JSON.stringify(baseM), 'freePrefix=' + baseF, '可交换车数=' + freeCells.length);

for (let it = 0; it < ITERS; it++) {
  const n = 2 + Math.floor(rand() * 3);
  const swaps = [], used = new Set();
  for (let k = 0; k < n; k++) {
    const a = freeCells[Math.floor(rand() * freeCells.length)];
    const b = freeCells[Math.floor(rand() * freeCells.length)];
    if (a.join() === b.join()) continue;
    if (used.has(a.join()) || used.has(b.join())) continue;
    used.add(a.join()); used.add(b.join());
    swaps.push([a, b]);
  }
  if (!swaps.length) continue;
  const g = applySwaps(swaps);
  let m; try { m = pageMetrics(g); } catch (e) { continue; }
  if (!m.won || m.items > 0 || m.peak > 4 || m.at4 < 12 || m.run4 < 6) continue;
  const f = freePrefix(g);
  if (!best || f < best.f || (f === best.f && m.at4 > best.m.at4)) {
    best = { swaps, m, f, g };
    console.log('改进 freePrefix=' + f + ' at4=' + m.at4 + ' run4=' + m.run4 + ' swaps=' + JSON.stringify(swaps));
  }
}
if (!best) { console.log('无改进'); process.exit(0); }
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(best.g, null, 2));
console.log('written=' + OUT);
