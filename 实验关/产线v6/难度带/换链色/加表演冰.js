#!/usr/bin/env node
'use strict';
/**
 * 换链色实验 · 给 C2（换链色去冰）加回原 final 的 2 块表演冰 → C1（换链色）。
 * 冰格与 param 与 试造_140/关卡_ZC_140_final.json 完全一致：
 *   (5,4) 色14 type7 param31、(6,3) 色7 type7 param33。
 * 自检：只有这两格变化；目标图/尺寸/逐色容量不变；与 final 的差异只在 4 个链格。
 * 只读输入，写新目录，不改任何现有文件。
 */
const fs = require('fs');
const path = require('path');
const D = __dirname;
const SRC = path.join(D, '关卡_ZC_140_C2_换链色去冰.json');
const FIN = path.join(D, '关卡_ZC_140_C4_原链.json');
const OUT = path.join(D, '关卡_ZC_140_C1_换链色.json');
const ICE = [[5, 4, 31], [6, 3, 33]];

const clone = (o) => JSON.parse(JSON.stringify(o));
const before = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const fin = JSON.parse(fs.readFileSync(FIN, 'utf8'));
const after = clone(before);
function fail(m) { console.error('FAIL: ' + m); process.exit(1); }

for (const [r, c, param] of ICE) {
  const cell = after.spools[r][c];
  if (!cell || !(cell.id > 0) || !(cell.count > 0)) fail(`(${r},${c}) 不是车`);
  const ts = Array.isArray(cell.type) ? cell.type : (cell.type === 0 || cell.type == null ? [] : [cell.type]);
  if (ts.length) fail(`(${r},${c}) 已有障碍 ${JSON.stringify(cell.type)}`);
  cell.type = 7; cell.param = param;
}

const diffs = [];
for (let r = 0; r < after.spools.length; r++) for (let c = 0; c < after.spools[0].length; c++) {
  if (JSON.stringify(before.spools[r][c]) !== JSON.stringify(after.spools[r][c])) diffs.push(`${r},${c}`);
}
const expect = ICE.map(x => `${x[0]},${x[1]}`).sort().join('|');
if (diffs.sort().join('|') !== expect) fail('除冰格之外还有变化: ' + diffs.join(' '));
if (JSON.stringify(before.blocks) !== JSON.stringify(after.blocks)) fail('目标图被改动');
if (before.toprow !== after.toprow || before.maprow !== after.maprow || before.mapcol !== after.mapcol) fail('尺寸字段被改动');
function colorTotals(g) {
  const t = {};
  for (const row of g.spools) for (const c of row) {
    if (!c || !(c.id > 0) || !(c.count > 0)) continue;
    t[c.id] = (t[c.id] || 0) + c.count;
  }
  return t;
}
const ta = colorTotals(before), tb = colorTotals(after);
for (const k of new Set([...Object.keys(ta), ...Object.keys(tb)])) if (ta[k] !== tb[k]) fail(`颜色 ${k} 容量变了`);

// 与 final 对比：只允许 4 个链格不同（链的位置换了），冰格必须与 final 完全一致
const swapCells = new Set(['0,0', '0,1', '1,0', '1,1']);
let nDiff = 0;
for (let r = 0; r < after.spools.length; r++) for (let c = 0; c < after.spools[0].length; c++) {
  if (JSON.stringify(after.spools[r][c]) !== JSON.stringify(fin.spools[r][c])) {
    nDiff++;
    if (!swapCells.has(r + ',' + c)) fail(`与 final 的差异不只链格: (${r},${c})`);
  }
}
if (nDiff !== 4) fail(`与 final 的差异格数应为 4，实际 ${nDiff}`);
for (const [r, c] of ICE) if (JSON.stringify(after.spools[r][c]) !== JSON.stringify(fin.spools[r][c])) fail(`冰格 (${r},${c}) 与 final 不一致`);
if (JSON.stringify(after.blocks) !== JSON.stringify(fin.blocks)) fail('与 final 目标图不一致');

fs.writeFileSync(OUT, JSON.stringify(after, null, 1));
console.log(JSON.stringify({ ok: true, out: OUT, ice: ICE, changedCells: diffs, diffsVsFinal: nDiff }, null, 1));
