#!/usr/bin/env node
'use strict';
/**
 * RouteFirstB_v1 —— Mode B 独立生成：只用目标图，不用骨架/主体/门位
 *
 * 流程：
 *   1) 目标图开图曲线（每色每步可达量）；
 *   2) 车数按“功能/体量”定：n_c = round(px_c / avg)，且每辆不低于 floor
 *      （背景/大色自然得到少而大的车，不再按像素份额摊出 1–2px 碎车）；
 *   3) 棋盘按总车数生成（≤8×8，多余格做黑块），非黑格按行优先作为暴露顺序；
 *   4) 车序：颜色按首次触达、轮次交错；摆进暴露格；
 *   5) 容量：同色均分 + 下限 floor；早期格若装不下均分量，超出部分挪到同色最后
 *      （形成一笔可还的债，但绝不低于 floor）；
 *   6) 修复环：按玩家/噪声路线把“容量 > 拿时可达”的车压到 max(floor, 可达)；
 *   7) 输出关卡 + ModeBCheck 指标。
 *
 * 用法：node RouteFirstB_v1.js <目标图.txt> --out <关卡.json>
 *   [--avg 50] [--floor 10] [--layout 骨架.json] [--rows R --cols C] [--maxrow 8] [--maxcol 8] [--maxcar 140] [--iters 6]
 */
const B = require('./Build006Thickness_v688');
const A = B.loadSolver('corner');
const fs = require('fs');

function arg(k, d) { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; }
function parse(file) {
  const lines = fs.readFileSync(file, 'utf8').replace(/\r/g, '').trim().split('\n');
  const rows = [];
  for (const line of lines) { const t = line.trim(); if (!t || /[^\d\s]/.test(t)) continue; rows.push(t.split(/\s+/).map(Number)); }
  return rows;
}
function targetCurve(blocks, maxSteps) {
  const H = blocks.length, W = blocks[0].length;
  const elim = Array.from({ length: H }, () => Array(W).fill(false));
  const total = {}, reach = {};
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const c = blocks[y][x]; if (c > 0) total[c] = (total[c] || 0) + 1; }
  const reachable = (y, x) => y === 0 || x === 0 || y === H - 1 || x === W - 1 || elim[y - 1][x] || elim[y + 1][x] || elim[y][x - 1] || elim[y][x + 1];
  const scan = () => {
    for (const c of Object.keys(total)) reach[c] = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!elim[y][x] && reachable(y, x) && blocks[y][x] > 0) reach[blocks[y][x]]++;
  };
  const rows = [];
  scan(); rows.push({ step: 0, reach: { ...reach } });
  for (let step = 1; step <= maxSteps; step++) {
    let pickColor = null, pickD = Infinity;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (elim[y][x] || blocks[y][x] <= 0 || !reachable(y, x)) continue;
      const d = (H - 1 - y) + x;
      if (d < pickD) { pickD = d; pickColor = blocks[y][x]; }
    }
    if (pickColor == null) break;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!elim[y][x] && blocks[y][x] === pickColor && reachable(y, x)) elim[y][x] = true;
    scan(); rows.push({ step, reach: { ...reach } });
  }
  return rows;
}
function evalLevel(g) {
  const lv = A.parseLevel(A.fromGameFormat(g));
  const mb = A.Solver.runMinBuffer(lv, { depth: 3, instantChain: false });
  const peak = Math.max(0, ...(mb.stepBufferHistory || []));
  let pass = 0;
  for (let seed = 7; seed < 12; seed++) {
    const pr = A.PlayerSim.run(lv, { seed, instantChain: false, reviveCap: 2, capturePreviewStats: false });
    if (pr.won) pass++;
  }
  let tol = 0;
  for (let i = 0; i < 20; i++) {
    const nz = i === 0 ? 0 : 0.2 + (i % 5) * 0.2;
    const oo = A.Solver.runSolver(lv, nz, 1000 + i * 37, false, false, { capturePreviewStats: false, instantChain: false });
    if (oo.completed) tol++;
  }
  return { minWon: !!mb.won, boxes: mb.completedBoxes + '/' + mb.totalBoxes, peak, pass, tol };
}

