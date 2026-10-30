#!/usr/bin/env node
/** v557：验证四方向瞬时为生成/模拟默认，同时保留显式四边入口回退。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '游戏主bin', 'bin', 'js');
const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js',
  'playersim.js', 'analysis.js', 'car-sequencer.js', 'solver-analysis.js', 'experience-goal.js',
  'capacity-tuner.js', 'instant-playout.js', 'generator.js', 'source-preflight.js'];
function load() {
  const sb = { console: { log() {}, warn() {}, error() {} }, module: { exports: {} },
    WeakMap, Map, Set, Date, Math, JSON, setTimeout, clearTimeout, Infinity };
  vm.createContext(sb);
  for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BIN, f), 'utf8'), sb, { filename: f });
  return sb.AntSolver;
}
const A = load();
const normalizedDefault = A.Generator.normalizeRuleConfig({});
const explicitFour = A.Generator.normalizeRuleConfig({ ruleMode: 'fourSide' });
const explicitFourLegacy = A.Generator.normalizeRuleConfig({ instantChain: false, bottomOnly: false });
const explicitBottom = A.Generator.normalizeRuleConfig({ ruleMode: 'bottomOnly' });
const blocks = A.Generator.blocksFromTXT(fs.readFileSync(path.join(ROOT, '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_007.txt'), 'utf8'));
const probe = A.Generator.produceFixed(blocks, {
  seed: 1001, generatorFlow: 'new_fixed',
  boxSizeMin: 20, boxSizeMax: 40, capNormMin: 20, capNormMax: 40,
  boardRowsMin: 9, boardRowsMax: 9, boardColsMin: 7, boardColsMax: 7,
  boardHardRange: true, boardAuto: false, boardAllowSquare: true, boardFitGuard: 'warn',
  p7BaseCount: 0, p7Repair: false, trapPost: false, pool: 1,
  instantPlanPolicy: 'shortDebt', instantPlanTargetBuffer: 4,
  instantPlanMaxDebt: 40, instantPlanDebtEvery: 2,
  instantPlanBranchCount: 2, instantPlanBranchDebtRoots: true,
  instantPlanBranchPrefixDebts: 12,
  targetCarCount: 52, blackPercent: 10, experienceGoal: false,
  candidateCount: 1, rounds: 0, timeBudgetMs: 30000, acceptMode: 'time'
});
const html = fs.readFileSync(path.join(ROOT, '02_工程', '游戏主bin', 'bin', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(BIN, 'app.js'), 'utf8');
const checks = {
  generatorDefaultConfig: A.Generator.DEFAULT_CONFIG.instantChain === true &&
    A.Generator.DEFAULT_CONFIG.bottomOnly === false && A.Generator.DEFAULT_CONFIG.elimOrder === 'instant',
  defaultIsInstant: normalizedDefault.ruleMode === 'instantChain' &&
    normalizedDefault.instantChain === true && normalizedDefault.bottomOnly === false &&
    normalizedDefault.elimOrder === 'instant',
  explicitFourSideWorks: explicitFour.ruleMode === 'fourSide' && explicitFour.instantChain === false &&
    explicitFour.elimOrder === 'ring',
  legacyFourSideWorks: explicitFourLegacy.ruleMode === 'fourSide' && explicitFourLegacy.instantChain === false,
  explicitBottomWorks: explicitBottom.ruleMode === 'bottomOnly' && explicitBottom.bottomOnly === true &&
    explicitBottom.instantChain === false,
  productionEntryModeInstant: !!(probe && probe.valid && probe.config &&
    probe.config.ruleMode === 'instantChain' && probe.config.instantChain === true &&
    probe.config.bottomOnly === false && probe.config.elimOrder === 'instant'),
  generationSelectDefault: /<option value="2" selected>四方向瞬时连锁/.test(html),
  simulationSelectDefault: /<option value="instantChain" selected>四方向瞬时连锁/.test(html),
  pageVersion: /车接小人 v557/.test(html),
  appFallbackIsInstant: /var currentEntryMode = 'fourSideInstantChain'/.test(app) &&
    /return v === 'bottomOnly' \? 'bottomOnly' : \(v === 'fourSide' \? 'fourSide' : 'instantChain'\)/.test(app)
};
const pass = Object.keys(checks).every(k => checks[k]);
const report = { schema: 'instant-default-regression-v557', date: '2026-10-26',
  checks, pass, normalized: { default: normalizedDefault, explicitFour, explicitFourLegacy, explicitBottom },
  productionProbe: probe ? { valid: !!probe.valid, entryMode: probe.entryMode || null,
    config: probe.config ? { ruleMode: probe.config.ruleMode, instantChain: probe.config.instantChain,
      bottomOnly: probe.config.bottomOnly, elimOrder: probe.config.elimOrder } : null,
    elapsedMs: probe.elapsedMs } : null };
const out = path.join(ROOT, '03_工具', '好关评分', '瞬时默认回归_v557.json');
fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ pass, checks }, null, 2));
if (!pass) process.exitCode = 1;
