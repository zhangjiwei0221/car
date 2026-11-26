#!/usr/bin/env node
'use strict';
/**
 * LevelAutopsy_v1 —— 单关逐步解剖（只读）
 *
 * 回答两件事（第一批）：
 *   发生：每一步拿走了哪些棋盘格、消掉了目标图哪些像素、暂存谁进谁出、
 *         冰/链/管道/问号各自发生了什么。
 *   约束：每一步每色剩余/可达/可见，每辆车的容量是否 ≤ 入场步可达，
 *         逐色容量守恒、链组空位、管道队列守恒。
 *
 * 不改任何现有工具，不写关卡文件；路线复用 RouteTimeline_v1，保证与仪表盘一致。
 *
 * 用法：
 *   node LevelAutopsy_v1.js <关卡.json> --mode solver|freefirst [--out report.json]
 *   node LevelAutopsy_v1.js <关卡.json> --click <点击记录.json> [--out report.json]
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const B = require('./Build006Thickness_v688');
const A = B.loadSolver('corner');
const TOOLS = __dirname;

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const levelFile = process.argv[2];
const mode = arg('--mode', null);
const clickFile = arg('--click', null);
const outFile = arg('--out', null);
if (!levelFile || (!mode && !clickFile)) {
  console.error('用法: node LevelAutopsy_v1.js <关卡.json> --mode solver|freefirst [--out report.json] | --click <click.json>');
  process.exit(2);
}

const g = JSON.parse(fs.readFileSync(levelFile, 'utf8'));
const lv = A.parseLevel(A.fromGameFormat(g));
const idx = (r, c, cols) => r * cols + c;

/* ---------- 路线：复用 RouteTimeline，避免第二份取车逻辑 ---------- */
function routeFromTimeline() {
  const tmp = path.join(os.tmpdir(), `level_autopsy_route_${process.pid}_${Date.now()}.json`);
  const args = [path.join(TOOLS, 'RouteTimeline_v1.js'), levelFile, '--out', tmp];
  if (clickFile) args.push('--click', clickFile); else args.push('--mode', mode);
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 300000 });
  if (r.status !== 0) throw new Error('RouteTimeline 失败：' + (r.stderr || r.stdout || r.error));
  const j = JSON.parse(fs.readFileSync(tmp, 'utf8'));
  try { fs.unlinkSync(tmp); } catch (e) { }
  return { picks: (j.timeline || []).map(t => t.pick), routeMeta: { won: j.won, steps: j.steps, deathStep: j.deathStep, summary: j.summary } };
}

/* ---------- 快照与差异 ---------- */
function snapshot(s) {
  return {
    cells: s.cells.map(row => row.map(cell => cell ? {
      t: cell.t, color: cell.color, count: cell.count, chain: cell.chain || 0,
      q: !!cell.q, numice: cell.numice || 0, dir: cell.dir, next: cell.next || 0,
      opened: !!cell.opened, queueLen: (cell.queue || []).length,
      queueColors: (cell.queue || []).map(b => b.color)
    } : null)),
    eliminated: s.eliminated.map(row => row.slice()),
    numice: Object.keys(s.numice || {}).reduce((o, k) => { o[k] = s.numice[k].remaining; return o; }, {}),
    activated: Object.keys(s.activated || {}),
    removed: Object.keys(s.removed || {}),
    buffer: (s.buffer || []).map(b => ({ key: b.key, color: b.color, need: b.need, progress: b.progress, remaining: b.need - b.progress, link: b.link || 0 })),
    completedBoxes: s.completedBoxes,
    eliminatedPixels: s.eliminatedPixels,
    totalPixels: s.totalPixels,
    totalBoxes: s.totalBoxes
  };
}

