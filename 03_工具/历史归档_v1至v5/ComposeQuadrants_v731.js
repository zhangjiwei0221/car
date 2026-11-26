// ComposeQuadrants_v731.js —— 用“官方图的象限”当主体（碎色内部）+ 三层结构
// 用法：node ComposeQuadrants_v731.js --levels a.txt,b.txt,c.txt,d.txt --out 目标图.txt [--size 44] [--depth 0,1,2,3] [--max-colors 15]
'use strict';
const fs = require('fs'), path = require('path');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const LEVELS = arg('--levels').split(',');
const OUT = arg('--out');
const SIZE = Number(arg('--size', 44));
const DEPTHS = String(arg('--depth', '0,1,2,3')).split(',').map(Number);
const MAXC = Number(arg('--max-colors', 15));
const OUTLINES = String(arg('--outlines', '14,28,19,16')).split(',').map(Number);
const BG = String(arg('--bg', '31,1')).split(',').map(Number);

function loadG(p) {
  const lines = fs.readFileSync(p, 'utf8').split('\n').map(l => l.trim()).filter(Boolean);
  const body = lines[0].startsWith('像素') ? lines.slice(1) : lines;
  return body.map(l => l.split(/\s+/).map(Number));
}
const W = SIZE, half = Math.floor(W / 2);
const canvas = Array.from({ length: W }, (_, y) => Array.from({ length: W }, (_, x) => BG[((y >> 1) + (x >> 1)) % BG.length]));
const cells = [[0, 0], [0, half], [half, 0], [half, half]];

LEVELS.forEach((file, i) => {
  const q = loadG(path.resolve(file));
  const hr = Math.floor(q.length / 2), hc = Math.floor(q[0].length / 2);
  const quad = q.slice(0, hr).map(r => r.slice(0, hc));
  const d = DEPTHS[i] || 0, size = half - 2 * d;
  const [oy, ox] = cells[i];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const sy = Math.min(quad.length - 1, Math.floor(y * quad.length / size));
    const sx = Math.min(quad[0].length - 1, Math.floor(x * quad[0].length / size));
    canvas[oy + d + y][ox + d + x] = quad[sy][sx];
  }
  const oc = OUTLINES[i];
  for (let t = 0; t < size; t++) {
    canvas[oy + d][ox + d + t] = oc;
    canvas[oy + d + size - 1][ox + d + t] = oc;
    canvas[oy + d + t][ox + d] = oc;
    canvas[oy + d + t][ox + d + size - 1] = oc;
  }
});

// 色数收敛：超过上限时，把“用量最少”的颜色并到最近的已保留色（RGB 距离）
function palette() {
  const src = fs.readFileSync(path.resolve(__dirname, '../../02_工程/游戏主bin/bin/js/utils.js'), 'utf8');
  const pal = {};
  const re = /\{\s*name:\s*'([^']+)',\s*hex:\s*'#([0-9A-Fa-f]{6})'\s*\}\s*,\s*\/\/\s*(\d+)/g;
  let m; while ((m = re.exec(src))) pal[+m[3]] = m[2];
  return pal;
}
const pal = palette();
const rgb = (c) => { const h = pal[c] || 'FFFFFF'; return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; };
const dist = (a, b) => { const A = rgb(a), B = rgb(b); return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]); };

let stat = {};
for (const row of canvas) for (const v of row) stat[v] = (stat[v] || 0) + 1;
let colors = Object.keys(stat).map(Number);
if (colors.length > MAXC) {
  const keep = new Set(colors.sort((a, b) => stat[b] - stat[a]).slice(0, MAXC));
  const map = {};
  for (const c of colors) {
    if (keep.has(c)) { map[c] = c; continue; }
    let best = null, bd = 1e9;
    for (const k of keep) { const d = dist(c, k); if (d < bd) { bd = d; best = k; } }
    map[c] = best;
  }
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) canvas[y][x] = map[canvas[y][x]];
  console.log(`色数超限（${colors.length} → ${MAXC}），已按最近色合并`);
}
stat = {};
for (const row of canvas) for (const v of row) stat[v] = (stat[v] || 0) + 1;
colors = Object.keys(stat).map(Number);
console.log(`画布 ${W}×${W} = ${W * W}px，色数 ${colors.length}`);
console.log('分布：', colors.sort((a, b) => stat[b] - stat[a]).map(c => `${c}:${stat[c]}`).join(' '));
fs.writeFileSync(OUT, '像素矩阵\n' + canvas.map(r => r.join(' ')).join('\n') + '\n');
console.log('已写出：' + OUT);
