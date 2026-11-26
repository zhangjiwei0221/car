// ImageFilter_v725.js —— 筛图器：在“构建”之前预判这张图能不能出持续压力
// 用法：node ImageFilter_v725.js --dir 关卡 --n 20 [--json 输出.json]
'use strict';
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const { advise, loadMatrix, colorTotals } = require('./SizeAdvisor_v723.js');
const B = require('./Build006Thickness_v688');
const A = B.loadSolver();

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DIR = arg('--dir', '关卡');
const N = Number(arg('--n', 20));
const OUT = arg('--json', '输出/筛图特征.json');
const PROBE = Number(arg('--probe', 0));      // >0 时跑 N 轮快速构建做探测
const MIN_AT4 = Number(arg('--min-at4', 10)); // 探测后判定阈值
const ROOT = path.resolve(__dirname, '../..');
const TMP = '/tmp/filter';
fs.mkdirSync(TMP, { recursive: true });

function regions(g) {
  const R = g.length, C = g[0].length;
  const seen = Array.from({ length: R }, () => new Array(C).fill(false));
  const out = {};
  for (let y = 0; y < R; y++) for (let x = 0; x < C; x++) {
    if (seen[y][x]) continue;
    const col = g[y][x]; const st = [[y, x]]; seen[y][x] = true; let n = 0;
    while (st.length) {
      const [cy, cx] = st.pop(); n++;
      for (const [dy, dx] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ny = cy + dy, nx = cx + dx;
        if (ny >= 0 && ny < R && nx >= 0 && nx < C && !seen[ny][nx] && g[ny][nx] === col) { seen[ny][nx] = true; st.push([ny, nx]); }
      }
    }
    (out[col] = out[col] || []).push(n);
  }
  return out;
}

function evalLevel(g) {
  const lv = A.parseLevel(A.fromGameFormat(g));
  const o = A.Solver.runSolver(lv, 0, 1, false, false, { capturePreviewStats: true, instantChain: true });
  const buf = (o.pressureSamples || []).map(s => s.buf || 0);
  let at4 = 0, run4 = 0, cur = 0;
  for (const v of buf) { if (v >= 4) { cur++; at4++; run4 = Math.max(run4, cur); } else cur = 0; }
  const first = {};
  (o.pickOrder || []).forEach((p, i) => { if (first[p.color] === undefined) first[p.color] = i + 1; });
  return { won: !!o.completed, peak: Math.max(0, ...buf), at4, run4, steps: buf.length, first };
}

function features(full) {
  const g = loadMatrix(full);
  const R = g.length, C = g[0].length, pixels = R * C;
  const tot = colorTotals(g), reg = regions(g);
  const colors = Object.keys(tot).length;
  let maxReg = 0, maxRegColor = null;
  for (const c of Object.keys(reg)) { const m = Math.max(...reg[c]); if (m > maxReg) { maxReg = m; maxRegColor = +c; } }
  const a = advise(pixels);
  const lv0 = path.join(TMP, path.basename(full, '.txt') + '.json');
  const out = spawnSync('node', ['03_工具/正式版/SplitLevel_v722.js', '--target', full, '--out', lv0, '--rows', String(a.rows), '--cols', String(a.cols)], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });
  let flat = null, capacityOk = /每色核对：✅/.test(out.stdout || '');
  try { flat = evalLevel(JSON.parse(fs.readFileSync(lv0, 'utf8'))); } catch (e) { flat = null; }
  // 晚解锁色：首次被用 ≥60% 步数，且该色总量 ≥ 25
  let lateColors = 0;
  if (flat) for (const c of Object.keys(flat.first)) { if (flat.first[c] >= 0.6 * flat.steps && (tot[c] || 0) >= 25) lateColors++; }
  // 稀疏色：最大连通区 < 平均车容量（说明该色永远吃不满一整块）
  const avgCap = pixels / a.cars;
  let scarce = 0;
  for (const c of Object.keys(reg)) if (Math.max(...reg[c]) < avgCap * 0.9) scarce++;
  return { file: path.basename(full), pixels, colors, rows: a.rows, cols: a.cols, cars: a.cars,
    maxReg, maxRegShare: Math.round(maxReg / pixels * 100), avgCap: Math.round(avgCap * 10) / 10,
    capacityOk, flatAt4: flat ? flat.at4 : null, flatRun4: flat ? flat.run4 : null,
    flatPeak: flat ? flat.peak : null, flatWon: flat ? flat.won : null,
    lateColors, scarce, steps: flat ? flat.steps : null };
}

const files = fs.readdirSync(path.join(ROOT, DIR)).filter(f => f.endsWith('.txt')).sort();
const step = Math.max(1, Math.floor(files.length / N));
const pick = [];
for (let i = 0; i < files.length && pick.length < N; i += step) pick.push(files[i]);

const rows = [];
for (const f of pick) {
  try {
    const full = path.join(ROOT, DIR, f);
    const r = features(full);
    if (PROBE > 0) {
      const lv0 = path.join(TMP, path.basename(f, '.txt') + '.json');
      const lvP = path.join(TMP, path.basename(f, '.txt') + '_probe.json');
      const out = spawnSync('node', ['03_工具/正式版/OverlapBuild_v719.js', lv0, '--out', lvP, '--rounds', String(PROBE), '--samples', '25'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });
      const m = /终局：.*?at4=(\d+) run4=(\d+) 峰值(\d+)/.exec(out.stdout || '');
      r.probeAt4 = m ? +m[1] : null; r.probeRun4 = m ? +m[2] : null; r.probePeak = m ? +m[3] : null;
      r.keep = r.probeAt4 !== null && r.probeAt4 >= MIN_AT4;
    }
    rows.push(r);
    console.log(`${r.file.slice(0, 10)} 色${r.colors} 最大区${r.maxRegShare}%${PROBE > 0 ? ` 探测at4=${r.probeAt4} run4=${r.probeRun4}` : ''}${r.keep !== undefined ? (r.keep ? ' → 保留' : ' → 丢弃') : ''}`);
  } catch (e) { console.log(f + ' 失败: ' + e.message.slice(0, 40)); }
}
fs.writeFileSync(path.join(ROOT, OUT), JSON.stringify(rows, null, 2));
console.log(`\n写出 ${OUT}（${rows.length} 张）`);
