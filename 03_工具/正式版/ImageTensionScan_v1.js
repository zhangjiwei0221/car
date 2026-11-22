#!/usr/bin/env node
'use strict';
/**
 * ImageTensionScan_v1 —— 选图：按“总量 × 连通性”筛“中间态”颜色
 *
 * 背景（2026-11-12 用户）：
 *   “19 没任何压力，纯色联通太大了。”
 *   “不止要看像素的数量吧，连不连通也是一方面。”
 *
 * 每张图对每个颜色算（4 连通）：
 *   totalPx   该色像素总数
 *   maxBlob   该色最大连通块
 * 两个关键统计：
 *   bigShare  = maxBlob / coloredPx            —— “大且联”的顺手色，越高关卡越平
 *   midColors = 满足 totalPx≥60·s 且 40·s≤maxBlob≤120·s 的颜色数，s=(W·H)/1600
 *               （2026-11-22 用户裁决：阈值按图面积缩放，参考 40×40=1600px）
 *               —— 这些是“需要先开一片、再拿一辆”的张力色
 *
 * 用法：
 *   node ImageTensionScan_v1.js <目录|单个txt> [--out 结果.json] [--top 30]
 *
 * 输出：每图 {W,H,colors,coloredPx,maxBlob,bigShare,midColors,colorDetail[]}
 *       控制台按 midColors 降序、bigShare 升序打印前 N。
 */
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const input = argv[0];
const arg = (k, d) => { const i = argv.indexOf(k); return i > 0 ? argv[i + 1] : d; };
const OUT = arg('--out', '');
const TOP = Number(arg('--top', 30));
if (!input) { console.error('用法: node ImageTensionScan_v1.js <目录|txt> [--out 结果.json] [--top 30]'); process.exit(2); }

function parse(file) {
  const lines = fs.readFileSync(file, 'utf8').replace(/\r/g, '').trim().split('\n');
  const rows = [];
  for (const l of lines) {
    const t = l.trim();
    if (!t || /[^\d\s-]/.test(t)) continue;
    rows.push(t.split(/\s+/).map(Number));
  }
  return rows;
}

function scan(b) {
  const H = b.length, W = b[0].length;
  const seen = Array.from({ length: H }, () => Array(W).fill(false));
  const perColor = new Map();
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    if (seen[r][c]) continue;
    const v = b[r][c];
    seen[r][c] = true;
    if (!v || v < 0) continue;
    let n = 0;
    const st = [[r, c]];
    while (st.length) {
      const [y, x] = st.pop(); n++;
      for (const [dy, dx] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ny = y + dy, nx = x + dx;
        if (ny < 0 || nx < 0 || ny >= H || nx >= W || seen[ny][nx]) continue;
        if (b[ny][nx] === v) { seen[ny][nx] = true; st.push([ny, nx]); }
      }
    }
    if (!perColor.has(v)) perColor.set(v, { totalPx: 0, blobs: [] });
    const e = perColor.get(v);
    e.totalPx += n;
    e.blobs.push(n);
  }
  let coloredPx = 0, maxBlob = 0, midColors = 0;
  const midScale = (W * H) / 1600;   // 中间色阈值按面积缩放（参考 40×40）
  const detail = [];
  for (const [v, e] of perColor) {
    const mx = Math.max(...e.blobs);
    coloredPx += e.totalPx;
    if (mx > maxBlob) maxBlob = mx;
    const mid = e.totalPx >= 60 * midScale && mx >= 40 * midScale && mx <= 120 * midScale;
    if (mid) midColors++;
    detail.push({ color: v, totalPx: e.totalPx, blobs: e.blobs.length, maxBlob: mx, mid });
  }
  detail.sort((a, b2) => b2.totalPx - a.totalPx);
  return {
    W, H, colors: perColor.size, coloredPx, maxBlob,
    bigShare: +(maxBlob / (coloredPx || 1)).toFixed(3),
    midColors, colorDetail: detail,
  };
}

const files = fs.statSync(input).isDirectory()
  ? fs.readdirSync(input).filter(f => f.endsWith('.txt')).sort().map(f => path.join(input, f))
  : [input];

const out = [];
for (const f of files) {
  try { out.push({ name: path.basename(f, '.txt'), file: f, ...scan(parse(f)) }); }
  catch (e) { out.push({ name: path.basename(f, '.txt'), file: f, error: e.message }); }
}
out.sort((a, b) => (b.midColors || 0) - (a.midColors || 0) || (a.bigShare || 9) - (b.bigShare || 9));
for (const r of out.slice(0, TOP)) {
  console.log(`${String(r.name).padEnd(14)} ${r.W}x${r.H} 色=${r.colors} 彩色=${r.coloredPx} 最大块=${r.maxBlob}(${(r.bigShare * 100).toFixed(1)}%) 中间色=${r.midColors}`);
}
if (OUT) { fs.writeFileSync(OUT, JSON.stringify(out, null, 1)); console.log('saved ' + OUT); }
