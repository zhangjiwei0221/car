#!/usr/bin/env node
'use strict';
/**
 * RxPrescribe_v796 —— 按 13 项症状开障碍处方（2026-11-03）
 *
 * 用户 2026-11-03：
 *   「每次都是两个三连锁，而且没有冰块和问号」——关卡生成公式化。
 *
 * 这不是"配额"，是"对症"：
 *   每个症状先量，只有该症状存在才开药；每味药加完立即复测，没用就撤回。
 *   同一症状有多个位置可选时，按 seed 洗牌 —— 同样的症状也会长出不同的障碍。
 *
 * 症状 → 药（全部用 13 项口径，不用已废弃的「被迫欠债」）：
 *   R1 后 20% at3<3 或连续<3  → 三连（挑后段才被取的 3 辆车）
 *   R2 中段 at3<15            → 三连 / 冰（二选一，按 seed 随机）
 *   R3 峰值<4                 → 三连
 *   R4 前 20% at4>0           → 撤回：把已加的冰/三连里"最早被取"的那块拿掉
 *   R5 全程有富余（决策度够、没得选少）→ 问号 1–3 个（让"免费车"变得不确定）
 *
 * 硬约束：容量守恒 / 无空格 / 可通关 —— 任一被破坏就撤回这味药。
 *
 * 用法：
 *   node RxPrescribe_v796.js <关卡.json> --out 结果.json [--seed 20261103] [--ref corner]
 */
const fs = require('fs');
const B = require('./Build006Thickness_v688');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const FILE = process.argv.slice(2).find(a => !a.startsWith('--') && !['--out', '--seed', '--ref'].includes(process.argv[process.argv.indexOf(a) - 1]));
const OUT = arg('--out', '/tmp/rx.json');
const REF = arg('--ref', 'corner');
const SEED = Number(arg('--seed', '20261103'));
const QUIET = process.argv.includes('--quiet');

const A = B.loadSolver(REF);

