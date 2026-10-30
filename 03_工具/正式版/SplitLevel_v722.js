#!/usr/bin/env node
'use strict';
/**
 * 自写切块器 v722
 * 目标：把目标图按颜色切成“车”，保证 sum(容量) == 目标像素（不丢余量），
 * 再按棋盘摆放成关卡 JSON，并用求解器给出首测数字。
 *
 * 为什么要自己切：GenAnchorCut 的锚点切对“细框 + 小点缀”的图会丢余量
 * （实测 40×40 的拼接图丢 60~130px），容量对不上就没法用。
 *
 * 用法：
 *   node SplitLevel_v722.js --target <目标图.txt> --out <关卡.json> [--rows 7 --cols 7]
 *                            [--box-min 20 --box-max 40] [--seed 1001]
 */
const fs = require('fs');
const path = require('path');
const B = require('./Build006Thickness_v688');
const A = B.loadSolver();

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const target = arg('--target', '实验关/目标图_拼接/拼接_四主体v14_40x40.txt');
const out = arg('--out', '实验关/关卡拼接/v14_self/关卡_自切_v722.json');
const rows = Number(arg('--rows', 7));
const cols = Number(arg('--cols', 7));
const boxMin = Number(arg('--box-min', 18));
const boxMax = Number(arg('--box-max', 46));
const seed = Number(arg('--seed', 1001));
const debtColors = Number(arg('--debt-colors', 0));
const guideColor = Number(arg('--guide-color', 0));
const lockOthers = Number(arg('--lock-others', 0));   // 给“非引导色”的车加冰锁，param=该值
const guideOnly = argv.includes('--guide-only');       // 外圈只放引导色 + 开局暴露色
const buryColors = String(arg('--bury-colors', '')).split(',').map(Number).filter(n => n > 0); // 埋到棋盘最里面
const noSplit = String(arg('--no-split-colors', '')).split(',').map(Number).filter(n => n > 0);   // 这些颜色不拆车（整色一辆）
const iceColors = String(arg('--ice-colors', '')).split(',').map(Number).filter(n => n > 0);
const iceParam = Number(arg('--ice-param', 12));   // 想让玩家先开的主体边框色
const debtFactor = Number(arg('--debt-factor', 1.5));

// ---------- 读目标图 ----------
function loadTarget(p) {
  const lines = fs.readFileSync(p, 'utf8').trim().split(/\r?\n/);
  const body = lines[0].startsWith('像素') ? lines.slice(1) : lines;
  return body.filter(l => l.trim()).map(l => l.trim().split(/\s+/).map(Number));
}
const g = loadTarget(target);
const R = g.length, C = g[0].length;
const cells = R * C;

// ---------- 颜色 -> 连通区 ----------
function regions() {
  const seen = Array.from({ length: R }, () => new Array(C).fill(false));
  const out = {};
  for (let y = 0; y < R; y++) for (let x = 0; x < C; x++) {
    if (seen[y][x]) continue;
    const col = g[y][x];
    const st = [[y, x]]; seen[y][x] = true; const list = [];
    while (st.length) {
      const [cy, cx] = st.pop(); list.push([cy, cx]);
      for (const [dy, dx] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ny = cy + dy, nx = cx + dx;
        if (ny >= 0 && nx >= 0 && ny < R && nx < C && !seen[ny][nx] && g[ny][nx] === col) {
          seen[ny][nx] = true; st.push([ny, nx]);
        }
      }
    }
    (out[col] = out[col] || []).push(list);
  }
  return out;
}
const reg = regions();
const totals = {};
for (const col of Object.keys(reg)) totals[col] = reg[col].reduce((a, r) => a + r.length, 0);

