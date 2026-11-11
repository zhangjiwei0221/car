#!/usr/bin/env node
'use strict';
/**
 * LevelsToTxt_v1 —— 把关卡 JSON 的 blocks 还原成目标图 TXT
 *
 * 用途：桌面上只有关卡 JSON、没有原始 TXT 时，先把目标图抽出来，
 *      再交给 ImageDebtScan / JointSearch 等 v3 工具。
 *
 * 用法：
 *   node LevelsToTxt_v1.js <关卡.json | 目录> --out <txt目录> [--limit N] [--numeric]
 *
 * 输出：
 *   <out>/<关卡名>.txt      像素矩阵 + 空格分隔的 blocks
 *   --numeric：用关卡名末尾的数字当文件名（G8_bq_level_43 → 43.txt）
 *   <out>/manifest.json     每个 txt 的尺寸、颜色数、总像素、old→new 映射
 */
const fs = require('fs');
const path = require('path');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const input = process.argv[2];
const outDir = arg('--out', null);
const limit = Number(arg('--limit', 0)) || 0;
const numeric = process.argv.includes('--numeric');
if (!input || !outDir) {
  console.error('用法: node LevelsToTxt_v1.js <关卡.json | 目录> --out <txt目录> [--limit N]');
  process.exit(2);
}

function collect(p) {
  const st = fs.statSync(p);
  if (st.isFile()) return [p];
  return fs.readdirSync(p).filter(f => f.endsWith('.json')).sort().map(f => path.join(p, f));
}
function isLevel(g) { return !!(g && Array.isArray(g.blocks) && g.blocks.length && Array.isArray(g.spools)); }
function colorCount(blocks) {
  const s = new Set();
  for (const row of blocks) for (const v of row) if (v > 0) s.add(v);
  return s.size;
}
function toTxt(blocks) {
  return '像素矩阵\n' + blocks.map(row => row.map(v => (v > 0 ? v : 0)).join(' ')).join('\n') + '\n';
}

fs.mkdirSync(outDir, { recursive: true });
const files = collect(input).slice(0, limit || undefined);
const manifest = [];
let ok = 0, skipped = 0;
const usedNames = new Set();
for (const file of files) {
  let g;
  try { g = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { skipped++; continue; }
  if (!isLevel(g)) { skipped++; continue; }
  const h = g.blocks.length, w = g.blocks[0].length;
  if (!h || !w) { skipped++; continue; }
  const base = path.basename(file, '.json');
  const num = (base.match(/(\d+)$/) || [])[1];
  let stem = numeric && num ? num : base;
  let n = 2;
  while (usedNames.has(stem + '.txt')) stem = (numeric && num ? num : base) + '_' + (n++);
  const txtName = stem + '.txt';
  usedNames.add(txtName);
  const txt = path.join(outDir, txtName);
  fs.writeFileSync(txt, toTxt(g.blocks));
  manifest.push({
    level: base,
    source: file,
    txt: txtName,
    originalTxt: base + '.txt',
    size: h + 'x' + w,
    totalPx: h * w,
    colorCount: colorCount(g.blocks),
    toprow: g.toprow || null
  });
  ok++;
}
fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify({
  tool: 'LevelsToTxt_v1',
  input,
  outDir,
  count: ok,
  skipped,
  levels: manifest
}, null, 2));
console.log(`已写 ${ok} 个 TXT 到 ${outDir}（跳过 ${skipped} 个非关卡）`);
