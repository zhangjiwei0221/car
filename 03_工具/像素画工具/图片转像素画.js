#!/usr/bin/env node
/**
 * 图片 → 像素画目标图（TXT） / 现有 TXT → 新尺寸
 *
 * 用法：
 *   node 图片转像素画.js <图片或TXT> <列数> <行数> [选项]
 * 选项：
 *   --colors N      最多用几种颜色（默认 12）
 *   --despeckle N   去碎色：4-连通块小于 N 像素的并到邻色（默认 8；0=不处理）
 *   --sample mode|avg  取色方式：mode=主色聚类投票（默认，同一条线的抗锯齿像素会合成一个颜色）；
 *                      avg=旧的整格平均色口径
 *   --protect N     细线保护阈值（默认 0=关；0.3=中；0.2=强）：格内占比≥N 的「对比色」在连续两格以上时保留
 *   --outdir 目录   输出目录（默认当前目录）
 *   --name 名字     输出文件名前缀（默认用输入文件名）
 *   --bin 目录      工程 bin/js 目录（默认取交接包里的快照，用于色表 + 碎色闸门判定）
 *   --lib auto|older|official   【v154】色库（默认 auto）
 *                     older    = 真实毛线 34 色（1-34，0=空位），本工程一直在用
 *                     official = 官方 22 色（游戏真实色号 0-21，-1=空位）→ **取色表换成 22 个真色**，
 *                                产出的色号都是游戏里真有的颜色，可直接上实机
 *                     auto     = 输入是 TXT 就自动认（-1 → 官方；>21 → 老）；图片输入按 older
 *                     ⚠ 选 official 时，官方里没有的颜色（如 34 色的深灰 #010101）会落到最近的官方色，
 *                       画面观感会变 —— 这是"只许用真机色"的必然取舍
 *
 * 产出：
 *   <名字>_<列>x<行>.txt          目标图 TXT（首行"像素矩阵"，空格分隔）
 *                                老色库：0 = 空位；官方色库：-1 = 空位、色号 0-21
 *   <名字>_<列>x<行>_预览.png      像素画预览（放大的方格图）
 *   屏幕报告：输出色库 / 尺寸 / 色数 / 每色格数 / 碎色率（与生成器同一口径）/ 是否过闸
 */
const fs = require('fs'), os = require('os'), path = require('path'), zlib = require('zlib'), vm = require('vm');
const { execFileSync } = require('child_process');

// ---------- 参数 ----------
const argv = process.argv.slice(2);
if (argv.length < 3) { console.log('用法: node 图片转像素画.js <图片或TXT> <列数> <行数> [--colors N] [--despeckle N] [--lib auto|older|official] [--outdir 目录] [--name 名字] [--bin bin/js目录]'); process.exit(1); }
const SRC = argv[0], COLS = +argv[1], ROWS = +argv[2];
function opt(name, dflt) { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : dflt; }
const MAX_COLORS = +opt('colors', 12);
const DESPECKLE = +opt('despeckle', 8);
const SAMPLE = (opt('sample', 'mode') === 'avg') ? 'avg' : 'mode';   // 【2026-10-14】默认改成主色聚类投票
const PROTECT = +opt('protect', 0);                                  // 细线保护（0=关）
// 【v153】取色窗口：格内取中间多大一片投票。默认 0.75 —— AI 放大图/带阴影描边的图，
//   格子四边有一圈抗锯齿与立体倒角，整格投进去会让深色倒角多投票（实测黑块比真值多约 10%、描边变粗一格）。
const INNER = (() => { const v = +opt('inner', 0.75); return v > 0 && v <= 1 ? v : 0.75; })();
const OUTDIR = opt('outdir', '.');
// 【v154】色库：--lib auto|older|official
//   older  = 真实毛线 34 色（1-34，0=空位），本工程一直用的那套
//   official = 官方 22 色（游戏真实色号 0-21，-1=空位），产出直接能上实机
//   auto   = 输入 TXT 自动认；图片输入按 older
//   选了 official：**取色表就换成官方 22 个真色**，所以输出的每个色号都是游戏里真有的颜色，
//   不需要事后再让求解器做一次近似转换。代价：官方里没有的颜色（如 34 色的深灰 #010101）
//   落到最近的官方色，画面观感会变 —— 这是"用真机色"必然的取舍。
const LIBOPT = (function () { const v = String(opt('lib', 'auto')).toLowerCase(); return ['auto', 'older', 'official'].includes(v) ? v : 'auto'; })();
// 找工程里的 bin/js（色表 + 碎色闸门用）：--bin 优先；否则从本文件往上找，
// 这样整个包随便挪目录都不用改脚本。
function findBin() {
  const explicit = opt('bin', null);
  if (explicit) return explicit;
  let dir = __dirname;
  for (let up = 0; up < 5; up++) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch (e) { names = []; }
    for (const n of names) {
      const cands = [path.join(dir, n, 'bin', 'js'), path.join(dir, n, '完整主bin快照_20261012', 'bin', 'js')];
      for (const cd of cands) if (fs.existsSync(path.join(cd, 'utils.js'))) return cd;
    }
    const direct = path.join(dir, 'bin', 'js');
    if (fs.existsSync(path.join(direct, 'utils.js'))) return direct;
    dir = path.dirname(dir);
  }
  return null;
}
const BIN = findBin();
if (!BIN) { console.error('✗ 找不到工程 bin/js（用 --bin <目录> 手动指定）'); process.exit(1); }
console.log('色表/闸门取自：' + BIN);
const NAME = opt('name', path.basename(SRC).replace(/\.[^.]+$/, ''));
const BG = opt('bg', 'auto');   // auto=把贴边的背景色整片转成 0（空位）；none=不处理

