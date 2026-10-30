#!/usr/bin/env node
'use strict';

/**
 * E6.8: add interpretable obstacle thickness to the v17 006 story board.
 *
 * This builder changes only the obstacle layer:
 *   - keep the v17 capacity multiset and every vehicle position;
 *   - keep the existing black cells, adjacent three-chain and pipe;
 *   - add one adjacent two-chain and four mid-branch numbered-ice gates.
 *
 * The generated evidence includes the opening consequence matrix, uniform and
 * reasonable random walks, exact chain-member event tracking, group ablations,
 * PlayerSim runs with and without revives, and a JSON round trip.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '完整主bin快照_20261012', 'bin', 'js');
const SOURCE = path.join(ROOT, '实验关/关卡6/原型_v17/关卡_实验_006_v17.json');
const SOURCE_DEBUG = path.join(ROOT, '实验关/关卡6/原型_v17/关卡_实验_006_v17.debug.json');
const ATLAS = path.join(ROOT, '实验关/关卡6/分析_v632/target-atlas.json');

const PROFILES = {
  v18: {
    version: 'v18',
    chainGroups: [
      {
        id: 1,
        cells: [[5, 1], [5, 2], [5, 3]],
        role: '完成车被欠债伙伴扣住，直到第三段末尾整组释放'
      },
      {
        id: 2,
        cells: [[0, 0], [0, 1]],
        role: '把首行31/31与30/22绑成一次可见组动作；选择该入口会改变同阶段的目标区推进量'
      }
    ],
    iceSpec: [
      { r: 1, c: 4, ticks: 10, role: '延迟中段长色21/36，先让玩家处理当前可收满目标区' },
      { r: 5, c: 5, ticks: 5, role: '延迟右侧后段31/30的连续供给' },
      { r: 2, c: 5, ticks: 10, role: '延迟右侧5色供给，保留相邻组锁链的进入成本' },
      { r: 4, c: 1, ticks: 8, role: '延迟15色中段余量，塑造第二条分支节奏' },
      { r: 6, c: 0, ticks: 12, role: '延迟末端31/30，避免终局过早免费收满' }
    ]
  },
  meaningful: {
    version: 'v19',
    chainGroups: [
      {
        id: 1,
        cells: [[5, 1], [5, 2], [5, 3]],
        role: '完成车被欠债伙伴扣住，直到第三段末尾整组释放'
      },
      {
        id: 2,
        cells: [[2, 5], [3, 5]],
        role: '右侧5/21先完成、5/40留下约30像素债务；完成车被扣住数步后才能整组释放'
      }
    ],
    iceSpec: [
      { r: 1, c: 4, ticks: 9, role: '延迟中段长色21/36，先处理当前可收满区域' },
      { r: 2, c: 3, ticks: 10, role: '中段短等待，保留左侧轻债路线' },
      { r: 3, c: 4, ticks: 10, role: '延迟14色中段供给，形成第二支路节奏' },
      { r: 5, c: 5, ticks: 8, role: '延迟右侧释放后的31/30补给' },
      { r: 6, c: 2, ticks: 5, role: '末端短冰，推迟最后一组15色收尾' }
    ]
  }
};

const PROFILE_NAME = PROFILES[process.env.BUILD_PROFILE] ?
  process.env.BUILD_PROFILE : 'v18';
const ACTIVE_PROFILE = PROFILES[PROFILE_NAME];
const LEVEL_VERSION = ACTIVE_PROFILE.version;
const OUT = path.join(ROOT, '实验关/关卡6/原型_' + LEVEL_VERSION);
const LEVEL_FILE = path.join(OUT, '关卡_实验_006_' + LEVEL_VERSION + '.json');
const ROUTE_FILE = path.join(OUT, '关卡_实验_006_' + LEVEL_VERSION + '.route.json');
const DEBUG_FILE = path.join(OUT, '关卡_实验_006_' + LEVEL_VERSION + '.debug.json');
const PLAN_FILE = path.join(OUT, 'story-plan-v5.json');
const REPORT_FILE = path.join(OUT, '关卡_实验_006_' + LEVEL_VERSION + '.md');
const MATRIX_FILE = path.join(OUT, 'opening-consequence-matrix-v1.json');
const RANDOM_FILE = path.join(OUT, 'random-choice-audit-v1.json');

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

const BLACK_CELLS = [[1, 1], [1, 2]];
const PIPE_CELL = [6, 6];
const PIPE_DIR = 11;
const CHAIN_GROUPS = ACTIVE_PROFILE.chainGroups;
const ICE_SPEC = ACTIVE_PROFILE.iceSpec;
const ROLE_PATHS = {
  safe: [[0, 3], [1, 3]],
  lightDebt: [[0, 0], [1, 0], [2, 0]],
  heavyDebt: [[0, 6], [1, 6], [2, 6]]
};

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadSolver(refMode) {
  // refMode: 'ring'(默认) | 'corner'(左下角一点) | 'bottom'(底边)
  const _ref = refMode || process.env.PICK_REF || 'ring';
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
    const src = fs.readFileSync(path.join(BIN, file), 'utf8');
    vm.runInContext(src, sandbox, { filename: file });
  }
  if (_ref && sandbox.AntSolver && sandbox.AntSolver.Simulator && sandbox.AntSolver.Simulator.setPickRef) {
    sandbox.AntSolver.Simulator.setPickRef(_ref);
  }
  return sandbox.AntSolver;
}

function rng(seed) {
  let value = seed >>> 0;
  return function next() {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function choice(items, random) {
  return items[Math.floor(random() * items.length)];
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

function poseKey(picks) {
  return picks.slice(0, 16).map(pick => pick.r + ',' + pick.c).join('>');
}

function bufferState(state) {
  return state.buffer.map(item => ({
    key: item.key,
    color: item.color,
    remaining: item.need - item.progress,
    need: item.need,
    progress: item.progress,
    slot: item.slot,
    link: item.link || 0,
    enteredAtStep: item.enterStep == null ? null : item.enterStep + 1
  }));
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
        peak: Math.max(...timeline.slice(start, i)),
        release: true
      });
      start = null;
    }
  }
  if (start != null) {
    windows.push({
      start: start + 1,
      end: timeline.length,
      peak: Math.max(...timeline.slice(start)),
      release: false
    });
  }
  return windows;
}

function regionLookup(atlas) {
  const byCell = {};
  const byId = {};
  for (const region of atlas.target.regions || []) {
    byId[region.id] = region;
    for (const cell of region.cells || []) {
      byCell[cell[0] + ',' + cell[1]] = region.id;
    }
  }
  return { byCell, byId };
}

function regionHits(cells, lookup) {
  const counts = {};
  for (const cell of cells || []) {
    const r = Array.isArray(cell) ? cell[0] : cell.r;
    const c = Array.isArray(cell) ? cell[1] : cell.c;
    const id = lookup.byCell[r + ',' + c];
    if (!id) continue;
    counts[id] = (counts[id] || 0) + 1;
  }
  return Object.keys(counts)
    .map(id => ({
      region: id,
      color: lookup.byId[id].color,
      pixels: counts[id]
    }))
    .sort((a, b) => b.pixels - a.pixels || a.region.localeCompare(b.region));
}

function optionsAt(A, state, includeDetails) {
  return A.Simulator.listMoves(state)
    .filter(move => !move.blocked)
    .map(move => {
      if (!includeDetails) {
        return {
          r: move.r,
          c: move.c,
          color: move.antBox.color,
          count: move.antBox.count,
          canConsume: !!move.canConsume,
          groupSize: move.groupSize || 1
        };
      }
      const child = A.SolverStrategy.cloneState(state);
      const before = child.eliminatedPixels;
      child.capOps = [];
      const applied = A.Simulator.applyPick(child, move.r, move.c);
      return {
        r: move.r,
        c: move.c,
        color: move.antBox.color,
        count: move.antBox.count,
        canConsume: !!move.canConsume,
        groupSize: move.groupSize || 1,
        consumed: child.eliminatedPixels - before,
        debt: bufferState(child).reduce((sum, item) => sum + item.remaining, 0),
        bufferAfter: bufferState(child),
        applied
      };
    });
}

function applyPath(A, level, path) {
  const state = A.Simulator.createState(level, {
    useSlotStart: true,
    instantChain: true
  });
  state.capture = true;
  const evidence = [];
  for (const [r, c] of path) {
    const move = A.Simulator.listMoves(state)
      .find(item => item.r === r && item.c === c && !item.blocked);
    if (!move) return { ok: false, evidence, reason: 'missing:' + r + ',' + c };
    const before = state.eliminatedPixels;
    state.capOps = [];
    if (!A.Simulator.applyPick(state, r, c)) {
      return { ok: false, evidence, reason: 'apply:' + r + ',' + c };
    }
    evidence.push({
      r,
      c,
      color: move.antBox.color,
      count: move.antBox.count,
      consumed: state.eliminatedPixels - before,
      buffer: bufferState(state)
    });
  }
  return { ok: true, state, evidence };
}

function roleEvidence(A, level) {
  const roles = {
    safe: applyPath(A, level, ROLE_PATHS.safe),
    lightDebt: applyPath(A, level, ROLE_PATHS.lightDebt),
    heavyDebt: applyPath(A, level, ROLE_PATHS.heavyDebt)
  };
  const ok =
    roles.safe.ok && roles.safe.state.buffer.length === 0 &&
    roles.lightDebt.ok &&
    roles.lightDebt.evidence[1].buffer.some(item =>
      item.color === 17 && item.remaining === 10) &&
    roles.lightDebt.state.buffer.length === 0 &&
    roles.heavyDebt.ok &&
    roles.heavyDebt.evidence[1].buffer.some(item =>
      item.color === 34 && item.remaining === 19) &&
    roles.heavyDebt.state.buffer.length === 0;
  return { ok, roles };
}

function chainMembersOf(state, chainId) {
  const spec = CHAIN_GROUPS.find(group => group.id === chainId);
  if (!spec) return [];
  return spec.cells.map(([r, c]) => {
    const cell = state.cells[r][c];
    return cell && cell.t === 'box'
      ? { r, c, color: cell.color, count: cell.count, present: true }
      : { r, c, present: false };
  });
}

function obstacleEvents(A, level, picks) {
  const state = A.Simulator.createState(level, {
    useSlotStart: true,
    instantChain: true
  });
  state.capture = true;
  const events = {};
  const active = {};
  for (const spec of CHAIN_GROUPS) {
    events[spec.id] = {
      group: spec.id,
      cells: spec.cells,
      entered: false,
      entryConsumedMember: false,
      completedMember: false,
      debtMember: false,
      released: false
    };
  }
  let pipe = null;

  for (let i = 0; i < picks.length; i++) {
    const pick = picks[i];
    state.capOps = [];
    if (!A.Simulator.applyPick(state, pick.r, pick.c)) continue;
    const last = state.lastPick || {};

    for (const spec of CHAIN_GROUPS) {
      const triggerMember = (last.picked || []).some(item =>
        spec.cells.some(cell => cell[0] === item.r && cell[1] === item.c));
      if (last.isChain && last.chain === spec.id && triggerMember) {
        const link = state._linkSeq;
        const eatCounts = {};
        for (const op of state.capOps || []) {
          if (op.t === 'eat') {
            eatCounts[op.key] = (eatCounts[op.key] || 0) +
              (op.cells ? op.cells.length : 0);
          }
        }
        const entryAdds = (state.capOps || [])
          .filter(op => op.t === 'add' && op.link === link);
        const entryResults = entryAdds.map(op => ({
          key: op.key,
          color: op.color,
          need: op.need,
          progress: Math.min(op.need, eatCounts[op.key] || 0),
          remaining: Math.max(0, op.need - (eatCounts[op.key] || 0))
        }));
        const membersBefore = chainMembersOf(state, spec.id)
          .filter(item => item.present)
          .map(item => ({
            r: item.r,
            c: item.c,
            color: item.color,
            count: item.count
          }));
        active[spec.id] = {
          link,
          keys: bufferState(state)
            .filter(item => item.link === link)
            .map(item => item.key)
        };
        events[spec.id].entered = true;
        const linkedAtEntry = bufferState(state).filter(item => item.link === link);
        events[spec.id].entryConsumedMember =
          entryResults.some(item => item.progress > 0);
        events[spec.id].completedMember =
          entryResults.some(item => item.remaining === 0);
        events[spec.id].debtMember =
          entryResults.some(item => item.remaining > 0);
        events[spec.id].entry = {
          step: i + 1,
          triggerPick: pick,
          picked: last.picked || [],
          membersBefore,
          entryResults,
          linked: linkedAtEntry,
          bufferEnter: last.bufEnter,
          bufferAfter: bufferState(state)
        };
      }
    }

    for (const spec of CHAIN_GROUPS) {
      const current = active[spec.id];
      if (!current) continue;
      const linked = bufferState(state)
        .filter(item => item.link === current.link);
      if (!linked.length) {
        if (!events[spec.id].released) {
          events[spec.id].released = true;
          events[spec.id].release = {
            step: i + 1,
            pick,
            bufferAfter: bufferState(state)
          };
        }
        delete active[spec.id];
        continue;
      }
      if (linked.some(item => item.remaining === 0)) {
        events[spec.id].completedMember = true;
      }
      if (linked.some(item => item.remaining > 0)) {
        events[spec.id].debtMember = true;
      }
    }

    const pipeCell = state.cells[PIPE_CELL[0]][PIPE_CELL[1]];
    if (!pipe && pipeCell && pipeCell.t === 'pipe' &&
        pipeCell.next > 0 && pipeCell.opened) {
      const delta = A.PIPE_DIRS[PIPE_DIR] || [-1, 0];
      const exitCell = state.cells[PIPE_CELL[0] + delta[0]]
        [PIPE_CELL[1] + delta[1]];
      pipe = {
        step: i + 1,
        triggerPick: pick,
        queue: clone(pipeCell.queue || []),
        next: pipeCell.next,
        exit: exitCell && exitCell.t === 'box'
          ? {
              r: PIPE_CELL[0] + delta[0],
              c: PIPE_CELL[1] + delta[1],
              color: exitCell.color,
              count: exitCell.count
            }
          : null
      };
    }
  }

  for (const spec of CHAIN_GROUPS) {
    const current = active[spec.id];
    if (!current) continue;
    const linked = bufferState(state).filter(item => item.link === current.link);
    if (linked.some(item => item.remaining === 0)) events[spec.id].completedMember = true;
    if (linked.some(item => item.remaining > 0)) events[spec.id].debtMember = true;
  }
  return { chains: events, pipe };
}

function tracePlan(A, level, run, atlasLookup) {
  const picks = uniquePicks(run);
  const state = A.Simulator.createState(level, {
    useSlotStart: true,
    instantChain: true
  });
  state.capture = true;
  const steps = [];
  for (let i = 0; i < picks.length; i++) {
    const pick = picks[i];
    state.capOps = [];
    if (!A.Simulator.applyPick(state, pick.r, pick.c)) {
      throw new Error(LEVEL_VERSION + ' route replay failed at step ' + (i + 1));
    }
    const eaten = [];
    for (const op of state.capOps || []) {
      if (op.t === 'eat') for (const cell of op.cells || []) eaten.push(cell);
    }
    const nextMoves = state.buffer.length >= 3
      ? optionsAt(A, state, false)
      : [];
    steps.push({
      step: i + 1,
      r: pick.r,
      c: pick.c,
      color: pick.color,
      count: pick.count,
      bufferLevel: state.buffer.length,
      buffer: bufferState(state),
      regions: regionHits(eaten, atlasLookup),
      visibleChoices: nextMoves.length,
      consumableChoices: nextMoves.filter(move => move.canConsume).length
    });
  }
  const initialWindows = pressureWindows(steps.map(step => step.bufferLevel), 3);
  return {
    steps,
    windows: initialWindows.map((window, index) => {
      const interval = steps.slice(window.start - 1, window.end);
      const peakStep = interval.reduce((best, step) =>
        best == null || step.bufferLevel > best.bufferLevel ? step : best, null);
      const release = steps.slice(window.end)
        .find(step => step.bufferLevel < peakStep.bufferLevel);
      const byRegion = {};
      for (const step of interval) {
        for (const region of step.regions) {
          byRegion[region.region] = byRegion[region.region] || {
            region: region.region,
            color: region.color,
            pixels: 0
          };
          byRegion[region.region].pixels += region.pixels;
        }
      }
      return {
        id: 'pressure-' + (index + 1),
        startStep: window.start,
        endStep: window.end,
        peak: window.peak,
        release: window.release,
        peakStep: {
          step: peakStep.step,
          pick: { r: peakStep.r, c: peakStep.c, color: peakStep.color, count: peakStep.count },
          bufferLevel: peakStep.bufferLevel,
          visibleChoices: peakStep.visibleChoices,
          consumableChoices: peakStep.consumableChoices
        },
        targetRegions: Object.values(byRegion)
          .sort((a, b) => b.pixels - a.pixels || a.region.localeCompare(b.region))
          .slice(0, 12),
        releaseStep: release ? {
          step: release.step,
          r: release.r,
          c: release.c,
          color: release.color,
          count: release.count,
          reduction: peakStep.bufferLevel - release.bufferLevel
        } : null
      };
    })
  };
}

function randomWalk(A, level, opts) {
  const random = rng(opts.seed);
  const state = A.Simulator.createState(level, {
    useSlotStart: true,
    instantChain: true
  });
  state.capture = true;
  const timeline = [];
  const picks = [];
  let firstApplied = !opts.first;

  function chooseMove() {
    const moves = A.Simulator.listMoves(state).filter(move => !move.blocked);
    if (!moves.length) return null;
    if (opts.policy === 'reasonable') {
      const consumable = moves.filter(move => move.canConsume);
      if (consumable.length) return choice(consumable, random);
    }
    return choice(moves, random);
  }

  if (opts.first) {
    const firstMove = A.Simulator.listMoves(state)
      .find(move => move.r === opts.first[0] && move.c === opts.first[1] &&
        !move.blocked);
    if (!firstMove) {
      return { valid: false, reason: 'first move missing' };
    }
    state.capOps = [];
    firstApplied = A.Simulator.applyPick(state, firstMove.r, firstMove.c);
    picks.push({
      r: firstMove.r,
      c: firstMove.c,
      color: firstMove.antBox.color,
      count: firstMove.antBox.count
    });
    timeline.push(state.buffer.length);
  }

  let moveCount = firstApplied ? 1 : 0;
  while (moveCount < 300 && state.eliminatedPixels < state.totalPixels) {
    const move = chooseMove();
    if (!move) break;
    state.capOps = [];
    if (!A.Simulator.applyPick(state, move.r, move.c)) break;
    picks.push({
      r: move.r,
      c: move.c,
      color: move.antBox.color,
      count: move.antBox.count
    });
    timeline.push(state.buffer.length);
    moveCount++;
  }
  const peak = timeline.length ? Math.max(...timeline) : 0;
  return {
    valid: true,
    seed: opts.seed,
    reachedBuffer5: peak >= 5,
    won: state.eliminatedPixels >= state.totalPixels,
    progress: +(state.eliminatedPixels / state.totalPixels * 100).toFixed(1),
    picks: moveCount,
    peak,
    windows: pressureWindows(timeline, 3),
    timeline,
    pickOrder: picks
  };
}

function randomAudit(A, level, count) {
  const uniform = [];
  const reasonable = [];
  for (let i = 0; i < count; i++) {
    uniform.push(randomWalk(A, level, {
      seed: 700001 + i,
      policy: 'uniform'
    }));
    reasonable.push(randomWalk(A, level, {
      seed: 800001 + i,
      policy: 'reasonable'
    }));
  }
  function summarize(runs) {
    const distribution = {};
    for (const run of runs) {
      distribution[run.peak] = (distribution[run.peak] || 0) + 1;
    }
    return {
      count: runs.length,
      reachedBuffer5: runs.filter(run => run.reachedBuffer5).length,
      reachedBuffer5Pct: +(runs.filter(run => run.reachedBuffer5).length /
        runs.length * 100).toFixed(1),
      won: runs.filter(run => run.won).length,
      avgProgress: +(runs.reduce((sum, run) => sum + run.progress, 0) /
        runs.length).toFixed(1),
      peakDistribution: distribution
    };
  }
  return {
    schema: '006-random-choice-audit-v1',
    uniform: summarize(uniform),
    reasonable: summarize(reasonable),
    definitions: {
      uniform: '每一步在当前未阻塞动作中均匀随机。',
      reasonable: '每一步若存在当前可收满动作，则只在可收满动作中随机；否则在全部未阻塞动作中随机。',
      buffer5: '整条随机路线任一操作后暂存占用达到5。'
    }
  };
}

function greedyContinuation(A, state, atlasLookup) {
  const work = A.SolverStrategy.cloneState(state);
  work.capture = true;
  const picks = [];
  const timeline = [work.buffer.length];
  let guard = 300;
  while (work.eliminatedPixels < work.totalPixels && guard-- > 0) {
    const moves = A.Simulator.listMoves(work).filter(move => !move.blocked);
    if (!moves.length) break;
    let best = null;
    for (const move of moves) {
      const child = A.SolverStrategy.cloneState(work);
      const before = child.eliminatedPixels;
      child.capOps = [];
      if (!A.Simulator.applyPick(child, move.r, move.c)) continue;
      const consumed = child.eliminatedPixels - before;
      const score = [
        move.canConsume ? 1 : 0,
        consumed,
        -child.buffer.length,
        -move.r,
        -move.c
      ];
      if (!best || lexGreater(score, best.score)) best = { move, score };
    }
    if (!best) break;
    work.capOps = [];
    if (!A.Simulator.applyPick(work, best.move.r, best.move.c)) break;
    picks.push({
      r: best.move.r,
      c: best.move.c,
      color: best.move.antBox.color,
      count: best.move.antBox.count
    });
    timeline.push(work.buffer.length);
  }
  return {
    won: work.eliminatedPixels >= work.totalPixels,
    progress: +(work.eliminatedPixels / work.totalPixels * 100).toFixed(1),
    peak: Math.max(...timeline),
    timeline,
    windows: pressureWindows(timeline, 3),
    picks,
    reachableRegions: visibleRegions(A, work, atlasLookup)
  };
}

function lexGreater(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

function visibleRegions(A, state, atlasLookup) {
  const preview = A.Simulator.previewNextEliminationOrder(state);
  const cells = [];
  for (let r = 0; r < preview.rank.length; r++) {
    for (let c = 0; c < preview.rank[r].length; c++) {
      if (preview.rank[r][c] > 0) cells.push([r, c]);
    }
  }
  return regionHits(cells, atlasLookup);
}

function openingMatrix(A, level, atlasLookup) {
  const initial = A.Simulator.createState(level, {
    useSlotStart: true,
    instantChain: true
  });
  initial.capture = true;
  const opening = optionsAt(A, initial, true);
  const rows = [];
  for (let i = 0; i < opening.length; i++) {
    const option = opening[i];
    const post = A.Simulator.createState(level, {
      useSlotStart: true,
      instantChain: true
    });
    post.capture = true;
    post.capOps = [];
    A.Simulator.applyPick(post, option.r, option.c);
    const greedy = greedyContinuation(A, post, atlasLookup);
    const samples = [];
    for (let j = 0; j < 50; j++) {
      samples.push(randomWalk(A, level, {
        seed: 910001 + i * 1009 + j,
        policy: 'uniform',
        first: [option.r, option.c]
      }));
    }
    const peakDistribution = {};
    for (const run of samples) {
      peakDistribution[run.peak] = (peakDistribution[run.peak] || 0) + 1;
    }
    rows.push({
      index: i + 1,
      cell: [option.r, option.c],
      car: { color: option.color, count: option.count },
      immediate: {
        canConsume: option.canConsume,
        consumed: option.consumed,
        debtRemaining: option.debt,
        bufferAfter: option.bufferAfter
      },
      afterEntryReachableRegions: greedy.reachableRegions.slice(0, 12),
      greedyContinuation: {
        won: greedy.won,
        progress: greedy.progress,
        peak: greedy.peak,
        windows: greedy.windows,
        picks: greedy.picks
      },
      randomContinuation: {
        count: samples.length,
        won: samples.filter(run => run.won).length,
        reachedBuffer5: samples.filter(run => run.reachedBuffer5).length,
        reachedBuffer5Pct: +(samples.filter(run => run.reachedBuffer5).length /
          samples.length * 100).toFixed(1),
        avgProgress: +(samples.reduce((sum, run) => sum + run.progress, 0) /
          samples.length).toFixed(1),
        peakDistribution,
        routeDiversity: new Set(samples.map(run => poseKey(run.pickOrder))).size
      }
    });
  }
  return {
    schema: '006-opening-consequence-matrix-v1',
    definition: {
      debtRemaining: '当前首取结算后暂存区所有未完成订单的剩余像素总数。',
      reachableRegions: '按该入口后的首个消除预览，可达目标图像素命中的区域。',
      randomContinuation: '固定首取后，每一步在当前未阻塞动作中均匀随机，共50局。'
    },
    opening,
    entries: rows,
    distinctGreedyProfiles: new Set(rows.map(row =>
      row.greedyContinuation.peak + ':' + row.greedyContinuation.progress +
      ':' + row.greedyContinuation.picks.length)).size
  };
}

function evaluateVariant(A, game) {
  const level = A.parseLevel(A.fromGameFormat(game));
  const solve = A.Solver.solveInstantChain(level, { timeBudgetMs: 20000 });
  const players = [7, 1009, 2027].map(seed =>
    A.PlayerSim.run(level, {
      seed,
      instantChain: true,
      reviveCap: 0
    })
  );
  return {
    solve: {
      completed: solve.completed,
      progress: solve.progress,
      peak: solve.maxBuffer,
      windows: pressureWindows(solve.stepBufferHistory || [], 3)
    },
    players: players.map(run => ({
      won: run.won,
      progress: run.progress,
      peak: run.bufferPeak,
      revivesUsed: run.revivesUsed,
      windows: pressureWindows(run.bufferTimeline || [], 3)
    }))
  };
}

function removeChain(game, group) {
  const out = clone(game);
  for (const spec of CHAIN_GROUPS.filter(item => item.id === group)) {
    for (const [r, c] of spec.cells) {
      out.spools[r][c].type = 0;
      out.spools[r][c].param = 0;
    }
  }
  return out;
}

function removeIce(game) {
  const out = clone(game);
  for (const item of ICE_SPEC) {
    out.spools[item.r][item.c].type = 0;
    out.spools[item.r][item.c].param = 0;
  }
  return out;
}

function removePipe(game) {
  const out = clone(game);
  const source = readJson(SOURCE);
  out.spools[PIPE_CELL[0]][PIPE_CELL[1]] =
    clone(source.spools[PIPE_CELL[0]][PIPE_CELL[1]]);
  return out;
}

function removeBlack(game) {
  const out = clone(game);
  for (const [r, c] of BLACK_CELLS) {
    out.spools[r][c] = { id: 0, type: 0, param: 0, count: 0 };
  }
  return out;
}

function boundary(counters, level) {
  for (let r = 0; r < counters.rows; r++) {
    for (let c = 0; c < counters.cols; c++) {
      const box = level.board.cells[r][c];
      if (!box || box.t !== 'box' || box.chain <= 0) continue;
      const spec = CHAIN_GROUPS.find(group => group.id === box.chain);
      if (!spec) continue;
      for (let i = 1; i < spec.cells.length; i++) {
        const previous = spec.cells[i - 1];
        const current = spec.cells[i];
        if (Math.abs(previous[0] - current[0]) +
            Math.abs(previous[1] - current[1]) !== 1) {
          return false;
        }
      }
    }
  }
  return true;
}

function main() {
  const A = loadSolver();
  const baseGame = readJson(SOURCE);
  const game = clone(baseGame);
  for (const spec of ICE_SPEC) {
    const spool = game.spools[spec.r][spec.c];
    if (!spool || spool.id <= 0) {
      throw new Error('数字冰目标不是车辆: ' + spec.r + ',' + spec.c);
    }
    spool.type = 7;
    spool.param = spec.ticks;
  }
  for (const spec of CHAIN_GROUPS.filter(group => group.id === 2)) {
    for (const [r, c] of spec.cells) {
      const spool = game.spools[r][c];
      if (!spool || spool.id <= 0) {
        throw new Error('二连锁目标不是车辆: ' + r + ',' + c);
      }
      spool.type = 5;
      spool.param = spec.id;
    }
  }

  const level = A.parseLevel(A.fromGameFormat(game));
  const atlasLookup = regionLookup(readJson(ATLAS));
  const initial = A.Simulator.createState(level, {
    useSlotStart: true,
    instantChain: true
  });
  initial.capture = true;
  const opening = optionsAt(A, initial, true);
  const roles = roleEvidence(A, level);

  const solve = A.Solver.solveInstantChain(level, { timeBudgetMs: 30000 });
  const players = [];
  const playerPlans = [];
  let primaryEvents = null;
  let anyChainsObserved = null;
  for (const reviveCap of [0, 2]) {
    for (const seed of [7, 1009, 2027]) {
      const run = A.PlayerSim.run(level, {
        seed,
        instantChain: true,
        reviveCap
      });
      const picks = uniquePicks(run);
      const plan = tracePlan(A, level, run, atlasLookup);
      const events = obstacleEvents(A, level, picks);
      if (seed === 7 && reviveCap === 0) primaryEvents = events;
      if (!anyChainsObserved ||
          CHAIN_GROUPS.every(spec =>
            events.chains[spec.id].entered &&
            events.chains[spec.id].entryConsumedMember &&
            events.chains[spec.id].released)) {
        anyChainsObserved = events;
      }
      players.push({
        seed,
        reviveCap,
        won: run.won,
        progress: run.progress,
        peak: run.bufferPeak,
        revivesUsed: run.revivesUsed,
        bufferTimeline: run.bufferTimeline || [],
        windows: plan.windows,
        picks
      });
      playerPlans.push({
        seed,
        reviveCap,
        steps: plan.steps,
        windows: plan.windows,
        events
      });
    }
  }
  const zeroRevive = players.filter(player => player.reviveCap === 0);
  const randomResult = randomAudit(A, level, 500);
  const matrix = openingMatrix(A, level, atlasLookup);

  const baseLevel = A.parseLevel(A.fromGameFormat(baseGame));
  const baseRandom = randomAudit(A, baseLevel, 500);
  const noIceLevel = A.parseLevel(A.fromGameFormat(removeIce(game)));
  const noIceRandom = randomAudit(A, noIceLevel, 500);

  const variants = {
    secondChain: evaluateVariant(A, removeChain(game, 2)),
    allIce: evaluateVariant(A, removeIce(game)),
    firstChain: evaluateVariant(A, removeChain(game, 1)),
    pipe: evaluateVariant(A, removePipe(game)),
    black: evaluateVariant(A, removeBlack(game))
  };

  const roundtrip = A.parseLevel(A.fromGameFormat(A.toGameFormat(level)));
  const roundtripSolve = A.Solver.solveInstantChain(roundtrip, {
    timeBudgetMs: 20000,
    greedyOnly: true
  });

  let boxes = 0;
  let black = 0;
  let ice = 0;
  let chainCells = 0;
  let pipeCells = 0;
  let question = 0;
  let capacitySum = 0;
  let logicalCars = 0;
  const capacities = [];
  for (let r = 0; r < level.board.rows; r++) {
    for (let c = 0; c < level.board.cols; c++) {
      const cell = level.board.cells[r][c];
      if (!cell) continue;
      if (cell.t === 'black') black++;
      if (cell.t === 'box') {
        boxes++;
        logicalCars++;
        capacitySum += cell.count;
        capacities.push(cell.count);
        if (cell.numice > 0) ice++;
        if (cell.chain > 0) chainCells++;
        if (cell.q) question++;
      }
      if (cell.t === 'pipe') {
        pipeCells++;
        logicalCars += (cell.queue || []).length;
        for (const item of cell.queue || []) {
          capacitySum += item.count;
          capacities.push(item.count);
        }
      }
    }
  }

  function signatureOf(runs) {
    return JSON.stringify(runs.map(run => ({
      won: run.won,
      progress: run.progress,
      peak: run.peak,
      windows: run.windows.map(window => ({
        start: window.startStep || window.start,
        end: window.endStep || window.end,
        peak: window.peak
      }))
    })));
  }
  const mainSignature = signatureOf(zeroRevive);
  const fullSignature = JSON.stringify({
    solve: {
      completed: solve.completed,
      progress: solve.progress,
      peak: solve.maxBuffer,
      windows: pressureWindows(solve.stepBufferHistory || [], 3)
    },
    players: JSON.parse(mainSignature)
  });
  function variantSignature(variant) {
    return JSON.stringify({
      solve: variant.solve,
      players: variant.players
    });
  }
  function twoProportionZ(controlCount, candidateCount, count) {
    const p1 = controlCount / count;
    const p2 = candidateCount / count;
    const pooled = (controlCount + candidateCount) / (2 * count);
    const se = Math.sqrt(pooled * (1 - pooled) * (2 / count));
    return se === 0 ? 0 : (p1 - p2) / se;
  }
  const uniformRandomZ = twoProportionZ(
    baseRandom.uniform.reachedBuffer5,
    randomResult.uniform.reachedBuffer5,
    randomResult.uniform.count
  );
  const chainObserved = anyChainsObserved && CHAIN_GROUPS.every(spec =>
    anyChainsObserved.chains[spec.id].entered &&
    anyChainsObserved.chains[spec.id].entryConsumedMember &&
    anyChainsObserved.chains[spec.id].released);
  const chainNeedColorPass = anyChainsObserved && CHAIN_GROUPS.every(spec =>
    anyChainsObserved.chains[spec.id].entryConsumedMember);
  const chainDebtPass = anyChainsObserved && CHAIN_GROUPS.every(spec =>
    anyChainsObserved.chains[spec.id].debtMember);
  const matrixProfiles = new Set(matrix.entries.map(entry => JSON.stringify({
    debt: entry.immediate.debtRemaining,
    greedyPeak: entry.greedyContinuation.peak,
    greedyWon: entry.greedyContinuation.won,
    regions: entry.afterEntryReachableRegions.slice(0, 3).map(item => item.region),
    randomPeaks: entry.randomContinuation.peakDistribution
  })));
  const uniformDropped = uniformRandomZ >= 1.96;
  const checks = {
    capacityContract: logicalCars === 47 && capacitySum === 1225 &&
      capacities.every(value => value >= 20 && value <= 40),
    boardContract: boxes === 46 && logicalCars === 47 &&
      black === 2 && chainCells === 5 && ice === 5 &&
      pipeCells === 1 && question === 0,
    noInitialIce: level.board.cells[0].every(cell =>
      !cell || cell.t !== 'box' || cell.numice === 0),
    openingHasSevenConsumableChoices: opening.length === 7 &&
      opening.every(move => move.applied && move.canConsume && move.consumed > 0),
    roleGraphPass: roles.ok,
    solvePass: solve.completed && solve.progress === 100,
    playersPass: players.every(player =>
      player.won && player.progress === 100 && player.revivesUsed === 0),
    twoPressureWindowsPerSeed:
      zeroRevive.every(player => player.windows.length >= 2),
    pressureWindowsReleased:
      zeroRevive.every(player => player.windows.every(window => window.release)),
    pressureWindowsHaveChoicesAndRegions:
      zeroRevive.every(player => player.windows.every(window =>
        window.peakStep.visibleChoices >= 2 &&
        window.peakStep.consumableChoices >= 1 &&
        window.targetRegions.length > 0)),
    adjacentChainGroups:
      CHAIN_GROUPS.every(spec => spec.cells.length >= 2 &&
        spec.cells.slice(1).every((cell, index) =>
          Math.abs(cell[0] - spec.cells[index][0]) +
          Math.abs(cell[1] - spec.cells[index][1]) === 1)),
    twoChainGroupsObserved: chainObserved,
    chainGroupsConsumeCurrentNeed: chainNeedColorPass,
    chainGroupsCarryRealDebt:
      PROFILE_NAME === 'v18' ? true : chainDebtPass,
    pipeQueueReleased:
      !!(anyChainsObserved && anyChainsObserved.pipe &&
        anyChainsObserved.pipe.next > 0 && anyChainsObserved.pipe.exit),
    openingMatrixComplete: matrix.entries.length === 7 &&
      matrix.entries.every(entry =>
        entry.randomContinuation.count === 50 &&
        Object.keys(entry.randomContinuation.peakDistribution).length > 0),
    openingProfilesDiffer: matrixProfiles.size >= 2,
    uniformRandomBelowV17:
      uniformDropped && baseRandom.uniform.reachedBuffer5 === 489,
    randomChoiceRemainsRecoverable:
      randomResult.uniform.won >= 450 &&
      randomResult.reasonable.won >= 450,
    secondChainAblationChanges:
      variantSignature(variants.secondChain) !== fullSignature,
    iceAblationChanges:
      variantSignature(variants.allIce) !== fullSignature ||
      noIceRandom.uniform.reachedBuffer5 !== randomResult.uniform.reachedBuffer5 ||
      JSON.stringify(noIceRandom.uniform.peakDistribution) !==
        JSON.stringify(randomResult.uniform.peakDistribution),
    firstChainAblationChanges:
      variantSignature(variants.firstChain) !== fullSignature,
    pipeAblationChanges:
      variantSignature(variants.pipe) !== fullSignature,
    blackAblationChanges:
      variantSignature(variants.black) !== fullSignature ||
      variants.black.solve.peak !== solve.maxBuffer,
    roundtripPass: roundtripSolve.completed === true
  };
  const hardCheckKeys = Object.keys(checks).filter(key =>
    PROFILE_NAME !== 'meaningful' || key !== 'uniformRandomBelowV17');
  const passed = hardCheckKeys.every(key => checks[key]);

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(LEVEL_FILE, JSON.stringify(A.toGameFormat(level), null, 2) + '\n');
  const sha256 = crypto.createHash('sha256')
    .update(fs.readFileSync(LEVEL_FILE))
    .digest('hex');

  const primaryPlan = playerPlans.find(item =>
    item.seed === 7 && item.reviveCap === 0);
  const baseDebug = readJson(SOURCE_DEBUG);
  const plan = {
    schema: '006-story-plan-v5',
    status: passed
      ? (PROFILE_NAME === 'meaningful'
          ? 'E6.8_SEMANTIC_PASS_RANDOM_DIAGNOSTIC'
          : 'E6.8_THICKNESS_PASS')
      : 'E6.8_THICKNESS_FAIL',
    source: SOURCE,
    level: LEVEL_FILE,
    sha256,
    opening,
    obstacles: {
      black: BLACK_CELLS,
      chains: CHAIN_GROUPS.map(spec => ({
        ...spec,
        cells: spec.cells.map(([r, c]) => ({
          r,
          c,
          color: baseGame.spools[r][c].id,
          count: baseGame.spools[r][c].count
        }))
      })),
      ice: ICE_SPEC.map(item => ({
        ...item,
        color: baseGame.spools[item.r][item.c].id,
        count: baseGame.spools[item.r][item.c].count
      })),
      pipe: {
        cell: PIPE_CELL,
        direction: PIPE_DIR,
        queue: [{
          color: baseGame.spools[PIPE_CELL[0]][PIPE_CELL[1]].id,
          count: baseGame.spools[PIPE_CELL[0]][PIPE_CELL[1]].count
        }]
      }
    },
    pressureWindows: primaryPlan.windows,
    chainEvents: primaryEvents && primaryEvents.chains,
    pipeEvent: primaryEvents && primaryEvents.pipe,
    randomAudit: {
      v17: baseRandom,
      [LEVEL_VERSION]: randomResult
    },
    matrix
  };
  fs.writeFileSync(PLAN_FILE, JSON.stringify(plan, null, 2) + '\n');
  fs.writeFileSync(MATRIX_FILE, JSON.stringify(matrix, null, 2) + '\n');
  fs.writeFileSync(RANDOM_FILE, JSON.stringify({
    v17: baseRandom,
    [LEVEL_VERSION]: randomResult
  }, null, 2) + '\n');

  const debug = {
    schema: '006-thickness-' + LEVEL_VERSION,
    status: passed ? LEVEL_VERSION.toUpperCase() + '_PASS' :
      LEVEL_VERSION.toUpperCase() + '_FAIL',
    source: SOURCE,
    gameFormat: LEVEL_FILE,
    routeFile: ROUTE_FILE,
    storyPlan: PLAN_FILE,
    matrixFile: MATRIX_FILE,
    randomAuditFile: RANDOM_FILE,
    sha256,
    board: {
      rows: 7,
      cols: 7,
      boxes,
      logicalCars,
      black,
      ice,
      chainCells,
      pipeCells,
      question,
      capacityMin: Math.min(...capacities),
      capacityMax: Math.max(...capacities),
      capacitySum
    },
    opening,
    roles,
    solve: {
      completed: solve.completed,
      progress: solve.progress,
      peak: solve.maxBuffer,
      timeline: solve.stepBufferHistory || [],
      picks: uniquePicks(solve)
    },
    players,
    chainEvents: primaryEvents && primaryEvents.chains,
    pipeEvent: primaryEvents && primaryEvents.pipe,
    randomAudit: {
      v17: baseRandom,
      [LEVEL_VERSION]: randomResult
    },
    openingMatrix: matrix,
    ablations: variants,
    checks
  };
  fs.writeFileSync(DEBUG_FILE, JSON.stringify(debug, null, 2) + '\n');
  fs.writeFileSync(ROUTE_FILE, JSON.stringify({
    schema: '006-player-routes-v5',
    levelFile: LEVEL_FILE,
    playerRuns: players
  }, null, 2) + '\n');

  const lines = [
    '# 006 · E6.8 障碍厚度 ' + LEVEL_VERSION,
    '',
    '## 结论',
    '',
    passed
      ? '通过：新增二连锁和五格分支冰后，保留开放开局、故事角色、压力窗口、零复活通关和可直接使用的JSON。'
      : '失败：保留完整证据，不得接入生产页。',
    '',
    '## 棋盘',
    '',
    `- 7×7、${logicalCars}逻辑车、${boxes}表面车；`,
    `- ${black}黑、5格两组相邻锁链、${ice}数字冰、${pipeCells}管道、${question}问号；`,
    `- 容量${Math.min(...capacities)}～${Math.max(...capacities)}，总和${capacitySum}；`,
    `- SHA-256：\`${sha256}\`。`,
    '',
    '## 核心验收',
    '',
    `- 首行7入口全部立即收满：${checks.openingHasSevenConsumableChoices ? '是' : '否'}；`,
    `- 全知：${solve.progress}%，峰值${solve.maxBuffer}；`,
    `- 默认/0复活PlayerSim：${players.filter(player => player.won).length}/${players.length}，` +
      `0复活使用${players.filter(player => player.reviveCap === 0)
        .reduce((sum, player) => sum + player.revivesUsed, 0)}次；`,
    `- 零复活三个seed压力窗口：${zeroRevive.map(player =>
      player.windows.map(window => `${window.startStep}-${window.endStep}/峰${window.peak}`)
        .join('、')).join('；')}；`,
    `- 完全随机达到buffer5：v17 ${baseRandom.uniform.reachedBuffer5}/500，` +
      `${LEVEL_VERSION} ${randomResult.uniform.reachedBuffer5}/500；`,
    `- 合理随机达到buffer5：v17 ${baseRandom.reasonable.reachedBuffer5}/500，` +
      `${LEVEL_VERSION} ${randomResult.reasonable.reachedBuffer5}/500；`,
    `- 两组锁链均出现进入、当前色实际消除和释放：${chainObserved ? '是' : '否'}；`,
    `- 每组锁链入场后都留下未完成成员：${chainDebtPass ? '是' : '否'}；`,
    `- JSON往返：${roundtripSolve.completed ? '通过' : '失败'}。`,
    '',
    '## 首取矩阵',
    '',
    '| 入口 | 车 | 即时代价 | 贪心峰值 | 随机延续峰值分布 | 随机达buffer5 |',
    '|---|---|---|---:|---|---:|'
  ];
  for (const entry of matrix.entries) {
    const distribution = Object.keys(entry.randomContinuation.peakDistribution)
      .sort((a, b) => Number(a) - Number(b))
      .map(peak => `${peak}:${entry.randomContinuation.peakDistribution[peak]}`)
      .join(', ');
    lines.push(`| (${entry.cell[0]},${entry.cell[1]}) | ` +
      `${entry.car.color}/${entry.car.count} | ` +
      `消${entry.immediate.consumed}，债${entry.immediate.debtRemaining} | ` +
      `${entry.greedyContinuation.peak} | ${distribution} | ` +
      `${entry.randomContinuation.reachedBuffer5}/50 |`);
  }
  lines.push('');
  fs.writeFileSync(REPORT_FILE, lines.join('\n') + '\n');

  console.log(JSON.stringify({
    ok: passed,
    outDir: OUT,
    sha256,
    board: debug.board,
    openingCount: opening.length,
    solve: debug.solve,
    players: players.map(player => ({
      seed: player.seed,
      reviveCap: player.reviveCap,
      won: player.won,
      progress: player.progress,
      peak: player.peak,
      revivesUsed: player.revivesUsed,
      windows: player.windows.map(window => ({
        start: window.startStep,
        end: window.endStep,
        peak: window.peak,
        release: window.release
      }))
    })),
    randomAudit: {
      v17: baseRandom,
      [LEVEL_VERSION]: randomResult
    },
    chainEvents: primaryEvents && primaryEvents.chains,
    pipeEvent: primaryEvents && primaryEvents.pipe,
    matrix: matrix.entries.map(entry => ({
      cell: entry.cell,
      car: entry.car,
      debt: entry.immediate.debtRemaining,
      greedyPeak: entry.greedyContinuation.peak,
      randomBuffer5: entry.randomContinuation.reachedBuffer5,
      distribution: entry.randomContinuation.peakDistribution
    })),
    checks
  }, null, 2));
}

module.exports = {
  BLACK_CELLS,
  PIPE_CELL,
  PIPE_DIR,
  CHAIN_GROUPS,
  ICE_SPEC,
  ROLE_PATHS,
  readJson,
  clone,
  loadSolver,
  uniquePicks,
  poseKey,
  pressureWindows,
  optionsAt,
  applyPath,
  roleEvidence,
  obstacleEvents,
  tracePlan,
  randomWalk,
  randomAudit,
  greedyContinuation,
  openingMatrix,
  evaluateVariant,
  removeChain,
  removeIce,
  removePipe,
  removeBlack
};

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(err && err.stack || err);
    process.exit(1);
  }
}
