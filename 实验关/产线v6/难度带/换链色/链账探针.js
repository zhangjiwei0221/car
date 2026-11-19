#!/usr/bin/env node
'use strict';
/**
 * 链账探针（换链色实验，2026-11-20）
 *
 * 逐局复刻 PInterpPlayer（同 LCG、同 p-贪心、同死亡判据、同 rnd 消耗次序），
 * 额外记账锁链组：
 *   - 进场：某 link 首次出现在暂存时的起点进度（progress = eliminatedPixels/totalPixels，取点前值）；
 *   - 0 进度步数：进场后，该组成员仍在暂存且 progress===0 的步数
 *     （按组 gid 与按色各记一份；值 = 每局平均步数）；
 *   - 结束时（死/通关）仍卡在 0 的组成员数（deathZero）。
 *
 * 锁链组从关卡 JSON 读：spools 单元 type 含 5，param 即 gid。
 * 口径 corner：loadSolver('corner')，useSlotStart:true，instantChain:false。
 *
 * 用法：
 *   node 链账探针.js <关卡.json> [--p 0,0.1,...,1] [--games 100] [--seeds 977,4242]
 *                    [--out /tmp/链账_<pid>.json]
 */
const fs = require('fs');
const path = require('path');
const B = require(path.join(__dirname, '../../../../03_工具/正式版/Build006Thickness_v688.js'));
const A = B.loadSolver('corner');
const Sim = A.Simulator, St = A.SolverStrategy;

const args = process.argv.slice(2);
const flags = {};
const pos = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a.startsWith('--')) { const n = args[i + 1]; if (n !== undefined && !n.startsWith('--')) { flags[a.slice(2)] = n; i++; } else flags[a.slice(2)] = true; }
  else pos.push(a);
}
const LEVEL = pos[0];
if (!LEVEL) { console.error('用法: node 链账探针.js <关卡.json> [--p ...] [--games 100] [--seeds 977,4242] [--out <json>]'); process.exit(2); }
const PLIST = String(flags.p || '0,0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1').split(',').map(Number).filter(x => Number.isFinite(x) && x >= 0 && x <= 1);
const NGAMES = Number(flags.games || 100);
const SEEDS = String(flags.seeds || '977,4242').split(',').map(Number).filter(Number.isFinite);
const OUT = typeof flags.out === 'string' ? flags.out : `/tmp/链账_${process.pid}.json`;

const game = JSON.parse(fs.readFileSync(LEVEL, 'utf8'));
const lv = A.parseLevel(A.fromGameFormat(game));

// ===== 锁链组定义（gid → 颜色多重集） =====
const groups = {};
{
  const tl = (c) => Array.isArray(c.type) ? c.type : (c.type === 0 || c.type == null ? [] : [c.type]);
  const pl = (c) => Array.isArray(c.param) ? c.param : [c.param];
  for (let r = 0; r < game.spools.length; r++) for (let c = 0; c < game.spools[0].length; c++) {
    const cell = game.spools[r][c];
    if (!cell || !(cell.id > 0) || !(cell.count > 0)) continue;
    const ts = tl(cell), ps = pl(cell);
    const i = ts.indexOf(5);
    if (i < 0) continue;
    const gid = ps[i];
    (groups[gid] = groups[gid] || []).push({ r, c, color: cell.id, count: cell.count });
  }
}
const groupKey = (gid) => groups[gid].map(x => x.color).sort((a, b) => a - b).join(',');
const groupsByKey = {};
for (const gid in groups) groupsByKey[groupKey(gid)] = Number(gid);

const isWon = (s) => s.eliminatedPixels >= s.totalPixels;
const isDead = (s) => !!(s.overflow || s.buffer.length > s.bufferLimit || Sim.isDeadEnd(s));
const lcg = (seed) => { let rs = seed; return () => { rs = (rs * 1103515245 + 12345) & 0x7fffffff; return rs / 0x7fffffff; }; };
const r6 = (x) => Math.round(x * 1e6) / 1e6;
const median = (a) => { if (!a.length) return null; const b = a.slice().sort((x, y) => x - y), n = b.length; return n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2; };
const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;

