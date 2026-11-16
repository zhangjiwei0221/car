#!/usr/bin/env node
'use strict';
/**
 * 陷阱链实验 · 超时复核（2026-11-16）
 *
 * 第 1 步按任务口径（宽度 8、超时 2s）判“取它之后还有没有解”。2s 对早期状态太短：
 * 早期状态大量 timeout（不是“无解”，只是没搜出来），直接当无解会把所有开局格误判成陷阱；
 * 直接当有解又可能漏掉真陷阱。本脚本抽样 timeout 的评估，用更长超时重搜：
 *   - 重搜找到解 → 该 timeout 实为“有解”；
 *   - 重搜仍没找到 / 立刻死 → 该 timeout 实为“无解”。
 * 得到分阶段的 q = P(无解 | 2s timeout)，用于把 陷阱格.json 的 timeout 折算成无解。
 *
 * 抽样：按“可点进度”分三段早期 <0.2 / 中段 0.2–0.6 / 后段 >0.6，各抽 --per-phase 个。
 * 随机局与 free-first 的点击序列与 陷阱格_v1.js 完全同源（同种子、同 LCG、同判据）。
 *
 * 用法：
 *   node 超时复核_v1.js <关卡.json> <陷阱格.json> [--seed 977] [--runs 20]
 *        [--per-phase 60] [--timeout 12] [--workers 8] [--out 尝试复核.json]
 */
const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');
const B = require(path.join(__dirname, '../../../03_工具/正式版/Build006Thickness_v688.js'));
const A = B.loadSolver('corner');
const Sim = A.Simulator, St = A.SolverStrategy;
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.indexOf(k) > 0;

if (has('--worker')) runWorker(); else main();

function runWorker() {
  const LEVEL = arg('--level');
  const SHARD = Number(arg('--shard'));
  const nWorkers = Number(arg('--nworkers'));
  const TIMEOUT = Number(arg('--timeout', 12));
  const WIDTH = Number(arg('--width', 8));
  const PLANFILE = arg('--plan');
  const OUTFILE = arg('--shard-out');
  const plan = JSON.parse(fs.readFileSync(PLANFILE, 'utf8'));
  const jobs = plan.jobs, samples = plan.samples;
  const game = JSON.parse(fs.readFileSync(LEVEL, 'utf8'));
  const lv = A.parseLevel(A.fromGameFormat(game));
  const isWon = (s) => s.eliminatedPixels >= s.totalPixels;

  const out = [];
  for (const job of jobs) {
    if (job.id % nWorkers !== SHARD) continue;
    const mine = samples.filter(s => s.game === job.id).sort((a, b) => a.step - b.step);
    if (!mine.length) continue;
    let s = Sim.createState(lv, { useSlotStart: true, instantChain: false });
    let idx = 0;
    for (let t = 0; t < job.picks.length; t++) {
      if (isWon(s) || s.gameOver) break;
      while (idx < mine.length && mine[idx].step === t + 1) {
        const sm = mine[idx++];
        const mv = Sim.listMoves(s).filter(m => !m.blocked).find(m => m.r === sm.r && m.c === sm.c);
        if (!mv) { out.push({ ...sm, re: 'moveMissing' }); continue; }
        const ch = St.cloneState(s);
        const ok = Sim.applyPick(ch, mv.r, mv.c);
        if (!ok) { out.push({ ...sm, re: 'applyFail', solvable: false }); continue; }
        if (isWon(ch)) { out.push({ ...sm, re: 'won', solvable: true, sec: 0 }); continue; }
        if (ch.overflow || ch.buffer.length > ch.bufferLimit || Sim.isDeadEnd(ch)) {
          out.push({ ...sm, re: 'dead', solvable: false, sec: 0 }); continue;
        }
        const r = solveFrom(ch, WIDTH, TIMEOUT);
        out.push({ ...sm, re: r.solvable ? 'solvable' : (r.timedOut ? 'timeout2' : 'fatal'), solvable: r.solvable, sec: r.sec });
      }
      if (!Sim.applyPick(s, job.picks[t].r, job.picks[t].c)) break;
    }
    process.stderr.write(`[shard ${SHARD}] game ${job.id}: ${mine.length} samples done\n`);
  }
  fs.writeFileSync(OUTFILE, JSON.stringify({ shard: SHARD, samples: out, _pid: process.pid }));
  process.exit(0);
}

