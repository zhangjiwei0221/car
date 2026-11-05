#!/usr/bin/env node
'use strict';
/**
 * GenerateV1 —— 图 + 角色骨架 → 自动生成关卡（v2.0 P2：角色感知映射 + 曲线容量）
 *
 * 用法：
 *   node GenerateV1.js <骨架.json> <目标图.txt> --out <关卡.json> [--recipe <配方.json>]
 *
 * 映射：
 *   1) 框色按骨架 stageQuadrants（BL/TL/TR/BR）→ 目标图对应象限主体；
 *   2) 非框色优先“源色同位”（骨架格的 refColor 在目标图存在且不是框色 → 同格同色）；
 *   3) 其余按 class + 象限匹配 + 未用优先 + 容量相近 贪心分配。
 *
 * 容量：
 *   - 若某色的骨架格全部是同 refColor 且 refCount 和 == 目标像素数 → 直接用源容量（自测应复现源关）；
 *   - 否则用“最小路线可达”迭代：门/frame2/fill 容量 ≤ 可达、debt 容量 ≈ 可达×1.8，同色守恒，迭代 3 次。
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
  if (!archFile || !targetFile) { console.error('用法: node GenerateV1.js <骨架.json> <目标图.txt> --out <关卡.json> [--recipe <配方.json>]'); process.exit(2); }
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
    if (pick == null) throw new Error('主体 ' + s.name + ' 没有可用颜色');
    frame[i] = pick; frameColors.add(pick);
  }
  const key = (r, c) => r + ',' + c;
  const cells = [];
  for (let r = 0; r < arch.maprow; r++) for (let c = 0; c < arch.mapcol; c++) {
    const a = arch.cells[r][c]; if (a && a.role !== 'black') cells.push({ r, c, a });
  }
  const assigned = {}, used = new Set();
  for (const cl of cells) if (cl.a.role === 'door' || cl.a.role === 'frame2') { assigned[key(cl.r, cl.c)] = frame[cl.a.stage]; used.add(frame[cl.a.stage]); }
  // 源色同位
  for (const cl of cells) {
    if (assigned[key(cl.r, cl.c)] != null) continue;
    const a = cl.a;
    if (a.refColor != null && st[a.refColor] && !frameColors.has(a.refColor)) { assigned[key(cl.r, cl.c)] = a.refColor; used.add(a.refColor); }
  }
  // 剩余：class + 象限 + 未用 + 容量相近
  const nonFrame = colors.filter(c => !frameColors.has(c));
  const unassigned = cells.filter(x => assigned[key(x.r, x.c)] == null).sort((a, b) => (b.a.refCount || 1) - (a.a.refCount || 1));
  for (const x of unassigned) {
    const cellQuads = new Set((x.a.subs || []).map(si => arch.subjectQuads ? arch.subjectQuads[si] : null).filter(Boolean));
    const cand = nonFrame.filter(c => classOf(c) === x.a.role);
    const pool = cand.length ? cand : nonFrame;
    let best = null, bestScore = -1e9;
    for (const c of pool) {
      const cQuads = new Set([...st[c].subs].map(si => quadOf(subs[si], H, W)));
      let qm = 0; for (const q of cellQuads) if (cQuads.has(q)) qm++;
      const r = Math.min(st[c].px, x.a.refCount || 1) / Math.max(st[c].px, x.a.refCount || 1);
      const score = qm * 100 + (used.has(c) ? 0 : 20) + r * 20;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    assigned[key(x.r, x.c)] = best; used.add(best);
  }
  // 初始容量
  const cap = {};
  const cellsByColor = {};
  for (const cl of cells) { const c = assigned[key(cl.r, cl.c)]; (cellsByColor[c] = cellsByColor[c] || []).push(cl); }
  for (const c of Object.keys(cellsByColor)) {
    const list = cellsByColor[c], total = st[c].px;
    const exact = list.every(x => x.a.refColor === +c) && list.reduce((a, x) => a + (x.a.refCount || 0), 0) === total;
    if (exact) { list.forEach(x => { cap[key(x.r, x.c)] = x.a.refCount; }); continue; }
    const weights = list.map(x => x.a.refCount || 1), sum = weights.reduce((a, b) => a + b, 0);
    const caps = weights.map(w => Math.max(1, Math.round(total * w / sum)));
    let diff = total - caps.reduce((a, b) => a + b, 0); let idx = caps.indexOf(Math.max(...caps)); caps[idx] += diff;
    for (let i = 0; i < caps.length; i++) if (caps[i] < 1) { caps[i] = 1; caps[idx] -= 1; }
    list.forEach((x, i) => { cap[key(x.r, x.c)] = caps[i]; });
  }
  // 迭代容量
  let best = null;
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
  const srcExact = Object.keys(cellsByColor).every(c => cellsByColor[c].every(x => x.a.refColor === +c));
  if (srcExact) {
    const g = build(); const ev = evalLevel(g);
    best = { g, ev };
    console.log('源色同位 + 源容量：直接复现源关');
  } else {
    for (let iter = 0; iter < 3; iter++) {
      const g = build(); const ev = evalLevel(g);
      if (!best || ev.score > best.ev.score) best = { g: JSON.parse(JSON.stringify(g)), ev };
      const lv = A.parseLevel(A.fromGameFormat(g));
      const reach = reachMap(lv);
      for (const c of Object.keys(cellsByColor)) {
        const list = cellsByColor[c], total = st[c].px;
        const targets = list.map(x => {
          const rc = reach[key(x.r, x.c)];
          const isKey = x.a.role === 'door' || x.a.role === 'frame2' || x.a.role === 'fill';
          if (rc == null) return cap[key(x.r, x.c)] || 1;
          return isKey ? Math.max(1, rc) : Math.max(1, Math.round(rc * 1.8));
        });
        let sum = targets.reduce((a, b) => a + b, 0);
        if (sum > total) {
          const debtIdx = list.map((x, i) => (x.a.role.startsWith('debt') ? i : -1)).filter(i => i >= 0);
          const pool = debtIdx.length ? debtIdx : list.map((_, i) => i);
          let excess = sum - total;
          const poolSum = pool.reduce((a, i) => a + targets[i], 0) || 1;
          for (const i of pool) { const cut = Math.round(excess * targets[i] / poolSum); targets[i] = Math.max(1, targets[i] - cut); }
          sum = targets.reduce((a, b) => a + b, 0);
          if (sum > total) { // 还超就按比例压
            const scale = total / sum; for (let i = 0; i < targets.length; i++) targets[i] = Math.max(1, Math.floor(targets[i] * scale));
          }
        } else if (sum < total) {
          const debtIdx = list.map((x, i) => (x.a.role.startsWith('debt') ? i : -1)).filter(i => i >= 0);
          const pool = debtIdx.length ? debtIdx : [targets.indexOf(Math.max(...targets))];
          targets[pool[0]] += total - sum;
        }
        // 修正总和
        let diff = total - targets.reduce((a, b) => a + b, 0);
        const adj = list.map((x, i) => (x.a.role.startsWith('debt') ? i : -1)).filter(i => i >= 0);
        targets[(adj.length ? adj[0] : targets.indexOf(Math.max(...targets)))] += diff;
        list.forEach((x, i) => { cap[key(x.r, x.c)] = Math.max(1, targets[i]); });
      }
    }
  }
  const g = best.g;
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
    fs.writeFileSync(recipeOut, JSON.stringify({ name: 'gen_' + arch.name, target: targetFile, toprow: H, maprow: arch.maprow, mapcol: arch.mapcol, cars, black, obstacles, notes: { archetype: archFile, frames: frame, srcExact } }, null, 2));
  }
  console.log('骨架=' + arch.name + ' 图=' + targetFile.split('/').pop());
  console.log('框色: ' + [1, 2, 3, 4].map(i => frame[i]).join('/') + '  源色同位=' + (srcExact ? '是' : '否'));
  console.log('best: min=' + (best.ev.minWon ? '通' : '不通') + ' ' + best.ev.boxes + ' peak=' + best.ev.peak + ' player2=' + best.ev.pass + '/5 score=' + best.ev.score);
  if (out) console.log('已写：' + out);
}

try { main(); } catch (e) { console.error('失败：' + e.message); process.exit(1); }
