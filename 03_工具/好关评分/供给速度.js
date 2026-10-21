#!/usr/bin/env node
/**
 * 供给速度：开局每步"有多少辆车是现在就能吃满的"
 *
 *   node 供给速度.js --image <图.txt> [--scheme <方案.json>] [--seeds 401,402] [--steps 12]
 *
 * 为什么：35×35 那张图，环上"可点且早出"的车只有 1~2 辆，可峰窗还是上不去。
 *   假设是"吃掉这 1~2 辆后，可消供给打开得太快"——本工具就是量这个：
 *     每一步记一次 canConsume 的车数；
 *     再看"连续多少步都有 ≥4 辆能吃满"（= 供给太宽，玩家根本不用垫）。
 *
 * 只读：不写输出文件。
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
let imagePath = null, schemePath = DEFAULT_SCHEME, steps = 12;
let seeds = [401, 402, 403, 404, 405];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--image') imagePath = path.resolve(argv[++i]);
  else if (argv[i] === '--scheme') schemePath = path.resolve(argv[++i]);
  else if (argv[i] === '--seeds') seeds = String(argv[++i]).split(',').map(Number).filter(Boolean);
  else if (argv[i] === '--steps') steps = Math.max(4, parseInt(argv[++i], 10) || 12);
  else if (!argv[i].startsWith('--') && !imagePath) imagePath = path.resolve(argv[i]);
}
if (!imagePath) { console.error('用法: node 供给速度.js --image <图.txt> [--seeds 401,402]'); process.exit(1); }

const sandbox = { console: { log() {}, warn() {}, error() {} }, module: { exports: {} },
  WeakMap, Map, Set, setTimeout, clearTimeout, Infinity, Math, JSON };
vm.createContext(sandbox);
for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BIN, f), 'utf8'), sandbox, { filename: f });
const A = sandbox.AntSolver, G = A.Generator, Sim = A.Simulator;

const base = JSON.parse(fs.readFileSync(schemePath, 'utf8')).config || {};
const blocks = G.blocksFromTXT(fs.readFileSync(imagePath, 'utf8'));
const R = blocks.length, C = blocks[0].length;

/** 走一局，记录每一步"能吃满的车数" */
function supplyCurve(parsed) {
  const st = Sim.enter(parsed, { useSlotStart: true });
  const counts = [];
  let guard = 0;
  while (guard++ < 200 && !st.gameOver) {
    const mv = Sim.listMoves(st);
    const full = mv.filter(m => m.canConsume && !m.blocked);
    counts.push(full.length);
    if (!full.length) {
      const any = mv.filter(m => !m.blocked);
      if (!any.length) break;
      if (!Sim.applyPick(st, any[0].r, any[0].c)) break;
    } else {
      full.sort((a, b) => (b.antBox.count || 0) - (a.antBox.count || 0));
      if (!Sim.applyPick(st, full[0].r, full[0].c)) break;
    }
  }
  return counts;
}

/** 连续 ≥4 辆的最长步数 + 前 N 步均值 */
function summarize(counts, n) {
  let run = 0, maxRun = 0;
  for (const c of counts) { if (c >= 4) { run++; if (run > maxRun) maxRun = run; } else run = 0; }
  const head = counts.slice(0, n);
  const mean = head.length ? head.reduce((a, b) => a + b, 0) / head.length : 0;
  // 中后期窗口（30%~80% 进度）里的供给均值——峰窗就在这个窗口里量，供给也该在这量
  const a = Math.floor(counts.length * 0.3), b = Math.max(a + 1, Math.floor(counts.length * 0.8));
  const mid = counts.slice(a, b);
  const midMean = mid.length ? mid.reduce((x, y) => x + y, 0) / mid.length : 0;
  const midMin = mid.length ? Math.min.apply(null, mid) : 0;
  return { maxRun, mean: +mean.toFixed(2), head, midMean: +midMean.toFixed(2), midMin };
}

console.log('图: ' + path.basename(imagePath) + '  ' + R + '×' + C + '  |  ' + path.basename(schemePath));
console.log('seed  六条  峰窗  供给(前 ' + steps + ' 步能吃满的车数)        均值  连续≥4步');
for (const seed of seeds) {
  const cfg = Object.assign({}, base, { candidateCount: 4, difficultyRounds: 2, timeBudgetMs: 60000,
    requireHardPass: false, seed, designSweep: true, designDebt: true });
  let res = null;
  try { res = G.produce(blocks, Object.assign(cfg, { mapSize: R })); } catch (e) { res = null; }
  if (!res || !res.level) { console.log(String(seed).padEnd(5) + ' 未出关'); continue; }
  const parsed = A.parseLevel(res.level);
  const counts = supplyCurve(parsed);
  const s = summarize(counts, steps);
  const g = res.goodV3 || {};
  console.log(String(seed).padEnd(5) +
    (g.pass ? ' ✅ ' : ' ✗  ') + String(g.midLateMax).padStart(4) + '  ' +
    JSON.stringify(s.head).padEnd(32) + '  ' + String(s.mean).padStart(5) + '  ' + String(s.maxRun).padStart(6) +
    '   中后期供给 ' + String(s.midMean).padStart(5) + '（最低 ' + s.midMin + '）');
}