function diffStep(before, after, s, rows, cols, lastPick) {
  // 棋盘格离场以 lastPick.picked 为准：管道会在同一格立刻补新车，diff 会把"替换"看成"没变"。
  const boardRemoved = ((lastPick && lastPick.picked) || []).map(p => ({ r: p.r, c: p.c, color: p.color, count: p.count }));
  const cellChanges = [];
  for (let r = 0; r < s.boardRows; r++) for (let c = 0; c < s.boardCols; c++) {
    const b = before.cells[r] && before.cells[r][c], a = after.cells[r] && after.cells[r][c];
    const key = x => x ? [x.t, x.color, x.count, x.chain, x.q, x.numice].join('|') : 'null';
    if (key(b) !== key(a)) cellChanges.push({ r, c, before: b, after: a });
  }

  const targetEliminated = [];
  const byColor = {};
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (!before.eliminated[r][c] && after.eliminated[r][c]) {
      const color = s.blocks[r][c];
      targetEliminated.push({ r, c, color });
      byColor[color] = (byColor[color] || 0) + 1;
    }
  }

  const numice = [];
  for (const k of Object.keys(before.numice)) {
    if (!(k in after.numice)) numice.push({ r: +k.split(',')[0], c: +k.split(',')[1], event: 'break', before: before.numice[k] });
    else if (after.numice[k] < before.numice[k]) numice.push({ r: +k.split(',')[0], c: +k.split(',')[1], event: 'dec', before: before.numice[k], after: after.numice[k] });
  }

  const pipe = [];
  for (let r = 0; r < s.boardRows; r++) for (let c = 0; c < s.boardCols; c++) {
    const b = before.cells[r][c], a = after.cells[r][c];
    if (!b || b.t !== 'pipe' || !a || a.t !== 'pipe') continue;
    if (!b.opened && a.opened) pipe.push({ r, c, event: 'open', queueColors: a.queueColors });
    if (a.next !== b.next) pipe.push({ r, c, event: 'pop', from: b.next, to: a.next, color: b.queueColors[b.next], queueLen: a.queueLen });
    if (a.queueLen !== b.queueLen && a.next === b.next) pipe.push({ r, c, event: 'queue', from: b.queueLen, to: a.queueLen });
  }

  const bKeys = new Set(before.buffer.map(x => x.key));
  const aKeys = new Set(after.buffer.map(x => x.key));
  const bufferAdded = after.buffer.filter(x => !bKeys.has(x.key));
  const bufferRemoved = before.buffer.filter(x => !aKeys.has(x.key));
  const bufferProgressed = after.buffer.filter(x => {
    const b = before.buffer.find(y => y.key === x.key);
    return b && b.progress !== x.progress;
  }).map(x => {
    const b = before.buffer.find(y => y.key === x.key);
    return { key: x.key, color: x.color, need: x.need, from: b.progress, to: x.progress, remaining: x.remaining, link: x.link };
  });

  const bAct = new Set(before.activated), aAct = new Set(after.activated);
  const activatedNew = after.activated.filter(k => !bAct.has(k)).map(k => ({ r: +k.split(',')[0], c: +k.split(',')[1] }));
  const bRem = new Set(before.removed), aRem = new Set(after.removed);
  const removedNew = after.removed.filter(k => !bRem.has(k)).map(k => ({ r: +k.split(',')[0], c: +k.split(',')[1] }));

  return {
    boardRemoved, cellChanges, targetEliminated: { count: targetEliminated.length, byColor, cells: targetEliminated },
    numice, pipe, bufferAdded, bufferRemoved, bufferProgressed,
    activatedNew, removedNew,
    completedDelta: after.completedBoxes - before.completedBoxes
  };
}

/* ---------- 约束 ---------- */
function reachOfColor(s, color) {
  const em = s.eliminated.map(row => row.slice());
  return A.Simulator.floodFillCount(em, s.blocks, s.rows, s.cols, color, s.bottomOnly);
}
function visibleRemainOfColor(s, color) {
  let n = 0;
  for (let r = 0; r < s.rows; r++) for (let c = 0; c < s.cols; c++) {
    if (!s.eliminated[r][c] && s.blocks[r][c] === color) n++;
  }
  return n;
}
function remainingCapacityByColor(s) {
  const out = {};
  for (let r = 0; r < s.boardRows; r++) for (let c = 0; c < s.boardCols; c++) {
    const cell = s.cells[r][c];
    if (cell && cell.t === 'box') out[cell.color] = (out[cell.color] || 0) + cell.count;
    if (cell && cell.t === 'pipe') for (let q = (cell.queue || []).length - 1; q >= (cell.next || 0); q--) {
      const b = cell.queue[q]; if (b) out[b.color] = (out[b.color] || 0) + b.count;
    }
  }
  for (const b of s.buffer) out[b.color] = (out[b.color] || 0) + (b.need - b.progress);
  return out;
}
function colorSet(s) {
  const set = new Set();
  for (let r = 0; r < s.rows; r++) for (let c = 0; c < s.cols; c++) if (!s.eliminated[r][c] && s.blocks[r][c] > 0) set.add(s.blocks[r][c]);
  for (let r = 0; r < s.boardRows; r++) for (let c = 0; c < s.boardCols; c++) {
    const cell = s.cells[r][c];
    if (cell && cell.t === 'box') set.add(cell.color);
    if (cell && cell.t === 'pipe') for (const b of cell.queue || []) set.add(b.color);
  }
  for (const b of s.buffer) set.add(b.color);
  return [...set].sort((a, b) => a - b);
}

