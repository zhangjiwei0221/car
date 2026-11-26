#!/usr/bin/env node
'use strict';
/**
 * ReachabilityCurve_v1 —— 路线条件化的可达曲线 + 每车 fill rate + 决策点选项表
 *
 * 为什么不是“一条曲线”：
 *   同一个关卡，不同路线的消除顺序不同 → 第 N 步可达的颜色/像素不同。
 *   所以本工具跑一组代表策略（min / psim / psim 阈值 / lookahead / greedy），
 *   每条路线 replay 真实 Simulator 状态，记录：
 *     - 每步每色可达 px；
 *     - 这一步吃完后新露出哪些颜色、各多少 px；
 *     - 每辆车被拿时的“可达 / 容量 / 是否吃满”；
 *     - 每步的选项（颜色:容量:可达）——用来区分“真选择”和“看起来有选择”。
 *   再按车汇总成“路线包络”（min/median/max 可达、fillRoutes），用于定容量表：
 *     - 门/钥匙要 fillRoutes 全满（鲁棒）；
 *     - 可选债要故意路线敏感（安全满、背债欠）。
 *
 * 用法：
 *   node ReachabilityCurve_v1.js <关卡.json> [--out 报告.json]
 */
const B = require('./Build006Thickness_v688');
const A = B.loadSolver('corner');
const fs = require('fs');

function reachCounts(st) {
  const H = st.blocks.length, W = st.blocks[0].length;
  const blocks = st.blocks, elim = st.eliminated;
  const reach = (y, x) => y === 0 || x === 0 || y === H - 1 || x === W - 1 ||
    elim[y - 1][x] || elim[y + 1][x] || elim[y][x - 1] || elim[y][x + 1];
  const cnt = {};
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (elim[y][x] || !reach(y, x)) continue;
    const c = blocks[y][x];
    if (c > 0) cnt[c] = (cnt[c] || 0) + 1;
  }
  return cnt;
}

function envelope(nums) {
  if (!nums.length) return null;
  const s = nums.slice().sort((a, b) => a - b);
  const med = s[Math.floor(s.length / 2)];
  return { min: s[0], med, max: s[s.length - 1], n: s.length };
}

function getRoutes(lv) {
  const routes = [];
  try {
    const mb = A.Solver.runMinBuffer(lv, { depth: 3, instantChain: false });
    routes.push({ label: 'min', pickOrder: mb.pickOrder || [], meta: { won: !!mb.won, boxes: mb.completedBoxes + '/' + mb.totalBoxes, buf: mb.stepBufferHistory || [] } });
  } catch (e) { routes.push({ label: 'min', pickOrder: [], meta: { error: e.message, buf: [] } }); }
  const psimOpts = [
    ['psim', {}],
    ['psim-thr0.4', { pickThreshold: 0.4 }],
    ['psim-thr0.8', { pickThreshold: 0.8 }],
    ['psim-lookahead', { lookahead2: true }]
  ];
  for (const [label, opts] of psimOpts) {
    try {
      const r = A.PlayerSim.run(lv, Object.assign({ seed: 7, instantChain: false, reviveCap: 2, capturePreviewStats: false }, opts));
      routes.push({ label, pickOrder: r.pickOrder || [], meta: { won: !!r.won, picks: r.picks, progress: r.progress, buf: r.bufferTimeline || [] } });
    } catch (e) { routes.push({ label, pickOrder: [], meta: { error: e.message, buf: [] } }); }
  }
  try {
    const o = A.Solver.runSolver(lv, 0, 1, false, false, { capturePreviewStats: true, instantChain: false });
    routes.push({ label: 'greedy', pickOrder: o.pickOrder || [], meta: { won: !!o.completed, buf: o.stepBufferHistory || [] } });
  } catch (e) { routes.push({ label: 'greedy', pickOrder: [], meta: { error: e.message, buf: [] } }); }
  return routes;
}