// ---------- 极简 PNG 解码（8bit 灰/RGB/调色板/RGBA，非隔行）----------
function decodePNG(file) {
  const buf = fs.readFileSync(file);
  let off = 8, w = 0, h = 0, ct = 0, idat = [], pal = null;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.slice(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'PLTE') pal = data;
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const ch = ct === 2 ? 3 : (ct === 6 ? 4 : (ct === 0 ? 1 : (ct === 3 ? 1 : 2)));
  const stride = w * ch, out = Buffer.alloc(h * stride);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const ft = raw[p++], line = raw.slice(p, p + stride); p += stride;
    const cur = out.slice(y * stride, (y + 1) * stride), prev = y > 0 ? out.slice((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0;
      let v = line[i];
      if (ft === 1) v += a; else if (ft === 2) v += b; else if (ft === 3) v += ((a + b) >> 1);
      else if (ft === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); }
      cur[i] = v & 255;
    }
  }
  function px(x, y) {
    const i = y * stride + x * ch;
    if (ct === 3 && pal) { const k = out[i] * 3; return [pal[k], pal[k + 1], pal[k + 2]]; }
    if (ch === 1) return [out[i], out[i], out[i]];
    return [out[i], out[i + 1], out[i + 2]];
  }
  return { w, h, px };
}
function writePNG(file, w, h, rgb) {
  function crc32(b) { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
    let cr = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) cr = t[(cr ^ b[i]) & 255] ^ (cr >>> 8); return (cr ^ 0xFFFFFFFF) >>> 0; }
  function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const t = Buffer.from(type, 'ascii');
    const cr = Buffer.alloc(4); cr.writeUInt32BE(crc32(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, cr]); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const rows = []; for (let y = 0; y < h; y++) { rows.push(Buffer.from([0])); rows.push(Buffer.from(rgb.slice(y * w * 3, (y + 1) * w * 3))); }
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]));
}
function writeTXT(file, grid) { fs.writeFileSync(file, '像素矩阵\n' + grid.map(r => r.join(' ')).join('\n') + '\n'); }

// ---------- 读工程色表 + 碎色闸门 ----------
const sb = { console, Math, Date, JSON, Int32Array, Uint8Array, Float64Array, Object, Array, String, Number, Boolean, parseInt, parseFloat, isNaN };
sb.window = sb; sb.globalThis = sb;
const ctx = vm.createContext(sb);
['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js', 'generator.js'].forEach(f => {
  const p = path.join(BIN, f); if (fs.existsSync(p)) vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: f });
});
const A = ctx.AntSolver;
const rgbOf = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const cssOf = id => A.getColorCSS(id);

