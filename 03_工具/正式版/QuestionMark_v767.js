#!/usr/bin/env node
'use strict';
/**
 * QuestionMark_v767 —— 给「玩家确定能吃满」的车加问号（隐藏颜色）
 *
 * 逻辑（用户 2026-11-02）：
 *   问号只隐藏颜色，不改局面、不影响可解性；
 *   优先给"当时能一口吃满"的车加，让玩家失去确定性 → 感受压力。
 *
 * 用法：node QuestionMark_v767.js <关卡.json> --out 结果.json [--ratio 0.12] [--lo 0.3] [--hi 0.8]
 */
const fs = require('fs');
const B = require('./Build006Thickness_v688');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const FILE = process.argv.slice(2).find(a => !a.startsWith('--') && !['--out', '--ratio', '--lo', '--hi', '--ref'].includes(process.argv[process.argv.indexOf(a) - 1]));
const OUT = arg('--out', '/tmp/qmark.json');
const RATIO = Number(arg('--ratio', 0.12));
const LO = Number(arg('--lo', 0.3));
const HI = Number(arg('--hi', 0.8));
const REF = String(arg('--ref', 'corner'));
const A = B.loadSolver(REF);

function analyze(g) {
  const lv = A.parseLevel(A.fromGameFormat(g));
  const o = A.Solver.runSolver(lv, 0, 1, false, false, { capturePreviewStats: true, instantChain: false });
  const H = g.blocks.length, W = g.blocks[0].length;
  const col = g.blocks.map(r => r.slice());
  const gone = g.blocks.map(r => r.map(() => false));
  const rows = g.spools.length, cols = g.spools[0].length;
  const reach = (y, x) => (y === 0 || x === 0 || y === H - 1 || x === W - 1) ||
    gone[y - 1][x] || gone[y + 1][x] || gone[y][x - 1] || gone[y][x + 1];
  const picks = (o.pickOrder || []).filter(p => p.chainIndex === 0);
  const N = picks.length || 1;
  const fillableCount = new Map();   // "r,c" → 在多少步里"能一口吃满"
  const taken = new Set();
  let certSum = 0, certMid = 0, midSteps = 0;
  for (let i = 0; i < picks.length; i++) {
    const p = picks[i];
    const cnt = {};
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (gone[y][x] || !reach(y, x)) continue;
      const c = col[y][x]; cnt[c] = (cnt[c] || 0) + 1;
    }
    let cert = 0;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const s = g.spools[r][c];
      if (!s || !(s.id > 0) || taken.has(r + ',' + c)) continue;
      const isFill = (cnt[s.id] || 0) >= s.count;
      if (isFill) {
        cert++;
        if (!s.q) fillableCount.set(r + ',' + c, (fillableCount.get(r + ',' + c) || 0) + 1);
        if (s.q) { /* 已标记的不算确定 */ }
      }
    }
    // 计算「确定能吃满」= 能吃满且没问号
    let certNoQ = 0;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const s = g.spools[r][c];
      if (!s || !(s.id > 0) || taken.has(r + ',' + c) || s.q) continue;
      if ((cnt[s.id] || 0) >= s.count) certNoQ++;
    }
    certSum += certNoQ;
    const frac = i / N;
    if (frac >= 0.45 && frac <= 0.55) { certMid += certNoQ; midSteps++; }
    const c0 = p.color;
    const list = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (gone[y][x] || col[y][x] !== c0 || !reach(y, x)) continue;
      list.push([(H - 1 - y) + x, y, x]);
    }
    list.sort((a, b) => a[0] - b[0]);
    let n = 0;
    for (const [d, y, x] of list) { if (n >= p.count) break; gone[y][x] = true; n++; }
    taken.add(p.r + ',' + p.c);
  }
  const buf = (o.pressureSamples || []).map(s => s.buf || 0);
  let a4 = 0; for (const v of buf) if (v >= 4) a4++;
  return { o, buf, a4, peak: Math.max(0, ...buf), won: !!o.completed, fillableCount,
           certAvg: certSum / N, certMidAvg: certMid / (midSteps || 1) };
}

const g = B.readJson(FILE);
const base = analyze(g);
console.log(`基线：确定能吃满 中段 ${base.certMidAvg.toFixed(1)} 辆 / 全程 ${base.certAvg.toFixed(1)} | at4=${base.a4} 峰值=${base.peak} 可通=${base.won}`);

// 候选：在中段频繁"能一口吃满"的普通车
const rows = g.spools.length, cols = g.spools[0].length;
const cands = [];
for (const [key, n] of base.fillableCount) {
  const [r, c] = key.split(',').map(Number);
  const s = g.spools[r][c];
  if (!s || !(s.id > 0)) continue;
  const t = Array.isArray(s.type) ? s.type : [s.type || 0];
  if (t.includes(5) || t.includes(7)) continue;   // 锁链/冰不动
  if (s.q) continue;
  cands.push({ r, c, n });
}
cands.sort((a, b) => b.n - a.n);
const want = Math.max(1, Math.round(cands.length * RATIO));
const pick = cands.slice(0, want);
for (const p of pick) g.spools[p.r][p.c].q = true;

const after = analyze(g);
fs.writeFileSync(OUT, JSON.stringify(g));
console.log(`加问号 ${pick.length} 辆（占候选 ${(RATIO * 100).toFixed(0)}%）→ 确定能吃满 中段 ${after.certMidAvg.toFixed(1)} 辆 / 全程 ${after.certAvg.toFixed(1)}`);
console.log(`可通=${after.won} 峰值=${after.peak} at4=${after.a4}`);
console.log('已写入', OUT);
