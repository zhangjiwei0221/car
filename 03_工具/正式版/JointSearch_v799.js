#!/usr/bin/env node
'use strict';
/**
 * JointSearch_v799 —— 联合搜索（2026-11-03）
 *
 * 背景：三个手段各自验证过有效，但一直是单独用——
 *   · SplitLevel --by-order（容量递减）→ 修「没得选」，代价是中段压力掉
 *   · TopoSearch（黑块）            → 修「没得选/决策度」，压力基本不动
 *   · RxPrescribe（冰/三连/问号）    → 补障碍多样性，顺带修一些压力
 *
 * 本工具把它们串起来：对每个切车比例，各跑一遍拓扑 + 处方，按 13 项通过数取最好。
 *
 * 用法：
 *   node JointSearch_v799.js --target <图.txt> --outdir <目录> [--ratios 1,0.9,0.8,0.7]
 *        [--topo-seeds 1,2] [--rx-seeds 3,4] [--rows 7 --cols 7] [--jobs 1]
 *
 * 产物：<outdir>/best.json + <outdir>/report.json
 */
const fs = require('fs'), path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const TARGET = arg('--target');
const OUTDIR = arg('--outdir', path.join('输出', '联合_' + process.pid));
// OUTDIR 可能是绝对路径（/tmp/...），下面的 abs() 会处理
const ROWS = arg('--rows', '7'), COLS = arg('--cols', '7');
const REF = arg('--ref', 'corner');
const SEED = Number(arg('--seed', '20261030'));
const RATIOS = String(arg('--ratios', '1,0.9,0.8,0.7')).split(',').map(Number);
const TOPO_SEEDS = String(arg('--topo-seeds', '1,2')).split(',').map(Number);
const RX_SEEDS = String(arg('--rx-seeds', '3,4')).split(',').map(Number);
const USE_PLAN = !process.argv.includes('--no-plan');   // 障碍预算（墙/管道/冰自动选优）
const TRAPS = String(arg('--traps', '')).split(',').filter(Boolean).map(Number);   // 顺序陷阱比例
const EDGE_BIG = Number(arg('--edge-big', '0.25'));
const WITH_TOPO = process.argv.includes('--with-topo');   // 默认只扫切车，加速
const SEEDS = String(arg('--seeds', String(SEED))).split(',').filter(Boolean).map(Number);  // 多 seed 取最好

if (!TARGET) { console.error('用法：node JointSearch_v799.js --target <图.txt> --outdir <目录>'); process.exit(2); }
const OUTDIR_ABS = path.isAbsolute(OUTDIR) ? OUTDIR : path.join(ROOT, OUTDIR);
fs.mkdirSync(OUTDIR_ABS, { recursive: true });
const abs = f => path.isAbsolute(f) ? f : path.join(ROOT, f);

function run(args) {
  const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });
  return { ok: r.status === 0, out: (r.stdout || '') + (r.stderr || '') };
}

const { check } = require('./ArlCheck_v792');
function scoreOf(file) {
  try {
    const r = check(file);
    const hard = r.rules.filter(x => !x[3]);            // 排除软项/参考项
    const p = hard.filter(x => x[1]).length;
    return { p, total: hard.length, pass: r.pass, fail: hard.filter(x => !x[1]).map(x => x[0]) };
  } catch (e) { return { p: 0, pass: false, fail: ['解析失败'] }; }
}

const base = path.basename(TARGET).replace(/\.txt$/, '');
const report = [];
let best = null;
let n = 0;

const COMBOS = [];
for (const ratio of RATIOS) for (const trap of (TRAPS.length ? TRAPS : [0])) for (const sd of SEEDS) COMBOS.push({ ratio, trap, sd });

