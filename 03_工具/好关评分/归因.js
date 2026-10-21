#!/usr/bin/env node
/**
 * 归因：失败是哪个功能块造成的？（消融实验，带种子）
 *
 *   node 归因.js --image <图.txt> [--scheme <方案.json>] [--seeds 11,33,44,55,66,77,88]
 *
 * 做法（对应工作日志 33 节，但这次**带种子**）：
 *   对每个 seed：先生成基线关 → 若六条没全过，就逐个"拿掉一种功能块"重跑同一条随机流：
 *     无冰 / 无链 / 无问号 / 无黑块 / 全拿掉
 *   看哪一版的 稳健通关率 / 策略差 / 被埋 / 峰窗 变好 → 就是它的贡献。
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

// ---- 参数 ----
const argv = process.argv.slice(2);
let imagePath = null, schemePath = DEFAULT_SCHEME, seeds = [11, 33, 44, 55, 66, 77, 88];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--image') imagePath = path.resolve(argv[++i]);
  else if (argv[i] === '--scheme') schemePath = path.resolve(argv[++i]);
  else if (argv[i] === '--seeds') seeds = String(argv[++i]).split(',').map(s => parseInt(s, 10)).filter(x => x > 0);
  else if (!argv[i].startsWith('--') && !imagePath) imagePath = path.resolve(argv[i]);
}
if (!imagePath) { console.error('用法: node 归因.js --image <图.txt> [--scheme <方案.json>] [--seeds 11,22,…]'); process.exit(1); }

// ---- 种子化 Math.random（生成器全走 Math.random）----
let _rng = 1;
function reseed(n) { _rng = (n >>> 0) || 1; }
const seededMath = Object.create(Math);
seededMath.random = function () { _rng = (_rng * 1664525 + 1013904223) >>> 0; return _rng / 4294967296; };
const sandbox = {
  console: { log() {}, warn() {}, error() {} }, module: { exports: {} },
  WeakMap, Map, Set, setTimeout, clearTimeout, Infinity, Math: seededMath, JSON
};
vm.createContext(sandbox);
for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BIN, f), 'utf8'), sandbox, { filename: f });
const A = sandbox.AntSolver;
const G = A.Generator;

const base = JSON.parse(fs.readFileSync(schemePath, 'utf8')).config || {};
const CFG = Object.assign({}, base, { candidateCount: 4, difficultyRounds: 2, timeBudgetMs: 60000, requireHardPass: false, seed: 1 });
const blocks = G.blocksFromTXT(fs.readFileSync(imagePath, 'utf8'));
const R = blocks.length, C = blocks[0].length;

// ---- 消融臂 ----
const ARMS = [
  ['基线', {}],
  ['无冰', { icePercent: 0, icePercentMin: 0, icePercentMax: 0 }],
  ['无链', { chainCount: 0, chainCountMin: 0, chainCountMax: 0 }],
  ['无问号', { questionPercent: 0, questionPercentMin: 0, questionPercentMax: 0 }],
  ['无黑块', { blackPercent: 0, blackPercentMin: 0, blackPercentMax: 0, usableSpaceTarget: 0 }],
  ['无管道', { minPipes: 0, minPipesMin: 0, minPipesMax: 0, pipeFloorCount: 0, pipeFallbackCount: 0 }],
  ['全拿掉', { icePercent: 0, icePercentMin: 0, icePercentMax: 0, chainCount: 0, chainCountMin: 0, chainCountMax: 0,
              questionPercent: 0, questionPercentMin: 0, questionPercentMax: 0, blackPercent: 0, blackPercentMin: 0, blackPercentMax: 0,
              narrowPath: false, minPipes: 0, usableSpaceTarget: 0 }]
];

function evaluate(res) {
  if (!res || !res.level) return null;
  const parsed = A.parseLevel(res.level);
  const audit = res.audit || {};
  let play = null, buried = null;
  try { play = G.chokeV2PlayBatch(parsed, { n: 18 }); } catch (e) {}
  try { const b = G.buriedCountOf(parsed); buried = (b && typeof b === 'object') ? (b.buried != null ? b.buried : b.stuck) : b; } catch (e) {}
  const p50 = play && play.lateMax ? play.lateMax.p50 : null;
  const steady = play ? play.steadyWonPct : null;
  const spread = play ? play.spreadPct : null;
  const early = audit.earlyMax != null ? audit.earlyMax : null;
  const solved = !!(res.solveResult && res.solveResult.completed);
  const fails = [];
  if (!solved) fails.push('可解');
  if (steady == null || steady < 50) fails.push('稳健');
  if (buried == null || buried !== 0) fails.push('被埋');
  if (early == null || early > 2) fails.push('前期');
  if (p50 == null || p50 < 3.2 || p50 > 4.8) fails.push('峰窗');
  if (spread == null || spread > 34) fails.push('策略差');
  return { solved, steady, spread, buried, p50, early, fails, pass: fails.length === 0 };
}

function runArm(seed, overrides) {
  reseed(seed);
  try {
    return G.produce(blocks, Object.assign({}, CFG, overrides, { mapSize: R }));
  } catch (e) { return null; }
}

console.log('图: ' + path.basename(imagePath) + '  ' + R + '×' + C + '  |  方案: ' + path.basename(schemePath));
console.log('seeds: ' + seeds.join(',') + '  |  臂: ' + ARMS.map(a => a[0]).join(' / ') + '\n');

const rows = [];
for (const seed of seeds) {
  const line = { seed, arms: {} };
  for (const [name, ov] of ARMS) {
    const res = runArm(seed, ov);
    const m = evaluate(res);
    line.arms[name] = m;
    if (name === '基线') {
      console.log('── seed ' + seed + ' 基线: ' + (m ? (m.pass ? '✅ 六条全过' : '✗ ' + m.fails.join('、')) : '✗ 未出关') +
        (m ? ' ｜ 稳健 ' + m.steady + '% · 策略差 ' + m.spread + ' · 被埋 ' + m.buried + ' · 峰窗 ' + m.p50 + ' · 前期 ' + m.early : ''));
    }
  }
  rows.push(line);
  // 逐臂对比
  for (const [name] of ARMS) {
    if (name === '基线') continue;
    const b = line.arms['基线'], m = line.arms[name];
    if (!b || !m) { console.log('    ' + name.padEnd(5) + ' ✗ 未出关'); continue; }
    const d = [];
    if (m.steady !== b.steady) d.push('稳健 ' + b.steady + '→' + m.steady);
    if (m.spread !== b.spread) d.push('策略差 ' + b.spread + '→' + m.spread);
    if (m.buried !== b.buried) d.push('被埋 ' + b.buried + '→' + m.buried);
    if (m.p50 !== b.p50) d.push('峰窗 ' + b.p50 + '→' + m.p50);
    if (m.early !== b.early) d.push('前期 ' + b.early + '→' + m.early);
    console.log('    ' + name.padEnd(5) + (d.length ? d.join('  ') : '（无变化）'));
  }
  console.log('');
}

// ---- 汇总：各消融对每个失败项的"改善次数" ----
console.log('══ 汇总（基线失败的 seed 里，消融后该指标变好/变坏的次数）');
const keys = [['稳健', 'steady', 1], ['策略差', 'spread', -1], ['被埋', 'buried', -1], ['峰窗', 'p50', 1], ['前期', 'early', -1]];
for (const [name] of ARMS) {
  if (name === '基线') continue;
  const out = [];
  for (const [label, key, dir] of keys) {
    let better = 0, worse = 0, n = 0;
    for (const line of rows) {
      const b = line.arms['基线'], m = line.arms[name];
      if (!b || !m || b[key] == null || m[key] == null) continue;
      n++;
      if ((m[key] - b[key]) * dir > 0) better++;
      else if ((m[key] - b[key]) * dir < 0) worse++;
    }
    out.push(label + ' ↑' + better + '/↓' + worse + '（n=' + n + '）');
  }
  console.log('  ' + name.padEnd(5) + out.join('　'));
}
