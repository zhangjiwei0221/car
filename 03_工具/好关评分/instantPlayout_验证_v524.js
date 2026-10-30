#!/usr/bin/env node
/**
 * 瞬时连锁「虚拟回放」验证工具（v524 第 1 步，只读，不改生产）
 *
 * 目的：实机规则 = 四方向可达 + 离该车暂存起点**曼哈顿距离最近**优先 + 该车占「从左侧数第一个空槽」。
 *      生成侧现在用的是静态圈序（AntSolver.eliminationOrder），需要换成能表达槽位占用的动态序。
 *      本工具先实现一版【虚拟回放】并量三件事，不改生产代码：
 *        ① 回放自身是否自洽（像素全覆盖、每色守恒、每车容量不越界、无死锁）
 *        ② 回放车序/像素块 与 现有四边圈序 差多少（这就是"不改"的损失基线）
 *        ③ 槽位时间线：第几车进第几槽、多少车在缓冲非空时进场（压力的直接来源）
 *
 * 用法（仓库根目录）：
 *   node 03_工具/好关评分/instantPlayout_验证_v524.js
 *   node 03_工具/好关评分/instantPlayout_验证_v524.js --images 006,010 --out 03_工具/好关评分/instantPlayout_v524
 *
 * 口径：
 *   - 起点 slot = 从左侧数第一个空槽（与 simulator.leftmostFreeSlot 一致）
 *   - 起点坐标 = { r: rows-1, c: floor(slot/bufferLimit*cols) }（slotStartCoord 同式）
 *   - 取色 = 从该起点出发可达像素最多的颜色（与 demandCurveOf 同启发）
 *   - 容量 = deriveCapacityBand 的带，夹在 [bandLo, bandHi]；同色余量不足 min 时并入本车（禁止拆区间）
 *   - 距离 = 曼哈顿；平手 = 最底、再最左（simulator.instantChainEliminate 同式）
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const BASE = path.join(ROOT, '02_工程', '游戏主bin');
const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js', 'playersim.js', 'analysis.js', 'generator.js'];
const sandbox = { console: { log() { }, warn() { }, error() { } }, module: { exports: {} }, WeakMap, Map, Set, setTimeout, clearTimeout, Infinity, Math, JSON, Date };
vm.createContext(sandbox);
for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BASE, 'bin/js', f), 'utf8'), sandbox, { filename: f });
const A = sandbox.AntSolver, G = A.Generator, S = A.Simulator;

const IMAGES = {
  '006': '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_006.txt',
  '010': '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_010.txt',
  '007': '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_007.txt'
};
const BUFFER = 5;

function parseArgs(argv) {
  const o = { images: Object.keys(IMAGES), out: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--images') o.images = argv[++i].split(',').map(s => s.trim()).filter(Boolean);
    else if (argv[i] === '--out') o.out = argv[++i];
  }
  return o;
}

/** 每色剩余像素（用于"余量并入本车"规则） */
function remainingByColor(elim, blocks, R, C) {
  const m = {};
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    const v = blocks[r][c];
    if (v > 0 && !elim[r][c]) m[v] = (m[v] || 0) + 1;
  }
  return m;
}

/**
 * 单车上限：按该色剩余量做均衡拆分，尽量不让任何一辆越过用户上限。
 *   Rc ≤ maxC       → 整车
 *   否则 n=ceil(Rc/maxC)，每车 ceil(Rc/n)（夹回 [minC,maxC]）
 * 拆不开（余量 < minC）交给审计记 belowMin，不偷偷造巨车。
 */
function planCap(Rc, minC, maxC) {
  if (!(Rc > 0)) return 1;
  if (Rc <= maxC) return Rc;
  const n = Math.ceil(Rc / maxC);
  let cap = Math.ceil(Rc / n);
  if (cap < minC) cap = minC;
  if (cap > maxC) cap = maxC;
  return cap;
}

