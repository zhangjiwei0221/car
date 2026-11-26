#!/usr/bin/env node
'use strict';

/**
 * E6.8R “纯免费路线”存在性检验
 *
 * 问题（用户 2026-10-28 反馈）：全知求解器显示高压力，
 * 但真人玩起来“卡一次之后一路免费步”。
 *
 * 本工具回答一个确定性问题：
 *   是否存在一条**每一步都不产生任何债务**（暂存不增加）的完整通关路线？
 *
 * 做法：按步进 beam search，只保留“该步零债务”的动作；
 *       用（已消除格 + 暂存内容）做状态签名去重。
 *
 * 用法：node 03_工具/正式版/Audit006FreeOnlyPath_v708.js <level.json> [--beam 80]
 */

const fs = require('fs');
const path = require('path');
const B = require('./Build006Thickness_v688');

const file = process.argv[2];
if (!file) { console.error('用法: node Audit006FreeOnlyPath_v708.js <level.json> [--beam 80]'); process.exit(1); }
const bi = process.argv.indexOf('--beam');
const BEAM = bi >= 0 ? Number(process.argv[bi + 1]) : 80;

const A = B.loadSolver();
const game = B.readJson(file);
const level = A.parseLevel(A.fromGameFormat(game));

function replay(picks) {
  const st = A.Simulator.createState(level, { useSlotStart: true, instantChain: true });
  st.capture = true;
  for (const p of picks) {
    st.capOps = [];
    if (!A.Simulator.applyPick(st, p.r, p.c)) return null;
  }
  return st;
}

function sig(st) {
  const elim = st.eliminated.map(row => row.map(v => (v ? 1 : 0)).join('')).join('|');
  const buf = (st.buffer || []).map(it => it.color + ':' + (it.need - (it.progress || 0))).sort().join(',');
  return elim + '#' + buf;
}

function debtOf(st, move) {
  const probe = replay([...st.__picks, { r: move.r, c: move.c }]);
  if (!probe) return null;
  const items = (probe.buffer || []).filter(it => (it.progress || 0) < (it.need || 0));
  return items.reduce((a, it) => a + (it.need - (it.progress || 0)), 0);
}

function main() {
  let beam = [{ picks: [] }];
  const seen = new Set();
  let maxDepth = 0;
  let deepest = null;
  for (let step = 1; step <= 80; step++) {
    const next = [];
    for (const node of beam) {
      const st = replay(node.picks);
      if (!st) continue;
      st.__picks = node.picks;
      if (st.gameWon) {
        console.log('FREE-PATH FOUND: ' + node.picks.length + ' 步全免费');
        console.log('picks=' + JSON.stringify(node.picks.map(p => [p.r, p.c, p.color, p.count])));
        return;
      }
      const moves = A.Simulator.listMoves(st).filter(m => !m.blocked);
      for (const m of moves) {
        const d = debtOf(st, m);
        if (d !== 0) continue;
        const picks = node.picks.concat([{ r: m.r, c: m.c, color: m.antBox.color, count: m.antBox.count }]);
        const probe = replay(picks);
        if (!probe) continue;
        if (probe.gameOver && !probe.gameWon) continue;
        const s = sig(probe);
        if (seen.has(s)) continue;
        seen.add(s);
        next.push({ picks, won: probe.gameWon });
      }
    }
    if (!next.length) {
      console.log('NO FREE PATH: 第 ' + step + ' 步起没有零债务动作（深 ' + maxDepth + '）');
      if (deepest) {
        console.log('free-path=' + JSON.stringify(deepest.picks.map(p => [p.r, p.c, p.color, p.count])));
      }
      return;
    }
    next.sort((a, b) => Number(b.won) - Number(a.won));
    beam = next.slice(0, BEAM);
    if (!deepest || beam[0].picks.length >= deepest.picks.length) deepest = beam[0];
    maxDepth = step;
  }
  console.log('NO FREE PATH: 深 ' + maxDepth + ' 步仍未通关（beam ' + BEAM + '）');
}

main();