function main() {
  const targetFile = process.argv[2];
  if (!targetFile) { console.error('用法: node RouteFirstB_v1.js <目标图.txt> --out <关卡.json> [--avg 50] [--floor 10] [--layout 骨架.json] [--rows R --cols C] [--maxrow 8] [--maxcol 8] [--maxcar 140] [--iters 6]'); process.exit(2); }
  const out = arg('--out', '');
  const avg = +arg('--avg', '50'), floor = +arg('--floor', '10');
  const maxRow = +arg('--maxrow', '8'), maxCol = +arg('--maxcol', '8'), maxCar = +arg('--maxcar', '140');
  const iters = +arg('--iters', '6');
  const blocks = parse(targetFile);
  const H = blocks.length, W = blocks[0].length;
  const curve = targetCurve(blocks, 60);
  const reachAt = (c, s) => (curve[Math.min(s, curve.length - 1)] || { reach: {} }).reach[c] || 0;
  const firstTouch = c => { for (let s = 0; s < curve.length; s++) if (reachAt(c, s) > 0) return s; return 99; };
  const px = {};
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const c = blocks[y][x]; if (c > 0) px[c] = (px[c] || 0) + 1; }
  const colors = Object.keys(px).map(Number).sort((a, b) => px[b] - px[a]);

  // 棋盘与车数：--layout 用现成 7×7 布局（只取黑块/障碍位置，不取门/主体）；
  // 否则按 avg 推车数、自动找棋盘
  const layoutFile = arg('--layout', '');
  const arch = layoutFile ? JSON.parse(fs.readFileSync(layoutFile, 'utf8')) : null;
  let counts, N, rows, cols, slotCells, blackCells;
  if (arch) {
    rows = arch.maprow; cols = arch.mapcol;
    slotCells = []; blackCells = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const a = arch.cells[r] && arch.cells[r][c];
      if (a && a.role === 'black') blackCells.push({ r, c });
      else if (a) slotCells.push({ r, c, a });
      else blackCells.push({ r, c });
    }
    N = slotCells.length;
    const pxTotal = colors.reduce((s2, c) => s2 + px[c], 0);
    const avg2 = Math.max(1, pxTotal / Math.max(1, N));
    counts = colors.map(c => {
      let n = Math.max(1, Math.round(px[c] / avg2));
      const maxN = Math.max(1, Math.floor(px[c] / floor));
      n = Math.min(n, maxN);
      return { c, n };
    });
    let sum = counts.reduce((s2, x) => s2 + x.n, 0);
    const byPx = counts.slice().sort((a, b) => px[b.c] - px[a.c]);
    while (sum > N) { const x = byPx.find(y => y.n > 1); if (!x) break; x.n--; sum--; }
    while (sum < N) { byPx[0].n++; sum++; }
  } else {
    counts = colors.map(c => {
      let n = Math.max(1, Math.round(px[c] / avg));
      const maxN = Math.max(1, Math.floor(px[c] / floor));
      n = Math.min(n, maxN);
      while (n > 1 && px[c] / n > maxCar) n++;
      return { c, n };
    });
    N = counts.reduce((s2, x) => s2 + x.n, 0);
    const forceRows = +arg('--rows', '0'), forceCols = +arg('--cols', '0');
    let bestGrid = null;
    if (forceRows >= 3 && forceCols >= 3) {
      const cells = forceRows * forceCols, black = cells - N;
      if (cells >= N && black <= Math.max(4, Math.round(cells * 0.15))) bestGrid = { r: forceRows, c: forceCols, black, score: 0 };
    }
    if (!bestGrid) for (let r = 3; r <= maxRow; r++) for (let c = 3; c <= maxCol; c++) {
      const cells = r * c;
      if (cells < N) continue;
      const black = cells - N;
      if (black > Math.max(4, Math.round(cells * 0.15))) continue;
      const aspect = Math.abs(r - c);
      const score = black * 3 + aspect;
      if (!bestGrid || score < bestGrid.score) bestGrid = { r, c, black, score };
    }
    if (!bestGrid) throw new Error('找不到合适的棋盘（车数 ' + N + '）');
    rows = bestGrid.r; cols = bestGrid.c;
    const allCells = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) allCells.push({ r, c });
    slotCells = allCells.slice(0, rows * cols - bestGrid.black);
    blackCells = allCells.slice(rows * cols - bestGrid.black);
  }

  // 暴露深度（棋盘边界 BFS）——先算，摆车要用
  const depth = {};
  {
    const q = [];
    for (const s of slotCells) if (s.r === 0 || s.c === 0 || s.r === rows - 1 || s.c === cols - 1) { depth[s.r + ',' + s.c] = 0; q.push(s); }
    for (let i = 0; i < q.length; i++) {
      const { r, c } = q[i];
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nr = r + dr, nc = c + dc, k = nr + ',' + nc;
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols || depth[k] != null) continue;
        if (!slotCells.some(s => s.r === nr && s.c === nc)) continue;
        depth[k] = depth[r + ',' + c] + 1; q.push({ r: nr, c: nc });
      }
    }
  }
  // 车序：按“该色在该容量下的 ready 步”摆车——还没露出的颜色不放浅格
  const firstReady = (c, n) => { for (let s = 0; s < curve.length; s++) if (reachAt(c, s) >= n) return s; return 999; };
  const carList = [];
  for (const x of counts) {
    const base = Math.max(floor, Math.floor(px[x.c] / x.n));
    for (let i = 0; i < x.n; i++) {
      carList.push({ color: x.c, idx: i, ready: firstReady(x.c, Math.min(base, maxCar)), px: px[x.c] });
    }
  }
  carList.sort((a, b) => a.ready - b.ready || firstTouch(a.color) - firstTouch(b.color) || b.px - a.px || a.idx - b.idx);
  const slotOrder = slotCells.slice().sort((a, b) =>
    ((depth[a.r + ',' + a.c] ?? 9) - (depth[b.r + ',' + b.c] ?? 9)) || (a.r - b.r) || (a.c - b.c));
  const assigned = {}, cap = {};
  carList.slice(0, slotOrder.length).forEach((car, i) => {
    const s = slotOrder[i];
    assigned[s.r + ',' + s.c] = car.color;
  });

  // 容量：同色均分 + floor；早期装不下的超出量挪到最后同色车
  const byColor = {};
  for (const [k, c] of Object.entries(assigned)) {
    (byColor[c] = byColor[c] || []).push(k.split(',').map(Number));
  }
  for (const c of Object.keys(byColor)) {
    const list = byColor[c].sort((a, b) => (depth[a[0] + ',' + a[1]] ?? 9) - (depth[b[0] + ',' + b[1]] ?? 9) || (a[0] - b[0]) || (a[1] - b[1]));
    const n = list.length;
    let base = Math.max(floor, Math.floor(px[c] / n));
    let caps = list.map(() => base);
    let diff = px[c] - base * n;
    caps[n - 1] += diff;
    if (caps[n - 1] < floor) { const need = floor - caps[n - 1]; caps[n - 1] = floor; caps[0] -= need; }
    // 不做“早期格限流”：容量先均分，超出由修复环按真实路线处理
    // （限流会把大颜色的浅格车压成 floor，形成 10+146 的尖）
    list.forEach(([r, cc], i) => { cap[r + ',' + cc] = Math.max(1, caps[i]); });
  }

  const build = () => {
    const spools = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ({ id: -1, type: 0, param: 0, count: 0 })));
    for (const s of slotCells) {
      const k = s.r + ',' + s.c, color = assigned[k]; if (color == null) continue;
      const types = [], params = [];
      const a = s.a;
      if (a && a.ice) { types.push(7); params.push(Math.max(1, Math.min(28, firstReady(color, cap[k] || floor) - 1))); }
      if (a && a.chain) { types.push(5); params.push(a.chain); }
      if (a && a.q) { types.push(6); params.push(0); }
      spools[s.r][s.c] = {
        id: color,
        type: types.length === 0 ? 0 : types.length === 1 ? types[0] : types,
        param: params.length === 0 ? 0 : params.length === 1 ? params[0] : params,
        count: cap[k] || floor
      };
    }
    for (const s of blackCells) spools[s.r][s.c] = { id: -1, type: 0, param: 0, count: 0 };
    return { toprow: H, blocks, maprow: rows, mapcol: cols, spools };
  };
  const countReach = (state, color) => {
    const Hh = blocks.length, Ww = blocks[0].length, elim = state.eliminated;
    const reach = (y, x) => y === 0 || x === 0 || y === Hh - 1 || x === Ww - 1 || elim[y - 1][x] || elim[y + 1][x] || elim[y][x - 1] || elim[y][x + 1];
    let n = 0;
    for (let y = 0; y < Hh; y++) for (let x = 0; x < Ww; x++) if (!elim[y][x] && reach(y, x) && blocks[y][x] === color) n++;
    return n;
  };
  const replayReach = (lv, picks) => {
    const Sim = A.Simulator;
    let st; try { st = Sim.enter(lv, { useSlotStart: true, instantChain: false }); } catch (e) { return []; }
    const res = [];
    for (const p of picks) {
      if (!st || st.gameOver) break;
      res.push({ r: p.r, c: p.c, color: p.color, rc: countReach(st, p.color) });
      try { Sim.applyPick(st, p.r, p.c); } catch (e) { break; }
    }
    return res;
  };
  let bestTry = null;
  for (let it = 0; it < iters; it++) {
    const g = build();
    const ev = evalLevel(g);
    console.log('  iter' + it + ': min=' + (ev.minWon ? '通' : '不通') + ' ' + ev.boxes + ' peak=' + ev.peak + ' player=' + ev.pass + '/5 容错=' + ev.tol + '/20');
    const score = (ev.minWon ? 100 : 0) + ev.pass * 10 + (ev.peak === 4 ? 30 : ev.peak === 3 ? 15 : ev.peak === 5 ? -20 : 0);
    if (!bestTry || score > bestTry.score) bestTry = { g: JSON.parse(JSON.stringify(g)), ev, score };
    if (ev.minWon && ev.pass >= 1) break;
    const lv = A.parseLevel(A.fromGameFormat(g));
    let changed = false;
    const routes = [];
    const pr = A.PlayerSim.run(lv, { seed: 7, instantChain: false, reviveCap: 2, capturePreviewStats: false });
    routes.push((pr.pickOrder || []).filter(p => p.chainIndex == null || p.chainIndex === 0));
    for (let i = 0; i < 10; i++) {
      const nz = i === 0 ? 0 : 0.2 + (i % 5) * 0.2;
      const oo = A.Solver.runSolver(lv, nz, 1000 + i * 37, false, false, { capturePreviewStats: false, instantChain: false });
      if (!oo.completed) routes.push((oo.pickOrder || []).filter(p => p.chainIndex == null || p.chainIndex === 0));
    }
    for (const picks of routes) {
      for (const q of replayReach(lv, picks)) {
        if (q.rc <= 0) continue;
        const k = q.r + ',' + q.c, cp = cap[k] || floor;
        const lim = Math.max(floor, q.rc);
        if (cp <= lim) continue;
        const over = cp - lim;
        cap[k] = lim;
        const color = assigned[k];
        const cand = (byColor[color] || []).map(([r, cc]) => ({ r, c: cc })).filter(x => x.r !== q.r || x.c !== q.c)
          .sort((a, b) => (cap[b.r + ',' + b.c] || 0) - (cap[a.r + ',' + a.c] || 0))[0];
        if (cand) cap[cand.r + ',' + cand.c] = (cap[cand.r + ',' + cand.c] || floor) + over;
        else cap[k] += over;
        changed = true;
      }
    }
    if (!changed) break;
  }
  const g = bestTry.g;
  if (out) fs.writeFileSync(out, JSON.stringify(g));
  console.log('图=' + targetFile.split('/').pop() + ' 车数=' + N + ' 棋盘=' + rows + 'x' + cols + ' 黑块=' + blackCells.length + ' 最小车=' + Math.min(...Object.values(cap)));
  console.log('best: min=' + (bestTry.ev.minWon ? '通' : '不通') + ' ' + bestTry.ev.boxes + ' peak=' + bestTry.ev.peak + ' player=' + bestTry.ev.pass + '/5 容错=' + bestTry.ev.tol + '/20');
  if (out) console.log('已写：' + out);
}

try { main(); } catch (e) { console.error('失败：' + e.message); process.exit(1); }
