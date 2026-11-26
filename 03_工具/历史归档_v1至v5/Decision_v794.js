#!/usr/bin/env node
'use strict';
/**
 * Decision_v794 —— 决策度（模拟器真实口径）
 *
 * v793 的问题：可达性用"一步邻接"算（目标图边框或与已消格相邻），
 * 但游戏里的消除是同色 flood-fill：与已消格连通的一整片同色像素都算可达。
 * 结果 v793 在同一批车上把"可吃满"算成 0，v2 的 32/60 门在第1步明明能吃满却判 0/40。
 *
 * v794 直接用模拟器：
 *   - 按求解器路线逐步重放；
 *   - 每步 Sim.listMoves 得到真实可选车（已排除冰/锁/黑块）；
 *   - canConsume 为真的车 = 当前能消满；
 *   - 好决策 = 可选≥2 且 可吃满≥1 且 可吃满<可选；
 *   - 没得选 = 可吃满=0。
 *
 * 用法：
 *   node Decision_v794.js <关卡.json> [...]
 */
const B = require('./Build006Thickness_v688');
const A = B.loadSolver('corner');

function analyze(file) {
  const g = B.readJson(file);
  const lv = A.parseLevel(A.fromGameFormat(g));
  const o = A.Solver.runSolver(lv, 0, 1, false, false, { capturePreviewStats: true, instantChain: false });
  const Sim = A.Simulator;
  const st = Sim.enter(lv, { useSlotStart: true, instantChain: false });
  const picks = (o.pickOrder || []).filter(p => p.chainIndex === 0);
  let good = 0, dead = 0, forced = 0, sumAvail = 0, sumFill = 0;
  const avs = [];
  for (const p of picks) {
    const moves = Sim.listMoves(st).filter(m => !m.blocked);
    const avail = moves.length;
    const fill = moves.filter(m => m.canConsume).length;
    avs.push(avail); sumAvail += avail; sumFill += fill;
    if (avail >= 2 && fill >= 1 && fill < avail) good++;
    if (fill === 0) dead++;
    if (avail === 1) forced++;
    Sim.applyPick(st, p.r, p.c);
  }
  const N = picks.length;
  return {
    f: file,
    N,
    good,
    dead,
    forced,
    avg: sumAvail / Math.max(1, N),
    avgFill: sumFill / Math.max(1, N),
    max: Math.max(0, ...avs),
    won: !!o.completed
  };
}

const files = process.argv.slice(2);
if (!files.length) {
  console.error('用法: node Decision_v794.js <关卡.json> [...]');
  process.exit(2);
}
for (const f of files) {
  const r = analyze(f);
  console.log(
    r.f.split('/').slice(-2)[0].padEnd(18) +
    ' 步' + String(r.N).padStart(3) +
    ' | 平均可选 ' + r.avg.toFixed(1).padStart(4) + '（最多 ' + String(r.max).padStart(2) + '）' +
    ' | 平均可吃满 ' + r.avgFill.toFixed(1).padStart(4) +
    ' | 好决策 ' + String(r.good).padStart(3) + '/' + r.N +
    ' | 没得选 ' + String(r.dead).padStart(2) +
    ' | 唯一选择 ' + String(r.forced).padStart(2) +
    ' | 可通' + (r.won ? '✓' : '✗')
  );
}
