#!/usr/bin/env node
/**
 * 死路选择数：一关里有多少步"两个都能装满，但只有一个能活"
 *
 *   node 死路选择.js --image <图.txt> [--scheme <方案.json>] [--seeds 11,22,…]
 *
 * 做法（v190）：
 *   1. 用"能吃满就吃、按容量降序"的稳态策略走一局，记下整条路线；
 *   2. 对每一步，列出"此刻能装满的车"（canConsume 且未被阻塞）；
 *   3. 若某步有 ≥2 辆能装满：分别把每一辆作为这一步的选择，**重放到该步再往后走完**；
 *   4. 有分支走死、有分支能通 → 这一步就是"死路选择"。
 *
 * 这是 v190 的**只读测量**：不改生成。用它去和 goodV3 的"策略差"对表。
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
let imagePath = null, schemePath = DEFAULT_SCHEME, seeds = [11, 22, 33, 44, 55, 66, 77, 88];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--image') imagePath = path.resolve(argv[++i]);
  else if (argv[i] === '--scheme') schemePath = path.resolve(argv[++i]);
  else if (argv[i] === '--seeds') seeds = String(argv[++i]).split(',').map(s => parseInt(s, 10)).filter(x => x > 0);
  else if (!argv[i].startsWith('--') && !imagePath) imagePath = path.resolve(argv[i]);
}
if (!imagePath) { console.error('用法: node 死路选择.js --image <图.txt> [--scheme <方案.json>] [--seeds 11,22,…]'); process.exit(1); }

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
const A = sandbox.AntSolver, G = A.Generator, Sim = A.Simulator;

const base = JSON.parse(fs.readFileSync(schemePath, 'utf8')).config || {};
const CFG = Object.assign({}, base, { candidateCount: 4, difficultyRounds: 2, timeBudgetMs: 60000, requireHardPass: false, seed: 1 });
const blocks = G.blocksFromTXT(fs.readFileSync(imagePath, 'utf8'));
const R = blocks.length, C = blocks[0].length;

// ---------- 策略：能吃满就吃（容量大的优先），否则垫第一辆不阻塞的 ----------
function pickPolicy(st) {
  const mv = Sim.listMoves(st);
  const full = mv.filter(m => m.canConsume && !m.blocked);
  if (full.length) { full.sort((a, b) => (b.antBox.count || 0) - (a.antBox.count || 0)); return { move: full[0], full }; }
  const any = mv.filter(m => !m.blocked);
  return { move: any[0] || null, full: [] };
}
function isWon(st) { return !!st.gameWon || (st.eliminatedPixels >= st.totalPixels); }
function apply(st, p) { try { return Sim.applyPick(st, p.r, p.c); } catch (e) { return false; } }

// ---------- 一局（可带前缀 + 指定第一个分支）----------
function play(parsed, prefix, branch) {
  const st = Sim.enter(parsed, { useSlotStart: true });
  for (let i = 0; i < (prefix ? prefix.length : 0); i++) {
    if (st.gameOver) break;
    if (!apply(st, prefix[i])) return { won: false, broken: true, steps: i };
  }
  if (branch) { if (!apply(st, branch)) return { won: false, broken: true, steps: 0 }; }
  let guard = 0;
  while (guard++ < 1500 && !st.gameOver) {
    const { move } = pickPolicy(st);
    if (!move) break;
    if (!apply(st, move)) break;
  }
  return { won: isWon(st) };
}

// ---------- 主测量 ----------
function measure(parsed) {
  const st = Sim.enter(parsed, { useSlotStart: true });
  const route = [];   // 每一步：{r,c, full:[{r,c,color,count}], fullCount}
  let guard = 0;
  while (guard++ < 1500 && !st.gameOver) {
    const { move, full } = pickPolicy(st);
    if (!move) break;
    route.push({
      r: move.r, c: move.c,
      full: full.map(m => ({ r: m.r, c: m.c, color: m.antBox.color, count: m.antBox.count })),
      fullCount: full.length
    });
    if (!apply(st, move)) break;
  }
  const baseWon = isWon(st);

  // 只测"≥2 个满解"的步；每步把每个满解都试一遍
  let deathSteps = 0, doomed = 0, tested = 0;
  const details = [];
  for (let i = 0; i < route.length; i++) {
    const step = route[i];
    if (step.fullCount < 2) continue;
    tested++;
    const outcomes = [];
    for (const cand of step.full) {
      const r = play(parsed, route.slice(0, i), cand);
      outcomes.push({ cand, won: r.won });
    }
    const winN = outcomes.filter(o => o.won).length;
    const loseN = outcomes.length - winN;
    if (winN > 0 && loseN > 0) {
      deathSteps++;
      doomed += loseN;
      details.push({ step: i + 1, options: outcomes.map(o => (o.cand.color + '号/' + o.cand.count + (o.won ? '✓' : '✗'))) });
    }
  }
  return { baseWon, steps: route.length, tested, deathSteps, doomed, details };
}

console.log('图: ' + path.basename(imagePath) + '  ' + R + '×' + C + '  |  方案: ' + path.basename(schemePath));
console.log('seeds: ' + seeds.join(','));
console.log('\nseed  出关  六条         稳健   策略差  峰窗  被埋 | 步数  ≥2满解步  死路步  死路选项');
const rows = [];
for (const seed of seeds) {
  reseed(seed);
  let res = null;
  try { res = G.produce(blocks, Object.assign({}, CFG, { mapSize: R })); } catch (e) {}
  if (!res || !res.level) { console.log(String(seed).padEnd(5) + ' ✗ 未出关'); continue; }
  const parsed = A.parseLevel(res.level);
  const gv = res.goodV3 || {};
  const m = measure(parsed);
  rows.push({ seed, gv, m });
  console.log(String(seed).padEnd(5) +
    (res.valid ? ' ✓  ' : ' ✗  ') + ((gv.pass ? '6/6 ✅' : '✗ ' + (gv.fails || []).join('、')).padEnd(14)) +
    String(gv.steadyWonPct).padStart(4) + '%  ' + String(gv.spreadPct).padStart(4) + '  ' +
    String(gv.midLateMax).padStart(4) + '  ' + String(gv.buried).padStart(2) + ' | ' +
    String(m.steps).padStart(4) + '  ' + String(m.tested).padStart(7) + '  ' + String(m.deathSteps).padStart(6) + '  ' + String(m.doomed).padStart(6));
  if (m.details.length) {
    console.log('      死路明细: ' + m.details.slice(0, 4).map(d => '第' + d.step + '步[' + d.options.join(' vs ') + ']').join('  '));
  }
}

// ---- 相关性：死路步 vs 策略差 ----
const ok = rows.filter(r => r.gv && r.gv.spreadPct != null);
if (ok.length >= 3) {
  const xs = ok.map(r => r.m.deathSteps), ys = ok.map(r => r.gv.spreadPct);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < xs.length; i++) { num += (xs[i] - mx) * (ys[i] - my); dx += (xs[i] - mx) ** 2; dy += (ys[i] - my) ** 2; }
  const r = (dx && dy) ? num / Math.sqrt(dx * dy) : 0;
  console.log('\n死路步 与 策略差 的相关系数 r = ' + r.toFixed(3) + '（n=' + ok.length + '）');
}
