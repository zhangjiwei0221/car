#!/usr/bin/env node
/**
 * 关系量化：把「目标区需求」与「棋盘区供给」写成两张图，再用一条「债务曲线」量出压力。
 *
 *   node 关系量化.js <关卡.json|txt> [更多…] [--permute N] [--verbose]
 *
 * 目标侧  D 图：色块(同色连通块) → 依赖层；每个颜色「有多少像素、第几层才露脸、它压住了谁」
 * 棋盘侧  S 图：每辆车的「供给深度」= 至少要先拿几辆才轮到它露头（0-1 BFS：空=0，车=1）
 * 耦合    债务：取了一辆车、可它的颜色在目标区还不够量 → 差额挂在暂存里，等目标区追上
 *         债务曲线 = 贪心玩家每一步之后的暂存占用；峰值就是这一关的压力下限
 *
 * 只读：不写 输出文件/，不改任何生产代码。
 */
'use strict';
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const BIN = path.join(HERE, '..', '..', '02_工程', '完整主bin快照_20261012', 'bin');
const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js', 'analysis.js'];

let _seed = 20261019 >>> 0;
const seededMath = Object.create(Math);
seededMath.random = function () { _seed = (_seed * 1664525 + 1013904223) >>> 0; return _seed / 4294967296; };
const sandbox = {
  console: { log() {}, warn() {}, error() {} }, module: { exports: {} },
  WeakMap, Map, Set, setTimeout, clearTimeout, Infinity, Math: seededMath, JSON
};
vm.createContext(sandbox);
for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BIN, 'js', f), 'utf8'), sandbox, { filename: f });
const A = sandbox.AntSolver;
const Sim = A.Simulator;

const argv = process.argv.slice(2);
const files = [];
let permute = 0, verbose = false, sweep = 0, window = [], csvMode = false;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--permute') { permute = parseInt(argv[++i], 10) || 0; continue; }
  if (argv[i] === '--sweep') { sweep = parseInt(argv[++i], 10) || 0; continue; }
  if (argv[i] === '--window') { window = argv[++i].split(',').map(Number).filter(x => x > 1); continue; }
  if (argv[i] === '--verbose') { verbose = true; continue; }
  if (argv[i] === '--csv') { csvMode = true; continue; }
  files.push(argv[i]);
}

// ---------------- 读关卡 ----------------
function loadLevel(file) {
  const raw = fs.readFileSync(file, 'utf8');
  let g;
  if (file.endsWith('.txt')) {
    const rows = [];
    let started = false;
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (t === '像素矩阵') { started = true; continue; }
      if (!started || !t) continue;
      rows.push(t.split(/\s+/).map(Number));
    }
    return { blocks: rows, board: null, name: path.basename(file) };
  }
  g = JSON.parse(raw);
  const lv = A.fromGameFormat(g);
  return { blocks: lv.blocks, board: lv.board, name: path.basename(file) };
}

