#!/usr/bin/env node
/** v526：instantPlayout进入瞬时模式切车；验证计划自洽、端到端出关、默认四边不变。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..', '..'), BIN = path.join(ROOT, '02_工程', '游戏主bin', 'bin', 'js');
const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js', 'playersim.js', 'analysis.js', 'car-sequencer.js', 'solver-analysis.js', 'experience-goal.js', 'capacity-tuner.js', 'instant-playout.js', 'generator.js'];
const sb = { console: { log() {}, warn() {}, error() {} }, module: { exports: {} }, WeakMap, Map, Set, Date, Math, JSON, setTimeout, clearTimeout, Infinity };
vm.createContext(sb); for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BIN, f), 'utf8'), sb, { filename: f });
const A = sb.AntSolver, G = A.Generator;
function hash(x) { return crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex'); }
function loadBlocks(id) { return G.blocksFromTXT(fs.readFileSync(path.join(ROOT, '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_' + id + '.txt'), 'utf8')); }
function baseCfg(blocks, ruleMode) {
  const band = G.deriveCapacityBand(blocks);
  return { seed: 1001, candidateCount: 1, rounds: 0, timeBudgetMs: 12000, ruleMode, generatorFlow: 'new_fixed',
    boxSizeMin: band.band[0], boxSizeMax: band.band[1], capNormMin: band.band[0], capNormMax: band.band[1],
    boardRowsMin: 6, boardRowsMax: 9, boardColsMin: 6, boardColsMax: 11, boardHardRange: true, boardAllowSquare: true, p7BaseCount: 1, pool: 1 };
}
const out = { schema: 'instant-playout-production-v526', date: '2026-10-26', plans: {}, instantEndToEnd: {}, fourSideProtection: null };
for (const id of ['006', '010', '007']) {
  const blocks = loadBlocks(id), cfg = baseCfg(blocks, 'instantChain');
  const tp = Date.now(), p = A.InstantPlayout.plan({ blocks, bufferLimit: 5 }, cfg), stat = p.boxes && p.boxes._instantPlayout;
  out.plans[id] = { ms: Date.now() - tp, ok: p.ok, reason: p.reason, cars: p.cars.length, audit: p.audit,
    minCap: Math.min(...p.cars.map(x => x.cap)), maxCap: Math.max(...p.cars.map(x => x.cap)),
    bufferEvents: stat && stat.bufferEvents, hash: hash(p.boxes) };
  const t = Date.now(), r = G.produceFixed(blocks, cfg);
  out.instantEndToEnd[id] = { ms: Date.now() - t, level: !!(r && r.level), valid: !!(r && r.valid), structural: r && r.structural,
    config: r && r.config && { ruleMode: r.config.ruleMode, instantChain: r.config.instantChain, elimOrder: r.config.elimOrder },
    instant: r && r.config && r.config._instantPlayoutStat || null,
    capacity: r && r.level ? A.Quality.capacityEvidence(r.level, r.config || cfg) : null,
    board: r && r.level && r.level.board ? { rows: r.level.board.rows, cols: r.level.board.cols } : null,
    hash: r && r.level ? hash(r.level) : null, stop: r && r.perf && r.perf.stopReason };
}
const pblocks = loadBlocks('006'), pcfg = baseCfg(pblocks, 'fourSide'), pr = G.produceFixed(pblocks, pcfg);
out.fourSideProtection = { level: !!(pr && pr.level), valid: !!(pr && pr.valid), hash: pr && pr.level ? hash(pr.level) : null,
  expectedHash: '48680c72a30cbec03784b516c876c25e2ac24588e805b5191dd818f47a87202d',
  config: pr && pr.config && { ruleMode: pr.config.ruleMode, instantChain: pr.config.instantChain, elimOrder: pr.config.elimOrder } };
out.pass = Object.values(out.plans).every(x => x.ok) && Object.values(out.instantEndToEnd).every(x => x.level && x.valid && x.structural && x.config && x.config.elimOrder === 'instant' && x.capacity && x.capacity.aboveMax === 0) && out.fourSideProtection.hash === out.fourSideProtection.expectedHash;
fs.writeFileSync(path.join(__dirname, 'instantPlayout生产接入_v526.json'), JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify({ pass: out.pass, plans: out.plans, instantEndToEnd: out.instantEndToEnd, fourSideProtection: out.fourSideProtection }, null, 2));
if (!out.pass) process.exitCode = 1;
