#!/usr/bin/env node
'use strict';

/**
 * E6.8R 压力双曲线报告（全知 vs 免费步）
 *
 * 背景：用户反馈“全知求解器压力超高，但真人一路免费步”——
 * 原因是两者根本不是一个东西。本工具把两条曲线画在同一张图上，
 * 并在标题区标注：全知峰值/窗口 vs 免费步玩家的峰值/窗口/最早被迫欠债步。
 *
 * 用法：
 *   node 03_工具/正式版/Report006Pressure_v709.js <level.json> [<level.json> ...]
 * 输出：与关卡同目录的 压力双曲线_<名字>.html
 */

const fs = require('fs');
const path = require('path');
const B = require('./Build006Thickness_v688');

function runFreeFirst(A, level) {
  const st = A.Simulator.createState(level, { useSlotStart: true, instantChain: true });
  st.capture = true;
  const picks = [];
  const history = [];
  const debts = [];
  for (let step = 0; step < 300; step++) {
    if (st.gameWon) break;
    const moves = A.Simulator.listMoves(st).filter(m => !m.blocked);
    if (!moves.length) break;
    const scored = [];
    for (const m of moves) {
      const probe = A.Simulator.createState(level, { useSlotStart: true, instantChain: true });
      probe.capture = true;
      for (const p of picks) { probe.capOps = []; A.Simulator.applyPick(probe, p.r, p.c); }
      probe.capOps = [];
      if (!A.Simulator.applyPick(probe, m.r, m.c)) continue;
      const items = (probe.buffer || []).filter(it => (it.progress || 0) < (it.need || 0));
      const debt = items.reduce((a, it) => a + (it.need - (it.progress || 0)), 0);
      scored.push({ m, debt });
    }
    if (!scored.length) break;
    scored.sort((a, b) => {
      const ca = a.m.groupSize > 1 ? 1 : 0, cb = b.m.groupSize > 1 ? 1 : 0;
      return (ca - cb) || (a.debt - b.debt) || (b.m.antBox.count - a.m.antBox.count);
    });
    const pick = scored[0];
    st.capOps = [];
    A.Simulator.applyPick(st, pick.m.r, pick.m.c);
    picks.push({ r: pick.m.r, c: pick.m.c });
    history.push((st.buffer || []).length);
    debts.push(pick.debt);
  }
  return { picks, history, debts, won: !!st.gameWon };
}

function polyline(values, w, h, maxY) {
  if (!values.length) return '';
  const stepX = values.length > 1 ? w / (values.length - 1) : w;
  return values.map((v, i) => `${(i * stepX).toFixed(1)},${(h - (v / maxY) * h).toFixed(1)}`).join(' ');
}

function report(file) {
  const A = B.loadSolver();
  const game = B.readJson(file);
  const level = A.parseLevel(A.fromGameFormat(game));
  const solve = A.Solver.solveInstantChain(level, { timeBudgetMs: 20000 });
  const akPicks = B.uniquePicks(solve);
  const akHist = solve.stepBufferHistory || [];
  const free = runFreeFirst(A, level);
  const akWin = B.pressureWindows(akHist, 3);
  const freeWin = B.pressureWindows(free.history, 3);
  const firstForced = free.debts.findIndex(d => d > 0);

  const W = 900, H = 260, maxY = 5;
  const totalSteps = Math.max(akHist.length, free.history.length);
  const padL = 40, padB = 26;
  const svgW = W - padL, svgH = H - padB;
  const akLine = polyline(akHist, svgW, svgH, maxY);
  const freeLine = polyline(free.history, svgW, svgH, maxY);

  const name = path.basename(file, '.json');
  const out = path.join(path.dirname(file), '压力双曲线_' + name + '.html');
  const html = `<!doctype html><meta charset="utf-8">
<title>压力双曲线 · ${name}</title>
<style>body{font:13px/1.6 -apple-system,sans-serif;background:#faf7f2;color:#3a2f26;margin:24px}
.box{background:#fff;border:1px solid #e6ddd0;border-radius:8px;padding:16px;max-width:1000px}
.h{font-weight:600;margin:0 0 8px}
.k{display:inline-block;margin-right:18px;font-size:12px;color:#6b5a45}
.dot{display:inline-block;width:10px;height:3px;vertical-align:middle;margin-right:5px}
table{border-collapse:collapse;margin-top:10px;font-size:12px}
td,th{border:1px solid #e6ddd0;padding:4px 8px;text-align:right}
th{background:#f3ece2}
</style>
<div class="box">
  <div class="h">${name} · 全知 vs 免费步（暂存压力）</div>
  <div>
    <span class="k"><span class="dot" style="background:#d2601a"></span>全知求解器（${akPicks.length} 步，峰值 ${solve.maxBuffer}，窗口 ${akWin.length}）</span>
    <span class="k"><span class="dot" style="background:#2f7d4f"></span>免费步玩家（${free.picks.length} 步，峰值 ${Math.max(0, ...free.history)}，窗口 ${freeWin.length}）</span>
  </div>
  <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <g transform="translate(${padL},0)">
      <rect x="0" y="0" width="${svgW}" height="${svgH}" fill="#fffdf9" stroke="#eee5d8"/>
      ${[0,1,2,3,4,5].map(v => `<line x1="0" y1="${svgH - v / maxY * svgH}" x2="${svgW}" y2="${svgH - v / maxY * svgH}" stroke="#f0e8dc"/>
        <text x="-8" y="${svgH - v / maxY * svgH + 4}" font-size="11" fill="#8a7a66" text-anchor="end">${v}</text>`).join('')}
      <polyline points="${akLine}" fill="none" stroke="#d2601a" stroke-width="2"/>
      <polyline points="${freeLine}" fill="none" stroke="#2f7d4f" stroke-width="2"/>
      <line x1="${svgW * (firstForced < 0 ? 0 : firstForced / Math.max(1, totalSteps))}" y1="0"
            x2="${svgW * (firstForced < 0 ? 0 : firstForced / Math.max(1, totalSteps))}" y2="${svgH}"
            stroke="#2f7d4f" stroke-dasharray="4 4" opacity="0.6"/>
    </g>
    <text x="${padL}" y="${H - 6}" font-size="11" fill="#8a7a66">步数（横轴按各自路线长度拉伸；绿色虚线=免费步玩家第一次被迫欠债）</text>
  </svg>
  <table>
    <tr><th></th><th>步数</th><th>峰值</th><th>窗口</th><th>说明</th></tr>
    <tr><th>全知</th><td>${akPicks.length}</td><td>${solve.maxBuffer}</td><td>${akWin.length}</td><td style="text-align:left">求解器自选路线，会主动吃债</td></tr>
    <tr><th>免费步</th><td>${free.picks.length}</td><td>${Math.max(0, ...free.history)}</td><td>${freeWin.length}</td>
        <td style="text-align:left">只挑能收满的车；${firstForced < 0 ? '全程无债务（可免费通关）' : '第 ' + (firstForced + 1) + ' 步起被迫欠债'}</td></tr>
  </table>
</div>`;
  fs.writeFileSync(out, html);
  console.log('written=' + out);
  console.log(`${name}: allKnowing steps=${akPicks.length} peak=${solve.maxBuffer} windows=${akWin.length} | free steps=${free.picks.length} peak=${Math.max(0, ...free.history)} windows=${freeWin.length} firstForced=${firstForced < 0 ? 'none' : firstForced + 1}`);
}

const files = process.argv.slice(2);
if (!files.length) { console.error('用法: node Report006Pressure_v709.js <level.json> ...'); process.exit(1); }
files.forEach(report);