// ---------------- 目标侧：色块依赖层 ----------------
function targetGraph(blocks) {
  const R = blocks.length, C = blocks[0].length;
  const id = A.create2D(R, C, 0);
  const regions = [];   // {color, px, layer, cells:[[r,c]]}
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    if (blocks[r][c] <= 0 || id[r][c]) continue;
    const color = blocks[r][c], rid = regions.length + 1;
    const stack = [[r, c]]; id[r][c] = rid;
    const cells = [];
    while (stack.length) {
      const [x, y] = stack.pop(); cells.push([x, y]);
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= R || ny < 0 || ny >= C) continue;
        if (id[nx][ny] || blocks[nx][ny] !== color) continue;
        id[nx][ny] = rid; stack.push([nx, ny]);
      }
    }
    regions.push({ color, px: cells.length, cells, layer: 0 });
  }
  // 邻接 + 边界
  const nbr = regions.map(() => new Set());
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    if (!id[r][c]) continue;
    const a = id[r][c] - 1;
    if (regions[a].layer === 0 && (r === 0 || r === R - 1 || c === 0 || c === C - 1)) regions[a].layer = 1;
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const nr = r + dx, nc = c + dy;
      if (nr >= R || nc >= C || !id[nr][nc]) continue;
      const b = id[nr][nc] - 1;
      if (a !== b) { nbr[a].add(b); nbr[b].add(a); }
    }
  }
  // 层：BFS（边界层=1）。未触边的封闭腔也按"最小父层+1"兜底
  const queue = [];
  regions.forEach((g, i) => { if (g.layer === 1) queue.push(i); });
  for (let h = 0; h < queue.length; h++) {
    const i = queue[h];
    for (const j of nbr[i]) if (regions[j].layer === 0) { regions[j].layer = regions[i].layer + 1; queue.push(j); }
  }
  for (const g of regions) if (g.layer === 0) g.layer = 1;
  // 按颜色汇总
  const byColor = {};
  regions.forEach(g => {
    const o = byColor[g.color] || (byColor[g.color] = { color: g.color, px: 0, regions: 0, minLayer: 99, pxByLayer: {} });
    o.px += g.px; o.regions++;
    o.minLayer = Math.min(o.minLayer, g.layer);
    o.pxByLayer[g.layer] = (o.pxByLayer[g.layer] || 0) + g.px;
  });
  // 依赖边：A(浅) 压住 B(深)
  const cover = {};
  regions.forEach((g, i) => {
    if (g.layer <= 1) return;
    let parent = null;
    for (const j of nbr[i]) if (regions[j].layer === g.layer - 1) { parent = regions[j]; break; }
    if (!parent) return;
    (cover[parent.color] = cover[parent.color] || new Set()).add(g.color);
  });
  return { regions, byColor, cover, layers: Math.max(...regions.map(g => g.layer)) };
}

// ---------------- 目标侧：颜色出现日程（纯目标图，不考虑棋盘） ----------------
function targetSchedule(blocks) {
  const R = blocks.length, C = blocks[0].length;
  const elim = A.create2D(R, C, false);
  const s = Sim.createState({
    blocks, rows: R, cols: C, totalPixels: 0, totalBoxes: 0, bufferLimit: 5,
    board: { rows: 0, cols: 0, cells: [] }
  }, {});
  const total = blocks.reduce((a, row) => a + row.filter(v => v > 0).length, 0);
  const firstAt = {}, fullAt = {};
  let done = 0, guard = 0;
  while (done < total && guard++ < 200) {
    const pv = Sim.previewNextEliminationOrder(s);
    let best = -1, bestN = 0;
    for (const k in pv.byColor) {
      const n = pv.byColor[k].reachable;
      if (n > bestN) { bestN = n; best = +k; }
    }
    if (best < 0) break;
    if (firstAt[best] == null) firstAt[best] = done / total;
    const got = Sim.elimDispatch(s, best, Infinity);
    done += got;
    if (pv.byColor[best].remaining <= got) fullAt[best] = done / total;
  }
  return { firstAt, fullAt, total };
}

// ---------------- 对齐度：棋盘暴露序 vs 目标需求序 ----------------
function alignment(cars, tg, tsched) {
  const n = cars.length;
  if (!n) return null;
  const xs = [], ys = [];
  for (const c of cars) {
    const f = tsched.firstAt[c.color];
    if (f == null) continue;
    xs.push(c.supply / Math.max(1, n - 1));
    ys.push(f);
  }
  const m = xs.length;
  if (m < 3) return null;
  const rank = (arr) => {
    const idx = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const r = new Array(arr.length);
    idx.forEach(([, i], k) => r[i] = k);
    return r;
  };
  const rx = rank(xs), ry = rank(ys);
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const mx = mean(rx), my = mean(ry);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < m; i++) { num += (rx[i] - mx) * (ry[i] - my); dx += (rx[i] - mx) ** 2; dy += (ry[i] - my) ** 2; }
  return { rho: num / Math.sqrt(dx * dy || 1), n: m };
}

