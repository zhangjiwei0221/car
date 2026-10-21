#!/usr/bin/env node
/**
 * 源图「开局体检」—— 一眼看出这张目标图**开局露出几种颜色**，也就是"能不能出有选择的关"。
 *
 * 为什么看这一项（2026-10-15 v153 实测，见 01_交接文档/工作日志_20261012.md 第十七节）：
 *   玩家每一步的可选项 = 【棋盘顶行的车】(第 0 行恒可取) ∩ 【目标图上当前暴露的颜色】。
 *   一辆车只有在"它自己颜色的暴露像素 ≥ 这辆车的容量"时才吃得满，而暴露 = 贴图边 或 邻接外部背景
 *   —— 也就是【从画的外圈往里剥】。所以剪影被单一颜色包住的图，开局几乎只能按唯一路线走。
 *
 * 第二项（2026-10-18 加）：**深层色储备** —— 一个颜色最浅出现在第几层（依赖层）。
 *   第 0~1 层就露脸的颜色，无论怎么排都只能做出"差几个像素"的短债；
 *   只有"≥3 层才露脸"的颜色能承载"车比货早到很久"的长期债。
 *   实测：40x40拼接图纸_016（深层色 0 个）压力旋钮拧到 5 档，峰值卡在 2；
 *        目标图_33x35_老色库34色（深层色 7 个），旋钮 1→5 档 → 峰值 1→5 逐档跟随。
 *
 * 实测基准：
 *   · 蚂蚁关卡_1791949636679.txt（596 像素 / 5 色）：开局暴露 **1 色** → 开局选项恒 1~2，调参改不了。
 *   · 004_55像素_004_12种（用户评价"有灵气"那关）：开局暴露 **8 色** → 开局能吃满 6 个选项。
 *
 * 口径与生成器运行时【同一个函数】（Generator.openingExposure → exposedBlobByColor），不另写一套。
 *
 * 用法：
 *   node 开局体检.js <目标图.txt | 关卡json> [更多文件…]
 *   或把文件拖到 开局体检.command 上。
 */
const fs = require('fs'), path = require('path'), vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '完整主bin快照_20261012', 'bin');

function loadGenerator() {
  const sb = { console, Math, Date, JSON, Object, Array, String, Number, isNaN, parseInt, parseFloat, Set, Map, WeakMap, setTimeout, clearTimeout };
  sb.global = sb; vm.createContext(sb);
  for (const m of ['utils.js', 'simulator.js', 'anchor-cut.js', 'solver-strategy.js', 'solver.js', 'playersim.js', 'analysis.js', 'generator.js']) {
    const f = path.join(BIN, 'js', m);
    if (!fs.existsSync(f)) {
      console.error('找不到工程文件：' + f + '\n（这个脚本要放在交接包里的 03_工具/源图开局体检/ 下运行）');
      process.exit(2);
    }
    vm.runInContext(fs.readFileSync(f, 'utf8'), sb, { filename: m });
  }
  return sb.AntSolver;
}

function readBlocks(A, file) {
  const txt = fs.readFileSync(file, 'utf8');
  if (/\.json$/i.test(file)) {
    const j = JSON.parse(txt);
    if (j.blocks) return { blocks: j.blocks, note: '关卡 json 的 blocks' };
    throw new Error('这个 json 里没有 blocks（要目标图像素矩阵）');
  }
  return { blocks: A.Generator.blocksFromTXT(txt), note: '目标图 txt' };
}

