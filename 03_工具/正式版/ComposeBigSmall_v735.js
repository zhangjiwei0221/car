// ComposeBigSmall_v735.js —— “一大主体 + 三个小主体”布局（硬引导的前提）
// 用法：node ComposeBigSmall_v735.js --config cfg.json --out 目标图.txt [--png 预览.png]
// config: { size, bg:[c1,c2], border:[上,右,下,左], entryRing: 12, subjects:[{file,x,y,w,h,outline,src}] }
'use strict';
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.resolve(__dirname, '../..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const CFG = arg('--config'), OUT = arg('--out'), PNG = arg('--png');
const cfg = JSON.parse(fs.readFileSync(CFG, 'utf8'));
const MAXC = Number(arg('--max-colors', 15));
const PROTECT = new Set(String(arg('--outlines', '')).split(',').map(Number).filter(n => n > 0));
const SUBCOLORS = String(arg('--subject-colors', '')).split(',').map(Number).filter(n => n > 0);   // 每个主体内部保留几色（空=不改）
const MIN_SHARE = Number(arg('--min-color-share', 0));   // 全局：占比低于此值的颜色并入最近色（保护描边）
const CLEAN_INTERIOR = !process.argv.includes('--no-clean');
if (cfg.outlines) cfg.outlines.forEach(c => PROTECT.add(c));

function loadG(p) {
  const lines = fs.readFileSync(p, 'utf8').split('\n').map(l => l.trim()).filter(Boolean);
  const body = lines[0].startsWith('像素') ? lines.slice(1) : lines;
  return body.map(l => l.split(/\s+/).map(Number));
}
const W = cfg.size || 44;
const bg = cfg.bg || [31, 1];
const canvas = Array.from({ length: W }, (_, y) => Array.from({ length: W }, (_, x) => bg[((y >> 1) + (x >> 1)) % bg.length]));

function cropQuad(g, q) {
  if (!q || q === 'full') return g;
  const R0 = g.length, C0 = g[0].length, hr = Math.floor(R0 / 2), hc = Math.floor(C0 / 2);
  if (q === 'TL') return g.slice(0, hr).map(r => r.slice(0, hc));
  if (q === 'TR') return g.slice(0, hr).map(r => r.slice(hc));
  if (q === 'BL') return g.slice(hr).map(r => r.slice(0, hc));
  if (q === 'BR') return g.slice(hr).map(r => r.slice(hc));
  return g;
}
for (const s of cfg.subjects) {
  const g = cropQuad(loadG(path.join(ROOT, s.file)), s.quad);
  const { x, y, w, h, outline } = s;
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
    const sy = Math.min(g.length - 1, Math.floor(yy * g.length / h));
    const sx = Math.min(g[0].length - 1, Math.floor(xx * g[0].length / w));
    canvas[y + yy][x + xx] = g[sy][sx];
  }
  // L1 描边
  for (let t = 0; t < w; t++) { canvas[y][x + t] = outline; canvas[y + h - 1][x + t] = outline; }
  for (let t = 0; t < h; t++) { canvas[y + t][x] = outline; canvas[y + t][x + w - 1] = outline; }
}

