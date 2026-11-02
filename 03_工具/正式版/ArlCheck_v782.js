#!/usr/bin/env node
'use strict';
/**
 * ArlCheck_v782 —— 【正式验收】按 at4/run4 口径（用户 2026-11-02 定稿）
 *
 *   ① 峰值 = 4（5 即死）
 *   ② 前 20%：at4 = 0 且 免费步（buffer=0 的完成数）≤ 6
 *   ③ 全程：at4 ≥ 20 且 run4 ≥ 10
 *   ④ 后 20%：at3 ≥ 3 且连续 ≥ 3
 *
 * 用法：node ArlCheck_v782.js <关卡.json> [...]
 */
const B = require('./Build006Thickness_v688');
const A = B.loadSolver('corner');
const fs = require('fs');

function check(f) {
  const g = B.readJson(f);
  const o = A.Solver.runSolver(A.parseLevel(A.fromGameFormat(g)), 0, 1, false, false, { capturePreviewStats: true, instantChain: false });
  const buf = (o.pressureSamples || []).map(s => s.buf || 0);
  const N = buf.length;
  const eN = Math.max(1, Math.round(N * 0.2));
  const tN = Math.floor(N * 0.8);
  let at4 = 0, run4 = 0, cur = 0;
  for (const v of buf) { if (v >= 4) { at4++; cur++; run4 = Math.max(run4, cur); } else cur = 0; }
  const early4 = buf.slice(0, eN).filter(v => v >= 4).length;
  const earlyFree = buf.slice(0, eN).filter(v => v === 0).length;
  const tail3 = buf.slice(tN).filter(v => v >= 3).length;
  let tailRun = 0; cur = 0;
  for (const v of buf.slice(tN)) { if (v >= 3) { cur++; tailRun = Math.max(tailRun, cur); } else cur = 0; }
  const peak = Math.max(0, ...buf);

  // 容量守恒 / 空格
  let sum = 0, empty = 0, black = 0;
  for (const row of g.spools) for (const s of row) {
    const t = s ? (Array.isArray(s.type) ? s.type : [s.type || 0]) : [];
    if (t.some(x => x >= 11 && x <= 14)) { (Array.isArray(s.param) ? s.param : []).forEach(b => sum += (b.count || 0)); continue; }
    if (s && s.id === -1) { black++; continue; }
    if (!s || !s.id || s.id <= 0) { empty++; continue; }
    sum += s.count;
  }
  const px = g.blocks.flat().length;
  const rules = [
    ['峰值=4', peak === 4, peak],
    ['前20% at4=0', early4 === 0, early4 + ' 步'],
    ['前20% 免费步≤6', earlyFree <= 6, earlyFree + '/' + eN],
    ['at4≥20', at4 >= 20, at4],
    ['run4≥10', run4 >= 10, run4],
    ['后20% at3≥3', tail3 >= 3, tail3],
    ['后20% 连续≥3', tailRun >= 3, tailRun],
    ['可通关', !!o.completed, o.completed ? '✓' : '✗'],
    ['无空格', empty === 0, empty],
    ['容量守恒', sum === px, sum + '/' + px],
  ];
  const pass = rules.every(r => r[1]);
  return { f, rules, pass, N };
}

let bad = 0;
for (const f of process.argv.slice(2)) {
  const r = check(f);
  console.log('\n=== ' + f.split('/').pop() + '（' + r.N + ' 步）===');
  for (const [name, ok, val] of r.rules) console.log('  ' + (ok ? '✅' : '❌') + ' ' + name.padEnd(16) + String(val));
  console.log('  → ' + (r.pass ? '通过' : '不通过'));
  if (!r.pass) bad++;
}
process.exit(bad ? 1 : 0);
