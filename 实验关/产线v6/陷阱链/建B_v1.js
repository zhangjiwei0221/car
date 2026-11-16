#!/usr/bin/env node
'use strict';
/**
 * 陷阱链实验 · 第 3 步：建 B 组（避开陷阱格的 3 条两连锁）（2026-11-16）
 *
 * 规则（任务书）：
 *   1) 正交相邻、两格都在第 0–2 行；
 *   2) 6 格都不能是陷阱格（第 1 步 陷阱格.json 的 trapCells）；
 *   3) 尽量接近 A 组选链标准：两色中段需求高、首次被拿 0.10–0.40；
 *   4) 每条加完必须 ChainRatchetCheck_v1 PASS 且 Solvable_v1 --width 8 可通关；FAIL 换下一对；
 *   5) 不改容量/颜色/目标图；不加冰/管道。
 *
 * 选链尺的数据来自第 1 步同一套模拟：扫描 JSON（加链/扫描_v1.js 输出）里的
 *   firstPick（首次被拿中位）与 colorDemand（free-first 路线 midShare）。
 *
 * 用法：
 *   node 建B_v1.js <底座.json> <陷阱格.json> <扫描.json> <out.json> [--log 日志.json]
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../../..');
const BUILD = path.join(ROOT, '实验关/产线v6/多链/建链_v1.js');
const RATCHET = path.join(ROOT, '03_工具/正式版/ChainRatchetCheck_v1.js');
const SOLVABLE = path.join(ROOT, '03_工具/正式版/Solvable_v1.js');

const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const flag = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const [BASE, TRAPFILE, SCANFILE, OUT] = args;
if (!BASE || !TRAPFILE || !SCANFILE || !OUT) {
  console.error('用法: node 建B_v1.js <底座.json> <陷阱格.json> <扫描.json> <out.json> [--log 日志.json]');
  process.exit(2);
}
const LOG = flag('--log', `/tmp/建B_log_${process.pid}.json`);
const event = (m) => { console.log(m); };

const base = JSON.parse(fs.readFileSync(BASE, 'utf8'));
const trap = JSON.parse(fs.readFileSync(TRAPFILE, 'utf8'));
const scan = JSON.parse(fs.readFileSync(SCANFILE, 'utf8'));
const ROWS = base.spools.length, COLS = base.spools[0].length;

const trapSet = new Set((trap.trapCells || []).map(x => x.r + ',' + x.c));
// 校准后没有任何格达到 30%；为了避免 B 退化成 A 的复制品，额外避开：
//   (a) 致命比例最高的 --avoid-top 个格子（默认 4，对应 (2,4)/(3,3)/(3,2)/(2,5)）；
//   (b) A 组的 6 格（可用 --allow-a 关闭，用于“可接受与 A 重叠”的备用模式）。
const AVOID_TOP = Math.max(0, Number(flag('--avoid-top', 4)) || 0);
const nearSet = new Set((trap.cells || []).slice().sort((a, b) => b.correctedShare - a.correctedShare)
  .slice(0, AVOID_TOP).map(x => x.r + ',' + x.c));
const parseRC = (k) => k.split(',').map(Number);
const firstPick = scan.firstPick || {};   // "r,c" -> {median,n}
const demand = {};
for (const d of scan.colorDemand || []) demand[d.color] = d;
const typeList = (c) => Array.isArray(c.type) ? c.type : (c.type == null || c.type === 0 ? [] : [c.type]);
const isPlainCar = (c) => c && c.id > 0 && c.count > 0 && typeList(c).length === 0;
const pickMed = (k) => (firstPick[k] ? firstPick[k].median : null);
const midOf = (color) => (demand[color] ? demand[color].midShare : null);

// A 组的 6 格（对照用，不强制避开）
const A_CELLS = new Set(['1,4', '1,5', '1,1', '1,2', '1,3', '2,3']);
const ALLOW_A = process.argv.includes('--allow-a');

// ---- 枚举候选对 ----
const cands = [];
for (let r = 0; r <= 2; r++) for (let c = 0; c < COLS; c++) {
  for (const [dr, dc] of [[0, 1], [1, 0]]) {
    const rr = r + dr, cc = c + dc;
    if (rr > 2 || cc >= COLS) continue;
    const ka = r + ',' + c, kb = rr + ',' + cc;
    const a = base.spools[r][c], b = base.spools[rr][cc];
    if (!isPlainCar(a) || !isPlainCar(b)) continue;
    if (trapSet.has(ka) || trapSet.has(kb)) continue;      // 规则 2（校准后为空集）
    if (nearSet.has(ka) || nearSet.has(kb)) continue;      // 避开致命比例最高的格子
    if (!ALLOW_A && (A_CELLS.has(ka) || A_CELLS.has(kb))) continue;  // 默认与 A 不重叠
    const pa = pickMed(ka), pb = pickMed(kb);
    if (pa == null || pb == null) continue;
    const inBand = (x) => x >= 0.10 && x <= 0.40;
    const mA = midOf(a.id), mB = midOf(b.id);
    const midA = mA != null && mA >= 0.25, midB = mB != null && mB >= 0.25;
    const inBandA = inBand(pa), inBandB = inBand(pb);
    let score = 0;
    score += (inBandA ? 10 : 0) + (inBandB ? 10 : 0);
    score += (midA ? 5 : 0) + (midB ? 5 : 0);
    score += (a.id !== b.id ? 2 : 0);
    score -= Math.abs((pa + pb) / 2 - 0.25) * 10;
    cands.push({
      a: [r, c], b: [rr, cc], ka, kb,
      colorA: a.id, capA: a.count, colorB: b.id, capB: b.count,
      pickA: pa, pickB: pb, midA, midB, midShareA: mA, midShareB: mB,
      inBandA, inBandB, score: +score.toFixed(2)
    });
  }
}
cands.sort((x, y) => y.score - x.score);

// ---- 顺序建链（每条必须 PASS + 可通关）----
function runTool(cmd) {
  try {
    return { ok: true, out: execFileSync(process.execPath, cmd, { encoding: 'utf8', timeout: 300000, maxBuffer: 32 * 1024 * 1024 }) };
  } catch (e) {
    return { ok: false, out: (e.stdout || '') + (e.stderr || ''), err: e.message };
  }
}
function ratchetPass(file, tmpOut) {
  const r = runTool([RATCHET, file, '--out', tmpOut]);
  if (!r.ok) return { pass: false, note: 'tool error: ' + r.err };
  try {
    const j = JSON.parse(fs.readFileSync(tmpOut, 'utf8'));
    return { pass: j.summary && j.summary.pass === 1 && j.summary.fail === 0, note: JSON.stringify(j.summary) };
  } catch (e) { return { pass: false, note: 'parse: ' + e.message }; }
}
function solvable(file) {
  const r = runTool([SOLVABLE, file, '--width', '8', '--timeout', '60']);
  if (!r.ok) return { pass: false, note: 'tool error: ' + r.err };
  const line = r.out.trim().split('\n').filter(x => x.startsWith('{')).pop();
  try {
    const j = JSON.parse(line);
    return { pass: !!j.solvable, note: `solvable=${j.solvable} steps=${j.steps} sec=${j.sec}` };
  } catch (e) { return { pass: false, note: 'parse: ' + e.message }; }
}

const log = { tool: '建B_v1', base: path.basename(BASE), trapFile: path.basename(TRAPFILE), _pid: process.pid, candidates: cands, chains: [], tries: [] };
const used = new Set();
let cur = BASE;
for (let gid = 1; gid <= 3; gid++) {
  let built = false;
  for (const cd of cands) {
    if (used.has(cd.ka) || used.has(cd.kb)) continue;
    const tmpLevel = `/tmp/陷阱链_B_g${gid}_${process.pid}.json`;
    const bres = runTool([BUILD, cur, cd.ka, cd.kb, tmpLevel, '--gid', String(gid)]);
    if (!bres.ok) { log.tries.push({ gid, pair: [cd.ka, cd.kb], step: 'build', ok: false, note: bres.err }); continue; }
    const rt = ratchetPass(tmpLevel, `/tmp/陷阱链_B_g${gid}_棘轮_${process.pid}.json`);
    if (!rt.pass) { log.tries.push({ gid, pair: [cd.ka, cd.kb], step: 'ratchet', ok: false, note: rt.note }); event(`  g${gid} ${cd.ka}+${cd.kb} 棘轮 FAIL，换下一对`); continue; }
    const sv = solvable(tmpLevel);
    if (!sv.pass) { log.tries.push({ gid, pair: [cd.ka, cd.kb], step: 'solvable', ok: false, note: sv.note }); event(`  g${gid} ${cd.ka}+${cd.kb} 棘轮 PASS 但不可通关，换下一对`); continue; }
    log.tries.push({ gid, pair: [cd.ka, cd.kb], step: 'ok', ok: true, ratchet: rt.note, solvable: sv.note });
    log.chains.push({ gid, ...cd, ratchet: rt.note, solvable: sv.note });
    used.add(cd.ka); used.add(cd.kb);
    fs.copyFileSync(tmpLevel, OUT);
    cur = OUT;
    event(`  g${gid} ✅ ${cd.ka}(色${cd.colorA}/${cd.capA}) + ${cd.kb}(色${cd.colorB}/${cd.capB})  pick=${cd.pickA}/${cd.pickB} mid=${cd.midShareA}/${cd.midShareB}  棘轮 PASS，可通关 ${sv.note}`);
    built = true;
    break;
  }
  if (!built) { event(`  g${gid} ❌ 没有可用候选对`); }
}
fs.writeFileSync(LOG, JSON.stringify(log, null, 1));
event(`\n写出 ${OUT}；尝试 ${log.tries.length} 次；成功 ${log.chains.length} 条链`);
console.log('LOG ' + LOG);
if (log.chains.length < 3) process.exit(1);
