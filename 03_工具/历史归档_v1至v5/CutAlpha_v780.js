#!/usr/bin/env node
'use strict';
/**
 * CutAlpha_v780 —— 实验：车数按 n_c ∝ P_c^α 分配给各颜色
 *   α=1   → 车数与像素成正比（均分容量，大色多车/小车）
 *   α>1   → 大色相对车少（每辆容量更大），小色相对车多（容量更小）
 *   α<1   → 反之
 * 用法：node CutAlpha_v780.js <图.txt> --rows 7 --cols 7 --alpha 1.5 --out x.json
 */
const fs = require('fs');
const B = require('./Build006Thickness_v688');
const A = B.loadSolver('corner');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const IMG = process.argv[2];
const ROWS = Number(arg('--rows', 7)), COLS = Number(arg('--cols', 7));
const ALPHA = Number(arg('--alpha', 1));
const SEED = Number(arg('--seed', 7));
const OUT = arg('--out', '/tmp/alpha.json');

const lines = fs.readFileSync(IMG, 'utf8').trim().split(/\r?\n/).slice(1);
const blocks = lines.map(l => l.trim().split(/\s+/).map(Number));
const H = blocks.length, W = blocks[0].length;
const px = {};
for (const r of blocks) for (const v of r) px[v] = (px[v] || 0) + 1;
const colors = Object.keys(px).map(Number);
const cells = ROWS * COLS;

// 权重点 α，归一化到总车数
const w = colors.map(c => Math.pow(px[c], ALPHA));
const wsum = w.reduce((a, b) => a + b, 0);
const exact = w.map(x => x / wsum * cells);
let n = exact.map(x => Math.max(1, Math.floor(x)));
// 最大余数法补足剩余车数（且不能超过该色像素数）
let diff = cells - n.reduce((a, b) => a + b, 0);
while (diff > 0) {
  let best = -1, bestFrac = -1;
  for (let i = 0; i < n.length; i++) {
    if (n[i] >= px[colors[i]]) continue;          // 车数不能超过像素数
    const frac = exact[i] - Math.floor(exact[i]);
    if (frac > bestFrac) { bestFrac = frac; best = i; }
  }
  if (best < 0) break;
  n[best]++; exact[best] = Math.floor(exact[best]); diff--;
}
while (diff < 0) {
  let best = -1, bestCap = -1;
  for (let i = 0; i < n.length; i++) {
    if (n[i] <= 1) continue;
    const cap = px[colors[i]] / n[i];
    if (cap > bestCap) { bestCap = cap; best = i; }
  }
  if (best < 0) break;
  n[best]--; diff++;
}

// 生成车列表（每色 n_c 辆，容量尽量均分，余数给最后几辆）
const cars = [];
colors.forEach((c, i) => {
  const k = n[i], base = Math.floor(px[c] / k);
  let rest = px[c] - base * k;
  for (let j = 0; j < k; j++) {
    const cap = base + (j >= k - rest ? 1 : 0);
    cars.push({ id: c, count: cap });
  }
});
// 随机撒到棋盘
let s = SEED;
const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
for (let i = cars.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [cars[i], cars[j]] = [cars[j], cars[i]]; }
const spools = [];
for (let r = 0; r < ROWS; r++) { const row = []; for (let c = 0; c < COLS; c++) { const k = cars.pop(); row.push(k ? { id: k.id, type: 0, param: 0, count: k.count } : null); } spools.push(row); }
const g = { toprow: H, blocks, maprow: ROWS, mapcol: COLS, spools };
fs.writeFileSync(OUT, JSON.stringify(g));

const caps = spools.flat().filter(Boolean).map(x => x.count).sort((a, b) => a - b);
console.log(`α=${ALPHA} → 车数 ${caps.length}，容量 ${caps[0]}~${caps[caps.length-1]}（中位 ${caps[Math.floor(caps.length/2)]}），合计 ${caps.reduce((a,b)=>a+b,0)} / 像素 ${H*W}`);
console.log('  每色车数:', colors.map((c,i)=>c+":"+n[i]).join(' '));
