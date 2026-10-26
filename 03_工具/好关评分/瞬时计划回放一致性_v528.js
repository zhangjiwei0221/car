#!/usr/bin/env node
/** v528：比较instantPlayout计划车序与最终棋盘/求解车序，定位摆盘是否改序。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..'), BIN = path.join(ROOT, '02_工程', '完整主bin快照_20261012', 'bin', 'js');
const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js', 'playersim.js', 'analysis.js', 'car-sequencer.js', 'solver-analysis.js', 'experience-goal.js', 'capacity-tuner.js', 'instant-playout.js', 'generator.js'];
const sb = { console: { log() {}, warn() {}, error() {} }, module: { exports: {} }, WeakMap, Map, Set, Date, Math, JSON, setTimeout, clearTimeout, Infinity };
vm.createContext(sb); for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BIN, f), 'utf8'), sb, { filename: f });
const A = sb.AntSolver, G = A.Generator;
function lcs(a, b) {
  let prev = new Array(b.length + 1).fill(0), cur = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    [prev, cur] = [cur, prev]; cur.fill(0);
  }
  return prev[b.length];
}
function routeCars(sr) {
  return (sr && sr.pickOrder || []).filter(p => !p.chainIndex).map(p => ({ color: p.color, count: p.count, r: p.r, c: p.c, step: p.step }));
}
function replayPlanCells(level, cells) {
  const lv = A.parseLevel(level), S = A.Simulator, st = S.createState(lv, { useSlotStart: true, instantChain: true }), trace = [];
  for (let i = 0; i < cells.length; i++) {
    const p = cells[i], m = S.listMoves(st).filter(x => !x.blocked).find(x => x.r === p.r && x.c === p.c);
    if (!m) return { completed: false, failedAt: i + 1, reason: 'not_pickable', trace };
    S.applyPick(st, p.r, p.c);
    trace.push({ r: p.r, c: p.c, color: p.color, count: p.count, buffer: st.buffer.length, overflow: !!st.overflow });
    if (st.overflow || st.gameOver && !st.gameWon) return { completed: false, failedAt: i + 1, reason: st.overflow ? 'overflow' : 'gameover', trace };
  }
  const completed = !st.overflow && st.eliminatedPixels >= st.totalPixels;
  return { completed, wonFlag: !!st.gameWon, steps: trace.length, maxBuffer: Math.max(0, ...trace.map(x => x.buffer)), trace };
}
const out = { schema: 'instant-plan-board-fidelity-v1', date: '2026-10-26', images: {} };
for (const id of ['006', '010', '007']) {
  const blocks = G.blocksFromTXT(fs.readFileSync(path.join(ROOT, '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_' + id + '.txt'), 'utf8'));
  const band = G.deriveCapacityBand(blocks);
  const cfg = { seed: 1001, candidateCount: 1, rounds: 0, timeBudgetMs: 12000, ruleMode: 'instantChain', generatorFlow: 'new_fixed',
    boxSizeMin: band.band[0], boxSizeMax: band.band[1], capNormMin: band.band[0], capNormMax: band.band[1],
    boardRowsMin: 6, boardRowsMax: 9, boardColsMin: 6, boardColsMax: 11, boardHardRange: true, boardAllowSquare: true, p7BaseCount: 1, pool: 1 };
  const t = Date.now(), r = G.produceFixed(blocks, cfg), plan = r && r.config && r.config._instantPlayoutStat;
  const planned = plan && plan.carSequence || [], routed = routeCars(r && r.solveResult);
  const pt = planned.map(x => x.color + ':' + x.cap), rt = routed.map(x => x.color + ':' + x.count);
  const planCells = r && r.level && r.level.board && r.level.board.instantPlanCells || [];
  const planCellSeq = planCells.map(x => x.color + ':' + x.count);
  const referenceReplay = r && r.level ? replayPlanCells(r.level, planCells) : { completed: false, reason: 'no_level' };
  const pc = planned.map(x => x.color), rc = routed.map(x => x.color);
  let exactPos = 0; for (let i = 0; i < Math.min(pt.length, rt.length); i++) if (pt[i] === rt[i]) exactPos++;
  out.images[id] = { ms: Date.now() - t, level: !!(r && r.level), valid: !!(r && r.valid), planCars: planned.length, routeCars: routed.length,
    planCells: planCells.length, planCellMatches: JSON.stringify(pt) === JSON.stringify(planCellSeq), referenceReplay: { completed: referenceReplay.completed,
      failedAt: referenceReplay.failedAt || null, reason: referenceReplay.reason || null, steps: referenceReplay.steps || 0, maxBuffer: referenceReplay.maxBuffer == null ? null : referenceReplay.maxBuffer },
    exactPositionPct: pt.length ? +(exactPos / pt.length * 100).toFixed(1) : null,
    exactLcs: lcs(pt, rt), colorLcs: lcs(pc, rc), plan: pt.slice(0, 18), route: rt.slice(0, 18),
    routeFirst: routed.slice(0, 12), planFirst: planned.slice(0, 12), board: r && r.level && r.level.board ? { rows: r.level.board.rows, cols: r.level.board.cols } : null };
  console.log(id, JSON.stringify({ planCars: out.images[id].planCars, routeCars: out.images[id].routeCars, planCells: out.images[id].planCells,
    planCellMatches: out.images[id].planCellMatches, referenceReplay: out.images[id].referenceReplay, exactPositionPct: out.images[id].exactPositionPct,
    exactLcs: out.images[id].exactLcs, colorLcs: out.images[id].colorLcs, plan: out.images[id].plan, route: out.images[id].route }));
}
out.pass = Object.values(out.images).every(x => x.planCellMatches && x.referenceReplay.completed);
out.note = '求解器最佳路线可与计划参考路线不同；本验收要求计划车单一一落格且参考路线真实可回放通关，不要求全知必须选同一条。';
if (!out.pass) process.exitCode = 1;
fs.writeFileSync(path.join(__dirname, '瞬时计划回放一致性_v528.json'), JSON.stringify(out, null, 2) + '\n');
