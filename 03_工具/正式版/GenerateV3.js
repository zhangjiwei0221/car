#!/usr/bin/env node
'use strict';
/**
 * GenerateV3 —— 图 + 骨架拓扑 + 开图曲线 → 自动生成（v2.0 P2：门按 reach 定时）
 *
 * 流程：
 *   1) TargetReachCurve：每色在 0..40 步的 reach（每次取一色、消全部可达的乐观模型）；
 *   2) 每主体选框色：在该主体独占色里，选“0–10 步最大 reach”最大的；记录首次 reach≥10 的步；
 *   3) 阶段顺序：按各框色首次 reach≥10 的步升序；
 *   4) 门：骨架门位按阶段顺序分配；门容量 = min(框色 0–10 步最大 reach, 55% 框色总量)；
 *   5) frame2：骨架的最晚 4 个非黑/非门格；容量 = 框色余量；
 *   6) 自由格颜色：按格子深度升序 × 颜色 px 升序（早期小色、晚期大色），class/象限做次判据；
 *   7) 容量 bootstrap：最小路线死时压“超可达的最后一手”，余量挪同色更晚格；最多 20 轮。
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
function classify(blocks, subs) {
  const H = blocks.length, W = blocks[0].length;
  const subOf = Array.from({ length: H }, () => Array(W).fill(-1));
  subs.forEach((s, i) => { for (const key of s.cells) { const [y, x] = key.split(',').map(Number); subOf[y][x] = i; } });
  const st = {};
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = blocks[y][x]; if (c <= 0) continue;
    const o = st[c] = st[c] || { px: 0, border: 0, interior: 0, outside: 0, subs: new Set() };
    o.px++;
    if (y === 0 || x === 0 || y === H - 1 || x === W - 1) o.border++; else o.interior++;
    if (subOf[y][x] >= 0) o.subs.add(subOf[y][x]); else o.outside++;
  }
  const classOf = c => {
    const o = st[c]; if (!o) return 'fill';
    if (o.subs.size >= 2) return 'debtS';
    if (o.border >= 10 && o.interior >= 10) return 'debtC';
    if (o.outside > 0 && o.subs.size >= 1) return 'debtB';
    if (o.border < 10 && o.interior >= 10) return 'debtI';
    return 'fill';
  };
  return { st, classOf };
}
function quadOf(s, H, W) {
  let sy = 0, sx = 0, n = 0;
  for (const key of s.cells) { const [y, x] = key.split(',').map(Number); sy += y; sx += x; n++; }
  return (sy / n >= H / 2 ? 'B' : 'T') + (sx / n < W / 2 ? 'L' : 'R');
}
function targetCurve(blocks, maxSteps) {
  const H = blocks.length, W = blocks[0].length;
  const elim = Array.from({ length: H }, () => Array(W).fill(false));
  const total = {}, gone = {}, reach = {};
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
function countReach(st, color) {
  const H = st.blocks.length, W = st.blocks[0].length, blocks = st.blocks, elim = st.eliminated;
  const reach = (y, x) => y === 0 || x === 0 || y === H - 1 || x === W - 1 || elim[y - 1][x] || elim[y + 1][x] || elim[y][x - 1] || elim[y][x + 1];
  let n = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!elim[y][x] && reach(y, x) && blocks[y][x] === color) n++;
  return n;
}
function reachMap(lv) {
  const mb = A.Solver.runMinBuffer(lv, { depth: 3, instantChain: false });
  const Sim = A.Simulator; const st = Sim.enter(lv, { useSlotStart: true, instantChain: false });
  const out = {};
  for (const p of (mb.pickOrder || []).filter(p => p.chainIndex == null || p.chainIndex === 0)) {
    if (!st || st.gameOver) break;
    out[p.r + ',' + p.c] = countReach(st, p.color);
    try { Sim.applyPick(st, p.r, p.c); } catch (e) { break; }
  }
  return out;
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
  const score = (mb.won ? 100 : 0) + pass * 10 + (peak === 4 ? 30 : peak === 3 ? 15 : peak === 5 ? -20 : 0);
  return { minWon: !!mb.won, boxes: mb.completedBoxes + '/' + mb.totalBoxes, peak, pass, score };
}

function main() {
  const archFile = process.argv[2], targetFile = process.argv[3];
  const out = arg('--out', ''), recipeOut = arg('--recipe', '');
  if (!archFile || !targetFile) { console.error('用法: node GenerateV3.js <骨架.json> <目标图.txt> --out <关卡.json> [--recipe <配方.json>]'); process.exit(2); }
  const arch = JSON.parse(fs.readFileSync(archFile, 'utf8'));
  const blocks = parse(targetFile);
  const H = blocks.length, W = blocks[0].length;
  const subs = detect(blocks);
  const { st, classOf } = classify(blocks, subs);
  const colors = Object.keys(st).map(Number).sort((a, b) => st[b].px - st[a].px);
  const curve = targetCurve(blocks, 40);
  const reachAt = (c, s) => (curve[Math.min(s, curve.length - 1)] || { reach: {} }).reach[c] || 0;
  const maxReachIn = (c, a, b) => { let m = 0; for (let s = a; s <= b && s < curve.length; s++) m = Math.max(m, reachAt(c, s)); return m; };
  const firstAtLeast = (c, t) => { for (let s = 0; s < curve.length; s++) if (reachAt(c, s) >= t) return s; return null; };
  const newQuad = {}; subs.forEach(s => { newQuad[quadOf(s, H, W)] = s; });
  // 每主体选框色（0–10 步最大 reach 最大）
  const quads = ['BL', 'TL', 'TR', 'BR'];
  let subjectPlan = quads.map(q => {
    const s = newQuad[q];
    if (!s) return null;
    const si = subs.indexOf(s);
    const excl = colors.filter(c => st[c].subs.size === 1 && st[c].subs.has(si));
    const scored = excl.map(c => ({
      color: c,
      early: maxReachIn(c, 0, 10),
      first10: firstAtLeast(c, 10),
      total: st[c].px
    })).sort((a, b) => (b.early - a.early) || (a.first10 == null ? 99 : a.first10) - (b.first10 == null ? 99 : b.first10) || b.total - a.total);
    return { quad: q, subject: s.name.split('/').pop(), frame: scored[0].color, early: scored[0].early, first10: scored[0].first10, total: scored[0].total };
  }).filter(Boolean);
  const key = (r, c) => r + ',' + c;
  const doors = (arch.doors || []).slice(0, 4);
  // 门位的近似拿车步：顶行 2 / 左列 4 / 右列 10 / 深处 18
  const doorSteps = doors.map(d => {
    const [r, c] = d.position || [0, 0];
    if (r === 0) return 2;
    if (c === 0) return 4;
    if (c === arch.mapcol - 1) return 10;
    return 18;
  });
  const perms = arr => arr.length <= 1 ? [arr] : arr.flatMap((x, i) => perms(arr.slice(0, i).concat(arr.slice(i + 1))).map(p => [x].concat(p)));
  let bestOrder = null, bestMatch = -1e9;
  for (const p of perms(subjectPlan)) {
    let sum = 0, mn = 1e9;
    p.forEach((sp, i) => { const rc = reachAt(sp.frame, doorSteps[i] || 18); sum += rc; mn = Math.min(mn, rc); });
    const score = sum + mn * 2;
    if (score > bestMatch) { bestMatch = score; bestOrder = p; }
  }
  subjectPlan = bestOrder || subjectPlan;
  const doorCells = doors.map(d => d.position).filter(Boolean);
  const cells = [];
  for (let r = 0; r < arch.maprow; r++) for (let c = 0; c < arch.mapcol; c++) {
    const a = arch.cells[r][c]; if (a && a.role !== 'black') cells.push({ r, c, a });
  }
  const isDoor = (r, c) => doorCells.some(p => p[0] === r && p[1] === c);
  const assigned = {};
  // 门
  subjectPlan.forEach((sp, i) => {
    const d = doors[i]; if (!d) return;
    assigned[key(d.position[0], d.position[1])] = sp.frame;
  });
  // frame2：最晚的 4 个非黑/非门格
  const freeAll = cells.filter(x => !isDoor(x.r, x.c)).sort((a, b) => (b.r + b.c) - (a.r + a.c));
  const frame2Cells = freeAll.slice(0, 4);
  subjectPlan.forEach((sp, i) => { const cl = frame2Cells[i]; if (cl) assigned[key(cl.r, cl.c)] = sp.frame; });
  const freeCells = cells.filter(x => !isDoor(x.r, x.c) && !frame2Cells.some(f => f.r === x.r && f.c === x.c));
  // 自由格颜色：早期小色、晚期大色
  const frameColors = new Set(subjectPlan.map(s => s.frame));
  const nonFrame = colors.filter(c => !frameColors.has(c));
  const colorAsc = nonFrame.slice().sort((a, b) => st[a].px - st[b].px);
  const freeSorted = freeCells.slice().sort((a, b) => (a.r + a.c) - (b.r + b.c));
  for (let i = 0; i < freeSorted.length; i++) {
    const x = freeSorted[i];
    const rankSlot = i / Math.max(1, freeSorted.length);
    let best = null, bestScore = -1e9;
    for (const c of colorAsc) {
      const rankColor = colorAsc.indexOf(c) / Math.max(1, colorAsc.length);
      const sizeScore = 30 * (1 - Math.abs(rankSlot - rankColor));
      const cls = classOf(c);
      const exact = cls === x.a.role ? 20 : (cls.startsWith('debt') && x.a.role.startsWith('debt') ? 10 : 0);
      const score = sizeScore + exact;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    assigned[key(x.r, x.c)] = best;
  }
  // 容量
  const cap = {};
  const cellsByColor = {};
  for (const cl of cells) { const c = assigned[key(cl.r, cl.c)]; if (c == null) continue; (cellsByColor[c] = cellsByColor[c] || []).push(cl); }
  // 门/ frame2 先定
  subjectPlan.forEach((sp, i) => {
    const d = doors[i]; if (!d) return;
    const dk = key(d.position[0], d.position[1]);
    const doorCap = Math.min(sp.early, Math.max(8, Math.round(sp.total * 0.55)));
    cap[dk] = Math.max(1, doorCap);
    const rest = sp.total - cap[dk];
    const f2 = frame2Cells[i]; if (f2) cap[key(f2.r, f2.c)] = Math.max(1, rest);
  });
  // 自由色初始容量：refCount 权重（没有 refCount 的按平均）
  for (const c of Object.keys(cellsByColor)) {
    const list = cellsByColor[c];
    if (list.every(x => cap[key(x.r, x.c)] != null)) continue;
    const pending = list.filter(x => cap[key(x.r, x.c)] == null);
    const done = list.filter(x => cap[key(x.r, x.c)] != null);
    const doneSum = done.reduce((a, x) => a + cap[key(x.r, x.c)], 0);
    const rest = st[c].px - doneSum;
    if (rest <= 0) { pending.forEach(x => { cap[key(x.r, x.c)] = 1; }); continue; }
    const weights = pending.map(x => x.a.refCount || 1), sum = weights.reduce((a, b) => a + b, 0);
    const caps = weights.map(w => Math.max(1, Math.round(rest * w / sum)));
    let diff = rest - caps.reduce((a, b) => a + b, 0); let idx = caps.indexOf(Math.max(...caps)); caps[idx] += diff;
    pending.forEach((x, i) => { cap[key(x.r, x.c)] = Math.max(1, caps[i]); });
  }
  const build = () => {
    const spools = Array.from({ length: arch.maprow }, () => Array.from({ length: arch.mapcol }, () => ({ id: -1, type: 0, param: 0, count: 0 })));
    for (const cl of cells) {
      const a = cl.a, color = assigned[key(cl.r, cl.c)], count = cap[key(cl.r, cl.c)] || 1;
      if (color == null) continue;
      const types = [], params = [];
      if (a.ice) { types.push(7); params.push(a.ice); }
      if (a.chain) { types.push(5); params.push(a.chain); }
      if (a.q) { types.push(6); params.push(0); }
      spools[cl.r][cl.c] = { id: color, type: types.length === 0 ? 0 : types.length === 1 ? types[0] : types, param: params.length === 0 ? 0 : params.length === 1 ? params[0] : params, count };
    }
    return { toprow: H, blocks, maprow: arch.maprow, mapcol: arch.mapcol, spools };
  };
  // bootstrap
  let best = null, bestFull = null;
  for (let iter = 0; iter < 20; iter++) {
    const g = build();
    const lv = A.parseLevel(A.fromGameFormat(g));
    const mb = A.Solver.runMinBuffer(lv, { depth: 3, instantChain: false });
    const peak = Math.max(0, ...(mb.stepBufferHistory || []));
    const won = !!mb.won;
    if (!best || (won && !best.won) || (won === best.won && peak < best.peak)) best = { g: JSON.parse(JSON.stringify(g)), won, peak };
    if (won) {
      const ev = evalLevel(g);
      if (!bestFull || ev.score > bestFull.ev.score) bestFull = { g: JSON.parse(JSON.stringify(g)), ev };
      break;
    }
    const reach = reachMap(lv);
    const picks = (mb.pickOrder || []).filter(p => p.chainIndex == null || p.chainIndex === 0);
    const pickedSet = new Set(picks.map(p => p.r + ',' + p.c));
    let changed = false;
    for (const p of picks) {
      const k = p.r + ',' + p.c;
      const rc = reach[k]; if (rc == null) continue;
      const cp = cap[k] || 1;
      if (cp <= rc) continue;
      const over = cp - rc;
      cap[k] = Math.max(1, rc);
      const color = assigned[k];
      const list = cellsByColor[color] || [];
      const later = list.filter(x => !pickedSet.has(x.r + ',' + x.c)).sort((a, b) => (b.r + b.c) - (a.r + a.c))[0]
        || list.slice().sort((a, b) => (b.r + b.c) - (a.r + a.c))[0];
      if (later) {
        const lk = later.r + ',' + later.c;
        cap[lk] = (cap[lk] || 1) + over;
      } else {
        cap[k] += over;
      }
      changed = true;
    }
    if (!changed) break;
  }
  const g = (bestFull || best).g;
  const ev = bestFull ? bestFull.ev : { minWon: best.won, boxes: '', peak: best.peak, pass: '?', score: best.won ? 100 : -20 };
  if (out) fs.writeFileSync(out, JSON.stringify(g));
  if (recipeOut) {
    const cars = [], black = [], obstacles = [];
    for (let r = 0; r < arch.maprow; r++) for (let c = 0; c < arch.mapcol; c++) {
      const s = g.spools[r][c];
      if (s.id === -1) { black.push([r, c]); continue; }
      if (s.id > 0) cars.push({ r, c, id: s.id, count: s.count });
      const t = Array.isArray(s.type) ? s.type : [s.type || 0]; const p = Array.isArray(s.param) ? s.param : [s.param || 0];
      if (t.length === 1 && t[0]) obstacles.push({ r, c, types: [{ type: t[0], param: p[0] || 0 }] });
      else if (t.some(x => x)) obstacles.push({ r, c, type: t, param: p });
    }
    fs.writeFileSync(recipeOut, JSON.stringify({ name: 'genv3_' + arch.name, target: targetFile, toprow: H, maprow: arch.maprow, mapcol: arch.mapcol, cars, black, obstacles, notes: { archetype: archFile, subjectPlan } }, null, 2));
  }
  console.log('骨架=' + arch.name + ' 图=' + targetFile.split('/').pop());
  console.log('阶段顺序: ' + subjectPlan.map(s => s.quad + ' ' + s.subject + ' 框' + s.frame + '(early' + s.early + '/first10@' + s.first10 + ')').join(' -> '));
  console.log('best: min=' + (ev.minWon ? '通' : '不通') + ' ' + ev.boxes + ' peak=' + ev.peak + ' player2=' + ev.pass + '/5 score=' + ev.score);
  if (out) console.log('已写：' + out);
}

try { main(); } catch (e) { console.error('失败：' + e.message); process.exit(1); }
