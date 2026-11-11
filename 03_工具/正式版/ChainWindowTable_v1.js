#!/usr/bin/env node
'use strict';
/**
 * ChainWindowTable_v1 —— 链组窗口表（v1.5）
 *
 * 对每个候选 2/3 车链组，沿 p2 路线和求解器 min 路线回放，找第一个窗口：
 *   - 组内所有成员都已激活、仍在场；
 *   - 暂存空位 >= 组大小；
 *   - 每个成员容量 <= 该步 reach；
 *   - 至少一个成员当前可点。
 *
 * 输出 p2Window / solverWindow；两者都有且 margin>=0 才算 safe。
 *
 * 用法：
 *   node ChainWindowTable_v1.js <关卡.json> [--out 报告.json]
 *        [--sizes 2,3] [--max-groups 60]
 *
 * 只读；不改关卡。
 */
const fs = require('fs');
const path = require('path');
const B = require('./Build006Thickness_v688');
const A = B.loadSolver('corner');
const S = A.Simulator;

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.indexOf(k) > 0;

function isPipe(s) { return !!(s && typeof s.type === 'number' && s.type >= 11 && s.type <= 14); }
function isChain(s) { return !!(s && (s.type === 5 || (Array.isArray(s.type) && s.type.includes(5)))); }
function isIce(s) { return !!(s && (s.type === 7 || (Array.isArray(s.type) && s.type.includes(7)))); }
function isPlain(s) { return !!(s && s.id > 0 && s.type === 0 && !s.q); }
function key(r, c) { return r + ',' + c; }
function colorTotals(g) {
  const m = {};
  for (const row of g.blocks) for (const v of row) if (v > 0) m[v] = (m[v] || 0) + 1;
  return m;
}
function reachCounts(s) {
  const H = s.blocks.length, W = s.blocks[0].length;
  const blocks = s.blocks, elim = s.eliminated;
  const reach = (y, x) => y === 0 || x === 0 || y === H - 1 || x === W - 1 ||
    elim[y - 1][x] || elim[y + 1][x] || elim[y][x - 1] || elim[y][x + 1];
  const cnt = {};
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (elim[y][x] || !reach(y, x)) continue;
    const c = blocks[y][x];
    if (c > 0) cnt[c] = (cnt[c] || 0) + 1;
  }
  return cnt;
}
function snapshot(s, step, sourceStep) {
  const present = new Set(), activated = new Set();
  for (let r = 0; r < s.boardRows; r++) for (let c = 0; c < s.boardCols; c++) {
    const cell = s.cells[r][c];
    if (cell && cell.t === 'box') present.add(key(r, c));
  }
  for (const k of Object.keys(s.activated || {})) if (s.activated[k]) activated.add(k);
  const pickable = new Set();
  for (const m of S.listMoves(s).filter(x => !x.blocked)) pickable.add(key(m.r, m.c));
  return {
    step, sourceStep, buffer: s.buffer.length, free: s.bufferLimit - s.buffer.length,
    reach: reachCounts(s), present, activated, pickable
  };
}
function replay(lv, picks) {
  const s = S.createState(lv, { useSlotStart: true, bottomOnly: false, instantChain: false });
  const out = [];
  const seen = new Set();
  let n = 0;
  out.push(snapshot(s, n++, null));
  for (const p of picks || []) {
    if (p.chainIndex != null && p.chainIndex !== 0) continue;
    const k = p.step + ':' + p.r + ',' + p.c;
    if (seen.has(k)) continue;
    seen.add(k);
    if (!S.applyPick(s, p.r, p.c)) break;
    out.push(snapshot(s, n++, p.step));
  }
  return out;
}
function minPicks(lv) {
  const min = A.Solver.runMinBuffer(lv, { depth: 3, instantChain: false });
  return { won: !!min.won, picks: min.pickOrder || [] };
}
function groupWindow(snaps, group) {
  const size = group.length;
  for (const sn of snaps) {
    if (sn.free < size) continue;
    let ok = true, minMargin = Infinity;
    const members = [];
    for (const m of group) {
      if (!sn.present.has(key(m.r, m.c))) { ok = false; break; }
      if (!sn.activated.has(key(m.r, m.c))) { ok = false; break; }
      const reach = sn.reach[m.color] || 0;
      const margin = reach - m.count;
      if (margin < 0) { ok = false; break; }
      minMargin = Math.min(minMargin, margin);
      members.push({ r: m.r, c: m.c, color: m.color, count: m.count, reach, margin });
    }
    if (!ok) continue;
    if (!group.some(m => sn.pickable.has(key(m.r, m.c)))) continue;
    return { step: sn.step, sourceStep: sn.sourceStep, buffer: sn.buffer, free: sn.free, minMargin, members };
  }
  return null;
}
function enumerateGroups(g, sizes) {
  const plain = new Map();
  for (let r = 0; r < g.spools.length; r++) for (let c = 0; c < g.spools[r].length; c++) {
    const s = g.spools[r][c];
    if (isPlain(s)) plain.set(key(r, c), { r, c, color: s.id, count: s.count });
  }
  const groups = new Map();
  const add = (arr) => {
    const sorted = arr.slice().sort((a, b) => (a.r - b.r) || (a.c - b.c));
    const k = sorted.map(x => key(x.r, x.c)).join('|');
    if (!groups.has(k)) groups.set(k, sorted);
  };
  if (sizes.includes(2)) {
    for (const a of plain.values()) for (const [dr, dc] of [[0, 1], [1, 0]]) {
      const b = plain.get(key(a.r + dr, a.c + dc));
      if (b) add([a, b]);
    }
  }
  if (sizes.includes(3)) {
    for (const a of plain.values()) for (const [dr, dc] of [[0, 1], [1, 0]]) {
      const b = plain.get(key(a.r + dr, a.c + dc));
      if (!b) continue;
      for (const base of [a, b]) for (const [er, ec] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const c = plain.get(key(base.r + er, base.c + ec));
        if (!c) continue;
        if ((c.r === a.r && c.c === a.c) || (c.r === b.r && c.c === b.c)) continue;
        add([a, b, c]);
      }
    }
  }
  return [...groups.values()];
}
function existingGroups(g) {
  const m = new Map();
  for (let r = 0; r < g.spools.length; r++) for (let c = 0; c < g.spools[r].length; c++) {
    const s = g.spools[r][c];
    if (!isChain(s) || s.id <= 0) continue;
    const id = Array.isArray(s.param) ? s.param[s.type.indexOf(5)] : s.param;
    if (!m.has(String(id))) m.set(String(id), []);
    m.get(String(id)).push({ r, c, color: s.id, count: s.count });
  }
  return [...m.entries()].map(([id, members]) => ({ id, members }));
}

