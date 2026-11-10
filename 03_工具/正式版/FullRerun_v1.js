#!/usr/bin/env node
'use strict';
/**
 * FullRerun_v1 —— 全量重跑（2026-11-10 runMinBuffer overflow 修复后）
 *
 * 范围：
 *   --scope v3（默认）：实验关/产线v3 的 关卡*.json + 现行候选 F2/pin15
 *   --scope current：v1 十批（批次_*）+ 产线v3
 *   --scope all：实验关 下全部 关卡*.json + 批次目录
 * 用户 2026-11-10 决定：v1 暂不重跑，默认 v3。
 *
 * 每个关卡依次跑：
 *   1. ClickSettleEngineCheck_v1（点击结算 forced）
 *   2. ArlCheck_v793（19 项）
 *   3. PlayerEngineCheck_v1 --family --prefer-small-debt --revives 0,2
 *
 * 产物：<outdir>/summary.jsonl（逐关追加，可断点续跑）
 *       <outdir>/summary.md（结束时汇总）
 *       <outdir>/logs/<phase>/<level>.log
 *       <outdir>/progress.log
 *       <outdir>/scope.json
 *
 * 用法：
 *   node FullRerun_v1.js [--scope current|all] [--out 目录] [--limit N] [--phase click|arl|player]
 *   --force 重跑已有记录；默认跳过 summary.jsonl 里已完成的 phase+file。
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const TOOLS = path.join(ROOT, '03_工具', '正式版');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const has = k => process.argv.indexOf(k) > 0;
const scope = arg('--scope', 'v3');
const limit = Number(arg('--limit', 0)) || 0;
const onlyPhase = arg('--phase', null);
const force = has('--force');
const outDir = path.resolve(ROOT, arg('--out', path.join('实验关/产线v3', `全量重跑_20261110_${process.pid}`)));

const PHASES = [
  { key: 'click', tool: 'ClickSettleEngineCheck_v1.js', args: f => [f], timeout: 300000 },
  { key: 'arl', tool: 'ArlCheck_v793.js', args: f => [f], timeout: 600000 },
  { key: 'player', tool: 'PlayerEngineCheck_v1.js', args: f => [f, '--family', '--prefer-small-debt', '--revives', '0,2'], timeout: 600000 }
].filter(p => !onlyPhase || p.key === onlyPhase);

function walk(dir, out, re) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out, re);
    else if (re.test(e.name)) out.push(p);
  }
  return out;
}
function isLevel(f) {
  try {
    const g = JSON.parse(fs.readFileSync(f, 'utf8'));
    return !!(g && g.toprow && Array.isArray(g.blocks) && Array.isArray(g.spools));
  } catch (e) { return false; }
}
function collect() {
  const dirs = [];
  if (scope === 'all') {
    // all：实验关下所有 关卡*.json；批次目录另按 *.json 收（批次文件名是 00004.json 这类）
    dirs.push({ dir: path.join(ROOT, '实验关'), re: /^关卡.*\.json$/ });
    for (const name of fs.readdirSync(path.join(ROOT, '实验关'))) {
      if (name.startsWith('批次_')) dirs.push({ dir: path.join(ROOT, '实验关', name), re: /\.json$/ });
    }
  } else if (scope === 'current') {
    // current：v1 十批全部 JSON + 产线v3 的 canonical 关卡*.json
    for (const name of fs.readdirSync(path.join(ROOT, '实验关'))) {
      if (name.startsWith('批次_')) dirs.push({ dir: path.join(ROOT, '实验关', name), re: /\.json$/ });
    }
    dirs.push({ dir: path.join(ROOT, '实验关', '产线v3'), re: /^关卡.*\.json$/ });
  } else {
    // v3：只跑产线v3 的 canonical 关卡*.json（v1 暂不重跑）
    dirs.push({ dir: path.join(ROOT, '实验关', '产线v3'), re: /^关卡.*\.json$/ });
  }
  const raw = [];
  for (const d of dirs) if (fs.existsSync(d.dir)) walk(d.dir, raw, d.re);
  // 现行候选里文件名不以“关卡”开头的，显式加入
  for (const extra of [
    '实验关/产线v3/00154中段/F2_68_36_30_25_19_25_21_42.json',
    '实验关/产线v3/M5批次/transfer_v7/pin006/pin15_32_pipe53.json'
  ]) {
    const p = path.join(ROOT, extra);
    if (fs.existsSync(p)) raw.push(p);
  }
  const seen = new Set();
  const files = [];
  for (const f of raw) {
    const rp = path.resolve(f);
    if (seen.has(rp)) continue;
    seen.add(rp);
    if (isLevel(rp)) files.push(rp);
  }
  return files.sort();
}
function safeName(f) {
  return path.relative(ROOT, f).replace(/[\/\\]/g, '__').replace(/[^\w一-龥.-]/g, '_');
}
function now() { return new Date().toISOString(); }
function readDone(summaryFile) {
  const done = new Set();
  if (!fs.existsSync(summaryFile)) return done;
  for (const line of fs.readFileSync(summaryFile, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { const j = JSON.parse(line); done.add(j.phase + '\t' + j.file); } catch (e) { /* ignore partial line */ }
  }
  return done;
}
function verdictOf(phase, out) {
  if (phase === 'arl') {
    const pass = /→\s*通过/.test(out);
    const fail = /→\s*不通过/.test(out);
    const can = out.match(/可通关（最小路线）[\s\S]{0,60}?([✓✗])/);
    return { pass: pass ? '通过' : (fail ? '不通过' : '?'), canPass: can ? can[1] : '?' };
  }
  if (phase === 'player') {
    const m = out.match(/solver=(\w)\(([^)]*)\)\s+forced=(\w)\(([^)]*)\)\s+policy0=(\w)\s+policy2=(\w)/);
    return m ? { solver: m[1], forced: m[3], policy0: m[5], policy2: m[6] } : {};
  }
  if (phase === 'click') {
    const m = out.match(/solver=(\w)\(([^)]*)\)\s+clickForced=(\w)\(([^)]*)\)/);
    return m ? { solver: m[1], clickForced: m[3] } : {};
  }
  return {};
}
function summarize(entries, files) {
  const lines = [];
  lines.push('# 全量重跑汇总（' + now() + '）');
  lines.push('');
  lines.push('- 范围：`' + scope + '`；关卡数：' + files.length);
  lines.push('- 输出目录：`' + path.relative(ROOT, outDir) + '`');
  lines.push('');
  for (const p of PHASES) {
    const es = entries.filter(e => e.phase === p.key);
    const ok = es.filter(e => e.ok).length;
    const bad = es.filter(e => !e.ok);
    lines.push('## ' + p.key + '：' + ok + '/' + es.length + ' 完成');
    if (p.key === 'arl') {
      const pass = es.filter(e => e.verdict && e.verdict.pass === '通过').length;
      const canY = es.filter(e => e.verdict && e.verdict.canPass === '✓').length;
      lines.push('- 19 项通过：' + pass + '；可通关 ✓：' + canY);
    }
    if (p.key === 'player') {
      const sy = es.filter(e => e.verdict && e.verdict.solver === 'Y').length;
      const fy = es.filter(e => e.verdict && e.verdict.forced === 'Y').length;
      const p0 = es.filter(e => e.verdict && e.verdict.policy0 === 'Y').length;
      lines.push('- solver Y：' + sy + '；forced Y：' + fy + '；policy0 Y：' + p0);
    }
    if (p.key === 'click') {
      const cy = es.filter(e => e.verdict && e.verdict.clickForced === 'Y').length;
      const sy = es.filter(e => e.verdict && e.verdict.solver === 'Y').length;
      lines.push('- solver Y：' + sy + '；clickForced Y：' + cy);
    }
    if (bad.length) {
      lines.push('');
      lines.push('失败/超时：');
      for (const e of bad.slice(0, 50)) lines.push('- `' + path.relative(ROOT, e.file) + '`（status=' + e.status + ', signal=' + (e.signal || '') + '）');
      if (bad.length > 50) lines.push('- …其余 ' + (bad.length - 50) + ' 条见 summary.jsonl');
    }
    lines.push('');
  }
  return lines.join('\n') + '\n';
}

