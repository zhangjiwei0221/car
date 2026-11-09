#!/usr/bin/env node
'use strict';
/**
 * M5Build_v3 —— 按目标窗口改写容量（reach-window 原型）
 *
 * 用法：
 *   node M5Build_v3.js <base.recipe.json> <targetReach.json> --out <recipe.json>
 *        [--window 10] [--margin 10] [--top 1]
 *
 * 对每种颜色：
 *   - 取该色当前容量最大的车；
 *   - 容量改为 reach[window][color] + margin（限制 8..90，且给其余车留 8）；
 *   - 其余车按剩余总量重分。
 * 只改容量，不动位置/障碍。
 */
const fs = require('fs');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const baseFile = process.argv[2], reachFile = process.argv[3];
const out = arg('--out', '');
const windowStep = Number(arg('--window', 10)) || 10;
const margin = Number(arg('--margin', 10)) || 10;
if (!baseFile || !reachFile || !out) { console.error('用法: node M5Build_v3.js <base.recipe.json> <targetReach.json> --out <recipe.json> [--window N] [--margin N]'); process.exit(2); }
const rec = JSON.parse(fs.readFileSync(baseFile, 'utf8'));
const reach = JSON.parse(fs.readFileSync(reachFile, 'utf8'));
const rows = reach.rows || [];
const row = rows.find(r => r.step === windowStep) || rows[Math.min(windowStep, rows.length - 1)] || { reach: {} };
const R = row.reach || {};

function partition(total, n, lo, hi) {
  if (n <= 0) return null;
  if (n * lo > total || n * hi < total) return null;
  const a = new Array(n).fill(Math.floor(total / n));
  let diff = total - a.reduce((x, y) => x + y, 0);
  for (let guard = 0; diff !== 0 && guard < n * 8; guard++) {
    for (let i = 0; i < n && diff !== 0; i++) {
      if (diff > 0 && a[i] < hi) { a[i]++; diff--; }
      else if (diff < 0 && a[i] > lo) { a[i]--; diff++; }
    }
  }
  return diff === 0 ? a : null;
}

const by = {};
for (const c of rec.cars) (by[c.id] = by[c.id] || []).push(c);
for (const id of Object.keys(by)) {
  const arr = by[id];
  const total = arr.reduce((a, c) => a + c.count, 0);
  const rv = Number(R[id] || 0);
  if (!rv || total < 8) continue;
  // 最大车做窗口债车
  arr.sort((a, b) => b.count - a.count);
  const big = arr[0];
  const restN = arr.length - 1;
  let want = Math.max(8, Math.min(90, rv + margin));
  if (restN > 0) want = Math.min(want, total - 8 * restN);
  if (want < 8) continue;
  const rest = partition(total - want, restN, 8, 90);
  if (!rest) continue;
  big.count = want;
  for (let i = 1; i < arr.length; i++) arr[i].count = rest[i - 1];
}
fs.writeFileSync(out, JSON.stringify(rec, null, 1));
console.log('wrote', out, 'window', windowStep, 'margin', margin);
