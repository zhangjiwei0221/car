#!/usr/bin/env node
'use strict';
/**
 * analyze_grid —— C7 开局网格：汇总 12 个变体的通关率 / 熵 / 死亡进度分布 / 开局可点 / 救援车
 * C7_开局网格（2026-11-12）
 *
 * 用法：node analyze_grid.js --dir <本实验目录> --out <汇总.json>
 *
 * 读取：pop_<变体>/routes_seed*.json、cs_<变体>.json、open_<变体>.json。
 * 死亡进度分档（任务口径）：<10% / 10–25% / 25–50% / 50–90% / >90%。
 */
const fs = require('fs');
const path = require('path');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DIR = arg('--dir', __dirname);
const OUT = arg('--out', path.join(DIR, 'grid_summary.json'));
const NAMES = [];
for (const a of [7, 6, 5, 4]) for (const b of [0, 1, 2]) NAMES.push(`A${a}_B${b}`);
const SEEDS = [977, 4242, 31337];
const r3 = (x) => x == null ? null : Math.round(x * 1000) / 1000;
function band(p) {
  if (p < 0.10) return 'lt10';
  if (p < 0.25) return 'p10to25';
  if (p < 0.50) return 'p25to50';
  if (p <= 0.90) return 'p50to90';
  return 'gt90';
}
const out = {};
for (const name of NAMES) {
  const dir = path.join(DIR, 'pop_' + name);
  if (!fs.existsSync(dir)) { console.error('缺少 ' + dir); continue; }
  const games = [];
  for (const f of fs.readdirSync(dir).filter(f => /^routes_seed.*\.json$/.test(f)).sort()) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const g of j.games) games.push({ seed: j.seed, ...g });
  }
  const n = games.length;
  const wins = games.filter(g => g.won).length;
  const seedRates = {};
  for (const g of games) {
    if (!seedRates[g.seed]) seedRates[g.seed] = { n: 0, w: 0 };
    seedRates[g.seed].n++; if (g.won) seedRates[g.seed].w++;
  }
  for (const s of Object.keys(seedRates)) seedRates[s].rate = r3(seedRates[s].w / seedRates[s].n);
  const deaths = games.filter(g => !g.won);
  const bands = { lt10: 0, p10to25: 0, p25to50: 0, p50to90: 0, gt90: 0 };
  for (const g of deaths) bands[band(g.deathProgress)]++;
  const bandShare = {};
  for (const k of Object.keys(bands)) bandShare[k] = deaths.length ? r3(bands[k] / deaths.length) : 0;
  const csFile = path.join(DIR, 'cs_' + name + '.json');
  let entropy = null, avgM = null, forcedSteps = null, fakeChoiceSteps = null, overloadSteps = null;
  if (fs.existsSync(csFile)) {
    const cs = JSON.parse(fs.readFileSync(csFile, 'utf8'));
    const row = (cs.rows || [])[0];
    if (row) { entropy = r3(row.avgEntropy); avgM = r3(row.avgM); forcedSteps = row.forcedSteps; fakeChoiceSteps = row.fakeChoiceSteps; overloadSteps = row.overloadSteps; }
  }
  const openFile = path.join(DIR, 'open_' + name + '.json');
  let opening = null;
  if (fs.existsSync(openFile)) opening = JSON.parse(fs.readFileSync(openFile, 'utf8'));
  out[name] = {
    n, wins, winRate: r3(wins / n), seedRates: SEEDS.map(s => seedRates[s] ? seedRates[s].rate : null),
    deaths: deaths.length, deathStepMedian: deaths.length ? r3(deaths.map(g => g.deathStep).sort((a, b) => a - b)[deaths.length >> 1]) : null,
    deathProgressMedian: deaths.length ? r3(deaths.map(g => g.deathProgress).sort((a, b) => a - b)[deaths.length >> 1]) : null,
    deathBands: bands, deathBandShare: bandShare,
    entropy, avgM, forcedSteps, fakeChoiceSteps, overloadSteps,
    openingLegalMoves: opening ? opening.openingLegalMoves : null,
    openingRow0Moves: opening ? opening.openingRow0Moves : null,
    rescueCars: opening ? opening.rescueCars : null,
    row0RescueCars: opening ? opening.row0RescueCars : null,
    frozen: opening ? opening.frozen : null,
    openingCells: opening ? opening.cells : null
  };
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
const pct = (x) => x == null ? '—' : (x * 100).toFixed(0) + '%';
console.log('变体    通关率(977/4242/31337) 均值  死亡  <10 10-25 25-50 50-90 >90  熵    开局可点 救援车');
for (const name of NAMES) {
  const o = out[name]; if (!o) continue;
  const sr = o.seedRates.map(x => x == null ? '—' : x.toFixed(2)).join('/');
  const b = o.deathBands;
  console.log(`${name.padEnd(7)} ${sr.padEnd(20)} ${o.winRate.toFixed(3)} ${String(o.deaths).padEnd(4)} ${String(b.lt10).padEnd(3)} ${String(b.p10to25).padEnd(5)} ${String(b.p25to50).padEnd(5)} ${String(b.p50to90).padEnd(4)} ${String(b.gt90).padEnd(3)} ${String(o.entropy).padEnd(5)} ${String(o.openingLegalMoves).padEnd(8)} ${o.rescueCars}`);
}
console.log('\n结果: ' + path.resolve(OUT));
