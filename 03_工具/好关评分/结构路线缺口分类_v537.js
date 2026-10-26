#!/usr/bin/env node
/** v537：只读分类 v536 A/B 的结构门与高压路线缺口。 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const inputPath = path.resolve(ROOT, process.argv[2] || '03_工具/好关评分/释放路线生成对照_v536.json');
const outPath = path.resolve(ROOT, process.argv[3] || '03_工具/好关评分/结构路线缺口分类_v537.json');
const source = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
function highPressure(row) {
  return !!(row && row.solver && row.solver.midBuffer34Pct >= 50);
}
function classify(row) {
  if (!row || !row.valid) return 'invalid';
  const hp = highPressure(row);
  if (row.struct && hp) return 'both_ready';
  if (row.struct && !hp) return 'structure_only';
  if (!row.struct && hp) return 'route_only';
  return 'neither';
}
const offRows = source.rows.filter(x => x.arm === 'off');
const rows = offRows.map(row => {
  const category = classify(row);
  const on = source.rows.find(x => x.arm === 'on' && x.image === row.image && x.seed === row.seed);
  return {
    image: row.image, seed: row.seed, category,
    valid: row.valid, struct: row.struct, pass: row.pass,
    solverMid: row.solver && row.solver.midBuffer34Pct,
    solverMax: row.solver && row.solver.maxBuffer,
    solverRelease: row.solver && row.solver.releaseStatus,
    qGateReasons: row.qGateReasons || [],
    qReasons: row.qReasons || [],
    onReleaseRoutePass: !!(on && on.releaseRoute && on.releaseRoute.pass),
    onReleaseRouteStatus: on && on.releaseRoute && on.releaseRoute.status || null,
    onAcceptedByReleaseRoute: !!(on && on.acceptedByReleaseRoute)
  };
});
const categories = ['both_ready', 'structure_only', 'route_only', 'neither', 'invalid'];
const counts = {};
for (const c of categories) counts[c] = rows.filter(x => x.category === c).length;
const byImage = {};
for (const image of [...new Set(rows.map(x => x.image))]) {
  byImage[image] = {};
  for (const c of categories) byImage[image][c] = rows.filter(x => x.image === image && x.category === c).length;
}
const dominant = categories.slice().sort((a, b) => counts[b] - counts[a])[0];
const result = {
  schema: 'structure-route-gap-classification-v1',
  date: '2026-10-26',
  input: path.relative(ROOT, inputPath),
  preregistration: '结构路线缺口分类_预登记_v537.md',
  definition: {
    highPressure: 'solver.midBuffer34Pct >= 50',
    categories: {
      both_ready: '结构合格 + 高压路线',
      structure_only: '结构合格 + 无高压路线',
      route_only: '结构不合格 + 高压路线',
      neither: '结构不合格 + 无高压路线',
      invalid: '无有效关卡'
    }
  },
  summary: { rows: rows.length, counts, byImage, dominant },
  rows
};
fs.writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result.summary, null, 2));
