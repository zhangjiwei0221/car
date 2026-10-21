#!/usr/bin/env node
/**
 * 一图多产：同一张图跑 K 个不同 seed，按"最终指标"（goodV3）留最好的一关
 *
 *   node 一图多产.js --image <图.txt> [--scheme <方案.json>] [--k 5] [--base 101]
 *
 * 为什么：候选期的代理指标控制不了最终峰窗（41/53 节），single build 的全过率又只有 7.5%~30%；
 *   那就"多产几关、末尾择优"——通过的关一定来自最终指标，不依赖任何代理。
 *
 * 只读：不写 输出文件/。
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
let imagePath = null, schemePath = DEFAULT_SCHEME, K = 5, base = 101;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--image') imagePath = path.resolve(argv[++i]);
  else if (argv[i] === '--scheme') schemePath = path.resolve(argv[++i]);
  else if (argv[i] === '--k') K = Math.max(1, parseInt(argv[++i], 10) || 5);
  else if (argv[i] === '--base') base = parseInt(argv[++i], 10) || 101;
  else if (!argv[i].startsWith('--') && !imagePath) imagePath = path.resolve(argv[i]);
}
if (!imagePath) { console.error('用法: node 一图多产.js --image <图.txt> [--k 5] [--base 101]'); process.exit(1); }

const sandbox = {
  console: { log() {}, warn() {}, error() {} }, module: { exports: {} },
  WeakMap, Map, Set, setTimeout, clearTimeout, Infinity, Math, JSON
};
vm.createContext(sandbox);
for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BIN, f), 'utf8'), sandbox, { filename: f });
const A = sandbox.AntSolver, G = A.Generator;

const baseCfg = JSON.parse(fs.readFileSync(schemePath, 'utf8')).config || {};
const blocks = G.blocksFromTXT(fs.readFileSync(imagePath, 'utf8'));
const R = blocks.length, C = blocks[0].length;

function dist(p) { return p == null ? 1e9 : (p < 3.2 ? 3.2 - p : (p > 4.8 ? p - 4.8 : 0)); }
function scoreOf(g) {
  var f = (g && g.fails) ? g.fails.length : 99;
  var d = dist(g && g.midLateMax);
  var s = (g && g.steadyWonPct) || 0;
  return { f: f, d: d, s: s };
}
function better(x, y) {          // x 是否优于 y
  if (!y) return true;
  if (x.f !== y.f) return x.f < y.f;
  if (Math.abs(x.d - y.d) > 0.05) return x.d < y.d;
  return x.s > y.s;
}

console.log('图: ' + path.basename(imagePath) + '  ' + R + '×' + C + '  |  ' + path.basename(schemePath));
console.log('K = ' + K + '，seed = ' + base + '…' + (base + K - 1) + '\n');
console.log('seed  出关  六条                     峰窗  稳健   被埋  用时');

let best = null, bestSeed = null, anyPass = 0, produced = 0;
const t0 = Date.now();
for (let i = 0; i < K; i++) {
  const seed = base + i;
  const cfg = Object.assign({}, baseCfg, {
    candidateCount: 4, difficultyRounds: 2, timeBudgetMs: 60000,
    requireHardPass: false, seed: seed
  });
  const t = Date.now();
  let res = null;
  try { res = G.produce(blocks, Object.assign(cfg, { mapSize: R })); } catch (e) { res = null; }
  const ms = Date.now() - t;
  if (!res || !res.level) { console.log(String(seed).padEnd(6) + ' ✗ 未出关' + '  (' + (ms / 1000).toFixed(1) + 's)'); continue; }
  produced++;
  const g = res.goodV3 || {};
  if (g.pass) anyPass++;
  const sc = scoreOf(g);
  if (better(sc, best ? best.sc : null)) { best = { res: res, sc: sc }; bestSeed = seed; }
  console.log(String(seed).padEnd(6) + ' ✓     ' + (g.pass ? '✅ 6/6' : '✗ ' + (g.fails || []).join('、')).padEnd(24) +
    String(g.midLateMax).padStart(4) + '  ' + String(g.steadyWonPct).padStart(4) + '%  ' +
    String(g.buried).padStart(3) + '  ' + (ms / 1000).toFixed(1) + 's');
}
const sec = (Date.now() - t0) / 1000;
console.log('\n出关 ' + produced + '/' + K + ' ｜ 全过 ' + anyPass + '/' + K + ' ｜ 用时 ' + sec.toFixed(0) + 's');
if (best) {
  const g = best.res.goodV3 || {};
  console.log('选中 seed ' + bestSeed + '：' + (g.pass ? '✅ 六条全过' : '✗ ' + (g.fails || []).join('、')) +
    ' ｜ 峰窗 ' + g.midLateMax + ' · 稳健 ' + g.steadyWonPct + '% · 被埋 ' + g.buried);
}
if (!anyPass) console.log('⚠ 这一批没有任何一关全过；要么加 K，要么换图/换方案。');