// ---------------- 棋盘侧：供给深度 ----------------
function boardSupply(level) {
  const B = level.board;
  if (!B || !B.rows) return null;
  const R = B.rows, C = B.cols;
  const isBox = (r, c) => { const x = B.cells[r][c]; return !!(x && x.t === 'box'); };
  const passable = (r, c) => { const x = B.cells[r][c]; return !!(x && x.t === 'box') || x == null; };
  const dist = A.create2D(R, C, -1);
  // 0-1 BFS
  const dq = [];
  for (let c = 0; c < C; c++) {
    if (!passable(0, c)) continue;
    dist[0][c] = isBox(0, c) ? 1 : 0;
    dq.push([0, c]);
  }
  let head = 0;
  const pushFront = (x) => { dq.splice(head, 0, x); };
  while (head < dq.length) {
    const [r, c] = dq[head++];
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nr = r + dx, nc = c + dy;
      if (nr < 0 || nr >= R || nc < 0 || nc >= C) continue;
      if (!passable(nr, nc)) continue;
      const w = isBox(nr, nc) ? 1 : 0;
      if (dist[nr][nc] < 0 || dist[nr][nc] > dist[r][c] + w) {
        dist[nr][nc] = dist[r][c] + w;
        if (w === 0) pushFront([nr, nc]); else dq.push([nr, nc]);
      }
    }
  }
  // 每辆车的供给深度 = 其四邻的最小可达代价（第 0 行直接 0）
  const cars = [];
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    if (!isBox(r, c)) continue;
    let d = r === 0 ? 0 : 99;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nr = r + dx, nc = c + dy;
      if (nr < 0 || nr >= R || nc < 0 || nc >= C) continue;
      if (dist[nr][nc] >= 0) d = Math.min(d, dist[nr][nc]);
    }
    cars.push({ r, c, color: B.cells[r][c].color, count: B.cells[r][c].count, supply: d, unlocks: 0 });
  }
  // 扇出：拿掉这一辆，会让几辆车「从不可点变成可点」
  const exposedSet = () => {
    const R2 = A.create2D(R, C, false), q = [];
    for (let c = 0; c < C; c++) if (B.cells[0][c] == null) { R2[0][c] = true; q.push([0, c]); }
    for (let h = 0; h < q.length; h++) {
      const [r, c] = q[h];
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nr = r + dx, nc = c + dy;
        if (nr < 0 || nr >= R || nc < 0 || nc >= C || R2[nr][nc]) continue;
        if (B.cells[nr][nc] == null) { R2[nr][nc] = true; q.push([nr, nc]); }
      }
    }
    const ex = {};
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
      if (!isBox(r, c)) continue;
      if (r === 0) { ex[r + ',' + c] = 1; continue; }
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nr = r + dx, nc = c + dy;
        if (nr >= 0 && nr < R && nc >= 0 && nc < C && R2[nr][nc]) { ex[r + ',' + c] = 1; break; }
      }
    }
    return ex;
  };
  const baseEx = exposedSet();
  for (const car of cars) {
    const saved = B.cells[car.r][car.c];
    B.cells[car.r][car.c] = null;
    const ex = exposedSet();
    B.cells[car.r][car.c] = saved;
    let n = 0;
    for (const k in ex) if (!baseEx[k]) n++;
    car.unlocks = n;
  }
  cars.sort((a, b) => a.supply - b.supply);
  return { cars, rows: R, cols: C };
}

