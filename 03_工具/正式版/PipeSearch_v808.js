#!/usr/bin/env node
'use strict';
/**
 * PipeSearch_v808 —— 管道位置搜索
 *
 * 背景（2026-11-04 用户）：PipeConvert_v772 只从左上角取前 N 个，不做评估，
 * 结果管道一加中段就崩（实测：中段 15%、at4=1、后段=1）。
 *
 * 做法：枚举所有可转管道的位置，逐个转换 + 复测（用轻量 quick 指标），
 *       选「通过项最多」的那个。找不到不破坏指标的，就一个都不加。
 *
 * 用法：node PipeSearch_v808.js <关卡.json> --out 结果.json [--count 2] [--ref corner]
 */
const fs = require('fs');
const path = require('path');
const B = require('./Build006Thickness_v688');
const A = B.loadSolver('corner');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const FILE = process.argv.slice(2).find(a => a.endsWith('.json') && !a.startsWith('--'));
const OUT = arg('--out', '/tmp/pipe_search.json');
const WANT = Number(arg('--count', 2));

const clone = o => JSON.parse(JSON.stringify(o));
const BASE = B.readJson(FILE);

/** 轻量指标：和 ArlCheck 的硬项大致对齐（通关/峰值/中段/后段/at4/连续免费/低压） */
function quick(g) {
  const lv = A.parseLevel(A.fromGameFormat(g));
  const o = A.Solver.runSolver(lv, 0, 1, false, false, { capturePreviewStats: true, instantChain: false });
  const buf = (Array.isArray(o.stepBufferHistory) && o.stepBufferHistory.length)
    ? o.stepBufferHistory : (o.pressureSamples || []).map(s => s.buf || 0);
  const L = buf.length, e = Math.max(1, Math.round(L * 0.1)), t = Math.floor(L * 0.8);
  const mid = buf.slice(e, t);
  let freeRun = 0, cur = 0, lowRun = 0, curLow = 0;
  for (const v of buf) { cur = v <= 0 ? cur + 1 : 0; freeRun = Math.max(freeRun, cur); }
  for (const v of mid) { curLow = v <= 1 ? curLow + 1 : 0; lowRun = Math.max(lowRun, curLow); }
  const at4 = buf.filter(v => v >= 4).length;
  return {
    won: !!o.completed,
    peak: Math.max(0, ...buf),
    mid3: mid.filter(v => v >= 3).length,
    midRatio: mid.length ? mid.filter(v => v >= 3).length / mid.length : 0,
    tail3: buf.slice(t).filter(v => v >= 3).length,
    at4, freeRun, lowRun, steps: L
  };
}

/** 硬项（管道不能破坏这些） */
function scoreOf(m) {
  let n = 0;
  if (m.won) n++;
  if (m.peak === 4) n++;
  if (m.midRatio >= 0.45 && m.midRatio <= 0.80) n++;
  if (m.tail3 >= 2) n++;
  if (m.at4 >= 5) n++;
  if (m.freeRun <= 5) n++;
  if (m.lowRun <= 5) n++;
  return n;
}

/** 把 (r,c) 的车变成管道（方向朝外，容量进队列） */
function toPipe(g, r, c) {
  const rows = g.spools.length, cols = g.spools[0].length;
  const s = g.spools[r][c];
  if (!s || !(s.id > 0)) return false;
  const t = Array.isArray(s.type) ? s.type : [s.type || 0];
  if (t.includes(5) || t.includes(7) || t.includes(6) || s.q) return false;
  if (t.some(x => x >= 11 && x <= 14)) return false;
  // 选一个朝外的方向
  let dir = 0;
  if (r === 0) dir = 11; else if (c === cols - 1) dir = 12; else if (r === rows - 1) dir = 13; else if (c === 0) dir = 14;
  if (!dir) dir = 11;
  s.type = dir;
  s.param = [{ id: s.id, count: s.count, color: s.id }];
  s.count = 0;
  return true;
}

const baseM = quick(BASE);
const baseS = scoreOf(baseM);
console.log(`基线：通过 ${baseS}/7 | 峰${baseM.peak} 中${Math.round(baseM.midRatio * 100)}% 后${baseM.tail3} at4=${baseM.at4} 免费连${baseM.freeRun} 低压连${baseM.lowRun} 步${baseM.steps}`);

const rows = BASE.spools.length, cols = BASE.spools[0].length;
const cands = [];
for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
  const tmp = clone(BASE);
  if (!toPipe(tmp, r, c)) continue;
  const m = quick(tmp);
  const sc = scoreOf(m);
  cands.push({ r, c, sc, m, g: tmp, color: BASE.spools[r][c].id, count: BASE.spools[r][c].count });
}
cands.sort((a, b) => b.sc - a.sc || b.m.midRatio - a.m.midRatio);
console.log(`候选 ${cands.length} 个，前 5：`);
cands.slice(0, 5).forEach(x => console.log(
  `  (${x.r},${x.c}) 色${x.color}容量${x.count} → 通过${x.sc}/7 峰${x.m.peak} 中${Math.round(x.m.midRatio * 100)}% 后${x.m.tail3} at4=${x.m.at4}`
));

// 贪心挑 WANT 个（每加一个都重新评估剩余候选）
let cur = clone(BASE), curM = baseM, curS = baseS, added = 0;
const used = new Set();
for (let k = 0; k < WANT; k++) {
  let best = null;
  for (const x of cands) {
    const key = x.r + ',' + x.c;
    if (used.has(key)) continue;
    const tmp = clone(cur);
    if (!toPipe(tmp, x.r, x.c)) continue;
    const m = quick(tmp), sc = scoreOf(m);
    if (!best || sc > best.sc || (sc === best.sc && m.midRatio > best.m.midRatio)) best = { sc, m, g: tmp, key, r: x.r, c: x.c };
  }
  if (!best) break;
  if (best.sc < curS) { console.log(`  第 ${k + 1} 个管道会让通过项从 ${curS} 掉到 ${best.sc}，停止`); break; }
  cur = best.g; curM = best.m; curS = best.sc; used.add(best.key); added++;
  console.log(`  加管道 @(${best.r},${best.c}) → 通过${curS}/7 峰${curM.peak} 中${Math.round(curM.midRatio * 100)}% 后${curM.tail3}`);
}
fs.writeFileSync(OUT, JSON.stringify(cur));
let pipes = 0;
for (const row of cur.spools) for (const s of row) { if (!s) continue; const t = Array.isArray(s.type) ? s.type : [s.type || 0]; if (t.some(x => x >= 11 && x <= 14)) pipes++; }
console.log(`结果：加 ${added} 个管道（棋盘上共 ${pipes} 个）→ ${OUT}`);
