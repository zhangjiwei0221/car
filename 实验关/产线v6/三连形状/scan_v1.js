#!/usr/bin/env node
'use strict';
/**
 * scan_v1 —— 三连锁候选扫描（2026-11-13）
 *
 * 对给定「位置 × 形状」枚举全部合法三格组合（优先三格都是普通车 type 0），
 * 按离锚点距离排序，逐个：
 *   1. 用 建三连_v1.js 生成变体（自检只有三格变化、容量守恒）
 *   2. Solvable_v1 --width 8
 *   3. ChainRatchetCheck_v1（必须 pass：0 flags / 0 traps）
 * 取第一个两项都过的组合作为该格子的正式变体；失败也全部记录。
 *
 * 用法：
 *   node scan_v1.js <base.json> <mid|open> <v|h|l> <out.json>
 *
 * 中间文件带 pid，避免并行互相覆盖。
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../../..');
const TOOLS = path.join(ROOT, '03_工具/正式版');
const BUILDER = path.join(__dirname, '建三连_v1.js');
const [BASE, POS, SHAPE, OUT] = process.argv.slice(2);
if (!BASE || !POS || !SHAPE || !OUT) {
  console.error('用法: node scan_v1.js <base.json> <mid|open> <v|h|l> <out.json>');
  process.exit(2);
}
const PID = process.pid;
const tmpDir = path.join(__dirname, `.scan_${PID}_${POS}_${SHAPE}`);
fs.mkdirSync(tmpDir, { recursive: true });

const game = JSON.parse(fs.readFileSync(BASE, 'utf8'));
const R = game.spools.length, C = game.spools[0].length;
const typeList = (c) => Array.isArray(c.type) ? c.type : (c.type === 0 || c.type == null ? [] : [c.type]);
const isPlainCar = (r, c) => { const x = game.spools[r][c]; return x && x.id > 0 && x.count > 0 && typeList(x).length === 0; };

// ---- 位置窗口 ----
// mid: 三格都在第 3–5 行；open: 三格都在第 0–1 行（纵向放不下，用第 0–2 行）
const inWin = (r, c) => POS === 'mid' ? (r >= 3 && r <= 5) : (r >= 0 && r <= 1);
const inWinV = (r, c) => POS === 'mid' ? (r >= 3 && r <= 5) : (r >= 0 && r <= 2);
const anchor = POS === 'mid' ? [3, 0] : [0, 0];

const cands = [];
if (SHAPE === 'v') {
  for (let c = 0; c < C; c++) for (let r = 0; r + 2 < R; r++) {
    const cells = [[r, c], [r + 1, c], [r + 2, c]];
    if (cells.every(([rr, cc]) => inWinV(rr, cc)) && cells.every(([rr, cc]) => isPlainCar(rr, cc))) cands.push(cells);
  }
} else if (SHAPE === 'h') {
  for (let r = 0; r < R; r++) for (let c = 0; c + 2 < C; c++) {
    const cells = [[r, c], [r, c + 1], [r, c + 2]];
    if (cells.every(([rr, cc]) => inWin(rr, cc)) && cells.every(([rr, cc]) => isPlainCar(rr, cc))) cands.push(cells);
  }
} else if (SHAPE === 'l') {
  // 四种镜像：右上/右下/左下/左上，统一排重
  const seen = new Set();
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    for (const [dr, dc] of [[1, 0], [-1, 0]]) for (const [dr2, dc2] of [[0, 1], [0, -1]]) {
      const cells = [[r, c], [r + dr, c + dc], [r + dr2, c + dc2]];
      if (cells.some(([rr, cc]) => rr < 0 || cc < 0 || rr >= R || cc >= C)) continue;
      if (!cells.every(([rr, cc]) => inWin(rr, cc))) continue;
      if (!cells.every(([rr, cc]) => isPlainCar(rr, cc))) continue;
      const key = cells.map(x => x.join(',')).sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key); cands.push(cells);
    }
  }
}
const dist = (cells) => cells.reduce((a, [r, c]) => a + Math.abs(r - anchor[0]) + Math.abs(c - anchor[1]), 0);
cands.sort((a, b) => dist(a) - dist(b) || a.map(x => x.join(',')).sort().join('|').localeCompare(b.map(x => x.join(',')).sort().join('|')));

function runNode(script, args) {
  try {
    return { ok: true, out: execFileSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 180000, stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) { return { ok: false, out: (e.stdout || '') + (e.stderr || ''), code: e.status }; }
}

const results = [];
let chosen = null;
for (let i = 0; i < cands.length; i++) {
  const cells = cands[i];
  const tag = cells.map(x => x.join(',')).join('_');
  const lvl = path.join(tmpDir, `cand_${i}_${tag}.json`);
  const b = runNode(BUILDER, [BASE, SHAPE, ...cells.map(x => x.join(',')), lvl, '--gid', '1']);
  if (!b.ok) { results.push({ i, cells, build: 'FAIL', note: b.out.slice(-200) }); continue; }
  let buildInfo = null;
  try { buildInfo = JSON.parse(b.out); } catch (_) {}
  const solvRaw = runNode(path.join(TOOLS, 'Solvable_v1.js'), [lvl, '--width', '8']);
  let solv = null;
  try { solv = JSON.parse(solvRaw.out.trim().split('\n').pop()); } catch (_) {}
  const ratchetOut = path.join(tmpDir, `ratchet_${i}.json`);
  const rat = runNode(path.join(TOOLS, 'ChainRatchetCheck_v1.js'), [lvl, '--out', ratchetOut]);
  let ratchet = null;
  try { ratchet = JSON.parse(fs.readFileSync(ratchetOut, 'utf8')); } catch (_) {}
  const row = { i, cells, colors: buildInfo ? buildInfo.cells.map(x => x.color) : null, counts: buildInfo ? buildInfo.cells.map(x => x.count) : null, solvable: solv && solv.solvable, solvSteps: solv && solv.steps, ratchetPass: ratchet ? ratchet.rows[0].pass : null, flags: ratchet ? ratchet.rows[0].flags.length : null, traps: ratchet ? ratchet.rows[0].traps.length : null };
  results.push(row);
  if (row.solvable && row.ratchetPass) { chosen = { ...row, level: lvl, cells }; break; }
}

fs.writeFileSync(OUT, JSON.stringify({ tool: 'scan_v1', pid: PID, base: path.basename(BASE), pos: POS, shape: SHAPE, candidates: results, chosen }, null, 1));
console.log(`${POS} ${SHAPE}: tried ${results.length} candidates, chosen=${chosen ? chosen.cells.map(x => x.join(',')).join(' | ') : 'NONE'}`);
for (const r of results) console.log(`  #${r.i} ${r.cells.map(x => x.join(',')).join('|')} colors=${JSON.stringify(r.colors)} solvable=${r.solvable} ratchet=${r.ratchetPass} flags=${r.flags} traps=${r.traps}`);
