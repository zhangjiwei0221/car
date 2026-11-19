#!/usr/bin/env node
'use strict';
// 换链色四变体逐格 diff：只比较 spools 单元格（含 id/type/param/count）。
// 用法: node 逐格diff.js
const fs = require('fs');
const path = require('path');
const D = __dirname;
const files = {
  C1: '关卡_ZC_140_C1_换链色.json',
  C2: '关卡_ZC_140_C2_换链色去冰.json',
  C3: '关卡_ZC_140_C3_原链去冰.json',
  C4: '关卡_ZC_140_C4_原链.json',
};
const g = {};
for (const k in files) g[k] = JSON.parse(fs.readFileSync(path.join(D, files[k]), 'utf8'));
const pairs = [['C1', 'C2'], ['C3', 'C4'], ['C1', 'C4'], ['C2', 'C3'], ['C1', 'C3'], ['C2', 'C4']];
function cellDiff(a, b) {
  const out = [];
  for (let r = 0; r < a.spools.length; r++) for (let c = 0; c < a.spools[0].length; c++) {
    const x = a.spools[r][c], y = b.spools[r][c];
    if (JSON.stringify(x) !== JSON.stringify(y)) out.push({ cell: `${r},${c}`, a: x, b: y });
  }
  return out;
}
const res = {};
for (const [x, y] of pairs) {
  const d = cellDiff(g[x], g[y]);
  res[x + '->' + y] = { n: d.length, cells: d.map(z => z.cell) };
  console.log(`${x} -> ${y}: ${d.length} 格  ${d.map(z => z.cell).join(' ')}`);
  for (const z of d) console.log(`    ${z.cell}: ${x}=${JSON.stringify(z.a)}  ${y}=${JSON.stringify(z.b)}`);
}
// 不变量：目标图/尺寸
const base = g.C4;
for (const k in g) {
  if (JSON.stringify(g[k].blocks) !== JSON.stringify(base.blocks)) throw new Error(k + ' blocks 不同');
  if (g[k].toprow !== base.toprow || g[k].maprow !== base.maprow || g[k].mapcol !== base.mapcol) throw new Error(k + ' 尺寸字段不同');
}
const outFile = path.join(D, '逐格diff.json');
fs.writeFileSync(outFile, JSON.stringify({ generatedBy: '逐格diff.js', pairs: res }, null, 1));
console.log('saved', outFile);
