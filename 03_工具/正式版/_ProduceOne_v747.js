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
const BOARDS = String(arg('--boards', '')).split(',').map(x => x.trim()).filter(Boolean);   // 如 "7x7,6x6,8x8"
const TIER = String(arg('--tier', 'std')).toLowerCase();
const PRESET = {
  easy: { at4: 12, run4: 6,  maxAt4: 18, plan: true,  wRun4: 5, rounds: 2, samples: 40,  stack: 1, attempts: 3 },
  std:  { at4: 20, run4: 12, maxAt4: 99, plan: true,  wRun4: 5, rounds: 3, samples: 60,  stack: 1, attempts: 3 },
  hard: { at4: 28, run4: 20, maxAt4: 99, plan: true,  wRun4: 8, rounds: 4, samples: 100, stack: 3, attempts: 3 },
}[TIER] || null;
if (PRESET) console.log(`档位 ${TIER}：目标 at4≥${PRESET.at4}${PRESET.maxAt4 < 99 ? ' 且 ≤' + PRESET.maxAt4 : ''}、run4≥${PRESET.run4}、plan=${PRESET.plan}、w-run4=${PRESET.wRun4}`);
const ROUNDS = arg('--rounds', '3'), SAMPLES = arg('--samples', '120');
const REF = arg('--ref', 'corner');
const PLAN = has('--plan');
let ATTEMPTS = Number(arg('--attempts', PRESET ? String(PRESET.attempts) : '3'));
let T_AT4 = Number(arg('--target-at4', PRESET ? String(PRESET.at4) : '20'));
let T_RUN4 = Number(arg('--target-run4', PRESET ? String(PRESET.run4) : '12'));
const T_LATE = Number(arg('--target-late4', '4'));
const T_MAX_AT4 = PRESET ? PRESET.maxAt4 : 99;
const ALLPAIRS = has('--all-pairs');
const STACK = arg('--stack', '1');
const SEED = arg('--seed', '20261030');

fs.mkdirSync(OUTDIR, { recursive: true });
const base = path.basename(TARGET).replace(/\.txt$/, '');



function run(args) {
  const r = spawnSync('node', args, { cwd: path.resolve(__dirname, '../..'), encoding: 'utf8', maxBuffer: 1 << 26 });
  return { ok: r.status === 0, out: (r.stdout || '') + (r.stderr || '') };
}

const t0 = Date.now();
let bestRes = null;

function measureFile(src) {
  const A2 = B.loadSolver(REF);
  const g2 = B.readJson(src);
  const lv2 = A2.parseLevel(A2.fromGameFormat(g2));
  const o2 = A2.Solver.runSolver(lv2, 0, 1, false, false, { capturePreviewStats: true, instantChain: false });
  const p2 = (o2.pressureSamples || []).map(x => x.buf || 0);
  let at4 = 0, cur = 0, run4 = 0, late4 = 0;
  const from2 = Math.floor(p2.length * 0.75);
  for (let i = 0; i < p2.length; i++) { const v = p2[i]; if (v >= 4) { cur++; at4++; run4 = Math.max(run4, cur); } else cur = 0; if (i >= from2 && v >= 4) late4++; }
  return { at4, run4, late4, peak: Math.max(0, ...p2), won: !!o2.completed, steps: p2.length };
}

const boardList = BOARDS.length ? BOARDS : [ROWS + 'x' + COLS];
let attemptNo = 0;
outer:
for (const board of boardList) {
  const [BR, BC] = board.split('x');
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
  attemptNo++;
  const seed = String(Number(SEED) + (attemptNo - 1) * 7);
  const bFile = path.join(OUTDIR, base + '.a' + attemptNo + '.build.json');
  const init = path.join(OUTDIR, base + '.' + board + '.init.json');
  // 1) 切车（按当前棋盘尺寸）
  let r = run(['03_工具/正式版/SplitLevel_v722.js', '--target', TARGET, '--out', init, '--rows', BR, '--cols', BC]);
  if (!fs.existsSync(init)) { report({ target: TARGET, stage: 'split', ok: false }); return; }
  // 2) 构建（换 seed、逐次加样本）
  const baseRounds = PRESET ? PRESET.rounds : Number(ROUNDS);
  const baseSamples = PRESET ? PRESET.samples : Number(SAMPLES);
  const wRun4 = PRESET ? PRESET.wRun4 : null;
  const rounds = String(baseRounds + (attempt - 1));
  const samples = String(baseSamples + (attempt - 1) * 40);
  const buildArgs = ['03_工具/正式版/OverlapBuild_v719.js', init, '--out', bFile, '--rounds', rounds, '--samples', samples, '--mode', 'a', '--ref', REF, '--seed', seed];
  if (wRun4 != null) buildArgs.push('--w-run4', String(wRun4));
  r = run(buildArgs);
  if (!fs.existsSync(bFile)) { console.log(`  尝试${attempt}：构建失败`); continue; }
  // 3) 可选分配（后几次尝试允许叠加）
  let src = bFile;
  const doPlan = PRESET ? PRESET.plan : PLAN;
  if (doPlan) {
    const fFile = path.join(OUTDIR, base + '.a' + attemptNo + '.plan.json');
    const planArgs = ['03_工具/正式版/ObstaclePlan_v745.js', bFile, '--ref', REF, '--out', fFile];
    if (ALLPAIRS) planArgs.push('--all-pairs');
    const st = attempt >= 2 ? 2 : (PRESET ? PRESET.stack : Number(STACK));
    if (st > 1) planArgs.push('--stack', String(st));
    run(planArgs);
    if (fs.existsSync(fFile)) src = fFile;
  }
  const m = measureFile(src);
  // 主指标：at4 与 run4；late4 只作参考（实测与 at4/run4 互斥）
  const hit = m.won && m.peak <= 4 && m.at4 >= T_AT4 && m.run4 >= T_RUN4 && m.at4 <= T_MAX_AT4;
  // easy 档：优先“落在 12–18 窗口内且尽量靠近 15”，而不是越高越好
  const score = (TIER === 'easy')
    ? -(Math.abs(m.at4 - 15) * 10) - (m.at4 > 18 ? (m.at4 - 18) * 20 : 0) + m.run4 * 0.2
    : (m.at4 + m.run4 * 0.5 + m.late4 * 2);
  console.log(`  尝试${attempt}（seed=${seed} rounds=${rounds} samples=${samples}）：at4=${m.at4} run4=${m.run4} late4=${m.late4} 峰值${m.peak}${hit ? ' ★达目标' : ''}`);
  if (!bestRes || score > bestRes.score) bestRes = { src, m, score, attempt };
  if (hit) break outer;
  }
}
if (!bestRes) { report({ target: TARGET, stage: 'all-failed', ok: false }); return; }
const src = bestRes.src;
// 把“最佳尝试”复制成固定文件名，方便下游直接读取
try { fs.copyFileSync(src, path.join(OUTDIR, base + '.json')); } catch (e) {}