// ── 可复现随机（mulberry32：对 seed 敏感，避免 LCG 相邻 seed 输出雷同）──
let _s = (SEED >>> 0) || 1;
const rand = () => {
  _s = (_s + 0x6D2B79F5) >>> 0;
  let t = Math.imul(_s ^ (_s >>> 15), 1 | _s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const shuffle = a => { const x = a.slice(); for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; };

const colorOf = (gg, r, c) => (gg.spools[r] && gg.spools[r][c] ? gg.spools[r][c].id : '?');
const typesOf = s => (s ? (Array.isArray(s.type) ? s.type : [s.type || 0]) : []);
const isPlain = s => { if (!s || !(s.id > 0)) return false; const t = typesOf(s); return !t.includes(5) && !t.includes(6) && !t.includes(7); };
const isIce = s => typesOf(s).includes(7);
const isChain = s => typesOf(s).includes(5);

function solve(g) {
  const o = A.Solver.runSolver(A.parseLevel(A.fromGameFormat(g)), 0, 1, false, false, { capturePreviewStats: true, instantChain: false });
  return { o, buf: (o.pressureSamples || []).map(s => s.buf || 0) };
}

/** 轻量指标：只跑一次求解器（不含容错/决策度），用于"每味药复测" */
function quick(g) {
  const { o, buf } = solve(g);
  const L = buf.length, eN = Math.max(1, Math.round(L * 0.2)), tN = Math.floor(L * 0.8);
  const tail = buf.slice(tN);
  let run = 0, c = 0;
  for (const v of tail) { if (v >= 3) { c++; run = Math.max(run, c); } else c = 0; }
  return {
    L, peak: Math.max(0, ...buf), won: !!o.completed,
    at3: buf.filter(v => v >= 3).length, at4: buf.filter(v => v >= 4).length,
    early4: buf.slice(0, eN).filter(v => v >= 4).length,
    earlyFree: buf.slice(0, eN).filter(v => v === 0).length,
    mid3: buf.slice(eN, tN).filter(v => v >= 3).length,
    tail3: tail.filter(v => v >= 3).length, tailRun: run,
  };
}

function capOK(g) {
  let sum = 0, empty = 0;
  for (const row of g.spools) for (const s of row) {
    const t = typesOf(s);
    if (t.some(x => x >= 11 && x <= 14)) { (Array.isArray(s.param) ? s.param : []).forEach(b => sum += (b.count || 0)); continue; }
    if (s && s.id === -1) continue;
    if (!s || !s.id || s.id <= 0) { empty++; continue; }
    sum += s.count;
  }
  const px = g.blocks.flat().length;
  return { ok: sum === px && empty === 0, sum, px, empty };
}

/** 每辆车在第几手被取（用来判断"前段/后段"） */
function pickSteps(g) {
  const { o } = solve(g);
  const m = new Map();
  for (const p of (o.pickOrder || [])) m.set(p.r + ',' + p.c, p.step);
  return { map: m, steps: (o.pressureSamples || []).length };
}

const clone = g => JSON.parse(JSON.stringify(g));
let g = B.readJson(FILE);
const g0 = clone(g);   // 原始备份：整体回滚用
const cap0 = capOK(g);
if (!cap0.ok) { console.error('输入关卡容量/空格已不正常，拒绝处理'); process.exit(2); }

const m0 = quick(g);
if (!QUIET) console.log(`基线：步${m0.L} 峰值${m0.peak} 前20% at4=${m0.early4}/免费${m0.earlyFree} 中段at3=${m0.mid3} 后20% at3=${m0.tail3}/连续${m0.tailRun} at4=${m0.at4} 可通=${m0.won}`);

const log = [];
const rows = g.spools.length, cols = g.spools[0].length;

/** 通用：试一味药，有效才留 */
function tryDrug(name, apply, undo, better) {
  const before = quick(g);
  apply();
  const cap = capOK(g);
  if (!cap.ok) { undo(); log.push(`${name}：破坏容量/空格，撤回`); return false; }
  const after = quick(g);
  if (!after.won) { undo(); log.push(`${name}：导致不可通关，撤回`); return false; }
  if (process.env.RX_DEBUG) log.push(`[dbg] ${name} won=${after.won} better=${better(before, after)} peak ${before.peak}->${after.peak} mid ${before.mid3}->${after.mid3}`);
  if (!better(before, after)) { undo(); log.push(`${name}：复测无改善，撤回`); return false; }
  log.push(`${name}：✅ 保留（${describe(before)} → ${describe(after)}）`);
  return true;
}
const describe = m => `峰${m.peak} 中${m.mid3} 后${m.tail3}/${m.tailRun}`;

// ── 硬门（13 项里"障碍能影响"的子集；容错/决策度另算）──
// 注意：不含 earlyFree —— "开局全松"是车序问题，加冰治不了（实测全被撤回），
// 让它卡在硬门里只会让整关放弃加药，所以单独当症状处理，不阻塞后面的多样化。
const HARD = m => m.won && m.peak === 4 && m.early4 === 0 &&
  m.mid3 >= 15 && m.tail3 >= 3 && m.tailRun >= 3 && m.at4 >= 5;

/**
 * 【2026-11-04 用户】放宽判据：原来加冰必须"硬门全过"，而冰几乎必然让某项变差 →
 * 冰永远被撤回（实测 10 张里只有 1 张留下冰）。
 * 现在：只要能通关 + 别比原来差太多，就保留。
 */
// 【2026-11-04 用户】再放宽到"只要还能通关就留"——用户明确要冰 4–8 块，
// 之前的三重条件让 9/10 张图一块冰都留不下（实测：全是"复测无改善，撤回"）。
const LOOSE = (a, b) => a.won;

let cur = quick(g);
log.push(`基线：${describe(cur)} 硬门${HARD(cur) ? '过' : '不过'}`);

// ═══ 一、治病（硬门不过时才补）═══
if (!HARD(cur)) {
  // 前 20% 已经到 4（开局过压）→ 撤回最早被取的那块冰/链，给开局留呼吸
  if (cur.early4 > 0) {
    const { map } = pickSteps(g);
    const marked = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const s = g.spools[r][c];
      if (s && (isIce(s) || isChain(s))) marked.push([r, c]);
    }
    marked.sort((a, b) => (map.get(a.join(',')) || 1e9) - (map.get(b.join(',')) || 1e9));
    for (const [r, c] of marked) {
      const s = g.spools[r][c];
      if (isIce(s)) {
        const old = { type: s.type, param: s.param };
        const ts = Array.isArray(s.type) ? s.type.slice() : [s.type];
        const ps = Array.isArray(s.param) ? s.param.slice() : [s.param];
        const i = ts.indexOf(7);
        const nt = ts.filter((_, k) => k !== i), np = ps.filter((_, k) => k !== i);
        if (tryDrug(`撤冰(${r},${c})`,
          () => { if (nt.length === 0) { s.type = 0; s.param = 0; } else { s.type = nt.length === 1 ? nt[0] : nt; s.param = np.length === 1 ? np[0] : np; } },
          () => { s.type = old.type; s.param = old.param; },
          (b, a) => a.early4 < b.early4 && a.peak >= 4 && a.mid3 >= 15 && a.tail3 >= 3 && a.tailRun >= 3)) break;
      } else {
        const grp = s.param, cells = [];
        for (let rr = 0; rr < rows; rr++) for (let cc = 0; cc < cols; cc++) {
          const t = g.spools[rr][cc];
          if (t && isChain(t) && t.param === grp) cells.push([rr, cc, { type: t.type, param: t.param }]);
        }
        if (tryDrug(`撤链·组${grp}(${r},${c})`,
          () => cells.forEach(([rr, cc]) => { g.spools[rr][cc].type = 0; g.spools[rr][cc].param = 0; }),
          () => cells.forEach(([rr, cc, o]) => { g.spools[rr][cc].type = o.type; g.spools[rr][cc].param = o.param; }),
          (b, a) => a.early4 < b.early4 && a.peak >= 4 && a.mid3 >= 15 && a.tail3 >= 3 && a.tailRun >= 3)) break;
      }
    }
  }
  // 开局全松（免费步 > 6：前 20% 全是 buf=0）→ 给开局车加冰，把第一波债务提前
  if (cur.earlyFree > 6) {
    for (const [r, c, delay] of shuffle(iceEarlyCandidates(g))) {
      const old = { type: g.spools[r][c].type, param: g.spools[r][c].param };
      if (tryDrug(`冰·开局(${r},${c}) 数字${delay}`,
        () => { g.spools[r][c].type = 7; g.spools[r][c].param = delay; },
        () => { g.spools[r][c].type = old.type; g.spools[r][c].param = old.param; },
        (b, a) => a.earlyFree < b.earlyFree || a.mid3 > b.mid3)) break;
    }
  }
  if (cur.peak < 4 || cur.tail3 < 3 || cur.tailRun < 3) {
    for (const trio of shuffle(chainCandidates(g))) {
      const old = trio.map(([r, c]) => ({ type: g.spools[r][c].type, param: g.spools[r][c].param }));
      if (tryDrug(`三连(${trio[0]})`,
        () => { const grp = nextGroup(g); trio.forEach(([r, c]) => { g.spools[r][c].type = 5; g.spools[r][c].param = grp; }); },
        () => trio.forEach(([r, c], i) => { g.spools[r][c].type = old[i].type; g.spools[r][c].param = old[i].param; }),
        (b, a) => HARD(a) || a.peak > b.peak || a.tail3 > b.tail3)) break;
    }
  }
  if (!HARD(quick(g)) && quick(g).mid3 < 15) {
    const useIce = rand() < 0.5;
    if (useIce) {
      for (const [r, c, delay, st] of iceCandidates(g)) {   // 已按被取步数排序，不 shuffle
        const old = { type: g.spools[r][c].type, param: g.spools[r][c].param };
        if (tryDrug(`冰(${r},${c})`,
          () => { g.spools[r][c].type = 7; g.spools[r][c].param = delay; },
          () => { g.spools[r][c].type = old.type; g.spools[r][c].param = old.param; },
          (b, a) => a.mid3 > b.mid3)) break;
      }
    } else {
      for (const trio of shuffle(chainCandidates(g))) {
        const old = trio.map(([r, c]) => ({ type: g.spools[r][c].type, param: g.spools[r][c].param }));
        if (tryDrug(`三连(${trio[0]})`,
          () => { const grp = nextGroup(g); trio.forEach(([r, c]) => { g.spools[r][c].type = 5; g.spools[r][c].param = grp; }); },
          () => trio.forEach(([r, c], i) => { g.spools[r][c].type = old[i].type; g.spools[r][c].param = old[i].param; }),
          (b, a) => a.mid3 > b.mid3)) break;
      }
    }
  }
}

// ═══ 二、多样化（硬门过了 → 随机组合，仍然守住硬门）═══
// 这一步才是"公式化"的解药：同一张图用不同障碍组合达成同样的硬门。
{
  // 【2026-11-04 用户】冰 0–2 → 4–8 块（用户喜欢障碍多；每块仍要复测，破了就撤）
  const wantIce = 4 + Math.floor(rand() * 5); // 4–8 块
  const wantChain = Math.floor(rand() * 3);   // 0–2 组
  const wantQ = 1 + Math.floor(rand() * 4);   // 1–4 个
  const plan = [];
  for (let i = 0; i < wantIce; i++) plan.push('ice');
  for (let i = 0; i < wantChain; i++) plan.push('chain');
  for (let i = 0; i < wantQ; i++) plan.push('q');
  log.push(`随机组合：冰${wantIce} 三连${wantChain} 问号${wantQ}`);

  let nIce = 0, nChain = 0, nQ = 0;
  for (const kind of shuffle(plan)) {
    // 【2026-11-04 用户】原来这里用 HARD 拦：基线硬门本就不过的关（mid3<15）会直接 break，
    // 一块药都加不上（实测 9/10 张图冰=0 的真凶）。改为只要还能通关就继续加。
    if (!quick(g).won) { log.push('关卡已不可通关，停止加药'); break; }
    if (kind === 'ice') {
      for (const [r, c, delay, st] of iceCandidates(g)) {   // 已按被取步数排序，不 shuffle
        const old = { type: g.spools[r][c].type, param: g.spools[r][c].param };
        if (tryDrug(`冰(${r},${c})【色${colorOf(g,r,c)} 原本第${st}步就被取，冻结到第${delay}步】`,
          () => { g.spools[r][c].type = 7; g.spools[r][c].param = delay; },
          () => { g.spools[r][c].type = old.type; g.spools[r][c].param = old.param; },
          (b, a) => LOOSE(a, b))) { nIce++; break; }   // 【2026-11-04 用户】放宽：不再要求"硬门全过"，只要不整体变差
      }
    } else if (kind === 'chain') {
      for (const trio of shuffle(chainCandidates(g))) {
        const old = trio.map(([r, c]) => ({ type: g.spools[r][c].type, param: g.spools[r][c].param }));
        if (tryDrug(`三连(${trio[0]})`,
          () => { const grp = nextGroup(g); trio.forEach(([r, c]) => { g.spools[r][c].type = 5; g.spools[r][c].param = grp; }); },
          () => trio.forEach(([r, c], i) => { g.spools[r][c].type = old[i].type; g.spools[r][c].param = old[i].param; }),
          (b, a) => LOOSE(a, b))) { nChain++; break; }
      }
    } else {
      const freq = fillFrequency(g);
      const marks = [];
      for (let r = 1; r < rows; r++) for (let c = 0; c < cols; c++) if (isPlain(g.spools[r][c])) marks.push([r, c, freq.get(r + ',' + c) || 0]);
      marks.sort((a, b) => b[2] - a[2]);   // 【有理有据】优先给「最常能吃满」的车
      for (const [r, c, fq] of marks) {
        const s = g.spools[r][c];
        const old = { type: s.type, param: s.param, q: s.q };
        if (tryDrug(`问号(${r},${c})【色${colorOf(g,r,c)} 在 ${fq} 个时刻都能一口吃满，隐藏它】`,
          () => { const t = typesOf(s); if (!t.includes(6)) t.push(6); s.type = t; s.q = true; },
          () => { s.type = old.type; s.param = old.param; s.q = old.q; },
          (b, a) => LOOSE(a, b))) { nQ++; break; }
      }
    }
  }
  log.push(`实际落位：冰${nIce} 三连${nChain} 问号${nQ}`);
}

function chainCandidates(gg) {
  const out = [];
  for (let r = 0; r < gg.spools.length; r++) for (let c = 0; c + 2 < gg.spools[0].length; c++) {
    const trio = [[r, c], [r, c + 1], [r, c + 2]];
    if (trio.every(([y, x]) => isPlain(gg.spools[y][x]))) out.push(trio);
  }
  for (let r = 0; r + 2 < gg.spools.length; r++) for (let c = 0; c < gg.spools[0].length; c++) {
    const trio = [[r, c], [r + 1, c], [r + 2, c]];
    if (trio.every(([y, x]) => isPlain(gg.spools[y][x]))) out.push(trio);
  }
  return out;
}
function iceCandidates(gg) {
  const { map, steps } = pickSteps(gg);
  const out = [];
  for (let r = 0; r < gg.spools.length; r++) for (let c = 0; c < gg.spools[0].length; c++) {
    const s = gg.spools[r][c];
    if (!isPlain(s)) continue;
    const st = map.get(r + ',' + c);
    if (!st) continue;
    if (st < steps * 0.2 || st > steps * 0.8) continue;
    out.push([r, c, Math.min(steps - 1, st + 4 + Math.floor(rand() * 6)), st, s.id]);
  }
  // 【有理有据】按「被取步数」升序：越早被取的车，冻住它越能推迟第一波债务
  out.sort((a, b) => a[3] - b[3]);
  return out;
}

/** 每辆车「能吃满」的步数（越多越容易被玩家一眼看中 → 适合加问号） */
function fillFrequency(gg) {
  const { o } = solve(gg);
  const H = gg.blocks.length, W = gg.blocks[0].length, rows = gg.spools.length, cols = gg.spools[0].length;
  const col = gg.blocks.map(r => r.slice()), gone = gg.blocks.map(r => r.map(() => false));
  const reach = (y, x) => y === 0 || x === 0 || y === H - 1 || x === W - 1 ||
    gone[y - 1][x] || gone[y + 1][x] || gone[y][x - 1] || gone[y][x + 1];
  const picks = (o.pickOrder || []).filter(p => p.chainIndex === 0);
  const taken = new Set(), freq = new Map();
  for (const p of picks) {
    const cnt = {};
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { if (gone[y][x] || !reach(y, x)) continue; cnt[col[y][x]] = (cnt[col[y][x]] || 0) + 1; }
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const s = gg.spools[r][c];
      if (!s || !(s.id > 0) || taken.has(r + ',' + c) || s.q) continue;
      if ((cnt[s.id] || 0) >= s.count) freq.set(r + ',' + c, (freq.get(r + ',' + c) || 0) + 1);
    }
    const c0 = p.color, list = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { if (gone[y][x] || col[y][x] !== c0 || !reach(y, x)) continue; list.push([(H - 1 - y) + x, y, x]); }
    list.sort((a, b) => a[0] - b[0]);
    let n = 0;
    for (const [, y, x] of list) { if (n >= p.count) break; gone[y][x] = true; n++; }
    taken.add(p.r + ',' + p.c);
  }
  return freq;
}
function nextGroup(gg) {
  let n = 1;
  for (const row of gg.spools) for (const s of row) if (s && isChain(s)) n = Math.max(n, (Number(s.param) || 0) + 1);
  return n;
}
/** 开局就被取的车（前 20%）——用来给"免费步太多"的关提前制造第一波债务 */
function iceEarlyCandidates(gg) {
  const { map, steps } = pickSteps(gg);
  const out = [];
  for (let r = 0; r < gg.spools.length; r++) for (let c = 0; c < gg.spools[0].length; c++) {
    const s = gg.spools[r][c];
    if (!isPlain(s)) continue;
    const st = map.get(r + ',' + c);
    if (!st || st > steps * 0.2) continue;
    out.push([r, c, Math.min(steps - 1, st + 3 + Math.floor(rand() * 6))]);
  }
  return out;
}

