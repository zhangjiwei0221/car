#!/usr/bin/env node
'use strict';
/**
 * CapacityPlan_v1 —— 按「可达 + 时间」重新分配车容量
 *
 * 规则（来自 v3-07/08）：
 *   1. 每辆车的容量 ≤ 它在参考路线里被拿时的可达量；
 *   2. 同色剩余容量优先分给「还有 spare（reach - cap）」的车，先早后晚；
 *   3. 逐色守恒：sum(count) == 该色像素数；
 *   4. 不可行的颜色（sum(reach) < 总像素 / 有链组 / reach=0）保持原样并标记，不硬造。
 *
 * 参考路线：优先 2 复活通关路线（覆盖全关），否则用 0 复活路线。
 *
 * 用法：
 *   node CapacityPlan_v1.js <关卡.json> --out <计划关.json> [--report plan.json]
 */
const fs = require('fs');
const B = require('./Build006Thickness_v688');
const A = B.loadSolver('corner');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const file = process.argv[2];
const outFile = arg('--out', null);
const reportFile = arg('--report', null);
if (!file || !outFile) {
  console.error('用法: node CapacityPlan_v1.js <关卡.json> --out <计划关.json> [--report plan.json]');
  process.exit(2);
}

const g = B.readJson(file);
const lv = A.parseLevel(A.fromGameFormat(g));
const p2 = A.PlayerSim.run(lv, { seed: 7, instantChain: false, reviveCap: 2, trackReach: true });
const p0 = A.PlayerSim.run(lv, { seed: 7, instantChain: false, reviveCap: 0, trackReach: true });
const ref = p2.won ? p2 : p0;

const pickByRC = {};
for (const p of ref.pickOrder || []) pickByRC[p.r + ',' + p.c] = p;
const timelineMax = {};
for (const e of ref.reachTimeline || []) {
  if (timelineMax[e.color] == null || e.reach > timelineMax[e.color]) timelineMax[e.color] = e.reach;
}

const colorTotal = {};
for (const row of g.blocks || []) for (const x of row) if (x) colorTotal[x] = (colorTotal[x] || 0) + 1;

const chainColors = new Set();
const cars = [];
for (let r = 0; r < g.spools.length; r++) {
  for (let c = 0; c < g.spools[r].length; c++) {
    const car = g.spools[r][c];
    if (!car || !(car.id > 0)) continue;
    const ts = Array.isArray(car.type) ? car.type : [car.type || 0];
    if (ts.indexOf(5) >= 0) chainColors.add(car.id);
    const pick = pickByRC[r + ',' + c];
    cars.push({
      r, c, color: car.id, orig: car.count,
      step: pick ? pick.step : Infinity,
      reach: pick ? pick.reachAtPick : (timelineMax[car.id] || 0),
      picked: !!pick
    });
  }
}

const byColor = {};
for (const x of cars) (byColor[x.color] = byColor[x.color] || []).push(x);

const plan = { level: file, ref: p2.won ? 'revive2' : 'revive0', colors: [] };
const out = JSON.parse(JSON.stringify(g));
for (const color of Object.keys(byColor)) {
  const list = byColor[color].slice().sort((a, b) => (a.step - b.step) || (a.r - b.r) || (a.c - b.c));
  const total = colorTotal[color] || list.reduce((a, x) => a + x.orig, 0);
  let status = 'planned';
  let reason = '';
  let caps = list.map(x => Math.max(0, Math.min(x.orig, x.reach)));
  let sum = caps.reduce((a, b) => a + b, 0);
  if (chainColors.has(color)) { status = 'skip'; reason = 'chain'; }
  else if (list.some(x => x.reach < 1)) { status = 'skip'; reason = 'reach0'; }
  else if (sum > total) { status = 'skip'; reason = 'sum>total'; }
  else {
    let leftover = total - sum;
    // 先给「已拿且还有 spare」的车，按 reach 降序；再给未拿的
    const order = list.map((x, i) => ({ i, picked: x.picked, spare: Math.max(0, x.reach - caps[i]) }))
      .filter(x => x.spare > 0)
      .sort((a, b) => (b.picked - a.picked) || (b.spare - a.spare));
    for (const o of order) {
      if (leftover <= 0) break;
      const add = Math.min(leftover, o.spare);
      caps[o.i] += add; leftover -= add;
    }
    if (leftover > 0) { status = 'skip'; reason = 'not enough reach (' + leftover + ' left)'; caps = list.map(x => x.orig); }
  }
  if (status !== 'planned') caps = list.map(x => x.orig);
  const rows = list.map((x, i) => ({
    r: x.r, c: x.c, step: x.step === Infinity ? 'unpicked' : x.step,
    reach: x.reach, orig: x.orig, planned: caps[i]
  }));
  plan.colors.push({ color: +color, total, status, reason, cars: rows });
  list.forEach((x, i) => { out.spools[x.r][x.c].count = caps[i]; });
}

fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
if (reportFile) fs.writeFileSync(reportFile, JSON.stringify(plan, null, 2));

for (const c of plan.colors) {
  const changed = c.cars.filter(x => x.orig !== x.planned);
  if (!changed.length && c.status === 'planned') continue;
  console.log(`color ${c.color} (total ${c.total}) ${c.status}${c.reason ? ' · ' + c.reason : ''}: ` +
    c.cars.map(x => `${x.r},${x.c} ${x.step}:${x.orig}→${x.planned}(r${x.reach})`).join(' | '));
}
const planned = plan.colors.filter(c => c.status === 'planned').length;
console.log(`planned ${planned}/${plan.colors.length} colors; saved ${outFile}`);
