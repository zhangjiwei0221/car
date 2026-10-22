#!/usr/bin/env node
/**
 * 决策表 —— 把一关的每一步拆开：能点哪些车 / 每辆车吃什么 / 吃完露出什么 / 开什么新车辆
 *
 *   node 决策表.js <关卡json> [--steps 12] [--json]
 *
 * 只读：不改生产代码、不动版本号。
 *
 * 口径（与 PlayerSim 一致）：
 *   · 目标图可达量 = floodFillCount(已消格, 图, 色) —— 即"这个颜色现在还能被吃多少像素"
 *   · 吃了哪些像素 = applyPick 前后 eliminated 矩阵的差
 *   · 新露出什么颜色 = applyPick 前后「各色可达量」的增量（正数=这步之后多出来的料）
 *   · 新开哪些车     = applyPick 前后 activated 集合的差
 *   · 吃不完（溢出） = 车容量 − 实际吃掉的像素数，这部分压在暂存里
 *
 * 输出判据：
 *   nEatFull  = 能吃满的车数（C ≤ R）—— 真正的"好选择"
 *   nOverflow = 会占槽的车数（C > R）—— 陷阱
 *   nEatFull = 0 → 这一步没有好选择，必挨坑
 *   nEatFull = 1 → 独木桥（唯一正确解）
 */
'use strict';
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const BASE = path.join(__dirname, '..', '..', '02_工程', '完整主bin快照_20261012');
const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js', 'playersim.js', 'analysis.js', 'generator.js'];
const sandbox = {
  console: { log() {}, warn() {}, error() {} },
  module: { exports: {} }, WeakMap, Map, Set, setTimeout, clearTimeout, Infinity, Math, JSON, Date,
};
vm.createContext(sandbox);
for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BASE, 'bin/js', f), 'utf8'), sandbox, { filename: f });
const A = sandbox.AntSolver, S = A.Simulator;

const NAM = { 4: "暗粉", 5: "浅粉", 13: "天蓝", 14: "浅蓝", 15: "深棕", 17: "灰蓝", 21: "橄榄", 22: "青蓝", 28: "橙", 30: "棕", 31: "浅灰", 33: "深灰", 34: "中灰" };
const nm = c => NAM[c] || '';

// ---------- 参数 ----------
const argv = process.argv.slice(2);
const file = argv[0];
if (!file) { console.error('用法：node 决策表.js <关卡json> [--steps 12] [--json]'); process.exit(1); }
const si = argv.indexOf('--steps');
const MAX_STEPS = si > 0 ? (parseInt(argv[si + 1], 10) || 12) : 12;
const AS_JSON = argv.includes('--json');

const lv = JSON.parse(fs.readFileSync(file, 'utf8'));
const level = { blocks: lv.blocks, bufferLimit: lv.bufferLimit || 5, board: lv.board };
const parsed = A.parseLevel(JSON.parse(JSON.stringify(level)));

// ---------- 工具 ----------
/**
 * 试算用的状态：从初始态重新 createState，再把历史点击重放一遍。
 * ⚠ 不能手写 cloneState —— applyPick 依赖 chainGroups / slotUsed 等一堆 createState 才建的内部字段，
 *   手抄字段会漏，漏了的表现就是"消像素=0 / 新露出为空"（踩过一次）。
 */
function replay(picks) {
  const st = S.createState(parsed);
  S.updateActivation(st);
  for (const p of picks) {
    try { S.applyPick(st, p.r, p.c); S.updateActivation(st); } catch (e) { }
  }
  return st;
}

/** 各色当前可达像素数（= 该色还能被吃多少） */
function reachMap(s) {
  const alive = {};
  for (let r = 0; r < s.rows; r++) for (let c = 0; c < s.cols; c++) {
    const v = s.blocks[r][c];
    if (v > 0 && !s.eliminated[r][c]) alive[v] = 1;
  }
  const out = {};
  for (const col of Object.keys(alive)) {
    let n = 0;
    try {
      // ⚠ floodFillCount 会就地修改传入的 eliminated 矩阵，必须传副本，
      //   否则算完一个颜色就把状态搞脏了（踩过：一算"新露出"，前面算过的颜色全成 0）
      const scratch = JSON.parse(JSON.stringify(s.eliminated));
      n = S.floodFillCount(scratch, s.blocks, s.rows, s.cols, parseInt(col, 10), s.bottomOnly);
    } catch (e) { n = 0; }
    out[col] = n;
  }
  return out;
}

function activatedMap(s) {
  const out = {};
  for (let r = 0; r < s.boardRows; r++) for (let c = 0; c < s.boardCols; c++) {
    const x = s.cells[r][c];
    if (x && x.t === 'box' && s.activated[r + ',' + c]) out[r + ',' + c] = x.color;
  }
  return out;
}

// ---------- 主流程 ----------
const history = [];
const s = replay(history);

const report = { file: path.basename(file), bufferLimit: level.bufferLimit, board: `${lv.board.rows}×${lv.board.cols}`, steps: [] };

if (!AS_JSON) {
  console.log('='.repeat(108));
  console.log(`决策表  ${report.file}   棋盘 ${report.board}   暂存上限 ${report.bufferLimit}`);
  console.log('='.repeat(108));
}

// 用来选"走哪一步"的参考线
const ref = A.PlayerSim.run(A.parseLevel(JSON.parse(JSON.stringify(level))), { seed: 7, useItems: false, reviveCap: 0 });
const refPicks = ref.pickOrder.map(p => ({ r: p.r, c: p.c, color: p.color }));

