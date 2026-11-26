#!/usr/bin/env node
'use strict';

/**
 * E6.8R v22 多窗口搜索器（全知优先）
 *
 * 输入：原型_v21 的关卡（含目标 blocks 与 spools）
 * 输出：在“不改车格容量、只改障碍层”的约束下，
 *       找到窗口数最多、峰值不触 5 的链组/冰组合，写成 原型_v22。
 *
 * 用法：
 *   node 03_工具/正式版/Search006MultiWindow_v696.js --probe        # 只评估 v21 基线
 *   node 03_工具/正式版/Search006MultiWindow_v696.js --search       # 贪心搜索
 *   node 03_工具/正式版/Search006MultiWindow_v696.js --write        # 落盘最优变体
 */

const fs = require('fs');
const path = require('path');
const B = require('./Build006Thickness_v688');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, '实验关/关卡6/原型_v21/关卡_实验_006_v21.json');
const OUT = path.join(ROOT, '实验关/关卡6/原型_v22');

const BASE_GROUPS = [
  { id: 2, cells: [[2, 5], [3, 5]], role: '中段5色组（v21保留）' },
  { id: 3, cells: [[4, 1], [4, 2]], role: '中段15色组（v21保留）' }
];

function load() {
  const A = B.loadSolver();
  const game = B.readJson(SRC);
  return { A, game };
}

function isCar(spool) {
  if (!spool) return false;
  const types = Array.isArray(spool.type) ? spool.type : [spool.type || 0];
  const carLike = types.every(t => t !== 11) && spool.id > 0;
  return carLike;
}

/** 枚举同色相邻可成链的候选（2 连或 3 连，同行/同列连续） */
function candidates(game) {
  const sp = game.spools;
  const rows = sp.length;
  const cols = sp[0].length;
  const out = [];
  const seen = new Set();
  function push(cells) {
    const key = cells.map(c => c.join(',')).sort().join('|');
    if (seen.has(key)) return;
    seen.add(key);
    const colors = new Set(cells.map(([r, c]) => sp[r][c].id));
    out.push({ cells, color: colors.size === 1 ? sp[cells[0][0]][cells[0][1]].id : 0, sameColor: colors.size === 1 });
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!isCar(sp[r][c])) continue;
      if (c + 1 < cols && isCar(sp[r][c + 1]) && sp[r][c + 1].id === sp[r][c].id) {
        push([[r, c], [r, c + 1]]);
        if (c + 2 < cols && isCar(sp[r][c + 2]) && sp[r][c + 2].id === sp[r][c].id) {
          push([[r, c], [r, c + 1], [r, c + 2]]);
        }
      }
      if (r + 1 < rows && isCar(sp[r + 1][c]) && sp[r + 1][c].id === sp[r][c].id) {
        push([[r, c], [r + 1, c]]);
        if (r + 2 < rows && isCar(sp[r + 2][c]) && sp[r + 2][c].id === sp[r][c].id) {
          push([[r, c], [r + 1, c], [r + 2, c]]);
        }
      }
    }
  }
  return out;
}

