// PipeQueue_v728.js —— 管道串行：把两辆相邻的车变成“一条队列”，强制 A 先于 B 出现
// 原理：管道 = 队列发盒器（前方空一格才吐下一个球）；把 A、B 两辆车的容量搬进队列，
//       A 在队首 → 必须先出 A；A 被取走、格子空出来，B 才出现。
// 用法：node PipeQueue_v728.js <关卡.json> --out <输出.json> [--try 40]
'use strict';
const fs = require('fs');
const B = require('./03_工具/正式版/Build006Thickness_v688'.replace('03_工具/正式版/', ''));
const A = B.loadSolver();
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const FILE = process.argv[2];
const OUT = arg('--out', '/tmp/pipequeue.json');
const TRY = Number(arg('--try', 40));

function evalLv(g) {
  const lv = A.parseLevel(A.fromGameFormat(g));
  const o = A.Solver.runSolver(lv, 0, 1, false, false, { capturePreviewStats: true, instantChain: true });
  const buf = (o.pressureSamples || []).map(s => s.buf || 0);
  let at4 = 0, run4 = 0, cur = 0;
  for (const v of buf) { if (v >= 4) { cur++; at4++; run4 = Math.max(run4, cur); } else cur = 0; }
  const first = {};
  (o.pickOrder || []).forEach((p, i) => { if (first[p.color] === undefined) first[p.color] = i + 1; });
  return { won: !!o.completed, peak: Math.max(0, ...buf), at4, run4, steps: buf.length, first, order: o.pickOrder || [] };
}

const base = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const R = base.spools.length, C = base.spools[0].length;
const b0 = evalLv(base);
const sum0 = base.spools.flat().filter(c => c.id > 0).reduce((a, c) => a + c.count, 0);
console.log(`基线：步${b0.steps} 峰值${b0.peak} at4=${b0.at4} run4=${b0.run4} 容量和=${sum0}`);

const DIRS = { 11: [-1, 0], 12: [1, 0], 13: [0, -1], 14: [0, 1] }; // 与 AntSolver.PIPE_DIRS 对齐（上/下/左/右）
const isPlain = (x) => x.id > 0 && (x.type === 0 || x.type === '0');
const isEmpty = (x) => !x || x.id <= 0 || x.id === -1;

// 候选：相邻两辆普通车 (A,B)，其中 A 的位置能朝空方向吐
const cands = [];
for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
  const a = base.spools[r][c];
  if (!isPlain(a)) continue;
  for (const [dr, dc] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
    const nr = r + dr, nc = c + dc;
    if (nr < 0 || nr >= R || nc < 0 || nc >= C) continue;
    const b = base.spools[nr][nc];
    if (!isPlain(b) || b.id === a.id) continue;
    // 管道方向：优先朝空处；否则朝任意未占用的邻格（等它被取走后才会吐）
    let pipeType = null, fallbackDir = null;
    for (const [t, [dy, dx]] of Object.entries(DIRS)) {
      const er = r + dy, ec = c + dx;
      if (er < 0 || er >= R || ec < 0 || ec >= C) continue;
      if (er === nr && ec === nc) continue;           // 不能朝 B（B 会被清空成黑格）
      const e = base.spools[er][ec];
      if (isEmpty(e) && pipeType === null) pipeType = Number(t);
      if (fallbackDir === null) fallbackDir = Number(t);
    }
    if (pipeType === null) pipeType = fallbackDir;
    if (!pipeType) continue;
    cands.push({ a: { r, c, color: a.id, count: a.count }, b: { r: nr, c: nc, color: b.id, count: b.count }, pipeType });
  }
}
console.log(`候选对 ${cands.length}，试前 ${Math.min(TRY, cands.length)} 组`);

let best = null;
for (const cand of cands.slice(0, TRY)) {
  const h = JSON.parse(JSON.stringify(base));
  // A 位置变成管道，队列 = [A, B]；B 位置空出（黑格）
  h.spools[cand.a.r][cand.a.c] = { id: 0, type: cand.pipeType, param: [{ id: cand.a.color, count: cand.a.count }, { id: cand.b.color, count: cand.b.count }], count: 0 };
  h.spools[cand.b.r][cand.b.c] = { id: -1, type: 0, param: 0, count: 0 };
  const sum = h.spools.flat().filter(c => c.id > 0).reduce((a, c) => a + (c.count || 0), 0)
    + h.spools.flat().filter(c => Array.isArray(c.param)).reduce((a, c) => a + c.param.reduce((x, p) => x + p.count, 0), 0);
  if (sum !== sum0) continue;                       // 守恒检查
  let e; try { e = evalLv(h); } catch (err) { continue; }
  if (!e.won || e.peak > 4) continue;
  const fa = e.first[cand.a.color] || 99, fb = e.first[cand.b.color] || 99;
  if (!(fb > fa)) continue;                          // 串行未成立
  const score = (fb - fa) + (e.at4 - b0.at4) * 0.5;
  if (!best || score > best.score) best = { score, cand, e, level: h, fa, fb };
}

if (!best) { console.log('没有可行组合（守恒/可解/串行 三者不同时满足）'); process.exit(0); }
console.log(`最佳：管道 ${best.cand.a.r},${best.cand.a.c}（色${best.cand.a.color}→色${best.cand.b.color}）`);
console.log(`  串行：A 首用第 ${best.fa} 步，B 首用第 ${best.fb} 步（差 ${best.fb - best.fa} 步）`);
console.log(`  指标：at4 ${b0.at4}→${best.e.at4}，run4 ${b0.run4}→${best.e.run4}，峰值 ${best.e.peak}`);
fs.writeFileSync(OUT, JSON.stringify(best.level, null, 2));
console.log('已写出：' + OUT);
