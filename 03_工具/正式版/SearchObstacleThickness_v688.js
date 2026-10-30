#!/usr/bin/env node
'use strict';

/**
 * E6.8 search helper: enumerate one additional adjacent chain group on v17.
 *
 * This is a deterministic screening pass, not a random seed search. For every
 * adjacent car pair, the same 006 target, vehicle multiset, role graph and
 * PlayerSim seeds are used. The output narrows the manual ice-gate search.
 */

const fs = require('fs');
const path = require('path');
const B = require('./Build006Thickness_v688');

const ROOT = path.resolve(__dirname, '..', '..');
const SOURCE = path.join(ROOT, '实验关/关卡6/原型_v17/关卡_实验_006_v17.json');
const ATLAS = path.join(ROOT, '实验关/关卡6/分析_v632/target-atlas.json');
const OUT = path.join(ROOT, '实验关/关卡6/搜索_v18_thickness');
const REPORT = path.join(OUT, 'chain-search-v1.json');

function applyPair(game, cells) {
  const out = B.clone(game);
  for (const [r, c] of cells) {
    out.spools[r][c].type = 5;
    out.spools[r][c].param = 2;
  }
  return out;
}

function adjacentPairs(game) {
  const protectedCells = new Set();
  for (const spec of B.CHAIN_GROUPS.filter(group => group.id === 1)) {
    for (const [r, c] of spec.cells) protectedCells.add(r + ',' + c);
  }
  for (const [r, c] of B.BLACK_CELLS) protectedCells.add(r + ',' + c);
  protectedCells.add(B.PIPE_CELL[0] + ',' + B.PIPE_CELL[1]);
  const pairs = [];
  for (let r = 0; r < game.maprow; r++) {
    for (let c = 0; c < game.mapcol; c++) {
      const first = game.spools[r][c];
      if (!first || first.id <= 0 || protectedCells.has(r + ',' + c)) continue;
      for (const [dr, dc] of [[0, 1], [1, 0]]) {
        const rr = r + dr;
        const cc = c + dc;
        if (rr >= game.maprow || cc >= game.mapcol) continue;
        const second = game.spools[rr][cc];
        if (!second || second.id <= 0 || protectedCells.has(rr + ',' + cc)) continue;
        pairs.push([[r, c], [rr, cc]]);
      }
    }
  }
  return pairs;
}

function measure(A, game, atlasLookup, cells) {
  B.CHAIN_GROUPS.find(group => group.id === 2).cells = cells;
  const level = A.parseLevel(A.fromGameFormat(game));
  const roles = B.roleEvidence(A, level);
  const solve = A.Solver.solveInstantChain(level, { timeBudgetMs: 10000 });
  const players = [];
  let observed = false;
  for (const seed of [7, 1009, 2027]) {
    const run = A.PlayerSim.run(level, {
      seed,
      instantChain: true,
      reviveCap: 0
    });
    const picks = B.uniquePicks(run);
    const plan = B.tracePlan(A, level, run, atlasLookup);
    const events = B.obstacleEvents(A, level, picks);
    const group = events.chains[2];
    if (group.entered && group.completedMember &&
        group.debtMember && group.released) observed = true;
    players.push({
      won: run.won,
      progress: run.progress,
      peak: run.bufferPeak,
      revivesUsed: run.revivesUsed,
      windows: plan.windows,
      group2: {
        entered: group.entered,
        completedMember: group.completedMember,
        debtMember: group.debtMember,
        released: group.released,
        entryStep: group.entry && group.entry.step,
        releaseStep: group.release && group.release.step
      }
    });
  }
  const uniform = [];
  const reasonable = [];
  for (let i = 0; i < 80; i++) {
    uniform.push(B.randomWalk(A, level, {
      seed: 610001 + i,
      policy: 'uniform'
    }));
    reasonable.push(B.randomWalk(A, level, {
      seed: 620001 + i,
      policy: 'reasonable'
    }));
  }
  return {
    cells,
    cars: cells.map(([r, c]) => ({
      r,
      c,
      color: game.spools[r][c].id,
      count: game.spools[r][c].count
    })),
    rolesPass: roles.ok,
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
    peakDistribution: players.reduce((out, player) => {
      out[player.peak] = (out[player.peak] || 0) + 1;
      return out;
    }, {}),
    group2Observed: observed,
    uniformBuffer5: uniform.filter(run => run.reachedBuffer5).length,
    reasonableBuffer5: reasonable.filter(run => run.reachedBuffer5).length
  };
}

function main() {
  const A = B.loadSolver();
  const base = B.readJson(SOURCE);
  const atlasLookup = require('./Build006Thickness_v688').readJson(ATLAS);
  const lookup = {
    byCell: {},
    byId: {}
  };
  for (const region of atlasLookup.target.regions || []) {
    lookup.byId[region.id] = region;
    for (const cell of region.cells || []) {
      lookup.byCell[cell[0] + ',' + cell[1]] = region.id;
    }
  }
  const pairs = adjacentPairs(base);
  const records = [];
  for (let i = 0; i < pairs.length; i++) {
    const game = applyPair(base, pairs[i]);
    let record;
    try {
      record = measure(A, game, lookup, pairs[i]);
    } catch (err) {
      record = {
        cells: pairs[i],
        error: String(err && err.stack || err)
      };
    }
    const rank =
      (record.rolesPass ? 1e9 : 0) +
      (record.solve && record.solve.completed ? 1e8 : 0) +
      (record.allPlayersPass ? 1e7 : 0) +
      (record.everySeedTwoWindows ? 1e6 : 0) +
      (record.group2Observed ? 1e5 : 0) +
      (record.players || []).filter(player => player.peak >= 4).length * 1e4 -
      (record.uniformBuffer5 || 80) * 10 -
      (record.reasonableBuffer5 || 80);
    records.push({ rank, ...record });
    console.log(i + '/' + pairs.length + ' ' +
      pairs[i].map(cell => cell.join(',')).join('+') +
      ' rank=' + rank);
  }
  records.sort((a, b) => b.rank - a.rank);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(REPORT, JSON.stringify({
    schema: '006-thickness-chain-search-v1',
    source: SOURCE,
    pairCount: pairs.length,
    top: records.slice(0, 30),
    all: records
  }, null, 2) + '\n');
  console.log(JSON.stringify({
    ok: true,
    output: REPORT,
    top: records.slice(0, 12).map(record => ({
      rank: record.rank,
      cells: record.cells,
      cars: record.cars,
      rolesPass: record.rolesPass,
      solvePeak: record.solve && record.solve.peak,
      players: record.players && record.players.map(player => ({
        won: player.won,
        peak: player.peak,
        windows: player.windows.map(window => [
          window.startStep,
          window.endStep,
          window.peak
        ])
      })),
      group2Observed: record.group2Observed,
      uniformBuffer5: record.uniformBuffer5,
      reasonableBuffer5: record.reasonableBuffer5
    }))
  }, null, 2));
}

try {
  main();
} catch (err) {
  console.error(err && err.stack || err);
  process.exit(1);
}
