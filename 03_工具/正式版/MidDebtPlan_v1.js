#!/usr/bin/env node
'use strict';
/**
 * MidDebtPlan_v1 —— 中段债规划（A 方案：安全优先，mid 15–35）
 *
 * 思路：当前 v1 切法把债都放在开局，中段没有可持续的债；单旋钮抬不动 mid。
 * 做法：沿 ReachTimeline 的玩家路线，挑一个中段的车，把它加大 δ（制造债），
 *       从同色后段的车搬走 δ（总容量不变）；要求
 *         新容量 > 该步 reach（是债）且 ≤ 之后最大 reach（能还），且 ≤ 40。
 * 输出每个候选后，跑 SeedGate / RecoveryVariantCheck / ChainRatchetCheck，按 A 的目标排序：
 *       硬门全过 + ratchet PASS + mid 15–40，mid 最大者优先。
 *
 * 用法：
 *   node MidDebtPlan_v1.js <关卡.json> --outdir <目录> [--deltas 8,12,16] [--max 12]
 *
 * 只读输入；产物写 outdir。
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const B = require('./Build006Thickness_v688');
const A = B.loadSolver('corner');
const { analyze } = require('./ReachTimeline_v1');

const ROOT = path.resolve(__dirname, '../..');
const TOOLS = path.join(ROOT, '03_工具', '正式版');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const input = process.argv[2];
const outdir = path.resolve(arg('--outdir', ''));
const deltas = String(arg('--deltas', '8,12,16')).split(',').map(Number).filter(x => x > 0);
const maxVariants = Number(arg('--max', 12));
if (!input || !outdir) {
  console.error('用法: node MidDebtPlan_v1.js <关卡.json> --outdir <目录> [--deltas 8,12,16] [--max 12]');
  process.exit(2);
}
fs.mkdirSync(outdir, { recursive: true });
const env = Object.assign({}, process.env, { PICK_REF: 'corner' });
const run = (tool, args, timeout) => {
  const r = spawnSync(process.execPath, [path.join(TOOLS, tool), ...args], {
    cwd: ROOT, env, encoding: 'utf8', timeout: timeout || 600000, maxBuffer: 64 * 1024 * 1024
  });
  return { out: (r.stdout || '') + (r.stderr ? '\n[stderr]\n' + r.stderr : ''), status: r.status };
};
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const writeJson = (f, x) => fs.writeFileSync(f, JSON.stringify(x));
const clone = x => JSON.parse(JSON.stringify(x));

function battery(levelFile) {
  const t = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mdp_' + process.pid + '_'));
  fs.copyFileSync(levelFile, path.join(t, path.basename(levelFile)));
  const out = path.join(t, 'recovery.json');
  run('RecoveryVariantCheck_v1.js', [t, '--out', out]);
  if (!fs.existsSync(out)) return null;
  return (readJson(out).rows || [])[0] || null;
}
function ratchet(levelFile) {
  const t = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mdp_rat_' + process.pid + '_'));
  const f = path.join(t, path.basename(levelFile));
  fs.copyFileSync(levelFile, f);
  const out = path.join(t, 'ratchet.json');
  run('ChainRatchetCheck_v1.js', [f, '--out', out], 900000);
  if (!fs.existsSync(out)) return { pass: false, error: 'no report' };
  const row = (readJson(out).rows || [])[0] || {};
  return { pass: !!row.pass, flags: (row.flags || []).length, traps: (row.traps || []).length };
}
function hardPass(m) {
  if (!m || !m.arl || !m.opening || !m.policy || !m.layout) return false;
  return m.arl.canPass === '✓'
    && m.opening.c0AtBufLt5 === 0
    && (m.opening.f0AtBuf3 == null || m.opening.f0AtBuf3 <= 2)
    && m.arl.open >= 5
    && m.layout.hard === 0
    && m.policy.policy2 === true
    && (m.policy.policy0 === true || m.click.clickForced === 'Y');
}

// ---------- 读关卡与 reach ----------
const g = readJson(input);
const lv = A.parseLevel(A.fromGameFormat(g));
const rep = analyze(input);
const colors = rep.colors || [];
const totalSteps = Math.max(1, ...colors.flatMap(c => (c.steps || []).map(s => s.step)));

const plans = [];
for (const c of colors) {
  const picks = (c.picks || []).slice().sort((a, b) => a.step - b.step);
  if (picks.length < 2) continue;
  for (let i = 0; i < picks.length; i++) {
    const p = picks[i];
    const frac = p.step / totalSteps;
    if (frac < 0.25 || frac > 0.65) continue;
    const future = (c.steps || []).filter(s => s.step >= p.step).map(s => s.reach);
    const maxFuture = future.length ? Math.max(...future) : 0;
    for (let j = i + 1; j < picks.length; j++) {
      const q = picks[j];
      for (const d of deltas) {
        const newCount = p.count + d;
        if (newCount > 40) continue;
        if (newCount <= p.reachAtPick + 1) continue;      // 必须是债
        if (newCount > maxFuture) continue;                // 必须能还
        if (q.count - d < 8) continue;                     // 后车不能太小
        plans.push({ color: c.color, step: p.step, frac: +frac.toFixed(2), r: p.r, c: p.c, from: p.count, to: newCount, donor: { r: q.r, c: q.c, from: q.count, to: q.count - d }, delta: d, reachAtPick: p.reachAtPick, maxFuture });
      }
    }
  }
}
// 优先中段 40–55%、δ 大
plans.sort((a, b) => Math.abs(a.frac - 0.45) - Math.abs(b.frac - 0.45) || b.delta - a.delta);
const picked = plans.slice(0, maxVariants);
console.log(`候选计划 ${plans.length} 个，取 ${picked.length} 个检查`);
if (!picked.length) { console.log('没有满足「中段债且能还」的容量重分配'); process.exit(0); }

// ---------- 生成与检查 ----------
const rows = [];
for (let i = 0; i < picked.length; i++) {
  const p = picked[i];
  const v = clone(g);
  const a = v.spools[p.r][p.c], b = v.spools[p.donor.r][p.donor.c];
  if (!a || !b) continue;
  a.count = p.to; b.count = p.donor.to;
  const tag = `MD_${p.color}_s${p.step}_d${p.delta}`;
  const f = path.join(outdir, `关卡_${tag}.json`);
  writeJson(f, v);
  const m = battery(f);
  const rat = ratchet(f);
  const arl = m && m.arl || {};
  const ok = hardPass(m) && rat.pass;
  rows.push({ tag, plan: p, file: f, arl: { peak: arl.peak, mid: arl.mid, tol: arl.tol, open: arl.open, at4: arl.at4, can: arl.canPass }, C0: m && m.opening && m.opening.c0AtBufLt5, F0: m && m.opening && m.opening.f0AtBuf3, ratchet: rat, pass: ok });
  console.log(`  ${tag}: peak=${arl.peak} mid=${arl.mid} tol=${arl.tol} open=${arl.open} C0=${m && m.opening && m.opening.c0AtBufLt5} ratchet=${rat.pass ? 'PASS' : 'FAIL'} ${ok ? 'HARD-PASS' : ''}`);
}
// A 的目标：硬门 + ratchet + mid 15–40，mid 最大
const good = rows.filter(r => r.pass && r.arl.mid >= 15 && r.arl.mid <= 40);
good.sort((a, b) => b.arl.mid - a.arl.mid);
const out = { tool: 'MidDebtPlan_v1', input, totalSteps, plans: rows, best: good[0] || null };
writeJson(path.join(outdir, '中段债报告.json'), out);
if (good[0]) console.log(`\nA 方案候选 → ${good[0].file}（mid ${good[0].arl.mid}，ratchet PASS）`);
else console.log('\n没有「硬门+ratchet+mid 15–40」的候选；判负记录见 中段债报告.json');
