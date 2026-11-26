#!/usr/bin/env node
'use strict';
/**
 * PathAlignCheck_v1 —— 校验“点击路径 JSON”是否真对应某张关卡
 *
 * 用户 2026-11-16 担心：导出的路径可能和当前客户端/编辑器的关卡对不上。
 * 导出文件里 session.level.name 可能是 null，所以不能靠名字，只能逐点击回放核对。
 *
 * 检查四项：
 *   1. 目标图尺寸（session.level.rows/cols）与关卡 blocks 一致；
 *   2. 总像素（session.level.totalPixels）与关卡非零像素一致；
 *   3. 棋盘行列（session.layout）与 maprow/mapcol 一致；
 *   4. 逐点击回放：该格车辆的颜色/容量与路径记录一致，且全程合法。
 *
 * 用法：
 *   node PathAlignCheck_v1.js <路径.json> --level <关卡.json>
 *   node PathAlignCheck_v1.js <路径.json> --dir <目录>     # 在目录里逐张试，报最匹配的
 */
const fs = require('fs');
const path = require('path');
const B = require('./Build006Thickness_v688');
const A = B.loadSolver('corner');
const Sim = A.Simulator, St = A.SolverStrategy;

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i > 0 ? argv[i + 1] : d; };
const pfile = argv[0];
if (!pfile) { console.error('用法: node PathAlignCheck_v1.js <路径.json> --level <关卡.json> | --dir <目录>'); process.exit(2); }

const P = JSON.parse(fs.readFileSync(pfile, 'utf8'));
const sess = P.session || {};
const L = sess.level || {};
const lay = sess.layout || {};

function levelInfo(file) {
  const g = JSON.parse(fs.readFileSync(file, 'utf8'));
  const rows = g.blocks.length, cols = g.blocks[0].length;
  const total = g.blocks.flat().filter(v => v > 0).length;
  return { g, rows, cols, total, maprow: g.maprow, mapcol: g.mapcol };
}

function replay(file) {
  const lv = A.parseLevel(A.fromGameFormat(JSON.parse(fs.readFileSync(file, 'utf8'))));
  let s = Sim.createState(lv, { useSlotStart: true, instantChain: false });
  const issues = [];
  for (const ck of (P.clicks || [])) {
    const box = s.cells[ck.r] && s.cells[ck.r][ck.c];
    if (!box || box.t !== 'box') { issues.push(`step ${ck.n}: (${ck.r},${ck.c}) 不是车/已被拿走`); break; }
    const rec = (ck.picked && ck.picked[0]) || {};
    if (rec.color != null && box.color !== rec.color) issues.push(`step ${ck.n}: 颜色 ${box.color}≠${rec.color}`);
    if (rec.count != null && box.count !== rec.count) issues.push(`step ${ck.n}: 容量 ${box.count}≠${rec.count}`);
    if (issueCount(issues) >= 3) break;
    if (!Sim.applyPick(s, ck.r, ck.c)) { issues.push(`step ${ck.n}: applyPick 失败`); break; }
  }
  return { issues, steps: (P.clicks || []).length, won: s.eliminatedPixels >= s.totalPixels };
}
const issueCount = (a) => a.length;

function check(file) {
  const info = levelInfo(file);
  const out = { file: path.basename(file), checks: {}, ok: false };
  out.checks.size = (L.rows === info.rows && L.cols === info.cols) ? `✓ ${info.rows}x${info.cols}` : `✗ 路径 ${L.rows}x${L.cols} vs 关卡 ${info.rows}x${info.cols}`;
  out.checks.totalPx = (L.totalPixels === info.total) ? `✓ ${info.total}` : `✗ 路径 ${L.totalPixels} vs 关卡 ${info.total}`;
  out.checks.layout = (lay.rows === info.maprow && lay.cols === info.mapcol) ? `✓ ${info.maprow}x${info.mapcol}` : `✗ 路径 ${lay.rows}x${lay.cols} vs 关卡 ${info.maprow}x${info.mapcol}`;
  const r = replay(file);
  out.checks.replay = r.issues.length ? `✗ ${r.issues[0]}` : `✓ ${r.steps} 步全程合法（${r.won ? '通关' : '未通关'}）`;
  out.ok = !out.checks.size.startsWith('✗') && !out.checks.totalPx.startsWith('✗') &&
           !out.checks.layout.startsWith('✗') && !out.checks.replay.startsWith('✗');
  return out;
}

const levelFile = arg('--level', '');
const dir = arg('--dir', '');
if (levelFile) {
  console.log(JSON.stringify(check(levelFile), null, 1));
} else if (dir) {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => path.join(dir, f));
  const res = files.map(f => { try { return check(f); } catch (e) { return { file: path.basename(f), ok: false, error: e.message }; } });
  const ok = res.filter(r => r.ok);
  console.log(JSON.stringify({ path: path.basename(pfile), matched: ok, tried: res.length }, null, 1));
} else {
  console.log(JSON.stringify({ session: { level: L, layout: lay }, clicks: (P.clicks || []).length }, null, 1));
}
