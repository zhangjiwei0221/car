#!/usr/bin/env node
'use strict';
/**
 * 加链 A/B 实验 · 扫描器（2026-11-13）
 *
 * 作用（只读，不改关卡）：
 *   1) 在底座上跑 20 局随机 + 1 条 free-first，记录每辆车**第一次可点**时的进度；
 *   2) 统计逐色需求曲线（颜色像素在 free-first / 随机路线里什么时候被吃）；
 *   3) 枚举“两连”候选：正交相邻、都在第 0 行或第 0–1 行、两车首次可点中位
 *      都落在 [0.20, 0.60]、颜色属于中段需求；
 *   4) 输出 JSON（文件名自带 pid）+ 控制台表。
 *
 * 口径：loadSolver('corner')，useSlotStart:true，instantChain:false（AGENTS 红线 2）。
 * 随机玩家与 PopulationSim_v1 --no-mcfd 逐行同源（同 LCG、同洗牌、同死亡判据）。
 *
 * 用法：
 *   node 扫描_v1.js <关卡.json> [--runs 20] [--seed 977] [--out <文件.json>]
 */
const fs = require('fs');
const path = require('path');
const B = require(path.join(__dirname, '../../../03_工具/正式版/Build006Thickness_v688.js'));
const A = B.loadSolver('corner');
const EV = require(path.join(__dirname, '../../../03_工具/正式版/EscapeValveCheck_v1.js'));
const Sim = A.Simulator, St = A.SolverStrategy;

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const LEVEL = process.argv[2];
if (!LEVEL || LEVEL.startsWith('--')) { console.error('用法: node 扫描_v1.js <关卡.json> [--runs 20] [--seed 977] [--out <文件>]'); process.exit(2); }
const RUNS = Math.max(2, Number(arg('--runs', 20)) || 20);
const SEED = Number(arg('--seed', 977));
const OUT = arg('--out', `/tmp/加链scan_${process.pid}.json`);

const game = JSON.parse(fs.readFileSync(LEVEL, 'utf8'));
const ROWS = game.spools.length, COLS = game.spools[0].length;

// 开局逃生阀（EscapeValveCheck_v1）：点一下即吃满的车；链绑了它，满格时无路可走（103 的 13 局死因）。
// 这类候选默认不进排名，只在 excludedValve 里留档。
const OPENING_VALVES = (() => { try { return EV.openingValves(game); } catch (e) { return []; } })();
const VALVE_KEY = new Set(OPENING_VALVES.map(v => `${v.r},${v.c}`));

function clone(o) { return JSON.parse(JSON.stringify(o)); }
function lcg(seed) { let rs = seed; return () => { rs = (rs * 1103515245 + 12345) & 0x7fffffff; return rs / 0x7fffffff; }; }
function median(a) { if (!a || !a.length) return null; const b = a.slice().sort((x, y) => x - y), n = b.length; return n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2; }
function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }
function r3(x) { return x == null ? null : +Number(x).toFixed(3); }
const isWon = (s) => s.eliminatedPixels >= s.totalPixels;
const isDead = (s) => !!(s.overflow || s.buffer.length > s.bufferLimit || Sim.isDeadEnd(s));
const typeList = (c) => Array.isArray(c.type) ? c.type : (c.type === 0 || c.type == null ? [] : [c.type]);
function cmpArr(a, b) { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1; return 0; }

// 逐色已消除计数（目标图）
function colorEaten(s) {
  const m = {};
  for (let r = 0; r < s.rows; r++) for (let c = 0; c < s.cols; c++) {
    if (!s.eliminated[r][c]) continue;
    const col = s.blocks[r][c];
    if (col > 0) m[col] = (m[col] || 0) + 1;
  }
  return m;
}