function replay(lv, route) {
  const Sim = A.Simulator;
  const st = Sim.enter(lv, { useSlotStart: true, instantChain: false });
  const steps = [];
  const tracked = [];
  const picks = route.pickOrder.filter(p => p.chainIndex == null || p.chainIndex === 0);
  for (const p of picks) {
    if (!st || st.gameOver) break;
    const before = reachCounts(st);
    const moves = Sim.listMoves(st).filter(m => !m.blocked);
    const options = moves.map(m => {
      const reach = before[m.antBox.color] || 0;
      const cnt = m.antBox.count || 0;
      return {
        color: m.antBox.color, count: cnt, r: m.r, c: m.c, groupSize: m.groupSize || 1,
        reachable: reach,
        full: cnt > 0 && reach >= cnt,
        half: cnt > 0 && reach >= cnt / 2
      };
    });
    const step = {
      i: steps.length + 1, color: p.color, count: p.count, r: p.r, c: p.c,
      bufBefore: st.buffer.length, options,
      triggerReach: before[p.color] || 0
    };
    const beforeKeys = new Set((st.buffer || []).map(b => b.key));
    try { Sim.applyPick(st, p.r, p.c); } catch (e) { step.error = e.message; steps.push(step); break; }
    const afterBuf = st.buffer || [];
    const newEntry = afterBuf.find(b => !beforeKeys.has(b.key) && b.color === p.color && b.need === p.count);
    const rec = { color: p.color, count: p.count, entryStep: step.i, releaseStep: null };
    if (newEntry) { rec.entryKey = newEntry.key; rec.entryProgress = newEntry.progress; tracked.push(rec); step.entryKey = newEntry.key; }
    else { step.filledAtPick = true; }
    for (const t of tracked) if (t.releaseStep == null && t.entryKey != null && !afterBuf.some(b => b.key === t.entryKey)) t.releaseStep = step.i;
    step.trackRec = rec;
    step.openDebts = tracked.filter(t => t.releaseStep == null).map(t => ({ key: t.entryKey, color: t.color, count: t.count, entryStep: t.entryStep }));
    const after = reachCounts(st);
    step.bufAfter = st.buffer.length;
    step.newColors = Object.keys(after)
      .filter(c => (after[c] || 0) - (before[c] || 0) > 0)
      .map(c => ({ color: +c, gain: after[c] - (before[c] || 0) }))
      .sort((a, b) => b.gain - a.gain);
    steps.push(step);
  }
  return { label: route.label, meta: route.meta, steps, tracked, won: !!st.gameWon };
}

