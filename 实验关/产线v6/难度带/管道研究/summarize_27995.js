#!/usr/bin/env node
'use strict';
// 汇总三段口径 + lt10（读取 PInterpPlayer 的 summary_all.json 目录；pid 27995）
// 用法: node summarize_27995.js <pinterp目�录> [label]
const fs = require('fs');
const path = require('path');
const dir = process.argv[2];
const label = process.argv[3] || path.basename(path.dirname(path.resolve(dir)));
const all = JSON.parse(fs.readFileSync(path.join(dir, 'summary_all.json'), 'utf8'));
const w = {};
let lt10 = 0, deaths = 0, games = 0, lt10By = {};
for (const x of all) {
  w[x.p] = x.winRate;
  games += x.games;
  const dd = x.deathDist || {};
  lt10 += dd.lt10 || 0;
  lt10By[x.p] = dd.lt10 || 0;
  deaths += x.games - Math.round(x.winRate * x.games);
}
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const casual = mean([w[0], w[0.1], w[0.2]]);
const mid = mean([w[0.3], w[0.4], w[0.5], w[0.6], w[0.7]]);
const serious = mean([w[0.8], w[0.9], w[1]]);
const ps = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
let inv = 0;
for (let i = 1; i < ps.length; i++) if (w[ps[i]] < w[ps[i - 1]] - 1e-12) inv++;
console.log(JSON.stringify({
  label, casual: +casual.toFixed(3), mid: +mid.toFixed(3), serious: +serious.toFixed(3), gap: +(serious - casual).toFixed(3), inversions: inv,
  lt10, deaths, games, lt10pct: +(100 * lt10 / Math.max(1, games)).toFixed(1), lt10By,
  curve: ps.map(p => `${p}:${w[p]}`).join(' ')
}, null, 1));
