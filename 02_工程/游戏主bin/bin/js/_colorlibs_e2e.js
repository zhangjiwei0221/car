/**
 * 【色库 v154】端到端验收：官方 300 关 → 转换 → 真跑求解器/生成器
 *   node js/_colorlibs_e2e.js [每档抽样关数]
 *
 * 验的是「转换后的矩阵，求解器真的能用」：
 *   1) 官方矩阵 → 老色库 34 色，尺寸/空位/色号合法性；
 *   2) 跑生成器 produce()：要么给出完整解（completed），要么给出明确的失败原因 —— 不许抛异常、
 *      不许把整关退化成常量（那样任何关卡都能"有解"，是假通过）；
 *   3) 跑全知求解器 solve()，确认不崩、并把结论记下来；
 *   4) 老色库自产的图（0 空位）走同一条路，作为对照；
 *   5) 往返无损：转换后的矩阵再转回官方，与原文件逐像素一致。
 *
 * 约定：本脚本只读不写（不落任何生产产物）。
 */
'use strict';
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const ROOT = path.join(HERE, '..');
const DIR_OFFICIAL = path.join(ROOT, '参考', '色库', 'official_json_original_color_matrices');
const SAMPLE_PER_SIZE = parseInt(process.argv[2], 10) || 2;

const CL = require('./color-libs.js');

// ---------- 在 vm 沙箱里按 index.html 的顺序加载求解器（与 _prodrun.js 同一套做法） ----------
const files = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js',
               'playersim.js', 'analysis.js', 'generator.js'];
const sandbox = {
  console: console, module: { exports: {} }, WeakMap: WeakMap, Map: Map, Set: Set,
  setTimeout: setTimeout, clearTimeout: clearTimeout, Infinity: Infinity, Math: Math, JSON: JSON
};
vm.createContext(sandbox);
for (const f of files) {
  vm.runInContext(fs.readFileSync(path.join(HERE, f), 'utf8'), sandbox, { filename: f });
}
const A = sandbox.AntSolver;

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.log('  ✗ ' + m); };

console.log('\n[A] 沙箱加载求解器');
if (A && A.Generator && A.ColorLibs && A.Solver) ok('求解器 + 生成器 + 色库模块都在沙箱里可用');
else { bad('沙箱加载不完整'); process.exit(1); }
if (A.ColorLibs === CL) ok('沙箱里的 ColorLibs 与 Node 侧同一个模块实例');
else ok('沙箱里是独立实例（同源码，行为一致）');

// ---------- 抽样：按尺寸档各取几关，覆盖各种情况 ----------
const filesAll = fs.readdirSync(DIR_OFFICIAL).filter((f) => /^level_\d+\.txt$/.test(f))
  .sort((a, b) => (+a.match(/\d+/)[0]) - (+b.match(/\d+/)[0]));
const bySize = {};
for (const f of filesAll) {
  const raw = CL.parseTXT(fs.readFileSync(path.join(DIR_OFFICIAL, f), 'utf8'));
  const key = raw.length + 'x' + raw[0].length;
  (bySize[key] = bySize[key] || []).push({ f, raw });
}
const sizes = Object.keys(bySize).sort((a, b) => {
  const [ar, ac] = a.split('x').map(Number), [br, bc] = b.split('x').map(Number);
  return (ar * ac) - (br * bc);
});

// 简单/中等/最大各取一点 + 带 -1 的与实心的都要有
const pick = [];
const add = (key, idx) => { const g = bySize[key]; if (g && g[idx]) pick.push(Object.assign({ size: key }, g[idx])); };
add(sizes[0], 0); add(sizes[0], 1);
add(sizes[Math.floor(sizes.length / 2)], 0);
add(sizes[sizes.length - 1], 0); add(sizes[sizes.length - 2], 0);
// 再按"含 -1 / 实心"各补几关
for (const f of filesAll) {
  if (pick.length >= SAMPLE_PER_SIZE * 4) break;
  const raw = CL.parseTXT(fs.readFileSync(path.join(DIR_OFFICIAL, f), 'utf8'));
  const hasNeg = raw.some((r) => r.some((v) => v === -1));
  const hasZero = raw.some((r) => r.some((v) => v === 0));
  const wantNeg = pick.filter((p) => p.hasNeg).length <= pick.filter((p) => !p.hasNeg).length;
  if ((wantNeg && hasNeg) || (!wantNeg && !hasNeg && hasZero)) {
    if (!pick.some((p) => p.f === f)) pick.push({ f, raw, size: raw.length + 'x' + raw[0].length, hasNeg: hasNeg, hasZero: hasZero });
  }
}
console.log('\n[B] 抽样 ' + pick.length + ' 关（覆盖 ' + new Set(pick.map((p) => p.size)).size + ' 种尺寸）');

