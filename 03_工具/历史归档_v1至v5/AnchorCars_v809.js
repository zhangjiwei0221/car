#!/usr/bin/env node
'use strict';
/**
 * AnchorCars_v809 —— 保底车布局
 *
 * 背景（2026-11-04 用户）：实测 00011 步 6-11 连续 6 步"一辆能吃满的都没有"，
 * 玩家被迫连背三个债，很难受。根因是边框上摊着的车容量都太大（吃不满）。
 *
 * 做法：把容量最小的 N 辆车挪到"棋盘边框"（其他车换进内部）。
 *       小车容易吃满 → 每几步总有一辆能吃满 → 不会连续被逼。
 *       每次挪动都复测，指标变差不挪。
 *
 * 用法：node AnchorCars_v809.js <关卡.json> --out 结果.json [--count 4]
 */
const fs = require('fs');
const B = require('./Build006Thickness_v688');
const A = B.loadSolver('corner');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const FILE = process.argv.slice(2).find(a => a.endsWith('.json') && !a.startsWith('--'));
const OUT = arg('--out', '/tmp/anchor.json');
const WANT = Number(arg('--count', 4));

const clone = o => JSON.parse(JSON.stringify(o));
const g = B.readJson(FILE);
const rows = g.spools.length, cols = g.spools[0].length;
const isEdge = (r, c) => r === 0 || c === 0 || r === rows - 1 || c === cols - 1;

function quick(gg) {
  const lv = A.parseLevel(A.fromGameFormat(gg));
  const o = A.Solver.runSolver(lv, 0, 1, false, false, { capturePreviewStats: true, instantChain: false });
  const buf = (Array.isArray(o.stepBufferHistory) && o.stepBufferHistory.length) ? o.stepBufferHistory : (o.pressureSamples || []).map(s => s.buf || 0);
  const L = buf.length, e = Math.max(1, Math.round(L * 0.1)), t = Math.floor(L * 0.8);
  const mid = buf.slice(e, t);
  return { won: !!o.completed, peak: Math.max(0, ...buf), midRatio: mid.length ? mid.filter(v => v >= 3).length / mid.length : 0, tail3: buf.slice(t).filter(v => v >= 3).length };
}
const score = m => (m.won ? 1 : 0) + (m.peak === 4 ? 1 : 0) + (m.midRatio >= 0.45 && m.midRatio <= 0.8 ? 1 : 0) + (m.tail3 >= 2 ? 1 : 0);

const base = quick(g), baseS = score(base);
console.log(`基线：通过 ${baseS}/4 | 峰${base.peak} 中${Math.round(base.midRatio * 100)}% 后${base.tail3}`);

// 找容量最小的车（优先内部的）
const small = [];
for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
  const s = g.spools[r][c];
  if (!s || !(s.id > 0)) continue;
  const tt = Array.isArray(s.type) ? s.type : [s.type || 0];
  if (tt.includes(5) || tt.includes(7) || tt.includes(6) || s.q || tt.some(x => x >= 11 && x <= 14)) continue;
  small.push({ r, c, s, count: s.count, edge: isEdge(r, c) });
}
small.sort((a, b) => a.count - b.count);
let cur = clone(g), moved = 0;
for (let i = 0; i < WANT; i++) {
  const pick = small.find(x => !x.edge) || small[i];
  if (!pick) break;
  // 找一个边框上的"普通车"位置来交换
  let spot = null;
  for (let r = 0; r < rows && !spot; r++) for (let c = 0; c < cols && !spot; c++) {
    if (!isEdge(r, c)) continue;
    const t = cur.spools[r][c];
    if (!t || !(t.id > 0)) continue;
    const tt = Array.isArray(t.type) ? t.type : [t.type || 0];
    if (tt.includes(5) || tt.includes(7) || tt.includes(6) || t.q) continue;
    if (t.count <= pick.count) continue;   // 只把更大的换进去
    spot = [r, c];
  }
  if (!spot) break;
  const tmp = clone(cur);
  const a = tmp.spools[pick.r][pick.c], b = tmp.spools[spot[0]][spot[1]];
  tmp.spools[pick.r][pick.c] = b; tmp.spools[spot[0]][spot[1]] = a;
  const m = quick(tmp), sc = score(m);
  if (sc < baseS) { console.log(`  第 ${i + 1} 辆（容量${pick.count}）会让通过掉到 ${sc}/4，停`); break; }
  cur = tmp; moved++;
  pick.edge = true;
  console.log(`  小车(容量${pick.count}) → 边框(${spot[0]},${spot[1]}) | 通过${sc}/4 峰${m.peak} 中${Math.round(m.midRatio * 100)}%`);
}
fs.writeFileSync(OUT, JSON.stringify(cur));
console.log(`结果：挪了 ${moved} 辆保底车 → ${OUT}`);
