#!/usr/bin/env node
'use strict';
/**
 * 加链 A/B 实验 · 指标器（2026-11-13）
 *
 * 对一张关（A 或 B）测：
 *   random   100 局 × 3 种子（与 PopulationSim_v1 --no-mcfd 逐行同源）：
 *            win / steps / maxBuffer / 链组被拿率 / fill 步数 / 链组首次可点进度
 *   skilled  free-first（会玩）+ max-eat / small-debt（与 ChainRatchetCheck_v1 同打分）：
 *            won / took / fill / 链组首次可点 / 拿链进度 / 选择熵（free-first）
 *   solver   最小暂存路线（A.Solver.runMinBuffer）是否拿链
 *
 * 链组口径：
 *   took = 某一步 lastPick.isChain 且 chain === gid（取一端即整组进场）
 *   fill = 拿到链组后，链组仍占着暂存的**后续步数**（0 = 当步吃满离场；GateApply_v2 同口径）
 *   open = 链组任一成员第一次出现在合法可点列表时的进度
 *
 * 用法：
 *   node 指标_v1.js <关卡.json> [--runs 100] [--seeds 977,4242,31337] [--gid 1]
 *        [--skilled] [--out <文件.json>]
 */
const fs = require('fs');
const path = require('path');
const B = require(path.join(__dirname, '../../../03_工具/正式版/Build006Thickness_v688.js'));
const A = B.loadSolver('corner');
const Sim = A.Simulator, St = A.SolverStrategy;

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(k);
const LEVEL = process.argv[2];
if (!LEVEL || LEVEL.startsWith('--')) { console.error('用法: node 指标_v1.js <关卡.json> [--runs 100] [--seeds 977,4242,31337] [--gid 1] [--skilled] [--out <文件>]'); process.exit(2); }
const RUNS = Math.max(2, Number(arg('--runs', 100)) || 100);
const SEEDS = String(arg('--seeds', '977,4242,31337')).split(',').map(x => Number(x.trim())).filter(Number.isFinite);
const GID = Number(arg('--gid', 1));
const OUT = arg('--out', `/tmp/加链指标_${process.pid}.json`);

const game = JSON.parse(fs.readFileSync(LEVEL, 'utf8'));
const ROWS = game.spools.length, COLS = game.spools[0].length;
const typeList = (c) => Array.isArray(c.type) ? c.type : (c.type === 0 || c.type == null ? [] : [c.type]);
const chainOf = (c) => { const ts = typeList(c); const i = ts.indexOf(5); if (i < 0) return 0; return Array.isArray(c.param) ? (Number(c.param[i]) || 0) : (Number(c.param) || 0); };
const chainCells = new Set();
const chainColors = [];
for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (chainOf(game.spools[r][c]) === GID) { chainCells.add(r + ',' + c); chainColors.push({ r, c, color: game.spools[r][c].id, count: game.spools[r][c].count }); }
if (has('--skilled') && !chainCells.size) console.error('提示：输入没有链组，took/fill 将为 N/A');

const lv = A.parseLevel(A.fromGameFormat(game));
const isWon = (s) => s.eliminatedPixels >= s.totalPixels;
const isDead = (s) => !!(s.overflow || s.buffer.length > s.bufferLimit || Sim.isDeadEnd(s));
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function lcg(seed) { let rs = seed; return () => { rs = (rs * 1103515245 + 12345) & 0x7fffffff; return rs / 0x7fffffff; }; }
function median(a) { if (!a || !a.length) return null; const b = a.slice().sort((x, y) => x - y), n = b.length; return n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2; }
function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }
function quantile(a, p) { if (!a.length) return null; const b = a.slice().sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.max(0, Math.floor(p * (b.length - 1))))]; }
function r3(x) { return x == null ? null : +Number(x).toFixed(3); }
function cmpArr(a, b) { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1; return 0; }
function bucket(x) { if (x <= 0) return 0; if (x <= 2) return 1; if (x <= 5) return 2; if (x <= 10) return 3; if (x <= 20) return 4; return 5; }
function entropy(keys) { if (!keys.length) return 0; const c = {}; for (const k of keys) c[k] = (c[k] || 0) + 1; let h = 0; for (const k in c) { const p = c[k] / keys.length; h -= p * Math.log(p); } return h; }