/** 每色暴露像素 + 每个颜色"开局一口气能吃掉几辆车"都没法在这里算（要容量），所以只报暴露面。 */
function report(A, file) {
  const { blocks, note } = readBlocks(A, file);
  if (!blocks || !blocks.length) { console.log('  ✗ 读不出像素矩阵'); return null; }
  const R = blocks.length, C = blocks[0].length;
  const exp = A.Generator.openingExposure(blocks, R, C, false);
  let pix = 0, colors = 0; const seen = {}, colPx = {};
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    const v = blocks[r][c];
    if (v > 0) { pix++; colPx[v] = (colPx[v] || 0) + 1; if (!seen[v]) { seen[v] = 1; colors++; } }
  }
  // 依赖层（同色连通块 + 洋葱分层）——与生成器同一个函数 veinLayers
  let li = null;
  try { li = A.Generator.veinLayers(A.parseLevel({ blocks, bufferLimit: 5 }), {}); } catch (e) { li = null; }
  const colorsArr = Object.keys(colPx).map(Number);
  const deep = li ? colorsArr.filter(c => (li.colorMinLevel[c] || 0) >= 3)
    .sort((a, b) => (li.colorMinLevel[a] - li.colorMinLevel[b]) || (colPx[b] - colPx[a])) : [];
  const deepPx = deep.reduce((a, c) => a + colPx[c], 0);
  const deepShare = pix ? deepPx / pix : 0;

  console.log('\n━━ ' + path.basename(file) + '  （' + note + '）');
  console.log('   画布 ' + R + '×' + C + ' ｜ 彩色像素 ' + pix + ' ｜ 颜色 ' + colors + ' 种');
  if (li) console.log('   依赖层：最深 ' + li.maxLevel + ' 层 ｜ 同色连通块 ' + li.count + ' 个' + (li.unreached ? '（' + li.unreached + ' 块不可达）' : ''));
  console.log('   开局暴露的颜色：' + (exp && exp.detail.length
    ? exp.detail.map(d => d.color + ' 号色 ' + d.px + ' 像素').join('，')
    : '（无）'));
  const n = exp ? exp.exposedColors : 0;
  if (n >= 5) console.log('   ✅ 开局暴露 ' + n + ' 色 —— 开局就有分支，可以做"有选择"的关');
  else if (n >= 3) console.log('   ⚠️ 开局暴露 ' + n + ' 色 —— 勉强，开局选项大概率只有 1~3 个');
  else console.log('   ❌ 开局暴露 ' + n + ' 色 —— 前段几乎只能按唯一路线走（调障碍/棋盘/容差都改不了）');

  console.log('   深层色（≥3 层才露脸）：' + (deep.length
    ? deep.length + ' 个 · 深层像素 ' + (deepShare * 100).toFixed(1) + '% —— '
      + deep.slice(0, 6).map(c => c + '号@' + li.colorMinLevel[c] + '层/' + colPx[c] + 'px').join('，')
      + (deep.length > 6 ? ' …' : '')
    : '0 个 · 0%'));
  if (deep.length >= 3 && deepShare >= 0.15) console.log('   ✅ 深色储备够 —— 切球层能做长期债（车比货早到很久），压力不必靠墙');
  else if (deep.length >= 1) console.log('   ⚠️ 深色储备偏少 —— 只能做短债，峰窗大概到 2~3 就饱和');
  else console.log('   ❌ 没有"层深型"长债素材 —— 压力只能靠障碍（墙/冰/链）。注意：这不等于关卡不好（用户认可的小鹿就是这一类，它的长债来自容量）');

  return { file: path.basename(file), R, C, pix, colors, expColors: n, expPix: exp ? exp.exposedPixels : 0,
    maxLevel: li ? li.maxLevel : null, veins: li ? li.count : null, deep: deep.length, deepShare };
}

const files = process.argv.slice(2).filter(f => f && !f.startsWith('-'));
if (!files.length) {
  console.log('用法：node 开局体检.js <目标图.txt | 关卡json> [更多文件…]');
  console.log('     （或把文件拖到 开局体检.command 上）');
  process.exit(1);
}
const A = loadGenerator();
console.log('源图「开局体检」—— 开局露出几种颜色 = 这张图能不能出有选择的关（口径：贴图边 或 邻接外部背景）');
const rows = [];
for (const f of files) {
  try { const r = report(A, f); if (r) rows.push(r); }
  catch (e) { console.log('\n━━ ' + path.basename(f) + '\n   ✗ ' + e.message); }
}
if (rows.length > 1) {
  console.log('\n── 汇总（按开局暴露色数降序）');
  rows.sort((a, b) => b.expColors - a.expColors);
  for (const r of rows) console.log('   ' + String(r.expColors).padStart(2) + ' 色暴露 ｜ 深色 ' +
    String(r.deep).padStart(2) + ' 个(' + (r.deepShare * 100).toFixed(1).padStart(4) + '%) ｜ ' +
    String(r.colors).padStart(2) + ' 色 · ' + String(r.pix).padStart(5) + ' 像素 · ' + r.R + '×' + r.C + '   ' + r.file);
}
console.log('\n提示①：想让开局有分支，就让内层颜色"探出外圈"—— 在轮廓上开口、或把外框拆成几段不同颜色。');
console.log('提示②：想让中后期能做长期压力，就留几个颜色"藏深"（≥3 层才露脸）—— 它们才是"车比货早到"的素材。');
console.log('      贴到图边的色块天然算暴露（BUS 那几张 16×13 的图就是这么拿到 8 色的）。');
