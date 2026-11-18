#!/usr/bin/env node
'use strict';
/**
 * BaitLocator_v1 —— 死亡回放定位“早死诱饵”（2026-11-18）
 *
 * 为什么需要它：
 *   管道/开局冰的有效性取决于“锁掉的车是否真是随意玩家早死的诱饵”（日志 §1115）。
 *   旧做法靠“贪心前 5 步用不用该色”猜生命线/诱饵，211 证明这会失效（同一色两者兼备）。
 *   这个工具直接从**死亡回放**里数：哪一格/哪一色最常出现在早死局的前一步。
 *
 * 做法：
 *   按 PInterpPlayer 的 p-贪心口径（同 LCG、同洗牌、同死亡判据）跑 N 局，
 *   对每局“未通关”的记录：死亡进度、最后 3 步（格/色/容量/暂存）。
 *   统计“早死局（进度 < --early）的最后一步”落在哪一格、哪一色。
 *   另给每个候选格：开局是否可点、是否开局逃生阀、该色总量/占比、midShare、firstPick 中位。
 *
 * 用法：
 *   node BaitLocator_v1.js <关卡.json> [--p 0,0.1,0.2] [--games 100] [--seeds 977,4242]
 *        [--early 0.25] [--top 10] [--json] [--out 结果.json]
 *
 * 输出读法：
 *   - `bait` 列表按“早死局最后一步次数”降序；`share` = 占全部早死局比例；
 *   - `opening` = 开局是否可点（决定能不能用开局管道/冰锁它）；
 *   - `valve` = 是否开局逃生阀（EscapeValveCheck 口径）。
 *   只读，不改关卡。
 */
const fs = require('fs');
const path = require('path');
const B = require('./Build006Thickness_v688');
const A = B.loadSolver('corner');
const Sim = A.Simulator, St = A.SolverStrategy;
const EV = require('./EscapeValveCheck_v1.js');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i > 0 ? argv[i + 1] : d; };
const has = (k) => argv.indexOf(k) > 0;
const FILE = argv[0];
if (!FILE || FILE.startsWith('--')) {
  console.error('用法: node BaitLocator_v1.js <关卡.json> [--p 0,0.1,0.2] [--games 100] [--seeds 977,4242] [--early 0.25] [--top 10] [--json] [--out 结果.json]');
  process.exit(2);
}
const PS = String(arg('--p', '0,0.1,0.2')).split(',').map(Number).filter(x => Number.isFinite(x));
const GAMES = Number(arg('--games', 100));
const SEEDS = String(arg('--seeds', '977')).split(',').map(Number).filter(Number.isFinite);
const EARLY = Number(arg('--early', 0.25));
const TOP = Number(arg('--top', 10));
const OUT = arg('--out', null);
const ASJSON = has('--json');

const isWon = (s) => s.eliminatedPixels >= s.totalPixels;
const isDead = (s) => !!(s.overflow || s.buffer.length > s.bufferLimit || Sim.isDeadEnd(s));
const r3 = (x) => +Number(x).toFixed(3);
function lcg(seed) { let rs = seed; return () => { rs = (rs * 1103515245 + 12345) & 0x7fffffff; return rs / 0x7fffffff; }; }
function median(a) { if (!a.length) return null; const b = a.slice().sort((x, y) => x - y), n = b.length; return n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2; }

const game = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const lv = A.parseLevel(A.fromGameFormat(game));

// 逐色总量 / 首拿中位（从本工具自己的对局里收集）
const colorTotals = {};
for (const row of game.blocks) for (const v of row) if (v > 0) colorTotals[v] = (colorTotals[v] || 0) + 1;

function play(p, rnd) {
  let s = Sim.createState(lv, { useSlotStart: true, bottomOnly: false, instantChain: false });
  const hist = [];
  const firstPickByCell = {};
  let steps = 0;
  while (steps < 200) {
    if (isWon(s)) return { won: true, hist, firstPickByCell };
    const progress = s.eliminatedPixels / s.totalPixels;
    const ms = Sim.listMoves(s).filter(m => !m.blocked);
    const alive = (t) => !isDead(t) || isWon(t);
    let pick = null;
    if (rnd() < p) {
      const cand = [];
      for (const m of ms) {
        const t = St.cloneState(s);
        const e0 = t.eliminatedPixels;
        if (!Sim.applyPick(t, m.r, m.c)) continue;
        if (!alive(t)) continue;
        cand.push({ m, t, gain: t.eliminatedPixels - e0 });
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
        const ok = Sim.applyPick(t, m.r, m.c);
        if (!ok) continue;
        if (alive(t)) { pick = { m, t }; break; }
      }
    }
    if (!pick) return { won: false, hist, firstPickByCell, progress, buffer: s.buffer.map(x => ({ color: x.color, progress: x.progress, need: x.need })) };
    const cell = s.cells[pick.m.r][pick.m.c];
    const rec = { n: steps + 1, r: pick.m.r, c: pick.m.c, color: cell ? cell.color : null, count: cell ? cell.count : null, bufAfter: pick.t.buffer.length };
    if (firstPickByCell[`${rec.r},${rec.c}`] == null) firstPickByCell[`${rec.r},${rec.c}`] = progress;
    hist.push(rec);
    s = pick.t;
    steps++;
  }
  return { won: false, hist, firstPickByCell, progress: s.eliminatedPixels / s.totalPixels, buffer: [] };
}

