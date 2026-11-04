// ObstaclePlan_v745.js —— 障碍预算分配器
// 思路：先量基线，再按“缺什么补什么”决定用哪种障碍；每种障碍单独试一次，
//       然后只对“最优单障碍结果”再叠一种，最后按分数选最优（峰值/容量/可解为硬约束）。
// 用法：node ObstaclePlan_v745.js <关卡.json> --ref ring|corner|bottom [--out 结果.json] [--target-at4 20] [--target-late4 4]
'use strict';
const fs = require('fs');
const { spawnSync } = require('child_process');
const B = require('./Build006Thickness_v688');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const FILE = process.argv[2];
const REF = String(arg('--ref', 'ring'));
const NO_ICE = process.argv.includes('--no-ice');   // 【2026-11-04】跳过慢速冰搜索（改由 RxPrescribe 加冰）
const MODE = 'a';
const NO_EMPTY = !process.argv.includes('--allow-empty');
const STACK = Number(arg('--stack', '1'));   // 在最优结果上继续叠障碍的次数上限   // 默认不允许棋盘出现空格
const OUT = arg('--out', '/tmp/plan745.json');
const TMPDIR = `/tmp/plan745_${process.pid}`;
require('fs').mkdirSync(TMPDIR, { recursive: true });
const T_AT4 = Number(arg('--target-at4', 20));
const T_LATE = Number(arg('--target-late4', 4));
const A = B.loadSolver(REF);
const TOOL = '03_工具/正式版';

function metrics(f) {
  const g = B.readJson(f);
  const lv = A.parseLevel(A.fromGameFormat(g));
  const o = A.Solver.runSolver(lv, 0, 1, false, false, { capturePreviewStats: true, instantChain: false });
  const p = (o.pressureSamples || []).map(s => s.buf || 0);
  let at4 = 0, cur = 0, run4 = 0; const from = Math.floor(p.length * 0.75);
  let late4 = 0;
  for (let i = 0; i < p.length; i++) {
    const v = p[i];
    if (v >= 4) { cur++; at4++; run4 = Math.max(run4, cur); } else cur = 0;
    if (i >= from && v >= 4) late4++;
  }
  // 首手消除比例：开局第一手必须吃掉 ≥80% 容量（前期容错高，允许留一点债）
  let firstRatio = 1;
  if (o.pickOrder && o.pickOrder.length) {
    const st = A.Simulator.createState(lv, { useSlotStart: true, bottomOnly: false, instantChain: false });
    A.Simulator.applyPick(st, o.pickOrder[0].r, o.pickOrder[0].c);
    let n = 0;
    for (let y = 0; y < lv.rows; y++) for (let x = 0; x < lv.cols; x++) if (st.eliminated[y][x]) n++;
    firstRatio = n / Math.max(1, o.pickOrder[0].count);
  }
  return { won: !!o.completed, peak: Math.max(0, ...p), at4, run4, late4, firstRatio: +firstRatio.toFixed(2), steps: p.length };
}
const run = (args) => {
  const r = spawnSync('node', args, { encoding: 'utf8', maxBuffer: 1 << 26 });
  return (r.stdout || '') + (r.stderr || '');
};
const score = m => (m.won ? 0 : -999) + m.at4 * 1 + m.late4 * 2 + m.run4 * 0.5 - (m.peak > 4 ? 500 : 0);

const base = metrics(FILE);
console.log(`基线（${REF}）：at4=${base.at4} run4=${base.run4} late4=${base.late4} 峰值${base.peak} 步${base.steps}`);
console.log(`目标：at4 ≥ ${T_AT4}、late4 ≥ ${T_LATE}`);

const cands = [{ name: 'base', file: FILE, m: base }];
const needAt4 = base.at4 < T_AT4, needLate = base.late4 < T_LATE;
console.log(`诊断：${needAt4 ? 'at4 不足 → 优先墙' : 'at4 达标'}；${needLate ? 'late4 不足 → 优先冰' : 'late4 达标'}`);

// ── 决策树：先只跑“缺的那一类”，不再一上来三件全跑 ──
const NEED_AT4 = base.at4 < T_AT4;
const NEED_LATE = base.late4 < T_LATE;
const FAST = !process.argv.includes('--all-pairs');

if (FAST) {
  console.log(`\n[决策] at4 ${NEED_AT4 ? '不足→先空间类(墙/管道)' : '达标'}；late4 ${NEED_LATE ? '不足→后段补冰' : '达标'}`);
}