/**
 * 虚拟回放：按实机规则走一遍，返回像素序/车表/槽位时间线。
 * 不依赖棋盘与求解器，纯目标图 + 容量带。
 */
function instantPlayout(blocks, cfg) {
  const R = blocks.length, C = blocks[0].length;
  const minC = Math.max(1, cfg.minCap | 0), maxC = Math.max(minC, cfg.maxCap | 0);
  const elim = A.create2D(R, C, false);
  const seq = A.create2D(R, C, 0);
  const slots = new Array(BUFFER).fill(null);   // 每槽：{id,color,need} 或 null
  const cars = [];
  const timeline = [];                          // 每车进场记录
  let done = 0, total = 0;
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) if (blocks[r][c] > 0) total++;

  function leftmostFree() { for (let k = 0; k < BUFFER; k++) if (!slots[k]) return k; return -1; }
  function startOf(slot) { return { r: R - 1, c: Math.min(C - 1, Math.floor(slot / BUFFER * C)) }; }

  /** 从某起点出发，某色当前可达像素数（scratch 试算，不落地） */
  function reachableCount(color, start) {
    const scratch = elim.map(row => row.slice());
    if (cfg.order === 'ring') return S.floodFillEliminate(scratch, blocks, R, C, color, Infinity, null, null, false);
    return S.instantChainEliminate(scratch, blocks, R, C, color, Infinity, null, start, null);
  }

  /** 推进一辆车：吃掉自己颜色里最近的 reachable，直到 need 用尽或无可达 */
  function advance(car) {
    if (!(car.need > 0)) return 0;
    const trace = [];
    const got = (cfg.order === 'ring')
      ? S.floodFillEliminate(elim, blocks, R, C, car.color, car.need, trace, null, false)
      : S.instantChainEliminate(elim, blocks, R, C, car.color, car.need, trace, car.start, null);
    if (car.seqFrom == null) car.seqFrom = done;
    for (const p of trace) seq[p[0]][p[1]] = ++done;
    car.seqTo = done;
    car.need -= got;
    if (car.need <= 0) car.finished = true;
    return got;
  }

  let guard = R * C * 4 + 100, deadlock = false;
  while (done < total && guard-- > 0) {
    let progress = 0;
    // ① 先推进已在缓冲里的车（先到先得；这里按槽位从左到右，等价于先进先出）
    for (let k = 0; k < BUFFER; k++) {
      const car = slots[k];
      if (!car || car.finished) continue;
      const got = advance(car);
      progress += got;
      if (car.finished) slots[k] = null;
    }
    if (progress > 0) continue;
    // ② 没有可推进的 → 新车上场（进最左空槽）
    const slot = (cfg.fixedSlot != null) ? cfg.fixedSlot : leftmostFree();
    if (slot < 0) { deadlock = true; break; }   // 缓冲满且全都推不动 = 真机会卡死
    const start = startOf(slot);
    const rem = remainingByColor(elim, blocks, R, C);
    let best = -1, bestN = 0;
    for (const k in rem) {
      const col = +k;
      const n = reachableCount(col, start);
      if (n > bestN) { bestN = n; best = col; }
    }
    if (best < 0 || bestN <= 0) { deadlock = true; break; }
    // 容量：默认 maxC；若余数 < minC 则整车带走（余数盒并入同色车，与 normalizeCapacities 同口径）。
    // 容量：按该色剩余量做均衡拆分（n = ceil(Rc/maxC)），避免"余数并入"造出 69px 的巨车。
    // 落点仍尽量在用户区间内；实在拆不开（余量 < minC）才记 belowMin，如实审计。
    const Rc = rem[best];
    let cap = planCap(Rc, minC, maxC);
    const car = { id: cars.length + 1, color: best, cap, need: cap, slot, start, finished: false, batch: 0 };
    if (cfg.fixedSlot == null) slots[slot] = car;   // 方案 A 不建模占用
    cars.push(car);
    timeline.push({ id: car.id, color: best, slot, cap, need: cap, bufferUsed: slots.filter(Boolean).length });
    advance(car);
    if (cfg.fixedSlot == null && car.finished) slots[car.slot] = null;
  }

  // 不变式自检
  const carsOut = cars.map(c => ({ id: c.id, color: c.color, cap: c.cap, need: c.need, slot: c.slot, start: c.start, finished: c.finished, seqFrom: c.seqFrom || 0, seqTo: c.seqTo || 0 }));
  const covered = done;
  const audit = {
    aboveMax: carsOut.filter(c => c.cap > maxC).length,
    belowMin: carsOut.filter(c => c.cap < minC).length,
    unfinished: carsOut.filter(c => !c.finished).length
  };
  return { seq, cars: carsOut, timeline, deadlock, covered, total, capacity: { minC, maxC }, audit };
}

