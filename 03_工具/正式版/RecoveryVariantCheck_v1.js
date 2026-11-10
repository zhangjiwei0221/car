#!/usr/bin/env node
'use strict';
/**
 * RecoveryVariantCheck_v1 —— 方向1 变体验收
 *
 * 对目录里的每个变体跑：
 *   ArlCheck、ClickSettleEngine、ClickSettlePolicy(+route)、OpeningCheck、
 *   ChoiceSpace、LayoutScore
 *
 * 用法：
 *   node RecoveryVariantCheck_v1.js <变体目录> [--out report.json] [--limit N]
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const TOOLS = path.join(ROOT, '03_工具', '正式版');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const input = process.argv[2];
const outFile = arg('--out', null);
const limit = Number(arg('--limit', 0)) || 0;
if (!input) { console.error('用法: node RecoveryVariantCheck_v1.js <变体目录> [--out report.json]'); process.exit(2); }

const run = (tool, args, timeout) => {
  const r = spawnSync(process.execPath, [path.join(TOOLS, tool), ...args], {
    cwd: ROOT, encoding: 'utf8', timeout: timeout || 300000, maxBuffer: 64 * 1024 * 1024
  });
  return { out: (r.stdout || '') + (r.stderr ? '\n[stderr]\n' + r.stderr : ''), status: r.status };
};
const num = (re, out) => { const m = re.exec(out); return m ? Number(m[1]) : -1; };
function parseArl(out) {
  const can = /可通关（最小路线）[\s\S]{0,60}?([✓✗])/.exec(out);
  return {
    peak: num(/峰值=4\s+(\d+)/, out), mid: num(/玩家中段 45–80%\s+\d+ 步（占比 (\d+)%）/, out),
    tol: num(/容错 55–75%\s+(\d+)\/20/, out), open: num(/开局可点≥5\s+(\d+)/, out),
    at4: num(/at4≥5\s+(\d+)/, out), canPass: can ? can[1] : '?'
  };
}
function parseClick(out) {
  const m = /solver=(\w)\(([^)]*)\)\s+clickForced=(\w)\(([^)]*)\)/.exec(out);
  return m ? { solver: m[1], clickForced: m[3] } : {};
}
function parseLayout(out) { return { hard: num(/hard=(\d+)/, out), warn: num(/warn=(\d+)/, out) }; }

const files = fs.readdirSync(input).filter(f => f.endsWith('.json')).sort();
const selected = limit ? files.slice(0, limit) : files;
const rows = [];
for (const f of selected) {
  const file = path.join(input, f);
  const tag = path.basename(f, '.json');
  const click = parseClick(run('ClickSettleEngineCheck_v1.js', [file], 120000).out);
  const routeDir = path.join(input, '.routes', tag);
  const policyFile = path.join(input, '.checks', tag + '.policy.json');
  fs.mkdirSync(path.dirname(policyFile), { recursive: true });
  const polOut = run('ClickSettlePolicyCheck_v1.js', [file, '--out', policyFile, '--route-dir', routeDir], 300000).out;
  let policy = {};
  try {
    const j = JSON.parse(fs.readFileSync(policyFile, 'utf8'));
    const r = (j.rows || [])[0] || {};
    policy = {
      policy0: !!r.policy0, policy2: !!r.policy2,
      win0: (r.results || []).filter(x => x.cap === 0 && x.won).map(x => x.strategy),
      freeFirst0: (r.results || []).some(x => x.cap === 0 && x.won && x.strategy === 'free-first')
    };
  } catch (e) { policy = { error: String(e.message || e) }; }
  const routeFile = path.join(routeDir, path.basename(file).replace(/\.json$/i, '') + '.freefirst.click.json');
  let opening = {};
  if (fs.existsSync(routeFile)) {
    const or = run('OpeningCheck_v1.js', [file, '--click', routeFile, '--json'], 120000).out;
    try {
      const j = JSON.parse(or);
      const s = j.summary || {};
      const v = s.violations || {};
      opening = Object.assign({}, s, {
        f0AtBuf3: Number(v.f0AtBuf3 || 0),
        maxF0AtBuf3: Number(s.maxF0AtBuf3 || 0),
        c0AtBufLt5: Number(s.c0AtBufLt5 != null ? s.c0AtBufLt5 : (v.c0AtBufLt5 || 0)),
        f0RunAtBuf3Gt1: !!v.f0RunAtBuf3Gt1
      });
      opening.openM = j.rows && j.rows[0] ? j.rows[0].M : null;
    } catch (e) { opening = { error: String(e.message || e) }; }
  } else opening = { error: 'no route' };
  const arl = parseArl(run('ArlCheck_v793.js', [file], 300000).out);
  const layout = parseLayout(run('LayoutScore_v1.js', [file], 120000).out);
  const choiceFile = path.join(input, '.checks', tag + '.choice.json');
  const choiceOut = run('ChoiceSpaceCheck_v1.js', [file, '--out', choiceFile], 300000).out;
  let choice = {};
  try { const j = JSON.parse(fs.readFileSync(choiceFile, 'utf8')); const r = j.rows[0] || {}; choice = { M: r.avgM, entropy: r.avgEntropy, fake: r.fakeChoiceSteps, forced: r.forcedSteps }; } catch (e) { choice = { error: String(e.message || e) }; }
  const row = { tag, file: path.relative(ROOT, file), click, policy, opening: { pass: opening.pass, openM: opening.openM, f0AtBuf3: opening.f0AtBuf3, c0AtBufLt5: opening.c0AtBufLt5 }, arl, layout, choice };
  rows.push(row);
  console.log(`${tag.padEnd(14)} peak=${arl.peak} mid=${arl.mid} tol=${arl.tol} open=${arl.open} at4=${arl.at4} can=${arl.canPass} C0=${opening.c0AtBufLt5 ?? '?'} F0=${opening.f0AtBuf3 ?? '?'} openM=${opening.openM ?? '?'} p0/2=${policy.policy0 ? 'Y' : 'N'}/${policy.policy2 ? 'Y' : 'N'} win0=${(policy.win0 || []).length} ff=${policy.freeFirst0 ? 'Y' : 'N'} M=${choice.M != null ? choice.M.toFixed(2) : '?'} H=${choice.entropy != null ? choice.entropy.toFixed(2) : '?'} fake=${choice.fake ?? '?'} forced=${choice.forced ?? '?'} hard=${layout.hard}`);
}
fs.writeFileSync(outFile || path.join(input, 'variants.json'), JSON.stringify({ input: path.relative(ROOT, input), rows }, null, 2));
console.log('saved ' + (outFile || path.join(input, 'variants.json')));
