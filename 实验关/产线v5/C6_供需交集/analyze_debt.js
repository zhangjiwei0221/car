#!/usr/bin/env node
'use strict';
/**
 * analyze_debt —— C6 供需交集：玩家「看面积估容量」导致的背债 + 还债时长
 *
 * 用法：
 *   node analyze_debt.js --routes <C6/routes> --levels <分组2目录> \
 *     --csv <分组2-20261110-新指标.csv> --out <debt_summary.json>
 *
 * 背债口径（任务定义）：
 *   沿 PopulationSim_v1 random 路线，对每一步被点的车记录
 *     capacity      = 该车 count（antBox.count）
 *     reachBefore   = 点击前该颜色可达未消除像素（Sim.floodFillCount，消除矩阵副本）
 *     visibleBefore = 点击前该颜色未消除像素总数（可达 + 被挡）
 *     debtOnPick    = max(0, capacity - reachBefore)
 *     deception     = 1 - reachBefore / visibleBefore
 *   每关汇总 mean/median debt、p80 debt、mean deception；并按通关/失败局拆分。
 *
 * 还债时长口径（补充任务）：
 *   每辆车进入暂存的那一刻开始计时；当步就吃满离场 = 0；
 *   否则从进场 pick 到离场 pick 之间隔了几个 pick（离场 pick - 进场 pick）；
 *   到局终仍未离场 = 99（未还）。
 *   统计 repayMedian / repayP90（只在已还事件上算）、neverRepaidShare（99 占比）。
 */

const fs = require('fs');
const path = require('path');
const B = require('../../../03_工具/正式版/Build006Thickness_v688');
const A = B.loadSolver('corner');
const Sim = A.Simulator;

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ROUTES = arg('--routes', path.join(__dirname, 'routes'));
const LEVELS = arg('--levels', path.join(__dirname, '../../../测试版本/2026_11_05/分组2'));
const CSV = arg('--csv', path.join(__dirname, '../../../测试版本/2026_11_05/分组2-20261110-新指标.csv'));
const OUT = arg('--out', path.join(__dirname, 'debt_summary.json'));
const LEVEL_IDS = (arg('--level-ids', '2,3,4,5,6,7,8,9,10,11,12,13'))
  .split(',').map(s => Number(s.trim())).filter(Number.isFinite);

const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
function median(a) {
  if (!a.length) return null;
  const b = a.slice().sort((x, y) => x - y), m = b.length >> 1;
  return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
}
function quantile(a, q) {
  if (!a.length) return null;
  const b = a.slice().sort((x, y) => x - y);
  const pos = (b.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return b[lo] + (b[hi] - b[lo]) * (pos - lo);
}
const r3 = x => x == null ? null : Math.round(x * 1000) / 1000;

function parseCsv(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  const lines = text.split(/\r?\n/).filter(l => l.trim().length);
  const header = lines[0].split(',');
  const idx = name => header.indexOf(name);
  const cols = {
    level: idx('关卡'),
    fail: idx('失败率②'),
    levelChurn: idx('关流失②'),
    failChurn: idx('失败流失②')
  };
  for (const [k, v] of Object.entries(cols)) if (v < 0) throw new Error('CSV 缺列: ' + k);
  const pct = s => {
    if (s == null) return null;
    const t = String(s).trim();
    if (!t || t === '-') return null;
    const x = parseFloat(t.replace('%', ''));
    return Number.isFinite(x) ? x : null;
  };
  const rows = {};
  for (const line of lines.slice(1)) {
    const f = line.split(',');
    const id = Number(f[cols.level]);
    if (!Number.isFinite(id)) continue;
    rows[id] = {
      failRate: pct(f[cols.fail]),
      levelChurn: pct(f[cols.levelChurn]),
      failChurn: pct(f[cols.failChurn])
    };
  }
  return rows;
}

// —— Spearman（平均秩处理并列）——
function ranks(a) {
  const idx = a.map((v, i) => ({ v, i })).sort((x, y) => x.v - y.v);
  const out = new Array(a.length);
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1].v === idx[i].v) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[idx[k].i] = r;
    i = j + 1;
  }
  return out;
}
function normCdf(x) { // Abramowitz-Stegun 7.1.26
  const s = x < 0 ? -1 : 1, z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return 0.5 * (1 + s * y);
}
function spearman(xs, ys) {
  const pairs = xs.map((x, i) => [x, ys[i]]).filter(([x, y]) => x != null && y != null);
  const n = pairs.length;
  if (n < 4) return { n, rho: null, p: null };
  const rx = ranks(pairs.map(p => p[0])), ry = ranks(pairs.map(p => p[1]));
  const mx = mean(rx), my = mean(ry);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    num += (rx[i] - mx) * (ry[i] - my);
    dx += (rx[i] - mx) ** 2;
    dy += (ry[i] - my) ** 2;
  }
  if (!dx || !dy) return { n, rho: null, p: null };
  const rho = num / Math.sqrt(dx * dy);
  const z = rho * Math.sqrt(n - 1);           // Spearman 的正态近似
  return { n, rho, p: 2 * (1 - normCdf(Math.abs(z))) };
}
function binom(n, k) {
  let r = 1;
  for (let i = 1; i <= k; i++) r = r * (n - k + i) / i;
  return r;
}
// 符号检验（双侧，忽略 0）：n 个配对里正/负各多少
function signTest(pos, neg) {
  const n = pos + neg;
  if (!n) return null;
  const k = Math.max(pos, neg);
  let s = 0;
  for (let i = k; i <= n; i++) s += binom(n, i);
  return Math.min(1, 2 * s / Math.pow(2, n));
}
function testDiffs(ds) {
  const v = ds.filter(x => x != null);
  const pos = v.filter(x => x > 0).length, neg = v.filter(x => x < 0).length;
  return { n: v.length, pos, neg, zero: v.length - pos - neg, median: r3(median(v)), signP: r3(signTest(pos, neg)) };
}

