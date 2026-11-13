#!/usr/bin/env node
'use strict';
/**
 * 多链实验 · 多链组指标（2026-11-13）
 *
 * 一次随机模拟同时统计**每个链组**（gid）的被拿率 / 首次可点 / 拿链进度 / fill。
 * 随机玩家口径与 PopulationSim_v1 --no-mcfd / 加链/指标_v1.js 逐行同源：
 *   loadSolver('corner')，useSlotStart:true，instantChain:false。
 *
 * 另外跑 free-first 会玩路线，报告每个 gid 是否被拿。
 *
 * 用法：
 *   node 多链指标_v1.js <关卡.json> --runs 150 --seeds 977,4242,31337,111,222,333,444,555 [--out 文件.json]
 */
const fs = require('fs');
const path = require('path');
const B = require(path.join(__dirname, '../../..', '03_工具/正式版/Build006Thickness_v688.js'));
const A = B.loadSolver('corner');
const Sim = A.Simulator, St = A.SolverStrategy;

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const LEVEL = process.argv[2];
if (!LEVEL || LEVEL.startsWith('--')) { console.error('用法: node 多链指标_v1.js <关卡.json> --runs 150 --seeds 977,... [--out 文件]'); process.exit(2); }
const RUNS = Math.max(2, Number(arg('--runs', 150)) || 150);
const SEEDS = String(arg('--seeds', '977,4242,31337,111,222,333,444,555')).split(',').map(x => Number(x.trim())).filter(Number.isFinite);
const OUT = arg('--out', `/tmp/多链指标_${process.pid}.json`);

const game = JSON.parse(fs.readFileSync(LEVEL, 'utf8'));
const ROWS = game.spools.length, COLS = game.spools[0].length;
const typeList = (c) => Array.isArray(c.type) ? c.type : (c.type === 0 || c.type == null ? [] : [c.type]);
const chainOf = (c) => { const ts = typeList(c); const i = ts.indexOf(5); if (i < 0) return 0; return Array.isArray(c.param) ? (Number(c.param[i]) || 0) : (Number(c.param) || 0); };
const groups = {};   // gid -> Set(cells)
for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
  const g = chainOf(game.spools[r][c]);
  if (g) (groups[g] = groups[g] || new Set()).add(r + ',' + c);
}
const GIDLIST = Object.keys(groups).map(Number).sort((a, b) => a - b);
const gidOfCell = {};
for (const g of GIDLIST) for (const k of groups[g]) gidOfCell[k] = g;

const lv = A.parseLevel(A.fromGameFormat(game));
const isWon = (s) => s.eliminatedPixels >= s.totalPixels;
const isDead = (s) => !!(s.overflow || s.buffer.length > s.bufferLimit || Sim.isDeadEnd(s));
function lcg(seed) { let rs = seed; return () => { rs = (rs * 1103515245 + 12345) & 0x7fffffff; return rs / 0x7fffffff; }; }
function median(a) { if (!a || !a.length) return null; const b = a.slice().sort((x, y) => x - y), n = b.length; return n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2; }
function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }
function quantile(a, p) { if (!a.length) return null; const b = a.slice().sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.max(0, Math.floor(p * (b.length - 1))))]; }
function r3(x) { return x == null ? null : +Number(x).toFixed(3); }
function bucket(x) { if (x <= 0) return 0; if (x <= 2) return 1; if (x <= 5) return 2; if (x <= 10) return 3; if (x <= 20) return 4; return 5; }
function entropy(keys) { if (!keys.length) return 0; const c = {}; for (const k of keys) c[k] = (c[k] || 0) + 1; let h = 0; for (const k in c) { const p = c[k] / keys.length; h -= p * Math.log(p); } return h; }
function cmpArr(a, b) { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1; return 0; }
function newG() { const o = {}; for (const g of GIDLIST) o[g] = { took: 0, open: [], pickedAt: [], fill: [], fillDone: true, links: null }; return o; }

