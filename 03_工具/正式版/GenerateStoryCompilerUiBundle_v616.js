#!/usr/bin/env node
'use strict';

/**
 * Generate the browser-side story compiler registry used by the v616 UI.
 *
 * Only board spools and route contracts are embedded. Target blocks always come
 * from the image currently loaded in the production UI.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(
  ROOT,
  '02_工程',
  '游戏主bin',
  'bin',
  'js',
  'story-compiler.js'
);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function blocksFromTXT(file) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  let start = 0;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === '' || !/^-?\d/.test(trimmed)) start = i + 1;
    else break;
  }
  const blocks = [];
  for (let i = start; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    blocks.push(line.split(/\s+/).map(value => parseInt(value, 10) || 0));
  }
  return blocks;
}

function targetSignature(blocks) {
  let hash = 2166136261 >>> 0;
  function mix(value) {
    hash ^= (value >>> 0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  mix(blocks.length);
  mix(blocks[0] ? blocks[0].length : 0);
  for (const row of blocks) for (const value of row) mix(value | 0);
  return hash.toString(16).padStart(8, '0');
}

function routePicksOf006() {
  const manifest = readJson(path.join(ROOT, '实验关/关卡6/E5_v1/manifest.json'));
  return manifest.route.expectedUniqueSteps.map(text => {
    const [r, c] = text.split(',').map(Number);
    return { r, c };
  });
}

function routePicksOfDebug(file) {
  const debug = readJson(file);
  return debug.evidence.map(item => ({ r: item.r, c: item.c }));
}

function entryOf(config) {
  const levelFile = path.join(ROOT, config.level);
  const raw = readJson(levelFile);
  const blocks = blocksFromTXT(path.join(ROOT, config.target));
  function typesOf(value) {
    return Array.isArray(value) ? value : (value == null || value === 0 ? [] : [value]);
  }
  const totalCars = raw.spools.flat().reduce((sum, spool) => {
    if (!spool) return sum;
    if (spool.id > 0) return sum + 1;
    if (typesOf(spool.type).some(type => type >= 11 && type <= 14)) {
      return sum + (Array.isArray(spool.param) ? spool.param.length : 0);
    }
    return sum;
  }, 0);
  const capacities = raw.spools
    .flat()
    .filter(spool => spool && spool.id > 0)
    .map(spool => spool.count);
  return {
    id: config.id,
    label: config.label,
    targetSig: targetSignature(blocks),
    targetSize: [blocks.length, blocks[0].length],
    sha256: sha256(levelFile),
    maprow: raw.maprow,
    mapcol: raw.mapcol,
    spools: raw.spools,
    capacityMin: capacities.length ? Math.min(...capacities) : null,
    capacityMax: capacities.length ? Math.max(...capacities) : null,
    totalCars,
    expectedPicks: config.expectedPicks || [],
    requiredSteps: config.requiredSteps || (config.expectedPicks ? config.expectedPicks.length : 0),
    openingContract: config.openingContract || null,
    storyGraph: config.storyGraph || null,
    roleGraph: config.roleGraph || null,
    pressureContract: config.pressureContract || null,
    chainContracts: config.chainContracts || [],
    pipeContract: config.pipeContract || null,
    routeMode: config.routeMode,
    storyBeats: config.storyBeats
  };
}

function main() {
  const entries = [
    entryOf({
      id: '006',
      label: '006 · 硬引导双链',
      target: '实验关/关卡6/35x35拼接图纸_006.txt',
      level: '实验关/关卡6/原型_v21/关卡_实验_006_v21.json',
      requiredSteps: 45,
      routeMode: 'roleGraph',
      openingContract: {
        exactMoves: 7,
        allCanConsume: true,
        bufferAfterEmpty: true
      },
      roleGraph: {
        roles: [
          {
            id: 'safe',
            path: [{ r: 0, c: 3 }, { r: 1, c: 3 }],
            debtAfterStep: null,
            finalBufferEmpty: true
          },
          {
            id: 'lightDebt',
            path: [{ r: 0, c: 0 }, { r: 1, c: 0 }, { r: 2, c: 0 }],
            debtAfterStep: 2,
            debt: { color: 17, remaining: 10 },
            finalBufferEmpty: true
          },
          {
            id: 'heavyDebt',
            path: [{ r: 0, c: 6 }, { r: 1, c: 6 }, { r: 2, c: 6 }],
            debtAfterStep: 2,
            debt: { color: 34, remaining: 19 },
            finalBufferEmpty: true
          }
        ]
      },
      pressureContract: {
        threshold: 3,
        minWindows: 2,
        minPeak: 4,
        requireRelease: true,
        reviveCap: 0
      },
      chainContracts: [
        {
          group: 2,
          cells: [{ r: 2, c: 5 }, { r: 3, c: 5 }],
          requireAdjacent: true,
          requireCurrentConsumption: true,
          requireCompletedMember: true,
          requireDebtMember: true,
          requireRelease: true
        },
        {
          group: 3,
          cells: [{ r: 4, c: 1 }, { r: 4, c: 2 }],
          requireAdjacent: true,
          requireCurrentConsumption: true,
          requireCompletedMember: true,
          requireDebtMember: true,
          requireRelease: true
        }
      ],
      pipeContract: {
        cell: { r: 6, c: 6 },
        direction: 11,
        queue: [{ color: 13, count: 28 }],
        requireReleased: true
      },
      storyBeats: [
        '顶层7个无冰入口全部立即收满',
        '安全路径不产生债务',
        '轻债路径17/26欠10后由31/31偿还',
        '长债路径34/25欠19后由31/31偿还',
        '第一段同色债务峰值3并在下一窗口部分释放',
        '第二段混色债务达到4并持续到33/20释放',
        '首行7个入口均无冰；债务发生在中段而不是首行免费双消',
        '右侧5/21先完成、5/40留下23px债务，第23步整组释放',
        '中段15/25先完成、另一辆15/25留下22px，第20步释放',
        '两组锁链都在全知路线峰值4窗口内形成真实债务',
        '五格分支数字冰延迟高误判供给，移除后完全随机buffer5比例回升',
        '管道以13/28暂存并在出口空出后释放',
        '最终组债释放并收尾'
      ]
    }),
    entryOf({
      id: '008',
      label: '008 · 双债务故事图',
      target: '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_008.txt',
      level: '实验关/关卡8/原型_v3/关卡_实验_008_v3.json',
      requiredSteps: 47,
      routeMode: 'storyGraph',
      storyGraph: {
        start: { r: 0, c: 0, color: 7, count: 26 },
        choices: [
          {
            id: 'lightDebt',
            path: [{ r: 1, c: 0 }, { r: 2, c: 0 }],
            debt: { color: 33, remaining: 18 },
            releaseStep: 1
          },
          {
            id: 'heavyDebt',
            path: [{ r: 0, c: 1 }, { r: 0, c: 2 }],
            debt: { color: 3, remaining: 27 },
            releaseStep: 1
          }
        ],
        minRouteDiversity: 2
      },
      storyBeats: [
        '7/26教学',
        '轻债33/22或重债3/29二选一',
        '32/27或5/36分别偿还',
        '第二枚7/26汇合',
        '后续分区选择与终局'
      ]
    }),
    entryOf({
      id: '014',
      label: '014 · 最终留出',
      target: '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_014.txt',
      level: '实验关/关卡14/原型_v1/关卡_实验_014_v1.json',
      expectedPicks: routePicksOfDebug(
        path.join(ROOT, '实验关/关卡14/原型_v1/关卡_实验_014_v1.debug.json')
      ),
      routeMode: 'full',
      storyBeats: [
        'R107小缺口',
        'R69鱼形内部',
        '玉米未完成债务',
        '末段31债务释放'
      ]
    })
  ];

  const registry = {};
  for (const entry of entries) registry[entry.targetSig] = entry;

  const source = [
    '/*',
    ' * StoryCompiler v1 · generated by GenerateStoryCompilerUiBundle_v616.js',
    ' *',
    ' * Default-off browser registry for the three accepted story levels.',
    ' * Unsupported targets fail explicitly and never fall back to random search.',
    ' */',
    'var AntSolver = AntSolver || {};',
    '',
    'AntSolver.StoryCompiler = (function () {',
    '  var REGISTRY = ' + JSON.stringify(registry, null, 2) + ';',
    '',
    '  function clone(value) { return JSON.parse(JSON.stringify(value)); }',
    '  function signature(blocks) {',
    '    var hash = 2166136261 >>> 0;',
    '    function mix(value) {',
    '      hash ^= (value >>> 0);',
    '      hash = Math.imul(hash, 16777619) >>> 0;',
    '    }',
    '    mix(blocks.length);',
    '    mix(blocks[0] ? blocks[0].length : 0);',
    '    for (var r = 0; r < blocks.length; r++) for (var c = 0; c < blocks[r].length; c++) mix(blocks[r][c] | 0);',
    '    return hash.toString(16);',
    '  }',
    '  function uniquePicks(run) {',
    '    var seen = {};',
    '    var out = [];',
    '    var picks = (run && run.pickOrder) || [];',
    '    for (var i = 0; i < picks.length; i++) {',
    '      var pick = picks[i];',
    '      var key = String(pick.step);',
    '      if (seen[key]) continue;',
    '      seen[key] = true;',
    '      out.push({ r: pick.r, c: pick.c, color: pick.color, count: pick.count });',
    '    }',
    '    return out;',
    '  }',
    '  function poseKey(picks) {',
    '    return picks.map(function (pick) { return pick.r + \",\" + pick.c; }).join(\">\");',
    '  }',
    '  function routeMatches(picks, required, mode) {',
    '    if (mode === \"prefix\") return poseKey(picks.slice(0, required.length)) === poseKey(required);',
    '    return poseKey(picks) === poseKey(required);',
    '  }',
    '  function storyGraphPass(level, entry, solvePicks, playerRuns) {',
    '    var graph = entry.storyGraph;',
    '    if (!graph) return true;',
    '    var st = AntSolver.Simulator.createState(level, { useSlotStart: true, instantChain: true });',
    '    st.capture = true;',
    '    st.capOps = [];',
    '    if (!AntSolver.Simulator.applyPick(st, graph.start.r, graph.start.c)) return false;',
    '    var opening = AntSolver.Simulator.listMoves(st).filter(function (move) { return !move.blocked; });',
    '    if (opening.length !== graph.choices.length) return false;',
    '    for (var gi = 0; gi < graph.choices.length; gi++) {',
    '      var choice = graph.choices[gi];',
    '      if (!opening.some(function (move) { return move.r === choice.path[0].r && move.c === choice.path[0].c; })) return false;',
    '      st = AntSolver.Simulator.createState(level, { useSlotStart: true, instantChain: true });',
    '      st.capture = true;',
    '      st.capOps = [];',
    '      if (!AntSolver.Simulator.applyPick(st, graph.start.r, graph.start.c)) return false;',
    '      for (var pi = 0; pi < choice.path.length; pi++) {',
    '        st.capOps = [];',
    '        if (!AntSolver.Simulator.applyPick(st, choice.path[pi].r, choice.path[pi].c)) return false;',
    '        if (pi === 0 && choice.debt) {',
    '          if (!st.buffer.some(function (item) {',
    '            return item.color === choice.debt.color && item.need - item.progress === choice.debt.remaining;',
    '          })) return false;',
    '        }',
    '      }',
    '      if (st.buffer.length !== 0) return false;',
    '    }',
    '    var keys = {};',
    '    keys[poseKey(solvePicks.slice(0, 12))] = true;',
    '    for (var ri = 0; ri < playerRuns.length; ri++) keys[poseKey(playerRuns[ri].slice(0, 12))] = true;',
    '    return Object.keys(keys).length >= (graph.minRouteDiversity || 1);',
    '  }',
    '  function roleGraphPass(level, entry) {',
    '    var graph = entry.roleGraph;',
    '    if (!graph) return true;',
    '    for (var ri = 0; ri < graph.roles.length; ri++) {',
    '      var role = graph.roles[ri];',
    '      var st = AntSolver.Simulator.createState(level, { useSlotStart: true, instantChain: true });',
    '      st.capture = true;',
    '      st.capOps = [];',
    '      for (var pi = 0; pi < role.path.length; pi++) {',
    '        var cell = role.path[pi];',
    '        var move = AntSolver.Simulator.listMoves(st).filter(function (item) {',
    '          return !item.blocked && item.r === cell.r && item.c === cell.c;',
    '        })[0];',
    '        if (!move) return false;',
    '        st.capOps = [];',
    '        if (!AntSolver.Simulator.applyPick(st, cell.r, cell.c)) return false;',
    '        if (role.debtAfterStep === pi + 1 && role.debt) {',
    '          var hasDebt = st.buffer.some(function (item) {',
    '            return item.color === role.debt.color && item.need - item.progress === role.debt.remaining;',
    '          });',
    '          if (!hasDebt) return false;',
    '        }',
    '      }',
    '      if (role.finalBufferEmpty && st.buffer.length !== 0) return false;',
    '    }',
    '    return true;',
    '  }',
    '  function pressureWindowsOf(timeline, threshold) {',
    '    var windows = [];',
    '    var start = null;',
    '    for (var i = 0; i < timeline.length; i++) {',
    '      if (timeline[i] >= threshold && start == null) start = i;',
    '      if (timeline[i] < threshold && start != null) {',
    '        windows.push({ start: start + 1, end: i, peak: Math.max.apply(null, timeline.slice(start, i)), release: true });',
    '        start = null;',
    '      }',
    '    }',
    '    if (start != null) {',
    '      windows.push({ start: start + 1, end: timeline.length, peak: Math.max.apply(null, timeline.slice(start)), release: false });',
    '    }',
    '    return windows;',
    '  }',
    '  function pressureGraphPass(players, entry) {',
    '    var contract = entry.pressureContract;',
    '    if (!contract) return true;',
    '    var tested = players.filter(function (player) { return player.reviveCap === contract.reviveCap; });',
    '    if (!tested.length) return false;',
    '    return tested.every(function (player) {',
    '      var windows = pressureWindowsOf(player.bufferTimeline || [], contract.threshold);',
    '      player.pressureWindows = windows;',
    '      var peak = Math.max.apply(null, (player.bufferTimeline || []).concat([0]));',
    '      if (windows.length < contract.minWindows) return false;',
    '      if (contract.minPeak != null && peak < contract.minPeak) return false;',
    '      if (contract.requireRelease && !windows.every(function (window) { return window.release; })) return false;',
    '      return true;',
    '    });',
    '  }',
    '  function chainGraphPass(level, entry, playerRuns) {',
    '    var contracts = entry.chainContracts || [];',
    '    for (var ci = 0; ci < contracts.length; ci++) {',
    '      var contract = contracts[ci];',
    '      var actualCells = [];',
    '      for (var r = 0; r < level.board.rows; r++) for (var c = 0; c < level.board.cols; c++) {',
    '        var cell = level.board.cells[r][c];',
    '        if (cell && cell.t === \"box\" && cell.chain === contract.group) actualCells.push(r + \",\" + c);',
    '      }',
    '      var expectedCells = contract.cells.map(function (cell) { return cell.r + \",\" + cell.c; });',
    '      if (actualCells.sort().join(\"|\") !== expectedCells.sort().join(\"|\")) return false;',
    '      if (contract.requireAdjacent) {',
    '        for (var ai = 1; ai < contract.cells.length; ai++) {',
    '          var previousCell = contract.cells[ai - 1], currentCell = contract.cells[ai];',
    '          if (Math.abs(previousCell.r - currentCell.r) + Math.abs(previousCell.c - currentCell.c) !== 1) return false;',
    '        }',
    '      }',
    '      var contractPassed = false;',
    '      for (var ri = 0; ri < playerRuns.length && !contractPassed; ri++) {',
    '        var picks = playerRuns[ri];',
    '        var st = AntSolver.Simulator.createState(level, { useSlotStart: true, instantChain: true });',
    '        st.capture = true;',
    '        var activeLink = 0, consumed = false, completed = false, debt = false, released = false;',
    '        for (var pi = 0; pi < picks.length && !released; pi++) {',
    '          st.capOps = [];',
    '          if (!AntSolver.Simulator.applyPick(st, picks[pi].r, picks[pi].c)) continue;',
    '          var last = st.lastPick || {};',
    '          if (!activeLink && last.isChain && last.chain === contract.group) {',
    '            activeLink = st._linkSeq;',
    '            var eatCounts = {};',
    '            for (var oi = 0; oi < (st.capOps || []).length; oi++) {',
    '              var op = st.capOps[oi];',
    '              if (op.t === \"eat\") eatCounts[op.key] = (eatCounts[op.key] || 0) + (op.cells ? op.cells.length : 0);',
    '            }',
    '            for (var adi = 0; adi < (st.capOps || []).length; adi++) {',
    '              var add = st.capOps[adi];',
    '              if (add.t !== \"add\" || add.link !== activeLink) continue;',
    '              var progress = Math.min(add.need, eatCounts[add.key] || 0);',
    '              if (progress > 0) consumed = true;',
    '              if (progress >= add.need) completed = true;',
    '              if (progress < add.need) debt = true;',
    '            }',
    '          }',
    '          if (activeLink) {',
    '            var linked = st.buffer.filter(function (item) { return item.link === activeLink; });',
    '            if (!linked.length) {',
    '              released = true;',
    '              activeLink = 0;',
    '            } else {',
    '              if (linked.some(function (item) { return item.need - item.progress === 0; })) completed = true;',
    '              if (linked.some(function (item) { return item.need - item.progress > 0; })) debt = true;',
    '            }',
    '          }',
    '        }',
    '        contractPassed = (!contract.requireCurrentConsumption || consumed) &&',
    '          (!contract.requireCompletedMember || completed) &&',
    '          (!contract.requireDebtMember || debt) &&',
    '          (!contract.requireRelease || released);',
    '      }',
    '      if (!contractPassed) return false;',
    '    }',
    '    return true;',
    '  }',
    '  function pipeGraphPass(level, entry, playerRuns) {',
    '    var contract = entry.pipeContract;',
    '    if (!contract) return true;',
    '    var pipe = level.board.cells[contract.cell.r][contract.cell.c];',
    '    if (!pipe || pipe.t !== \"pipe\" || pipe.dir !== contract.direction) return false;',
    '    if ((pipe.queue || []).length !== contract.queue.length) return false;',
    '    for (var qi = 0; qi < contract.queue.length; qi++) {',
    '      var queueExpected = contract.queue[qi], queueActual = pipe.queue[qi];',
    '      if (!queueActual || queueActual.color !== queueExpected.color || queueActual.count !== queueExpected.count) return false;',
    '    }',
    '    for (var ri = 0; ri < playerRuns.length; ri++) {',
    '      var picks = playerRuns[ri];',
    '      var st = AntSolver.Simulator.createState(level, { useSlotStart: true, instantChain: true });',
    '      st.capture = true;',
    '      for (var pi = 0; pi < picks.length; pi++) {',
    '        st.capOps = [];',
    '        if (!AntSolver.Simulator.applyPick(st, picks[pi].r, picks[pi].c)) continue;',
    '        var currentPipe = st.cells[contract.cell.r][contract.cell.c];',
    '        if (!currentPipe || currentPipe.t !== \"pipe\" || currentPipe.next <= 0 || !currentPipe.opened) continue;',
    '        var delta = AntSolver.PIPE_DIRS[contract.direction] || [-1, 0];',
    '        var exitCell = st.cells[contract.cell.r + delta[0]][contract.cell.c + delta[1]];',
    '        var first = contract.queue[0];',
    '        if (exitCell && exitCell.t === \"box\" &&',
    '            exitCell.color === first.color && exitCell.count === first.count) return true;',
    '      }',
    '    }',
    '    return false;',
    '  }',
    '  function openingFrontierPass(level, entry) {',
    '    var contract = entry.openingContract;',
    '    if (!contract) return true;',
    '    var state = AntSolver.Simulator.createState(level, { useSlotStart: true, instantChain: true });',
    '    state.capture = true;',
    '    var moves = AntSolver.Simulator.listMoves(state).filter(function (move) { return !move.blocked; });',
    '    if (contract.exactMoves != null && moves.length !== contract.exactMoves) return false;',
    '    if (contract.allCanConsume && !moves.every(function (move) { return move.canConsume; })) return false;',
    '    if (contract.bufferAfterEmpty) {',
    '      for (var i = 0; i < moves.length; i++) {',
    '        var clone = AntSolver.SolverStrategy.cloneState(state);',
    '        clone.capOps = [];',
    '        if (!AntSolver.Simulator.applyPick(clone, moves[i].r, moves[i].c)) return false;',
    '        if (clone.buffer.length !== 0) return false;',
    '      }',
    '    }',
    '    return true;',
    '  }',
    '  function entryFor(blocks) { return REGISTRY[signature(blocks)] || null; }',
    '  function availableTargets() {',
    '    return Object.keys(REGISTRY).map(function (key) {',
    '      var entry = REGISTRY[key];',
    '      return { id: entry.id, label: entry.label, targetSig: key };',
    '    });',
    '  }',
    '  function compile(blocks, config) {',
    '    var t0 = Date.now();',
    '    var entry = entryFor(blocks);',
    '    if (!entry) {',
    '      return { ok: false, level: null, meta: {',
    '        schema: \"story-compiler-v1\", status: \"unsupported-target\",',
    '        targetSig: signature(blocks), available: availableTargets(), elapsedMs: Date.now() - t0',
    '      } };',
    '    }',
    '    if (!blocks.length || blocks.length !== entry.targetSize[0] || blocks[0].length !== entry.targetSize[1]) {',
    '      return { ok: false, level: null, meta: { schema: \"story-compiler-v1\", status: \"size-mismatch\", storyId: entry.id } };',
    '    }',
    '    var level = AntSolver.parseLevel(AntSolver.fromGameFormat({',
    '      toprow: blocks.length, blocks: clone(blocks), maprow: entry.maprow, mapcol: entry.mapcol,',
    '      spools: clone(entry.spools)',
    '    }));',
    '    var solve = AntSolver.Solver.solveInstantChain(level, { timeBudgetMs: 20000 });',
    '    var solvePicks = uniquePicks(solve);',
    '    var exactSolveRouteMatches = !!(solve.completed && routeMatches(solvePicks, entry.expectedPicks, entry.routeMode));',
    '    var players = [];',
    '    var playerPickLists = [];',
    '    var seeds = [7, 1009, 2027];',
    '    var caps = [0, 2];',
    '    for (var ci = 0; ci < caps.length; ci++) for (var si = 0; si < seeds.length; si++) {',
    '      var run = AntSolver.PlayerSim.run(level, { seed: seeds[si], instantChain: true, reviveCap: caps[ci] });',
    '      var runPicks = uniquePicks(run);',
    '      playerPickLists.push(runPicks);',
    '      players.push({ seed: seeds[si], reviveCap: caps[ci], won: !!run.won,',
    '        progress: run.progress, bufferPeak: run.bufferPeak, revivesUsed: run.revivesUsed,',
    '        bufferTimeline: run.bufferTimeline || [],',
    '        routeMatches: entry.routeMode === \"storyGraph\" ? true : routeMatches(runPicks, entry.expectedPicks, entry.routeMode) });',
    '    }',
    '    var graphPass = storyGraphPass(level, entry, solvePicks, playerPickLists);',
    '    var rolePass = roleGraphPass(level, entry);',
    '    var pressurePass = pressureGraphPass(players, entry);',
    '    var chainPass = chainGraphPass(level, entry, playerPickLists);',
    '    var pipePass = pipeGraphPass(level, entry, playerPickLists);',
    '    var frontierPass = openingFrontierPass(level, entry);',
    '    if (entry.routeMode === \"storyGraph\") {',
    '      for (var pgi = 0; pgi < players.length; pgi++) players[pgi].routeMatches = graphPass;',
    '    } else if (entry.routeMode === \"openFrontier\") {',
    '      for (var pfj = 0; pfj < players.length; pfj++) players[pfj].routeMatches = frontierPass;',
    '    } else if (entry.routeMode === \"roleGraph\") {',
    '      for (var prj = 0; prj < players.length; prj++) players[prj].routeMatches = frontierPass && rolePass && pressurePass && chainPass && pipePass;',
    '    }',
    '    var solveRouteMatches = entry.routeMode === \"storyGraph\" ? graphPass :',
    '      (entry.routeMode === \"openFrontier\" ? frontierPass :',
    '        (entry.routeMode === \"roleGraph\" ? (frontierPass && rolePass && pressurePass && chainPass && pipePass) : exactSolveRouteMatches));',
    '    var roundtrip = AntSolver.parseLevel(AntSolver.fromGameFormat(AntSolver.toGameFormat(level)));',
    '    var roundtripSolve = AntSolver.Solver.solveInstantChain(roundtrip, { timeBudgetMs: 20000, greedyOnly: true });',
    '    var checks = {',
    '      solveCompleted: !!solve.completed,',
    '      solveRouteMatches: solveRouteMatches,',
    '      storyGraphPass: graphPass,',
    '      roleGraphPass: rolePass,',
    '      pressureGraphPass: pressurePass,',
    '      chainGraphPass: chainPass,',
    '      pipeGraphPass: pipePass,',
    '      openingFrontierPass: frontierPass,',
    '      playersPass: players.every(function (x) { return x.won && x.progress === 100 && x.routeMatches; }),',
    '      noRevivePass: players.filter(function (x) { return x.reviveCap === 0; }).every(function (x) { return x.revivesUsed === 0; }),',
    '      roundtripPass: !!roundtripSolve.completed',
    '    };',
    '    var passed = Object.keys(checks).every(function (key) { return checks[key]; });',
    '    return {',
    '      ok: passed,',
    '      level: passed ? level : null,',
    '      meta: {',
    '        schema: \"story-compiler-v1\",',
    '        status: passed ? \"pass\" : \"story-validation-failed\",',
    '        storyId: entry.id,',
    '        label: entry.label,',
    '        targetSig: entry.targetSig,',
    '        sourceSha256: entry.sha256,',
    '        capacityMin: entry.capacityMin,',
    '        capacityMax: entry.capacityMax,',
    '        totalCars: entry.totalCars,',
    '        routeMode: entry.routeMode,',
    '        requiredSteps: entry.requiredSteps,',
    '        storyBeats: entry.storyBeats,',
    '        checks: checks,',
    '        roleGraphPass: rolePass,',
    '        pressureGraphPass: pressurePass,',
    '        chainGraphPass: chainPass,',
    '        pipeGraphPass: pipePass,',
    '        solve: { completed: !!solve.completed, progress: solve.progress, bufferPeak: solve.maxBuffer, routeMatches: solveRouteMatches },',
    '        players: players,',
    '        elapsedMs: Date.now() - t0',
    '      }',
    '    };',
    '  }',
    '',
    '  return {',
    '    schema: \"story-compiler-v1\",',
    '    signature: signature,',
    '    availableTargets: availableTargets,',
    '    compile: compile',
    '  };',
    '})();',
    ''
  ].join('\n');

  fs.writeFileSync(OUT, source);
  console.log(JSON.stringify({
    ok: true,
    output: OUT,
    entries: entries.map(entry => ({
      id: entry.id,
      targetSig: entry.targetSig,
      sourceSha256: entry.sha256,
      routeMode: entry.routeMode,
      requiredSteps: entry.requiredSteps
    }))
  }, null, 2));
}

try {
  main();
} catch (err) {
  console.error(err && err.stack || err);
  process.exit(1);
}
