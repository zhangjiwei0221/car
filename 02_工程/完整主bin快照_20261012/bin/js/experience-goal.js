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
  return { DEFAULTS: DEFAULTS, evaluate: evaluate, releaseDecision: releaseDecision, curveFromTrace: curveFromTrace };
})();
