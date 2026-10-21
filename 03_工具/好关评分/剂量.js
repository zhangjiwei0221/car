#!/usr/bin/env node
/**
 * 剂量曲线：同一条随机流下，冰比例 → 峰窗/稳健/被埋
 *
 *   node 剂量.js --image <图.txt> [--scheme <方案.json>] [--seeds 116,133] [--ice 0,4,8,12,16,20]
 *
 * 依赖 v193 的 config.seed（生成器自带随机源），所以每个 (seed, ice) 都是同一条流的同一起点，
 * 冰比例是唯一变量 —— 这才是真正的"剂量反应"。
 */
'use strict';
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const BIN = path.join(HERE, '..', '..', '02_工程', '完整主bin快照_20261012', 'bin', 'js');
const DEFAULT_SCHEME = path.join(HERE, '..', '..', '02_工程', '完整主bin快照_20261012', '方案文件夹', '方案_小图33-40四方向_v1.json');
const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js',
               'playersim.js', 'analysis.js', 'generator.js'];

const argv = process.argv.slice(2);
let imagePath = null, schemePath = DEFAULT_SCHEME;
let seeds = [116, 133], ices = [0, 4, 8, 12, 16, 20];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--image') imagePath = path.resolve(argv[++i]);
  else if (argv[i] === '--scheme') schemePath = path.resolve(argv[++i]);
  else if (argv[i] === '--seeds') seeds = String(argv[++i]).split(',').map(Number).filter(Boolean);
  else if (argv[i] === '--ice') ices = String(argv[++i]).split(',').map(Number).filter(x => x >= 0);
  else if (!argv[i].startsWith('--') && !imagePath) imagePath = path.resolve(argv[i]);
}
if (!imagePath) { console.error('用法: node 剂量.js --image <图.txt> [--seeds 116,133] [--ice 0,4,8,12,16,20]'); process.exit(1); }

let _rng = 1;
const seededMath = Object.create(Math);
seededMath.random = function () { _rng = (_rng * 1664525 + 1013904223) >>> 0; return _rng / 4294967296; };
const sandbox = {
  console: { log() {}, warn() {}, error() {} }, module: { exports: {} },
  WeakMap, Map, Set, setTimeout, clearTimeout, Infinity, Math: seededMath, JSON
};
vm.createContext(sandbox);
for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BIN, f), 'utf8'), sandbox, { filename: f });
const A = sandbox.AntSolver, G = A.Generator;

const base = JSON.parse(fs.readFileSync(schemePath, 'utf8')).config || {};
const blocks = G.blocksFromTXT(fs.readFileSync(imagePath, 'utf8'));
const R = blocks.length, C = blocks[0].length;

function run(seed, ice) {
  const cfg = Object.assign({}, base, {
    candidateCount: 4, difficultyRounds: 2, timeBudgetMs: 60000, requireHardPass: false,
    seed: seed,                       // 【v193】生成器自带 seed → 同一条流
    icePercent: ice, icePercentMin: ice, icePercentMax: ice
  });
  try { return G.produce(blocks, Object.assign(cfg, { mapSize: R })); } catch (e) { return null; }
}

console.log('图: ' + path.basename(imagePath) + '  ' + R + '×' + C + '  |  ' + path.basename(schemePath));
console.log('每条曲线 = 同一 seed、只改冰比例\n');
console.log('seed   ice  峰窗p50  稳健   被埋  六条');
for (const seed of seeds) {
  for (const ice of ices) {
    const res = run(seed, ice);
    if (!res || !res.level) { console.log(String(seed).padEnd(6) + String(ice).padStart(3) + '    ✗ 未出关'); continue; }
    const g = res.goodV3 || {};
    console.log(String(seed).padEnd(6) + String(ice).padStart(3) + '   ' +
      String(g.midLateMax).padStart(5) + '   ' + String(g.steadyWonPct).padStart(4) + '%  ' +
      String(g.buried).padStart(3) + '   ' + (g.pass ? '✅' : '✗ ' + (g.fails || []).join('、')));
  }
  console.log('');
}