// 1) 单障碍：墙
console.log('\n[1/3] 墙搜索…');
const wOut = `${TMPDIR}/wall.json`;
const wLog = run([`${TOOL}/WallSearch_v742.js`, FILE, '--out', wOut, '--ref', REF, '--mode', MODE, '--max-walls', '2']);
if (fs.existsSync(wOut)) { const m = metrics(wOut); cands.push({ name: 'wall', file: wOut, m }); console.log(`  墙 → at4=${m.at4} run4=${m.run4} late4=${m.late4} 峰值${m.peak}`); }
else console.log('  墙：无候选');

// 2) 单障碍：冰
console.log('\n[2/3] 冰搜索…');
if (NO_ICE) { console.log('  冰：跳过（--no-ice，交给 RxPrescribe）'); }
else {
const iOut = `${TMPDIR}/ice.json`;
run([`${TOOL}/LateIceSearch_v743.js`, FILE, '--out', iOut, '--ref', REF, '--mode', MODE, '--max-ice', '3']);
if (fs.existsSync(iOut)) { const m = metrics(iOut); cands.push({ name: 'ice', file: iOut, m }); console.log(`  冰 → at4=${m.at4} run4=${m.run4} late4=${m.late4} 峰值${m.peak}`); }
else console.log('  冰：无候选');
}

// 3) 单障碍：管道
console.log('\n[3/3] 管道搜索…');
const pOut = `${TMPDIR}/pipe.json`;
run([`${TOOL}/PipePair_v744.js`, FILE, '--out', pOut, '--ref', REF, '--mode', MODE].concat(NO_EMPTY ? ['--no-empty'] : []));
if (fs.existsSync(pOut)) { const m = metrics(pOut); cands.push({ name: 'pipe', file: pOut, m }); console.log(`  管道 → at4=${m.at4} run4=${m.run4} late4=${m.late4} 峰值${m.peak}`); }
else console.log('  管道：无候选');

// ── FAST 路径：若两者都缺，就在“最好的空间类结果”上补一次冰；否则直接用最好的单障碍 ──
if (FAST) {
  cands.sort((a, b) => score(b.m) - score(a.m));
  const spaceBest = cands.filter(c => c.name === 'wall' || c.name === 'pipe').sort((a, b) => score(b.m) - score(a.m))[0];
  const base0 = cands.find(c => c.name === 'base');
  let bestSoFar = cands[0];
  if (NEED_AT4 && spaceBest && score(spaceBest.m) > score(base0.m)) bestSoFar = spaceBest;
  if (NEED_LATE && !NO_ICE) {
    const out = `${TMPDIR}/fast_ice.json`;
    console.log(`\n[决策] 在 ${bestSoFar.name} 上补冰（只跑一次）…`);
    run([`${TOOL}/LateIceSearch_v743.js`, bestSoFar.file, '--out', out, '--ref', REF, '--mode', MODE, '--max-ice', '2']);
    if (fs.existsSync(out) && JSON.stringify(B.readJson(out)) !== JSON.stringify(B.readJson(bestSoFar.file))) {
      const m = metrics(out);
      cands.push({ name: bestSoFar.name + '+ice', file: out, m });
      console.log(`  ${bestSoFar.name}+ice → at4=${m.at4} run4=${m.run4} late4=${m.late4} 峰值${m.peak} 首手${Math.round((m.firstRatio||0)*100)}% ${m.won ? '可解' : '不可解'}`);
    } else console.log('  冰：无候选（关卡未改动）');
  }
  cands.sort((a, b) => score(b.m) - score(a.m));
  const bestFast = cands[0];
  console.log('\n=== 决策树结果 ===');
  for (const c of cands) {
    const ok = c.m.won && c.m.peak <= 4 && c.m.at4 >= T_AT4 && c.m.late4 >= T_LATE;
    console.log(`  ${c.name.padEnd(14)} at4=${String(c.m.at4).padStart(2)} run4=${String(c.m.run4).padStart(2)} late4=${String(c.m.late4).padStart(2)} 峰值${c.m.peak} 首手${String(Math.round((c.m.firstRatio||0)*100)).padStart(3)}% ${ok ? '★达标' : ''}`);
  }
  // ── 继续叠障碍：--stack N（N-1 次追加，每次在 wall/ice/pipe 里挑最好的）──
  let curFile = bestFast.file, curName = bestFast.name;
  let curM = metrics(curFile);
  const TOOLSET = {
    wall: { tool: 'WallSearch_v742.js', args: ['--max-walls', '2'] },
    ice: { tool: 'LateIceSearch_v743.js', args: ['--max-ice', '2'] },
    pipe: { tool: 'PipePair_v744.js', args: NO_EMPTY ? ['--no-empty'] : [] },
  };
  for (let k = 1; k < STACK; k++) {
    let bestAdd = null;
    for (const tag of Object.keys(TOOLSET)) {
      const out = `${TMPDIR}/stack_${k}_${tag}.json`;
      run([`${TOOL}/${TOOLSET[tag].tool}`, curFile, '--out', out, '--ref', REF, '--mode', MODE].concat(TOOLSET[tag].args));
      if (!fs.existsSync(out)) continue;
      if (JSON.stringify(B.readJson(out)) === JSON.stringify(B.readJson(curFile))) continue;
      const m = metrics(out);
      if (!m.won || m.peak > 4) continue;
      if (m.firstRatio != null && m.firstRatio < 0.8) continue;
      if (score(m) <= score(curM)) continue;
      if (!bestAdd || score(m) > score(bestAdd.m)) bestAdd = { tag, file: out, m };
    }
    if (!bestAdd) { console.log(`\n[stack] 第 ${k} 次追加：没有能进一步提升的障碍，停止`); break; }
    curFile = bestAdd.file; curM = bestAdd.m; curName += '+' + bestAdd.tag;
    console.log(`[stack] 第 ${k} 次追加 ${bestAdd.tag} → at4=${curM.at4} run4=${curM.run4} late4=${curM.late4} 峰值${curM.peak}`);
  }
  fs.writeFileSync(OUT, JSON.stringify(B.readJson(curFile), null, 2));
  console.log(`\n选定：${curName} → ${OUT}（at4=${curM.at4} run4=${curM.run4} late4=${curM.late4}）`);
  process.exit(0);
}

