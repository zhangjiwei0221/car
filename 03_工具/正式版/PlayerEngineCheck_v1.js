#!/usr/bin/env node
'use strict';
/**
 * PlayerEngineCheck_v1 —— 玩家引擎可通关复核
 *
 * 背景：求解器的 min 路线是「一次取车=完整结算」；真机/PlayerSim 是「逐步/并发结算」。
 * 两者可以给出相反结论（G2_9_0023：求解器 36 步通关，玩家照走第 19 步死）。
 *
 * 本工具只读，做三件事：
 *   1. Solver.runMinBuffer：求解器口径是否能通；
 *   2. 把 min 路线强制给 PlayerSim：玩家引擎能否照走；
 *   3. 小策略族（pickThreshold 0.4/0.6/0.8 × reviveCap）：玩家是否至少有一条路能通。
 *
 * 用法：
 *   node PlayerEngineCheck_v1.js <关卡.json | 目录> [--out report.json]
 *        [--revives 0,2] [--family] [--lookahead] [--limit N]
 *
 * 输出：每关一行；JSON 里带 forcedMismatch / deathStep / 每个策略的结果。
 */
const fs = require('fs');
const path = require('path');
const B = require('./Build006Thickness_v688');
const A = B.loadSolver('corner');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.indexOf(k) > 0;
const input = process.argv[2];
if (!input) {
  console.error('用法: node PlayerEngineCheck_v1.js <关卡.json | 目录> [--out report.json] [--revives 0,2] [--family] [--lookahead] [--limit N]');
  process.exit(2);
}
const outFile = arg('--out', null);
const reviveCaps = String(arg('--revives', '0,2')).split(',').map(Number).filter(Number.isFinite);
const useFamily = has('--family');
const useLookahead = has('--lookahead');
const limit = Number(arg('--limit', 0)) || 0;
const thresholds = useFamily ? [0.4, 0.6, 0.8] : [0.6];
const lookaheads = useLookahead ? [false, true] : [false];

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

function forcedFromMin(lv, min) {
  const byStep = {};
  for (const p of min.pickOrder || []) if (!byStep[p.step]) byStep[p.step] = { r: p.r, c: p.c };
  const fp = {};
  for (const k of Object.keys(byStep)) fp[+k - 1] = byStep[k];
  const res = A.PlayerSim.run(lv, { seed: 7, instantChain: false, reviveCap: 0, forcedPicks: fp });
  let mismatch = 0;
  for (const k of Object.keys(byStep)) {
    const s = +k, at = res.pickOrder.filter(p => p.step === s);
    if (!at.some(p => p.r === byStep[s].r && p.c === byStep[s].c)) mismatch++;
  }
  return { res, mismatch, steps: Object.keys(byStep).length };
}

function policyRuns(lv, caps) {
  const runs = [];
  for (const t of thresholds) {
    for (const la of lookaheads) {
      for (const cap of caps) {
        const r = A.PlayerSim.run(lv, {
          seed: 7, instantChain: false, reviveCap: cap,
          pickThreshold: t, lookahead2: la, lookaheadLimit: 6
        });
        runs.push({
          threshold: t, lookahead: la, reviveCap: cap,
          won: !!r.won, picks: r.picks, revivesUsed: r.revivesUsed || 0,
          deathStep: r.deathSnapshot ? r.deathSnapshot.step : null,
          progress: r.progress
        });
      }
    }
  }
  return runs;
}

const files = collect(input).slice(0, limit || undefined);
const rows = [];
for (const file of files) {
  let g;
  try { g = B.readJson(file); } catch (e) { rows.push({ file, error: 'read: ' + e.message }); continue; }
  if (!isLevel(g)) { rows.push({ file, error: 'not a level' }); continue; }
  const lv = A.parseLevel(A.fromGameFormat(g));
  const min = minRoute(lv);
  const forced = forcedFromMin(lv, min);
  const policies = policyRuns(lv, reviveCaps);
  const byCap = {};
  for (const r of policies) {
    byCap[r.reviveCap] = byCap[r.reviveCap] || { won: false, best: null };
    if (r.won && !byCap[r.reviveCap].won) byCap[r.reviveCap] = { won: true, best: r };
  }
  const row = {
    file: path.basename(file),
    solverWon: !!min.won,
    solverSteps: min.steps || new Set((min.pickOrder || []).map(p => p.step)).size,
    solverBoxes: (min.pickOrder || []).length,
    forcedWon: !!forced.res.won,
    forcedPicks: forced.res.picks,
    forcedDeath: forced.res.deathSnapshot ? forced.res.deathSnapshot.step : null,
    forcedMismatch: forced.mismatch,
    policy: byCap,
    policies,
    playerSolvable0: !!(byCap[0] && byCap[0].won),
    playerSolvable2: !!(byCap[2] && byCap[2].won)
  };
  row.gap = row.solverWon && !row.playerSolvable0;
  rows.push(row);
  const flag = (b) => b ? 'Y' : 'N';
  console.log(`${String(row.file).padEnd(28)} solver=${flag(row.solverWon)}(${row.solverSteps}) forced=${flag(row.forcedWon)}(${row.forcedPicks}${row.forcedDeath ? ',d' + row.forcedDeath : ''},mm${row.forcedMismatch}) policy0=${flag(row.playerSolvable0)} policy2=${flag(row.playerSolvable2)}${row.gap ? '  << GAP' : ''}`);
}

const summary = {
  levels: rows.filter(r => !r.error).length,
  errors: rows.filter(r => r.error).length,
  solverWon: rows.filter(r => r.solverWon).length,
  forcedWon: rows.filter(r => r.forcedWon).length,
  playerSolvable0: rows.filter(r => r.playerSolvable0).length,
  playerSolvable2: rows.filter(r => r.playerSolvable2).length,
  gap: rows.filter(r => r.gap).length
};
console.log('\n=== summary ===');
console.log(JSON.stringify(summary, null, 2));
if (outFile) {
  fs.writeFileSync(outFile, JSON.stringify({ tool: 'PlayerEngineCheck_v1', summary, rows }, null, 2));
  console.log('saved ' + outFile);
}
