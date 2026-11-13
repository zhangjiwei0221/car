#!/usr/bin/env node
'use strict';
/**
 * 独立验收：重新从磁盘读取每个 BUG_<n>_G3-2.json，按 验证记录.json 里的预热顺序点击，
 * 再点 (4,6)，核对 bufEnter / bufAfter / 未判死 / 守恒。
 * 只读交付文件，不修改任何东西。
 */
const fs = require('fs');
const path = require('path');
const { loadSolver } = require(path.resolve(__dirname, '../../../03_工具/正式版/Build006Thickness_v688.js'));

const DIR = __dirname;
const A = loadSolver('corner');
const rec = JSON.parse(fs.readFileSync(path.join(DIR, '验证记录.json'), 'utf8'));

function cloneState(s) {
  return {
    level: s.level, useSlotStart: s.useSlotStart, bottomOnly: s.bottomOnly, instantChain: s.instantChain,
    rows: s.rows, cols: s.cols, blocks: s.blocks,
    eliminated: s.eliminated.map(row => row.slice()),
    totalPixels: s.totalPixels, eliminatedPixels: s.eliminatedPixels, bufferLimit: s.bufferLimit,
    buffer: s.buffer.map(it => Object.assign({}, it)),
    boardRows: s.boardRows, boardCols: s.boardCols,
    cells: s.cells.map(row => row.map(cell => (cell ? Object.assign({}, cell) : null))),
    activated: Object.assign({}, s.activated), removed: Object.assign({}, s.removed),
    numice: JSON.parse(JSON.stringify(s.numice)), chainGroups: s.chainGroups,
    pressureSamples: [], capturePreviewStats: false, steps: s.steps, totalBoxes: s.totalBoxes,
    completedBoxes: s.completedBoxes, _linkSeq: s._linkSeq, _keySeq: s._keySeq,
    capture: false, capOps: null, history: [],
    gameOver: s.gameOver, gameWon: s.gameWon, overflow: s.overflow,
    resSum: s.resSum, resCount: s.resCount, lastPick: s.lastPick, _enterPeak: s._enterPeak
  };
}
function conservation(game) {
  const lvl = A.parseLevel(A.fromGameFormat(game));
  const remain = {}, sum = {};
  for (let r = 0; r < lvl.rows; r++) for (let c = 0; c < lvl.cols; c++) { const id = lvl.blocks[r][c]; if (id > 0) remain[id] = (remain[id] || 0) + 1; }
  for (let r = 0; r < lvl.board.rows; r++) for (let c = 0; c < lvl.board.cols; c++) {
    const cell = lvl.board.cells[r][c]; if (!cell) continue;
    if (cell.t === 'box') sum[cell.color] = (sum[cell.color] || 0) + (cell.count || 0);
    else if (cell.t === 'pipe') for (const b of cell.queue || []) sum[b.color] = (sum[b.color] || 0) + (b.count || 0);
  }
  const colors = new Set(Object.keys(remain).concat(Object.keys(sum)));
  const bad = [];
  for (const k of colors) if ((remain[k] || 0) !== (sum[k] || 0)) bad.push({ color: Number(k), pixels: remain[k] || 0, boxes: sum[k] || 0 });
  return { ok: bad.length === 0, bad };
}

let allOk = true;
for (const v of rec.entries) {
  const file = path.join(DIR, v.file);
  const game = JSON.parse(fs.readFileSync(file, 'utf8'));
  const cons = conservation(game);
  const lvl = A.parseLevel(A.fromGameFormat(game));
  const s = A.Simulator.createState(lvl, { useSlotStart: true, instantChain: false });
  const logs = [];
  let ok = true;
  for (const p of v.preheatClickOrder) {
    if (!A.Simulator.applyPick(s, p.row, p.col)) { ok = false; logs.push(`not pickable ${p.row},${p.col}`); break; }
    logs.push(s.buffer.length);
    if (s.overflow || s.gameOver) { ok = false; logs.push('dead during preheat'); break; }
  }
  const buf3 = s.buffer.length === 3;
  const mv = A.Simulator.listMoves(s);
  const m46 = mv.find(m => m.r === 4 && m.c === 6), m56 = mv.find(m => m.r === 5 && m.c === 6);
  const chainReady = !!(m46 && !m46.blocked && m56 && !m56.blocked);
  const cl = cloneState(s);
  let trig = null;
  if (ok && buf3 && chainReady) {
    A.Simulator.applyPick(cl, 4, 6);
    trig = { bufEnter: cl.lastPick.bufEnter, bufAfter: cl.lastPick.bufAfter, overflow: !!cl.overflow, gameOver: !!cl.gameOver, deadEnd: A.Simulator.isDeadEnd(cl) };
  }
  const pass = ok && buf3 && chainReady && trig && trig.bufEnter === 5 && trig.bufAfter <= 4 && !trig.overflow && !trig.gameOver && !trig.deadEnd && cons.ok;
  if (!pass) allOk = false;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${v.file} source#${v.sourceSequence} preheatBuf=[${logs.join(',')}] chainReady=${chainReady} ` +
    `enter=${trig && trig.bufEnter} after=${trig && trig.bufAfter} dead=${trig && trig.deadEnd} cons=${cons.ok}` +
    (!cons.ok ? ' ' + JSON.stringify(cons.bad) : ''));
}
console.log(allOk ? '\nALL PASS' : '\nSOME FAILED');
process.exit(allOk ? 0 : 1);
