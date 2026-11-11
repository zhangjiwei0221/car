#!/usr/bin/env node
'use strict';
/**
 * StructPlanSearch_v1 —— v1.5 联合候选搜索（第一版）
 *
 * 从一张基底关卡出发，固定链/冰/管道/问号，只做两类结构变体：
 *   A. tail-swap：底行/小容量尾料车与非同色小/中车换位；
 *   B. 30-disperse（--allow-30）：非链 30:35 与非 30 的同量级车换位，打散 30 堆。
 *
 * 评估：
 *   1) SeedGate（容量/空格/开局/can/链组/reach + PlayerSim p0/p2）；
 *   2) 同色分（PlacementPlan.score）；
 *   3) top N 跑 RecoveryVariantCheck + DifficultyScore，按 v1.5 硬门排序。
 *
 * 用法：
 *   node StructPlanSearch_v1.js <基底.json> --outdir <目录>
 *        [--max-variants 24] [--full-limit 6] [--allow-30]
 *
 * 只读基底；输出变体与报告。
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { gate } = require('./SeedGate_v1');
const { score } = require('./PlacementPlan_v1');

const TOOLS = __dirname;
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.indexOf(k) > 0;

function isPipe(s) { return !!(s && typeof s.type === 'number' && s.type >= 11 && s.type <= 14); }
function isChain(s) { return !!(s && (s.type === 5 || (Array.isArray(s.type) && s.type.includes(5)))); }
function isIce(s) { return !!(s && (s.type === 7 || (Array.isArray(s.type) && s.type.includes(7)))); }
function isPlain(s) { return !!(s && s.id > 0 && s.type === 0 && !s.q); }
function clone(x) { return JSON.parse(JSON.stringify(x)); }
function run(tool, args, timeout) {
  const r = spawnSync(process.execPath, [path.join(TOOLS, tool), ...args], { cwd: path.resolve(TOOLS, '../..'), encoding: 'utf8', timeout: timeout || 600000, maxBuffer: 64 * 1024 * 1024 });
  return (r.stdout || '') + (r.stderr ? '\n' + r.stderr : '');
}
function cars(g) {
  const out = [];
  for (let r = 0; r < g.spools.length; r++) for (let c = 0; c < g.spools[r].length; c++) {
    const s = g.spools[r][c];
    if (isPlain(s)) out.push({ r, c, id: s.id, count: s.count });
  }
  return out;
}
function swap(g, a, b) {
  const g2 = clone(g);
  const t = g2.spools[a.r][a.c];
  g2.spools[a.r][a.c] = g2.spools[b.r][b.c];
  g2.spools[b.r][b.c] = t;
  return g2;
}
function tag(cells) { return cells.map(x => 'r' + x.r + 'c' + x.c).join('_'); }

function buildVariants(base, maxVariants, allow30) {
  const list = cars(base);
  const small = list.filter(x => x.count <= 20 && x.r >= 4);
  const mid = list.filter(x => x.count >= 17 && x.count <= 40);
  const out = [];
  const seen = new Set();
  const add = (kind, a, b, level) => {
    const id = kind + '_' + tag([a, b]);
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ id, kind, cells: [a, b], level });
  };
  // A. 尾料换位：小容量车 vs 非同一颜色的中/小车
  for (const a of small) {
    for (const b of mid) {
      if (b.id === a.id) continue;
      if (a.r === b.r && a.c === b.c) continue;
      if (isChain(base.spools[b.r][b.c]) || isIce(base.spools[b.r][b.c])) continue;
      add('tail', a, b, swap(base, a, b));
      if (out.length >= maxVariants) break;
    }
    if (out.length >= maxVariants) break;
  }
  // B. 30 分散：非链 30:35 vs 非 30 中车
  if (allow30) {
    const c30 = list.filter(x => x.id === 30 && x.count === 35 && !isChain(base.spools[x.r][x.c]));
    for (const a of c30) {
      for (const b of mid) {
        if (b.id === 30) continue;
        if (isChain(base.spools[b.r][b.c]) || isIce(base.spools[b.r][b.c])) continue;
        add('disp30', a, b, swap(base, a, b));
        if (out.length >= maxVariants) break;
      }
      if (out.length >= maxVariants) break;
    }
  }
  return out.slice(0, maxVariants);
}

function oneStepVariants(base, allow30, limit) {
  const list = cars(base);
  const small = list.filter(x => x.count <= 20 && x.r >= 4);
  const mid = list.filter(x => x.count >= 17 && x.count <= 40);
  const out = [];
  const seen = new Set();
  const add = (kind, a, b, level) => {
    const key = kind + '_' + tag([a, b]);
    if (seen.has(key)) return false;
    seen.add(key);
    out.push({ kind, cells: [a, b], level });
    return out.length >= limit;
  };
  for (const a of small) {
    for (const b of mid) {
      if (b.id === a.id || (a.r === b.r && a.c === b.c)) continue;
      if (isChain(base.spools[b.r][b.c]) || isIce(base.spools[b.r][b.c])) continue;
      if (add('tail', a, b, swap(base, a, b))) return out;
    }
  }
  if (allow30) {
    const c30 = list.filter(x => x.id === 30 && x.count === 35 && !isChain(base.spools[x.r][x.c]));
    for (const a of c30) {
      for (const b of mid) {
        if (b.id === 30) continue;
        if (isChain(base.spools[b.r][b.c]) || isIce(base.spools[b.r][b.c])) continue;
        if (add('disp30', a, b, swap(base, a, b))) return out;
      }
    }
  }
  return out;
}

function buildDeepVariants(base, depth, beam, finalLimit, allow30) {
  let beamLevels = [{ level: base, path: [], score: score(base) }];
  const seen = new Set([JSON.stringify(base.spools)]);
  for (let d = 1; d <= depth; d++) {
    const next = [];
    for (const prev of beamLevels) {
      for (const v of oneStepVariants(prev.level, allow30, 160)) {
        const key = JSON.stringify(v.level.spools);
        if (seen.has(key)) continue;
        seen.add(key);
        next.push({
          level: v.level,
          path: prev.path.concat([{ kind: v.kind, cells: v.cells }]),
          score: score(v.level)
        });
      }
    }
    next.sort((a, b) => a.score - b.score);
    beamLevels = next.slice(0, beam);
    if (!beamLevels.length) break;
  }
  return beamLevels.slice(0, finalLimit).map((x, i) => ({
    id: 'd' + depth + '_' + (i + 1) + '_' + x.path.map(p => p.kind + '_' + tag(p.cells)).join('__'),
    kind: 'deep' + depth,
    cells: x.path.flatMap(p => p.cells),
    path: x.path,
    level: x.level
  }));
}

function main() {
  const baseFile = process.argv[2];
  const outdir = arg('--outdir', null);
  const maxVariants = Number(arg('--max-variants', 24)) || 24;
  const fullLimit = Number(arg('--full-limit', 6)) || 6;
  const depth = Number(arg('--depth', 1)) || 1;
  const beam = Number(arg('--beam', 8)) || 8;
  const allow30 = has('--allow-30');
  if (!baseFile || !outdir) { console.error('用法: node StructPlanSearch_v1.js <基底.json> --outdir <目录> [--max-variants 24] [--full-limit 6] [--depth 2] [--beam 8] [--allow-30]'); process.exit(2); }
  fs.mkdirSync(outdir, { recursive: true });
  const base = JSON.parse(fs.readFileSync(baseFile, 'utf8'));
  const variants = depth > 1
    ? buildDeepVariants(base, depth, beam, maxVariants, allow30)
    : buildVariants(base, maxVariants, allow30);
  const rows = [];
  for (let i = 0; i < variants.length; i++) {
    const v = variants[i];
    const file = path.join(outdir, v.id + '.json');
    fs.writeFileSync(file, JSON.stringify(v.level));
    let g;
    try { g = gate(file, { openMin: 5 }); } catch (e) { g = { pass: false, reasons: [String(e.message || e)] }; }
    let s = score(v.level);
    rows.push({ ...v, file, seed: g, sameScore: s });
  }
  rows.sort((a, b) => (a.seed.pass === b.seed.pass ? a.sameScore - b.sameScore : a.seed.pass ? -1 : 1));
  const top = rows.filter(r => r.seed.pass).slice(0, fullLimit);
  const checks = [];
  for (const r of top) {
    const dir = path.join(outdir, r.id + '_check');
    fs.mkdirSync(dir, { recursive: true });
    const variantFile = path.join(dir, path.basename(r.file));
    fs.copyFileSync(r.file, variantFile);
    run('RecoveryVariantCheck_v1.js', [dir, '--out', path.join(dir, 'variants.json')]);
    const vj = path.join(dir, 'variants.json');
    let metrics = null;
    try { const j = JSON.parse(fs.readFileSync(vj, 'utf8')); metrics = (j.rows || [])[0]; } catch (e) { }
    run('DifficultyScore_v1.js', ['--results', vj, '--out', path.join(dir, 'difficulty.json')]);
    let D = null;
    try { const j = JSON.parse(fs.readFileSync(path.join(dir, 'difficulty.json'), 'utf8')); D = (j.rows || [])[0] && j.rows[0].D; } catch (e) { }
    const a = metrics && metrics.arl || {};
    const p = metrics && metrics.policy || {};
    const o = metrics && metrics.opening || {};
    const c = metrics && metrics.click || {};
    const l = metrics && metrics.layout || {};
    const pass = !!(a.canPass === '✓' && a.peak === 4 && a.mid >= 45 && a.mid <= 80 &&
      o.openM >= 5 && o.c0AtBufLt5 === 0 && o.f0AtBuf3 < 3 &&
      p.policy0 && p.freeFirst0 && c.clickForced === 'Y' && l.hard === 0 &&
      r.seed.p0Won && r.seed.p2Won);
    checks.push({ id: r.id, kind: r.kind, file: r.file, seed: r.seed, sameScore: r.sameScore, metrics, D, pass });
  }
  checks.sort((a, b) => (a.pass === b.pass ? (a.D == null ? 999 : a.D) - (b.D == null ? 999 : b.D) : a.pass ? -1 : 1));
  const lines = ['# StructPlanSearch', '', `基底：\`${baseFile}\``, `变体：${variants.length}，SeedGate pass：${rows.filter(r => r.seed.pass).length}，完整检查：${checks.length}`, ''];
  lines.push('| 候选 | 类型 | same | seed | can | peak | mid | open | C0/F0 | click | D | 判定 |');
  lines.push('|---|---|---:|---|---:|---:|---:|---:|---|---:|---:|---|');
  for (const c of checks) {
    const a = c.metrics && c.metrics.arl || {};
    const o = c.metrics && c.metrics.opening || {};
    const cl = c.metrics && c.metrics.click || {};
    const p = c.metrics && c.metrics.policy || {};
    lines.push(`| \`${c.id}\` | ${c.kind} | ${c.sameScore} | ${c.seed.pass ? 'Y' : 'N'} | ${a.canPass || '?'} | ${a.peak ?? '?'} | ${a.mid ?? '?'} | ${o.openM ?? '?'} | ${o.c0AtBufLt5 ?? '?'}/${o.f0AtBuf3 ?? '?'} | ${cl.clickForced || '?'}/${p.policy0 ? 'Y' : 'N'} | ${c.D ?? '?'} | ${c.pass ? '✅' : '❌'} |`);
  }
  fs.writeFileSync(path.join(outdir, 'report.md'), lines.join('\n'));
  fs.writeFileSync(path.join(outdir, 'report.json'), JSON.stringify({ tool: 'StructPlanSearch_v1', baseFile, variants: variants.length, checks }, null, 2));
  console.log(lines.join('\n'));
  console.log('\n报告：' + path.join(outdir, 'report.md'));
}

if (require.main === module) main();
module.exports = { buildVariants, buildDeepVariants };