// ---------- 色库模块（可选）----------
// 【v154】这个工具能指向**任意一份工程副本**（--bin 或自动往上找）——实测会命中
//   03_工具/关卡图修改工具/bin/js 那份 v110 的旧副本，它没有 color-libs.js。
//   所以这里必须优雅降级：没有色库模块就退回 A.COLORS（老色库仍然可用），
//   只有用户明确要 official 时才报错并说清怎么解决。
let CL = A.ColorLibs || null;
if (!CL) {
  const clPath = path.join(BIN, 'color-libs.js');
  if (fs.existsSync(clPath)) {
    try { vm.runInContext(fs.readFileSync(clPath, 'utf8'), ctx, { filename: 'color-libs.js' }); CL = ctx.AntSolver.ColorLibs || null; }
    catch (e) { CL = null; }
  }
}
if (!CL) {
  console.log('⚠ 这份工程副本里没有色库模块 color-libs.js（' + BIN + '）——「老色库 34 色」照常可用；');
  console.log('  要用「官方 22 色」请加 --bin 指向带 color-libs.js 的工程（如 完整主bin快照_20261012/bin/js）。');
}

// ---------- 0. 【v154】定"取色表"与"输出色库" ----------
// 工作态约定：**grid 里 0 恒为空位、颜色恒为 1..N 的正整数**（既有算法全部依赖这一点）。
//   older   ：色号就是工程色号 1..34，原样可用。
//   official：色号 = 官方色号 + 1（官方 0..21 → 工作态 1..22）。因为官方 0 是有含义的黄色，
//             而工作态要用 0 表示空位，所以整体 +1；出文件时再减回去（空位写 -1）。
function paletteOf(lib) {
  if (lib === 'official') {
    if (!CL) throw new Error('这份工程副本没有 color-libs.js，取不到官方 22 色。请加 --bin 指向 完整主bin快照_20261012/bin/js');
    return CL.OFFICIAL.colors.map((c, i) => ({ id: i + 1, hex: c.hex, name: c.name }));
  }
  // 老色库：有色库模块就用它（与求解器内置副本同源）；没有就直接用工程的 AntSolver.COLORS
  const src = CL ? CL.OLDER.colors : A.COLORS;
  return src.map((c, i) => (c ? { id: i, hex: c.hex, name: c.name } : null)).filter(Boolean);
}
const PAL_OLDER = paletteOf('older');
let _palOfficial = null;
const PAL_OFFICIAL = () => (_palOfficial || (_palOfficial = paletteOf('official')));   // 懒建：没色库模块时不报错，只有真要用官方才报
// 输入 TXT 是不是官方格式：交给色库模块判（-1 → 官方；>21 → 老；实心图判据不足时回落老）
let inLib = 'older';
const lower0 = SRC.toLowerCase();
if (LIBOPT === 'official') inLib = 'official';
else if (LIBOPT === 'older') inLib = 'older';
else if (lower0.endsWith('.txt')) {
  let raw = null;
  try { raw = CL ? CL.parseTXT(fs.readFileSync(SRC, 'utf8')) : null; } catch (e) { raw = null; }
  if (raw && raw.length && CL) {
    const d = CL.detect(raw);
    inLib = d.lib;
    console.log('输入色库：' + (inLib === 'official' ? '官方 0-21（-1 空位）' : '老色库 34 色（0 空位）') +
      (d.confident ? '' : '【判据不足，实心图】') + ' —— ' + d.reason);
  }
}
const OUTLIB = (LIBOPT === 'auto' || LIBOPT === 'older') ? 'older' : 'official';
let PAL;
try { PAL = (OUTLIB === 'official') ? PAL_OFFICIAL() : PAL_OLDER; }
catch (e) {
  console.error('✗ ' + e.message);
  console.error('  当前色表目录：' + BIN);
  process.exit(1);
}
const ALL_IDS = PAL.map(p => p.id);
const FIRST_ID = ALL_IDS[0];               // 兜底色号（原来是写死的 31，现在跟色库走）
const ID2HEX = new Map(PAL.map(p => [p.id, p.hex]));
const ID2NAME = new Map(PAL.map(p => [p.id, p.name]));
console.log('取色表：' + (OUTLIB === 'official' ? '官方 22 色（色号 0-21，输出 -1 空位）' : '老色库 34 色（色号 1-34，输出 0 空位）') +
  (LIBOPT === 'auto' ? '（auto）' : ''));
