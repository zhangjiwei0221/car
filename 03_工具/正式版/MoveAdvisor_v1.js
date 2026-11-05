#!/usr/bin/env node
'use strict';
/**
 * MoveAdvisor_v1 —— 局部移动评估器（生成侧的“哪个改动值得试”）
 *
 * 给定一个关卡 + 关注的颜色/门，生成局部候选移动：
 *   - cap  ：同色两车之间转移容量（±5/10/20）
 *   - ice  ：给非门车加/改冰（4/8/12/16/20），用于“让门先吃边界”
 *   - swap ：同色两车整格互换（门/路径换位）
 * 每个候选用轻量评估：
 *   - 最小暂存路线：通/峰值
 *   - PlayerSim 5 seeds（2 复活）：通关数、中段 at3 占比中位数
 * 按“硬门 + 软分”排序，输出 top N + 完整 JSON。
 *
 * 用法：
 *   node MoveAdvisor_v1.js <关卡.json> --focus 25,22 --doors 0,5;2,0 \
 *        [--moves cap,ice,swap] [--out 报告.json] [--top 12]
 */
const B = require('./Build006Thickness_v688');
const A = B.loadSolver('corner');
const fs = require('fs');
const path = require('path');

function clone(x) { return JSON.parse(JSON.stringify(x)); }
function median(a) { const b = a.slice().sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : 0; }

function evalLevel(g) {
  const lv = A.parseLevel(A.fromGameFormat(g));
  const mb = A.Solver.runMinBuffer(lv, { depth: 3, instantChain: false });
  const peak = Math.max(0, ...(mb.stepBufferHistory || []));
  let playerPass = 0;
  const mids = [];
  for (let seed = 7; seed < 12; seed++) {
    const pr = A.PlayerSim.run(lv, { seed, instantChain: false, reviveCap: 2, capturePreviewStats: false });
    if (pr.won) playerPass++;
    const tl = pr.bufferTimeline || [];
    const picks = (pr.pickOrder || []).filter(p => p.chainIndex === 0);
    const ss = picks.map(p => (tl[p.tick] != null ? tl[p.tick] : 0));
    const L = ss.length, e = Math.max(1, Math.round(L * 0.1)), t = Math.floor(L * 0.8);
    const mid = ss.slice(e, t);
    mids.push(mid.filter(v => v >= 3).length / Math.max(1, mid.length));
  }
  const mid = Math.round(median(mids) * 100);
  const minWon = !!mb.won;
  const boxes = mb.completedBoxes + '/' + mb.totalBoxes;
  const score =
    (minWon ? 100 : 0) +
    playerPass * 10 +
    (peak === 4 ? 30 : peak === 3 ? 15 : peak === 5 ? -20 : 0) +
    (mid >= 45 && mid <= 80 ? 25 : 0) +
    Math.max(0, 20 - Math.abs(mid - 62));
  return { minWon, peak, boxes, playerPass, mid, score };
}

function moveKey(m) { return m.type + ' ' + m.desc; }

function main() {
  const file = process.argv[2];
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  if (!file) {
    console.error('用法: node MoveAdvisor_v1.js <关卡.json> --focus 25,22 --doors 0,5;2,0 [--moves cap,ice,swap] [--out 报告.json]');
    process.exit(2);
  }
  const focus = String(arg('--focus', '')).split(',').map(Number).filter(Number.isFinite);
  const doors = String(arg('--doors', '')).split(';').filter(Boolean).map(s => s.split(',').map(Number));
  const moves = String(arg('--moves', 'cap,ice,swap')).split(',');
  const top = +arg('--top', '12');
  const out = arg('--out', '');
  const g0 = B.readJson(file);
  const base = evalLevel(g0);
  const baseCells = [];
  for (let r = 0; r < g0.spools.length; r++) for (let c = 0; c < g0.spools[r].length; c++) {
    const s = g0.spools[r][c];
    if (s && s.id > 0) baseCells.push({ r, c, id: s.id, count: s.count });
  }
  const isDoor = (r, c) => doors.some(([dr, dc]) => dr === r && dc === c);
  const candidates = [];
  const add = (type, desc, mutate) => {
    const g = clone(g0);
    mutate(g);
    candidates.push({ type, desc, g });
  };
  for (const color of focus) {
    const cars = baseCells.filter(x => x.id === color);
    if (moves.includes('cap')) {
      for (const a of cars) for (const b of cars) {
        if (a === b) continue;
        for (const k of [5, 10, 20]) {
          if (a.count - k < 1) continue;
          add('cap', color + ' ' + a.r + ',' + a.c + ' -' + k + ' -> ' + b.r + ',' + b.c, g => {
            g.spools[a.r][a.c].count -= k;
            g.spools[b.r][b.c].count += k;
          });
        }
      }
    }
    if (moves.includes('ice')) {
      for (const a of cars) {
        if (isDoor(a.r, a.c)) continue;
        for (const p of [4, 8, 12, 16, 20]) {
          add('ice', color + ' ' + a.r + ',' + a.c + ' ice' + p, g => {
            g.spools[a.r][a.c].type = 7;
            g.spools[a.r][a.c].param = p;
          });
        }
      }
    }
    if (moves.includes('swap')) {
      for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) {
        const a = cars[i], b = cars[j];
        add('swap', color + ' ' + a.r + ',' + a.c + ' <-> ' + b.r + ',' + b.c, g => {
          const t = g.spools[a.r][a.c];
          g.spools[a.r][a.c] = g.spools[b.r][b.c];
          g.spools[b.r][b.c] = t;
        });
      }
    }
  }
  // 去重
  const seen = new Set();
  const uniq = candidates.filter(c => { const k = moveKey(c) + JSON.stringify(c.g.spools); if (seen.has(k)) return false; seen.add(k); return true; });

  const rows = [];
  const dir = path.join(require('os').tmpdir(), 'moveadvisor_' + process.pid);
  fs.mkdirSync(dir, { recursive: true });
  let idx = 0;
  for (const c of uniq) {
    const tmp = path.join(dir, 'cand_' + (++idx) + '_' + Date.now() + '.json');
    fs.writeFileSync(tmp, JSON.stringify(c.g));
    let ev;
    try { ev = evalLevel(c.g); } catch (e) { ev = { error: e.message }; }
    try { fs.unlinkSync(tmp); } catch (e) {}
    rows.push({ type: c.type, desc: c.desc, ...ev });
  }
  rows.sort((a, b) => (b.score - a.score) || (a.desc < b.desc ? -1 : 1));

  console.log('=== ' + path.basename(file) + ' ===');
  console.log('base: min=' + (base.minWon ? '通' : '不通') + ' ' + base.boxes + ' peak=' + base.peak + ' player2=' + base.playerPass + '/5 mid=' + base.mid + '% score=' + base.score);
  console.log('\n候选（按 score 降序）：');
  for (const r of rows.slice(0, top)) {
    if (r.error) { console.log('  ERROR ' + r.desc + ' ' + r.error); continue; }
    console.log('  ' + String(r.score).padStart(4) + '  ' + r.type.padEnd(5) + ' ' + r.desc.padEnd(28) +
      ' min=' + (r.minWon ? '通' : '不通') + '/' + r.boxes + ' peak=' + r.peak + ' player2=' + r.playerPass + '/5 mid=' + r.mid + '%');
  }
  if (out) {
    fs.writeFileSync(out, JSON.stringify({ tool: 'MoveAdvisor_v1', level: file, base, focus, doors, moves, rows }, null, 2));
    console.log('\n已写：' + out);
  }
}

try { main(); } catch (e) { console.error('失败：' + e.message); process.exit(1); }