// ==================== 随机玩家（PopulationSim --no-mcfd 逐行同源） ====================
function runRandom(rnd) {
  let s = Sim.createState(lv, { useSlotStart: true, instantChain: false });
  let steps = 0, maxBuffer = s.buffer.length;
  let took = false, fill = 0, open = null, pickedAt = null, links = null, fillDone = true;
  while (!isWon(s)) {
    const bufBefore = s.buffer.length;
    const progress = s.eliminatedPixels / s.totalPixels;
    const ms = Sim.listMoves(s).filter(m => !m.blocked);
    if (chainCells.size) for (const m of ms) if (chainCells.has(m.r + ',' + m.c)) { if (open == null) open = progress; break; }
    // 链组占用：上一 pick 后仍在 buffer 里的 link，每经过一个后续 pick 记 1 步
    if (links && !fillDone) {
      const live = links.filter(l => s.buffer.some(b => b.link === l));
      if (live.length) fill++;
      links = live.length ? live : null;
      if (!links) fillDone = true;
    }
    const idx = ms.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const x = idx[i]; idx[i] = idx[j]; idx[j] = x; }
    let pick = null;
    for (const k of idx) {
      const m = ms[k];
      const t = St.cloneState(s);
      if (!Sim.applyPick(t, m.r, m.c)) continue;
      if (!isDead(t) || isWon(t)) { pick = { r: m.r, c: m.c, t }; break; }
    }
    if (!pick) {
      const chainHeld = !!(links && links.some(l => s.buffer.some(b => b.link === l)));
      return { won: false, steps, progress, maxBuffer, took, fill, open, pickedAt, deathBuf: s.buffer.length, chainHeld };
    }
    const lp = pick.t.lastPick || null;
    if (lp && lp.isChain && lp.chain === GID) {
      took = true; pickedAt = progress;
      const before = new Set(s.buffer.map(b => b.link).filter(Boolean));
      const newLinks = [...new Set(pick.t.buffer.map(b => b.link).filter(l => l && !before.has(l)))];
      links = newLinks.length ? newLinks : null; fillDone = !links; fill = 0;
    }
    steps++;
    s = pick.t;
    if (s.buffer.length > maxBuffer) maxBuffer = s.buffer.length;
  }
  return { won: true, steps, progress: 1, maxBuffer, took, fill, open, pickedAt };
}

// ==================== 会玩（free-first / max-eat / small-debt） ====================
function moveScore(s, m, strategy) {
  const c = clone(s);
  const before = c.eliminatedPixels;
  if (!A.Simulator.applyPick(c, m.r, m.c)) return null;
  const gain = c.eliminatedPixels - before;
  const buf = c.buffer.length;
  const stuckPx = c.buffer.reduce((a, b) => a + (b.need - b.progress), 0);
  const free = buf === 0 ? 1 : 0;
  const completedDelta = c.completedBoxes - s.completedBoxes;
  const noMoves = c.eliminatedPixels < c.totalPixels && Sim.listMoves(c).filter(x => !x.blocked).length === 0;
  const wonAfter = c.gameWon || c.eliminatedPixels >= c.totalPixels;
  const dead = !wonAfter && (c.overflow || buf > c.bufferLimit || (buf >= c.bufferLimit && completedDelta === 0) || noMoves);
  let score;
  if (strategy === 'max-eat') score = [dead ? 0 : 1, gain, free, -buf, -stuckPx, -m.r, -m.c];
  else if (strategy === 'small-debt') score = [dead ? 0 : 1, free, -buf, -stuckPx, gain, -m.r, -m.c];
  else score = [dead ? 0 : 1, free, gain, -buf, -stuckPx, -m.r, -m.c];
  return { m, score, c, gain, dead };
}
function policyRun(strategy) {
  let s = Sim.createState(lv, { useSlotStart: true, instantChain: false });
  let steps = 0, took = false, fill = 0, open = null, pickedAt = null, links = null, fillDone = true;
  const hs = [];
  for (let i = 0; i < 300; i++) {
    if (isWon(s) || s.gameOver) break;
    const progress = s.eliminatedPixels / s.totalPixels;
    const ms = Sim.listMoves(s).filter(m => !m.blocked);
    if (chainCells.size) for (const m of ms) if (chainCells.has(m.r + ',' + m.c)) { if (open == null) open = progress; break; }
    if (links && !fillDone) {
      const live = links.filter(l => s.buffer.some(b => b.link === l));
      if (live.length) fill++;
      links = live.length ? live : null;
      if (!links) fillDone = true;
    }
    // ChoiceSpace 同签名熵（free-first 口径）
    const sigs = [];
    const scored = [];
    for (const m of ms) {
      const sc = moveScore(s, m, strategy);
      if (!sc) continue;
      const t = sc.c;
      const bufAfter = t.buffer.length;
      const debtPx = t.buffer.reduce((a, b) => a + (b.need - b.progress), 0);
      const nextM = isWon(t) ? 0 : Sim.listMoves(t).filter(x => !x.blocked).length;
      const dead = t.overflow || bufAfter > t.bufferLimit || (bufAfter >= t.bufferLimit && t.completedBoxes - s.completedBoxes === 0) || (!isWon(t) && nextM === 0);
      sigs.push([dead ? 1 : 0, Math.min(bufAfter, 6), bucket(debtPx), bucket(sc.gain), Math.min(nextM, 10), t.completedBoxes - s.completedBoxes].join('|'));
      scored.push(sc);
    }
    hs.push(entropy(sigs));
    let best = null;
    for (const sc of scored) if (!best || cmpArr(sc.score, best.score) > 0) best = sc;
    if (!best) break;
    const lp = best.c.lastPick || null;
    if (lp && lp.isChain && lp.chain === GID) {
      took = true; pickedAt = progress;
      const before = new Set(s.buffer.map(b => b.link).filter(Boolean));
      const newLinks = [...new Set(best.c.buffer.map(b => b.link).filter(l => l && !before.has(l)))];
      links = newLinks.length ? newLinks : null; fillDone = !links; fill = 0;
    }
    steps++;
    s = best.c;
  }
  return { strategy, won: isWon(s), steps, progress: s.eliminatedPixels / s.totalPixels, took, fill, open, pickedAt, entropy: mean(hs) };
}