function applySpec(game, spec) {
  const g = B.clone(game);
  // 先清空所有锁链标记，避免继承 v21
  for (const row of g.spools) {
    for (const cell of row) {
      if (!cell) continue;
      let types = Array.isArray(cell.type) ? cell.type.slice() : [cell.type || 0];
      let params = Array.isArray(cell.param) ? cell.param.slice() : [cell.param || 0];
      const iceIdx = types.indexOf(7);
      if (types.indexOf(5) >= 0) {
        types = types.filter(t => t !== 5);
        params = params.filter((_, i) => types[i] !== 5);
        if (iceIdx >= 0) {
          const ice = params[types.indexOf(7)];
          cell.type = 7; cell.param = ice;
        } else {
          cell.type = 0; cell.param = 0;
        }
      }
    }
  }
  for (const group of spec.groups || []) {
    for (const [r, c] of group.cells) {
      const cell = g.spools[r][c];
      if (!cell || !(cell.id > 0)) throw new Error('链格不是车: ' + r + ',' + c);
      const types = Array.isArray(cell.type) ? cell.type : [cell.type || 0];
      const params = Array.isArray(cell.param) ? cell.param : [cell.param || 0];
      const iceIdx = types.indexOf(7);
      const ice = iceIdx >= 0 ? (parseInt(params[iceIdx], 10) || 0) : 0;
      cell.type = ice > 0 ? [5, 7] : 5;
      cell.param = ice > 0 ? [group.id, ice] : group.id;
    }
  }
  for (const ice of spec.ice || []) {
    const cell = g.spools[ice.r][ice.c];
    if (!cell || !(cell.id > 0)) throw new Error('冰格不是车: ' + ice.r + ',' + ice.c);
    const types = Array.isArray(cell.type) ? cell.type.slice() : [cell.type || 0];
    if (types.indexOf(5) >= 0) {
      const id = Array.isArray(cell.param) ? cell.param[0] : cell.param;
      cell.type = [5, 7]; cell.param = [id, ice.steps];
    } else {
      cell.type = 7; cell.param = ice.steps;
    }
  }
  return g;
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

function evaluate(A, game, spec) {
  const applied = applySpec(game, spec);
  const level = A.parseLevel(A.fromGameFormat(applied));
  const solve = A.Solver.solveInstantChain(level, { timeBudgetMs: 20000 });
  const picks = B.uniquePicks(solve);
  const history = solve.stepBufferHistory || [];
  const windows = B.pressureWindows(history, 3);
  const events = chainEvents(A, level, picks, spec.groups);
  const groupsDebt = spec.groups.filter(g => events[g.id].debt && events[g.id].released).length;
  const stats = (() => {
    let ice = 0, chain = 0, pipe = 0, black = 0, cars = 0, sum = 0;
    for (const row of applied.spools) for (const cell of row) {
      if (!cell) continue;
      const types = Array.isArray(cell.type) ? cell.type : [cell.type || 0];
      if (cell.id < 0) { black++; continue; }
      if (types.indexOf(11) >= 0) { pipe++; continue; }
      if (types.indexOf(5) >= 0) chain++;
      if (types.indexOf(7) >= 0) ice++;
      if (cell.id > 0) { cars++; sum += cell.count; }
    }
    return { ice, chain, pipe, black, cars, capacitySum: sum };
  })();
  const peak = solve.maxBuffer;
  const allDebt = spec.groups.every(g => {
    const e = events[g.id];
    return e.debt && e.released && e.maxDebt >= 8;
  });
  const debtSum = spec.groups.reduce((acc, g) => acc + Math.min(events[g.id].maxDebt || 0, 25), 0);
  const longWindows = windows.filter(w => (w.end - w.start + 1) > 6).length;
  const openingChain = spec.groups.filter(g => g.cells.some(([r]) => r === 0) &&
    !(events[g.id].maxDebt >= 8)).length;
  const score =
    (solve.completed ? 0 : -9999) +
    Math.min(windows.length, 4) * 1000 +
    (peak <= 4 ? 150 : -900) +
    (allDebt ? 400 : -5000) +
    debtSum +
    Math.min(stats.ice, 12) * 6 - Math.max(0, stats.ice - 12) * 200 +
    (history.filter(v => v >= 3).length) * 4 +
    windows.reduce((acc, w) => acc + Math.min(w.end - w.start + 1, 5) * 40, 0) -
    Math.max(0, 41 - picks.length) * 120 -
    longWindows * 200 -
    openingChain * 600;
  return {
    score, completed: solve.completed, steps: picks.length, peak,
    windows, history, events, groupsDebt, stats,
    picks
  };
}

function summarize(r, spec) {
  const w = r.windows.map(x => x.start + '-' + x.end + ':' + x.peak).join(' ') || 'none';
  const ev = spec.groups.map(g => {
    const e = r.events[g.id];
    return g.id + (e.entered ? '' : '未进') + (e.debt ? '/债' + e.maxDebt : '/无债') +
      (e.releaseStep ? '/放' + e.releaseStep : '');
  }).join(' ');
  return `steps=${r.steps} peak=${r.peak} windows=${r.windows.length} [${w}] groups[${ev}] score=${Math.round(r.score)}`;
}

function search() {
  const { A, game } = load();
  const cands = candidates(game);
  console.log('候选同色相邻组:', cands.map(c => c.cells.map(x => x.join(',')).join('+') + '#' + c.color).join(' | '));
  const baseSpec = { groups: BASE_GROUPS, ice: [] };
  const base = evaluate(A, game, baseSpec);
  console.log('v21基线:', summarize(base, baseSpec));

  const usable = cands.filter(c => !c.cells.some(([r, c]) => BASE_GROUPS.some(g => g.cells.some(([rr, cc]) => rr === r && cc === c))))
    .filter(c => c.cells.every(([r]) => r > 0));
  let best = { spec: baseSpec, result: base };
  let tried = 0;

  // 第 1 轮：只加 1 组
  const one = [];
  for (const cand of usable) {
    const spec = { groups: BASE_GROUPS.concat([{ id: 4, cells: cand.cells, role: '新组' }]), ice: [] };
    let r; try { r = evaluate(A, game, spec); } catch (e) { continue; }
    tried++;
    one.push({ spec, result: r });
    if (r.score > best.result.score) best = { spec, result: r };
    if (process.env.VERBOSE) console.log('  +' + JSON.stringify(cand.cells), summarize(r, spec));
  }
  one.sort((a, b) => b.result.score - a.result.score);
  console.log('加1组最优:', summarize(best.result, best.spec));

  // 第 2 轮：在 top-8 单组上再加一组，凑成 4 组
  const pool = one.slice(0, 8).map(x => x.spec.groups[2]);
  for (const first of pool) {
    for (const cand of usable) {
      if (cand.cells.some(([r, c]) => first.cells.some(([rr, cc]) => rr === r && cc === c))) continue;
      const groups = BASE_GROUPS.concat([{ id: 4, cells: first.cells }, { id: 5, cells: cand.cells }]);
      const spec = { groups, ice: [] };
      let r; try { r = evaluate(A, game, spec); } catch (e) { continue; }
      tried++;
      if (r.score > best.result.score) best = { spec, result: r };
    }
  }
  console.log('加2组最优:', summarize(best.result, best.spec), 'tried=' + tried);

  // 第 3 轮：冰微调（只在不破坏已有组债务的前提下加冰）
  const iceCands = [];
  for (let r = 1; r < game.spools.length; r++) {
    for (let c = 0; c < game.spools[r].length; c++) {
      const cell = game.spools[r][c];
      if (!cell || !(cell.id > 0)) continue;
      if (best.spec.groups.some(g => g.cells.some(([rr, cc]) => rr === r && cc === c))) continue;
      iceCands.push({ r, c, color: cell.id, count: cell.count });
    }
  }
  let improved = true;
  while (improved) {
    improved = false;
    for (const cand of iceCands) {
      if (best.spec.ice.some(x => x.r === cand.r && x.c === cand.c)) continue;
      for (const steps of [6, 10, 14]) {
        const spec = { groups: best.spec.groups, ice: best.spec.ice.concat([{ r: cand.r, c: cand.c, steps }]) };
        let r; try { r = evaluate(A, game, spec); } catch (e) { continue; }
        if (r.score > best.result.score + 5) {
          best = { spec, result: r }; improved = true;
          console.log('  +冰(' + cand.r + ',' + cand.c + ')/' + steps, summarize(r, spec));
        }
      }
    }
  }

  console.log('\n最终:', summarize(best.result, best.spec));
  console.log('组:', best.spec.groups.map(g => g.id + ':' + g.cells.map(c => c.join(',')).join('+')).join(' '));
  console.log('冰:', best.spec.ice.map(i => i.r + ',' + i.c + '/' + i.steps).join(' ') || 'none');
  console.log('障碍:', JSON.stringify(best.result.stats));
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'search-best.json'), JSON.stringify({
    spec: best.spec,
    summary: {
      steps: best.result.steps, peak: best.result.peak,
      windows: best.result.windows, groupsDebt: best.result.groupsDebt,
      events: best.result.events, stats: best.result.stats
    },
    history: best.result.history
  }, null, 2));
  console.log('written=' + path.join(OUT, 'search-best.json'));
  return { A, game, best };
}

function probe() {
  const { A, game } = load();
  const spec = { groups: BASE_GROUPS, ice: [] };
  const r = evaluate(A, game, spec);
  console.log(summarize(r, spec));
  console.log('history=', r.history.join(','));
  console.log('stats=', JSON.stringify(r.stats));
}

const mode = process.argv.includes('--probe') ? 'probe' : 'search';
if (mode === 'probe') probe(); else search();
