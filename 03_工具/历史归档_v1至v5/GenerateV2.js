#!/usr/bin/env node
'use strict';
/**
 * GenerateV2 —— 图 + 骨架拓扑 → 自动生成关卡（v2.0 P2：拓扑可搬，角色重推）
 *
 * 与 V1 的区别：
 *   - 只搬骨架的 **topology**：black / door / frame2 / 自由格位置；
 *   - **roles 不搬**：自由格的颜色角色由新图的 class + 尺寸排名 + 象限重新推导；
 *   - 容量仍用最小路线可达迭代（门/frame2/fill ≤ 可达，debt≈可达×1.8）。
 *
 * 用法：
 *   node GenerateV2.js <骨架.json> <目标图.txt> --out <关卡.json> [--recipe <配方.json>]
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
  if (!archFile || !targetFile) { console.error('用法: node GenerateV2.js <骨架.json> <目标图.txt> --out <关卡.json> [--recipe <配方.json>]'); process.exit(2); }
  const arch = JSON.parse(fs.readFileSync(archFile, 'utf8'));
  const blocks = parse(targetFile);
  const H = blocks.length, W = blocks[0].length;
  const subs = detect(blocks);
  const { st, classOf } = classify(blocks, subs);
  const colors = Object.keys(st).map(Number).sort((a, b) => st[b].px - st[a].px);
  const newQuad = {}; subs.forEach(s => { newQuad[quadOf(s, H, W)] = s; });
  const stageQuads = arch.stageQuadrants || ['BL', 'TL', 'TR', 'BR'];
  const frame = {}, frameColors = new Set();
  for (let i = 1; i <= 4; i++) {
    const s = newQuad[stageQuads[i - 1]];
    if (!s) throw new Error('目标图 ' + stageQuads[i - 1] + ' 没有主体');
    const si = subs.indexOf(s);
    const excl = colors.filter(c => st[c].subs.size === 1 && st[c].subs.has(si));
    const pick = (excl[0] != null ? excl[0] : colors.find(c => st[c].subs.has(si)));
    frame[i] = pick; frameColors.add(pick);
  }
  const key = (r, c) => r + ',' + c;
  const cells = [];
  for (let r = 0; r < arch.maprow; r++) for (let c = 0; c < arch.mapcol; c++) {
    const a = arch.cells[r][c]; if (a && a.role !== 'black') cells.push({ r, c, a });
  }
  const assigned = {}, used = {};
  // 框：door/frame2（拓扑固定）
  for (const cl of cells) if (cl.a.role === 'door' || cl.a.role === 'frame2') { assigned[key(cl.r, cl.c)] = frame[cl.a.stage]; used[frame[cl.a.stage]] = (used[frame[cl.a.stage]] || 0) + 1; }
  // 自由格：roles 重推（class + 尺寸排名 + 象限）
  const free = cells.filter(x => x.a.role !== 'door' && x.a.role !== 'frame2').sort((a, b) => (b.a.refCount || 1) - (a.a.refCount || 1));
  const nonFrame = colors.filter(c => !frameColors.has(c));
  const colorOrder = nonFrame.slice().sort((a, b) => st[b].px - st[a].px);
  for (const x of free) {
    const cellRole = x.a.role;
    const cellQuads = new Set((x.a.subs || []).map(si => arch.subjectQuads ? arch.subjectQuads[si] : null).filter(Boolean));
    const rankSlot = free.indexOf(x) / Math.max(1, free.length);
    let best = null, bestScore = -1e9;
    for (const c of colorOrder) {
      const cls = classOf(c);
      const exact = cls === cellRole ? 40 : 0;
      const fam = (cls.startsWith('debt') && cellRole.startsWith('debt')) ? 20 : 0;
      const rankColor = colorOrder.indexOf(c) / Math.max(1, colorOrder.length);
      const sizeScore = 30 * (1 - Math.abs(rankSlot - rankColor));
      const cQuads = new Set([...st[c].subs].map(si => quadOf(subs[si], H, W)));
      let qm = 0; for (const q of cellQuads) if (cQuads.has(q)) qm++;
      const score = exact + fam + sizeScore + qm * 15 + (used[c] ? 0 : 10);
      if (score > bestScore) { bestScore = score; best = c; }
    }
    assigned[key(x.r, x.c)] = best; used[best] = (used[best] || 0) + 1;
  }
  // 容量
  const cap = {};
  const cellsByColor = {};
  for (const cl of cells) { const c = assigned[key(cl.r, cl.c)]; (cellsByColor[c] = cellsByColor[c] || []).push(cl); }
  for (const c of Object.keys(cellsByColor)) {
    const list = cellsByColor[c], total = st[c].px;
    const weights = list.map(x => x.a.refCount || 1), sum = weights.reduce((a, b) => a + b, 0);
    const caps = weights.map(w => Math.max(1, Math.round(total * w / sum)));
    let diff = total - caps.reduce((a, b) => a + b, 0); let idx = caps.indexOf(Math.max(...caps)); caps[idx] += diff;
    for (let i = 0; i < caps.length; i++) if (caps[i] < 1) { caps[i] = 1; caps[idx] -= 1; }
    list.forEach((x, i) => { cap[key(x.r, x.c)] = caps[i]; });
  }
  const build = () => {
    const spools = Array.from({ length: arch.maprow }, () => Array.from({ length: arch.mapcol }, () => ({ id: -1, type: 0, param: 0, count: 0 })));
    for (const cl of cells) {
      const a = cl.a, color = assigned[key(cl.r, cl.c)], count = cap[key(cl.r, cl.c)] || 1;
      const types = [], params = [];
      if (a.ice) { types.push(7); params.push(a.ice); }
      if (a.chain) { types.push(5); params.push(a.chain); }
      if (a.q) { types.push(6); params.push(0); }
      spools[cl.r][cl.c] = { id: color, type: types.length === 0 ? 0 : types.length === 1 ? types[0] : types, param: params.length === 0 ? 0 : params.length === 1 ? params[0] : params, count };
    }
    return { toprow: H, blocks, maprow: arch.maprow, mapcol: arch.mapcol, spools };
  };
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
    let culprit = null;
    for (let i = picks.length - 1; i >= 0; i--) {
      const p = picks[i], rc = reach[p.r + ',' + p.c];
      if (rc == null) continue;
      const cp = cap[p.r + ',' + p.c];
      if (cp > rc) { culprit = { p, rc, cp }; break; }
    }
    if (!culprit) {
      const p = picks[picks.length - 1];
      if (!p) break;
      const k = p.r + ',' + p.c;
      if (cap[k] > 1) { cap[k]--; continue; }
      break;
    }
    const color = assigned[culprit.p.r + ',' + culprit.p.c];
    const over = culprit.cp - culprit.rc;
    cap[culprit.p.r + ',' + culprit.p.c] = Math.max(1, culprit.rc);
    const later = (cellsByColor[color] || []).filter(x => !(x.r === culprit.p.r && x.c === culprit.p.c))
      .sort((a, b) => (b.r + b.c) - (a.r + a.c))[0];
    if (later) {
      const lk = later.r + ',' + later.c;
      cap[lk] = (cap[lk] || 1) + over;
    } else {
      cap[culprit.p.r + ',' + culprit.p.c] += over;
      break;
    }
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
    fs.writeFileSync(recipeOut, JSON.stringify({ name: 'genv2_' + arch.name, target: targetFile, toprow: H, maprow: arch.maprow, mapcol: arch.mapcol, cars, black, obstacles, notes: { archetype: archFile, frames: frame } }, null, 2));
  }
  console.log('骨架=' + arch.name + ' 图=' + targetFile.split('/').pop());
  console.log('框色: ' + [1, 2, 3, 4].map(i => frame[i]).join('/'));
  console.log('best: min=' + (ev.minWon ? '通' : '不通') + ' ' + ev.boxes + ' peak=' + ev.peak + ' player2=' + ev.pass + '/5 score=' + ev.score);
  if (out) console.log('已写：' + out);
}

try { main(); } catch (e) { console.error('失败：' + e.message); process.exit(1); }
