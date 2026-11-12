#!/usr/bin/env node
'use strict';
/**
 * scan_swaps —— C5 中段代价：把候选代价车逐辆换到第 2–3 行，测量它第一次可点的进度
 * C5_中段代价（2026-11-12）
 *
 * 用法：
 *   node scan_swaps.js <关卡.json> --out <结果.json> \
 *        [--colors 5,1,22,23] [--rows 2,3] [--games 20] [--seed 1] [--shard 0 --nshards 4] [--keep <目录>]
 *
 * 对每个候选车（颜色在 --colors 内）和每个第 2–3 行的普通车格（type=0）：
 *   - 整辆车互换（不改 count / 颜色总量 / 目标图 / 障碍）；
 *   - 跑 20 局随机玩家（LCG + 倒序洗牌 + 当步不死，与 PopulationSim_v1 同口径）；
 *   - 记录「被换进去的那辆代价车」第一次进入合法可点列表时的 progress / gain / ratio。
 * 只要代价车，不改关卡文件本身；--keep 时才把每个候选变体 JSON 落盘（文件名带 pid）。
 */
const fs = require('fs');
const path = require('path');
const B = require(path.resolve(__dirname, '../../../03_工具/正式版/Build006Thickness_v688.js'));
const A = B.loadSolver('corner');
const Sim = A.Simulator, St = A.SolverStrategy;

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const levelFile = process.argv[2];
if (!levelFile || levelFile.startsWith('--')) {
  console.error('用法: node scan_swaps.js <关卡.json> --out <结果.json> [--colors 5,1,22,23] [--rows 2,3] [--games 20] [--seed 1] [--shard 0 --nshards 4] [--keep <目录>]');
  process.exit(2);
}
const OUT = arg('--out', `/tmp/c5_scan_${process.pid}.json`);
const ALL = process.argv.includes('--all');
const COLORS = String(arg('--colors', '5,1,22,23')).split(',').map(Number);
const ROWS = String(arg('--rows', '2,3')).split(',').map(Number);
const NGAMES = Number(arg('--games', 20));
const SEED = Number(arg('--seed', 1));
const SHARD = Number(arg('--shard', 0));
const NSHARDS = Number(arg('--nshards', 1));
const KEEP = arg('--keep', '');
const KEEP_TAG = KEEP ? String(process.pid) : '';
if (KEEP) fs.mkdirSync(KEEP, { recursive: true });

const isWon = (s) => s.eliminatedPixels >= s.totalPixels;
const isDead = (s) => !!(s.overflow || s.buffer.length > s.bufferLimit || Sim.isDeadEnd(s));
function lcg(seed) { let rs = seed; return () => { rs = (rs * 1103515245 + 12345) & 0x7fffffff; return rs / 0x7fffffff; }; }
function median(a) { if (!a.length) return null; const b = a.slice().sort((x, y) => x - y), m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; }
const r4 = (x) => x == null ? null : Math.round(x * 1e4) / 1e4;
const pct = (a, p) => { if (!a.length) return null; const b = a.slice().sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(p * (b.length - 1)))]; };

const base = JSON.parse(fs.readFileSync(levelFile, 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));
const isOrdinary = (s) => s && s.id > 0 && (!s.type || (Array.isArray(s.type) ? !s.type.length : s.type === 0));

const cars = [];
for (let r = 0; r < base.spools.length; r++) for (let c = 0; c < base.spools[r].length; c++) {
  const s = base.spools[r][c];
  if (isOrdinary(s)) cars.push({ r, c, color: s.id, count: s.count, key: r + ',' + c });
}
const targets = cars.filter(x => ROWS.includes(x.r));
const candidates = ALL ? cars : cars.filter(x => COLORS.includes(x.color));

