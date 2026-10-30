#!/usr/bin/env node
/** v568：按源图原始容量带重审已生产关卡，防止使用被生成器改写的config自证合规。 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '游戏主bin', 'bin', 'js');
const OUT = path.join(__dirname, '容量合同重审_v568.json');
const FILES = [
  'utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js',
  'playersim.js', 'analysis.js', 'car-sequencer.js', 'solver-analysis.js',
  'experience-goal.js', 'capacity-tuner.js', 'instant-playout.js', 'generator.js',
  'source-preflight.js'
];
const IMAGE_PATHS = {
  '008': '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_008.txt',
  '014': '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_014.txt'
};
const SETS = [
  { arm: 'A', dir: 'M7独立seed留出图_v568.A臂.levels' },
  { arm: 'B', dir: 'M7独立seed留出图_v568.levels' }
];

function load() {
  const sb = {
    console: { log() {}, warn() {}, error() {} },
    module: { exports: {} },
    WeakMap, Map, Set, Date, Math, JSON, setTimeout, clearTimeout, Infinity
  };
  vm.createContext(sb);
  for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BIN, f), 'utf8'), sb, { filename: f });
  return sb.AntSolver;
}

function main() {
  const A = load();
  const rows = [];
  const bands = {};
  for (const image of Object.keys(IMAGE_PATHS)) {
    const blocks = A.Generator.blocksFromTXT(fs.readFileSync(path.join(ROOT, IMAGE_PATHS[image]), 'utf8'));
    bands[image] = A.Generator.deriveCapacityBand(blocks).band;
  }
  for (const set of SETS) {
    const dir = path.join(__dirname, set.dir);
    for (const file of fs.readdirSync(dir).filter(x => x.endsWith('.json') && !x.endsWith('.route.json')).sort()) {
      const m = file.match(/^(008|014)_(\d+)\.json$/);
      if (!m) continue;
      const image = m[1], seed = +m[2];
      const level = A.parseLevel(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')));
      const band = bands[image];
      const cap = A.Quality.capacityEvidence(level, {
        boxSizeMin: band[0],
        boxSizeMax: band[1]
      });
      rows.push({
        arm: set.arm,
        image,
        seed,
        originalBand: band,
        cars: cap.cars,
        minCap: cap.minCap,
        maxCap: cap.maxCap,
        conserved: cap.conserved,
        perColorConserved: cap.perColorConserved,
        aboveMax: cap.aboveMax,
        belowMin: cap.belowMin,
        boardFloorPass: cap.boardFloorPass,
        pass: !!(cap.conserved && cap.perColorConserved && cap.boardFloorPass && cap.aboveMax === 0)
      });
    }
  }
  const summary = {
    rows: rows.length,
    pass: rows.filter(x => x.pass).length,
    aboveMax: rows.filter(x => x.aboveMax > 0).length,
    perColorFail: rows.filter(x => x.perColorConserved !== true).length,
    bands,
    byArm: Object.fromEntries(['A', 'B'].map(arm => {
      const a = rows.filter(x => x.arm === arm);
      return [arm, {
        rows: a.length,
        pass: a.filter(x => x.pass).length,
        aboveMaxRows: a.filter(x => x.aboveMax > 0).length,
        maxAbove: a.length ? Math.max.apply(null, a.map(x => x.aboveMax)) : null
      }];
    })),
    decision: rows.some(x => x.aboveMax > 0)
      ? '按源图原始容量带重审发现超上限关卡；此前使用改写后r.config的aboveMax=0不能作为合规证据。'
      : '按源图原始容量带重审全部合规。'
  };
  fs.writeFileSync(OUT, JSON.stringify({
    schema: 'capacity-contract-reaudit-v568',
    date: '2026-10-26',
    summary,
    rows
  }, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
}

main();