// ---------------- 耦合：贪心玩家 + 债务曲线 ----------------
function playGreedy(level, opts) {
  opts = opts || {};
  const s = Sim.createState(level, { bottomOnly: !!opts.bottomOnly });
  const trace = [];
  let guard = 0;
  while (guard++ < 200 && !s.gameOver && !s.gameWon) {
    const moves = Sim.listMoves(s).filter(m => !m.blocked);
    if (!moves.length) break;
    // 目标区各色当前可达量
    const pv = Sim.previewNextEliminationOrder(s);
    const avail = {};
    for (const k in pv.byColor) avail[+k] = pv.byColor[k].reachable;
    const scored = moves.map(m => {
      const cc = m.antBox.color, q = m.antBox.count;
      const a = avail[cc] || 0;
      return { m, color: cc, count: q, avail: a, fill: m.canConsume, gap: Math.max(0, q - a), fanout: 0 };
    });
    // 选择：①能一次吃满 ②吃满的车里挑暴露新格最多的 ③否则挑缺口最小的
    let pick;
    const fillable = scored.filter(x => x.fill);
    if (fillable.length) {
      pick = fillable.sort((a, b) => (b.count - a.count) || (b.avail - a.avail))[0];
    } else {
      pick = scored.sort((a, b) => (a.gap - b.gap) || (b.avail - a.avail))[0];
    }
    const before = s.buffer.length;
    const ok = Sim.applyPick(s, pick.m.r, pick.m.c);
    if (!ok) break;
    trace.push({
      step: s.steps, color: pick.color, count: pick.count, avail: pick.avail,
      fill: pick.fill, gap: pick.gap, bufBefore: before, bufAfter: s.buffer.length,
      pickable: moves.length, fillable: fillable.length
    });
  }
  const buf = trace.map(t => t.bufAfter);
  const peak = Math.max(0, ...buf);
  const peakAt = peak > 0 ? trace[buf.indexOf(peak)].step : 0;
  const avgPick = trace.length ? trace.reduce((a, t) => a + t.pickable, 0) / trace.length : 0;
  const avgFill = trace.length ? trace.reduce((a, t) => a + t.fillable, 0) / trace.length : 0;
  const stepsWithLe1 = trace.filter(t => t.fillable <= 1).length;
  // 50% 之后峰值（与审核同口径的近似）
  const half = Math.floor(trace.length * 0.3);
  const late = buf.slice(half);
  return {
    trace, peak, peakAt, steps: trace.length, avgPick, avgFill,
    le1Ratio: trace.length ? stepsWithLe1 / trace.length : 0,
    latePeak: late.length ? Math.max(...late) : 0,
    won: !!s.gameWon, over: !!s.gameOver,
    completed: s.completedBoxes, total: s.totalBoxes
  };
}

// ---------------- 摆位实验：同一副车、不同放法 ----------------
function shuffleCars(level, rng) {
  const B = level.board;
  const slots = [], cars = [];
  for (let r = 0; r < B.rows; r++) for (let c = 0; c < B.cols; c++) {
    const x = B.cells[r][c];
    if (x && x.t === 'box') slots.push([r, c]);
  }
  for (const [r, c] of slots) cars.push({ color: B.cells[r][c].color, count: B.cells[r][c].count });
  for (let i = cars.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = cars[i]; cars[i] = cars[j]; cars[j] = t; }
  const cells = B.cells.map(row => row.map(x => x ? Object.assign({}, x) : x));
  slots.forEach(([r, c], i) => { cells[r][c] = Object.assign({}, cells[r][c], { color: cars[i].color, count: cars[i].count }); });
  return { blocks: level.blocks, rows: level.rows, cols: level.cols, totalPixels: level.totalPixels, totalBoxes: level.totalBoxes, bufferLimit: level.bufferLimit, board: { rows: B.rows, cols: B.cols, cells } };
}

// ---------------- 摆位：复刻生产的「暴露距离」填法 ----------------
function placeOrder(level) {
  const B = level.board, R = B.rows, C = B.cols;
  const pass = A.create2D(R, C, false), dist = A.create2D(R, C, -1);
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    const x = B.cells[r][c];
    pass[r][c] = (x == null || x.t === 'pipe');
  }
  const q = [];
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    if (!pass[r][c]) continue;
    if (r === 0 || r === R - 1 || c === 0 || c === C - 1) { dist[r][c] = 0; q.push([r, c]); }
  }
  for (let h = 0; h < q.length; h++) {
    const [r, c] = q[h];
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nr = r + dx, nc = c + dy;
      if (nr < 0 || nr >= R || nc < 0 || nc >= C || !pass[nr][nc] || dist[nr][nc] >= 0) continue;
      dist[nr][nc] = dist[r][c] + 1; q.push([nr, nc]);
    }
  }
  const order = [];
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    if (B.cells[r][c] != null) continue;
    order.push([r, c, dist[r][c] < 0 ? 999 : dist[r][c]]);
  }
  order.sort((a, b) => a[2] - b[2] || a[0] - b[0] || a[1] - b[1]);
  return order;
}