// 官方色号 → 工作态色号的换算（懒建，理由同上：没色库模块时不能在这里就炸）
function officialToWork(v) {
  if (!CL) return 0;
  if (v < 0 || v > CL.OFFICIAL_MAX) return 0;
  return v + 1;
}
// 出文件时用：把 grid 写成目标色库的 TXT 文本（官方空位写 -1，老色库写 0）
function gridToTXT(grid) {
  if (OUTLIB !== 'official') return '像素矩阵\n' + grid.map(r => r.join(' ')).join('\n') + '\n';
  return '像素矩阵\n' + grid.map(r => r.map(v => v === 0 ? -1 : v - 1).join(' ')).join('\n') + '\n';
}

// ---------- 1. 取源像素（图片或 TXT）----------
let sw, sh, srcPx;
const lower = SRC.toLowerCase();
if (lower.endsWith('.txt')) {
  // 【v154 修】原来用 /^\s*\d/ 过滤数据行 → **以 -1 开头的行会被整行丢掉**（官方 300 关里 180 关有这种行，
  //   共丢 5276 行），矩阵缺行错位。改成 /^\s*-?\d/，并把编号按输入色库换算进工作态。
  const lines = fs.readFileSync(SRC, 'utf8').trim().split('\n').filter(l => /^\s*-?\d/.test(l));
  const g = lines.map(l => l.trim().split(/\s+/).map(Number));
  sw = g[0].length; sh = g.length;
  srcPx = (x, y) => {
    const v = g[Math.min(y, sh - 1)][Math.min(x, sw - 1)];
    if (v === undefined || v === null) return [255, 255, 255];
    // 输入色库 → 工作态色号（老：原样，0=空；官方：0..21 → 1..22，-1=空）
    let work;
    if (inLib === 'official') work = officialToWork(v);
    else work = v > 0 ? v : 0;
    if (!work) return [255, 255, 255];
    return ID2HEX.has(work) ? rgbOf(ID2HEX.get(work)) : [255, 255, 255];
  };
  console.log('源：TXT 像素画 ' + sw + '×' + sh);
} else {
  let png = SRC;
  if (!/\.png$/i.test(SRC)) {           // jpg/webp/heic… → sips 转 PNG（macOS 自带，无需 PIL）
    png = path.join(os.tmpdir(), 'img2px_' + Date.now() + '.png');
    execFileSync('sips', ['-s', 'format', 'png', SRC, '--out', png], { stdio: 'ignore' });
  }
  const im = decodePNG(png); sw = im.w; sh = im.h; srcPx = im.px;
  console.log('源：图片 ' + sw + '×' + sh);
}