function solveFrom(s0, width, timeoutSec) {
  const t0 = Date.now();
  const deadline = t0 + timeoutSec * 1000;
  const isWon = (x) => x.eliminatedPixels >= x.totalPixels;
  let beam = [s0], found = isWon(s0) ? s0 : null, timedOut = false;
  let nBox = 0;
  for (const row of s0.cells) for (const c of row) if (c && c.t === 'box') nBox++;
  const maxSteps = (nBox || 1) + 1;
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
    const seen = new Set(), kept = [];
    for (const st of next) { const k = keyOf(st); if (seen.has(k)) continue; seen.add(k); kept.push(st); if (kept.length >= width) break; }
    beam = kept;
  }
  return { solvable: !!found, sec: +((Date.now() - t0) / 1000).toFixed(3), timedOut };
}
function keyOf(s) {
  let k = '';
  for (const row of s.cells) for (const c of row) k += (c && c.t === 'box') ? '1' : '0';
  let ice = '';
  if (s.numice) for (const kk of Object.keys(s.numice).sort()) ice += kk + ':' + s.numice[kk].remaining + ';';
  return k + '|' + s.eliminatedPixels + '|' + ice + '|' + s.buffer.map(b => b.color + ':' + b.progress).sort().join(',');
}
function better(a, b) { return (a.buffer.length - b.buffer.length) || (b.eliminatedPixels - a.eliminatedPixels); }

