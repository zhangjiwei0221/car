#!/usr/bin/env node
'use strict';
/**
 * 陷阱链实验 · 第 1 步：找出底座上的「陷阱格」（2026-11-16）
 *
 * 做法：
 *   在底座上跑 N 局随机（默认 20，种子 977，与 加链/扫描_v1.js 同 LCG、同洗牌、
 *   同“当步不死”判据）+ 1 条 free-first 路线。**每一步**枚举所有可点选项，对每个选项：
 *     复制状态 → applyPick → 用宽度 8、超时 2s 的束搜索判断“之后还有没有解”
 *     （束搜索逐行复刻 Solvable_v1.js：同 createState 口径、同 keyOf、同 better、同 width）。
 *   可点网格子上「取它就无解」的比例 ≥30% 的格子记为陷阱格。
 *
 * 口径：loadSolver('corner')，useSlotStart:true，instantChain:false（AGENTS 红线 2）。
 *
 * 并行：父进程生成所有随机局/ free-first 的点击序列（随机流必须顺序消费，无法先分发），
 *       子进程按游戏编号分片重放状态并评估。中间文件一律带 pid。
 *
 * 用法：
 *   node 陷阱格_v1.js <关卡.json> [--runs 20] [--seed 977] [--width 8] [--timeout 2]
 *        [--threshold 0.30] [--workers 8] [--out 陷阱格.json]
 */
const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');
const B = require(path.join(__dirname, '../../../03_工具/正式版/Build006Thickness_v688.js'));
const A = B.loadSolver('corner');
const Sim = A.Simulator, St = A.SolverStrategy;

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.indexOf(k) > 0;

// ==================== 子进程：评估一个游戏的所有步 ====================
if (has('--worker')) {
  runWorker();
} else {
  main();
}

function runWorker() {
  const LEVEL = arg('--level');
  const SHARD = Number(arg('--shard'));
  const WIDTH = Number(arg('--width', 8));
  const TIMEOUT = Number(arg('--timeout', 2));
  const PLANFILE = arg('--plan');
  const OUTFILE = arg('--shard-out');
  const plan = JSON.parse(fs.readFileSync(PLANFILE, 'utf8'));
  const jobs = plan.jobs, nWorkers = plan.workers;
  const game = JSON.parse(fs.readFileSync(LEVEL, 'utf8'));
  const lv = A.parseLevel(A.fromGameFormat(game));
  const isWon = (s) => s.eliminatedPixels >= s.totalPixels;

  const results = [];
  for (const job of jobs) {
    if (job.id % nWorkers !== SHARD) continue;
    // 重放：state at step t = 依次 applyPick picks[0..t-1]
    let s = Sim.createState(lv, { useSlotStart: true, instantChain: false });
    for (let t = 0; t < job.picks.length; t++) {
      if (isWon(s) || s.gameOver) break;
      const moves = Sim.listMoves(s).filter(m => !m.blocked);
      for (const m of moves) {
        const r = evalFrom(s, m, WIDTH, TIMEOUT);
        results.push({ game: job.id, kind: job.kind, step: t + 1, progress: +(s.eliminatedPixels / s.totalPixels).toFixed(4), r: m.r, c: m.c, ...r });
      }
      if (!Sim.applyPick(s, job.picks[t].r, job.picks[t].c)) break; // 不应发生
    }
    process.stderr.write(`[shard ${SHARD}] game ${job.id} (${job.kind}) done, ${results.length} evals\n`);
  }
  fs.writeFileSync(OUTFILE, JSON.stringify({ shard: SHARD, results, _pid: process.pid }));
  process.exit(0);
}

