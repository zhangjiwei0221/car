#!/usr/bin/env node
'use strict';
/**
 * GenBest_v784 —— 扩大搜索 + 多样性选择
 *
 * 用户 2026-11-02：「① 扩大搜索 + 多样性选择」
 *
 * 流程：
 *   1. 同一张图跑 N 个种子（每个种子完整走一遍产线）
 *   2. 用 ArlCheck 的十项标准过滤
 *   3. 在达标的候选里：优先选"链形态少见"的，其次按 at4 高
 *
 * 用法：node GenBest_v784.js --target 图.txt --seeds 12 --outdir 目录
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.resolve(__dirname, '../..');
const T = '03_工具/正式版';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const TARGET = arg('--target', '');
const SEEDS = Number(arg('--seeds', 12));
const OUTDIR = arg('--outdir', '/tmp/genbest');
const BASE = Number(arg('--base-seed', 20261030));
const B = require('./Build006Thickness_v688');
const A = B.loadSolver('corner');

function run(args) {
  const r = spawnSync('node', args, { cwd: ROOT, encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout || '') + (r.stderr || '') };
}
function evaluate(f) {
  const g = B.readJson(f);
  const o = A.Solver.runSolver(A.parseLevel(A.fromGameFormat(g)), 0, 1, false, false, { capturePreviewStats: true, instantChain: false });
  const buf = (o.pressureSamples || []).map(s => s.buf || 0);
  const N = buf.length, eN = Math.max(1, Math.round(N * 0.2)), tN = Math.floor(N * 0.8);
  let a4 = 0, r4 = 0, c = 0;
  for (const v of buf) { if (v >= 4) { a4++; c++; r4 = Math.max(r4, c); } else c = 0; }
  const e4 = buf.slice(0, eN).filter(v => v >= 4).length;
  const free = buf.slice(0, eN).filter(v => v === 0).length;
  const t3 = buf.slice(tN).filter(v => v >= 3).length;
  let tr = 0; c = 0;
  for (const v of buf.slice(tN)) { if (v >= 3) { c++; tr = Math.max(tr, c); } else c = 0; }
  let empty = 0, sum = 0;
  for (const row of g.spools) for (const s of row) {
    const t = s ? (Array.isArray(s.type) ? s.type : [s.type || 0]) : [];
    if (t.some(x => x >= 11 && x <= 14)) { (Array.isArray(s.param) ? s.param : []).forEach(b => sum += (b.count || 0)); continue; }
    if (s && s.id === -1) continue;
    if (!s || !s.id || s.id <= 0) { empty++; continue; }
    sum += s.count;
  }
  // 链形态签名
  const gr = {};
  for (const row of g.spools) for (const s of row) {
    const t = s ? (Array.isArray(s.type) ? s.type : [s.type || 0]) : [];
    if (s && s.id > 0 && t.includes(5)) (gr[s.param] = gr[s.param] || []).push(1);
  }
  const sig = Object.values(gr).map(v => v.length).sort((a, b) => b - a).join('+') || '无链';
  const pass = o.completed && Math.max(0, ...buf) === 4 && a4 >= 20 && r4 >= 10 && e4 === 0 && free <= 6 && t3 >= 3 && tr >= 3 && empty === 0 && sum === g.blocks.flat().length;
  return { pass, a4, r4, e4, free, t3, tr, peak: Math.max(0, ...buf), sig, file: f };
}

fs.mkdirSync(OUTDIR, { recursive: true });
const results = [];
for (let i = 0; i < SEEDS; i++) {
  const seed = BASE + i * 7;
  const dir = path.join(OUTDIR, 's' + seed);
  fs.mkdirSync(dir, { recursive: true });
  run([`${T}/_ProduceOne_v747.js`, '--target', TARGET, '--outdir', dir, '--tier', 'std', '--attempts', '1', '--seed', String(seed)]);
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.plan.json'));
  if (!files.length) { console.log(`seed ${seed}: 无产物`); continue; }
  // 加上感受优化（400 轮）+ 障碍预算
  const plan = path.join(dir, files[0]);
  const build = plan.replace(/\.a\d+\.plan\.json$/, '.a1.build.json');
  let cur = fs.existsSync(build) ? build : plan;
  const fz = path.join(dir, 'fz.json');
  run([`${T}/FeelBuild_v766.js`, cur, '--out', fz, '--iters', '400']);
  if (fs.existsSync(fz)) cur = fz;
  const bd = path.join(dir, 'bud.json');
  run([`${T}/ObstacleBudget_v770.js`, cur, '--out', bd, '--chain-groups', '2', '--ice', '0']);
  if (fs.existsSync(bd)) cur = bd;
  const m = evaluate(cur);
  console.log(`seed ${seed}: at4=${m.a4} run4=${m.r4} 免费${m.free} 后段${m.t3} 链=${m.sig} → ${m.pass ? '✅' : '❌'}`);
  results.push(m);
}
const passing = results.filter(r => r.pass);
if (!passing.length) { console.log('\n❌ 没有达标候选'); process.exit(1); }
// 统计本批的形态分布
const cnt = {};
passing.forEach(r => cnt[r.sig] = (cnt[r.sig] || 0) + 1);
// 优先选"本批最少见"的形态；同形态内取 at4 最高
passing.sort((a, b) => {
  const ra = cnt[a.sig], rb = cnt[b.sig];
  if (ra !== rb) return ra - rb;
  return b.a4 - a.a4;
});
const best = passing[0];
const out = path.join(OUTDIR, 'BEST.json');
fs.copyFileSync(best.file, out);
console.log(`\n本批达标 ${passing.length}/${results.length}，形态分布:`, JSON.stringify(cnt));
console.log(`★ 选中: ${best.sig} at4=${best.a4} run4=${best.r4}`);
console.log('  →', out);
