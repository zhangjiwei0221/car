// QuadrantSweep_v732.js —— M4：象限组合 × 深度阶梯 扫描，看“引导+压力”能稳定出几张
// 用法：node QuadrantSweep_v732.js --n 6 --depth 0,1,2,3 --probe-min 10 --rounds 5 --tag m4
'use strict';
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const { advise, loadMatrix } = require('./SizeAdvisor_v723.js');
const ROOT = path.resolve(__dirname, '../..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const N = Number(arg('--n', 6));
const DEPTH = arg('--depth', '0,1,2,3');
const PROBE_MIN = Number(arg('--probe-min', 10));
const ROUNDS = Number(arg('--rounds', 5));
const TAG = arg('--tag', 'm4');
const TMP = '/tmp/sweep'; fs.mkdirSync(TMP, { recursive: true });

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });
  return (r.stdout || '') + (r.stderr || '');
}
const files = fs.readdirSync(path.join(ROOT, '关卡')).filter(f => f.endsWith('.txt')).sort();
// 均匀抽 4*N 张做组合
const step = Math.max(1, Math.floor(files.length / (4 * N)));
const pool = [];
for (let i = 0; i < files.length && pool.length < 4 * N; i += step) pool.push(path.join(ROOT, '关卡', files[i]));

const rows = [];
for (let k = 0; k < N; k++) {
  const set = pool.slice(k * 4, k * 4 + 4);
  if (set.length < 4) break;
  const tag = `${TAG}_${k + 1}`;
  const target = path.join(TMP, tag + '.txt');
  const out = run('node', ['03_工具/正式版/ComposeQuadrants_v731.js', '--levels', set.join(','), '--out', target, '--size', '44', '--depth', DEPTH, '--max-colors', '15']);
  const cm = /画布 (\d+)×(\d+) = (\d+)px，色数 (\d+)/.exec(out);
  const g = loadMatrix(target);
  const a = advise(g.length * g[0].length);
  const lv0 = path.join(TMP, tag + '_flat.json');
  run('node', ['03_工具/正式版/SplitLevel_v722.js', '--target', target, '--out', lv0, '--rows', String(a.rows), '--cols', String(a.cols)]);
  const lvP = path.join(TMP, tag + '_probe.json');
  const po = run('node', ['03_工具/正式版/OverlapBuild_v719.js', lv0, '--out', lvP, '--rounds', '2', '--samples', '25']);
  const pm = /at4=(\d+) run4=(\d+)/.exec(po);
  const probeAt4 = pm ? +pm[1] : -1;
  const rec = { tag, set: set.map(s => path.basename(s).slice(0, 9)), colors: cm ? +cm[4] : null, depth: DEPTH, probeAt4 };
  if (probeAt4 < PROBE_MIN) {
    rec.built = null; rec.pass = false; rec.reason = `探测at4=${probeAt4}<${PROBE_MIN}`;
  } else {
    const lv1 = path.join(TMP, tag + '_built.json');
    const bo = run('node', ['03_工具/正式版/OverlapBuild_v719.js', lv0, '--out', lv1, '--rounds', String(ROUNDS), '--samples', '40']);
    const bm = /at4=(\d+) run4=(\d+) 峰值(\d+)/.exec(bo.slice(bo.lastIndexOf('终局')));
    const vo = run('node', ['03_工具/正式版/Validate006Level_v706.js', lv1, '--audit']);
    const cap = /capacity: mismatch=none sum=(\d+)/.exec(vo);
    const am = /audit: pass=(true|false).*?reasons=(\[.*\])/.exec(vo);
    rec.built = bm ? { at4: +bm[1], run4: +bm[2], peak: +bm[3] } : null;
    rec.sum = cap ? +cap[1] : null;
    rec.conserved = rec.sum === (cm ? +cm[3] : -1);
    rec.auditReasons = am ? am[2] : null;
    rec.pass = !!(rec.built && rec.built.at4 >= 20 && rec.built.run4 >= 12 && rec.built.peak <= 4 && rec.conserved);
    rec.reason = rec.pass ? null : (!rec.built ? '构建失败' : (rec.built.at4 < 20 ? 'at4不足' : '其它'));
    fs.copyFileSync(lv1, path.join(ROOT, '实验关', '三层', tag + '_关卡.json'));
    fs.copyFileSync(target, path.join(ROOT, '实验关', '三层', tag + '_目标图.txt'));
  }
  rows.push(rec);
  console.log(`[${k + 1}/${N}] ${tag} 色${rec.colors} 探测at4=${probeAt4} ${rec.built ? `→ at4=${rec.built.at4} run4=${rec.built.run4}` : '(跳过)'} ${rec.pass ? 'PASS' : 'FAIL:' + rec.reason}`);
  fs.writeFileSync(path.join(ROOT, '输出', `象限扫描_${TAG}.json`), JSON.stringify(rows, null, 2));
}
const pass = rows.filter(r => r.pass).length;
console.log(`\n象限扫描：PASS ${pass}/${rows.length}`);
