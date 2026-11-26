#!/usr/bin/env node
'use strict';
/**
 * ExtractArchetype_v1 —— 把一张成功关卡抽象成“角色化骨架”（v2.0 P3 第一步）
 *
 * 用法：
 *   node ExtractArchetype_v1.js <关卡.json> <阶段计划.json> --out <骨架.json>
 *
 * 输出与颜色无关的 7×7 角色模板：
 *   - black  ：黑格
 *   - door   ：阶段门（stage 1..4）
 *   - frame2 ：同框色的第二辆车（stage）
 *   - debtS  ：跨主体共享色（池债原料）
 *   - debtC  ：跨深度色（border+interior，长债原料）
 *   - debtB  ：背景+主体色（主体债原料）
 *   - debtI  ：内部色（位置债原料）
 *   - fill   ：贴边/背景（免费步原料）
 * 并保留：阶段顺序、门位置、障碍修饰（ice/chain/q）。
 * 生成器下一步按角色分配新图的颜色与容量。
 */
const B = require('./Build006Thickness_v688');
const { detect } = require('./SubjectDetect_v800');
const fs = require('fs');

function quadOf(s, H, W) {
  let sy = 0, sx = 0, n = 0;
  for (const key of s.cells) { const [y, x] = key.split(',').map(Number); sy += y; sx += x; n++; }
  return (sy / n >= H / 2 ? 'B' : 'T') + (sx / n < W / 2 ? 'L' : 'R');
}

function arg(k, d) {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : d;
}

function main() {
  const levelFile = process.argv[2], planFile = process.argv[3];
  const out = arg('--out', '');
  if (!levelFile || !planFile) {
    console.error('用法: node ExtractArchetype_v1.js <关卡.json> <阶段计划.json> --out <骨架.json>');
    process.exit(2);
  }
  const g = B.readJson(levelFile);
  const plan = B.readJson(planFile);
  const blocks = g.blocks, H = blocks.length, W = blocks[0].length;
  const subs = detect(blocks);
  const subOf = Array.from({ length: H }, () => Array(W).fill(-1));
  subs.forEach((s, i) => { for (const key of s.cells) { const [y, x] = key.split(',').map(Number); subOf[y][x] = i; } });
  // 每色材料分类
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
  // 门/框色映射
  const doorAt = {}; const frameStage = {};
  (plan.stages || []).forEach((s, i) => {
    if (s.doorCar && s.doorCar.position) doorAt[s.doorCar.position.join(',')] = i + 1;
    frameStage[Number(s.frameColor)] = i + 1;
  });
  const cells = Array.from({ length: g.spools.length }, () => Array(g.spools[0].length).fill(null));
  for (let r = 0; r < g.spools.length; r++) for (let c = 0; c < g.spools[r].length; c++) {
    const s = g.spools[r][c];
    if (!s) { cells[r][c] = { role: 'black' }; continue; }
    if (s.id === -1) { cells[r][c] = { role: 'black' }; continue; }
    const role = doorAt[r + ',' + c] ? 'door' : (frameStage[s.id] ? 'frame2' : classOf(s.id));
    const cell = { role, refCount: s.count, refColor: s.id };
    if (role === 'door' || role === 'frame2') cell.stage = doorAt[r + ',' + c] || frameStage[s.id];
    if (st[s.id]) {
      cell.material = classOf(s.id);
      cell.subs = [...st[s.id].subs];
    }
    const t = Array.isArray(s.type) ? s.type : [s.type || 0];
    const p = Array.isArray(s.param) ? s.param : [s.param || 0];
    const ices = t.map((x, i) => x === 7 ? p[i] : null).filter(x => x != null);
    if (ices.length) cell.ice = ices[0];
    if (t.includes(5)) cell.chain = p[t.indexOf(5)];
    if (t.includes(6)) cell.q = true;
    cells[r][c] = cell;
  }
  const subjectQuads = subs.map(s => quadOf(s, H, W));
  const stageQuadrants = (plan.stages || []).map(st => {
    const idx = subs.findIndex(x => x.name.split('/').pop().startsWith(st.subject));
    return idx >= 0 ? subjectQuads[idx] : null;
  });
  const archetype = {
    name: (g.name || levelFile.split('/').pop()) + '_archetype',
    subjectQuads, stageQuadrants,
    sourceLevel: levelFile,
    sourcePlan: planFile,
    maprow: g.maprow, mapcol: g.mapcol,
    subjects: subs.map(s => s.name.split('/').pop()),
    stageOrder: (plan.stages || []).map(s => s.subject),
    doors: (plan.stages || []).map((s, i) => ({ stage: i + 1, color: s.frameColor, position: s.doorCar && s.doorCar.position })),
    cells
  };
  if (out) { fs.writeFileSync(out, JSON.stringify(archetype, null, 2)); console.log('已写：' + out); }
  // 摘要
  const count = {};
  for (const row of cells) for (const c of row) count[c.role] = (count[c.role] || 0) + 1;
  console.log(JSON.stringify(count));
  console.log('doors:', JSON.stringify(archetype.doors));
}

try { main(); } catch (e) { console.error('失败：' + e.message); process.exit(1); }
