#!/usr/bin/env node
'use strict';
/**
 * ModeBBatch_v1 —— Mode B 多起点批处理：参数网格 → RouteFirstB → ModeBCheck → 汇总
 *
 * 用法：node ModeBBatch_v1.js <目标图.txt> <输出目录> [--tag 名称] [--avgs 85,90,95,100]
 *   [--boards auto,3x7,4x6] [--timeout 180]
 *
 * 说明：每跑完一个组合就向 <输出目录>/results.jsonl 追加一行，进程中断也能保留已完成结果。
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const B = require('./Build006Thickness_v688');
const A = B.loadSolver('corner');

function arg(k, d) { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; }
const ROOT = path.resolve(__dirname, '..', '..');
const TOOLS = path.join(ROOT, '03_工具', '正式版');

const img = process.argv[2], outDir = process.argv[3];
if (!img || !outDir) { console.error('用法: node ModeBBatch_v1.js <目标图.txt> <输出目录> [--tag 名称] [--avgs ...] [--boards ...]'); process.exit(2); }
const tag = arg('--tag', path.basename(img, '.txt'));
const avgs = arg('--avgs', '85,90,95,100').split(',').map(Number);
const boards = arg('--boards', 'auto,3x7,4x6').split(',');
const timeout = +arg('--timeout', '240');
fs.mkdirSync(outDir, { recursive: true });
const resultsFile = path.join(outDir, 'results.jsonl');

function parseTxt(file) {
  const lines = fs.readFileSync(file, 'utf8').replace(/\r/g, '').trim().split('\n');
  const rows = [];
  for (const line of lines) { const t = line.trim(); if (!t || /[^\d\s]/.test(t)) continue; rows.push(t.split(/\s+/).map(Number)); }
  return rows;
}
const blocks = parseTxt(img);
const px = {};
for (const row of blocks) for (const v of row) if (v > 0) px[v] = (px[v] || 0) + 1;

const rows = [];
for (const avg of avgs) {
  for (const b of boards) {
    const br = b === 'auto' ? 0 : +b.split('x')[0];
    const bc = b === 'auto' ? 0 : +b.split('x')[1];
    const name = tag + '_avg' + avg + '_' + (b === 'auto' ? 'auto' : br + 'x' + bc);
    const level = path.join(outDir, name + '.json');
    const rep = path.join(outDir, name + '_check.json');
    let rec = { name, avg, board: b, level };
    try {
      const cmd = `node "${path.join(TOOLS, 'RouteFirstB_v1.js')}" "${img}" --out "${level}" --avg ${avg}` +
        (b === 'auto' ? '' : ` --rows ${br} --cols ${bc}`);
      const out = execSync(cmd, { encoding: 'utf8', timeout: timeout * 1000 });
      const m = out.match(/best: min=(\S+) (\S+) peak=(\d+) player=(\d)\/5 容错=(\d+)\/20/);
      if (m) { rec.minWon = m[1] === '通'; rec.boxes = m[2]; rec.peak = +m[3]; rec.pass = +m[4]; rec.tol = +m[5]; }
      const m2 = out.match(/车数=(\d+) 棋盘=(\d+)x(\d+) 黑块=(\d+)/);
      if (m2) { rec.cars = +m2[1]; rec.rows = +m2[2]; rec.cols = +m2[3]; rec.black = +m2[4]; }
      // ModeBCheck
      execSync(`node "${path.join(TOOLS, 'ModeBCheck_v1.js')}" "${level}" --json "${rep}"`, { encoding: 'utf8', timeout: 120000 });
      const r = JSON.parse(fs.readFileSync(rep, 'utf8'));
      rec.hard = r.hard; rec.tol = r.tolerance.tol;
      rec.peak = r.peakMin; rec.peakPlayer = r.peakPlayer;
      rec.beats = r.beats.min.length; rec.gap = r.gap.minAvg; rec.debt = r.gap.debtShare;
      rec.minCap = r.hard.minCap; rec.solvable = r.hard.solvable; rec.player2 = r.hard.player2;
      // mid 由 PlayerSim 时间线算（ModeBCheck 已有 player 峰值，但中段比例这里补算）
      const lv = JSON.parse(fs.readFileSync(level, 'utf8'));
      try {
        const plv = A.parseLevel(A.fromGameFormat(lv));
        const pr = A.PlayerSim.run(plv, { seed: 7, instantChain: false, reviveCap: 2, capturePreviewStats: false });
        const picks = (pr.pickOrder || []).filter(p => p.chainIndex === 0);
        const tl = pr.bufferTimeline || [];
        const ss = picks.map(p => tl[p.tick] != null ? tl[p.tick] : 0);
        const e2 = Math.max(1, Math.round(ss.length * 0.1)), t2 = Math.floor(ss.length * 0.8);
        const mid = ss.slice(e2, t2);
        rec.mid = mid.length ? +(mid.filter(v => v >= 3).length / mid.length).toFixed(2) : 0;
        rec.playerWon = !!pr.won;
      } catch (e) { rec.mid = null; }
      const sliver = (() => {
        let bad = false;
        for (const row of lv.spools) for (const s of row) if (s && s.id > 0 && s.count < 10 && (px[s.id] || 0) >= 10) bad = true;
        return bad;
      })();
      rec.sliver = sliver;
    } catch (e) {
      rec.error = e.message.split('\n')[0];
    }
    fs.appendFileSync(resultsFile, JSON.stringify(rec) + '\n');
    rows.push(rec);
    console.log(name, rec.error ? 'ERR ' + rec.error : `peak=${rec.peak} player=${rec.pass}/5 tol=${rec.tol} min=${rec.minCap} sliver=${rec.sliver} beats=${rec.beats}`);
  }
}

// 汇总
const ok = rows.filter(r => !r.error && r.solvable && r.player2 && !r.sliver);
const score = r => {
  let s = 100;
  s += r.peak === 4 ? 80 : r.peak === 5 ? 40 : r.peak === 3 ? 0 : -50;
  const mid = r.mid == null ? 0.6 : r.mid;
  s += (mid >= 0.45 && mid <= 0.8) ? 60 : 0;
  s += (r.tol >= 11 && r.tol <= 15) ? 80 : (r.tol >= 8 ? 30 : 0);
  s += (r.beats >= 1 && r.beats <= 2) ? 30 : 0;
  return s;
};
ok.sort((a, b) => score(b) - score(a));
console.log('\n=== 汇总（可玩且无碎车 '+ok.length+' 张）===');
for (const r of ok.slice(0, 10)) console.log(`${r.name} 峰值${r.peak}/玩家${r.peakPlayer} 容错${r.tol}/20 段${r.beats} 最小车${r.minCap} gap${r.gap} 分${score(r)}`);
fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(ok.map(r => ({ ...r, score: score(r) })), null, 2));
console.log('已写：' + path.join(outDir, 'summary.json'));
