#!/usr/bin/env node
'use strict';
/**
 * PlayerChoiceCheck_v1 —— 玩家层选择/恢复检查（2026-11-11）
 *
 * 解决的问题：M/C/F/D 只数“有几个选项”，不数“选项有多好”；
 * 本工具在每条步上补两项：
 *   Fgain   ：本步所有免费选项（不新增未完成车）里，最大能消多少 px；
 *   recovery：buffer≥3 时，最少几步能完成一辆“已在暂存里的车”（有界 BFS，找不到记 null）。
 *
 * 还标出 weakFree：有免费选项，但它的收益 < 最佳债车收益 × weakRatio（默认 0.5）。
 * 这就是“有代价的选择”：玩家不是没得选，而是自由选项很弱。
 *
 * 用法：
 *   node PlayerChoiceCheck_v1.js <关卡.json> [--path 用户路径.json] [--depth 4] [--weak-ratio 0.5] [--out report.json]
 *   不给 --path 时沿 free-first 路线跑。
 *
 * 只读；不改关卡。诊断工具，暂不作硬门。
 */
const fs = require('fs');
const path = require('path');
const B = require('./Build006Thickness_v688');
const A = B.loadSolver('corner');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const input = process.argv[2];
const userPath = arg('--path', null);
const maxDepth = Number(arg('--depth', 4));
const weakRatio = Number(arg('--weak-ratio', 0.5));
const outFile = arg('--out', null);
if (!input) {
  console.error('用法: node PlayerChoiceCheck_v1.js <关卡.json> [--path 用户路径.json] [--depth 4] [--weak-ratio 0.5] [--out report.json]');
  process.exit(2);
}

const clone = s => JSON.parse(JSON.stringify(s));
const live = s => A.Simulator.listMoves(s).filter(m => !m.blocked);
const stateKey = s => s.buffer.map(b => b.key + ':' + b.progress).sort().join(',') + '#' + s.eliminatedPixels + '#'
  + s.cells.map(row => row.map(c => (c && c.t === 'box') ? (c.color + '.' + (c.chain || 0)) : '-').join('|')).join('/');

// free-first 路线（与 ChainRatchetCheck 同口径）
function score(s, m) {
  const c = clone(s);
  if (!A.Simulator.applyPick(c, m.r, m.c)) return null;
  const gain = c.eliminatedPixels - s.eliminatedPixels;
  const buf = c.buffer.length;
  const free = buf === 0 ? 1 : 0;
  const stuck = c.buffer.reduce((a, b) => a + (b.need - b.progress), 0);
  const done = c.completedBoxes - s.completedBoxes;
  const noMoves = live(c).length === 0;
  const won = c.gameWon || c.eliminatedPixels >= c.totalPixels;
  const dead = !won && (c.overflow || buf > c.bufferLimit || (buf >= c.bufferLimit && done === 0) || noMoves);
  return [dead ? 0 : 1, free, gain, -buf, -stuck, -m.r, -m.c];
}
function cmp(a, b) { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; }
function freeFirstRoute(lv) {
  const s = A.Simulator.createState(lv, { useSlotStart: true, bottomOnly: false, instantChain: false });
  const picks = [];
  for (let i = 0; i < 200; i++) {
    if (s.gameWon || s.eliminatedPixels >= s.totalPixels) break;
    let best = null;
    for (const m of live(s)) { const sc = score(s, m); if (!sc) continue; if (!best || cmp(sc, best.sc) > 0) best = { m, sc }; }
    if (!best) break;
    picks.push({ r: best.m.r, c: best.m.c });
    A.Simulator.applyPick(s, best.m.r, best.m.c);
  }
  return picks;
}
function readPicks(file) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (Array.isArray(j.clicks)) return j.clicks.map(c => ({ r: c.r, c: c.c }));
  if (Array.isArray(j.steps)) { const out = []; for (const s of j.steps) for (const p of (s.picked || [])) out.push({ r: p.r, c: p.c }); return out; }
  if (Array.isArray(j.picks)) return j.picks.map(p => ({ r: p.r, c: p.c }));
  return [];
}

/** 每一步的选项质量 */
function classifyMove(s, m) {
  const c = clone(s);
  const beforeKeys = new Set(s.buffer.map(b => b.key));
  const done0 = c.completedBoxes;
  if (!A.Simulator.applyPick(c, m.r, m.c)) return null;
  const gain = c.eliminatedPixels - s.eliminatedPixels;
  const newCar = c.buffer.some(b => !beforeKeys.has(b.key));
  return { gain, isF: !newCar, completed: c.completedBoxes > done0, buffer: c.buffer.length };
}

