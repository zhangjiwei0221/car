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
 *   - 一次点击后只把“未吃完（progress < need）”的车算作债/暂存；
 *     锁链组里已经吃完、只是被组占位留住的成员不算债；
 *   - 能吃完的车直接离开暂存，不计债。
 *
 * 路线：
 *   默认 free-first 贪心：先拿“点了能吃完”的车；没有时比吃得多、债少、位置稳定。
 *   贪心走进死局时自动回退到束搜索（--beam N，默认 60）。
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
// 点击结算的债 = 结算后仍未吃完的车；链组里已经吃完、只是被组占位留住的成员不算债。
function debtOf(s) { return s.buffer.filter(b => b.progress < b.need); }
function isDead(s) {
  if (s.eliminatedPixels >= s.totalPixels) return false;
  if (debtOf(s).length > s.bufferLimit) return true;
  // 在“点击结算”口径下不把物理 buffer 的 blocked 当死；只看还有没有可取盒。
  const moves = A.Simulator.listMoves(s);
  return moves.length === 0;
}

// ---------- 路线 1：点击结算贪心 ----------
function greedyRoute() {
  let s = fresh();
  const route = [];
  const limit = 200;
  while (s.eliminatedPixels < s.totalPixels) {
    if (route.length >= limit) throw new Error('贪心路线超过 ' + limit + ' 步');
    const moves = A.Simulator.listMoves(s);
    if (!moves.length) throw new Error('贪心走到死局：step ' + (route.length + 1));
    let best = null;
    for (const m of moves) {
      const c = clone(s);
      const before = c.eliminatedPixels;
      if (!A.Simulator.applyPick(c, m.r, m.c)) continue;
      if (c.eliminatedPixels < c.totalPixels && isDead(c)) continue;
      const gain = c.eliminatedPixels - before;
      const debt = debtOf(c);
      const buf = debt.length;
      const stuckPx = debt.reduce((a, b) => a + (b.need - b.progress), 0);
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

// ---------- 路线 1b：贪心失败时的束搜索回退 ----------
// 目标仍是“能通关 + 免费步多 + 债少”；只在贪心走进死局时启用。
function stateSig(s) {
  let bits = '';
  for (let r = 0; r < s.rows; r++) {
    const row = s.eliminated[r];
    for (let c = 0; c < s.cols; c++) bits += row[c] ? '1' : '0';
  }
  const buf = s.buffer.map(b => b.color + ':' + (b.need - b.progress)).sort().join(',');
  const rem = Object.keys(s.removed || {}).sort().join(',');
  return bits + '|' + buf + '|' + rem;
}
function routeStatsAfter(node, c, gain) {
  const debt = debtOf(c);
  const buf = debt.length;
  const stuckPx = debt.reduce((a, b) => a + (b.need - b.progress), 0);
  const free = buf === 0;
  return {
    freeSteps: node.freeSteps + (free ? 1 : 0),
    freeRun: free ? Math.max(node.freeRun, node.curFree + 1) : node.freeRun,
    curFree: free ? node.curFree + 1 : 0,
    maxBuffer: Math.max(node.maxBuffer, buf),
    stuckPeak: Math.max(node.stuckPeak, buf),
    stuckSteps: node.stuckSteps + (buf >= 1 ? 1 : 0),
    gain
  };
}
function betterRoute(a, b) {
  if (!a) return true;
  if (!b) return false;
  return cmp([a.freeSteps, a.freeRun, -a.maxBuffer, -a.stuckSteps], [b.freeSteps, b.freeRun, -b.maxBuffer, -b.stuckSteps]) > 0;
}
function beamRoute(width) {
  width = width || 60;
  let beam = [{ s: fresh(), route: [], freeSteps: 0, freeRun: 0, curFree: 0, maxBuffer: 0, stuckPeak: 0, stuckSteps: 0 }];
  let win = null;
  for (let depth = 0; depth < 120 && beam.length; depth++) {
    const next = [];
    for (const node of beam) {
      const moves = A.Simulator.listMoves(node.s);
      for (const m of moves) {
        const c = clone(node.s);
        const before = c.eliminatedPixels;
        if (!A.Simulator.applyPick(c, m.r, m.c)) continue;
        const won = c.eliminatedPixels >= c.totalPixels;
        if (!won && isDead(c)) continue;
        const gain = c.eliminatedPixels - before;
        const st = routeStatsAfter(node, c, gain);
        const route = node.route.concat([{ r: m.r, c: m.c }]);
        if (won) {
          const cand = Object.assign({ route }, st);
          if (betterRoute(cand, win)) win = cand;
          continue;
        }
        next.push(Object.assign({ s: c, route }, st));
      }
    }
    if (win) break;
    // 去重 + 保留前 width 个；排序：进度优先，其次债少，再次步数少
    const seen = new Set();
    const uniq = [];
    for (const n of next) {
      const sig = stateSig(n.s);
      if (seen.has(sig)) continue;
      seen.add(sig);
      uniq.push(n);
    }
    uniq.sort((a, b) => cmp(
      [b.s.eliminatedPixels, -debtOf(b.s).length, -b.stuckPeak, -b.route.length],
      [a.s.eliminatedPixels, -debtOf(a.s).length, -a.stuckPeak, -a.route.length]
    ));
    beam = uniq.slice(0, width);
  }
  if (!win) throw new Error('束搜索没有找到通关路线');
  return win.route;
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
let route, routeSource;
if (fromPlayer) {
  route = playerRoute();
  routeSource = 'PlayerSim (legacy comparison)';
} else if (has('--beam-first')) {
  const width = +arg('--beam', 60);
  route = beamRoute(width);
  routeSource = 'click-settle-beam (width ' + width + ', experience-first)';
} else {
  try {
    route = greedyRoute();
    routeSource = 'click-settle-greedy (free-first)';
  } catch (e) {
    const width = +arg('--beam', 60);
    route = beamRoute(width);
    routeSource = 'click-settle-beam (width ' + width + ', fallback)';
  }
}

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
  const buffer = debtOf(s).map(b => ({
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
    routeSource,
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
