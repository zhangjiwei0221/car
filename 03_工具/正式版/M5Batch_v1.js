#!/usr/bin/env node
'use strict';
/**
 * M5Batch_v1 —— 低流失小批量：4 张 base × 15 个候选（窗口/边距网格）
 *
 * 生成：M5Build_v5（自由贪心失败时自动退回 --from-solver）
 * 验收（点击结算口径）：
 *   1. ClickSettleEngineCheck（forced）
 *   2. ClickSettlePolicyCheck（policy0/2 + 策略广度 + free-first 路线）
 *   3. OpeningCheck（free-first 路线前段）
 *   4. ArlCheck（19 项）
 *   5. PlayerEngineCheck（PlayerSim 对照）
 *   6. LayoutScore
 *
 * 用法：
 *   node M5Batch_v1.js --outdir <目录> [--resume] [--limit N]
 *
 * 产物：
 *   <outdir>/<base>/w<window>_m<margin>/v5.json       生成的候选
 *   <outdir>/checks/<base>_wX_mY/{click,policy,opening,arl,player,layout}.log
 *   <outdir>/ranking.json / ranking.md                新口径排序
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const TOOLS = path.join(ROOT, '03_工具', '正式版');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const has = k => process.argv.indexOf(k) > 0;
const outDir = path.resolve(ROOT, arg('--outdir', path.join('实验关/产线v3', `批次_低流失_20261110_${process.pid}`)));
const resume = has('--resume');
const limit = Number(arg('--limit', 0)) || 0;

const BASES = [
  { name: '00045_v7', recipe: '实验关/产线v3/M5批次/00045_v7/配方_00045_v7.json' },
  { name: 'pin15_32_pipe53', recipe: '实验关/产线v3/M5批次/transfer_v7/pin006/pin15_32_pipe53.recipe.json' },
  { name: 'F2', recipe: '实验关/产线v3/F2_配方_v1.json' },
  { name: '00005_v27', recipe: '实验关/产线v3/M4新图_关卡00005/配方_关卡00005_v27.json' }
];
const WINDOWS = [8, 10, 12, 14, 16];
const MARGINS = [6, 8, 10];
const tasks = [];
for (const b of BASES) for (const w of WINDOWS) for (const m of MARGINS) tasks.push({ base: b, w, m });
const selected = limit ? tasks.slice(0, limit) : tasks;

fs.mkdirSync(outDir, { recursive: true });
const progressFile = path.join(outDir, 'progress.log');
const plog = s => fs.appendFileSync(progressFile, '[' + new Date().toISOString() + '] ' + s + '\n');
const run = (tool, args, timeout) => {
  const r = spawnSync(process.execPath, [path.join(TOOLS, tool), ...args], {
    cwd: ROOT, encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024
  });
  return { out: (r.stdout || '') + (r.stderr ? '\n[stderr]\n' + r.stderr : ''), status: r.status, error: r.error, signal: r.signal };
};
const num = (re, out) => { const m = re.exec(out); return m ? Number(m[1]) : 0; };
function parseClick(out) {
  const m = /solver=(\w)\(([^)]*)\)\s+clickForced=(\w)\(([^)]*)\)/.exec(out);
  return m ? { solver: m[1], solverInfo: m[2], clickForced: m[3], clickInfo: m[4] } : {};
}
function parseArl(out) {
  const can = /可通关（最小路线）[\s\S]{0,60}?([✓✗])/.exec(out);
  return {
    pass: /→\s*通过/.test(out) && !/→\s*不通过/.test(out),
    peak: num(/峰值=4\s+(\d+)/, out),
    mid: num(/玩家中段 45–80%\s+\d+ 步（占比 (\d+)%）/, out),
    tol: num(/容错 55–75%\s+(\d+)\/20/, out),
    open: num(/开局可点≥5\s+(\d+)/, out),
    at4: num(/at4≥5\s+(\d+)/, out),
    canPass: can ? can[1] : '?'
  };
}
function parsePlayer(out) {
  const m = /solver=(\w)\(([^)]*)\)\s+forced=(\w)\(([^)]*)\)\s+policy0=(\w)\s+policy2=(\w)/.exec(out);
  return m ? { solver: m[1], forced: m[3], policy0: m[5], policy2: m[6] } : {};
}
function parseLayout(out) {
  return { hard: num(/hard=(\d+)/, out), warn: num(/warn=(\d+)/, out) };
}
function safe(s) { return String(s).replace(/[^\w一-龥.-]/g, '_'); }

function generate(t) {
  const tag = `${t.base.name}_w${t.w}_m${t.m}`;
  const dir = path.join(outDir, t.base.name, `w${t.w}_m${t.m}`);
  const level = path.join(dir, 'v5.json');
  if (resume && fs.existsSync(level)) return { tag, dir, level, skipped: true };
  fs.mkdirSync(dir, { recursive: true });
  const r = run('M5Build_v5.js', [path.join(ROOT, t.base.recipe), '--outdir', dir, '--window', String(t.w), '--margin', String(t.m)], 300000);
  fs.writeFileSync(path.join(dir, 'generate.log'), r.out);
  return { tag, dir, level: fs.existsSync(level) ? level : null, ok: !!fs.existsSync(level), status: r.status, signal: r.signal };
}

function check(one) {
  const tag = one.tag;
  const cdir = path.join(outDir, 'checks', safe(tag));
  fs.mkdirSync(cdir, { recursive: true });
  const resultFile = path.join(cdir, 'result.json');
  if (resume && fs.existsSync(resultFile)) {
    try { return JSON.parse(fs.readFileSync(resultFile, 'utf8')); } catch (e) { /* recompute */ }
  }
  const level = one.level;
  const click = parseClick(run('ClickSettleEngineCheck_v1.js', [level], 120000).out);
  fs.writeFileSync(path.join(cdir, 'click.log'), JSON.stringify(click, null, 2));

  const routeDir = path.join(cdir, 'routes');
  const policyFile = path.join(cdir, 'policy.json');
  const polRun = run('ClickSettlePolicyCheck_v1.js', [level, '--out', policyFile, '--route-dir', routeDir], 300000);
  fs.writeFileSync(path.join(cdir, 'policy.log'), polRun.out);
  let policy = { policy0: false, policy2: false, win0: [], win2: [], freeFirst0: false, results: [] };
  try {
    const j = JSON.parse(fs.readFileSync(policyFile, 'utf8'));
    const row = (j.rows || [])[0];
    if (row) {
      policy.policy0 = !!row.policy0;
      policy.policy2 = !!row.policy2;
      policy.results = row.results || [];
      policy.win0 = policy.results.filter(x => x.cap === 0 && x.won).map(x => x.strategy);
      policy.win2 = policy.results.filter(x => x.cap === 2 && x.won).map(x => x.strategy);
      policy.freeFirst0 = policy.win0.includes('free-first');
    }
  } catch (e) { policy.error = String(e.message || e); }

  const routeFile = path.join(routeDir, path.basename(level).replace(/\.json$/i, '') + '.freefirst.click.json');
  let opening = {};
  if (fs.existsSync(routeFile)) {
    const or = run('OpeningCheck_v1.js', [level, '--click', routeFile, '--json'], 120000);
    fs.writeFileSync(path.join(cdir, 'opening.log'), or.out);
    try {
      const j = JSON.parse(or.out);
      opening = j.summary || {};
      opening.openM = j.rows && j.rows[0] ? j.rows[0].M : null;
    } catch (e) { opening.error = String(e.message || e); }
  } else {
    opening.error = 'no free-first route';
  }

  const arl = parseArl(run('ArlCheck_v793.js', [level], 300000).out);
  fs.writeFileSync(path.join(cdir, 'arl.log'), JSON.stringify(arl, null, 2));
  const player = parsePlayer(run('PlayerEngineCheck_v1.js', [level, '--family', '--prefer-small-debt', '--revives', '0,2'], 300000).out);
  fs.writeFileSync(path.join(cdir, 'player.log'), JSON.stringify(player, null, 2));
  const layout = parseLayout(run('LayoutScore_v1.js', [level], 120000).out);
  fs.writeFileSync(path.join(cdir, 'layout.log'), JSON.stringify(layout, null, 2));

  const hard = [];
  if (click.solver !== 'Y') hard.push('solverN');
  if (click.clickForced !== 'Y') hard.push('clickForcedN');
  if (Number(opening.c0AtBufLt5) > 0) hard.push('C0@buf<5=' + opening.c0AtBufLt5);
  if (Number(opening.f0AtBuf3) >= 3 || Number(opening.maxF0AtBuf3) >= 3) hard.push('F0@buf3>=3');
  if (arl.open > 0 && arl.open < 5) hard.push('opening<5');
  if (layout.hard > 0) hard.push('layoutHard' + layout.hard);
  if (!policy.policy2) hard.push('policy2N');

  const flags = [];
  if (Number(opening.f0AtBuf3) === 2) flags.push('F0@buf3=2');
  if (opening.openM != null && opening.openM <= 3) flags.push('openM<=3');
  if (policy.win0.length <= 2) flags.push('breadth<=2');
  if (arl.mid > 0 && (arl.mid < 40 || arl.mid > 80)) flags.push('mid=' + arl.mid);
  if (arl.tol > 0 && (arl.tol < 8 || arl.tol > 18)) flags.push('tol=' + arl.tol);
  if (!policy.freeFirst0) flags.push('freeFirstN');
  if (arl.peak !== 4) flags.push('peak=' + arl.peak);

  let score = 1000 - hard.length * 500 - flags.length * 20 + policy.win0.length * 10;
  if (arl.mid >= 40 && arl.mid <= 80) score += 30;
  if (arl.tol >= 8 && arl.tol <= 18) score += 20;
  if (policy.freeFirst0) score += 50;

  const result = {
    tag, base: one.tag.split('_w')[0], level: path.relative(ROOT, level),
    hard, flags, score, click, policy: { policy0: policy.policy0, policy2: policy.policy2, win0: policy.win0, win2: policy.win2, freeFirst0: policy.freeFirst0 },
    opening: {
      pass: !!opening.pass, openM: opening.openM,
      f0AtBuf3: Number(opening.f0AtBuf3 || 0), maxF0AtBuf3: Number(opening.maxF0AtBuf3 || 0),
      c0AtBufLt5: Number(opening.c0AtBufLt5 || 0), firstC0: opening.firstC0,
      avgF: opening.avgF, steps: opening.steps
    },
    arl, player, layout
  };
  fs.writeFileSync(resultFile, JSON.stringify(result, null, 2));
  return result;
}

