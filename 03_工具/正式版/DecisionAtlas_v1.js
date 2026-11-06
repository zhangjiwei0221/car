#!/usr/bin/env node
'use strict';
/**
 * DecisionAtlas_v1 —— 决策图谱（玩家引擎版）
 *
 * 给定一张关，先跑一条 PlayerSim 基线路线；然后对指定步数窗口的每一步：
 *   1. 锁死基线前缀；
 *   2. 枚举棋盘上所有格，逐个强制为当前步的取车；
 *   3. 让 PlayerSim 从下一步继续，记录终局结果；
 *   4. 相对基线分类：win / extend / worse / same。
 *
 * 用法：
 *   node DecisionAtlas_v1.js <关卡.json> [--from 1] [--to 11] [--seed 7]
 *        [--out report.json]
 *
 * 注意：forcedPicks 的键是 0 起算（代码里在 picks++ 之前取）。
 */
const fs = require('fs');
const path = require('path');
const B = require('./Build006Thickness_v688');
const A = B.loadSolver('corner');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const file = process.argv[2];
if (!file) {
  console.error('用法: node DecisionAtlas_v1.js <关卡.json> [--from 1] [--to 11] [--seed 7] [--out report.json]');
  process.exit(2);
}
const from = Math.max(1, Number(arg('--from', 1)));
const seed = Number(arg('--seed', 7));
const outFile = arg('--out', null);

const g = B.readJson(file);
const lv = A.parseLevel(A.fromGameFormat(g));
const rows = g.maprow, cols = g.mapcol;

const baseline = A.PlayerSim.run(lv, { seed, instantChain: false, reviveCap: 0 });
const byStep = {};
for (const p of baseline.pickOrder) if (!byStep[p.step]) byStep[p.step] = { r: p.r, c: p.c, color: p.color };
const baseDeath = baseline.deathSnapshot ? baseline.deathSnapshot.step : null;
const baseProgress = baseline.progress;
const lastStep = Math.max(...Object.keys(byStep).map(Number));
const to = Math.min(lastStep, Number(arg('--to', lastStep)));

function runWith(prefix, k, cand) {
  const fp = Object.assign({}, prefix, { [k - 1]: cand });
  const res = A.PlayerSim.run(lv, { seed, instantChain: false, reviveCap: 0, forcedPicks: fp });
  const at = res.pickOrder.filter(p => p.step === k);
  if (!at.some(p => p.r === cand.r && p.c === cand.c)) return null; // 非法/被阻塞
  return {
    r: cand.r, c: cand.c,
    color: at[0].color, group: at.length,
    won: !!res.won, picks: res.picks, progress: res.progress,
    deathStep: res.deathSnapshot ? res.deathSnapshot.step : null,
    death: res.deathSnapshot || null,
    lastRefuse: res.lastRefuse || null,
    peak: res.bufferPeak
  };
}

function classify(m) {
  if (m.won) return 'win';
  const dDeath = (m.deathStep == null ? 999 : m.deathStep) - (baseDeath == null ? 999 : baseDeath);
  const dProg = m.progress - baseProgress;
  if (dDeath > 0 || dProg > 0) return 'extend';
  if (dDeath < 0 || dProg < 0) return 'worse';
  return 'same';
}

const steps = [];
for (let k = from; k <= to; k++) {
  if (!byStep[k]) continue;
  const prefix = {};
  for (let s = 1; s < k; s++) if (byStep[s]) prefix[s - 1] = { r: byStep[s].r, c: byStep[s].c };
  const moves = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const m = runWith(prefix, k, { r, c });
      if (m) moves.push(Object.assign(m, { verdict: classify(m) }));
    }
  }
  const legal = moves.length;
  const wins = moves.filter(m => m.verdict === 'win');
  const extends_ = moves.filter(m => m.verdict === 'extend');
  const worse = moves.filter(m => m.verdict === 'worse');
  const best = moves.slice().sort((a, b) =>
    (b.won - a.won) || ((b.deathStep || 999) - (a.deathStep || 999)) || (b.progress - a.progress)
  )[0] || null;
  steps.push({
    k,
    baselinePick: byStep[k],
    legal,
    win: wins.length,
    extend: extends_.length,
    worse: worse.length,
    same: moves.filter(m => m.verdict === 'same').length,
    best,
    wins: wins.map(m => ({ r: m.r, c: m.c, color: m.color, picks: m.picks, progress: m.progress })),
    moves
  });
  console.log(`step ${k}: legal=${legal} win=${wins.length} extend=${extends_.length} worse=${worse.length}` +
    (best ? `  best=r${best.r}c${best.c}:${best.color}(${best.won ? 'WIN' : 'd' + best.deathStep + ',' + best.progress + '%'})` : ''));
}

const noChoice = steps.filter(s => s.legal <= 1).map(s => s.k);
let maxRun = 0, run = 0;
for (let k = from; k <= to; k++) {
  if (noChoice.includes(k)) { run++; maxRun = Math.max(maxRun, run); } else run = 0;
}
const fingerprint = {
  level: path.basename(file),
  baseline: {
    picks: baseline.picks,
    progress: baseProgress,
    deathStep: baseDeath,
    bufferPeak: baseline.bufferPeak
  },
  window: { from, to },
  noChoiceSteps: noChoice,
  maxNoChoiceRun: maxRun,
  firstStepWithWin: (steps.find(s => s.win > 0) || {}).k || null,
  totalWinMoves: steps.reduce((a, s) => a + s.win, 0),
  totalLegalMoves: steps.reduce((a, s) => a + s.legal, 0),
  steps
};

console.log('\n=== fingerprint ===');
console.log(JSON.stringify({
  baseline: fingerprint.baseline,
  noChoiceSteps: fingerprint.noChoiceSteps,
  maxNoChoiceRun: fingerprint.maxNoChoiceRun,
  firstStepWithWin: fingerprint.firstStepWithWin,
  totalWinMoves: fingerprint.totalWinMoves,
  totalLegalMoves: fingerprint.totalLegalMoves
}, null, 2));

if (outFile) {
  fs.writeFileSync(outFile, JSON.stringify(fingerprint, null, 2));
  console.log('saved ' + outFile);
}