/* ---------- 静态盘点 ---------- */
function staticInventory(s, g) {
  const colors = new Map();
  const cars = [];
  let boxes = 0, blacks = 0, pipes = 0, iceCells = 0, iceBalls = 0, qCells = 0;
  for (let r = 0; r < s.boardRows; r++) for (let c = 0; c < s.boardCols; c++) {
    const cell = s.cells[r][c];
    if (!cell) continue;
    if (cell.t === 'black') { blacks++; continue; }
    if (cell.t === 'pipe') {
      pipes++;
      for (const q of cell.queue || []) {
        if (!colors.has(q.color)) colors.set(q.color, { color: q.color, pixels: 0, cars: 0, capacity: 0, maxCar: 0, minCar: Infinity });
        const xq = colors.get(q.color); xq.capacity += q.count;
      }
      continue;
    }
    if (cell.t !== 'box') continue;
    boxes++;
    if (cell.numice > 0) { iceCells++; iceBalls += cell.numice; }
    if (cell.q) qCells++;
    cars.push({ r, c, color: cell.color, count: cell.count, chain: cell.chain || 0, numice: cell.numice || 0, q: !!cell.q });
    if (!colors.has(cell.color)) colors.set(cell.color, { color: cell.color, pixels: 0, cars: 0, capacity: 0, maxCar: 0, minCar: Infinity });
    const x = colors.get(cell.color);
    x.cars++; x.capacity += cell.count; x.maxCar = Math.max(x.maxCar, cell.count); x.minCar = Math.min(x.minCar, cell.count);
  }
  for (let r = 0; r < s.rows; r++) for (let c = 0; c < s.cols; c++) {
    const id = s.blocks[r][c];
    if (id > 0) {
      if (!colors.has(id)) colors.set(id, { color: id, pixels: 0, cars: 0, capacity: 0, maxCar: 0, minCar: Infinity });
      colors.get(id).pixels++;
    }
  }
  const chainGroups = (s.chainGroups || []).map((grp, i) => ({
    group: i + 1, size: grp.length, members: grp.map(p => ({ r: p.r, c: p.c }))
  }));
  const pipesInfo = [];
  for (let r = 0; r < s.boardRows; r++) for (let c = 0; c < s.boardCols; c++) {
    const cell = s.cells[r][c];
    if (cell && cell.t === 'pipe') pipesInfo.push({ r, c, dir: cell.dir, opened: !!cell.opened, next: cell.next || 0, queue: (cell.queue || []).map(b => ({ color: b.color, count: b.count })) });
  }
  let pipeQueueSum = 0;
  for (const p of pipesInfo) for (const b of p.queue) pipeQueueSum += b.count;
  const spoolList = (g.spools || []).flat ? (g.spools || []).flat() : [].concat(...(g.spools || []));
  const spoolSum = spoolList.reduce((a, b) => a + (b && b.count || 0), 0);
  const colorRows = [...colors.values()].sort((a, b) => a.color - b.color).map(x => ({ ...x, minCar: x.minCar === Infinity ? 0 : x.minCar, capacityGap: x.capacity - x.pixels }));
  return {
    board: { rows: s.boardRows, cols: s.boardCols },
    image: { rows: s.rows, cols: s.cols, totalPixels: s.totalPixels },
    counts: { boxes, blacks, pipes, iceCells, iceBalls, qCells, chainGroups: chainGroups.length },
    colors: colorRows,
    cars, chains: chainGroups, pipes: pipesInfo,
    conservation: {
      spoolsSum: spoolSum, pipeQueueSum, totalPixels: s.totalPixels,
      spoolsPlusPipes: spoolSum + pipeQueueSum,
      ok: spoolSum + pipeQueueSum === s.totalPixels && colorRows.every(x => x.capacityGap === 0),
      colorGaps: colorRows.filter(x => x.capacityGap !== 0).map(x => ({ color: x.color, pixels: x.pixels, capacity: x.capacity, gap: x.capacityGap }))
    }
  };
}

