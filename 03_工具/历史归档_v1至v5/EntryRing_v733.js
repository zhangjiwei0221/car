// EntryRing_v733.js —— 入口环：把目标图最外 1px 换成入口色（其余像素内推 1px 保留）
// 用途：让“入口色”成为画布边界唯一暴露色 → 开局只能先开它
// 用法：node EntryRing_v733.js <目标图.txt> --entry 14 --out 新目标图.txt [--ring 1]
'use strict';
const fs = require('fs');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const FILE = process.argv[2];
const ENTRY = Number(arg('--entry', 0));
const OUT = arg('--out');
const RING = Number(arg('--ring', 1));

function loadG(p) {
  const lines = fs.readFileSync(p, 'utf8').split('\n').map(l => l.trim()).filter(Boolean);
  const body = lines[0].startsWith('像素') ? lines.slice(1) : lines;
  return body.map(l => l.split(/\s+/).map(Number));
}
const g = loadG(FILE);
const R = g.length, C = g[0].length;
for (let k = 0; k < RING; k++) {
  // 内推：把第 k+1 圈搬到第 k 圈
  const next = g.map(r => r.slice());
  for (let x = 0; x < C; x++) { next[k][x] = g[k + 1][x]; next[R - 1 - k][x] = g[R - 2 - k][x]; }
  for (let y = 0; y < R; y++) { next[y][k] = g[y][k + 1]; next[y][C - 1 - k] = g[y][C - 2 - k]; }
  for (let y = 0; y < R; y++) for (let x = 0; x < C; x++) g[y][x] = next[y][x];
  for (let x = 0; x < C; x++) { g[k][x] = ENTRY; g[R - 1 - k][x] = ENTRY; }
  for (let y = 0; y < R; y++) { g[y][k] = ENTRY; g[y][C - 1 - k] = ENTRY; }
}
fs.writeFileSync(OUT, '像素矩阵\n' + g.map(r => r.join(' ')).join('\n') + '\n');
const edge = new Set();
for (let x = 0; x < C; x++) { edge.add(g[0][x]); edge.add(g[R - 1][x]); }
for (let y = 0; y < R; y++) { edge.add(g[y][0]); edge.add(g[y][C - 1]); }
console.log(`已写出 ${OUT}；边界色 = ${[...edge].join(',')}`);
