#!/usr/bin/env node
'use strict';

/**
 * E6.8 deterministic ice-gate search.
 *
 * Candidate cells are restricted to mid-board branch cars. Initial entries,
 * role-path cells, black cells, pipe cells and both chain groups are excluded.
 * The score rewards story preservation first and lower random-choice debt
 * second; this is not a seed search over generated boards.
 */

const fs = require('fs');
const path = require('path');
const B = require('./Build006Thickness_v688');

const ROOT = path.resolve(__dirname, '..', '..');
const SOURCE = path.join(ROOT, '实验关/关卡6/原型_v17/关卡_实验_006_v17.json');
const ATLAS = path.join(ROOT, '实验关/关卡6/分析_v632/target-atlas.json');
const OUT = path.join(ROOT, '实验关/关卡6/搜索_v18_thickness');
const SEARCH_TAG = process.env.SEARCH_TAG || 'ice-search-v1';
const REPORT = path.join(OUT, SEARCH_TAG + '.json');

const SECOND_CHAIN = process.env.SECOND_CHAIN ?
  JSON.parse(process.env.SECOND_CHAIN) :
  [[3, 6], [4, 6]];
const ROLE_CELLS = new Set([
  '0,0', '0,3', '0,6', '1,0', '1,3', '1,6', '2,0', '2,6'
]);
const EXCLUDED = new Set([
  ...ROLE_CELLS,
  ...B.BLACK_CELLS.map(cell => cell.join(',')),
  ...B.CHAIN_GROUPS[0].cells.map(cell => cell.join(',')),
  ...SECOND_CHAIN.map(cell => cell.join(',')),
  B.PIPE_CELL.join(',')
]);
const CANDIDATE_CELLS = [
  [1, 1], [1, 2], [1, 4], [1, 5],
  [2, 1], [2, 2], [2, 3], [2, 4], [2, 5],
  [3, 0], [3, 1], [3, 2], [3, 3], [3, 4], [3, 5],
  [4, 0], [4, 1], [4, 2], [4, 3], [4, 4], [4, 5],
  [5, 0], [5, 4], [5, 5], [5, 6],
  [6, 0], [6, 1], [6, 2], [6, 3], [6, 4], [6, 5]
].filter(cell => !EXCLUDED.has(cell.join(',')));