// 在「暴露序」上按窗口 W 局部打乱（W 越大越乱；W=2 只换相邻）
function windowShuffle(level, W, rng) {
  const B = level.board;
  const order = placeOrder(level);
  const cars = order.map(([r, c]) => ({ color: B.cells[r][c].color, count: B.cells[r][c].count }));
  for (let i = 0; i < cars.length; i += W) {
    const seg = cars.slice(i, i + W);
    for (let j = seg.length - 1; j > 0; j--) { const k = Math.floor(rng() * (j + 1)); const t = seg[j]; seg[j] = seg[k]; seg[k] = t; }
    for (let j = 0; j < seg.length; j++) cars[i + j] = seg[j];
  }
  const out = B.cells.map(row => row.map(x => x ? Object.assign({}, x) : x));
  order.forEach(([r, c], k) => { out[r][c] = Object.assign({}, out[r][c], { color: cars[k].color, count: cars[k].count }); });
  return { blocks: level.blocks, rows: level.rows, cols: level.cols, totalPixels: level.totalPixels, totalBoxes: level.totalBoxes, bufferLimit: level.bufferLimit, board: { rows: B.rows, cols: B.cols, cells: out } };
}

// 把当前车序整体平移 lag 位（环形），其余（黑块/管道/空位）不动
function lagPlace(level, lag) {
  const B = level.board;
  const order = placeOrder(level);
  const cells = [];
  for (const [r, c] of order) cells.push({ color: B.cells[r][c].color, count: B.cells[r][c].count });
  const n = cells.length;
  const shift = ((lag % n) + n) % n;
  const out = B.cells.map(row => row.map(x => x ? Object.assign({}, x) : x));
  order.forEach(([r, c], k) => {
    const src = cells[(k + shift) % n];
    out[r][c] = Object.assign({}, out[r][c], { color: src.color, count: src.count });
  });
  return { blocks: level.blocks, rows: level.rows, cols: level.cols, totalPixels: level.totalPixels, totalBoxes: level.totalBoxes, bufferLimit: level.bufferLimit, board: { rows: B.rows, cols: B.cols, cells: out } };
}