function playVariant(g, watchKey) {
  const lv = A.parseLevel(A.fromGameFormat(g));
  const rnd = lcg(SEED);
  const vals = [], gains = [], ratios = [];
  let wins = 0;
  const wc = watchKey.split(',').map(Number);
  const wCar = g.spools[wc[0]][wc[1]];
  for (let gi = 0; gi < NGAMES; gi++) {
    let s = Sim.createState(lv, { useSlotStart: true, instantChain: false });
    let seen = false;
    while (!isWon(s)) {
      const progress = s.eliminatedPixels / s.totalPixels;
      const ms = Sim.listMoves(s).filter(m => !m.blocked);
      if (!seen) {
        const m = ms.find(m => m.r === wc[0] && m.c === wc[1]);
        if (m) {
          const t = St.cloneState(s);
          const ok = Sim.applyPick(t, m.r, m.c);
          if (ok) {
            seen = true;
            const gain = t.eliminatedPixels - s.eliminatedPixels;
            vals.push(r4(progress)); gains.push(gain); ratios.push(wCar.count ? r4(gain / wCar.count) : 0);
          }
        }
      }
      const idx = ms.map((_, i) => i);
      for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const x = idx[i]; idx[i] = idx[j]; idx[j] = x; }
      let pick = null;
      for (const k of idx) {
        const m = ms[k], t = St.cloneState(s);
        if (!Sim.applyPick(t, m.r, m.c)) continue;
        if (!isDead(t) || isWon(t)) { pick = { r: m.r, c: m.c, t }; break; }
      }
      if (!pick) break;
      s = pick.t;
    }
    if (isWon(s)) wins++;
  }
  return {
    gamesSeen: vals.length, wins,
    firstProgressMedian: median(vals), firstProgressP25: pct(vals, 0.25), firstProgressP75: pct(vals, 0.75),
    firstProgressMin: vals.length ? Math.min(...vals) : null, firstProgressMax: vals.length ? Math.max(...vals) : null,
    gainMedian: median(gains), gainMax: gains.length ? Math.max(...gains) : null,
    ratioMedian: median(ratios), ratioMax: ratios.length ? Math.max(...ratios) : null
  };
}

const jobs = [];
let idx = 0;
for (const car of candidates) for (const tgt of targets) {
  if (tgt.r === car.r && tgt.c === car.c) continue;
  if (idx++ % NSHARDS !== SHARD) continue;
  jobs.push({ car, tgt });
}

const rows = [];
for (const j of jobs) {
  const g = clone(base);
  const a = [j.car.r, j.car.c], b = [j.tgt.r, j.tgt.c];
  const tmp = g.spools[a[0]][a[1]]; g.spools[a[0]][a[1]] = g.spools[b[0]][b[1]]; g.spools[b[0]][b[1]] = tmp;
  const watchKey = b[0] + ',' + b[1];
  const m = playVariant(g, watchKey);
  const row = {
    from: a.join(','), to: watchKey, row: j.tgt.r,
    color: j.car.color, count: j.car.count,
    displacedColor: j.tgt.color, displacedCount: j.tgt.count,
    ...m
  };
  rows.push(row);
  if (KEEP && m.firstProgressMedian != null) {
    const name = `swap_${a.join('_')}__to_${b.join('_')}__c${j.car.color}x${j.car.count}_${KEEP_TAG}.json`;
    fs.writeFileSync(path.join(KEEP, name), JSON.stringify(g, null, 1));
  }
}

rows.sort((x, y) => (x.firstProgressMedian == null ? 9 : x.firstProgressMedian) - (y.firstProgressMedian == null ? 9 : y.firstProgressMedian));
console.log(`shard ${SHARD}/${NSHARDS}：${jobs.length} 个交换`);
console.log('from   -> to     color/count  first中位(p25..p75)  gain中位 gainMax ratio中位  局数 通关');
for (const r of rows) {
  const p = (x) => x == null ? '—' : (x * 100).toFixed(1) + '%';
  console.log(`${r.from.padEnd(6)} ${r.to.padEnd(6)} ${String(r.color).padStart(2)}/${String(r.count).padEnd(3)}  ${p(r.firstProgressMedian).padEnd(9)} (${p(r.firstProgressP25)}..${p(r.firstProgressP75)}) ${String(r.gainMedian).padEnd(7)} ${String(r.gainMax).padEnd(6)} ${p(r.ratioMedian).padEnd(8)} ${r.gamesSeen}/${NGAMES} ${r.wins}`);
}
const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { meta: { level: path.resolve(levelFile), games: NGAMES, seed: SEED, colors: COLORS, rows: ROWS }, rows: [] };
if (!prev.meta) prev.meta = { level: path.resolve(levelFile), games: NGAMES, seed: SEED, colors: COLORS, rows: ROWS };
prev.rows = prev.rows.concat(rows);
prev.updated = new Date().toISOString();
fs.writeFileSync(OUT, JSON.stringify(prev, null, 1));
console.log('结果: ' + path.resolve(OUT));
