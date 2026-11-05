#!/usr/bin/env node
'use strict';
/**
 * AssignArchetype_v1 —— 图 + 角色骨架 → 自动生成关卡（v2.0 P2 第一步）
 *
 * 用法：
 *   node AssignArchetype_v1.js <骨架.json> <目标图.txt> --out <关卡.json> [--recipe <配方.json>]
 *
 * 做什么：
 *   1. 目标图：识别四主体、每主体独占框色、颜色材料分类（shared/cross/bgSubj/interior/fill）；
 *   2. 骨架：door/frame2 按 stage 给框色；debtS/debtB/debtI/fill 按类 class 轮转分配颜色；
 *   3. 容量：同色像素按骨架格的 refCount 权重分配（基线，不是最终解）；
 *   4. 障碍：沿用骨架的 ice/chain/q；
 *   5. 评估：最小暂存路线（通/峰值）+ PlayerSim 5 seeds（2 复活）。
 *
 * 这是“独立生成”的第一版：颜色/容量是启发式基线；下一步用 ReachabilityCurve 包络做容量求解。
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
    const c = blocks[y][x];
    if (c <= 0) continue;
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
  return { st, classOf, subOf };
}

function quadOf(s, H, W) {
  let sy = 0, sx = 0, n = 0;
  for (const key of s.cells) { const [y, x] = key.split(',').map(Number); sy += y; sx += x; n++; }
  const cy = sy / n, cx = sx / n;
  return (cy >= H / 2 ? 'B' : 'T') + (cx < W / 2 ? 'L' : 'R');
}

function main() {
  const archFile = process.argv[2], targetFile = process.argv[3];
  const out = arg('--out', ''), recipeOut = arg('--recipe', '');
  if (!archFile || !targetFile) {
    console.error('用法: node AssignArchetype_v1.js <骨架.json> <目标图.txt> --out <关卡.json> [--recipe <配方.json>]');
    process.exit(2);
  }
  const arch = JSON.parse(fs.readFileSync(archFile, 'utf8'));
  const blocks = parse(targetFile);
  const H = blocks.length, W = blocks[0].length;
  const subs = detect(blocks);
  const { st, classOf } = classify(blocks, subs);
  const colors = Object.keys(st).map(Number).sort((a, b) => st[b].px - st[a].px);
  const subjByQuad = {};
  subs.forEach(s => { subjByQuad[quadOf(s, H, W)] = s; });
  const stageQuads = ['BL', 'TL', 'TR', 'BR'];
  const frame = {}, frameColors = new Set();
  for (let i = 1; i <= 4; i++) {
    const s = subjByQuad[stageQuads[i - 1]];
    if (!s) throw new Error('目标图 ' + stageQuads[i - 1] + ' 没有主体');
    const si = subs.indexOf(s);
    const excl = colors.filter(c => st[c].subs.size === 1 && st[c].subs.has(si));
    const pick = (excl[0] != null ? excl[0] : colors.filter(c => st[c].subs.has(si))[0]);
    if (pick == null) throw new Error('主体 ' + s.name + ' 没有可用颜色');
    frame[i] = pick; frameColors.add(pick);
  }
  const key = (r, c) => r + ',' + c;
  const cells = [];
  for (let r = 0; r < arch.maprow; r++) for (let c = 0; c < arch.mapcol; c++) {
    const a = arch.cells[r][c];
    if (a && a.role !== 'black') cells.push({ r, c, a });
  }
  const assign = {};
  for (const cl of cells) if (cl.a.role === 'door' || cl.a.role === 'frame2') assign[key(cl.r, cl.c)] = frame[cl.a.stage];
  const colorByClass = { debtS: [], debtC: [], debtB: [], debtI: [], fill: [] };
  for (const c of colors) if (!frameColors.has(c)) colorByClass[classOf(c)].push(c);
  const cellsByRole = {};
  for (const cl of cells) (cellsByRole[cl.a.role] = cellsByRole[cl.a.role] || []).push(cl);
  // 没有对应格子的类，合并到 debtS / debtI
  for (const cls of ['debtC', 'debtB', 'fill']) {
    if (!(cellsByRole[cls] || []).length && colorByClass[cls].length) {
      const target = (cellsByRole.debtS || []).length ? 'debtS' : 'debtI';
      colorByClass[target] = colorByClass[target].concat(colorByClass[cls]);
      colorByClass[cls] = [];
    }
  }
  for (const cls of ['debtS', 'debtB', 'debtI']) {
    const cs = colorByClass[cls].slice().sort((a, b) => st[b].px - st[a].px);
    const cl = (cellsByRole[cls] || []).slice().sort((a, b) => (b.a.refCount || 1) - (a.a.refCount || 1));
    if (!cl.length) continue;
    if (!cs.length) continue;
    cl.forEach((x, i) => { assign[key(x.r, x.c)] = cs[i % cs.length]; });
  }
  // 还没分到颜色的格子 / 还没用到的颜色：互相补
  const used = new Set(Object.values(assign));
  const unassignedCells = cells.filter(x => assign[key(x.r, x.c)] == null);
  const unusedColors = colors.filter(c => !used.has(c));
  unassignedCells.forEach((x, i) => { if (unusedColors.length) assign[key(x.r, x.c)] = unusedColors[i % unusedColors.length]; else assign[key(x.r, x.c)] = colors[i % colors.length]; });
  // 容量：同色按 refCount 权重分像素
  const byColor = {};
  for (const cl of cells) { const c = assign[key(cl.r, cl.c)]; (byColor[c] = byColor[c] || []).push(cl); }
  const cap = {};
  for (const c of Object.keys(byColor)) {
    const list = byColor[c], total = st[c].px;
    const weights = list.map(x => x.a.refCount || 1);
    const sum = weights.reduce((a, b) => a + b, 0);
    const caps = weights.map(w => Math.max(1, Math.round(total * w / sum)));
    let diff = total - caps.reduce((a, b) => a + b, 0);
    let idx = caps.indexOf(Math.max(...caps));
    caps[idx] += diff;
    // 若最大格被减到 <1，向前一个格借
    for (let i = 0; i < caps.length; i++) if (caps[i] < 1) { caps[i] = 1; caps[idx] -= 1; }
    list.forEach((x, i) => { cap[key(x.r, x.c)] = caps[i]; });
  }
  // 建 spools
  const spools = Array.from({ length: arch.maprow }, () => Array.from({ length: arch.mapcol }, () => ({ id: -1, type: 0, param: 0, count: 0 })));
  for (const cl of cells) {
    const a = cl.a, color = assign[key(cl.r, cl.c)], count = cap[key(cl.r, cl.c)];
    const types = [], params = [];
    if (a.ice) { types.push(7); params.push(a.ice); }
    if (a.chain) { types.push(5); params.push(a.chain); }
    if (a.q) { types.push(6); params.push(0); }
    spools[cl.r][cl.c] = {
      id: color,
      type: types.length === 0 ? 0 : (types.length === 1 ? types[0] : types),
      param: params.length === 0 ? 0 : (params.length === 1 ? params[0] : params),
      count
    };
  }
  const level = { toprow: H, blocks, maprow: arch.maprow, mapcol: arch.mapcol, spools };
  // 配方
  if (recipeOut) {
    const cars = [], black = [], obstacles = [];
    for (let r = 0; r < arch.maprow; r++) for (let c = 0; c < arch.mapcol; c++) {
      const s = spools[r][c];
      if (s.id === -1) { black.push([r, c]); continue; }
      if (s.id > 0) cars.push({ r, c, id: s.id, count: s.count });
      const t = Array.isArray(s.type) ? s.type : [s.type || 0];
      const p = Array.isArray(s.param) ? s.param : [s.param || 0];
      if (t.length === 1 && t[0]) obstacles.push({ r, c, types: [{ type: t[0], param: p[0] || 0 }] });
      else if (t.some(x => x)) obstacles.push({ r, c, type: t, param: p });
    }
    fs.writeFileSync(recipeOut, JSON.stringify({ name: 'auto_' + arch.name, target: targetFile, toprow: H, maprow: arch.maprow, mapcol: arch.mapcol, cars, black, obstacles, notes: { archetype: archFile, frames: frame } }, null, 2));
  }
  if (out) fs.writeFileSync(out, JSON.stringify(level));
  // 评估
  const lv = A.parseLevel(A.fromGameFormat(level));
  const mb = A.Solver.runMinBuffer(lv, { depth: 3, instantChain: false });
  const peak = Math.max(0, ...(mb.stepBufferHistory || []));
  let pass = 0;
  for (let seed = 7; seed < 12; seed++) {
    const pr = A.PlayerSim.run(lv, { seed, instantChain: false, reviveCap: 2, capturePreviewStats: false });
    if (pr.won) pass++;
  }
  console.log('骨架=' + arch.name + ' 图=' + targetFile.split('/').pop());
  console.log('框色 stage1-4: ' + [1, 2, 3, 4].map(i => frame[i]).join('/'));
  console.log('颜色分类: ' + Object.keys(colorByClass).map(k => k + ':' + colorByClass[k].length).join(' '));
  console.log('generated: min=' + (mb.won ? '通' : '不通') + ' ' + mb.completedBoxes + '/' + mb.totalBoxes + ' peak=' + peak + ' player2=' + pass + '/5');
  if (out) console.log('已写：' + out);
}

try { main(); } catch (e) { console.error('失败：' + e.message); process.exit(1); }
