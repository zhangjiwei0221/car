#!/usr/bin/env node
'use strict';
/**
 * B1 归因验证驱动（一次性实验脚本，不进工具索引）
 *
 * 输入：PopulationSim_v1.js --no-mcfd 产出的 routes_seed<seed>.json
 * 对每次死亡，沿该局路线从死亡步往前回扫最多 `--back` 步：
 *   用 Simulator.createState + 逐 applyPick 重放前 k 步（不重写规则），
 *   对「第 k 步之后的状态」做束搜索（逐行复用 Solvable_v1.js 的 keyOf/better/判死口径），
 *   先 width 8、未找到再 width 16，单次判定预算 --timeout 秒。
 *   找到最靠后的有解状态 k → 归因距离 = deathStep - k。
 *
 * 注意：Solvable_v1.js 只接受关卡文件、不能从中间状态启动；本脚本复用同一
 *      Build006Thickness_v688.loadSolver('corner') 与同一束搜索算法，从重放状态开始，
 *      未修改任何现有工具。
 *
 * 用法：
 *   node run_attribution.js --level <关卡.json> --routes <目录> --out <json> [--max-deaths 10] [--back 10] [--timeout 5]
 */
const fs = require('fs');
const path = require('path');

const B = require(path.resolve(__dirname, '../../../03_工具/正式版/Build006Thickness_v688'));
const A = B.loadSolver('corner');
const Sim = A.Simulator, St = A.SolverStrategy;

function argv(key, def) {
  const i = process.argv.indexOf('--' + key);
  return i > 0 ? process.argv[i + 1] : def;
}
const LEVEL_FILE = argv('level');
const ROUTES_DIR = argv('routes');
const OUT_FILE = argv('out');
const MAX_DEATHS = parseInt(argv('max-deaths', '10'), 10) || 10;
const BACK = parseInt(argv('back', '10'), 10) || 10;
const TIMEOUT = parseFloat(argv('timeout', '5')) || 5;
if (!LEVEL_FILE || !ROUTES_DIR || !OUT_FILE) {
  console.error('用法: node run_attribution.js --level <关卡.json> --routes <目录> --out <json> [--max-deaths 10] [--back 10] [--timeout 5]');
  process.exit(2);
}

const game = JSON.parse(fs.readFileSync(LEVEL_FILE, 'utf8'));
const level = A.parseLevel(A.fromGameFormat(game));

// ==================== 束搜索（逐行复用 Solvable_v1.js） ====================
function keyOf(s) {
  let k = '';
  for (const row of s.cells) for (const c of row) k += (c && c.t === 'box') ? '1' : '0';
  let ice = '';
  if (s.numice) {
    for (const kk of Object.keys(s.numice).sort()) ice += kk + ':' + s.numice[kk].remaining + ';';
  }
  return k + '|' + s.eliminatedPixels + '|' + ice + '|' +
    s.buffer.map(b => b.color + ':' + b.progress).sort().join(',');
}
function better(a, b) {
  return (a.buffer.length - b.buffer.length) ||
    (b.eliminatedPixels - a.eliminatedPixels);
}

/**
 * 从给定状态 s0 出发判断“能否找到一条通关路线”。
 * 返回 { found, bestPx, timedOut, ms }；found=false 只代表该宽度没找到。
 */
function solvableFrom(s0, width, timeoutSec) {
  const t0 = Date.now();
  const deadline = timeoutSec > 0 ? t0 + timeoutSec * 1000 : Infinity;
  const totalPx = s0.totalPixels || level.totalPixels || 0;
  let bestPx = s0.eliminatedPixels || 0;

  let beam = [s0];
  let found = (totalPx > 0 && s0.eliminatedPixels >= totalPx) ? s0 : null;
  let timedOut = false;
  const maxSteps = (level.totalBoxes || 1) + 1;

  for (let step = 0; step < maxSteps && beam.length && !found; step++) {
    if (Date.now() > deadline) { timedOut = true; break; }
    const next = [];
    for (const s of beam) {
      if (Date.now() > deadline) { timedOut = true; break; }
      const moves = Sim.listMoves(s).filter(m => !m.blocked);
      for (const m of moves) {
        const child = St.cloneState(s);
        if (!Sim.applyPick(child, m.r, m.c)) continue;
        const px = child.eliminatedPixels || 0;
        if (px > bestPx) bestPx = px;
        if (px >= totalPx) { found = child; break; }
        if (child.overflow || child.buffer.length > child.bufferLimit) continue;
        if (child.buffer.length >= child.bufferLimit && Sim.isDeadEnd(child)) continue;
        next.push(child);
      }
      if (found || timedOut) break;
    }
    if (found || timedOut) break;
    next.sort(better);
    const seen = new Set();
    const kept = [];
    for (const s of next) {
      const k = keyOf(s);
      if (seen.has(k)) continue;
      seen.add(k);
      kept.push(s);
      if (kept.length >= width) break;
    }
    beam = kept;
  }
  return { found: !!found, bestPx, timedOut, ms: Date.now() - t0 };
}

/** 重放该局路线，返回 states[k] = 前 k 步 applyPick 之后的状态 */
function replay(route) {
  const states = [Sim.createState(level, { useSlotStart: true, instantChain: false })];
  let s = states[0];
  for (const p of route) {
    const t = St.cloneState(s);
    if (!Sim.applyPick(t, p.r, p.c)) throw new Error(`重放失败 step=${p.step} (${p.r},${p.c})`);
    states.push(t);
    s = t;
  }
  return states;
}

