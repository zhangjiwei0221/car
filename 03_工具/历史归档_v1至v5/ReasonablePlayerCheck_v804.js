#!/usr/bin/env node
'use strict';
/**
 * ReasonablePlayerCheck_v804 —— 合理玩家检查器
 *
 * 用法：
 *   node ReasonablePlayerCheck_v804.js <关卡.json> [--seeds 7,19,37,73,101] [--revives 0,2]
 *
 * 这不是随机点击容错。它调用 PlayerSim 的有限信息贪心策略：
 *   - 优先当前能消完的车；
 *   - 高压时拒绝不可消车；
 *   - 暂存满时宁可等待，不主动送死；
 *   - 可选地报告 0 复活和 2 复活路线。
 *
 * 结果只作为“合理玩家路线是否成立”的证据，不替代 StagePlanCheck 或 ArlCheck。
 */
const B = require('./Build006Thickness_v688');
const A = B.loadSolver('corner');
const fs = require('fs');

const file = process.argv[2];
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
if (!file) {
  console.error('用法: node ReasonablePlayerCheck_v804.js <关卡.json> [--seeds 7,19,37,73,101] [--revives 0,2]');
  process.exit(2);
}
const g = B.readJson(file);
const lv = A.parseLevel(A.fromGameFormat(g));
const seeds = String(arg('--seeds', '7,19,37,73,101')).split(',').map(Number).filter(Number.isFinite);
const caps = String(arg('--revives', '0,2')).split(',').map(Number).filter(Number.isFinite);
const rows = [];
for (const cap of caps) {
  for (const seed of seeds) {
    const r = A.PlayerSim.run(lv, { seed, instantChain: false, reviveCap: cap, capturePreviewStats: false });
    rows.push({
      seed, reviveCap: cap, won: !!r.won,
      picks: r.picks, progress: r.progress,
      completedBoxes: r.completedBoxes, totalBoxes: r.totalBoxes,
      bufferPeak: r.bufferPeak, stalledAtEnd: r.stalledAtEnd,
      revivesUsed: r.revivesUsed,
      lastRefuse: r.lastRefuse || null,
      deathSnapshot: r.deathSnapshot || null
    });
  }
}
const summary = {};
for (const cap of caps) {
  const a = rows.filter(x => x.reviveCap === cap);
  summary[cap] = {
    pass: a.filter(x => x.won).length,
    total: a.length,
    allPass: a.length > 0 && a.every(x => x.won)
  };
}
console.log(JSON.stringify({ tool: 'ReasonablePlayerCheck_v804', level: file, summary, rows }, null, 2));