function runRandom(rnd) {
  let s = Sim.createState(lv, { useSlotStart: true, instantChain: false });
  let steps = 0, maxBuffer = s.buffer.length;
  const G = newG();
  while (!isWon(s)) {
    const progress = s.eliminatedPixels / s.totalPixels;
    const ms = Sim.listMoves(s).filter(m => !m.blocked);
    for (const m of ms) { const g = gidOfCell[m.r + ',' + m.c]; if (g && G[g].open.length === 0) G[g].open.push(progress); }
    for (const g of GIDLIST) {
      const st = G[g];
      if (st.links && !st.fillDone) {
        const live = st.links.filter(l => s.buffer.some(b => b.link === l));
        if (live.length) st.fill.push(steps);
        st.links = live.length ? live : null;
        if (!st.links) st.fillDone = true;
      }
    }
    const idx = ms.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const x = idx[i]; idx[i] = idx[j]; idx[j] = x; }
    let pick = null;
    for (const k of idx) {
      const m = ms[k];
      const t = St.cloneState(s);
      if (!Sim.applyPick(t, m.r, m.c)) continue;
      if (!isDead(t) || isWon(t)) { pick = { m, t }; break; }
    }
    if (!pick) {
      const held = {}; for (const g of GIDLIST) held[g] = !!(G[g].links && G[g].links.some(l => s.buffer.some(b => b.link === l)));
      return { won: false, steps, progress, maxBuffer, G, held };
    }
    const lp = pick.t.lastPick || null;
    if (lp && lp.isChain) {
      const g = lp.chain; const st = G[g];
      if (st) {
        st.took++; st.pickedAt.push(progress);
        const before = new Set(s.buffer.map(b => b.link).filter(Boolean));
        const nl = [...new Set(pick.t.buffer.map(b => b.link).filter(l => l && !before.has(l)))];
        st.links = nl.length ? nl : null; st.fillDone = !st.links;
      }
    }
    steps++;
    s = pick.t;
    if (s.buffer.length > maxBuffer) maxBuffer = s.buffer.length;
  }
  return { won: true, steps, progress: 1, maxBuffer, G, held: {} };
}

function moveScore(s, m, strategy) {
  const c = JSON.parse(JSON.stringify(s));
  const before = c.eliminatedPixels;
  if (!Sim.applyPick(c, m.r, m.c)) return null;
  const gain = c.eliminatedPixels - before;
  const buf = c.buffer.length;
  const stuckPx = c.buffer.reduce((a, b) => a + (b.need - b.progress), 0);
  const free = buf === 0 ? 1 : 0;
  const completedDelta = c.completedBoxes - s.completedBoxes;
  const noMoves = c.eliminatedPixels < c.totalPixels && Sim.listMoves(c).filter(x => !x.blocked).length === 0;
  const wonAfter = c.gameWon || c.eliminatedPixels >= c.totalPixels;
  const dead = !wonAfter && (c.overflow || buf > c.bufferLimit || (buf >= c.bufferLimit && completedDelta === 0) || noMoves);
  const score = [dead ? 0 : 1, free, gain, -buf, -stuckPx, -m.r, -m.c];
  return { m, score, c, dead };
}
function runFreeFirst() {
  let s = Sim.createState(lv, { useSlotStart: true, instantChain: false });
  const took = {}; for (const g of GIDLIST) took[g] = false;
  const hs = [];
  for (let i = 0; i < 300; i++) {
    if (isWon(s) || s.gameOver) break;
    const ms = Sim.listMoves(s).filter(m => !m.blocked);
    const sigs = [], scored = [];
    for (const m of ms) {
      const sc = moveScore(s, m, 'free-first'); if (!sc) continue;
      const t = sc.c, bufAfter = t.buffer.length;
      const debtPx = t.buffer.reduce((a, b) => a + (b.need - b.progress), 0);
      const nextM = isWon(t) ? 0 : Sim.listMoves(t).filter(x => !x.blocked).length;
      const dead = t.overflow || bufAfter > t.bufferLimit || (bufAfter >= t.bufferLimit && t.completedBoxes - s.completedBoxes === 0) || (!isWon(t) && nextM === 0);
      sigs.push([dead ? 1 : 0, Math.min(bufAfter, 6), bucket(debtPx), bucket(sc.gain = t.eliminatedPixels - s.eliminatedPixels), Math.min(nextM, 10), t.completedBoxes - s.completedBoxes].join('|'));
      scored.push(sc);
    }
    hs.push(entropy(sigs));
    let best = null;
    for (const sc of scored) if (!best || cmpArr(sc.score, best.score) > 0) best = sc;
    if (!best) break;
    const lp = best.c.lastPick || null;
    if (lp && lp.isChain) took[lp.chain] = true;
    s = best.c;
  }
  return { won: isWon(s), steps: s.steps || null, took, entropy: mean(hs) };
}