function main() {
  const LEVEL = process.argv[2], TRAPFILE = process.argv[3];
  if (!LEVEL || LEVEL.startsWith('--') || !TRAPFILE) {
    console.error('用法: node 超时复核_v1.js <关卡.json> <陷阱格.json> [--per-phase 60] [--timeout 12] [--workers 8] [--out 文件.json]');
    process.exit(2);
  }
  const SEED = Number(arg('--seed', 977));
  const RUNS = Math.max(1, Number(arg('--runs', 20)) || 20);
  const PER = Math.max(1, Number(arg('--per-phase', 60)) || 60);
  const TIMEOUT = Number(arg('--timeout', 12));
  const WORKERS = Math.max(1, Number(arg('--workers', 8)) || 8);
  const OUT = arg('--out', path.join(__dirname, `超时复核_${process.pid}.json`));
  const trap = JSON.parse(fs.readFileSync(TRAPFILE, 'utf8'));

  const game = JSON.parse(fs.readFileSync(LEVEL, 'utf8'));
  const lv = A.parseLevel(A.fromGameFormat(game));
  const isWon = (s) => s.eliminatedPixels >= s.totalPixels;
  const isDead = (s) => !!(s.overflow || s.buffer.length > s.bufferLimit || Sim.isDeadEnd(s));
  function lcg(seed) { let rs = seed; return () => { rs = (rs * 1103515245 + 12345) & 0x7fffffff; return rs / 0x7fffffff; }; }
  function cmpArr(a, b) { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1; return 0; }

  // ---- 与 陷阱格_v1 同源生成点击序列 ----
  const rnd = lcg(SEED);
  const jobs = [];
  for (let gi = 0; gi < RUNS; gi++) {
    let s = Sim.createState(lv, { useSlotStart: true, instantChain: false });
    const picks = [];
    while (!isWon(s)) {
      const ms = Sim.listMoves(s).filter(m => !m.blocked);
      const idx = ms.map((_, i) => i);
      for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const x = idx[i]; idx[i] = idx[j]; idx[j] = x; }
      let pick = null;
      for (const k of idx) {
        const m = ms[k]; const t = St.cloneState(s);
        if (!Sim.applyPick(t, m.r, m.c)) continue;
        if (!isDead(t) || isWon(t)) { pick = { m, t }; break; }
      }
      if (!pick) break;
      picks.push({ r: pick.m.r, c: pick.m.c });
      s = pick.t;
    }
    jobs.push({ id: gi, kind: 'random', picks });
  }
  {
    let s = Sim.createState(lv, { useSlotStart: true, instantChain: false });
    const picks = [];
    for (let i = 0; i < 120 && !isWon(s); i++) {
      const ms = Sim.listMoves(s).filter(m => !m.blocked);
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
      s = best.t;
    }
    jobs.push({ id: RUNS, kind: 'free-first', picks });
  }

  // ---- 收集 timeout 样本（来自 陷阱格.json 的 per-cell samples）----
  const pool = [];
  for (const cell of trap.trapCells.concat(trap.cells || [])) {
    if (!cell.samples || !cell.samples.length) continue;
    for (const sm of cell.samples) {
      if (sm.verdict !== 'timeout') continue;
      pool.push({ r: cell.r, c: cell.c, color: cell.color, game: sm.game, kind: sm.kind, step: sm.step, progress: sm.progress, phase: sm.progress < 0.2 ? 'early' : (sm.progress <= 0.6 ? 'mid' : 'late') });
    }
  }
  // 去重（同一状态同一选项只算一次）
  const seenKey = new Set();
  const uniq = [];
  for (const x of pool) {
    const k = x.game + '#' + x.step + '#' + x.r + ',' + x.c;
    if (seenKey.has(k)) continue;
    seenKey.add(k); uniq.push(x);
  }
  // 分阶段确定抽样（用固定 LCG，可复现）
  const pickRnd = lcg(20261116);
  const samples = [];
  for (const phase of ['early', 'mid', 'late']) {
    const arr = uniq.filter(x => x.phase === phase);
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(pickRnd() * (i + 1)); const t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
    samples.push(...arr.slice(0, PER));
  }
  console.log(`timeout 样本池 ${uniq.length}（early ${uniq.filter(x => x.phase === 'early').length} / mid ${uniq.filter(x => x.phase === 'mid').length} / late ${uniq.filter(x => x.phase === 'late').length}），抽 ${samples.length}；复核超时 ${TIMEOUT}s，workers=${WORKERS}`);

  const planFile = `/tmp/陷阱链_复核plan_${process.pid}.json`;
  fs.writeFileSync(planFile, JSON.stringify({ jobs, samples, workers: WORKERS }));
  const t0 = Date.now();
  const shardFiles = [], procs = [];
  for (let i = 0; i < WORKERS; i++) {
    const sf = `/tmp/陷阱链_复核shard_${process.pid}_${i}.json`;
    shardFiles.push(sf);
    procs.push(fork(__filename, ['--worker', '--level', LEVEL, '--shard', String(i), '--nworkers', String(WORKERS),
      '--timeout', String(TIMEOUT), '--plan', planFile, '--shard-out', sf], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] }));
  }
  let done = 0;
  const all = new Promise(res => { for (const [i, p] of procs.entries()) p.on('exit', c => { if (c !== 0) console.error(`shard ${i} exit ${c}`); if (++done === procs.length) res(); }); });
  all.then(() => {
    const rows = [];
    for (const f of shardFiles) if (fs.existsSync(f)) rows.push(...JSON.parse(fs.readFileSync(f, 'utf8')).samples);
    const byPhase = {};
    for (const ph of ['early', 'mid', 'late']) {
      const s = rows.filter(x => x.phase === ph);
      const fatal = s.filter(x => x.solvable === false && x.re !== 'moveMissing').length;
      const solvable = s.filter(x => x.solvable === true).length;
      const unknown = s.filter(x => x.re === 'timeout2').length;
      byPhase[ph] = { n: s.length, fatal, solvable, unknown, q: +(fatal / Math.max(1, fatal + solvable)).toFixed(3) };
    }
    const fatal = rows.filter(x => x.solvable === false && x.re !== 'moveMissing').length;
    const solvable = rows.filter(x => x.solvable === true).length;
    const out = {
      tool: '超时复核_v1', level: path.basename(LEVEL), trapFile: path.basename(TRAPFILE),
      timeout: TIMEOUT, width: 8, sec: +((Date.now() - t0) / 1000).toFixed(1), _pid: process.pid,
      pool: uniq.length, sampled: rows.length, byPhase,
      overall: { n: rows.length, fatal, solvable, unknown: rows.filter(x => x.re === 'timeout2').length, q: +(fatal / Math.max(1, fatal + solvable)).toFixed(3) },
      samples: rows
    };
    fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
    for (const f of shardFiles) { try { fs.unlinkSync(f); } catch (e) {} }
    try { fs.unlinkSync(planFile); } catch (e) {}
    console.log('各阶段 P(无解 | 2s timeout)：');
    for (const ph of ['early', 'mid', 'late']) console.log(`  ${ph}: n=${byPhase[ph].n} 无解=${byPhase[ph].fatal} 有解=${byPhase[ph].solvable} 12s仍超时=${byPhase[ph].unknown} q=${byPhase[ph].q}`);
    console.log('总体 q=', out.overall.q, ' n=', out.overall.n);
    console.log('saved', OUT);
  });
}
