#!/usr/bin/env node
'use strict';
/**
 * ComposeMultiSubject_v1 —— 程序化逻辑背景 + 2~3 个 18×18 主体的满格正方形 TXT 合成器（2026-11-25 派工#008）
 *
 * 输入：txt图/图库/主体图纸库XXX/<name>.txt（18×18，0=透明底）
 * 输出：SIZE×SIZE、zeros=0 的目标图；同目录 .preview.txt（背景 / 合成 / 主体掩码 三张字符图）
 *
 * 5 套程序化背景母版：
 *   window_well（井字画框窗格）/ wave_ribbons（正弦海浪彩带）/ stagger_bricks（4×8 错缝砖墙）
 *   seigaiha_arches（青海波同心弧）/ bunting_garland（派对彩旗横幅）
 * 也支持 --bg-file 复用桌面现成背景（自动做「轮廓避撞色」图着色量化，保留纹样几何）。
 *
 * 用法：
 *   node ComposeMultiSubject_v1.js --size 35 --subjects "三角饭团-1,冰淇淋-1,单块披萨-1" \
 *     --layout pin --bg-style window_well --out <输出.txt> [--bg-file <背景.txt>]
 *     [--seed 101] [--save-bg <纯背景.txt>] [--scale auto] [--force]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const LIB = path.join(ROOT, 'txt图/图库');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const has = k => argv.includes(k);

const SIZE = Number(arg('--size', '35'));
const SUBJECTS = String(arg('--subjects', '')).split(',').map(s => s.trim()).filter(Boolean);
const LAYOUT = arg('--layout', 'pin');
const BG_STYLE = arg('--bg-style', 'window_well');
const OUT = arg('--out', null);
const BG_FILE = arg('--bg-file', null);
const SAVE_BG = arg('--save-bg', null);
const SEED = Number(arg('--seed', '101'));
const SCALE_ARG = arg('--scale', 'auto');
const FORCE = has('--force');

// ---------- 34 色库 ----------
const HEX = {
  1: '#FF3240', 2: '#FF269F', 3: '#FF5294', 4: '#DF2455', 5: '#FF98A3', 6: '#F63C3F',
  7: '#A073E7', 8: '#E749B6', 9: '#AD00AC', 10: '#C538C3', 11: '#A032DC', 12: '#C60174',
  13: '#00ACF6', 14: '#00E1EF', 15: '#256A85', 16: '#7074B6', 17: '#6F67DC', 18: '#6B5BBA',
  19: '#95E502', 20: '#01CC64', 21: '#00AEAD', 22: '#04DB01', 23: '#02CBA9', 24: '#018441',
  25: '#FFB900', 26: '#C15701', 27: '#FF9F6A', 28: '#FF8002', 29: '#F69602', 30: '#F9DA00',
  31: '#FDE8D6', 32: '#FFEAB2', 33: '#010101', 34: '#BBB6B7'
};
const rgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const dist = (a, b) => {
  if (!HEX[a] || !HEX[b]) return 0;
  const A = rgb(HEX[a]), B = rgb(HEX[b]);
  return Math.sqrt((A[0] - B[0]) ** 2 + (A[1] - B[1]) ** 2 + (A[2] - B[2]) ** 2);
};
const CH = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXY'; // 34 色 + 0

// ---------- 读写 ----------
function loadMatrix(file) {
  const lines = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
  const body = lines[0].startsWith('像素') ? lines.slice(1) : lines;
  return body.filter(l => l.trim()).map(l => l.trim().split(/\s+/).map(Number));
}
function writeMatrix(file, g) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '像素矩阵\n' + g.map(r => r.join('\t')).join('\n') + '\n');
}
function previewChar(v) { return v === 0 ? '.' : CH[(v - 1) % 34]; }

// ---------- 主体 ----------
function findSubject(name) {
  const dirs = fs.readdirSync(LIB).filter(d => d.startsWith('主体图纸库'));
  for (const d of dirs) {
    const p = path.join(LIB, d, name + '.txt');
    if (fs.existsSync(p)) return p;
  }
  throw new Error('找不到主体: ' + name);
}
function trimGrid(g) {
  let y0 = Infinity, y1 = -1, x0 = Infinity, x1 = -1;
  for (let y = 0; y < g.length; y++) for (let x = 0; x < g[0].length; x++) {
    if (g[y][x] > 0) { y0 = Math.min(y0, y); y1 = Math.max(y1, y); x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
  }
  return g.slice(y0, y1 + 1).map(r => r.slice(x0, x1 + 1));
}
function scaleNN(g, s) {
  const H = Math.round(g.length * s), W = Math.round(g[0].length * s);
  const out = Array.from({ length: H }, () => Array(W).fill(0));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    out[y][x] = g[Math.min(g.length - 1, Math.floor(y / s))][Math.min(g[0].length - 1, Math.floor(x / s))];
  }
  return out;
}
function outlineSet(g) {
  const out = new Set();
  for (let y = 0; y < g.length; y++) for (let x = 0; x < g[0].length; x++) {
    const v = g[y][x]; if (v <= 0) continue;
    let edge = false;
    for (const [dy, dx] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ny = y + dy, nx = x + dx;
      if (ny < 0 || nx < 0 || ny >= g.length || nx >= g[0].length || g[ny][nx] === 0) { edge = true; break; }
    }
    if (edge) out.add(v);
  }
  return out;
}
function colorCounts(g) {
  const c = {};
  for (const row of g) for (const v of row) if (v > 0) c[v] = (c[v] || 0) + 1;
  return c;
}
// 把主体内 < minPx 的非轮廓色并入同主体 RGB 最近色（保持主体像素面积不变）
function mergeSmall(grid, minPx, protect) {
  const cnt = colorCounts(grid);
  const cols = Object.keys(cnt).map(Number).filter(c => cnt[c] < minPx && !protect.has(c));
  for (const c of cols) {
    const cands = Object.keys(cnt).map(Number).filter(o => o !== c && !protect.has(o));
    if (!cands.length) continue;
    cands.sort((a, b) => dist(c, a) - dist(c, b));
    const to = cands[0];
    for (let y = 0; y < grid.length; y++) for (let x = 0; x < grid[0].length; x++) if (grid[y][x] === c) grid[y][x] = to;
  }
  return grid;
}

// ---------- 背景调色板 ----------
const PALETTES = [
  [31, 27, 28, 34],
  [31, 20, 21, 19],
  [31, 5, 3, 17],
  [32, 30, 28, 26],
  [14, 13, 21, 34],
  [8, 10, 12, 31],
  [20, 24, 19, 34],
  [27, 5, 31, 34],
  [5, 2, 31, 17],
  [30, 25, 28, 4],
  [31, 21, 13, 34],
  [34, 16, 17, 31]
];
function paletteSafe(p, outlines) {
  if (new Set(p).size !== p.length) return false;
  for (const c of p) {
    if (outlines.has(c)) return false;
    for (const o of outlines) if (dist(c, o) < 80) return false;
  }
  for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) if (dist(p[i], p[j]) < 45) return false;
  return true;
}
function choosePalette(outlines, n) {
  for (const p of PALETTES) if (p.length >= n && paletteSafe(p.slice(0, n), outlines)) return p.slice(0, n);
  // 兜底：按柔和度贪心
  const pref = [31, 32, 34, 5, 27, 14, 13, 20, 21, 19, 24, 16, 17, 8, 10, 2, 3, 28, 30, 25, 1, 4, 29, 26, 15, 18, 33, 6, 7, 9, 11, 12, 22, 23];
  const out = [];
  for (const c of pref) {
    if (outlines.has(c)) continue;
    if (out.some(o => dist(c, o) < 45)) continue;
    if ([...outlines].some(o => dist(c, o) < 80)) continue;
    out.push(c);
    if (out.length === n) return out;
  }
  throw new Error('找不到与主体轮廓拉开 >=80 的背景色板');
}

// ---------- 5 套背景母版 ----------
function ringPath(S) {
  const p = [];
  for (let x = 0; x < S; x++) p.push([0, x]);
  for (let y = 1; y < S; y++) p.push([y, S - 1]);
  for (let x = S - 2; x >= 0; x--) p.push([S - 1, x]);
  for (let y = S - 2; y >= 1; y--) p.push([y, 0]);
  return p;
}
function bgWindowWell(S, p) {
  const g = Array.from({ length: S }, () => Array(S).fill(p[0]));
  // 2px 分段外框（每 11 格换色，环被颜色切断，避免 264px 大环）
  const ring = ringPath(S);
  for (let i = 0; i < ring.length; i++) {
    const [y, x] = ring[i];
    const col = (Math.floor(i / 11) % 2) ? p[1] : p[2];
    g[y][x] = col;
    const ny = y === 0 ? 1 : y === S - 1 ? S - 2 : y;
    const nx = x === 0 ? 1 : x === S - 1 ? S - 2 : x;
    if (ny !== y) g[ny][x] = col; else if (nx !== x) g[y][nx] = col;
  }
  const y1 = Math.round(S * 0.30), y2 = Math.round(S * 0.72), x1 = Math.round(S * 0.47);
  for (let y = y1; y < y1 + 3; y++) for (let x = 0; x < S; x++) g[y][x] = p[1];
  for (let y = y2; y < y2 + 3; y++) for (let x = 0; x < S; x++) g[y][x] = p[1];
  for (let y = 0; y < S; y++) for (let x = x1; x < x1 + 3; x++) g[y][x] = p[2];
  // 窗格内 4 行浅色横带（每格错位 2 行），保证每列 8~10 次纵向换色
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    if (g[y][x] !== p[0]) continue;
    const pane = y < y1 ? 0 : y < y2 ? 1 : 2;
    const band = Math.floor((y + pane * 2) / 4) % 2;
    if (band === 1) g[y][x] = p[3];
  }
  // 四角 3×3 角花
  for (const [cy, cx] of [[2, 2], [2, S - 5], [S - 5, 2], [S - 5, S - 5]]) {
    for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) {
      const y = cy + dy, x = cx + dx;
      if (g[y][x] === p[0] || g[y][x] === p[3]) g[y][x] = p[2];
    }
  }
  return g;
}
function bgWaveRibbons(S, p) {
  const g = Array.from({ length: S }, () => Array(S).fill(p[0]));
  const cyc = [p[0], p[1], p[2], p[1]];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const phase = Math.round(2 * Math.sin(x * Math.PI / 8));
    const b = Math.floor((y + phase) / 4);
    g[y][x] = cyc[((b % 4) + 4) % 4];
  }
  // 波峰 2×3 高光
  for (let x = 1; x < S - 1; x += 9) {
    const phase = Math.round(2 * Math.sin(x * Math.PI / 8));
    for (let y = 0; y < S; y++) {
      const b = Math.floor((y + phase) / 4);
      if (((b % 4) + 4) % 4 === 1) {
        for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 3; dx++) {
          if (y + dy < S && x + dx < S) g[y + dy][x + dx] = p[3];
        }
      }
    }
  }
  // 3px 竖向「彩带立柱」每 13 列，切断整幅横带（maxComp 从 140 降到 <=110）
  for (const px of [4, 17, 30]) for (let y = 0; y < S; y++) for (let dx = 0; dx < 3; dx++) if (px + dx < S) g[y][px + dx] = p[3];
  return g;
}
function bgStaggerBricks(S, p) {
  const g = Array.from({ length: S }, () => Array(S).fill(p[0]));
  const BH = 5, BW = 8; // 砖高 5px：35/5=7 道勾缝，保证 avgColChanges 不破 16.5 上限
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const row = Math.floor(y / BH);
    const off = (row % 2) ? 4 : 0;
    const bx = Math.floor((x + off) / BW);
    const mortar = (y % BH === 0) || ((x + off) % BW === 0);
    // 勾缝按砖行交替 p0 / p3 两色：把整张勾缝网切成互不相连的 56px 小块（防 176px 大网）
    const mcol = (row % 2) ? p[3] : p[0];
    g[y][x] = mortar ? mcol : [p[1], p[2]][((row + bx) % 2 + 2) % 2];
  }
  return g;
}
function bgSeigaiha(S, p) {
  const centers = [];
  for (let row = -1; row * 5 <= S + 6; row++) {
    const cy = row * 5;
    const off = (row % 2) ? 7 : 0;
    for (let cx = off - 14; cx <= S + 14; cx += 14) centers.push([cx, cy]);
  }
  const g = Array.from({ length: S }, () => Array(S).fill(p[0]));
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let d = 1e9;
    for (const [cx, cy] of centers) {
      const dd = Math.hypot(x - cx, y - cy);
      if (dd < d) d = dd;
    }
    g[y][x] = d < 4 ? p[3] : d < 8 ? p[2] : d < 12 ? p[1] : p[0];
  }
  return g;
}
function bgBunting(S, p) {
  const g = Array.from({ length: S }, () => Array(S).fill(p[0]));
  const hs = [12, 11, 12];
  let y0 = 0;
  hs.forEach((h, si) => {
    const base = (si % 2) ? p[1] : p[0];
    for (let y = y0; y < y0 + h; y++) for (let x = 0; x < S; x++) g[y][x] = base;
    // 段顶 2px 旗绳
    for (let y = y0; y < y0 + 2; y++) for (let x = 0; x < S; x++) g[y][x] = p[2];
    // 倒三角彩旗：宽 6 高 5
    for (let fx = 2; fx + 6 <= S - 2; fx += 8) {
      const col = ((fx / 8 + si) % 2) ? p[2] : p[3];
      for (let dy = 0; dy < 5; dy++) {
        const halfW = Math.floor((6 - dy) / 2);
        for (let dx = 2 - halfW; dx <= 3 + halfW; dx++) {
          const x = fx + dx;
          if (x >= 0 && x < S) g[y0 + 2 + dy][x] = col;
        }
      }
    }
    // 段底 2px 几何花边
    for (let y = y0 + h - 2; y < y0 + h; y++) for (let x = 0; x < S; x++) g[y][x] = (x % 4 < 2) ? p[3] : p[2];
    y0 += h;
  });
  // 3px 竖向立柱（p3）切断整幅横带；与旗绳 p2 / 花边 p2 分色，避免连成 >110px 大块
  for (const px of [10, 22]) for (let y = 0; y < S; y++) for (let dx = 0; dx < 3; dx++) if (px + dx < S) g[y][px + dx] = p[3];
  return g;
}
const BGS = {
  window_well: bgWindowWell,
  wave_ribbons: bgWaveRibbons,
  stagger_bricks: bgStaggerBricks,
  seigaiha_arches: bgSeigaiha,
  bunting_garland: bgBunting
};

// ---------- 外部背景：轮廓避撞色图着色量化 ----------
function externalBg(file, S, outlines, n) {
  const src = loadMatrix(file);
  if (src.length !== S || src[0].length !== S) throw new Error('外部背景必须是 ' + S + '×' + S);
  const cnt = {};
  for (const row of src) for (const v of row) cnt[v] = (cnt[v] || 0) + 1;
  const origCols = Object.keys(cnt).map(Number);
  // 相邻图（4 邻域）
  const adj = new Map(origCols.map(c => [c, new Set()]));
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const a = src[y][x];
    for (const [dy, dx] of [[1, 0], [0, 1]]) {
      const ny = y + dy, nx = x + dx;
      if (ny < S && nx < S) {
        const b = src[ny][nx];
        if (a !== b) { adj.get(a).add(b); adj.get(b).add(a); }
      }
    }
  }
  const pal = choosePalette(outlines, n);
  // 贪心图着色：按总像素从大到小
  const order = origCols.slice().sort((a, b) => cnt[b] - cnt[a]);
  const map = {};
  for (const c of order) {
    const used = new Set([...adj.get(c)].map(o => map[o]).filter(Boolean));
    const pick = pal.find(p => !used.has(p)) || pal.find(p => p !== map[c]);
    map[c] = pick;
  }
  const g = src.map(row => row.map(v => map[v] || pal[0]));
  return { g, map };
}

// ---------- 布局 ----------
function layoutPositions(layout, subjects, S) {
  // subjects: [{g,h,w}]
  const pos = [];
  const place = (i, y, x) => pos.push({ i, y, x });
  if (layout === 'pin' && subjects.length === 3) {
    const S1 = subjects[0], S2 = subjects[1], S3 = subjects[2];
    place(0, S - 1 - S1.h, 1);
    place(1, S - 1 - S2.h, S - 1 - S2.w);
    place(2, 1, Math.floor((S - S3.w) / 2));
  } else if (layout === 'diag' && subjects.length === 2) {
    const S1 = subjects[0], S2 = subjects[1];
    place(0, S - 1 - S1.h, 1);
    place(1, 1, S - 1 - S2.w);
  } else if (layout === 'trio_diag' && subjects.length === 3) {
    const S1 = subjects[0], S2 = subjects[1], S3 = subjects[2];
    place(0, S - 1 - S1.h, 1);
    place(1, Math.floor(S * 0.42), S - 1 - S2.w);
    place(2, 1, 1);
  } else {
    throw new Error('layout 与主体数量不匹配: ' + layout + ' / ' + subjects.length);
  }
  // 夹到画布内
  for (const p of pos) {
    p.y = Math.max(0, Math.min(S - subjects[p.i].h, p.y));
    p.x = Math.max(0, Math.min(S - subjects[p.i].w, p.x));
  }
  return pos;
}
function maskOverlap(subjects, pos) {
  const S = SIZE;
  const occ = Array.from({ length: S }, () => Array(S).fill(false));
  let ov = 0;
  for (const p of pos) {
    const g = subjects[p.i].g;
    for (let y = 0; y < g.length; y++) for (let x = 0; x < g[0].length; x++) {
      if (g[y][x] <= 0) continue;
      const yy = p.y + y, xx = p.x + x;
      if (yy < 0 || xx < 0 || yy >= S || xx >= S) continue;
      if (occ[yy][xx]) ov++; else occ[yy][xx] = true;
    }
  }
  return ov;
}
function shiftSearch(subjects, pos) {
  let best = { pos: pos.map(p => ({ ...p })), ov: maskOverlap(subjects, pos) };
  if (best.ov <= 6) return best;
  for (const d of [1, 2, 3, -1, -2, -3]) {
    for (let k = 0; k < pos.length; k++) {
      const trial = pos.map(p => ({ ...p }));
      trial[k].y += d;
      trial[k].y = Math.max(0, Math.min(SIZE - subjects[trial[k].i].h, trial[k].y));
      const ov = maskOverlap(subjects, trial);
      if (ov < best.ov) best = { pos: trial.map(p => ({ ...p })), ov };
      if (best.ov === 0) return best;
    }
  }
  return best;
}

// ---------- 校验 ----------
function analyze(g, outlines, bgCols) {
  const S = g.length;
  const cnt = colorCounts(g);
  const cols = Object.keys(cnt).map(Number);
  const zeros = g.flat().filter(v => v === 0).length;
  let subjPx = 0;
  let changes = 0;
  for (let x = 0; x < S; x++) for (let y = 0; y < S - 1; y++) if (g[y][x] !== g[y + 1][x]) changes++;
  // 最大连通块
  const seen = g.map(r => r.map(() => false));
  let maxComp = 0, maxColor = 0;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    if (seen[y][x]) continue;
    const col = g[y][x], st = [[y, x]];
    seen[y][x] = true;
    let n = 0;
    while (st.length) {
      const [a, b] = st.pop(); n++;
      for (const [da, db] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const na = a + da, nb = b + db;
        if (na >= 0 && nb >= 0 && na < S && nb < S && !seen[na][nb] && g[na][nb] === col) { seen[na][nb] = true; st.push([na, nb]); }
      }
    }
    if (n > maxComp) { maxComp = n; maxColor = col; }
  }
  let minOutlineDist = Infinity, idClash = [];
  for (const b of bgCols) {
    for (const o of outlines) {
      if (b === o) idClash.push(b);
      minOutlineDist = Math.min(minOutlineDist, dist(b, o));
    }
  }
  return {
    S, zeros, colors: cols.length, cnt, minPx: Math.min(...Object.values(cnt)),
    avgChanges: +(changes / S).toFixed(2), maxComp, maxColor, minOutlineDist: +minOutlineDist.toFixed(1), idClash
  };
}

// ---------- 主流程 ----------
if (!OUT) { console.error('用法见文件头'); process.exit(2); }
if (!SUBJECTS.length) { console.error('--subjects 不能为空'); process.exit(2); }
if (SUBJECTS.length < 2 || SUBJECTS.length > 3) { console.error('--subjects 必须是 2~3 个'); process.exit(2); }

const raw = SUBJECTS.map(n => {
  const f = findSubject(n);
  let g = trimGrid(loadMatrix(f));
  if (g.length > 20 || g[0].length > 20) throw new Error(n + ' 超过 20×20');
  return { name: n, file: f, g };
});

// 2 主体 diag：覆盖不足 38% 时按 1.05 步长放大
let scale = SCALE_ARG === 'auto' ? 1 : Number(SCALE_ARG);
if (SCALE_ARG === 'auto' && LAYOUT === 'diag' && raw.length === 2) {
  const baseCover = raw.reduce((a, s) => a + s.g.flat().filter(v => v > 0).length, 0) / (SIZE * SIZE);
  while (scale < 1.4 && baseCover * scale * scale < 0.385) scale = +(scale + 0.05).toFixed(2);
}
const subs = raw.map((s, i) => {
  const g = scale === 1 ? s.g : scaleNN(s.g, scale);
  return { name: s.name, file: s.file, g, h: g.length, w: g[0].length };
});

// 主体小色合并 + 轮廓
const outlineUnion = new Set();
for (const s of subs) {
  s.outline = outlineSet(s.g);
  for (const o of s.outline) outlineUnion.add(o);
  mergeSmall(s.g, 16, s.outline);
  s.outline = outlineSet(s.g);
}
for (const s of subs) for (const o of s.outline) outlineUnion.add(o);

// 背景
let bg, bgCols, bgMode;
if (BG_FILE) {
  const ext = externalBg(BG_FILE, SIZE, outlineUnion, 6);
  bg = ext.g; bgCols = [...new Set(bg.flat())]; bgMode = 'file:' + path.basename(BG_FILE);
} else {
  const painter = BGS[BG_STYLE];
  if (!painter) throw new Error('未知背景母版: ' + BG_STYLE);
  const pal = choosePalette(outlineUnion, 4);
  bg = painter(SIZE, pal);
  bgCols = pal.slice();
  bgMode = BG_STYLE;
}

// 位置与贴图
let pos = layoutPositions(LAYOUT, subs, SIZE);
const search = shiftSearch(subs, pos);
pos = search.pos;
const g = bg.map(r => r.slice());
const mask = Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
let overlap = 0;
for (const p of pos) {
  const sg = subs[p.i].g;
  for (let y = 0; y < sg.length; y++) for (let x = 0; x < sg[0].length; x++) {
    if (sg[y][x] <= 0) continue;
    const yy = p.y + y, xx = p.x + x;
    if (yy < 0 || xx < 0 || yy >= SIZE || xx >= SIZE) continue;
    if (mask[yy][xx]) overlap++;
    g[yy][xx] = sg[y][x];
    mask[yy][xx] = 1;
  }
}
// 主体覆盖率
const subjPx = mask.flat().reduce((a, b) => a + b, 0);

// 全局调色板压缩：总色数 >16 时，把「最小的非轮廓主体色」并回同主体最近色
function subjectOfColor(c) {
  for (const s of subs) {
    for (const row of s.g) for (const v of row) if (v === c) return s;
  }
  return null;
}
let cnt = colorCounts(g);
let allCols = Object.keys(cnt).map(Number);
let guard = 0;
while (allCols.length > 16 && guard++ < 40) {
  const cands = allCols.filter(c => !outlineUnion.has(c) && !bgCols.includes(c))
    .sort((a, b) => cnt[a] - cnt[b]);
  if (!cands.length) break;
  const src = cands[0];
  const s = subjectOfColor(src);
  if (!s) break;
  const others = Object.keys(colorCounts(s.g)).map(Number).filter(c => c !== src);
  if (!others.length) break;
  others.sort((a, b) => dist(src, a) - dist(src, b));
  const to = others[0];
  for (let y = 0; y < s.g.length; y++) for (let x = 0; x < s.g[0].length; x++) if (s.g[y][x] === src) s.g[y][x] = to;
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (g[y][x] === src) g[y][x] = to;
  cnt = colorCounts(g);
  allCols = Object.keys(cnt).map(Number);
}
// 再把 <16px 的非轮廓色并掉
guard = 0;
while (guard++ < 20) {
  cnt = colorCounts(g);
  const tiny = Object.keys(cnt).map(Number).filter(c => cnt[c] < 16 && !outlineUnion.has(c) && !bgCols.includes(c)).sort((a, b) => cnt[a] - cnt[b]);
  if (!tiny.length) break;
  const src = tiny[0];
  const s = subjectOfColor(src);
  const others = (s ? Object.keys(colorCounts(s.g)).map(Number) : Object.keys(cnt).map(Number))
    .filter(c => c !== src && !bgCols.includes(c));
  if (!others.length) break;
  others.sort((a, b) => dist(src, a) - dist(src, b));
  const to = others[0];
  if (s) { for (let y = 0; y < s.g.length; y++) for (let x = 0; x < s.g[0].length; x++) if (s.g[y][x] === src) s.g[y][x] = to; }
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (g[y][x] === src) g[y][x] = to;
}

// 写出 + 预览
writeMatrix(OUT, g);
if (SAVE_BG) writeMatrix(SAVE_BG, bg);

const stat = analyze(g, outlineUnion, bgCols);
const share = +(subjPx / (SIZE * SIZE)).toFixed(3);
const chk = {
  square: g.length === SIZE && g[0].length === SIZE,
  full: stat.zeros === 0,
  colors: stat.colors >= 10 && stat.colors <= 16,
  minPx: stat.minPx >= 16,
  share: share >= 0.38 && share <= 0.58,
  changes: stat.avgChanges >= 7.5 && stat.avgChanges <= 16.5,
  maxComp: stat.maxComp <= 110,
  outline: stat.minOutlineDist >= 80 && stat.idClash.length === 0
};
const pass = Object.values(chk).every(Boolean);

const lines = [];
lines.push('【纯背景】');
for (const row of bg) lines.push(row.map(previewChar).join(''));
lines.push('【合成图】');
for (const row of g) lines.push(row.map(previewChar).join(''));
lines.push('【主体掩码】');
for (const row of mask) lines.push(row.map(v => v ? '#' : '.').join(''));
lines.push(`# ${SUBJECTS.join(' + ')} | layout=${LAYOUT} | bg=${bgMode} | scale=${scale}`);
lines.push(`# 色数=${stat.colors} 最小色=${stat.minPx}px 主体占比=${(share * 100).toFixed(1)}% avgColChanges=${stat.avgChanges} maxComp=${stat.maxComp}(色${stat.maxColor}) 轮廓最小距离=${stat.minOutlineDist}`);
lines.push(`# 检查: ${JSON.stringify(chk)} => ${pass ? 'PASS' : 'FAIL'}`);
fs.writeFileSync(OUT.replace(/\.txt$/, '') + '.preview.txt', lines.join('\n') + '\n');

console.log(JSON.stringify({
  out: OUT, size: `${SIZE}x${SIZE}`, layout: LAYOUT, bg: bgMode, scale,
  subjects: subs.map(s => ({ name: s.name, box: `${s.h}x${s.w}`, outline: [...s.outline] })),
  colors: stat.colors, minPx: stat.minPx, subjectShare: share,
  avgColChanges: stat.avgChanges, maxComp: stat.maxComp, minOutlineDist: stat.minOutlineDist,
  overlap, checks: chk, pass
}, null, 1));
if (!pass && !FORCE) process.exit(1);