// ---------- 2. 分格取色：主色聚类投票（默认）/ 整格平均（旧口径）----------
//   为什么默认改了：一条单色直线的抗锯齿像素会散落吸附到好几个相近的暗色上，整格平均后每格混到的比例又不同，
//   同一条线会被识别成一节一节的不同色（用户实测）。聚类投票把相近色并成一簇再取最大簇，线就合成一个颜色。
const hexOf = id => ID2HEX.get(id) || null;
const nameOf = id => ID2NAME.get(id) || ('色' + id);
function nearest(colorArr, ids) {
  let best = null, bd = Infinity;
  for (const id of ids) { const q = rgbOf(hexOf(id));
    const d = (q[0] - colorArr[0]) ** 2 + (q[1] - colorArr[1]) ** 2 + (q[2] - colorArr[2]) ** 2;
    if (d < bd) { bd = d; best = id; } }
  return best;
}
const MERGE2 = 9000;            // 聚簇阈值（本文件用的是平方欧氏距离；≈ HTML 版 redmean 阈值 150²的等价量级）
const PROTECT_CONTRAST = 0.25;
const lumOf = (id) => { const c = rgbOf(hexOf(id)); return (0.299*c[0]+0.587*c[1]+0.114*c[2])/255; };
function cellToId(pix) {
  if (!pix.length) return FIRST_ID;
  if (SAMPLE === 'avg') {
    let R = 0, G = 0, B = 0;
    for (const p of pix) { R += p[0]; G += p[1]; B += p[2]; }
    return nearest([Math.round(R/pix.length), Math.round(G/pix.length), Math.round(B/pix.length)], ALL_IDS);
  }
  const byId = new Map();
  for (const p of pix) { const id = nearest(p, ALL_IDS); byId.set(id, (byId.get(id) || 0) + 1); }
  const cl = [];
  [...byId.entries()].sort((a, b) => b[1] - a[1]).forEach(([id, n2]) => {
    const pc = rgbOf(hexOf(id));      // ★簇心用"色表色"，不是像素均值（否则相近色并不到一起）
    let hit = cl.find(x => ((x.rgb[0]-pc[0])**2 + (x.rgb[1]-pc[1])**2 + (x.rgb[2]-pc[2])**2) <= MERGE2);
    if (hit) { const t = hit.n + n2;
      hit.rgb = [(hit.rgb[0]*hit.n + pc[0]*n2)/t, (hit.rgb[1]*hit.n + pc[1]*n2)/t, (hit.rgb[2]*hit.n + pc[2]*n2)/t];
      hit.n = t;
    } else cl.push({ rgb: pc.slice(), n: n2 });
  });
  cl.forEach(x => { x.share = x.n / pix.length; x.rep = nearest([Math.round(x.rgb[0]), Math.round(x.rgb[1]), Math.round(x.rgb[2])], ALL_IDS); });
  cl.sort((a, b) => b.n - a.n);
  let main = cl[0].rep, cand = null, bestDiff = 0;
  if (PROTECT > 0) {
    for (let i = 1; i < cl.length; i++) {
      if (cl[i].share < PROTECT) continue;
      const diff = Math.abs(lumOf(cl[0].rep) - lumOf(cl[i].rep));
      if (diff > bestDiff) { bestDiff = diff; cand = cl[i].rep; }
    }
    if (bestDiff < PROTECT_CONTRAST) cand = null;
  }
  return { main, cand };
}
const info = [];
for (let r = 0; r < ROWS; r++) { const row = [];
  for (let c = 0; c < COLS; c++) {
    const x0 = Math.floor(c * sw / COLS), x1 = Math.max(x0 + 1, Math.floor((c + 1) * sw / COLS));
    const y0 = Math.floor(r * sh / ROWS), y1 = Math.max(y0 + 1, Math.floor((r + 1) * sh / ROWS));
    // 【v153】只看格心那一片（默认 75%），避开四边抗锯齿与立体倒角
    const kit = (1 - INNER) / 2;
    const kx0 = Math.floor(x0 + (x1 - x0) * kit), kx1 = Math.max(kx0 + 1, Math.ceil(x1 - (x1 - x0) * kit));
    const ky0 = Math.floor(y0 + (y1 - y0) * kit), ky1 = Math.max(ky0 + 1, Math.ceil(y1 - (y1 - y0) * kit));
    const pix = [];
    for (let y = ky0; y < ky1; y++) for (let x = kx0; x < kx1; x++) pix.push(srcPx(x, y));
    row.push(cellToId(pix));
  }
  info.push(row);
}

// ---------- 3. 吸附色表 + 限制色数（细线保护要求"相邻格也选中相近的候选色"，连续两格以上才认）----------
const cell = info.map((row, r) => row.map((cellv, c) => {
  if (typeof cellv === 'number') return cellv;                 // avg 口径：已是 id
  if (!cellv.cand) return cellv.main;
  const nb = [[r-1,c],[r+1,c],[r,c-1],[r,c+1]];
  for (const [nr, nc] of nb) {
    const nrow = info[nr]; if (!nrow) continue;
    const nCell = nrow[nc]; if (!nCell || typeof nCell === 'number' || !nCell.cand) continue;
    const a = rgbOf(hexOf(nCell.cand)), b = rgbOf(hexOf(cellv.cand));
    if (nCell.cand === cellv.cand || ((a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2) <= MERGE2) return cellv.cand;
  }
  return cellv.main;
}));
const used = new Map();
for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) { const id = cell[r][c]; used.set(id, (used.get(id) || 0) + 1); }   // 上面取色已直接给出 id
// --colors 超过色表容量时（例如官方色库只有 22 色却写了 30）如实说明，别让用户以为 30 色生效了
const COLOR_CAP = ALL_IDS.length;
if (MAX_COLORS > COLOR_CAP) console.log('提示：--colors ' + MAX_COLORS + ' 超过本色库容量 ' + COLOR_CAP + ' 色，最多只能用 ' + COLOR_CAP + ' 色');
let keep = [...used.entries()].sort((a, b) => b[1] - a[1]).slice(0, Math.min(MAX_COLORS, COLOR_CAP)).map(e => e[0]);
let grid = cell.map(row => row.map(id => keep.includes(id) ? id : nearest(rgbOf(hexOf(id)), keep)));
if (used.size > keep.length) console.log('色数限制：把 ' + used.size + ' 色压到 ' + keep.length + ' 色（用最多的那些）');

