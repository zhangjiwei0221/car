#!/usr/bin/env node
'use strict';
/**
 * ObstacleBudget_v770 —— 障碍预算：保证每关"障碍够多"
 *
 * 用户 2026-11-02：
 *   · 每关保底：链 ≥2 组、冰 ≥6；棋盘**不允许空**（管道会留空格 → 默认不用管道）
 *   · 新增障碍必须不让"被迫欠债"变差太多
 *
 * 用法：node ObstacleBudget_v770.js <关卡.json> --out 结果.json
 *        [--chain-groups 2] [--ice 6] [--ice-delay 6]
 */
const fs = require('fs');
const B = require('./Build006Thickness_v688');
const A = B.loadSolver('corner');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const FILE = process.argv.slice(2).find(a => !a.startsWith('--') && !['--out', '--chain-groups', '--ice', '--ice-delay', '--ice-delay-bottom'].includes(process.argv[process.argv.indexOf(a) - 1]));
const OUT = arg('--out', '/tmp/budget.json');
const MIN_CHAIN = Number(arg('--chain-groups', 2));
const MIN_ICE = Number(arg('--ice', 6));
const DELAY = Number(arg('--ice-delay', 6));
const DELAY_B = Number(arg('--ice-delay-bottom', 10));

function analyze(g) {
  const o = A.Solver.runSolver(A.parseLevel(A.fromGameFormat(g)), 0, 1, false, false, { capturePreviewStats: true, instantChain: false });
  const H = g.blocks.length, W = g.blocks[0].length, rows = g.spools.length, cols = g.spools[0].length;
  const col = g.blocks.map(r => r.slice()), gone = g.blocks.map(r => r.map(() => false));
  const reach = (y, x) => (y === 0 || x === 0 || y === H - 1 || x === W - 1) || gone[y - 1][x] || gone[y + 1][x] || gone[y][x - 1] || gone[y][x + 1];
  const picks = (o.pickOrder || []).filter(p => p.chainIndex === 0);
  const taken = new Set(); let forced = 0;
  for (const p of picks) {
    const cnt = {};
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { if (gone[y][x] || !reach(y, x)) continue; const c = col[y][x]; cnt[c] = (cnt[c] || 0) + 1; }
    let canFill = 0;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const s = g.spools[r][c];
      if (!s || !(s.id > 0) || taken.has(r + ',' + c) || s.q) continue;
      if ((cnt[s.id] || 0) >= s.count) canFill++;
    }
    if (canFill === 0) forced++;
    const c0 = p.color, list = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { if (gone[y][x] || col[y][x] !== c0 || !reach(y, x)) continue; list.push([(H - 1 - y) + x, y, x]); }
    list.sort((a, b) => a[0] - b[0]);
    let n = 0; for (const [d, y, x] of list) { if (n >= p.count) break; gone[y][x] = true; n++; }
    taken.add(p.r + ',' + p.c);
  }
  const buf = (o.pressureSamples || []).map(s => s.buf || 0);
  let empty = 0, ice = 0, black = 0, pipe = 0;
  const groups = new Set();
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const s = g.spools[r][c];
    const t = s ? (Array.isArray(s.type) ? s.type : [s.type || 0]) : [];
    if (s && s.id === -1) { black++; continue; }
    if (t.some(x => x >= 11 && x <= 14)) { pipe++; continue; }
    if (!s || !s.id || s.id <= 0) { empty++; continue; }
    if (t.includes(7)) ice++;
    if (t.includes(5)) groups.add(s.param);
  }
  return { forced, steps: picks.length, ice, chainGroups: groups.size, empty, black, pipe,
           peak: Math.max(0, ...buf), won: !!o.completed };
}

let g = B.readJson(FILE);
let m = analyze(g);
console.log(`基线：被迫欠债 ${m.forced}/${m.steps}(${Math.round(100*m.forced/m.steps)}%) | 链组 ${m.chainGroups} | 冰 ${m.ice} | 空格 ${m.empty} | 峰值 ${m.peak} | 可通 ${m.won}`);

