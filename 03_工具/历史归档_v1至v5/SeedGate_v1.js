#!/usr/bin/env node
'use strict';
/**
 * SeedGate_v1 —— v1.5 的种子门（全量检查前的轻量结构检查）
 *
 * 先挡掉“造出来就必死”的种子：
 *   1. 逐色容量守恒（含管道队列）
 *   2. 无空格（黑块/管道合法）
 *   3. 每辆车容量 ≤ 被拿时 reach；链组成员 ≤ 入场步 reach
 *   4. 开局可点 ≥5
 *   5. 链组入场时不出现“容量 > 可达”的成员
 *
 * 用法：
 *   node SeedGate_v1.js <关卡.json | 目录> [--out 报告.json] [--limit N] [--open-min 5]
 *
 * 只读；不改关卡。通过 ≠ 成品，仍要跑 ArlCheck/点击/PlayerSim。
 */
const fs = require('fs');
const path = require('path');
const B = require('./Build006Thickness_v688');
const A = B.loadSolver('corner');
const { analyze, colorTotals } = require('./ReachTimeline_v1');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.indexOf(k) > 0;

function collect(p) {
  const st = fs.statSync(p);
  if (st.isFile()) return [p];
  return fs.readdirSync(p).filter(f => f.endsWith('.json')).sort().map(f => path.join(p, f));
}
function isLevel(g) { return !!(g && Array.isArray(g.blocks) && Array.isArray(g.spools)); }
function isPipe(s) { return !!(s && typeof s.type === 'number' && s.type >= 11 && s.type <= 14); }
function carTotals(g) {
  const m = {};
  for (const row of g.spools) for (const s of row) {
    if (!s) continue;
    if (isPipe(s)) {
      if (Array.isArray(s.param)) for (const q of s.param) if (q && q.id > 0) m[q.id] = (m[q.id] || 0) + (q.count || 0);
      continue;
    }
    if (s.id > 0) m[s.id] = (m[s.id] || 0) + (s.count || 0);
  }
  return m;
}
function emptyCells(g) {
  const out = [];
  for (let r = 0; r < g.spools.length; r++) for (let c = 0; c < g.spools[r].length; c++) {
    const s = g.spools[r][c];
    if (!s) { out.push([r, c]); continue; }
    if (isPipe(s)) continue;
    if (s.id === 0) out.push([r, c]);
  }
  return out;
}
function openingCount(g) {
  try {
    const lv = A.parseLevel(A.fromGameFormat(g));
    const s = A.Simulator.createState(lv, { useSlotStart: true, bottomOnly: false, instantChain: false });
    return A.Simulator.listMoves(s).filter(m => !m.blocked).length;
  } catch (e) { return null; }
}
function gate(file, opts) {
  const g = B.readJson(file);
  if (!isLevel(g)) throw new Error('不是关卡 JSON');
  const reasons = [];
  const warnings = [];
  const px = colorTotals(g), car = carTotals(g);
  for (const k of new Set([...Object.keys(px), ...Object.keys(car)])) {
    if ((px[k] || 0) !== (car[k] || 0)) reasons.push(`容量不守恒 颜色${k}: 像素${px[k] || 0} / 车${car[k] || 0}`);
  }
  const empties = emptyCells(g);
  if (empties.length) reasons.push(`空格 ${empties.length} 个: ${empties.slice(0, 6).map(x => 'r' + x[0] + 'c' + x[1]).join(',')}`);
  const open = openingCount(g);
  const openMin = Number(opts.openMin || 5);
  if (open == null) reasons.push('开局可点：无法计算');
  else if (open < openMin) reasons.push(`开局可点 ${open} < ${openMin}`);

  let solverWon = null;
  try {
    const lv = A.parseLevel(A.fromGameFormat(g));
    const min = A.Solver.runMinBuffer(lv, { depth: 3, instantChain: false });
    solverWon = !!min.won;
    if (!solverWon) reasons.push('求解器最小路线不通（can✗）');
  } catch (e) {
    reasons.push('求解器检查失败: ' + e.message);
  }

  let reach = null;
  try { reach = analyze(file); } catch (e) { reasons.push('reach 分析失败: ' + e.message); }
  if (reach) {
    // p2 都过不了 → 种子硬失败；p2 能过时，fatal/over 是“陷阱”，记警告。
    const severe = reach.p2Won === false;
    if (reach.overCars.length) {
      const list = reach.overCars.slice(0, 8).map(c => `车 r${c.r}c${c.c} 颜色${c.color} 容量${c.count} > 取时reach${c.minReachAtPick}`);
      if (severe) reasons.push(...list); else warnings.push('存在容量>reach车（p2可绕开）: ' + list.join('；'));
    }
    if (reach.fatalChains.length) {
      const list = reach.fatalChains.map(ch => `链组 p${ch.id} 入场步${ch.entryStep}: ` + ch.fatalMembers.map(m => `颜色${m.color} ${m.count}>${m.reach}`).join('，'));
      if (severe) reasons.push(...list); else warnings.push('存在必死链（p2可绕开）: ' + list.join('；'));
    }
    const notEntered = reach.chains.filter(c => c.entryStep == null);
    if (notEntered.length) warnings.push(`链组未入场: ${notEntered.map(c => 'p' + c.id).join(',')}`);
    if (!reach.p2Won) reasons.push(`PlayerSim p2 未通关${reach.p2Progress != null ? '（' + reach.p2Progress + '%）' : ''}`);
    if (!reach.p0Won) warnings.push(`PlayerSim p0 未通关${reach.p0Death ? '（第' + reach.p0Death + '步）' : ''}`);
  }

  return {
    file: path.basename(file),
    pass: reasons.length === 0,
    reasons,
    warnings,
    open,
    solverWon,
    p0Won: reach ? reach.p0Won : null,
    p0Death: reach ? reach.p0Death : null,
    p2Won: reach ? reach.p2Won : null,
    fatalChains: reach ? reach.fatalChains : [],
    overCars: reach ? reach.overCars : [],
    reach
  };
}

