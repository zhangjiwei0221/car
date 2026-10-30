#!/usr/bin/env node
/** v529：mixedDebt频率的端到端体验筛选（计划路线+求解路线）。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..'), BIN = path.join(ROOT, '02_工程', '游戏主bin', 'bin', 'js');
const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js', 'playersim.js', 'analysis.js', 'car-sequencer.js', 'solver-analysis.js', 'experience-goal.js', 'capacity-tuner.js', 'instant-playout.js', 'generator.js'];
const sb = { console: { log() {}, warn() {}, error() {} }, module: { exports: {} }, WeakMap, Map, Set, Date, Math, JSON, setTimeout, clearTimeout, Infinity };
vm.createContext(sb); for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BIN, f), 'utf8'), sb, { filename: f });
const A = sb.AntSolver, G = A.Generator;
function planRoute(level) { return (level && level.board && level.board.instantPlanCells || []).map((p, i) => ({ r: p.r, c: p.c, color: p.color, count: p.count, step: i, chainIndex: 0 })); }
function slim(ev) { return ev && { pass: ev.pass, status: ev.status, reasons: ev.reasons, curvePass: ev.curvePass, metrics: ev.metrics,
  release: ev.releaseDecision && { status: ev.releaseDecision.status, found: ev.releaseDecision.found, evidence: ev.releaseDecision.evidence } }; }
const out = { schema: 'instant-debt-strategy-v1', date: '2026-10-26', rows: [] };
for (const id of ['006', '010', '007']) {
  const blocks = G.blocksFromTXT(fs.readFileSync(path.join(ROOT, '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_' + id + '.txt'), 'utf8'));
  const band = G.deriveCapacityBand(blocks);
  const cases = [
    { name: 'mixed3', policy: 'mixedDebt', debtEvery: 3 },
    { name: 'target2', policy: 'targetBuffer', targetBuffer: 2 },
    { name: 'target3', policy: 'targetBuffer', targetBuffer: 3 },
    { name: 'target2d16', policy: 'targetBuffer', targetBuffer: 2, maxDebt: 16 },
    { name: 'target2d40', policy: 'targetBuffer', targetBuffer: 2, maxDebt: 40 },
    { name: 'target3d12', policy: 'targetBuffer', targetBuffer: 3, maxDebt: 12 },
    { name: 'target3d16', policy: 'targetBuffer', targetBuffer: 3, maxDebt: 16 },
    { name: 'target3d40', policy: 'targetBuffer', targetBuffer: 3, maxDebt: 40 }
    ,{ name: 'target4d8', policy: 'targetBuffer', targetBuffer: 4, maxDebt: 8 }
    ,{ name: 'target4d12', policy: 'targetBuffer', targetBuffer: 4, maxDebt: 12 }
    ,{ name: 'target4d16', policy: 'targetBuffer', targetBuffer: 4, maxDebt: 16 }
    ,{ name: 'target4d24', policy: 'targetBuffer', targetBuffer: 4, maxDebt: 24 }
    ,{ name: 'target4d40', policy: 'targetBuffer', targetBuffer: 4, maxDebt: 40 }
  ];
  for (const tc of cases) {
    const cfg = { seed: 1001, candidateCount: 1, rounds: 0, timeBudgetMs: 12000, ruleMode: 'instantChain', generatorFlow: 'new_fixed',
      boxSizeMin: band.band[0], boxSizeMax: band.band[1], capNormMin: band.band[0], capNormMax: band.band[1],
      boardRowsMin: 6, boardRowsMax: 9, boardColsMin: 6, boardColsMax: 11, boardHardRange: true, boardAllowSquare: true,
      p7BaseCount: 0, p7Repair: false, trapPost: false, pool: 1, instantPlanPolicy: tc.policy,
      instantPlanDebtEvery: tc.debtEvery || 4, instantPlanTargetBuffer: tc.targetBuffer || 3, instantPlanMaxDebt: tc.maxDebt || 8 };
    const t = Date.now(), r = G.produceFixed(blocks, cfg), route = planRoute(r && r.level), plan = r && r.config && r.config._instantPlayoutStat;
    const planEv = r && r.level ? A.ExperienceGoal.evaluate(r.level, { solveResult: { pickOrder: route, completed: true }, decision: true, instantChain: true }) : null;
    const solverEv = r && r.level ? A.ExperienceGoal.evaluate(r.level, { solveResult: r.solveResult, decision: true, instantChain: true }) : null;
    const row = { image: id, case: tc.name, debtEvery: tc.debtEvery || null, targetBuffer: tc.targetBuffer || null, maxDebt: tc.maxDebt || 8, ms: Date.now() - t, level: !!(r && r.level), valid: !!(r && r.valid), structural: r && r.structural,
      planCars: plan && plan.cars, maxPlayoutBuffer: plan && plan.maxBuffer, debtCars: plan && plan.debtCars,
      capacity: r && r.level ? A.Quality.capacityEvidence(r.level, r.config || cfg) : null,
      planRoute: slim(planEv), solverRoute: slim(solverEv), board: r && r.level && r.level.board ? { rows: r.level.board.rows, cols: r.level.board.cols } : null };
    out.rows.push(row);
    console.log(JSON.stringify({ image: id, case: tc.name, maxPlayoutBuffer: row.maxPlayoutBuffer, debtCars: row.debtCars,
      plan: { pass: planEv && planEv.pass, mid: planEv && planEv.metrics && planEv.metrics.midBuffer34Pct, max: planEv && planEv.metrics && planEv.metrics.maxBuffer, rel: planEv && planEv.releaseDecision && planEv.releaseDecision.status },
      solver: { pass: solverEv && solverEv.pass, mid: solverEv && solverEv.metrics && solverEv.metrics.midBuffer34Pct, max: solverEv && solverEv.metrics && solverEv.metrics.maxBuffer, rel: solverEv && solverEv.releaseDecision && solverEv.releaseDecision.status } }));
  }
}
out.summary = { runs: out.rows.length, planPass: out.rows.filter(x => x.planRoute && x.planRoute.pass).length,
  solverPass: out.rows.filter(x => x.solverRoute && x.solverRoute.pass).length,
  bestByImage: Object.fromEntries(['006', '010', '007'].map(id => {
    const rs = out.rows.filter(x => x.image === id && x.planRoute && x.planRoute.metrics);
    rs.sort((a, b) => (b.planRoute.pass - a.planRoute.pass) || (b.planRoute.metrics.midBuffer34Pct - a.planRoute.metrics.midBuffer34Pct));
    return [id, rs[0] && { case: rs[0].case, debtEvery: rs[0].debtEvery, targetBuffer: rs[0].targetBuffer, mid: rs[0].planRoute.metrics.midBuffer34Pct, max: rs[0].planRoute.metrics.maxBuffer,
      release: rs[0].planRoute.release && rs[0].planRoute.release.status, pass: rs[0].planRoute.pass }];
  })) };
fs.writeFileSync(path.join(__dirname, '瞬时债务策略_v529.json'), JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out.summary, null, 2));
