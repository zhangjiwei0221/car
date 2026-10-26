#!/usr/bin/env node
/** v531：2/3分支入口 + 分支入口债务车的只读原型，记录黑块与plan/solver差异。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..'), BIN = path.join(ROOT, '02_工程', '完整主bin快照_20261012', 'bin', 'js');
const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js', 'playersim.js', 'analysis.js', 'car-sequencer.js', 'solver-analysis.js', 'experience-goal.js', 'capacity-tuner.js', 'instant-playout.js', 'generator.js'];
const sb = { console: { log() {}, warn() {}, error() {} }, module: { exports: {} }, WeakMap, Map, Set, Date, Math, JSON, setTimeout, clearTimeout, Infinity };
vm.createContext(sb); for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BIN, f), 'utf8'), sb, { filename: f });
const A = sb.AntSolver, G = A.Generator;
function routeOf(level) { return level.board.instantPlanCells.map((p, i) => ({ r: p.r, c: p.c, color: p.color, count: p.count, step: i, chainIndex: 0 })); }
function ev(level, route) { return A.ExperienceGoal.evaluate(level, { solveResult: { pickOrder: route, completed: true }, decision: true, instantChain: true }); }
const out = { schema: 'instant-branching-v1', date: '2026-10-26', rows: [] };
for (const s of [{ id: '006', debt: 40 }, { id: '010', debt: 40 }, { id: '007', debt: 40 }]) {
  const blocks = G.blocksFromTXT(fs.readFileSync(path.join(ROOT, '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_' + s.id + '.txt'), 'utf8'));
  const band = G.deriveCapacityBand(blocks);
  for (const branch of [2, 3]) {
    const cfg = { seed: 1001, candidateCount: 1, rounds: 0, timeBudgetMs: 12000, ruleMode: 'instantChain', generatorFlow: 'new_fixed',
      boxSizeMin: band.band[0], boxSizeMax: band.band[1], capNormMin: band.band[0], capNormMax: band.band[1],
      boardRowsMin: 6, boardRowsMax: 9, boardColsMin: 6, boardColsMax: 11, boardHardRange: true, boardAuto: false, boardAllowSquare: true, boardFitGuard: 'warn',
      p7BaseCount: 0, p7Repair: false, trapPost: false, pool: 1, instantPlanPolicy: 'targetBuffer', instantPlanTargetBuffer: 4,
      instantPlanMaxDebt: s.debt, instantPlanBranchCount: branch, instantPlanBranchDebtRoots: true };
    const t = Date.now(), r = G.produceFixed(blocks, cfg), route = r && r.level ? routeOf(r.level) : [];
    const pe = r && r.level ? ev(r.level, route) : null, se = r && r.level ? ev(r.level, r.solveResult.pickOrder) : null;
    let cellCount = 0, black = 0;
    if (r && r.level) { cellCount = r.level.board.rows * r.level.board.cols; black = r.level.board.cells.flat().filter(x => x && x.t === 'black').length; }
    out.rows.push({ image: s.id, branch, ms: Date.now() - t, level: !!(r && r.level), structural: r && r.structural, reason: r && r.lastFailReason,
      board: r && r.level ? { rows: r.level.board.rows, cols: r.level.board.cols } : null, black, blackPct: cellCount ? +(black / cellCount * 100).toFixed(1) : null,
      roots: r && r.config && r.config._instantPlanBranchDebtRoots || null,
      plan: pe && { pass: pe.pass, mid: pe.metrics && pe.metrics.midBuffer34Pct, max: pe.metrics && pe.metrics.maxBuffer, release: pe.releaseDecision && pe.releaseDecision.status },
      solver: se && { pass: se.pass, mid: se.metrics && se.metrics.midBuffer34Pct, max: se.metrics && se.metrics.maxBuffer, release: se.releaseDecision && se.releaseDecision.status },
      capacity: r && r.level ? A.Quality.capacityEvidence(r.level, r.config || cfg) : null });
    console.log(JSON.stringify(out.rows[out.rows.length - 1]));
  }
}
out.summary = { rows: out.rows.length, planPass: out.rows.filter(x => x.plan && x.plan.pass).length,
  solverPass: out.rows.filter(x => x.solver && x.solver.pass).length,
  maxBlackPct: Math.max.apply(null, out.rows.map(x => x.blackPct || 0)),
  decision: '分支入口+入口债务车能保持黑块较低，但仍存在低压求解绕路；下一项做分支级车序/路线选择。' };
fs.writeFileSync(path.join(__dirname, '瞬时有限分支_v531.json'), JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out.summary, null, 2));
