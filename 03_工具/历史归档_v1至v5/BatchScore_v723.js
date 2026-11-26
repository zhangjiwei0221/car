// BatchScore_v723.js —— 批量跑分：N 张图 → 成功率 + 失败原因分布
// 用法：node BatchScore_v723.js --n 20 --rounds 4 --samples 30 --tag batch1
'use strict';
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const { advise, loadMatrix } = require('./SizeAdvisor_v723.js');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const N = Number(arg('--n', 20));
const ROUNDS = Number(arg('--rounds', 4));
const SAMPLES = Number(arg('--samples', 30));
const TAG = arg('--tag', 'batch');
const BUILD_ARGS = String(arg('--build-args', '')).split(' ').filter(Boolean);
const ALLOW_EARLY = process.argv.includes('--allow-early');  // 用户口径：允许前期卡点
const PROBE_MIN = Number(arg('--probe-min', 0));   // >0：先跑 2 轮探测，at4 低于此值直接丢弃
const ROOT = path.resolve(__dirname, '../..');
const TMP = '/tmp/batchscore';
fs.mkdirSync(TMP, { recursive: true });

function run(cmd, args, timeout) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', timeout: timeout || 600000, maxBuffer: 1 << 26 });
  return (r.stdout || '') + (r.stderr || '');
}

// 均匀抽 N 张
const all = fs.readdirSync(path.join(ROOT, '关卡')).filter(f => f.endsWith('.txt')).sort();
const step = Math.max(1, Math.floor(all.length / N));
const pick = [];
for (let i = 0; i < all.length && pick.length < N; i += step) pick.push(all[i]);

const rows = [];
for (let k = 0; k < pick.length; k++) {
  const file = pick[k];
  const full = path.join(ROOT, '关卡', file);
  const label = file.replace(/_.*$/, '');
  const t0 = Date.now();
  let rec = { file, label, ok: false };
  try {
    const g = loadMatrix(full);
    const pixels = g.length * g[0].length;
    const a = advise(pixels);
    rec = Object.assign(rec, { pixels, rows: a.rows, cols: a.cols, cars: a.cars, contract: a.contract });
    const lv0 = path.join(TMP, label + '_flat.json');
    const out0 = run('node', ['03_工具/正式版/SplitLevel_v722.js', '--target', full, '--out', lv0, '--rows', String(a.rows), '--cols', String(a.cols)]);
    const m0 = /首测：步 (\d+) \/ 峰值 (\d+) \/ at4 (\d+) \/ run4 (\d+) \/ 通关 (true|false)/.exec(out0);
    const capOk = /每色核对：✅/.test(out0);
    rec.split = m0 ? { steps: +m0[1], peak: +m0[2], at4: +m0[3], run4: +m0[4], won: m0[5] === 'true' } : null;
    rec.capacityOk = capOk;
    if (!rec.split) { rec.reason = '切块失败'; }
    else if (!capOk) { rec.reason = '容量不守恒'; }
    else if (!rec.split.won) { rec.reason = '初始不可解'; }
    else {
      if (PROBE_MIN > 0) {
        const lvP = path.join(TMP, label + '_probe.json');
        const outP = run('node', ['03_工具/正式版/OverlapBuild_v719.js', lv0, '--out', lvP, '--rounds', '2', '--samples', '25']);
        const mp = /终局：.*?at4=(\d+) run4=(\d+)/.exec(outP);
        rec.probeAt4 = mp ? +mp[1] : null;
        if (rec.probeAt4 !== null && rec.probeAt4 < PROBE_MIN) {
          rec.ok = false; rec.reason = `探测at4=${rec.probeAt4}<${PROBE_MIN}（跳过构建）`;
          rows.push(rec);
          console.log(`[${k + 1}/${pick.length}] ${label} 探测at4=${rec.probeAt4} → 跳过 (${Math.round((Date.now() - t0) / 1000)}s)`);
          fs.writeFileSync(path.join(ROOT, '输出', `批量跑分_${TAG}.json`), JSON.stringify(rows, null, 2));
          continue;
        }
      }
      const lv1 = path.join(TMP, label + '_built.json');
      const out1 = run('node', ['03_工具/正式版/OverlapBuild_v719.js', lv0, '--out', lv1, '--rounds', String(ROUNDS), '--samples', String(SAMPLES)].concat(BUILD_ARGS));
      const m1 = /终局：最长低压段(\d+) 低压步(\d+) at4=(\d+) run4=(\d+) 峰值(\d+)/.exec(out1);
      rec.built = m1 ? { lowRun: +m1[1], lowTotal: +m1[2], at4: +m1[3], run4: +m1[4], peak: +m1[5] } : null;
      const auditOut = run('node', ['03_工具/正式版/Validate006Level_v706.js', lv1, '--audit']);
      const am = /audit: pass=(true|false).*?reasons=(\[.*\])/.exec(auditOut);
      rec.auditPass = am ? am[1] === 'true' : null;
      rec.auditReasons = am ? am[2] : null;
      const cm = /capacity: mismatch=none sum=(\d+)/.exec(auditOut);
      rec.sum = cm ? +cm[1] : null;
      rec.conserved = rec.sum === pixels;
      const best = rec.built || rec.split;
      const reasons = String(rec.auditReasons || '');
      const lateBad = /中后期|30%~100%无卡点/.test(reasons) && !/前期/.test(reasons);
      const auditOk = ALLOW_EARLY ? !lateBad : rec.auditPass;
      rec.ok = !!(best && best.at4 >= 20 && best.run4 >= 12 && best.peak <= 4 && auditOk && rec.conserved);
      rec.auditOkByUser = auditOk;
      rec.reason = rec.ok ? null : (!auditOk ? '中后期无卡点' : (best.at4 < 20 ? 'at4不足' : (best.run4 < 12 ? 'run4不足' : (best.peak > 4 ? '峰值超限' : '其它'))));
    }
  } catch (e) { rec.reason = '异常:' + e.message.slice(0, 60); }
  rec.seconds = Math.round((Date.now() - t0) / 1000);
  rows.push(rec);
  const b = rec.built || rec.split || {};
  console.log(`[${k + 1}/${pick.length}] ${label} 盘${rec.rows}x${rec.cols} 车${rec.cars} 守恒${rec.conserved ? '✅' : '❌'} at4=${b.at4} run4=${b.run4} 峰值=${b.peak} 审核=${rec.auditPass ? '✅' : '❌'} ${rec.ok ? 'PASS' : 'FAIL:' + rec.reason} (${rec.seconds}s)`);
  // 增量落盘，防止中途崩
  fs.writeFileSync(path.join(ROOT, '输出', `批量跑分_${TAG}.json`), JSON.stringify(rows, null, 2));
}

// 汇总
const pass = rows.filter(r => r.ok).length;
const reasons = {};
for (const r of rows) if (!r.ok) reasons[r.reason] = (reasons[r.reason] || 0) + 1;
const out = { tag: TAG, total: rows.length, pass, rate: Math.round(pass / rows.length * 1000) / 10, reasons, rows };
fs.writeFileSync(path.join(ROOT, '输出', `批量跑分_${TAG}.json`), JSON.stringify(out, null, 2));
console.log(`\n成功率 ${pass}/${rows.length} = ${out.rate}%`);
console.log('失败原因：', JSON.stringify(reasons, null, 0));