// ① 补链：找相邻的普通车配对成组
const rows = g.spools.length, cols = g.spools[0].length;
function isPlain(s) {
  if (!s || !(s.id > 0)) return false;
  const t = Array.isArray(s.type) ? s.type : [s.type || 0];
  return !t.includes(5) && !t.includes(7);
}
let nextGroup = 1;
for (const row of g.spools) for (const s of row) {
  if (!s) continue;
  const t = Array.isArray(s.type) ? s.type : [s.type || 0];
  if (t.includes(5)) nextGroup = Math.max(nextGroup, (s.param || 0) + 1);
}
while (m.chainGroups < MIN_CHAIN) {
  let done = false;
  outer:
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (!isPlain(g.spools[r][c])) continue;
    for (const [dr, dc] of [[0, 1], [1, 0]]) {
      const r2 = r + dr, c2 = c + dc;
      if (r2 >= rows || c2 >= cols) continue;
      if (!isPlain(g.spools[r2][c2])) continue;
      const a = g.spools[r][c], b = g.spools[r2][c2];
      const oldA = { type: a.type, param: a.param }, oldB = { type: b.type, param: b.param };
      a.type = 5; a.param = nextGroup; b.type = 5; b.param = nextGroup;
      const m2 = analyze(g);
      if (m2.won && m2.peak <= 4 && m2.empty === m.empty && m2.forced >= m.forced - 2) {
        m = m2; nextGroup++; done = true;
        console.log(`  加链组 #${nextGroup - 1}：(${r},${c})+(${r2},${c2}) → 被迫欠债 ${m.forced}、链组 ${m.chainGroups}`);
        break outer;
      }
      a.type = oldA.type; a.param = oldA.param; b.type = oldB.type; b.param = oldB.param;
    }
  }
  if (!done) { console.log('  ⚠ 找不到可加的链组'); break; }
}

// ② 补冰（复用 IceFill 的逻辑：避开开局车、底层用大数字、只在不变差时保留）
const o0 = A.Solver.runSolver(A.parseLevel(A.fromGameFormat(g)), 0, 1, false, false, { capturePreviewStats: true, instantChain: false });
const early = new Set(); const nat = new Map();
const limit = Math.round((o0.pressureSamples || []).length * 0.2);
for (const p of (o0.pickOrder || [])) { nat.set(p.r + ',' + p.c, p.step); if (p.step <= limit) early.add(p.r + ',' + p.c); }
const totalSteps = (o0.pressureSamples || []).length;
const cands = [];
for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
  const s = g.spools[r][c];
  if (!isPlain(s)) continue;
  if (early.has(r + ',' + c)) continue;
  cands.push({ r, c, count: s.count, bottom: r >= rows - 2 });
}
cands.sort((a, b) => a.count - b.count);
let added = 0;
for (const cd of cands) {
  if (m.ice >= MIN_ICE) break;
  const cell = g.spools[cd.r][cd.c];
  const old = { type: cell.type, param: cell.param };
  const natStep = nat.get(cd.r + ',' + cd.c) || 1;
  const want = Math.max(1, Math.min(totalSteps - 1, natStep + (cd.bottom ? DELAY_B : DELAY)));
  cell.type = 7; cell.param = want;
  const m2 = analyze(g);
  if (m2.won && m2.peak <= 4 && m2.empty === m.empty && m2.forced >= m.forced - 2) { m = m2; added++; continue; }
  cell.type = old.type; cell.param = old.param;
}
console.log(`  加冰 ${added} 块 → 冰 ${m.ice}`);
fs.writeFileSync(OUT, JSON.stringify(g));
console.log(`结果：被迫欠债 ${m.forced}/${m.steps}(${Math.round(100*m.forced/m.steps)}%) | 链组 ${m.chainGroups} | 冰 ${m.ice} | 空格 ${m.empty} | 峰值 ${m.peak} | 可通 ${m.won}`);
console.log('已写入', OUT);