const files = collect();
const selected = limit ? files.slice(0, limit) : files;
if (has('--dry-run')) {
  console.log('SCOPE=' + scope + ' FILES=' + selected.length);
  for (const f of selected) console.log(path.relative(ROOT, f));
  process.exit(0);
}
fs.mkdirSync(outDir, { recursive: true });
for (const p of PHASES) fs.mkdirSync(path.join(outDir, 'logs', p.key), { recursive: true });
const lock = path.join(outDir, 'RUN.lock');
if (fs.existsSync(lock)) {
  const pid = Number(fs.readFileSync(lock, 'utf8')) || 0;
  try { process.kill(pid, 0); console.error('already running: pid ' + pid + ' (' + lock + ')'); process.exit(1); } catch (e) { /* stale lock */ }
}
fs.writeFileSync(lock, String(process.pid));
process.on('exit', () => { try { fs.unlinkSync(lock); } catch (e) {} });

const summaryFile = path.join(outDir, 'summary.jsonl');
const progressFile = path.join(outDir, 'progress.log');
const done = force ? new Set() : readDone(summaryFile);
fs.writeFileSync(path.join(outDir, 'scope.json'), JSON.stringify({ scope, files: selected.map(f => path.relative(ROOT, f)) }, null, 2));
const plog = s => { fs.appendFileSync(progressFile, '[' + now() + '] ' + s + '\n'); };
plog('START scope=' + scope + ' files=' + selected.length + ' phases=' + PHASES.map(p => p.key).join(',') + ' out=' + path.relative(ROOT, outDir));
console.log('OUTDIR=' + path.relative(ROOT, outDir));
console.log('SCOPE=' + scope + ' FILES=' + selected.length + ' PHASES=' + PHASES.map(p => p.key).join(','));

