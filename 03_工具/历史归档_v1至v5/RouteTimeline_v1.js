#!/usr/bin/env node
'use strict';
/**
 * RouteTimeline_v1 —— 一条路线的逐步时间线（M/C/F/D + 每个选项的后果）
 *
 * 用法：
 *   node RouteTimeline_v1.js <关卡.json> --mode freefirst|solver --out <json>
 *   node RouteTimeline_v1.js <关卡.json> --click <click.json> --out <json>
 *
 * 输出每一步：
 *   buf, M/C/F/D, 当前 cells/buffer, 所有合法选项的
 *   gain/bufferAfter/debtPx/dead/nextM/kind(F/D/C0)
 */
const fs = require('fs');
const B = require('./Build006Thickness_v688');
const A = B.loadSolver('corner');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const levelFile = process.argv[2];
const mode = arg('--mode', null);
const clickFile = arg('--click', null);
const outFile = arg('--out', null);
if (!levelFile || !outFile || (!mode && !clickFile)) {
  console.error('用法: node RouteTimeline_v1.js <关卡.json> --mode freefirst|solver --out <json> | --click <click.json> --out <json>');
  process.exit(2);
}
const g = JSON.parse(fs.readFileSync(levelFile, 'utf8'));
const lv = A.parseLevel(A.fromGameFormat(g));
const clone = x => JSON.parse(JSON.stringify(x));
function legal(s) { return A.Simulator.listMoves(s).filter(m => !m.blocked); }
function cmp(a, b) { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1; return 0; }

function solverRoute() {
  const min = A.Solver.runMinBuffer(lv, { depth: 3, instantChain: false });
  const byStep = {};
  for (const p of min.pickOrder || []) if (!byStep[p.step]) byStep[p.step] = p;
  const steps = Object.keys(byStep).map(Number).sort((a, b) => a - b).map(s => ({ r: byStep[s].r, c: byStep[s].c }));
  return { route: steps, solverWon: !!min.won, solverSteps: min.steps || steps.length };
}
function freeFirstRoute() {
  const s = A.Simulator.createState(lv, { useSlotStart: true, bottomOnly: false, instantChain: false });
  const route = [];
  for (let i = 0; i < 120; i++) {
    if (s.eliminatedPixels >= s.totalPixels) break;
    const moves = legal(s);
    if (!moves.length) break;
    let best = null;
    for (const m of moves) {
      const c = clone(s);
      const before = c.eliminatedPixels; const doneBefore = c.completedBoxes;
      if (!A.Simulator.applyPick(c, m.r, m.c)) continue;
      const gain = c.eliminatedPixels - before;
      const buf = c.buffer.length;
      const debt = c.buffer.reduce((a, b) => a + (b.need - b.progress), 0);
      const delta = c.completedBoxes - doneBefore;
      const noMoves = c.eliminatedPixels < c.totalPixels && legal(c).length === 0;
      const dead = c.overflow || buf > c.bufferLimit || (buf >= c.bufferLimit && delta === 0) || noMoves;
      const score = [dead ? 0 : 1, buf === 0 ? 1 : 0, gain, -buf, -debt, -m.r, -m.c];
      if (!best || cmp(score, best.score) > 0) best = { m, score };
    }
    if (!best) break;
    route.push({ r: best.m.r, c: best.m.c });
    const doneBefore = s.completedBoxes;
    if (!A.Simulator.applyPick(s, best.m.r, best.m.c)) break;
    if (s.eliminatedPixels >= s.totalPixels) break;
    if (s.overflow || s.buffer.length > s.bufferLimit || (s.buffer.length >= s.bufferLimit && s.completedBoxes === doneBefore) || legal(s).length === 0) break;
  }
  return { route, solverWon: s.eliminatedPixels >= s.totalPixels, solverSteps: route.length };
}
function routeFromClick() {
  const c = JSON.parse(fs.readFileSync(clickFile, 'utf8'));
  const steps = (c.steps || []).map(st => {
    const p = (st.picked || [])[0];
    return p ? { r: p.r, c: p.c } : null;
  }).filter(Boolean);
  return { route: steps, solverWon: !!c.won, solverSteps: steps.length };
}