// 每个主体的内部量化：只保留它自己最常用的 K 色，其余按最近色并入
if (SUBCOLORS.length) {
  const pal0 = (() => {
    const src = fs.readFileSync(path.join(ROOT, '02_工程/完整主bin快照_20261012/bin/js/utils.js'), 'utf8');
    const m2 = {}; const re = /\{\s*name:\s*'([^']+)',\s*hex:\s*'#([0-9A-Fa-f]{6})'\s*\}\s*,\s*\/\/\s*(\d+)/g;
    let mm; while ((mm = re.exec(src))) m2[+mm[3]] = mm[2];
    return m2;
  })();
  const rgbOf = (c) => { const h = pal0[c] || 'FFFFFF'; return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; };
  cfg.subjects.forEach((s2, idx) => {
    const K = SUBCOLORS[idx] || SUBCOLORS[SUBCOLORS.length - 1] || 3;
    const cnt = {};
    for (let yy = 1; yy < s2.h - 1; yy++) for (let xx = 1; xx < s2.w - 1; xx++) {
      const v = canvas[s2.y + yy][s2.x + xx];
      if (v === s2.outline || PROTECT.has(v)) continue;
      cnt[v] = (cnt[v] || 0) + 1;
    }
    const keep = Object.keys(cnt).map(Number).sort((a, b) => cnt[b] - cnt[a]).slice(0, K);
    if (!keep.length) return;
    let changed = 0;
    for (let yy = 1; yy < s2.h - 1; yy++) for (let xx = 1; xx < s2.w - 1; xx++) {
      const v = canvas[s2.y + yy][s2.x + xx];
      if (v === s2.outline || PROTECT.has(v) || keep.includes(v)) continue;
      let best = keep[0], bd = 1e9;
      for (const k of keep) { const A = rgbOf(v), B = rgbOf(k); const d = Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]); if (d < bd) { bd = d; best = k; } }
      canvas[s2.y + yy][s2.x + xx] = best; changed++;
    }
    console.log(`主体#${idx + 1} 内部量化到 ${K} 色（保留 ${keep.join('/')}），改动 ${changed} 格`);
  });
}

// 主体内部的“描边色污染”清理：若内部出现别人的描边色，改成该主体最常见的非描边色
if (CLEAN_INTERIOR) for (const s2 of cfg.subjects) {
  const cnt = {};
  for (let yy = 1; yy < s2.h - 1; yy++) for (let xx = 1; xx < s2.w - 1; xx++) {
    const v = canvas[s2.y + yy][s2.x + xx];
    if (!PROTECT.has(v)) cnt[v] = (cnt[v] || 0) + 1;
  }
  const safe = Object.keys(cnt).map(Number).sort((a, b) => cnt[b] - cnt[a])[0];
  if (!safe) continue;
  let fixed = 0;
  for (let yy = 1; yy < s2.h - 1; yy++) for (let xx = 1; xx < s2.w - 1; xx++) {
    const v = canvas[s2.y + yy][s2.x + xx];
    if (PROTECT.has(v) && v !== s2.outline) { canvas[s2.y + yy][s2.x + xx] = safe; fixed++; }
  }
  if (fixed) console.log(`主体(${s2.x},${s2.y}) 内部清理 ${fixed} 格描边色 → ${safe}`);
}

// L3：最外 1px 四段
if (cfg.border) {
  const b = cfg.border;
  for (let x = 0; x < W; x++) { canvas[0][x] = b[0]; canvas[W - 1][x] = b[2]; }
  for (let y = 0; y < W; y++) { canvas[y][0] = b[3]; canvas[y][W - 1] = b[1]; }
}
// 入口环：把最外 k 圈刷成入口色（可选）
if (cfg.entryRing) {
  const k = cfg.ring || 1;
  for (let d = 0; d < k; d++) {
    for (let x = d; x < W - d; x++) { canvas[d][x] = cfg.entryRing; canvas[W - 1 - d][x] = cfg.entryRing; }
    for (let y = d; y < W - d; y++) { canvas[y][d] = cfg.entryRing; canvas[y][W - 1 - d] = cfg.entryRing; }
  }
}