// ---------- 4. 去碎色（4-连通小块并到边界最长的邻色）----------
function despeckle(grid, minPx) {
  if (!(minPx > 0)) return grid;
  let changed = true, rounds = 0;
  while (changed && rounds++ < 12) {
    changed = false;
    const lab = grid.map(r => r.map(() => -1));
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (lab[r][c] >= 0 || !grid[r][c]) continue;
      const v = grid[r][c], st = [[r, c]], cells = []; lab[r][c] = 1;
      while (st.length) { const [y, x] = st.pop(); cells.push([y, x]);
        for (const [dy, dx] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ny = y + dy, nx = x + dx;
          if (ny < 0 || ny >= ROWS || nx < 0 || nx >= COLS) continue;
          if (lab[ny][nx] < 0 && grid[ny][nx] === v) { lab[ny][nx] = 1; st.push([ny, nx]); } } }
      if (cells.length < minPx) {
        const border = {};
        for (const [y, x] of cells) for (const [dy, dx] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ny = y + dy, nx = x + dx;
          if (ny < 0 || ny >= ROWS || nx < 0 || nx >= COLS) continue;
          const nv = grid[ny][nx]; if (nv && nv !== v) border[nv] = (border[nv] || 0) + 1;
        }
        const best = Object.keys(border).sort((a, b) => border[b] - border[a])[0];
        if (best) { for (const [y, x] of cells) grid[y][x] = +best; changed = true; }
      }
    }
  }
  return grid;
}
if (DESPECKLE > 0) grid = despeckle(grid, DESPECKLE);

// ---------- 4.5 背景 → 空位(0)：贴边那一色整片挖空 ----------
let bgDug = 0, bgDugId = 0;     // 【v153】如实记下"挖掉了多少格"，供结果提醒
if (BG !== 'none') {
  // 取四边出现最多的颜色当背景色（含四角）
  const tally = {};
  const bump = id => tally[id] = (tally[id] || 0) + 1;
  for (let c = 0; c < COLS; c++) { bump(grid[0][c]); bump(grid[ROWS - 1][c]); }
  for (let r = 0; r < ROWS; r++) { bump(grid[r][0]); bump(grid[r][COLS - 1]); }
  const bgId = +Object.keys(tally).sort((a, b) => tally[b] - tally[a])[0];
  // 从四边 flood-fill：同为 bgId 的连通片 → 0
  const seen = grid.map(r => r.map(() => false));
  const stack = [];
  for (let c = 0; c < COLS; c++) { stack.push([0, c], [ROWS - 1, c]); }
  for (let r = 0; r < ROWS; r++) { stack.push([r, 0], [r, COLS - 1]); }
  let cleared = 0;
  while (stack.length) {
    const [y, x] = stack.pop();
    if (y < 0 || y >= ROWS || x < 0 || x >= COLS) continue;
    if (seen[y][x] || grid[y][x] !== bgId) continue;
    seen[y][x] = true; grid[y][x] = 0; cleared++;
    stack.push([y + 1, x], [y - 1, x], [y, x + 1], [y, x - 1]);
  }
  if (cleared) { bgDug = cleared; bgDugId = bgId;
    console.log('背景识别：贴边那色（' + bgId + ' ' + nameOf(bgId) + '）连通片挖成空位，共 ' + cleared + ' 格'); }
}

// ---------- 4.6 【v153】保真度：与"每格格心 3×3 像素的中位色"逐格比 ----------
//   格心那一点正是"这格看上去是什么色"，避开了上高光/下阴影/四边抗锯齿 → 拿它当参考。
//   这个数就是"识别得好不好"的度量：低了先看背景挖掉多少格，再看源图是不是带渐变/阴影。
let fidelity = null, diffCells = 0;
{
  let same = 0, n = 0;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const cx = Math.round((c + 0.5) * sw / COLS), cy = Math.round((r + 0.5) * sh / ROWS);
    const R = [], G = [], B = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const yy = cy + dy, xx = cx + dx;
      if (yy < 0 || yy >= sh || xx < 0 || xx >= sw) continue;
      const p = srcPx(xx, yy);
      if (p[0] === 255 && p[1] === 255 && p[2] === 255 && lower.endsWith('.txt')) continue;
      R.push(p[0]); G.push(p[1]); B.push(p[2]);
    }
    let refId = 0;
    if (R.length) { R.sort((a, b) => a - b); G.sort((a, b) => a - b); B.sort((a, b) => a - b);
      const m = R.length >> 1; refId = nearest([R[m], G[m], B[m]], ALL_IDS) || FIRST_ID; }
    n++;
    if ((refId === 0) === (grid[r][c] === 0) && (refId === 0 || refId === grid[r][c])) same++; else diffCells++;
  }
  fidelity = n ? same / n : 0;
}

