#!/usr/bin/env node
/** v534：把高压状态发现的可执行释放动作拼回完整路线，验证整条路线是否真正有显著释放。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..'), BIN = path.join(ROOT, '02_工程', '完整主bin快照_20261012', 'bin', 'js');
const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js', 'playersim.js', 'analysis.js', 'car-sequencer.js', 'solver-analysis.js', 'experience-goal.js', 'capacity-tuner.js', 'instant-playout.js', 'generator.js'];
const sb = { console: { log() {}, warn() {}, error() {} }, module: { exports: {} }, WeakMap, Map, Set, Date, Math, JSON, setTimeout, clearTimeout, Infinity };
vm.createContext(sb); for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BIN, f), 'utf8'), sb, { filename: f });
const A = sb.AntSolver, G = A.Generator, S = A.Simulator, SA = A.SolverAnalysis, EG = A.ExperienceGoal;
function makeLevel() {
  const blocks = G.blocksFromTXT(fs.readFileSync(path.join(ROOT, '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_007.txt'), 'utf8'));
  const band = G.deriveCapacityBand(blocks), cfg = { seed: 1001, candidateCount: 1, rounds: 0, timeBudgetMs: 12000, ruleMode: 'instantChain', generatorFlow: 'new_fixed',
    boxSizeMin: band.band[0], boxSizeMax: band.band[1], capNormMin: band.band[0], capNormMax: band.band[1],
    boardRowsMin: 7, boardRowsMax: 7, boardColsMin: 8, boardColsMax: 8, boardHardRange: true, boardAuto: false, boardAllowSquare: true, boardFitGuard: 'warn',
    p7BaseCount: 0, p7Repair: false, trapPost: false, pool: 1, instantPlanPolicy: 'targetBuffer', instantPlanTargetBuffer: 4,
    instantPlanMaxDebt: 40, instantPlanBranchCount: 2, instantPlanBranchDebtRoots: true, instantPlanBranchPrefixDebts: 8 };
  return G.produceFixed(blocks, cfg);
}
function replayFull(level, actions) {
  const lv = A.parseLevel(level), start = S.createState(lv, { useSlotStart: true, instantChain: true });
  return SA.replayFromState(start, actions);
}
const r = makeLevel(), lv = A.parseLevel(r.level), route = r.solveResult, actions = SA.normalizeActions(route);
const start = S.createState(lv, { useSlotStart: true, instantChain: true });
const candidates = [];
for (let i = 0; i < actions.length; i++) {
  if (start.gameWon || start.gameOver) break;
  const ref = actions[i];
  const progress = start.totalPixels ? start.eliminatedPixels / start.totalPixels : 0;
  if (start.buffer.length >= 3 && progress >= 0.2 && progress <= 0.85) {
    const moves = S.listMoves(start).filter(m => !m.blocked);
    moves.sort((a, b) => (a.r === ref.r && a.c === ref.c ? 0 : 1) - (b.r === ref.r && b.c === ref.c ? 0 : 1));
    for (const m of moves.slice(0, 8)) {
      const after = A.SolverStrategy.cloneState(start);
      S.applyPick(after, m.r, m.c);
      if (after.eliminatedPixels >= after.totalPixels) { after.gameWon = true; after.gameOver = true; }
      const searched = SA.searchFromState(after, { timeBudgetMs: 900, maxNodes: 3000, beamWidth: 16, branchWidth: 8, maxRoutes: 1 });
      if (!searched.routes.length) continue;
      const full = actions.slice(0, i).concat([{ r: m.r, c: m.c, color: m.antBox && m.antBox.color, count: m.antBox && m.antBox.count }]).concat(searched.routes[0].actions);
      const replayed = replayFull(r.level, full);
      if (!replayed.completed) continue;
      const curve = EG.curveFromTrace(replayed.trace, replayed.totalPixels, replayed.state ? replayed.state.bufferLimit : 5, { instantChain: true });
      const candidate = { step: i + 1, progress: +progress.toFixed(3), action: { r: m.r, c: m.c, color: m.antBox && m.antBox.color },
        fullSteps: full.length, midBuffer34Pct: curve.midBuffer34Pct, maxBuffer: curve.pressure.maxBuffer,
        significantReleaseCount: curve.pressure.significantReleaseCount, finalReplayValid: true,
        fullSig: full.map(x => x.r + ',' + x.c).join(' ') };
      candidates.push(candidate);
    }
  }
  S.applyPick(start, ref.r, ref.c);
  if (start.eliminatedPixels >= start.totalPixels) { start.gameWon = true; start.gameOver = true; }
}
candidates.sort((a, b) => (b.significantReleaseCount - a.significantReleaseCount) || (b.midBuffer34Pct - a.midBuffer34Pct));
const out = { schema: 'release-route-construction-v1', date: '2026-10-26', base: { mid: r.solveResult && r.solveResult.pressureSamples ? null : null,
  actions: actions.length, board: r.level.board, level: r.level }, candidates, summary: { tested: candidates.length,
  withRelease: candidates.filter(x => x.significantReleaseCount >= 1).length,
  withMid50: candidates.filter(x => x.midBuffer34Pct >= 50).length,
  both: candidates.filter(x => x.significantReleaseCount >= 1 && x.midBuffer34Pct >= 50).length,
  best: candidates[0] || null } };
fs.writeFileSync(path.join(__dirname, '释放路线构造_v534.json'), JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify({ summary: out.summary, candidates: candidates.slice(0, 8) }, null, 2));
