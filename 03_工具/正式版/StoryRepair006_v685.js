#!/usr/bin/env node
'use strict';

/**
 * E6.7f bounded story repair.
 *
 * The repair order is intentional:
 *   1. restore semantic obstacle bindings;
 *   2. restore critical car positions;
 *   3. adjust a single color's car partition.
 *
 * Each layer is evaluated independently against the same story contract.
 * No seed search and no whole-board regeneration.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '完整主bin快照_20261012', 'bin', 'js');
const GOLDEN = path.join(ROOT, '实验关/关卡6/原型_v17/关卡_实验_006_v17.json');
const OUT = path.join(ROOT, '实验关/关卡6/repair_v1');
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

const ROLE_PATHS = {
  safe: [[0, 3], [1, 3]],
  lightDebt: [[0, 0], [1, 0], [2, 0]],
  heavyDebt: [[0, 6], [1, 6], [2, 6]]
};
const KEY_CARS = [
  [0, 0], [0, 3], [0, 6],
  [1, 0], [1, 6],
  [2, 0], [2, 6],
  [5, 1], [5, 2], [5, 3]
];
const BLACK_CELLS = [[1, 1], [1, 2]];
const CHAIN_CELLS = [[5, 1], [5, 2], [5, 3]];
const CHAIN_GROUP = 1;
const PIPE_CELL = [6, 6];
const PIPE_DIR = 11;
const PIPE_QUEUE = [{ id: 13, count: 28 }];

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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function uniquePicks(run) {
  const seen = new Set();
  const out = [];
  for (const pick of run.pickOrder || []) {
    if (seen.has(pick.step)) continue;
    seen.add(pick.step);
    out.push({ r: pick.r, c: pick.c, color: pick.color, count: pick.count });
  }
  return out;
}

function pressureWindows(timeline, threshold) {
  const windows = [];
  let start = null;
  for (let i = 0; i < timeline.length; i++) {
    if (timeline[i] >= threshold && start == null) start = i;
    if (timeline[i] < threshold && start != null) {
      windows.push({
        start: start + 1,
        end: i,
        peak: Math.max(...timeline.slice(start, i))
      });
      start = null;
    }
  }
  if (start != null) {
    windows.push({
      start: start + 1,
      end: timeline.length,
      peak: Math.max(...timeline.slice(start))
    });
  }
  return windows;
}

function traceRole(A, level, path) {
  const state = A.Simulator.createState(level, {
    useSlotStart: true,
    instantChain: true
  });
  state.capture = true;
  const evidence = [];
  for (const [r, c] of path) {
    const move = A.Simulator.listMoves(state)
      .find(item => item.r === r && item.c === c && !item.blocked);
    if (!move) return null;
    state.capOps = [];
    if (!A.Simulator.applyPick(state, r, c)) return null;
    evidence.push({
      color: move.antBox.color,
      count: move.antBox.count,
      buffer: state.buffer.map(item => ({
        color: item.color,
        remaining: item.need - item.progress
      }))
    });
  }
  return { state, evidence };
}

function openingStats(A, level) {
  const state = A.Simulator.createState(level, {
    useSlotStart: true,
    instantChain: true
  });
  state.capture = true;
  return A.Simulator.listMoves(state)
    .filter(move => !move.blocked)
    .map(move => {
      const child = A.SolverStrategy.cloneState(state);
      const before = child.eliminatedPixels;
      child.capOps = [];
      A.Simulator.applyPick(child, move.r, move.c);
      return {
        r: move.r,
        c: move.c,
        color: move.antBox.color,
        count: move.antBox.count,
        canConsume: move.canConsume,
        consumed: child.eliminatedPixels - before,
        bufferAfter: child.buffer.length
      };
    });
}

function chainEvent(A, level, run) {
  const picks = uniquePicks(run);
  const state = A.Simulator.createState(level, {
    useSlotStart: true,
    instantChain: true
  });
  state.capture = true;
  let entered = false;
  let completed = false;
  let debt = false;
  let released = false;
  for (const pick of picks) {
    state.capOps = [];
    if (!A.Simulator.applyPick(state, pick.r, pick.c)) continue;
    const linked = state.buffer.filter(item => item.link === CHAIN_GROUP);
    if (linked.length) {
      entered = true;
      if (linked.some(item => item.need - item.progress === 0)) completed = true;
      if (linked.some(item => item.need - item.progress > 0)) debt = true;
    } else if (entered) {
      released = true;
      break;
    }
  }
  return { entered, completed, debt, released };
}

function pipeEvent(A, level, run) {
  const picks = uniquePicks(run);
  const state = A.Simulator.createState(level, {
    useSlotStart: true,
    instantChain: true
  });
  state.capture = true;
  for (const pick of picks) {
    state.capOps = [];
    if (!A.Simulator.applyPick(state, pick.r, pick.c)) continue;
    const pipe = state.cells[PIPE_CELL[0]][PIPE_CELL[1]];
    if (!pipe || pipe.t !== 'pipe' || pipe.next <= 0 || !pipe.opened) continue;
    const delta = A.PIPE_DIRS[PIPE_DIR] || [-1, 0];
    const exit = state.cells[PIPE_CELL[0] + delta[0]][PIPE_CELL[1] + delta[1]];
    const expected = PIPE_QUEUE[0];
    if (exit && exit.t === 'box' &&
        exit.color === expected.id && exit.count === expected.count) {
      return {
        released: true,
        step: state.steps,
        exit: {
          r: PIPE_CELL[0] + delta[0],
          c: PIPE_CELL[1] + delta[1],
          color: exit.color,
          count: exit.count
        }
      };
    }
  }
  return { released: false };
}

function capacityStats(game) {
  const byColor = {};
  let cars = 0;
  for (const row of game.spools) {
    for (const spool of row) {
      if (spool.id > 0) {
        cars++;
        byColor[spool.id] = (byColor[spool.id] || 0) + spool.count;
        continue;
      }
      const types = Array.isArray(spool.type) ? spool.type : [spool.type];
      if (types.some(type => type >= 11 && type <= 14)) {
        const queue = Array.isArray(spool.param) ? spool.param : [];
        for (const item of queue) {
          if (!item || !(item.id > 0)) continue;
          cars++;
          byColor[item.id] = (byColor[item.id] || 0) + item.count;
        }
      }
    }
  }
  return { cars, byColor };
}

function targetColorTotals(game) {
  const out = {};
  for (const row of game.blocks) {
    for (const color of row) {
      if (color > 0) out[color] = (out[color] || 0) + 1;
    }
  }
  return out;
}

function analyze(A, game, opts) {
  const level = A.parseLevel(A.fromGameFormat(game));
  const opening = openingStats(A, level);
  const safe = traceRole(A, level, ROLE_PATHS.safe);
  const light = traceRole(A, level, ROLE_PATHS.lightDebt);
  const heavy = traceRole(A, level, ROLE_PATHS.heavyDebt);
  const rolePass = !!safe && !!light && !!heavy &&
    safe.state.buffer.length === 0 &&
    light.evidence[1].buffer.some(item =>
      item.color === 17 && item.remaining === 10) &&
    light.state.buffer.length === 0 &&
    heavy.evidence[1].buffer.some(item =>
      item.color === 34 && item.remaining === 19) &&
    heavy.state.buffer.length === 0;
  const solve = A.Solver.solveInstantChain(level, {
    timeBudgetMs: opts && opts.solveBudgetMs || 3000
  });
  const players = [];
  for (const seed of [7, 1009, 2027]) {
    const run = A.PlayerSim.run(level, {
      seed,
      instantChain: true,
      reviveCap: 0
    });
    const windows = pressureWindows(run.bufferTimeline || [], 3);
    players.push({
      seed,
      won: run.won,
      progress: run.progress,
      revivesUsed: run.revivesUsed,
      peak: run.bufferPeak,
      bufferTimeline: run.bufferTimeline,
      windows,
      chain: chainEvent(A, level, run),
      pipe: pipeEvent(A, level, run),
      run
    });
  }

  const totals = capacityStats(game);
  const targetTotals = targetColorTotals(game);
  let perColorConserved = true;
  for (const color of Object.keys(targetTotals)) {
    if ((totals.byColor[color] || 0) !== targetTotals[color]) {
      perColorConserved = false;
    }
  }
  const capacities = [];
  for (const row of game.spools) {
    for (const spool of row) {
      if (spool.id > 0) {
        capacities.push(spool.count);
        continue;
      }
      const types = Array.isArray(spool.type) ? spool.type : [spool.type];
      if (types.some(type => type >= 11 && type <= 14)) {
        for (const item of (Array.isArray(spool.param) ? spool.param : [])) {
          if (item && item.id > 0) capacities.push(item.count);
        }
      }
    }
  }
  const capacityPass = totals.cars === 47 && perColorConserved &&
    capacities.every(value => value >= 20 && value <= 40);
  const openingPass = opening.length >= 3 &&
    opening.every(move => move.consumed > 0);
  const playersPass = players.every(player =>
    player.won && player.progress === 100 && player.revivesUsed === 0);
  const pressurePass = players.every(player =>
    player.windows.length >= 2 && player.peak >= 4);
  const chainPass = players.every(player =>
    player.chain.entered && player.chain.completed &&
    player.chain.debt && player.chain.released);
  const pipePass = players.every(player => player.pipe.released);

  const failures = [];
  if (!capacityPass) failures.push('capacity-contract');
  if (!openingPass) failures.push('opening-not-live');
  if (!rolePass) failures.push('role-graph');
  if (!solve.completed || solve.progress !== 100) failures.push('unsolvable');
  if (!playersPass) failures.push('player-failure');
  if (!pressurePass) failures.push('pressure-window');
  if (!chainPass) failures.push('chain-debt');
  if (!pipePass) failures.push('pipe-queue');

  const score =
    (capacityPass ? 1e10 : 0) +
    (openingPass ? 1e9 : 0) +
    (rolePass ? 1e9 : 0) +
    (solve.completed ? 1e8 : 0) +
    players.filter(player => player.won).length * 1e7 +
    players.reduce((sum, player) => sum + player.windows.length, 0) * 1e5 +
    players.reduce((sum, player) => sum + player.peak, 0) * 1e3 +
    (chainPass ? 1e6 : 0) +
    (pipePass ? 1e6 : 0);

  return {
    game,
    level,
    opening,
    rolePass,
    solve,
    players,
    capacityPass,
    openingPass,
    playersPass,
    pressurePass,
    chainPass,
    pipePass,
    failures,
    score
  };
}

function compactAnalysis(result) {
  return {
    score: result.score,
    failures: result.failures,
    capacityPass: result.capacityPass,
    openingPass: result.openingPass,
    rolePass: result.rolePass,
    pipePass: result.pipePass,
    solve: {
      completed: result.solve.completed,
      progress: result.solve.progress,
      peak: result.solve.maxBuffer
    },
    players: result.players.map(player => ({
      seed: player.seed,
      won: player.won,
      progress: player.progress,
      peak: player.peak,
      windows: player.windows,
      chain: player.chain,
      pipe: player.pipe
    }))
  };
}

function restoreObstacles(A, game, golden) {
  const candidate = clone(game);
  for (const row of candidate.spools) {
    for (const spool of row) {
      if (spool.id > 0) {
        const types = Array.isArray(spool.type) ? spool.type : (spool.type ? [spool.type] : []);
        const params = Array.isArray(spool.param) ? spool.param : (types.length ? [spool.param] : []);
        const keptTypes = [];
        const keptParams = [];
        for (let i = 0; i < types.length; i++) {
          if (types[i] !== 5) {
            keptTypes.push(types[i]);
            keptParams.push(params[i]);
          }
        }
        spool.type = keptTypes.length === 0 ? 0 : (keptTypes.length === 1 ? keptTypes[0] : keptTypes);
        spool.param = keptParams.length === 0 ? 0 : (keptParams.length === 1 ? keptParams[0] : keptParams);
      }
    }
  }
  for (const [r, c] of BLACK_CELLS) {
    if (candidate.spools[r][c].id !== -1) {
      candidate.spools[r][c] = clone(golden.spools[r][c]);
    }
  }
  for (const [r, c] of CHAIN_CELLS) {
    const current = candidate.spools[r][c];
    const expected = golden.spools[r][c];
    if (current.id === expected.id && current.count === expected.count) {
      current.type = 5;
      current.param = CHAIN_GROUP;
    }
  }
  candidate.spools[PIPE_CELL[0]][PIPE_CELL[1]] =
    clone(golden.spools[PIPE_CELL[0]][PIPE_CELL[1]]);
  return {
    game: candidate,
    action: 'restore-semantic-obstacles'
  };
}

function restoreKeyCars(game, golden) {
  const candidates = [];
  for (const [r, c] of KEY_CARS) {
    const expected = golden.spools[r][c];
    const current = game.spools[r][c];
    // A same-color key car with a different count is a capacity problem.
    // Swapping it with another copy would hide that fault instead of repairing it.
    if (current.id === expected.id) continue;
    for (let sr = 0; sr < game.maprow; sr++) {
      for (let sc = 0; sc < game.mapcol; sc++) {
        const source = game.spools[sr][sc];
        if (source.id !== expected.id || source.count !== expected.count) continue;
        const candidate = clone(game);
        const temp = candidate.spools[r][c];
        candidate.spools[r][c] = candidate.spools[sr][sc];
        candidate.spools[sr][sc] = temp;
        candidates.push({
          game: candidate,
          action: 'restore-key-car:' + r + ',' + c + '<->' + sr + ',' + sc
        });
      }
    }
  }
  return candidates;
}

function capacityCandidates(game, maxCandidates) {
  const groups = {};
  for (let r = 0; r < game.maprow; r++) {
    for (let c = 0; c < game.mapcol; c++) {
      const spool = game.spools[r][c];
      if (spool.id <= 0) continue;
      if (!groups[spool.id]) groups[spool.id] = [];
      groups[spool.id].push({ r, c });
    }
  }
  const candidates = [];
  for (const color of Object.keys(groups)) {
    const cells = groups[color];
    for (let i = 0; i < cells.length; i++) {
      for (let j = i + 1; j < cells.length; j++) {
        const a = cells[i];
        const b = cells[j];
        for (const delta of [1, -1]) {
          const sa = game.spools[a.r][a.c];
          const sb = game.spools[b.r][b.c];
          if (sa.count + delta < 20 || sa.count + delta > 40) continue;
          if (sb.count - delta < 20 || sb.count - delta > 40) continue;
          const candidate = clone(game);
          candidate.spools[a.r][a.c].count += delta;
          candidate.spools[b.r][b.c].count -= delta;
          candidates.push({
            game: candidate,
            action: 'reslice-color-' + color + ':' +
              (a.r + ',' + a.c) + delta + '/' +
              (b.r + ',' + b.c) + (-delta)
          });
          if (candidates.length >= maxCandidates) return candidates;
        }
      }
    }
  }
  return candidates;
}

function bestCandidate(A, candidates, baseline, opts) {
  let best = baseline;
  const tested = [];
  for (const candidate of candidates) {
    const result = analyze(A, candidate.game, opts);
    tested.push({
      action: candidate.action,
      score: result.score,
      failures: result.failures
    });
    if (result.score > best.score) {
      best = Object.assign({}, result, { repairAction: candidate.action });
    }
  }
  tested.sort((a, b) => b.score - a.score);
  return { best, tested: tested.slice(0, 20) };
}

function repair(A, game, golden, opts) {
  const maxLayers = opts && opts.maxLayers || 3;
  const maxCapacity = opts && opts.maxCapacity || 160;
  const trace = [];
  let current = analyze(A, game, opts);
  trace.push({ layer: 'baseline', result: compactAnalysis(current) });

  for (let layer = 1; layer <= maxLayers && current.failures.length; layer++) {
    let candidates;
    let layerName;
    if (layer === 1) {
      layerName = 'obstacles';
      candidates = [restoreObstacles(A, current.game, golden)];
    } else if (layer === 2) {
      layerName = 'key-cars';
      candidates = restoreKeyCars(current.game, golden);
    } else {
      layerName = 'capacity';
      candidates = capacityCandidates(current.game, maxCapacity);
    }
    if (!candidates.length) {
      trace.push({ layer: layerName, attempted: 0, accepted: false });
      continue;
    }
    const picked = bestCandidate(A, candidates, current, opts);
    const accepted = picked.best.score > current.score;
    trace.push({
      layer: layerName,
      attempted: candidates.length,
      accepted,
      action: accepted ? picked.best.repairAction : null,
      bestScore: picked.best.score,
      top: picked.tested
    });
    if (accepted) current = picked.best;
  }
  return {
    schema: '006-bounded-repair-v1',
    status: current.failures.length === 0 ? 'REPAIRED' : 'STILL_FAILING',
    repairOrder: ['obstacles', 'key-cars', 'capacity'],
    layersUsed: trace.filter(item => item.accepted).length,
    trace,
    result: compactAnalysis(current),
    game: current.game
  };
}

function inject(game, type) {
  const broken = clone(game);
  if (type === 'chain-removed') {
    for (const [r, c] of CHAIN_CELLS) {
      broken.spools[r][c].type = 0;
      broken.spools[r][c].param = 0;
    }
    return broken;
  }
  if (type === 'key-swap') {
    const temp = broken.spools[0][0];
    broken.spools[0][0] = broken.spools[6][5];
    broken.spools[6][5] = temp;
    return broken;
  }
  if (type === 'pipe-removed') {
    broken.spools[PIPE_CELL[0]][PIPE_CELL[1]] = {
      id: 13,
      type: 0,
      param: 0,
      count: 28
    };
    return broken;
  }
  if (type === 'capacity-shift') {
    broken.spools[2][6].count -= 1;
    broken.spools[4][5].count += 1;
    return broken;
  }
  throw new Error('未知注入类型: ' + type);
}

function parseArgs(argv) {
  const out = {
    inject: 'chain-removed',
    maxLayers: 3,
    maxCapacity: 160,
    solveBudgetMs: 3000
  };
  for (const arg of argv.slice(2)) {
    const match = /^--([^=]+)=(.+)$/.exec(arg);
    if (!match) continue;
    out[match[1]] = match[1] === 'inject'
      ? match[2] : Number(match[2]);
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  const A = loadSolver();
  const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
  const broken = inject(golden, args.inject);
  const repaired = repair(A, broken, golden, args);
  repaired.injection = args.inject;
  repaired.golden = GOLDEN;

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(
    path.join(OUT, 'repair-' + args.inject + '.json'),
    JSON.stringify(repaired, null, 2) + '\n'
  );
  if (repaired.game) {
    fs.writeFileSync(
      path.join(OUT, 'repaired-' + args.inject + '.json'),
      JSON.stringify(repaired.game, null, 2) + '\n'
    );
  }

  console.log(JSON.stringify({
    ok: repaired.status === 'REPAIRED',
    injection: args.inject,
    status: repaired.status,
    layersUsed: repaired.layersUsed,
    trace: repaired.trace.map(item => ({
      layer: item.layer,
      attempted: item.attempted,
      accepted: item.accepted,
      action: item.action || null,
      failures: item.result ? item.result.failures : undefined
    })),
    result: repaired.result
  }, null, 2));
}

try {
  main();
} catch (err) {
  console.error(err && err.stack || err);
  process.exit(1);
}
