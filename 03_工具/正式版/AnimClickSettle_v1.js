#!/usr/bin/env node
'use strict';
/**
 * AnimClickSettle_v1 —— 按「点击一次车 → 当前可达像素一次吃满」输出逐步动画数据
 *
 * 与 AnimPlayerRoute_v1（逐 tick）不同：
 *   - 这里不展示 1px/1px 的吃东西过程；
 *   - 每一步 = 一次点击，调用 Simulator.applyPick（一次取车 + autoReleaseBuffer 完整结算）；
 *   - 结算后 buffer 里只剩「还有剩余、但当前无路可吃」的车，即用户口径的真债；
 *   - 能吃完的车不会留在暂存区。
 *
 * 点击顺序来自 PlayerSim（逐步引擎）的实际路线；只取它的选择，不取它的 tick 过程。
 *
 * 用法：
 *   node AnimClickSettle_v1.js <关卡.json> --out <动画数据.json>
 *        [--threshold 0.8] [--seed 7] [--revive 0] [--no-psd]
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const B = require('./Build006Thickness_v688');
const A = B.loadSolver('corner');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const has = k => process.argv.indexOf(k) > 0;
const levelFile = process.argv[2];
const out = arg('--out', '');
if (!levelFile || !out) {
  console.error('用法: node AnimClickSettle_v1.js <关卡.json> --out <动画数据.json> [--threshold 0.8] [--seed 7] [--revive 0] [--no-psd]');
  process.exit(2);
}
const g = JSON.parse(fs.readFileSync(levelFile, 'utf8'));
const lv = A.parseLevel(A.fromGameFormat(g));
const threshold = +arg('--threshold', 0.8);
const seed = +arg('--seed', 7);
const reviveCap = +arg('--revive', 0);
const preferSmallDebt = !has('--no-psd');

// 1) 拿玩家路线的点击顺序（只取选择）
const ps = A.PlayerSim.run(lv, { seed, instantChain: false, reviveCap, pickThreshold: threshold, preferSmallDebt, capture: true });
if (!ps.won) throw new Error('玩家路线没有通关：picks=' + ps.picks);
const clicks = [];
for (const t of ps.tickTrajectory) {
  if (t.pick && t.pick.picked && t.pick.picked.length) clicks.push(t.pick.picked);
}

// 2) 在完整结算引擎上回放这些点击
const s = A.Simulator.createState(lv, { useSlotStart: true, bottomOnly: false, instantChain: false });
const H = s.rows, W = s.cols;
const steps = [];
let freeSteps = 0, freeRun = 0, curFree = 0, maxBuffer = 0, stuckPeak = 0, stuckSteps = 0;

for (let i = 0; i < clicks.length; i++) {
  const picked = clicks[i];
  const trigger = picked[0];
  const before = s.eliminated.map(row => row.slice());
  const ok = A.Simulator.applyPick(s, trigger.r, trigger.c);
  if (!ok) throw new Error('第 ' + (i + 1) + ' 次点击在完整结算引擎上不合法：' + trigger.r + ',' + trigger.c);

  const eaten = [];
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    if (!before[r][c] && s.eliminated[r][c]) eaten.push([r, c, s.blocks[r][c]]);
  }
  const buffer = s.buffer.map(b => ({
    key: b.key, slot: b.slot, color: b.color,
    need: b.need, progress: b.progress, remaining: b.need - b.progress
  }));
  const bufAfter = buffer.length;
  const stuckPx = buffer.reduce((a, b) => a + b.remaining, 0);
  const free = bufAfter === 0;
  if (free) { freeSteps++; curFree++; if (curFree > freeRun) freeRun = curFree; } else curFree = 0;
  if (bufAfter > maxBuffer) maxBuffer = bufAfter;
  if (bufAfter > stuckPeak) stuckPeak = bufAfter;
  if (bufAfter >= 1) stuckSteps++;

  steps.push({
    step: i + 1,
    picked: picked.map(p => ({ r: p.r, c: p.c, color: p.color, count: p.count })),
    colors: picked.map(p => p.color),
    needs: picked.map(p => p.count),
    group: picked.length,
    eaten,
    eliminatedCount: eaten.length,
    eliminatedTotal: s.eliminatedPixels,
    progress: s.totalPixels ? +(s.eliminatedPixels / s.totalPixels).toFixed(4) : 0,
    bufferAfter: bufAfter,
    buffer,
    stuckCars: bufAfter,
    stuckPx,
    free
  });
}

if (s.eliminatedPixels !== s.totalPixels) throw new Error('回放没有消完：' + s.eliminatedPixels + '/' + s.totalPixels);

const data = {
  meta: {
    level: path.basename(levelFile),
    sha: crypto.createHash('sha256').update(fs.readFileSync(levelFile)).digest('hex'),
    policy: `threshold=${threshold}, preferSmallDebt=${preferSmallDebt}, revive=${reviveCap}, seed=${seed}`,
    mode: 'click-settle',
    clicks: steps.length,
    boxes: clicks.reduce((a, x) => a + x.length, 0),
    won: true
  },
  blocks: g.blocks, maprow: g.maprow, mapcol: g.mapcol, spools: g.spools,
  steps,
  summary: { freeSteps, freeRun, maxBuffer, stuckPeak, stuckSteps }
};
fs.writeFileSync(out, JSON.stringify(data));
console.log(JSON.stringify({ clicks: steps.length, ...data.summary, bytes: fs.statSync(out).size }));
