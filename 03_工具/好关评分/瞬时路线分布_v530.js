#!/usr/bin/env node
/** v530：target4计划关卡的路线分布与压力对比，先只读不约束。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..'), BIN = path.join(ROOT, '02_工程', '游戏主bin', 'bin', 'js');
const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js', 'playersim.js', 'analysis.js', 'car-sequencer.js', 'solver-analysis.js', 'experience-goal.js', 'capacity-tuner.js', 'instant-playout.js', 'generator.js'];
const sb = { console: { log() {}, warn() {}, error() {} }, module: { exports: {} }, WeakMap, Map, Set, Date, Math, JSON, setTimeout, clearTimeout, Infinity };
vm.createContext(sb); for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BIN, f), 'utf8'), sb, { filename: f });
const A = sb.AntSolver, G = A.Generator;
function routeOf(planCells) { return planCells.map((p, i) => ({ r: p.r, c: p.c, color: p.color, count: p.count, step: i, chainIndex: 0 })); }
function slim(ev) { return ev && { pass: ev.pass, status: ev.status, reasons: ev.reasons, metrics: ev.metrics,
  release: ev.releaseDecision && { status: ev.releaseDecision.status, found: ev.releaseDecision.found, evidence: ev.releaseDecision.evidence } }; }
const out = { schema: 'instant-route-distribution-v1', date: '2026-10-26', rows: [] };
const specs = [{ id: '006', debt: 24 }, { id: '010', debt: 40 }, { id: '007', debt: 40 }];
for (const s of specs) {
  const blocks = G.blocksFromTXT(fs.readFileSync(path.join(ROOT, '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_' + s.id + '.txt'), 'utf8'));
  const band = G.deriveCapacityBand(blocks), cfg = { seed: 1001, candidateCount: 1, rounds: 0, timeBudgetMs: 12000, ruleMode: 'instantChain', generatorFlow: 'new_fixed',
    boxSizeMin: band.band[0], boxSizeMax: band.band[1], capNormMin: band.band[0], capNormMax: band.band[1], boardRowsMin: 6, boardRowsMax: 9, boardColsMin: 6, boardColsMax: 11,
    boardHardRange: true, boardAllowSquare: true, p7BaseCount: 0, p7Repair: false, trapPost: false, pool: 1,
    instantPlanPolicy: 'targetBuffer', instantPlanTargetBuffer: 4, instantPlanMaxDebt: s.debt };
  const t = Date.now(), r = G.produceFixed(blocks, cfg), planCells = r && r.level && r.level.board.instantPlanCells || [];
  const planRoute = routeOf(planCells), planEv = r && r.level ? A.ExperienceGoal.evaluate(r.level, { solveResult: { pickOrder: planRoute, completed: true }, decision: true, instantChain: true }) : null;
  const multi = r && r.level ? A.SolverAnalysis.findRoutes(r.level, { instantChain: true, timeBudgetMs: 2500, maxNodes: 8000, beamWidth: 24, branchWidth: 8, maxRoutes: 8 }) : null;
  const routes = [];
  if (r && r.level) routes.push({ source: 'plan', sig: planRoute.map(x => x.r + ',' + x.c).join(' '), ev: slim(planEv) });
  if (r && r.level && r.solveResult) {
    const ev = A.ExperienceGoal.evaluate(r.level, { solveResult: r.solveResult, decision: true, instantChain: true });
    routes.push({ source: 'solver-best', sig: (r.solveResult.pickOrder || []).map(x => x.r + ',' + x.c).join(' '), ev: slim(ev) });
  }
  for (const q of (multi && multi.routes || [])) {
    if (routes.some(x => x.sig === (q.signature || (q.actions || []).map(a => a.r + ',' + a.c).join(' ')))) continue;
    const ev = A.ExperienceGoal.evaluate(r.level, { solveResult: { pickOrder: q.actions || q.pickOrder || [], completed: true }, decision: true, instantChain: true });
    routes.push({ source: 'beam', sig: q.signature || '', ev: slim(ev) });
  }
  const row = { image: s.id, debt: s.debt, ms: Date.now() - t, level: !!(r && r.level), planMaxBuffer: r && r.config && r.config._instantPlayoutStat && r.config._instantPlayoutStat.maxBuffer,
    routeCount: routes.length, planPass: !!(planEv && planEv.pass), solverPass: !!(routes.find(x => x.source === 'solver-best') && routes.find(x => x.source === 'solver-best').ev.pass),
    minRouteMid: Math.min(...routes.map(x => x.ev && x.ev.metrics && x.ev.metrics.midBuffer34Pct != null ? x.ev.metrics.midBuffer34Pct : 0)),
    maxRouteMid: Math.max(...routes.map(x => x.ev && x.ev.metrics && x.ev.metrics.midBuffer34Pct || 0)), routes };
  out.rows.push(row); console.log(JSON.stringify({ image: s.id, routeCount: row.routeCount, planMid: planEv && planEv.metrics.midBuffer34Pct,
    solverMid: routes.find(x => x.source === 'solver-best') && routes.find(x => x.source === 'solver-best').ev.metrics.midBuffer34Pct,
    minRouteMid: row.minRouteMid, maxRouteMid: row.maxRouteMid, sources: routes.map(x => ({ source: x.source, pass: x.ev.pass, mid: x.ev.metrics && x.ev.metrics.midBuffer34Pct, max: x.ev.metrics && x.ev.metrics.maxBuffer, rel: x.ev.release && x.ev.release.status })) }));
}
fs.writeFileSync(path.join(__dirname, '瞬时路线分布_v530.json'), JSON.stringify(out, null, 2) + '\n');
