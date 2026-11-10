#!/usr/bin/env node
'use strict';
/**
 * ClickSettlePolicyCheck_v1 —— 点击结算口径的策略族（policy0/2）
 *
 * 口径（用户 2026-11-10）：
 *   - 点一次车 → 当前可达像素一次吃满（Simulator.applyPick）；
 *   - 暂存区最多 5；锁链组入场需 N 个空位，buffer+N>5 即不可选；
 *   - 结算后满 5 且本步无车吃满 → 死；没有“短暂超 5”。
 *
 * 策略族（每条都在点击结算下自己选路）：
 *   solver-min     ：Solver.runMinBuffer 的最小暂存路线；不可用步回退到 free-first
 *   free-first     ：先拿能吃完的，再比吃得多/债少
 *   max-eat        ：先比吃得多，再比能吃完/债少
 *   small-debt     ：先比暂存少/剩余债少，再比吃得多
 *   beam（可选）   ：束搜索，--beam N 开启（默认关）
 *
 * 每个策略跑 0 / 2 次复活：
 *   复活 = 移除暂存里剩余最大的 2 辆车（暂存不足 2 时用棋盘残留盒补足），
 *          无视可达性直接消掉它们的剩余像素；与 PlayerSim.revivePS 同一语义。
 *
 * 用法：
 *   node ClickSettlePolicyCheck_v1.js <关卡.json | 目录> [--out report.json] [--limit N] [--beam N] [--route-dir DIR]
 *   --route-dir：把每关 free-first cap0 的路线写成 OpeningCheck 可读的 click JSON。
 * 输出：每关一行 policy0=Y/N policy2=Y/N + 每个策略的胜负/死亡步。
 * 只读，不改关卡。
 */
const fs = require('fs');
const path = require('path');
const B = require('./Build006Thickness_v688');
const A = B.loadSolver('corner');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const input = process.argv[2];
const outFile = arg('--out', null);
const limit = Number(arg('--limit', 0)) || 0;
const beamWidth = Number(arg('--beam', 0)) || 0;
const routeDir = arg('--route-dir', null);
if (!input) {
  console.error('用法: node ClickSettlePolicyCheck_v1.js <关卡.json | 目录> [--out report.json] [--limit N] [--beam N]');
  process.exit(2);
}

const STRATEGIES = ['solver', 'free-first', 'max-eat', 'small-debt'];
if (beamWidth > 0) STRATEGIES.push('beam');
const CAPS = [0, 2];

