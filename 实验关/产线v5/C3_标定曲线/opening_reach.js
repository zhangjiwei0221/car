#!/usr/bin/env node
'use strict';
/**
 * opening_reach —— 开局（progress=0）每种颜色从外界可达的像素数
 * C3_标定曲线（2026-11-12）
 *
 * 做法：把 (0,4) 临时替换成该颜色的 count=999 假车，createState 后 applyPick，
 * gain 即开局该色可达像素数（corner 口径；目标图不变）。只用于测量，不写回关卡。
 *
 * 用法：node opening_reach.js <关卡.json> --out <结果.json>
 */
const fs = require('fs');
const path = require('path');
const B = require(path.resolve(__dirname, '../../../03_工具/正式版/Build006Thickness_v688.js'));
const A = B.loadSolver('corner');
const Sim = A.Simulator;
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const file = process.argv[2];
if (!file || file.startsWith('--')) { console.error('用法: node opening_reach.js <关卡.json> --out <结果.json>'); process.exit(2); }
const OUT = arg('--out', `/tmp/opening_reach_${process.pid}.json`);
const base = JSON.parse(fs.readFileSync(file, 'utf8'));
const cap = {};
for (const row of base.spools) for (const s of row) if (s && s.id > 0) cap[s.id] = (cap[s.id] || 0) + s.count;
const colors = Object.keys(cap).map(Number).sort((a, b) => a - b);
const rows = [];
for (const col of colors) {
  const g = JSON.parse(JSON.stringify(base));
  g.spools[0][4] = { id: col, type: 0, param: 0, count: 999 };
  const lv = A.parseLevel(A.fromGameFormat(g));
  const s = Sim.createState(lv, { useSlotStart: true, instantChain: false });
  const before = s.eliminatedPixels;
  if (!Sim.applyPick(s, 0, 4)) throw new Error('applyPick 失败 color=' + col);
  const reach = s.eliminatedPixels - before;
  rows.push({ color: col, capacity: cap[col], openingReach: reach,
    ratioFullColor: Math.round(Math.min(cap[col], reach) / cap[col] * 1e4) / 1e4,
    ratioFor43: Math.round(Math.min(43, reach) / 43 * 1e4) / 1e4 });
}
rows.sort((a, b) => a.ratioFor43 - b.ratioFor43 || a.color - b.color);
console.log('color  cap  openingReach  reach/cap  reach/43');
for (const r of rows) console.log(`${String(r.color).padStart(5)} ${String(r.capacity).padStart(5)} ${String(r.openingReach).padStart(13)}  ${(r.ratioFullColor * 100).toFixed(1)}%`.padEnd(48) + (r.ratioFor43 * 100).toFixed(1) + '%');
fs.writeFileSync(OUT, JSON.stringify(rows, null, 1));
console.log('结果: ' + path.resolve(OUT));
