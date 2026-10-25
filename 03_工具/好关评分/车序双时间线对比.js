#!/usr/bin/env node
/**
 * v494 真生成对照（默认不改生产）：006 / cap20~40 / 6×7下限 / seed1001~1003。
 * node 03_工具/好关评分/车序双时间线对比.js --mode timeline --flow old --out 报告.jsonl
 * --mode base 不生成变体；--mode timeline 只在旧产线结构失败项运行 timelineCompare。
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '完整主bin快照_20261012', 'bin', 'js');
const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js', 'playersim.js', 'analysis.js', 'solver-analysis.js', 'car-sequencer.js', 'generator.js'];
const sandbox = { console: { log() {}, warn() {}, error() {} }, module: { exports: {} }, WeakMap, Map, Set, Date, Math, JSON, setTimeout, clearTimeout, Infinity };
vm.createContext(sandbox); for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BIN, f), 'utf8'), sandbox, { filename: f });
const A = sandbox.AntSolver;
function arg(name, fallback) { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : fallback; }
const mode = arg('mode', 'timeline'), flow = arg('flow', 'old'), out = arg('out', '');
const seeds = arg('seeds', '1001,1002,1003').split(',').map(Number);
const txtFile = arg('txt', path.join(ROOT, '蚂蚁图库', '拼接图', '拼接图图库', '35x35拼接图纸_006.txt'));
const blocks = A.Generator.blocksFromTXT(fs.readFileSync(txtFile, 'utf8'));
const rows = [];
for (const seed of seeds) {
  const cfg = { seed, generatorFlow: flow, cutMode: 'auto', boxSizeMin: 20, boxSizeMax: 40,
    capNormMin: 20, capNormMax: 40, boardRowsMin: 6, boardRowsMax: 6,
    boardColsMin: 7, boardColsMax: 7, candidateCount: 3, timeBudgetMs: 20000,
    fullTime: true, difficultyRounds: 1, roleSchedule: mode === 'timeline' ? 'timelineCompare' : false,
    timelineIterations: 2 };
  const t = Date.now(), r = A.Generator.produce(blocks, cfg), fc = r.goodV3 && r.goodV3.fillCurve || {};
  const row = { schema: 'timeline-generation-record-v1', seed, mode, flow, ms: Date.now() - t,
    hash: r.level && crypto.createHash('sha256').update(JSON.stringify(r.level)).digest('hex'),
    valid: !!r.valid, gate: A.Generator.goalStructPass(r), freeLow: fc.freeLowPct != null ? fc.freeLowPct : null,
    freeRun: fc.freeRunMax != null ? fc.freeRunMax : null, capacity: r.capacityAudit || null,
    chosen: r.timelineCompare ? r.timelineCompare.chosen : 'base', skipped: r.timelineCompare ? r.timelineCompare.skipped : null,
    attempts: r.timelineCompare ? r.timelineCompare.attempts : [], debt: r.debtTimeline ? r.debtTimeline.summary : null,
    timeline: r.carTimeline ? r.carTimeline.summary : null };
  rows.push(row); console.log(JSON.stringify({ seed, ms: row.ms, valid: row.valid, gate: row.gate,
    board: row.capacity && [row.capacity.rows, row.capacity.cols], chosen: row.chosen, skipped: row.skipped,
    attempts: row.attempts.length, hash: row.hash && row.hash.slice(0, 12) }));
}
if (out) fs.writeFileSync(out, rows.map(x => JSON.stringify(x)).join('\n') + '\n');
