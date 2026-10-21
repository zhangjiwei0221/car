#!/usr/bin/env node
/**
 * 选图：哪些目标图"藏得深"——能同时做出"活的压力"和"有选择的开局"
 *
 *   node 扫图_深层色.js                       # 扫 输出文件/（历史所有批次，自动去重）
 *   node 扫图_深层色.js <目录或txt> [更多…]   # 扫任意目录/文件
 *   node 扫图_深层色.js --out 结果.csv <目录> # 指定 CSV 路径
 *
 * 只看静态结构，不生成、不写生产目录。
 *
 * 两个判据（口径与 03_工具/源图开局体检 一致，都是引擎自己的函数）：
 *   ① 开局暴露色数（openingExposure）：≥5 = 开局就有分支；≤2 = 前段只能按唯一路线走。
 *   ② 深层色储备（≥3 层才露脸的颜色）：决定切球层能不能做出长期债。
 *
 * 分级（2026-10-18 实测得出，见工作日志 39.3/39.6）：
 *   A 推荐    ≥3 个深层色且深层像素 ≥15%  → 深色图 + 现有生产切法 = 合格 3/4、稳健 100%、被埋 0
 *   B 可用    有深层色但不够多            → 能做短债，压力主要靠障碍；开局若 ≤2 色要一起改图
 *   C 不建议  0 个深层色                  → 切球层造不出长期债；实测同参数下 合格 0/4，且会出"被埋 + 稳健 0%"
 */
'use strict';
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HERE = __dirname;
const BINJS = path.join(HERE, '..', '..', '02_工程', '完整主bin快照_20261012', 'bin', 'js');
const DEFAULT_ROOT = path.join(HERE, '..', '..', '02_工程', '完整主bin快照_20261012', '输出文件');
const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js',
               'playersim.js', 'analysis.js', 'generator.js'];

const sandbox = {
  console: { log() {}, warn() {}, error() {} }, module: { exports: {} },
  WeakMap, Map, Set, setTimeout, clearTimeout, Infinity, Math, JSON
};
vm.createContext(sandbox);
for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BINJS, f), 'utf8'), sandbox, { filename: f });
const A = sandbox.AntSolver;
const G = A.Generator;

// ---------- 参数 ----------
const argv = process.argv.slice(2);
let outCsv = null;
const roots = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--out') { outCsv = path.resolve(argv[++i] || ''); continue; }
  if (a.startsWith('--')) continue;
  roots.push(path.resolve(a));
}
if (!roots.length) roots.push(DEFAULT_ROOT);

// ---------- 收集 TXT 并去重 ----------
function walk(p, out) {
  let st;
  try { st = fs.statSync(p); } catch (e) { return; }
  if (st.isFile()) { if (/\.txt$/i.test(p)) out.push(p); return; }
  let ents;
  try { ents = fs.readdirSync(p, { withFileTypes: true }); } catch (e) { return; }
  for (const e of ents) walk(path.join(p, e.name), out);
}
const all = [];
roots.forEach(r => walk(r, all));
const groups = {};
for (const f of all) {
  let buf;
  try { buf = fs.readFileSync(f); } catch (e) { continue; }
  if (buf.length < 20) continue;
  const h = crypto.createHash('md5').update(buf).digest('hex');
  (groups[h] = groups[h] || { hash: h, files: [], buf }).files.push(f);
}
const uniq = Object.keys(groups).map(h => groups[h]);

// ---------- 逐图分析 ----------
function analyze(g) {
  let blocks;
  try { blocks = G.blocksFromTXT(g.buf.toString('utf8')); } catch (e) { return null; }
  if (!blocks || !blocks.length || !blocks[0].length) return null;
  const R = blocks.length, C = blocks[0].length;
  let P = 0; const colPx = {};
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    const v = blocks[r][c];
    if (v > 0) { P++; colPx[v] = (colPx[v] || 0) + 1; }
  }
  if (!P) return null;
  const parsed = A.parseLevel({ blocks, bufferLimit: 5 });
  let li = null, exp = null;
  try { li = G.veinLayers(parsed, {}); } catch (e) {}
  try { exp = G.openingExposure(blocks, R, C, false); } catch (e) {}
  const colors = Object.keys(colPx).map(Number);
  const minLv = li ? li.colorMinLevel : {};
  const deep = colors.filter(c => (minLv[c] || 0) >= 3);
  const deepPx = deep.reduce((a, c) => a + colPx[c], 0);
  const deepShare = deepPx / P;
  const expColors = exp ? exp.exposedColors : 0;

  let grade, why;
  if (deep.length >= 3 && deepShare >= 0.15) { grade = 'A 深色充足'; why = '能做"层深型"长债'; }
  else if (deep.length >= 1) { grade = 'B 深色不足'; why = '层深型长债少，压力主要靠障碍'; }
  else { grade = 'C 无深层色'; why = '切球层做不出"层深型"长债（不代表关卡不好）'; }
  const note = [];
  if (expColors <= 2) note.push('开局仅 ' + expColors + ' 色（前段唯一路线）');
  if (deep.length >= 3 && deepShare < 0.15) note.push('深层色多但占比低');

  return {
    name: path.basename(g.files[0]),
    path: path.relative(path.join(HERE, '..', '..'), g.files[0]),
    R, C, P, colors: colors.length,
    veins: li ? li.count : null, maxLevel: li ? li.maxLevel : null,
    expColors, deep3: deep.length, deepShare,
    deepList: deep.map(c => c + '号@' + minLv[c] + '层/' + colPx[c] + 'px').join(' '),
    nFiles: g.files.length, grade, why, note: note.join('；')
  };
}

