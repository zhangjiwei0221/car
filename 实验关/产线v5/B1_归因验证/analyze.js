#!/usr/bin/env node
'use strict';
/**
 * B1 汇总：读每关 run_attribution.js 的结果 + 线上 CSV，
 * 计算每关 {死亡局数, 归因距离中位数, 死亡进度中位数}，
 * 与线上 4 列做 Spearman（n=12 与 n=9 两套）。
 * 用法：node analyze.js --results <每关结果目录> --csv <线上csv> --out <报告json>
 */
const fs = require('fs');
const path = require('path');

function argv(key, def) {
  const i = process.argv.indexOf('--' + key);
  return i > 0 ? process.argv[i + 1] : def;
}
const RESULTS_DIR = argv('results');
const CSV = argv('csv');
const OUT = argv('out');
if (!RESULTS_DIR || !CSV || !OUT) {
  console.error('用法: node analyze.js --results <目录> --csv <csv> --out <json>');
  process.exit(2);
}

function rank(arr) {
  const idx = arr.map((v, i) => i).sort((a, b) => arr[a] - arr[b]);
  const r = new Array(arr.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && arr[idx[j + 1]] === arr[idx[i]]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k]] = avg;
    i = j + 1;
  }
  return r;
}
function pearson(a, b) {
  const n = a.length;
  if (n < 3) return null;
  const ma = a.reduce((x, y) => x + y, 0) / n;
  const mb = b.reduce((x, y) => x + y, 0) / n;
  let sa = 0, sb = 0, sab = 0;
  for (let i = 0; i < n; i++) { const da = a[i] - ma, db = b[i] - mb; sa += da * da; sb += db * db; sab += da * db; }
  if (sa === 0 || sb === 0) return null;
  return sab / Math.sqrt(sa * sb);
}
function spearman(a, b) {
  // 成对剔除缺失
  const x = [], y = [];
  for (let i = 0; i < a.length; i++) if (Number.isFinite(a[i]) && Number.isFinite(b[i])) { x.push(a[i]); y.push(b[i]); }
  if (x.length < 3) return { rho: null, n: x.length };
  return { rho: +pearson(rank(x), rank(y)).toFixed(4), n: x.length };
}
function median(a) {
  const b = a.filter(Number.isFinite).slice().sort((x, y) => x - y);
  if (!b.length) return null;
  const m = Math.floor(b.length / 2);
  return b.length % 2 ? b[m] : +((b[m - 1] + b[m]) / 2).toFixed(2);
}
function num(s) {
  if (s == null) return NaN;
  s = String(s).trim();
  if (!s || s === '-') return NaN;
  const pct = s.endsWith('%');
  const v = Number(pct ? s.slice(0, -1) : s);
  return Number.isFinite(v) ? (pct ? v / 100 : v) : NaN;
}

// ===== 读 CSV =====
const raw = fs.readFileSync(CSV, 'utf8').replace(/^﻿/, '');
const lines = raw.split(/\r?\n/).filter(l => l && !l.startsWith('#'));
const header = lines[0].split(',');
const col = (name) => header.indexOf(name);
const C = {
  level: col('关卡'),
  enter: col('进入人数②'),
  failRate: col('失败率②'),
  levelChurn: col('关流失②'),
  plays: col('次数②'),
  failChurn: col('失败流失②')
};
for (const [k, v] of Object.entries(C)) if (v < 0) { console.error('CSV 缺列: ' + k); process.exit(2); }
const csvRows = {};
for (const line of lines.slice(1)) {
  const f = line.split(',');
  const lv = Number(f[C.level]);
  if (!Number.isFinite(lv)) continue;
  csvRows[lv] = {
    level: lv,
    enter: num(f[C.enter]),
    failRate: num(f[C.failRate]),
    levelChurn: num(f[C.levelChurn]),
    plays: num(f[C.plays]),
    failChurn: num(f[C.failChurn])
  };
}

