#!/usr/bin/env node
'use strict';
/**
 * build_variants —— C5 中段代价：按候选交换清单构建中段代价车 2/4/6/8 辆变体
 * C5_中段代价（2026-11-12）
 *
 * 用法：
 *   node build_variants.js <base.json> --swaps <最终交换清单.json> --out <目录>
 *
 * 交换清单： [{ from:[r,c], to:[r,c], color, count, note }...]，按剂量阶梯排序。
 * 变体：M0（底座）/ M2 / M4 / M6 / M8 取前 N 个交换（N 超过清单长度时停在该长度）。
 * 每个变体都校验：颜色总量守恒、总像素守恒、车数不变。
 */
const fs = require('fs');
const path = require('path');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const file = process.argv[2];
if (!file || file.startsWith('--')) { console.error('用法: node build_variants.js <base.json> --swaps <清单.json> --out <目录>'); process.exit(2); }
const SWAP_FILE = arg('--swaps', '');
const OUT = arg('--out', path.dirname(file));
if (!SWAP_FILE) { console.error('缺少 --swaps'); process.exit(2); }
const base = JSON.parse(fs.readFileSync(file, 'utf8'));
const SWAPS = JSON.parse(fs.readFileSync(SWAP_FILE, 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));

function swap(g, a, b) { const t = g.spools[a[0]][a[1]]; g.spools[a[0]][a[1]] = g.spools[b[0]][b[1]]; g.spools[b[0]][b[1]] = t; }
function colorTotals(g) {
  const t = {};
  for (const row of g.spools) for (const s of row) if (s && s.id > 0) t[s.id] = (t[s.id] || 0) + s.count;
  return t;
}
const baseTotals = colorTotals(base);
const BASE_TOTAL = Object.values(baseTotals).reduce((a, b) => a + b, 0);
const BASE_CARS = base.spools.flat().filter(s => s && s.id > 0).length;
function verify(g, label) {
  const t = colorTotals(g);
  const keys = new Set([...Object.keys(baseTotals), ...Object.keys(t)]);
  const bad = [];
  for (const k of keys) if ((baseTotals[k] || 0) !== (t[k] || 0)) bad.push(`${k}:${baseTotals[k] || 0}->${t[k] || 0}`);
  const total = Object.values(t).reduce((a, b) => a + b, 0);
  const cars = g.spools.flat().filter(s => s && s.id > 0).length;
  if (bad.length) throw new Error(`${label} 逐色守恒失败: ${bad.join(',')}`);
  if (total !== BASE_TOTAL) throw new Error(`${label} 总量 ${total} != ${BASE_TOTAL}`);
  if (cars !== BASE_CARS) throw new Error(`${label} 车数 ${cars} != ${BASE_CARS}`);
  console.log(`${label}: 守恒 ${total}/${BASE_TOTAL}，${cars} 车，逐色 OK`);
}
fs.mkdirSync(OUT, { recursive: true });
const counts = String(arg('--counts', '0,2,4,6,8')).split(',').map(Number).filter(n => Number.isFinite(n));
const built = {};
for (const n of counts) {
  const use = Math.min(n, SWAPS.length);
  const g = clone(base);
  for (let i = 0; i < use; i++) swap(g, SWAPS[i].from, SWAPS[i].to);
  const name = `M${n}.json`;
  verify(g, name);
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(g, null, 1));
  built[name] = use;
}
fs.writeFileSync(path.join(OUT, 'swaps_final.json'), JSON.stringify(SWAPS, null, 1));
console.log('\n最终交换清单：');
SWAPS.forEach((s, i) => console.log(`${String(i + 1).padStart(2)}. ${s.color}/${s.count}  r${s.from[0]}c${s.from[1]} -> r${s.to[0]}c${s.to[1]}  ${s.note || ''}`));
console.log('\n变体:', Object.entries(built).map(([k, v]) => `${k}(${v}辆)`).join(', '));