const r = clickFile ? routeFromClick() : (mode === 'solver' ? solverRoute() : freeFirstRoute());
const s = A.Simulator.createState(lv, { useSlotStart: true, bottomOnly: false, instantChain: false });
const steps = [];
let bufferPeak = 0, f0AtBuf3 = 0, c0AtBufLt5 = 0, maxF0AtBuf3 = 0, runF0 = 0, firstF0 = null, firstC0 = null, mismatch = 0, deathStep = null;
for (let i = 0; i < r.route.length; i++) {
  const pick = r.route[i];
  const moves = legal(s);
  const beforeKeys = new Set(s.buffer.map(b => b.key));
  const options = [];
  for (const m of moves) {
    const c = clone(s);
    const beforePx = c.eliminatedPixels; const doneBefore = c.completedBoxes;
    if (!A.Simulator.applyPick(c, m.r, m.c)) continue;
    const gain = c.eliminatedPixels - beforePx;
    const bufAfter = c.buffer.length;
    const debtPx = c.buffer.reduce((a, b) => a + (b.need - b.progress), 0);
    const delta = c.completedBoxes - doneBefore;
    const newInc = c.buffer.filter(b => !beforeKeys.has(b.key) && (b.need - b.progress) > 0).length;
    const noMoves = c.eliminatedPixels < c.totalPixels && legal(c).length === 0;
    const dead = c.overflow || bufAfter > c.bufferLimit || (bufAfter >= c.bufferLimit && delta === 0) || noMoves;
    const nextM = c.eliminatedPixels >= c.totalPixels ? 0 : legal(c).length;
    const addsDebt = newInc > 0;
    const kind = gain === 0 ? 'C0' : (addsDebt ? 'D' : 'F');
    options.push({
      r: m.r, c: m.c, color: (s.cells[m.r][m.c] || {}).color, count: (s.cells[m.r][m.c] || {}).count,
      groupSize: m.groupSize, canConsume: !!m.canConsume, gain, bufferAfter: bufAfter, debtPx, dead, nextM,
      newInc, addsDebt, kind
    });
  }
  const M = options.length, C = options.filter(o => o.gain > 0).length, D = options.filter(o => o.addsDebt).length, F = options.filter(o => !o.addsDebt).length;
  const buf = s.buffer.length;
  if (buf > bufferPeak) bufferPeak = buf;
  if (buf >= 3) {
    if (F === 0) { f0AtBuf3++; if (firstF0 == null) firstF0 = i + 1; runF0++; if (runF0 > maxF0AtBuf3) maxF0AtBuf3 = runF0; }
    else runF0 = 0;
  } else runF0 = 0;
  if (buf < 5 && C === 0) { c0AtBufLt5++; if (firstC0 == null) firstC0 = i + 1; }
  const cells = s.cells.map(row => row.map(cell => cell ? { color: cell.color, count: cell.count, type: cell.type, param: cell.param } : null));
  const buffer = s.buffer.map(b => ({ color: b.color, need: b.need, progress: b.progress, remaining: b.need - b.progress, link: b.link || 0 }));
  const chosen = options.find(o => o.r === pick.r && o.c === pick.c);
  steps.push({ step: i + 1, pick, buf, M, C, F, D, options, cells, buffer, chosen: !!chosen, dead: chosen ? chosen.dead : null });
  if (!chosen) { mismatch++; deathStep = i + 1; break; }
  const doneBefore = s.completedBoxes;
  if (!A.Simulator.applyPick(s, pick.r, pick.c)) { mismatch++; deathStep = i + 1; break; }
  if (s.eliminatedPixels >= s.totalPixels) break;
  if (s.overflow || s.buffer.length > s.bufferLimit || (s.buffer.length >= s.bufferLimit && s.completedBoxes === doneBefore) || legal(s).length === 0) { deathStep = i + 1; break; }
}
const result = {
  route: clickFile ? 'click' : mode,
  routeSource: clickFile ? clickFile : mode,
  solverWon: r.solverWon,
  won: s.eliminatedPixels >= s.totalPixels,
  steps: steps.length,
  mismatch,
  deathStep,
  summary: { bufferPeak, f0AtBuf3, c0AtBufLt5, maxF0AtBuf3, firstF0, firstC0, steps: steps.length, won: s.eliminatedPixels >= s.totalPixels },
  timeline: steps
};
fs.writeFileSync(outFile, JSON.stringify(result, null, 1));
console.log(`${mode || 'click'} steps=${steps.length} won=${result.won ? 'Y' : 'N'} peak=${bufferPeak} F0@b3=${f0AtBuf3} C0<5=${c0AtBufLt5} mismatch=${mismatch} death=${deathStep || '-'}`);
