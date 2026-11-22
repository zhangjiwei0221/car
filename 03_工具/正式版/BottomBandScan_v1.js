#!/usr/bin/env node
'use strict';
/**
 * BottomBandScan_v1 —— 底边结构扫描（2026-11-22，v7 选图用）
 *
 * 动机：颜色数/中间色等统计指标与墙模式张力不相关；墙下难度由“底边暴露的像素结构”决定。
 * 本工具只看目标图底带（默认底 1 行，可 --rows N），输出：
 *   bottomColors      底带里出现的颜色数
 *   perColor[]        每个底带颜色：totalPx（全图）、blobsAll、bandPx、bandBlobs、singleBlob（全图只有 1 块）
 *   trapColors        底带里“全图只有 1 块且总量≤80px”的颜色数（近似单车色 → 开局债务源）
 *   bigBottom         底带里总量≥150px 的颜色数（近似“多车供应”）
 *   balance           bigBottom / bottomColors
 *
 * 用法：
 *   node BottomBandScan_v1.js <图.txt> [--rows 1] [--out 结果.json]
 */
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i > 0 ? argv[i + 1] : d; };
const FILE = argv[0];
if (!FILE || FILE.startsWith('--')) { console.error('用法: node BottomBandScan_v1.js <图.txt> [--rows 1] [--out 结果.json]'); process.exit(2); }
const BAND = Math.max(1, Number(arg('--rows', 1)) || 1);
const OUT = arg('--out', null);

const lines = fs.readFileSync(FILE, 'utf8').split(/\r?\n/).filter(l => l.trim().length);
let body;
if (/像素矩阵/.test(lines[0])) body = lines.slice(1);
else body = lines;
const grid = body.map(l => l.trim().split(/[\s,]+/).map(Number));
const H = grid.length, W = grid[0].length;

// 全图统计：每色总像素与连通块
function components(color) {
  const vis = Array.from({ length: H }, () => Array(W).fill(false));
  let blobs = 0;
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    if (vis[r][c] || grid[r][c] !== color) continue;
    blobs++;
    const st = [[r, c]]; vis[r][c] = true;
    while (st.length) {
      const [x, y] = st.pop();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= H || ny >= W || vis[nx][ny] || grid[nx][ny] !== color) continue;
        vis[nx][ny] = true; st.push([nx, ny]);
      }
    }
  }
  return blobs;
}

const total = {};
for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
  const v = grid[r][c]; if (v > 0) total[v] = (total[v] || 0) + 1;
}
// 底带（最后 BAND 行）
const bandColors = {};
for (let r = Math.max(0, H - BAND); r < H; r++) for (let c = 0; c < W; c++) {
  const v = grid[r][c]; if (v > 0) bandColors[v] = (bandColors[v] || 0) + 1;
}
const perColor = [];
for (const k of Object.keys(bandColors).map(Number).sort((a, b) => bandColors[b] - bandColors[a])) {
  const blobsAll = components(k);
  perColor.push({ color: k, totalPx: total[k], blobsAll, bandPx: bandColors[k], singleBlob: blobsAll === 1 });
}
const trapColors = perColor.filter(x => x.singleBlob && x.totalPx <= 80).length;
const bigBottom = perColor.filter(x => x.totalPx >= 150).length;
const res = {
  file: path.basename(FILE), W, H, band: BAND,
  bottomColors: perColor.length, trapColors, bigBottom,
  balance: perColor.length ? +(bigBottom / perColor.length).toFixed(2) : 0,
  perColor
};
if (OUT) fs.writeFileSync(OUT, JSON.stringify(res, null, 1));
console.log(JSON.stringify(res));