// ---------- 债注入计划（可选） ----------
const debtPlan = {};
if (debtColors > 0) {
  const order = Object.keys(reg).sort((a, b) => totals[b] - totals[a]).slice(0, debtColors);
  for (const col of order) {
    const maxRegion = Math.max(...reg[col].map(r => r.length));
    const want = Math.min(Math.floor(totals[col] * 0.6), Math.ceil(maxRegion * debtFactor) + 2);
    const need = Math.max(want, Math.min(boxMax, totals[col] - boxMin));
    if (need > maxRegion && totals[col] - need >= boxMin) debtPlan[col] = need;
  }
}
// ---------- 开局暴露色（贴边界的颜色） ----------
const exposed = new Set();
for (let x = 0; x < C; x++) { exposed.add(g[0][x]); exposed.add(g[R - 1][x]); }
for (let y = 0; y < R; y++) { exposed.add(g[y][0]); exposed.add(g[y][C - 1]); }
// ---------- 每色切成块（精确划分，不丢像素） ----------
// 通过调整 targetSize 让块数 <= 格子数；只允许同色相邻块合并
function splitAll(targetSize) {
  const out = [];
  for (const col of Object.keys(reg)) {
    if (noSplit.includes(Number(col))) {
      const pool0 = [];
      for (const region of reg[col]) for (const p of region) pool0.push(p);
      out.push({ color: Number(col), cells: pool0, count: pool0.length, first: pool0[0] });
      continue;
    }
    const debtNeed = debtPlan[col];
    const pool = [];
    for (const region of reg[col]) for (const p of region) pool.push(p);
    pool.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
    let idx = 0;
    if (debtNeed && debtNeed > 0) {
      const chunk = pool.slice(0, debtNeed);
      out.push({ color: Number(col), cells: chunk, count: chunk.length, first: chunk[0] });
      idx = debtNeed;
    }
    while (idx < pool.length) {
      const remain = pool.length - idx;
      let take = Math.min(targetSize, remain);
      if (remain - take > 0 && remain - take < boxMin) take = remain;
      const chunk = pool.slice(idx, idx + take);
      idx += take;
      out.push({ color: Number(col), cells: chunk, count: chunk.length, first: chunk[0] });
    }
  }
  return out;
}
let targetSize = Math.max(boxMin, Math.min(boxMax, Math.round(cells / (rows * cols))));
let boxes = splitAll(targetSize);
let guard = 0;
while (boxes.length > rows * cols && targetSize < boxMax && guard++ < 200) {
  targetSize++;
  boxes = splitAll(targetSize);
}
// 若仍超出，只能同色合并（绝不跨色）
boxes.sort((a, b) => a.count - b.count);
while (boxes.length > rows * cols) {
  const small = boxes.shift();
  const sameIdx = boxes.findIndex(b => b.color === small.color);
  if (sameIdx < 0) { boxes.push(small); break; }
  boxes[sameIdx].count += small.count;
  boxes[sameIdx].cells = boxes[sameIdx].cells.concat(small.cells);
}
// 摆放顺序：按颜色聚在一起（同色相邻，方便成链）
const order = String(arg('--order', 'pos'));
if (order === 'color') {
  boxes.sort((a, b) => (a.color - b.color) || (a.first[0] - b.first[0]) || (a.first[1] - b.first[1]));
} else if (order === 'rand') {
  let rs = seed >>> 0 || 1;
  const rnd = () => { rs = (rs * 1664525 + 1013904223) >>> 0; return rs / 4294967296; };
  for (let i = boxes.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [boxes[i], boxes[j]] = [boxes[j], boxes[i]]; }
} else {
  boxes.sort((a, b) => (a.first[0] - b.first[0]) || (a.first[1] - b.first[1]));
}

