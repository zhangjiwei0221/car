// DistReport_v752.js —— 读批次 results.json，出难度分布报告
// 用法：node DistReport_v752.js 输出/批次_量产50 [--md 输出/批次_量产50/分布.md]
'use strict';
const fs = require('fs'), path = require('path');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DIR = process.argv[2];
const MD = arg('--md', path.join(DIR, '分布.md'));
const rows = JSON.parse(fs.readFileSync(path.join(DIR, 'results.json'), 'utf8')).filter(r => r.ok);

const pass = r => r.won && r.peak <= 4 && r.at4 >= 20 && r.run4 >= 12 && r.capacityOK;
const okRows = rows.filter(pass);

function bucket(v, cuts) { for (const c of cuts) if (v <= c[0]) return c[1]; return cuts[cuts.length - 1][1]; }
const bAt4 = [[9, '<10'], [14, '10-14'], [19, '15-19'], [24, '20-24'], [29, '25-29'], [99, '30+']];
const bRun = [[5, '<6'], [11, '6-11'], [17, '12-17'], [23, '18-23'], [99, '24+']];

const hist = (arr, cuts) => {
  const h = {};
  for (const v of arr) { const k = bucket(v, cuts); h[k] = (h[k] || 0) + 1; }
  return h;
};
const at4h = hist(rows.map(r => r.at4), bAt4);
const runh = hist(rows.map(r => r.run4), bRun);
const lateh = hist(rows.map(r => r.late4), [[0, '0'], [1, '1'], [3, '2-3'], [5, '4-5'], [99, '6+']]);
const times = rows.map(r => r.wall || 0).sort((a, b) => a - b);
const mean = a => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);

const md = [];
md.push('# 量产批次分布报告');
md.push('');
md.push(`样本：**${rows.length}** 张（过图门槛的官方图）`);
md.push('');
md.push('## 达标率');
md.push('');
md.push(`| 口径 | 数量 | 占比 |`);
md.push(`|---|---:|---:|`);
md.push(`| 可解 + 峰值≤4 + 容量守恒 | ${rows.filter(r => r.won && r.peak <= 4 && r.capacityOK).length} | ${Math.round(rows.filter(r => r.won && r.peak <= 4 && r.capacityOK).length / rows.length * 100)}% |`);
md.push(`| **达标（+ at4≥20 且 run4≥12）** | **${okRows.length}** | **${Math.round(okRows.length / rows.length * 100)}%** |`);
md.push(`| 首手消除 ≥80% | ${rows.filter(r => (r.firstRatio || 0) >= 0.8).length} | ${Math.round(rows.filter(r => (r.firstRatio || 0) >= 0.8).length / rows.length * 100)}% |`);
md.push('');
md.push('## at4 分布');
md.push('');
md.push('| 区间 | 数量 |');
md.push('|---|---:|');
for (const k of ['<10', '10-14', '15-19', '20-24', '25-29', '30+']) if (at4h[k]) md.push(`| ${k} | ${at4h[k]} |`);
md.push('');
md.push('## run4 分布');
md.push('');
md.push('| 区间 | 数量 |');
md.push('|---|---:|');
for (const k of ['<6', '6-11', '12-17', '18-23', '24+']) if (runh[k]) md.push(`| ${k} | ${runh[k]} |`);
md.push('');
md.push('## late4 分布（参考）');
md.push('');
md.push('| 区间 | 数量 |');
md.push('|---|---:|');
for (const k of ['0', '1', '2-3', '4-5', '6+']) if (lateh[k]) md.push(`| ${k} | ${lateh[k]} |`);
md.push('');
md.push('## 耗时');
md.push('');
md.push(`| 均值 | 中位 | 最小 | 最大 |`);
md.push(`|---:|---:|---:|---:|`);
md.push(`| ${Math.round(mean(times))}s | ${times[Math.floor(times.length / 2)]}s | ${times[0]}s | ${times[times.length - 1]}s |`);
md.push('');
md.push('## 达标清单');
md.push('');
md.push('| 图 | at4 | run4 | late4 | 首手% | 用时 |');
md.push('|---|---:|---:|---:|---:|---:|');
for (const r of okRows.sort((a, b) => b.at4 - a.at4)) {
  md.push(`| ${r.file} | ${r.at4} | ${r.run4} | ${r.late4} | ${Math.round((r.firstRatio || 0) * 100)}% | ${r.wall}s |`);
}
md.push('');
md.push('## 不达标清单（附原因）');
md.push('');
md.push('| 图 | at4 | run4 | 主要短板 |');
md.push('|---|---:|---:|---|');
for (const r of rows.filter(x => !pass(x)).sort((a, b) => b.at4 - a.at4)) {
  const why = r.at4 < 20 && r.run4 < 12 ? 'at4+run4' : (r.at4 < 20 ? 'at4' : (r.run4 < 12 ? 'run4' : (r.won ? '峰值/容量' : '不可解')));
  md.push(`| ${r.file} | ${r.at4} | ${r.run4} | ${why} |`);
}
fs.writeFileSync(MD, md.join('\n'));
console.log(`已写出 ${MD}`);
console.log(`达标 ${okRows.length}/${rows.length}（${Math.round(okRows.length / rows.length * 100)}%）`);
console.log('at4 分布:', JSON.stringify(at4h));
console.log('run4 分布:', JSON.stringify(runh));
console.log('耗时 均值', Math.round(mean(times)) + 's', '中位', times[Math.floor(times.length / 2)] + 's');
