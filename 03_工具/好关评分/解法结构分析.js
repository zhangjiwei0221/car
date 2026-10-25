#!/usr/bin/env node
/**
 * 多路线与关键状态反事实（只读，不改生产）：
 * node 03_工具/好关评分/解法结构分析.js <关卡.json> [--out 报告.json]
 *   [--time 2500] [--nodes 4000] [--width 16] [--routes 6]
 *   [--decisions 4] [--alternatives 2] [--alt-time 600] [--policy uniform|value]
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const BIN = path.join(__dirname, '..', '..', '02_工程', '完整主bin快照_20261012', 'bin', 'js');
const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js', 'playersim.js', 'analysis.js', 'solver-analysis.js'];
const sandbox = { console: { log() {}, warn() {}, error() {} }, module: { exports: {} }, WeakMap, Map, Set,
  setTimeout, clearTimeout, Infinity, Math, JSON, Date };
vm.createContext(sandbox);
for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BIN, f), 'utf8'), sandbox, { filename: f });
const args = process.argv.slice(2), file = args[0];
if (!file) { console.error('用法：node 解法结构分析.js <关卡.json> [--out 报告.json]'); process.exit(1); }
function opt(name, fallback) { const i = args.indexOf('--' + name); return i >= 0 && args[i + 1] ? +args[i + 1] : fallback; }
function strOpt(name, fallback) { const i = args.indexOf('--' + name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; }
const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
const level = raw.spools ? sandbox.AntSolver.fromGameFormat(raw) : raw;
const report = sandbox.AntSolver.SolverAnalysis.analyze(level, {
  timeBudgetMs: opt('time', 2500), maxNodes: opt('nodes', 4000), beamWidth: opt('width', 16),
  maxRoutes: opt('routes', 6), branchWidth: opt('branch', 8), maxDecisionPoints: opt('decisions', 4),
  maxAlternatives: opt('alternatives', 2), decisionPolicy: strOpt('policy', 'uniform'), timePerAlternativeMs: opt('alt-time', 600),
  maxNodesPerAlternative: opt('alt-nodes', 1200)
});
report.input = path.resolve(file);
const out = strOpt('out', '');
if (out) fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
const alts = report.counterfactual.decisions.reduce((n, d) => n + d.alternatives.length, 0);
const solved = report.counterfactual.decisions.reduce((n, d) => n + d.alternatives.filter(a => a.outcome === 'solved').length, 0);
const dead = report.counterfactual.decisions.reduce((n, d) => n + d.alternatives.filter(a => a.outcome === 'dead').length, 0);
console.log(JSON.stringify({ file, out: out || null, elapsedMs: report.elapsedMs,
  baseline: report.baseline && { completed: report.baseline.completed, replayValid: report.baseline.replayValid, maxBuffer: report.baseline.maxBuffer },
  multi: { status: report.multi.status, routes: report.multi.routes.length, distinctRoutes: report.multi.distinctRoutes,
    replayValid: report.multi.routes.filter(r => r.replayValid).length, nodes: report.multi.nodes, elapsedMs: report.multi.elapsedMs },
  bestKnown: report.bestKnown,
  counterfactual: { decisions: report.counterfactual.decisions.length, alternatives: alts, solved, dead } }, null, 2));
