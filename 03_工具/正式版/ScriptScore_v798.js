#!/usr/bin/env node
'use strict';
/**
 * ScriptScore_v798 —— 剧本匹配度（2026-11-03）
 *
 * 这是 Total Plan「故事驱动关卡编译器」的第一步：
 *   以前的目标是一个**标量**（at4 最大 / 13 项通过数）；剧本的目标是**一串带位置的约束**
 *   （哪一段要压、压多久、哪一段必须松）。
 *
 * 剧本格式（沿用 `进度与下一步 §16.2`）：
 *   {
 *     "bufferLine": 3,
 *     "segments": [
 *       { "from": 0.00, "to": 0.20, "max4": 0 },
 *       { "from": 0.20, "to": 0.60, "min3": 5 },
 *       { "from": 0.60, "to": 0.80, "max4": 0 },
 *       { "from": 0.80, "to": 1.00, "minRun": 3 }
 *     ]
 *   }
 *
 * 每个段支持：
 *   min3 / max3     该段 buffer≥线 的步数下限/上限
 *   min4 / max4     该段 buffer≥4 的步数下限/上限
 *   minRun          该段 buffer≥线 的最长连续下限
 *   minFree / maxFree 该段 buffer=0 的步数下限/上限
 *
 * 输出：每段的实测值 vs 要求、违规步数、匹配度 0–100。
 *
 * 用法：
 *   node ScriptScore_v798.js <关卡.json> [--script 剧本.json] [--json]
 *   不带 --script 时用「13 项等价剧本」（默认剧本）。
 */
const fs = require('fs');
const B = require('./Build006Thickness_v688');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const FILE = process.argv.slice(2).find(a => !a.startsWith('--') && !['--script', '--ref'].includes(process.argv[process.argv.indexOf(a) - 1]));
const SCRIPT = arg('--script', '');
const REF = arg('--ref', 'corner');
const JSONOUT = process.argv.includes('--json');

/** 默认剧本：与 13 项等价，但表达成"分段"，方便改写 */
const DEFAULT_SCRIPT = {
  bufferLine: 3,
  segments: [
    { from: 0.00, to: 0.20, max4: 0, maxFree: 6, note: '教学段：不许到 4，开局别一上来就欠债' },
    { from: 0.20, to: 0.80, min3: 15, note: '中段：至少 15 步在高压线以上' },
    { from: 0.80, to: 1.00, min3: 3, minRun: 3, note: '收尾：连续 3 步压住' },
  ],
};

const A = B.loadSolver(REF);

function measure(g, script) {
  const o = A.Solver.runSolver(A.parseLevel(A.fromGameFormat(g)), 0, 1, false, false,
    { capturePreviewStats: true, instantChain: false });
  const buf = (o.pressureSamples || []).map(s => s.buf || 0);
  const L = buf.length;
  const line = script.bufferLine ?? 3;
  const segs = [];

  for (const seg of script.segments) {
    const a = Math.floor(L * seg.from), b = Math.min(L, Math.ceil(L * seg.to));
    const slice = buf.slice(a, b);
    let run = 0, c = 0;
    for (const v of slice) { if (v >= line) { c++; run = Math.max(run, c); } else c = 0; }
    const got = {
      steps: slice.length,
      n3: slice.filter(v => v >= line).length,
      n4: slice.filter(v => v >= 4).length,
      free: slice.filter(v => v === 0).length,
      run,
    };
    const viol = [];
    const chk = (key, gotKey, cond, label) => {
      if (seg[key] != null && !cond(got[gotKey])) viol.push(`${label} 要求 ${seg[key]}，实测 ${got[gotKey]}`);
    };
    chk('min3', 'n3', v => v >= seg.min3, 'min3');
    chk('max3', 'n3', v => v <= seg.max3, 'max3');
    chk('min4', 'n4', v => v >= seg.min4, 'min4');
    chk('max4', 'n4', v => v <= seg.max4, 'max4');
    chk('minFree', 'free', v => v >= seg.minFree, 'minFree');
    chk('maxFree', 'free', v => v <= seg.maxFree, 'maxFree');
    chk('minRun', 'run', v => v >= seg.minRun, 'minRun');
    segs.push({ from: seg.from, to: seg.to, note: seg.note || '', got, viol });
  }

  const allViol = segs.flatMap(s => s.viol);
  const nSeg = segs.length || 1;
  const okSeg = segs.filter(s => s.viol.length === 0).length;
  return {
    steps: L, won: !!o.completed, peak: Math.max(0, ...buf),
    segments: segs, violations: allViol,
    score: Math.round(100 * okSeg / nSeg),   // 匹配度：完全符合的段占比
    okSeg, nSeg,
  };
}

let g, script = DEFAULT_SCRIPT;
if (SCRIPT) {
  g = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  script = JSON.parse(fs.readFileSync(SCRIPT, 'utf8'));
} else {
  g = B.readJson(FILE);
}
const r = measure(g, script);

if (JSONOUT) {
  console.log(JSON.stringify(r));
} else {
  console.log(`\n=== ${FILE.split('/').pop()}（${r.steps} 步）剧本匹配度 ${r.score}% ===`);
  for (const s of r.segments) {
    console.log(`  ${(s.from * 100).toFixed(0).padStart(3)}%–${(s.to * 100).toFixed(0).padStart(3)}%  ` +
      `at3=${String(s.got.n3).padStart(2)} at4=${String(s.got.n4).padStart(2)} 免费=${String(s.got.free).padStart(2)} 连续=${String(s.got.run).padStart(2)}  ` +
      (s.viol.length ? '❌ ' + s.viol.join('；') : '✅'));
    if (s.note) console.log(`        ${s.note}`);
  }
  console.log(`  → ${r.score}%（${r.okSeg}/${r.nSeg} 段符合）${r.violations.length ? '，共 ' + r.violations.length + ' 处不符' : '，完全符合'}`);
}

process.exit(r.violations.length ? 1 : 0);
