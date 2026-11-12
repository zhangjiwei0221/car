#!/usr/bin/env node
'use strict';
/**
 * analyze_routes —— C5 中段代价：通关率 / 死亡进度分布 / 中段代价车实际被拿率
 * C5_中段代价（2026-11-12）
 *
 * 用法：node analyze_routes.js --dir <本实验目录> --out <结果.json>
 * 读取 <dir>/pop_MX/routes_seed*.json 与 <dir>/swaps_final.json。
 *
 * 死亡进度分档（任务口径）：<10% / 10–25% / 25–50% / 50–90% / >90%。
 * 代价车被拿：该局路线里点过 swaps_final 前 N 个交换的 to 格之一。
 */
const fs = require('fs');
const path = require('path');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DIR = arg('--dir', __dirname);
const OUT = arg('--out', path.join(DIR, 'routes_analysis.json'));
const swaps = JSON.parse(fs.readFileSync(path.join(DIR, 'swaps_final.json'), 'utf8'));
const LABELS = ['M0', 'M2', 'M4', 'M5'];
const N = { M0: 0, M2: 2, M4: 4, M5: 5 };

function median(a) { if (!a.length) return null; const b = a.slice().sort((x, y) => x - y), m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; }
const r3 = (x) => x == null ? null : Math.round(x * 1000) / 1000;

function load(lbl) {
  const d = path.join(DIR, 'pop_' + lbl);
  if (!fs.existsSync(d)) return [];
  const games = [];
  for (const f of fs.readdirSync(d).filter(f => /^routes_seed.*\.json$/.test(f)).sort()) {
    const j = JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'));
    for (const g of j.games) games.push({ seed: j.seed, ...g });
  }
  return games;
}

function band(prog) {
  if (prog < 0.10) return 'lt10';
  if (prog < 0.25) return 'p10to25';
  if (prog < 0.50) return 'p25to50';
  if (prog <= 0.90) return 'p50to90';
  return 'gt90';
}

