#!/usr/bin/env node
'use strict';
/**
 * RouteFirst_v1 —— 路线优先：先按目标开图曲线排“谁先拿、拿多少”，再沿路线摆车/定容量/放门
 *
 * 与 GenerateV3（先定颜色/容量再拟合路线）相反：
 *   1) 目标开图曲线 → 每色首次触达步；
 *   2) 阶段顺序：框色与骨架门位按“门所在行窗口内的框色 reach”做 4! 匹配；
 *   3) 门：框色第一辆在门位，容量 = 该行窗口内的 reach；剩余 → 同阶段的 frame2 格（晚）；
 *   4) 自由车：按“颜色首次触达 + 车序”排车，按“格子行优先”排槽，一一对应；
 *   5) 每车容量：该格所在行窗口（row*5+1..row*5+6）里该色的 reach；同色最后一辆吃余量（债）；
 *   6) 跑 min/PlayerSim；不通过再 MoveAdvisor。
 *
 * 用法：node RouteFirst_v1.js <骨架.json> <目标图.txt> --out <关卡.json> [--recipe <配方.json>]
 */
const B = require('./Build006Thickness_v688');
const A = B.loadSolver('corner');
const { detect } = require('./SubjectDetect_v800');
const fs = require('fs');

function arg(k, d) { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; }
function parse(file) {
  const lines = fs.readFileSync(file, 'utf8').replace(/\r/g, '').trim().split('\n');
  const rows = [];
  for (const line of lines) { const t = line.trim(); if (!t || /[^\d\s]/.test(t)) continue; rows.push(t.split(/\s+/).map(Number)); }
  return rows;
}
function quadOf(s, H, W) {
  let sy = 0, sx = 0, n = 0;
  for (const key of s.cells) { const [y, x] = key.split(',').map(Number); sy += y; sx += x; n++; }
  return (sy / n >= H / 2 ? 'B' : 'T') + (sx / n < W / 2 ? 'L' : 'R');
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
function classify(blocks, subs) {
  const H = blocks.length, W = blocks[0].length;
  const subOf = Array.from({ length: H }, () => Array(W).fill(-1));
  subs.forEach((s, i) => { for (const key of s.cells) { const [y, x] = key.split(',').map(Number); subOf[y][x] = i; } });
  const st = {};
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = blocks[y][x]; if (c <= 0) continue;
    const o = st[c] = st[c] || { px: 0, border: 0, interior: 0, outside: 0, subs: new Set() };
    o.px++; if (y === 0 || x === 0 || y === H - 1 || x === W - 1) o.border++; else o.interior++;
    if (subOf[y][x] >= 0) o.subs.add(subOf[y][x]); else o.outside++;
  }
  return st;
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
  for (let i = 0; i < 8; i++) {
    const nz = i === 0 ? 0 : 0.2 + (i % 5) * 0.2;
    const oo = A.Solver.runSolver(lv, nz, 1000 + i * 37, false, false, { capturePreviewStats: false, instantChain: false });
    if (oo.completed) tol++;
  }
  const score = (mb.won ? 100 : 0) + pass * 10 + tol * 4 + (peak === 4 ? 30 : peak === 3 ? 15 : peak === 5 ? -20 : 0);
  return { minWon: !!mb.won, boxes: mb.completedBoxes + '/' + mb.totalBoxes, peak, pass, tol, score };
}

