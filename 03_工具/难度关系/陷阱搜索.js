#!/usr/bin/env node
/**
 * P3 v1：局部颜色陷阱搜索（只读评估 + 输出变异关卡）
 *
 * 用法：
 *   node 03_工具/难度关系/陷阱搜索.js 实验关/我做_006_第三版A_中等.json
 *   node 03_工具/难度关系/陷阱搜索.js <关卡.json> --top 10 --time 2000
 *
 * 做法：
 *   1. 对基准关卡求解，取 pickOrder 的前 6 手（early）和 30~60%（deep）的普通盒；
 *   2. 枚举 early×deep 的不同色交换（只换位置，不改数量/颜色/障碍，守恒不变）；
 *   3. 每个变异跑：可解 + 首通 6 局 + 学会后（≤2 次重试/避死色）+ 2 步前瞻（2 局）+ T/R/U；
 *   4. 评分：学会后回升、前瞻回升、T>0、R>0，且首通落在 20~70% 最好；
 *   5. 打印 Top N，把最高分的变异写进 03_工具/难度关系/输出/。
 *
 * 只读：不改基准文件；输出单独文件。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '../..');
const JS_DIR = path.join(ROOT, '02_工程/完整主bin快照_20261012/bin/js');
const OUT_DIR = path.join(__dirname, '输出');
const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js', 'playersim.js', 'analysis.js', 'generator.js'];

function loadAnt() {
  const sb = {
    console: { log() {}, warn() {}, error() {} },
    module: { exports: {} }, WeakMap, Map, Set, setTimeout, clearTimeout, Infinity, Math, JSON, Date
  };
  vm.createContext(sb);
  for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(JS_DIR, f), 'utf8'), sb, { filename: f });
  return sb.AntSolver;
}

function evalLevel(A, G, lv, timeBudgetMs) {
  const parsed = A.parseLevel(lv);
  const sr = A.Solver.solve(parsed, { timeBudgetMs: timeBudgetMs || 2000 });
  if (!sr || !sr.completed) return null;

  const runs = [];
  const thr = [0.3, 0.45, 0.6, 0.75, 0.9];
  for (const t of thr) for (let si = 0; si < 2; si++) {
    try {
      runs.push(A.PlayerSim.run(parsed, {
        pickThreshold: t, seed: 101 + si * 37, useItems: false, reviveCap: 0, capturePreviewStats: false
      }));
    } catch (e) { runs.push(null); }
  }
  const ok = runs.filter(Boolean);
  if (!ok.length) return null;
  const first = Math.round(ok.filter(r => r.won).length / ok.length * 100);

  // 学会后：每个首通局失败后最多 2 次重试，带上局死色
  let lw = 0, lr = 0;
  for (const r0 of ok) {
    lr++;
    if (r0.won) { lw++; continue; }
    let avoid = (r0.lastBlocked || r0.lastRefuse);
    avoid = (avoid && avoid.color != null) ? avoid.color : null;
    let won = false;
    for (let at = 1; at <= 2; at++) {
      try {
        const rr = A.PlayerSim.run(parsed, {
          pickThreshold: 0.6 + (at === 1 ? 0.15 : -0.15), seed: 500 + at * 97,
          useItems: false, reviveCap: 0, capturePreviewStats: false, avoidColor: avoid
        });
        if (rr && rr.won) { won = true; break; }
        const b = rr && (rr.lastBlocked || rr.lastRefuse);
        if (b && b.color != null) avoid = b.color;
      } catch (e) { }
    }
    if (won) lw++;
  }
  const learned = Math.round(lw / lr * 100);

  // 2 步前瞻（2 局采样）
  let lookW = 0;
  for (let i = 0; i < 2; i++) {
    try {
      const rr = A.PlayerSim.run(parsed, {
        pickThreshold: 0.6, seed: 401 + i * 97, useItems: false, reviveCap: 0,
        capturePreviewStats: false, lookahead2: true, lookaheadLimit: 6
      });
      if (rr && rr.won) lookW++;
    } catch (e) { }
  }
  const look = Math.round(lookW / 2 * 100);

  const best = ok.reduce((a, b) => ((b.won && !a.won) || (b.won === a.won && (b.progress || 0) > (a.progress || 0))) ? b : a, ok[0]);
  const bestProg = best ? (best.progress || 0) : 0;
  const avg = ok.reduce((s, r) => s + (r.progress || 0), 0) / ok.length;
  const R = Math.max(0, Math.round(bestProg - avg));

  let union = new Set(), picked = 0;
  for (const r of ok) for (const p of (r.pickOrder || [])) {
    const k = p.r + ',' + p.c;
    if (!union.has(k)) { union.add(k); picked++; }
  }
  const total = parsed.totalBoxes || 0;
  const U = total ? Math.max(0, Math.min(100, Math.round((1 - picked / total) * 100))) : null;

  let fill = null;
  try { fill = G.choiceCurve(parsed, sr); } catch (e) { }
  const dec = fill && fill.steps ? fill.steps.filter(s => s.full >= 2).length : 0;
  const traps = new Set();
  if (best && best.won) {
    for (const r of ok) {
      if (r.won) continue;
      const bp = best.pickOrder || [], rp = r.pickOrder || [], n = Math.min(bp.length, rp.length);
      for (let i = 0; i < n; i++) {
        if (bp[i].r !== rp[i].r || bp[i].c !== rp[i].c) {
          traps.add(bp[i].step != null ? bp[i].step : i);
          break;
        }
      }
    }
  }
  const T = (dec > 0 && best && best.won) ? Math.round(traps.size / dec * 100) : 0;

  return { first, learned, look, T, R, U, bestProg, dec, po: sr.pickOrder, total };
}

function main() {
  const args = process.argv.slice(2);
  const input = args.find(a => !a.startsWith('--'));
  if (!input) {
    console.log('用法: node 03_工具/难度关系/陷阱搜索.js <关卡.json> [--top 10] [--time 2000]');
    process.exit(1);
  }
  const topN = parseInt((args[args.indexOf('--top') + 1] || '10'), 10) || 10;
  const time = parseInt((args[args.indexOf('--time') + 1] || '2000'), 10) || 2000;
  const maxPairs = parseInt((args[args.indexOf('--max') + 1] || '999'), 10) || 999;
  const noWrite = args.includes('--no-write');
  const hard = args.includes('--hard');
  const lv0 = JSON.parse(fs.readFileSync(input, 'utf8'));
  if (!lv0.board || !lv0.blocks) { console.error('不是内部关卡 JSON（缺 board/blocks）'); process.exit(1); }

  const A = loadAnt();
  const G = A.Generator;
  const base = evalLevel(A, G, lv0, time);
  if (!base) { console.error('基准关卡不可解'); process.exit(1); }
  console.log('BASE', JSON.stringify({ first: base.first, learned: base.learned, look: base.look, T: base.T, R: base.R, U: base.U, bestProg: base.bestProg, dec: base.dec }));

  const plain = (r, c) => {
    const cell = lv0.board.cells[r] && lv0.board.cells[r][c];
    return cell && cell.t === 'box' && !cell.chain && !cell.numice && !cell.q;
  };
  const po = base.po;
  const early = [], deep = [];
  for (let i = 0; i < po.length; i++) {
    const p = po[i];
    if (!plain(p.r, p.c)) continue;
    if (i < 6) early.push(p);
    if (i >= Math.floor(po.length * 0.3) && i <= Math.floor(po.length * 0.6)) deep.push(p);
  }
  console.log('候选: early', early.length, 'deep', deep.length);

  // P3 v3：不只交换，增加“同色计数偏斜”和“三色位置轮换”
  const muts = [];
  const coordKey = (p) => p.r + ',' + p.c;
  for (const e of early) for (const d of deep) {
    if (e.color !== d.color) {
      muts.push({ type: 'swap', a: e, b: d });
    } else if (e.count > 1 && d.count > 1) {
      const delta = Math.max(1, Math.min(10, Math.floor(d.count / 2)));
      if (e.count + delta > d.count) muts.push({ type: 'skew', a: e, b: d, delta: delta });
    }
  }
  // 三色/三位置轮换：从 early×deep×（early∪deep）里抽前 30 个不同三元组
  const pool = early.concat(deep);
  let cyc = 0;
  for (const e of early) for (const d of deep) for (const x of pool) {
    if (cyc >= 30) break;
    if (coordKey(e) === coordKey(d) || coordKey(e) === coordKey(x) || coordKey(d) === coordKey(x)) continue;
    muts.push({ type: 'cycle3', a: e, b: d, c: x });
    cyc++;
  }
  function applyMut(lv, mut) {
    if (mut.type === 'swap') {
      const a = lv.board.cells[mut.a.r][mut.a.c], b = lv.board.cells[mut.b.r][mut.b.c];
      if (!a || !b) return false;
      lv.board.cells[mut.a.r][mut.a.c] = b; lv.board.cells[mut.b.r][mut.b.c] = a;
    } else if (mut.type === 'skew') {
      const a = lv.board.cells[mut.a.r][mut.a.c], b = lv.board.cells[mut.b.r][mut.b.c];
      if (!a || !b) return false;
      a.count += mut.delta; b.count -= mut.delta;
      if (b.count <= 0) return false;
    } else if (mut.type === 'cycle3') {
      const A = lv.board.cells[mut.a.r][mut.a.c], B = lv.board.cells[mut.b.r][mut.b.c], C = lv.board.cells[mut.c.r][mut.c.c];
      if (!A || !B || !C) return false;
      lv.board.cells[mut.a.r][mut.a.c] = C;
      lv.board.cells[mut.b.r][mut.b.c] = A;
      lv.board.cells[mut.c.r][mut.c.c] = B;
    }
    return true;
  }
  // 硬模式：单变异到不了“学会后 60~85”，改用双变异组合
  const work = [];
  if (hard) {
    const cap = Math.min(80, muts.length * (muts.length - 1) / 2);
    for (let i = 0; i < muts.length && work.length < cap; i++) {
      for (let j = i + 1; j < muts.length && work.length < cap; j++) {
        const a = muts[i], b = muts[j];
        const keys = [a.a, a.b, a.c, b.a, b.b, b.c].filter(Boolean).map(p => p.r + ',' + p.c);
        if (new Set(keys).size < keys.length) continue;
        work.push({ type: 'combo', parts: [a, b] });
      }
    }
    if (!work.length) work.push(...muts.map(m => ({ type: 'combo', parts: [m] })));
  } else {
    work.push(...muts);
  }
  const rows = [];
  let tried = 0;
  for (const mut of work) {
    if (tried >= maxPairs) break;
    tried++;
    const lv = JSON.parse(JSON.stringify(lv0));
    let ok = true;
    if (mut.type === 'combo') {
      for (const part of mut.parts) { if (!applyMut(lv, part)) { ok = false; break; } }
    } else ok = applyMut(lv, mut);
    if (!ok) continue;
    let m = null;
    try { m = evalLevel(A, G, lv, time); } catch (err) { }
    if (!m) continue;
    let score;
    if (hard) {
      if (m.first < 15 || m.first > 50) continue;
      if (m.learned < 50 || m.learned > 90) continue;
      if (m.look < 40 || m.look > 90) continue;
      if (m.T < 10 || m.T > 35) continue;
      if (m.U != null && m.U > 20) continue;
      score = -Math.abs(m.first - 30) - Math.abs(m.learned - 75) - Math.abs(m.look - 65) * 0.8 - Math.abs(m.T - 22) + (m.R || 0) * 0.3;
    } else {
      if (m.T <= 0) continue;
      if (m.first < 10 || m.first > 90) continue;
      if (m.learned <= m.first) continue;
      if (m.U != null && m.U > 30) continue;
      if (m.first > base.first + 5) continue;
      if (m.learned < base.learned - 5) continue;
      if (m.look < base.look - 5) continue;
      if (m.T < base.T) continue;
      if (m.learned <= base.learned && m.look <= base.look && m.T <= base.T) continue;
      score = (m.learned - base.learned) * 3 + (m.look - base.look) + (m.T - base.T) * 2 + (m.R - base.R) * 0.2 - Math.max(0, m.first - base.first) * 2;
    }
    const prim = mut.type === 'combo' ? mut.parts[0] : mut;
    const sec = mut.type === 'combo' ? mut.parts[1] : null;
    rows.push({
      type: mut.type, score: Math.round(score),
      early: [prim.a.r, prim.a.c, prim.a.color, prim.a.count], deep: [prim.b.r, prim.b.c, prim.b.color, prim.b.count],
      third: prim.c ? [prim.c.r, prim.c.c, prim.c.color, prim.c.count] : (sec ? [sec.a.r, sec.a.c, sec.a.color, sec.a.count] : null),
      first: m.first, learned: m.learned, look: m.look, T: m.T, R: m.R, U: m.U, bestProg: m.bestProg, dec: m.dec,
      level: lv
    });
  }
  rows.sort((a, b) => b.score - a.score);
  console.log('\nTOP ' + Math.min(topN, rows.length));
  for (const r of rows.slice(0, topN)) {
    console.log(JSON.stringify({
      type: r.type, score: r.score, swap: r.early.join(',') + ' <-> ' + r.deep.join(','),
      first: r.first, learned: r.learned, look: r.look, T: r.T, R: r.R, U: r.U, bestProg: r.bestProg, dec: r.dec
    }));
  }
  if (noWrite) return;
  if (!rows.length) { console.log('没有可评估的交换'); return; }
  const best = rows[0];
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const baseName = path.basename(input, '.json');
  const outLevel = path.join(OUT_DIR, (hard ? '硬_' : '陷阱_') + baseName + '.json');
  const outReport = path.join(OUT_DIR, (hard ? '硬_' : '陷阱_') + baseName + '_报告.json');
  fs.writeFileSync(outLevel, JSON.stringify(best.level, null, 2));
  // 另存一份客户端格式（便于直接导入游戏/关卡包工具）
  try {
    const gameLv = A.toGameFormat(A.parseLevel(best.level));
    fs.writeFileSync(path.join(OUT_DIR, (hard ? '硬_' : '陷阱_') + baseName + '_game.json'), JSON.stringify(gameLv, null, 2));
  } catch (e) { console.error('客户端格式写出失败:', e.message); }
  fs.writeFileSync(outReport, JSON.stringify({
    input, generatedAt: new Date().toISOString(),
    base: { first: base.first, learned: base.learned, look: base.look, T: base.T, R: base.R, U: base.U, bestProg: base.bestProg, dec: base.dec },
    best: {
      type: best.type, score: best.score, swap: { early: best.early, deep: best.deep, third: best.third },
      first: best.first, learned: best.learned, look: best.look, T: best.T, R: best.R, U: best.U, bestProg: best.bestProg, dec: best.dec
    },
    runnerUps: rows.slice(1, topN).map(r => ({
      type: r.type, score: r.score, swap: { early: r.early, deep: r.deep, third: r.third },
      first: r.first, learned: r.learned, look: r.look, T: r.T, R: r.R, U: r.U
    }))
  }, null, 2));
  console.log('\n写出: ' + outLevel);
  console.log('报告: ' + outReport);
}

main();
