#!/usr/bin/env node
'use strict';
/**
 * ReachTimeline_v1 —— 每色/每车/每链组的 reach 时间线（v1.5 M1）
 *
 * 回答：
 *   - 每个颜色在哪一步可达多少；
 *   - 每辆车被拿时的 reach、容量、最早填满步、最晚安全步；
 *   - 每个链组入场时的成员 reach、容量余量、是否会必死。
 *
 * 用法：
 *   node ReachTimeline_v1.js <关卡.json | 目录> [--out 报告.json] [--limit N]
 *
 * 只读；不改关卡。
 */
const fs = require('fs');
const path = require('path');
const B = require('./Build006Thickness_v688');
const A = B.loadSolver('corner');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };

function collect(p) {
  const st = fs.statSync(p);
  if (st.isFile()) return [p];
  return fs.readdirSync(p).filter(f => f.endsWith('.json')).sort().map(f => path.join(p, f));
}
function isLevel(g) { return !!(g && Array.isArray(g.blocks) && Array.isArray(g.spools)); }
function colorTotals(g) {
  const m = {};
  for (const row of g.blocks) for (const v of row) if (v > 0) m[v] = (m[v] || 0) + 1;
  return m;
}
function chainGroups(g) {
  const groups = new Map();
  for (let r = 0; r < g.spools.length; r++) for (let c = 0; c < g.spools[r].length; c++) {
    const s = g.spools[r][c];
    if (!s) continue;
    const t = s.type;
    const isChain = t === 5 || (Array.isArray(t) && t.includes(5));
    if (!isChain) continue;
    const id = Array.isArray(s.param) ? s.param[t.indexOf(5)] : s.param;
    const k = String(id);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push({ r, c, color: s.id, count: s.count });
  }
  return [...groups.entries()].map(([id, members]) => ({ id, members }));
}

function analyze(file) {
  const g = B.readJson(file);
  if (!isLevel(g)) throw new Error('不是关卡 JSON');
  const lv = A.parseLevel(A.fromGameFormat(g));
  const p0 = A.PlayerSim.run(lv, { seed: 7, instantChain: false, reviveCap: 0, pickThreshold: 0.6, trackReach: true });
  const p2 = A.PlayerSim.run(lv, { seed: 7, instantChain: false, reviveCap: 2, pickThreshold: 0.6, trackReach: true });

  // 每色每步最大 reach（取 p0；p2 只作补充）
  const byColor = {};
  const addTimeline = (timeline) => {
    for (const e of timeline || []) {
      const c = e.color;
      const o = byColor[c] = byColor[c] || { color: c, steps: {}, firstFullStep: null, lastSafeStep: null };
      const prev = o.steps[e.step] || 0;
      if (e.reach > prev) o.steps[e.step] = e.reach;
    }
  };
  addTimeline(p0.reachTimeline);
  addTimeline(p2.reachTimeline);

  const totals = colorTotals(g);
  const colors = Object.keys(totals).map(Number).sort((a, b) => a - b).map(color => {
    const o = byColor[color] || { steps: {} };
    const steps = Object.keys(o.steps).map(Number).sort((a, b) => a - b);
    const maxReach = Math.max(0, ...steps.map(s => o.steps[s]));
    const firstFullStep = steps.find(s => o.steps[s] >= totals[color]) || null;
    const fullSteps = steps.filter(s => o.steps[s] >= totals[color]);
    const lastSafeStep = fullSteps.length ? fullSteps[fullSteps.length - 1] : null;
    const picks = (p0.pickOrder || []).filter(p => p.color === color && (p.chainIndex == null || p.chainIndex === 0));
    return {
      color, total: totals[color], maxReach, firstFullStep, lastSafeStep,
      neverFull: maxReach < totals[color],
      picks: picks.map(p => ({ step: p.step, r: p.r, c: p.c, count: p.count, reachAtPick: p.reachAtPick, chainSize: p.chainSize })),
      minReachAtPick: picks.length ? Math.min(...picks.map(p => p.reachAtPick)) : null,
      maxReachAtPick: picks.length ? Math.max(...picks.map(p => p.reachAtPick)) : null,
      steps: steps.map(s => ({ step: s, reach: o.steps[s] }))
    };
  });

  // 每辆车
  const cars = [];
  for (let r = 0; r < g.spools.length; r++) for (let c = 0; c < g.spools[r].length; c++) {
    const s = g.spools[r][c];
    if (!s || s.id <= 0) continue;
    const picks = (p0.pickOrder || []).filter(p => p.r === r && p.c === c && (p.chainIndex == null || p.chainIndex === 0));
    const colorInfo = colors.find(x => x.color === s.id) || { steps: [] };
    const steps = colorInfo.steps || [];
    const firstFullStep = steps.find(x => x.reach >= s.count)?.step ?? null;
    const fullSteps = steps.filter(x => x.reach >= s.count);
    const lastSafeStep = fullSteps.length ? fullSteps[fullSteps.length - 1].step : null;
    cars.push({
      r, c, color: s.id, count: s.count,
      picks: picks.map(p => ({ step: p.step, reachAtPick: p.reachAtPick, chainSize: p.chainSize })),
      minReachAtPick: picks.length ? Math.min(...picks.map(p => p.reachAtPick)) : null,
      maxReachAtPick: picks.length ? Math.max(...picks.map(p => p.reachAtPick)) : null,
      firstFullStep, lastSafeStep,
      overAtPick: picks.length ? picks.some(p => p.count > p.reachAtPick) : false
    });
  }

  // 链组：入场步按 p0 的 chain pick；pickOrder.chain 是“第几个链组”的序号，
  // 不是关卡里的 chain param，所以用坐标反查组号。
  const groups = chainGroups(g);
  const groupOfCell = {};
  for (const grp of groups) for (const m of grp.members) groupOfCell[m.r + ',' + m.c] = grp.id;
  const entryByGroup = {};
  for (const p of p0.pickOrder || []) {
    if (!(p.chainSize > 1)) continue;
    const id = groupOfCell[p.r + ',' + p.c];
    if (id != null && entryByGroup[id] == null) entryByGroup[id] = p.step;
  }
  const chains = groups.map(grp => {
    const entryStep = entryByGroup[grp.id] ?? null;
    const members = grp.members.map(m => {
      const colorInfo = colors.find(x => x.color === m.color);
      const at = colorInfo && colorInfo.steps.find(x => x.step === entryStep);
      const reach = at ? at.reach : (entryStep == null ? null : 0);
      return {
        ...m,
        reachAtEntry: reach,
        margin: reach == null ? null : reach - m.count,
        over: reach != null && m.count > reach
      };
    });
    const fatalMembers = members.filter(m => m.over);
    return {
      id: grp.id, entryStep, members,
      minMargin: members.every(m => m.margin != null) ? Math.min(...members.map(m => m.margin)) : null,
      fatal: fatalMembers.length > 0,
      fatalMembers: fatalMembers.map(m => ({ r: m.r, c: m.c, color: m.color, count: m.count, reach: m.reachAtEntry }))
    };
  }).sort((a, b) => (a.entryStep || 999) - (b.entryStep || 999));

  return {
    file: path.basename(file),
    p0Won: !!p0.won, p0Death: p0.deathSnapshot ? p0.deathSnapshot.step : null, p0Progress: p0.progress,
    p2Won: !!p2.won, p2Progress: p2.progress,
    colors, cars, chains,
    fatalChains: chains.filter(c => c.fatal),
    overCars: cars.filter(c => c.overAtPick)
  };
}

