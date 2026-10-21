#!/usr/bin/env node
/**
 * 压力体检：把「全知压力曲线」拆成可对比的几个量，用来判断一次改动到底有没有用。
 *
 *   node 压力体检.js <目标图.txt> [--boards 6x7,7x7] [--seeds 401,403] [--lag 0,2] [--span 0,2]
 *
 * 输出每个组合的一行：
 *   30-80≥3%   30~80% 进度里暂存 ≥3 的样本占比（用户目标：基本都 ≥3）
 *   峰         该区间峰值（用户目标 ≤4）
 *   前沿中位   沿求解路线每步"可点盒数"的中位数（判断压力平台是否受前沿宽度限制）
 *   峰窗/稳健/合格  与生产同口径
 *
 * 只读：不写 输出文件/，不改生产代码。
 */
'use strict';
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const BASE = path.join(__dirname, '..', '..', '02_工程', '完整主bin快照_20261012');
const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js', 'playersim.js', 'analysis.js', 'generator.js'];
const sandbox = { console: { log() {}, warn() {}, error() {} }, module: { exports: {} }, WeakMap, Map, Set, setTimeout, clearTimeout, Infinity, Math, JSON };
vm.createContext(sandbox);
for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BASE, 'bin/js', f), 'utf8'), sandbox, { filename: f });
const A = sandbox.AntSolver, Sim = A.Simulator;

function loadImg(p) {
  const rows = []; let started = false;
  for (const l of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const t = l.trim();
    if (t === '像素矩阵') { started = true; continue; }
    if (!started || !t) continue;
    rows.push(t.split(/\s+/).map(Number));
  }
  return rows;
}

const argv = process.argv.slice(2);
const file = argv.find(a => !a.startsWith('--') && !a.includes(',') === false ? false : (!a.startsWith('--') && (a.endsWith('.txt'))));
const opt = (name, def) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const imgPath = argv.find(a => a.endsWith('.txt') || a.endsWith('.json'));
if (!imgPath) { console.error('用法：node 压力体检.js <目标图.txt> [--boards 6x7] [--seeds 401] [--lag 0] [--span 0]'); process.exit(1); }
const img = loadImg(imgPath);
const px = img.reduce((a, r) => a + r.filter(v => v > 0).length, 0);
const boards = opt('boards', '6x7').split(',').map(s => s.split('x').map(Number));
const seeds = opt('seeds', '401,403').split(',').map(Number);
const lags = opt('lag', '0').split(',').map(Number);
const spans = opt('span', '0').split(',').map(Number);

function once(seed, R, C, lag, span) {
  const cars = Math.round(R * C * 0.90), cap = Math.round(px / cars);
  const cfg = {
    boxSizeMin: Math.max(14, Math.round(cap * 0.9)), boxSizeMax: Math.max(20, Math.round(cap * 1.1)),
    usableSpaceTarget: 0.90, blackPercent: 0, blackPercentMin: 0, blackPercentMax: 0,
    icePercent: 0, row0IceMax: 2, iceSchedule: true, iceScheduleCount: 2, iceScheduleDelay: 3,
    chainCount: 1, chainCountMin: 0, chainCountMax: 3, questionPercent: 6, questionPercentMin: 6, questionPercentMax: 6,
    narrowPath: false, narrowPathProb: 0, minPipes: 0, maxPipes: 1, pipeFloorCount: 1, pipeFallbackCount: 1, pipeMaxDepth: 6, pipeMinFill: 2,
    boardAllowSquare: true, candidateCount: 1, portfolioK: 1, timeBudgetMs: 20000, difficultyRounds: 1,
    goodV3: true, requireHardPass: false, seed: seed,
    designSweep: false, designDebt: false, boardHardRange: true, boardAuto: false,
    boardRowsMin: R, boardRowsMax: R, boardColsMin: C, boardColsMax: C,
    cutPixelOrder: 'peel', fillOrder: 'exposure', debtCarCap: 40, cutMode: '', targetCarCount: cars, carFillRatio: 0.90,
    valvePlan: false, acceptMode: 'target', targetPeakMin: 3.2, targetPeakMax: 4, targetSteadyMin: 30, targetSteadyMax: 80,
    wallBottomFirst: true, splitByLayer: false, chunkCut: span, fillLag: lag
  };
  let out;
  try { out = A.Generator.produce(img, cfg); } catch (e) { return 'ERR ' + e.message; }
  if (!out || !out.level) return 'X ' + ((out && out.structural && out.structural.reason) || '').slice(0, 40);
  const lv = A.parseLevel(out.level);
  const sr = A.Solver.solve(lv, { greedyOnly: true });
  const ps = sr.pressureSamples || [], tb = sr.totalBoxes || 0;
  let bt = 0, bg = 0, bp = 0;
  for (const s of ps) { const pr = tb ? s.done / tb : 0; if (pr < 0.3 || pr > 0.8) continue; bt++; if (s.buf >= 3) bg++; if (s.buf > bp) bp = s.buf; }
  const st = Sim.createState(lv, {});
  const order = (sr.pickOrder || []).slice().sort((a, b) => (a.step || 0) - (b.step || 0));
  const widths = [];
  for (const p of order) {
    if (p.chainIndex > 0) continue;
    widths.push(Sim.listMoves(st).filter(m => !m.blocked).length);
    if (!Sim.applyPick(st, p.r, p.c)) break;
    if (st.gameOver) break;
  }
  widths.sort((a, b) => a - b);
  const med = widths.length ? widths[Math.floor(widths.length / 2)] : 0;
  const g = out.goodV3 || {};
  const pe = g.persist || {};
  return `30-80≥3:${bt ? Math.round(bg / bt * 100) : 0}% 峰${bp} 卡点窗${pe.chokeWin == null ? '?' : pe.chokeWin} 前沿中位${med} 峰窗${g.midLateMax} 稳健${g.steadyWonPct}% pass=${g.pass}`;
}

for (const span of spans) for (const lag of lags) for (const [R, C] of boards) for (const seed of seeds) {
  console.log(`span${span} lag${lag} ${R}x${C} seed${seed}: ` + once(seed, R, C, lag, span));
}
