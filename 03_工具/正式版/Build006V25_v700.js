#!/usr/bin/env node
'use strict';

/**
 * E6.8R v24：开局可读性重做 + 多窗口
 *
 * 用户试玩 v23 反馈（2026-10-28）：
 *   “首行一堆黄色想表达什么，第二行全部冰封，逼着我拿黄色”
 *
 * v23 实测：首行 30 色 5/7，第2行 7/7 全封（5冰+2黑），第3行 4/7 封。
 *
 * 本版做三件事：
 *   1. 只交换车格颜色/容量，让首行 7 个入口变成 7 种不同颜色；
 *   2. 清空整行冰封，冰只留在“移除就会改变路线”的位置；
 *   3. 保留三组既有锁链，重跑全知看窗口。
 *
 * 用法：node 03_工具/正式版/Build006V25_v700.js [--ice=...]
 */

const fs = require('fs');
const path = require('path');
const B = require('./Build006Thickness_v688');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, '实验关/关卡6/原型_v24/关卡_实验_006_v24.json');
const OUT = path.join(ROOT, '实验关/关卡6/原型_v25');

// 只交换 id/count，type/param 留在格子上
const SWAPS = [];

const CHAINS = [
  { id: 2, cells: [[2, 5], [3, 5]] },
  { id: 3, cells: [[4, 1], [4, 2]] },
  { id: 4, cells: [[3, 2], [3, 3], [3, 4]] },
  { id: 5, cells: [[5, 4], [5, 5], [5, 6]] },
  { id: 6, cells: [[1, 3], [2, 3]] }
];

// 先不给冰，看纯棋盘重排后的自然窗口
const ICE = [];

function typeList(cell) {
  return Array.isArray(cell.type) ? cell.type.slice() : [cell.type || 0];
}
function paramList(cell) {
  return Array.isArray(cell.param) ? cell.param.slice() : [cell.param || 0];
}

function build() {
  const game = B.readJson(SRC);
  const sp = game.spools;
  for (const [a, b] of SWAPS) {
    const ca = sp[a[0]][a[1]];
    const cb = sp[b[0]][b[1]];
    const tmpId = ca.id, tmpCount = ca.count;
    ca.id = cb.id; ca.count = cb.count;
    cb.id = tmpId; cb.count = tmpCount;
  }
  // 清空冰与锁链，保留黑块/管道
  for (const row of sp) for (const cell of row) {
    const types = typeList(cell);
    if (types.indexOf(11) >= 0) continue;
    if (types.indexOf(5) >= 0 || types.indexOf(7) >= 0) {
      cell.type = 0;
      cell.param = 0;
    }
  }
  for (const g of CHAINS) {
    for (const [r, c] of g.cells) {
      const cell = sp[r][c];
      if (!cell || !(cell.id > 0)) throw new Error('链格不是车: ' + r + ',' + c);
      cell.type = 5;
      cell.param = g.id;
    }
  }
  for (const ice of ICE) {
    const cell = sp[ice.r][ice.c];
    const types = typeList(cell);
    if (types.indexOf(5) >= 0) {
      cell.type = [5, 7];
      cell.param = [cell.param, ice.steps];
    } else {
      cell.type = 7;
      cell.param = ice.steps;
    }
  }
  return game;
}

function chainEvents(A, level, picks, groups) {
  const st = A.Simulator.createState(level, { useSlotStart: true, instantChain: true });
  st.capture = true;
  const ev = {};
  groups.forEach(g => {
    ev[g.id] = { id: g.id, cells: g.cells, entered: false, entryStep: null, debt: false,
      maxDebt: 0, completed: false, released: false, releaseStep: null };
  });
  for (let i = 0; i < picks.length; i++) {
    st.capOps = [];
    if (!A.Simulator.applyPick(st, picks[i].r, picks[i].c)) continue;
    const last = st.lastPick || {};
    if (last.isChain && ev[last.chain] && !ev[last.chain].entered) {
      ev[last.chain].entered = true;
      ev[last.chain].entryStep = i + 1;
      ev[last.chain].link = st._linkSeq;
    }
    groups.forEach(g => {
      const e = ev[g.id];
      if (!e.entered) return;
      const items = (st.buffer || []).filter(it => it.link === e.link);
      if (items.length) {
        const debts = items.filter(it => (it.progress || 0) < (it.need || 0));
        if (debts.length) {
          e.debt = true;
          e.maxDebt = Math.max(e.maxDebt, ...debts.map(it => it.need - (it.progress || 0)));
        }
        if (items.every(it => (it.progress || 0) >= (it.need || 0))) e.completed = true;
      } else if (!e.released) {
        e.released = true;
        e.releaseStep = i + 1;
      }
    });
  }
  return ev;
}

