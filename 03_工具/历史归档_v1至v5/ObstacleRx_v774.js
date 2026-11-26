#!/usr/bin/env node
'use strict';
/**
 * ObstacleRx_v774 —— 障碍"对症下药"
 *
 * 用户 2026-11-02：
 *   「做不到障碍的选择有道理」—— 取消配额，每加一个障碍都必须治一个具体症状。
 *
 * 症状 → 药：
 *   S1 前段被迫欠债 > 1      → 冰（把开局车推后）
 *   S2 后段被迫欠债 < 3      → 三连锁（一次取 3 盒的"难度炸弹"）
 *   S3 全程可吃满率 > 55%    → 问号（不看颜色 → 免费车变少）
 *
 * 每味药加完都要复测，症状没好就撤掉。
 *
 * 用法：node ObstacleRx_v774.js <关卡.json> --out 结果.json
 */
const fs = require('fs');
const B = require('./Build006Thickness_v688');
const A = B.loadSolver('corner');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const FILE = process.argv.slice(2).find(a => !a.startsWith('--') && !['--out', '--ref'].includes(process.argv[process.argv.indexOf(a) - 1]));
const OUT = arg('--out', '/tmp/rx.json');

function measure(g) {
  const o = A.Solver.runSolver(A.parseLevel(A.fromGameFormat(g)), 0, 1, false, false, { capturePreviewStats: true, instantChain: false });
  const H = g.blocks.length, W = g.blocks[0].length, rows = g.spools.length, cols = g.spools[0].length;
  const col = g.blocks.map(r => r.slice()), gone = g.blocks.map(r => r.map(() => false));
  const reach = (y, x) => (y === 0 || x === 0 || y === H - 1 || x === W - 1) || gone[y - 1][x] || gone[y + 1][x] || gone[y][x - 1] || gone[y][x + 1];
  const picks = (o.pickOrder || []).filter(p => p.chainIndex === 0);
  const taken = new Set(); const per = [];
  for (const p of picks) {
    const cnt = {};
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { if (gone[y][x] || !reach(y, x)) continue; const c = col[y][x]; cnt[c] = (cnt[c] || 0) + 1; }
    let fill = 0, avail = 0;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const s = g.spools[r][c];
      if (!s || !(s.id > 0) || taken.has(r + ',' + c)) continue;
      avail++;
      if (!s.q && (cnt[s.id] || 0) >= s.count) fill++;
    }
    per.push({ fill, avail });
    const c0 = p.color, list = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { if (gone[y][x] || col[y][x] !== c0 || !reach(y, x)) continue; list.push([(H - 1 - y) + x, y, x]); }
    list.sort((a, b) => a[0] - b[0]);
    let n = 0; for (const [d, y, x] of list) { if (n >= p.count) break; gone[y][x] = true; n++; }
    taken.add(p.r + ',' + p.c);
  }
  const N = per.length || 1;
  const early = per.slice(0, Math.max(1, Math.floor(N * 0.2)));
  const tail = per.slice(Math.floor(N * 0.8));
  let empty = 0, sum = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const s = g.spools[r][c];
    const t = s ? (Array.isArray(s.type) ? s.type : [s.type || 0]) : [];
    if (t.some(x => x >= 11 && x <= 14)) { (Array.isArray(s.param) ? s.param : []).forEach(b => sum += (b.count || 0)); continue; }
    if (s && s.id === -1) continue;
    if (!s || !s.id || s.id <= 0) { empty++; continue; }
    sum += s.count;
  }
  const buf = (o.pressureSamples || []).map(s => s.buf || 0);
  const fillRatio = per.reduce((s, x) => s + (x.avail ? x.fill / x.avail : 0), 0) / N;
  return {
    steps: N,
    forcedEarly: early.filter(x => x.fill === 0).length,
    forcedTail: tail.filter(x => x.fill === 0).length,
    forced: per.filter(x => x.fill === 0).length,
    fillRatio, peak: Math.max(0, ...buf), won: !!o.completed, empty, sum, px: g.blocks.flat().length
  };
}

