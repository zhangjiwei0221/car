#!/usr/bin/env node
'use strict';
/**
 * MapComplexity_v1.js —— 图库复杂度评分（派工#003 任务 C1）
 * 口径：颜色碎片（4 连通块数）+ 边界密度（相邻异色边 / 总边）+ 小色块占比（<32px）+ 色数。
 * 用法：node MapComplexity_v1.js --dir <图库目录> [--out map_complexity.json]
 * 也支持多个 --dir（逗号分隔）或直接传目录列表。
 */
const fs = require('fs');
const path = require('path');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const dirs = (arg('--dir', '') || '').split(',').map(s => s.trim()).filter(Boolean);
const out = arg('--out', null);
if (!dirs.length) { console.error('用法: node MapComplexity_v1.js --dir <目录1,目录2> [--out x.json]'); process.exit(2); }

function readMatrix(file) {
  const lines = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).filter(l => /^\s*\d/.test(l));
  return lines.map(l => l.trim().split(/\s+/).map(Number));
}
function scoreMatrix(mat) {
  const H = mat.length, W = mat[0].length;
  const cnt = {}, total = H * W;
  for (const row of mat) for (const v of row) if (v > 0) cnt[v] = (cnt[v] || 0) + 1;
  const colors = Object.keys(cnt).length;
  // 4 连通块
  const seen = Array.from({ length: H }, () => new Uint8Array(W));
  let comps = 0;
  const dirs4 = [[1,0],[-1,0],[0,1],[0,-1]];
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    if (seen[r][c] || mat[r][c] <= 0) continue;
    comps++;
    const v = mat[r][c]; const st = [[r, c]]; seen[r][c] = 1;
    while (st.length) {
      const [x, y] = st.pop();
      for (const [dx, dy] of dirs4) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= H || ny < 0 || ny >= W || seen[nx][ny]) continue;
        if (mat[nx][ny] === v) { seen[nx][ny] = 1; st.push([nx, ny]); }
      }
    }
  }
  let edges = 0, diff = 0;
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    if (c + 1 < W) { edges++; if (mat[r][c] !== mat[r][c + 1]) diff++; }
    if (r + 1 < H) { edges++; if (mat[r][c] !== mat[r + 1][c]) diff++; }
  }
  const edgeDensity = edges ? diff / edges : 0;
  const smallPx = Object.values(cnt).filter(v => v < 32).reduce((a, b) => a + b, 0);
  const smallShare = smallPx / total;
  const score = +(100 * (0.45 * Math.min(1, comps / 60) + 0.35 * edgeDensity + 0.20 * Math.min(1, smallShare * 3) + 0.10 * Math.min(1, colors / 20))).toFixed(2);
  return { W, H, colors, comps, edgeDensity: +edgeDensity.toFixed(3), smallShare: +smallShare.toFixed(3), score };
}
const result = { generated: new Date().toISOString(), dirs: {}, top: {} };
for (const d of dirs) {
  const files = fs.readdirSync(d).filter(f => f.endsWith('.txt')).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  const rows = [];
  for (const f of files) {
    try {
      const m = readMatrix(path.join(d, f));
      if (!m.length || !m[0].length) continue;
      rows.push({ file: f, ...scoreMatrix(m) });
    } catch (e) {}
  }
  rows.sort((a, b) => b.score - a.score);
  result.dirs[d] = rows;
  result.top[d] = rows.slice(0, 3);
  console.log(`\n== ${d} (${rows.length} 图)`);
  rows.slice(0, 10).forEach(r => console.log(`${r.score.toFixed(2).padStart(7)}  ${r.file.padEnd(10)} ${r.W}x${r.H} 色${r.colors} 块${r.comps} 边界${r.edgeDensity} 小色${r.smallShare}`));
}
if (out) fs.writeFileSync(out, JSON.stringify(result, null, 1));
