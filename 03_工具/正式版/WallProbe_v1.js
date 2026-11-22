#!/usr/bin/env node
'use strict';
/**
 * WallProbe_v1 —— 批量“墙下张力探针”（2026-11-22）
 *
 * 背景：静态底边像素统计区分不了“有张力/免疫”（BottomBandScan 实测失败）；
 * 直接测量才是可靠选择。本工具对目录下每张目标图：
 *   1) CarSplitPlan_v0 切车（7×7）
 *   2) PInterpPlayer --bottom-only --instant-chain --p 0,0.1,0.2（各 games 局）
 *   3) 汇总随意档，按“距离目标窗口中点”排序
 *
 * 用法：
 *   node WallProbe_v1.js <图片目录> [--games 20] [--seed 977] [--out 结果.json] [--work /tmp/wallprobe_<pid>] [--fast]
 *
 *   --fast：用 SplitLevel 默认切车直筛（每图约 2 秒），不走 CarSplitPlan 的加压/验收；
 *           筛出有张力的图后再走完整产线。不加 --fast 时每图数分钟。
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i > 0 ? argv[i + 1] : d; };
const DIR = argv[0];
if (!DIR || DIR.startsWith('--')) { console.error('用法: node WallProbe_v1.js <图片目录> [--games 20] [--seed 977] [--out 结果.json]'); process.exit(2); }
const GAMES = Number(arg('--games', 20));
const SEED = Number(arg('--seed', 977));
const OUT = arg('--out', null);
const WORK = arg('--work', `/tmp/wallprobe_${process.pid}`);
const FAST = argv.includes('--fast'); // 默认切车直筛（SplitLevel，不走 CarSplitPlan 加压/验收）
const ROOT = path.resolve(__dirname, '../..');
const TOOLS = path.join(ROOT, '03_工具/正式版');
fs.mkdirSync(WORK, { recursive: true });

const files = fs.readdirSync(DIR).filter(f => f.endsWith('.txt')).sort();
const rows = [];
for (const f of files) {
  const src = path.join(DIR, f);
  const name = f.replace(/\.txt$/, '');
  const outDir = path.join(WORK, name);
  try {
    fs.mkdirSync(outDir, { recursive: true });
    let lvPath;
    if (FAST) {
      lvPath = path.join(outDir, 'lv.json');
      execFileSync('node', [path.join(TOOLS, 'SplitLevel_v722.js'), '--target', src, '--out', lvPath, '--rows', '7', '--cols', '7'], { stdio: 'ignore' });
    } else {
      execFileSync('node', [path.join(TOOLS, 'CarSplitPlan_v0.js'), '--target', src, '--outdir', outDir, '--rows', '7', '--cols', '7', '--id', 'ZC_' + name.replace(/[^A-Za-z0-9]/g, '_')], { stdio: 'ignore' });
      const lv = fs.readdirSync(outDir).filter(x => /^关卡_.*_default\.json$/.test(x))[0];
      if (!lv) throw new Error('无 default 关卡');
      lvPath = path.join(outDir, lv);
    }
    execFileSync('node', [path.join(ROOT, '实验关/产线v5/C9_插值玩家/PInterpPlayer.js'), lvPath, '--bottom-only', '--instant-chain', '--p', '0,0.1,0.2', '--games', String(GAMES), '--seeds', String(SEED), '--out', path.join(outDir, 'q')], { stdio: 'ignore' });
    const sum = JSON.parse(fs.readFileSync(path.join(outDir, 'q', 'summary_all.json'), 'utf8'));
    const m = {}; for (const r of sum) m[r.p.toFixed(1)] = r.winRate;
    const casual = (m['0.0'] + m['0.1'] + m['0.2']) / 3;
    rows.push({ name, file: src, level: lvPath, casual: +casual.toFixed(3), p: { p0: m['0.0'], p1: m['0.1'], p2: m['0.2'] } });
  } catch (e) {
    rows.push({ name, file: src, error: String(e.message || e).slice(0, 120) });
  }
}
const ok = rows.filter(r => r.casual != null);
ok.sort((a, b) => Math.abs(a.casual - 0.64) - Math.abs(b.casual - 0.64));
const res = { dir: DIR, games: GAMES, seed: SEED, at: new Date().toISOString(), results: rows };
if (OUT) fs.writeFileSync(OUT, JSON.stringify(res, null, 1));
console.log('name              casual  (p0/p.1/p.2)');
for (const r of ok) console.log(r.name.padEnd(18), String(r.casual).padEnd(7), `(${r.p.p0}/${r.p.p1}/${r.p.p2})`);
const bad = rows.filter(r => r.casual == null);
if (bad.length) { console.log('失败:'); for (const r of bad) console.log(' ', r.name, r.error); }