const ok = m => m.won && m.peak <= 4 && m.empty === 0 && m.sum === m.px;
function chainGroups(g) {
  const s = new Set();
  for (const row of g.spools) for (const c of row) {
    const t = c ? (Array.isArray(c.type) ? c.type : [c.type || 0]) : [];
    if (t.includes(5)) s.add(c.param);
  }
  return s.size;
}
function nextGroup(g) {
  let n = 1;
  for (const row of g.spools) for (const c of row) {
    const t = c ? (Array.isArray(c.type) ? c.type : [c.type || 0]) : [];
    if (t.includes(5)) n = Math.max(n, (c.param || 0) + 1);
  }
  return n;
}
const isPlain = s => {
  if (!s || !(s.id > 0)) return false;
  const t = Array.isArray(s.type) ? s.type : [s.type || 0];
  return !t.includes(5) && !t.includes(7) && !s.q;
};

let g = B.readJson(FILE);
let m = measure(g);
console.log(`基线：步${m.steps} 被迫欠债 ${Math.round(100*m.forced/m.steps)}% | 前段 ${m.forcedEarly} | 后段 ${m.forcedTail} | 可吃满率 ${Math.round(m.fillRatio*100)}% | 峰值 ${m.peak} | 空格 ${m.empty}`);
const log = [];

// S1 前段过压 → 冰
if (m.forcedEarly > 1) {
  const rows = g.spools.length, cols = g.spools[0].length;
  const o0 = A.Solver.runSolver(A.parseLevel(A.fromGameFormat(g)), 0, 1, false, false, { capturePreviewStats: true, instantChain: false });
  const early = new Set();
  const lim = Math.round((o0.pressureSamples || []).length * 0.2);
  for (const p of (o0.pickOrder || [])) if (p.step <= lim) early.add(p.r + ',' + p.c);
  let added = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const s = g.spools[r][c];
    if (!isPlain(s) || early.has(r + ',' + c)) continue;
    const old = { type: s.type, param: s.param };
    s.type = 7; s.param = Math.min(m.steps - 1, (o0.pickOrder || []).filter(p => p.r === r && p.c === c).map(p => p.step)[0] || 8);
    const m2 = measure(g);
    if (ok(m2) && m2.forcedEarly < m.forcedEarly) { m = m2; added++; }
    else { s.type = old.type; s.param = old.param; }
    if (m.forcedEarly <= 1) break;
  }
  log.push(`S1 前段过压 → 加冰 ${added} 块（前段 ${m.forcedEarly}）`);
}

// S0 峰值不足 → 三连锁（一次取 3 盒，最能顶峰值）
if (m.peak < 4) {
  const rows = g.spools.length, cols = g.spools[0].length;
  let added = 0;
  outer0:
  for (let r = 0; r < rows; r++) for (let c = 0; c + 2 < cols; c++) {
    const trio = [[r, c], [r, c + 1], [r, c + 2]];
    if (!trio.every(([y, x]) => isPlain(g.spools[y][x]))) continue;
    const grp = nextGroup(g);
    const old = trio.map(([y, x]) => ({ type: g.spools[y][x].type, param: g.spools[y][x].param }));
    trio.forEach(([y, x]) => { g.spools[y][x].type = 5; g.spools[y][x].param = grp; });
    const m2 = measure(g);
    if (ok(m2) && m2.peak >= 4) { m = m2; added++; log.push(`S0 峰值不足(${m.peak}) → 加三连锁 组${grp} @(${r},${c}) → 峰值 ${m.peak}`); break outer0; }
    trio.forEach(([y, x], i) => { g.spools[y][x].type = old[i].type; g.spools[y][x].param = old[i].param; });
  }
  if (!added) log.push(`S0 峰值不足(${m.peak}) → 三连锁也顶不上去`);
}

// S2 后段不足 → 三连锁
if (m.forcedTail < 3) {
  const rows = g.spools.length, cols = g.spools[0].length;
  let added = 0;
  outer:
  for (let r = 0; r < rows; r++) for (let c = 0; c + 2 < cols; c++) {
    const trio = [[r, c], [r, c + 1], [r, c + 2]];
    if (!trio.every(([y, x]) => isPlain(g.spools[y][x]))) continue;
    const grp = nextGroup(g);
    const old = trio.map(([y, x]) => ({ type: g.spools[y][x].type, param: g.spools[y][x].param }));
    trio.forEach(([y, x]) => { g.spools[y][x].type = 5; g.spools[y][x].param = grp; });
    const m2 = measure(g);
    if (ok(m2) && m2.forcedTail > m.forcedTail) { m = m2; added++; log.push(`S2 后段不足 → 加三连锁 组${grp} @(${r},${c})（后段 ${m.forcedTail}）`); break outer; }
    trio.forEach(([y, x], i) => { g.spools[y][x].type = old[i].type; g.spools[y][x].param = old[i].param; });
  }
  if (!added) log.push('S2 后段不足 → 没有可加的三连锁（或加了无效）');
}