/** 对一次死亡做归因：返回 {dist, found, capped, lastK, widthUsed, checks} */
function attributeDeath(g) {
  if (g.won) return null;
  const N = g.deathStep;
  const states = replay(g.route);
  const checks = [];
  // k 从 N-1 往前；k=0 表示初始状态。死亡步 N 本身无解，不检。
  const kStart = N - 1;
  const kEnd = Math.max(0, N - BACK);
  let candidates = [];
  if (N === 0) candidates = [0];
  else for (let k = kStart; k >= kEnd; k--) candidates.push(k);

  for (const k of candidates) {
    // width 8
    const r8 = solvableFrom(states[k], 8, TIMEOUT);
    if (r8.found) {
      checks.push({ k, width: 8, found: true, ms: r8.ms, timedOut: r8.timedOut });
      return { dist: N - k, found: true, capped: false, lastK: k, widthUsed: 8, checks };
    }
    // width 16
    const r16 = solvableFrom(states[k], 16, TIMEOUT);
    checks.push({ k, width: 8, found: false, ms: r8.ms, timedOut: r8.timedOut });
    checks.push({ k, width: 16, found: r16.found, ms: r16.ms, timedOut: r16.timedOut });
    if (r16.found) {
      return { dist: N - k, found: true, capped: false, lastK: k, widthUsed: 16, checks };
    }
  }
  // 10 步内未找到有解状态
  const d = N >= BACK ? BACK : N;
  return { dist: d, found: false, capped: true, lastK: null, widthUsed: null, checks };
}

// ==================== 主流程 ====================
function median(a) {
  if (!a.length) return null;
  const b = a.slice().sort((x, y) => x - y);
  const m = Math.floor(b.length / 2);
  return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
}

const files = fs.readdirSync(ROUTES_DIR).filter(f => /^routes_seed\d+\.json$/.test(f))
  .sort((a, b) => {
    const sa = Number(a.match(/\d+/)[0]), sb = Number(b.match(/\d+/)[0]);
    return sa - sb;
  });
if (!files.length) { console.error('routes 目录没有 routes_seed*.json: ' + ROUTES_DIR); process.exit(2); }

const perSeed = files.map(f => JSON.parse(fs.readFileSync(path.join(ROUTES_DIR, f), 'utf8')));

// 三种子轮转取样，最多 MAX_DEATHS 次死亡，避免单一种子独占样本
const deathQueues = perSeed.map(rs => rs.games
  .map((g, i) => ({ g, i }))
  .filter(x => !x.g.won));
const sampled = [];
let round = 0;
while (sampled.length < MAX_DEATHS) {
  let added = false;
  for (let si = 0; si < deathQueues.length && sampled.length < MAX_DEATHS; si++) {
    const q = deathQueues[si];
    if (round < q.length) {
      sampled.push({ seed: perSeed[si].seed, gameIndex: q[round].i, g: q[round].g });
      added = true;
    }
  }
  if (!added) break;
  round++;
}

const t0 = Date.now();
const deaths = [];
let width16Count = 0, cappedCount = 0, replayErrors = 0;
for (const item of sampled) {
  let a;
  try {
    a = attributeDeath(item.g);
  } catch (e) {
    replayErrors++;
    console.error(`重放失败 seed=${item.seed} game=${item.gameIndex}: ${e.message}`);
    continue;
  }
  if (a.widthUsed === 16) width16Count++;
  if (a.capped) cappedCount++;
  deaths.push({
    seed: item.seed,
    gameIndex: item.gameIndex,
    deathStep: item.g.deathStep,
    deathProgress: item.g.deathProgress,
    dist: a.dist,
    found: a.found,
    capped: a.capped,
    lastK: a.lastK,
    widthUsed: a.widthUsed,
    checks: a.checks
  });
  console.error(`  seed=${item.seed} game=${item.gameIndex} deathStep=${item.g.deathStep} dist=${a.dist}${a.capped ? '+' : ''} width=${a.widthUsed || '-'}`);
}

const out = {
  level: path.basename(LEVEL_FILE),
  levelFile: LEVEL_FILE,
  routesDir: ROUTES_DIR,
  params: { maxDeaths: MAX_DEATHS, back: BACK, timeoutSec: TIMEOUT },
  totalDeathsAvailable: deathQueues.reduce((s, q) => s + q.length, 0),
  sampledDeaths: deaths.length,
  width16Count,
  cappedCount,
  replayErrors,
  elapsedSec: +((Date.now() - t0) / 1000).toFixed(1),
  deathProgressMedian: median(deaths.map(d => d.deathProgress)),
  attributionMedian: median(deaths.map(d => d.dist)),
  attributionMin: deaths.length ? Math.min(...deaths.map(d => d.dist)) : null,
  attributionMax: deaths.length ? Math.max(...deaths.map(d => d.dist)) : null,
  deaths
};
fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));
console.log(JSON.stringify({
  level: out.level,
  available: out.totalDeathsAvailable,
  sampled: out.sampledDeaths,
  attrMed: out.attributionMedian,
  progMed: out.deathProgressMedian,
  w16: out.width16Count,
  capped: out.cappedCount,
  sec: out.elapsedSec
}));