// ==================== 玩家 ====================
function runRandom(lv, rnd) {
  let s = Sim.createState(lv, { useSlotStart: true, instantChain: false });
  const route = [];
  let maxBuffer = s.buffer.length;
  const first = {}, firstPick = {};
  const colorTrace = [];
  while (!isWon(s)) {
    const bufBefore = s.buffer.length;
    const progress = s.eliminatedPixels / s.totalPixels;
    const ms = Sim.listMoves(s).filter(m => !m.blocked);
    for (const m of ms) { const k = m.r + ',' + m.c; if (first[k] == null) first[k] = progress; }
    const eaten0 = colorEaten(s);
    const idx = ms.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const x = idx[i]; idx[i] = idx[j]; idx[j] = x; }
    let pick = null;
    for (const k of idx) {
      const m = ms[k];
      const t = St.cloneState(s);
      const e0 = t.eliminatedPixels;
      if (!Sim.applyPick(t, m.r, m.c)) continue;
      if (!isDead(t) || isWon(t)) { pick = { r: m.r, c: m.c, t, gain: t.eliminatedPixels - e0 }; break; }
    }
    if (!pick) return { won: false, steps: route.length, progress, maxBuffer, route, first, colorTrace: Object.keys(eaten0).length ? colorTrace : colorTrace };
    const eaten1 = colorEaten(pick.t);
    const stepColor = {};
    for (const col in eaten1) stepColor[col] = eaten1[col] - (eaten0[col] || 0);
    colorTrace.push({ step: route.length + 1, progress, colors: stepColor });
    route.push({ step: route.length + 1, r: pick.r, c: pick.c, buffer: bufBefore, progress, gain: pick.gain });
    if (firstPick[pick.r + ',' + pick.c] == null) firstPick[pick.r + ',' + pick.c] = progress;
    s = pick.t;
    if (s.buffer.length > maxBuffer) maxBuffer = s.buffer.length;
  }
  const eatenEnd = colorEaten(s);
  return { won: true, steps: route.length, progress: 1, maxBuffer, route, first, firstPick, colorTrace };
}

function runFree(lv) {
  let s = Sim.createState(lv, { useSlotStart: true, instantChain: false });
  const first = {}, firstPick = {}, colorTrace = [], route = [];
  let maxBuffer = s.buffer.length;
  for (let i = 0; i < 120 && !isWon(s); i++) {
    const progress = s.eliminatedPixels / s.totalPixels;
    const opts = [];
    const ms = Sim.listMoves(s).filter(m => !m.blocked);
    for (const m of ms) { const k = m.r + ',' + m.c; if (first[k] == null) first[k] = progress; }
    const eaten0 = colorEaten(s);
    for (const m of ms) {
      const t = St.cloneState(s);
      const e0 = t.eliminatedPixels, d0 = t.completedBoxes;
      if (!Sim.applyPick(t, m.r, m.c)) continue;
      const bufAfter = t.buffer.length;
      const debtPx = t.buffer.reduce((a, b) => a + (b.need - b.progress), 0);
      const nextM = isWon(t) ? 0 : Sim.listMoves(t).filter(x => !x.blocked).length;
      const dead = t.overflow || bufAfter > t.bufferLimit || (bufAfter >= t.bufferLimit && t.completedBoxes - d0 === 0) || (!isWon(t) && nextM === 0);
      opts.push({ m, t, gain: t.eliminatedPixels - e0, dead, bufAfter, debtPx, nextM });
    }
    if (!opts.length) break;
    let best = null, bestKey = null;
    for (const o of opts) {
      const key = [o.dead ? 0 : 1, o.bufAfter === 0 ? 1 : 0, o.gain, -o.bufAfter, -o.debtPx, -o.m.r, -o.m.c];
      if (!best || cmpArr(key, bestKey) > 0) { best = o; bestKey = key; }
    }
    if (!best) break;
    const eaten1 = colorEaten(best.t);
    const stepColor = {};
    for (const col in eaten1) stepColor[col] = eaten1[col] - (eaten0[col] || 0);
    colorTrace.push({ step: route.length + 1, progress, colors: stepColor });
    route.push({ step: route.length + 1, r: best.m.r, c: best.m.c, buffer: s.buffer.length, progress, gain: best.gain });
    if (firstPick[best.m.r + ',' + best.m.c] == null) firstPick[best.m.r + ',' + best.m.c] = progress;
    if (s.buffer.length > maxBuffer) maxBuffer = s.buffer.length;
    s = best.t;
    if (s.buffer.length > maxBuffer) maxBuffer = s.buffer.length;
  }
  return { won: isWon(s), steps: route.length, progress: s.eliminatedPixels / s.totalPixels, maxBuffer, route, first, firstPick, colorTrace };
}

// ==================== 主流程 ====================
const lv = A.parseLevel(A.fromGameFormat(game));
const rnd = lcg(SEED);
const runs = [];
for (let i = 0; i < RUNS; i++) runs.push(runRandom(lv, rnd));
const free = runFree(lv);
const allRuns = runs.concat([free]);

// 每格首次可点进度
const act = {};
for (const run of allRuns) for (const k in run.first) (act[k] = act[k] || []).push(run.first[k]);
const activation = {};
for (const k in act) activation[k] = { median: r3(median(act[k])), mean: r3(mean(act[k])), min: r3(Math.min(...act[k])), max: r3(Math.max(...act[k])), n: act[k].length };