for (let step = 0; step < MAX_STEPS; step++) {
  const moves = S.listMoves(s);
  if (!moves.length) {
    if (!AS_JSON) console.log(`\n【第 ${step + 1} 步】没有可点的车 → 死局`);
    report.steps.push({ step: step + 1, dead: true });
    break;
  }
  const reach = reachMap(s);
  const actBefore = activatedMap(s);
  const bufBefore = (s.buffer || []).length;

  const rows = [];
  for (const mv of moves) {
    const cell = s.cells[mv.r][mv.c];
    const C = cell.count;
    const R = reach[cell.color] || 0;
    const eat = Math.min(C, R);
    const overflow = C - eat;

    // 试算：吃这一步之后目标图 / 棋盘的变化
    let opened = [], newly = {}, elimPx = 0, bufAfter = bufBefore;
    try {
      const cs = replay(history);
      const beforeReach = reachMap(cs);
      const beforeAct = activatedMap(cs);
      const beforeElim = cs.eliminatedPixels;
      S.applyPick(cs, mv.r, mv.c);
      S.updateActivation(cs);
      elimPx = cs.eliminatedPixels - beforeElim;
      const afterReach = reachMap(cs);
      const afterAct = activatedMap(cs);
      for (const k in afterReach) {
        const d = afterReach[k] - (beforeReach[k] || 0);
        if (d > 0) newly[k] = d;
      }
      for (const k in afterAct) if (beforeAct[k] == null) opened.push(afterAct[k]);
      bufAfter = (cs.buffer || []).length;
    } catch (e) { /* 试算失败就留空 */ }

    rows.push({
      r: mv.r, c: mv.c, color: cell.color, C, R, eat, overflow,
      chain: cell.chain || 0, numice: cell.numice || 0,
      elimPx, newly, opened, bufAfter,
    });
  }

  const nFull = rows.filter(x => x.overflow === 0).length;
  const nOver = rows.filter(x => x.overflow > 0).length;

  if (!AS_JSON) {
    console.log(`\n【第 ${step + 1} 步】暂存 ${bufBefore}/${level.bufferLimit}   可点 ${moves.length} 辆   能吃满 ${nFull} 辆   会占槽 ${nOver} 辆${nFull === 0 ? '   ⚠ 无好选择' : (nFull === 1 ? '   ← 独木桥' : '')}`);
    console.log('  车辆     | 色        | 容量 | 该色可达 | 吃掉 | 溢出 | 消像素 | 吃完新露出的颜色      | 新开的车        | 暂存后');
    console.log('  ---------+-----------+------+----------+------+------+--------+-----------------------+-----------------+-------');
    for (const x of rows) {
      const newlyStr = Object.keys(x.newly).length
        ? Object.entries(x.newly).map(([c, n]) => `${c}${nm(c)}+${n}`).join(' ') : '-';
      const openedStr = x.opened.length ? x.opened.slice(0, 6).map(c => c + nm(c)).join(' ') + (x.opened.length > 6 ? '…' : '') : '-';
      const flag = x.overflow === 0 ? '✓' : ' ';
      console.log(`  ${flag}(${x.r},${x.c})${x.chain ? '链' : (x.numice ? '冰' + x.numice : '  ')} | ${String(x.color).padStart(2)} ${nm(x.color).padEnd(3)} | ${String(x.C).padStart(4)} | ${String(x.R).padStart(8)} | ${String(x.eat).padStart(4)} | ${String(x.overflow).padStart(4)} | ${String(x.elimPx).padStart(6)} | ${newlyStr.padEnd(21)} | ${openedStr.padEnd(15)} | ${x.bufAfter}`);
    }
  }

  report.steps.push({ step: step + 1, buffer: bufBefore, nClick: moves.length, nEatFull: nFull, nOverflow: nOver, options: rows });

  // 走一步（沿 PlayerSim 的路线）
  const pick = refPicks[step];
  if (!pick) break;
  S.applyPick(s, pick.r, pick.c);
  S.updateActivation(s);
  history.push({ r: pick.r, c: pick.c });
  if (!AS_JSON) {
    const chosen = rows.find(x => x.r === pick.r && x.c === pick.c);
    console.log(`  → 玩家点了 (${pick.r},${pick.c}) 色${pick.color}${nm(pick.color)}${chosen ? (chosen.overflow === 0 ? '  [吃得满]' : `  [溢出 ${chosen.overflow}]`) : ''}`);
  }
}

if (!AS_JSON) {
  // 总结
  const st = report.steps;
  const dead = st.find(x => x.dead);
  const firstBad = st.find(x => x.nEatFull === 0);
  const firstBridge = st.find(x => x.nEatFull === 1);
  console.log('\n' + '='.repeat(108));
  console.log('诊断');
  console.log('='.repeat(108));
  console.log(`  步数 ${st.length}   最紧的一步 ${firstBad ? '第 ' + firstBad.step + ' 步（无好选择）' : (firstBridge ? '第 ' + firstBridge.step + ' 步（独木桥）' : '未出现')}`);
  const curve = st.filter(x => !x.dead).map(x => x.nEatFull);
  console.log(`  可吃满车数曲线: ${curve.join(' → ')}`);
  if (dead) console.log(`  死局出现在第 ${dead.step} 步`);
  console.log(`  玩家线: ${ref.won || ref.success ? '通关' : '失败'} ${ref.progress}%  峰 ${ref.bufferPeak}`);
} else {
  console.log(JSON.stringify(report, null, 1));
}