// ===== 读每关结果 =====
const files = fs.readdirSync(RESULTS_DIR).filter(f => /^G2_bq_level_\d+\.json$/.test(f));
const rows = [];
for (const f of files) {
  const r = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, f), 'utf8'));
  const m = r.level.match(/G2_bq_level_(\d+)\.json/);
  const lv = Number(m[1]);
  const c = csvRows[lv] || {};
  rows.push({
    level: lv,
    sampledDeaths: r.sampledDeaths,
    totalDeathsAvailable: r.totalDeathsAvailable,
    attrMedian: r.attributionMedian,
    progMedian: r.deathProgressMedian,
    width16Count: r.width16Count,
    cappedCount: r.cappedCount,
    elapsedSec: r.elapsedSec,
    enter: c.enter, failRate: c.failRate, levelChurn: c.levelChurn,
    plays: c.plays, failChurn: c.failChurn,
    attrMin: r.attributionMin, attrMax: r.attributionMax
  });
}
rows.sort((a, b) => a.level - b.level);

const lv12 = rows.filter(r => r.level >= 2 && r.level <= 13);
const lv9 = lv12.filter(r => r.enter >= 30);

const cols = [
  ['failChurn', '失败流失②'],
  ['plays', '次数②'],
  ['failRate', '失败率②'],
  ['levelChurn', '关流失②']
];
const metrics = [
  ['attrMedian', '归因距离中位数'],
  ['progMedian', '死亡进度中位数']
];

function table(set) {
  const t = {};
  for (const [mk, mn] of metrics) {
    t[mn] = {};
    for (const [ck, cn] of cols) {
      t[mn][cn] = spearman(set.map(r => r[mk]), set.map(r => r[ck]));
    }
  }
  return t;
}

const report = {
  generatedAt: new Date().toISOString(),
  rows,
  n12: { levels: lv12.map(r => r.level), table: table(lv12) },
  n9: { levels: lv9.map(r => r.level), table: table(lv9) },
  attrMedianRange: {
    min: lv12.length ? Math.min(...lv12.map(r => r.attrMedian)) : null,
    minLevels: lv12.filter(r => r.attrMedian === Math.min(...lv12.map(x => x.attrMedian))).map(r => r.level),
    max: lv12.length ? Math.max(...lv12.map(r => r.attrMedian)) : null,
    maxLevels: lv12.filter(r => r.attrMedian === Math.max(...lv12.map(x => x.attrMedian))).map(r => r.level)
  },
  pass12: metrics.some(([mk]) => cols.some(([ck]) => {
    const r = spearman(lv12.map(x => x[mk]), lv12.map(x => x[ck])).rho;
    return r !== null && Math.abs(r) >= 0.6;
  })),
  pass9: metrics.some(([mk]) => cols.some(([ck]) => {
    const r = spearman(lv9.map(x => x[mk]), lv9.map(x => x[ck])).rho;
    return r !== null && Math.abs(r) >= 0.6;
  }))
};
fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

// 控制台表
console.log('level  deaths  attrMed  progMed  进入② 失败率② 关流失② 次数② 失败流失②');
for (const r of rows) {
  const p = (x) => Number.isFinite(x) ? (x * 100).toFixed(1) + '%' : '-';
  console.log(`${String(r.level).padStart(5)} ${String(r.sampledDeaths).padStart(7)} ${String(r.attrMedian).padStart(8)} ${String(r.progMedian).padStart(8)} ${String(r.enter).padStart(6)} ${p(r.failRate).padStart(8)} ${p(r.levelChurn).padStart(8)} ${String(r.plays).padStart(6)} ${p(r.failChurn).padStart(9)}`);
}
for (const [name, set] of [['n=12 L2-L13', lv12], ['n=9 进入>=30', lv9]]) {
  console.log(`\nSpearman ${name} (n=${set.length})`);
  const t = table(set);
  for (const mn of Object.keys(t)) {
    console.log('  ' + mn);
    for (const cn of Object.keys(t[mn])) {
      const v = t[mn][cn];
      console.log(`    ${cn.padEnd(10)} rho=${v.rho} n=${v.n}`);
    }
  }
}
console.log(`\nPASS12=${report.pass12} PASS9=${report.pass9}`);
console.log('attrMedian range: min=' + report.attrMedianRange.min + ' (L' + report.attrMedianRange.minLevels.join(',') + ') max=' + report.attrMedianRange.max + ' (L' + report.attrMedianRange.maxLevels.join(',') + ')');