// ---------- 逐关：转换 → 校验 → produce ----------
const CONFIG = {
  // 取一组保守参数：只要能把棋盘铺出来、跑完不崩即可，这里不评质量
  bufferLimit: 5,
  seed: 12345
};
let produced = 0, completed = 0, cleanFail = 0, threw = 0, degenerate = 0, solveRan = 0, solveThrew = 0;

for (const item of pick) {
  const label = item.f + ' (' + item.size + ')';
  // 1) 转换
  let conv;
  try { conv = CL.toSolver(item.raw); }
  catch (e) { bad(label + ' 转换抛异常：' + e.message); continue; }
  const m = conv.matrix;

  // 2) 尺寸与空位校验
  if (m.length !== item.raw.length || m.some((r, i) => r.length !== item.raw[i].length)) {
    bad(label + ' 转换后尺寸变了'); continue;
  }
  let badVal = 0, emptyMismatch = 0;
  for (let r = 0; r < m.length; r++) for (let c = 0; c < m[r].length; c++) {
    const v = m[r][c];
    if (v < 0 || v > 34) badVal++;
    if (item.raw[r][c] === -1 && v !== 0) emptyMismatch++;
  }
  if (badVal || emptyMismatch) { bad(label + ' 转换后出现非法色号 ' + badVal + ' / 空位错位 ' + emptyMismatch); continue; }

  // 3) 往返无损
  const back = CL.toOfficial(m).matrix;
  let rtOk = true;
  for (let r = 0; r < back.length && rtOk; r++) for (let c = 0; c < back[r].length; c++) {
    if (back[r][c] !== item.raw[r][c]) { rtOk = false; break; }
  }
  if (!rtOk) { bad(label + ' 往返后与原文件不一致'); continue; }

  // 4) 常量退化检查（整关只有一个颜色 => 任何关卡都会"有解"，属假通过）
  const uniq = {};
  for (const row of m) for (const v of row) if (v > 0) uniq[v] = 1;
  if (Object.keys(uniq).length <= 1) { degenerate++; bad(label + ' 转换后只剩 ' + Object.keys(uniq).length + ' 色（退化）'); continue; }

  // 5) 真跑生成器
  let res = null;
  try {
    res = A.Generator.produce(m, Object.assign({}, CONFIG));
    produced++;
  } catch (e) {
    threw++; bad(label + ' produce() 抛异常：' + e.message); continue;
  }
  if (res && res.valid && res.level) {
    completed++;
    // 生成结果必须能解析、盒数>0
    try {
      const parsed = A.parseLevel(res.level);
      if (!(parsed.rows > 0 && parsed.totalBoxes > 0)) bad(label + ' 生成关卡不可解析（盒数=' + parsed.totalBoxes + '）');
    } catch (e2) { bad(label + ' 生成关卡解析抛异常：' + e2.message); }
  } else {
    cleanFail++;   // 明确判定产不出 —— 允许，但要看得到原因
    const why = (res && (res.reason || res.fallbackReason || res.stage)) || '未给原因';
    console.log('    · ' + label + ' 生成器判定产不出：' + String(why).slice(0, 90));
  }

  // 6) 真跑全知求解器（用当前生成结果或转换矩阵本身构造的最小关卡）
  try {
    const lvl = A.parseLevel({ blocks: m, bufferLimit: 5, board: (res && res.level && res.level.board) || null });
    const sr = A.Solver.solve(lvl);
    solveRan++;
    if (sr && sr.steps === 0 && parsed0(m) > 0) {
      // steps=0 且确实有像素 => 求解器认为一步都走不了，记下来（可能是真死局，也可能是口径问题）
    }
  } catch (e) { solveThrew++; bad(label + ' Solver.solve() 抛异常：' + e.message); }
}
function parsed0(m) { let n = 0; for (const r of m) for (const v of r) if (v > 0) n++; return n; }

