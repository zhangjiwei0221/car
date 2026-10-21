#!/usr/bin/env node
/**
 * 死因分析：把"玩家线在这关会死"拆成"主要死在哪个障碍上"。
 *
 *   node 死因分析.js <关卡json> [--runs 16]
 *
 * 判定依据（playersim 的 v323 埋点 s.lastBlocked）：
 *   死前最后一次"想点但放不下"的格子 + 那格是不是锁链组 + 差几个槽。
 *
 *   链   ：卡在锁链组（need ≥ 2，一次要 n 个空槽）
 *   冰   ：卡住的格 / 场上能点的格被数字冰锁着
 *   管道 ：卡住的格在管道口（或唯一通路要经过管道）
 *   形状 ：没有可点的格（被墙/其它盒堵死）
 *   断供 ：某色场上已无可达像素
 *
 * 只读：不写 输出文件/，不改生产代码。
 */
'use strict';
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const BASE = path.join(__dirname, '..', '..', '02_工程', '完整主bin快照_20261012');
const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js', 'playersim.js', 'analysis.js', 'generator.js'];
const sandbox = { console: { log() {}, warn() {}, error() {} }, module: { exports: {} }, WeakMap, Map, Set, setTimeout, clearTimeout, Infinity, Math, JSON, Date };
vm.createContext(sandbox);
for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BASE, 'bin/js', f), 'utf8'), sandbox, { filename: f });
const A = sandbox.AntSolver;

const file = process.argv[2];
if (!file) { console.error('用法：node 死因分析.js <关卡json> [--runs 16]'); process.exit(1); }
let runs = 16;
const ri = process.argv.indexOf('--runs');
if (ri > 0) runs = parseInt(process.argv[ri + 1], 10) || 16;

const j = JSON.parse(fs.readFileSync(file, 'utf8'));
const level = { blocks: j.blocks, bufferLimit: j.bufferLimit, board: j.board };
const parsed = A.parseLevel(level);

// 棋盘上一格是不是管道口 / 有没有冰
function cellAt(r, c) { const row = j.board.cells[r]; return row ? row[c] : null; }
function isPipeMouth(r, c) {
  const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  for (const d of dirs) {
    const x = cellAt(r + d[0], c + d[1]);
    if (x && x.t === 'pipe') return true;
  }
  return false;
}

const tally = { 链: 0, 冰: 0, 管道: 0, 形状: 0, 断供: 0, 通关: 0, 其它: 0 };
const detail = [];
for (let k = 0; k < runs; k++) {
  // 【口径】先跑"不给复活"的严格局（reviveCap=0）：这才是真死；
  //   再跑带复活的（reviveCap=2）：用掉复活也算"濒死"，单独计。
  const r = A.PlayerSim.run(parsed, { seed: 7 + k * 13, useItems: false, capturePreviewStats: true, reviveCap: 0 });
  const r2 = A.PlayerSim.run(parsed, { seed: 7 + k * 13, useItems: false, capturePreviewStats: true, reviveCap: 2 });
  if (r.won || r.success) { tally.通关++; continue; }
  const rev = (r2.reviveEvents || []).length;
  if (rev) tally['濒死(靠复活)'] = (tally['濒死(靠复活)'] || 0) + 1;
  const lb = r.lastRefuse || r.lastBlocked;
  const ds = r.deathSnapshot;
  let cause = '其它';
  if (ds && ds.chainMax && ds.chainMax > ds.free) {
    // 【主因】场上还留着一组 n 连锁链，而空槽不足 n 个 → 这组永远拿不进来，整关卡死。
    cause = '链卡死(' + ds.chainMax + '连>空' + ds.free + ')';
  } else if (ds && ds.free === 0) {
    // 满仓卡死：手里满了、且没有任何能消的车。看场上还剩什么障碍来归因。
    const L = ds.left || {};
    cause = L.chain > 0 ? '满仓·链在场' : (L.ice > 0 ? '满仓·冰在场' : (L.pipe > 0 ? '满仓·管道在场' : '满仓·断供'));
  } else if (lb) {
    if (lb.reason === 'noMoves') cause = '形状';
    else if (lb.reason === 'highPressure') cause = '高压拒取';
    else if (lb.isChainGroup || (lb.need || 1) > 1) cause = '链';
    else if (isPipeMouth(lb.r, lb.c)) cause = '管道';
    else {
      const cell = cellAt(lb.r, lb.c);
      if (cell && (cell.numice || 0) > 0) cause = '冰';
      else if (lb.free === 0) cause = '形状';
      else cause = '其它';
    }
  } else cause = '形状';
  tally[cause] = (tally[cause] || 0) + 1;
  detail.push({ run: k, cause, step: (lb && lb.step) || (ds && ds.step), at: lb && (lb.r + ',' + lb.c), need: lb && lb.need, free: lb && lb.free, color: lb && lb.color, snap: ds });
}

console.log('关卡：' + path.basename(file) + '　盘 ' + j.board.rows + '×' + j.board.cols + '　暂存上限 ' + j.bufferLimit);
console.log('跑 ' + runs + ' 局：');
for (const k of ['通关', '濒死(靠复活)', '满仓·链在场', '满仓·冰在场', '满仓·管道在场', '满仓·断供', '链', '冰', '管道', '形状', '高压拒取', '其它']) {
  if (!tally[k]) continue;
  console.log('  ' + k + '　' + tally[k] + ' 局　' + Math.round(tally[k] / runs * 100) + '%');
}
const fails = detail.slice(0, 8);
if (fails.length) {
  console.log('死法样本（前 8 局）：');
  for (const f of fails) {
    const sn = f.snap || {};
    const buf = (sn.buffer || []).map(function (b) { return b.color + ':' + b.rem; }).join(' ');
    console.log('  第' + f.run + '局　' + f.cause + '　第' + f.step + '步　手里[' + buf + ']　场上剩 链' +
      ((sn.left && sn.left.chain) || 0) + ' 冰' + ((sn.left && sn.left.ice) || 0) + ' 管' + ((sn.left && sn.left.pipe) || 0));
  }
}
