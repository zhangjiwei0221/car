#!/usr/bin/env node
'use strict';
// 只读探针（pid/uuid AE32D8BD）：每色像素/车量、贪心首次使用步、前5步、随机首拿进度中位
const path = require('path');
const B = require(path.resolve(__dirname, '../../../../03_工具/正式版/Build006Thickness_v688.js'));
const A = B.loadSolver('corner');
const Sim = A.Simulator, St = A.SolverStrategy;
const fs = require('fs');
const f = process.argv[2];
const g = JSON.parse(fs.readFileSync(f, 'utf8'));
const lv = A.parseLevel(A.fromGameFormat(g));

// 像素数
const px = {};
for (const row of g.blocks) for (const v of row) if (v) px[v] = (px[v] || 0) + 1;
// 车 count 合计（含链；管道 param）
const cars = {}, cells = {};
for (let r = 0; r < g.spools.length; r++) for (let c = 0; c < g.spools[r].length; c++) {
  const s = g.spools[r][c]; if (!s || !(s.id > 0)) continue;
  cars[s.id] = (cars[s.id] || 0) + (s.count || 0);
  (cells[s.id] = cells[s.id] || []).push(`${r},${c}${[].concat(s.type||0).some(t=>t>0) ? 't' + JSON.stringify(s.type) : ''}/${s.count}`);
}
// 贪心（corner）
const o = A.Solver.runSolver(lv, 0, 1, false, false, { capturePreviewStats: true, instantChain: false });
const picks = o.pickOrder || [];
const firstStep = {};
picks.forEach((p, i) => { if (!(p.color in firstStep)) firstStep[p.color] = i + 1; });
const first5 = new Set(picks.slice(0, 5).map(p => p.color));
const first10 = new Set(picks.slice(0, 10).map(p => p.color));

// 随机玩家每色首拿进度（p=0），100 局 seed 977
const isWon = s => s.eliminatedPixels >= s.totalPixels;
const isDead = s => !!(s.overflow || s.buffer.length > s.bufferLimit || Sim.isDeadEnd(s));
function lcg(seed) { let rs = seed; return () => { rs = (rs * 1103515245 + 12345) & 0x7fffffff; return rs / 0x7fffffff; }; }
const rnd = lcg(977), firstProg = {};
let wins = 0;
for (let k = 0; k < 100; k++) {
  let s = Sim.createState(lv, { useSlotStart: true, bottomOnly: false, instantChain: false });
  let steps = 0; const seen = new Set();
  while (!isWon(s) && steps < 200) {
    const ms = Sim.listMoves(s).filter(m => !m.blocked);
    const idx = ms.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const x = idx[i]; idx[i] = idx[j]; idx[j] = x; }
    let pick = null;
    for (const q of idx) { const m = ms[q]; const t = St.cloneState(s); if (!Sim.applyPick(t, m.r, m.c)) continue; if (!isDead(t) || isWon(t)) { pick = { m, t }; break; } }
    if (!pick) break;
    const col = pick.m.antBox.color;
    if (!seen.has(col)) { seen.add(col); (firstProg[col] = firstProg[col] || []).push(s.eliminatedPixels / s.totalPixels); }
    s = pick.t; steps++;
  }
  if (isWon(s)) wins++;
}
const med = a => { if (!a || !a.length) return null; const b = [...a].sort((x, y) => x - y); const m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
const rows = [];
for (const col of Object.keys(px).map(Number).sort((a, b) => b - a)) {
  rows.push({
    color: col, px: px[col], carCount: cars[col] || 0,
    greedyFirstStep: firstStep[col] || null,
    inGreedyFirst5: first5.has(col), inGreedyFirst10: first10.has(col),
    randomFirstProgMedian: med(firstProg[col]), cells: cells[col] || []
  });
}
console.log(JSON.stringify({ file: f.split('/').pop(), rows, pickOrder: picks.slice(0, 20).map(p => `${p.r},${p.c}#${p.color}/${p.count}`), randomWins: wins }, null, 1));
