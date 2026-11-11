#!/usr/bin/env node
'use strict';
/**
 * CarSplitPlan_v0 —— 按 reach 关系建造单张关卡（Track B / B2-B3）
 *
 * 一条链，不改目标图、不改容量总量：
 *   1) SplitLevel_v722 默认切法（edge-big；PICK_REF=corner）
 *   2) R1 放置规则：目标图 corner 色必须有车在 row0；枚举多个换位方案
 *   3) 每个方案：OverlapBuild_v719 --ref corner → RxPrescribe_v796 → 全套验收
 *   4) 选硬门全过的；没有就用 mid 最好且 can 的进 KnobPlan fix-opening 再修
 *
 * 用法：
 *   node CarSplitPlan_v0.js --target <图.txt> --outdir <目录> [--id ZC_23]
 *        [--rows 7 --cols 7 --seed 7] [--max-variants 6] [--skip-build] [--skip-knob]
 *
 * 只读目标图；产物全部写进 --outdir。输出仍是标准关卡 JSON。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const TOOLS = path.join(ROOT, '03_工具', '正式版');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.indexOf(k) > 0;

const target = arg('--target', '');
const outdir = path.resolve(arg('--outdir', ''));
const id = arg('--id', target ? path.basename(target).replace(/\.txt$/i, '') : 'level');
const rows = Number(arg('--rows', 7));
const cols = Number(arg('--cols', 7));
const seed = Number(arg('--seed', 7));
const maxVariants = Number(arg('--max-variants', 6));
const skipBuild = has('--skip-build');
const skipKnob = has('--skip-knob');

if (!target || !outdir) {
  console.error('用法: node CarSplitPlan_v0.js --target <图.txt> --outdir <目录> [--id ZC_23]');
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

function battery(levelFile, tag) {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'csp_' + process.pid + '_'));
  fs.copyFileSync(levelFile, path.join(t, path.basename(levelFile)));
  const out = path.join(t, 'recovery.json');
  const r = run('RecoveryVariantCheck_v1.js', [t, '--out', out]);
  if (!fs.existsSync(out)) return { tag, error: '验收失败: ' + r.out.slice(-400) };
  const row = readJson(out).rows[0] || {};
  row.tag = tag;
  return row;
}
/** 锁链棘轮检查：路线死锁/陷阱（见 ChainRatchetCheck_v1） */
function ratchetPass(levelFile) {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'csp_rat_' + process.pid + '_'));
  const f = path.join(t, path.basename(levelFile));
  fs.copyFileSync(levelFile, f);
  const out = path.join(t, 'ratchet.json');
  const r = run('ChainRatchetCheck_v1.js', [f, '--out', out], 900000);
  if (!fs.existsSync(out)) return { pass: false, error: r.out.slice(-300) };
  const row = readJson(out).rows[0] || {};
  return { pass: !!row.pass, flags: (row.flags || []).length, traps: (row.traps || []).length };
}
function hardPass(m) {
  if (!m || !m.arl || !m.opening || !m.policy || !m.layout) return false;
  // 低流失硬门口径（下一阶段 §3.2）：C0@buf<5 = 0；F0@buf≥3 ≤ 2；
  // 不用 OpeningCheck 的 pass 字段——它把 F0=1 也判失败，比硬门更严。
  return m.arl.canPass === '✓'
    && m.opening.c0AtBufLt5 === 0
    && (m.opening.f0AtBuf3 == null || m.opening.f0AtBuf3 <= 2)
    && m.arl.open >= 5
    && m.layout.hard === 0
    && m.policy.policy2 === true
    && (m.policy.policy0 === true || m.click.clickForced === 'Y');
}
function softScore(m) {
  let s = 0;
  if (m.arl.peak === 4) s += 3; else if (m.arl.peak === 5) s += 1;
  if (m.arl.mid >= 45 && m.arl.mid <= 80) s += 2; else if (m.arl.mid >= 40) s += 1;
  if (m.arl.tol >= 8 && m.arl.tol <= 18) s += 2; else if (m.arl.tol >= 6) s += 1;
  if (m.arl.at4 >= 1) s += 1;
  s += Math.min(1, (m.choice && m.choice.entropy || 0) / 2);
  return Math.round(s * 100) / 100;
}
const digest = m => m && m.arl ? { peak: m.arl.peak, mid: m.arl.mid, tol: m.arl.tol, open: m.arl.open, at4: m.arl.at4, can: m.arl.canPass, C0: m.opening.c0AtBufLt5, F0: m.opening.f0AtBuf3, hard: m.layout.hard, pass: hardPass(m) } : { error: m && m.error };

// ---------- 1. 切车 ----------
const baseFile = path.join(outdir, `关卡_${id}_default.json`);
if (!skipBuild) {
  const r = run('SplitLevel_v722.js', ['--target', target, '--out', baseFile, '--rows', String(rows), '--cols', String(cols)]);
  console.log('[1] 切车 ' + (r.status === 0 ? 'OK' : 'FAIL'));
  console.log(r.out.split('\n').filter(l => /棋盘|每色核对|首测|已写/.test(l)).join('\n'));
}
if (!fs.existsSync(baseFile)) { console.error('没有基线关卡：' + baseFile); process.exit(3); }

// ---------- 2. R1：枚举把 corner 色换进 row0 的方案 ----------
const lvl0 = readJson(baseFile);
const H = lvl0.blocks.length;
const cornerColor = lvl0.blocks[H - 1][0];
const nRows = lvl0.spools.length;
const variants = [];
const clone = x => JSON.parse(JSON.stringify(x));

