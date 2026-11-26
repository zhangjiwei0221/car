// BatchReport_v723.js —— 把批量跑分 JSON 转成 Markdown 报告
// 用法：node BatchReport_v723.js --in 输出/批量跑分_batch1.json --out 输出/批量跑分_batch1.md
'use strict';
const fs = require('fs');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const IN = arg('--in'), OUT = arg('--out');
const d = JSON.parse(fs.readFileSync(IN, 'utf8'));
const rows = d.rows || d;
const lines = [];
lines.push(`# 批量跑分报告（${d.tag || ''}）`);
lines.push('');
lines.push(`- 样本：**${d.total || rows.length}** 张官方图`);
lines.push(`- 成功率（at4≥20 且 run4≥12 且 峰值≤4 且 审核通过 且 容量守恒）：**${d.pass}/${d.total} = ${d.rate}%**`);
lines.push(`- 失败原因分布：${JSON.stringify(d.reasons || {})}`);
lines.push('');
lines.push('| # | 图 | 棋盘 | 车 | 容量守恒 | at4 | run4 | 峰值 | 审核 | 结论 | 原因 | 耗时 |');
lines.push('|---:|---|---|---:|---|---:|---:|---:|---|---|---|---:|');
rows.forEach((r, i) => {
  const b = r.built || r.split || {};
  lines.push(`| ${i + 1} | ${r.label} | ${r.rows}×${r.cols} | ${r.cars || '-'} | ${r.conserved ? '✅' : '❌'} | ${b.at4 ?? '-'} | ${b.run4 ?? '-'} | ${b.peak ?? '-'} | ${r.auditPass === true ? '✅' : r.auditPass === false ? '❌' : '-'} | ${r.ok ? '**PASS**' : 'FAIL'} | ${r.reason || ''} | ${r.seconds || ''}s |`);
});
lines.push('');
lines.push('## 统计');
const pass = rows.filter(r => r.ok);
const fails = rows.filter(r => !r.ok);
const avg = (arr) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length * 10) / 10 : 0;
lines.push(`- 通过平均 at4：**${avg(pass.map(r => (r.built || r.split || {}).at4 || 0))}**，run4：**${avg(pass.map(r => (r.built || r.split || {}).run4 || 0))}**`);
lines.push(`- 未通过平均 at4：${avg(fails.map(r => (r.built || r.split || {}).at4 || 0))}`);
lines.push(`- 平均耗时：${avg(rows.map(r => r.seconds || 0))} 秒/张`);
fs.writeFileSync(OUT, lines.join('\n'));
console.log('写出：' + OUT);