const total = PHASES.length * selected.length;
let i = 0;
for (const phase of PHASES) {
  for (const file of selected) {
    i++;
    const key = phase.key + '\t' + file;
    if (done.has(key)) { if (i % 20 === 0) plog('skip-done ' + i + '/' + total); continue; }
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [path.join(TOOLS, phase.tool), ...phase.args(file)], {
      cwd: ROOT, encoding: 'utf8', timeout: phase.timeout, maxBuffer: 64 * 1024 * 1024
    });
    const out = (r.stdout || '') + (r.stderr ? '\n[stderr]\n' + r.stderr : '');
    const ms = Date.now() - t0;
    const ok = !r.error && r.status !== null;
    const logFile = path.join(outDir, 'logs', phase.key, safeName(file) + '.log');
    fs.writeFileSync(logFile, out);
    const firstLine = out.split('\n').map(s => s.trim()).filter(s => s && !/^=+/.test(s))[0] || '';
    const entry = {
      phase: phase.key, file, rel: path.relative(ROOT, file), ok, status: r.status,
      signal: r.signal || null, error: r.error ? String(r.error.message || r.error) : null,
      ms, line: firstLine, verdict: verdictOf(phase.key, out), log: path.relative(ROOT, logFile)
    };
    fs.appendFileSync(summaryFile, JSON.stringify(entry) + '\n');
    plog((ok ? 'OK ' : 'FAIL ') + i + '/' + total + ' ' + phase.key + ' ' + path.relative(ROOT, file) + ' (' + ms + 'ms)');
    if (i % 5 === 0 || !ok) console.log(i + '/' + total + ' ' + phase.key + ' ' + path.basename(file) + (ok ? '' : ' FAIL'));
  }
}
const all = fs.existsSync(summaryFile) ? fs.readFileSync(summaryFile, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean) : [];
fs.writeFileSync(path.join(outDir, 'summary.md'), summarize(all, selected));
plog('DONE');
console.log('DONE ' + path.relative(ROOT, outDir));