function collect(p) {
  const st = fs.statSync(p);
  if (st.isFile()) return [p];
  return fs.readdirSync(p).filter(f => f.endsWith('.json')).sort().map(f => path.join(p, f));
}
function isLevel(g) {
  return !!(g && g.toprow && Array.isArray(g.blocks) && Array.isArray(g.spools));
}
function clone(s) { return JSON.parse(JSON.stringify(s)); }
function cmp(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  }
  return 0;
}
function solverPicks(lv) {
  const min = A.Solver.runMinBuffer(lv, { depth: 3, instantChain: false });
  const byStep = {};
  for (const p of min.pickOrder || []) if (!byStep[p.step]) byStep[p.step] = p;
  return {
    won: !!min.won,
    picks: Object.keys(byStep).map(Number).sort((a, b) => a - b).map(s => ({ r: byStep[s].r, c: byStep[s].c }))
  };
}
function moveScore(s, m, strategy) {
  const c = clone(s);
  const before = c.eliminatedPixels;
  if (!A.Simulator.applyPick(c, m.r, m.c)) return null;
  const gain = c.eliminatedPixels - before;
  const buf = c.buffer.length;
  const stuckPx = c.buffer.reduce((a, b) => a + (b.need - b.progress), 0);
  const free = buf === 0 ? 1 : 0;
  const completedDelta = c.completedBoxes - s.completedBoxes;
  const noMoves = c.eliminatedPixels < c.totalPixels && A.Simulator.listMoves(c).filter(x => !x.blocked).length === 0;
  const dead = c.overflow || buf > c.bufferLimit || (buf >= c.bufferLimit && completedDelta === 0) || noMoves;
  let score;
  if (strategy === 'max-eat') score = [dead ? 0 : 1, gain, free, -buf, -stuckPx, -m.r, -m.c];
  else if (strategy === 'small-debt') score = [dead ? 0 : 1, free, -buf, -stuckPx, gain, -m.r, -m.c];
  else score = [dead ? 0 : 1, free, gain, -buf, -stuckPx, -m.r, -m.c]; // free-first / fallback
  return { m, score, dead };
}
function chooseMove(s, strategy) {
  const moves = A.Simulator.listMoves(s).filter(m => !m.blocked);
  let best = null;
  for (const m of moves) {
    const sc = moveScore(s, m, strategy);
    if (!sc) continue;
    if (!best || cmp(sc.score, best.score) > 0) best = sc;
  }
  return best;
}
function revive(s) {
  const targets = [];
  for (const b of s.buffer) {
    targets.push({
      kind: 'b', ref: b, color: b.color, rem: b.need - b.progress,
      ar: b.start ? b.start.r : 0, ac: b.start ? b.start.c : (b.slot || 0)
    });
  }
  targets.sort((a, b) => b.rem - a.rem);
  const picked = targets.slice(0, 2);
  if (picked.length < 2) {
    const board = [];
    for (let r = 0; r < s.boardRows; r++) for (let c = 0; c < s.boardCols; c++) {
      const cell = s.cells[r] && s.cells[r][c];
      const isBox = A.isBox ? A.isBox(cell) : !!(cell && cell.t === 'box');
      if (isBox) board.push({ kind: 'g', r, c, color: cell.color, rem: cell.count, ar: 0, ac: c });
    }
    board.sort((a, b) => b.rem - a.rem);
    for (let i = 0; i < board.length && picked.length < 2; i++) picked.push(board[i]);
  }
  if (!picked.length) return false;
  const removed = new Set();
  for (const tg of picked) {
    const px = [];
    for (let r = 0; r < s.boardRows; r++) for (let c = 0; c < s.boardCols; c++) {
      if (!s.eliminated[r][c] && s.blocks[r][c] === tg.color) {
        px.push({ r, c, d: Math.abs(r - tg.ar) + Math.abs(c - tg.ac) });
      }
    }
    px.sort((a, b) => (a.d - b.d) || (b.r - a.r) || (a.c - b.c));
    const k = Math.min(tg.rem, px.length);
    for (let i = 0; i < k; i++) {
      const q = px[i];
      s.eliminated[q.r][q.c] = true;
      s.eliminatedPixels++;
    }
    if (tg.kind === 'b') {
      removed.add(tg.ref);
      s.completedBoxes++;
    } else {
      s.cells[tg.r][tg.c] = null;
      s.completedBoxes++;
    }
  }
  if (removed.size) s.buffer = s.buffer.filter(b => !removed.has(b));
  A.Simulator.autoReleaseBuffer(s);
  s.overflow = false;
  return true;
}
function deadNow(s, completedBefore) {
  if (s.eliminatedPixels >= s.totalPixels) return false;
  if (s.overflow) return true;
  if (s.buffer.length > s.bufferLimit) return true;
  if (s.buffer.length >= s.bufferLimit && s.completedBoxes === completedBefore) return true;
  return A.Simulator.listMoves(s).filter(m => !m.blocked).length === 0;
}
function runOne(lv, strategy, cap, sp) {
  const s = A.Simulator.createState(lv, { useSlotStart: true, bottomOnly: false, instantChain: false });
  let revives = 0, picks = 0, bufferPeak = 0, solverIdx = 0, fallbacks = 0;
  const route = [];
  const maxPicks = s.totalBoxes + 20;
  for (let step = 0; step < maxPicks; step++) {
    if (s.eliminatedPixels >= s.totalPixels) {
      return { strategy, cap, won: true, picks, revivesUsed: revives, deathStep: null, progress: 1, bufferPeak, fallbacks, route };
    }
    let chosen = null;
    if (strategy === 'solver') {
      while (solverIdx < sp.picks.length) {
        const p = sp.picks[solverIdx];
        const m = A.Simulator.listMoves(s).find(x => x.r === p.r && x.c === p.c && !x.blocked);
        solverIdx++;
        if (m) { chosen = { m, dead: false }; break; }
      }
      if (!chosen) { chosen = chooseMove(s, 'free-first'); fallbacks++; }
    } else if (strategy === 'beam') {
      chosen = chooseMove(s, 'free-first'); // beam 路线在 runBeam 里单独算；这里只作兜底
    } else {
      chosen = chooseMove(s, strategy);
    }
    if (!chosen) {
      if (revives < cap && revive(s)) { revives++; continue; }
      return { strategy, cap, won: false, picks, revivesUsed: revives, deathStep: picks + 1, progress: s.eliminatedPixels / s.totalPixels, bufferPeak, fallbacks, route };
    }
    const completedBefore = s.completedBoxes;
    const bufferBefore = s.buffer.length;
    if (!A.Simulator.applyPick(s, chosen.m.r, chosen.m.c)) {
      if (revives < cap && revive(s)) { revives++; continue; }
      return { strategy, cap, won: false, picks, revivesUsed: revives, deathStep: picks + 1, progress: s.eliminatedPixels / s.totalPixels, bufferPeak, fallbacks, route };
    }
    picks++;
    route.push({ step: picks, r: chosen.m.r, c: chosen.m.c, bufferBefore, bufferAfter: s.buffer.length, revives });
    if (s.buffer.length > bufferPeak) bufferPeak = s.buffer.length;
    if (s.eliminatedPixels >= s.totalPixels) {
      return { strategy, cap, won: true, picks, revivesUsed: revives, deathStep: null, progress: 1, bufferPeak, fallbacks, route };
    }
    if (deadNow(s, completedBefore)) {
      if (revives < cap && revive(s)) { revives++; continue; }
      return { strategy, cap, won: false, picks, revivesUsed: revives, deathStep: picks + 1, progress: s.eliminatedPixels / s.totalPixels, bufferPeak, fallbacks, route };
    }
  }
  return { strategy, cap, won: false, picks, revivesUsed: revives, deathStep: 'limit', progress: s.eliminatedPixels / s.totalPixels, bufferPeak, fallbacks, route };
}
function runBeam(lv, width) {
  const start = A.Simulator.createState(lv, { useSlotStart: true, bottomOnly: false, instantChain: false });
  let beam = [{ s: start, picks: 0 }];
  const seen = new Set();
  for (let depth = 0; depth < 120 && beam.length; depth++) {
    const next = [];
    for (const node of beam) {
      if (node.s.eliminatedPixels >= node.s.totalPixels) {
        return { strategy: 'beam', cap: 0, won: true, picks: node.picks, revivesUsed: 0, deathStep: null, progress: 1, bufferPeak: 0, fallbacks: 0 };
      }
      const moves = A.Simulator.listMoves(node.s).filter(m => !m.blocked);
      for (const m of moves) {
        const c = clone(node.s);
        const completedBefore = c.completedBoxes;
        if (!A.Simulator.applyPick(c, m.r, m.c)) continue;
        if (c.eliminatedPixels < c.totalPixels && deadNow(c, completedBefore)) continue;
        next.push({ s: c, picks: node.picks + 1 });
      }
    }
    if (!next.length) break;
    next.sort((a, b) => (b.s.eliminatedPixels - a.s.eliminatedPixels) || (a.s.buffer.length - b.s.buffer.length));
    const uniq = [];
    const seenLocal = new Set();
    for (const n of next) {
      const sig = n.s.eliminated.map(r => r.map(x => x ? 1 : 0).join('')).join('') + '|' +
        n.s.buffer.map(b => b.color + ':' + (b.need - b.progress)).sort().join(',');
      if (seenLocal.has(sig)) continue;
      seenLocal.add(sig);
      uniq.push(n);
      if (uniq.length >= width) break;
    }
    beam = uniq;
  }
  return { strategy: 'beam', cap: 0, won: false, picks: 0, revivesUsed: 0, deathStep: 'beam-N', progress: beam.length ? beam[0].s.eliminatedPixels / beam[0].s.totalPixels : 0, bufferPeak: 0, fallbacks: 0 };
}