// —— 回放一局：每次点击算 debt + 跟踪每辆车在暂存区的滞留时长 ——
function replayGame(lv, game) {
  const s = Sim.createState(lv, { useSlotStart: true, bottomOnly: false, instantChain: false });
  const clicks = [];
  const repayEvents = [];          // 所有进过暂存的车（含锁链组员）
  const repayClicked = [];         // 只统计被点的车
  const entryAt = new Map();       // buffer key -> 进场 pick 下标（0-based）
  // 初始暂存（正常为 0；若有，视为开局前入场）
  for (const b of s.buffer) entryAt.set(b.key, 0);

  for (let i = 0; i < game.route.length; i++) {
    const p = game.route[i];
    const moves = Sim.listMoves(s).filter(m => !m.blocked);
    const m = moves.find(x => x.r === p.r && x.c === p.c);
    if (!m) throw new Error(`回放卡住：点 (${p.r},${p.c}) 不在合法列表`);
    const capacity = m.antBox.count;
    const color = m.antBox.color;
    const em = s.eliminated.map(row => row.slice());
    const reach = Sim.floodFillCount(em, s.blocks, s.rows, s.cols, color, s.bottomOnly);
    let visible = 0;
    for (let r = 0; r < s.rows; r++) for (let c = 0; c < s.cols; c++) {
      if (!s.eliminated[r][c] && s.blocks[r][c] === color) visible++;
    }
    const debt = Math.max(0, capacity - reach);
    const deception = visible > 0 ? 1 - reach / visible : 0;
    clicks.push({
      step: p.step, r: p.r, c: p.c, color, capacity, reach, visible,
      debt, deception, gain: p.gain, progress: p.progress, buffer: p.buffer
    });

    const keyBefore = s._keySeq;
    const beforeKeys = new Set(s.buffer.map(b => b.key));
    if (!Sim.applyPick(s, p.r, p.c)) throw new Error(`applyPick 失败：step ${p.step} (${p.r},${p.c})`);
    const afterKeys = new Map(s.buffer.map(b => [b.key, b]));

    // 本次点击新产生的车（含锁链组员）：仍在暂存 → 记进场；已离场 → 当步吃完，0
    const clickedKey = keyBefore + 1;
    for (let k = keyBefore + 1; k <= s._keySeq; k++) {
      if (afterKeys.has(k)) {
        entryAt.set(k, i);
        if (k === clickedKey) repayClicked.push({ key: k, color, entered: i, exit: null, duration: null });
      } else {
        const ev = { key: k, color, entered: i, exit: i, duration: 0 };
        repayEvents.push(ev);
        if (k === clickedKey) repayClicked.push({ key: k, color, entered: i, exit: i, duration: 0 });
      }
    }
    // 本次点击后离场的旧车
    for (const key of beforeKeys) {
      if (!afterKeys.has(key)) {
        if (!entryAt.has(key)) entryAt.set(key, 0);
        const d = i - entryAt.get(key);
        const ev = { key, color: null, entered: entryAt.get(key), exit: i, duration: d };
        repayEvents.push(ev);
        const ci = repayClicked.findIndex(x => x.key === key && x.exit == null);
        if (ci >= 0) { repayClicked[ci].exit = i; repayClicked[ci].duration = d; }
        entryAt.delete(key);
      }
    }
    // 更新已进场但尚未登记到 repayEvents 的 clicked 事件的颜色（后续离场按 key 补）
    for (const b of afterKeys.values()) if (b.key === clickedKey && !repayClicked.some(x => x.key === clickedKey)) {
      repayClicked.push({ key: clickedKey, color, entered: i, exit: null, duration: null });
    }
  }

  // 局终仍在暂存的 = 99（未还）
  for (const b of s.buffer) {
    const ev = { key: b.key, color: b.color, entered: entryAt.has(b.key) ? entryAt.get(b.key) : 0, exit: null, duration: 99 };
    repayEvents.push(ev);
    const ci = repayClicked.findIndex(x => x.key === b.key && x.exit == null);
    if (ci >= 0) { repayClicked[ci].duration = 99; }
  }
  // 未在局终 buffer 里、但 clicked 仍 exit=null 的，理论上不会发生；保险记 99
  for (const x of repayClicked) if (x.duration == null) x.duration = 99;

  const won = s.eliminatedPixels >= s.totalPixels;
  if (won !== !!game.won) throw new Error(`胜负不一致：模拟=${won} 记录=${game.won}`);
  return { won, clicks, repayEvents, repayClicked };
}

