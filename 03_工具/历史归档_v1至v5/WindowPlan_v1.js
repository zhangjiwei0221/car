#!/usr/bin/env node
'use strict';
/**
 * WindowPlan_v1 —— 颜色窗口 → 车安排建议
 *
 * 对每辆车：
 *   windowStep   求解器完整路线里，该色第一次 reach >= 该车 count 的步
 *   playerStep   玩家 0 复活路线里，第一次拿该车的步
 *   earlySteps   playerStep < windowStep 时，提前了几步
 *   earlyBalls   两条路线之间累计球数差（数字冰按球数递减，用它估冰量）
 *   ice          建议冰量（clamp 1..20）
 *
 * 用法：
 *   node WindowPlan_v1.js <关卡.json> [--report plan.json] [--apply-top N --out 变体.json]
 *
 * 只读分析；--apply-top 会生成一个加冰变体（不覆盖原关）。
 */
const fs = require('fs');
const B = require('./Build006Thickness_v688');
const A = B.loadSolver('corner');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const has = k => process.argv.indexOf(k) > 0;
const file = process.argv[2];
if (!file) {
  console.error('用法: node WindowPlan_v1.js <关卡.json> [--report plan.json] [--apply-top N --out 变体.json]');
  process.exit(2);
}
const reportFile = arg('--report', null);
const outFile = arg('--out', null);
const applyTop = Number(arg('--apply-top', 0)) || 0;

const g = B.readJson(file);
const lv = A.parseLevel(A.fromGameFormat(g));
const S = A.Simulator;

// 1) 求解器完整路线：每步每色的 reach
const min = A.Solver.runMinBuffer(lv, { depth: 3, instantChain: false });
const colors = new Set();
for (const row of g.spools) for (const car of row) if (car && car.id > 0) colors.add(car.id);
const s = S.enter(lv, { useSlotStart: true, instantChain: false, capturePreviewStats: false });
const byStep = {};
for (const p of min.pickOrder || []) (byStep[p.step] = byStep[p.step] || []).push(p);
const reachByStep = {};
let ballsSolver = 0;
const ballsAtSolver = {};
for (const step of Object.keys(byStep).sort((a, b) => +a - +b)) {
  const group = byStep[step];
  reachByStep[step] = {};
  for (const color of colors) {
    const em = s.eliminated.map(row => row.slice());
    reachByStep[step][color] = S.floodFillCount(em, s.blocks, s.rows, s.cols, color, s.bottomOnly);
  }
  ballsAtSolver[step] = ballsSolver;
  for (const p of group) {
    ballsSolver++;
    if (S.applyPick(s, p.r, p.c)) break;
  }
}
const solverOk = s.completedBoxes >= (min.completedBoxes || 0);
console.error(`solver replay ${s.completedBoxes}/${min.completedBoxes} complete=${solverOk}`);

// 2) 玩家路线
const p0 = A.PlayerSim.run(lv, { seed: 7, instantChain: false, reviveCap: 0 });
const playerFirst = {};
const playerBallsAt = {};
let ballsP = 0;
for (const p of p0.pickOrder || []) {
  const key = p.r + ',' + p.c;
  if (playerFirst[key] == null) playerFirst[key] = { step: p.step, color: p.color, count: p.count, reach: p.reachAtPick };
  playerBallsAt[p.step] = ballsP;
  ballsP++;
}

// 3) 每辆车
const cars = [];
for (let r = 0; r < g.spools.length; r++) {
  for (let c = 0; c < g.spools[r].length; c++) {
    const car = g.spools[r][c];
    if (!car || !(car.id > 0)) continue;
    const key = r + ',' + c;
    const color = car.id, count = car.count;
    let windowStep = null;
    for (const step of Object.keys(byStep).sort((a, b) => +a - +b)) {
      if (reachByStep[step][color] >= count) { windowStep = +step; break; }
    }
    const pf = playerFirst[key] || null;
    let earlySteps = 0, earlyBalls = 0;
    if (pf && windowStep != null && pf.step < windowStep) {
      earlySteps = windowStep - pf.step;
      earlyBalls = Math.max(0, (ballsAtSolver[windowStep] != null ? ballsAtSolver[windowStep] : ballsSolver) - (playerBallsAt[pf.step] != null ? playerBallsAt[pf.step] : 0));
    }
    cars.push({
      r, c, color, count,
      windowStep, windowReach: windowStep != null ? reachByStep[windowStep][color] : null,
      playerStep: pf ? pf.step : null, playerReach: pf ? pf.reach : null,
      earlySteps, earlyBalls,
      ice: earlyBalls > 0 ? Math.max(1, Math.min(20, earlyBalls)) : 0,
      chain: (Array.isArray(car.type) ? car.type : [car.type || 0]).indexOf(5) >= 0
    });
  }
}
cars.sort((a, b) => (b.earlyBalls - a.earlyBalls) || (b.earlySteps - a.earlySteps));

const plan = { level: file, solverOk, cars: cars.filter(x => x.earlyBalls > 0) };
if (reportFile) fs.writeFileSync(reportFile, JSON.stringify(plan, null, 2));
for (const x of plan.cars) {
  console.log(`r${x.r}c${x.c} color ${x.color} count ${x.count} | window ${x.windowStep}(r${x.windowReach}) | player ${x.playerStep}(r${x.playerReach}) | early ${x.earlySteps}步/${x.earlyBalls}球 | ice ${x.ice}${x.chain ? ' (chain)' : ''}`);
}
console.log(`early cars: ${plan.cars.length}; saved ${reportFile || '-'}`);

// 4) 可选：给 top N 个早拿车加冰
if (applyTop > 0 && outFile) {
  const out = JSON.parse(JSON.stringify(g));
  const picked = plan.cars.slice(0, applyTop);
  for (const x of picked) {
    const car = out.spools[x.r][x.c];
    if (x.chain) continue;
    if (car.type === 7) car.param = Math.max(car.param || 0, x.ice);
    else { car.type = 7; car.param = x.ice; }
  }
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
  console.log(`applied ice to ${picked.length} cars; saved ${outFile}`);
}
