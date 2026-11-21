#!/usr/bin/env node
'use strict';
/**
 * OpeningOpenness_v1 —— 开局开阔度：沿一条（贪心）路线，逐步统计“当前可消的颜色数”
 *
 * 定义（2026-11-21，用户提出）：
 *   openStart    第 0 步可点车里的颜色数（开局有几色可做）
 *   openFirst30  进度 <30% 的步里，可点颜色的平均值（开局段平均有多宽）
 *   openMin30    同上区间的最小值（最窄的时候）
 *   arrivals30   前 30% 进度里新进场的颜色数（相对第 0 步）
 *   buckets      按 10% 进度分桶的可点颜色均值
 *
 * 口径：corner（loadSolver('corner')）；--bottom-only 三面墙；--instant-chain 瞬时连锁。
 * 路线：贪心（当步不死里取 gain 最大），与扫描器 runFree 同源。
 *
 * 用法：
 *   node OpeningOpenness_v1.js <关卡.json> [--bottom-only] [--instant-chain] [--out 结果.json]
 */
const fs = require('fs');
const path = require('path');
const B = require(path.join(__dirname, 'Build006Thickness_v688.js'));
const A = B.loadSolver('corner');
const Sim = A.Simulator, St = A.SolverStrategy;

const argv = process.argv.slice(2);
const flag = (k) => argv.includes(k);
const arg = (k, d) => { const i = argv.indexOf(k); return i > 0 ? argv[i + 1] : d; };
const FILE = argv[0];
if (!FILE || FILE.startsWith('--')) {
  console.error('用法: node OpeningOpenness_v1.js <关卡.json> [--bottom-only] [--instant-chain] [--out 结果.json]');
  process.exit(2);
}
const BOTTOM_ONLY = flag('--bottom-only');
const INSTANT_CHAIN = flag('--instant-chain');
const OUT = arg('--out', null);

const game = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const colorAt = (r, c) => { const s = game.spools[r][c]; return s && s.id > 0 ? s.id : 0; };
const lv = A.parseLevel(A.fromGameFormat(game));

const isWon = (s) => s.eliminatedPixels >= s.totalPixels;
const isDead = (s) => !!(s.overflow || s.buffer.length > s.bufferLimit || Sim.isDeadEnd(s));

let s = Sim.createState(lv, { useSlotStart: true, bottomOnly: BOTTOM_ONLY, instantChain: INSTANT_CHAIN });
const steps = [];
for (let i = 0; i < 200 && !isWon(s); i++) {
  const ms = Sim.listMoves(s).filter(m => !m.blocked);
  if (!ms.length) break;
  const colors = [...new Set(ms.map(m => colorAt(m.r, m.c)).filter(x => x > 0))];
  // 逐色可点车数（宽度之外的“深度”：一色露几辆）
  const perColor = {};
  for (const m of ms) { const id = colorAt(m.r, m.c); if (id > 0) perColor[id] = (perColor[id] || 0) + 1; }
  const depth = colors.length ? Math.max(...Object.values(perColor)) : 0;
  const colors2plus = Object.values(perColor).filter(n => n >= 2).length;
  const progress = s.eliminatedPixels / s.totalPixels;
  steps.push({ step: i + 1, progress: +progress.toFixed(3), openColors: colors.length, colors, perColor, depth, colors2plus });
  // 贪心：当步不死里取 gain 最大
  let best = null, bg = -1;
  for (const m of ms) {
    const t = St.cloneState(s);
    const e0 = t.eliminatedPixels;
    if (!Sim.applyPick(t, m.r, m.c)) continue;
    if (isDead(t) && !isWon(t)) continue;
    const g = t.eliminatedPixels - e0;
    if (g > bg) { bg = g; best = t; }
  }
  if (!best) break;
  s = best;
}

const openStart = steps.length ? steps[0].openColors : 0;
const early = steps.filter(x => x.progress < 0.3);
const openFirst30 = early.length ? early.reduce((a, b) => a + b.openColors, 0) / early.length : 0;
const openMin30 = early.length ? Math.min(...early.map(x => x.openColors)) : 0;
const seen30 = new Set();
for (const x of early) for (const c of x.colors) seen30.add(c);
const arrivals30 = seen30.size - (steps.length ? steps[0].colors.length : 0);
const buckets = {};
for (const x of steps) {
  const b = Math.min(9, Math.floor(x.progress * 10));
  (buckets[b] = buckets[b] || []).push(x.openColors);
}
const bucketAvg = {};
for (const k of Object.keys(buckets)) bucketAvg[k] = +(buckets[k].reduce((a, b) => a + b, 0) / buckets[k].length).toFixed(2);

const res = {
  level: path.basename(FILE), mode: BOTTOM_ONLY ? (INSTANT_CHAIN ? 'wall+instant' : 'wall') : (INSTANT_CHAIN ? 'instant' : 'four-side'),
  won: isWon(s), steps: steps.length,
  openStart, openFirst30: +openFirst30.toFixed(2), openMin30, arrivals30,
  depthStart: steps.length ? steps[0].depth : 0,
  colors2plusStart: steps.length ? steps[0].colors2plus : 0,
  depthFirst30: early.length ? +(early.reduce((a, b) => a + b.depth, 0) / early.length).toFixed(2) : 0,
  buckets: bucketAvg
};
if (OUT) fs.writeFileSync(OUT, JSON.stringify({ ...res, trace: steps }, null, 1));
console.log(JSON.stringify(res));
process.exit(res.won ? 0 : 1);
