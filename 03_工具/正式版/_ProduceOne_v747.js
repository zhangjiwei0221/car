// _ProduceOne_v747.js —— 单张图的完整产线（被 ProduceBatch 调用，也可单独跑）
// 用法：
//   node _ProduceOne_v747.js --target 关卡/xxx.txt --outdir 输出/批次/xxx --rows 7 --cols 7
//        [--rounds 3] [--samples 120] [--plan] [--ref corner]
'use strict';
const fs = require('fs'), path = require('path');
const { spawnSync } = require('child_process');
const B = require('./Build006Thickness_v688');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const has = k => process.argv.includes(k);

const TARGET = arg('--target');
const OUTDIR = arg('--outdir');
const ROWS = arg('--rows', '7'), COLS = arg('--cols', '7');
const ROUNDS = arg('--rounds', '3'), SAMPLES = arg('--samples', '120');
const REF = arg('--ref', 'corner');
const PLAN = has('--plan');
const ALLPAIRS = has('--all-pairs');
const STACK = arg('--stack', '1');
const SEED = arg('--seed', '20261030');

fs.mkdirSync(OUTDIR, { recursive: true });
const base = path.basename(TARGET).replace(/\.txt$/, '');
const init = path.join(OUTDIR, base + '.init.json');
const build = path.join(OUTDIR, base + '.build.json');
const finalF = path.join(OUTDIR, base + '.json');

function run(args) {
  const r = spawnSync('node', args, { cwd: path.resolve(__dirname, '../..'), encoding: 'utf8', maxBuffer: 1 << 26 });
  return { ok: r.status === 0, out: (r.stdout || '') + (r.stderr || '') };
}

const t0 = Date.now();
// 1) 切车
let r = run(['03_工具/正式版/SplitLevel_v722.js', '--target', TARGET, '--out', init, '--rows', ROWS, '--cols', COLS]);
if (!r.ok || !fs.existsSync(init)) return report({ target: TARGET, stage: 'split', ok: false, log: r.out.slice(-300) });

// 2) 基础障碍
r = run(['03_工具/正式版/OverlapBuild_v719.js', init, '--out', build, '--rounds', ROUNDS, '--samples', SAMPLES, '--mode', 'a', '--ref', REF, '--seed', SEED]);
if (!fs.existsSync(build)) return report({ target: TARGET, stage: 'build', ok: false, log: r.out.slice(-300) });

// 3) 可选：障碍分配
let src = build;
if (PLAN) {
  const planArgs = ['03_工具/正式版/ObstaclePlan_v745.js', build, '--ref', REF, '--out', finalF];
  if (ALLPAIRS) planArgs.push('--all-pairs');
  if (Number(STACK) > 1) { planArgs.push('--stack', STACK); }
  r = run(planArgs);
  if (fs.existsSync(finalF)) src = finalF;
}

// 4) 指标 + 验收
const A = B.loadSolver(REF);
const g = B.readJson(src);
const lv = A.parseLevel(A.fromGameFormat(g));
const o = A.Solver.runSolver(lv, 0, 1, false, false, { capturePreviewStats: true, instantChain: false });
const p = (o.pressureSamples || []).map(s => s.buf || 0);
let at4 = 0, cur = 0, run4 = 0, late4 = 0;
const from = Math.floor(p.length * 0.75);
for (let i = 0; i < p.length; i++) { const v = p[i]; if (v >= 4) { cur++; at4++; run4 = Math.max(run4, cur); } else cur = 0; if (i >= from && v >= 4) late4++; }
// 首手落点
const R = lv.rows, C = lv.cols;
const st = A.Simulator.createState(lv, { useSlotStart: true, bottomOnly: false, instantChain: false });
let firstQuad = null, firstPx = 0, firstRatio = 0;
if (o.pickOrder && o.pickOrder.length) {
  A.Simulator.applyPick(st, o.pickOrder[0].r, o.pickOrder[0].c);
  for (let y = 0; y < R; y++) for (let x = 0; x < C; x++) if (st.eliminated[y][x]) firstPx++;
  firstRatio = +(firstPx / Math.max(1, o.pickOrder[0].count)).toFixed(2);
  const q = (y, x) => (y < R / 2 ? '上' : '下') + (x < C / 2 ? '左' : '右');
  const cnt = {};
  for (let y = 0; y < R; y++) for (let x = 0; x < C; x++) if (st.eliminated[y][x]) { const k = q(y, x); cnt[k] = (cnt[k] || 0) + 1; }
  firstQuad = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0] + '(' + Math.max(...Object.values(cnt)) + 'px/' + Object.keys(cnt).length + '象限)';
}
// 容量
let cap = 0, qn = 0;
for (const row of g.spools) for (const x of row) {
  if (x.id > 0) cap += x.count;
  if (Array.isArray(x.param)) for (const b of x.param) if (b && b.count) qn += b.count;
}
const px = g.blocks.flat().filter(v => v > 0).length;

report({
  target: TARGET, stage: 'done', ok: true, file: src,
  at4, run4, late4, peak: Math.max(0, ...p), steps: p.length, won: !!o.completed,
  firstQuad, firstPx, firstRatio, capacityOK: cap + qn === px, cap: cap + qn, px,
  seconds: Math.round((Date.now() - t0) / 1000),
});

function report(o) { console.log('RESULT ' + JSON.stringify(o)); }