function playProbe(p, rnd) {
  let s = Sim.createState(lv, { useSlotStart: true, bottomOnly: false, instantChain: false });
  let steps = 0, maxBuffer = s.buffer.length;
  const pureRandom = p <= 0, pureGreedy = p >= 1;
  const linksSeen = new Set();
  const entries = {};             // gid -> {step, progress, colors}
  const zeroByColor = {}, zeroAnyByGid = {};
  let zeroAnySteps = 0, zeroMemberSteps = 0;
  let lastProgress = 0;

  while (!isWon(s) && steps < 200) {
    const progress = s.eliminatedPixels / s.totalPixels;
    lastProgress = progress;
    const ms = Sim.listMoves(s).filter(m => !m.blocked);
    const aliveT = (t) => !isDead(t) || isWon(t);
    let pick = null;
    const useGreedy = pureGreedy || (!pureRandom && rnd() < p);
    if (useGreedy) {
      const cand = [];
      for (const m of ms) {
        const t = St.cloneState(s);
        const e0 = t.eliminatedPixels;
        if (!Sim.applyPick(t, m.r, m.c)) continue;
        if (!aliveT(t)) continue;
        cand.push({ r: m.r, c: m.c, t, gain: t.eliminatedPixels - e0 });
      }
      if (cand.length) {
        let best = -Infinity;
        for (const o of cand) if (o.gain > best) best = o.gain;
        const tied = cand.filter(o => o.gain === best);
        pick = tied[Math.floor(rnd() * tied.length)];
      }
    } else {
      const idx = ms.map((_, i) => i);
      for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const x = idx[i]; idx[i] = idx[j]; idx[j] = x; }
      for (const k of idx) {
        const m = ms[k];
        const t = St.cloneState(s);
        const e0 = t.eliminatedPixels;
        if (!Sim.applyPick(t, m.r, m.c)) continue;
        if (aliveT(t)) { pick = { r: m.r, c: m.c, t, gain: t.eliminatedPixels - e0 }; break; }
      }
    }
    if (!pick) break;
    s = pick.t;
    steps++;
    if (s.buffer.length > maxBuffer) maxBuffer = s.buffer.length;

    // 新的链组进场
    const cur = s.buffer.filter(b => b.link > 0);
    const byLink = new Map();
    for (const b of cur) { if (!byLink.has(b.link)) byLink.set(b.link, []); byLink.get(b.link).push(b); }
    for (const [link, items] of byLink) {
      if (linksSeen.has(link)) continue;
      linksSeen.add(link);
      const key = items.map(b => b.color).sort((a, b) => a - b).join(',');
      const gid = groupsByKey[key];
      if (gid != null && !entries[gid]) entries[gid] = { step: steps, progress: r6(progress), colors: items.map(b => b.color) };
    }
    // 0 进度记账（结算后）：按色与按 gid
    let anyThisStep = false;
    for (const b of cur) {
      if (b.progress !== 0) continue;
      anyThisStep = true; zeroMemberSteps++;
      zeroByColor[b.color] = (zeroByColor[b.color] || 0) + 1;
    }
    if (anyThisStep) zeroAnySteps++;
    for (const [link, items] of byLink) {
      const key = items.map(b => b.color).sort((a, b) => a - b).join(',');
      const gid = groupsByKey[key];
      if (gid == null) continue;
      if (items.some(b => b.progress === 0)) zeroAnyByGid[gid] = (zeroAnyByGid[gid] || 0) + 1;
    }
  }

  const won = isWon(s);
  // 结束时链组成员 0 进度个数（按 gid/颜色）
  const endZero = {};
  for (const gid in groups) endZero[gid] = 0;
  for (const b of s.buffer) {
    if (!(b.link > 0) || b.progress !== 0) continue;
    for (const gid in groups) if (groups[gid].some(x => x.color === b.color)) endZero[gid]++;
  }
  // link→gid 的 0 进度步数（zeroAnyByGid 直接以 gid 为键，无需转换）
  return {
    won, steps, deathProgress: won ? null : r6(lastProgress), maxBuffer,
    entries, zeroAnySteps, zeroMemberSteps,
    zeroAnyByGid, zeroByColor, endZero,
  };
}

function run(p, seed) {
  const rnd = lcg(seed);
  const games = [];
  for (let i = 0; i < NGAMES; i++) games.push(playProbe(p, rnd));
  const gids = Object.keys(groups).sort((a, b) => a - b);
  const agg = { p, seed, games: NGAMES, wins: games.filter(g => g.won).length, winRate: r6(games.filter(g => g.won).length / NGAMES) };
  agg.chain = {};
  for (const gid of gids) {
    const entered = games.filter(g => g.entries[gid]);
    const zeroSteps = games.map(g => g.zeroAnyByGid[gid] || 0);
    agg.chain[gid] = {
      colors: groups[gid].map(x => `${x.r},${x.c}色${x.color}/${x.count}`),
      entryRate: r6(entered.length / NGAMES),
      entryProgressMed: entered.length ? r6(median(entered.map(g => g.entries[gid].progress))) : null,
      entryProgressMean: entered.length ? r6(mean(entered.map(g => g.entries[gid].progress))) : null,
      zeroStepsMean: r6(mean(zeroSteps)),
      zeroStepsMeanIfEntered: entered.length ? r6(mean(entered.map(g => g.zeroAnyByGid[gid] || 0))) : null,
      endZeroRate: r6(games.filter(g => (g.endZero[gid] || 0) > 0).length / NGAMES),
    };
  }
  agg.anyChainZeroStepsMean = r6(mean(games.map(g => g.zeroAnySteps)));
  agg.memberZeroStepsMean = r6(mean(games.map(g => g.zeroMemberSteps)));
  const byColor = {};
  for (const gid of gids) for (const x of groups[gid]) if (byColor[x.color] == null) byColor[x.color] = [];
  for (const col in byColor) byColor[col] = r6(mean(games.map(g => g.zeroByColor[col] || 0)));
  agg.zeroStepsMeanByColor = byColor;
  return agg;
}

const result = { tool: '链账探针', level: path.basename(LEVEL), groups, runs: [] };
for (const p of PLIST) for (const seed of SEEDS) result.runs.push(run(p, seed));
result._pid = process.pid;
fs.writeFileSync(OUT, JSON.stringify(result, null, 1));

// 控制台：每 (p,seed) 一行，列 g1/g2 进场中位与 0 进度步数
const gids = Object.keys(groups).sort((a, b) => a - b);
console.log(`level=${result.level}  groups: ${gids.map(g => 'g' + g + '[' + groups[g].map(x => `${x.r},${x.c}:${x.color}/${x.count}`).join('+') + ']').join('  ')}`);
console.log('p\tseed\twin\t' + gids.map(g => `g${g}入场中位\tg${g}0步/局\tg${g}死时0率`).join('\t'));
for (const r of result.runs) {
  const cols = gids.map(g => {
    const c = r.chain[g];
    return `${c.entryProgressMed == null ? '-' : c.entryProgressMed}\t${c.zeroStepsMean}\t${c.endZeroRate}`;
  });
  console.log(`${r.p}\t${r.seed}\t${r.winRate}\t` + cols.join('\t'));
}
console.log('saved', OUT);
