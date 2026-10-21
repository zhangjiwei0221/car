#!/usr/bin/env node
/**
 * 批量 A/B 对比：同一张目标图，用多组参数各跑 N 个 seed，比较**分布**而不是单次结果。
 *
 *   node 批量AB对比.js <目标图.txt> [选项]
 *
 * 选项
 *   --seeds 401-412        种子范围（或 401,403,405）
 *   --boards 6x7,5x6       盘型，逗号分隔
 *   --variants base,noice  只跑指定变体（默认全跑）
 *   --csv out.csv          把逐 seed 明细写进 CSV
 *
 * 为什么需要它：本会话里单 seed 对比至少误导过 4 次（换一个 seed 结论就翻转）。
 * 任何"这个改动有没有用"的判断，都应该用这个工具跑 12 个 seed 再下结论。
 *
 * 只读引擎、不写 输出文件/、不改生产代码。
 */
'use strict';
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const BASE = path.join(__dirname, '..', '..', '02_工程', '完整主bin快照_20261012');
const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js', 'playersim.js', 'analysis.js', 'generator.js'];
const sandbox = { console: { log() {}, warn() {}, error() {} }, module: { exports: {} }, WeakMap, Map, Set, setTimeout, clearTimeout, Infinity, Math, JSON };
vm.createContext(sandbox);
for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BASE, 'bin/js', f), 'utf8'), sandbox, { filename: f });
const A = sandbox.AntSolver;

// ---------- 变体定义（键 = 传给 produce 的 config 覆盖） ----------
const VARIANTS = {
  base:     { desc: '当前生产参数（按层关、容量归一化、冰按时差）' },
  noice:    { desc: '关掉冰', iceSchedule: false, iceScheduleCount: 0 },
  layer:    { desc: '开按层铺盘', layerFill: true, layerLag: 0.5 },
  sandwich: { desc: '三明治 3 辆', sandwich: true, lateShallow: 3, earlyKeep: 2 },
  swap:     { desc: '网关色搬盒 4 次', repairSwap: 4 },
  inflate:  { desc: '同色增容 3 次', repairInflate: 3 },
  bigcap:   { desc: '容量上限 84 + 每色开局能装满 2 辆', capTie: true, capPerColor: 2, capCeil: 84 },
  bigcap72: { desc: '同上但上限 72（避免超大车）', capTie: true, capPerColor: 2, capCeil: 72 },
  cap80:    { desc: '上限 80', capTie: true, capPerColor: 2, capCeil: 80 },
  cap78:    { desc: '上限 78', capTie: true, capPerColor: 2, capCeil: 78 },
  rowmix1:  { desc: '逐行铺+每行1格免费', rowMajorMix: true, freePerRow: 1 },
  rowmix2:  { desc: '逐行铺+每行2格免费', rowMajorMix: true, freePerRow: 2 },
  bigcap_rowmix1: { desc: 'bigcap + 逐行铺1', capTie: true, capPerColor: 2, capCeil: 84, rowMajorMix: true, freePerRow: 1 },
  bigcap_mix1: { desc: 'bigcap+仅第0行混排', capTie: true, capPerColor: 2, capCeil: 84, rowMajorMix: true, freePerRow: 2, mixRows: 1 },
  bigcap_mix2: { desc: 'bigcap+前2行混排', capTie: true, capPerColor: 2, capCeil: 84, rowMajorMix: true, freePerRow: 2, mixRows: 2 },
  bigcap_rowmix3: { desc: 'bigcap + 逐行铺3', capTie: true, capPerColor: 2, capCeil: 84, rowMajorMix: true, freePerRow: 3 },
  rowmix3:  { desc: '逐行铺+每行3格免费', rowMajorMix: true, freePerRow: 3 },
  bigcap_rowmix2: { desc: 'bigcap + 逐行铺2', capTie: true, capPerColor: 2, capCeil: 84, rowMajorMix: true, freePerRow: 2 },
  bigcap_noice: { desc: '上限 84 + 关冰', capTie: true, capPerColor: 2, capCeil: 84, iceSchedule: false },
  bigcap72_noice: { desc: '上限 72 + 关冰', capTie: true, capPerColor: 2, capCeil: 72, iceSchedule: false },
};

