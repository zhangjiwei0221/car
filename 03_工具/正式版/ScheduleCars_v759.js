#!/usr/bin/env node
'use strict';
/**
 * ScheduleCars_v759 —— 用「数字冰」给车排期：把开局就造成欠债的车推到后面出场
 *
 * 思路：跑一次求解，看前 K 步里哪些车没填满（形成 buffer）；
 *       给这些车加 type:7（numice，param = 该步序号），它们在该步之前点不了；
 *       重跑，若「前期压力下降且后期不明显变差」则接受，迭代若干轮。
 *
 * 用法：
 *   node ScheduleCars_v759.js <关卡.json> --out 结果.json [--rounds 4] [--line 3] [--early 0.2]
 */
const fs = require('fs');
const B = require('./Build006Thickness_v688');
const A = B.loadSolver((() => { const i = process.argv.indexOf('--ref'); return i > 0 ? process.argv[i + 1] : 'corner'; })());
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const FILE = process.argv.slice(2).find(a => !a.startsWith('--') && !['--out', '--rounds', '--line', '--early', '--ref'].includes(process.argv[process.argv.indexOf(a) - 1]));
const OUT = arg('--out', '/tmp/scheduled.json');
const ROUNDS = Number(arg('--rounds', 4));
const LINE = Number(arg('--line', 3));
const EARLY = Number(arg('--early', 0.2));

function measure(g) {
  const lv = A.parseLevel(A.fromGameFormat(g));
  const o = A.Solver.runSolver(lv, 0, 1, false, false, { capturePreviewStats: true, instantChain: false });
  const buf = (o.pressureSamples || []).map(s => s.buf || 0);
  const n = buf.length, a = Math.round(n * EARLY), b = Math.round(n * 0.8);
  const hit = x => x.filter(v => v >= LINE).length;
  let run = 0, cur = 0;
  for (const v of buf.slice(b)) { if (v >= LINE) { cur++; run = Math.max(run, cur); } else cur = 0; }
  return { o, buf, early: hit(buf.slice(0, a)), late: hit(buf.slice(b)), run, peak: Math.max(0, ...buf), won: !!o.completed, steps: n };
}

let g = B.readJson(FILE);
let accepted = JSON.parse(JSON.stringify(g));   // 最近一个"已接受"的状态
let best = measure(g);
console.log(`基线：步${best.steps} 峰值${best.peak} 前期到线=${best.early} 后期到线=${best.late} 后段连续=${best.run} 可通=${best.won}`);

for (let round = 1; round <= ROUNDS; round++) {
  if (best.early === 0) { console.log('前期已无高压，停止'); break; }
  // 找开局前 K 步里、造成欠债的车（buffer 首次 >= LINE 的那一步被取的车）
  const picks = (best.o.pickOrder || []);
  const bad = [];
  let floorStep = null;
  for (let i = 0; i < picks.length; i++) {
    const step = picks[i].step;
    if (best.buf[step - 1] >= LINE && floorStep === null) floorStep = step;
  }
  if (floorStep === null) break;
  // 把这一步及其后 3 步内被取的车，全部推迟到 floorStep + 4 之后
  const gate = Math.min(best.steps, floorStep + (Number(process.env.GATE_OFF) || 4));
  for (const p of picks) {
    if (p.step >= floorStep && p.step <= gate) {
      const cell = g.spools[p.r][p.c];
      if (!cell || !(cell.id > 0)) continue;
      const t = Array.isArray(cell.type) ? cell.type : [cell.type || 0];
      if (t.includes(5) || t.includes(7)) continue;      // 链/已有冰不动
      cell.type = 7; cell.param = gate;
      bad.push(`(${p.r},${p.c})`);
    }
  }
  if (!bad.length) { console.log('没有可推迟的车'); break; }
  const cand = measure(g);
  console.log(`第${round}轮：推迟 ${bad.length} 辆到第 ${gate} 手 → 前期到线=${cand.early} 后期到线=${cand.late} 后段连续=${cand.run} 可通=${cand.won}`);
  if (!cand.won) { console.log('   ✗ 不可通关，回退到上次接受的状态'); g = JSON.parse(JSON.stringify(accepted)); best = measure(g); break; }
  if (cand.early < best.early && cand.late >= best.late - 1) {
    best = cand;
    accepted = JSON.parse(JSON.stringify(g));     // 记住这次成功
    continue;
  }
  console.log('   ✗ 未改善或伤后段，回退到上次接受的状态');
  g = JSON.parse(JSON.stringify(accepted));
  best = measure(g);
  break;
}
fs.writeFileSync(OUT, JSON.stringify(g));
console.log(`\n结果：前期到线=${best.early} 后期到线=${best.late} 后段连续=${best.run} 峰值=${best.peak} 可通=${best.won}`);
console.log('已写入', OUT);
