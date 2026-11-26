#!/usr/bin/env node
'use strict';
/**
 * ColorSpread_v788 —— 颜色传播预测
 *
 * 用户 2026-11-03：「先进行颜色预测，比如边框的颜色小区多少、会暴露多少新颜色等等，
 *                    来获取一个我们理想的消除车序」
 *
 * 做法：按 corner 规则（左下角优先）模拟"逐格吃掉"，每吃掉 1 车的像素量就记一档：
 *   - 此刻每色"可达像素"有多少
 *   - 哪些颜色已经凑够一车容量（= 可以放"好填"的车）
 *   - 哪些颜色还没凑够（= 放上去必然欠债）
 *
 * 用法：node ColorSpread_v788.js <图.txt> --cars 49 [--out 表.json]
 */
const fs = require('fs');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const IMG = process.argv[2];
const CARS = Number(arg('--cars', 49));
const OUT = arg('--out', '');

const m = fs.readFileSync(IMG, 'utf8').trim().split(/\r?\n/).slice(1).map(l => l.trim().split(/\s+/).map(Number));
const H = m.length, W = m[0].length, TOT = H * W;
const px = {};
for (const r of m) for (const v of r) px[v] = (px[v] || 0) + 1;
const colors = Object.keys(px).map(Number);
const CAP = TOT / CARS;

const col = m.map(r => r.slice());
const gone = m.map(r => r.map(() => false));
const reach = (y, x) => y === 0 || x === 0 || y === H - 1 || x === W - 1 ||
  gone[y - 1][x] || gone[y + 1][x] || gone[y][x - 1] || gone[y][x + 1];

function countReach() {
  const c = {};
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (gone[y][x] || !reach(y, x)) continue;
    const v = col[y][x]; c[v] = (c[v] || 0) + 1;
  }
  return c;
}

const rows = [];
let eaten = 0;
const per = Math.max(1, Math.round(CAP));
for (let k = 1; k <= CARS; k++) {
  // 吃掉 per 个像素（按 corner 顺序：从下左角开始）
  let n = 0;
  while (n < per && eaten < TOT) {
    const cand = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (gone[y][x] || !reach(y, x)) continue;
      cand.push([(H - 1 - y) + x, y, x]);
    }
    if (!cand.length) break;
    cand.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
    const [d, y, x] = cand[0];
    gone[y][x] = true; eaten++; n++;
  }
  const rc = countReach();
  const fillable = colors.filter(c => (rc[c] || 0) >= CAP);
  const notFillable = colors.filter(c => (rc[c] || 0) < CAP && (px[c] - (px[c] - (rc[c] || 0))) >= 0);
  rows.push({ step: k, eaten, reach: rc, fillable, count: fillable.length });
}

console.log('图: ' + IMG.split('/').pop() + ' | 像素 ' + TOT + ' | 车 ' + CARS + ' | 每车容量 ' + CAP.toFixed(1));
console.log('色: ' + colors.map(c => c + '(' + px[c] + ')').join(' '));
console.log('\n步 | 已吃 | 可填满的颜色数 | 可填的颜色');
for (const r of rows) {
  if (r.step <= 8 || r.step % Math.max(1, Math.floor(CARS / 8)) === 0) {
    console.log(String(r.step).padStart(2) + ' | ' + String(r.eaten).padStart(4) + ' | ' +
      String(r.count).padStart(2) + ' | ' + r.fillable.join(','));
  }
}
// 每色首次"够一车"的步数
const first = {};
for (const r of rows) for (const c of r.fillable) if (first[c] === undefined) first[c] = r.step;
console.log('\n各色"第一次凑够一车"的步数:');
console.log(colors.map(c => c + ':' + (first[c] !== undefined ? first[c] : '从未')).join('  '));
// 每色从边框可达的初始量
const r0 = rows[0].reach;
console.log('\n开局可达: ' + colors.map(c => c + ':' + (r0[c] || 0)).join(' '));
if (OUT) fs.writeFileSync(OUT, JSON.stringify(rows, null, 0));
