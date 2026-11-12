#!/usr/bin/env node
'use strict';
/**
 * make_tier10 —— 把 106 底座的容量改成“以 10 为单位的档位”
 *
 * 只改 spools[r][c].count，位置/颜色/障碍/目标图全部原样保留。
 *
 * 规则（用户 2026-11-12）：
 *   1. 每色车辆数 n 不变，该色总像素 P 不变；
 *   2. 目标容量尽量是 10 的倍数；
 *   3. 每色最多一辆“余数车”：P mod 10 不为 0 时，把这部分并进该色某一辆
 *      （这里并进十位最大的一辆；十位并列时取行优先第一辆）；
 *   4. 任一辆不得 <=5；若某色 P/n < 10，该色保持原容量并在审计里列出；
 *   5. 十位尽量平均：floor(P/10) 个十位在 n 辆车间差不超过 1 个十位，
 *      剩余的十位从行优先最后一辆往前放。
 *
 * 用法：
 *   node make_tier10.js <底座.json> <输出.json> [--audit <audit.json>]
 *
 * 输出 JSON 与输入同结构；审计内容是逐色分配表（旧容量 -> 新容量）。
 */
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const auditIdx = args.indexOf('--audit');
const AUDIT = auditIdx > 0 && args[auditIdx + 1] ? args[auditIdx + 1] : null;
const src = args[0];
const dst = args[1];
if (!src || !dst || src.startsWith('--') || dst.startsWith('--')) {
  console.error('用法: node make_tier10.js <底座.json> <输出.json> [--audit <audit.json>]');
  process.exit(2);
}

const game = JSON.parse(fs.readFileSync(src, 'utf8'));
if (!game || !Array.isArray(game.spools)) {
  console.error('输入不是游戏格式：缺少 spools');
  process.exit(2);
}

// 行优先收集每色的车（保留出现顺序）
const byColor = new Map();
for (let r = 0; r < game.spools.length; r++) {
  for (let c = 0; c < game.spools[r].length; c++) {
    const s = game.spools[r][c];
    if (!s || !(s.id > 0)) continue;
    if (!byColor.has(s.id)) byColor.set(s.id, []);
    byColor.get(s.id).push({ r, c, s, oldCount: s.count });
  }
}

const audit = [];
let changed = 0;
let skippedColors = [];
let totalOld = 0;
let totalNew = 0;
let totalCars = 0;

for (const color of [...byColor.keys()].sort((a, b) => a - b)) {
  const cars = byColor.get(color);
  const n = cars.length;
  const P = cars.reduce((a, x) => a + x.oldCount, 0);
  totalOld += P;

  let newCounts;
  let reason;
  if (P / n < 10) {
    // 硬约束：不缩放，保持原容量
    newCounts = cars.map(x => x.oldCount);
    reason = 'P/n<10，保持原容量';
    skippedColors.push({ color, n, P, Pn: P / n });
  } else if (n === 1) {
    // 只有一辆车：P 全部给它，它天然就是余数车
    newCounts = [P];
    reason = '单车色：整色容量必须落在一辆上';
  } else {
    const tens = Math.floor(P / 10);
    const rem = P % 10;
    const base = Math.floor(tens / n);
    const extra = tens - base * n;
    const tenArr = new Array(n).fill(base);
    // 多出的十位从行优先最后一辆往前放，保证差不超过 1 个十位
    for (let i = n - extra; i < n; i++) tenArr[i] += 1;
    newCounts = tenArr.map(t => t * 10);
    // P mod 10 并进十位最大的一辆（并列取行优先第一辆）
    const maxTen = Math.max(...tenArr);
    const maxIdx = tenArr.indexOf(maxTen);
    newCounts[maxIdx] += rem;
    reason = rem ? `余数 ${rem} 并入十位最大的一辆` : '整除 10';
  }

  const sumNew = newCounts.reduce((a, b) => a + b, 0);
  if (sumNew !== P) {
    console.error(`颜色 ${color} 守恒失败：${sumNew} != ${P}`);
    process.exit(1);
  }
  for (const v of newCounts) {
    if (v <= 5) {
      console.error(`颜色 ${color} 出现容量 <=5 的车：${v}`);
      process.exit(1);
    }
  }

  cars.forEach((x, i) => {
    if (x.s.count !== newCounts[i]) changed++;
    x.s.count = newCounts[i];
    totalNew += newCounts[i];
  });
  totalCars += n;
  audit.push({
    color, n, P,
    Pn: Number((P / n).toFixed(3)),
    oldCounts: cars.map(x => x.oldCount),
    newCounts,
    remainderCar: newCounts.filter(v => v % 10 !== 0).length,
    reason
  });
}

if (totalCars !== 49) {
  console.error(`车数不是 49：${totalCars}`);
  process.exit(1);
}
if (totalOld !== totalNew) {
  console.error(`总像素守恒失败：${totalOld} != ${totalNew}`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(dst), { recursive: true });
fs.writeFileSync(dst, JSON.stringify(game));

const nonMultiples = [];
for (const a of audit) for (const v of a.newCounts) if (v % 10 !== 0) nonMultiples.push({ color: a.color, count: v });
const cv = (() => {
  const vals = [];
  for (const a of audit) vals.push(...a.newCounts);
  const mean = vals.reduce((x, y) => x + y, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((x, y) => x + (y - mean) ** 2, 0) / vals.length);
  return { mean, sd, cv: sd / mean, max: Math.max(...vals), min: Math.min(...vals) };
})();

const report = {
  src, dst,
  cars: totalCars,
  totalPx: totalNew,
  changedCars: changed,
  skippedColors,
  nonMultiples,
  stats: cv,
  perColor: audit
};

console.log(JSON.stringify({
  src, dst, cars: totalCars, totalPx: totalNew, changedCars: changed,
  skippedColors, nonMultiplesCount: nonMultiples.length,
  cv: Number(cv.cv.toFixed(4)), max: cv.max, min: cv.min,
  perColor: audit.map(a => ({ color: a.color, n: a.n, P: a.P, old: a.oldCounts, new: a.newCounts, reason: a.reason }))
}, null, 1));

if (AUDIT) {
  fs.mkdirSync(path.dirname(AUDIT), { recursive: true });
  fs.writeFileSync(AUDIT, JSON.stringify(report, null, 1));
}