function main() {
  const input = process.argv[2];
  const out = arg('--out', null);
  const limit = Number(arg('--limit', 0)) || 0;
  if (!input) { console.error('用法: node ReachTimeline_v1.js <关卡.json | 目录> [--out 报告.json] [--limit N]'); process.exit(2); }
  const files = collect(input).slice(0, limit || undefined);
  const rows = [];
  for (const file of files) {
    try {
      const r = analyze(file);
      rows.push(r);
      const f = r.fatalChains[0];
      console.log(`${r.file.padEnd(30)} p0=${r.p0Won ? 'Y' : 'N'}${r.p0Death ? '(d' + r.p0Death + ',' + r.p0Progress + '%)' : ''} p2=${r.p2Won ? 'Y' : 'N'} colors=${r.colors.length} fatalChains=${r.fatalChains.length} overCars=${r.overCars.length}${f ? ' firstFatal=p' + f.id + '@' + f.entryStep : ''}`);
    } catch (e) {
      rows.push({ file: path.basename(file), error: String(e.message || e) });
      console.log(`${path.basename(file).padEnd(30)} ERROR ${e.message}`);
    }
  }
  const summary = {
    levels: rows.filter(r => !r.error).length,
    errors: rows.filter(r => r.error).length,
    p0Won: rows.filter(r => r.p0Won).length,
    p2Won: rows.filter(r => r.p2Won).length,
    withFatalChain: rows.filter(r => r.fatalChains && r.fatalChains.length).length,
    withOverCar: rows.filter(r => r.overCars && r.overCars.length).length
  };
  console.log('\n=== summary ===');
  console.log(JSON.stringify(summary, null, 2));
  if (out) {
    fs.writeFileSync(out, JSON.stringify({ tool: 'ReachTimeline_v1', summary, rows }, null, 2));
    console.log('saved ' + out);
  }
}

if (require.main === module) main();
module.exports = { analyze, chainGroups, colorTotals };