function loadImg(p) {
  const rows = []; let started = false;
  for (const l of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const t = l.trim();
    if (t === '像素矩阵') { started = true; continue; }
    if (!started || !t) continue;
    rows.push(t.split(/\s+/).map(Number));
  }
  return rows;
}

function parseSeeds(s) {
  const out = [];
  for (const part of s.split(',')) {
    const m = part.match(/^(\d+)-(\d+)$/);
    if (m) { for (let i = +m[1]; i <= +m[2]; i++) out.push(i); }
    else if (part.trim()) out.push(+part.trim());
  }
  return out;
}

const args = process.argv.slice(2);
const imgPath = args.find(a => a.endsWith('.txt') || a.endsWith('.json'));
if (!imgPath) { console.error('用法：node 批量AB对比.js <目标图.txt> [--seeds 401-412] [--boards 6x7] [--variants base,layer]'); process.exit(1); }
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 && args[i + 1] ? args[i + 1] : def; };
const seeds = parseSeeds(opt('seeds', '401-412'));
const boards = opt('boards', '6x7').split(',').map(s => s.split('x').map(Number));
const onlyV = opt('variants', '');
const csvPath = opt('csv', '');

const img = loadImg(imgPath);
const px = img.reduce((a, r) => a + r.filter(v => v > 0).length, 0);

function once(seed, R, C, over) {
  const cells = R * C;
  const cars = Math.round(cells * 0.86);
  const cap = Math.max(1, Math.round(px / Math.max(1, cars)));
  const capMin = Math.max(33, Math.round(cap * 0.85));
  const capMax = Math.min(64, Math.max(capMin + 6, Math.round(cap * 1.15)));
  const cfg = {
    boxSizeMin: capMin, boxSizeMax: capMax,
    usableSpaceTarget: 0.86,
    blackPercent: 0, blackPercentMin: 0, blackPercentMax: 0,
    icePercent: 0, row0IceMax: 3,
    iceSchedule: true, iceScheduleCount: 4, iceScheduleDelay: 7, iceSync: true,
    chainCount: 1, chainCountMin: 0, chainCountMax: 3,
    questionPercent: 6, questionPercentMin: 6, questionPercentMax: 6,
    narrowPath: false, narrowPathProb: 0,
    minPipes: 0, maxPipes: 1, pipeFloorCount: 1, pipeFallbackCount: 1, pipeMaxDepth: 6, pipeMinFill: 2,
    boardAllowSquare: true, candidateCount: 1, portfolioK: 1, timeBudgetMs: 20000,
    difficultyRounds: 1, goodV3: true, requireHardPass: false, seed: seed,
    boardHardRange: true, boardAuto: false,
    boardRowsMin: R, boardRowsMax: R, boardColsMin: C, boardColsMax: C,
    cutPixelOrder: 'peel', fillOrder: 'exposure', debtCarCap: 40, cutMode: '',
    targetCarCount: cars, carFillRatio: 0.86,
    valvePlan: false, acceptMode: 'target',
    targetPeakMin: 3.2, targetPeakMax: 4, targetSteadyMin: 30, targetSteadyMax: 80,
    wallBottomFirst: true, capTie: false, row0ColorMax: 2, layerFill: false,
    capNormalize: true,
    capNormMin: Math.max(16, Math.round(cap * 0.60)),
    capNormMax: Math.round(cap * 1.60),
    repairSwap: 0, repairInflate: 0,
  };
  Object.assign(cfg, over || {});
  let out;
  try { out = A.Generator.produce(img, cfg); } catch (e) { return { err: e.message }; }
  if (!out || !out.level) return { err: 'noLevel' };
  const lv = A.parseLevel(out.level);
  const sr = A.Solver.solve(lv, { greedyOnly: true });
  const ps = sr.pressureSamples || [], tb = sr.totalBoxes || 0;
  let bt = 0, bg = 0, bp = 0;
  for (const s of ps) {
    const pr = tb ? s.done / tb : 0;
    if (pr < 0.3 || pr > 0.8) continue;
    bt++; if (s.buf >= 3) bg++; if (s.buf > bp) bp = s.buf;
  }
  const caps = []; let ice = 0;
  for (const row of out.level.board.cells) for (const c of row) {
    if (!c || c.t !== 'box') continue;
    caps.push(c.count);
    if (c.numice > 0) ice++;
  }
  caps.sort((a, b) => a - b);
  return {
    cov: bt ? Math.round(bg / bt * 100) : 0,
    peak: bp,
    steady: out.goodV3 && out.goodV3.steadyWonPct,
    cars: caps.length,
    capMin: caps[0], capMed: caps[Math.floor(caps.length / 2)], capMax: caps[caps.length - 1],
    ice: ice,
  };
}

