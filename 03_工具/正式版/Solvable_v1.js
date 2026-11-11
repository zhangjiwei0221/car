#!/usr/bin/env node
'use strict';
/**
 * Solvable_v1 —— 宽度可调束搜索：只回答「这关能不能找到一条通关路线」
 *
 * 口径：build006 的 corner 结算口径（loadSolver('corner')），
 *       useSlotStart: true / instantChain: false，与造关、验收一致。
 *
 * 重要：本工具只做「找到解」的正面证明。
 *   solvable:true  —— 找到一条真实可重放的通关路线。
 *   solvable:false —— **只代表宽度 W 没有找到**，不代表这关无解。
 *                     证明无解是 T6b 的活，不在本工具的输出含义内。
 *
 * 用法：
 *   node Solvable_v1.js <关卡.json> [--width 16] [--timeout 30] [--out 结果.json]
 *
 * 输出（控制台一行 JSON）：
 *   {level, width, solvable, steps, bestPx, totalPx, sec, timedOut}
 *   steps 为找到解时的点击步数；未找到时为 null。
 *   bestPx 是搜索过程中见过的最好进度（已消除像素数）。
 *
 * 搜索：
 *   每层对 beam 中每个状态展开所有 !blocked 的 listMoves，cloneState + applyPick；
 *   消除像素达到 totalPixels 即赢；overflow / 暂存超上限 / Sim.isDeadEnd 丢弃；
 *   状态键 = 棋盘占位 + 已消除像素数 + 数字冰剩余 + 暂存（颜色:进度 排序后），同键只留一个；
 *   排序：暂存少优先，其次已消除像素多优先；每层截断到 width。
 */
const fs = require('fs');
const path = require('path');

const B = require('./Build006Thickness_v688');
const A = B.loadSolver('corner');
const Sim = A.Simulator;
const St = A.SolverStrategy;

const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : d;
};

const input = process.argv[2];
if (!input || input.startsWith('--')) {
  console.error('用法: node Solvable_v1.js <关卡.json> [--width 16] [--timeout 30] [--out 结果.json]');
  process.exit(2);
}

const width = Math.max(1, parseInt(arg('--width', '16'), 10) || 16);
const timeoutSec = Math.max(0, parseFloat(arg('--timeout', '30')) || 0);
const outFile = arg('--out', null);

function fail(msg) {
  console.error(msg);
  process.exit(2);
}

let raw;
try {
  raw = fs.readFileSync(input, 'utf8');
} catch (err) {
  fail('读取失败: ' + err.message);
}
let game;
try {
  game = JSON.parse(raw);
} catch (err) {
  fail('JSON 解析失败: ' + err.message);
}
if (!game || !Array.isArray(game.spools)) fail('不是可识别的关卡 JSON（缺少 spools）');

const level = A.parseLevel(A.fromGameFormat(game));
if (!level.board || !level.board.rows || !level.board.cols) fail('关卡棋盘为空');

/** 状态去重键：棋盘占位 + 已消除像素数 + 数字冰剩余 + 暂存（颜色:进度 排序后） */
function keyOf(s) {
  let k = '';
  for (const row of s.cells) for (const c of row) k += (c && c.t === 'box') ? '1' : '0';
  let ice = '';
  if (s.numice) {
    for (const kk of Object.keys(s.numice).sort()) ice += kk + ':' + s.numice[kk].remaining + ';';
  }
  return k + '|' + s.eliminatedPixels + '|' + ice + '|' +
    s.buffer.map(b => b.color + ':' + b.progress).sort().join(',');
}

/** 暂存少优先，其次已消除像素多优先 */
function better(a, b) {
  return (a.buffer.length - b.buffer.length) ||
    (b.eliminatedPixels - a.eliminatedPixels);
}

function solve() {
  const t0 = Date.now();
  const deadline = timeoutSec > 0 ? t0 + timeoutSec * 1000 : Infinity;

  const s0 = Sim.createState(level, { useSlotStart: true, instantChain: false });
  const totalPx = s0.totalPixels || level.totalPixels || 0;
  let bestPx = s0.eliminatedPixels || 0;

  let beam = [s0];
  let found = (totalPx > 0 && s0.eliminatedPixels >= totalPx) ? s0 : null;
  let timedOut = false;
  const maxSteps = (level.totalBoxes || 1) + 1; // 每步至少取走 1 个盒，步数不会超过盒数

  for (let step = 0; step < maxSteps && beam.length && !found; step++) {
    if (Date.now() > deadline) { timedOut = true; break; }
    const next = [];
    for (const s of beam) {
      if (Date.now() > deadline) { timedOut = true; break; }
      const moves = Sim.listMoves(s).filter(m => !m.blocked);
      for (const m of moves) {
        const child = St.cloneState(s);
        if (!Sim.applyPick(child, m.r, m.c)) continue;

        const px = child.eliminatedPixels || 0;
        if (px > bestPx) bestPx = px;
        if (px >= totalPx) { found = child; break; }

        // 死：overflow / 暂存超上限 / isDeadEnd
        if (child.overflow || child.buffer.length > child.bufferLimit) continue;
        // isDeadEnd 在"暂存未满"时只会因"盘上无可点车"判死；这种状态下一层展开也是 0 个孩子，
        // 让它自然消失即可（省掉一次 listMoves + 每个暂存球的 floodFill）。暂存满时必须判，
        // 因为"满格但暂存车还能吃"与"满格死局"只有 isDeadEnd 能区分。
        if (child.buffer.length >= child.bufferLimit && Sim.isDeadEnd(child)) continue;

        next.push(child);
      }
      if (found || timedOut) break;
    }
    if (found || timedOut) break;

    // 同键只留一个：先排序（好的在前），再按首次出现的键保留。
    next.sort(better);
    const seen = new Set();
    const kept = [];
    for (const s of next) {
      const k = keyOf(s);
      if (seen.has(k)) continue;
      seen.add(k);
      kept.push(s);
      if (kept.length >= width) break;
    }
    beam = kept;
  }

  const sec = +((Date.now() - t0) / 1000).toFixed(3);
  const note = found
    ? '宽度 ' + width + ' 找到一条通关路线'
    : '宽度 ' + width + ' 未找到（只代表这个宽度没找到，不代表无解）';
  return {
    level: path.basename(input),
    width,
    solvable: !!found,
    steps: found ? found.steps : null,
    bestPx,
    totalPx,
    sec,
    timedOut,
    note
  };
}

const result = solve();
const line = JSON.stringify(result);
console.log(line);
if (outFile) {
  try {
    fs.writeFileSync(outFile, JSON.stringify(result, null, 2) + '\n');
  } catch (err) {
    console.error('写结果失败: ' + err.message);
    process.exit(1);
  }
}
