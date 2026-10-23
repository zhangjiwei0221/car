#!/usr/bin/env node
/**
 * P3 v2：批量跑「陷阱搜索.js」并统计命中率。
 *
 * 用法：
 *   node 03_工具/难度关系/陷阱批跑.js <关卡1.json> <关卡2.json> ...
 *   node 03_工具/难度关系/陷阱批跑.js --list 清单.txt
 *
 * 判定命中：best.T>0、首通不高于基准+5、学会后或前瞻至少一项高于基准。
 * 输出：03_工具/难度关系/输出/陷阱批跑_<时间>.csv
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const TOOL = path.join(__dirname, '陷阱搜索.js');
const OUT_DIR = path.join(__dirname, '输出');

function parseToolOutput(stdout) {
  const lines = String(stdout || '').split(/\r?\n/);
  let base = null, best = null;
  for (const line of lines) {
    if (line.startsWith('BASE ')) {
      try { base = JSON.parse(line.slice(5)); } catch (e) { }
    }
  }
  // TOP 之后第一条 JSON 是 best
  let inTop = false;
  for (const line of lines) {
    if (line.startsWith('TOP ')) { inTop = true; continue; }
    if (inTop && line.trim().startsWith('{')) {
      try { best = JSON.parse(line); break; } catch (e) { }
    }
  }
  return { base, best };
}

function main() {
  let args = process.argv.slice(2);
  if (args[0] === '--list') {
    args = fs.readFileSync(args[1], 'utf8').split(/\r?\n/).filter(Boolean);
  }
  if (!args.length) {
    console.log('用法: node 03_工具/难度关系/陷阱批跑.js <关卡1.json> ... 或 --list 清单.txt');
    process.exit(1);
  }
  const rows = [];
  let hit = 0;
  for (let i = 0; i < args.length; i++) {
    const file = args[i];
    console.log('[' + (i + 1) + '/' + args.length + '] ' + file);
    let stdout = '', err = '';
    try {
      const r = spawnSync(process.execPath, [TOOL, file, '--top', '1', '--time', '1000', '--max', '60', '--no-write'], {
        encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 300000
      });
      stdout = r.stdout || ''; err = r.stderr || '';
      if (r.status !== 0) err = err || ('exit ' + r.status);
    } catch (e) { err = e.message; }
    const { base, best } = parseToolOutput(stdout);
    const ok = !!(best && base && best.T > 0 && best.first <= base.first + 5 &&
      best.learned >= base.learned && best.look >= base.look && best.T >= base.T && best.learned > best.first &&
      (best.learned > base.learned || best.look > base.look || best.T > base.T));
    if (ok) hit++;
    rows.push({
      file, ok,
      baseFirst: base ? base.first : '', baseLearned: base ? base.learned : '', baseLook: base ? base.look : '',
      baseT: base ? base.T : '', baseR: base ? base.R : '',
      bestFirst: best ? best.first : '', bestLearned: best ? best.learned : '', bestLook: best ? best.look : '',
      bestT: best ? best.T : '', bestR: best ? best.R : '', score: best ? best.score : '',
      swap: best ? best.swap : '', error: err ? err.slice(0, 120).replace(/\s+/g, ' ') : ''
    });
    console.log('    ' + (ok ? 'HIT' : 'miss') + (best ? ('  ' + best.swap + '  first ' + base.first + '->' + best.first + '  learned ' + base.learned + '->' + best.learned + '  T ' + base.T + '->' + best.T) : '  (no best)'));
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const csv = path.join(OUT_DIR, '陷阱批跑_' + stamp + '.csv');
  const header = ['file,ok,baseFirst,baseLearned,baseLook,baseT,baseR,bestFirst,bestLearned,bestLook,bestT,bestR,score,swap,error'];
  for (const r of rows) {
    header.push(['"' + r.file + '"', r.ok ? 1 : 0, r.baseFirst, r.baseLearned, r.baseLook, r.baseT, r.baseR,
      r.bestFirst, r.bestLearned, r.bestLook, r.bestT, r.bestR, r.score, '"' + r.swap + '"', '"' + r.error + '"'].join(','));
  }
  fs.writeFileSync(csv, '\ufeff' + header.join('\n'));
  console.log('\n命中 ' + hit + '/' + rows.length + ' (‘T>0 且首通不升 且学会/前瞻至少一项回升’)');
  console.log('CSV: ' + csv);
}

main();