// ---------- 摆盘 ----------
// 引导模式：外圈优先放“引导色”，其次放“开局未暴露的颜色”（拿不动→形成债），
// 其余“开局暴露的其他边框色”压到内圈，玩家不会一上来就开别的壳。
let placed;
if (buryColors.length > 0) {
  // 把指定颜色的车埋到棋盘中心，其它（入口色+背景色）放外圈
  const ring = [], inner = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (r === 0 || c === 0 || r === rows - 1 || c === cols - 1) ring.push([r, c]); else inner.push([r, c]);
  }
  // 内圈按“离中心距离”排序，越深越先放要埋的颜色
  const cy = (rows - 1) / 2, cx = (cols - 1) / 2;
  inner.sort((a, b) => {
    const da = Math.abs(a[0] - cy) + Math.abs(a[1] - cx);
    const db = Math.abs(b[0] - cy) + Math.abs(b[1] - cx);
    return da - db;
  });
  const buried = boxes.filter(b => buryColors.includes(b.color));
  const others2 = boxes.filter(b => !buryColors.includes(b.color));
  placed = new Array(rows * cols).fill(null);
  const slots = ring.concat(inner);
  let i = 0;
  // 先填外圈：入口色优先，其余按原顺序
  const guideFirst = others2.filter(b => b.color === guideColor).concat(others2.filter(b => b.color !== guideColor));
  for (const b of guideFirst) { if (i >= ring.length) break; const [sr, sc] = slots[i++]; placed[sr * cols + sc] = b; }
  // 再填内圈：普通色在外，埋的颜色最里面
  const innerSlots = slots.slice(ring.length);
  const ordered = others2.filter(b => guideFirst.indexOf(b) < 0).concat(buried);
  let j = 0;
  for (const b of ordered) { if (j >= innerSlots.length) break; const [sr, sc] = innerSlots[j++]; placed[sr * cols + sc] = b; }
} else if (guideColor > 0) {
  const ring = [], inner = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (r === 0 || c === 0 || r === rows - 1 || c === cols - 1) ring.push([r, c]); else inner.push([r, c]);
  }
  const guide = boxes.filter(b => b.color === guideColor);
  const hidden = guideOnly ? [] : boxes.filter(b => b.color !== guideColor && !exposed.has(b.color));
  const others = boxes.filter(b => b.color !== guideColor && (guideOnly ? exposed.has(b.color) : exposed.has(b.color)));
  const rest = boxes.filter(b => b.color !== guideColor && !others.includes(b) && !hidden.includes(b));
  placed = new Array(rows * cols).fill(null);
  const slots = ring.concat(inner);
  let i = 0;
  for (const b of guide.concat(hidden).concat(others).concat(rest)) {
    if (i >= slots.length) break;
    const [sr, sc] = slots[i++];
    placed[sr * cols + sc] = b;
  }
} else {
  placed = boxes;
}
const spools = [];
for (let r = 0; r < rows; r++) {
  const row = [];
  for (let c = 0; c < cols; c++) {
    const b = placed[r * cols + c];
    if (b && iceColors.includes(b.color)) {
      row.push({ id: b.color, type: 7, param: iceParam, count: b.count });
    } else if (b && guideColor > 0 && lockOthers > 0 && b.color !== guideColor) {
      row.push({ id: b.color, type: 7, param: lockOthers, count: b.count });
    } else {
      row.push(b ? { id: b.color, type: 0, param: 0, count: b.count } : { id: -1, type: 0, param: 0, count: 0 });
    }
  }
  spools.push(row);
}
// ---------- 自动成链：把相邻的同色车两两捆起来（造组债务） ----------
const autoChain = Number(arg('--auto-chain', 0));
if (autoChain > 0) {
  let made = 0, cid = 50;
  for (let r = 0; r < rows && made < autoChain; r++) {
    for (let c = 0; c < cols && made < autoChain; c++) {
      const a = spools[r][c];
      if (!(a.id > 0) || a.type !== 0) continue;
      for (const [dr, dc] of [[0, 1], [1, 0]]) {
        const nr = r + dr, nc = c + dc;
        if (nr >= rows || nc >= cols) continue;
        const b = spools[nr][nc];
        if (!(b.id > 0) || b.type !== 0 || b.id !== a.id) continue;
        a.type = 5; a.param = cid; b.type = 5; b.param = cid;
        made++; cid++;
        break;
      }
    }
  }
  console.log(`自动成链 ${made} 组`);
}
const level = { toprow: R, blocks: g, maprow: rows, mapcol: cols, spools };
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(level, null, 2));

// ---------- 校验与首测 ----------
const sum = spools.flat().filter(c => c.id > 0).reduce((a, c) => a + c.count, 0);
const perColor = {};
spools.flat().filter(c => c.id > 0).forEach(c => { perColor[c.id] = (perColor[c.id] || 0) + c.count; });
const bad = Object.keys(totals).filter(col => (perColor[col] || 0) !== totals[col]);

const lv = A.parseLevel(A.fromGameFormat(level));
const o = A.Solver.runSolver(lv, 0, 1, false, false, { capturePreviewStats: true, instantChain: true });
const buf = (o.pressureSamples || []).map(s => s.buf || 0);
let at4 = 0, run4 = 0, cur = 0;
for (const v of buf) { if (v >= 4) { cur++; at4++; run4 = Math.max(run4, cur); } else cur = 0; }

console.log(`棋盘 ${rows}×${cols} / 车 ${boxes.length} / 容量和 ${sum} / 目标 ${cells}`);
console.log(`每色核对：${bad.length ? '❌ 不一致 ' + bad.map(c => `${c}:${perColor[c] || 0}/${totals[c]}`).join(' ') : '✅ 全部吻合'}`);
console.log(`首测：步 ${buf.length} / 峰值 ${Math.max(0, ...buf)} / at4 ${at4} / run4 ${run4} / 通关 ${!!o.completed}`);
console.log(`已写：${out}`);