function main() {
  const archFile = process.argv[2], targetFile = process.argv[3];
  const out = arg('--out', ''), recipeOut = arg('--recipe', '');
  const iceMode = arg('--ice', 'derived'); // copy=沿用骨架参数 | derived=按本关 ready 步重推 | none=不放冰
  if (!archFile || !targetFile) { console.error('用法: node RouteFirst_v1.js <骨架.json> <目标图.txt> --out <关卡.json> [--recipe <配方.json>] [--ice derived|copy|none] [--group N] [--order stage|touch]'); process.exit(2); }
  const arch = JSON.parse(fs.readFileSync(archFile, 'utf8'));
  const blocks = parse(targetFile);
  const H = blocks.length, W = blocks[0].length;
  const subs = detect(blocks);
  const st = classify(blocks, subs);
  const colors = Object.keys(st).map(Number).sort((a, b) => st[b].px - st[a].px);
  const curve = targetCurve(blocks, 40);
  const reachAt = (c, s) => (curve[Math.min(s, curve.length - 1)] || { reach: {} }).reach[c] || 0;
  const maxReachIn = (c, a, b) => { let m = 0; for (let s = a; s <= b && s < curve.length; s++) m = Math.max(m, reachAt(c, s)); return m; };
  const firstTouch = c => { for (let s = 0; s < curve.length; s++) if (reachAt(c, s) > 0) return s; return 99; };
  // 该色在该容量下“最早能填满”的步；冰参数 = ready-1（到这一步才解锁）
  const firstReady = (c, n) => { for (let s = 0; s < curve.length; s++) if (reachAt(c, s) >= n) return s; return curve.length - 1; };
  const newQuad = {}; subs.forEach(s => { newQuad[quadOf(s, H, W)] = s; });
  // 主体/框色候选
  const quads = ['BL', 'TL', 'TR', 'BR'];
  const subjects = quads.map(q => {
    const s = newQuad[q]; if (!s) return null;
    const si = subs.indexOf(s);
    const excl = colors.filter(c => st[c].subs.size === 1 && st[c].subs.has(si));
    return { quad: q, subject: s.name.split('/').pop(), excl };
  }).filter(Boolean);
  const doorCells = (arch.doors || []).slice(0, 4).map(d => d.position);
  const winOf = r => [r * 5 + 1, r * 5 + 6];
  // 4! 匹配：主体 → 门位（门所在行窗口的框色 reach 最大）
  const perms = arr => arr.length <= 1 ? [arr] : arr.flatMap((x, i) => perms(arr.slice(0, i).concat(arr.slice(i + 1))).map(p => [x].concat(p)));
  let best = null, bestScore = -1e9;
  for (const p of perms(subjects)) {
    let sum = 0, mn = 1e9;
    const plan = p.map((sp, i) => {
      const [dr] = doorCells[i] || [0, 0];
      const [a, b] = winOf(dr);
      let bestFr = 0, bestC = sp.excl[0];
      for (const c of sp.excl) { const r = maxReachIn(c, a, b); if (r > bestFr) { bestFr = r; bestC = c; } }
      sum += bestFr; mn = Math.min(mn, bestFr);
      return { ...sp, frame: bestC, reach: bestFr, window: [a, b] };
    });
    const sc = sum + mn * 2;
    if (sc > bestScore) { bestScore = sc; best = plan; }
  }
  const subjectPlan = best;
  // 槽位
  const key = (r, c) => r + ',' + c;
  const cells = [];
  for (let r = 0; r < arch.maprow; r++) for (let c = 0; c < arch.mapcol; c++) {
    const a = arch.cells[r][c]; if (a && a.role !== 'black') cells.push({ r, c, a });
  }
  // 每格最短暴露步：从棋盘非黑边界 BFS，depth=0 表示开局即可拿
  const nonBlack = (r, c) => r >= 0 && r < arch.maprow && c >= 0 && c < arch.mapcol && arch.cells[r][c] && arch.cells[r][c].role !== 'black';
  const depthOf = {};
  {
    const q = [];
    for (const cl of cells) if (cl.r === 0 || cl.c === 0 || cl.r === arch.maprow - 1 || cl.c === arch.mapcol - 1) { depthOf[key(cl.r, cl.c)] = 0; q.push(cl); }
    for (let i = 0; i < q.length; i++) {
      const { r, c } = q[i];
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nr = r + dr, nc = c + dc;
        if (!nonBlack(nr, nc) || depthOf[key(nr, nc)] != null) continue;
        depthOf[key(nr, nc)] = depthOf[key(r, c)] + 1; q.push({ r: nr, c: nc });
      }
    }
  }
  const depthAt = (r, c) => depthOf[key(r, c)] == null ? 0 : depthOf[key(r, c)];
  const capReach = (c, r, cc) => reachAt(c, Math.max(1, depthAt(r, cc) + 1));
  const isDoor = (r, c) => doorCells.some(p => p[0] === r && p[1] === c);
  const frame2Cells = cells.filter(x => x.a.role === 'frame2');
  const freeCells = cells.filter(x => !isDoor(x.r, x.c) && x.a.role !== 'frame2');
  const assigned = {}, cap = {};
  // 门 + frame2
  subjectPlan.forEach((sp, i) => {
    const [dr, dc] = doorCells[i] || [];
    if (dr == null) return;
    const [a, b] = sp.window;
    const earlyR = capReach(sp.frame, dr, dc);
    const doorCap = Math.max(1, Math.min(st[sp.frame].px, earlyR > 0 ? earlyR : sp.reach));
    assigned[key(dr, dc)] = sp.frame; cap[key(dr, dc)] = doorCap;
    const f2 = frame2Cells[i];
    if (f2) {
      assigned[key(f2.r, f2.c)] = sp.frame;
      cap[key(f2.r, f2.c)] = Math.max(1, st[sp.frame].px - doorCap);
    }
  });
  // 自由色：按 px 份额分 30 辆
  const frameColors = new Set(subjectPlan.map(s => s.frame));
  const nonFrame = colors.filter(c => !frameColors.has(c));
  const nonFramePx = nonFrame.reduce((a, c) => a + st[c].px, 0);
  let counts = nonFrame.map(c => ({ c, n: Math.max(1, Math.round(st[c].px / nonFramePx * freeCells.length)) }));
  let sumN = counts.reduce((a, x) => a + x.n, 0);
  while (sumN > freeCells.length) { const x = counts.slice().sort((a, b) => b.n - a.n)[0]; if (x.n <= 1) break; x.n--; sumN--; }
  while (sumN < freeCells.length) { const x = counts.slice().sort((a, b) => st[b.c].px - st[a.c].px)[0]; x.n++; sumN++; }
  // 车序：按“车序轮次”交错——每色第 1 辆先按首次触达排，然后各色第 2 辆……
  // （避免整色一段、主体串行；交错让多个主体同时在飞，玩家拿错也有别的债可还）
  // 分组交错：每 group 个色一组做轮次交错，组间顺序推进（group=0 即全色交错）
  const groupSize = Math.max(0, +arg('--group', '3'));
  const carSeq = [];
  // 颜色的主导象限 → 阶段序；让同一阶段/象限的颜色成簇推进，避免四象限同时被啃
  const quadCount = {};
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = blocks[y][x]; if (c <= 0) continue;
    const q = (y < H / 2 ? 'T' : 'B') + (x < W / 2 ? 'L' : 'R');
    (quadCount[c] = quadCount[c] || {})[q] = (quadCount[c][q] || 0) + 1;
  }
  const domQuad = c => { const o = quadCount[c] || {}; let best = 'TL', bn = -1; for (const q of Object.keys(o)) if (o[q] > bn) { bn = o[q]; best = q; } return best; };
  const stageRank = {}; subjectPlan.forEach((s, i) => { if (stageRank[s.quad] == null) stageRank[s.quad] = i; });
  const qRank = c => { const q = domQuad(c); return stageRank[q] == null ? 99 : stageRank[q]; };
  const orderMode = arg('--order', 'stage');
  const sortedColors = counts.slice().sort((a, b) => orderMode === 'touch'
    ? (firstTouch(a.c) - firstTouch(b.c)) || (qRank(a.c) - qRank(b.c)) || (st[b.c].px - st[a.c].px)
    : (qRank(a.c) - qRank(b.c)) || (firstTouch(a.c) - firstTouch(b.c)) || (st[b.c].px - st[a.c].px));
  if (groupSize === 0) {
    const maxN = sortedColors.reduce((m, x) => Math.max(m, x.n), 0);
    for (let round = 0; round < maxN; round++) {
      for (const x of sortedColors) if (round < x.n) carSeq.push({ color: x.c, idx: round, n: x.n });
    }
  } else {
    for (let i0 = 0; i0 < sortedColors.length; i0 += groupSize) {
      const chunk = sortedColors.slice(i0, i0 + groupSize);
      const mx = chunk.reduce((m, x) => Math.max(m, x.n), 0);
      for (let round = 0; round < mx; round++) {
        for (const x of chunk) if (round < x.n) carSeq.push({ color: x.c, idx: round, n: x.n });
      }
    }
  }
  const slots = freeCells.slice().sort((a, b) => (a.r - b.r) || (a.c - b.c));
  const byColor = {};
  carSeq.forEach((car, i) => {
    const slot = slots[i]; if (!slot) return;
    assigned[key(slot.r, slot.c)] = car.color;
    (byColor[car.color] = byColor[car.color] || []).push({ slot, car });
  });
  // 容量：每色按暴露深度排序，前 n-1 辆 = 该格暴露步的 reach，最深一辆吃余量
  for (const c of Object.keys(byColor)) {
    const list = byColor[c].slice().sort((x, y) =>
      depthAt(x.slot.r, x.slot.c) - depthAt(y.slot.r, y.slot.c) ||
      (x.slot.r - y.slot.r) || (x.slot.c - y.slot.c));
    let remaining = st[c].px;
    list.forEach((x, i) => {
      const rch = capReach(c, x.slot.r, x.slot.c);
      const isLast = i === list.length - 1;
      const capV = isLast ? remaining : Math.max(1, Math.min(Math.max(1, rch), remaining - (list.length - i - 1)));
      cap[key(x.slot.r, x.slot.c)] = Math.max(1, capV);
      remaining = Math.max(0, remaining - capV);
    });
    // 余量兜底：加到最深一辆
    if (remaining > 0) { const last = list[list.length - 1]; cap[key(last.slot.r, last.slot.c)] += remaining; }
  }
  // 建关
  const cellsByColor = {};
  for (const cl of cells) { const c = assigned[key(cl.r, cl.c)]; if (c != null) (cellsByColor[c] = cellsByColor[c] || []).push(cl); }
  const build = () => {
    const spools = Array.from({ length: arch.maprow }, () => Array.from({ length: arch.mapcol }, () => ({ id: -1, type: 0, param: 0, count: 0 })));
    for (const cl of cells) {
      const a = cl.a, color = assigned[key(cl.r, cl.c)]; if (color == null) continue;
      const count = cap[key(cl.r, cl.c)] || 1;
      const types = [], params = [];
      if (a.ice && iceMode !== 'none') {
        types.push(7);
        params.push(iceMode === 'copy' ? a.ice : Math.max(1, Math.min(28, firstReady(color, count) - 1)));
      }
      if (a.chain) { types.push(5); params.push(a.chain); }
      if (a.q) { types.push(6); params.push(0); }
      spools[cl.r][cl.c] = { id: color, type: types.length === 0 ? 0 : types.length === 1 ? types[0] : types, param: params.length === 0 ? 0 : params.length === 1 ? params[0] : params, count };
    }
    return { toprow: H, blocks, maprow: arch.maprow, mapcol: arch.mapcol, spools };
  };
  const countReach = (state, color) => {
    const Hh = blocks.length, Ww = blocks[0].length, elim = state.eliminated;
    const reach = (y, x) => y === 0 || x === 0 || y === Hh - 1 || x === Ww - 1 || elim[y - 1][x] || elim[y + 1][x] || elim[y][x - 1] || elim[y][x + 1];
    let n = 0;
    for (let y = 0; y < Hh; y++) for (let x = 0; x < Ww; x++) if (!elim[y][x] && reach(y, x) && blocks[y][x] === color) n++;
    return n;
  };
  const replayReach = (lv, picks) => {
    const Sim = A.Simulator, st = Sim.enter(lv, { useSlotStart: true, instantChain: false });
    const out = [];
    for (const p of picks) {
      if (!st || st.gameOver) break;
      out.push({ r: p.r, c: p.c, color: p.color, rc: countReach(st, p.color) });
      try { Sim.applyPick(st, p.r, p.c); } catch (e) { break; }
    }
    return out;
  };
  // 修复：把路线里“容量 > 拿到时可达”的车压到可达，余量挪同色余量最大的车
  const repairFrom = (lv, picks) => {
    const reach = replayReach(lv, picks);
    let changed = false;
    for (const q of reach) {
      if (q.rc <= 0) continue;
      const k = q.r + ',' + q.c, cp = cap[k] || 1;
      if (cp <= q.rc) continue;
      const over = cp - q.rc;
      cap[k] = q.rc;
      const color = assigned[k];
      const cand = (cellsByColor[color] || []).filter(x => !(x.r === q.r && x.c === q.c))
        .sort((a, b) => {
          const ha = capReach(color, a.r, a.c) - (cap[key(a.r, a.c)] || 1);
          const hb = capReach(color, b.r, b.c) - (cap[key(b.r, b.c)] || 1);
          return (hb - ha) || (depthAt(b.r, b.c) - depthAt(a.r, a.c));
        })[0];
      if (cand) { const lk = key(cand.r, cand.c); cap[lk] = (cap[lk] || 1) + over; }
      else cap[k] += over;
      changed = true;
    }
    return changed;
  };
  // 玩家路线 + 噪声路线修复：让“拿错顺序”也能还债
  let bestTry = null;
  for (let iter = 0; iter < 8; iter++) {
    const g = build();
    const ev = evalLevel(g);
    console.log('  iter' + iter + ': min=' + (ev.minWon ? '通' : '不通') + ' ' + ev.boxes + ' peak=' + ev.peak + ' player=' + ev.pass + '/5 容错=' + ev.tol + '/8');
    if (!bestTry || ev.score > bestTry.ev.score) bestTry = { g: JSON.parse(JSON.stringify(g)), ev };
    if (ev.minWon && ev.pass >= 5 && ev.tol >= 6) break;
    const lv = A.parseLevel(A.fromGameFormat(g));
    let changed = false;
    const pr = A.PlayerSim.run(lv, { seed: 7, instantChain: false, reviveCap: 2, capturePreviewStats: false });
    changed = repairFrom(lv, (pr.pickOrder || []).filter(p => p.chainIndex == null || p.chainIndex === 0)) || changed;
    for (let i = 0; i < 8; i++) {
      const nz = i === 0 ? 0 : 0.2 + (i % 5) * 0.2;
      const oo = A.Solver.runSolver(lv, nz, 1000 + i * 37, false, false, { capturePreviewStats: false, instantChain: false });
      if (oo.completed) continue;
      changed = repairFrom(lv, (oo.pickOrder || []).filter(p => p.chainIndex == null || p.chainIndex === 0)) || changed;
    }
    if (!changed) break;
  }
  const g = bestTry.g, ev = bestTry.ev;
  const spools = g.spools;
  if (out) fs.writeFileSync(out, JSON.stringify(g));
  if (recipeOut) {
    const cars = [], black = [], obstacles = [];
    for (let r = 0; r < arch.maprow; r++) for (let c = 0; c < arch.mapcol; c++) {
      const s = spools[r][c];
      if (s.id === -1) { black.push([r, c]); continue; }
      if (s.id > 0) cars.push({ r, c, id: s.id, count: s.count });
      const t = Array.isArray(s.type) ? s.type : [s.type || 0]; const p = Array.isArray(s.param) ? s.param : [s.param || 0];
      if (t.length === 1 && t[0]) obstacles.push({ r, c, types: [{ type: t[0], param: p[0] || 0 }] });
      else if (t.some(x => x)) obstacles.push({ r, c, type: t, param: p });
    }
    fs.writeFileSync(recipeOut, JSON.stringify({ name: 'routefirst_' + arch.name, target: targetFile, toprow: H, maprow: arch.maprow, mapcol: arch.mapcol, cars, black, obstacles, notes: { archetype: archFile, subjectPlan: subjectPlan.map(s => ({ quad: s.quad, subject: s.subject, frame: s.frame, reach: s.reach })) } }, null, 2));
  }
  console.log('骨架=' + arch.name + ' 图=' + targetFile.split('/').pop());
  console.log('阶段: ' + subjectPlan.map((s, i) => '门' + (i + 1) + ' ' + s.quad + ' ' + s.subject + ' 框' + s.frame + '(reach' + s.reach + ')').join(' | '));
  console.log('min=' + (ev.minWon ? '通' : '不通') + ' ' + ev.boxes + ' peak=' + ev.peak + ' player2=' + ev.pass + '/5 容错=' + ev.tol + '/8 score=' + ev.score);
  if (out) console.log('已写：' + out);
}

try { main(); } catch (e) { console.error('失败：' + e.message); process.exit(1); }
