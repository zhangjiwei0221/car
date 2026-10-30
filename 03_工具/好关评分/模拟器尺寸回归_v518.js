#!/usr/bin/env node
/** v518：缺rows/cols的内部关卡必须从blocks恢复；正常尺寸与交替尺寸口径不变。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const ROOT = path.join(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '游戏主bin', 'bin', 'js');
const sb = { console, module: { exports: {} }, WeakMap, Map, Set, Date, Math, JSON, setTimeout, clearTimeout, Infinity };
vm.createContext(sb);
for (const f of ['utils.js', 'simulator.js']) vm.runInContext(fs.readFileSync(path.join(BIN, f), 'utf8'), sb, { filename: f });
const A = sb.AntSolver, S = A.Simulator;
const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '独立回归关卡_v516', 'recommend_32677.json'), 'utf8'));
const parsed = A.parseLevel(raw);
const inferred = S.createState(raw, { useSlotStart: true });
assert.strictEqual(inferred.rows, 35);
assert.strictEqual(inferred.cols, 35);
assert.strictEqual(inferred.eliminated.length, 35);
assert.strictEqual(inferred.eliminated[0].length, 35);
const explicitRing = Array.from(S.ringMaskOf(parsed ? A.create2D(35, 35, false) : null, raw.blocks, 35, 35, false));
const inferredRing = Array.from(S.ringMaskOf(A.create2D(35, 35, false), raw.blocks, undefined, undefined, false));
assert.deepStrictEqual(inferredRing, explicitRing);
const trace = [];
const removed = S.floodFillEliminate(inferred.eliminated, inferred.blocks, undefined, undefined, 5, 1, trace, null, false);
assert.strictEqual(removed, 1);
assert.strictEqual(trace.length, 1);
// 先大后小再大，确认共享ring缓存不串尺寸；空/非法尺寸必须直接返回而非进入BFS。
const small = [[1, 1, 1], [1, 1, 1]];
const smallRing = Array.from(S.ringMaskOf(A.create2D(2, 3, false), small, 2, 3, false)).slice(0, 6);
assert.strictEqual(smallRing.length, 6);
assert.deepStrictEqual(Array.from(S.ringMaskOf(A.create2D(35, 35, false), raw.blocks, 35, 35, false)), explicitRing);
assert.deepStrictEqual(Array.from(S.ringMaskOf([], [], 0, 0, false)), []);
assert.deepStrictEqual(Array.from(S.ringMaskOf([], [], undefined, undefined, false)), []);
const out = { schema: 'simulator-dimension-regression-v1', date: '2026-10-26', pass: true,
  inferred: { rows: inferred.rows, cols: inferred.cols, removed, trace: trace[0] },
  ring: { explicitEqualsInferred: true, largeLength: explicitRing.length, smallLength: smallRing.length, alternatingCachePass: true },
  note: 'v517原始缺尺寸路径会进入无效BFS；本回归只在修复版执行，避免旧版无限循环卡住测试进程。' };
const outPath = path.join(__dirname, '模拟器尺寸回归_v518.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out, null, 2));
