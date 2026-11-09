#!/usr/bin/env node
'use strict';
/**
 * AnimClickSettle_v1 —— 点击结算：点一次车 → 当前可达像素一次吃满
 *
 * 两种路线来源：
 *   默认（推荐）：click-settle-greedy —— 每一步枚举合法车，逐只 applyPick 试算，
 *                选“吃掉像素最多、且不爆仓”的车；同分再比结算后暂存和剩余债务。
 *   --from-player：沿用 PlayerSim 的点击顺序（只作对照，不再用于验收）。
 *
 * 结算口径：
 *   - 不展示 1px/tick 的吃东西过程；
 *   - 一次点击后 buffer 里只剩“有剩余、但当前无路可吃”的车（真债）；
 *   - 能吃完的车直接离开暂存，不计债。
 *
 * 用法：
 *   node AnimClickSettle_v1.js <关卡.json> --out <动画数据.json>
 *        [--from-player] [--threshold 0.8] [--seed 7] [--revive 0] [--no-psd]
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
  console.error('用法: node AnimClickSettle_v1.js <关卡.json> --out <动画数据.json> [--from-player]');
  process.exit(2);
}
const g = JSON.parse(fs.readFileSync(levelFile, 'utf8'));
const lv = A.parseLevel(A.fromGameFormat(g));
const threshold = +arg('--threshold', 0.8);
const seed = +arg('--seed', 7);
const reviveCap = +arg('--revive', 0);
const preferSmallDebt = !has('--no-psd');

function fresh() {
  return A.Simulator.createState(lv, { useSlotStart: true, bottomOnly: false, instantChain: false });
}
function clone(s) { return JSON.parse(JSON.stringify(s)); }
function isDead(s) {
  return s.overflow || s.gameOver || s.buffer.length >= s.bufferLimit || A.Simulator.isDeadEnd(s);
}

// ---------- 路线 1：点击结算贪心 ----------
function greedyRoute() {
  let s = fresh();
  const route = [];
  const limit = 200;
  while (s.eliminatedPixels < s.totalPixels) {
    if (route.length >= limit) throw new Error('贪心路线超过 ' + limit + ' 步');
    const moves = A.Simulator.listMoves(s).filter(m => !m.blocked);
    if (!moves.length) throw new Error('贪心走到死局：step ' + (route.length + 1));
    let best = null;
    for (const m of moves) {
      const c = clone(s);
      const before = c.eliminatedPixels;
      if (!A.Simulator.applyPick(c, m.r, m.c)) continue;
      if (c.eliminatedPixels < c.totalPixels && isDead(c)) continue;
      const gain = c.eliminatedPixels - before;
      const buf = c.buffer.length;
      const stuckPx = c.buffer.reduce((a, b) => a + (b.need - b.progress), 0);
      // 合理玩家：先拿“点了能吃完”的车（buffer=0），再比吃得多；都不吃完时比债少。
      const score = [buf === 0 ? 1 : 0, gain, -buf, -stuckPx, -m.r, -m.c];
      if (!best || cmp(score, best.score) > 0) best = { m, c, score, gain, buf, stuckPx };
    }
    if (!best) throw new Error('贪心没有可用走法：step ' + (route.length + 1));
    s = best.c;
    route.push({ r: best.m.r, c: best.m.c, gain: best.gain, bufferAfter: best.buf, stuckPx: best.stuckPx });
  }
  return route;
}
function cmp(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

// ---------- 路线 2：PlayerSim 点击顺序（对照） ----------
function playerRoute() {
  const ps = A.PlayerSim.run(lv, { seed, instantChain: false, reviveCap, pickThreshold: threshold, preferSmallDebt, capture: true });
  if (!ps.won) throw new Error('PlayerSim 路线没有通关：picks=' + ps.picks);
  const route = [];
  for (const t of ps.tickTrajectory) {
    if (t.pick && t.pick.picked && t.pick.picked.length) {
      const p = t.pick.picked[0];
      route.push({ r: p.r, c: p.c });
    }
  }
  return route;
}

const fromPlayer = has('--from-player');
const route = fromPlayer ? playerRoute() : greedyRoute();

// ---------- 回放路线并抓每一步快照 ----------
const s = fresh();
const H = s.rows, W = s.cols;
const steps = [];
let freeSteps = 0, freeRun = 0, curFree = 0, maxBuffer = 0, stuckPeak = 0, stuckSteps = 0;

for (let i = 0; i < route.length; i++) {
  const mv = route[i];
  const before = s.eliminated.map(row => row.slice());
  if (!A.Simulator.applyPick(s, mv.r, mv.c)) throw new Error('第 ' + (i + 1) + ' 次点击不合法：' + mv.r + ',' + mv.c);
  const picked = s.lastPick && s.lastPick.picked ? s.lastPick.picked : [{ r: mv.r, c: mv.c }];

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
    mode: 'click-settle',
    routeSource: fromPlayer ? 'PlayerSim (legacy comparison)' : 'click-settle-greedy (free-first)',
    clicks: steps.length,
    boxes: steps.reduce((a, x) => a + x.group, 0),
    won: true
  },
  blocks: g.blocks, maprow: g.maprow, mapcol: g.mapcol, spools: g.spools,
  steps,
  summary: { freeSteps, freeRun, maxBuffer, stuckPeak, stuckSteps }
};
fs.writeFileSync(out, JSON.stringify(data));
console.log(JSON.stringify({ routeSource: data.meta.routeSource, clicks: steps.length, ...data.summary, bytes: fs.statSync(out).size }));
