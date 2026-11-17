#!/usr/bin/env node
'use strict';
/**
 * EscapeValveCheck_v1 —— 链有没有绑到“开局逃生阀”（2026-11-17）
 *
 * 为什么需要它：
 *   103 的低独占链把 `(0,5) 色1/35`（外框背景色车，点一下就能吃满离场）绑到未激活的 `(1,5)` 上。
 *   满格（暂存 4、车里全是 0 进度）时，它是**唯一**能腾出一格的车：被链锁住点不了，
 *   就算搭档激活了，整组要 2 空位（4+2>5）也进不去 —— 13/100 局在第 5–6 步锁死。
 *   隔离实验（`难度带/独占色验证/103_机制/`）：无链/早独占/共享晚三个对照各 1100 局 0 死。
 *
 * 什么是逃生阀：
 *   开局状态上，**单独点它就能当场吃满、立即离场**的车
 *   （判据：该车容量 ≤ 此刻该颜色在场上的暴露像素数；实现上直接模拟单点，看完成数是否 +1）。
 *   corner 玩法下典型的是外框/背景色的单格车。
 *
 * 检查什么：
 *   1. 列出开局所有逃生阀；
 *   2. 若关卡带锁链，逐个链格判断它“去掉链之后”是不是逃生阀 —— 是则 FAIL
 *      （链会把它锁住、或让整组要 2 空位，逃生阀失效）；
 *   3. `--pair r1,c1 r2,c2`：只检查指定的候选链对（建链前用）。
 *
 * 边界：
 *   - 只检查**开局**逃生阀。中途才变成能一次吃满的车不在 v1 范围内（还没有数据）。
 *   - 只读，不改关卡；结论是“这条链会吃掉开局安全绳”，不是“这关过不了”。
 *
 * 用法：
 *   node EscapeValveCheck_v1.js <关卡.json | 目录> [--pair r1,c1 r2,c2] [--json] [--out 报告.json]
 *   退出码：0 = 链未绑逃生阀；1 = 绑了；2 = 用法/读取错误。
 */
const fs = require('fs');
const path = require('path');
const B = require('./Build006Thickness_v688');
const A = B.loadSolver('corner');
const Sim = A.Simulator, St = A.SolverStrategy;

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i > 0 ? argv[i + 1] : d; };
const has = (k) => argv.indexOf(k) > 0;
const input = argv[0];
const outFile = arg('--out', null);
const asJson = has('--json');
const pairArg = has('--pair') ? [arg('--pair'), argv[argv.indexOf('--pair') + 2]] : null;
if (!input || input.startsWith('--')) {
  console.error('用法: node EscapeValveCheck_v1.js <关卡.json | 目录> [--pair r1,c1 r2,c2] [--json] [--out 报告.json]');
  process.exit(2);
}

const isChainType = (t) => (Array.isArray(t) ? t.includes(5) : t === 5);
function stripChains(g) {
  const c = JSON.parse(JSON.stringify(g));
  for (const row of c.spools) for (const x of row) {
    if (!x || !isChainType(x.type)) continue;
    if (Array.isArray(x.type)) {
      const i = x.type.indexOf(5);
      x.type.splice(i, 1);
      if (Array.isArray(x.param)) x.param.splice(i, 1);
      if (!x.type.length) { x.type = 0; x.param = 0; }
    } else { x.type = 0; x.param = 0; }
  }
  return c;
}

function openingValves(g) {
  // 去掉链再测，才能看清“它本来能不能一次吃满”
  const lv = A.parseLevel(A.fromGameFormat(stripChains(g)));
  const s = Sim.createState(lv, { useSlotStart: true, instantChain: false });
  const valves = [];
  for (let r = 0; r < s.cells.length; r++) for (let c = 0; c < s.cells[r].length; c++) {
    const box = s.cells[r][c];
    if (!box || box.t !== 'box') continue;
    const t = St.cloneState(s);
    const d0 = t.completedBoxes;
    const ok = Sim.applyPick(t, r, c);
    if (!ok) continue;                       // 开局点不了（冰/未激活），不可能是逃生阀
    if (t.completedBoxes > d0) valves.push({ r, c, color: box.color, count: box.count });
  }
  return valves;
}

function checkLevel(file) {
  const g = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!g || !Array.isArray(g.spools)) return { file: path.basename(file), skipped: '不是关卡（无 spools）', ok: true };
  const valves = openingValves(g);
  const valveKey = new Set(valves.map(v => `${v.r},${v.c}`));
  const chained = [];
  for (let r = 0; r < g.spools.length; r++) for (let c = 0; c < g.spools[r].length; c++) {
    const x = g.spools[r][c];
    if (x && isChainType(x.type)) chained.push({ r, c, color: x.id, count: x.count });
  }
  let targets = chained;
  if (pairArg) {
    targets = pairArg.map(s => { const [r, c] = String(s).split(',').map(Number); const x = g.spools[r] && g.spools[r][c]; return { r, c, color: x && x.id, count: x && x.count }; });
  }
  const hits = targets.filter(t => valveKey.has(`${t.r},${t.c}`));
  return { file: path.basename(file), valves, chained, hits, ok: hits.length === 0 };
}

const files = fs.statSync(input).isDirectory()
  ? fs.readdirSync(input).filter(f => f.endsWith('.json')).sort().map(f => path.join(input, f))
  : [input];
const results = [];
for (const f of files) {
  try { results.push(checkLevel(f)); }
  catch (e) { results.push({ file: path.basename(f), error: e.message, ok: false }); }
}

if (asJson) {
  const out = { tool: 'EscapeValveCheck_v1', results };
  console.log(JSON.stringify(out, null, 1));
  if (outFile) fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
} else {
  for (const r of results) {
    if (r.skipped) { if (has('--verbose')) console.log(`[SKIP] ${r.file}: ${r.skipped}`); continue; }
    if (r.error) { console.log(`[ERR ] ${r.file}: ${r.error}`); continue; }
    const vtxt = r.valves.length ? r.valves.map(v => `(${v.r},${v.c})色${v.color}/${v.count}`).join(' ') : '无';
    if (r.hits.length) {
      console.log(`[FAIL] ${r.file}: 链格 ${r.hits.map(t => `(${t.r},${t.c})色${t.color}/${t.count}`).join(' ')} 是开局逃生阀（点一下即吃满）——链会把它锁住/要 2 空位，满格时无路可走`);
    } else if (r.chained.length) {
      console.log(`[PASS] ${r.file}: ${r.chained.length} 个链格均不是逃生阀`);
    } else {
      console.log(`[INFO] ${r.file}: 无锁链；开局逃生阀 ${r.valves.length} 个`);
    }
    console.log(`       开局逃生阀: ${vtxt}`);
  }
  if (outFile) fs.writeFileSync(outFile, JSON.stringify({ tool: 'EscapeValveCheck_v1', results }, null, 1));
}
const bad = results.some(r => r.hits && r.hits.length && (pairArg || r.chained.length));
process.exit(bad ? 1 : 0);
