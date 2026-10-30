// ComposeScene_v746.js —— 按“简单背景 + 单主体 + 少量点缀”拼一张目标图
// 规则（导师版）：
//   画布 30–35（默认 32）
//   主体：1 个，占非背景像素的 45–60%，放在左下（让 corner 起点先生效）
//   点缀：2–4 个小图，每个不超过画布 4%
//   背景：1–2 种纯色，尽量简单
// 用法：
//   node ComposeScene_v746.js --subject 主体.txt --deco "a.txt,b.txt" --size 32 --out 图.txt [--seed 7] [--bg 3]
'use strict';
const fs = require('fs');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };

function readTxt(p) {
  const lines = fs.readFileSync(p, 'utf8').trim().split('\n').filter(l => l.trim());
  if (lines[0].startsWith('像素')) lines.shift();
  return lines.map(l => l.trim().split(/\s+/).map(Number));
}
function trim(g) {
  const R = g.length, C = g[0].length;
  const rows = [], cols = [];
  for (let y = 0; y < R; y++) if (g[y].some(v => v > 0)) rows.push(y);
  for (let x = 0; x < C; x++) if (g.some(r => r[x] > 0)) cols.push(x);
  if (!rows.length) return [];
  return g.slice(rows[0], rows[rows.length - 1] + 1).map(r => r.slice(cols[0], cols[cols.length - 1] + 1));
}
/** 整数倍缩放（最近邻）；scale 为整数 */
function scale(g, s) {
  const out = [];
  for (const row of g) {
    const nr = [];
    for (const v of row) for (let k = 0; k < s; k++) nr.push(v);
    for (let k = 0; k < s; k++) out.push(nr.slice());
  }
  return out;
}
function countPixels(g) { let n = 0; for (const r of g) for (const v of r) if (v > 0) n++; return n; }

const SUBJECT = arg('--subject');
const DECOS = String(arg('--deco', '')).split(',').map(s => s.trim()).filter(Boolean);
const SIZE = Number(arg('--size', 32));
const OUT = arg('--out', '/tmp/scene.txt');
const SEED = Number(arg('--seed', 7));
const BG = Number(arg('--bg', 3));

if (!SUBJECT) { console.error('用法: node ComposeScene_v746.js --subject 主体.txt [--deco a.txt,b.txt] --size 32 --out 图.txt'); process.exit(1); }

// 伪随机（固定种子，可复现）
let _s = SEED * 9301 + 49297;
const rnd = () => { _s = (_s * 9301 + 49297) % 233280; return _s / 233280; };

// 收集素材用到的颜色，背景色自动避开它们
const used = new Set();
for (const g of [trim(readTxt(SUBJECT))].concat(DECOS.map(p => trim(readTxt(p))))) {
  for (const r of g) for (const v of r) if (v > 0) used.add(v);
}
// 背景优先用“最亮且未被素材使用”的颜色（浅灰 31 / 灰色 32 这类），保证背景干净
const LIGHT_ORDER = [31, 32, 5, 27, 25, 29, 30, 19];
let bg = LIGHT_ORDER.find(c => !used.has(c)) || 31;
if (process.argv.includes('--bg') && !used.has(BG)) bg = BG;
const canvas = Array.from({ length: SIZE }, () => new Array(SIZE).fill(bg));
// 主体目标：占画布 FILL（默认 55%），按“最近邻重采样”缩放到该尺寸
const FILL = Number(arg('--fill', 0.55));
let sub = trim(readTxt(SUBJECT));
if (!sub.length) { console.error('主体为空'); process.exit(1); }
const CROP = process.argv.includes('--crop');       // 大素材：居中裁剪铺满画布
const side = Math.max(6, Math.round(Math.sqrt(SIZE * SIZE * FILL)));   // 主体目标边长
const f0 = Math.max(sub.length, sub[0].length) / side;
if (CROP && (sub.length > SIZE || sub[0].length > SIZE)) {
  const y0 = Math.max(0, Math.floor((sub.length - SIZE) / 2));
  const x0 = Math.max(0, Math.floor((sub[0].length - SIZE) / 2));
  sub = sub.slice(y0, y0 + SIZE).map(r => r.slice(x0, x0 + SIZE));
} else if (f0 > 1.02 || f0 < 0.98) {
  const nh = Math.max(1, Math.round(sub.length / f0)), nw = Math.max(1, Math.round(sub[0].length / f0));
  const out = [];
  for (let y = 0; y < nh; y++) {
    const row = [];
    for (let x = 0; x < nw; x++) {
      row.push(sub[Math.min(sub.length - 1, Math.round(y * f0))][Math.min(sub[0].length - 1, Math.round(x * f0))]);
    }
    out.push(row);
  }
  sub = out;
}
// 若主体实际覆盖率不足目标，按比例继续放大（最多 3 轮）
for (let k = 0; k < 3; k++) {
  const cov = countPixels(sub) / (SIZE * SIZE);
  if (cov >= FILL * 0.9 || sub.length >= SIZE || sub[0].length >= SIZE) break;
  const grow = Math.sqrt(FILL / Math.max(0.01, cov));
  const nh = Math.min(SIZE, Math.round(sub.length * grow)), nw = Math.min(SIZE, Math.round(sub[0].length * grow));
  const out = [];
  for (let y = 0; y < nh; y++) {
    const row = [];
    for (let x = 0; x < nw; x++) {
      row.push(sub[Math.min(sub.length - 1, Math.floor(y * sub.length / nh))][Math.min(sub[0].length - 1, Math.floor(x * sub[0].length / nw))]);
    }
    out.push(row);
  }
  sub = out;
}
const sh = sub.length, sw = sub[0].length;

