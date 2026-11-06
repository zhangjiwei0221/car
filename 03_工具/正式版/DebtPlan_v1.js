#!/usr/bin/env node
'use strict';
/**
 * DebtPlan_v1 —— Mode B 债务规划搜索（对 RouteFirstB 的干净关做“主动造债”）
 *
 * 四类移动：
 *   1) 定向造债：取最小路线中间段的某辆车，把同色另一辆车的容量挪给它（源车不低于 floor）；
 *   2) 随机同色挪容量；
 *   3) 两格交换 颜色+容量+障碍（同色总量不变，改颜色-槽位结构）；
 *   4) 派生冰开关（param = 该色 ready 步 − 1）。
 *
 * 评分：玩家/最小路线必须通关；峰值 4–5、中段 45–80、容错 11–15、压力段 1–2；
 *       任何“颜色本身够大却出现 <floor 碎车”重罚。
 *
 * 用法：node DebtPlan_v1.js <关卡.json> <迭代数> <输出.json> [--floor 10]
 */
const B = require('./Build006Thickness_v688');
const A = B.loadSolver('corner');
const fs = require('fs');

function arg(k, d) { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; }
function targetCurve(blocks, maxSteps) {
  const H = blocks.length, W = blocks[0].length;
  const elim = Array.from({ length: H }, () => Array(W).fill(false));
  const total = {}, reach = {};
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const c = blocks[y][x]; if (c > 0) total[c] = (total[c] || 0) + 1; }
  const reachable = (y, x) => y === 0 || x === 0 || y === H - 1 || x === W - 1 || elim[y - 1][x] || elim[y + 1][x] || elim[y][x - 1] || elim[y][x + 1];
  const scan = () => {
    for (const c of Object.keys(total)) reach[c] = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!elim[y][x] && reachable(y, x) && blocks[y][x] > 0) reach[blocks[y][x]]++;
  };
  const rows = [];
  scan(); rows.push({ step: 0, reach: { ...reach } });
  for (let step = 1; step <= maxSteps; step++) {
    let pickColor = null, pickD = Infinity;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (elim[y][x] || blocks[y][x] <= 0 || !reachable(y, x)) continue;
      const d = (H - 1 - y) + x;
      if (d < pickD) { pickD = d; pickColor = blocks[y][x]; }
    }
    if (pickColor == null) break;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!elim[y][x] && blocks[y][x] === pickColor && reachable(y, x)) elim[y][x] = true;
    scan(); rows.push({ step, reach: { ...reach } });
  }
  return rows;
}
function stretches(buf) {
  const out = []; let s = -1;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] >= 3) { if (s < 0) s = i; }
    else { if (s >= 0) { out.push({ start: s, end: i - 1, len: i - s }); s = -1; } }
  }
  if (s >= 0) out.push({ start: s, end: buf.length - 1, len: buf.length - s });
  return out;
}