const pct = (arr, q) => { const s = arr.slice().sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * q))] : 0; };

const names = onlyV ? onlyV.split(',').filter(n => VARIANTS[n]) : Object.keys(VARIANTS);
const rows = [];
const summary = [];
for (const vn of names) {
  const over = Object.assign({}, VARIANTS[vn]);
  delete over.desc;
  for (const [R, C] of boards) {
    const covs = [], peaks = [], fails = [];
    for (const seed of seeds) {
      const r = once(seed, R, C, over);
      if (r.err) { fails.push(seed); continue; }
      covs.push(r.cov); peaks.push(r.peak);
      rows.push({ variant: vn, board: R + 'x' + C, seed, ...r });
    }
    summary.push({
      variant: vn, board: R + 'x' + C, desc: VARIANTS[vn].desc,
      n: covs.length, fail: fails.length,
      med: pct(covs, 0.5), p25: pct(covs, 0.25), p75: pct(covs, 0.75),
      max: covs.length ? Math.max(...covs) : 0,
      pass: covs.filter(x => x >= 45).length,
      peak4: peaks.filter(x => x === 4).length,
    });
  }
  if (false) {
  summary.push({
    variant: vn, board: (boards.length === 1 ? boards[0].join('x') : boards.map(b => b.join('x')).join('+')), desc: VARIANTS[vn].desc,
    n: covs.length, fail: fails.length,
    med: pct(covs, 0.5), p25: pct(covs, 0.25), p75: pct(covs, 0.75),
    max: covs.length ? Math.max(...covs) : 0,
    pass: 0, peak4: 0,
  });
  }
}

console.log('');
console.log('变体'.padEnd(10), '盘型'.padEnd(6), 'n', '死', '中位', 'p25', 'p75', '最高', '≥45%', '峰值4');
for (const s of summary) {
  console.log(
    s.variant.padEnd(10),
    String(s.board).padEnd(6),
    String(s.n).padStart(2),
    String(s.fail).padStart(2),
    String(s.med + '%').padStart(5),
    String(s.p25 + '%').padStart(4),
    String(s.p75 + '%').padStart(4),
    String(s.max + '%').padStart(5),
    `${s.pass}/${s.n}`.padStart(6),
    `${s.peak4}/${s.n}`.padStart(6)
  );
}
console.log('');
const best = summary.slice().sort((a, b) => b.med - a.med)[0];
console.log('中位最高：' + best.variant + '（' + best.med + '%）— ' + best.desc);

if (csvPath) {
  const head = ['variant', 'board', 'seed', 'cov', 'peak', 'steady', 'cars', 'capMin', 'capMed', 'capMax', 'ice'];
  const lines = [head.join(',')].concat(rows.map(r => head.map(h => r[h] == null ? '' : r[h]).join(',')));
  fs.writeFileSync(csvPath, lines.join('\n'), 'utf8');
  console.log('明细已写入 ' + csvPath);
}
