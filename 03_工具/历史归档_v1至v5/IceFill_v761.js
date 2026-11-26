#!/usr/bin/env node
'use strict';
/**
 * IceFill_v761 —— 按「配额」补冰（不追求指标收益，只增加障碍厚度）
 *
 * 规则（用户 2026-11-02）：
 *   · 加冰对结果影响不大时，允许补 5–6 块；
 *   · 加在「暂时用不到的小车」上：容量小、且不在前 20% 被取；
 *   · **不加在棋盘底层**（已暴露得晚，加了没意义）；
 *   · 数字取小值（默认 8–12 手）。
 *
 * 用法：node IceFill_v761.js <关卡.json> --out 结果.json [--count 6] [--param 8]
 */
const fs = require('fs');
const B = require('./Build006Thickness_v688');
const A = B.loadSolver((() => { const i = process.argv.indexOf('--ref'); return i > 0 ? process.argv[i + 1] : 'corner'; })());
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const FILE = process.argv.slice(2).find(a => !a.startsWith('--') && !['--out', '--count', '--param', '--ref'].includes(process.argv[process.argv.indexOf(a) - 1]));
const OUT = arg('--out', '/tmp/icefill.json');
const COUNT = Number(arg('--count', 6));
const BOTTOM_ROWS = 2;      // 棋盘最后 2 行 = 底层：可以加，但数字要大（用户 2026-11-02）
// 延迟量（手）：冰的数字 = 该车自然手数 + 延迟
const DELAY = Number((() => { const i = process.argv.indexOf('--delay'); return i > 0 ? process.argv[i + 1] : 6; })());
const DELAY_BOTTOM = Number((() => { const i = process.argv.indexOf('--delay-bottom'); return i > 0 ? process.argv[i + 1] : 10; })());

function metrics(g) {
  const o = A.Solver.runSolver(A.parseLevel(A.fromGameFormat(g)), 0, 1, false, false, { capturePreviewStats: true, instantChain: false });
  const buf = (o.pressureSamples || []).map(s => s.buf || 0);
  let a4 = 0, c = 0, r = 0;
  for (const v of buf) { if (v >= 4) { c++; a4++; r = Math.max(r, c); } else c = 0; }
  const n = buf.length, b0 = Math.round(n * 0.8);
  const late4 = buf.slice(b0).filter(v => v >= 4).length;
  const early3 = buf.slice(0, Math.round(n * 0.2)).filter(v => v >= 3).length;
  return { a4, run4: r, late4, early3, peak: Math.max(0, ...buf), won: !!o.completed, steps: n,
           score: a4 + 2 * late4 + r };
}

const base = B.readJson(FILE);
const m0 = metrics(base);
console.log(`基线：at4=${m0.a4} run4=${m0.run4} 峰值=${m0.peak} 可通=${m0.won}`);

// 1) 求每辆车的"自然手数"（不加冰时它第几手被取）与前 20% 用到的车
const o0 = A.Solver.runSolver(A.parseLevel(A.fromGameFormat(base)), 0, 1, false, false, { capturePreviewStats: true, instantChain: false });
const early = new Set();
const naturalStep = new Map();          // "r,c" → 自然手数
const limit = Math.round((o0.pressureSamples || []).length * 0.2);
for (const p of (o0.pickOrder || [])) {
  naturalStep.set(p.r + ',' + p.c, p.step);
  if (p.step <= limit) early.add(p.r + ',' + p.c);
}
const totalSteps = (o0.pressureSamples || []).length;

// 2) 候选：普通车、不在底层、不在前 20%、容量偏小
const rows = base.spools.length;
const cands = [];
for (let r = 0; r < rows; r++) for (let c = 0; c < base.spools[r].length; c++) {
  const s = base.spools[r][c];
  if (!s || !(s.id > 0)) continue;
  const t = Array.isArray(s.type) ? s.type : [s.type || 0];
  if (t.includes(5) || t.includes(7)) continue;
  const bottom = r >= rows - BOTTOM_ROWS;             // 底层：可以加，但用大数字
  if (early.has(r + ',' + c)) continue;               // 前 20% 用得到的不加
  cands.push({ r, c, count: s.count, score: s.count, bottom }); // 容量小的优先
}
cands.sort((a, b) => a.score - b.score);

// 3) 逐个尝试加冰，保证可通关且指标不明显变差
const g = JSON.parse(JSON.stringify(base));
let added = 0;
for (const cd of cands) {
  if (added >= COUNT) break;
  const cell = g.spools[cd.r][cd.c];
  const old = { type: cell.type, param: cell.param };
  // 数字 = 这辆车的自然手数 + 延迟；底层（本来就很晚）额外加 DELAY_BOTTOM
  const nat = naturalStep.get(cd.r + ',' + cd.c) || 1;
  const want = nat + (cd.bottom ? DELAY_BOTTOM : DELAY);
  cell.type = 7; cell.param = Math.max(1, Math.min(totalSteps - 1, want));
  const m = metrics(g);
  // 接受条件：可通关、峰值≤4、复合分不降、前期高压不增加（否则回退）
  if (m.won && m.peak <= 4 && m.score >= m0.score - 1 && m.early3 <= m0.early3) { added++; continue; }
  cell.type = old.type; cell.param = old.param;      // 回退
}
const m1 = metrics(g);
fs.writeFileSync(OUT, JSON.stringify(g));
console.log(`加冰 ${added} 块（数字=自然手数+${DELAY}，底层+${DELAY_BOTTOM}）→ at4=${m1.a4} run4=${m1.run4} 峰值=${m1.peak} 可通=${m1.won}`);
console.log('已写入', OUT);