// ---------------- 主流程 ----------------
for (const file of files) {
  const L = loadLevel(file);
  const level = A.parseLevel({ blocks: L.blocks, board: L.board, bufferLimit: 5 });
  const tg = targetGraph(L.blocks);
  const sup = boardSupply(level);

  if (csvMode) {
    const gg = playGreedy(level);
    let late = '', choke = '', pk = '';
    try {
      const sr = A.Solver.solve(level, { greedyOnly: true });
      const au = A.Analysis.chokepointAudit(sr.pressureSamples || [], sr.totalBoxes, 5);
      late = au.lateMax.toFixed(1); choke = au.hasChoke ? 1 : 0; pk = sr.maxBuffer;
    } catch (e) { late = 'ERR'; }
    console.log([L.name, level.board && level.board.rows ? level.board.rows + 'x' + level.board.cols : '-',
      level.totalPixels, level.totalBoxes, gg.avgPick.toFixed(2), gg.avgFill.toFixed(2),
      (gg.le1Ratio * 100).toFixed(0), pk, late, choke].join(','));
    continue;
  }

  console.log('\n' + '='.repeat(78));
  console.log('关卡：' + L.name + (level.board && level.board.rows ? '   棋盘 ' + level.board.rows + '×' + level.board.cols : '   仅目标图'));
  console.log('目标：' + level.rows + '×' + level.cols + '，' + level.totalPixels + ' 像素，' + Object.keys(tg.byColor).length + ' 色，依赖层 ' + tg.layers);

  // 颜色表
  const colors = Object.values(tg.byColor).sort((a, b) => a.minLayer - b.minLayer || a.color - b.color);
  console.log('\n[目标侧] 颜色 → 像素 / 色块数 / 最浅层 / 各层像素');
  for (const o of colors) {
    const covered = [...(tg.cover[o.color] || [])];
    console.log('  ' + String(o.color).padStart(3) + '  px=' + String(o.px).padStart(4) +
      '  块=' + String(o.regions).padStart(2) + '  最浅层=' + String(o.minLayer).padStart(2) +
      '  分层=' + JSON.stringify(o.pxByLayer) + (covered.length ? '  压住→' + covered.join(',') : ''));
  }

  if (sup) {
    console.log('\n[棋盘侧] 供给深度（= 至少先拿几辆才轮到它）');
    const hist = {};
    for (const c of sup.cars) hist[c.supply] = (hist[c.supply] || 0) + 1;
    console.log('  ' + sup.cars.length + ' 辆；深度分布 ' + JSON.stringify(hist));
    const tsched = targetSchedule(L.blocks);
    const al = alignment(sup.cars, tg, tsched);
    const firstPct = {};
    for (const k in tsched.firstAt) firstPct[k] = (tsched.firstAt[k] * 100).toFixed(0) + '%';
    console.log('  目标出现日程（该色第一次可吃的进度）：' + JSON.stringify(firstPct));
    if (al) console.log('  对齐度 ρ = ' + al.rho.toFixed(2) + '（棋盘暴露序 vs 目标出现序，1=完全同步 / 0=无关）');
    // 匹配表
    console.log('\n[耦合] 车 → 颜色层 vs 供给深度（负=车来得早，要背债）');
    let debtSum = 0, worse = 0;
    const rows = sup.cars.slice(0, verbose ? 999 : 12).map(c => {
      const t = tg.byColor[c.color] || { minLayer: 99 };
      const gap = c.supply - t.minLayer;
      debtSum += Math.max(0, gap); if (gap > 0) worse++;
      return '  ' + ('(' + c.r + ',' + c.c + ')').padEnd(8) + ' 色' + String(c.color).padStart(3) +
        ' 容量' + String(c.count).padStart(3) + ' 供给深度' + String(c.supply).padStart(2) +
        ' 目标层' + String(t.minLayer).padStart(2) + ' 差' + (gap >= 0 ? '+' : '') + gap;
    });
    console.log(rows.join('\n'));
    console.log('  平均背债深度 ' + (debtSum / sup.cars.length).toFixed(2) + '；' + worse + '/' + sup.cars.length + ' 辆的车比它的颜色先到');
  }

  const g = playGreedy(level);
  console.log('\n[压力] 稳健玩家近似（能装满就装满，装不满挑缺口最小）');
  console.log('  步数 ' + g.steps + '；完成 ' + g.completed + '/' + g.total + '；通关=' + g.won +
    '；峰值暂存 ' + g.peak + '（第 ' + g.peakAt + ' 步）；后期峰 ' + g.latePeak);
  console.log('  每步可点 ' + g.avgPick.toFixed(1) + ' 辆 · 能一次吃满 ' + g.avgFill.toFixed(2) + ' 辆 · 吃满≤1 的步 ' +
    (g.le1Ratio * 100).toFixed(0) + '%');
  console.log('  债务曲线 ' + g.trace.map(t => t.bufAfter).join(' '));

  // 全知最优路线的债务曲线（压力下限）
  let baseLate = null;
  try {
    const sr = A.Solver.solve(level, { greedyOnly: true });
    const au = A.Analysis.chokepointAudit(sr.pressureSamples || [], sr.totalBoxes, 5);
    baseLate = au.lateMax;
    console.log('\n[压力·全知] 通关=' + sr.completed + '；峰值暂存 ' + sr.maxBuffer + '；平均 ' + sr.avgBuffer +
      '；步数 ' + sr.steps);
    console.log('  债务曲线 ' + (sr.stepBufferHistory || []).join(' '));
    console.log('  审核口径：前期峰 ' + au.earlyMax + ' · 卡点区峰窗 ' + au.lateMax + '@' + au.lateAt +
      '%（卡点线 ' + au.high + '）· 有卡点=' + au.hasChoke);
  } catch (e) {
    console.log('\n[压力·全知] 求解失败：' + e.message);
  }

  if (sweep > 0 && sup) {
    console.log('\n[平移扫描] 车序整体平移 L 位（0=原摆位）→ 峰窗 / 是否可解');
    const out = [];
    for (let L = 0; L <= sweep; L++) {
      try {
        const sr = A.Solver.solve(lagPlace(level, L), { greedyOnly: true });
        const au = A.Analysis.chokepointAudit(sr.pressureSamples || [], sr.totalBoxes, 5);
        out.push({ L, late: au.lateMax, peak: sr.maxBuffer, ok: sr.completed });
        console.log('  L=' + String(L).padStart(2) + '  峰窗 ' + au.lateMax.toFixed(1) +
          '  峰值暂存 ' + sr.maxBuffer + '  可解=' + sr.completed);
      } catch (e) {
        console.log('  L=' + String(L).padStart(2) + '  求解异常：' + e.message);
      }
    }
  }

  if (window.length && sup) {
    console.log('\n[局部打乱] 在暴露序上按窗口 W 打乱 → 峰窗 / 可解率（每档 6 次）');
    for (const W of window) {
      let ok = 0, lates = [];
      for (let i = 0; i < 6; i++) {
        try {
          const sr = A.Solver.solve(windowShuffle(level, W, seededMath.random), { greedyOnly: true });
          if (!sr.completed) continue;
          ok++;
          lates.push(A.Analysis.chokepointAudit(sr.pressureSamples || [], sr.totalBoxes, 5).lateMax);
        } catch (e) { /* skip */ }
      }
      lates.sort((a, b) => a - b);
      console.log('  W=' + W + '  可解 ' + ok + '/6' + (lates.length ? '  峰窗 ' + lates[0] + '~' + lates[lates.length - 1] +
        '（中位 ' + lates[Math.floor(lates.length / 2)] + '）' : ''));
    }
  }

  if (permute > 0 && sup) {
    const rows = [];
    let unsolved = 0;
    for (let i = 0; i < permute; i++) {
      const shuffled = shuffleCars(level, seededMath.random);
      try {
        const sr = A.Solver.solve(shuffled, { greedyOnly: true });
        if (!sr.completed) { unsolved++; continue; }
        const au = A.Analysis.chokepointAudit(sr.pressureSamples || [], sr.totalBoxes, 5);
        rows.push({ peak: sr.maxBuffer, late: au.lateMax });
      } catch (e) { unsolved++; }
    }
    if (!rows.length) { console.log('\n[摆位实验] 所有重摆都解不出来（说明这一关极度依赖摆位）'); continue; }
    const late = rows.map(r => r.late).sort((a, b) => a - b);
    const peak = rows.map(r => r.peak).sort((a, b) => a - b);
    const hist = {};
    rows.forEach(r => { const k = r.late.toFixed(1); hist[k] = (hist[k] || 0) + 1; });
    console.log('\n[摆位实验] 同一副车随机重摆 ' + permute + ' 次（其余全不变），可解 ' + rows.length + '/' + permute);
    console.log('  卡点区峰窗分布 ' + JSON.stringify(hist));
    console.log('  峰窗 最低 ' + late[0] + ' / 中位 ' + late[Math.floor(late.length / 2)] + ' / 最高 ' + late[late.length - 1] +
      (baseLate != null ? '（原摆位 ' + baseLate + '）' : ''));
    console.log('  暂存峰值 最低 ' + peak[0] + ' / 中位 ' + peak[Math.floor(peak.length / 2)] + ' / 最高 ' + peak[peak.length - 1]);
  }
}
