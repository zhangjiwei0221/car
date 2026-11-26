#!/usr/bin/env node
'use strict';
/**
 * GenLevel_v773 —— 统一出关器（按用户 2026-11-02 的四条）
 *
 * ① 先定节奏再倒推棋盘：--steps 目标步数 → 试几个棋盘尺寸，选最接近的
 * ② 障碍对症下药：只在"被迫欠债"不够/前段过压时加，不搞配额
 * ③ K 个候选：棋盘尺寸 × 容量分配方式，统一评分选最好
 * ④ 不用管道（单球无意义）
 *
 * 用法：node GenLevel_v773.js --target 图.txt --steps 49 --outdir 输出目录
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.resolve(__dirname, '../..');
const T = '03_工具/正式版';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const TARGET = arg('--target', '');
const STEPS = Number(arg('--steps', 0));   // 0 = 不指定，工具用默认区间 45~60
const OUTDIR = arg('--outdir', '/tmp/gen773');
const REF = 'corner';
const B = require('./Build006Thickness_v688');
const A = B.loadSolver(REF);

function run(args) {
  const r = spawnSync('node', args, { cwd: ROOT, encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout || '') + (r.stderr || '') };
}

function score(g) {
  const o = A.Solver.runSolver(A.parseLevel(A.fromGameFormat(g)), 0, 1, false, false, { capturePreviewStats: true, instantChain: false });
  const H = g.blocks.length, W = g.blocks[0].length, rows = g.spools.length, cols = g.spools[0].length;
  const col = g.blocks.map(r => r.slice()), gone = g.blocks.map(r => r.map(() => false));
  const reach = (y, x) => (y === 0 || x === 0 || y === H - 1 || x === W - 1) || gone[y - 1][x] || gone[y + 1][x] || gone[y][x - 1] || gone[y][x + 1];
  const picks = (o.pickOrder || []).filter(p => p.chainIndex === 0);
  const taken = new Set(); const per = [];
  for (const p of picks) {
    const cnt = {};
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { if (gone[y][x] || !reach(y, x)) continue; const c = col[y][x]; cnt[c] = (cnt[c] || 0) + 1; }
    let canFill = 0;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const s = g.spools[r][c];
      if (!s || !(s.id > 0) || taken.has(r + ',' + c) || s.q) continue;
      if ((cnt[s.id] || 0) >= s.count) canFill++;
    }
    per.push(canFill);
    const c0 = p.color, list = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { if (gone[y][x] || col[y][x] !== c0 || !reach(y, x)) continue; list.push([(H - 1 - y) + x, y, x]); }
    list.sort((a, b) => a[0] - b[0]);
    let n = 0; for (const [d, y, x] of list) { if (n >= p.count) break; gone[y][x] = true; n++; }
    taken.add(p.r + ',' + p.c);
  }
  let empty = 0, sum = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const s = g.spools[r][c];
    const t = s ? (Array.isArray(s.type) ? s.type : [s.type || 0]) : [];
    if (t.some(x => x >= 11 && x <= 14)) { (Array.isArray(s.param) ? s.param : []).forEach(b => sum += (b.count || 0)); continue; }
    if (s && s.id === -1) continue;
    if (!s || !s.id || s.id <= 0) { empty++; continue; }
    sum += s.count;
  }
  const N = per.length || 1;
  const early = per.slice(0, Math.max(1, Math.floor(N * 0.2)));
  const buf = (o.pressureSamples || []).map(s => s.buf || 0);
  return {
    steps: N, forcedRatio: per.filter(v => v === 0).length / N,
    earlyForced: early.filter(v => v === 0).length,
    peak: Math.max(0, ...buf), won: !!o.completed, empty, sum,
    px: g.blocks.flat().length
  };
}

const cands = [];
const sha = require('crypto').createHash('md5').update(fs.readFileSync(TARGET)).digest('hex').slice(0, 6);
fs.mkdirSync(OUTDIR, { recursive: true });
const boards = [[7, 7], [8, 8], [9, 9], [8, 7]];
for (const [R, C] of boards) {
  for (const mode of ['uniform', 'band']) {
    const tag = `${R}x${C}_${mode}`;
    const d = path.join(OUTDIR, tag);
    fs.mkdirSync(d, { recursive: true });
    let f = path.join(d, 'a_split.json');
    const s1 = run([`${T}/SplitLevel_v722.js`, '--target', TARGET, '--out', f, '--rows', String(R), '--cols', String(C), '--box-min', '14', '--box-max', '50']);
    if (!s1.ok) { console.log(`  ${tag} 切车失败`); continue; }
    if (mode === 'band') {
      const f2 = path.join(d, 'b_band.json');
      const s2 = run([`${T}/BandSpread_v769.js`, f, '--out', f2, '--cap-min', '14', '--cap-max', '50']);
      if (s2.ok) f = f2;
    }
    const fb = path.join(d, 'c_build.json');
    run([`${T}/OverlapBuild_v719.js`, f, '--out', fb, '--rounds', '2', '--samples', '30', '--mode', 'a', '--ref', REF, '--no-chain']);
    if (!fs.existsSync(fb)) { console.log(`  ${tag} 构建失败`); continue; }
    let cur = fb;
    const ff = path.join(d, 'e_feel.json');
    run([`${T}/FeelBuild_v766.js`, cur, '--out', ff, '--iters', '60']);
    if (fs.existsSync(ff)) cur = ff;
    // 【2026-11-02 用户要求】障碍是标配，不再等提醒：先补基础预算（链≥2组、冰≥4）
    const fbud = path.join(d, 'f_budget.json');
    run([`${T}/ObstacleBudget_v770.js`, cur, '--out', fbud, '--chain-groups', '2', '--ice', '4']);
    if (fs.existsSync(fbud)) cur = fbud;
    // 再按症状开处方（补峰值/前段/后段）
    const frx = path.join(d, 'f_rx.json');
    run([`${T}/ObstacleRx_v774.js`, cur, '--out', frx]);
    if (fs.existsSync(frx)) cur = frx;
    const g = B.readJson(cur);
    const m = score(g);
    const hardOK = m.won && m.peak <= 4 && m.empty === 0 && m.sum === m.px;
    // 步数：用户没指定时，按"官方量级 45~60 更优"给一个小加分，而不是硬性距离
    const inRange = m.steps >= 45 && m.steps <= 60;
    const stepBonus = STEPS ? -Math.abs(m.steps - STEPS) * 0.8 : (inRange ? 6 : -Math.abs(m.steps - 52) * 0.4);
    // 峰值必须是 4（用户："没峰4没压力"）：4 加分，3 扣分
    const peakBonus = m.peak === 4 ? 20 : -15;
    const sc = hardOK ? (m.forcedRatio * 100 - m.earlyForced * 8 + peakBonus + stepBonus) : -1e9;
    console.log(`  ${tag.padEnd(14)} 步${String(m.steps).padStart(2)} 被迫${Math.round(100*m.forcedRatio)}% 前段${m.earlyForced} 峰值${m.peak} ${hardOK?'✅':'❌'} 评分${sc.toFixed(1)}`);
    cands.push({ tag, file: cur, m, hardOK, sc });
  }
}
cands.sort((a, b) => b.sc - a.sc);
const best = cands[0];
if (!best || !best.hardOK) { console.log('❌ 没有合格候选'); process.exit(1); }
const out = path.join(OUTDIR, `关卡_最优_${sha}.json`);
fs.copyFileSync(best.file, out);
console.log(`\n★ 最好：${best.tag}  步${best.m.steps} 被迫${Math.round(100*best.m.forcedRatio)}% 前段${best.m.earlyForced} 峰值${best.m.peak}`);
console.log('  →', out);
