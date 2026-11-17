#!/usr/bin/env node
'use strict';
/**
 * 复现_早期链 · 三段口径统计（只读）
 *
 * 读 PInterpPlayer 输出目录（含 summary_all.json），打印：
 *   - 11 档 p 通关率
 *   - 随意档 = p0/0.1/0.2 均值；中间档 p0.3–0.7；认真档 p0.8/0.9/1.0 均值
 *   - gap = 认真 − 随意；倒序处数（p 递增时通关率下降的次数）
 *   - lt10 = 随意档三档死亡分布里 deathProgress<10% 的局数（合计/300）
 *
 * 用法：node _三段统计.js <pinterp输出目录>
 */
const fs = require('fs');
const path = require('path');

const dir = process.argv[2];
if (!dir) { console.error('用法: node _三段统计.js <pinterp输出目录>'); process.exit(2); }
const rows = JSON.parse(fs.readFileSync(path.join(dir, 'summary_all.json'), 'utf8')).sort((a, b) => a.p - b.p);
const byP = {};
for (const r of rows) byP[Math.round(r.p * 10) / 10] = r;
const val = (p) => byP[p] ? byP[p].winRate : null;
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

const ps = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
const curve = ps.map(val);
let inversions = 0;
for (let i = 1; i < curve.length; i++) if (curve[i] != null && curve[i - 1] != null && curve[i] < curve[i - 1]) inversions++;
const casual = mean([val(0), val(0.1), val(0.2)].filter(v => v != null));
const mid = [0.3, 0.4, 0.5, 0.6, 0.7].map(val);
const serious = mean([val(0.8), val(0.9), val(1)].filter(v => v != null));
const lt10 = [0, 0.1, 0.2].reduce((s, p) => s + ((byP[p] && byP[p].deathDist && byP[p].deathDist.lt10) || 0), 0);
const deaths = [0, 0.1, 0.2].reduce((s, p) => s + Math.round((1 - (byP[p] ? byP[p].winRate : 1)) * 100), 0);
const dist = {};
for (const k of ['lt10', 'p10_25', 'p25_50', 'p50_90', 'gt90'])
  dist[k] = [0, 0.1, 0.2].reduce((s, p) => s + (((byP[p] && byP[p].deathDist) || {})[k] || 0), 0);

console.log(JSON.stringify({
  dir,
  p: curve,
  casual: +casual.toFixed(3),
  mid: mid.map(v => v == null ? null : +v.toFixed(3)),
  serious: +serious.toFixed(3),
  gap: +(serious - casual).toFixed(3),
  inversions,
  casualDeaths: deaths,
  lt10,
  lt10Share: deaths ? +(lt10 / deaths).toFixed(3) : null,
  deathDist: dist
}, null, 1));