function summarizeDebt(clicks) {
  const debts = clicks.map(x => x.debt);
  const decs = clicks.map(x => x.deception);
  return {
    clicks: clicks.length,
    debtMean: r3(mean(debts)),
    debtMedian: r3(median(debts)),
    debtP80: r3(quantile(debts, 0.8)),
    deceptionMean: r3(mean(decs)),
    deceptionMedian: r3(median(decs)),
    zeroDebtShare: r3(debts.length ? debts.filter(d => d === 0).length / debts.length : null)
  };
}

function summarizeRepay(events) {
  const repaid = events.filter(e => e.duration !== 99).map(e => e.duration);
  const debtCars = events.filter(e => e.duration > 0 && e.duration !== 99).map(e => e.duration);
  const never = events.filter(e => e.duration === 99).length;
  return {
    cars: events.length,
    repaidCars: repaid.length,
    debtCars: debtCars.length,
    neverCars: never,
    repayMedian: r3(median(repaid)),
    repayP90: r3(quantile(repaid, 0.9)),
    repayMean: r3(mean(repaid)),
    repayMedianDebt: r3(median(debtCars)),
    repayP90Debt: r3(quantile(debtCars, 0.9)),
    repayMeanDebt: r3(mean(debtCars)),
    neverRepaidShare: r3(events.length ? never / events.length : null)
  };
}

function gameRepaySummary(events) {
  const x = summarizeRepay(events);
  return { repayMedian: x.repayMedian, repayMedianDebt: x.repayMedianDebt, neverRepaidShare: x.neverRepaidShare, cars: x.cars };
}

const csv = parseCsv(CSV);
const out = {
  meta: { routes: ROUTES, levels: LEVELS, csv: CSV, levelIds: LEVEL_IDS, generatedBy: 'analyze_debt.js', pid: process.pid },
  csv, levels: {}
};

