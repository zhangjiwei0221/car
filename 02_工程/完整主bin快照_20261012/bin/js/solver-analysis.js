/**
 * v483 · 解法结构只读分析（M1）
 *
 * 不替换 Solver.solve，不参与生产候选选择。
 * - findRoutes：有宽度/节点/时间预算的多路线 beam 搜索，完整状态去重；
 * - counterfactual：沿一条已知解，在同一父状态只换当前一步，再搜索后续；
 * - replay：所有返回路线必须用 Simulator 独立回放。
 *
 * 重要边界：本模块不是完备求解器。budget_exhausted / not_found_within_budget
 * 都不能写成“无解”；dead 只用于 overflow 或 isDeadEnd 可直接确认的状态。
 */
var AntSolver = AntSolver || {};

AntSolver.SolverAnalysis = (function () {
  var Sim = AntSolver.Simulator;
  var Clone = AntSolver.SolverStrategy.cloneState;

  function parsed(level) {
    return (level && level.rows && level.totalPixels != null && level.board) ? level : AntSolver.parseLevel(level);
  }
  function create(level, opts) {
    return Sim.createState(level, {
      useSlotStart: true,
      bottomOnly: !!(opts && opts.bottomOnly),
      instantChain: !!(opts && opts.instantChain),
      capturePreviewStats: false
    });
  }
  function won(s) { return !!s && (s.gameWon || s.eliminatedPixels >= s.totalPixels); }
  function dead(s) {
    if (!s || won(s)) return false;
    if (s.overflow || s.buffer.length > s.bufferLimit) return true;
    try { return Sim.isDeadEnd(s); } catch (e) { return false; }
  }
  function finishFlags(s) {
    if (won(s)) { s.gameWon = true; s.gameOver = true; }
    else if (s.overflow || s.buffer.length > s.bufferLimit) { s.gameOver = true; s.gameWon = false; }
    return s;
  }
  function actionOf(m) {
    return { r: m.r, c: m.c, color: m.antBox ? m.antBox.color : m.color, count: m.antBox ? m.antBox.count : m.count };
  }
  function normalizeActions(route) {
    if (!route) return [];
    var src = route.actions || route.pickOrder || route;
    if (!Array.isArray(src)) return [];
    var out = [], seenStep = {};
    for (var i = 0; i < src.length; i++) {
      var a = src[i];
      if (!a || a.r == null || a.c == null) continue;
      // solver.pickOrder 一组锁链有多条记录；回放只执行 chainIndex=0 的触发盒。
      if (a.chainIndex != null && a.chainIndex !== 0) continue;
      if (a.chainSize > 1 && a.step != null) {
        if (seenStep[a.step]) continue;
        seenStep[a.step] = true;
      }
      out.push({ r: a.r, c: a.c, color: a.color, count: a.count });
    }
    return out;
  }
  function replayFromState(start, actions) {
    var s = Clone(start), trace = [], maxBuffer = s.buffer.length, sumBuffer = 0;
    for (var i = 0; i < actions.length; i++) {
      if (won(s) || dead(s)) break;
      var a = actions[i];
      if (!Sim.isPickable(s, a.r, a.c)) return { completed: false, replayValid: false, reason: 'illegal_pick@' + i, steps: i, state: s, trace: trace };
      Sim.applyPick(s, a.r, a.c);
      finishFlags(s);
      maxBuffer = Math.max(maxBuffer, s.buffer.length);
      sumBuffer += s.buffer.length;
      trace.push({ step: i + 1, r: a.r, c: a.c, buffer: s.buffer.length, eliminated: s.eliminatedPixels });
    }
    var complete = won(s), isDead = !complete && dead(s);
    return { completed: complete, replayValid: complete || !isDead, reason: complete ? null : (isDead ? 'dead' : 'incomplete'),
      steps: trace.length, maxBuffer: maxBuffer, avgBuffer: trace.length ? +(sumBuffer / trace.length).toFixed(3) : 0,
      eliminatedPixels: s.eliminatedPixels, totalPixels: s.totalPixels, state: s, trace: trace };
  }
  function replay(level, route, opts) {
    var lv = parsed(level), start = create(lv, opts || {});
    var r = replayFromState(start, normalizeActions(route));
    r.actions = normalizeActions(route);
    return r;
  }

  // 包含所有会影响后续合法动作/结算的运行态；不把 pressureSamples/history 等观测字段混入。
  function stateKey(s) {
    var parts = [];
    parts.push(s.eliminated.map(function (row) { return row.map(function (x) { return x ? 1 : 0; }).join(''); }).join('/'));
    parts.push(s.cells.map(function (row) {
      return row.map(function (c) {
        if (!c) return '.';
        if (c.t === 'box') return 'b' + c.color + ':' + c.count + ':' + (c.chain || 0) + ':' + (c.q ? 1 : 0) + ':' + (c.numice || 0);
        if (c.t === 'pipe') return 'p' + c.dir + ':' + c.next + ':' + (c.queue || []).map(function (q) { return q.color + ',' + q.count; }).join(',');
        return c.t || '.';
      }).join(',');
    }).join('/'));
    parts.push(s.buffer.map(function (b) {
      return [b.color, b.progress, b.need, b.link || 0, b.key || 0, b.slot == null ? '-' : b.slot,
        b.start ? b.start.r + ',' + b.start.c : '-', b.enterStep || 0].join(':');
    }).join(','));
    parts.push(Object.keys(s.activated || {}).sort().join(','));
    parts.push(Object.keys(s.removed || {}).sort().join(','));
    parts.push(Object.keys(s.numice || {}).sort().map(function (k) { return k + ':' + s.numice[k].remaining; }).join(','));
    parts.push([s.steps, s.eliminatedPixels, s.completedBoxes, s._linkSeq || 0, s._keySeq || 0, s.overflow ? 1 : 0].join(':'));
    return parts.join('|');
  }
  function score(s) {
    if (won(s)) return 1e12;
    if (dead(s)) return -1e12;
    var moves = Sim.listMoves(s), open = 0;
    for (var i = 0; i < moves.length; i++) if (!moves[i].blocked) open++;
    var pressure = Math.max(0, s.buffer.length - (s.bufferLimit - 2));
    return s.eliminatedPixels * 4 + s.completedBoxes * 20 + open * 3 - s.buffer.length * 24 - pressure * pressure * 90;
  }
  function orderedMoves(s, branchWidth) {
    var moves = Sim.listMoves(s).filter(function (m) { return !m.blocked; });
    // 便宜、确定的预排；真正子态得分在 apply 后再算。full 可消优先不等于永远只吃满。
    moves.sort(function (a, b) {
      if (!!a.canConsume !== !!b.canConsume) return a.canConsume ? -1 : 1;
      var ac = a.antBox ? a.antBox.count : 0, bc = b.antBox ? b.antBox.count : 0;
      if (ac !== bc) return bc - ac;
      if (a.r !== b.r) return a.r - b.r;
      return a.c - b.c;
    });
    return moves.slice(0, Math.max(1, branchWidth || moves.length));
  }
  function searchFromState(start, opts) {
    opts = opts || {};
    var width = Math.max(1, opts.beamWidth || 16), branch = Math.max(1, opts.branchWidth || 8);
    var maxNodes = Math.max(1, opts.maxNodes || 4000), maxRoutes = Math.max(1, opts.maxRoutes || 6);
    var deadline = Date.now() + Math.max(1, opts.timeBudgetMs || 2500);
    var remainingBoxes = Math.max(1, start.totalBoxes - start.completedBoxes + 2);
    var maxDepth = Math.min(remainingBoxes, opts.maxDepth || remainingBoxes);
    var frontier = [{ state: Clone(start), actions: [], maxBuffer: start.buffer.length }];
    var seen = {}; seen[stateKey(start)] = true;
    var routes = [], rejected = [], nodes = 0, exhausted = false, depth = 0;
    function out(reason) {
      return { status: routes.length ? 'solved' : reason, routes: routes, rejectedRoutes: rejected,
        nodes: nodes, depth: depth, budgetExhausted: exhausted, elapsedMs: 0 };
    }
    while (frontier.length && depth < maxDepth && routes.length < maxRoutes) {
      if (Date.now() >= deadline || nodes >= maxNodes) { exhausted = true; break; }
      var children = [];
      depth++;
      for (var ni = 0; ni < frontier.length; ni++) {
        var node = frontier[ni];
        var moves = orderedMoves(node.state, branch);
        for (var mi = 0; mi < moves.length; mi++) {
          if ((nodes & 15) === 0 && (Date.now() >= deadline || nodes >= maxNodes)) { exhausted = true; break; }
          nodes++;
          var childState = Clone(node.state);
          Sim.applyPick(childState, moves[mi].r, moves[mi].c);
          finishFlags(childState);
          var actions = node.actions.concat([actionOf(moves[mi])]);
          var maxBuf = Math.max(node.maxBuffer, childState.buffer.length);
          if (won(childState)) {
            var replayed = replayFromState(start, actions);
            var route = { actions: actions, steps: actions.length, maxBuffer: maxBuf,
              replayValid: !!replayed.completed, eliminatedPixels: childState.eliminatedPixels };
            if (replayed.completed) {
              route.avgBuffer = replayed.avgBuffer;
              routes.push(route);
              if (routes.length >= maxRoutes) break;
            } else rejected.push({ steps: actions.length, reason: replayed.reason || 'replay_failed' });
            continue;
          }
          if (dead(childState)) continue;
          var key = stateKey(childState);
          if (seen[key]) continue;
          seen[key] = true;
          children.push({ state: childState, actions: actions, maxBuffer: maxBuf, score: score(childState) });
        }
        if (exhausted || routes.length >= maxRoutes) break;
      }
      children.sort(function (a, b) { return b.score - a.score; });
      frontier = children.slice(0, width);
    }
    if (!exhausted && (Date.now() >= deadline || nodes >= maxNodes)) exhausted = true;
    return out(exhausted ? 'budget_exhausted' : 'not_found_within_budget');
  }
  function findRoutes(level, opts) {
    opts = opts || {};
    var lv = parsed(level), start = create(lv, opts), t = Date.now();
    var result = searchFromState(start, opts);
    result.elapsedMs = Date.now() - t;
    result.config = { beamWidth: opts.beamWidth || 16, branchWidth: opts.branchWidth || 8,
      maxNodes: opts.maxNodes || 4000, maxRoutes: opts.maxRoutes || 6, timeBudgetMs: opts.timeBudgetMs || 2500 };
    var signatures = {};
    for (var i = 0; i < result.routes.length; i++) {
      var sig = result.routes[i].actions.map(function (a) { return a.r + ',' + a.c; }).join(' ');
      result.routes[i].signature = sig;
      signatures[sig] = true;
    }
    result.distinctRoutes = Object.keys(signatures).length;
    result.initial = { totalBoxes: start.totalBoxes, totalPixels: start.totalPixels, bufferLimit: start.bufferLimit };
    return result;
  }

  function sampleIndices(indices, limit) {
    if (indices.length <= limit) return indices;
    var out = [];
    for (var i = 0; i < limit; i++) {
      var at = limit === 1 ? 0 : Math.round(i * (indices.length - 1) / (limit - 1));
      if (out.indexOf(at) < 0) out.push(at);
    }
    return out;
  }
  function counterfactualFromState(start, actions, opts) {
    opts = opts || {};
    var maxDecisions = Math.max(1, opts.maxDecisionPoints || 4), maxAlts = Math.max(1, opts.maxAlternatives || 2);
    var parent = Clone(start), decisions = [], candidates = [], prefixMax = parent.buffer.length;
    for (var i = 0; i < actions.length; i++) {
      if (won(parent) || dead(parent)) break;
      var moves = Sim.listMoves(parent);
      if (moves.length >= 2) candidates.push({ index: i, moves: moves, state: Clone(parent), prefixMax: prefixMax });
      Sim.applyPick(parent, actions[i].r, actions[i].c);
      finishFlags(parent);
      prefixMax = Math.max(prefixMax, parent.buffer.length);
    }
    var selected = sampleIndices(candidates.map(function (_, i) { return i; }), maxDecisions);
    for (var si = 0; si < selected.length; si++) {
      var point = candidates[selected[si]], chosen = actions[point.index];
      var alternatives = point.moves.filter(function (m) { return !(m.r === chosen.r && m.c === chosen.c); });
      alternatives.sort(function (a, b) {
        if (!!a.canConsume !== !!b.canConsume) return a.canConsume ? -1 : 1;
        if (a.r !== b.r) return a.r - b.r;
        return a.c - b.c;
      });
      var record = { step: point.index + 1, progress: +(point.state.eliminatedPixels / point.state.totalPixels).toFixed(4),
        moves: point.moves.length, chosen: chosen, alternatives: [] };
      for (var ai = 0; ai < alternatives.length && record.alternatives.length < maxAlts; ai++) {
        var m = alternatives[ai], alt = actionOf(m), next = Clone(point.state);
        Sim.applyPick(next, alt.r, alt.c); finishFlags(next);
        var item = { action: alt, canConsume: !!m.canConsume, immediateBuffer: next.buffer.length };
        if (won(next)) {
          item.outcome = 'solved'; item.steps = 1; item.replayValid = true; item.maxBuffer = Math.max(point.prefixMax, next.buffer.length);
        } else if (dead(next)) {
          item.outcome = 'dead'; item.steps = 1; item.replayValid = true;
        } else {
          var searchStartMs = Date.now();
          var searched = searchFromState(next, {
            beamWidth: opts.beamWidth || 12, branchWidth: opts.branchWidth || 6,
            maxNodes: opts.maxNodesPerAlternative || 1200, maxRoutes: 1,
            maxDepth: opts.maxDepth, timeBudgetMs: opts.timePerAlternativeMs || 600
          });
          item.outcome = searched.routes.length ? 'solved' : searched.status;
          item.nodes = searched.nodes; item.elapsedMs = Date.now() - searchStartMs;
          if (searched.routes.length) {
            var continuation = [alt].concat(searched.routes[0].actions);
            var replayed = replayFromState(point.state, continuation);
            item.replayValid = !!replayed.completed;
            if (!replayed.completed) item.outcome = 'replay_failed';
            item.steps = continuation.length; item.maxBuffer = Math.max(point.prefixMax, replayed.maxBuffer || 0);
          }
        }
        record.alternatives.push(item);
      }
      decisions.push(record);
    }
    return { decisions: decisions, candidateDecisionPoints: candidates.length, sampledDecisionPoints: decisions.length };
  }
  function counterfactual(level, route, opts) {
    var lv = parsed(level), start = create(lv, opts || {});
    return counterfactualFromState(start, normalizeActions(route), opts || {});
  }

  function analyze(level, opts) {
    opts = opts || {};
    var lv = parsed(level), t = Date.now(), baseline = null;
    if (opts.includeBaseline !== false) {
      var sr = AntSolver.Solver.solve(lv, { timeBudgetMs: opts.baselineTimeBudgetMs || 10000,
        bottomOnly: !!opts.bottomOnly, instantChain: !!opts.instantChain });
      var br = replay(lv, sr, opts);
      baseline = { completed: !!sr.completed, retryRound: sr.retryRound, replayValid: !!br.completed,
        steps: br.steps, maxBuffer: br.maxBuffer, avgBuffer: br.avgBuffer, pickOrder: sr.pickOrder || [] };
    }
    var multi = findRoutes(lv, opts), chosen = multi.routes.length ? multi.routes[0] : (baseline && baseline.replayValid ? baseline : null);
    var cf = chosen ? counterfactual(lv, chosen, opts) : { decisions: [], reason: 'no_verified_route' };
    return { schema: 'solver-analysis-v1', baseline: baseline, multi: multi, counterfactual: cf,
      elapsedMs: Date.now() - t,
      note: '只读有界搜索；未找到不等于无解，dead 仅用于可直接确认的死局。' };
  }

  return { analyze: analyze, findRoutes: findRoutes, counterfactual: counterfactual,
    replay: replay, replayFromState: replayFromState, stateKey: stateKey, normalizeActions: normalizeActions };
})();