const gen = [];
for (const t of selected) {
  const g = generate(t);
  gen.push(g);
  plog((g.level ? 'GEN ' : 'GEN-FAIL ') + g.tag + (g.skipped ? ' (skip)' : ''));
  console.log((g.level ? 'GEN ' : 'GEN-FAIL ') + g.tag + (g.skipped ? ' (skip)' : ''));
}
const results = [];
for (const g of gen) {
  if (!g.level) { results.push({ tag: g.tag, hard: ['generateFail'], flags: [], score: -9999 }); continue; }
  const r = check({ tag: g.tag, level: g.level });
  results.push(r);
  plog('CHECK ' + g.tag + ' hard=' + r.hard.length + ' flags=' + r.flags.length + ' score=' + r.score);
  console.log('CHECK ' + g.tag + ' hard=[' + r.hard.join(',') + '] flags=[' + r.flags.join(',') + '] score=' + r.score);
}
results.sort((a, b) => (a.hard.length - b.hard.length) || (a.flags.length - b.flags.length) || (b.score - a.score));
fs.writeFileSync(path.join(outDir, 'ranking.json'), JSON.stringify({ outDir: path.relative(ROOT, outDir), results }, null, 2));
const lines = ['# 低流失小批量排序（' + new Date().toISOString() + '）', '', `- 输出：\`${path.relative(ROOT, outDir)}\``, `- 候选：${results.length}（生成失败 ${results.filter(r => r.hard.includes('generateFail')).length}）`, ''];
lines.push('| # | 候选 | hard | flags | peak | mid | tol | open | policy0/2 | 策略数 | free-first | F0@b3 | C0 |');
lines.push('|---:|---|---|---|---:|---:|---:|---:|---|---:|---|---:|---:|');
results.forEach((r, i) => {
  const a = r.arl || {}, o = r.opening || {}, p = r.policy || {};
  lines.push(`| ${i + 1} | ${r.tag} | ${(r.hard || []).join(',') || '—'} | ${(r.flags || []).join(',') || '—'} | ${a.peak || '?'} | ${a.mid || '?'} | ${a.tol || '?'} | ${a.open || '?'} | ${p.policy0 ? 'Y' : 'N'}/${p.policy2 ? 'Y' : 'N'} | ${(p.win0 || []).length} | ${p.freeFirst0 ? 'Y' : 'N'} | ${o.f0AtBuf3 != null ? o.f0AtBuf3 : '?'} | ${o.c0AtBufLt5 != null ? o.c0AtBufLt5 : '?'} |`);
});
fs.writeFileSync(path.join(outDir, 'ranking.md'), lines.join('\n') + '\n');
plog('DONE');
console.log('DONE ' + path.relative(ROOT, outDir));