// 色数收敛：超过上限时，把用量最少的颜色并到最近的保留色
function loadPalette() {
  const src = fs.readFileSync(path.join(ROOT, '02_工程/完整主bin快照_20261012/bin/js/utils.js'), 'utf8');
  const pal = {}; const re = /\{\s*name:\s*'([^']+)',\s*hex:\s*'#([0-9A-Fa-f]{6})'\s*\}\s*,\s*\/\/\s*(\d+)/g;
  let m; while ((m = re.exec(src))) pal[+m[3]] = m[2];
  return pal;
}
let stat = {};
for (const row of canvas) for (const v of row) stat[v] = (stat[v] || 0) + 1;
let colors = Object.keys(stat).map(Number).sort((a, b) => stat[b] - stat[a]);
// 全局：把占比过低的颜色并入最近色（保护描边），尽量少破坏主体结构
if (MIN_SHARE > 0) {
  const pal = loadPalette();
  const rgb = (c) => { const h = pal[c] || 'FFFFFF'; return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; };
  const total = W * W;
  const big = colors.filter(c => PROTECT.has(c) || stat[c] / total >= MIN_SHARE / 100);
  const bigSet = new Set(big);
  let merged = 0;
  for (const c of colors) {
    if (bigSet.has(c)) continue;
    let best = big[0], bd = 1e9;
    for (const k of big) { const A = rgb(c), B = rgb(k); const d = Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]); if (d < bd) { bd = d; best = k; } }
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) if (canvas[y][x] === c) canvas[y][x] = best;
    merged++;
  }
  stat = {}; for (const row of canvas) for (const v of row) stat[v] = (stat[v] || 0) + 1;
  colors = Object.keys(stat).map(Number).sort((a, b) => stat[b] - stat[a]);
  console.log(`按占比合并 ${merged} 个稀有颜色（阈值 ${MIN_SHARE}%）→ ${colors.length} 色`);
}

if (colors.length > MAXC) {
  const pal = loadPalette();
  const rgb = (c) => { const h = pal[c] || 'FFFFFF'; return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; };
  // 受保护色（四个描边 + 入口环）永远保留，且不作为合并目标（保持纯净）
  const prot = colors.filter(c => PROTECT.has(c));
  const rest = colors.filter(c => !PROTECT.has(c));
  const keep = new Set(prot.concat(rest.slice(0, Math.max(0, MAXC - prot.length))));
  const map = {};
  for (const c of colors) {
    if (keep.has(c)) { map[c] = c; continue; }
    let best = null, bd = 1e9;
    for (const k of keep) {
      if (PROTECT.has(k)) continue;              // 不许并进受保护色
      const A = rgb(c), B = rgb(k); const d = Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
      if (d < bd) { bd = d; best = k; }
    }
    if (best === null) best = [...keep][0];
    map[c] = best;
  }
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) canvas[y][x] = map[canvas[y][x]];
  stat = {};
  for (const row of canvas) for (const v of row) stat[v] = (stat[v] || 0) + 1;
  colors = Object.keys(stat).map(Number).sort((a, b) => stat[b] - stat[a]);
  console.log(`色数超限，已按最近色合并 → ${colors.length}（受保护色 ${[...PROTECT].filter(c=>stat[c]).join(',')} 保留）`);
}
console.log(`画布 ${W}×${W} = ${W * W}px，色数 ${colors.length}`);
console.log('分布：', colors.map(c => `${c}:${stat[c]}(${Math.round(stat[c] / (W * W) * 100)}%)`).join(' '));

fs.writeFileSync(OUT, '像素矩阵\n' + canvas.map(r => r.join(' ')).join('\n') + '\n');
console.log('已写出：' + OUT);

if (PNG) {
  const py = process.env.PY || '/Users/red/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/python/bin/python3';
  const code = `
import re
from PIL import Image
pal={}
src=open('02_工程/完整主bin快照_20261012/bin/js/utils.js').read()
for mm in re.finditer(r"{ name: '([^']+)',\\s+hex: '#([0-9A-Fa-f]{6})' \\}\\s*,\\s*// (\\d+)", src):
    pal[int(mm.group(3))]=mm.group(2)
lines=[l for l in open('${OUT}').read().strip().splitlines() if l.strip()]
if lines[0].startswith('像素'): lines=lines[1:]
g=[[int(x) for x in l.split()] for l in lines]
R,C=len(g),len(g[0]); s=${Math.max(6, Math.floor(560 / W))}
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
