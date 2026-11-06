#!/usr/bin/env node
'use strict';
/**
 * CapacityReachCheck_v1 —— 容量 vs 暴露步可达量
 *
 * 读 PlayerSim 的基线路线（pickOrder 已带 reachAtPick），标出：
 *   1. 单盒车：count > 被拿时的可达量 → 必然填不满（硬违规）；
 *   2. 链组：任一成员 count > 可达量 → 可疑（成员可能被同组其他车吃出来，需人工/图谱确认）。
 *
 * 用法：
 *   node CapacityReachCheck_v1.js <关卡.json | 目录> [--out report.json] [--limit N]
 *
 * 只读；不改关卡、不改玩家决策。
 */
const fs = require('fs');
const path = require('path');
const B = require('./Build006Thickness_v688');
const A = B.loadSolver('corner');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const input = process.argv[2];
if (!input) {
  console.error('用法: node CapacityReachCheck_v1.js <关卡.json | 目录> [--out report.json] [--limit N]');
  process.exit(2);
}
const outFile = arg('--out', null);
const limit = Number(arg('--limit', 0)) || 0;

function collect(p) {
  const st = fs.statSync(p);
  if (st.isFile()) return [p];
  return fs.readdirSync(p).filter(f => f.endsWith('.json')).sort().map(f => path.join(p, f));
}
function isLevel(g) { return g && g.toprow && Array.isArray(g.blocks) && Array.isArray(g.spools); }

const files = collect(input).slice(0, limit || undefined);
const rows = [];
for (const file of files) {
  let g;
  try { g = B.readJson(file); } catch (e) { rows.push({ file, error: 'read: ' + e.message }); continue; }
  if (!isLevel(g)) { rows.push({ file, error: 'not a level' }); continue; }
  const lv = A.parseLevel(A.fromGameFormat(g));
  const p0 = A.PlayerSim.run(lv, { seed: 7, instantChain: false, reviveCap: 0 });
  const p2 = A.PlayerSim.run(lv, { seed: 7, instantChain: false, reviveCap: 2 });

  const singleOver = [];
  const chainSuspect = [];
  const byStep = {};
  for (const p of p0.pickOrder || []) {
    (byStep[p.step] = byStep[p.step] || []).push(p);
    if (p.chainSize > 1) continue;
    if (typeof p.reachAtPick === 'number' && p.count > p.reachAtPick) {
      singleOver.push({
        step: p.step, r: p.r, c: p.c, color: p.color,
        count: p.count, reach: p.reachAtPick, over: p.count - p.reachAtPick
      });
    }
  }
  for (const step of Object.keys(byStep)) {
    const ps = byStep[step];
    if (ps.length <= 1) continue;
    const bad = ps.filter(p => typeof p.reachAtPick === 'number' && p.count > p.reachAtPick);
    if (bad.length) {
      chainSuspect.push({
        step: +step,
        members: ps.map(p => ({ r: p.r, c: p.c, color: p.color, count: p.count, reach: p.reachAtPick })),
        overMembers: bad.map(p => p.color)
      });
    }
  }
  const maxOver = singleOver.reduce((a, x) => Math.max(a, x.over), 0);
  const row = {
    file: path.basename(file),
    picks: (p0.pickOrder || []).length,
    singleOverCount: singleOver.length,
    chainSuspectCount: chainSuspect.length,
    maxOver,
    singleOver,
    chainSuspect,
    p0Won: !!p0.won,
    p0Death: p0.deathSnapshot ? p0.deathSnapshot.step : null,
    p0Progress: p0.progress,
    p2Won: !!p2.won,
    p2Revives: p2.revivesUsed || 0
  };
  rows.push(row);
  console.log(`${row.file.padEnd(30)} picks=${row.picks} singleOver=${row.singleOverCount} chainSuspect=${row.chainSuspectCount} maxOver=${row.maxOver} p0=${row.p0Won ? 'Y' : 'N'}${row.p0Death ? '(d' + row.p0Death + ',' + row.p0Progress + '%)' : ''} p2=${row.p2Won ? 'Y' : 'N'}(r${row.p2Revives})`);
}

const ok = rows.filter(r => !r.error);
const summary = {
  levels: ok.length,
  errors: rows.length - ok.length,
  p0Won: ok.filter(r => r.p0Won).length,
  p2Won: ok.filter(r => r.p2Won).length,
  withSingleOver: ok.filter(r => r.singleOverCount > 0).length,
  withChainSuspect: ok.filter(r => r.chainSuspectCount > 0).length,
  p0FailWithSingleOver: ok.filter(r => !r.p0Won && r.singleOverCount > 0).length,
  p0FailWithChainSuspect: ok.filter(r => !r.p0Won && r.chainSuspectCount > 0).length,
  p0FailWithEither: ok.filter(r => !r.p0Won && (r.singleOverCount > 0 || r.chainSuspectCount > 0)).length,
  p0FailTotal: ok.filter(r => !r.p0Won).length
};
console.log('\n=== summary ===');
console.log(JSON.stringify(summary, null, 2));
if (outFile) {
  fs.writeFileSync(outFile, JSON.stringify({ tool: 'CapacityReachCheck_v1', summary, rows }, null, 2));
  console.log('saved ' + outFile);
}