function main() {
  const file = process.argv[2];
  const out = arg('--out', null);
  const sizes = String(arg('--sizes', '2,3')).split(',').map(Number).filter(x => x === 2 || x === 3);
  const maxGroups = Number(arg('--max-groups', 60)) || 60;
  if (!file) { console.error('用法: node ChainWindowTable_v1.js <关卡.json> [--out 报告.json] [--sizes 2,3] [--max-groups 60]'); process.exit(2); }

  const g = B.readJson(file);
  const lv = A.parseLevel(A.fromGameFormat(g));
  const p2 = A.PlayerSim.run(lv, { seed: 7, instantChain: false, reviveCap: 2, pickThreshold: 0.6, trackReach: true });
  const p2Snaps = replay(lv, p2.pickOrder || []);
  const min = minPicks(lv);
  const solverSnaps = replay(lv, min.picks);

  const candidates = enumerateGroups(g, sizes);
  const rows = [];
  for (const grp of candidates) {
    const pw = groupWindow(p2Snaps, grp);
    const sw = groupWindow(solverSnaps, grp);
    const safe = !!(pw && sw && pw.minMargin >= 0 && sw.minMargin >= 0);
    rows.push({
      cells: grp.map(m => ({ r: m.r, c: m.c, color: m.color, count: m.count })),
      size: grp.length,
      colors: [...new Set(grp.map(m => m.color))],
      p2Window: pw, solverWindow: sw, safe
    });
  }
  rows.sort((a, b) => {
    if (a.safe !== b.safe) return a.safe ? -1 : 1;
    const as = a.solverWindow ? a.solverWindow.step : 999, bs = b.solverWindow ? b.solverWindow.step : 999;
    return as - bs;
  });
  const top = rows.slice(0, maxGroups);

  console.log(`# ${path.basename(file)}  p2=${p2.won ? 'Y' : 'N'} solver=${min.won ? 'Y' : 'N'}`);
  console.log('cells'.padEnd(28), 'size', 'p2 step/free/margin'.padEnd(22), 'solver step/free/margin'.padEnd(24), 'safe');
  for (const r of top) {
    const c = r.cells.map(m => `r${m.r}c${m.c}:${m.color}/${m.count}`).join(' ');
    const f = w => w ? `${w.step}/${w.free}/${w.minMargin}` : '-';
    console.log(c.padEnd(28), String(r.size).padEnd(4), f(r.p2Window).padEnd(22), f(r.solverWindow).padEnd(24), r.safe ? 'Y' : 'N');
  }
  console.log(`\n候选 ${rows.length} 组，safe ${rows.filter(r => r.safe).length} 组`);

  if (out) {
    fs.writeFileSync(out, JSON.stringify({
      tool: 'ChainWindowTable_v1', file, p2Won: !!p2.won, solverWon: !!min.won,
      counts: { candidates: rows.length, safe: rows.filter(r => r.safe).length },
      existing: existingGroups(g), rows: top, allCount: rows.length
    }, null, 2));
    console.log('saved ' + out);
  }
}

if (require.main === module) main();
module.exports = { enumerateGroups, existingGroups, replay, groupWindow };
