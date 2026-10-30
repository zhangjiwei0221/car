#!/usr/bin/env node
/** v558：验证生成模式默认按目标，缺失控件回退也按目标。 */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(ROOT, '02_工程', '游戏主bin', 'bin', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(ROOT, '02_工程', '游戏主bin', 'bin', 'js', 'app.js'), 'utf8');
const checks = {
  goalOptionSelected: /<option value="goal" selected>按目标（预算内达标才停）<\/option>/.test(html),
  timeOptionNotSelected: /<option value="time">按时间（到点出最好）<\/option>/.test(html) &&
    !/<option value="time" selected>/.test(html),
  initialHintGoal: /<span class="gen-hint" id="gen-mode-hint">总预算内达标即停；到点输出当前最好<\/span>/.test(html),
  fallbackGoal: /var genMode = \(modeEl && modeEl\.value === 'time'\) \? 'time' : 'goal';/.test(app),
  pageVersion: /车接小人 v558/.test(html)
};
const pass = Object.keys(checks).every(k => checks[k]);
const out = path.join(ROOT, '03_工具', '好关评分', '生成模式默认回归_v558.json');
fs.writeFileSync(out, JSON.stringify({ schema: 'goal-mode-default-regression-v558', date: '2026-10-26', checks, pass }, null, 2) + '\n');
console.log(JSON.stringify({ pass, checks }, null, 2));
if (!pass) process.exitCode = 1;