// 最小暂存求解路线：看它是否拿链
function solverRun() {
  let min;
  try { min = A.Solver.runMinBuffer(lv, { depth: 3, instantChain: false }); } catch (e) { return { error: e.message }; }
  const byStep = {};
  for (const p of min.pickOrder || []) if (!byStep[p.step]) byStep[p.step] = { r: p.r, c: p.c };
  const picks = Object.keys(byStep).map(Number).sort((a, b) => a - b).map(s => byStep[s]);
  return { steps: picks.length, took: picks.some(p => chainCells.has(p.r + ',' + p.c)) };
}

// ==================== 主流程 ====================
const seeds = [];
for (const seed of SEEDS) {
  const rnd = lcg(seed);
  const runs = [];
  for (let i = 0; i < RUNS; i++) runs.push(runRandom(rnd));
  const takers = runs.filter(x => x.took);
  const losers = runs.filter(x => !x.won);
  const losersTook = losers.filter(x => x.took);
  const losersNoTake = losers.filter(x => !x.took);
  seeds.push({
    seed, games: RUNS, wins: runs.filter(x => x.won).length,
    winRate: r3(runs.filter(x => x.won).length / RUNS),
    takeRate: chainCells.size ? r3(takers.length / RUNS) : null,
    takeN: takers.length,
    openMed: r3(median(runs.map(x => x.open).filter(v => v != null))),
    fillMedian: r3(median(takers.map(x => x.fill))),
    fillMean: r3(mean(takers.map(x => x.fill))),
    fillP90: r3(quantile(takers.map(x => x.fill), 0.9)),
    fillMax: takers.length ? Math.max(...takers.map(x => x.fill)) : null,
    pickedAtMed: r3(median(takers.map(x => x.pickedAt).filter(v => v != null))),
    deathProgressMed: r3(median(losers.map(x => x.progress))),
    deaths: losers.length,
    deathsTook: losersTook.length,
    deathsNoTake: losersNoTake.length,
    deathProgressTookMed: r3(median(losersTook.map(x => x.progress))),
    deathProgressNoTakeMed: r3(median(losersNoTake.map(x => x.progress))),
    deathsChainHeld: losers.filter(x => x.chainHeld).length,
    deathBufMed: r3(median(losers.map(x => x.deathBuf))),
    peakMedian: r3(median(runs.map(x => x.maxBuffer)))
  });
}
const skills = has('--skilled') ? ['free-first', 'max-eat', 'small-debt'].map(policyRun) : [];
const solver = has('--skilled') ? solverRun() : null;
const out = {
  tool: '指标_v1', level: path.basename(LEVEL), runs: RUNS, seeds: SEEDS, gid: GID,
  chain: chainCells.size ? chainColors : null,
  random: {
    winRate: r3(mean(seeds.map(s => s.winRate))),
    winRange: [Math.min(...seeds.map(s => s.winRate)), Math.max(...seeds.map(s => s.winRate))],
    takeRate: chainCells.size ? r3(mean(seeds.map(s => s.takeRate))) : null,
    fillMedianPerSeed: seeds.map(s => s.fillMedian),
    fillMeanPerSeed: seeds.map(s => s.fillMean),
    perSeed: seeds
  },
  skilled: skills, solver, _pid: process.pid
};
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log('saved', OUT);
console.log(`${path.basename(LEVEL)}  random win mean=${out.random.winRate}  take=${out.random.takeRate}  fillMed=${JSON.stringify(out.random.fillMedianPerSeed)}`);
for (const s of seeds) console.log(`  seed ${s.seed}: win=${s.winRate} take=${s.takeRate} openMed=${s.openMed} fill med/mean/p90/max=${s.fillMedian}/${s.fillMean}/${s.fillP90}/${s.fillMax} pickedAt=${s.pickedAtMed} peak=${s.peakMedian} | deaths=${s.deaths} (took=${s.deathsTook} noTake=${s.deathsNoTake} held=${s.deathsChainHeld}) deathProg=${s.deathProgressMed} (took ${s.deathProgressTookMed} / noTake ${s.deathProgressNoTakeMed}) deathBuf=${s.deathBufMed}`);
for (const s of skills) console.log(`  skilled ${s.strategy}: won=${s.won} steps=${s.steps} took=${s.took} open=${r3(s.open)} pickedAt=${r3(s.pickedAt)} fill=${s.fill} H=${r3(s.entropy)}`);
if (solver) console.log(`  solver: ${JSON.stringify(solver)}`);
