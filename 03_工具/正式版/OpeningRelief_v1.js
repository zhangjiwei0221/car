#!/usr/bin/env node
'use strict';
/**
 * OpeningRelief_v1 —— 方向1：把 row0 冰车拆成“12px 小车上排 + 大车藏黑格”
 *
 * 目的：增加开局可点选项，但不把大车直接暴露成重债。
 *   1. 选 row0 的冰车（type7）；
 *   2. 去掉它的冰；
 *   3. 把 count 拆成 k（默认12，留在 row0）+ 剩余（放到黑格，非暴露位）；
 *   4. 每色总像素不变。
 *
 * 用法：
 *   node OpeningRelief_v1.js <关卡.json> --out <变体.json> [--n 1] [--k 12]
 */
const fs = require('fs');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const levelFile = process.argv[2];
const outFile = arg('--out', null);
const nWanted = Number(arg('--n', 1)) || 1;
const kSmall = Number(arg('--k', 12)) || 12;
if (!levelFile || !outFile) { console.error('用法: node OpeningRelief_v1.js <关卡.json> --out <变体.json> [--n 1] [--k 12]'); process.exit(2); }
const g = JSON.parse(fs.readFileSync(levelFile, 'utf8'));
if (!g || !Array.isArray(g.spools)) throw new Error('不是关卡 JSON');
const rows = g.spools.length, cols = g.spools[0].length;
// 黑格：id<=0 且不是管道；优先非 row0（避免又暴露一个大车）
const blacks = [];
for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
  const cell = g.spools[r][c];
  if (!cell || cell.id > 0) continue;
  if (typeof cell.type === 'number' && cell.type >= 11 && cell.type <= 14) continue;
  blacks.push({ r, c, priority: r === 0 ? 2 : (r === rows - 1 || c === 0 || c === cols - 1 ? 1 : 0) });
}
blacks.sort((a, b) => a.priority - b.priority);
const targets = [];
for (let c = 0; c < cols; c++) {
  const cell = g.spools[0][c];
  if (!cell || cell.id <= 0) continue;
  if (cell.type === 7 && cell.count >= kSmall + 8) targets.push({ c, color: cell.id, count: cell.count, cell });
}
if (!targets.length) { console.error('row0 没有可拆的冰车'); process.exit(1); }
if (!blacks.length) { console.error('没有黑格可藏大车'); process.exit(1); }
let made = 0;
for (let i = 0; i < targets.length && made < nWanted && i < blacks.length; i++) {
  const t = targets[i], b = blacks[i];
  const rem = t.count - kSmall;
  t.cell.count = kSmall;
  t.cell.type = 0;
  t.cell.param = 0;
  g.spools[b.r][b.c] = { id: t.color, type: 0, param: 0, count: rem };
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
console.log('已写：' + outFile + '（拆 ' + made + ' 辆 row0 冰车，k=' + kSmall + '）');