// ---------- 5. 出文件 + 报告 ----------
fs.mkdirSync(OUTDIR, { recursive: true });
const base = NAME + '_' + COLS + 'x' + ROWS;
// 【v154】按目标色库出 TXT：官方把空位写成 -1、色号 = 工作态 - 1；老色库仍 0=空位
fs.writeFileSync(path.join(OUTDIR, base + '.txt'), gridToTXT(grid));
const S = Math.max(6, Math.min(40, Math.floor(900 / Math.max(COLS, ROWS))));
const W = COLS * S, H = ROWS * S, buf = Buffer.alloc(W * H * 3, 245);
for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
  const id = grid[r][c];
  const col = id ? rgbOf(hexOf(id)) : [235, 235, 235];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const px = (r * S + y) * W + (c * S + x);
    const edge = (x === 0 || y === 0);
    const k = edge ? 0.72 : 1;                       // 只压暗格线，便于数格子
    buf[px * 3] = Math.round(col[0] * k); buf[px * 3 + 1] = Math.round(col[1] * k); buf[px * 3 + 2] = Math.round(col[2] * k);
  }
}
writePNG(path.join(OUTDIR, base + '_预览.png'), W, H, buf);

const cnt = {}; grid.forEach(row => row.forEach(v => cnt[v] = (cnt[v] || 0) + 1));
// 报告里显示的颜色编号：官方色库按游戏真实色号（0-21）显示，老色库按 1-34
const showNo = id => (OUTLIB === 'official') ? (id - 1) : id;
console.log('\n产出：' + path.join(OUTDIR, base + '.txt') + '（' + COLS + ' 列 × ' + ROWS + ' 行）');
console.log('       ' + path.join(OUTDIR, base + '_预览.png'));
console.log('输出色库：' + (OUTLIB === 'official'
  ? '官方 22 色（色号 0-21，空位 -1）—— 每个色号都是游戏里真有的颜色，可直接上实机'
  : '老色库 34 色（色号 1-34，空位 0）'));
console.log('保真度：' + (fidelity * 100).toFixed(1) + '%（与「每格格心 3×3 中位色」逐格比，不一致 ' + diffCells + ' 格；取色窗口 格内 ' + Math.round(INNER * 100) + '%）');
if (bgDug) console.log('⚠ 背景挖空吃掉了 ' + bgDug + ' 格（' + (100 * bgDug / (COLS * ROWS)).toFixed(1) + '%，颜色 ' +
  bgDugId + ' ' + nameOf(bgDugId) + '）—— 如果这是美术自带的边框/底色，请加 --bg none 再转一次。');
console.log('每色格数：');
Object.keys(cnt).map(Number).sort((a, b) => b - a).forEach(id => {
  console.log('   ' + (id === 0
    ? String(OUTLIB === 'official' ? '-1' : ' 0').padStart(3) + ' 空位'
    : String(showNo(id)).padStart(3) + ' ' + nameOf(id).padEnd(4) + ' ' + hexOf(id)) + '  ×' + cnt[id]);
});
if (A.Generator && A.Generator.checkFragmentGate) {
  // 闸门只按"色号是否相等"算几何碎色（不看色值），所以工作态编号直接喂进去就是准确口径。
  const g = A.Generator.checkFragmentGate(grid, { fragmentMaxRate: 0.22 });
  console.log('\n碎色闸门（与生成器同一口径，上限 22%）：' + (g.ok ? '✅ 过闸' : '❌ 不过闸') + ' —— ' + g.detail);
  if (!g.ok) console.log('   建议：把 --colors 调小、或 --despeckle 调大（例如 12~20），再跑一次');
}
