#!/usr/bin/env node
/** v588：固定全部条件，只比较targetBuffer3与shortDebt。 */
'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');

const HERE = __dirname;
const SCRIPT = path.join(HERE, '债务间隔_seed筛选_v587.js');
const OUT = path.join(HERE, '债务策略AB_v588.json');
const POLICIES = ['targetBuffer', 'shortDebt'];
const rows = [];
function hashFile(p) {
  return fs.existsSync(p) ? crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') : null;
}

for (const policy of POLICIES) {
  const outFile = path.join(HERE, '债务策略AB_v588_' + policy + '.json');
  const run = cp.spawnSync(process.execPath, [SCRIPT], {
    env: Object.assign({}, process.env, { PLAN_POLICY: policy, SEEDS: '1001', AB_MODE: 'v588' }),
    encoding: 'utf8'
  });
  if (run.status !== 0) throw new Error(policy + ' failed: ' + (run.stderr || run.stdout));
  process.stdout.write(run.stdout);
  const rec = JSON.parse(fs.readFileSync(outFile, 'utf8')).rows[0];
  const levelFile = path.join(HERE, '债务策略AB_v588_' + policy + '.levels', '1001.json');
  rows.push({
    policy, valid: rec.valid, failReason: rec.failReason, board: rec.board,
    cars: rec.cars, debt: rec.debt, quality: rec.quality, curve: rec.curve,
    maxBuffer: rec.maxBuffer, levelHash: hashFile(levelFile),
    source: path.relative(HERE, outFile)
  });
}

const sameHash = rows.length === 2 && rows[0].levelHash && rows[0].levelHash === rows[1].levelHash;
const report = {
  schema: 'debt-policy-ab-v588', date: '2026-10-27', seed: 1001, policies: POLICIES, rows,
  summary: {
    valid: rows.filter(x => x.valid).length,
    sameHash,
    debtCandidates: rows.map(x => x.debt && x.debt.candidates.length),
    minGaps: rows.map(x => x.debt && x.debt.minGap),
    maxBuffers: rows.map(x => x.maxBuffer),
    freeLow: rows.map(x => x.curve && x.curve.freeLowPct),
    freeRun: rows.map(x => x.curve && x.curve.freeRunMax)
  }
};
fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ out: path.relative(process.cwd(), OUT), summary: report.summary }, null, 2));