const out = {};
for (const lbl of LABELS) {
  const games = load(lbl);
  if (!games.length) continue;
  const n = games.length;
  const wins = games.filter(g => g.won).length;
  const seedRates = {};
  for (const g of games) {
    seedRates[g.seed] = seedRates[g.seed] || { n: 0, w: 0 };
    seedRates[g.seed].n++; if (g.won) seedRates[g.seed].w++;
  }
  for (const s of Object.keys(seedRates)) seedRates[s].rate = r3(seedRates[s].w / seedRates[s].n);

  const deaths = games.filter(g => !g.won);
  const bands = { lt10: 0, p10to25: 0, p25to50: 0, p50to90: 0, gt90: 0 };
  for (const g of deaths) bands[band(g.deathProgress)]++;
  const bandShare = {};
  for (const k of Object.keys(bands)) bandShare[k] = r3(bands[k] / (deaths.length || 1));

  // 本变体放进中段的代价车格（前 N 个 swap 的 to）
  const use = Math.min(N[lbl] || 0, swaps.length);
  const costCells = new Set(swaps.slice(0, use).map(s => s.to.join(',')));
  const cellInfo = new Map(swaps.slice(0, use).map(s => [s.to.join(','), s]));
  const clicks = [];
  let gamesClickedAny = 0, totalClicks = 0, clicksInMidWindow = 0, gamesClickedMid = 0;
  const perCar = {};
  for (const s of swaps.slice(0, use)) {
    perCar[s.to.join(',')] = { color: s.color, count: s.count, from: s.from.join(','), to: s.to.join(','), gamesPicked: 0, clicks: 0, gains: [], progresses: [] };
  }
  for (const g of games) {
    let any = false, anyMid = false;
    for (const p of g.route) {
      const k = p.r + ',' + p.c;
      if (!costCells.has(k)) continue;
      const s = cellInfo.get(k);
      const rec = perCar[k];
      any = true; totalClicks++; rec.clicks++;
      rec.gains.push(p.gain); rec.progresses.push(p.progress);
      if (p.progress >= 0.30 && p.progress <= 0.60) { clicksInMidWindow++; anyMid = true; }
      clicks.push({ seed: g.seed, won: g.won, step: p.step, progress: r3(p.progress), gain: p.gain, bufferBefore: p.buffer, color: s.color, count: s.count, ratio: r3(p.gain / s.count) });
    }
    // 每局每车只记一次「被拿」
    const pickedKeys = new Set(g.route.map(p => p.r + ',' + p.c));
    for (const k of pickedKeys) if (perCar[k]) perCar[k].gamesPicked++;
    if (any) gamesClickedAny++;
    if (anyMid) gamesClickedMid++;
  }
  const gains = clicks.map(x => x.gain), ratios = clicks.map(x => x.ratio);

  // 按「本局点过 k 辆代价车」分组的胜率
  const byClicks = {};
  for (const g of games) {
    const k = new Set(g.route.map(p => p.r + ',' + p.c).filter(x => costCells.has(x))).size;
    byClicks[k] = byClicks[k] || { n: 0, w: 0 };
    byClicks[k].n++; if (g.won) byClicks[k].w++;
  }
  for (const k of Object.keys(byClicks)) byClicks[k].rate = r3(byClicks[k].w / byClicks[k].n);
  for (const rec of Object.values(perCar)) {
    rec.gainMedian = r3(median(rec.gains));
    rec.progressMedian = r3(median(rec.progresses));
    rec.progressMin = rec.progresses.length ? Math.min(...rec.progresses) : null;
    rec.progressMax = rec.progresses.length ? Math.max(...rec.progresses) : null;
    rec.gamesPicked = rec.clicks > 0 ? rec.gamesPicked : 0; // 只统计至少点过的局
    rec.samples = rec.gains.length;
  }

  out[lbl] = {
    n, wins, winRate: r3(wins / n), seedRates,
    deaths: deaths.length,
    deathStepMedian: r3(median(deaths.map(g => g.deathStep))),
    deathProgressMedian: r3(median(deaths.map(g => g.deathProgress))),
    deathProgressBands: bands, deathProgressBandShare: bandShare,
    costCarsPlaced: use,
    gamesClickedAnyCostCar: gamesClickedAny,
    gamesClickedAnyCostCarShare: r3(gamesClickedAny / n),
    gamesClickedCostMidWindow: gamesClickedMid,
    gamesClickedCostMidWindowShare: r3(gamesClickedMid / n),
    totalCostClicks: totalClicks,
    clicksInMidWindow,
    avgCostClicksPerGame: r3(totalClicks / n),
    costGainMedian: r3(median(gains)), costGainMean: r3(gains.length ? gains.reduce((a, b) => a + b, 0) / gains.length : null),
    costRatioMedian: r3(median(ratios)),
    costClickProgressMedian: r3(median(clicks.map(x => x.progress))),
    perCar, byClicks
  };
}

console.log('变体 辆数 通关率  种子(977/4242/31337)  死亡  <10% 10-25 25-50 50-90 >90  点过代价车局  中段(30-60%)点过  总点击  点击progress中位 gain中位');
for (const lbl of LABELS) {
  const o = out[lbl]; if (!o) continue;
  const sr = [977, 4242, 31337].map(s => (o.seedRates[s] ? o.seedRates[s].rate.toFixed(2) : '—')).join('/');
  const b = o.deathProgressBands;
  console.log(`${lbl.padEnd(4)} ${String(o.costCarsPlaced).padEnd(4)} ${o.winRate.toFixed(3)}  ${sr.padEnd(20)} ${String(o.deaths).padEnd(4)} ${String(b.lt10).padEnd(4)} ${String(b.p10to25).padEnd(5)} ${String(b.p25to50).padEnd(5)} ${String(b.p50to90).padEnd(4)} ${String(b.gt90).padEnd(3)}  ${o.gamesClickedAnyCostCar}/${o.n}(${o.gamesClickedAnyCostCarShare.toFixed(2)})  ${o.gamesClickedCostMidWindow}/${o.n}(${o.gamesClickedCostMidWindowShare.toFixed(2)})  ${o.totalCostClicks}  ${String(o.costClickProgressMedian).padEnd(4)} ${o.costGainMedian}`);
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log('\n结果: ' + path.resolve(OUT));
