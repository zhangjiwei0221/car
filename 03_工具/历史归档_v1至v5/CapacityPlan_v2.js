#!/usr/bin/env node
'use strict';
/**
 * CapacityPlan_v2 —— 用「求解器 min 路线」做完整参考，按可达 + 时间重分容量
 *
 * 与 v1 的区别：v1 用 PlayerSim 的 2 复活路线，复活会移走车 → reach=0；
 * v2 用 Solver.runMinBuffer 的完整路线（46/46，拿起全部车），回放 Sim.applyPick，
 * 逐步算每辆车被拿时的 reach。
 *
 * 规则：
 *   1. 每辆车的容量 ≤ 参考路线里被拿时的 reach；
 *   2. 同色剩余容量按 spare（reach - cap）分给已拿的车；
 *   3. 不可行（链组 / reach0 / spare 不够）的颜色保持原样并标记。
 *
 * 用法：
 *   node CapacityPlan_v2.js <关卡.json> --out <计划关.json> [--report plan.json]
 */
const fs = require('fs');
const B = require('./Build006Thickness_v688');
const A = B.loadSolver('corner');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const file = process.argv[2];
const outFile = arg('--out', null);
const reportFile = arg('--report', null);
if (!file || !outFile) {
  console.error('用法: node CapacityPlan_v2.js <关卡.json> --out <计划关.json> [--report plan.json]');
  process.exit(2);
}

const g = B.readJson(file);
const lv = A.parseLevel(A.fromGameFormat(g));
const min = A.Solver.runMinBuffer(lv, { depth: 3, instantChain: false });
const S = A.Simulator;

// 回放 min 路线：每步取盒前，算该盒颜色的可达量
const s = S.enter(lv, { useSlotStart: true, instantChain: false, capturePreviewStats: false });
const refByRC = {};
const refByStep = {};
const byStep = {};
for (const p of min.pickOrder || []) (byStep[p.step] = byStep[p.step] || []).push(p);
for (const step of Object.keys(byStep).sort((a, b) => +a - +b)) {
  const group = byStep[step];
  for (const p of group) {
    const em = s.eliminated.map(row => row.slice());
    refByRC[p.r + ',' + p.c] = S.floodFillCount(em, s.blocks, s.rows, s.cols, p.color, s.bottomOnly);
  }
  let ok = false;
  for (const p of group) {
    if (S.applyPick(s, p.r, p.c)) { ok = true; refByStep[+step] = { r: p.r, c: p.c }; break; }
  }
  if (!ok) { console.error('min route replay stuck at step ' + step); break; }
}
const refComplete = s.completedBoxes >= (min.completedBoxes || 0);
console.error(`min route: ${min.pickOrder.length} boxes, replay completed=${s.completedBoxes}/${min.completedBoxes}, complete=${refComplete}`);

const timelineMax = {};
for (const k of Object.keys(refByRC)) {
  const p = (min.pickOrder || []).find(x => x.r + ',' + x.c === k);
  if (!p) continue;
  if (timelineMax[p.color] == null || refByRC[k] > timelineMax[p.color]) timelineMax[p.color] = refByRC[k];
}

const colorTotal = {};
for (const row of g.blocks || []) for (const x of row) if (x) colorTotal[x] = (colorTotal[x] || 0) + 1;

// 每辆车：优先取 min 路线里的 reach/step；不在路线里的用该色最大值
const minStepByRC = {};
for (const p of min.pickOrder || []) if (minStepByRC[p.r + ',' + p.c] == null) minStepByRC[p.r + ',' + p.c] = p.step;

const chainColors = new Set();
const cars = [];
for (let r = 0; r < g.spools.length; r++) {
  for (let c = 0; c < g.spools[r].length; c++) {
    const car = g.spools[r][c];
    if (!car || !(car.id > 0)) continue;
    const ts = Array.isArray(car.type) ? car.type : [car.type || 0];
    if (ts.indexOf(5) >= 0) chainColors.add(car.id);
    const key = r + ',' + c;
    cars.push({
      r, c, color: car.id, orig: car.count,
      step: minStepByRC[key] == null ? Infinity : minStepByRC[key],
      reach: refByRC[key] == null ? (timelineMax[car.id] || 0) : refByRC[key],
      picked: refByRC[key] != null
    });
  }
}

const byColor = {};
for (const x of cars) (byColor[x.color] = byColor[x.color] || []).push(x);

const plan = { level: file, ref: 'solver-min', refComplete, colors: [] };
const out = JSON.parse(JSON.stringify(g));
for (const color of Object.keys(byColor)) {
  const list = byColor[color].slice().sort((a, b) => (a.step - b.step) || (a.r - b.r) || (a.c - b.c));
  const total = colorTotal[color] || list.reduce((a, x) => a + x.orig, 0);
  let status = 'planned', reason = '';
  let caps = list.map(x => Math.max(0, Math.min(x.orig, x.reach)));
  const sum = caps.reduce((a, b) => a + b, 0);
  if (chainColors.has(color)) { status = 'skip'; reason = 'chain'; }
  else if (!refComplete) { status = 'skip'; reason = 'ref incomplete'; }
  else if (list.some(x => x.reach < 1)) { status = 'skip'; reason = 'reach0'; }
  else if (sum > total) { status = 'skip'; reason = 'sum>total'; }
  else {
    let leftover = total - sum;
    const order = list.map((x, i) => ({ i, picked: x.picked, spare: Math.max(0, x.reach - caps[i]) }))
      .filter(x => x.spare > 0)
      .sort((a, b) => (b.picked - a.picked) || (b.spare - a.spare));
    for (const o of order) {
      if (leftover <= 0) break;
      const add = Math.min(leftover, o.spare);
      caps[o.i] += add; leftover -= add;
    }
    if (leftover > 0) { status = 'skip'; reason = 'not enough reach (' + leftover + ')'; caps = list.map(x => x.orig); }
  }
  if (status !== 'planned') caps = list.map(x => x.orig);
  plan.colors.push({
    color: +color, total, status, reason,
    cars: list.map((x, i) => ({
      r: x.r, c: x.c, step: x.step === Infinity ? 'unpicked' : x.step,
      reach: x.reach, orig: x.orig, planned: caps[i]
    }))
  });
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
