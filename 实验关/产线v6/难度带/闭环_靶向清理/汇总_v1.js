'use strict';
// 汇总闭环实验：读取 pinterp_* 目录的 summary_all.json，输出三段/lt10/逐 p 曲线。
// 用法: node 汇总_v1.js <pinterp 目录> [...]
const fs = require('fs');
const path = require('path');
const dirs = process.argv.slice(2);
const f = (x) => Number(x).toFixed(3);
for (const dir of dirs) {
  const a = JSON.parse(fs.readFileSync(path.join(dir, 'summary_all.json'), 'utf8'));
  const w = {}; let lt10 = 0, lt25 = 0, games = 0;
  const casualLt = {};
  for (const x of a) {
    w[x.p] = x.winRate;
    const d = x.deathDist || {};
    lt10 += d.lt10 || 0;
    lt25 += (d.lt10 || 0) + (d.p10_25 || 0);
    games += x.games;
    if ([0, 0.1, 0.2].includes(x.p)) casualLt[x.p] = d.lt10 || 0;
  }
  const mean = (ks) => ks.reduce((s, k) => s + w[k], 0) / ks.length;
  console.log(JSON.stringify({
    dir: dir.split('/').slice(-2).join('/'),
    casual: +mean([0, 0.1, 0.2]).toFixed(4),
    mid: +mean([0.3, 0.4, 0.5, 0.6, 0.7]).toFixed(4),
    serious: +mean([0.8, 0.9, 1]).toFixed(4),
    gap: +(mean([0.8, 0.9, 1]) - mean([0, 0.1, 0.2])).toFixed(4),
    lt10: `${lt10}/${games}`,
    lt25: `${lt25}/${games}`,
    lt10_casual: `p0=${casualLt[0]},p.1=${casualLt[0.1]},p.2=${casualLt[0.2]} (${(casualLt[0] || 0) + (casualLt[0.1] || 0) + (casualLt[0.2] || 0)}/300)`,
    curve: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1].map(p => f(w[p])).join(' '),
  }));
}
