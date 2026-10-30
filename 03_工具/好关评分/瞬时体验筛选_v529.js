#!/usr/bin/env node
/** v529：计划参考路线 vs 求解器最佳路线的完整体验筛选。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..'), BIN = path.join(ROOT, '02_工程', '游戏主bin', 'bin', 'js');
const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js', 'playersim.js', 'analysis.js', 'car-sequencer.js', 'solver-analysis.js', 'experience-goal.js', 'capacity-tuner.js', 'instant-playout.js', 'generator.js'];
const sb = { console: { log() {}, warn() {}, error() {} }, module: { exports: {} }, WeakMap, Map, Set, Date, Math, JSON, setTimeout, clearTimeout, Infinity };
vm.createContext(sb); for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BIN, f), 'utf8'), sb, { filename: f });
const A = sb.AntSolver, G = A.Generator;
function planRoute(level) {
  return (level && level.board && level.board.instantPlanCells || []).map((p, i) => ({ r: p.r, c: p.c, color: p.color, count: p.count, step: i, chainIndex: 0 }));
}
function slim(ev) {
  return ev && { pass: ev.pass, status: ev.status, reasons: ev.reasons, curvePass: ev.curvePass,
    metrics: ev.metrics, release: ev.releaseDecision && { status: ev.releaseDecision.status, found: ev.releaseDecision.found,
      decisionsTried: ev.releaseDecision.decisionsTried, alternativesTried: ev.releaseDecision.alternativesTried,
      unknown: ev.releaseDecision.unknownAlternatives, evidence: ev.releaseDecision.evidence } };
}
const out = { schema: 'instant-experience-screen-v1', date: '2026-10-26', images: {} };
for (const id of ['006', '010', '007']) {
  const blocks = G.blocksFromTXT(fs.readFileSync(path.join(ROOT, '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_' + id + '.txt'), 'utf8'));
  const band = G.deriveCapacityBand(blocks);
  const cfg = { seed: 1001, candidateCount: 1, rounds: 0, timeBudgetMs: 12000, ruleMode: 'instantChain', generatorFlow: 'new_fixed',
    boxSizeMin: band.band[0], boxSizeMax: band.band[1], capNormMin: band.band[0], capNormMax: band.band[1],
    boardRowsMin: 6, boardRowsMax: 9, boardColsMin: 6, boardColsMax: 11, boardHardRange: true, boardAllowSquare: true,
    p7BaseCount: 0, p7Repair: false, trapPost: false, pool: 1 };
  const t = Date.now(), r = G.produceFixed(blocks, cfg), route = planRoute(r && r.level), solve = r && r.solveResult;
  const planEv = r && r.level ? A.ExperienceGoal.evaluate(r.level, { solveResult: { pickOrder: route, completed: route.length > 0 },
    decision: true, instantChain: true }) : null;
  const solverEv = r && r.level ? A.ExperienceGoal.evaluate(r.level, { solveResult: solve, decision: true, instantChain: true }) : null;
  out.images[id] = { ms: Date.now() - t, level: !!(r && r.level), valid: !!(r && r.valid), planSteps: route.length,
    plan: slim(planEv), solver: slim(solverEv), selected: r && r.solveResult && route.length ? 'both-recorded' : 'missing',
    board: r && r.level && r.level.board ? { rows: r.level.board.rows, cols: r.level.board.cols } : null };
  console.log(id, JSON.stringify({ plan: { pass: planEv && planEv.pass, metrics: planEv && planEv.metrics, release: planEv && planEv.releaseDecision && planEv.releaseDecision.status },
    solver: { pass: solverEv && solverEv.pass, metrics: solverEv && solverEv.metrics, release: solverEv && solverEv.releaseDecision && solverEv.releaseDecision.status } }));
}
fs.writeFileSync(path.join(__dirname, '瞬时体验筛选_v529.json'), JSON.stringify(out, null, 2) + '\n');