function main() {
  const file = process.argv[2], N = +(process.argv[3] || 60), out = process.argv[4];
  const floor = +arg('--floor', '10');
  if (!file || !out) { console.error('用法: node DebtPlan_v1.js <关卡.json> <迭代数> <输出.json> [--floor 10]'); process.exit(2); }
  const g0 = JSON.parse(fs.readFileSync(file, 'utf8'));
  const blocks = g0.blocks;
  const curve = targetCurve(blocks, 60);
  const reachAt = (c, s) => (curve[Math.min(s, curve.length - 1)] || { reach: {} }).reach[c] || 0;
  const px = {};
  for (const row of blocks) for (const v of row) if (v > 0) px[v] = (px[v] || 0) + 1;
  const firstReady = (c, n) => { for (let s = 0; s < curve.length; s++) if (reachAt(c, s) >= n) return s; return 999; };

  function evalF(g) {
    const lv = A.parseLevel(A.fromGameFormat(g));
    const mb = A.Solver.runMinBuffer(lv, { depth: 3, instantChain: false });
    const hist = mb.stepBufferHistory || [];
    const peak = Math.max(0, ...hist);
    const pr = A.PlayerSim.run(lv, { seed: 7, instantChain: false, reviveCap: 2, capturePreviewStats: false });
    const picks = (pr.pickOrder || []).filter(p => p.chainIndex == null || p.chainIndex === 0);
    const tl = pr.bufferTimeline || [];
    const ss = picks.map(p => tl[p.tick] != null ? tl[p.tick] : 0);
    const e2 = Math.max(1, Math.round(ss.length * 0.1)), t2 = Math.floor(ss.length * 0.8);
    const mid = ss.slice(e2, t2);
    const midRatio = mid.length ? +(mid.filter(v => v >= 3).length / mid.length).toFixed(2) : 0;
    let tol = 0;
    for (let i = 0; i < 20; i++) {
      const nz = i === 0 ? 0 : 0.2 + (i % 5) * 0.2;
      const oo = A.Solver.runSolver(lv, nz, 1000 + i * 37, false, false, { capturePreviewStats: false, instantChain: false });
      if (oo.completed) tol++;
    }
    const beats = stretches(hist).length;
    // 碎车检查：颜色体量 ≥ floor，却出现 < floor 的车
    let sliver = false;
    for (let r = 0; r < g.spools.length; r++) for (let c = 0; c < g.spools[0].length; c++) {
      const s = g.spools[r][c];
      if (s && s.id > 0 && s.count < floor && (px[s.id] || 0) >= floor) sliver = true;
    }
    return { won: !!mb.won, peak, pass: pr.won ? 1 : 0, mid: midRatio, tol, beats, sliver, picks: (mb.pickOrder || []).filter(p => p.chainIndex == null || p.chainIndex === 0) };
  }
  function score(e) {
    if (!e.won || !e.pass) return -1000 + e.peak;
    let s = 200;
    s += e.peak === 4 ? 100 : e.peak === 5 ? 40 : e.peak === 3 ? -30 : e.peak === 2 ? -70 : -100;
    s += (e.mid >= 0.45 && e.mid <= 0.8) ? 100 : -Math.round(Math.abs(e.mid - 0.62) * 150);
    s += (e.tol >= 11 && e.tol <= 15) ? 100 : (e.tol > 15 ? -30 : 0);
    s += (e.beats >= 1 && e.beats <= 2) ? 40 : e.beats === 0 ? -20 : -10;
    s += e.sliver ? -120 : 0;
    return s;
  }

  const R = g => g.spools.length, C = g => g.spools[0].length;
  const carCells = g => { const out = []; for (let r = 0; r < R(g); r++) for (let c = 0; c < C(g); c++) { const s = g.spools[r][c]; if (s && s.id > 0) out.push([r, c]); } return out; };
  const byColor = g => { const m = {}; for (let r = 0; r < R(g); r++) for (let c = 0; c < C(g); c++) { const s = g.spools[r][c]; if (s && s.id > 0) (m[s.id] = m[s.id] || []).push([r, c]); } return m; };

  let cur = JSON.parse(JSON.stringify(g0));
  let curEv = evalF(cur), curS = score(curEv);
  let best = { g: JSON.parse(JSON.stringify(cur)), ev: curEv, s: curS };
  fs.writeFileSync(out, JSON.stringify(best.g));
  console.log('start', JSON.stringify({ ...curEv, picks: undefined }), curS);
  for (let t = 0; t < N; t++) {
    const g = JSON.parse(JSON.stringify(cur));
    const kind = Math.random();
    let desc = '';
    if (kind < 0.15) {
      // 合并：同色两车并成一车，另一格变黑——制造少而大的车和真债
      const m = byColor(g); const ids = Object.keys(m).filter(id => m[id].length >= 2 && (px[id] || 0) >= 2 * floor);
      if (!ids.length) continue;
      const id = ids[Math.floor(Math.random() * ids.length)];
      const list = m[id];
      const a = list[Math.floor(Math.random() * list.length)], b = list[Math.floor(Math.random() * list.length)];
      if (a[0] === b[0] && a[1] === b[1]) continue;
      const sa = g.spools[a[0]][a[1]], sb = g.spools[b[0]][b[1]];
      sa.count += sb.count;
      g.spools[b[0]][b[1]] = { id: -1, type: 0, param: 0, count: 0 };
      desc = 'merge 色' + id + ' r' + a[0] + 'c' + a[1] + '+' + sb.count + ' (r' + b[0] + 'c' + b[1] + '→黑)';
    } else if (kind < 0.5) {
      // 定向造债：最小路线中间段的车上加债
      const picks = curEv.picks || [];
      const midPicks = picks.slice(Math.floor(picks.length * 0.25), Math.floor(picks.length * 0.75));
      if (!midPicks.length) continue;
      const p = midPicks[Math.floor(Math.random() * midPicks.length)];
      const k = p.r + ',' + p.c;
      const s = g.spools[p.r][p.c];
      if (!s || !(s.id > 0)) continue;
      const sib = (byColor(g)[s.id] || []).filter(([r, c]) => !(r === p.r && c === p.c) && g.spools[r][c].count - 20 >= floor);
      if (!sib.length) continue;
      const [br, bc] = sib[Math.floor(Math.random() * sib.length)];
      const d = [20, 40, 60][Math.floor(Math.random() * 3)];
      if (g.spools[br][bc].count - d < floor) continue;
      g.spools[br][bc].count -= d; s.count += d;
      desc = 'debt r' + p.r + 'c' + p.c + ' +' + d + ' <- r' + br + 'c' + bc;
    } else if (kind < 0.75) {
      const m = byColor(g); const ids = Object.keys(m).filter(id => m[id].length >= 2);
      if (!ids.length) continue;
      const id = ids[Math.floor(Math.random() * ids.length)];
      const list = m[id];
      const a = list[Math.floor(Math.random() * list.length)], b = list[Math.floor(Math.random() * list.length)];
      if (a[0] === b[0] && a[1] === b[1]) continue;
      const d = [10, 20, 30][Math.floor(Math.random() * 3)];
      const sa = g.spools[a[0]][a[1]], sb = g.spools[b[0]][b[1]];
      if (sb.count - d < floor) continue;
      sb.count -= d; sa.count += d;
      desc = 'cap ' + d + ' r' + a[0] + 'c' + a[1] + ' <- r' + b[0] + 'c' + b[1];
    } else if (kind < 0.9) {
      const cs = carCells(g); if (cs.length < 2) continue;
      const a = cs[Math.floor(Math.random() * cs.length)], b = cs[Math.floor(Math.random() * cs.length)];
      if (a[0] === b[0] && a[1] === b[1]) continue;
      const sa = g.spools[a[0]][a[1]], sb = g.spools[b[0]][b[1]];
      if (sa.id === sb.id) continue;
      [sa.id, sb.id] = [sb.id, sa.id];
      [sa.count, sb.count] = [sb.count, sa.count];
      [sa.type, sb.type] = [sb.type, sa.type];
      [sa.param, sb.param] = [sb.param, sa.param];
      desc = 'swap r' + a[0] + 'c' + a[1] + ' <> r' + b[0] + 'c' + b[1];
    } else {
      const cs = carCells(g); if (!cs.length) continue;
      const [r, c] = cs[Math.floor(Math.random() * cs.length)];
      const s = g.spools[r][c];
      if (!(s.type === 7 || (Array.isArray(s.type) && s.type.includes(7)))) {
        const hp = firstReady(s.id, s.count) - 1;
        if (hp < 1) continue;
        s.type = 7; s.param = Math.max(1, Math.min(28, hp));
        desc = 'ice r' + r + 'c' + c + ' p' + s.param;
      } else {
        s.type = 0; s.param = 0; desc = 'unice r' + r + 'c' + c;
      }
    }
    const ev = evalF(g), sc = score(ev);
    if (sc > curS) {
      cur = g; curEv = ev; curS = sc;
      if (sc > best.s) { best = { g: JSON.parse(JSON.stringify(g)), ev, s: sc }; fs.writeFileSync(out, JSON.stringify(best.g)); }
      console.log('t' + t, 'accept', desc, JSON.stringify({ won: ev.won, peak: ev.peak, pass: ev.pass, mid: ev.mid, tol: ev.tol, beats: ev.beats, sliver: ev.sliver }), sc);
    } else if (t % 20 === 0) {
      console.log('t' + t, 'reject', desc, JSON.stringify({ won: ev.won, peak: ev.peak, pass: ev.pass, mid: ev.mid, tol: ev.tol, beats: ev.beats, sliver: ev.sliver }), sc);
    }
  }
  console.log('BEST', JSON.stringify({ won: best.ev.won, peak: best.ev.peak, pass: best.ev.pass, mid: best.ev.mid, tol: best.ev.tol, beats: best.ev.beats, sliver: best.ev.sliver }), best.s);
}

try { main(); } catch (e) { console.error('失败：' + e.message); process.exit(1); }