function evaluateWith(A, extra) {
  const groups = CHAINS.concat(extra || []);
  const game = build();
  const sp = game.spools;
  // 追加组（extra）在 build 之后打链
  for (const g of (extra || [])) {
    for (const [r, c] of g.cells) {
      const cell = sp[r][c];
      if (!cell || !(cell.id > 0)) return null;
      cell.type = 5; cell.param = g.id;
    }
  }
  const level = A.parseLevel(A.fromGameFormat(game));
  const solve = A.Solver.solveInstantChain(level, { timeBudgetMs: 20000 });
  const picks = B.uniquePicks(solve);
  const history = solve.stepBufferHistory || [];
  const windows = B.pressureWindows(history, 3);
  const events = chainEvents(A, level, picks, groups);
  const allDebt = groups.every(g => events[g.id].debt && events[g.id].released && events[g.id].maxDebt >= 8);
  return { game, groups, picks, history, windows, events, allDebt,
    steps: picks.length, peak: solve.maxBuffer, solve };
}

function main() {
  const A = B.loadSolver();
  const game = build();
  const level = A.parseLevel(A.fromGameFormat(game));
  const solve = A.Solver.solveInstantChain(level, { timeBudgetMs: 20000 });
  const picks = B.uniquePicks(solve);
  const history = solve.stepBufferHistory || [];
  const windows = B.pressureWindows(history, 3);
  const events = chainEvents(A, level, picks, CHAINS);

  // 开局可读性
  const row0 = game.spools[0].map(c => c.id);
  const distinct = new Set(row0).size;
  const maxSame = Math.max(...Object.values(row0.reduce((acc, id) => {
    acc[id] = (acc[id] || 0) + 1; return acc;
  }, {})));
  const row1Blocked = game.spools[1].filter(c => !(c.id > 0) ||
    typeList(c).indexOf(7) >= 0).length;

  // 首取后果：每个首行入口单独取一次，看消耗/债务
  const opening = [];
  for (let c = 0; c < game.spools[0].length; c++) {
    const cell = game.spools[0][c];
    if (!(cell.id > 0)) continue;
    const st = A.Simulator.createState(level, { useSlotStart: true, instantChain: true });
    st.capture = true;
    st.capOps = [];
    const ok = A.Simulator.applyPick(st, 0, c);
    const buf = (st.buffer || []).length;
    opening.push({ c, key: cell.id + '/' + cell.count, ok, buffer: buf });
  }

  const result = {
    steps: picks.length,
    peak: solve.maxBuffer,
    windows,
    history,
    events,
    opening,
    row0,
    distinct,
    maxSame,
    row1Blocked
  };

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, '关卡_实验_006_v24.json'), JSON.stringify(game, null, 2));
  fs.writeFileSync(path.join(OUT, 'v25-metrics.json'), JSON.stringify(result, null, 2));

  console.log('steps=' + picks.length, 'peak=' + solve.maxBuffer,
    'windows=' + windows.length, JSON.stringify(windows.map(w => w.start + '-' + w.end + ':' + w.peak)));
  console.log('row0=' + row0.join(','), 'distinct=' + distinct, 'maxSame=' + maxSame, 'row1Blocked=' + row1Blocked + '/7');
  console.log('opening=' + opening.map(o => '(' + o.c + ')' + o.key + '->buf' + o.buffer).join(' '));
  console.log('groups=' + CHAINS.map(g => {
    const e = events[g.id];
    return g.id + (e.entered ? '@' + e.entryStep : '未进') + (e.debt ? '/债' + e.maxDebt : '/无债') + (e.releaseStep ? '/放' + e.releaseStep : '');
  }).join(' '));
}

function searchOneMore() {
  const A = B.loadSolver();
  const used = new Set();
  CHAINS.forEach(g => g.cells.forEach(([r, c]) => used.add(r + ',' + c)));
  const base = build();
  const sp = base.spools;
  const cands = [];
  for (let r = 0; r < sp.length; r++) {
    for (let c = 0; c < sp[r].length; c++) {
      const a = sp[r][c];
      if (!a || !(a.id > 0) || used.has(r + ',' + c)) continue;
      for (const [dr, dc] of [[0, 1], [1, 0]]) {
        const r2 = r + dr, c2 = c + dc;
        if (r2 >= sp.length || c2 >= sp[r].length) continue;
        const b = sp[r2][c2];
        if (!b || !(b.id > 0) || used.has(r2 + ',' + c2)) continue;
        cands.push([[r, c], [r2, c2]]);
      }
    }
  }
  const rows = [];
  for (const cells of cands) {
    const r = evaluateWith(A, [{ id: 7, cells }]);
    if (!r) continue;
    rows.push({ cells, windows: r.windows.length, peak: r.peak, steps: r.steps,
      allDebt: r.allDebt, w: r.windows.map(w => w.start + '-' + w.end + ':' + w.peak).join(' ') });
  }
  rows.sort((a, b) => (b.windows - a.windows) || (Number(b.allDebt) - Number(a.allDebt)) || (b.peak - a.peak));
  console.log('候选数=' + rows.length);
  rows.slice(0, 12).forEach(x => {
    console.log((x.cells[0].join(',') + '+' + x.cells[1].join(',')) + '  windows=' + x.windows +
      ' peak=' + x.peak + ' steps=' + x.steps + ' allDebt=' + x.allDebt + ' [' + x.w + ']');
  });
}

if (process.argv.includes('--search')) searchOneMore(); else main();
