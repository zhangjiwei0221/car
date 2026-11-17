#!/usr/bin/env node
'use strict';
// 输出 markdown 对照表行（977 / 4242 / 194），pid 27995
// 用法: node table_27995.js
const fs = require('fs');
const path = require('path');
const D = __dirname;
function summ(dir) {
  const a = JSON.parse(fs.readFileSync(path.join(dir, 'summary_all.json'), 'utf8'));
  const w = {}; let lt = 0, games = 0;
  for (const x of a) { w[x.p] = x.winRate; lt += (x.deathDist || {}).lt10 || 0; games += x.games; }
  const mean = (ks) => ks.reduce((s, k) => s + w[k], 0) / ks.length;
  const cas = mean([0, 0.1, 0.2]), mid = mean([0.3, 0.4, 0.5, 0.6, 0.7]), ser = mean([0.8, 0.9, 1]);
  const ps = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
  let inv = 0; for (let i = 1; i < ps.length; i++) if (w[ps[i]] < w[ps[i - 1]] - 1e-12) inv++;
  return { cas, mid, ser, gap: ser - cas, inv, lt, games, w };
}
const f = (x) => x.toFixed(3);
const rows = [];
function add(name, dir) {
  try {
    const s = summ(dir);
    rows.push(`| ${name} | ${f(s.cas)} | ${f(s.mid)} | ${f(s.ser)} | ${s.gap >= 0 ? '+' : ''}${f(s.gap)} | ${s.inv} | ${s.lt}/${s.games} (${(100 * s.lt / s.games).toFixed(1)}%) |`);
  } catch (e) { rows.push(`| ${name} | - | - | - | - | - | - |`); }
}
add('底座 6-C2（977）', path.join(D, '基线/pinterp_977'));
for (const v of ['P-开局', 'P-中段', 'P-深行', 'P-链色', 'P-开局-晚色', 'P-开局-右向']) add(v + '（977）', path.join(D, v, 'pinterp_977'));
add('底座 6-C2（4242，文档值）', path.join(D, '__none__'));
for (const v of ['P-开局', 'P-中段', 'P-深行', 'P-链色', 'P-开局-晚色', 'P-开局-右向']) add(v + '（4242）', path.join(D, v, 'pinterp_4242'));
add('194 基线（977）', path.join(D, '194-基线/pinterp_977'));
add('194-P-开局（977）', path.join(D, '194-P-开局/pinterp_977'));
console.log(rows.join('\n'));
