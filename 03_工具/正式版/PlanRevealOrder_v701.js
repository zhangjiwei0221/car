#!/usr/bin/env node
'use strict';

/**
 * E6.8R 区域揭示顺序规划器 v1（只读）
 *
 * 目的：回答“某个三连应该在什么时机进入，才会欠债但 3～5 步内能释放”。
 *
 * 方法：
 *   1. 用 v24 的全知路线回放，得到每一步的棋盘状态；
 *   2. 对每个候选同色相邻组，计算它在第 s 步“进入时可用率”
 *      = 当前该色还能消掉多少像素 / 组内总容量；
 *   3. 只保留 40%～70% 的时机（欠债 30%～60%），并估算释放步
 *      （该色可用像素首次 ≥ 组容量）。
 *
 * 用法：node 03_工具/正式版/PlanRevealOrder_v701.js
 */

const fs = require('fs');
const path = require('path');
const B = require('./Build006Thickness_v688');

const ROOT = path.resolve(__dirname, '..', '..');
const LEVEL = path.join(ROOT, '实验关/关卡6/原型_v24/关卡_实验_006_v24.json');
const OUT = path.join(ROOT, '实验关/关卡6/原型_v25');

function isCar(cell) {
  if (!cell || !(cell.id > 0)) return false;
  const t = Array.isArray(cell.type) ? cell.type : [cell.type || 0];
  return t.indexOf(11) < 0;
}

function candidates(sp) {
  const out = [];
  const seen = new Set();
  const push = cells => {
    const key = cells.map(c => c.join(',')).sort().join('|');
    if (seen.has(key)) return;
    seen.add(key);
    const color = sp[cells[0][0]][cells[0][1]].id;
    const cap = cells.reduce((a, [r, c]) => a + sp[r][c].count, 0);
    out.push({ cells, color, cap });
  };
  for (let r = 0; r < sp.length; r++) {
    for (let c = 0; c < sp[r].length; c++) {
      if (!isCar(sp[r][c])) continue;
      const color = sp[r][c].id;
      if (c + 1 < sp[r].length && isCar(sp[r][c + 1]) && sp[r][c + 1].id === color) {
        push([[r, c], [r, c + 1]]);
        if (c + 2 < sp[r].length && isCar(sp[r][c + 2]) && sp[r][c + 2].id === color) {
          push([[r, c], [r, c + 1], [r, c + 2]]);
        }
      }
      if (r + 1 < sp.length && isCar(sp[r + 1][c]) && sp[r + 1][c].id === color) {
        push([[r, c], [r + 1, c]]);
        if (r + 2 < sp.length && isCar(sp[r + 2][c]) && sp[r + 2][c].id === color) {
          push([[r, c], [r + 1, c], [r + 2, c]]);
        }
      }
    }
  }
  return out;
}

function stateAt(A, level, picks, s) {
  const st = A.Simulator.createState(level, { useSlotStart: true, instantChain: true });
  st.capture = true;
  for (let i = 0; i < s; i++) {
    st.capOps = [];
    A.Simulator.applyPick(st, picks[i].r, picks[i].c);
  }
  return st;
}

function consumeIfPicked(A, level, picks, s, r, c) {
  const st = stateAt(A, level, picks, s);
  st.capture = true;
  st.capOps = [];
  const ok = A.Simulator.applyPick(st, r, c);
  if (!ok) return null;
  let eaten = 0;
  for (const op of st.capOps || []) if (op.t === 'eat') eaten += (op.cells ? op.cells.length : 0);
  return eaten;
}

function main() {
  const A = B.loadSolver();
  const game = B.readJson(LEVEL);
  const level = A.parseLevel(A.fromGameFormat(game));
  const solve = A.Solver.solveInstantChain(level, { timeBudgetMs: 20000 });
  const picks = B.uniquePicks(solve);
  console.log('route steps=' + picks.length + ' peak=' + solve.maxBuffer);

  const sp = game.spools;
  const cands = candidates(sp);
  const colors = Array.from(new Set(cands.map(c => c.color)));

  // 每步每色可用像素
  const avail = {};
  for (let s = 0; s <= picks.length; s++) {
    const st = stateAt(A, level, picks, s);
    const moves = A.Simulator.listMoves(st).filter(m => !m.blocked);
    avail[s] = {};
    for (const color of colors) {
      let sum = 0;
      for (const m of moves) {
        if (m.antBox.color !== color) continue;
        const eaten = consumeIfPicked(A, level, picks, s, m.r, m.c);
        if (eaten) sum += eaten;
      }
      avail[s][color] = sum;
    }
  }

  const rows = [];
  for (const cand of cands) {
    const series = [];
    for (let s = 0; s <= picks.length; s++) {
      const a = avail[s][cand.color] || 0;
      series.push({ s, avail: a, ratio: cand.cap ? a / cand.cap : 0 });
    }
    const sweet = series.filter(x => x.ratio >= 0.4 && x.ratio <= 0.7);
    const release = series.find(x => x.avail >= cand.cap);
    rows.push({
      cells: cand.cells.map(c => c.join(',')),
      color: cand.color, cap: cand.cap,
      sweetSteps: sweet.map(x => x.s),
      ratios: sweet.map(x => Number(x.ratio.toFixed(2))),
      releaseStep: release ? release.s : null
    });
  }

  rows.sort((a, b) => (b.sweetSteps.length - a.sweetSteps.length) || (a.color - b.color));
  console.log('\n候选组（进入时可用率 40%～70% 的步数）:');
  for (const r of rows.slice(0, 20)) {
    console.log(`${r.cells.join('+')} 色${r.color} 容量${r.cap}  ` +
      `甜区步=[${r.sweetSteps.join(',')}] 比率=[${r.ratios.join(',')}]  ` +
      `可用≥容量首步=${r.releaseStep}`);
  }

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'reveal-order-plan.json'), JSON.stringify({
    level: LEVEL, steps: picks.length, peak: solve.maxBuffer,
    candidates: rows, avail
  }, null, 2));
  console.log('\nwritten=' + path.join(OUT, 'reveal-order-plan.json'));
}

main();
