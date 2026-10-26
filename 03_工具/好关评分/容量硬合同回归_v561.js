#!/usr/bin/env node
/** v561：容量卡点硬上限、逐色守恒与已知成功保护回归。 */
'use strict';

const fs = require('fs'), path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '完整主bin快照_20261012', 'bin');
const html = fs.readFileSync(path.join(BIN, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(BIN, 'js', 'app.js'), 'utf8');
const generator = fs.readFileSync(path.join(BIN, 'js', 'generator.js'), 'utf8');
const utils = fs.readFileSync(path.join(BIN, 'js', 'utils.js'), 'utf8');
const capTest = JSON.parse(fs.readFileSync(path.join(__dirname, '容量越界修复测试_v561.json'), 'utf8'));
const protection = JSON.parse(fs.readFileSync(path.join(__dirname, '目标显著释放接入_v561-protection.json'), 'utf8'));
const repro = JSON.parse(fs.readFileSync(path.join(__dirname, '容量越界修复后复现_v561.json'), 'utf8'));
const newRepro = repro.rows.find(function(x) { return x.arm === 'new' && x.image === 'recommend'; });
const oldRepro = repro.rows.find(function(x) { return x.arm === 'old' && x.image === 'recommend'; });

const checks = {
  pageVersion: /车接小人 v561/.test(html) && /id="app-ver"[^>]*>v561</.test(html),
  cacheVersion20: (html.match(/\?v=561/g) || []).length === 20,
  appBuild561: /var APP_BUILD = "561";/.test(app),
  targetPreferenceStillOn: /boardPrefer7: true/.test(app),
  bigBoxClampPresent: /uncappedTarget/.test(generator) &&
    /target = Math\.min\(contractMax, Math\.max\(min, target\)\)/.test(generator),
  spreadClampPresent: /want = Math\.min\(want, contractMax\)/.test(generator),
  perColorEvidencePresent: /perColorConserved: perColorConserved/.test(utils) &&
    /colorMismatches: colorMismatches/.test(utils),
  targetGateUsesPerColor: /ca\.perColorConserved !== false/.test(generator),
  causalFixTest: capTest.pass === true,
  oldAboveMaxReproduced: !!oldRepro && !!oldRepro.capacity && oldRepro.capacity.aboveMax === 1,
  newAboveMaxRemoved: !!newRepro && !!newRepro.capacity && newRepro.capacity.aboveMax === 0,
  knownSuccessProtection: protection.summary && protection.summary.pass === true,
  timeModeUnchanged: protection.summary && protection.summary.timeMode &&
    protection.summary.timeMode.hashMatch === true
};
const pass = Object.keys(checks).every(function(k) { return checks[k] === true; });
const report = {
  schema: 'capacity-hard-contract-regression-v561',
  date: '2026-10-26',
  checks: checks,
  evidence: {
    causalFixTest: capTest,
    oldRepro: oldRepro || null,
    newRepro: newRepro || null,
    protection: protection.summary || null
  },
  pass: pass
};
fs.writeFileSync(path.join(__dirname, '容量硬合同回归_v561.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (!pass) process.exitCode = 1;