/** buffer≥3 时，最少几步能完成一辆“已在暂存里的车”；找不到返回 null */
function recoveryDepth(s, depth, budget) {
  const startKeys = new Set(s.buffer.map(b => b.key));
  if (!startKeys.size) return 0;
  const seen = new Set([stateKey(s)]);
  let frontier = [{ s, d: 0 }];
  while (frontier.length && budget.n > 0) {
    const next = [];
    for (const node of frontier) {
      if (node.d >= depth) continue;
      for (const m of live(node.s)) {
        if (budget.n-- <= 0) break;
        const c = clone(node.s);
        if (!A.Simulator.applyPick(c, m.r, m.c)) continue;
        if ([...startKeys].some(k => !c.buffer.some(b => b.key === k))) return node.d + 1;
        const k = stateKey(c);
        if (seen.has(k)) continue;
        seen.add(k);
        next.push({ s: c, d: node.d + 1 });
      }
    }
    frontier = next;
  }
  return null;
}

// ---------- 主流程 ----------
const g = B.readJson(input);
const lv = A.parseLevel(A.fromGameFormat(g));
const picks = userPath ? readPicks(userPath) : freeFirstRoute(lv);
const s = A.Simulator.createState(lv, { useSlotStart: true, bottomOnly: false, instantChain: false });
const rows = [];
for (let i = 0; i < picks.length; i++) {
  if (s.gameWon || s.eliminatedPixels >= s.totalPixels) break;
  const ms = live(s);
  const opts = ms.map(m => ({ m, v: classifyMove(s, m) })).filter(x => x.v);
  const F = opts.filter(x => x.v.isF);
  const D = opts.filter(x => !x.v.isF);
  const Fgain = F.length ? Math.max(...F.map(x => x.v.gain)) : null;
  const bestGain = opts.length ? Math.max(...opts.map(x => x.v.gain)) : 0;
  const bestDGain = D.length ? Math.max(...D.map(x => x.v.gain)) : 0;
  const weakFree = F.length > 0 && bestDGain > 0 && Fgain < bestDGain * weakRatio;
  const rec = s.buffer.length >= 3 ? recoveryDepth(s, maxDepth, { n: 300 }) : null;
  rows.push({
    step: i + 1, buffer: s.buffer.length, M: ms.length,
    C: opts.filter(x => x.v.gain > 0).length, F: F.length, D: D.length,
    Fgain, bestGain, bestDGain, weakFree,
    recoveryDepth: rec,
    pick: picks[i]
  });
  if (!A.Simulator.applyPick(s, picks[i].r, picks[i].c)) { rows[rows.length - 1].illegal = true; break; }
}

const at3 = rows.filter(r => r.buffer >= 3);
const recs = at3.map(r => r.recoveryDepth).filter(x => x != null);
const summary = {
  steps: rows.length,
  won: s.gameWon || s.eliminatedPixels >= s.totalPixels,
  progress: s.totalPixels ? +(s.eliminatedPixels / s.totalPixels).toFixed(3) : 0,
  avgM: rows.length ? +(rows.reduce((a, r) => a + r.M, 0) / rows.length).toFixed(2) : 0,
  avgF: rows.length ? +(rows.reduce((a, r) => a + r.F, 0) / rows.length).toFixed(2) : 0,
  f0Steps: rows.filter(r => r.F === 0).length,
  f0AtBuf3: at3.filter(r => r.F === 0).length,
  weakFreeSteps: rows.filter(r => r.weakFree).length,
  weakFreeAtBuf3: at3.filter(r => r.weakFree).length,
  avgFgain: rows.filter(r => r.Fgain != null).length
    ? +(rows.filter(r => r.Fgain != null).reduce((a, r) => a + r.Fgain, 0) / rows.filter(r => r.Fgain != null).length).toFixed(2)
    : null,
  minFgainAtBuf3: at3.filter(r => r.Fgain != null).length ? Math.min(...at3.filter(r => r.Fgain != null).map(r => r.Fgain)) : null,
  unrecoverableAtBuf3: at3.filter(r => r.recoveryDepth == null).length,
  recoveryDepthAvg: recs.length ? +(recs.reduce((a, b) => a + b, 0) / recs.length).toFixed(2) : null,
  recoveryDepthMax: recs.length ? Math.max(...recs) : null
};

if (outFile) fs.writeFileSync(outFile, JSON.stringify({ tool: 'PlayerChoiceCheck_v1', input, path: userPath, summary, rows }, null, 1));
console.log('=== ' + path.basename(input) + (userPath ? ' · ' + path.basename(userPath) : ' · free-first') + ' ===');
for (const r of rows) {
  if (r.buffer < 3 && !r.weakFree) continue;
  console.log(`  step ${String(r.step).padStart(2)} buf=${r.buffer} M=${r.M} F=${r.F} Fgain=${r.Fgain == null ? '-' : r.Fgain} bestD=${r.bestDGain}${r.weakFree ? ' WEAK' : ''} rec=${r.recoveryDepth == null ? 'NONE' : r.recoveryDepth}`);
}
console.log('\n=== summary ===');
console.log(JSON.stringify(summary, null, 1));
