#!/usr/bin/env node
/** v561：直接验证卡点 bigBox / inflate 不再越过用户容量上限。 */
'use strict';

const fs = require('fs'), path = require('path'), vm = require('vm'), cp = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const REL = '02_工程/完整主bin快照_20261012/bin/js';
const BIN = path.join(ROOT, REL);
const OLD = 'ed468cd';
const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js',
  'playersim.js', 'analysis.js', 'generator.js'];

function load(arm) {
  const sb = {
    console: { log() { }, warn() { }, error() { } }, module: { exports: {} },
    WeakMap, Map, Set, Date, Math, JSON, setTimeout, clearTimeout, Infinity
  };
  vm.createContext(sb);
  for (const f of FILES) {
    let source;
    if (arm === 'old' && (f === 'utils.js' || f === 'generator.js')) {
      source = cp.execFileSync('git', ['show', OLD + ':' + REL + '/' + f], {
        cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024
      });
    } else {
      source = fs.readFileSync(path.join(BIN, f), 'utf8');
    }
    if (f === 'generator.js') {
      const beforeSpread = '  /**\n   * 增容（卡点类型 `inflate`）';
      const beforeApply = '  // 卡点分派：按本关抽中的类型决定用哪个手段';
      if (source.indexOf(beforeSpread) < 0 || source.indexOf(beforeApply) < 0) {
        throw new Error('无法注入容量测试钩子');
      }
      source = source.replace(beforeSpread,
        '  AntSolver.__testChokeInflate = chokeInflate;\n' + beforeSpread);
      source = source.replace(beforeApply,
        '  AntSolver.__testChokeInflateSpread = chokeInflateSpread;\n\n' + beforeApply);
    }
    vm.runInContext(source, sb, { filename: arm + '/' + f });
  }
  return sb.AntSolver;
}

function boxes(board) {
  const out = [];
  for (const row of board.cells) {
    for (const cell of row) if (cell && cell.t === 'box') out.push(cell);
  }
  return out;
}

function makeBoard() {
  return {
    rows: 1,
    cols: 5,
    cells: [[
      { t: 'box', color: 5, count: 18, chain: 0, q: null },
      { t: 'box', color: 5, count: 18, chain: 0, q: null },
      { t: 'box', color: 5, count: 16, chain: 0, q: null },
      { t: 'box', color: 5, count: 18, chain: 0, q: null },
      { t: 'box', color: 5, count: 13, chain: 0, q: null }
    ]]
  };
}

function runCase(A, kind) {
  const board = makeBoard();
  const targets = board.cells[0].map(function(cell, c) { return { r: 0, c: c, count: cell.count, color: cell.color }; });
  const cfg = {
    boxSizeMin: 13,
    boxSizeMax: 19,
    _userCapMin: 13,
    _userCapMax: 19,
    bigBoxCapMin: 80,
    bigBoxCapMax: 80,
    inflateBoxCount: 1,
    inflateAmount: 15
  };
  const blocks = [Array.from({ length: 83 }, function() { return 5; })];
  let applied = false;
  if (kind === 'bigBox') applied = A.__testChokeInflate(board, targets, cfg, blocks);
  else applied = A.__testChokeInflateSpread(board, targets, cfg);
  const list = boxes(board);
  const counts = list.map(function(x) { return x.count; });
  const evidence = A.Quality.capacityEvidence({ blocks: blocks, bufferLimit: 5, board: board }, cfg);
  return {
    kind: kind,
    applied: !!applied,
    counts: counts,
    sum: counts.reduce(function(a, b) { return a + b; }, 0),
    min: Math.min.apply(null, counts),
    max: Math.max.apply(null, counts),
    above19: counts.filter(function(x) { return x > 19; }),
    perColorConserved: evidence.perColorConserved,
    colorMismatches: evidence.colorMismatches,
    diagnostic: kind === 'bigBox' ? board._chokeBigBox || null : board._chokeInflate || null
  };
}

const oldA = load('old');
const newA = load('new');
const oldBig = runCase(oldA, 'bigBox');
const oldSpread = runCase(oldA, 'spread');
const newBig = runCase(newA, 'bigBox');
const newSpread = runCase(newA, 'spread');
const report = {
  schema: 'capacity-choke-fix-test-v561',
  date: '2026-10-26',
  oldCommit: OLD,
  cases: {
    oldBig: oldBig,
    oldSpread: oldSpread,
    newBig: newBig,
    newSpread: newSpread
  },
  checks: {
    oldBigReproduced: oldBig.above19.length > 0,
    oldSpreadReproduced: oldSpread.above19.length > 0,
    newBigWithinCap: newBig.above19.length === 0 && newBig.max <= 19,
    newSpreadWithinCap: newSpread.above19.length === 0 && newSpread.max <= 19,
    newBigConserved: newBig.sum === 83,
    newSpreadConserved: newSpread.sum === 83,
    newBigPerColorConserved: newBig.perColorConserved === true,
    newSpreadPerColorConserved: newSpread.perColorConserved === true
  }
};
report.pass = Object.keys(report.checks).every(function(k) { return report.checks[k] === true; });
fs.writeFileSync(path.join(__dirname, '容量越界修复测试_v561.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (!report.pass) process.exitCode = 1;
