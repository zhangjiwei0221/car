#!/usr/bin/env node
/** v530：单入口隔行走廊上界实验；只验证路线隔离效果，不作为默认生产。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..'), BIN = path.join(ROOT, '02_工程', '完整主bin快照_20261012', 'bin', 'js');
const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js', 'playersim.js', 'analysis.js', 'car-sequencer.js', 'solver-analysis.js', 'experience-goal.js', 'capacity-tuner.js', 'instant-playout.js', 'generator.js'];
const sb = { console: { log() {}, warn() {}, error() {} }, module: { exports: {} }, WeakMap, Map, Set, Date, Math, JSON, setTimeout, clearTimeout, Infinity };
vm.createContext(sb); for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BIN, f), 'utf8'), sb, { filename: f });
const A = sb.AntSolver, G = A.Generator;
function routeOf(level) { return level.board.instantPlanCells.map((p, i) => ({ r: p.r, c: p.c, color: p.color, count: p.count, step: i, chainIndex: 0 })); }
function ev(level, route) { return A.ExperienceGoal.evaluate(level, { solveResult: { pickOrder: route, completed: true }, decision: true, instantChain: true }); }
const out = { schema: 'instant-single-entry-bound-v1', date: '2026-10-26', rows: [] };
for (const s of [{ id: '006', debt: 24, rows: 8, cols: 10 }, { id: '010', debt: 40, rows: 6, cols: 8 }, { id: '007', debt: 40, rows: 9, cols: 11 }]) {
  const blocks = G.blocksFromTXT(fs.readFileSync(path.join(ROOT, '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_' + s.id + '.txt'), 'utf8'));
  const band = G.deriveCapacityBand(blocks), cfg = { seed: 1001, candidateCount: 1, rounds: 0, timeBudgetMs: 12000, ruleMode: 'instantChain', generatorFlow: 'new_fixed',
    boxSizeMin: band.band[0], boxSizeMax: band.band[1], capNormMin: band.band[0], capNormMax: band.band[1],
    boardRowsMin: s.rows, boardRowsMax: s.rows, boardColsMin: s.cols, boardColsMax: s.cols, boardHardRange: true, boardAuto: false, boardAllowSquare: true,
    boardFitGuard: 'warn', p7BaseCount: 0, p7Repair: false, trapPost: false, pool: 1,
    instantPlanPolicy: 'targetBuffer', instantPlanTargetBuffer: 4, instantPlanMaxDebt: s.debt, instantPlanSingleEntry: true };
  const t = Date.now(), r = G.produceFixed(blocks, cfg), route = r && r.level ? routeOf(r.level) : [];
  const planEv = r && r.level ? ev(r.level, route) : null, solverEv = r && r.level ? ev(r.level, r.solveResult.pickOrder) : null;
  const cells = r && r.level ? [].concat.apply([], r.level.board.cells) : [], black = cells.filter(x => x && x.t === 'black').length;
  out.rows.push({ image: s.id, ms: Date.now() - t, level: !!(r && r.level), board: r && r.level ? { rows: r.level.board.rows, cols: r.level.board.cols } : null,
    black, blackPct: r && r.level ? +(black / (r.level.board.rows * r.level.board.cols) * 100).toFixed(1) : null,
    planPass: !!(planEv && planEv.pass), solverPass: !!(solverEv && solverEv.pass),
    plan: planEv && { mid: planEv.metrics.midBuffer34Pct, max: planEv.metrics.maxBuffer, release: planEv.releaseDecision && planEv.releaseDecision.status },
    solver: solverEv && { mid: solverEv.metrics.midBuffer34Pct, max: solverEv.metrics.maxBuffer, release: solverEv.releaseDecision && solverEv.releaseDecision.status },
    capacity: r && r.level ? A.Quality.capacityEvidence(r.level, r.config || cfg) : null });
  console.log(JSON.stringify(out.rows[out.rows.length - 1]));
}
out.summary = { rows: out.rows.length, planPass: out.rows.filter(x => x.planPass).length, solverPass: out.rows.filter(x => x.solverPass).length,
  maxBlackPct: Math.max.apply(null, out.rows.map(x => x.blackPct || 0)), acceptedAsDefault: false,
  decision: '路线隔离有效，但黑块43.8~53.8%且盘面偏大，不接默认；下一步改为有限分支迷宫。' };
fs.writeFileSync(path.join(__dirname, '瞬时单入口约束_v530.json'), JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out.summary, null, 2));