// 4) 叠加：默认只在“最优单障碍”上再叠一种；--all-pairs 则对每个单障碍都把另外两种各叠一次
const ALL_PAIRS = process.argv.includes('--all-pairs');
const TOOLS = {
  wall: { tool: 'WallSearch_v742.js', args: ['--max-walls', '2'] },
  ice: { tool: 'LateIceSearch_v743.js', args: ['--max-ice', '3'] },
  pipe: { tool: 'PipePair_v744.js', args: NO_EMPTY ? ['--no-empty'] : [] },
};
cands.sort((a, b) => score(b.m) - score(a.m));
const best1 = cands[0];
console.log(`\n最优单障碍：${best1.name}（score=${score(best1.m).toFixed(1)}）`);
const bases = ALL_PAIRS ? cands.filter(c => c.name !== 'base') : (best1.name !== 'base' ? [best1] : []);
for (const b of bases) {
  for (const tag of Object.keys(TOOLS)) {
    if (b.name.split('+').includes(tag)) continue;              // 不重复叠同一种
    const out = `${TMPDIR}/${b.name}_${tag}.json`;
    console.log(`  在 ${b.name} 上叠加 ${tag} …`);
    run([`${TOOL}/${TOOLS[tag].tool}`, b.file, '--out', out, '--ref', REF, '--mode', MODE].concat(TOOLS[tag].args));
    if (!fs.existsSync(out)) { console.log(`    ${tag}：无候选`); continue; }
    const same = JSON.stringify(B.readJson(out)) === JSON.stringify(B.readJson(b.file));
    if (same) { console.log(`    ${tag}：无候选（关卡未改动）`); continue; }
    const m = metrics(out);
    cands.push({ name: `${b.name}+${tag}`, file: out, m });
    console.log(`    ${b.name}+${tag} → at4=${m.at4} run4=${m.run4} late4=${m.late4} 峰值${m.peak} ${m.won ? '可解' : '不可解'}`);
  }
}

cands.sort((a, b) => score(b.m) - score(a.m));
console.log('\n=== 候选排序 ===');
for (const c of cands) {
  const ok = c.m.won && c.m.peak <= 4 && c.m.at4 >= T_AT4 && c.m.late4 >= T_LATE;
  console.log(`  ${c.name.padEnd(12)} at4=${String(c.m.at4).padStart(2)} run4=${String(c.m.run4).padStart(2)} late4=${String(c.m.late4).padStart(2)} 峰值${c.m.peak} score=${score(c.m).toFixed(1)} ${ok ? '★达标' : ''}`);
}
const best = cands[0];
fs.writeFileSync(OUT, JSON.stringify(B.readJson(best.file), null, 2));
console.log(`\n选定：${best.name} → ${OUT}`);
console.log('建议：' + (best.m.at4 >= T_AT4 && best.m.late4 >= T_LATE ? '可直接进试玩' : `仍未达标（at4 ${best.m.at4}/${T_AT4}、late4 ${best.m.late4}/${T_LATE}），需要换图或加搜索轮次`));