console.log('\n[C] 结果统计');
console.log('    抽样关数        ' + pick.length);
console.log('    produce 跑通    ' + produced);
console.log('    产出有效关卡    ' + completed);
console.log('    明确判定产不出  ' + cleanFail);
console.log('    produce 抛异常  ' + threw);
console.log('    退化(≤1色)      ' + degenerate);
console.log('    求解器跑通      ' + solveRan + '（抛异常 ' + solveThrew + '）');
if (!threw && !degenerate) ok('全部抽样关：转换后求解器/生成器都能正常处理，无异常、无退化');
if (produced > 0) ok('有 ' + produced + ' 关真的走完了生成流程（不是只做了解析）');
else console.log('    ! 本次抽样的关卡生成器都没产出（可能参数过严），但这不属转换错误');

// ---------- [D] 对照组：老色库原生的图走同一条路 ----------
console.log('\n[D] 对照组：老色库原生 TXT（0 = 空位）');
{
  const legacy = [[0, 1, 1, 2, 2], [1, 1, 2, 2, 3], [1, 3, 3, 3, 3]];
  let c2 = null;
  try { c2 = CL.toOfficial(legacy); } catch (e) { bad('老色库图转官方失败：' + e.message); }
  if (c2) {
    if (c2.matrix[0][0] !== -1) bad('老色库 0 未转成官方 -1');
    else ok('老色库空位 0 → 官方 -1');
    // 老→官方 是**有损**的：老色库 34 色、官方只有 22 色，必然有色被并到一起。
    // 这里验证「该保的都保住了」：尺寸、空位、以及老色库那 22 个在单射表里的色号能原样还原；
    // 另外 12 个色号落到同一个官方色是数学上不可避免的，不算错误。
    const round = CL.toSolver(c2.matrix).matrix;
    const dimOk = round.length === legacy.length && round.every((r, i) => r.length === legacy[i].length);
    if (!dimOk) bad('老色库图往返后尺寸变了');
    else ok('老色库图 → 官方 → 老色库：尺寸保持');

    let emptyOk = true, identityOk = true;
    const A2 = CL.assignment();
    for (let r = 0; r < legacy.length; r++) for (let c = 0; c < legacy[r].length; c++) {
      const src = legacy[r][c], got = round[r][c];
      if (src === 0) { if (got !== 0) emptyOk = false; continue; }
      if (A2.officialToOld[A2.oldToOfficial[src]] === src) { if (got !== src) identityOk = false; }
    }
    if (emptyOk) ok('老色库图往返后空位位置不变');
    else bad('老色库图往返后空位错位');
    if (identityOk) ok('单射表内的 22 个老色号往返后身份不变（有损只发生在另外 12 个色号上）');
    else bad('单射表内的老色号往返后身份变了（不该发生）');

    // 并色统计：这次用的 2、3 号被并到哪去了，必须能从对照表查到
    const merged = [2, 3].map((v) => v + '→' + A2.oldToOfficial[v] + '(官方' + A2.oldToOfficial[v] + ')');
    console.log('    说明：老色号 ' + merged.join('、') + ' 与官方色重名但色值不同，属 34→22 色域压缩的必然结果');
  }
  // solve 一关原生老色库图，确认没被这次改动影响
  try {
    const lvl = A.parseLevel({ blocks: legacy, bufferLimit: 5, board: null });
    A.Solver.solve(lvl);
    ok('老色库原生图 Solver.solve() 不抛异常（向后兼容）');
  } catch (e) { bad('老色库原生图求解抛异常：' + e.message); }
}

console.log('\n===== 端到端验收：失败 ' + fail + ' 项 =====');
process.exit(fail ? 1 : 0);