for (const id of LEVEL_IDS) {
  const name = `G2_bq_level_${id}.json`;
  const routeFile = path.join(ROUTES, `level_${id}`, 'routes_seed977.json');
  const levelFile = path.join(LEVELS, name);
  if (!fs.existsSync(routeFile)) throw new Error('缺路线: ' + routeFile);
  if (!fs.existsSync(levelFile)) throw new Error('缺关卡: ' + levelFile);

  const routeJson = JSON.parse(fs.readFileSync(routeFile, 'utf8'));
  const gameJson = JSON.parse(fs.readFileSync(levelFile, 'utf8'));
  const lv = A.parseLevel(A.fromGameFormat(gameJson));

  const games = [];
  const allClicks = [], winClicks = [], loseClicks = [];
  const allRepay = [], winRepay = [], loseRepay = [];
  const allRepayClicked = [], winRepayClicked = [], loseRepayClicked = [];
  const openingDebtAll = [], openingDebtWin = [], openingDebtLose = [];
  for (const g of routeJson.games) {
    const r = replayGame(lv, g);
    const gameSum = summarizeDebt(r.clicks);
    const gameRepay = gameRepaySummary(r.repayEvents);
    games.push({ won: r.won, steps: r.clicks.length, ...gameSum, ...gameRepay });
    allClicks.push(...r.clicks);
    allRepay.push(...r.repayEvents);
    allRepayClicked.push(...r.repayClicked);
    if (r.won) { winClicks.push(...r.clicks); winRepay.push(...r.repayEvents); winRepayClicked.push(...r.repayClicked); }
    else { loseClicks.push(...r.clicks); loseRepay.push(...r.repayEvents); loseRepayClicked.push(...r.repayClicked); }
    const open = r.clicks.slice(0, 5).map(x => x.debt);
    openingDebtAll.push(...open);
    (r.won ? openingDebtWin : openingDebtLose).push(...open);
  }

  const wins = games.filter(g => g.won);
  const losses = games.filter(g => !g.won);
  const gameDebtW = wins.map(g => g.debtMean);
  const gameDebtL = losses.map(g => g.debtMean);
  const gameDecW = wins.map(g => g.deceptionMean);
  const gameDecL = losses.map(g => g.deceptionMean);
  const gameRepayMedW = wins.map(g => g.repayMedian).filter(x => x != null);
  const gameRepayMedL = losses.map(g => g.repayMedian).filter(x => x != null);
  const gameNeverW = wins.map(g => g.neverRepaidShare).filter(x => x != null);
  const gameNeverL = losses.map(g => g.neverRepaidShare).filter(x => x != null);

  const all = summarizeDebt(allClicks);
  const repay = summarizeRepay(allRepay);
  const repayClicked = summarizeRepay(allRepayClicked);
  const repayWin = summarizeRepay(winRepay);
  const repayLose = summarizeRepay(loseRepay);
  const repayClickedWin = summarizeRepay(winRepayClicked);
  const repayClickedLose = summarizeRepay(winRepayClicked);

  out.levels[id] = {
    level: id,
    games: games.length,
    wins: wins.length,
    losses: losses.length,
    winRate: r3(wins.length / games.length),
    all,
    opening5: summarizeDebt(openingDebtAll.map(d => ({ debt: d, deception: 0 }))),
    win: summarizeDebt(winClicks),
    lose: summarizeDebt(loseClicks),
    repay,
    repayClicked,
    repayWin,
    repayLose,
    repayClickedWin,
    repayClickedLose,
    gameAvg: {
      debtMeanWin: r3(mean(gameDebtW)),
      debtMeanLose: r3(mean(gameDebtL)),
      debtMeanDiffLoseMinusWin: r3((mean(gameDebtL) == null || mean(gameDebtW) == null) ? null : mean(gameDebtL) - mean(gameDebtW)),
      deceptionMeanWin: r3(mean(gameDecW)),
      deceptionMeanLose: r3(mean(gameDecL)),
      deceptionDiffLoseMinusWin: r3((mean(gameDecL) == null || mean(gameDecW) == null) ? null : mean(gameDecL) - mean(gameDecW)),
      repayMedianWin: r3(median(gameRepayMedW)),
      repayMedianLose: r3(median(gameRepayMedL)),
      repayMedianDiffLoseMinusWin: r3((median(gameRepayMedW) == null || median(gameRepayMedL) == null) ? null : median(gameRepayMedL) - median(gameRepayMedW)),
      neverRepaidShareWin: r3(mean(gameNeverW)),
      neverRepaidShareLose: r3(mean(gameNeverL)),
      neverRepaidShareDiffLoseMinusWin: r3((mean(gameNeverW) == null || mean(gameNeverL) == null) ? null : mean(gameNeverL) - mean(gameNeverW))
    },
    opening5GameAvg: {
      debtMeanWin: r3(mean(openingDebtWin)),
      debtMeanLose: r3(mean(openingDebtLose)),
      debtMeanDiffLoseMinusWin: r3((mean(openingDebtWin) == null || mean(openingDebtLose) == null) ? null : mean(openingDebtLose) - mean(openingDebtWin))
    },
    csv: csv[id] || null,
    gamesDetail: games
  };
}

