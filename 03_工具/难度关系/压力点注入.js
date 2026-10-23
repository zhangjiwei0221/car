#!/usr/bin/env node
/**
 * P6 v1：压力点注入
 *
 * 用法:
 *   node 03_工具/难度关系/压力点注入.js <关卡.json> [--top 5]
 *
 * 做法:
 *   1. 求解 + choiceCurve，找 prog 35~70%、free ≤1、full ≥2 的压力点；
 *   2. 在压力点的“当前取盒”上加链（与相邻普通盒成组）或数字冰；
 *   3. evaluateLevel 重算四玩家/T/R/U；
 *   4. 过滤：首通 15~50、学会后 50~90、T 10~40、U≤20；输出最佳。
 *
 * 容量、棋盘不动。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '../..');
const JS_DIR = path.join(ROOT, '02_工程/完整主bin快照_20261012/bin/js');
const OUT_DIR = path.join(__dirname, '输出');
const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js', 'playersim.js', 'analysis.js', 'generator.js'];

function loadAnt() {
  const sb = { console: { log() {}, warn() {}, error() {} }, module: { exports: {} }, WeakMap, Map, Set, setTimeout, clearTimeout, Infinity, Math, JSON, Date };
  vm.createContext(sb);
  for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(JS_DIR, f), 'utf8'), sb, { filename: f });
  return sb.AntSolver;
}

function main() {
  const args = process.argv.slice(2);
  const input = args.find(a => !a.startsWith('--'));
  if (!input) { console.log('用法: node 压力点注入.js <关卡.json> [--top 5]'); process.exit(1); }
  const topN = parseInt((args[args.indexOf('--top') + 1] || '5'), 10) || 5;
  const noWrite = args.includes('--no-write');
  const lv0 = JSON.parse(fs.readFileSync(input, 'utf8'));
  if (!lv0.board || !lv0.blocks) { console.error('不是内部关卡 JSON（缺 board/blocks）'); process.exit(1); }

  const A = loadAnt();
  const G = A.Generator;
  const cfg = {
    bottomOnly: false, instantChain: false, acceptMode: 'target',
    targetPeakMin: 3.2, targetPeakMax: 4.8, targetSteadyMin: 0, targetSteadyMax: 100,
    targetPlayerPassMin: 0.25, targetPlayerPassMax: 80, targetWMin: 2, targetWLowMax: 35,
    targetHiddenDeathMax: 20, difficultyRounds: 1, trapEvalMs: 1500
  };
  const parsed = A.parseLevel(lv0);
  const sr = A.Solver.solve(parsed, { timeBudgetMs: 2000 });
  if (!sr || !sr.completed) { console.error('基准不可解'); process.exit(1); }
  const cv = G.choiceCurve(parsed, sr);
  if (!cv || !cv.steps) { console.error('无 choiceCurve'); process.exit(1); }

  const ev = (level) => {
    const e = G.evaluateLevel(level, cfg);
    const p = e && e.goodV3 && e.goodV3.persist;
    if (!p) return null;
    const q = p.quality || {};
    return { first: p.playerPassPct, learned: p.learnedPassPct, look: p.lookaheadPassPct, T: q.T, R: q.R, U: q.U };
  };
  const base = ev(lv0);
  console.log('BASE', JSON.stringify(base));

  const points = cv.steps.map((s, i) => ({ i, s }))
    .filter(x => x.s.prog >= 0.35 && x.s.prog <= 0.70 && x.s.free <= 1 && x.s.full >= 2);
  console.log('压力点', points.map(x => x.i + '@' + Math.round(x.s.prog * 100) + '%').join(' '));
  const plain = (level, r, c) => {
    const x = level.board.cells[r] && level.board.cells[r][c];
    return x && x.t === 'box' && !x.chain && !x.numice && !x.q;
  };
  let maxChain = 0;
  for (const row of lv0.board.cells) for (const x of row) if (x && x.chain > maxChain) maxChain = x.chain;

  const rows = [];
  for (const { i, s } of points) {
    const pr = s.pick;
    if (!plain(lv0, pr.r, pr.c)) continue;
    for (const [dr, dc] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
      const nr = pr.r + dr, nc = pr.c + dc;
      if (!plain(lv0, nr, nc)) continue;
      const lv = JSON.parse(JSON.stringify(lv0));
      lv.board.cells[pr.r][pr.c].chain = maxChain + 1;
      lv.board.cells[nr][nc].chain = maxChain + 1;
      const m = ev(lv);
      if (!m) continue;
      if (m.first < 15 || m.first > 50) continue;
      if (m.learned < 50 || m.learned > 90) continue;
      if (m.T < 10 || m.T > 40) continue;
      if (m.U != null && m.U > 20) continue;
      const score = -Math.abs(m.first - 25) - Math.abs(m.learned - 65) - Math.abs(m.look - 75) * 0.2 - Math.abs(m.T - 30) * 1.5 + (m.R || 0) * 0.3;
      rows.push({ score: Math.round(score), point: i, prog: Math.round(s.prog * 100), r: pr.r, c: pr.c, nr, nc, m, level: lv });
    }
  }
  rows.sort((a, b) => b.score - a.score);
  console.log('\nTOP ' + Math.min(topN, rows.length));
  for (const r of rows.slice(0, topN)) {
    console.log(JSON.stringify({ score: r.score, point: r.point + '@' + r.prog + '%', chain: [r.r, r.c, r.nr, r.nc], first: r.m.first, learned: r.m.learned, look: r.m.look, T: r.m.T, R: r.m.R, U: r.m.U }));
  }
  if (noWrite) return;
  if (!rows.length) { console.log('没有命中'); return; }
  const best = rows[0];
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const baseName = path.basename(input, '.json');
  const out = path.join(OUT_DIR, '压力_' + baseName + '.json');
  const game = path.join(OUT_DIR, '压力_' + baseName + '_game.json');
  const rep = path.join(OUT_DIR, '压力_' + baseName + '_报告.json');
  fs.writeFileSync(out, JSON.stringify(best.level, null, 2));
  fs.writeFileSync(game, JSON.stringify(A.toGameFormat(A.parseLevel(best.level)), null, 2));
  fs.writeFileSync(rep, JSON.stringify({
    input, base, best: { score: best.score, point: best.point, prog: best.prog, chain: [best.r, best.c, best.nr, best.nc], metrics: best.m }
  }, null, 2));
  console.log('\n写出: ' + out); console.log('报告: ' + rep);
}

main();
