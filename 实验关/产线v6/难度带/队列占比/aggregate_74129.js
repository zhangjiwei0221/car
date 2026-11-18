#!/usr/bin/env node
'use strict';
/**
 * aggregate_74129 —— 汇总队列占比各档的构建/硬门/测量，输出 JSON + Markdown 表
 *
 * 用法: node aggregate_74129.js <实验根目录，如 实验关/产线v6/难度带/队列占比/194>
 */
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
if (!root) { console.error('用法: node aggregate_74129.js <实验根目录>'); process.exit(2); }
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } };
const readText = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch (e) { return ''; } };
const dirs = fs.readdirSync(root).filter(d => /^Q\d+$/.test(d)).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
const rungs = [];
for (const d of dirs) {
  const dir = path.join(root, d);
  const build = readJson(path.join(dir, '构建.json'));
  const levelFile = fs.readdirSync(dir).find(f => f.startsWith('关卡_') && f.endsWith('.json'));
  if (!build || !levelFile) continue;
  const Q = Number(d.slice(1));
  const ratio = Q / 49;
  const solv = {};
  for (const w of [8, 16, 32]) solv['w' + w] = readJson(path.join(dir, `可通关_w${w}.json`));
  const ratchet = readJson(path.join(dir, '棘轮.json'));
  const escape = readJson(path.join(dir, '逃生阀.json'));
  const cons = readJson(path.join(dir, '守恒.json'));
  const layout = readJson(path.join(dir, 'layout.json'));
  const at4 = readText(path.join(dir, 'at4.txt')).trim().split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
  const open = {};
  for (const s of [977, 4242]) {
    const t = readText(path.join(dir, `open_random_${s}.txt`)).trim();
    open[s] = t ? JSON.parse(t.split('\n').pop()) : null;
  }
  const openprobe = readText(path.join(dir, 'openprobe.txt')).trim();
  const pinterp = {};
  for (const s of [977, 4242]) {
    const a = readJson(path.join(dir, `pinterp_${s}`, 'summary_all.json'));
    if (!a) continue;
    const w = {}; let lt10 = 0, lt25 = 0, games = 0;
    for (const x of a) {
      w[x.p] = x.winRate;
      const dd = x.deathDist || {};
      lt10 += dd.lt10 || 0;
      lt25 += (dd.lt10 || 0) + (dd.p10_25 || 0);
      games += x.games;
    }
    const mean = (ks) => ks.reduce((s2, k) => s2 + (w[k] || 0), 0) / ks.length;
    pinterp[s] = {
      casual: +mean([0, 0.1, 0.2]).toFixed(4),
      serious: +mean([0.8, 0.9, 1]).toFixed(4),
      mid: +mean([0.3, 0.4, 0.5, 0.6, 0.7]).toFixed(4),
      lt10: `${lt10}/${games}`, lt25: `${lt25}/${games}`,
      curve: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1].map(p => w[p] == null ? null : +w[p].toFixed(3)),
      perP: w,
    };
  }
  rungs.push({
    rung: d, Q, ratio: +(ratio).toFixed(4), blacks: build.blackCount, opening: build.openingPickable,
    hiddenPx: build.pipes[0].queueParam.reduce((a, x) => a + x.count, 0),
    conserved: build.conserved, queue: build.pipes[0].queueParam.map(x => `${x.id}/${x.count}`).join(','),
    exit: build.pipes[0].pipe.exit, solvable: Object.fromEntries(Object.entries(solv).map(([k, v]) => [k, v && v.solvable])),
    ratchet: ratchet && ratchet.summary, escape: escape && escape.results && escape.results[0] && { ok: escape.results[0].ok, hits: escape.results[0].hits.length },
    layout: layout && layout.rows && layout.rows[0] && { hard: (layout.rows[0].hard || []).length, warn: (layout.rows[0].warn || []).length, maxRun: layout.rows[0].maxRun, blackRatio: layout.rows[0].blackRatio },
    open977: open[977], open4242: open[4242], openprobe: openprobe ? JSON.parse(openprobe.split('\n').pop()) : null,
    at4, pinterp,
  });
}
fs.writeFileSync(path.join(root, '汇总_队列占比.json'), JSON.stringify(rungs, null, 1));
// Markdown
const L = [];
L.push('| 档 | Q | 占比(车) | 隐藏px占比 | 黑块 | 开管中位 977/4242（率） | 随意 977 / 4242 | 认真 977 / 4242 | lt10 977/4242 | lt25 977/4242 | at4 p.1/p.2 | 可解 w8/16/32 |');
L.push('|---|---:|---:|---:|---:|---|---|---|---|---|---|---|');
for (const r of rungs) {
  const o977 = r.open977 ? `${r.open977.openProgressMedian}（${Math.round(r.open977.openRate * 100)}%）` : '—';
  const o4242 = r.open4242 ? `${r.open4242.openProgressMedian}（${Math.round(r.open4242.openRate * 100)}%）` : '—';
  const p = r.pinterp;
  const c = p[977] ? p[977].casual : null, c2 = p[4242] ? p[4242].casual : null;
  const s = p[977] ? p[977].serious : null, s2 = p[4242] ? p[4242].serious : null;
  const l10 = p[977] ? p[977].lt10 : '—', l102 = p[4242] ? p[4242].lt10 : '—';
  const l25 = p[977] ? p[977].lt25 : '—', l252 = p[4242] ? p[4242].lt25 : '—';
  const a4 = r.at4.map(x => x.meanAt4).join('/');
  const sv = `w8=${r.solvable.w8}/w16=${r.solvable.w16}/w32=${r.solvable.w32}`;
  L.push(`| ${r.rung} | ${r.Q} | ${(r.ratio * 100).toFixed(1)}% | ${((r.hiddenPx || 0) / 1982 * 100).toFixed(1)}% | ${r.blacks} | ${o977} / ${o4242} | ${c} / ${c2} | ${s} / ${s2} | ${l10} / ${l102} | ${l25} / ${l252} | ${a4} | ${sv} |`);
}
fs.writeFileSync(path.join(root, '汇总_队列占比.md'), L.join('\n') + '\n');
console.log(L.join('\n'));