/** 四边圈序基线（现行生成口径） */
function ringBaseline(blocks) {
  const R = blocks.length, C = blocks[0].length;
  const eo = A.eliminationOrder(blocks, R, C, false);
  return { seq: eo.seq, rounds: eo.rounds, colorOrder: (eo.roundColors || []).map(x => x.color) };
}

/** 比较两臂每车：颜色是否相同 + 像素集合 Jaccard（按车序对齐） */
function compareCars(x, y) {
  const n = Math.min(x.cars.length, y.cars.length);
  let same = 0, jsum = 0;
  for (let i = 0; i < n; i++) {
    const ca = x.cars[i], cb = y.cars[i];
    if (ca.color === cb.color) same++;
    // 用车 id 区间重算像素集合（seq 单调）
    const setA = carSet(x.seq, ca), setB = carSet(y.seq, cb);
    let inter = 0;
    for (const p of setA) if (setB.has(p)) inter++;
    jsum += inter / (setA.size + setB.size - inter);
  }
  return { sameColorPct: n ? +(same / n * 100).toFixed(1) : 0, jaccardAvg: n ? +(jsum / n).toFixed(3) : 0 };
}
/** 某车吃掉的像素坐标集合：seq ∈ (前车结束, 本车结束] */
function carSet(seq, car) {
  const set = new Set();
  const lo = car.seqFrom || 0, hi = car.seqTo || 0;
  if (!hi) return set;
  for (let r = 0; r < seq.length; r++) for (let c = 0; c < seq[0].length; c++) {
    const v = seq[r][c];
    if (v > lo && v <= hi) set.add(r * seq[0].length + c);
  }
  return set;
}