function main() {
  const input = process.argv[2];
  const out = arg('--out', null);
  const limit = Number(arg('--limit', 0)) || 0;
  const openMin = Number(arg('--open-min', 5)) || 5;
  if (!input) { console.error('用法: node SeedGate_v1.js <关卡.json | 目录> [--out 报告.json] [--limit N] [--open-min 5]'); process.exit(2); }
  const files = collect(input).slice(0, limit || undefined);
  const rows = [];
  for (const file of files) {
    try {
      const r = gate(file, { openMin });
      rows.push(r);
      console.log(`${r.file.padEnd(30)} ${r.pass ? 'PASS' : 'FAIL'} open=${r.open == null ? '?' : r.open} solver=${r.solverWon ? 'Y' : 'N'} p0=${r.p0Won ? 'Y' : 'N'} p2=${r.p2Won ? 'Y' : 'N'} fatal=${r.fatalChains.length} over=${r.overCars.length}${r.reasons.length ? ' | ' + r.reasons.slice(0, 3).join('；') : ''}`);
    } catch (e) {
      rows.push({ file: path.basename(file), error: String(e.message || e) });
      console.log(`${path.basename(file).padEnd(30)} ERROR ${e.message}`);
    }
  }
  const summary = {
    levels: rows.filter(r => !r.error).length,
    errors: rows.filter(r => r.error).length,
    pass: rows.filter(r => r.pass).length,
    fail: rows.filter(r => !r.error && !r.pass).length,
    withFatalChain: rows.filter(r => r.fatalChains && r.fatalChains.length).length,
    withOverCar: rows.filter(r => r.overCars && r.overCars.length).length
  };
  console.log('\n=== summary ===');
  console.log(JSON.stringify(summary, null, 2));
  if (out) {
    fs.writeFileSync(out, JSON.stringify({ tool: 'SeedGate_v1', summary, rows }, null, 2));
    console.log('saved ' + out);
  }
}

if (require.main === module) main();
module.exports = { gate };