// —— 12 关汇总表 ——
const rows = LEVEL_IDS.map(id => {
  const x = out.levels[id];
  const gm = x.gamesDetail.map(g => g.debtMean);
  const gd = x.gamesDetail.map(g => g.deceptionMean);
  return {
    level: id,
    winRate: x.winRate,
    debtMean: x.all.debtMean,
    debtMedian: x.all.debtMedian,
    debtP80: x.all.debtP80,
    debtMedianGame: r3(median(gm)),
    deceptionMean: x.all.deceptionMean,
    deceptionMedianGame: r3(median(gd)),
    openingDebtMean: x.opening5.debtMean,
    repayMedian: x.repay.repayMedian,
    repayP90: x.repay.repayP90,
    repayMedianDebt: x.repay.repayMedianDebt,
    repayP90Debt: x.repay.repayP90Debt,
    neverRepaidShare: x.repay.neverRepaidShare,
    repayMedianClicked: x.repayClicked.repayMedian,
    failRate: x.csv ? x.csv.failRate : null,
    levelChurn: x.csv ? x.csv.levelChurn : null,
    failChurn: x.csv ? x.csv.failChurn : null
  };
});
out.table = rows;

// —— Spearman ——
const corr = {};
for (const metric of ['debtMean', 'debtMedian', 'debtMedianGame', 'debtP80', 'deceptionMean', 'deceptionMedianGame', 'openingDebtMean', 'repayMedian', 'repayP90', 'repayMedianDebt', 'repayP90Debt', 'neverRepaidShare', 'repayMedianClicked']) {
  for (const target of ['failRate', 'levelChurn', 'failChurn', 'winRate']) {
    const r = spearman(rows.map(x => x[metric]), rows.map(x => x[target]));
    corr[`${metric}~${target}`] = { n: r.n, rho: r.rho == null ? null : r3(r.rho), p: r.p == null ? null : r3(r.p) };
  }
}
out.correlation = corr;