// 主体放在左下（左边距 1–2，底边贴 1）
const sy = Math.max(0, SIZE - sh - 1);
const sx = 1;
for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
  const v = sub[y][x];
  if (v > 0 && sy + y < SIZE && sx + x < SIZE) canvas[sy + y][sx + x] = v;
}

// 点缀：放在右上/上中/右中等空位，缩到很小
let placed = 0;
for (const p of DECOS.slice(0, 4)) {
  let d = trim(readTxt(p));
  if (!d.length) continue;
  const dp = countPixels(d);
  const want = Math.max(9, Math.round(SIZE * SIZE * 0.02));       // 每个点缀约占 2%
  // 目标边长（像素）；素材若更大，按最近邻抽样降到该尺寸，保留形状
  const box = Math.max(4, Math.round(Math.sqrt(want)));
  const f = Math.max(d.length, d[0].length) / box;
  if (f > 1.2) {
    const nh = Math.max(1, Math.round(d.length / f)), nw = Math.max(1, Math.round(d[0].length / f));
    const out = [];
    for (let y = 0; y < nh; y++) {
      const row = [];
      for (let x = 0; x < nw; x++) {
        row.push(d[Math.min(d.length - 1, Math.round(y * f))][Math.min(d[0].length - 1, Math.round(x * f))]);
      }
      out.push(row);
    }
    d = out;
  }
  const dh = d.length, dw = d[0].length;
  // 候选位置：右上、左上、右中、下右（避开左下主体）
  const spots = [
    [1, SIZE - dw - 1], [1, 1], [Math.floor(SIZE * 0.35), SIZE - dw - 1],
    [SIZE - dh - 1, SIZE - dw - 1], [Math.floor(SIZE * 0.2), Math.floor(SIZE * 0.55)],
  ];
  let tries = 0, ok = false;
  while (tries < spots.length && !ok) {
    const [y, x] = spots[(tries + placed) % spots.length]; tries++;
    if (y < 0 || x < 0 || y + dh > SIZE || x + dw > SIZE) continue;
    // 不覆盖主体：检查区域里非背景像素为 0
    let free = true;
    for (let yy = 0; yy < dh && free; yy++) for (let xx = 0; xx < dw; xx++) {
      const v = d[yy][xx];
      if (v > 0 && canvas[y + yy] && canvas[y + yy][x + xx] !== bg) { free = false; break; }
    }
    if (!free) continue;
    for (let yy = 0; yy < dh; yy++) for (let xx = 0; xx < dw; xx++) {
      const v = d[yy][xx];
      if (v > 0 && canvas[y + yy] && canvas[y + yy][x + xx] === bg) canvas[y + yy][x + xx] = v;
    }
    placed++; ok = true;
  }
}

const lines = ['像素矩阵'].concat(canvas.map(r => r.join(' ')));
fs.writeFileSync(OUT, lines.join('\n') + '\n');
const total = SIZE * SIZE;
let subArea = 0; for (const r of canvas) for (const v of r) if (v > 0 && v !== bg) subArea++;
// 三类占比
const subSet = new Set();
for (const r of sub) for (const v of r) if (v > 0) subSet.add(v);
let bgPx = 0; for (const r of canvas) for (const v of r) if (v === bg) bgPx++;
console.log(`已写出 ${OUT}：${SIZE}x${SIZE}`);
console.log(`  主体 ${sh}x${sw} → 非背景像素 ${subArea}（${Math.round(subArea / total * 100)}%）`);
console.log(`  背景 ${bgPx}（${Math.round(bgPx / total * 100)}%，颜色 ${bg}），点缀 ${placed} 个`);
if (bgPx / total > 0.4) console.log('  ⚠ 背景占比 >40%，太空，建议加大主体或加点缀');