function addVariant(tag, level, swap) {
  const f = path.join(outdir, `关卡_${id}_${tag}.json`);
  writeJson(f, level);
  variants.push({ tag, file: f, swap });
}

if ((lvl0.spools[0] || []).some(s => s.id === cornerColor)) {
  addVariant('guard0', lvl0, null);
} else {
  const cornerCars = [];
  for (let r = 1; r < nRows; r++) for (let c = 0; c < lvl0.spools[r].length; c++) {
    if (lvl0.spools[r][c].id === cornerColor) cornerCars.push([r, c]);
  }
  // 每个 row0 槽位各配一个 corner 车（槽位间不同色），上限 maxVariants
  const used = new Set();
  for (let slot = 0; slot < lvl0.spools[0].length && variants.length < maxVariants; slot++) {
    if (lvl0.spools[0][slot].id === cornerColor) continue;
    const pick = cornerCars.find(([r, c]) => !used.has(r + ',' + c));
    if (!pick) break;
    used.add(pick[0] + ',' + pick[1]);
    const v = clone(lvl0);
    const a = v.spools[0][slot], b = v.spools[pick[0]][pick[1]];
    v.spools[0][slot] = b; v.spools[pick[0]][pick[1]] = a;
    addVariant(`guard_s${slot}_r${pick[0]}c${pick[1]}`, v, { slot, from: pick, a: a.id, b: b.id });
  }
}
console.log(`[2] R1 corner 色 ${cornerColor}：${variants.length} 个换位方案`);

// ---------- 3/4/5. 每个方案：构建 → 处方 → 验收 ----------
const results = [];
const passers = [];
for (const v of variants) {
  let cur = v.file, built = false, rxed = false;
  if (!skipBuild) {
    const buildFile = path.join(outdir, `关卡_${id}_${v.tag}_build.json`);
    run('OverlapBuild_v719.js', [cur, '--out', buildFile, '--rounds', '3', '--samples', '30', '--ref', 'corner']);
    if (fs.existsSync(buildFile)) { cur = buildFile; built = true; }
    const rxFile = path.join(outdir, `关卡_${id}_${v.tag}_rx.json`);
    run('RxPrescribe_v796.js', [cur, '--out', rxFile, '--seed', String(seed), '--ref', 'corner']);
    if (fs.existsSync(rxFile)) { cur = rxFile; rxed = true; }
  }
  const m = battery(cur, v.tag);
  const rat = ratchetPass(cur);
  results.push({ tag: v.tag, swap: v.swap, built, rxed, file: cur, metrics: m, ratchet: rat });
  const ok = hardPass(m) && rat.pass;
  console.log(`  ${v.tag}: ` + JSON.stringify(digest(m)) + ' ratchet=' + (rat.pass ? 'PASS' : 'FAIL') + (ok ? ' score=' + softScore(m) : ''));
  if (ok) passers.push({ file: cur, metrics: m, from: v.tag, score: softScore(m), ratchet: rat });
}
let best = null;
if (passers.length) {
  passers.sort((a, b) => b.score - a.score);
  best = passers[0];
  console.log(`[5] 硬门全过 ${passers.length} 个，取最优 ${best.from}（score ${best.score}）`);
}
let holder = null;
if (!best) {
  const usable = results.filter(r => r.metrics && r.metrics.arl && r.metrics.arl.canPass === '✓');
  usable.sort((a, b) => (a.metrics.opening.c0AtBufLt5 - b.metrics.opening.c0AtBufLt5) || (b.metrics.arl.mid - a.metrics.arl.mid));
  if (usable.length) holder = usable[0];
}

// ---------- 6. KnobPlan 修复 ----------
if (!best && holder && !skipKnob) {
  const base = holder.file;
  const kpDir = path.join(outdir, `KnobPlan_${Date.now()}_${process.pid}`);
  run('KnobPlan_v1.js', [base, '--intent', 'fix-opening', '--out', kpDir]);
  const sumFile = path.join(kpDir, 'summary.json');
  let rowsK = [];
  if (fs.existsSync(sumFile)) rowsK = (readJson(sumFile).files && readJson(sumFile).files[0] && readJson(sumFile).files[0].rows) || [];
  console.log(`[6] KnobPlan 候选 ${rowsK.length} 个（基线 ${holder.tag}）`);
  for (const row of rowsK) {
    if (hardPass(row.metrics)) { best = { file: row.metrics.file || row.file, metrics: row.metrics, from: 'knob:' + row.id }; break; }
  }
}

// ---------- 7. 落盘 ----------
const out = {
  tool: 'CarSplitPlan_v0', generatedAt: new Date().toISOString(),
  id, target, cornerColor,
  variants: results.map(x => ({ tag: x.tag, swap: x.swap, file: x.file, digest: digest(x.metrics), ratchet: x.ratchet })),
  best: best && best.file ? { from: best.from, file: best.file, digest: digest(best.metrics), ratchet: best.ratchet } : null
};
writeJson(path.join(outdir, `建造报告_${id}.json`), out);

if (best && best.file) {
  const outLevel = path.join(outdir, `关卡_${id}_v1.json`);
  fs.copyFileSync(best.file, outLevel);
  console.log(`\n硬门全过 → ${outLevel}（来自 ${best.from}）`);
  console.log('  ' + JSON.stringify(digest(best.metrics)) + ' ratchet=' + (best.ratchet && best.ratchet.pass ? 'PASS' : 'FAIL'));
} else {
  console.log('\n没有硬门全过的候选（判负记录见 建造报告_' + id + '.json）');
}
