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
const MODE = 'a';
const NO_EMPTY = !process.argv.includes('--allow-empty');   // 默认不允许棋盘出现空格
const OUT = arg('--out', '/tmp/plan745.json');
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
  return { won: !!o.completed, peak: Math.max(0, ...p), at4, run4, late4, steps: p.length };
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

// 1) 单障碍：墙
console.log('\n[1/3] 墙搜索…');
const wOut = '/tmp/plan745_wall.json';
const wLog = run([`${TOOL}/WallSearch_v742.js`, FILE, '--out', wOut, '--ref', REF, '--mode', MODE, '--max-walls', '2']);
if (fs.existsSync(wOut)) { const m = metrics(wOut); cands.push({ name: 'wall', file: wOut, m }); console.log(`  墙 → at4=${m.at4} run4=${m.run4} late4=${m.late4} 峰值${m.peak}`); }
else console.log('  墙：无候选');

// 2) 单障碍：冰
console.log('\n[2/3] 冰搜索…');
const iOut = '/tmp/plan745_ice.json';
run([`${TOOL}/LateIceSearch_v743.js`, FILE, '--out', iOut, '--ref', REF, '--mode', MODE, '--max-ice', '3']);
if (fs.existsSync(iOut)) { const m = metrics(iOut); cands.push({ name: 'ice', file: iOut, m }); console.log(`  冰 → at4=${m.at4} run4=${m.run4} late4=${m.late4} 峰值${m.peak}`); }
else console.log('  冰：无候选');

// 3) 单障碍：管道
console.log('\n[3/3] 管道搜索…');
const pOut = '/tmp/plan745_pipe.json';
run([`${TOOL}/PipePair_v744.js`, FILE, '--out', pOut, '--ref', REF, '--mode', MODE].concat(NO_EMPTY ? ['--no-empty'] : []));
if (fs.existsSync(pOut)) { const m = metrics(pOut); cands.push({ name: 'pipe', file: pOut, m }); console.log(`  管道 → at4=${m.at4} run4=${m.run4} late4=${m.late4} 峰值${m.peak}`); }
else console.log('  管道：无候选');

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
    const out = `/tmp/plan745_${b.name}_${tag}.json`;
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
