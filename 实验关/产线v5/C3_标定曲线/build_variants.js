#!/usr/bin/env node
'use strict';
/**
 * build_variants —— C3 标定曲线：把「开局吃不饱的代价车」逐辆换到第 0–1 行
 * C3_标定曲线（2026-11-12）
 *
 * 候选池（全部 count=43，开局该色可达像素/容量 < 0.6）：
 *   32/43 ×7（开局可达 0）、5/43 ×1（0）、14/43 ×2（0）
 * 只做整辆车换位：同容量（43↔43）；不改容量、不改颜色总量、不改目标图、不加障碍。
 * 目标格全部是原本 count=43 的第 0–1 行格，因此换位前后每格容量不变。
 *
 * 用法：node build_variants.js <base.json> --out <目录>
 */
const fs = require('fs');
const path = require('path');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const file = process.argv[2];
if (!file || file.startsWith('--')) { console.error('用法: node build_variants.js <base.json> --out <目录>'); process.exit(2); }
const OUT = arg('--out', path.dirname(file));
const base = JSON.parse(fs.readFileSync(file, 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));
const key = (p) => p[0] + ',' + p[1];

// 顺序 = 剂量阶梯的前缀；每辆只换一次。
const SWAPS = [
  { from: [2, 6], to: [0, 4], color: 32, count: 43, note: '32/43 → 行0' },
  { from: [3, 1], to: [0, 5], color: 32, count: 43, note: '32/43 → 行0' },
  { from: [3, 3], to: [0, 6], color: 32, count: 43, note: '32/43 → 行0' },
  { from: [4, 2], to: [1, 0], color: 32, count: 43, note: '32/43 → 行1' },
  { from: [4, 3], to: [1, 1], color: 32, count: 43, note: '32/43 → 行1' },
  { from: [5, 1], to: [1, 2], color: 32, count: 43, note: '32/43 → 行1' },
  { from: [5, 2], to: [1, 3], color: 32, count: 43, note: '32/43 → 行1' },
  { from: [2, 4], to: [1, 4], color: 5,  count: 43, note: '5/43 → 行1' },
  { from: [3, 0], to: [1, 5], color: 14, count: 43, note: '14/43 → 行1' },
  { from: [3, 5], to: [1, 6], color: 14, count: 43, note: '14/43 → 行1' }
];

function swap(g, a, b) { const t = g.spools[a[0]][a[1]]; g.spools[a[0]][a[1]] = g.spools[b[0]][b[1]]; g.spools[b[0]][b[1]] = t; }
function colorTotals(g) {
  const t = {};
  for (const row of g.spools) for (const s of row) if (s && s.id > 0) t[s.id] = (t[s.id] || 0) + s.count;
  return t;
}
function verify(baseTotals, baseTotal, g, label) {
  const t = colorTotals(g);
  const keys = new Set([...Object.keys(baseTotals), ...Object.keys(t)]);
  const bad = [];
  for (const k of keys) if ((baseTotals[k] || 0) !== (t[k] || 0)) bad.push(`${k}:${baseTotals[k] || 0}->${t[k] || 0}`);
  const total = Object.values(t).reduce((a, b) => a + b, 0);
  const cars = g.spools.flat().filter(s => s && s.id > 0).length;
  if (bad.length) throw new Error(`${label} 逐色守恒失败: ${bad.join(',')}`);
  if (total !== baseTotal) throw new Error(`${label} 总量 ${total} != ${baseTotal}`);
  console.log(`${label}: 守恒 ${total}/${baseTotal}，${cars} 车，逐色 OK`);
}

const baseTotals = colorTotals(base);
const BASE_TOTAL = Object.values(baseTotals).reduce((a, b) => a + b, 0);
fs.mkdirSync(OUT, { recursive: true });

const variants = [0, 2, 4, 6, 8, 9, 10]; // 9 = 诊断点（定位陡崖），不在任务要求的 6 个点内
for (const n of variants) {
  const g = clone(base);
  for (let i = 0; i < n; i++) swap(g, SWAPS[i].from, SWAPS[i].to);
  const name = n === 0 ? 'V0_base.json' : `V${n}.json`;
  verify(baseTotals, BASE_TOTAL, g, name);
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(g, null, 1));
}
fs.writeFileSync(path.join(OUT, 'swaps.json'), JSON.stringify(SWAPS, null, 1));

// 诊断变体（不在 6 个主点内）：同样 10 辆代价车，但最后 1 辆放行2，
// 让第 1 行保留 1 个安全格（28/43），用来分离「数量」与「第 1 行被代价车铺满」。
const spread = clone(base);
for (let i = 0; i < 9; i++) swap(spread, SWAPS[i].from, SWAPS[i].to);
swap(spread, SWAPS[9].from, [2, 0]); // (3,5)14/43 ↔ (2,0)28/43
verify(baseTotals, BASE_TOTAL, spread, 'D10_spread.json');
fs.writeFileSync(path.join(OUT, 'D10_spread.json'), JSON.stringify(spread, null, 1));

// 诊断变体：把「开局能吃到约一半」的 11/43 车换到开局（H2/H4）。
// 用来区分「零收益代价车」与「半饱代价车」——11 开局可达 23/43=0.535。
const HALF_SWAPS = [
  { from: [2, 1], to: [0, 4], color: 11, count: 43 },
  { from: [4, 1], to: [0, 5], color: 11, count: 43 },
  { from: [4, 5], to: [0, 6], color: 11, count: 43 },
  { from: [5, 3], to: [1, 0], color: 11, count: 43 }
];
for (const n of [2, 4]) {
  const h = clone(base);
  for (let i = 0; i < n; i++) swap(h, HALF_SWAPS[i].from, HALF_SWAPS[i].to);
  verify(baseTotals, BASE_TOTAL, h, `H${n}_half.json`);
  fs.writeFileSync(path.join(OUT, `H${n}_half.json`), JSON.stringify(h, null, 1));
}
fs.writeFileSync(path.join(OUT, 'half_swaps.json'), JSON.stringify(HALF_SWAPS, null, 1));

console.log('\n换位清单（前缀阶梯）：');
SWAPS.forEach((s, i) => console.log(`${String(i + 1).padStart(2)}. ${s.note}  r${s.from[0]}c${s.from[1]} ↔ r${s.to[0]}c${s.to[1]}  (${s.count}px)`));
console.log('\n变体: ' + variants.map(n => n === 0 ? 'V0_base' : 'V' + n).join(', '));
