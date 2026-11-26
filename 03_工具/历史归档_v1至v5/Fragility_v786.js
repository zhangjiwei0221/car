#!/usr/bin/env node
'use strict';
/**
 * Fragility_v786 —— 容错率检测（"死感"的量化）
 *
 * 思路：用不同噪声强度跑多次求解，统计通关率。
 *   容错率高 → 走错了还能救回来（好）
 *   容错率低 → 一步走错就死（"死感"）
 *
 * 用法：node Fragility_v786.js <关卡.json> [--runs 20]
 */
const B = require('./Build006Thickness_v688');
const A = B.loadSolver('corner');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const FILE = process.argv[2];
const RUNS = Number(arg('--runs', 20));
const g = B.readJson(FILE);
const lv = A.parseLevel(A.fromGameFormat(g));

let ok = 0, tot = 0;
const details = [];
for (let i = 0; i < RUNS; i++) {
  const noise = i === 0 ? 0 : 0.2 + (i % 5) * 0.2;      // 0, 0.2, 0.4, 0.6, 0.8, 1.0 循环
  const seed = 1000 + i * 37;
  const o = A.Solver.runSolver(lv, noise, seed, false, false, { capturePreviewStats: false, instantChain: false });
  tot++;
  if (o.completed) ok++;
  const buf = (o.pressureSamples || []).map(s => s.buf || 0);
  details.push({ noise: noise.toFixed(1), won: !!o.completed, steps: buf.length, peak: Math.max(0, ...buf) });
}
const rate = ok / tot;
console.log('=== ' + FILE.split('/').pop() + ' ===');
console.log('  容错率: ' + ok + '/' + tot + ' = ' + (100 * rate).toFixed(0) + '%');
const byNoise = {};
for (const d of details) { (byNoise[d.noise] = byNoise[d.noise] || []).push(d.won); }
console.log('  按噪声:');
for (const [n, arr] of Object.entries(byNoise)) {
  const w = arr.filter(Boolean).length;
  console.log('    噪声 ' + n + ' → ' + w + '/' + arr.length);
}
const judge = rate >= 0.9 ? '✅ 很宽容（几乎不会走死）'
  : rate >= 0.7 ? '🟡 一般（偶尔会走死）'
  : rate >= 0.4 ? '🟠 偏紧（容易走死）'
  : '❌ 很脆（一步错就死）';
console.log('  判定: ' + judge);
