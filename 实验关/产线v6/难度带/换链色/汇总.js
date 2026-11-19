#!/usr/bin/env node
'use strict';
// 换链色实验汇总：PInterp 三段、链账（进场中位/0 进度步数）、at4。
// 用法: node 汇总.js
const fs = require('fs');
const path = require('path');
const D = __dirname;
const VARIANTS = ['C1_换链色', 'C2_换链色去冰', 'C3_原链去冰', 'C4_原链'];
const SEEDS = ['977', '4242'];
const PS = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const fmt = (x) => x.toFixed(3);
const pct = (x) => (x >= 0 ? '+' : '') + (x * 100).toFixed(1) + 'pp';

function seg(by) {
  const casual = mean([0, 0.1, 0.2].map(p => by[p]));
  const mid = mean([0.3, 0.4, 0.5, 0.6, 0.7].map(p => by[p]));
  const mid46 = mean([0.4, 0.5, 0.6].map(p => by[p]));
  const serious = mean([0.8, 0.9, 1].map(p => by[p]));
  const vals = PS.map(p => by[p]);
  let rises = 0, drops = 0;
  for (let i = 1; i < vals.length; i++) { if (vals[i] > vals[i - 1] + 1e-9) rises++; if (vals[i] < vals[i - 1] - 1e-9) drops++; }
  return { casual, mid, mid46, serious, rises, drops, curve: vals };
}

const out = { pinterp: {}, chain: {}, at4: {} };
console.log('=== PInterp 三段（100 局/档） ===');
console.log('variant        seed  casual  mid.3-.7 mid.4-.6 serious | rises drops | curve');
for (const v of VARIANTS) {
  out.pinterp[v] = {};
  for (const s of SEEDS) {
    const f = path.join(D, `pinterp_${v}_${s}`, 'summary_all.json');
    if (!fs.existsSync(f)) { console.log(`${v} ${s}: MISSING`); continue; }
    const d = JSON.parse(fs.readFileSync(f, 'utf8'));
    const by = {}; for (const row of d) by[Math.round(row.p * 1000) / 1000] = row.winRate;
    const sg = seg(by);
    out.pinterp[v][s] = { by, ...sg };
    console.log(`${v.padEnd(14)} ${s.padEnd(5)} ${fmt(sg.casual)}   ${fmt(sg.mid)}    ${fmt(sg.mid46)}    ${fmt(sg.serious)} | ${sg.rises}     ${sg.drops}     | ${sg.curve.map(x => x.toFixed(2)).join('/')}`);
  }
  if (out.pinterp[v]['977'] && out.pinterp[v]['4242']) {
    const a = out.pinterp[v]['977'], b = out.pinterp[v]['4242'];
    console.log(`${v.padEnd(14)} 均值  ${fmt((a.casual + b.casual) / 2)}   ${fmt((a.mid + b.mid) / 2)}    ${fmt((a.mid46 + b.mid46) / 2)}    ${fmt((a.serious + b.serious) / 2)}`);
  }
}

console.log('\n=== 链账（每局均值；入场=链组首次进暂存的起点进度） ===');
for (const v of VARIANTS) {
  const f = path.join(D, `链账_${v}.json`);
  if (!fs.existsSync(f)) { console.log(`${v}: MISSING`); continue; }
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  out.chain[v] = j;
  console.log(`-- ${v}`);
  for (const r of j.runs) {
    const gs = Object.keys(r.chain).sort().map(g => {
      const c = r.chain[g];
      return `g${g}(${c.colors.map(x => x.split('色')[1]).join('+')}) 入场中位=${c.entryProgressMed} 0步/局=${c.zeroStepsMean} 死时0率=${c.endZeroRate}`;
    });
    console.log(`   p=${r.p} seed=${r.seed} win=${r.winRate} | ${gs.join(' | ')} | 任意链0步/局=${r.anyChainZeroStepsMean} 色0步=${JSON.stringify(r.zeroStepsMeanByColor)}`);
  }
}

console.log('\n=== at4（p=0.1/0.2，seed 977，100 局） ===');
for (const v of VARIANTS) {
  const f = path.join(D, 'at4', `at4_${v}.txt`);
  if (!fs.existsSync(f)) { console.log(`${v}: MISSING`); continue; }
  const lines = fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  out.at4[v] = lines;
  console.log(`${v}: ` + lines.map(l => `p${l.p} win=${l.winRate} at4=${l.meanAt4} at3=${l.meanAt3} peak=${l.meanPeak} 有at4局=${l.gamesWithAt4}`).join(' | '));
}

fs.writeFileSync(path.join(D, '汇总.json'), JSON.stringify(out, null, 1));
console.log('\nsaved', path.join(D, '汇总.json'));
