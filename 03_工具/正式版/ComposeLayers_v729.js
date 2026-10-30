// ComposeLayers_v729.js —— 三层合成器（M1）
// L3 大边框（2–4 段，各不同色） / L2 背景（1–2 色） / L1 每个主体的独有描边
// 每主体可设深度 d（L1 到边框之间隔多少层背景），决定“谁先暴露”
// 用法：node ComposeLayers_v729.js --config cfg.json --out 目标图.txt [--png 预览.png]
'use strict';
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.resolve(__dirname, '../..');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const CFG = arg('--config');
const OUT = arg('--out');
const PNG = arg('--png');
if (!CFG || !OUT) { console.log('用法：node ComposeLayers_v729.js --config cfg.json --out 目标图.txt [--png 预览.png]'); process.exit(1); }
const cfg = JSON.parse(fs.readFileSync(CFG, 'utf8'));

function loadG(p) {
  const lines = fs.readFileSync(p, 'utf8').split('\n').map(l => l.trim()).filter(Boolean);
  const body = lines[0].startsWith('像素') ? lines.slice(1) : lines;
  return body.map(l => l.split(/\s+/).map(Number));
}
// 裁到非零外接框
function crop(g) {
  let y0 = 1e9, y1 = -1, x0 = 1e9, x1 = -1;
  for (let y = 0; y < g.length; y++) for (let x = 0; x < g[y].length; x++) {
    if (g[y][x] !== 0) { if (y < y0) y0 = y; if (y > y1) y1 = y; if (x < x0) x0 = x; if (x > x1) x1 = x; }
  }
  if (y1 < 0) return g;
  return g.slice(y0, y1 + 1).map(r => r.slice(x0, x1 + 1));
}
function downscale(g, n) {
  const h = g.length, w = g[0].length, out = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const y0 = Math.floor(y * h / n), y1 = Math.max(y0 + 1, Math.floor((y + 1) * h / n));
    const x0 = Math.floor(x * w / n), x1 = Math.max(x0 + 1, Math.floor((x + 1) * w / n));
    const cnt = {};
    for (let yy = y0; yy < Math.min(y1, h); yy++) for (let xx = x0; xx < Math.min(x1, w); xx++) {
      const v = g[yy][xx]; if (v) cnt[v] = (cnt[v] || 0) + 1;
    }
    let best = 0, bn = 0; for (const k in cnt) if (cnt[k] > bn) { bn = cnt[k]; best = +k; }
    out[y][x] = best;
  }
  return out;
}

const W = cfg.size || 44;
const L2 = cfg.background;              // [c1, c2] 可选
const L3 = cfg.border;                  // 4 段（上/右/下/左）颜色
const subs = cfg.subjects;              // [{file, outline, colors:[..], depth, cell:'TL'|'TR'|'BL'|'BR'}]

const canvas = Array.from({ length: W }, (_, y) => Array.from({ length: W }, (_, x) => L2[((y >> 1) + (x >> 1)) % L2.length]));

// L3：最外 1px，四条边各一段颜色
for (let x = 0; x < W; x++) { canvas[0][x] = L3[0]; canvas[W - 1][x] = L3[2]; }
for (let y = 0; y < W; y++) { canvas[y][W - 1] = L3[1]; canvas[y][0] = L3[3]; }

// 每个主体占一个象限，按 depth 内缩
const half = Math.floor(W / 2);
const cellOf = { TL: [0, 0], TR: [0, half], BL: [half, 0], BR: [half, half] };
for (const s of subs) {
  const [oy, ox] = cellOf[s.cell];
  const d = s.depth || 1;
  const box = half - d;                       // 该象限内可画尺寸
  if (box <= 4) continue;
  // L1 描边
  for (let t = 0; t < box; t++) {
    canvas[oy + d][ox + d + t] = s.outline;
    canvas[oy + d + box - 1][ox + d + t] = s.outline;
    canvas[oy + d + t][ox + d] = s.outline;
    canvas[oy + d + t][ox + d + box - 1] = s.outline;
  }
  // 主体
  const sprite = downscale(crop(loadG(path.join(ROOT, s.file))), box - 2);
  const cnt = {};
  for (const row of sprite) for (const v of row) if (v) cnt[v] = (cnt[v] || 0) + 1;
  const srcs = Object.keys(cnt).map(Number).sort((a, b) => cnt[b] - cnt[a]);
  const map = {};
  srcs.forEach((c, i) => { map[c] = s.colors[i % s.colors.length]; });
  for (let y = 0; y < box - 2; y++) for (let x = 0; x < box - 2; x++) {
    const v = sprite[y][x];
    if (v) canvas[oy + d + 1 + y][ox + d + 1 + x] = map[v] || s.colors[0];
  }
}

// 预算检查
const stat = {};
for (const row of canvas) for (const v of row) stat[v] = (stat[v] || 0) + 1;
const colors = Object.keys(stat).map(Number);
console.log(`画布 ${W}×${W} = ${W * W} px，色数 ${colors.length}（上限 15）`);
console.log('分布：', colors.sort((a, b) => stat[b] - stat[a]).map(c => `${c}:${stat[c]}`).join(' '));

fs.writeFileSync(OUT, '像素矩阵\n' + canvas.map(r => r.join(' ')).join('\n') + '\n');
console.log('已写出目标图：' + OUT);

if (PNG) {
  const py = process.env.PY || '/Users/red/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/python/bin/python3';
  const code = `
import re,sys
from PIL import Image
pal={}
src=open('02_工程/完整主bin快照_20261012/bin/js/utils.js').read()
for mm in re.finditer(r"{ name: '([^']+)',\\s+hex: '#([0-9A-Fa-f]{6})' \\}\\s*,\\s*// (\\d+)", src):
    pal[int(mm.group(3))]=mm.group(2)
lines=[l for l in open('${OUT}').read().strip().splitlines() if l.strip()]
if lines[0].startswith('像素'): lines=lines[1:]
g=[[int(x) for x in l.split()] for l in lines]
R,C=len(g),len(g[0]); s=${Math.max(8, Math.floor(560 / W))}
img=Image.new('RGB',(C*s,R*s)); px=img.load()
for y in range(R):
    for x in range(C):
        h=pal.get(g[y][x],'#FFFFFF').lstrip('#')
        c=tuple(int(h[i:i+2],16) for i in (0,2,4))
        for dy in range(s):
            for dx in range(s): px[x*s+dx,y*s+dy]=c
img.save('${PNG}')
print('PNG:', '${PNG}')
`;
  const r = spawnSync(py, ['-c', code], { cwd: ROOT, encoding: 'utf8' });
  process.stdout.write(r.stdout || ''); process.stderr.write(r.stderr || '');
}
