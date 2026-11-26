#!/usr/bin/env node
'use strict';
/**
 * M5Build_v1 —— 按“角色”生成 7×7 候选（M5 原型）
 *
 * 不复制某张旧关的具体格子；只复用角色语法：
 *   - 边框色 → opening / 冰门（总 opening 车数控制为 5）
 *   - 内部大色 → 债车（容量按该色总量拆）
 *   - 后排内部车 → 2 连链组
 *   - 中心 → 管道，队列放 3 辆小色
 *
 * 用法：
 *   node M5Build_v1.js <目标图.txt> --out <配方.json> --seed N [--toprow 40]
 *
 * 输出配方；再用 BuildFromRecipe_v1.js 生成关卡，并跑 ArlCheck/PlayerEngine/点击结算/排版。
 */
const fs = require('fs');
const path = require('path');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const target = process.argv[2];
const out = arg('--out', '');
const seed = Number(arg('--seed', 1)) || 1;
const INNER_TARGET = Number(arg('--inner-target', 45)) || 45;
const BORDER_TARGET = Number(arg('--border-target', 70)) || 70;
if (!target || !out) { console.error('用法: node M5Build_v1.js <目标图.txt> --out <配方.json> --seed N'); process.exit(2); }

function rngFactory(s) { let x = (s >>> 0) || 1; return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; }; }
const rand = rngFactory(seed);
const shuffle = a => { const x = a.slice(); for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; };
const sum = a => a.reduce((x, y) => x + y, 0);

function parseImage(file) {
  const lines = fs.readFileSync(file, 'utf8').replace(/\r/g, '').trim().split('\n');
  const rows = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t || /[^\d\s]/.test(t)) continue;
    rows.push(t.split(/\s+/).map(Number));
  }
  if (!rows.length) throw new Error('目标图没有数字');
  const H = rows.length, W = rows[0].length;
  const px = {}, border = {}, interior = {};
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const v = rows[r][c]; if (v > 0) px[v] = (px[v] || 0) + 1;
  }
  for (let c = 0; c < W; c++) { const a = rows[0][c], b = rows[H - 1][c]; if (a > 0) border[a] = (border[a] || 0) + 1; if (b > 0) border[b] = (border[b] || 0) + 1; }
  for (let r = 0; r < H; r++) { const a = rows[r][0], b = rows[r][W - 1]; if (a > 0) border[a] = (border[a] || 0) + 1; if (b > 0) border[b] = (border[b] || 0) + 1; }
  for (const k of Object.keys(px)) if (!border[k]) interior[k] = px[k];
  return { rows, H, W, px, borderColors: Object.keys(border).map(Number), interiorColors: Object.keys(interior).map(Number) };
}

function partition(total, n, lo, hi) {
  // 把 total 均分成 n 份，限制 [lo,hi]；不满足时返回 null。
  if (n <= 0) return null;
  if (n * lo > total || n * hi < total) return null;
  const a = new Array(n).fill(Math.floor(total / n));
  let diff = total - sum(a);
  for (let i = 0; diff !== 0 && i < n * 4; i++) {
    const idx = i % n;
    if (diff > 0 && a[idx] < hi) { a[idx]++; diff--; }
    else if (diff < 0 && a[idx] > lo) { a[idx]--; diff++; }
  }
  if (diff !== 0) { for (let i = 0; i < n && diff > 0; i++) if (a[i] < hi) { const add = Math.min(hi - a[i], diff); a[i] += add; diff -= add; } }
  if (diff !== 0) { for (let i = n - 1; i >= 0 && diff < 0; i--) if (a[i] > lo) { const sub = Math.min(a[i] - lo, -diff); a[i] -= sub; diff += sub; } }
  return diff === 0 ? shuffle(a) : null;
}

