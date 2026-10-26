#!/usr/bin/env node
/** v560：验证生产尺寸偏好接线、A/B 结果与已知成功保护。只读回归。 */
'use strict';

const fs = require('fs'), path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '完整主bin快照_20261012', 'bin');
const OUT = path.join(__dirname, '生产棋盘偏好回归_v560.json');
const html = fs.readFileSync(path.join(BIN, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(BIN, 'js', 'app.js'), 'utf8');
const generator = fs.readFileSync(path.join(BIN, 'js', 'generator.js'), 'utf8');
const ab = JSON.parse(fs.readFileSync(path.join(__dirname, '生产尺寸偏好AB_v560.json'), 'utf8'));
const protection = JSON.parse(fs.readFileSync(path.join(__dirname, '目标显著释放接入_v560-protection.json'), 'utf8'));

const byArm = {};
for (const s of ab.summary) byArm[s.arm] = s;
const checks = {
  pageVersion: /车接小人 v560/.test(html) && /id="app-ver"[^>]*>v560</.test(html),
  cacheVersion20: (html.match(/\?v=560/g) || []).length === 20,
  appBuild560: /var APP_BUILD = "560";/.test(app),
  appEnablesPrefer7: /boardPrefer7: true/.test(app),
  appRecordsPrefer7: /boardPrefer7: !!result\.config\.boardPrefer7/.test(app),
  generatorDefaultOff: /boardPrefer7: false/.test(generator),
  targetOnlySwitch: /config\.boardPrefer7 === true && config\.acceptMode === 'target'/.test(generator),
  noSixBySixPreference: !/BOARD_PREFER7_DEFAULT[^\n]*6x6/.test(generator),
  allPlanDimsAtLeast7: (function() {
    const m = /BOARD_PREFER7_DEFAULT = \[([^\]]+)\]/.exec(generator);
    if (!m) return false;
    const dims = m[1].match(/\d+x\d+/g) || [];
    return dims.length >= 7 && dims.every(function(d) {
      const x = d.split('x').map(Number);
      return x[0] >= 7 && x[1] >= 7 && x[0] <= 9 && x[1] <= 9;
    });
  })(),
  abComplete: ab.runs.length === 24 && ab.summary.length === 2,
  bStructureNotWorse: !!byArm.B && !!byArm.A && byArm.B.structPass >= byArm.A.structPass,
  bGoalNotWorse: !!byArm.B && !!byArm.A && byArm.B.goalPass >= byArm.A.goalPass,
  bCapacityHardGate: !!byArm.B && byArm.B.aboveMax === 0,
  bAtLeastElevenPreferred: !!byArm.B && byArm.B.prefer7Generated >= 11,
  knownReleaseProtection: protection.summary && protection.summary.pass === true,
  timeModeUnchanged: protection.summary && protection.summary.timeMode &&
    protection.summary.timeMode.hashMatch === true
};

const pass = Object.keys(checks).every(function(k) { return checks[k] === true; });
const report = {
  schema: 'production-board-prefer7-regression-v560',
  date: '2026-10-26',
  checks: checks,
  evidence: {
    a: byArm.A || null,
    b: byArm.B || null,
    releaseProtection: protection.summary || null
  },
  pass: pass
};
fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (!pass) process.exitCode = 1;
