#!/usr/bin/env node
/* 只读债务生命周期：node 03_工具/好关评分/债务时间线.js <关卡.json> [--out 报告.json] */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const BIN = path.join(__dirname, '..', '..', '02_工程', '游戏主bin', 'bin', 'js');
const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js', 'playersim.js', 'analysis.js', 'solver-analysis.js', 'car-sequencer.js'];
const sandbox = { console: { log() {}, warn() {}, error() {} }, module: { exports: {} }, WeakMap, Map, Set, Date, Math, JSON };
vm.createContext(sandbox); for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BIN, f), 'utf8'), sandbox, { filename: f });
const A = sandbox.AntSolver, file = process.argv[2]; if (!file) throw new Error('需要关卡 JSON');
const out = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : '';
const raw = JSON.parse(fs.readFileSync(file, 'utf8')), level = A.parseLevel(raw.spools ? A.fromGameFormat(raw) : raw);
const solved = A.Solver.solve(level, { timeBudgetMs: 10000 });
const result = A.CarSequencer.debtTimeline(level, solved);
result.input = path.resolve(file); result.solverCompleted = !!solved.completed;
if (out) fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ file, solverCompleted: result.solverCompleted, replayCompleted: result.completed, summary: result.summary }, null, 2));