/* ---------- 主循环 ---------- */
const route = routeFromTimeline();
const s = A.Simulator.createState(lv, { useSlotStart: true, bottomOnly: false, instantChain: false });
const rows = s.rows, cols = s.cols;
const staticInfo = staticInventory(s, g);
const steps = [];
let won = false, deathStep = null, mismatch = null, bufferPeak = 0;
let totalConstraintViolations = 0;

for (let i = 0; i < route.picks.length; i++) {
  const pick = route.picks[i];
  if (!pick) break;
  const before = snapshot(s);
  const moves = A.Simulator.listMoves(s).filter(m => !m.blocked);
  const move = moves.find(m => m.r === pick.r && m.c === pick.c);
  if (!move) { mismatch = i + 1; deathStep = i + 1; break; }
  const cell = s.cells[pick.r][pick.c];
  const groupSize = move.groupSize || 1;
  const capacity = cell.count;

  // 约束（取车之前算）
  const reachBefore = reachOfColor(s, cell.color);
  const visibleBefore = visibleRemainOfColor(s, cell.color);
  const freeSlots = s.bufferLimit - s.buffer.length;
  const overReach = capacity > reachBefore;
  const slotShort = groupSize > freeSlots;
  const cons = {
    color: cell.color, capacity, groupSize, reachBefore, visibleBefore,
    overReach, overBy: Math.max(0, capacity - reachBefore),
    freeSlots, slotShort,
    bufferBefore: before.buffer.length,
    remainingCapacity: remainingCapacityByColor(s),
    perColor: colorSet(s).map(color => ({
      color, remaining: visibleRemainOfColor(s, color), reach: color === cell.color ? reachBefore : reachOfColor(s, color)
    }))
  };
  if (slotShort) totalConstraintViolations++;

  const ok = A.Simulator.applyPick(s, pick.r, pick.c);
  if (!ok) { mismatch = i + 1; deathStep = i + 1; break; }
  const after = snapshot(s);
  const events = diffStep(before, after, s, rows, cols, s.lastPick);
  if (after.buffer.length > bufferPeak) bufferPeak = after.buffer.length;
  const completedNow = after.completedBoxes > before.completedBoxes;

  steps.push({
    step: i + 1, pick: { r: pick.r, c: pick.c }, car: { color: cell.color, count: cell.count, chain: cell.chain || 0, q: !!cell.q, numice: cell.numice || 0 },
    events, constraints: cons,
    state: {
      buffer: after.buffer, bufferCount: after.buffer.length,
      debtPx: after.buffer.reduce((a, b) => a + b.remaining, 0),
      eliminatedPixels: after.eliminatedPixels, totalPixels: after.totalPixels,
      completedBoxes: after.completedBoxes, totalBoxes: after.totalBoxes,
      overflow: !!s.overflow, completedNow
    }
  });

  if (after.eliminatedPixels >= after.totalPixels) { won = true; break; }
  const noMoves = A.Simulator.listMoves(s).filter(m => !m.blocked).length === 0;
  if (s.overflow || s.buffer.length > s.bufferLimit || (s.buffer.length >= s.bufferLimit && !completedNow) || noMoves) { deathStep = i + 1; break; }
}

const result = {
  tool: 'LevelAutopsy_v1', version: '1.0',
  level: { file: levelFile, mode: clickFile ? 'click' : mode, click: clickFile || null },
  routeMeta: route.routeMeta,
  static: staticInfo,
  steps,
  summary: {
    won, steps: steps.length, deathStep, mismatch, bufferPeak,
    eliminatedPixels: steps.length ? steps[steps.length - 1].state.eliminatedPixels : 0,
    totalPixels: s.totalPixels,
    constraintViolations: totalConstraintViolations,
    partialFillSteps: steps.filter(x => x.constraints.overReach).length,
    firstPartialFillStep: (steps.find(x => x.constraints.overReach) || {}).step || null,
    firstSlotShortStep: (steps.find(x => x.constraints.slotShort) || {}).step || null,
    conservationOk: staticInfo.conservation.ok
  }
};

if (outFile) fs.writeFileSync(outFile, JSON.stringify(result, null, 1));
const S = result.summary;
console.log(`autopsy ${clickFile ? 'click' : mode} steps=${S.steps} won=${S.won ? 'Y' : 'N'} death=${S.deathStep || '-'} peak=${S.bufferPeak} violations=${S.constraintViolations} cons=${S.conservationOk ? 'OK' : 'BAD'} partialFill=${S.partialFillSteps}@${S.firstPartialFillStep || '-'}`);
if (outFile) console.log('saved ' + outFile);
module.exports = { autopsy: () => result };
