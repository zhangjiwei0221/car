#!/usr/bin/env node
'use strict';
/**
 * 守恒检查_97478 —— 变体 vs 底座：目标图/尺寸不变、逐色车辆容量 = 目标图块数、总量守恒。
 * 用法：node 守恒检查_97478.js <底座.json> <变体.json> <out.json>
 */
const fs = require('fs');
const [baseFile, variantFile, outFile] = process.argv.slice(2);
if (!baseFile || !variantFile || !outFile) {
  console.error('用法: node 守恒检查_97478.js <底座.json> <变体.json> <out.json>');
  process.exit(2);
}
const base = JSON.parse(fs.readFileSync(baseFile, 'utf8'));
const variant = JSON.parse(fs.readFileSync(variantFile, 'utf8'));

function blockTotals(g) {
  const t = {};
  let sum = 0;
  for (const row of g.blocks || []) for (const x of row) if (x) { t[x] = (t[x] || 0) + 1; sum++; }
  return { t, sum };
}
function carTotals(g) {
  const t = {};
  let sum = 0;
  for (const row of g.spools || []) for (const c of row) {
    if (!c || !(c.id > 0) || !(c.count > 0)) continue;
    t[c.id] = (t[c.id] || 0) + c.count; sum += c.count;
  }
  return { t, sum };
}
const bb = blockTotals(base), vb = blockTotals(variant);
const bc = carTotals(base), vc = carTotals(variant);
const colors = [...new Set([...Object.keys(bb.t), ...Object.keys(vb.t), ...Object.keys(bc.t), ...Object.keys(vc.t)])].sort((a, b) => +a - +b);
const perColor = {};
let perColorEqual = true;
for (const k of colors) {
  const rows = {
    blocks: bb.t[k] || 0, cars: bc.t[k] || 0,
    varBlocks: vb.t[k] || 0, varCars: vc.t[k] || 0
  };
  rows.equal = rows.blocks === rows.varBlocks && rows.cars === rows.varCars;
  if (!rows.equal) perColorEqual = false;
  perColor[k] = rows;
}
const out = {
  tool: '守恒检查_97478',
  base: baseFile, variant: variantFile,
  dimensionsEqual: base.toprow === variant.toprow && base.maprow === variant.maprow && base.mapcol === variant.mapcol
    && base.spools.length === variant.spools.length && base.spools[0].length === variant.spools[0].length,
  blocksUnchanged: JSON.stringify(base.blocks) === JSON.stringify(variant.blocks),
  perColorEqual,
  everyColorCarsEqualBlocks: colors.every(k => (bc.t[k] || 0) === (bb.t[k] || 0) && (vc.t[k] || 0) === (vb.t[k] || 0)),
  sumBase: bc.sum, sumVariant: vc.sum, targetPixels: bb.sum,
  colors: perColor
};
fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
console.log(JSON.stringify({ ok: out.dimensionsEqual && out.blocksUnchanged && out.perColorEqual && out.everyColorCarsEqualBlocks && out.sumVariant === out.targetPixels, dims: out.dimensionsEqual, blocks: out.blocksUnchanged, perColor: out.perColorEqual, sumVariant: out.sumVariant, target: out.targetPixels }));
