#!/usr/bin/env node
'use strict';
/**
 * DebtWindowScan_v1 —— 中段债窗口扫描（2026-11-11）
 *
 * 目的：不猜哪张图能做出“有意义的债”，而是用 ReachTimeline 逐色算：
 *   在玩家路线的中段（25%–65%），是否存在某个颜色的某一辆车，
 *   被拿时 reach 低、之后 reach 变高（能还），且同色有后车可以搬容量。
 *
 * 这正是 MidDebtPlan_v1 的可行条件；本工具只做筛选，不改关卡。
 *
 * 用法：
 *   node DebtWindowScan_v1.js <关卡.json | 目录> [--out report.json] [--deltas 8,12,16]
 *
 * 输出：每关一行——可行计划数、有窗口的颜色数、最大窗口（px）、最佳颜色/步。
 */
const fs = require('fs');
const path = require('path');
const { analyze } = require('./ReachTimeline_v1');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const input = process.argv[2];
const outFile = arg('--out', null);
const deltas = String(arg('--deltas', '8,12,16')).split(',').map(Number).filter(x => x > 0);
if (!input) {
  console.error('用法: node DebtWindowScan_v1.js <关卡.json | 目录> [--out report.json] [--deltas 8,12,16]');
  process.exit(2);
}
function collect(p) {
  if (fs.statSync(p).isFile()) return [p];
  return fs.readdirSync(p).filter(f => f.endsWith('.json')).sort().map(x => path.join(p, x));
}

const rows = [];
for (const file of collect(input)) {
  let rep;
  try { rep = analyze(file); } catch (e) { rows.push({ file, error: e.message }); continue; }
  const colors = rep.colors || [];
  const total = Math.max(1, ...colors.flatMap(c => (c.steps || []).map(s => s.step)));
  let plans = 0, colorsWithWindow = 0, bestWindow = 0, best = null;
  for (const c of colors) {
    const picks = (c.picks || []).slice().sort((a, b) => a.step - b.step);
    if (picks.length < 2) continue;
    let hasWindow = false;
    for (let i = 0; i < picks.length; i++) {
      const p = picks[i];
      const frac = p.step / total;
      if (frac < 0.25 || frac > 0.65) continue;
      const future = (c.steps || []).filter(s => s.step >= p.step).map(s => s.reach);
      const maxFuture = future.length ? Math.max(...future) : 0;
      const window = maxFuture - p.reachAtPick;
      if (window > bestWindow) { bestWindow = window; best = { color: c.color, step: p.step, frac: +frac.toFixed(2), reachAtPick: p.reachAtPick, maxFuture }; }
      if (window < 10) continue;
      hasWindow = true;
      for (let j = i + 1; j < picks.length; j++) {
        const q = picks[j];
        for (const d of deltas) {
          const newCount = p.count + d;
          if (newCount <= p.reachAtPick + 1) continue;
          if (newCount > maxFuture) continue;
          if (q.count - d < 8) continue;
          plans++;
        }
      }
    }
    if (hasWindow) colorsWithWindow++;
  }
  rows.push({
    file: path.basename(file),
    plans,
    colorsWithWindow,
    bestWindow,
    best,
    totalSteps: total
  });
}
rows.sort((a, b) => (b.plans - a.plans) || (b.bestWindow - a.bestWindow));
if (outFile) fs.writeFileSync(outFile, JSON.stringify({ tool: 'DebtWindowScan_v1', rows }, null, 1));
for (const r of rows) {
  if (r.error) { console.log(r.file.padEnd(30) + ' ERROR ' + r.error); continue; }
  console.log(r.file.padEnd(30) + ' plans=' + String(r.plans).padStart(3) + ' colors=' + r.colorsWithWindow
    + ' bestWindow=' + String(r.bestWindow).padStart(3) + (r.best ? ` (色${r.best.color}@${r.best.step} ${r.best.reachAtPick}→${r.best.maxFuture})` : ''));
}