/** 从状态 s 的选项 m 出发，判断“取它之后还有没有解”。逐行复刻 Solvable_v1.solve()。 */
function evalFrom(s, m, width, timeoutSec) {
  const t0 = Date.now();
  const child = St.cloneState(s);
  if (!Sim.applyPick(child, m.r, m.c)) return { verdict: 'illegal', sec: 0, timedOut: false };
  const isWon = (x) => x.eliminatedPixels >= x.totalPixels;
  if (isWon(child)) return { verdict: 'solvable', sec: 0, timedOut: false };
  // 立刻死：overflow / 暂存超上限 / isDeadEnd → 无需搜索，确定无解
  if (child.overflow || child.buffer.length > child.bufferLimit || Sim.isDeadEnd(child)) {
    return { verdict: 'fatal', sec: +((Date.now() - t0) / 1000).toFixed(2), timedOut: false, reason: child.overflow ? 'overflow' : (child.buffer.length > child.bufferLimit ? 'overLimit' : 'deadEnd') };
  }
  const res = solveFrom(child, width, timeoutSec);
  return { verdict: res.solvable ? 'solvable' : (res.timedOut ? 'timeout' : 'fatal'), sec: res.sec, timedOut: res.timedOut };
}

/** 与 Solvable_v1.solve() 同一束搜索，只是起点不是 createState，而是给定状态。 */
function solveFrom(s0, width, timeoutSec) {
  const t0 = Date.now();
  const deadline = timeoutSec > 0 ? t0 + timeoutSec * 1000 : Infinity;
  const totalPx = s0.totalPixels;
  const isWon = (x) => x.eliminatedPixels >= x.totalPixels;
  let beam = [s0];
  let found = isWon(s0) ? s0 : null;
  let timedOut = false;
  const cells0 = s0.cells || [];
  const maxSteps = ((cells0.length ? countBoxes(s0) : 49) || 1) + 1;
  for (let step = 0; step < maxSteps && beam.length && !found; step++) {
    if (Date.now() > deadline) { timedOut = true; break; }
    const next = [];
    for (const s of beam) {
      if (Date.now() > deadline) { timedOut = true; break; }
      for (const m of Sim.listMoves(s).filter(x => !x.blocked)) {
        const ch = St.cloneState(s);
        if (!Sim.applyPick(ch, m.r, m.c)) continue;
        if (isWon(ch)) { found = ch; break; }
        if (ch.overflow || ch.buffer.length > ch.bufferLimit) continue;
        if (ch.buffer.length >= ch.bufferLimit && Sim.isDeadEnd(ch)) continue;
        next.push(ch);
      }
      if (found || timedOut) break;
    }
    if (found || timedOut) break;
    next.sort(better);
    const seen = new Set();
    const kept = [];
    for (const st of next) {
      const k = keyOf(st);
      if (seen.has(k)) continue;
      seen.add(k);
      kept.push(st);
      if (kept.length >= width) break;
    }
    beam = kept;
  }
  return { solvable: !!found, sec: +((Date.now() - t0) / 1000).toFixed(3), timedOut };
}

function countBoxes(s) {
  let n = 0;
  for (const row of s.cells) for (const c of row) if (c && c.t === 'box') n++;
  return n;
}

/** Solvable_v1 的状态键：棋盘占位 + 已消除像素数 + 数字冰剩余 + 暂存（颜色:进度 排序后） */
function keyOf(s) {
  let k = '';
  for (const row of s.cells) for (const c of row) k += (c && c.t === 'box') ? '1' : '0';
  let ice = '';
  if (s.numice) for (const kk of Object.keys(s.numice).sort()) ice += kk + ':' + s.numice[kk].remaining + ';';
  return k + '|' + s.eliminatedPixels + '|' + ice + '|' +
    s.buffer.map(b => b.color + ':' + b.progress).sort().join(',');
}
function better(a, b) {
  return (a.buffer.length - b.buffer.length) || (b.eliminatedPixels - a.eliminatedPixels);
}

