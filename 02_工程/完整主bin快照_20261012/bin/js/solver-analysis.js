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
  function score(s, moves) {
    if (won(s)) return 1e12;
    if (dead(s)) return -1e12;
    moves = moves || Sim.listMoves(s);
    var open = 0;
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
          // v486：原子节点的死活与评分共用一次 listMoves。
          // finishFlags 已处理 won/overflow；isDeadEnd 的剩余语义就是没有任何非阻塞动作。
          var nextMoves = Sim.listMoves(childState), hasLegal = false;
          for (var lm = 0; lm < nextMoves.length; lm++) if (!nextMoves[lm].blocked) { hasLegal = true; break; }
          if (!hasLegal) continue;
          var key = stateKey(childState);
          if (seen[key]) continue;
          seen[key] = true;
          children.push({ state: childState, actions: actions, maxBuffer: maxBuf, score: score(childState, nextMoves) });
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

  // v485：预算自适应实验。coverage 少升档；pressure 为更低压力积极升档。
  // 默认不接 analyze，先与固定 standard/deep 做全题库对照，避免“自适应”名义下更贵或丢解。
  function findRoutesAdaptive(level, opts) {
    opts = opts || {};
    var profile = opts.profile === 'pressure' ? 'pressure' : 'coverage';
    var targetRoutes = Math.max(1, opts.targetRoutes || 4), pressureFloor = opts.pressureFloor == null ? 1 : opts.pressureFloor;
    var tiers = opts.tiers || [
      { name: 'standard', timeBudgetMs: 3000, maxNodes: 6000, beamWidth: 16, branchWidth: 8, maxRoutes: 6 },
      { name: 'deep', timeBudgetMs: 8000, maxNodes: 15000, beamWidth: 24, branchWidth: 8, maxRoutes: 8 }
    ];
    var allRoutes = [], seen = {}, attempts = [], totalNodes = 0, t0 = Date.now(), finalStatus = 'not_found_within_budget';
    for (var ti = 0; ti < tiers.length; ti++) {
      var tier = tiers[ti], r = findRoutes(level, tier), best = null;
      totalNodes += r.nodes; finalStatus = r.status;
      for (var ri = 0; ri < r.routes.length; ri++) {
        var route = r.routes[ri], sig = route.signature || route.actions.map(function (a) { return a.r + ',' + a.c; }).join(' ');
        if (!seen[sig]) { seen[sig] = true; route.sourceTier = tier.name; allRoutes.push(route); }
        if (route.replayValid && (best == null || route.maxBuffer < best)) best = route.maxBuffer;
      }
      attempts.push({ tier: tier.name, status: r.status, routes: r.routes.length, newRoutes: allRoutes.length,
        bestMaxBuffer: best, nodes: r.nodes, elapsedMs: r.elapsedMs });
      var enough = allRoutes.length >= targetRoutes, last = ti === tiers.length - 1;
      if (last) break;
      var escalate;
      if (profile === 'coverage') {
        // 覆盖优先：已有足够路线就停；接受可能漏掉更低压力解，报告必须保留这一边界。
        escalate = !enough;
      } else {
        // 压力优先：路线不足、达到单档路线上限且仍有压力空间，或当前最好没有明显优于 baseline 时升档。
        var hitCap = r.routes.length >= (tier.maxRoutes || 6);
        var base = opts.baselineMaxBuffer;
        var noClearImprovement = base != null && (best == null || base - best <= 1);
        escalate = !enough || (hitCap && (best == null || best > pressureFloor)) || noClearImprovement;
        if (best != null && best <= pressureFloor && enough) escalate = false;
      }
      if (!escalate) break;
    }
    var bestKnown = null;
    for (var i = 0; i < allRoutes.length; i++) if (allRoutes[i].replayValid && (bestKnown == null || allRoutes[i].maxBuffer < bestKnown)) bestKnown = allRoutes[i].maxBuffer;
    return { status: allRoutes.length ? 'solved' : finalStatus, routes: allRoutes,
      distinctRoutes: Object.keys(seen).length, bestMaxBuffer: bestKnown,
      nodes: totalNodes, elapsedMs: Date.now() - t0, attempts: attempts,
      config: { adaptive: true, profile: profile, targetRoutes: targetRoutes, pressureFloor: pressureFloor },
      budgetExhausted: finalStatus === 'budget_exhausted', rejectedRoutes: [] };
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
  function decisionFeatures(point) {
    var full = 0, partial = 0, blocked = 0;
    for (var i = 0; i < point.moves.length; i++) {
      var m = point.moves[i];
      if (m.blocked) blocked++;
      if (m.canConsume) full++; else partial++;
    }
    var progress = point.state.totalPixels ? point.state.eliminatedPixels / point.state.totalPixels : 0;
    var bufferPct = point.state.bufferLimit ? point.state.buffer.length / point.state.bufferLimit : 0;
    var mixed = full > 0 && partial > 0;
    var score = bufferPct * 4 + Math.min(point.moves.length, 6) * 0.25;
    if (progress >= 0.2 && progress <= 0.85) score += 2;
    else if (progress < 0.08 || progress > 0.96) score -= 1;
    if (mixed) score += 4; else if (partial > 0) score += 2;
    if (full === 0) score += 1;
    return { progress: progress, buffer: point.state.buffer.length, bufferPct: bufferPct,
      fullCount: full, partialCount: partial, blockedCount: blocked, mixed: mixed, valueScore: score };
  }
  function alternativeValue(move, chosenMove, decisionScore) {
    var score = decisionScore;
    if (chosenMove && !!move.canConsume !== !!chosenMove.canConsume) score += 4;
    score += move.canConsume ? 1 : 2;
    if ((move.groupSize || 1) > 1) score += 1;
    if (move.blocked) score -= 3;
    return score;
  }
  function valueBudget(value, opts) {
    var baseMs = opts.timePerAlternativeMs || 1000, baseNodes = opts.maxNodesPerAlternative || 2200;
    var factor = 0.45 + value * 0.07;
    return { timeBudgetMs: Math.round(Math.max(baseMs * 0.4, Math.min(baseMs * 1.8, baseMs * factor))),
      maxNodes: Math.round(Math.max(baseNodes * 0.35, Math.min(baseNodes * 2, baseNodes * (0.45 + value * 0.08)))) };
  }

  function counterfactualFromState(start, actions, opts) {
    opts = opts || {};
    var maxDecisions = Math.max(1, opts.maxDecisionPoints || 4), maxAlts = Math.max(1, opts.maxAlternatives || 2);
    var policy = opts.decisionPolicy === 'value' ? 'value' : 'uniform';
    var parent = Clone(start), decisions = [], candidates = [], prefixMax = parent.buffer.length;
    for (var i = 0; i < actions.length; i++) {
      if (won(parent) || dead(parent)) break;
      var moves = Sim.listMoves(parent);
      if (moves.length >= 2) {
        var point = { index: i, moves: moves, state: Clone(parent), prefixMax: prefixMax };
        point.features = decisionFeatures(point);
        candidates.push(point);
      }
      Sim.applyPick(parent, actions[i].r, actions[i].c);
      finishFlags(parent);
      prefixMax = Math.max(prefixMax, parent.buffer.length);
    }
    var selected;
    if (policy === 'value') {
      selected = candidates.map(function (_, i) { return i; });
      selected.sort(function (a, b) {
        var d = candidates[b].features.valueScore - candidates[a].features.valueScore;
        return d || candidates[a].index - candidates[b].index;
      });
      selected = selected.slice(0, maxDecisions).sort(function (a, b) { return candidates[a].index - candidates[b].index; });
    } else selected = sampleIndices(candidates.map(function (_, i) { return i; }), maxDecisions);
    for (var si = 0; si < selected.length; si++) {
      var point = candidates[selected[si]], chosen = actions[point.index];
      var chosenMove = null;
      for (var cm = 0; cm < point.moves.length; cm++) if (point.moves[cm].r === chosen.r && point.moves[cm].c === chosen.c) { chosenMove = point.moves[cm]; break; }
      var alternatives = point.moves.filter(function (m) { return !(m.r === chosen.r && m.c === chosen.c); });
      alternatives.sort(function (a, b) {
        if (policy === 'value') {
          var vd = alternativeValue(b, chosenMove, point.features.valueScore) - alternativeValue(a, chosenMove, point.features.valueScore);
          if (vd) return vd;
        } else if (!!a.canConsume !== !!b.canConsume) return a.canConsume ? -1 : 1;
        if (a.r !== b.r) return a.r - b.r;
        return a.c - b.c;
      });
      var record = { step: point.index + 1, progress: +(point.state.eliminatedPixels / point.state.totalPixels).toFixed(4),
        moves: point.moves.length, chosen: chosen, features: point.features, alternatives: [] };
      for (var ai = 0; ai < alternatives.length && record.alternatives.length < maxAlts; ai++) {
        var m = alternatives[ai], alt = actionOf(m), next = Clone(point.state);
        Sim.applyPick(next, alt.r, alt.c); finishFlags(next);
        var altValue = alternativeValue(m, chosenMove, point.features.valueScore);
        var budget = policy === 'value' ? valueBudget(altValue, opts) : null;
        var item = { action: alt, canConsume: !!m.canConsume, immediateBuffer: next.buffer.length,
          valueScore: policy === 'value' ? altValue : null, budgetMs: budget ? budget.timeBudgetMs : (opts.timePerAlternativeMs || 600),
          budgetNodes: budget ? budget.maxNodes : (opts.maxNodesPerAlternative || 1200) };
        if (won(next)) {
          item.outcome = 'solved'; item.steps = 1; item.replayValid = true; item.maxBuffer = Math.max(point.prefixMax, next.buffer.length);
        } else if (dead(next)) {
          item.outcome = 'dead'; item.steps = 1; item.replayValid = true;
        } else {
          var searchStartMs = Date.now();
          var searched = searchFromState(next, {
            beamWidth: opts.beamWidth || 12, branchWidth: opts.branchWidth || 6,
            maxNodes: budget ? budget.maxNodes : (opts.maxNodesPerAlternative || 1200), maxRoutes: 1,
            maxDepth: opts.maxDepth, timeBudgetMs: budget ? budget.timeBudgetMs : (opts.timePerAlternativeMs || 600)
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
    return { policy: policy, decisions: decisions, candidateDecisionPoints: candidates.length, sampledDecisionPoints: decisions.length };
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
    var multi = findRoutes(lv, opts);
    // v484：beam 单档最低峰值可能高于旧 Solver，必须合并所有已验证路线再选 bestKnown。
    var verifiedRoutes = [], seenRoutes = {};
    function addRoute(route, source, replayed) {
      if (!route) return;
      var actions = normalizeActions(route);
      if (!actions.length) return;
      var sig = actions.map(function (a) { return a.r + ',' + a.c; }).join(' ');
      if (seenRoutes[sig]) return;
      seenRoutes[sig] = true;
      verifiedRoutes.push({ source: source, actions: actions, steps: actions.length,
        maxBuffer: route.maxBuffer, avgBuffer: route.avgBuffer,
        replayValid: source === 'baseline' ? !!(replayed && replayed.completed) : !!route.replayValid,
        signature: sig });
    }
    if (baseline && baseline.replayValid) addRoute(baseline, 'baseline', br);
    for (var ri = 0; ri < multi.routes.length; ri++) addRoute(multi.routes[ri], 'beam');
    verifiedRoutes = verifiedRoutes.filter(function (r) { return r.replayValid && r.maxBuffer != null; });
    verifiedRoutes.sort(function (a, b) {
      if (a.maxBuffer !== b.maxBuffer) return a.maxBuffer - b.maxBuffer;
      if (a.steps !== b.steps) return a.steps - b.steps;
      return a.source === 'baseline' ? -1 : 1;
    });
    var chosen = verifiedRoutes.length ? verifiedRoutes[0] : null;
    var bestKnown = chosen ? { maxBuffer: chosen.maxBuffer, source: chosen.source,
      verifiedRoutes: verifiedRoutes.length, isProvenMinimum: false } : null;
    var cf = chosen ? counterfactual(lv, chosen, opts) : { decisions: [], reason: 'no_verified_route' };
    return { schema: 'solver-analysis-v2', baseline: baseline, multi: multi,
      verifiedRoutes: verifiedRoutes, bestKnown: bestKnown, counterfactualRoute: chosen ? { source: chosen.source, maxBuffer: chosen.maxBuffer, signature: chosen.signature } : null,
      counterfactual: cf, elapsedMs: Date.now() - t,
      note: 'bestKnown 仅是当前已验证路线的最好，不证明全局最低；未找到不等于无解。' };
  }

  return { analyze: analyze, findRoutes: findRoutes, findRoutesAdaptive: findRoutesAdaptive, counterfactual: counterfactual,
    replay: replay, replayFromState: replayFromState, stateKey: stateKey, normalizeActions: normalizeActions };
})();