const files = collect(input).slice(0, limit || undefined);
const rows = [];
for (const file of files) {
  let g;
  try { g = B.readJson(file); } catch (e) { rows.push({ file, error: 'read: ' + e.message }); continue; }
  if (!isLevel(g)) { rows.push({ file, error: 'not a level' }); continue; }
  const lv = A.parseLevel(A.fromGameFormat(g));
  const sp = solverPicks(lv);
  const results = [];
  for (const strategy of STRATEGIES) {
    if (strategy === 'beam') {
      results.push(runBeam(lv, beamWidth));
      continue;
    }
    for (const cap of CAPS) results.push(runOne(lv, strategy, cap, sp));
  }
  const wins0 = results.filter(r => r.cap === 0 && r.won);
  const wins2 = results.filter(r => r.cap === 2 && r.won);
  const best0 = wins0[0] || results.filter(r => r.cap === 0).sort((a, b) => b.progress - a.progress)[0];
  const best2 = wins2[0] || results.filter(r => r.cap === 2).sort((a, b) => b.progress - a.progress)[0];
  if (routeDir) {
    fs.mkdirSync(routeDir, { recursive: true });
    const ff = results.find(r => r.strategy === 'free-first' && r.cap === 0);
    if (ff) {
      const outName = path.basename(file).replace(/\.json$/i, '') + '.freefirst.click.json';
      fs.writeFileSync(path.join(routeDir, outName), JSON.stringify({
        level: file,
        source: 'ClickSettlePolicyCheck_v1',
        strategy: 'free-first',
        cap: 0,
        won: ff.won,
        deathStep: ff.deathStep,
        steps: (ff.route || []).map(s => ({ step: s.step, picked: [{ r: s.r, c: s.c }], bufferAfter: s.bufferAfter, revives: s.revives }))
      }, null, 2));
    }
  }
  for (const r of results) delete r.route;
  const row = {
    file: path.basename(file),
    policy0: wins0.length > 0,
    policy2: wins2.length > 0,
    best0: best0 ? { strategy: best0.strategy, won: best0.won, picks: best0.picks, deathStep: best0.deathStep, progress: best0.progress } : null,
    best2: best2 ? { strategy: best2.strategy, won: best2.won, picks: best2.picks, revivesUsed: best2.revivesUsed, deathStep: best2.deathStep, progress: best2.progress } : null,
    results
  };
  rows.push(row);
  const f = b => b ? 'Y' : 'N';
  console.log(`${String(row.file).padEnd(34)} policy0=${f(row.policy0)} policy2=${f(row.policy2)} best0=${best0 ? best0.strategy + (best0.won ? '' : '(N@' + best0.deathStep + ')') : '-'} best2=${best2 ? best2.strategy + (best2.won ? '' : '(N@' + best2.deathStep + ')') : '-'}`);
}

const summary = {
  levels: rows.filter(r => !r.error).length,
  errors: rows.filter(r => r.error).length,
  policy0: rows.filter(r => r.policy0).length,
  policy2: rows.filter(r => r.policy2).length
};
console.log('\n=== summary ===');
console.log(JSON.stringify(summary, null, 2));
if (outFile) {
  fs.writeFileSync(outFile, JSON.stringify({ tool: 'ClickSettlePolicyCheck_v1', summary, rows }, null, 2));
  console.log('saved ' + outFile);
}