function rng(seed) {
  let value = seed >>> 0;
  return function next() {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
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

function applyCandidate(base, cells, durations) {
  const game = B.clone(base);
  for (const [r, c] of SECOND_CHAIN) {
    game.spools[r][c].type = 5;
    game.spools[r][c].param = 2;
  }
  for (let i = 0; i < cells.length; i++) {
    const [r, c] = cells[i];
    game.spools[r][c].type = 7;
    game.spools[r][c].param = durations[i];
  }
  return game;
}

function lookupAtlas() {
  const atlas = B.readJson(ATLAS);
  const lookup = { byCell: {}, byId: {} };
  for (const region of atlas.target.regions || []) {
    lookup.byId[region.id] = region;
    for (const cell of region.cells || []) {
      lookup.byCell[cell[0] + ',' + cell[1]] = region.id;
    }
  }
  return lookup;
}

function randomSample(A, level, count) {
  const uniform = [];
  const reasonable = [];
  for (let i = 0; i < count; i++) {
    uniform.push(B.randomWalk(A, level, {
      seed: 710001 + i,
      policy: 'uniform'
    }));
    reasonable.push(B.randomWalk(A, level, {
      seed: 720001 + i,
      policy: 'reasonable'
    }));
  }
  return {
    uniform: uniform.filter(run => run.reachedBuffer5).length,
    reasonable: reasonable.filter(run => run.reachedBuffer5).length,
    uniformWon: uniform.filter(run => run.won).length,
    reasonableWon: reasonable.filter(run => run.won).length,
    uniformPeakDistribution: uniform.reduce((out, run) => {
      out[run.peak] = (out[run.peak] || 0) + 1;
      return out;
    }, {})
  };
}

function evaluate(A, base, lookup, cells, durations) {
  B.CHAIN_GROUPS.find(group => group.id === 2).cells = SECOND_CHAIN;
  const game = applyCandidate(base, cells, durations);
  const level = A.parseLevel(A.fromGameFormat(game));
  const role = B.roleEvidence(A, level);
  if (!role.ok) return { rolePass: false };
  let st = A.Simulator.createState(level, {
    useSlotStart: true,
    instantChain: true
  });
  st.capture = true;
  const opening = B.optionsAt(A, st, true);
  const solve = A.Solver.solveInstantChain(level, { timeBudgetMs: 10000 });
  const players = [];
  let groupsObserved = false;
  for (const seed of [7, 1009, 2027]) {
    const run = A.PlayerSim.run(level, {
      seed,
      instantChain: true,
      reviveCap: 0
    });
    const picks = B.uniquePicks(run);
    const plan = B.tracePlan(A, level, run, lookup);
    const events = B.obstacleEvents(A, level, picks);
    const group1 = events.chains[1];
    const group2 = events.chains[2];
    if (group1.entered && group1.entryConsumedMember && group1.released &&
        group2.entered && group2.entryConsumedMember && group2.released) {
      groupsObserved = true;
    }
    players.push({
      won: run.won,
      progress: run.progress,
      peak: run.bufferPeak,
      revivesUsed: run.revivesUsed,
      windows: plan.windows,
      picks
    });
  }
  const current = randomSample(A, level, 100);
  const noIce = applyCandidate(base, [], []);
  const noIceLevel = A.parseLevel(A.fromGameFormat(noIce));
  const without = randomSample(A, noIceLevel, 100);
  return {
    rolePass: true,
    cells,
    durations,
    cars: cells.map(([r, c]) => ({
      r,
      c,
      color: base.spools[r][c].id,
      count: base.spools[r][c].count
    })),
    openingPass: opening.length === 7 &&
      opening.every(move => move.applied && move.canConsume && move.consumed > 0),
    solve: {
      completed: solve.completed,
      progress: solve.progress,
      peak: solve.maxBuffer,
      windows: B.pressureWindows(solve.stepBufferHistory || [], 3)
    },
    players,
    allPlayersPass: players.every(player =>
      player.won && player.progress === 100 && player.revivesUsed === 0),
    everySeedTwoWindows: players.every(player => player.windows.length >= 2),
    peak4Seeds: players.filter(player => player.peak >= 4).length,
    groupsObserved,
    current,
    without,
    iceChangesRandom:
      current.uniform !== without.uniform ||
      current.reasonable !== without.reasonable ||
      current.uniformWon !== without.uniformWon,
    iceChangesPlayers:
      JSON.stringify(players.map(player => player.windows)) !==
      JSON.stringify([])
  };
}

function main() {
  const A = B.loadSolver();
  const base = B.readJson(SOURCE);
  const lookup = lookupAtlas();
  const random = rng(6882);
  const records = [];
  const seen = new Set();
  const attempted = Number(process.env.SEARCH_COUNT || 320);
  for (let i = 0; i < attempted; i++) {
    const count = 4 + Math.floor(random() * 5);
    const cells = shuffle(CANDIDATE_CELLS, random).slice(0, count);
    const durations = cells.map(() =>
      [5, 6, 7, 8, 9, 10, 11, 12][Math.floor(random() * 8)]);
    const key = cells.map(cell => cell.join(',')).sort().join('|');
    if (seen.has(key)) {
      i--;
      continue;
    }
    seen.add(key);
    let record;
    try {
      record = evaluate(A, base, lookup, cells, durations);
    } catch (err) {
      record = { rolePass: false, error: String(err && err.stack || err), cells };
    }
    const score =
      (record.rolePass ? 1e12 : 0) +
      (record.openingPass ? 1e11 : 0) +
      (record.solve && record.solve.completed ? 1e10 : 0) +
      (record.allPlayersPass ? 1e9 : 0) +
      (record.everySeedTwoWindows ? 1e8 : 0) +
      (record.peak4Seeds || 0) * 1e7 +
      (record.groupsObserved ? 1e6 : 0) +
      (record.iceChangesRandom ? 1e5 : 0) +
      (record.iceChangesPlayers ? 1e4 : 0) -
      (record.current ? record.current.uniform * 100 : 1e8) -
      (record.current ? record.current.reasonable * 10 : 1e7);
    records.push({ score, ...record });
    if ((i + 1) % 10 === 0 || i === attempted - 1) {
      records.sort((a, b) => b.score - a.score);
      console.log((i + 1) + '/' + attempted + ' best=' + records[0].score +
        ' cells=' + records[0].cells.map(cell => cell.join(',')).join('+'));
    }
  }
  records.sort((a, b) => b.score - a.score);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(REPORT, JSON.stringify({
    schema: '006-ice-search-v1',
    source: SOURCE,
    secondChain: SECOND_CHAIN,
    attempted,
    candidateCellCount: CANDIDATE_CELLS.length,
    top: records.slice(0, 40),
    all: records
  }, null, 2) + '\n');
  console.log(JSON.stringify({
    ok: true,
    output: REPORT,
    top: records.slice(0, 12).map(record => ({
      score: record.score,
      cells: record.cells,
      durations: record.durations,
      cars: record.cars,
      openingPass: record.openingPass,
      solvePeak: record.solve && record.solve.peak,
      allPlayersPass: record.allPlayersPass,
      everySeedTwoWindows: record.everySeedTwoWindows,
      peak4Seeds: record.peak4Seeds,
      groupsObserved: record.groupsObserved,
      iceChangesRandom: record.iceChangesRandom,
      current: record.current,
      without: record.without
    }))
  }, null, 2));
}

try {
  main();
} catch (err) {
  console.error(err && err.stack || err);
  process.exit(1);
}
