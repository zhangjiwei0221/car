#!/usr/bin/env node
'use strict';
/**
 * diag_beam_74129 —— 诊断用束搜索（复制 Solvable_v1 的搜索逻辑），
 * 额外输出“最好状态”的剩余盘面/管道/暂存，用于判断卡在哪 88px。
 *
 * 用法: node diag_beam_74129.js <关卡.json> [--width 32] [--timeout 60]
 */
const fs = require('fs');
const path = require('path');
const B = require(path.resolve(__dirname, '../../../../03_工具/正式版/Build006Thickness_v688.js'));
const A = B.loadSolver('corner');
const Sim = A.Simulator, St = A.SolverStrategy;
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const input = process.argv[2];
const width = Math.max(1, parseInt(arg('--width', '32'), 10));
const timeoutSec = Math.max(0, parseFloat(arg('--timeout', '60')));
const game = JSON.parse(fs.readFileSync(input, 'utf8'));
const level = A.parseLevel(A.fromGameFormat(game));
function keyOf(s) {
  let k = '';
  for (const row of s.cells) for (const c of row) k += (c && c.t === 'box') ? '1' : '0';
  let ice = '';
  if (s.numice) for (const kk of Object.keys(s.numice).sort()) ice += kk + ':' + s.numice[kk].remaining + ';';
  return k + '|' + s.eliminatedPixels + '|' + ice + '|' +
    s.buffer.map(b => b.color + ':' + b.progress).sort().join(',');
}
const better = (a, b) => (a.buffer.length - b.buffer.length) || (b.eliminatedPixels - a.eliminatedPixels);
const t0 = Date.now(), deadline = timeoutSec > 0 ? t0 + timeoutSec * 1000 : Infinity;
const s0 = Sim.createState(level, { useSlotStart: true, instantChain: false });
const totalPx = s0.totalPixels || level.totalPixels || 0;
let best = s0, bestPx = s0.eliminatedPixels || 0;
let bestStepState = s0, bestStep = 0;
let beam = [s0], found = null, timedOut = false;
const maxSteps = (level.totalBoxes || 1) + 2;
for (let step = 0; step < maxSteps && beam.length && !found; step++) {
  if (Date.now() > deadline) { timedOut = true; break; }
  const next = [];
  for (const s of beam) {
    for (const m of Sim.listMoves(s).filter(x => !x.blocked)) {
      const child = St.cloneState(s);
      if (!Sim.applyPick(child, m.r, m.c)) continue;
      const px = child.eliminatedPixels || 0;
      if (px > bestPx) { bestPx = px; best = child; }
      if (child.steps > bestStep) { bestStep = child.steps; bestStepState = child; }
      if (px >= totalPx) { found = child; break; }
      if (child.overflow || child.buffer.length > child.bufferLimit) continue;
      if (child.buffer.length >= child.bufferLimit && Sim.isDeadEnd(child)) continue;
      next.push(child);
    }
    if (found) break;
  }
  if (found) break;
  next.sort(better);
  const seen = new Set(), kept = [];
  for (const s of next) { const k = keyOf(s); if (seen.has(k)) continue; seen.add(k); kept.push(s); if (kept.length >= width) break; }
  beam = kept;
}
const dump = (s, tag) => {
  const rem = {};
  const boxes = [];
  for (let r = 0; r < s.boardRows; r++) for (let c = 0; c < s.boardCols; c++) {
    const cell = s.cells[r][c];
    if (cell && cell.t === 'box') {
      rem[cell.color] = (rem[cell.color] || 0) + cell.count;
      boxes.push({ r, c, color: cell.color, count: cell.count, chain: cell.chain, flooded: cell.flooded });
    }
  }
  const moves = Sim.listMoves(s);
  console.log(JSON.stringify({
    tag, steps: s.steps, eliminatedPixels: s.eliminatedPixels, totalPx,
    gameOver: s.gameOver, deadEnd: s.deadEnd, isDeadEnd: (() => { try { return Sim.isDeadEnd(s); } catch (e) { return 'err:' + e.message; } })(),
    moves: moves.map(m => ({ r: m.r, c: m.c, color: m.antBox.color, count: m.antBox.count, blocked: m.blocked, canConsume: m.canConsume })),
    activatedCount: Object.keys(s.activated || {}).length,
    boxChecks: boxes.map(b => ({ r: b.r, c: b.c, color: b.color, act: !!(s.activated && s.activated[b.r + ',' + b.c]), iceLocked: (() => { try { return Sim.isNumIceLocked(s, b.r, b.c); } catch (e) { return 'err'; } })(), chainLocked: (() => { try { return Sim.isChainLocked(s, b.r, b.c); } catch (e) { return 'err'; } })() })),
    buffer: s.buffer.map(b => ({ color: b.color, progress: b.progress, count: b.count })),
    remainingBoxesByColor: rem,
    remainingBoxes: boxes,
    pipes: (() => { const out = []; for (let r = 0; r < s.boardRows; r++) for (let c = 0; c < s.boardCols; c++) { const cel = s.cells[r][c]; if (cel && cel.t === 'pipe') out.push({ r, c, dir: cel.dir, next: cel.next, opened: cel.opened, queueLen: (cel.queue || []).length }); } return out; })(),
  }, null, 1));
};
console.log('bestPx', bestPx, 'bestStep', bestStep, 'beam', beam.length, 'found', !!found);
dump(best, 'bestPx');
dump(bestStepState, 'bestStep');
