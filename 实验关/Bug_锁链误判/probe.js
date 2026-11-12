#!/usr/bin/env node
'use strict';
// 探针：确认关卡加载、链组 2 位置、初始可点，并跑少量随机局看链组 2 何时变可点。
const path = require('path');
const { loadSolver, readJson } = require(path.resolve(__dirname, '../../03_工具/正式版/Build006Thickness_v688.js'));

const LEVEL = '/Users/red/Desktop/ParkPassenger.app/Contents/Resources/bin/G3_bq_level_2.json';
const A = loadSolver('corner');
const game = readJson(LEVEL);
const level = A.parseLevel(A.fromGameFormat(game));

console.log('rows', level.rows, 'cols', level.cols, 'bufferLimit', level.bufferLimit,
  'totalPixels', level.totalPixels, 'totalBoxes', level.totalBoxes);
const s0 = A.Simulator.createState(level, { useSlotStart: true, instantChain: false });
console.log('board', s0.boardRows, 'x', s0.boardCols);
console.log('chainGroups', JSON.stringify(s0.chainGroups));
function dumpBoard(s) {
  const lines = [];
  for (let r = 0; r < s.boardRows; r++) {
    const cells = [];
    for (let c = 0; c < s.boardCols; c++) {
      const cell = s.cells[r][c];
      if (!cell) cells.push('  .   ');
      else if (cell.t === 'pipe') cells.push('PIPE  ');
      else if (cell.t === 'black') cells.push('BLACK ');
      else cells.push(String(cell.color).padStart(2) + '/' + String(cell.count).padStart(2) +
        (cell.chain ? 'c' + cell.chain : '  ') + (cell.numice ? 'i' + cell.numice : ''));
    }
    lines.push(String(r).padStart(2) + ' ' + cells.join(' | '));
  }
  return lines.join('\n');
}
console.log(dumpBoard(s0));
function moves(s) { return A.Simulator.listMoves(s).filter(m => !m.blocked); }
console.log('initial moves', moves(s0).map(m => `${m.r},${m.c}:${m.antBox.color}/${m.antBox.count}${m.groupSize > 1 ? ' grp' + m.groupSize : ''}`).join(' '));
const g2 = s0.chainGroups.find(g => g.some(m => m.r === 4 && m.c === 6));
console.log('group2', JSON.stringify(g2), 'cells', g2.map(m => s0.cells[m.r][m.c].color + '/' + s0.cells[m.r][m.c].count));

function lcg(seed) {
  let v = seed >>> 0;
  return () => { v = (Math.imul(v, 1664525) + 1013904223) >>> 0; return v / 4294967296; };
}
let pickableGames = 0, totalGames = 0;
for (let seed = 1; seed <= 300; seed++) {
  const rnd = lcg(seed);
  const s = A.Simulator.createState(level, { useSlotStart: true, instantChain: false });
  let sawPickable = false;
  for (let step = 0; step < 80; step++) {
    const ms = moves(s);
    if (!ms.length) break;
    if (ms.some(m => m.r === 4 && m.c === 6)) sawPickable = true;
    const m = ms[Math.floor(rnd() * ms.length)];
    A.Simulator.applyPick(s, m.r, m.c);
    if (s.gameOver || s.overflow) break;
  }
  totalGames++;
  if (sawPickable) pickableGames++;
}
console.log('random probe:', totalGames, 'games, group2 pickable in', pickableGames);
