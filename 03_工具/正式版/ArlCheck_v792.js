#!/usr/bin/env node
'use strict';
/**
 * ArlCheck_v792 —— 【新验收标准，2026-11-03 用户定稿】
 *
 *   ① 峰值 = 4
 *   ② 前 20%：at4 = 0
 *   ③ 前 20%：免费步 ≤ 6
 *   ④ 中段（20%~80%）：at3 ≥ 15
 *   ⑤ 后 20%：at3 ≥ 3 且连续 ≥ 3
 *   ⑥ 容错率 ≥ 80%（20 种随机打法）
 *   ⑦ 决策度（好决策步数）≥ 15
 *   ⑧ 没得选（可吃满=0 的步数）≤ 1
 *   ⑨ at4 ≥ 5（保留少量濒死时刻）
 *   ⑩ 可通关 / 无空格 / 容量守恒
 *
 * 用法：node ArlCheck_v792.js <关卡.json> [...]
 */
const B = require('./Build006Thickness_v688');
const A = B.loadSolver('corner');
const fs = require('fs');

function check(f) {
  const g = B.readJson(f);
  const lv = A.parseLevel(A.fromGameFormat(g));
  const o = A.Solver.runSolver(lv, 0, 1, false, false, { capturePreviewStats: true, instantChain: false });
  const buf = (o.pressureSamples || []).map(s => s.buf || 0);
  const L = buf.length, eN = Math.max(1, Math.round(L * 0.2)), tN = Math.floor(L * 0.8);
  let a3 = 0, a4 = 0;
  for (const v of buf) { if (v >= 3) a3++; if (v >= 4) a4++; }
  const early4 = buf.slice(0, eN).filter(v => v >= 4).length;
  const earlyFree = buf.slice(0, eN).filter(v => v === 0).length;
  const mid3 = buf.slice(eN, tN).filter(v => v >= 3).length;
  const tail3 = buf.slice(tN).filter(v => v >= 3).length;
  let tailRun = 0, c = 0;
  for (const v of buf.slice(tN)) { if (v >= 3) { c++; tailRun = Math.max(tailRun, c); } else c = 0; }
  const peak = Math.max(0, ...buf);

  // 容错
  let tol = 0;
  for (let i = 0; i < 20; i++) {
    const nz = i === 0 ? 0 : 0.2 + (i % 5) * 0.2;
    const oo = A.Solver.runSolver(lv, nz, 1000 + i * 37, false, false, { capturePreviewStats: false, instantChain: false });
    if (oo.completed) tol++;
  }

  // 决策度
  const H = g.blocks.length, W = g.blocks[0].length, rows = g.spools.length, cols = g.spools[0].length;
  const col = g.blocks.map(r => r.slice());
  const gone = g.blocks.map(r => r.map(() => false));
  const reach = (y, x) => y === 0 || x === 0 || y === H - 1 || x === W - 1 ||
    gone[y - 1][x] || gone[y + 1][x] || gone[y][x - 1] || gone[y][x + 1];
  const picks = (o.pickOrder || []).filter(p => p.chainIndex === 0);
  const taken = new Set(); let good = 0, dead = 0;
  // 【v793 修正】只有"棋盘上暴露的格子"才能选：边框行/列，或与已取走的空位相邻
  const tc = g.spools.map(r => r.map(() => false));
  const exposedAt = (r, c) => (r === 0 || c === 0 || r === rows - 1 || c === cols - 1) ||
    tc[r - 1] && tc[r - 1][c] || tc[r + 1] && tc[r + 1][c] || tc[r][c - 1] || tc[r][c + 1];
  for (const p of picks) {
    const cnt = {};
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { if (gone[y][x] || !reach(y, x)) continue; const cc = col[y][x]; cnt[cc] = (cnt[cc] || 0) + 1; }
    let avail = 0, fill = 0;
    for (let r = 0; r < rows; r++) for (let c2 = 0; c2 < cols; c2++) {
      const s = g.spools[r][c2]; if (!s || !(s.id > 0) || taken.has(r + ',' + c2)) continue;
      if (!exposedAt(r, c2)) continue;
      const t = Array.isArray(s.type) ? s.type : [s.type || 0]; if (t.includes(7)) continue;
      avail++; if (!s.q && (cnt[s.id] || 0) >= s.count) fill++;
    }
    if (avail >= 2 && fill >= 1 && fill < avail) good++;
    if (fill === 0) dead++;
    const c0 = p.color, list = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { if (gone[y][x] || col[y][x] !== c0 || !reach(y, x)) continue; list.push([(H - 1 - y) + x, y, x]); }
    list.sort((a, b) => a[0] - b[0]); let n = 0;
    for (const [d, y, x] of list) { if (n >= p.count) break; gone[y][x] = true; n++; }
    taken.add(p.r + ',' + p.c);
    tc[p.r][p.c] = true;
  }

  // 容量/空格
  let sum = 0, empty = 0;
  for (const row of g.spools) for (const s of row) {
    const t = s ? (Array.isArray(s.type) ? s.type : [s.type || 0]) : [];
    if (t.some(x => x >= 11 && x <= 14)) { (Array.isArray(s.param) ? s.param : []).forEach(b => sum += (b.count || 0)); continue; }
    if (s && s.id === -1) continue;
    if (!s || !s.id || s.id <= 0) { empty++; continue; }
    sum += s.count;
  }
  const px = g.blocks.flat().length;

  const rules = [
    ['峰值=4', peak === 4, peak],
    ['前20% at4=0', early4 === 0, early4 + ' 步'],
    ['前20% 免费步≤6', earlyFree <= 6, earlyFree + '/' + eN],
    ['中段 at3≥15', mid3 >= 15, mid3 + '/' + (tN - eN)],
    ['后20% at3≥3', tail3 >= 3, tail3],
    ['后20% 连续≥3', tailRun >= 3, tailRun],
    ['容错≥80%', tol >= 16, tol + '/20'],
    ['决策度≥15', good >= 15, good + '/' + picks.length],
    ['没得选≤1', dead <= 1, dead],
    ['at4≥5', a4 >= 5, a4],
    ['可通关', !!o.completed, o.completed ? '✓' : '✗'],
    ['无空格', empty === 0, empty],
    ['容量守恒', sum === px, sum + '/' + px],
  ];
  const pass = rules.every(r => r[1]);
  return { f, rules, pass, L };
}

if (require.main === module) {
  let bad = 0;
  for (const f of process.argv.slice(2)) {
    const r = check(f);
    console.log('\n=== ' + f.split('/').pop() + '（' + r.L + ' 步）===');
    for (const [name, ok, val] of r.rules) console.log('  ' + (ok ? '✅' : '❌') + ' ' + name.padEnd(16) + String(val));
    console.log('  → ' + (r.pass ? '通过' : '不通过'));
    if (!r.pass) bad++;
  }
  process.exit(bad ? 1 : 0);
}

module.exports = { check };