function main() {
  const im = parseImage(target);
  const colors = Object.keys(im.px).map(Number).sort((a, b) => im.px[b] - im.px[a]);
  const borderSet = new Set(im.borderColors);
  // 车数：边框色按 ~70px/车，内部色按 ~30px/车；再调整到 51 辆（48 spool + 3 queue）
  const plans = [];
  for (const c of colors) {
    const total = im.px[c];
    let n = borderSet.has(c) ? Math.max(1, Math.round(total / BORDER_TARGET)) : Math.max(1, Math.round(total / INNER_TARGET));
    n = Math.min(n, 14);
    plans.push({ color: c, total, n, border: borderSet.has(c) });
  }
  const targetCars = 51;
  let carsN = sum(plans.map(p => p.n));
  // 调整车数：优先增加内部大色的拆分
  while (carsN < targetCars) {
    const p = plans.filter(x => !x.border).sort((a, b) => b.total / b.n - a.total / a.n)[0] || plans[0];
    p.n++; carsN++;
  }
  while (carsN > targetCars) {
    const p = plans.slice().sort((a, b) => b.n - a.n).find(x => x.n > 1);
    if (!p) break;
    p.n--; carsN--;
  }
  // 边框色：若 >5 辆，用冰把多余车挡掉；若 <5，拆到 5
  let borderPlans = plans.filter(p => p.border);
  let borderN = sum(borderPlans.map(p => p.n));
  while (borderN < 5) {
    const p = borderPlans.slice().sort((a, b) => b.total / b.n - a.total / a.n)[0];
    p.n++; borderN++;
  }
  // 重新凑 51
  carsN = sum(plans.map(p => p.n));
  while (carsN < targetCars) { const p = plans.filter(x => !x.border).sort((a, b) => b.total / b.n - a.total / a.n)[0] || plans[0]; p.n++; carsN++; }

  // 每色容量
  for (const p of plans) {
    const lo = 8, hi = p.border ? 90 : 80;
    p.caps = partition(p.total, p.n, lo, hi);
    if (!p.caps) throw new Error('色 ' + p.color + ' 无法拆成 ' + p.n + ' 辆（总量 ' + p.total + '）');
    // 边框大色至少造一辆 > 初始可达(76) 的债车；看起来能拿、实际差几像素。
    if (p.border && p.caps.length >= 2 && p.total >= 120) {
      const big = Math.min(86, p.total - 8 * (p.caps.length - 1));
      const rest = partition(p.total - big, p.caps.length - 1, 8, hi);
      if (big >= 80 && rest) p.caps = [big].concat(rest);
    }
  }

  // 选 3 辆做管道队列：优先最小的内部色
  const queuePlans = plans.filter(p => !p.border).sort((a, b) => a.total - b.total).slice(0, 3);
  const queue = [];
  for (const p of queuePlans) {
    const n = Math.min(1, p.caps.length);
    for (let i = 0; i < n; i++) queue.push({ id: p.color, count: p.caps.pop() });
    p.n -= n;
  }
  // 队列优先用最小的 3 色；如果某色仍多车，保留 spool

  // 重新汇总 spool 车辆
  const spoolCars = [];
  for (const p of plans) for (const cap of (p.caps || [])) spoolCars.push({ id: p.color, count: cap, border: p.border });
  if (spoolCars.length !== 48) throw new Error('spool 车数不是48：' + spoolCars.length + '（queue ' + queue.length + '）');

  // 角色格：49 格，pipe 中心；opening 5 辆边框车；其余边框车冰；内部车填满
  const br = spoolCars.filter(x => x.border);
  const inner = shuffle(spoolCars.filter(x => !x.border));
  if (br.length < 5) throw new Error('边框车不足5：' + br.length);
  const opening = br.slice(0, 5);
  const gated = br.slice(5);
  const cells = [];
  for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) cells.push([r, c]);
  const pipeCell = [3, 3];
  const used = new Set([pipeCell.join(',')]);
  const seat = [];
  // 顶行放 opening；第二行放 gated；其余放内部
  let oi = 0, gi = 0, ii = 0;
  const byRow = [[], [], [], [], [], [], []];
  for (const [r, c] of cells) {
    if (r === 3 && c === 3) continue;
    if (r === 0 && oi < opening.length) byRow[r].push({ r, c, car: opening[oi++] });
    else if ((r === 1 || r === 0) && gi < gated.length) byRow[r].push({ r, c, car: gated[gi++] });
    else if (ii < inner.length) byRow[r].push({ r, c, car: inner[ii++] });
  }
  // 如果还有没放的，按行补
  for (let r = 0; r < 7; r++) for (const x of byRow[r]) seat.push(x);

  // 构造 spools
  const grid = Array.from({ length: 7 }, () => Array(7).fill(null));
  for (const x of seat) {
    grid[x.r][x.c] = { id: x.car.id, type: 0, param: 0, count: x.car.count };
  }
  grid[3][3] = { id: 0, type: 11, param: queue, count: 0 };
  // 冰：所有 gated 边框车 + 1 辆内部大车（若 gated<4 也可）
  const obs = [];
  for (const x of seat) if (x.car.border && opening.indexOf(x.car) < 0) obs.push({ r: x.r, c: x.c, type: 7, param: 6 + (x.r % 3) * 2 });
  // 找一辆内部最大车做第二冰门
  const big = seat.filter(x => !x.car.border).sort((a, b) => b.car.count - a.car.count)[0];
  if (big) obs.push({ r: big.r, c: big.c, type: 7, param: 10 });

  // 链组：中段 + 后排各找一组相邻内部车（2连）
  function pickPair(minR, maxR, param) {
    const pool = seat.filter(x => !x.car.border && x.r >= minR && x.r <= maxR);
    const pairs = [];
    for (let i = 0; i < pool.length; i++) for (let j = i + 1; j < pool.length; j++) {
      if (Math.abs(pool[i].r - pool[j].r) + Math.abs(pool[i].c - pool[j].c) !== 1) continue;
      pairs.push([pool[i], pool[j]]);
    }
    if (!pairs.length) return;
    const [a, b] = pairs[Math.floor(rand() * pairs.length)];
    obs.push({ r: a.r, c: a.c, type: 5, param }, { r: b.r, c: b.c, type: 5, param });
  }
  pickPair(2, 4, 2);
  pickPair(5, 6, 3);

  const spools = grid.map(row => row.map(x => x || { id: -1, type: 0, param: 0, count: 0 }));
  const recipe = {
    name: 'M5Build_' + path.basename(target).replace(/\.txt$/, '') + '_s' + seed,
    target, toprow: im.H, maprow: 7, mapcol: 7,
    cars: [], black: [], obstacles: obs,
    pipes: [{ r: 3, c: 3, type: 11, param: queue }],
    notes: { seed, grammar: ['opening 5', 'gated border cars', 'rear 2-chain', 'pipe queue'], plans: plans.map(p => ({ color: p.color, n: p.n, total: p.total })) }
  };
  for (const row of spools) for (const x of row) if (x.id > 0) recipe.cars.push({ r: 0, c: 0, id: x.id, count: x.count });
  // 用 grid 重建 cars 的 r/c
  recipe.cars = [];
  for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) {
    const x = spools[r][c]; if (x.id > 0) recipe.cars.push({ r, c, id: x.id, count: x.count });
  }
  fs.writeFileSync(out, JSON.stringify(recipe, null, 1));
  console.log('wrote', out, 'cars', recipe.cars.length, 'queue', queue.length, 'obstacles', obs.length);
}
try { main(); } catch (e) { console.error('失败：' + e.message); process.exit(1); }
