#!/usr/bin/env node
/** v522：精确失败基底的一次实测可用率重试与成功不触发保护。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
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
function hash(x) { return crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex'); }
function slim(r) { return { hasLevel: !!(r && r.level), valid: !!(r && r.valid), lastFailReason: r && r.lastFailReason || null,
  structural: r && r.structural || null, repair: r && r.usableSpaceRepair || null, board: r && r.level && r.level.board ? { rows: r.level.board.rows, cols: r.level.board.cols } : null,
  hash: r && r.level ? hash(r.level) : null, stopReason: r && r.perf && r.perf.stopReason || null }; }
const t0 = Date.now(), failed = G.produce(blocks, Object.assign({}, base, { _trace: [] })), beforeMs = Date.now() - t0;
const failureEvidence = failed.flowStats && { fail: failed.flowStats.fail, usableSamples: failed.flowStats.usableSpaceFailures && failed.flowStats.usableSpaceFailures.length,
  realValues: failed.flowStats.usableSpaceFailures && failed.flowStats.usableSpaceFailures.map(x => x.realUsable) };
const t1 = Date.now(), repaired = G.repairUsableNoCandidate(blocks, failed, base, { timeBudgetMs: 20000 }), repairWallMs = Date.now() - t1;
const success = G.produce(blocks, Object.assign({}, base, { cutMode: 'exposeCut', _trace: [] }));
const successBeforeHash = success && success.level ? hash(success.level) : null, successSame = G.repairUsableNoCandidate(blocks, success, base, { timeBudgetMs: 20000 });
const out = { schema: 'usable-space-repair-test-v1', date: '2026-10-26', beforeMs, repairWallMs, failureEvidence,
  before: slim(failed), after: slim(repaired), successControl: { before: slim(success), sameObject: successSame === success,
    repair: successSame && successSame.usableSpaceRepair || null, hashUnchanged: successSame && successSame.level && hash(successSame.level) === successBeforeHash } };
fs.writeFileSync(path.join(__dirname, '可用率失败重试_v522.json'), JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify({ beforeMs, repairWallMs, before: out.before, after: out.after, successControl: out.successControl }, null, 2));
if (out.before.hasLevel || !out.after.hasLevel || !out.after.repair || !out.after.repair.applied || !out.after.repair.capacityUnchanged || !out.successControl.sameObject) process.exitCode = 1;
