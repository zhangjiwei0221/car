#!/usr/bin/env node
'use strict';
/**
 * ReachPlan_v1 —— 每种颜色的「可达量」体检
 *
 * 对一张关，分别沿两条路线统计每种颜色：
 *   - PlayerSim 0 复活路线（玩家实际能走到的）
 *   - 求解器 min 路线（完整拿起全部车；只作参考上界）
 *
 * 指标：
 *   total          该色总像素
 *   playerSum      玩家路线里，该色各车被拿时的 reach 之和（下界）
 *   playerMax      玩家路线里，该色出现过的最大 reach
 *   solverSum      求解器路线里，该色各车被拿时的 reach 之和（参考）
 *   shortPlayer    total - playerSum
 *   shortSolver    total - solverSum
 *
 * 判定（诊断，不是硬判死）：
 *   ok            playerSum >= total
 *   route-short   playerSum < total，但 solverSum >= total（路线没走到）
 *   both-short    两边都 < total（reach 测量下界，或真的不够）
 *   unpicked      玩家路线根本没拿到该色
 *
 * 用法：
 *   node ReachPlan_v1.js <关卡.json | 目录> [--out report.json]
 */
const fs = require('fs');
const path = require('path');
const B = require('./Build006Thickness_v688');
const A = B.loadSolver('corner');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const input = process.argv[2];
if (!input) {
  console.error('用法: node ReachPlan_v1.js <关卡.json | 目录> [--out report.json]');
  process.exit(2);
}
const outFile = arg('--out', null);

function collect(p) {
  const st = fs.statSync(p);
  if (st.isFile()) return [p];
  return fs.readdirSync(p).filter(f => f.endsWith('.json')).sort().map(f => path.join(p, f));
}
function isLevel(g) { return g && g.toprow && Array.isArray(g.blocks) && Array.isArray(g.spools); }

const files = collect(input);
const rows = [];
for (const file of files) {
  let g;
  try { g = B.readJson(file); } catch (e) { rows.push({ file, error: 'read: ' + e.message }); continue; }
  if (!isLevel(g)) { rows.push({ file, error: 'not a level' }); continue; }
  const lv = A.parseLevel(A.fromGameFormat(g));

  // 玩家路线
  const p0 = A.PlayerSim.run(lv, { seed: 7, instantChain: false, reviveCap: 0, trackReach: true });
  const playerSum = {}, playerMax = {}, playerPicks = {};
  for (const p of p0.pickOrder || []) {
    playerSum[p.color] = (playerSum[p.color] || 0) + p.reachAtPick;
    playerMax[p.color] = Math.max(playerMax[p.color] || 0, p.reachAtPick);
    playerPicks[p.color] = (playerPicks[p.color] || 0) + 1;
  }
  for (const e of p0.reachTimeline || []) {
    playerMax[e.color] = Math.max(playerMax[e.color] || 0, e.reach);
  }

  // 求解器 min 路线：回放算 reach
  const min = A.Solver.runMinBuffer(lv, { depth: 3, instantChain: false });
  const S = A.Simulator;
  const s = S.enter(lv, { useSlotStart: true, instantChain: false, capturePreviewStats: false });
  const solverSum = {}, solverMax = {};
  const byStep = {};
  for (const p of min.pickOrder || []) (byStep[p.step] = byStep[p.step] || []).push(p);
  for (const step of Object.keys(byStep).sort((a, b) => +a - +b)) {
    const group = byStep[step];
    for (const p of group) {
      const em = s.eliminated.map(row => row.slice());
      const reach = S.floodFillCount(em, s.blocks, s.rows, s.cols, p.color, s.bottomOnly);
      solverSum[p.color] = (solverSum[p.color] || 0) + reach;
      solverMax[p.color] = Math.max(solverMax[p.color] || 0, reach);
    }
    for (const p of group) {
      if (S.applyPick(s, p.r, p.c)) break;
    }
  }

  const total = {};
  for (const row of g.blocks || []) for (const x of row) if (x) total[x] = (total[x] || 0) + 1;

  const colors = [];
  for (const color of Object.keys(total)) {
    const t = total[color];
    const ps = playerSum[color] || 0, pm = playerMax[color] || 0;
    const ss = solverSum[color] || 0, sm = solverMax[color] || 0;
    let status;
    if (!playerPicks[color]) status = 'unpicked';
    else if (ps >= t) status = 'ok';
    else if (ss >= t) status = 'route-short';
    else status = 'both-short';
    colors.push({
      color: +color, total: t,
      playerPicks: playerPicks[color] || 0, playerSum: ps, playerMax: pm,
      solverSum: ss, solverMax: sm,
      shortPlayer: t - ps, shortSolver: t - ss, status
    });
  }
  const count = { ok: 0, 'route-short': 0, 'both-short': 0, unpicked: 0 };
  for (const c of colors) count[c.status]++;
  const worst = colors.slice().sort((a, b) => b.shortPlayer - a.shortPlayer)[0] || null;
  const row = {
    file: path.basename(file),
    p0Won: !!p0.won, p0Death: p0.deathSnapshot ? p0.deathSnapshot.step : null, p0Progress: p0.progress,
    solverWon: !!min.won,
    counts: count,
    worstPlayer: worst,
    colors
  };
  rows.push(row);
  console.log(`${row.file.padEnd(30)} p0=${row.p0Won ? 'Y' : 'N'}${row.p0Death ? '(d' + row.p0Death + ',' + row.p0Progress + '%)' : ''} colors ok=${count.ok} route-short=${count['route-short']} both-short=${count['both-short']} unpicked=${count.unpicked}${worst ? ' worst=' + worst.color + '(' + worst.shortPlayer + ')' : ''}`);
}

const ok = rows.filter(r => !r.error);
const summary = {
  levels: ok.length,
  errors: rows.length - ok.length,
  p0Won: ok.filter(r => r.p0Won).length,
  levelsWithRouteShort: ok.filter(r => r.counts['route-short'] > 0).length,
  levelsWithBothShort: ok.filter(r => r.counts['both-short'] > 0).length,
  levelsWithUnpicked: ok.filter(r => r.counts.unpicked > 0).length,
  p0FailTotal: ok.filter(r => !r.p0Won).length,
  p0FailWithAnyShort: ok.filter(r => !r.p0Won && (r.counts['route-short'] + r.counts['both-short'] + r.counts.unpicked > 0)).length
};
console.log('\n=== summary ===');
console.log(JSON.stringify(summary, null, 2));
if (outFile) {
  fs.writeFileSync(outFile, JSON.stringify({ tool: 'ReachPlan_v1', summary, rows }, null, 2));
  console.log('saved ' + outFile);
}