// 可选：按「颜色露头」分层重排（只动车的位置，压开局、保后段）
let finalSrc = src;
if (has('--layer')) {
  const lFile = path.join(OUTDIR, base + '.layered.json');
  const lArgs = ['03_工具/正式版/LayerByEdge_v754.js', src, '--out', lFile,
    '--seeds', String(Number(arg('--layer-seeds', '12'))), '--ref', REF, '--mode', 'a'];
  const cPath = arg('--contract', '');
  if (cPath) lArgs.push('--contract', cPath);
  const lr = run(lArgs);
  if (lr.ok && fs.existsSync(lFile)) { finalSrc = lFile; console.log('  分层重排：' + path.basename(lFile)); }
  else console.log('  分层重排：失败，保留原结果');
}

// 可选：配额补冰（影响不大时补 6 块，增加障碍厚度；底层用大数字）
let icedSrc = finalSrc;
if (!has('--no-ice')) {
  const iFile = path.join(OUTDIR, base + '.iced.json');
  const ir = run(['03_工具/正式版/IceFill_v761.js', finalSrc, '--out', iFile,
    '--count', String(Number(arg('--ice-count', '6'))),
    '--param', String(Number(arg('--ice-param', '8'))),
    '--param-bottom', String(Number(arg('--ice-param-bottom', '18'))),
    '--ref', REF]);
  if (ir.ok && fs.existsSync(iFile)) { icedSrc = iFile; console.log('  配额补冰：' + path.basename(iFile)); }
  else console.log('  配额补冰：跳过');
}
finalSrc = icedSrc;

function report(o) { console.log('RESULT ' + JSON.stringify(o)); }

// ── 最终指标 + 验收 ──
{
  const A = B.loadSolver(REF);
  const g = B.readJson(finalSrc);
  const lv = A.parseLevel(A.fromGameFormat(g));
  const R = lv.rows, C = lv.cols;
  const o = A.Solver.runSolver(lv, 0, 1, false, false, { capturePreviewStats: true, instantChain: false });
  const p = (o.pressureSamples || []).map(x => x.buf || 0);
  let at4 = 0, cur = 0, run4 = 0, late4 = 0;
  const from = Math.floor(p.length * 0.75);
  for (let i = 0; i < p.length; i++) { const v = p[i]; if (v >= 4) { cur++; at4++; run4 = Math.max(run4, cur); } else cur = 0; if (i >= from && v >= 4) late4++; }

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
  let cap = 0, qn = 0;
  for (const row of g.spools) for (const x of row) {
    if (x.id > 0) cap += x.count;
    if (Array.isArray(x.param)) for (const b of x.param) if (b && b.count) qn += b.count;
  }
  const px = g.blocks.flat().filter(v => v > 0).length;
  const hit = o.completed && Math.max(0, ...p) <= 4 && at4 >= T_AT4 && run4 >= T_RUN4 && at4 <= T_MAX_AT4;   // late4 仅参考

  report({
    target: TARGET, stage: 'done', ok: true, file: src,
    at4, run4, late4, peak: Math.max(0, ...p), steps: p.length, won: !!o.completed,
    firstQuad, firstPx, firstRatio, hitTarget: hit, attempt: bestRes.attempt,
    capacityOK: cap + qn === px, cap: cap + qn, px,
    seconds: Math.round((Date.now() - t0) / 1000),
  });
}
