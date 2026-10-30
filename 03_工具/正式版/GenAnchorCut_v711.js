#!/usr/bin/env node
'use strict';

/**
 * 用生成器的“锚点切盒”重切一张目标图（切盒层实验）
 *
 * 背景：棋盘层三条手段（容量微调/冰/黑块/链）都无法同时满足
 * “无免费走廊 + 压力窗口”，根因在前沿曝露顺序 = 切盒层。
 *
 * 用法：
 *   node 03_工具/正式版/GenAnchorCut_v711.js --target 实验关/关卡8/35x35拼接图纸_008.txt \
 *        --out 实验关/关卡8/锚点切_v1 --seed 1001
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '完整主bin快照_20261012', 'bin', 'js');
const MODULES = ['utils.js', 'color-libs.js', 'anchor-cut.js', 'simulator.js',
  'solver-strategy.js', 'solver.js', 'playersim.js', 'analysis.js', 'generator.js'];

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const target = arg('--target', '实验关/关卡8/35x35拼接图纸_008.txt');
const outDir = arg('--out', '实验关/关卡8/锚点切_v1');
const seed = Number(arg('--seed', 1001));
const cutMode = arg('--cut', 'anchor');
const boxMin = Number(arg('--box-min', 20));
const boxMax = Number(arg('--box-max', 40));
const rows = Number(arg('--rows', 7));
const cols = Number(arg('--cols', 7));

const sandbox = { console, WeakMap, Map, Set, Date, Math, JSON, Object, Array, String, Number,
  isNaN, parseInt, parseFloat, isFinite, setTimeout, clearTimeout };
sandbox.global = sandbox;
vm.createContext(sandbox);
for (const f of MODULES) {
  const full = path.join(BIN, f);
  if (!fs.existsSync(full)) throw new Error('缺模块: ' + full);
  vm.runInContext(fs.readFileSync(full, 'utf8'), sandbox, { filename: f });
}
const A = sandbox.AntSolver;
const G = A.Generator;

const text = fs.readFileSync(path.join(ROOT, target), 'utf8');
const blocks = G.blocksFromTXT(text);
if (!blocks || !blocks.length) throw new Error('读不到目标图: ' + target);

const config = {
  boxSizeMin: boxMin, boxSizeMax: boxMax,
  boxSizeMode: 'random',
  boxCutMode: cutMode,
  anchorMode: 'double',
  anchorRoleAwareCut: true,
  boardRowsMin: rows, boardRowsMax: rows,
  boardColsMin: cols, boardColsMax: cols,
  bufferLimit: 5,
  seed: seed,
  _seedOnce: true,
  maxRetries: 3
};

const t0 = Date.now();
const res = G.generateFromBlocks(blocks, config);
const ms = Date.now() - t0;
if (!res || !res.level) { console.error('生成失败'); process.exit(2); }

fs.mkdirSync(path.join(ROOT, outDir), { recursive: true });
const outLevel = path.join(ROOT, outDir, '关卡_锚点切_' + seed + '.json');
const gameFormat = A.toGameFormat(res.level);
fs.writeFileSync(outLevel, JSON.stringify(gameFormat, null, 2));
const sr = res.solveResult || {};
console.log('cut=' + cutMode, 'seed=' + seed, 'ms=' + ms);
console.log('valid=' + res.valid, 'steps=' + (sr.steps || 0), 'maxBuffer=' + (sr.maxBuffer || 0),
  'progress=' + (sr.progress || 0), 'completed=' + !!sr.completed);
console.log('written=' + outLevel);
