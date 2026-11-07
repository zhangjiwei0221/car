#!/usr/bin/env node
'use strict';
/**
 * WindowPlan_v2 —— 用「更长的玩家路线」算颜色窗口
 *
 * 与 v1 的区别：v1 用求解器路线算窗口，会低估玩家的早拿；
 * v2 用 PlayerSim 的 reachTimeline：先跑 0 复活和 2 复活两条路线，
 * 取「拿车更多/走得更远」的那条作为参考，算每辆车第一次 reach >= count 的步。
 *
 * 分类：
 *   ok        玩家拿时 reach >= count
 *   early     玩家拿时不够，但参考路线后面能追上 → 建议冰
 *   never     参考路线直到结束都没追上 → 加冰救不了，要改容量/棋盘/图
 *   unpicked  玩家路线没拿这辆车
 *   chain     锁链车（单独处理）
 *
 * 用法：
 *   node WindowPlan_v2.js <关卡.json> [--report plan.json] [--apply-top N --out 变体.json]
 */
const fs = require('fs');
const B = require('./Build006Thickness_v688');
const A = B.loadSolver('corner');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const file = process.argv[2];
if (!file) {
  console.error('用法: node WindowPlan_v2.js <关卡.json> [--report plan.json] [--apply-top N --out 变体.json]');
  process.exit(2);
}
const reportFile = arg('--report', null);
const outFile = arg('--out', null);
const applyTop = Number(arg('--apply-top', 0)) || 0;

const g = B.readJson(file);
const lv = A.parseLevel(A.fromGameFormat(g));

const p0 = A.PlayerSim.run(lv, { seed: 7, instantChain: false, reviveCap: 0, trackReach: true });
const p2 = A.PlayerSim.run(lv, { seed: 7, instantChain: false, reviveCap: 2, trackReach: true });
const ref = (p2.picks > p0.picks || p2.won) ? p2 : p0;
console.error(`p0 picks=${p0.picks} won=${p0.won}; p2 picks=${p2.picks} won=${p2.won}; ref=${ref === p2 ? 'p2' : 'p0'}`);

const refTimeline = {};
for (const e of ref.reachTimeline || []) (refTimeline[e.color] = refTimeline[e.color] || []).push(e);
for (const c of Object.keys(refTimeline)) refTimeline[c].sort((a, b) => a.step - b.step);

const refBallsAt = {};
let balls = 0;
for (const p of ref.pickOrder || []) {
  if (refBallsAt[p.step] == null) refBallsAt[p.step] = balls;
  balls++;
}
const refBalls = balls;

const p0First = {};
for (const p of p0.pickOrder || []) {
  const key = p.r + ',' + p.c;
  if (!p0First[key]) p0First[key] = { step: p.step, color: p.color, count: p.count, reach: p.reachAtPick };
}

const cars = [];
for (let r = 0; r < g.spools.length; r++) {
  for (let c = 0; c < g.spools[r].length; c++) {
    const car = g.spools[r][c];
    if (!car || !(car.id > 0)) continue;
    const key = r + ',' + c;
    const pf = p0First[key] || null;
    const chain = (Array.isArray(car.type) ? car.type : [car.type || 0]).indexOf(5) >= 0;
    let windowStep = null, windowReach = null;
    if (pf) {
      const entries = refTimeline[car.id] || [];
      const hit = entries.find(e => e.step > pf.step && e.reach >= car.count);
      if (hit) { windowStep = hit.step; windowReach = hit.reach; }
    }
    let status;
    if (chain) status = 'chain';
    else if (!pf) status = 'unpicked';
    else if (pf.reach >= car.count) status = 'ok';
    else if (windowStep != null) status = 'early';
    else status = 'never';
    const earlySteps = (status === 'early') ? windowStep - pf.step : 0;
    const earlyBalls = (status === 'early')
      ? Math.max(0, (refBallsAt[windowStep] != null ? refBallsAt[windowStep] : refBalls) - (refBallsAt[pf.step] != null ? refBallsAt[pf.step] : 0))
      : 0;
    cars.push({
      r, c, color: car.id, count: car.count, chain,
      playerStep: pf ? pf.step : null, playerReach: pf ? pf.reach : null,
      windowStep, windowReach, earlySteps, earlyBalls,
      ice: earlyBalls > 0 ? Math.max(1, Math.min(20, earlyBalls)) : 0,
      status
    });
  }
}
cars.sort((a, b) => (b.earlyBalls - a.earlyBalls) || (b.earlySteps - a.earlySteps));

const plan = { level: file, ref: ref === p2 ? 'p2' : 'p0', cars };
if (reportFile) fs.writeFileSync(reportFile, JSON.stringify(plan, null, 2));
for (const x of cars) {
  if (x.status === 'ok') continue;
  console.log(`r${x.r}c${x.c} color ${x.color} count ${x.count} | player ${x.playerStep}(r${x.playerReach}) | window ${x.windowStep}(r${x.windowReach}) | ${x.status} early ${x.earlySteps}步/${x.earlyBalls}球 | ice ${x.ice}`);
}
const counts = {};
for (const x of cars) counts[x.status] = (counts[x.status] || 0) + 1;
console.log('status:', JSON.stringify(counts));

if (applyTop > 0 && outFile) {
  const out = JSON.parse(JSON.stringify(g));
  const picked = cars.filter(x => x.status === 'early' && !x.chain).slice(0, applyTop);
  for (const x of picked) {
    const car = out.spools[x.r][x.c];
    if (car.type === 7) car.param = Math.max(car.param || 0, x.ice);
    else { car.type = 7; car.param = x.ice; }
  }
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
  console.log(`applied ice to ${picked.length} early cars; saved ${outFile}`);
}