function main() {
  const file = process.argv[2];
  const outIdx = process.argv.indexOf('--out');
  const out = outIdx > 0 ? process.argv[outIdx + 1] : '';
  if (!file) { console.error('用法: node ReachabilityCurve_v1.js <关卡.json> [--out 报告.json]'); process.exit(2); }
  const g = B.readJson(file);
  const lv = A.parseLevel(A.fromGameFormat(g));
  const routes = getRoutes(lv);
  const replays = routes.map(r => replay(lv, r));

  // 每车包络
  const cars = {};
  for (const r of replays) {
    for (const s of r.steps) {
      if (s.error) continue;
      const key = s.r + ',' + s.c;
      const c = cars[key] = cars[key] || { r: s.r, c: s.c, color: s.color, count: s.count, picks: [] };
      const t = s.trackRec || null;
      const hold = t ? (t.entryKey ? (t.releaseStep != null ? t.releaseStep - t.entryStep : null) : 0) : null;
      c.picks.push({ route: r.label, step: s.i, reach: s.triggerReach, hold, open: !!(t && t.entryKey && t.releaseStep == null) });
    }
  }
  const maxOf = b => Math.max(0, ...(b || []));
  const rows = Object.values(cars).map(c => {
    const reaches = c.picks.map(p => p.reach).filter(x => x != null);
    const env = envelope(reaches);
    const fills = reaches.filter(x => x >= c.count).length;
    const holds = c.picks.map(p => p.hold).filter(x => x != null);
    const openRoutes = c.picks.filter(p => p.open).length;
    const holdEnv = envelope(holds);
    return {
      ...c,
      routesPicked: c.picks.length,
      fillRoutes: fills,
      env,
      maxDebt: env ? Math.max(0, c.count - env.min) : null,
      holdEnv, openRoutes
    };
  }).sort((a, b) => (a.fillRoutes - b.fillRoutes) || (b.maxDebt - a.maxDebt));

  const summary = {
    tool: 'ReachabilityCurve_v1', level: file,
    routes: replays.map(r => ({
      label: r.label,
      won: r.meta.won != null ? !!r.meta.won : r.won,
      replayWon: r.won,
      steps: r.steps.length,
      picks: r.meta.picks != null ? r.meta.picks : null,
      boxes: r.meta.boxes || null,
      progress: r.meta.progress != null ? r.meta.progress : null,
      revives: r.meta.revivesUsed != null ? r.meta.revivesUsed : null,
      peak: maxOf(r.meta.buf), meta: { ...r.meta, buf: undefined }
    })),
    cars: rows.map(r => ({
      r: r.r, c: r.c, color: r.color, count: r.count,
      routesPicked: r.routesPicked, fillRoutes: r.fillRoutes,
      env: r.env, maxDebt: r.maxDebt, holdEnv: r.holdEnv, openRoutes: r.openRoutes,
      picks: r.picks.map(p => ({ route: p.route, step: p.step, reach: p.reach, hold: p.hold, open: p.open }))
    }))
  };

  console.log('=== ' + file.split('/').pop() + ' ===');
  for (const r of summary.routes) console.log(' route ' + r.label.padEnd(16) + ' won=' + r.won + ' steps=' + r.steps + ' peak=' + r.peak + (r.picks != null ? ' picks=' + r.picks : '') + (r.boxes ? ' boxes=' + r.boxes : '') + (r.replayWon !== r.won ? ' (replayWon=' + r.replayWon + ')' : '') + (r.meta.error ? ' ERROR=' + r.meta.error : ''));
  console.log('\n车表（fillRoutes 升序 / maxDebt 降序）：');
  for (const c of summary.cars) {
    const env = c.env ? c.env.min + '/' + c.env.med + '/' + c.env.max : '—';
    console.log('  ' + (c.color + ':' + c.count).padEnd(9) + '@' + (c.r + ',' + c.c).padEnd(7) +
      ' picked=' + c.routesPicked + ' fillAtPick=' + c.fillRoutes + '/' + c.routesPicked +
      ' env=' + env + ' maxDebt=' + (c.maxDebt == null ? '—' : c.maxDebt) +
      ' hold=' + (c.holdEnv ? c.holdEnv.min + '/' + c.holdEnv.med + '/' + c.holdEnv.max : '—') +
      ' open=' + c.openRoutes);
  }

  // 决策点（min 路线，>=2 个“能吃到一半”的选项）
  const minRoute = replays.find(r => r.label === 'min');
  if (minRoute) {
    console.log('\n决策点（min 路线，能吃到一半的选项 ≥2）：');
    let shown = 0;
    for (const s of minRoute.steps) {
      const useful = s.options.filter(o => o.half && !o.error);
      if (useful.length < 2) continue;
      shown++;
      if (shown > 20) break;
      const opts = s.options.map(o => o.color + ':' + o.count + '→' + o.reachable + (o.full ? '(满)' : o.half ? '(半)' : '(欠)')).join(' ');
      console.log('  步' + s.i + ' 取 ' + s.color + ':' + s.count + '  buf=' + s.bufBefore + '  选项: ' + opts);
    }
    console.log('\n新露出（min 路线，前 12 步）：');
    for (const s of minRoute.steps.slice(0, 12)) {
      if (!s.newColors || !s.newColors.length) continue;
      console.log('  步' + s.i + ' 取 ' + s.color + ':' + s.count + ' → ' + s.newColors.slice(0, 6).map(x => '色' + x.color + '+' + x.gain).join(' '));
    }
  }

  if (out) {
    const full = { ...summary, routesFull: replays };
    fs.writeFileSync(out, JSON.stringify(full, null, 2));
    console.log('\n已写：' + out);
  }
}

try { main(); } catch (e) { console.error('失败：' + e.message); process.exit(1); }