// 每格首次**被拿**进度（模拟选车的第二把尺：行 0 的车可点=0，但可能中段才被拿）
const fp = {};
for (const run of runs) for (const k in run.firstPick) (fp[k] = fp[k] || []).push(run.firstPick[k]);
const firstPick = {};
for (const k in fp) firstPick[k] = { median: r3(median(fp[k])), n: fp[k].length };

// 逐色需求
const totals = {};
for (let r = 0; r < ROWS * 0 + game.blocks.length; r++) for (let c = 0; c < game.blocks[0].length; c++) {
  const col = game.blocks[r][c];
  if (col > 0) totals[col] = (totals[col] || 0) + 1;
}
function colorDemand(trace) {
  const firstEat = {}, lastEat = {}, bucket = {};   // bucket[color] = { early, mid, late }
  for (const st of trace) {
    for (const col in st.colors) {
      const n = st.colors[col];
      if (!(n > 0)) continue;
      if (firstEat[col] == null) firstEat[col] = st.progress;
      lastEat[col] = st.progress;
      const b = bucket[col] || (bucket[col] = { early: 0, mid: 0, late: 0 });
      if (st.progress < 0.2) b.early += n;
      else if (st.progress <= 0.6) b.mid += n;
      else b.late += n;
    }
  }
  return { firstEat, lastEat, bucket };
}
const freeDem = colorDemand(free.colorTrace);
const randDems = runs.map(x => colorDemand(x.colorTrace));
const colorDemandRows = Object.keys(totals).map(Number).sort((a, b) => a - b).map(col => {
  const tot = totals[col];
  const firsts = randDems.map(d => d.firstEat[col]).filter(v => v != null);
  const b = freeDem.bucket[col] || { early: 0, mid: 0, late: 0 };
  const midShare = b.mid / tot;
  return {
    color: col, total: tot,
    freeFirst: r3(freeDem.firstEat[col]), freeLast: r3(freeDem.lastEat[col]),
    randFirstMed: r3(median(firsts)),
    midShare: r3(midShare),
    classify: (freeDem.firstEat[col] == null ? 'unreached'
      : freeDem.firstEat[col] <= 0.05 ? 'opening'
        : midShare >= 0.25 && (freeDem.lastEat[col] == null || freeDem.lastEat[col] <= 0.9) ? 'mid-demand'
          : freeDem.firstEat[col] >= 0.75 ? 'late' : 'weak-mid')
  };
});
const demandByColor = {};
for (const row of colorDemandRows) demandByColor[row.color] = row;

// 候选对
const isCar = (c) => c && c.id > 0 && c.count > 0;
const isPipe = (c) => typeList(c).some(t => t >= 11 && t <= 14);
const candidates = [];
for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
  const a = game.spools[r][c];
  if (!isCar(a) || isPipe(a)) continue;
  for (const [dr, dc] of [[1, 0], [0, 1]]) {
    const rr = r + dr, cc = c + dc;
    if (rr >= ROWS || cc >= COLS) continue;
    const b = game.spools[rr][cc];
    if (!isCar(b) || isPipe(b)) continue;
    if (Math.max(r, rr) > 1) continue;              // 只在第 0 行 / 第 0–1 行
    const ka = r + ',' + c, kb = rr + ',' + cc;
    const aa = activation[ka], ab = activation[kb];
    if (!aa || !ab) continue;
    const pa = firstPick[ka], pb = firstPick[kb];
    const midA = aa.median >= 0.2 && aa.median <= 0.6;
    const midB = ab.median >= 0.2 && ab.median <= 0.6;
    const pickA = pa ? pa.median : null, pickB = pb ? pb.median : null;
    const midPickA = pickA != null && pickA >= 0.2 && pickA <= 0.6;
    const midPickB = pickB != null && pickB >= 0.2 && pickB <= 0.6;
    const da = demandByColor[a.id] || {}, db = demandByColor[b.id] || {};
    const midColorA = da.classify === 'mid-demand' || da.classify === 'weak-mid';
    const midColorB = db.classify === 'mid-demand' || db.classify === 'weak-mid';
    candidates.push({
      a: [r, c], b: [rr, cc], colorA: a.id, capA: a.count, colorB: b.id, capB: b.count,
      actA: aa.median, actB: ab.median, actA_n: aa.n, actB_n: ab.n,
      pickA, pickB,
      valveA: VALVE_KEY.has(ka), valveB: VALVE_KEY.has(kb),
      valvePair: VALVE_KEY.has(ka) || VALVE_KEY.has(kb),
      midAct: midA && midB, midPick: midPickA && midPickB, midColor: midColorA && midColorB,
      demandA: da.classify, demandB: db.classify,
      score: (midPickA && midPickB ? 20 : 0) + (midColorA && midColorB ? 10 : 0)
        + (a.id !== b.id ? 2 : 0)
        - Math.abs(((pickA == null ? 0.9 : pickA) + (pickB == null ? 0.9 : pickB)) / 2 - 0.4) * 10
    });
  }
}
// 逃生阀对的候选单独留档，不进排名（绑了阀 = 满格时唯一出路被锁，103 的 13 局死因）
const excludedValve = candidates.filter(c => c.valvePair);
const ranked = candidates.filter(c => !c.valvePair);
ranked.sort((x, y) => y.score - x.score);

