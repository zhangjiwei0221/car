#!/usr/bin/env node
/** v522：produceGoal精确失败seed的一轮实测重试与最终目标复核。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..'), BIN = path.join(ROOT, '02_工程', '游戏主bin', 'bin', 'js');
const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js', 'playersim.js', 'analysis.js', 'car-sequencer.js', 'solver-analysis.js', 'experience-goal.js', 'capacity-tuner.js', 'generator.js', 'source-preflight.js'];
const sb = { console: { log() {}, warn() {}, error() {} }, module: { exports: {} }, WeakMap, Map, Set, Date, Math, JSON, setTimeout, clearTimeout, Infinity };
vm.createContext(sb); for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BIN, f), 'utf8'), sb, { filename: f });
const A = sb.AntSolver, G = A.Generator, blocks = G.blocksFromTXT(fs.readFileSync(path.join(ROOT, '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_006.txt'), 'utf8'));
const cfg = { seed: 1978235744, goalMaxRounds: 1, goalMaxMs: 60000, goalPerRoundMs: 20000, goalSharedBudget: true, experienceGoal: true, reviewMix: false,
  generatorFlow: 'new_fixed', boxSizeMin: 31, boxSizeMax: 40, capNormMin: 31, capNormMax: 40, capScalePlan: [1.45, 1.15], cutMode: 'layerCut2', candidateCount: 14, fullTime: true,
  acceptMode: 'target', targetPeakMin: 3.2, targetPeakMax: 4.8, targetSteadyMin: 0, targetSteadyMax: 100, targetBand3Min: 0, targetBand4Min: 0, targetPlayerPassMin: .25,
  boardAllowSquare: true, boardRowsMin: 4, boardRowsMax: 6, boardColsMin: 6, boardColsMax: 8, boardHardRange: true, boardAuto: false,
  capacityTuneMs: 5000, capacityTuneCars: 8, capacityTuneVariants: 48, p7BaseCount: 1, maxPipes: 2, chainByDemand: 4,
  semanticObstacles: true, boardFirst: true, boardExpandOnOverflow: true, targetCarCount: 0, usableSpaceTarget: .86 };
const t = Date.now(), r = G.produceGoal(blocks, cfg), ev = r && r._experienceFull;
const repair = r && r.usableSpaceRepair ? JSON.parse(JSON.stringify(r.usableSpaceRepair)) : null;
const out = { schema: 'usable-space-goal-round-v1', date: '2026-10-26', ms: Date.now() - t, hasLevel: !!(r && r.level), valid: !!(r && r.valid), rounds: r && r.goalRounds,
  stop: r && r.goalStopReason, struct: !!(r && r.level && G.goalStructPass(r)), pass: !!(r && r.level && G.goalResultExperiencePass(r, cfg)), repair,
  experience: ev && { pass: ev.pass, metrics: ev.metrics, release: ev.releaseDecision && ev.releaseDecision.status },
  capacity: r && r.level && A.Quality.capacityEvidence(r.level, r.config || cfg), board: r && r.level && { rows: r.level.board.rows, cols: r.level.board.cols } };
fs.writeFileSync(path.join(__dirname, '可用率重试目标轮_v522.json'), JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out, null, 2));
if (!out.hasLevel || !out.repair || out.repair.applied !== true || out.rounds !== 1 || !out.pass) process.exitCode = 1;
