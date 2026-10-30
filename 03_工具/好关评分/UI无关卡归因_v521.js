#!/usr/bin/env node
/** v521：UI精确noCandidate基底的三个单变量诊断臂。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..'), BIN = path.join(ROOT, '02_工程', '游戏主bin', 'bin', 'js');
const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js', 'playersim.js', 'analysis.js', 'car-sequencer.js', 'solver-analysis.js', 'experience-goal.js', 'capacity-tuner.js', 'generator.js', 'source-preflight.js'];
const sb = { console: { log() {}, warn() {}, error() {} }, module: { exports: {} }, WeakMap, Map, Set, Date, Math, JSON, setTimeout, clearTimeout, Infinity };
vm.createContext(sb); for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BIN, f), 'utf8'), sb, { filename: f });
const A = sb.AntSolver, G = A.Generator, blocks = G.blocksFromTXT(fs.readFileSync(path.join(ROOT, '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_006.txt'), 'utf8'));
const base = { seed: 1978235744, goalSharedBudget: true, experienceGoal: true, reviewMix: false, generatorFlow: 'new_fixed',
  boxSizeMin: 31, boxSizeMax: 40, capNormMin: 31, capNormMax: 40, capScalePlan: [1.45, 1.15], cutMode: 'layerCut2', candidateCount: 14, fullTime: true, portfolioK: 1,
  acceptMode: 'target', targetPeakMin: 3.2, targetPeakMax: 4.8, targetSteadyMin: 0, targetSteadyMax: 100, targetBand3Min: 0, targetBand4Min: 0, targetPlayerPassMin: .25,
  boardAllowSquare: true, boardRowsMin: 4, boardRowsMax: 6, boardColsMin: 6, boardColsMax: 8, boardHardRange: true, boardAuto: false,
  capacityTuneMs: 5000, capacityTuneCars: 8, capacityTuneVariants: 48, timeBudgetMs: 20000, p7BaseCount: 1, maxPipes: 2, chainByDemand: 4,
  semanticObstacles: true, boardFirst: true, boardExpandOnOverflow: true, targetCarCount: 0, usableSpaceTarget: .86, _trace: [] };
const arms = { baseline: {}, targetOnly: { usableSpaceTarget: 0.823252688172043 },
  boardOnly: { boardRowsMin: 6, boardRowsMax: 9, boardColsMin: 6, boardColsMax: 11 }, cutOnly: { cutMode: 'exposeCut' } };
const rows = [];
for (const [arm, over] of Object.entries(arms)) {
  const cfg = Object.assign({}, base, over, { _trace: [] }), t = Date.now(); let r;
  try { r = G.produce(blocks, cfg); } catch (e) { r = { level: null, valid: false, error: String(e && e.message || e) }; }
  const row = { arm, override: over, ms: Date.now() - t, hasLevel: !!(r && r.level), valid: !!(r && r.valid), lastFailReason: r && r.lastFailReason || null,
    structural: r && r.structural || null, board: r && r.level && r.level.board ? { rows: r.level.board.rows, cols: r.level.board.cols } : null,
    boardStat: r && r.boardStat || null, stopReason: r && r.perf && r.perf.stopReason || null,
    baseCandidates: r && r.perf && r.perf.baseCandidates, boardBuilds: r && r.perf && r.perf.boardBuilds, error: r && r.error || null };
  rows.push(row); console.log(JSON.stringify({ arm, ms: row.ms, hasLevel: row.hasLevel, reason: row.lastFailReason, structural: row.structural && row.structural.reason, board: row.board, stop: row.stopReason }));
}
const out = { schema: 'ui-no-candidate-single-factor-v1', date: '2026-10-26', seed: base.seed, rows };
fs.writeFileSync(path.join(__dirname, 'UI无关卡归因_v521.json'), JSON.stringify(out, null, 2) + '\n');