for (const { ratio, trap, sd } of COMBOS) {
  const tag = (ratio >= 1 ? 'default' : 'r' + ratio) + (trap ? '.t' + trap : '') + (SEEDS.length > 1 ? '.s' + sd : '');
  const sp = path.join(OUTDIR_ABS, `${base}.${tag}.split.json`);
  let bl = path.join(OUTDIR_ABS, `${base}.${tag}.build.json`);
  n++;

  // 1) 切车
  const spArgs = ['03_工具/正式版/SplitLevel_v722.js', '--target', TARGET, '--out', sp,
    '--rows', ROWS, '--cols', COLS];
  if (ratio < 1) spArgs.push('--by-order', '--order-ratio', String(ratio));
  if (trap > 0) { spArgs.push('--trap-ratio', String(trap), '--edge-big-ratio', String(EDGE_BIG)); }
  else if (ratio < 1) spArgs.push('--edge-big-ratio', String(EDGE_BIG));
  const r1 = run(spArgs);
  if (!fs.existsSync(abs(sp))) { console.log(`[${tag}] 切车失败`); continue; }

  // 2) 构建
  const r2 = run(['03_工具/正式版/OverlapBuild_v719.js', sp, '--out', bl,
    '--rounds', '3', '--samples', '60', '--mode', 'a', '--ref', REF, '--seed', String(sd)]);
  if (!fs.existsSync(abs(bl))) { console.log(`[${tag}] 构建失败`); continue; }
  // 障碍预算（原来漏了这一步；_ProduceOne 里是有的）
  if (USE_PLAN) {
    const pl = path.join(OUTDIR_ABS, `${base}.${tag}.plan.json`);
    run(['03_工具/正式版/ObstaclePlan_v745.js', bl, '--ref', REF, '--out', pl]);
    if (fs.existsSync(abs(pl))) bl = pl;
  }
  const s0 = scoreOf(bl);
  report.push({ stage: 'build', ratio, tag, p: s0.p, fail: s0.fail });
  console.log(`[${tag}] 仅构建：${s0.p}/${s0.total}`);
  if (!best || s0.p > best.p) best = { file: bl, p: s0.p, tag, fail: s0.fail };

  // 3) 拓扑 + 处方（默认跳过，先只扫切车参数）
  if (!WITH_TOPO) continue;
  for (const ts of TOPO_SEEDS) {
    const tp = path.join(OUTDIR_ABS, `${base}.${tag}.topo${ts}.json`);
    const r3 = run(['03_工具/正式版/TopoSearch_v797.js', bl, '--out', tp,
      '--iters', '120', '--max-black', '3', '--seed', String(SEED + ts), '--ref', REF]);
    if (!fs.existsSync(abs(tp))) continue;
    const s1 = scoreOf(tp);
    report.push({ stage: 'topo', ratio, tag, topoSeed: ts, p: s1.p, fail: s1.fail });
    console.log(`[${tag}] +拓扑(seed ${ts})：${s1.p}/${s1.total}${s1.p > s0.p ? ' ↑' : ''}`);
    if (s1.p > best.p) best = { file: tp, p: s1.p, tag, fail: s1.fail };

    for (const rs of RX_SEEDS) {
      const rx = path.join(OUTDIR_ABS, `${base}.${tag}.topo${ts}.rx${rs}.json`);
      run(['03_工具/正式版/RxPrescribe_v796.js', tp, '--out', rx, '--seed', String(SEED + rs), '--ref', REF]);
      if (!fs.existsSync(abs(rx))) continue;
      const s2 = scoreOf(rx);
      report.push({ stage: 'rx', ratio, tag, topoSeed: ts, rxSeed: rs, p: s2.p, fail: s2.fail });
      console.log(`[${tag}] +拓扑+处方(seed ${rs})：${s2.p}/${s2.total}${s2.p > s1.p ? ' ↑' : ''}`);
      if (s2.p > best.p) best = { file: rx, p: s2.p, tag, fail: s2.fail };
    }
  }
}

if (best) {
  fs.copyFileSync(abs(best.file), abs(path.join(OUTDIR_ABS, 'best.json')));
  console.log(`\n=== 最好：${best.p}/${best.total||13}（${best.tag}）${best.fail.length ? '，仍差：' + best.fail.join('、') : '，全部通过'}`);
  console.log('已写', path.join(OUTDIR_ABS, 'best.json'));
}
fs.writeFileSync(abs(path.join(OUTDIR_ABS, 'report.json')), JSON.stringify({ target: TARGET, best, report }, null, 2));
process.exit(best && best.pass ? 0 : 1);
