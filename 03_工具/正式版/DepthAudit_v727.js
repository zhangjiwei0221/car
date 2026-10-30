// DepthAudit_v727.js —— 锁芯胚子预检：每色的“深度 / 质量”，判断这张图能不能做长平台
// 深度 = 从画布边界出发（忽略颜色）的曼哈顿步数；某色的深度取其所有像素的最小值。
// 用法：node DepthAudit_v727.js <目标图.txt> [--cars 30] [--depth 8]
'use strict';
const fs = require('fs');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const file = process.argv[2];
const CARS = Number(arg('--cars', 30));     // 一辆车的平均容量
const DEPTH = Number(arg('--depth', 8));    // 锁芯要求的最小深度

function loadG(p) {
  const lines = fs.readFileSync(p, 'utf8').split('\n').map(l => l.trim()).filter(Boolean);
  const body = lines[0].startsWith('像素') ? lines.slice(1) : lines;
  return body.map(l => l.split(/\s+/).map(Number));
}

const g = loadG(file);
const R = g.length, C = g[0].length;
// 多源 BFS：边界为 0
const dist = Array.from({ length: R }, () => new Array(C).fill(Infinity));
const q = [];
for (let x = 0; x < C; x++) { dist[0][x] = 0; q.push([0, x]); dist[R - 1][x] = 0; q.push([R - 1, x]); }
for (let y = 0; y < R; y++) { dist[y][0] = 0; q.push([y, 0]); dist[y][C - 1] = 0; q.push([y, C - 1]); }
let head = 0;
while (head < q.length) {
  const [y, x] = q[head++];
  for (const [dy, dx] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const ny = y + dy, nx = x + dx;
    if (ny < 0 || ny >= R || nx < 0 || nx >= C) continue;
    if (dist[ny][nx] > dist[y][x] + 1) { dist[ny][nx] = dist[y][x] + 1; q.push([ny, nx]); }
  }
}
const stat = {};
for (let y = 0; y < R; y++) for (let x = 0; x < C; x++) {
  const c = g[y][x];
  const s = stat[c] || (stat[c] = { total: 0, minDepth: Infinity, maxDepth: 0, depths: [] });
  s.total++; s.minDepth = Math.min(s.minDepth, dist[y][x]); s.maxDepth = Math.max(s.maxDepth, dist[y][x]);
  s.depths.push(dist[y][x]);
}
for (const k in stat) {
  const d = stat[k].depths.sort((a, b) => a - b);
  stat[k].median = d[Math.floor(d.length / 2)];
  stat[k].deepShare = d.filter(v => v >= DEPTH).length / d.length;
  delete stat[k].depths;
}
const rows = Object.entries(stat).map(([c, s]) => ({ color: +c, ...s }))
  .sort((a, b) => b.median - a.median);
const total = R * C;
const deep = rows.filter(r => r.median >= DEPTH && r.total >= CARS * 2);
const lockMass = deep.reduce((a, r) => a + r.total, 0);

console.log(`目标图：${file}（${R}×${C} = ${total} px，${rows.length} 色）`);
console.log('颜色  总量  中位深度  深占比  最大深度  占比');
for (const r of rows.slice(0, 8)) {
  console.log(`${String(r.color).padStart(4)} ${String(r.total).padStart(5)} ${String(r.median).padStart(8)} ${(r.deepShare*100).toFixed(0).padStart(6)}% ${String(r.maxDepth).padStart(8)} ${String(Math.round(r.total / total * 100)).padStart(4)}%`);
}
console.log(`\n锁芯胚子（中位深度≥${DEPTH} 且总量≥${CARS * 2}px）：${deep.length ? deep.map(r => `${r.color}(${r.total}px,中位${r.median})`).join(' ') : '无'}`);
console.log(`可做长平台：${lockMass >= CARS * 3 ? '✅ 可以（锁芯质量 ' + lockMass + 'px ≥ ' + CARS * 3 + '）' : '❌ 不行（锁芯质量 ' + lockMass + 'px < ' + CARS * 3 + '）'}`);
