#!/usr/bin/env node
'use strict';
/**
 * OpeningReliefTransfer_v1 —— 方向1：row0 冰车拆成 12px 小车上排，剩余容量加到同色后排车
 *
 * 与 OpeningRelief 的区别：剩余容量不藏黑格，而是加到同色的后排车上，
 * 这样开局多一个便宜选项，但后段债务还在（不把中段压平）。
 *
 * 用法：
 *   node OpeningReliefTransfer_v1.js <关卡.json> --out <变体.json> [--n 1] [--k 12] [--cap 90]
 */
const fs = require('fs');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const levelFile = process.argv[2];
const outFile = arg('--out', null);
const nWanted = Number(arg('--n', 1)) || 1;
const kSmall = Number(arg('--k', 12)) || 12;
const cap = Number(arg('--cap', 90)) || 90;
if (!levelFile || !outFile) { console.error('用法: node OpeningReliefTransfer_v1.js <关卡.json> --out <变体.json> [--n 1] [--k 12]'); process.exit(2); }
const g = JSON.parse(fs.readFileSync(levelFile, 'utf8'));
if (!g || !Array.isArray(g.spools)) throw new Error('不是关卡 JSON');
const rows = g.spools.length, cols = g.spools[0].length;
const targets = [];
for (let c = 0; c < cols; c++) {
  const cell = g.spools[0][c];
  if (!cell || cell.id <= 0) continue;
  if (cell.type === 7 && cell.count >= kSmall + 8) targets.push({ c, color: cell.id, count: cell.count, cell });
}
if (!targets.length) { console.error('row0 没有可拆的冰车'); process.exit(1); }
let made = 0;
for (let i = 0; i < targets.length && made < nWanted; i++) {
  const t = targets[i];
  const remainder = t.count - kSmall;
  if (remainder <= 0) continue;
  // 同色、非 row0 的车，优先后排
  const pool = [];
  for (let r = 1; r < rows; r++) for (let c = 0; c < cols; c++) {
    const cell = g.spools[r][c];
    if (cell && cell.id === t.color && !Array.isArray(cell.type) && cell.type !== 5 && cell.count < cap) pool.push({ r, c, cell, room: cap - cell.count });
  }
  pool.sort((a, b) => (b.r - a.r) || (a.room - b.room));
  const totalRoom = pool.reduce((a, x) => a + x.room, 0);
  if (totalRoom < remainder) { console.error('色' + t.color + ' 后排容量不够：余' + remainder + '，可放' + totalRoom); continue; }
  let left = remainder;
  for (const p of pool) {
    if (left <= 0) break;
    const add = Math.min(left, p.room);
    p.cell.count += add;
    left -= add;
  }
  if (left > 0) continue;
  t.cell.count = kSmall;
  t.cell.type = 0;
  t.cell.param = 0;
  made++;
}
if (!made) { console.error('没有成功拆车'); process.exit(1); }
// 守恒自检
const px = {};
for (const row of g.blocks) for (const v of row) if (v > 0) px[v] = (px[v] || 0) + 1;
const by = {};
for (const row of g.spools) for (const x of row) if (x && x.id > 0) by[x.id] = (by[x.id] || 0) + x.count;
for (const p of g.spools.flat()) if (p && typeof p.type === 'number' && p.type >= 11 && p.type <= 14 && Array.isArray(p.param)) for (const q of p.param) if (q && q.id > 0) by[q.id] = (by[q.id] || 0) + q.count;
for (const k of Object.keys(px)) if ((by[k] || 0) !== px[k]) throw new Error('容量不守恒：色' + k + ' 像素' + px[k] + ' 车' + (by[k] || 0));
fs.writeFileSync(outFile, JSON.stringify(g));
console.log('已写：' + outFile + '（拆 ' + made + ' 辆，k=' + kSmall + '，cap=' + cap + '）');
