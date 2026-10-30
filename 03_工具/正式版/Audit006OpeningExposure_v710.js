#!/usr/bin/env node
'use strict';

/**
 * E6.8R 开局曝露计算 v1（只读）
 *
 * 回答：开局第 1~N 步，每种颜色“当前可消像素”是多少？
 *       哪些可点的车因此变成“免费步”？
 *
 * 用法：node 03_工具/正式版/Audit006OpeningExposure_v710.js <level.json> [--steps 10]
 */

const fs = require('fs');
const path = require('path');
const B = require('./Build006Thickness_v688');

const file = process.argv[2];
if (!file) { console.error('用法: Audit006OpeningExposure_v710.js <level.json> [--steps 10]'); process.exit(1); }
const si = process.argv.indexOf('--steps');
const STEPS = si >= 0 ? Number(process.argv[si + 1]) : 10;

const A = B.loadSolver();
const game = B.readJson(file);
const level = A.parseLevel(A.fromGameFormat(game));

function freshState() {
  const st = A.Simulator.createState(level, { useSlotStart: true, instantChain: true });
  st.capture = true;
  return st;
}

/** 在某状态上模拟取这辆车，返回 {eaten, debt} */
function probe(st, picks, move) {
  const p = freshState();
  for (const q of picks) { p.capOps = []; A.Simulator.applyPick(p, q.r, q.c); }
  p.capOps = [];
  if (!A.Simulator.applyPick(p, move.r, move.c)) return null;
  const items = (p.buffer || []).filter(it => (it.progress || 0) < (it.need || 0));
  return {
    eaten: (move.antBox.count || 0) - items.reduce((a, it) => a + (it.need - (it.progress || 0)), 0),
    debt: items.reduce((a, it) => a + (it.need - (it.progress || 0)), 0),
    buffer: (p.buffer || []).length
  };
}

function main() {
  const picks = [];
  console.log('file=' + file);
  console.log('step | 可点 | 免费 | 各色可消像素（max 单车上限）');
  for (let step = 1; step <= STEPS; step++) {
    const st = freshState();
    for (const q of picks) { st.capOps = []; A.Simulator.applyPick(st, q.r, q.c); }
    const moves = A.Simulator.listMoves(st).filter(m => !m.blocked);
    if (!moves.length) { console.log('  no moves at step ' + step); break; }
    const perColor = {};
    let free = 0;
    const detail = [];
    for (const m of moves) {
      const r = probe(st, picks, m);
      if (!r) continue;
      const c = m.antBox.color;
      perColor[c] = Math.max(perColor[c] || 0, r.eaten);
      if (r.debt === 0) free++;
      detail.push({ r: m.r, c: m.c, color: c, cap: m.antBox.count, eaten: r.eaten, debt: r.debt });
    }
    console.log(`${String(step).padStart(4)} | ${String(moves.length).padStart(4)} | ${String(free).padStart(4)} | ` +
      Object.keys(perColor).sort((a, b) => a - b).map(c => `${c}:${perColor[c]}`).join(' '));
    if (step <= 3) {
      console.log('     可点明细: ' + detail.map(d => `(${d.r},${d.c})${d.color}/${d.cap}→吃${d.eaten}${d.debt ? '债' + d.debt : '满'}`).join('  '));
    }
    // 走“免费优先”一步
    detail.sort((a, b) => (a.debt - b.debt) || (b.eaten - a.eaten));
    const pick = detail[0];
    if (!pick) break;
    picks.push({ r: pick.r, c: pick.c });
  }
  console.log('freeFirstPicks=' + picks.length);
}

main();
