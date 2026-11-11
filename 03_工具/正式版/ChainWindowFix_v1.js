#!/usr/bin/env node
'use strict';
/**
 * ChainWindowFix_v1 —— 链组减薄（2026-11-11）
 *
 * 问题：ZC_18 有 4 组链（2+3+3+3=11 车），后段/左下角扎堆；三链窗口只有 1 步，
 *       玩家 buffer 一满就永远进不去，最后场上只剩链、没有空位。
 *
 * 规则（只改 type/chain，不改容量与颜色）：
 *   R3 保留最多 N 组链（默认 2），按「首次可点步早、窗口宽」排序；
 *   R4 晚段（首次可点 > 路线 40%）的三链 → 拆一个成员成单车，降为两链；
 *   R5 其余链组全部拆成单车（chain=0）。
 *
 * 用法：
 *   node ChainWindowFix_v1.js <关卡.json> --out <新关卡.json> [--keep 2] [--late 0.4]
 *
 * 只读输入；输出新关卡。改完仍要跑 ArlCheck / 点击结算 / PlayerSim / ChainRatchetCheck。
 */
const fs = require('fs');
const B = require('./Build006Thickness_v688');
const A = B.loadSolver('corner');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const input = process.argv[2];
const outFile = arg('--out', '');
const keep = Number(arg('--keep', 2));
const lateRatio = Number(arg('--late', 0.4));
if (!input || !outFile) {
  console.error('用法: node ChainWindowFix_v1.js <关卡.json> --out <新关卡.json> [--keep 2] [--late 0.4]');
  process.exit(2);
}

const clone = s => JSON.parse(JSON.stringify(s));
const live = s => A.Simulator.listMoves(s).filter(m => !m.blocked);

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
function windowStats(lv, picks) {
  const W = {};
  const s = A.Simulator.createState(lv, { useSlotStart: true, bottomOnly: false, instantChain: false });
  // 从模拟器初始棋盘收集每组链的成员（parseLevel 的静态 cells 不含 chain id）
  for (let r = 0; r < s.boardRows; r++) for (let c = 0; c < s.boardCols; c++) {
    const cell = s.cells[r][c];
    if (!cell || cell.t !== 'box' || !(cell.chain > 0)) continue;
    const k = cell.chain;
    W[k] = W[k] || { chain: k, first: null, steps: 0, minFree: 99, members: [] };
    W[k].members.push([r, c]);
  }
  for (const k of Object.keys(W)) W[k].size = W[k].members.length;
  // 沿 free-first 路线统计窗口
  let step = 0;
  for (const p of picks) {
    step++;
    if (s.gameWon || s.eliminatedPixels >= s.totalPixels) break;
    const seen = {};
    for (let r = 0; r < s.boardRows; r++) for (let c = 0; c < s.boardCols; c++) {
      const cell = s.cells[r][c];
      if (!cell || cell.t !== 'box' || !(cell.chain > 0)) continue;
      const k = cell.chain;
      if (seen[k]) continue;
      const cap = A.Simulator.pickCapacityOf(s, r, c);
      if (cap.ok) {
        seen[k] = 1;
        if (!W[k]) W[k] = { chain: k, first: null, steps: 0, minFree: 99, members: [] };
        if (W[k].first == null) W[k].first = step;
        W[k].steps++;
        W[k].minFree = Math.min(W[k].minFree, cap.free);
      }
    }
    A.Simulator.applyPick(s, p.r, p.c);
  }
  for (const k of Object.keys(W)) if (W[k].first == null) W[k].first = 1e9;
  return W;
}
function readJson(f) { return JSON.parse(fs.readFileSync(f, 'utf8')); }
function isBoxCell(cell) { return cell && cell.t === 'box'; }

// ---------- 主流程 ----------
const g = readJson(input);
const lv = A.parseLevel(A.fromGameFormat(g));
const picks = freeFirstRoute(lv);
const W = windowStats(lv, picks);
const groups = Object.keys(W).map(k => W[k]);
const totalSteps = picks.length || 1;
groups.sort((a, b) => (a.first - b.first) || (b.steps - a.steps));

const keepSet = new Set(groups.slice(0, keep).map(x => x.chain));
const actions = [];
function unchain(r, c) {
  const sp = g.spools && g.spools[r] && g.spools[r][c];
  if (!sp) return;
  if (Array.isArray(sp.type)) sp.type = sp.type.filter(t => t !== 5);
  else if (sp.type === 5) sp.type = 0;
}
for (const grp of groups) {
  const late = grp.first / totalSteps > lateRatio;
  if (keepSet.has(grp.chain) && !(late && grp.size === 3)) {
    actions.push({ chain: grp.chain, size: grp.size, first: grp.first, action: 'keep' });
    continue;
  }
  if (keepSet.has(grp.chain) && late && grp.size === 3) {
    // 晚段三链：拆掉最后一个成员（按行/列顺序），降为两链
    const m = grp.members[grp.members.length - 1];
    unchain(m[0], m[1]);
    actions.push({ chain: grp.chain, size: 3, first: grp.first, action: 'break-one', at: m });
    continue;
  }
  for (const m of grp.members) unchain(m[0], m[1]);
  actions.push({ chain: grp.chain, size: grp.size, first: grp.first, action: 'break-all' });
}

fs.writeFileSync(outFile, JSON.stringify(g));
console.log('链组窗口（free-first）：');
for (const grp of groups) console.log('  C' + grp.chain + ' size=' + grp.size + ' first=' + grp.first + ' steps=' + grp.steps + ' minFree=' + grp.minFree);
console.log('动作：');
for (const a of actions) console.log('  ' + JSON.stringify(a));
console.log('已写：' + outFile);
