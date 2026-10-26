#!/usr/bin/env node
/** v565：有界局部交换生产接线与同预算A/B回归。 */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '完整主bin快照_20261012', 'bin');
const html = fs.readFileSync(path.join(BIN, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(BIN, 'js', 'app.js'), 'utf8');
const generator = fs.readFileSync(path.join(BIN, 'js', 'generator.js'), 'utf8');
const ab = JSON.parse(fs.readFileSync(path.join(__dirname, '有界局部交换AB_v565.json'), 'utf8'));
const protection = JSON.parse(fs.readFileSync(path.join(__dirname, '目标显著释放接入_v565-protection.json'), 'utf8'));
const byArm = {};
for (const s of ab.summary) byArm[s.arm] = s;
const repairs = ab.rows.filter(function(x) { return x.arm === 'B' && x.localSwapRepair && x.localSwapRepair.applied; });
const overheads = repairs.map(function(x) { return x.localSwapRepair.overheadMs || 0; }).sort(function(a, b) { return a - b; });
const overheadMedian = overheads.length ? overheads[Math.floor(overheads.length / 2)] : null;
const overheadMax = overheads.length ? overheads[overheads.length - 1] : null;
const checks = {
  pageVersion: /车接小人 v565/.test(html) && /id="app-ver"[^>]*>v565</.test(html),
  cacheVersion20: (html.match(/\?v=565/g) || []).length === 20,
  appBuild565: /var APP_BUILD = "565";/.test(app),
  targetRepairEnabled: /localSwapRepair: true/.test(app),
  generatorHasRepair: /function localSwapRepairOnce/.test(generator) &&
    /planned_route_/.test(generator),
  abComplete: ab.rows.length === 12,
  bStruct6: !!byArm.B && byArm.B.struct === 6,
  bGoal6: !!byArm.B && byArm.B.goal === 6,
  aStruct2: !!byArm.A && byArm.A.struct === 2,
  noGoalRegression: ab.pairs.every(function(x) { return x.noRegression; }),
  hardCapacityOk: byArm.B && byArm.B.aboveMax === 0 && byArm.B.perColorFail === 0,
  repairsAtLeast5: repairs.length >= 5,
  overheadMedianAtMost8s: overheadMedian != null && overheadMedian <= 8000,
  overheadMaxAtMost8s: overheadMax != null && overheadMax <= 8000,
  knownProtection: protection.summary && protection.summary.pass === true,
  timeModeHash: protection.summary && protection.summary.timeMode &&
    protection.summary.timeMode.hashMatch === true
};
const pass = Object.keys(checks).every(function(k) { return checks[k] === true; });
const report = {
  schema: 'bounded-local-swap-regression-v565',
  date: '2026-10-26',
  checks: checks,
  evidence: {
    a: byArm.A || null,
    b: byArm.B || null,
    repairCount: repairs.length,
    overheadMedianMs: overheadMedian,
    overheadMaxMs: overheadMax,
    protection: protection.summary || null
  },
  pass: pass
};
fs.writeFileSync(path.join(__dirname, '有界局部交换回归_v565.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (!pass) process.exitCode = 1;
