#!/usr/bin/env node
'use strict';
/**
 * AnimPlayerRoute_v1 —— 把一条玩家路线导出成「逐步动画数据」
 *
 * 用法：
 *   node AnimPlayerRoute_v1.js <关卡.json> --out <动画数据.json>
 *        [--threshold 0.8] [--seed 7] [--revive 0] [--no-psd]
 *
 * 口径：
 *   - 用 PlayerSim（逐步/并发结算，与真机一致），capture:true 拿逐 tick 帧；
 *   - 每帧记录：本 tick 吃了哪些目标图像素、暂存每辆车的 progress、bufferAfter、stuck；
 *   - `free` = 该步结束后 buffer==0（玩家路线口径）；不是 ArlCheck 的 min 路线口径。
 *
 * 输出 JSON 可直接替换 `动画_*_template.html` 里的 `__DATA__`。
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
  console.error('用法: node AnimPlayerRoute_v1.js <关卡.json> --out <动画数据.json> [--threshold 0.8] [--seed 7] [--revive 0] [--no-psd]');
  process.exit(2);
}
const g = JSON.parse(fs.readFileSync(levelFile, 'utf8'));
const lv = A.parseLevel(A.fromGameFormat(g));
const threshold = +arg('--threshold', 0.8);
const seed = +arg('--seed', 7);
const reviveCap = +arg('--revive', 0);
const preferSmallDebt = !has('--no-psd');
const r = A.PlayerSim.run(lv, { seed, instantChain: false, reviveCap, pickThreshold: threshold, preferSmallDebt, capture: true });
if (!r.won) throw new Error('这条策略没有通关：picks=' + r.picks + ' progress=' + r.progress);

const ticks = r.tickTrajectory;
const frames = r.frames;
if (frames.length !== ticks.length) throw new Error('frame/tick 长度不一致：' + frames.length + ' vs ' + ticks.length);

const balls = {};
const outFrames = [];
const picks = [];
let step = 0, freeRun = 0, curFree = 0, freePicks = 0, instantPicks = 0;

for (let i = 0; i < frames.length; i++) {
  const f = frames[i], t = ticks[i];
  const picked = [];
  for (const p of f.picks || []) {
    balls[p.key] = { key: p.key, color: p.color, need: p.need, progress: 0, slot: p.slot };
    picked.push({ key: p.key, color: p.color, need: p.need, slot: p.slot });
  }
  for (const e of f.eats || []) if (balls[e.key]) balls[e.key].progress++;
  for (const d of f.done || []) delete balls[d.key];
  const buffer = Object.values(balls).map(b => ({ key: b.key, color: b.color, need: b.need, progress: b.progress, slot: b.slot }));

  let pickInfo = null;
  if (picked.length) {
    step++;
    const removed = (f.board && f.board.removed) || [];
    const free = t.bufferAfter === 0;
    const instant = (f.done || []).some(d => picked.some(p => p.key === d.key));
    pickInfo = {
      step, tick: t.tick,
      colors: picked.map(p => p.color),
      needs: picked.map(p => p.need),
      group: picked.length,
      board: removed,
      bufferAfter: t.bufferAfter,
      stuckCars: t.stuckCars,
      stuckPx: t.stuckPx,
      free, instant, progress: t.progress
    };
    picks.push(pickInfo);
    if (free) { freePicks++; curFree++; if (curFree > freeRun) freeRun = curFree; } else curFree = 0;
    if (instant) instantPicks++;
  }
  outFrames.push({
    i, tick: t.tick, progress: t.progress, bufferAfter: t.bufferAfter,
    stuckCars: t.stuckCars, stuckPx: t.stuckPx,
    pick: pickInfo,
    eats: (f.eats || []).map(e => [e.r, e.c, e.color]),
    done: (f.done || []).map(d => d.key),
    buffer
  });
}

const data = {
  meta: {
    level: path.basename(levelFile),
    sha: crypto.createHash('sha256').update(fs.readFileSync(levelFile)).digest('hex'),
    policy: `threshold=${threshold}, preferSmallDebt=${preferSmallDebt}, revive=${reviveCap}, seed=${seed}`,
    picks: step, ticks: frames.length, won: r.won, bufferPeak: r.bufferPeak
  },
  blocks: g.blocks, maprow: g.maprow, mapcol: g.mapcol, spools: g.spools,
  frames: outFrames, picks,
  summary: {
    freeRun, freePicks, instantPicks,
    stuckPeak: Math.max(...ticks.map(t => t.stuckCars || 0)),
    stuckSteps: ticks.filter(t => t.stuckCars >= 1).length
  }
};
fs.writeFileSync(out, JSON.stringify(data));
console.log(JSON.stringify({ picks: step, ticks: frames.length, freeRun, freePicks, instantPicks, ...data.summary, bytes: fs.statSync(out).size }));
