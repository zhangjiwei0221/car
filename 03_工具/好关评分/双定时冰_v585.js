#!/usr/bin/env node
/** v585：保持主冰48，分别测试两辆实际供给上的第二把定时冰。 */
'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const HERE = __dirname;
const SCRIPT = path.join(HERE, '单冰窗口_v583.js');
const OUT = path.join(HERE, '双定时冰_v585.json');
const CASES = [
  { r: 4, c: 2, value: 30 },
  { r: 5, c: 5, value: 32 }
];
const rows = [];
for (const x of CASES) {
  const outFile = path.join(HERE, '双定时冰_v585_' + x.r + '_' + x.c + '.json');
  const run = cp.spawnSync(process.execPath, [SCRIPT], {
    env: Object.assign({}, process.env, {
      ICE_VALUE: '48', EXTRA_ICE_CELL: x.r + ',' + x.c, EXTRA_ICE_VALUE: String(x.value)
    }),
    encoding: 'utf8'
  });
  if (run.status !== 0) throw new Error('extra ice failed: ' + (run.stderr || run.stdout));
  process.stdout.write(run.stdout);
  const rec = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  rows.push({
    extraIce: rec.extraIce, valid: rec.valid, watches: rec.watches,
    quality: rec.quality, curve: rec.curve,
    maxBuffer: rec.experience && rec.experience.metrics && rec.experience.metrics.maxBuffer,
    experiencePass: !!(rec.experience && rec.experience.pass),
    source: path.relative(HERE, outFile)
  });
}
const bufferMax = rows.map(x => Math.max(0, ...(x.watches || []).map(w => w.bufferAfter || 0)));
const report = {
  schema: 'dual-timed-ice-v585', date: '2026-10-27', cases: CASES, rows,
  summary: {
    variants: rows.length,
    buffer3: rows.filter(x => (x.watches || []).some(w => w.bufferAfter >= 3)).length,
    qGate: rows.filter(x => x.quality && x.quality.gatePass).length,
    experience: rows.filter(x => x.experiencePass).length,
    maxBuffers: rows.map((x, i) => x.maxBuffer || bufferMax[i])
  }
};
fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ out: path.relative(process.cwd(), OUT), summary: report.summary }, null, 2));