// 开局可点 / 逃生阀
const valves = new Set(EV.openingValves(game).map(v => `${v.r},${v.c}`));
const start = Sim.createState(lv, { useSlotStart: true, bottomOnly: false, instantChain: false });
const openingCells = new Set(Sim.listMoves(start).filter(m => !m.blocked).map(m => `${m.r},${m.c}`));

const byCell = {}, byColor = {}, byColorDebt = {}, deaths = [];
let gamesTotal = 0, earlyDeaths = 0, deathsTotal = 0;
const firstPickAgg = {};
for (const seed of SEEDS) {
  const rnd = lcg(seed);
  for (const p of PS) {
    for (let g = 0; g < GAMES; g++) {
      gamesTotal++;
      const r = play(p, rnd);
      for (const k in r.firstPickByCell) (firstPickAgg[k] = firstPickAgg[k] || []).push(r.firstPickByCell[k]);
      if (r.won) continue;
      deathsTotal++;
      const prog = r.progress;
      const last = r.hist[r.hist.length - 1] || null;
      deaths.push({ p, seed, g, progress: r3(prog), steps: r.hist.length, last, buffer: r.buffer });
      if (prog < EARLY && last) {
        earlyDeaths++;
        const k = `${last.r},${last.c}`;
        byCell[k] = (byCell[k] || { cell: k, color: last.color, count: last.count, hits: 0, debtHits: 0 });
        byCell[k].hits++;
        byColor[last.color] = (byColor[last.color] || { color: last.color, hits: 0 });
        byColor[last.color].hits++;
        // 死债来源：死亡时 progress=0 的暂存车，回溯它是在哪一步被拿进来的
        for (const bc of (r.buffer || [])) {
          if (bc.progress >= bc.need) continue;   // 未填满的暂存车都算债（progress 0 是最重的一种）
          let src = null;
          for (let i = r.hist.length - 1; i >= 0; i--) {
            const h = r.hist[i];
            if (h.color === bc.color && h.count === bc.need) { src = h; break; }
          }
          if (!src) continue;
          const dk = `${src.r},${src.c}`;
          byCell[dk] = (byCell[dk] || { cell: dk, color: src.color, count: src.count, hits: 0, debtHits: 0 });
          byCell[dk].debtHits++;
          byColorDebt[src.color] = (byColorDebt[src.color] || { color: src.color, hits: 0 });
          byColorDebt[src.color].hits++;
        }
      }
    }
  }
}

const bait = Object.values(byCell).map(x => {
  const [r, c] = x.cell.split(',').map(Number);
  const fp = firstPickAgg[x.cell];
  const cell = game.spools[r][c] || {};
  return {
    cell: x.cell, row: r, col: c, color: x.color, count: x.count,
    hits: x.hits, share: earlyDeaths ? r3(x.hits / earlyDeaths) : 0,
    debtHits: x.debtHits || 0, debtShare: earlyDeaths ? r3((x.debtHits || 0) / earlyDeaths) : 0,
    opening: openingCells.has(x.cell), valve: valves.has(x.cell),
    colorTotal: colorTotals[x.color] || null,
    colorShare: colorTotals[x.color] ? r3((x.count || 0) / colorTotals[x.color]) : null,
    firstPickMedian: fp ? median(fp) : null,
    type: cell.type, param: cell.param,
  };
}).sort((a, b) => (b.debtHits - a.debtHits) || (b.hits - a.hits)).slice(0, TOP);

const out = {
  tool: 'BaitLocator_v1', level: path.basename(FILE), early: EARLY,
  p: PS, seeds: SEEDS, gamesPerP: GAMES, gamesTotal, deathsTotal, earlyDeaths,
  deathRate: r3(deathsTotal / gamesTotal),
  earlyShare: deathsTotal ? r3(earlyDeaths / deathsTotal) : 0,
  bait,
  baitByColor: Object.values(byColor).sort((a, b) => b.hits - a.hits),
  debtByColor: Object.values(byColorDebt).sort((a, b) => b.hits - a.hits),
  deathsSample: deaths.slice(0, 20),
};

if (ASJSON) {
  console.log(JSON.stringify(out, null, 1));
} else {
  console.log(`=== ${out.level} · p=${PS.join('/')} · ${gamesTotal} 局 · 死亡 ${deathsTotal}（早死<${EARLY}: ${earlyDeaths}）===`);
  if (!bait.length) {
    console.log('没有早死局 → 没有可定位的诱饵（管道/开局冰在这张图上没有靶子）。');
  } else {
    console.log('格      色/容量  死债  末步  开局可点  逃生阀  该色x/x  首拿中位');
    for (const b of bait) {
      console.log(`${b.cell.padEnd(7)} ${String(b.color) + '/' + b.count}`.padEnd(16) +
        ` ${String(b.debtHits).padEnd(4)} ${String(b.hits).padEnd(4)}` +
        ` ${b.opening ? '是' : '否'}`.padEnd(8) + ` ${b.valve ? '是' : '否'}`.padEnd(7) +
        ` ${b.count}/${b.colorTotal}`.padEnd(10) + ` ${b.firstPickMedian}`);
    }
    console.log('死债按色：' + out.debtByColor.map(x => `${x.color}×${x.hits}`).join(' '));
    console.log('末步按色：' + out.baitByColor.map(x => `${x.color}×${x.hits}`).join(' '));
  }
}
if (OUT) fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