// S3 免费车太多 → 问号
if (m.fillRatio > 0.55) {
  const rows = g.spools.length, cols = g.spools[0].length;
  const order = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (isPlain(g.spools[r][c])) order.push([r, c]);
  let added = 0;
  for (const [r, c] of order) {
    if (added >= Math.max(2, Math.round(order.length * 0.12))) break;
    { const ss = g.spools[r][c]; ss.q = true; const tt = Array.isArray(ss.type) ? ss.type.slice() : (ss.type ? [ss.type] : []); if (!tt.includes(6)) tt.push(6); ss.type = tt; }
    const m2 = measure(g);
    if (ok(m2) && m2.fillRatio < m.fillRatio) { m = m2; added++; }
    else { g.spools[r][c].q = false; }
  }
  log.push(`S3 免费车太多 → 加问号 ${added} 个（可吃满率 ${Math.round(m.fillRatio*100)}%）`);
}

// S4 全程被迫欠债不足 → 问号（专挑"最常能吃满"的车，让它们变得不确定）
if (m.forced / m.steps < 0.30) {
  const rows = g.spools.length, cols = g.spools[0].length, H = g.blocks.length, W = g.blocks[0].length;
  // 复算每辆车"能吃满"的次数
  const o2 = A.Solver.runSolver(A.parseLevel(A.fromGameFormat(g)), 0, 1, false, false, { capturePreviewStats: true, instantChain: false });
  const col = g.blocks.map(r => r.slice()), gone = g.blocks.map(r => r.map(() => false));
  const reach = (y, x) => (y === 0 || x === 0 || y === H - 1 || x === W - 1) || gone[y - 1][x] || gone[y + 1][x] || gone[y][x - 1] || gone[y][x + 1];
  const picks = (o2.pickOrder || []).filter(p => p.chainIndex === 0);
  const taken = new Set(); const freq = new Map();
  for (const p of picks) {
    const cnt = {};
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { if (gone[y][x] || !reach(y, x)) continue; const c = col[y][x]; cnt[c] = (cnt[c] || 0) + 1; }
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const s = g.spools[r][c];
      if (!s || !(s.id > 0) || taken.has(r + ',' + c) || s.q) continue;
      if ((cnt[s.id] || 0) >= s.count) freq.set(r + ',' + c, (freq.get(r + ',' + c) || 0) + 1);
    }
    const c0 = p.color, list = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { if (gone[y][x] || col[y][x] !== c0 || !reach(y, x)) continue; list.push([(H - 1 - y) + x, y, x]); }
    list.sort((a, b) => a[0] - b[0]);
    let n = 0; for (const [d, y, x] of list) { if (n >= p.count) break; gone[y][x] = true; n++; }
    taken.add(p.r + ',' + p.c);
  }
  const cand = [...freq.entries()].sort((a, b) => b[1] - a[1]);
  let added = 0;
  for (const [key] of cand) {
    if (m.forced / m.steps >= 0.30) break;
    const [r, c] = key.split(',').map(Number);
    const s = g.spools[r][c];
    if (!s || !isPlain(s)) continue;
    { s.q = true; const tt2 = Array.isArray(s.type) ? s.type.slice() : (s.type ? [s.type] : []); if (!tt2.includes(6)) tt2.push(6); s.type = tt2; }
    const m2 = measure(g);
    if (ok(m2) && m2.forced > m.forced) { m = m2; added++; }
    else s.q = false;
  }
  log.push(`S4 全程欠债不足 → 加问号 ${added} 个（被迫欠债 ${Math.round(100*m.forced/m.steps)}%）`);
}

fs.writeFileSync(OUT, JSON.stringify(g));
console.log('\n处方：');
log.forEach(x => console.log('  · ' + x));
console.log(`\n结果：步${m.steps} 被迫欠债 ${Math.round(100*m.forced/m.steps)}% | 前段 ${m.forcedEarly} | 后段 ${m.forcedTail} | 可吃满率 ${Math.round(m.fillRatio*100)}% | 峰值 ${m.peak} | 链组 ${chainGroups(g)}`);
console.log('已写入', OUT);
