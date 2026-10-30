#!/usr/bin/env node
'use strict';

/**
 * E6.7f pressure search over non-story car positions.
 *
 * The six v13 role anchors stay fixed. Generic top-row cars may swap with
 * deeper cars, preserving the 47-car capacity multiset and zero obstacles.
 * Candidates are accepted only when:
 *   - the three role paths still replay;
 *   - the level remains solvable;
 *   - zero-revive PlayerSim seeds survive;
 *   - at least one route reaches buffer 3/4.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '完整主bin快照_20261012', 'bin', 'js');
const SOURCE = path.join(ROOT, '实验关/关卡6/原型_v13/关卡_实验_006_v13.json');
const OUT = path.join(ROOT, '实验关/关卡6/搜索_v14_pressure');
const MODULES = [
  'utils.js',
  'color-libs.js',
  'simulator.js',
  'solver-strategy.js',
  'solver.js',
  'playersim.js',
  'analysis.js',
  'car-sequencer.js',
  'solver-analysis.js',
  'experience-goal.js',
  'capacity-tuner.js',
  'instant-playout.js',
  'generator.js'
];

const PROTECTED = new Set([
  '0,0', '0,3', '0,6',
  '1,0', '1,6',
  '2,0', '2,6'
]);

const ROLE_PATHS = {
  safe: [[0, 3], [1, 3]],
  lightDebt: [[0, 0], [1, 0], [2, 0]],
  heavyDebt: [[0, 6], [1, 6], [2, 6]]
};

function loadSolver() {
  const sandbox = {
    console,
    WeakMap,
    Map,
    Set,
    Date,
    Math,
    JSON,
    Object,
    Array,
    String,
    Number,
    isNaN,
    parseInt,
    parseFloat,
    isFinite,
    setTimeout,
    clearTimeout
  };
  sandbox.global = sandbox;
  vm.createContext(sandbox);
  for (const file of MODULES) {
    vm.runInContext(
      fs.readFileSync(path.join(BIN, file), 'utf8'),
      sandbox,
      { filename: file }
    );
  }
  return sandbox.AntSolver;
}

function rng(seed) {
  let value = seed >>> 0;
  return function next() {
    value += 0x6D2B79F5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(items, random) {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const temp = out[i];
    out[i] = out[j];
    out[j] = temp;
  }
  return out;
}

function uniquePicks(run) {
  const seen = new Set();
  const out = [];
  for (const pick of run.pickOrder || []) {
    if (seen.has(pick.step)) continue;
    seen.add(pick.step);
    out.push({
      r: pick.r,
      c: pick.c,
      color: pick.color,
      count: pick.count
    });
  }
  return out;
}

function poseKey(picks) {
  return picks.map(pick => pick.r + ',' + pick.c).join('>');
}

function bufferState(state) {
  return state.buffer.map(item => ({
    color: item.color,
    remaining: item.need - item.progress,
    need: item.need,
    progress: item.progress,
    slot: item.slot
  }));
}

function tracePath(A, level, path) {
  const state = A.Simulator.createState(level, {
    useSlotStart: true,
    instantChain: true
  });
  state.capture = true;
  state.capOps = [];
  const evidence = [];
  for (const [r, c] of path) {
    const move = A.Simulator.listMoves(state)
      .find(item => item.r === r && item.c === c && !item.blocked);
    if (!move) return { ok: false, evidence, reason: 'missing:' + r + ',' + c };
    state.capOps = [];
    if (!A.Simulator.applyPick(state, r, c)) {
      return { ok: false, evidence, reason: 'apply:' + r + ',' + c };
    }
    evidence.push({
      r,
      c,
      color: move.antBox.color,
      count: move.antBox.count,
      buffer: bufferState(state)
    });
  }
  return { ok: true, evidence };
}

function optionsAt(A, state) {
  return A.Simulator.listMoves(state)
    .filter(move => !move.blocked)
    .map(move => {
      const clone = A.SolverStrategy.cloneState(state);
      const before = clone.eliminatedPixels;
      clone.capOps = [];
      const applied = A.Simulator.applyPick(clone, move.r, move.c);
      return {
        r: move.r,
        c: move.c,
        color: move.antBox.color,
        count: move.antBox.count,
        canConsume: move.canConsume,
        consumed: clone.eliminatedPixels - before,
        bufferAfter: bufferState(clone),
        applied
      };
    });
}

function rolePass(A, level) {
  const safe = tracePath(A, level, ROLE_PATHS.safe);
  const light = tracePath(A, level, ROLE_PATHS.lightDebt);
  const heavy = tracePath(A, level, ROLE_PATHS.heavyDebt);
  return {
    safe,
    light,
    heavy,
    ok: safe.ok && light.ok && heavy.ok &&
      safe.evidence.every(step => step.buffer.length === 0) &&
      light.evidence[1].buffer.some(item =>
        item.color === 17 && item.remaining === 10) &&
      light.evidence[2].buffer.length === 0 &&
      heavy.evidence[1].buffer.some(item =>
        item.color === 34 && item.remaining === 19) &&
      heavy.evidence[2].buffer.length === 0
  };
}

function pressureWindows(timeline, threshold) {
  const windows = [];
  let start = null;
  for (let i = 0; i < timeline.length; i++) {
    if (timeline[i] >= threshold && start == null) start = i;
    if (timeline[i] < threshold && start != null) {
      windows.push({ start, end: i - 1, peak: Math.max(...timeline.slice(start, i)) });
      start = null;
    }
  }
  if (start != null) {
    windows.push({
      start,
      end: timeline.length - 1,
      peak: Math.max(...timeline.slice(start))
    });
  }
  return windows;
}

function capacityKey(level) {
  return level.board.cells
    .flat()
    .filter(cell => cell && cell.t === 'box')
    .map(cell => cell.color + '/' + cell.count)
    .sort()
    .join(',');
}

function parseArgs(argv) {
  const out = { iterations: 1200, seed: 681, keep: 12, base: '' };
  for (const arg of argv.slice(2)) {
    const match = /^--([^=]+)=(.+)$/.exec(arg);
    if (!match) continue;
    out[match[1]] = match[1] === 'base' ? match[2] : Number(match[2]);
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  const A = loadSolver();
  const baseFile = args.base ? path.resolve(ROOT, args.base) : SOURCE;
  const baseGame = JSON.parse(fs.readFileSync(baseFile, 'utf8'));
  const baseLevel = A.parseLevel(A.fromGameFormat(baseGame));
  const baseCapacity = capacityKey(baseLevel);
  const random = rng(args.seed);

  const topFree = [];
  const lowerFree = [];
  for (let r = 0; r < baseGame.maprow; r++) {
    for (let c = 0; c < baseGame.mapcol; c++) {
      const spool = baseGame.spools[r][c];
      if (!spool || spool.id <= 0) continue;
      const key = r + ',' + c;
      if (PROTECTED.has(key)) continue;
      if (r === 0) topFree.push([r, c]);
      else lowerFree.push([r, c]);
    }
  }

  const records = [];
  let best = null;
  let validCount = 0;

  for (let iteration = 0; iteration < args.iterations; iteration++) {
    const game = JSON.parse(JSON.stringify(baseGame));
    const swapCount = 1 + Math.floor(random() * Math.min(4, topFree.length));
    const selectedTop = shuffle(topFree, random).slice(0, swapCount);
    const selectedLower = shuffle(lowerFree, random).slice(0, swapCount);
    const swaps = [];
    for (let i = 0; i < swapCount; i++) {
      const [tr, tc] = selectedTop[i];
      const [lr, lc] = selectedLower[i];
      const temp = game.spools[tr][tc];
      game.spools[tr][tc] = game.spools[lr][lc];
      game.spools[lr][lc] = temp;
      swaps.push([tr, tc, lr, lc]);
    }

    let level;
    try { level = A.parseLevel(A.fromGameFormat(game)); }
    catch (e) { continue; }
    if (capacityKey(level) !== baseCapacity) continue;

    const roles = rolePass(A, level);
    if (!roles.ok) continue;

    const initial = A.Simulator.createState(level, {
      useSlotStart: true,
      instantChain: true
    });
    initial.capture = true;
    const openingMoves = optionsAt(A, initial);
    if (openingMoves.length < 3 ||
        openingMoves.some(move => !move.applied || move.consumed <= 0)) {
      continue;
    }

    const solve = A.Solver.solveInstantChain(level, { timeBudgetMs: 3000 });
    if (!solve.completed || solve.progress !== 100) continue;
    const solveTimeline = solve.stepBufferHistory || [];
    const solvePeak = solve.maxBuffer || Math.max(0, ...solveTimeline);

    const players = [];
    let playersPass = true;
    for (const seed of [7, 1009, 2027]) {
      const run = A.PlayerSim.run(level, {
        seed,
        instantChain: true,
        reviveCap: 0
      });
      const timeline = run.bufferTimeline || [];
      const windows = pressureWindows(timeline, 3);
      players.push({
        seed,
        won: run.won,
        progress: run.progress,
        revivesUsed: run.revivesUsed,
        peak: run.bufferPeak || Math.max(0, ...timeline),
        timeline,
        windows,
        picks: uniquePicks(run)
      });
      if (!run.won || run.progress !== 100 || run.revivesUsed !== 0) {
        playersPass = false;
      }
    }

    const routeKeys = new Set([poseKey(uniquePicks(solve).slice(0, 12))]);
    for (const player of players) routeKeys.add(poseKey(player.picks.slice(0, 12)));

    const passSeeds3 = players.filter(player => player.peak >= 3).length;
    const passSeeds4 = players.filter(player => player.peak >= 4).length;
    const passSeedsTwoWindows = players.filter(player => player.windows.length >= 2).length;
    const totalWindows3 = players.reduce((sum, player) => sum + player.windows.length, 0);
    const pressureSteps3 = players.reduce(
      (sum, player) => sum + player.timeline.filter(value => value >= 3).length,
      0
    );
    const score =
      (playersPass ? 1e9 : 0) +
      passSeedsTwoWindows * 1e8 +
      passSeeds3 * 1e7 +
      (solvePeak >= 3 ? 5e6 : 0) +
      totalWindows3 * 1e5 +
      pressureSteps3 * 1e3 +
      passSeeds4 * 100 +
      Math.min(solvePeak, 5) * 10 -
      swapCount;

    const record = {
      iteration,
      score,
      swaps,
      solvePeak,
      solveTimeline,
      playersPass,
      passSeeds3,
      passSeeds4,
      passSeedsTwoWindows,
      totalWindows3,
      pressureSteps3,
      openingCount: openingMoves.length,
      openingCanConsume: openingMoves.filter(move => move.canConsume).length,
      openingMinConsumed: Math.min(...openingMoves.map(move => move.consumed)),
      routeDiversity: routeKeys.size,
      players: players.map(player => ({
        seed: player.seed,
        won: player.won,
        progress: player.progress,
        peak: player.peak,
        windows: player.windows,
        timeline: player.timeline
      })),
      game
    };
    records.push(record);
    records.sort((a, b) => b.score - a.score);
    if (records.length > args.keep) records.length = args.keep;
    if (playersPass && passSeeds3 > 0) validCount++;
    if (!best || score > best.score) best = record;
  }

  fs.mkdirSync(OUT, { recursive: true });
  const summary = {
    schema: '006-pressure-search-v1',
    source: SOURCE,
    baseFile,
    iterations: args.iterations,
    seed: args.seed,
    validCount,
    top: records.map(record => ({
      iteration: record.iteration,
      score: record.score,
      swaps: record.swaps,
      solvePeak: record.solvePeak,
      playersPass: record.playersPass,
      passSeeds3: record.passSeeds3,
      passSeeds4: record.passSeeds4,
      passSeedsTwoWindows: record.passSeedsTwoWindows,
      totalWindows3: record.totalWindows3,
      pressureSteps3: record.pressureSteps3,
      openingCount: record.openingCount,
      openingCanConsume: record.openingCanConsume,
      openingMinConsumed: record.openingMinConsumed,
      routeDiversity: record.routeDiversity,
      players: record.players
    }))
  };
  fs.writeFileSync(
    path.join(OUT, 'pressure-search-v1.json'),
    JSON.stringify(summary, null, 2) + '\n'
  );
  if (best) {
    fs.writeFileSync(
      path.join(OUT, 'best-candidate-v1.json'),
      JSON.stringify(best.game, null, 2) + '\n'
    );
  }

  console.log(JSON.stringify({
    ok: !!best,
    iterations: args.iterations,
    validCount,
    best: best ? {
      score: best.score,
      swaps: best.swaps,
      solvePeak: best.solvePeak,
      playersPass: best.playersPass,
      passSeeds3: best.passSeeds3,
      passSeeds4: best.passSeeds4,
      passSeedsTwoWindows: best.passSeedsTwoWindows,
      totalWindows3: best.totalWindows3,
      pressureSteps3: best.pressureSteps3,
      openingCount: best.openingCount,
      openingCanConsume: best.openingCanConsume,
      openingMinConsumed: best.openingMinConsumed,
      routeDiversity: best.routeDiversity,
      players: best.players
    } : null,
    outDir: OUT
  }, null, 2));
}

try {
  main();
} catch (err) {
  console.error(err && err.stack || err);
  process.exit(1);
}