// —— 同关内：通关 vs 失败 ——
const within = rows.map(x => {
  const l = out.levels[x.level];
  return {
    level: x.level,
    debtWin: l.gameAvg.debtMeanWin,
    debtLose: l.gameAvg.debtMeanLose,
    debtDiff: l.gameAvg.debtMeanDiffLoseMinusWin,
    deceptionWin: l.gameAvg.deceptionMeanWin,
    deceptionLose: l.gameAvg.deceptionMeanLose,
    deceptionDiff: l.gameAvg.deceptionDiffLoseMinusWin,
    repayMedianWin: l.repay.repayMedian,
    repayMedianLose: l.repayLose.repayMedian,
    repayMedianDiffLoseMinusWin: r3((l.repay.repayMedian == null || l.repayLose.repayMedian == null) ? null : l.repayLose.repayMedian - l.repay.repayMedian),
    repayMedianDebtWin: l.repayWin.repayMedianDebt,
    repayMedianDebtLose: l.repayLose.repayMedianDebt,
    repayMedianDebtDiffLoseMinusWin: r3((l.repayWin.repayMedianDebt == null || l.repayLose.repayMedianDebt == null) ? null : l.repayLose.repayMedianDebt - l.repayWin.repayMedianDebt),
    neverRepaidShareWin: l.repayWin.neverRepaidShare,
    neverRepaidShareLose: l.repayLose.neverRepaidShare,
    neverRepaidShareDiffLoseMinusWin: r3((l.repayWin.neverRepaidShare == null || l.repayLose.neverRepaidShare == null) ? null : l.repayLose.neverRepaidShare - l.repayWin.neverRepaidShare),
    openingDebtWin: l.opening5GameAvg.debtMeanWin,
    openingDebtLose: l.opening5GameAvg.debtMeanLose,
    openingDebtDiff: l.opening5GameAvg.debtMeanDiffLoseMinusWin
  };
});
out.withinLevel = within;
out.withinTests = {
  debtDiff: testDiffs(within.map(x => x.debtDiff)),
  deceptionDiff: testDiffs(within.map(x => x.deceptionDiff)),
  repayMedianDebtDiff: testDiffs(within.map(x => x.repayMedianDebtDiffLoseMinusWin)),
  neverRepaidShareDiff: testDiffs(within.map(x => x.neverRepaidShareDiffLoseMinusWin)),
  openingDebtDiff: testDiffs(within.map(x => x.openingDebtDiff))
};
out.summary = {
  levelsRepayMedianLoseHigher: within.filter(x => x.repayMedianDiffLoseMinusWin > 0).length,
  levelsRepayMedianDebtLoseHigher: within.filter(x => x.repayMedianDebtDiffLoseMinusWin > 0).length,
  levelsNeverShareLoseHigher: within.filter(x => x.neverRepaidShareDiffLoseMinusWin > 0).length,
  levelsDebtLoseHigher: within.filter(x => x.debtDiff > 0).length,
  levelsOpeningDebtLoseHigher: within.filter(x => x.openingDebtDiff > 0).length,
  totalLevels: LEVEL_IDS.length
};

fs.writeFileSync(OUT, JSON.stringify(out, null, 1));

console.log('关卡 胜率  debt均值 debt中位 p80  deception 开局debt repay中位 debt中位 p90d 未还比例 | 失败率② 关流失② 失败流失②');
for (const x of rows) {
  console.log([
    String(x.level).padEnd(3), String(x.winRate).padEnd(5),
    String(x.debtMean).padEnd(7), String(x.debtMedian).padEnd(7), String(x.debtP80).padEnd(5),
    String(x.deceptionMean).padEnd(9), String(x.openingDebtMean).padEnd(8),
    String(x.repayMedian).padEnd(8), String(x.repayMedianDebt).padEnd(8), String(x.repayP90Debt).padEnd(5), String(x.neverRepaidShare).padEnd(7),
    '|', String(x.failRate).padEnd(7), String(x.levelChurn).padEnd(8), String(x.failChurn)
  ].join(' '));
}
console.log('\nSpearman:');
for (const [k, v] of Object.entries(corr)) console.log(`  ${k.padEnd(40)} n=${v.n} rho=${v.rho} p=${v.p}`);
console.log('\n关内胜负（局均 debt / repay 中位 / 未还比例，lose - win）:');
for (const x of within) {
  console.log(`  关${String(x.level).padEnd(2)} debt win=${String(x.debtWin).padEnd(7)} lose=${String(x.debtLose).padEnd(7)} diff=${String(x.debtDiff).padEnd(7)} | repayDebt diff=${String(x.repayMedianDebtDiffLoseMinusWin).padEnd(7)} | 未还 diff=${String(x.neverRepaidShareDiffLoseMinusWin).padEnd(6)} | 开局debt diff=${x.openingDebtDiff}`);
}
console.log(`\n方向计数（失败局更高）: debt ${out.summary.levelsDebtLoseHigher}/${out.summary.totalLevels} · repayDebt中位 ${out.summary.levelsRepayMedianDebtLoseHigher}/${out.summary.totalLevels} · 未还比例 ${out.summary.levelsNeverShareLoseHigher}/${out.summary.totalLevels} · 开局debt ${out.summary.levelsOpeningDebtLoseHigher}/${out.summary.totalLevels}`);
console.log('\n关内符号检验（双侧，零差忽略）:');
for (const [k, v] of Object.entries(out.withinTests)) {
  console.log(`  ${k.padEnd(26)} +${v.pos}/-${v.neg}/0:${v.zero}  中位差=${v.median}  p=${v.signP}`);
}
console.log('\n结果: ' + path.resolve(OUT));