// ==================== 父进程 ====================
function main() {
  const LEVEL = process.argv[2];
  if (!LEVEL || LEVEL.startsWith('--')) {
    console.error('用法: node 陷阱格_v1.js <关卡.json> [--runs 20] [--seed 977] [--width 8] [--timeout 2] [--threshold 0.30] [--workers 8] [--out 陷阱格.json]');
    process.exit(2);
  }
  const RUNS = Math.max(1, Number(arg('--runs', 20)) || 20);
  const SEED = Number(arg('--seed', 977));
  const WIDTH = Number(arg('--width', 8));
  const TIMEOUT = Number(arg('--timeout', 2));
  const THRESH = Number(arg('--threshold', 0.30));
  const WORKERS = Math.max(1, Number(arg('--workers', 8)) || 8);
  const OUT = arg('--out', path.join(__dirname, '陷阱格.json'));

  const game = JSON.parse(fs.readFileSync(LEVEL, 'utf8'));
  const ROWS = game.spools.length, COLS = game.spools[0].length;
  const lv = A.parseLevel(A.fromGameFormat(game));
  const isWon = (s) => s.eliminatedPixels >= s.totalPixels;
  const isDead = (s) => !!(s.overflow || s.buffer.length > s.bufferLimit || Sim.isDeadEnd(s));
  function lcg(seed) { let rs = seed; return () => { rs = (rs * 1103515245 + 12345) & 0x7fffffff; return rs / 0x7fffffff; }; }
  function cmpArr(a, b) { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1; return 0; }

  // ---- 生成游戏计划（只记录点击序列；随机流顺序消费）----
  const rnd = lcg(SEED);
  const jobs = [];
  const perCell = {};  // "r,c" -> {clickable:[progress], firstPick:[progress]}
  const touch = (k, kind, p) => { const o = perCell[k] || (perCell[k] = { clickable: [], firstPick: [] }); o[kind].push(p); };

  for (let gi = 0; gi < RUNS; gi++) {
    let s = Sim.createState(lv, { useSlotStart: true, instantChain: false });
    const picks = [];
    const seenPick = new Set();
    while (!isWon(s)) {
      const progress = s.eliminatedPixels / s.totalPixels;
      const ms = Sim.listMoves(s).filter(m => !m.blocked);
      for (const m of ms) touch(m.r + ',' + m.c, 'clickable', +progress.toFixed(4));
      const idx = ms.map((_, i) => i);
      for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const x = idx[i]; idx[i] = idx[j]; idx[j] = x; }
      let pick = null;
      for (const k of idx) {
        const m = ms[k];
        const t = St.cloneState(s);
        if (!Sim.applyPick(t, m.r, m.c)) continue;
        if (!isDead(t) || isWon(t)) { pick = { m, t }; break; }
      }
      if (!pick) break;
      picks.push({ r: pick.m.r, c: pick.m.c });
      const pk = pick.m.r + ',' + pick.m.c;
      if (!seenPick.has(pk)) { seenPick.add(pk); touch(pk, 'firstPick', +progress.toFixed(4)); }
      s = pick.t;
    }
    jobs.push({ id: gi, kind: 'random', picks, won: isWon(s), steps: picks.length, progress: +(s.eliminatedPixels / s.totalPixels).toFixed(4) });
  }

  // ---- free-first 路线（与 加链/扫描_v1.js runFree 同打分）----
  {
    let s = Sim.createState(lv, { useSlotStart: true, instantChain: false });
    const picks = [];
    const seenPick = new Set();
    for (let i = 0; i < 120 && !isWon(s); i++) {
      const progress = s.eliminatedPixels / s.totalPixels;
      const ms = Sim.listMoves(s).filter(m => !m.blocked);
      for (const m of ms) touch(m.r + ',' + m.c, 'clickable', +progress.toFixed(4));
      let best = null, bestKey = null;
      for (const m of ms) {
        const t = St.cloneState(s);
        const e0 = t.eliminatedPixels, d0 = t.completedBoxes;
        if (!Sim.applyPick(t, m.r, m.c)) continue;
        const bufAfter = t.buffer.length;
        const debtPx = t.buffer.reduce((a, b) => a + (b.need - b.progress), 0);
        const nextM = isWon(t) ? 0 : Sim.listMoves(t).filter(x => !x.blocked).length;
        const dead = t.overflow || bufAfter > t.bufferLimit || (bufAfter >= t.bufferLimit && t.completedBoxes - d0 === 0) || (!isWon(t) && nextM === 0);
        const key = [dead ? 0 : 1, bufAfter === 0 ? 1 : 0, t.eliminatedPixels - e0, -bufAfter, -debtPx, -m.r, -m.c];
        if (!best || cmpArr(key, bestKey) > 0) { best = { m, t }; bestKey = key; }
      }
      if (!best) break;
      picks.push({ r: best.m.r, c: best.m.c });
      const pk = best.m.r + ',' + best.m.c;
      if (!seenPick.has(pk)) { seenPick.add(pk); touch(pk, 'firstPick', +progress.toFixed(4)); }
      s = best.t;
    }
    jobs.push({ id: RUNS, kind: 'free-first', picks, won: isWon(s), steps: picks.length, progress: +(s.eliminatedPixels / s.totalPixels).toFixed(4) });
  }

  const planFile = `/tmp/陷阱链_plan_${process.pid}.json`;
  fs.writeFileSync(planFile, JSON.stringify({ workers: WORKERS, jobs }));
  console.log(`计划: ${RUNS} 局随机 + 1 条 free-first；总步数 ${jobs.reduce((a, j) => a + j.picks.length, 0)}；workers=${WORKERS}；width=${WIDTH}；timeout=${TIMEOUT}s`);
  console.log(`随机局: ${jobs.filter(j => j.kind === 'random').map(j => j.won ? 'W' : 'D').join('')}  胜 ${jobs.filter(j => j.kind === 'random' && j.won).length}/${RUNS}`);

  // ---- 分片并行 ----
  const t0 = Date.now();
  const shardFiles = [];
  const procs = [];
  for (let i = 0; i < WORKERS; i++) {
    const sf = `/tmp/陷阱链_shard_${process.pid}_${i}.json`;
    shardFiles.push(sf);
    const p = fork(__filename, ['--worker', '--level', LEVEL, '--shard', String(i), '--width', String(WIDTH),
      '--timeout', String(TIMEOUT), '--plan', planFile, '--shard-out', sf], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    procs.push(p);
  }
  let done = 0;
  const waitAll = new Promise((resolve) => {
    for (const [i, p] of procs.entries()) {
      p.on('exit', (code) => {
        if (code !== 0) console.error(`shard ${i} 退出码 ${code}`);
        if (++done === procs.length) resolve();
      });
    }
  });
  waitAll.then(() => {
    const results = [];
    for (const f of shardFiles) {
      if (!fs.existsSync(f)) continue;
      results.push(...JSON.parse(fs.readFileSync(f, 'utf8')).results);
    }
    const sec = +((Date.now() - t0) / 1000).toFixed(1);

    // ---- 聚合：按格 ----
    const cells = {};
    for (const e of results) {
      const k = e.r + ',' + e.c;
      const o = cells[k] || (cells[k] = { r: e.r, c: e.c, n: 0, fatal: 0, solvable: 0, timeout: 0, illegal: 0, secSum: 0, samples: [] });
      o.n++;
      o.secSum += e.sec || 0;
      if (e.verdict === 'fatal') o.fatal++;
      else if (e.verdict === 'solvable') o.solvable++;
      else if (e.verdict === 'timeout') o.timeout++;
      else o.illegal++;
      o.samples.push({ game: e.game, kind: e.kind, step: e.step, progress: e.progress, verdict: e.verdict, sec: e.sec });
    }
    // ---- 聚合：按状态（game+step）----
    const stateMap = {};
    for (const e of results) {
      const k = e.game + '#' + e.step;
      const o = stateMap[k] || (stateMap[k] = { game: e.game, kind: e.kind, step: e.step, progress: e.progress, options: 0, fatal: 0, timeout: 0, solvable: 0, illegal: 0 });
      o.options++;
      if (e.verdict === 'fatal') o.fatal++;
      else if (e.verdict === 'solvable') o.solvable++;
      else if (e.verdict === 'timeout') o.timeout++;
      else o.illegal++;
    }
    const states = Object.values(stateMap).sort((a, b) => a.game - b.game || a.step - b.step);
    const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;

    const cellRows = [];
    for (const k in cells) {
      const o = cells[k];
      const [r, c] = k.split(',').map(Number);
      const sp = game.spools[r][c];
      const pc = perCell[k] || { clickable: [], firstPick: [] };
      const med = (a) => { if (!a.length) return null; const b = a.slice().sort((x, y) => x - y), n = b.length; return +(n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2).toFixed(3); };
      const fatalShare = +((o.fatal + o.illegal) / o.n).toFixed(3);
      const fatalShareLoose = +((o.fatal + o.illegal + o.timeout) / o.n).toFixed(3);
      const decisive = o.fatal + o.solvable;
      const fatalShareStrict = +(o.fatal / Math.max(1, decisive)).toFixed(3);
      cellRows.push({
        r, c, color: sp && sp.id, count: sp && sp.count,
        n: o.n, fatal: o.fatal, solvable: o.solvable, timeout: o.timeout, illegal: o.illegal,
        decisive,
        fatalShare, fatalShareLoose, fatalShareStrict,
        trap: decisive >= 5 && fatalShareStrict >= THRESH,
        actMed: med(pc.clickable), firstTakenMed: med(pc.firstPick), actN: pc.clickable.length,
        avgSec: +(o.secSum / o.n).toFixed(2),
        samples: (o.fatal > 0 || decisive >= 5 && fatalShareStrict >= THRESH) ? o.samples : []
      });
    }
    cellRows.sort((a, b) => b.fatalShare - a.fatalShare || a.r - b.r || a.c - b.c);
    const trapCells = cellRows.filter(x => x.trap);
    const out = {
      tool: '陷阱格_v1', level: path.basename(LEVEL), seed: SEED, runs: RUNS, width: WIDTH, timeout: TIMEOUT,
      threshold: THRESH, workers: WORKERS, sec, _pid: process.pid,
      gameOutcomes: jobs.map(j => ({ id: j.id, kind: j.kind, won: j.won, steps: j.steps, progress: j.progress })),
      summary: {
        evals: results.length,
        cellsEvaluated: cellRows.length,
        trapCells: trapCells.length,
        timeoutShare: +(results.filter(x => x.verdict === 'timeout').length / Math.max(1, results.length)).toFixed(3),
        states: states.length,
        fatalPerState: +mean(states.map(s => s.fatal)).toFixed(2),
        fatalPerStateLoose: +mean(states.map(s => s.fatal + s.illegal + s.timeout)).toFixed(2),
        fatalByPhase: {
          early: +mean(states.filter(s => s.progress < 0.2).map(s => s.fatal)).toFixed(2),
          mid: +mean(states.filter(s => s.progress >= 0.2 && s.progress <= 0.6).map(s => s.fatal)).toFixed(2),
          late: +mean(states.filter(s => s.progress > 0.6).map(s => s.fatal)).toFixed(2)
        },
        optionsPerState: +mean(states.map(s => s.options)).toFixed(2),
        fatalShareOfOptions: +(mean(states.map(s => (s.fatal + s.illegal) / s.options))).toFixed(3)
      },
      states,
      trapCells,
      cells: cellRows.map(({ samples, ...rest }) => rest)
    };
    fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
    // 清理中间文件
    for (const f of shardFiles) { try { fs.unlinkSync(f); } catch (e) {} }
    try { fs.unlinkSync(planFile); } catch (e) {}
    console.log(`\n完成：${results.length} 次评估，${cellRows.length} 个格子，${trapCells.length} 个陷阱格，耗时 ${sec}s`);
    console.log('=== 陷阱格（decisive≥5 且 strict fatalShare ≥ ' + THRESH + '）===');
    for (const x of trapCells) console.log(`  (${x.r},${x.c}) color=${x.color} cap=${x.count} strict=${x.fatalShareStrict} primary=${x.fatalShare} loose=${x.fatalShareLoose} (fatal=${x.fatal}, solvable=${x.solvable}, timeout=${x.timeout}, n=${x.n}) actMed=${x.actMed} firstTakenMed=${x.firstTakenMed}`);
    console.log('\n=== 全部格子（按 strict 降序前 20）===');
    for (const x of cellRows.slice(0, 20)) console.log(`  (${x.r},${x.c}) color=${x.color} cap=${x.count} fatal=${x.fatal} solvable=${x.solvable} timeout=${x.timeout} strict=${x.fatalShareStrict} primary=${x.fatalShare} actMed=${x.actMed} firstTaken=${x.firstTakenMed}`);
    console.log('saved', OUT);
  });
}
