#!/usr/bin/env node
'use strict';
/**
 * analyze_routes —— C3 标定曲线：通关率 / 死亡分布 / 代价车实际被点情况
 * C3_标定曲线（2026-11-12）
 *
 * 用法：node analyze_routes.js --dir <本实验目录> --out <结果.json>
 * 读取 <dir>/pop_VX/routes_seed*.json 与 <dir>/swaps.json。
 */
const fs = require('fs');
const path = require('path');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DIR = arg('--dir', __dirname);
const OUT = arg('--out', path.join(DIR, 'routes_analysis.json'));
const swaps = JSON.parse(fs.readFileSync(path.join(DIR, 'swaps.json'), 'utf8'));
const labels = ['V0', 'V2', 'V4', 'V6', 'V8', 'V9', 'V10'];
const N = { V0: 0, V2: 2, V4: 4, V6: 6, V8: 8, V9: 9, V10: 10 };

function median(a) {
  if (!a.length) return null;
  const b = a.slice().sort((x, y) => x - y), m = b.length >> 1;
  return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
}
const r3 = (x) => x == null ? null : Math.round(x * 1000) / 1000;

function load(lbl) {
  const d = path.join(DIR, 'pop_' + lbl);
  const games = [];
  for (const f of fs.readdirSync(d).filter(f => /^routes_seed.*\.json$/.test(f)).sort()) {
    const j = JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'));
    for (const g of j.games) games.push({ seed: j.seed, ...g });
  }
  return games;
}

const out = {};
for (const lbl of labels) {
  const games = load(lbl);
  const n = games.length;
  const wins = games.filter(g => g.won).length;
  const seedRates = {};
  for (const g of games) {
    seedRates[g.seed] = seedRates[g.seed] || { n: 0, w: 0 };
    seedRates[g.seed].n++; if (g.won) seedRates[g.seed].w++;
  }
  for (const s of Object.keys(seedRates)) seedRates[s].rate = r3(seedRates[s].w / seedRates[s].n);

  const deaths = games.filter(g => !g.won);
  const dSteps = deaths.map(g => g.deathStep);
  const dProg = deaths.map(g => g.deathProgress);
  const early5 = deaths.filter(g => g.deathStep <= 5).length;
  const lateStep = deaths.filter(g => g.deathStep > 5).length;
  const p0 = deaths.filter(g => g.deathProgress < 0.5).length;
  const mid = deaths.filter(g => g.deathProgress >= 0.5 && g.deathProgress <= 0.9).length;
  const late = deaths.filter(g => g.deathProgress > 0.9).length;

  // 本变体放进开局的代价车格（前 N 个 swap 的 to）
  const costCells = new Set(swaps.slice(0, N[lbl]).map(s => s.to.join(',')));
  const costInfo = [];
  let gamesClickedAny = 0;
  let totalClicks = 0;
  const clickCounts = [];
  for (const g of games) {
    let clicks = 0;
    for (const p of g.route) {
      const k = p.r + ',' + p.c;
      if (!costCells.has(k)) continue;
      clicks++;
      const sw = swaps.slice(0, N[lbl]).find(s => s.to.join(',') === k);
      costInfo.push({
        seed: g.seed, won: g.won, step: p.step, progress: r3(p.progress),
        gain: p.gain, bufferBefore: p.buffer, ratio: r3(p.gain / (sw ? sw.count : 43)),
        color: sw ? sw.color : null, deathStep: g.deathStep
      });
    }
    clickCounts.push(clicks);
    if (clicks > 0) gamesClickedAny++;
    totalClicks += clicks;
  }
  const gains = costInfo.map(x => x.gain);
  const ratios = costInfo.map(x => x.ratio);
  const buffers = costInfo.map(x => x.bufferBefore);
  const steps = costInfo.map(x => x.step);

  // 按「点了 k 辆代价车」分组的胜率与死亡位置
  const byClicks = {};
  for (const g of games) {
    const k = g.route.filter(p => costCells.has(p.r + ',' + p.c)).length;
    byClicks[k] = byClicks[k] || { n: 0, w: 0, deathProg: [], deathStep: [] };
    byClicks[k].n++;
    if (g.won) byClicks[k].w++;
    else { byClicks[k].deathProg.push(g.deathProgress); byClicks[k].deathStep.push(g.deathStep); }
  }

  out[lbl] = {
    n, wins, winRate: r3(wins / n), seedRates,
    deaths: deaths.length,
    deathStepMedian: r3(median(dSteps)), deathProgressMedian: r3(median(dProg)),
    deathEarlyStep5: early5, deathEarlyStep5Share: r3(early5 / (deaths.length || 1)),
    deathEarlyProgress: p0, deathMidProgress: mid, deathLateProgress: late,
    deathProgressBands: {
      lt50: p0, p50to90: mid, gt90: late,
      lt50Share: r3(p0 / (deaths.length || 1)),
      p50to90Share: r3(mid / (deaths.length || 1)),
      gt90Share: r3(late / (deaths.length || 1))
    },
    costCars: N[lbl],
    gamesClickedAnyCostCar: gamesClickedAny,
    gamesClickedAnyCostCarShare: r3(gamesClickedAny / n),
    totalCostClicks: totalClicks,
    avgCostClicksPerGame: r3(totalClicks / n),
    costGainMedian: r3(median(gains)),
    costRatioMedian: r3(median(ratios)),
    costRatioMean: r3(ratios.length ? ratios.reduce((a, b) => a + b, 0) / ratios.length : null),
    costBufferBeforeMedian: r3(median(buffers)),
    costFirstStepMedian: r3(median(steps)),
    byClicks
  };
}

// 控制台表
console.log('变体  代价车  通关率  种子(977/4242/31337)   死亡  死≤5步  死0-50%  死50-90%  死>90%  点过代价车局  代价车吃到px中位  ratio中位');
for (const lbl of labels) {
  const o = out[lbl];
  const sr = [977, 4242, 31337].map(s => (o.seedRates[s] ? o.seedRates[s].rate.toFixed(2) : '—')).join('/');
  console.log(`${lbl.padEnd(5)} ${String(o.costCars).padEnd(6)} ${o.winRate.toFixed(3)}  ${sr.padEnd(22)} ${String(o.deaths).padEnd(5)} ${String(o.deathEarlyStep5).padEnd(7)} ${String(o.deathProgressBands.lt50).padEnd(8)} ${String(o.deathProgressBands.p50to90).padEnd(9)} ${String(o.deathProgressBands.gt90).padEnd(7)} ${o.gamesClickedAnyCostCar}/${o.n} (${o.gamesClickedAnyCostCarShare.toFixed(2)})  ${String(o.costGainMedian).padEnd(14)} ${o.costRatioMedian}`);
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log('\n结果: ' + path.resolve(OUT));
