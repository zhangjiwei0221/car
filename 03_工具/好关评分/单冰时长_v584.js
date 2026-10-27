#!/usr/bin/env node
/** v584：复用v583单冰实验，比较29/35/42/48四个解锁时长。 */
'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const HERE = __dirname;
const SCRIPT = path.join(HERE, '单冰窗口_v583.js');
const OUT = path.join(HERE, '单冰时长_v584.json');
const VALUES = [29, 35, 42, 48];
const rows = [];

for (const value of VALUES) {
  const outFile = path.join(HERE, value === 29 ? '单冰窗口_v583.json' : '单冰时长_v584_' + value + '.json');
  if (value !== 29 || !fs.existsSync(outFile)) {
    const r = cp.spawnSync(process.execPath, [SCRIPT], {
      env: Object.assign({}, process.env, { ICE_VALUE: String(value) }),
      encoding: 'utf8'
    });
    if (r.status !== 0) {
      throw new Error('ICE_VALUE=' + value + ' failed: ' + (r.stderr || r.stdout));
    }
    process.stdout.write(r.stdout);
  }
  const rec = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  rows.push({
    iceValue: value, valid: rec.valid, watches: rec.watches,
    quality: rec.quality, curve: rec.curve,
    maxBuffer: rec.experience && rec.experience.metrics && rec.experience.metrics.maxBuffer,
    experiencePass: !!(rec.experience && rec.experience.pass),
    source: path.relative(HERE, outFile)
  });
}

const report = {
  schema: 'single-ice-duration-v584', date: '2026-10-27',
  iceCell: { r: 4, c: 3 }, values: VALUES, rows,
  summary: {
    values: rows.length,
    buffer3: rows.filter(x => (x.watches || []).some(w => w.role === 'debt' && w.bufferAfter >= 3)).length,
    qGate: rows.filter(x => x.quality && x.quality.gatePass).length,
    experience: rows.filter(x => x.experiencePass).length,
    maxBuffers: rows.map(x => x.maxBuffer)
  }
};
fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ out: path.relative(process.cwd(), OUT), summary: report.summary }, null, 2));