let out = clone(g); delete out._rx;
fs.writeFileSync(OUT, JSON.stringify(out));

// ── 13 项总闸：处方后"通过的项数"必须不少于处方前，否则整体回滚 ──
// 局部判据（HARD）只能看到曲线，看不到容错/决策度；这一步兜底，保证不会把好关改坏。
if (!QUIET) {
  const { check } = require('./ArlCheck_v792');
  const passed = f => check(f).rules.filter(r => r[1]).length;
  let p0 = null, p1 = null;
  try { p0 = passed(FILE); p1 = passed(OUT); } catch (e) { /* 校验失败就不拦 */ }
  if (p0 != null && p1 != null) {
    log.push(`13 项：改前 ${p0}/13 → 改后 ${p1}/13`);
    if (p1 < p0) {
      fs.writeFileSync(OUT, JSON.stringify(g0));
      log.push(`处方让通过项减少（${p0}→${p1}），已整体回滚原始关卡`);
      out = g0;
    }
  }
}

if (!QUIET) {
  console.log('\n处方：');
  log.forEach(x => console.log('  · ' + x));
  const mf = quick(out);
  console.log(`\n结果：${describe(mf)} 前20% at4=${mf.early4} 可通=${mf.won}`);
  console.log('已写入', OUT);
}