const out = {
  tool: '扫描_v1', level: path.basename(LEVEL), seed: SEED, runs: RUNS,
  randomWinRate: runs.filter(x => x.won).length / runs.length,
  freeWon: free.won, freeProgress: r3(free.progress),
  activation, firstPick, colorDemand: colorDemandRows,
  openingValves: OPENING_VALVES,
  candidates: ranked.map(c => ({ ...c, actA: r3(c.actA), actB: r3(c.actB), score: r3(c.score) })),
  excludedValve: excludedValve.map(c => ({ a: c.a, b: c.b, colorA: c.colorA, colorB: c.colorB, pickA: c.pickA, pickB: c.pickB })),
  runDetails: allRuns.map(x => ({ won: x.won, steps: x.steps, progress: r3(x.progress) })),
  _pid: process.pid
};
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log('saved', OUT);
console.log(`random win ${out.randomWinRate}  free won=${free.won} prog=${out.freeProgress}`);
console.log(`开局逃生阀 ${out.openingValves.length} 个: ${out.openingValves.map(v => `(${v.r},${v.c})色${v.color}/${v.count}`).join(' ') || '无'}`);
if (out.excludedValve.length) {
  console.log(`已排除逃生阀对 ${out.excludedValve.length} 组（链绑阀 = 满格时唯一出路被锁，103 的 13 局死因）:`);
  for (const c of out.excludedValve) console.log(`  ${c.a}(${c.colorA}) + ${c.b}(${c.colorB})  pick=${c.pickA}/${c.pickB}`);
}
console.log('\n=== 候选（两车“首次被拿”中位都在 0.20–0.60；行 0 / 0–1）===');
const usable = out.candidates.filter(c => c.midPick && c.midColor);
if (!usable.length) console.log('  （无）');
for (const c of usable) {
  console.log(`  ${c.a}(${c.colorA}/${c.capA}) + ${c.b}(${c.colorB}/${c.capB})  act=${c.actA}/${c.actB} pick=${c.pickA}/${c.pickB}  color=${c.demandA}/${c.demandB}  score=${c.score}`);
}
console.log('\n=== 全候选（诊断）===');
for (const c of out.candidates) console.log(`  ${c.a}(${c.colorA}/${c.capA}) + ${c.b}(${c.colorB}/${c.capB})  act=${c.actA}/${c.actB} pick=${c.pickA}/${c.pickB}  color=${c.demandA}/${c.demandB}  midAct=${c.midAct} midPick=${c.midPick} midColor=${c.midColor}`);
console.log('\n=== 激活 / 首次被拿（只列行 0–1）===');
for (let r = 0; r <= 1; r++) for (let c = 0; c < COLS; c++) {
  const k = r + ',' + c, a = activation[k], cell = game.spools[r][c];
  if (!a || !isCar(cell)) continue;
  console.log(`  ${k} color=${cell.id} cap=${cell.count} type=${JSON.stringify(cell.type)} act=${a.median} pick=${firstPick[k] ? firstPick[k].median : null} (n=${a.n})`);
}
console.log('\n=== 激活表（只列行 0–1）===');
for (let r = 0; r <= 1; r++) for (let c = 0; c < COLS; c++) {
  const k = r + ',' + c, a = activation[k], cell = game.spools[r][c];
  if (!a || !isCar(cell)) continue;
  console.log(`  ${k} color=${cell.id} cap=${cell.count} type=${JSON.stringify(cell.type)} act=${a.median} pick=${firstPick[k] ? firstPick[k].median : null} (n=${a.n})`);
}
console.log('\n=== 逐色需求 ===');
for (const d of colorDemandRows) console.log(`  color=${d.color} total=${d.total} freeFirst=${d.freeFirst} freeLast=${d.freeLast} midShare=${d.midShare} ${d.classify}`);
