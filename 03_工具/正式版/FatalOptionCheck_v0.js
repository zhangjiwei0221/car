#!/usr/bin/env node
'use strict';
/**
 * FatalOptionCheck_v0 —— 产线 v5-0：致命选项检查（2026-11-11，实验）
 *
 * 问题：容错不该是"有免费退路"，而是"没有致命选项"。本工具沿一条"像人、但不自杀"的路线，
 *       每一步枚举所有可点的车，判断点了之后还能不能通关。
 *
 * 选项分类（每步）：
 *   free   本步后暂存车数不增加
 *   cost   暂存车数增加，但之后仍可通关
 *   fatal  点了之后不可能通关：
 *            immediate —— 当步就死（溢出/死局）
 *            hidden    —— 当步没死，但已无解（"延迟致死"，玩家看不出来）
 *   bait   最"诱人"的选项（本步吃得最多，平手看暂存少）恰好是 fatal
 *
 * 可通关判定：宽度 W1 的束搜索（暂存少优先、吃得多次之）；失败再用 W2 复核。
 *   束搜索找不到 ≠ 严格无解，fatal 是"强搜索也找不到解"的近似（会略高估）。
 *
 * 路线：每步在"非致命"选项里按同一个诱人度挑（人会选的、但不自杀的那条）。
 *
 * 规则：corner（与 ArlCheck_v793 同一个 Simulator）。
 *
 * 用法：node FatalOptionCheck_v0.js <关卡.json> [--w1 8] [--w2 32] [--out 结果.json]
 */
const fs = require('fs');
const path = require('path');
const B = require('./Build006Thickness_v688');
const A = B.loadSolver('corner');
const Sim = A.Simulator, St = A.SolverStrategy;

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const file = process.argv[2];
if (!file || file.startsWith('--')) { console.error('用法: node FatalOptionCheck_v0.js <关卡.json> [--w1 8] [--w2 32] [--out 结果.json]'); process.exit(2); }
const W1 = Number(arg('--w1', 8));
const W2 = Number(arg('--w2', 32));
const OUT = arg('--out', '');

const game = JSON.parse(fs.readFileSync(file, 'utf8'));
const lv = A.parseLevel(A.fromGameFormat(game));
const s0 = Sim.createState(lv, { useSlotStart: true, instantChain: false });

function keyOf(s) {
  let k = '';
  for (const row of s.cells) for (const c of row) k += (c && c.t === 'box') ? '1' : '0';
  let ice = '';
  if (s.numice) for (const kk of Object.keys(s.numice).sort()) ice += kk + ':' + s.numice[kk].remaining + ';';
  return k + '|' + s.eliminatedPixels + '|' + ice + '|' + s.buffer.map(b => b.color + ':' + b.progress).sort().join(',');
}
const isWon = (s) => s.eliminatedPixels >= s.totalPixels;
const isDead = (s) => !!(s.overflow || s.buffer.length > s.bufferLimit || Sim.isDeadEnd(s));

function expand(s) {
  const out = [];
  for (const m of Sim.listMoves(s)) {
    if (m.blocked) continue;
    const t = St.cloneState(s);
    const e0 = t.eliminatedPixels;
    if (!Sim.applyPick(t, m.r, m.c)) continue;
    out.push({ r: m.r, c: m.c, t, eat: t.eliminatedPixels - e0, groupSize: m.groupSize, color: m.antBox && m.antBox.color });
  }
  return out;
}

const winCache = new Map();
function winnable(s, W) {
  if (isWon(s)) return true;
  if (isDead(s)) return false;
  const k0 = keyOf(s);
  const c = winCache.get(k0);
  if (c === true) return true;
  if (c !== undefined && c >= W) return false;
  let beam = [s];
  let won = false;
  while (beam.length && !won) {
    const next = new Map();
    for (const x of beam) {
      for (const o of expand(x)) {
        if (isWon(o.t)) { won = true; break; }
        if (isDead(o.t)) continue;
        const k = keyOf(o.t);
        if (winCache.get(k) === true) { won = true; break; }
        if (!next.has(k)) next.set(k, o.t);
      }
      if (won) break;
    }
    const arr = [...next.values()];
    arr.sort((a, b) => (a.buffer.length - b.buffer.length) || (b.eliminatedPixels - a.eliminatedPixels));
    beam = arr.slice(0, W);
  }
  winCache.set(k0, won ? true : Math.max(W, typeof c === 'number' ? c : 0));
  return won;
}