const seedRows = [];
const allRuns = [];
for (const seed of SEEDS) {
  const rnd = lcg(seed);
  const runs = [];
  for (let i = 0; i < RUNS; i++) runs.push(runRandom(rnd));
  allRuns.push(...runs);
  const per = {};
  for (const g of GIDLIST) {
    const st = runs.map(x => x.G[g]);
    const takers = st.filter(x => x.took > 0);
    per[g] = {
      takeRate: r3(takers.length / RUNS),
      openMed: r3(median(st.map(x => x.open[0]).filter(v => v != null))),
      pickedAtMed: r3(median(takers.flatMap(x => x.pickedAt))),
      fillMedian: r3(median(takers.map(x => x.fill.length))),
      fillMean: r3(mean(takers.map(x => x.fill.length))),
      fillP90: r3(quantile(takers.map(x => x.fill.length), 0.9)),
      fillMax: takers.length ? Math.max(...takers.map(x => x.fill.length)) : null,
      deathsHeld: runs.filter(x => !x.won && x.held[g]).length
    };
  }
  seedRows.push({
    seed, wins: runs.filter(x => x.won).length,
    winRate: r3(runs.filter(x => x.won).length / RUNS),
    deathProgressMed: r3(median(runs.filter(x => !x.won).map(x => x.progress))),
    peakMedian: r3(median(runs.map(x => x.maxBuffer))),
    perChain: per
  });
}
const free = runFreeFirst();
const agg = {};
for (const g of GIDLIST) {
  const ps = seedRows.map(s => s.perChain[g]);
  agg[g] = {
    takeRate: r3(mean(ps.map(p => p.takeRate))),
    takeRateRange: [Math.min(...ps.map(p => p.takeRate)), Math.max(...ps.map(p => p.takeRate))],
    openMed: r3(median(ps.map(p => p.openMed).filter(v => v != null))),
    pickedAtMed: r3(median(ps.map(p => p.pickedAtMed).filter(v => v != null))),
    fillMedian: r3(median(ps.map(p => p.fillMedian).filter(v => v != null))),
    fillMean: r3(mean(ps.map(p => p.fillMean).filter(v => v != null))),
    fillP90: r3(median(ps.map(p => p.fillP90).filter(v => v != null))),
    fillMax: Math.max(...ps.map(p => p.fillMax).filter(v => v != null)),
    deathsHeldTotal: ps.reduce((a, p) => a + p.deathsHeld, 0)
  };
}
const out = {
  tool: '多链指标_v1', level: path.basename(LEVEL), runs: RUNS, seeds: SEEDS, gids: GIDLIST,
  chains: Object.fromEntries(GIDLIST.map(g => [g, [...groups[g]].map(k => { const [r, c] = k.split(',').map(Number); return { r, c, color: game.spools[r][c].id, count: game.spools[r][c].count }; })])),
  random: { winRate: r3(mean(seedRows.map(s => s.winRate))), winRange: [Math.min(...seedRows.map(s => s.winRate)), Math.max(...seedRows.map(s => s.winRate))], perChain: agg, perSeed: seedRows },
  skilledFreeFirst: free, _pid: process.pid
};
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log('saved', OUT);
console.log(`${path.basename(LEVEL)} random win mean=${out.random.winRate} range=${JSON.stringify(out.random.winRange)}  seeds=${SEEDS.join(',')}  runs=${RUNS}`);
for (const s of seedRows) console.log(`  seed ${s.seed}: win=${s.winRate} deaths=${RUNS - s.wins} deathProg=${s.deathProgressMed} peak=${s.peakMedian}  ` + GIDLIST.map(g => `g${g}:take=${s.perChain[g].takeRate},fill=${s.perChain[g].fillMedian}/${s.perChain[g].fillMean}`).join(' '));
for (const g of GIDLIST) console.log(`  g${g} agg: take=${agg[g].takeRate} (${agg[g].takeRateRange[0]}–${agg[g].takeRateRange[1]}) openMed=${agg[g].openMed} pickedAt=${agg[g].pickedAtMed} fill med/mean/p90/max=${agg[g].fillMedian}/${agg[g].fillMean}/${agg[g].fillP90}/${agg[g].fillMax} deathsHeld=${agg[g].deathsHeldTotal}`);
console.log(`  free-first: won=${free.won} H=${r3(free.entropy)} took=${JSON.stringify(free.took)}`);