const rows = [];
for (const g of uniq) {
  try { const r = analyze(g); if (r) rows.push(r); } catch (e) { /* 跳过坏文件 */ }
}
rows.sort((a, b) => (a.grade > b.grade ? 1 : a.grade < b.grade ? -1 : 0) ||
  (b.deep3 - a.deep3) || (b.deepShare - a.deepShare) || (b.P - a.P));

// ---------- CSV ----------
const cols = ['grade', 'why', 'note', 'name', 'R', 'C', 'P', 'colors', 'veins', 'maxLevel',
  'expColors', 'deep3', 'deepShare', 'nFiles', 'path', 'deepList'];
const csv = [cols.join(',')].concat(rows.map(r => cols.map(k => {
  let v = r[k];
  if (k === 'deepShare') v = (v * 100).toFixed(1) + '%';
  if (typeof v === 'string' && /[,"\n]/.test(v)) v = '"' + v.replace(/"/g, '""') + '"';
  return v == null ? '' : v;
}).join(','))).join('\n');
const csvPath = outCsv || path.join(HERE, '选图_深层色.csv');
fs.writeFileSync(csvPath, '\uFEFF' + csv, 'utf8');

// ---------- 控制台 ----------
const cnt = { 'A 深色充足': 0, 'B 深色不足': 0, 'C 无深层色': 0 };
rows.forEach(r => cnt[r.grade]++);
console.log('扫描 ' + roots.map(r => path.relative(path.join(HERE, '..', '..'), r) || r).join(' + '));
console.log('唯一目标图 ' + rows.length + ' 张（来自 ' + all.length + ' 个 txt 文件）');
console.log('分级：A 深色充足 ' + cnt['A 深色充足'] + ' ／ B 深色不足 ' + cnt['B 深色不足'] + ' ／ C 无深层色 ' + cnt['C 无深层色'] + '\n'
  + '⚠ 这个判据只覆盖"层深型"长债：用户认可的小鹿（蚂蚁关卡_1791972704634）是 C 级 —— 它的长债来自"容量"，不是层深。\n'
  + '  所以它只用来【分方向、排优先级】，不做一票否决。\n');

const pad = (s, n) => { s = String(s); return s + ' '.repeat(Math.max(0, n - [...s].reduce((a, ch) => a + (ch.charCodeAt(0) > 255 ? 2 : 1), 0))); };
console.log(pad('分级', 10) + pad('开局色', 7) + pad('深层色', 7) + pad('深层%', 7) + pad('尺寸', 9) + pad('像素', 7) + '图');
rows.slice(0, 30).forEach(r => {
  console.log(pad(r.grade, 10) + pad(r.expColors, 7) + pad(r.deep3, 7) + pad((r.deepShare * 100).toFixed(1) + '%', 7) +
    pad(r.R + 'x' + r.C, 9) + pad(r.P, 7) + r.name + (r.note ? '  ← ' + r.note : ''));
});

const rec = rows.filter(r => r.grade === 'A 深色充足');
const bad = rows.filter(r => r.grade === 'C 无深层色');
if (rec.length) {
  console.log('\n✅ 想先产"有活压力"的关，优先这批（A 级）：');
  rec.slice(0, 10).forEach(r => console.log('   ' + r.name + '  → ' + r.deepList));
}
if (bad.length) {
  console.log('\n⛔ 这批没有"层深型"长债（C 级，压力只能靠障碍；但不等于关卡不好）：');
  bad.slice(0, 10).forEach(r => console.log('   ' + r.name));
}
console.log('\n实测（2026-10-18，方案_小图33-40四方向_v1.json，各 4 seed）：');
console.log('   A 级图（33x35，深色 7 个）：合格 3/4，峰窗 3.5~4，稳健 100%，被埋 0；');
console.log('   C 级图（40x40，深色 0 个）：合格 0/4，其中一局 被埋 2 辆 + 稳健 0%。');
console.log('\nCSV: ' + csvPath);