// 诱人度：本步吃得多 > 暂存少（人看得见的即时收益）
const lureCmp = (a, b) => (b.eat - a.eat) || (a.t.buffer.length - b.t.buffer.length);

const t0 = Date.now();
const steps = [];
let s = s0;
let doomed = false;
while (!isWon(s)) {
  const opts = expand(s);
  if (!opts.length) { doomed = true; break; }
  const bufBefore = s.buffer.length;
  for (const o of opts) {
    o.bufAfter = o.t.buffer.length;
    o.free = o.bufAfter <= bufBefore;
    if (isWon(o.t)) { o.fatal = null; continue; }
    if (isDead(o.t)) { o.fatal = 'immediate'; continue; }
    if (winnable(o.t, W1) || winnable(o.t, W2)) { o.fatal = null; continue; }
    o.fatal = 'hidden';
  }
  opts.sort(lureCmp);
  const safe = opts.filter(o => !o.fatal);
  const rec = {
    step: steps.length + 1,
    buffer: bufBefore,
    M: opts.length,
    free: opts.filter(o => o.free && !o.fatal).length,
    cost: opts.filter(o => !o.free && !o.fatal).length,
    fatalImmediate: opts.filter(o => o.fatal === 'immediate').length,
    fatalHidden: opts.filter(o => o.fatal === 'hidden').length,
    bait: !!opts[0].fatal,
    baitKind: opts[0].fatal || null,
    pick: safe.length ? { r: safe[0].r, c: safe[0].c, eat: safe[0].eat, bufAfter: safe[0].bufAfter } : null,
  };
  steps.push(rec);
  if (!safe.length) { doomed = true; break; }
  s = safe[0].t;
}

const n = steps.length;
const sum = (f) => steps.reduce((a, x) => a + f(x), 0);
const totalOpts = sum(x => x.M);
const summary = {
  level: path.basename(file),
  W1, W2,
  steps: n,
  doomed,
  options: totalOpts,
  fatalImmediate: sum(x => x.fatalImmediate),
  fatalHidden: sum(x => x.fatalHidden),
  fatalShare: totalOpts ? +(sum(x => x.fatalImmediate + x.fatalHidden) / totalOpts).toFixed(3) : 0,
  hiddenShare: totalOpts ? +(sum(x => x.fatalHidden) / totalOpts).toFixed(3) : 0,
  stepsWithFatal: steps.filter(x => x.fatalImmediate + x.fatalHidden > 0).length,
  stepsWithHidden: steps.filter(x => x.fatalHidden > 0).length,
  baitSteps: steps.filter(x => x.bait).length,
  baitHidden: steps.filter(x => x.baitKind === 'hidden').length,
  firstBaitStep: (steps.find(x => x.bait) || {}).step || null,
  firstHiddenStep: (steps.find(x => x.fatalHidden > 0) || {}).step || null,
  onlyOneSafeSteps: steps.filter(x => x.free + x.cost === 1).length,
  pressureSteps: steps.filter(x => x.buffer >= 3).length,
  pressureFatalShare: (() => {
    const p = steps.filter(x => x.buffer >= 3);
    const m = p.reduce((a, x) => a + x.M, 0);
    return m ? +(p.reduce((a, x) => a + x.fatalImmediate + x.fatalHidden, 0) / m).toFixed(3) : 0;
  })(),
  sec: +((Date.now() - t0) / 1000).toFixed(1),
};
console.log(JSON.stringify(summary));
if (OUT) fs.writeFileSync(OUT, JSON.stringify({ summary, steps }, null, 2));
