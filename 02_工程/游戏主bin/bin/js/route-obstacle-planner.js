/**
 * 路线障碍规划器 v1（实验）
 *
 * 输入一关已经求解的候选，沿其真实路线定位免费段，逐次尝试在免费段
 * 的开始/中点加入一组双锁链或一个数字冰。每个变体都重新求解并重新
 * 计算容量与体验，只有严格优于当前候选才保留，否则回退。
 *
 * 默认由 Generator 的显式开关 routeObstaclePlan==='v1' 调用。
 * 本模块不修改切球、容量、棋盘和初始摆车。
 */
var AntSolver = AntSolver || {};

AntSolver.RouteObstaclePlanner = (function () {
  var DEFAULTS = {
    version: 'v1',
    maxAttempts: 6,
    maxMs: 20000,
    attemptsPerRound: 3,
    playerSeeds: [7, 1009, 2027]
  };

  function copy(obj) {
    return Object.assign({}, obj || {});
  }

  function median(xs) {
    var a = (xs || []).filter(function (x) { return typeof x === 'number' && isFinite(x); })
      .sort(function (a, b) { return a - b; });
    if (!a.length) return null;
    var m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }

  function maxChainId(level) {
    var max = 0, cells = level && level.board && level.board.cells || [];
    for (var r = 0; r < cells.length; r++) {
      for (var c = 0; c < cells[r].length; c++) {
        var x = cells[r][c];
        if (x && x.t === 'box' && x.chain > max) max = x.chain;
      }
    }
    return max;
  }

  function chainGroupCount(level) {
    var ids = {}, cells = level && level.board && level.board.cells || [];
    for (var r = 0; r < cells.length; r++) {
      for (var c = 0; c < cells[r].length; c++) {
        var x = cells[r][c];
        if (x && x.t === 'box' && x.chain > 0) ids[x.chain] = 1;
      }
    }
    return Object.keys(ids).length;
  }

  function obstacleBudget(level, config) {
    var rows = level && level.board && level.board.rows || 0;
    var cols = level && level.board && level.board.cols || 0;
    var small = rows * cols <= 56;
    return {
      maxChains: config.routeObstacleMaxChains != null
        ? Math.max(0, parseInt(config.routeObstacleMaxChains, 10) || 0)
        : (small ? 3 : 5),
      maxIce: config.routeObstacleMaxIce != null
        ? Math.max(0, parseInt(config.routeObstacleMaxIce, 10) || 0)
        : (small ? 4 : 2)
    };
  }

  function freeRuns(level, solveResult, config) {
    if (!AntSolver.Generator || !AntSolver.Generator.choiceCurve) return [];
    var parsed;
    try { parsed = AntSolver.parseLevel(level); } catch (e) { return []; }
    var curve;
    try {
      curve = AntSolver.Generator.choiceCurve(parsed, {
        completed: true,
        pickOrder: solveResult && solveResult.pickOrder || []
      }, {
        instantChain: !!(config && config.instantChain),
        bottomOnly: !!(config && config.bottomOnly)
      });
    } catch (e) { return []; }
    var steps = curve && curve.steps || [], runs = [], start = null;
    for (var i = 0; i <= steps.length; i++) {
      var s = steps[i];
      var free = s && s.full >= 2 && s.free >= 3;
      if (free && start == null) start = i;
      if (!free && start != null) {
        runs.push({ start: start, end: i - 1, len: i - start, steps: steps.slice(start, i) });
        start = null;
      }
    }
    runs.sort(function (a, b) { return b.len - a.len; });
    return runs;
  }

  function plainForChain(cell) {
    return cell && cell.t === 'box' && !cell.chain && !cell.q;
  }

  function plainForIce(cell) {
    return cell && cell.t === 'box' && !cell.chain && !cell.q && !(cell.numice > 0);
  }

  function chainUnits(level, run, maxUnits) {
    var out = [], seen = {}, cells = level.board.cells;
    var positions = [0, Math.floor(Math.max(0, run.len - 1) / 2)];
    for (var pi = 0; pi < positions.length; pi++) {
      var step = run.steps[positions[pi]];
      if (!step || !step.pick) continue;
      var p = step.pick, own = cells[p.r] && cells[p.r][p.c];
      if (!plainForChain(own)) continue;
      for (var d = 0; d < 4; d++) {
        var dr = [-1, 1, 0, 0][d], dc = [0, 0, -1, 1][d];
        var r = p.r + dr, c = p.c + dc;
        if (r < 0 || r >= level.board.rows || c < 0 || c >= level.board.cols) continue;
        var other = cells[r][c];
        if (!plainForChain(other)) continue;
        if (Math.min(own.count, other.count) > (level.board.rows * level.board.cols <= 56 ? 18 : 22)) continue;
        var a = { r: p.r, c: p.c }, b = { r: r, c: c };
        var key = [a.r, a.c, b.r, b.c].join(',');
        if (seen[key]) continue;
        seen[key] = 1;
        out.push({
          type: 'chain',
          cells: [a, b],
          minCap: Math.min(own.count, other.count),
          sumCap: own.count + other.count,
          sourceStep: step.step || (run.start + 1)
        });
      }
    }
    out.sort(function (a, b) { return a.minCap - b.minCap || a.sumCap - b.sumCap; });
    return out.slice(0, maxUnits);
  }

  function iceUnits(level, run, maxUnits) {
    var out = [], seen = {}, cells = level.board.cells;
    var positions = [0, Math.floor(Math.max(0, run.len - 1) / 2)];
    for (var pi = 0; pi < positions.length; pi++) {
      var step = run.steps[positions[pi]];
      if (!step || !step.pick) continue;
      var p = step.pick, cell = cells[p.r] && cells[p.r][p.c];
      if (!plainForIce(cell)) continue;
      var key = p.r + ',' + p.c;
      if (seen[key]) continue;
      seen[key] = 1;
      var stepNo = step.step || (run.start + 1);
      out.push({
        type: 'ice',
        cell: { r: p.r, c: p.c },
        sourceStep: stepNo,
        value: Math.min(48, Math.max(4, stepNo + 6))
      });
    }
    return out.slice(0, maxUnits);
  }

  function metricsOf(level, config) {
    var G = AntSolver.Generator;
    if (!G || !G.evaluateLevel) return null;
    var evalCfg = copy(config);
    evalCfg.routeObstaclePlan = false;
    evalCfg.routeObstaclePlanV1 = false;
    var ev = null;
    try { ev = G.evaluateLevel(level, evalCfg); } catch (e) { return null; }
    if (!ev || !ev.valid || !ev.level || !ev.goodV3) return null;
    var quality = null;
    try { quality = AntSolver.Quality.fromGeneration(ev); } catch (e) { quality = null; }
    var curve = ev.goodV3.fillCurve || null;
    var exp = null;
    if (AntSolver.ExperienceGoal && ev.solveResult) {
      try {
        exp = AntSolver.ExperienceGoal.evaluate(ev.level, {
          solveResult: ev.solveResult,
          decision: false,
          instantChain: !!config.instantChain,
          maxDecisionStates: config.maxDecisionStates,
          stateSampleMode: config.stateSampleMode,
          minReleaseAmplitude: config.minReleaseAmplitude
        });
      } catch (e) { exp = null; }
    }
    var cap = null;
    try { cap = AntSolver.Quality.capacityEvidence(ev.level, config); } catch (e) { cap = null; }
    var seeds = Array.isArray(config.routeObstaclePlayerSeeds)
      ? config.routeObstaclePlayerSeeds : DEFAULTS.playerSeeds;
    var parsed = null;
    try { parsed = AntSolver.parseLevel(ev.level); } catch (e) {}
    var players = [];
    if (parsed && AntSolver.PlayerSim && AntSolver.PlayerSim.run) {
      for (var i = 0; i < seeds.length; i++) {
        try {
          var ps = AntSolver.PlayerSim.run(parsed, {
            seed: seeds[i],
            instantChain: !!config.instantChain,
            bottomOnly: !!config.bottomOnly
          });
          players.push({ seed: seeds[i], won: !!(ps && ps.won), peak: ps && ps.bufferPeak });
        } catch (e) {
          players.push({ seed: seeds[i], won: false, peak: null, error: String(e && e.message || e) });
        }
      }
    }
    return {
      ev: ev,
      parsed: parsed,
      quality: quality,
      curve: curve,
      experience: exp,
      capacity: cap,
      players: players,
      allPlayersWon: players.length === seeds.length && players.every(function (p) { return p.won; })
    };
  }

  function scoreOf(m) {
    if (!m || !m.ev || !m.allPlayersWon) return -1e15;
    var cap = m.capacity || {};
    if (!cap.conserved || !cap.perColorConserved || cap.aboveMax > 0 || !cap.boardFloorPass) return -1e15;
    var qPass = m.quality && m.quality.gatePass ? 1 : 0;
    var gateFails = m.quality && m.quality.gateReasons ? m.quality.gateReasons.length : 9;
    var expPass = m.experience && m.experience.pass ? 1 : 0;
    var expMetrics = m.experience && m.experience.metrics || {};
    var freeLow = m.curve && m.curve.freeLowPct != null ? m.curve.freeLowPct : 100;
    var freeRun = m.curve && m.curve.freeRunMax != null ? m.curve.freeRunMax : 100;
    var fullMedian = m.curve && m.curve.fullMedian2 != null ? m.curve.fullMedian2 : 99;
    var maxBuffer = expMetrics.maxBuffer || 0;
    var mid = expMetrics.midBuffer34Pct || 0;
    var sig = expMetrics.significantReleaseCount || 0;
    return qPass * 1e9 + expPass * 3e6 + (8 - gateFails) * 1e5 +
      Math.min(maxBuffer, 5) * 2e4 + mid * 1e3 + sig * 5e3 -
      freeLow * 120 - freeRun * 60 - Math.max(0, fullMedian - 3) * 2e4;
  }

  function applyUnit(level, unit, chainId) {
    var out = JSON.parse(JSON.stringify(level));
    if (unit.type === 'chain') {
      for (var i = 0; i < unit.cells.length; i++) {
        var c = unit.cells[i], cell = out.board.cells[c.r] && out.board.cells[c.r][c.c];
        if (!cell || cell.t !== 'box') return null;
        cell.chain = chainId;
      }
    } else {
      var ice = out.board.cells[unit.cell.r] && out.board.cells[unit.cell.r][unit.cell.c];
      if (!ice || ice.t !== 'box') return null;
      ice.numice = unit.value;
    }
    return out;
  }

  function apply(candidate, blocks, config, opts) {
    var t0 = Date.now();
    if (!candidate || !candidate.level || !candidate.solveResult) {
      return { accepted: false, candidate: candidate, evidence: { applied: false, reason: 'missing-candidate' } };
    }
    var rows = candidate.level.board && candidate.level.board.rows || 0;
    var cols = candidate.level.board && candidate.level.board.cols || 0;
    if (!rows || !cols || rows > 9 || cols > 9) {
      return { accepted: false, candidate: candidate, evidence: { applied: false, reason: 'board-over-9' } };
    }
    if (!config.instantChain) {
      return { accepted: false, candidate: candidate, evidence: { applied: false, reason: 'instant-chain-only' } };
    }
    var maxAttempts = Math.max(1, parseInt(config.routeObstaclePlanMaxAttempts, 10) || DEFAULTS.maxAttempts);
    var maxMs = Math.max(1000, parseInt(config.routeObstaclePlanMaxMs, 10) || DEFAULTS.maxMs);
    var budget = obstacleBudget(candidate.level, config);
    var currentLevel = candidate.level;
    var current = metricsOf(currentLevel, config);
    if (!current) {
      return { accepted: false, candidate: candidate, evidence: { applied: true, accepted: false, reason: 'baseline-eval-failed', ms: Date.now() - t0 } };
    }
    var beforeMetrics = {
      qGate: !!(current.quality && current.quality.gatePass),
      freeLowPct: current.curve ? current.curve.freeLowPct : null,
      freeRunMax: current.curve ? current.curve.freeRunMax : null,
      maxBuffer: current.experience && current.experience.metrics ? current.experience.metrics.maxBuffer : null
    };
    var currentScore = scoreOf(current);
    var added = [], attempts = [], rounds = [];
    var chainCount = chainGroupCount(currentLevel);
    var iceCount = 0;
    var cells = currentLevel.board.cells;
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      var x = cells[r][c];
      if (x && x.t === 'box' && x.numice > 0) iceCount++;
    }
    var nextChainId = maxChainId(currentLevel) + 1;
    for (var round = 0; round < maxAttempts && Date.now() - t0 < maxMs; round++) {
      var runs = freeRuns(currentLevel, current.ev.solveResult, config);
      if (!runs.length) break;
      var run = runs[0];
      var units = [];
      if (chainCount < budget.maxChains) {
        units = units.concat(chainUnits(currentLevel, run, DEFAULTS.attemptsPerRound));
      }
      if (iceCount < budget.maxIce) {
        units = units.concat(iceUnits(currentLevel, run, Math.max(1, DEFAULTS.attemptsPerRound - units.length)));
      }
      if (!units.length) break;
      var best = null, bestScore = currentScore;
      for (var i = 0; i < units.length && Date.now() - t0 < maxMs; i++) {
        var lv = applyUnit(currentLevel, units[i], nextChainId + round);
        if (!lv) continue;
        var m = metricsOf(lv, config);
        var sc = scoreOf(m);
        attempts.push({
          type: units[i].type,
          target: units[i].cells || units[i].cell,
          value: units[i].value || null,
          sourceStep: units[i].sourceStep,
          score: sc,
          valid: !!m,
          qGate: !!(m && m.quality && m.quality.gatePass),
          freeLowPct: m && m.curve ? m.curve.freeLowPct : null,
          freeRunMax: m && m.curve ? m.curve.freeRunMax : null,
          maxBuffer: m && m.experience && m.experience.metrics ? m.experience.metrics.maxBuffer : null,
          midBuffer34Pct: m && m.experience && m.experience.metrics ? m.experience.metrics.midBuffer34Pct : null,
          playerWins: m ? m.players.filter(function (p) { return p.won; }).length : 0
        });
        if (sc > bestScore) { bestScore = sc; best = { unit: units[i], level: lv, metrics: m }; }
      }
      rounds.push({ round: round + 1, run: { start: run.start + 1, end: run.end + 1, len: run.len }, units: units.length, accepted: !!best });
      if (!best) break;
      currentLevel = best.level;
      current = best.metrics;
      currentScore = bestScore;
      if (best.unit.type === 'chain') chainCount++;
      else iceCount++;
      added.push({
        type: best.unit.type,
        target: best.unit.cells || best.unit.cell,
        value: best.unit.value || null,
        sourceStep: best.unit.sourceStep,
        score: bestScore
      });
    }
    var evidence = {
      schema: 'route-obstacle-plan-v1',
      applied: true,
      accepted: added.length > 0,
      attempts: attempts.length,
      added: added,
      rounds: rounds,
      elapsedMs: Date.now() - t0,
      reason: added.length ? null : (rounds.length ? 'no-improvement' : 'no-eligible-free-run'),
      before: beforeMetrics
    };
    if (!added.length) return { accepted: false, candidate: candidate, evidence: evidence };
    var result = {
      level: current.ev.level,
      solveResult: current.ev.solveResult,
      audit: current.ev.audit,
      goodV3: current.ev.goodV3,
      valid: true,
      config: config
    };
    evidence.after = {
      qGate: !!(current.quality && current.quality.gatePass),
      gateReasons: current.quality ? current.quality.gateReasons : null,
      freeLowPct: current.curve ? current.curve.freeLowPct : null,
      freeRunMax: current.curve ? current.curve.freeRunMax : null,
      maxBuffer: current.experience && current.experience.metrics ? current.experience.metrics.maxBuffer : null,
      midBuffer34Pct: current.experience && current.experience.metrics ? current.experience.metrics.midBuffer34Pct : null,
      significantReleaseCount: current.experience && current.experience.metrics ? current.experience.metrics.significantReleaseCount : null,
      players: current.players
    };
    return { accepted: true, candidate: result, evidence: evidence };
  }

  return {
    apply: apply,
    freeRuns: freeRuns,
    scoreOf: scoreOf,
    DEFAULTS: DEFAULTS
  };
})();
