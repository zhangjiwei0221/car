// ImageGate_v748.js —— 图的门槛：先筛掉"注定做不出目标感"的图
// 四条判据（都可测）：
//   ① 背景占比 ≤ 35%（最大单色占全图的比例）
//   ② 主体覆盖 ≥ 45%（非背景像素占比）
//   ③ 颜色数 ≥ 8（太少=大色块，压力起不来）
//   ④ 首手落点只在一个象限（corner 规则，7×7 切块后跑一手）
// 用法：node ImageGate_v748.js --dir 关卡 [--limit 0] [--out 输出/图门槛.json]
'use strict';
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const B = require('./Build006Thickness_v688');
const ROOT = path.resolve(__dirname, '../..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DIR = arg('--dir', '关卡');
const LIMIT = Number(arg('--limit', '0'));
const OUT = arg('--out', '输出/图门槛.json');
const MIN_SUB = Number(arg('--min-subject', '0.45'));
const MAX_BG = Number(arg('--max-bg', '0.35'));
const MIN_COLORS = Number(arg('--min-colors', '8'));

function readTxt(p) {
  const lines = fs.readFileSync(p, 'utf8').trim().split('\n').filter(l => l.trim());
  if (lines[0].startsWith('像素')) lines.shift();
  return lines.map(l => l.trim().split(/\s+/).map(Number));
}

const A = B.loadSolver('corner');
const rows = [];
const files = fs.readdirSync(path.join(ROOT, DIR)).filter(f => f.endsWith('.txt')).sort();
for (const f of (LIMIT > 0 ? files.slice(0, LIMIT) : files)) {
  const p = path.join(ROOT, DIR, f);
  let g; try { g = readTxt(p); } catch (e) { continue; }
  const R = g.length, C = g[0].length, n = R * C;
  const cnt = {}; for (const r of g) for (const v of r) cnt[v] = (cnt[v] || 0) + 1;
  const colors = Object.keys(cnt).map(Number).filter(c => c > 0);
  const bg = Math.max(...Object.values(cnt));
  const bgShare = bg / n, subShare = 1 - bgShare;

  // 首手落点：切块后跑一手
  const tmp = '/tmp/gate_' + path.basename(f, '.txt') + '.json';
  const r = spawnSync('node', ['03_工具/正式版/SplitLevel_v722.js', '--target', path.join(DIR, f), '--out', tmp, '--rows', '7', '--cols', '7'], { cwd: ROOT, encoding: 'utf8' });
  let quad = null;
  if (fs.existsSync(tmp)) {
    try {
      const lv = A.parseLevel(A.fromGameFormat(B.readJson(tmp)));
      const o = A.Solver.runSolver(lv, 0, 1, false, false, { capturePreviewStats: true, instantChain: false });
      if (o.pickOrder && o.pickOrder.length) {
        const st = A.Simulator.createState(lv, { useSlotStart: true, bottomOnly: false, instantChain: false });
        A.Simulator.applyPick(st, o.pickOrder[0].r, o.pickOrder[0].c);
        const q = (y, x) => (y < lv.rows / 2 ? '上' : '下') + (x < lv.cols / 2 ? '左' : '右');
        const qc = {};
        for (let y = 0; y < lv.rows; y++) for (let x = 0; x < lv.cols; x++) if (st.eliminated[y][x]) { const k = q(y, x); qc[k] = (qc[k] || 0) + 1; }
        quad = { count: Object.keys(qc).length, main: Object.keys(qc).sort((a, b) => qc[b] - qc[a])[0] };
      }
    } catch (e) { }
  }

  const checks = {
    bgOK: bgShare <= MAX_BG,
    subOK: subShare >= MIN_SUB,
    colorsOK: colors.length >= MIN_COLORS,
    quadOK: !!quad && quad.count === 1,
  };
  const pass = checks.bgOK && checks.subOK && checks.colorsOK && checks.quadOK;
  rows.push({ file: f, size: R + 'x' + C, bgShare: +(bgShare * 100).toFixed(0), subShare: +(subShare * 100).toFixed(0), colors: colors.length, firstQuad: quad ? quad.main : '?', quadCount: quad ? quad.count : -1, pass, checks });
}

rows.sort((a, b) => (b.pass - a.pass) || (b.subShare - a.subShare));
fs.writeFileSync(path.join(ROOT, OUT), JSON.stringify(rows, null, 2));
const passed = rows.filter(r => r.pass);
console.log(`图门槛：${passed.length}/${rows.length} 通过`);
console.log('\n通过的前 10 张：');
for (const r of passed.slice(0, 10)) console.log(`  ${r.file.slice(0, 46).padEnd(46)} 背景${String(r.bgShare).padStart(2)}% 主体${String(r.subShare).padStart(2)}% 色${String(r.colors).padStart(2)} 首手${r.firstQuad}`);
console.log('\n未通过原因统计：');
const why = { bg: 0, sub: 0, colors: 0, quad: 0 };
for (const r of rows) { if (!r.checks.bgOK) why.bg++; if (!r.checks.subOK) why.sub++; if (!r.checks.colorsOK) why.colors++; if (!r.checks.quadOK) why.quad++; }
console.log(`  背景>${MAX_BG * 100}%: ${why.bg} 张 | 主体<${MIN_SUB * 100}%: ${why.sub} 张 | 颜色<${MIN_COLORS}: ${why.colors} 张 | 首手跨象限: ${why.quad} 张`);
console.log('写出：' + OUT);
