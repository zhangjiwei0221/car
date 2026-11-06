#!/usr/bin/env node
'use strict';

/**
 * E6.8R v22 落盘与验收（全知优先，不看 PlayerSim）
 *
 * 读取 Search006MultiWindow_v696 的 search-best.json，生成：
 *   原型_v22/关卡_实验_006_v22.json
 *   原型_v22/关卡_实验_006_v22.md（窗口、组债务、消融、容量守恒、往返）
 *
 * 用法：node 03_工具/正式版/Build006MultiWindow_v697.js
 */

const fs = require('fs');
const path = require('path');
const B = require('./Build006Thickness_v688');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, '实验关/关卡6/原型_v21/关卡_实验_006_v21.json');
const BEST = path.join(ROOT, '实验关/关卡6/原型_v22/search-best.json');
const OUT = path.join(ROOT, '实验关/关卡6/原型_v22');

function applySpec(game, spec) {
  const g = B.clone(game);
  for (const row of g.spools) {
    for (const cell of row) {
      if (!cell) continue;
      let types = Array.isArray(cell.type) ? cell.type.slice() : [cell.type || 0];
      let params = Array.isArray(cell.param) ? cell.param.slice() : [cell.param || 0];
      const iceIdx = types.indexOf(7);
      if (types.indexOf(5) >= 0) {
        types = types.filter(t => t !== 5);
        params = params.filter((_, i) => types[i] !== 5);
        if (iceIdx >= 0) { cell.type = 7; cell.param = params[types.indexOf(7)]; }
        else { cell.type = 0; cell.param = 0; }
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
    const types = Array.isArray(cell.type) ? cell.type : [cell.type || 0];
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

function solveLevel(A, game) {
  const level = A.parseLevel(A.fromGameFormat(game));
  const solve = A.Solver.solveInstantChain(level, { timeBudgetMs: 20000 });
  return { level, solve, picks: B.uniquePicks(solve), history: solve.stepBufferHistory || [] };
}

function main() {
  const A = B.loadSolver();
  const game = B.readJson(SRC);
  const best = B.readJson(BEST);
  const spec = best.spec;

  const applied = applySpec(game, spec);
  const { level, solve, picks, history } = solveLevel(A, applied);
  const windows = B.pressureWindows(history, 3);
  const events = chainEvents(A, level, picks, spec.groups);

  // 容量与逐色守恒
  const perColor = {};
  let iceCells = 0, chainCells = 0, pipeCells = 0, blackCells = 0, boardCars = 0;
  for (const row of applied.spools) for (const cell of row) {
    if (!cell) continue;
    const types = Array.isArray(cell.type) ? cell.type : [cell.type || 0];
    if (types.indexOf(11) >= 0) {
      pipeCells++;
      for (const item of (Array.isArray(cell.param) ? cell.param : [])) {
        if (item && item.id > 0) perColor[item.id] = (perColor[item.id] || 0) + item.count;
      }
      continue;
    }
    if (types.indexOf(7) >= 0) iceCells++;
    if (types.indexOf(5) >= 0) chainCells++;
    if (!(cell.id > 0)) { blackCells++; continue; }
    boardCars++;
    perColor[cell.id] = (perColor[cell.id] || 0) + cell.count;
  }
  const targetTotals = (() => {
    const tally = {};
    for (const row of applied.blocks) for (const v of row) {
      if (v > 0) tally[v] = (tally[v] || 0) + 1;
    }
    return tally;
  })();
  const colorMismatch = Object.keys(targetTotals).filter(k => perColor[k] !== targetTotals[k]);

  // 往返
  const gameFormat = A.toGameFormat(level);
  const roundtrip = A.parseLevel(A.fromGameFormat(gameFormat));
  const rt = A.Solver.solveInstantChain(roundtrip, { timeBudgetMs: 20000, greedyOnly: true });

  // 消融：逐个移除组，看窗口/路线是否变化
  const ablation = [];
  for (const group of spec.groups) {
    const variant = B.clone(applied);
    for (const [r, c] of group.cells) {
      const cell = variant.spools[r][c];
      const types = Array.isArray(cell.type) ? cell.type : [cell.type || 0];
      const params = Array.isArray(cell.param) ? cell.param : [cell.param || 0];
      const iceIdx = types.indexOf(7);
      if (iceIdx >= 0) { cell.type = 7; cell.param = params[iceIdx]; }
      else { cell.type = 0; cell.param = 0; }
    }
    const r2 = solveLevel(A, variant);
    const w2 = B.pressureWindows(r2.history, 3);
    const poseA = picks.map(p => p.r + ',' + p.c).join('>');
    const poseB = r2.picks.map(p => p.r + ',' + p.c).join('>');
    ablation.push({
      group: group.id, cells: group.cells,
      removedSteps: r2.picks.length, removedPeak: r2.solve.maxBuffer,
      removedWindows: w2, routeChanged: poseA !== poseB
    });
  }

  fs.writeFileSync(path.join(OUT, '关卡_实验_006_v22.json'), JSON.stringify(applied, null, 2));
  fs.writeFileSync(path.join(OUT, '关卡_实验_006_v22.debug.json'), JSON.stringify({
    spec, history, windows, events, ablation,
    solve: { completed: solve.completed, peak: solve.maxBuffer, steps: picks.length },
    picks
  }, null, 2));

  const lines = [];
  lines.push('# 006 · v22 多窗口候选（全知优先）');
  lines.push('');
  lines.push('> 生成：`node 03_工具/正式版/Search006MultiWindow_v696.js --search`');
  lines.push('> 落盘：`node 03_工具/正式版/Build006MultiWindow_v697.js`');
  lines.push('');
  lines.push('## 结论');
  lines.push('');
  lines.push('- 全知 ' + picks.length + ' 步、峰值 ' + solve.maxBuffer + '、窗口 ' + windows.length + ' 段；');
  lines.push('- 窗口：' + (windows.map(w => w.start + '～' + w.end + ' 峰值' + w.peak).join('；') || '无'));
  lines.push('- 组债务：' + spec.groups.map(g => {
    const e = events[g.id];
    return 'group-' + g.id + '(' + g.cells.map(c => c.join(',')).join('+') + ')' +
      (e.entered ? ' 第' + e.entryStep + '步进' : ' 未进入') +
      (e.debt ? '、留债' + e.maxDebt + 'px' : '、无债') +
      (e.releaseStep ? '、第' + e.releaseStep + '步放' : '、未释放');
  }).join('；'));
  lines.push('- 障碍（实际落地）：冰 ' + iceCells + ' 格、链车 ' + chainCells + ' 格（' + spec.groups.length + ' 组）、管道 ' + pipeCells + ' 条、黑块 ' + blackCells + '；');
  lines.push('- 容量逐色守恒：' + (colorMismatch.length === 0 ? '通过' : '失败 ' + colorMismatch.join(',')));
  lines.push('- 五键往返：' + (rt.completed ? '可解' : '不可解'));
  lines.push('');
  lines.push('## 容量');
  lines.push('');
  lines.push('| 颜色 | 目标像素 | 车容量和 | 差 |');
  lines.push('|---|---:|---:|---:|');
  Object.keys(targetTotals).sort((a, b) => a - b).forEach(k => {
    lines.push('| ' + k + ' | ' + targetTotals[k] + ' | ' + (perColor[k] || 0) + ' | ' + ((perColor[k] || 0) - targetTotals[k]) + ' |');
  });
  lines.push('');
  lines.push('## 组级消融');
  lines.push('');
  lines.push('| 组 | 格 | 移除后步数 | 移除后峰值 | 移除后窗口 | 路线变化 |');
  lines.push('|---|---|---:|---:|---|---|');
  ablation.forEach(a => {
    lines.push('| ' + a.group + ' | ' + a.cells.map(c => c.join(',')).join(' ') + ' | ' + a.removedSteps + ' | ' +
      a.removedPeak + ' | ' + (a.removedWindows.map(w => w.start + '-' + w.end + ':' + w.peak).join(' ') || 'none') + ' | ' +
      (a.routeChanged ? '是' : '否') + ' |');
  });
  lines.push('');
  lines.push('## 待改进');
  lines.push('');
  lines.push('- 第 2～5 步的窗口来自首行 30 色三连，组债务只有 4px，属于“弱债务”，下一轮应替换；');
  lines.push('- 第 24～25 步窗口只有 1 步，峰值 3，偏短；');
  lines.push('- 管道仍只有 1 条，目标 3 条；冰 12 格已达到目标下限；');
  lines.push('- PlayerSim 与策略族本轮不参与否决（按 2026-10-28 裁决）。');
  fs.writeFileSync(path.join(OUT, '关卡_实验_006_v22.md'), lines.join('\n') + '\n');

  console.log(lines.slice(0, 12).join('\n'));
  console.log('written=' + path.join(OUT, '关卡_实验_006_v22.json'));
}

main();
