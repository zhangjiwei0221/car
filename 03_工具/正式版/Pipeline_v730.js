// Pipeline_v730.js —— 一条命令跑完：合成 → 切块 → 构建 → 审核 → 报告
// 用法：node Pipeline_v730.js --config cfg.json --tag 三层_v1 [--rounds 4] [--guide 14]
'use strict';
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const { advise, loadMatrix } = require('./SizeAdvisor_v723.js');
const ROOT = path.resolve(__dirname, '../..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const CFG = arg('--config');
const TAG = arg('--tag', 'run');
const ROUNDS = Number(arg('--rounds', 4));
const SAMPLES = Number(arg('--samples', 30));
const GUIDE = Number(arg('--guide', 0));
const OUTDIR = path.join(ROOT, '实验关', '三层', TAG);
fs.mkdirSync(OUTDIR, { recursive: true });

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });
  return { out: (r.stdout || '') + (r.stderr || ''), ok: r.status === 0 };
}

const report = { tag: TAG, at: new Date().toISOString() };

// 1) 合成
const target = path.join(OUTDIR, '目标图.txt');
const png = path.join(ROOT, '实验关', 'renders', TAG + '.png');
let r = run('node', ['03_工具/正式版/ComposeLayers_v729.js', '--config', CFG, '--out', target, '--png', png]);
const cm = /画布 (\d+)×(\d+) = (\d+) px，色数 (\d+)/.exec(r.out);
report.compose = cm ? { size: +cm[1], pixels: +cm[3], colors: +cm[4] } : null;
console.log(`[1/5] 合成：${cm ? `${cm[1]}×${cm[2]} / ${cm[3]}px / ${cm[4]} 色` : '失败'}`);

// 2) 尺寸顾问
const g = loadMatrix(target);
const a = advise(g.length * g[0].length);
report.advisor = a;
console.log(`[2/5] 顾问：${a.rows}×${a.cols} / ${a.cars} 车 / 合同 [${a.contract}]`);

// 3) 切块
const lv0 = path.join(OUTDIR, '关卡_初始.json');
r = run('node', ['03_工具/正式版/SplitLevel_v722.js', '--target', target, '--out', lv0, '--rows', String(a.rows), '--cols', String(a.cols)]);
const sm = /首测：步 (\d+) \/ 峰值 (\d+) \/ at4 (\d+) \/ run4 (\d+) \/ 通关 (true|false)/.exec(r.out);
report.split = sm ? { steps: +sm[1], peak: +sm[2], at4: +sm[3], run4: +sm[4], won: sm[5] === 'true' } : null;
report.capacityOk = /每色核对：✅/.test(r.out);
console.log(`[3/5] 切块：${report.capacityOk ? '守恒✅' : '守恒❌'} ${sm ? `步${sm[1]} 峰值${sm[2]} at4=${sm[3]}` : '失败'}`);

// 4) 构建
const lv1 = path.join(OUTDIR, '关卡_构建.json');
const bargs = ['03_工具/正式版/OverlapBuild_v719.js', lv0, '--out', lv1, '--rounds', String(ROUNDS), '--samples', String(SAMPLES)];
if (GUIDE > 0) bargs.push('--guide-color', String(GUIDE), '--guide-steps', '6');
r = run('node', bargs);
const bm = /终局：最长低压段(\d+) 低压步(\d+) at4=(\d+) run4=(\d+) 峰值(\d+)/.exec(r.out);
report.built = bm ? { lowRun: +bm[1], lowTotal: +bm[2], at4: +bm[3], run4: +bm[4], peak: +bm[5] } : null;
console.log(`[4/5] 构建：${bm ? `at4=${bm[3]} run4=${bm[4]} 峰值=${bm[5]}` : '失败'}`);

// 5) 审核
r = run('node', ['03_工具/正式版/Validate006Level_v706.js', lv1, '--audit']);
const vm = /audit: pass=(true|false).*?reasons=(\[.*\])/.exec(r.out);
const cap = /capacity: mismatch=none sum=(\d+)/.exec(r.out);
report.auditPass = vm ? vm[1] === 'true' : null;
report.auditReasons = vm ? vm[2] : null;
report.sum = cap ? +cap[1] : null;
report.conserved = report.sum === report.compose.pixels;
console.log(`[5/5] 审核：${report.auditPass ? '✅' : '❌'} ${report.auditReasons || ''}`);

// 汇总
const pass = !!(report.compose && report.capacityOk && report.conserved && report.built &&
  report.built.at4 >= 20 && report.built.run4 >= 12 && report.built.peak <= 4 && report.auditPass);
report.pass = pass;
fs.writeFileSync(path.join(OUTDIR, 'pipeline_report.json'), JSON.stringify(report, null, 2));
console.log(`\n结论：${pass ? '✅ PASS' : '❌ 未达标'}（at4≥20 & run4≥12 & 峰值≤4 & 审核通过 & 守恒）`);
console.log('产物目录：' + OUTDIR);
