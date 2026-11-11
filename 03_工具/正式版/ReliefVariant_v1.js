#!/usr/bin/env node
'use strict';
/**
 * ReliefVariant_v1 —— 方向1：给开局补“缓解车”（不吃冰/链，只加一个可选小车）
 *
 * 做法：
 *   1. 找外围黑格（r=0/rows-1 或 c=0/cols-1，id<=0 且不是管道）；
 *   2. 从开局合法车的颜色里选一个“有≥18px 大车”的颜色；
 *   3. 把该颜色一辆大车拆出 10px，放到黑格，成为新的外围小车；
 *   4. 不改变任何颜色的总像素数（donor -10，新 car +10）。
 *
 * 用法：
 *   node ReliefVariant_v1.js <关卡.json> --out <变体.json> [--n 2]
 */
const fs = require('fs');
const B = require('./Build006Thickness_v688');
const A = B.loadSolver('corner');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const levelFile = process.argv[2];
const outFile = arg('--out', null);
const nWanted = Number(arg('--n', 2)) || 2;
if (!levelFile || !outFile) { console.error('用法: node ReliefVariant_v1.js <关卡.json> --out <变体.json> [--n 2]'); process.exit(2); }
const g = JSON.parse(fs.readFileSync(levelFile, 'utf8'));
const rows = g.spools.length, cols = g.spools[0].length;
const lv = A.parseLevel(A.fromGameFormat(g));
const s = A.Simulator.createState(lv, { useSlotStart: true, bottomOnly: false, instantChain: false });
const openingColors = [];
for (const m of A.Simulator.listMoves(s).filter(m => !m.blocked)) {
  const cell = s.cells[m.r][m.c];
  if (cell && cell.color > 0 && !openingColors.includes(cell.color)) openingColors.push(cell.color);
}
// 外围黑格
const blacks = [];
for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
  if (!(r === 0 || r === rows - 1 || c === 0 || c === cols - 1)) continue;
  const cell = g.spools[r][c];
  if (!cell || cell.id > 0) continue;
  if (typeof cell.type === 'number' && cell.type >= 11 && cell.type <= 14) continue;
  blacks.push({ r, c });
}
const donors = [];
const byColor = {};
for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
  const cell = g.spools[r][c];
  if (cell && cell.id > 0 && (!Array.isArray(cell.type)) && cell.type !== 5) (byColor[cell.id] = byColor[cell.id] || []).push({ r, c, count: cell.count });
}
for (const color of openingColors) {
  const arr = (byColor[color] || []).slice().sort((a, b) => b.count - a.count);
  for (const d of arr) if (d.count >= 18) { donors.push({ color, r: d.r, c: d.c, count: d.count }); break; }
}
if (!blacks.length) { console.error('没有外围黑格，无法加缓解车'); process.exit(1); }
if (!donors.length) { console.error('开局颜色没有≥18px 的可拆大车'); process.exit(1); }
let made = 0;
for (let i = 0; i < blacks.length && made < nWanted && i < donors.length; i++) {
  const b = blacks[i], d = donors[i];
  const donorCell = g.spools[d.r][d.c];
  if (!donorCell || donorCell.count < 18) continue;
  donorCell.count -= 10;
  g.spools[b.r][b.c] = { id: d.color, type: 0, param: 0, count: 10 };
  made++;
}
if (!made) { console.error('没有成功加缓解车'); process.exit(1); }
// 守恒自检
const px = {};
for (const row of g.blocks) for (const v of row) if (v > 0) px[v] = (px[v] || 0) + 1;
const by = {};
for (const row of g.spools) for (const x of row) if (x && x.id > 0) by[x.id] = (by[x.id] || 0) + x.count;
for (const p of g.spools.flat()) if (p && typeof p.type === 'number' && p.type >= 11 && p.type <= 14 && Array.isArray(p.param)) for (const q of p.param) if (q && q.id > 0) (by[q.id] = (by[q.id] || 0) + q.count);
for (const k of Object.keys(px)) if ((by[k] || 0) !== px[k]) throw new Error('容量不守恒：色' + k + ' 像素' + px[k] + ' 车' + (by[k] || 0));
fs.writeFileSync(outFile, JSON.stringify(g));
console.log('已写：' + outFile + '（加 ' + made + ' 辆缓解车）');
