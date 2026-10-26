#!/usr/bin/env node
/**
 * 消除口径「改前 vs 改后」对比（v524 第 1 步验证，只读，不改生产）
 *
 * 对比对象：utils.eliminationOrder 的 ring（默认，改动前）与 instant（瞬时连锁，新增）
 * 量三样，对应生成侧真正消费的东西：
 *   ① 车表      —— 按容量带把每色切成 (颜色, 数量)：两臂是否一致
 *   ② 切球      —— pickBoxSplit 四种切法的 box 列表 hash：两臂是否一致
 *   ③ 像素归属  —— 同色内按 rank 每 cap 一辆车，逐车比像素集合 Jaccard
 *
 * 用法（仓库根目录）：
 *   node 03_工具/好关评分/elimOrder_对比_v524.js
 *   node 03_工具/好关评分/elimOrder_对比_v524.js --images 006,010 --out 03_工具/好关评分/elimOrder_对比_v524.json
 *
 * 注意：exposeCut 自带随机（同 seed 三次结果不同），所以本工具给 sandbox 注入确定性 Math.random，
 *       否则会把随机噪声当成"改口径造成的差异"（v524 踩过）。
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const BASE = path.join(ROOT, '02_工程', '完整主bin快照_20261012');
const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js', 'playersim.js', 'analysis.js', 'generator.js'];
const IMAGES = {
  '006': '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_006.txt',
  '010': '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_010.txt',
  '007': '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_007.txt'
};

function load(seed) {
  let s = (seed | 0) || 12345;
  const M = Object.create(Math);
  M.random = function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };  // 确定性随机
  const sb = { console: { log() { }, warn() { }, error() { } }, module: { exports: {} }, WeakMap, Map, Set, setTimeout, clearTimeout, Infinity, JSON, Date, Math: M };
  vm.createContext(sb);
  for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BASE, 'bin/js', f), 'utf8'), sb, { filename: f });
  return sb.AntSolver;
}

const h = o => crypto.createHash('sha1').update(JSON.stringify(o)).digest('hex').slice(0, 12);
const jac = (a, b) => { let i = 0; for (const x of a) if (b.has(x)) i++; return i / (a.size + b.size - i); };

function parseArgs(argv) {
  const o = { images: Object.keys(IMAGES), out: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--images') o.images = argv[++i].split(',').map(s => s.trim()).filter(Boolean);
    else if (argv[i] === '--out') o.out = argv[++i];
  }
  return o;
}

/** 同色内按 rank 每 cap 一辆车 → 每车像素坐标集合（= 生成器切车时的像素归属口径） */
function chunks(eo, color, cap) {
  const g = (eo.colorGroups[color] || []).slice().sort((a, b) => a.rank - b.rank);
  const out = [];
  for (let i = 0; i < g.length; i += cap) out.push(new Set(g.slice(i, i + cap).map(p => p.r * 10000 + p.c)));
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = { tool: 'elimOrder_对比_v524', when: new Date().toISOString(), images: {} };

  for (const id of args.images) {
    const file = IMAGES[id];
    if (!file) { console.log('跳过未知图', id); continue; }
    const txt = fs.readFileSync(path.join(ROOT, file), 'utf8');

    // 每臂一个独立引擎 + 同一确定性随机源
    const A = load(1001), G = A.Generator;
    const blocks = G.blocksFromTXT(txt);
    const R = blocks.length, C = blocks[0].length;
    const band = G.deriveCapacityBand(blocks) || {};
    const cap = band.chosen || 40;

    const ring = A.eliminationOrder(blocks, R, C, false);
    const inst = A.eliminationOrder(blocks, R, C, false, { instantChain: true, slot: 0 });

    // ① 车表：每色按 cap 切成 (color,count)，两臂数量一致 → 车表相同
    const carList = eo => {
      const out = [];
      for (const c of Object.keys(eo.colorGroups)) {
        const n = eo.colorGroups[c].length;
        for (let left = n; left > 0; left -= cap) out.push({ color: +c, count: Math.min(cap, left) });
      }
      return out;
    };
    const lr = carList(ring), li = carList(inst);

    // ② 切球：pickBoxSplit 四种切法
    const cfgOf = mode => ({
      seed: 1001, generatorFlow: 'new_fixed', elimOrder: mode,
      boxSizeMin: band.band[0], boxSizeMax: band.band[1],
      candidateCount: 1, timeBudgetMs: 8000, fullTime: true, portfolioK: 1, acceptMode: 'target',
      targetPeakMin: 3.2, targetPeakMax: 4.8, targetSteadyMin: 0, targetSteadyMax: 100,
      targetBand3Min: 0, targetBand4Min: 0, targetPlayerPassMin: 0.25,
      boardAllowSquare: true, boardRowsMin: 4, boardRowsMax: 6, boardColsMin: 6, boardColsMax: 8,
      boardHardRange: true, boardAuto: false
    });
    const cut = {};
    for (const mode of ['layerCut2', 'exposeCut', 'roundCut', 'componentBoxes']) {
      const cRing = Object.assign(cfgOf('ring'), { cutMode: mode });
      const cInst = Object.assign(cfgOf('instant'), { cutMode: mode });
      // 每臂重开引擎，避免缓存/随机状态互相影响
      const g1 = load(1001).Generator, g2 = load(1001).Generator;
      const b1 = g1.blocksFromTXT(txt), b2 = g2.blocksFromTXT(txt);
      const h1 = h(g1.pickBoxSplit(b1, cRing));
      const h2 = h(g2.pickBoxSplit(b2, cInst));
      cut[mode] = { ring: h1, instant: h2, same: h1 === h2 };
    }

    // ③ 像素归属：逐车 Jaccard
    let cars = 0, jsum = 0, identical = 0;
    for (const c of Object.keys(ring.colorGroups)) {
      const a = chunks(ring, c, cap), b = chunks(inst, c, cap);
      const n = Math.min(a.length, b.length);
      for (let i = 0; i < n; i++) { const j = jac(a[i], b[i]); jsum += j; cars++; if (j > 0.99) identical++; }
    }

    report.images[id] = {
      size: `${R}x${C}`, cap,
      carList: { ring: lr.length, instant: li.length, identical: h(lr) === h(li) },
      cut,
      pixelOwnership: { cars, identical, identicalPct: +(identical / cars * 100).toFixed(1), jaccardAvg: +(jsum / cars).toFixed(3) }
    };
    console.log(`${id} ${R}x${C} cap=${cap}`);
    console.log(`  车表：ring ${lr.length} 辆 / instant ${li.length} 辆，完全一致=${h(lr) === h(li)}`);
    console.log(`  切球：${Object.keys(cut).map(m => `${m}=${cut[m].same ? '同' : '不同'}`).join(' ')}`);
    console.log(`  像素归属：${cars} 辆中 ${identical} 辆完全相同（${(identical / cars * 100).toFixed(0)}%），Jaccard 均 ${(jsum / cars).toFixed(3)}`);
  }

  if (args.out) {
    const p = args.out.endsWith('.json') ? args.out : args.out + '.json';
    fs.writeFileSync(path.resolve(ROOT, p), JSON.stringify(report, null, 2));
    console.log('已写出:', p);
  }
}

if (require.main === module) main();
module.exports = { chunks };
