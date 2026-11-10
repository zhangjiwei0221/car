#!/usr/bin/env node
'use strict';
/**
 * ClickSettleEngineCheck_v1 —— 点击结算口径的 forced 检查
 *
 * 口径（用户 2026-11-10 明确）：
 *   - 点一次车 → 当前可达像素一次吃满（Simulator.applyPick，autoReleaseBuffer 推到底）；
 *   - 暂存区最多 5；锁链组入场需要 N 个空位，bufferBefore + groupSize > 5 即不可选；
 *   - 结算后满 5 且本步没有任何车吃满 → 死；
 *   - 不存在“本步有车吃满所以可以短暂超 5”。
 *
 * 做法：把 Solver.runMinBuffer 的最小暂存路线按顺序用 Simulator.applyPick 重放，
 * 看这条最优路线在点击结算口径下能否走完。与 PlayerEngineCheck 的 forced 不同：
 * 后者走 PlayerSim 默认模式（每 tick 每球吃 1px），本工具走 applyPick 的一次结算。
 *
 * 用法：
 *   node ClickSettleEngineCheck_v1.js <关卡.json | 目录> [--out report.json] [--limit N]
 *
 * 输出：每关一行；JSON 里带逐步 trace、死亡步/原因、暂存峰值。
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
if (!input) {
  console.error('用法: node ClickSettleEngineCheck_v1.js <关卡.json | 目录> [--out report.json] [--limit N]');
  process.exit(2);
}

function collect(p) {
  const st = fs.statSync(p);
  if (st.isFile()) return [p];
  return fs.readdirSync(p).filter(f => f.endsWith('.json')).sort().map(f => path.join(p, f));
}
function isLevel(g) {
  return g && g.toprow && Array.isArray(g.blocks) && Array.isArray(g.spools);
}
function minRoute(lv) {
  return A.Solver.runMinBuffer(lv, { depth: 3, instantChain: false });
}

// 点击结算 forced：逐步重放求解器最小路线。
function forcedClickSettle(lv, min) {
  const byStep = {};
  for (const p of min.pickOrder || []) {
    // 同一步链组会展开多条；chainIndex=0 是触发盒，取第一条即可。
    if (!byStep[p.step]) byStep[p.step] = p;
  }
  const stepNos = Object.keys(byStep).map(Number).sort((a, b) => a - b);
  const s = A.Simulator.createState(lv, { useSlotStart: true, bottomOnly: false, instantChain: false });
  const trace = [];
  let death = null;
  let bufferPeak = 0;
  let enterPeakMax = 0;

  for (const step of stepNos) {
    if (s.eliminatedPixels >= s.totalPixels) break;
    const p = byStep[step];
    const moves = A.Simulator.listMoves(s);
    const m = moves.find(x => x.r === p.r && x.c === p.c);
    if (!m) {
      death = { step, reason: 'pick-not-available' };
      break;
    }
    if (m.blocked) {
      death = {
        step,
        reason: m.groupSize > 1 ? 'chain-needs-' + m.groupSize + '-free' : 'full-cannot-consume',
        bufferBefore: s.buffer.length,
        groupSize: m.groupSize
      };
      break;
    }

    const bufferBefore = s.buffer.length;
    const completedBefore = s.completedBoxes;
    if (!A.Simulator.applyPick(s, p.r, p.c)) {
      death = { step, reason: 'applyPick-false' };
      break;
    }
    const bufferAfter = s.buffer.length;
    const completedDelta = s.completedBoxes - completedBefore;
    const enterPeak = s._enterPeak != null ? s._enterPeak : bufferAfter;
    if (bufferAfter > bufferPeak) bufferPeak = bufferAfter;
    if (enterPeak > enterPeakMax) enterPeakMax = enterPeak;
    trace.push({
      step, r: p.r, c: p.c, color: p.color, count: p.count,
      bufferBefore, enterPeak, bufferAfter, completedDelta
    });

    if (s.eliminatedPixels >= s.totalPixels) break;
    if (s.overflow) { death = { step, reason: 'overflow', bufferAfter }; break; }
    if (bufferAfter > s.bufferLimit) { death = { step, reason: 'buffer-' + bufferAfter + '>' + s.bufferLimit, bufferAfter }; break; }
    if (bufferAfter >= s.bufferLimit && completedDelta === 0) { death = { step, reason: 'full-no-complete', bufferAfter }; break; }
    const live = A.Simulator.listMoves(s).filter(x => !x.blocked);
    if (!live.length) { death = { step, reason: 'no-legal-moves', bufferAfter }; break; }
  }

  const won = s.eliminatedPixels >= s.totalPixels;
  if (!won && !death) death = { step: trace.length + 1, reason: 'route-exhausted' };
  return {
    won,
    steps: trace.length,
    totalSteps: stepNos.length,
    mismatch: stepNos.length - trace.length,
    death,
    bufferPeak,
    enterPeakMax,
    trace
  };
}

const files = collect(input).slice(0, limit || undefined);
const rows = [];
for (const file of files) {
  let g;
  try { g = B.readJson(file); } catch (e) { rows.push({ file, error: 'read: ' + e.message }); continue; }
  if (!isLevel(g)) { rows.push({ file, error: 'not a level' }); continue; }
  const lv = A.parseLevel(A.fromGameFormat(g));
  const min = minRoute(lv);
  const r = forcedClickSettle(lv, min);
  const row = {
    file: path.basename(file),
    solverWon: !!min.won,
    solverSteps: min.steps || new Set((min.pickOrder || []).map(p => p.step)).size,
    clickForcedWon: r.won,
    clickForcedSteps: r.steps,
    clickForcedTotalSteps: r.totalSteps,
    clickForcedMismatch: r.mismatch,
    clickForcedDeathStep: r.death ? r.death.step : null,
    clickForcedDeathReason: r.death ? r.death.reason : null,
    bufferPeak: r.bufferPeak,
    enterPeakMax: r.enterPeakMax,
    trace: r.trace
  };
  rows.push(row);
  const flag = b => b ? 'Y' : 'N';
  const d = r.death ? `,d${r.death.step},${r.death.reason}` : '';
  console.log(`${String(row.file).padEnd(28)} solver=${flag(row.solverWon)}(${row.solverSteps}) clickForced=${flag(row.clickForcedWon)}(${r.steps}${d},mm${r.mismatch},peak${r.bufferPeak})`);
}

const summary = {
  levels: rows.filter(r => !r.error).length,
  errors: rows.filter(r => r.error).length,
  solverWon: rows.filter(r => r.solverWon).length,
  clickForcedWon: rows.filter(r => r.clickForcedWon).length,
  clickForcedFail: rows.filter(r => r.solverWon && !r.clickForcedWon).length
};
console.log('\n=== summary ===');
console.log(JSON.stringify(summary, null, 2));
if (outFile) {
  fs.writeFileSync(outFile, JSON.stringify({ tool: 'ClickSettleEngineCheck_v1', summary, rows }, null, 2));
  console.log('saved ' + outFile);
}
