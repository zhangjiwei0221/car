#!/usr/bin/env node
'use strict';
/**
 * ImgFeature_v781 —— 目标图体检：色数 / 碎度 / 包围色比例
 * 用法：node ImgFeature_v781.js <图.txt> [...]
 */
const fs = require('fs');
function feat(f) {
  const m = fs.readFileSync(f, 'utf8').trim().split(/\r?\n/).slice(1).map(l => l.trim().split(/\s+/).map(Number));
  const H = m.length, W = m[0].length, tot = H * W;
  const cnt = {}, comp = {}, seen = m.map(r => r.map(() => false));
  const comps = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = m[y][x];
    cnt[c] = (cnt[c] || 0) + 1;
    if (seen[y][x]) continue;
    comp[c] = (comp[c] || 0) + 1;
    const cells = []; const st = [[y, x]]; seen[y][x] = true;
    while (st.length) {
      const [cy, cx] = st.pop(); cells.push([cy, cx]);
      for (const [dy, dx] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const ny = cy + dy, nx = cx + dx;
        if (ny < 0 || nx < 0 || ny >= H || nx >= W || seen[ny][nx] || m[ny][nx] !== c) continue;
        seen[ny][nx] = true; st.push([ny, nx]);
      }
    }
    comps.push({ c, cells });
  }
  const colors = Object.keys(cnt).map(Number);
  const patchSizes = colors.map(c => cnt[c] / comp[c]).sort((a, b) => a - b);
  const patchCounts = colors.map(c => comp[c]).sort((a, b) => a - b);
  const med = a => a.length ? a[Math.floor(a.length / 2)] : 0;
  let enclosed = 0;
  for (const co of comps) {
    let border = false; const nb = new Set();
    for (const [y, x] of co.cells) {
      if (y === 0 || x === 0 || y === H - 1 || x === W - 1) border = true;
      for (const [dy, dx] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const ny = y + dy, nx = x + dx;
        if (ny < 0 || nx < 0 || ny >= H || nx >= W) continue;
        if (m[ny][nx] !== co.c) nb.add(m[ny][nx]);
      }
    }
    if (!border && nb.size === 1) enclosed += co.cells.length;
  }
  const maxPct = 100 * Math.max(...Object.values(cnt)) / tot;
  const avgPx = tot / colors.length;
  const rows = [
    ['尺寸', W + 'x' + H, '35–40'],
    ['色数', colors.length, '16–18'],
    ['每色平均像素', Math.round(avgPx), '≈80'],
    ['最大色占比', maxPct.toFixed(1) + '%', '≤12%'],
    ['碎度·块数(中位)', med(patchCounts), '18–22'],
    ['碎度·块大小(中位)', med(patchSizes).toFixed(1) + 'px', '3–4px'],
    ['包围色比例', (100 * enclosed / tot).toFixed(1) + '%', '≥7%'],
  ];
  console.log('=== ' + f.split('/').pop() + ' ===');
  for (const [k, v, want] of rows) console.log('  ' + k.padEnd(14) + String(v).padStart(8) + '   目标 ' + want);
}
for (const f of process.argv.slice(2)) feat(f);