function lcsLen(a, b) {
  const n = a.length, m = b.length;
  let prev = new Array(m + 1).fill(0), cur = new Array(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    const t = prev; prev = cur; cur = t; cur.fill(0);
  }
  return prev[m];
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = { tool: 'instantPlayout_验证_v524', when: new Date().toISOString(), images: {} };
  for (const id of args.images) {
    const file = IMAGES[id];
    if (!file) { console.log(`跳过未知图 ${id}`); continue; }
    const blocks = G.blocksFromTXT(fs.readFileSync(path.join(ROOT, file), 'utf8'));
    const R = blocks.length, C = blocks[0].length;
    const band = G.deriveCapacityBand(blocks) || {};
    const cfg = { minCap: (band.band && band.band[0]) || 20, maxCap: (band.band && band.band[1]) || 60 };
    const t0 = Date.now();
    const pl = instantPlayout(blocks, cfg);
    const plA = instantPlayout(blocks, { minCap: cfg.minCap, maxCap: cfg.maxCap, fixedSlot: 0 });
    const plRing = instantPlayout(blocks, { minCap: cfg.minCap, maxCap: cfg.maxCap, fixedSlot: 0, order: 'ring' });
    const ms = Date.now() - t0;
    const ring = ringBaseline(blocks);

    // 自洽检查
    const remLeft = remainingByColor(pl.seq.map(row => row.map(v => v > 0)), blocks, R, C);
    const leftover = Object.values(remLeft).reduce((a, b) => a + b, 0);
    const colorSum = {};
    for (const c of pl.cars) colorSum[c.color] = (colorSum[c.color] || 0) + (c.cap - c.need);
    // 每色总像素必须等于该色各车实际吃的和
    const pxByColor = {};
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) if (blocks[r][c] > 0) pxByColor[blocks[r][c]] = (pxByColor[blocks[r][c]] || 0) + 1;
    const conserveBad = Object.keys(pxByColor).filter(k => (colorSum[k] || 0) !== pxByColor[k]);

    const slotsUsed = {};
    for (const c of pl.cars) slotsUsed[c.slot] = (slotsUsed[c.slot] || 0) + 1;
    const enteredWhileBusy = pl.timeline.filter(t => t.bufferUsed > 1).length;
    const sameColorLcs = lcsLen(pl.cars.map(c => c.color), ring.colorOrder);
    const carsAvgPx = pl.cars.length ? (pl.covered / pl.cars.length) : 0;

    report.images[id] = {
      size: `${R}x${C}`, band: [cfg.minCap, cfg.maxCap], ms,
      playout: { cars: pl.cars.length, covered: pl.covered, total: pl.total, deadlock: pl.deadlock, leftoverPx: leftover },
      invariants: { coveredAll: pl.covered === pl.total, conserveBad: conserveBad.length ? conserveBad : 0 },
      capacityAudit: pl.audit,
      slotHistogram: slotsUsed,
      enteredWhileBusy,
      capacity: {
        min: Math.min(...pl.cars.map(c => c.cap)), max: Math.max(...pl.cars.map(c => c.cap)),
        avgPx: +carsAvgPx.toFixed(1)
      },
      vsRing: { colorLcs: sameColorLcs, colorSeqLen: pl.cars.length },
      vsFixedSlot0: compareCars(pl, plA),
      vsRingOrder: compareCars(plA, plRing)
    };
    console.log(`${id} ${R}x${C} band=[${cfg.minCap},${cfg.maxCap}] 耗时${ms}ms`);
    console.log(`  回放：车=${pl.cars.length} 覆盖=${pl.covered}/${pl.total} 死锁=${pl.deadlock} 余留=${leftover}px 守恒异常色=${conserveBad.length ? conserveBad.join(',') : '0'}`);
    console.log(`  容量：min=${Math.min(...pl.cars.map(c => c.cap))} max=${Math.max(...pl.cars.map(c => c.cap))} 均=${carsAvgPx.toFixed(1)}px`);
    console.log(`  槽位分布：${JSON.stringify(slotsUsed)}　缓冲非空时进场=${enteredWhileBusy}/${pl.cars.length}`);
    console.log(`  与四边圈序的颜色序列 LCS=${sameColorLcs}/${pl.cars.length}`);
    const vA = report.images[id].vsFixedSlot0;
    console.log(`  A(固定0号槽) vs B″(真实占用)：同色车=${vA.sameColorPct}% 每车像素Jaccard均=${vA.jaccardAvg} 车数差=${plA.cars.length - pl.cars.length}`);
    const vR = report.images[id].vsRingOrder;
    console.log(`  A(瞬时连锁) vs 圈序(现行)：同色车=${vR.sameColorPct}% 每车像素Jaccard均=${vR.jaccardAvg} 圈序侧belowMin=${plRing.audit.belowMin} aboveMax=${plRing.audit.aboveMax}`);
  }
  if (args.out) {
    const p = args.out.endsWith('.json') ? args.out : args.out + '.json';
    fs.writeFileSync(path.resolve(ROOT, p), JSON.stringify(report, null, 2));
    console.log('已写出:', p);
  }
}

if (require.main === module) main();
module.exports = { instantPlayout };
