/** v502 · 用户目标体验：中段暂存3/4、可释放、最终通关。只读评价，不改现有 qGate。 */
var AntSolver = AntSolver || {};
AntSolver.ExperienceGoal = (function () {
  var Sim = AntSolver.Simulator, SA = AntSolver.SolverAnalysis;
  var DEFAULTS = {
    midLo: 0.20, midHi: 0.85, minBuffer34Pct: 50,
    minSignificantReleases: 1, releaseWindow: 4, minReleaseAmplitude: 1,
    maxDecisionStates: 2, maxAlternativesPerState: 3,
    altTimeMs: 350, altMaxNodes: 1200
  };
  function cfg(opts) { return Object.assign({}, DEFAULTS, opts || {}); }
  function parsed(level) { return level && level.rows && level.totalPixels != null && level.board ? level : AntSolver.parseLevel(level); }
  function curveFromTrace(trace, totalPixels, bufferLimit, options) {
    var o = cfg(options), mid34 = 0, mid5 = 0, midN = 0, max5Run = 0, run5 = 0;
    var series = (trace || []).map(function (t) {
      var progress = totalPixels ? t.eliminated / totalPixels : 0, b = t.buffer || 0;
      if (progress >= o.midLo && progress <= o.midHi) {
        midN++; if (b === 3 || b === 4) mid34++; if (b >= 5) mid5++;
        if (b >= 5) { run5++; max5Run = Math.max(max5Run, run5); } else run5 = 0;
      }
      return { buffer: b, progress: progress };
    });
    var pressure = SA.pressureFromSeries(series, bufferLimit || 5);
    return { pressure: pressure, midSteps: midN,
      midBuffer34Pct: midN ? +(mid34 / midN * 100).toFixed(1) : null,
      midBuffer5Pct: midN ? +(mid5 / midN * 100).toFixed(1) : null,
      maxBuffer5Run: max5Run };
  }

  /** 从同一条参考解的高压父状态分叉；找到“有限步内释压且最终通关”才记 found。 */
  function releaseDecision(level, route, opts) {
    var o = cfg(opts), lv = parsed(level), t0 = Date.now();
    var actions = SA.normalizeActions(route), s = Sim.createState(lv, { useSlotStart: true,
      bottomOnly: !!o.bottomOnly, instantChain: !!o.instantChain });
    var stats = { status: 'not_found_within_budget', found: false, decisionsTried: 0, alternativesTried: 0,
      solvedNoRelease: 0, unknownAlternatives: 0, highPressureStates: 0, searchLimited: true, evidence: null };
    function evidenceAt(after, futureActions, beforeBuffer, m, step, progress, source) {
      var replayed = SA.replayFromState(after, futureActions || []);
      if (!replayed.completed) return { completed: false };
      var buffers = [after.buffer.length].concat((replayed.trace || []).slice(0, o.releaseWindow).map(function (x) { return x.buffer; }));
      var minBuffer = Math.min.apply(null, buffers), amplitude = beforeBuffer - minBuffer;
      return { completed: true, amplitude: amplitude, evidence: { referenceStep: step, progress: +progress.toFixed(3),
        beforeBuffer: beforeBuffer, action: { r: m.r, c: m.c, color: m.antBox ? m.antBox.color : null },
        minBufferWithinWindow: minBuffer, releaseAmplitude: amplitude, releaseWindow: o.releaseWindow,
        finalReplayValid: true, routeActions: futureActions.length, source: source,
        choiceContrast: null } };
    }
    for (var i = 0; i < actions.length; i++) {
      if (s.gameWon || s.gameOver) break;
      var a = actions[i];
      if (!Sim.isPickable(s, a.r, a.c)) { stats.status = 'invalid_reference'; return stats; }
      var progress = s.totalPixels ? s.eliminatedPixels / s.totalPixels : 0;
      if (s.buffer.length >= 3 && progress >= o.midLo && progress <= o.midHi && stats.decisionsTried < o.maxDecisionStates) {
        stats.highPressureStates++; stats.decisionsTried++;
        var beforeBuffer = s.buffer.length, moves = Sim.listMoves(s).filter(function (m) { return !m.blocked; });
        // 先验参考动作：后续 suffix 已知可通关，不必再花一次全图搜索。
        moves.sort(function (x, y) {
          var xr = x.r === a.r && x.c === a.c ? 0 : 1, yr = y.r === a.r && y.c === a.c ? 0 : 1;
          return xr - yr;
        });
        moves = moves.slice(0, Math.max(1, o.maxAlternativesPerState));
        for (var mi = 0; mi < moves.length; mi++) {
          stats.alternativesTried++;
          var m = moves[mi], isReference = m.r === a.r && m.c === a.c;
          var after = AntSolver.SolverStrategy.cloneState(s);
          Sim.applyPick(after, m.r, m.c);
          if (after.eliminatedPixels >= after.totalPixels) { after.gameWon = true; after.gameOver = true; }
          var direct = null;
          if (isReference) {
            direct = evidenceAt(after, actions.slice(i + 1), beforeBuffer, m, i + 1, progress, 'reference_action');
            if (direct.completed && direct.amplitude >= o.minReleaseAmplitude) {
              stats.status = 'found'; stats.found = true; stats.evidence = direct.evidence;
              stats.elapsedMs = Date.now() - t0; return stats;
            }
          }
          var searched = SA.searchFromState(after, { timeBudgetMs: o.altTimeMs, maxNodes: o.altMaxNodes,
            beamWidth: 16, branchWidth: 8, maxRoutes: 1 });
          if (!searched.routes.length) {
            if (searched.budgetExhausted) stats.unknownAlternatives++;
            continue;
          }
          var future = searched.routes[0], checked = evidenceAt(after, future.actions, beforeBuffer, m, i + 1, progress,
            isReference ? 'reference_action_resolved' : 'alternative_action');
          if (!checked.completed) continue;
          if (checked.amplitude < o.minReleaseAmplitude) { stats.solvedNoRelease++; continue; }
          stats.status = 'found'; stats.found = true; stats.evidence = checked.evidence;
          stats.elapsedMs = Date.now() - t0; return stats;
        }
      }
      Sim.applyPick(s, a.r, a.c);
      if (s.eliminatedPixels >= s.totalPixels) { s.gameWon = true; s.gameOver = true; }
    }
    if (!stats.highPressureStates) stats.status = 'no_high_pressure_state';
    else if (stats.unknownAlternatives > 0 && stats.solvedNoRelease === 0) stats.status = 'unknown_within_budget';
    stats.elapsedMs = Date.now() - t0; return stats;
  }

  function evaluate(level, opts) {
    opts = opts || {}; var o = cfg(opts), lv = parsed(level), t0 = Date.now();
    var sr = opts.solveResult || AntSolver.Solver.solve(lv, { timeBudgetMs: opts.solveTimeMs || 3000,
      bottomOnly: !!o.bottomOnly, instantChain: !!o.instantChain });
    if (!sr || !sr.completed) return { schema: 'experience-goal-v1', pass: false, status: 'no_verified_solution',
      reasons: ['no_verified_solution'], target: o, elapsedMs: Date.now() - t0 };
    var replayed = SA.replay(lv, sr, o), curve = curveFromTrace(replayed.trace, replayed.totalPixels,
      replayed.state ? replayed.state.bufferLimit : (lv.bufferLimit || 5), o);
    var reasons = [];
    if (!replayed.completed) reasons.push('reference_replay_failed');
    if (curve.midSteps <= 0) reasons.push('mid_steps_missing');
    if (curve.midBuffer34Pct == null || curve.midBuffer34Pct < o.minBuffer34Pct) reasons.push('buffer34_below_' + o.minBuffer34Pct);
    if ((curve.pressure.significantReleaseCount || 0) < o.minSignificantReleases) reasons.push('significant_release_missing');
    var curvePass = reasons.length === 0;
    var decision = opts.decision ? releaseDecision(lv, sr, o) : null;
    if (opts.decision && (!decision || !decision.found)) reasons.push('release_decision_' + (decision ? decision.status : 'missing'));
    var pass = curvePass && (!opts.decision || !!(decision && decision.found));
    var unknown = curvePass && opts.decision && decision && decision.status === 'unknown_within_budget';
    var distance = Math.max(0, o.minBuffer34Pct - (curve.midBuffer34Pct || 0)) +
      Math.max(0, o.minSignificantReleases - (curve.pressure.significantReleaseCount || 0)) * 25 +
      (opts.decision && !(decision && decision.found) ? 25 : 0);
    return { schema: 'experience-goal-v1', pass: pass, curvePass: curvePass,
      status: pass ? 'pass' : (unknown ? 'unknown' : 'fail'), reasons: reasons,
      target: { midLo: o.midLo, midHi: o.midHi, minBuffer34Pct: o.minBuffer34Pct,
        minSignificantReleases: o.minSignificantReleases, releaseWindow: o.releaseWindow,
        minReleaseAmplitude: o.minReleaseAmplitude },
      metrics: { midSteps: curve.midSteps, midBuffer34Pct: curve.midBuffer34Pct,
        midBuffer5Pct: curve.midBuffer5Pct, maxBuffer5Run: curve.maxBuffer5Run,
        significantReleaseCount: curve.pressure.significantReleaseCount,
        oscillationCount: curve.pressure.oscillationCount,
        lateHighPressurePct: curve.pressure.lateHighPressurePct,
        maxBuffer: curve.pressure.maxBuffer, distance: +distance.toFixed(1) },
      releaseDecision: decision, pressure: curve.pressure,
      nearMiss: !!replayed.completed && (curve.midBuffer34Pct || 0) >= Math.max(0, o.minBuffer34Pct - 20),
      elapsedMs: Date.now() - t0 };
  }
  /** v507：两条已知路线首次分岔的同父状态对照；不把低压力直接命名为聪明。 */
  function routeChoiceContrast(level, baselineRoute, lowRoute, opts) {
    opts = opts || {}; var lv = parsed(level), Sim = AntSolver.Simulator;
    var a = SA.normalizeActions(baselineRoute), b = SA.normalizeActions(lowRoute), n = Math.min(a.length, b.length), at = -1;
    for (var i = 0; i < n; i++) if (a[i].r !== b[i].r || a[i].c !== b[i].c) { at = i; break; }
    if (at < 0) return { status: 'no_divergence' };
    var s = Sim.createState(lv, { useSlotStart: true, bottomOnly: !!opts.bottomOnly, instantChain: !!opts.instantChain });
    for (var j = 0; j < at; j++) { if (!Sim.isPickable(s, a[j].r, a[j].c)) return { status: 'invalid_prefix', step: j + 1 }; Sim.applyPick(s, a[j].r, a[j].c); }
    function inspect(m) {
      if (!m) return { legal: false };
      var cell = s.cells[m.r] && s.cells[m.r][m.c], after = AntSolver.SolverStrategy.cloneState(s), beforeE = s.eliminatedPixels, beforeB = s.buffer.length;
      Sim.applyPick(after, m.r, m.c);
      return { legal: true, r: m.r, c: m.c, color: m.antBox ? m.antBox.color : cell && cell.color,
        count: m.antBox ? m.antBox.count : cell && cell.count, canConsume: !!m.canConsume,
        q: !!(cell && cell.q), numice: (cell && cell.numice) || 0, chain: (cell && cell.chain) || 0,
        immediateEliminated: after.eliminatedPixels - beforeE, bufferBefore: beforeB, bufferAfter: after.buffer.length,
        overflow: !!after.overflow };
    }
    var moves = Sim.listMoves(s), baseMove = null, lowMove = null;
    for (var mi = 0; mi < moves.length; mi++) {
      var m = moves[mi]; if (m.blocked) continue;
      if (m.r === a[at].r && m.c === a[at].c) baseMove = m;
      if (m.r === b[at].r && m.c === b[at].c) lowMove = m;
    }
    var base = inspect(baseMove), low = inspect(lowMove), baselinePct = opts.baselineBuffer34Pct, lowPct = opts.lowBuffer34Pct;
    var pressureDrop = baselinePct != null && lowPct != null ? +(baselinePct - lowPct).toFixed(1) : null;
    return { status: base.legal && low.legal ? 'compared' : 'missing_legal_action', step: at + 1,
      progress: s.totalPixels ? +(s.eliminatedPixels / s.totalPixels).toFixed(3) : null,
      parentBuffer: s.buffer.length, baselineAction: base, lowAction: low, pressureDropPp: pressureDrop,
      immediateYieldRelation: base.immediateEliminated == null || low.immediateEliminated == null ? null :
        (low.immediateEliminated < base.immediateEliminated ? 'lower_short_term' : (low.immediateEliminated > base.immediateEliminated ? 'higher_short_term' : 'equal')),
      planningLikeCandidate: !!(base.legal && low.legal && pressureDrop >= 20 && low.immediateEliminated <= base.immediateEliminated && !low.q),
      obviousBypassCandidate: !!(base.legal && low.legal && pressureDrop >= 20 &&
        ((low.canConsume && !base.canConsume) || low.immediateEliminated > base.immediateEliminated)),
      note: '仅描述分岔证据；planningLike/obviousBypass都需玩家模型或真人复核。' };
  }

  /** v506：baseline + 有界多路线；bestVerified 不是全局最优，未找到不证明不存在。 */
  function evaluateRoutes(level, opts) {
    opts = opts || {}; var lv = parsed(level), t0 = Date.now();
    var baseline = opts.solveResult || AntSolver.Solver.solve(lv, { timeBudgetMs: opts.solveTimeMs || 3000,
      bottomOnly: !!opts.bottomOnly, instantChain: !!opts.instantChain });
    var routes = [], seen = {};
    function add(route, source) {
      if (!route) return;
      var actions = SA.normalizeActions(route); if (!actions.length) return;
      var sig = actions.map(function (a) { return a.r + ',' + a.c; }).join(' ');
      if (seen[sig]) return; seen[sig] = true;
      routes.push({ route: Object.assign({}, route, { completed: true, actions: actions, pickOrder: actions }), source: source, signature: sig });
    }
    if (baseline && baseline.completed) add(baseline, 'baseline');
    var multi = null;
    if (opts.multi !== false) {
      multi = SA.findRoutes(lv, { timeBudgetMs: opts.multiTimeMs || 4000, maxNodes: opts.multiNodes || 6000,
        beamWidth: opts.beamWidth || 24, branchWidth: opts.branchWidth || 8, maxRoutes: opts.maxRoutes || 6 });
      for (var i = 0; i < multi.routes.length; i++) if (multi.routes[i].replayValid) add(multi.routes[i], 'beam');
    }
    var evaluations = [], best = null;
    for (var ri = 0; ri < routes.length; ri++) {
      var item = routes[ri], quick = evaluate(lv, Object.assign({}, opts, { solveResult: item.route, decision: false }));
      var rec = { source: item.source, signature: item.signature, quick: quick, full: null };
      if (quick.curvePass) {
        rec.full = evaluate(lv, Object.assign({}, opts, { solveResult: item.route, decision: true }));
        if (rec.full.pass && (!best || !best.full || !best.full.pass)) best = rec;
      }
      if (!best) {
        if (!best || (quick.metrics && quick.metrics.distance < best.quick.metrics.distance)) best = rec;
      } else if (!best.full || !best.full.pass) {
        var currentScore = best.full && best.full.curvePass ? 1 : 0;
        if ((quick.curvePass ? 1 : 0) > currentScore) best = rec;
      }
      evaluations.push(rec);
    }
    if (!best && evaluations.length) best = evaluations[0];
    var pcts = evaluations.map(function (x) { return x.quick && x.quick.metrics && x.quick.metrics.midBuffer34Pct; })
      .filter(function (x) { return typeof x === 'number'; });
    var minPct = pcts.length ? Math.min.apply(null, pcts) : null, maxPct = pcts.length ? Math.max.apply(null, pcts) : null;
    var lowRoute = null, baselineEval = evaluations.length ? evaluations[0] : null;
    for (var di = 0; di < evaluations.length; di++) {
      var cand = evaluations[di], pct = cand.quick && cand.quick.metrics && cand.quick.metrics.midBuffer34Pct;
      if (pct != null && (!lowRoute || pct < lowRoute.quick.metrics.midBuffer34Pct)) lowRoute = cand;
    }
    function divergence(other) {
      if (!baselineEval || !other) return null;
      var aa = baselineEval.signature.split(' '), bb = other.signature.split(' '), n = Math.min(aa.length, bb.length);
      for (var j = 0; j < n; j++) if (aa[j] !== bb[j]) return { step: j + 1, from: aa[j], to: bb[j] };
      return null;
    }
    var distribution = { minBuffer34Pct: minPct, maxBuffer34Pct: maxPct,
      spreadPp: minPct != null && maxPct != null ? +(maxPct - minPct).toFixed(1) : null,
      lowPressureRoute: lowRoute ? { source: lowRoute.source, midBuffer34Pct: lowRoute.quick.metrics.midBuffer34Pct,
        significantReleaseCount: lowRoute.quick.metrics.significantReleaseCount,
        firstDivergence: divergence(lowRoute),
        choiceContrast: (function () {
          var lowInternal = null;
          for (var li = 0; li < routes.length; li++) if (routes[li].signature === lowRoute.signature) { lowInternal = routes[li]; break; }
          return lowInternal && routes.length ? routeChoiceContrast(lv, routes[0].route, lowInternal.route, Object.assign({}, opts, {
            baselineBuffer34Pct: baselineEval.quick.metrics.midBuffer34Pct,
            lowBuffer34Pct: lowRoute.quick.metrics.midBuffer34Pct })) : null;
        })() } : null,
      note: '低压力路线可能代表聪明解法，不自动判为关卡缺陷；明显性仍需玩家模型/真人判断。' };
    return { schema: 'experience-routes-v1', pass: !!(best && best.full && best.full.pass),
      routeDistribution: distribution,
      status: best && best.full && best.full.pass ? 'pass' : (routes.length ? 'not_passed_within_budget' : 'no_verified_route'),
      bestVerified: best, routes: evaluations, routeCount: routes.length,
      multi: multi ? { status: multi.status, routes: multi.routes.length, distinctRoutes: multi.distinctRoutes,
        nodes: multi.nodes, budgetExhausted: multi.budgetExhausted, elapsedMs: multi.elapsedMs } : null,
      searchLimited: true, isProvenGlobalBest: false, elapsedMs: Date.now() - t0,
      note: 'bestVerified仅当前已验证路线最佳；预算内未通过不证明所有路线均不满足。' };
  }

  function diagnose(ev, structuralPass) {
    if (!ev || ev.status === 'no_verified_solution') return { primary: 'no_verified_solution', action: 'repair_structure', flags: [] };
    var m = ev.metrics || {}, flags = [], target = ev.target && ev.target.minBuffer34Pct != null ? ev.target.minBuffer34Pct : 50;
    if (m.maxBuffer >= 5 || (m.midBuffer5Pct || 0) > 0) flags.push('top_pressure');
    if ((m.lateHighPressurePct || 0) >= 50) flags.push('late_pressure_risk');
    if ((m.maxBuffer5Run || 0) >= 2) flags.push('critical_run');
    var releaseStatus = ev.releaseDecision && ev.releaseDecision.status;
    var out = { primary: null, action: null, flags: flags,
      pressureDeficit: Math.max(0, target - (m.midBuffer34Pct || 0)),
      releaseCurveMissing: (m.significantReleaseCount || 0) < 1,
      releaseDecisionStatus: releaseStatus || 'not_evaluated' };
    if (structuralPass === false) { out.primary = 'structure_gate_failed'; out.action = 'repair_structure'; }
    else if ((m.midBuffer34Pct || 0) < Math.max(0, target - 20)) { out.primary = 'far_pressure_deficit'; out.action = 'regenerate_base'; }
    else if (out.releaseCurveMissing) { out.primary = 'release_curve_missing'; out.action = 'repair_release_supply'; }
    else if ((m.midBuffer34Pct || 0) < target) { out.primary = 'near_pressure_deficit'; out.action = 'tune_capacity'; }
    else if (releaseStatus === 'unknown_within_budget') { out.primary = 'release_unknown'; out.action = 'increase_release_budget'; }
    else if (releaseStatus !== 'found') { out.primary = 'release_decision_missing'; out.action = 'repair_release_choice'; }
    else { out.primary = ev.pass ? 'pass' : 'inspect_remaining_target'; out.action = ev.pass ? 'done' : 'inspect_target'; }
    return out;
  }
  return { DEFAULTS: DEFAULTS, evaluate: evaluate, releaseDecision: releaseDecision, evaluateRoutes: evaluateRoutes, routeChoiceContrast: routeChoiceContrast, curveFromTrace: curveFromTrace, diagnose: diagnose };
})();
