/** v535：从参考路线的高压父状态构造完整、可独立回放的释放路线。只读模块，不参与默认生成。 */
var AntSolver = AntSolver || {};
AntSolver.ReleaseRouteConstructor = (function () {
  var Sim = AntSolver.Simulator, SA = AntSolver.SolverAnalysis, EG = AntSolver.ExperienceGoal;
  var DEFAULTS = {
    midLo: 0.20, midHi: 0.85, minBuffer: 3,
    maxAlternativesPerState: 8, timePerAlternativeMs: 900, maxNodes: 3000,
    beamWidth: 16, branchWidth: 8, maxUniqueCandidates: 160,
    overallTimeBudgetMs: 180000, minBuffer34Pct: 50,
    minSignificantReleases: 1, maxAcceptedBuffer: 4,
    targetMidProgress: 0.60, stopAfterFirstPass: true
  };

  function cfg(opts) {
    var o = Object.assign({}, DEFAULTS, opts || {});
    o.midLo = Math.max(0, Math.min(1, +o.midLo));
    o.midHi = Math.max(o.midLo, Math.min(1, +o.midHi));
    return o;
  }
  function parsed(level) {
    return level && level.rows && level.totalPixels != null && level.board ? level : AntSolver.parseLevel(level);
  }
  function sigOf(actions) {
    return (actions || []).map(function (a) { return a.r + ',' + a.c; }).join(' ');
  }
  function actionOf(m) {
    return { r: m.r, c: m.c, color: m.antBox ? m.antBox.color : null, count: m.antBox ? m.antBox.count : null };
  }
  function pctRank(sorted, p) {
    if (!sorted.length) return null;
    var i = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1));
    return sorted[i];
  }
  function metricsOf(level, actions, opts) {
    var lv = parsed(level);
    var start = Sim.createState(lv, { useSlotStart: true, instantChain: true });
    var replayed = SA.replayFromState(start, actions);
    if (!replayed.completed) return { finalReplayValid: false, replayReason: replayed.reason || 'incomplete' };
    var curve = EG.curveFromTrace(replayed.trace, replayed.totalPixels,
      replayed.state ? replayed.state.bufferLimit : (lv.bufferLimit || 5), { instantChain: true });
    var significant = (curve.pressure.releaseEvents || []).filter(function (e) {
      return (e.amplitude || 0) >= 2;
    });
    return {
      finalReplayValid: true, replaySteps: replayed.steps,
      midBuffer34Pct: curve.midBuffer34Pct,
      maxBuffer: curve.pressure.maxBuffer,
      significantReleaseCount: curve.pressure.significantReleaseCount,
      significantReleaseEvents: significant,
      firstSignificantRelease: significant[0] || null,
      pressure: curve.pressure
    };
  }
  function passOf(metrics, o) {
    return !!(metrics.finalReplayValid &&
      (metrics.midBuffer34Pct || 0) >= o.minBuffer34Pct &&
      (metrics.significantReleaseCount || 0) >= o.minSignificantReleases);
  }
  function better(a, b, o) {
    if (!b) return true;
    var ap = passOf(a, o) ? 1 : 0, bp = passOf(b, o) ? 1 : 0;
    if (ap !== bp) return ap > bp;
    var ab = a.maxBuffer <= o.maxAcceptedBuffer ? 1 : 0;
    var bb = b.maxBuffer <= o.maxAcceptedBuffer ? 1 : 0;
    if (ab !== bb) return ab > bb;
    if ((a.significantReleaseCount || 0) !== (b.significantReleaseCount || 0))
      return (a.significantReleaseCount || 0) > (b.significantReleaseCount || 0);
    if ((a.midBuffer34Pct || 0) !== (b.midBuffer34Pct || 0))
      return (a.midBuffer34Pct || 0) > (b.midBuffer34Pct || 0);
    if ((a.maxBuffer || 0) !== (b.maxBuffer || 0)) return (a.maxBuffer || 0) < (b.maxBuffer || 0);
    return (a.fullSteps || 0) < (b.fullSteps || 0);
  }
  function candidateOf(level, source, actions, meta, o) {
    var metrics = metricsOf(level, actions, o);
    if (!metrics.finalReplayValid) return null;
    return Object.assign({
      source: source, fullSteps: actions.length, fullSig: sigOf(actions),
      finalReplayValid: true, midBuffer34Pct: metrics.midBuffer34Pct,
      maxBuffer: metrics.maxBuffer, significantReleaseCount: metrics.significantReleaseCount,
      firstSignificantRelease: metrics.firstSignificantRelease,
      pass: passOf(metrics, o)
    }, meta || {});
  }
  function collectFromSource(level, source, state, o, seen, out) {
    var lv = parsed(level);
    var actions = SA.normalizeActions(source.pickOrder || source.route || source.actions || []);
    var s = Sim.createState(lv, { useSlotStart: true, instantChain: true });
    var snapshots = [];
    for (var i = 0; i < actions.length; i++) {
      if (Date.now() >= state.deadline || s.gameWon || s.gameOver) break;
      var ref = actions[i];
      if (!Sim.isPickable(s, ref.r, ref.c)) {
        state.invalidSources.push({ source: source.name, step: i + 1, reason: 'illegal_reference_pick' });
        break;
      }
      var progress = s.totalPixels ? s.eliminatedPixels / s.totalPixels : 0;
      if (s.buffer.length >= o.minBuffer && progress >= o.midLo && progress <= o.midHi) {
        snapshots.push({ step: i + 1, progress: progress, buffer: s.buffer.length,
          state: AntSolver.SolverStrategy.cloneState(s), ref: ref, prefix: actions.slice(0, i) });
      }
      Sim.applyPick(s, ref.r, ref.c);
      if (s.eliminatedPixels >= s.totalPixels) { s.gameWon = true; s.gameOver = true; }
    }
    snapshots.sort(function (a, b) {
      var ad = Math.abs(a.progress - o.targetMidProgress);
      var bd = Math.abs(b.progress - o.targetMidProgress);
      return ad - bd || Math.abs(b.buffer - 4) - Math.abs(a.buffer - 4) || b.progress - a.progress;
    });
    for (var si = 0; si < snapshots.length; si++) {
      if (Date.now() >= state.deadline || state.unique >= o.maxUniqueCandidates) {
        state.budgetExhausted = true;
        break;
      }
      if (o.stopAfterFirstPass && state.best && passOf(state.best, o)) break;
      var snap = snapshots[si];
      state.highPressureStates++;
      var moves = Sim.listMoves(snap.state).filter(function (m) { return !m.blocked; });
      var ranked = moves.map(function (m) {
        var after = AntSolver.SolverStrategy.cloneState(snap.state);
        Sim.applyPick(after, m.r, m.c);
        if (after.eliminatedPixels >= after.totalPixels) {
          after.gameWon = true; after.gameOver = true;
        }
        return { m: m, after: after, debtGain: after.buffer.length - snap.buffer,
          changed: !(m.r === snap.ref.r && m.c === snap.ref.c) };
      });
      ranked.sort(function (a, b) {
        return (b.debtGain - a.debtGain) || (b.changed - a.changed) ||
          (b.after.buffer.length - a.after.buffer.length) || (a.m.r - b.m.r) || (a.m.c - b.m.c);
      });
      ranked = ranked.slice(0, Math.max(1, o.maxAlternativesPerState));
      for (var mi = 0; mi < ranked.length; mi++) {
        if (Date.now() >= state.deadline || state.unique >= o.maxUniqueCandidates) {
          state.budgetExhausted = true;
          break;
        }
        var item = ranked[mi], m = item.m, after = item.after;
        var t0 = Date.now(), suffix = [], searched = null;
        if (!after.gameWon) {
          searched = SA.searchFromState(after, {
            timeBudgetMs: o.timePerAlternativeMs, maxNodes: o.maxNodes,
            beamWidth: o.beamWidth, branchWidth: o.branchWidth, maxRoutes: 1
          });
          if (!searched.routes.length) {
            state.tested++;
            state.searchMs.push(Date.now() - t0);
            continue;
          }
          suffix = searched.routes[0].actions || [];
        }
        var full = snap.prefix.concat([actionOf(m)], suffix);
        var sig = sigOf(full);
        state.tested++;
        state.searchMs.push(Date.now() - t0);
        if (seen[sig]) {
          state.duplicates++;
          continue;
        }
        seen[sig] = true;
        var divergence = null;
        for (var di = 0; di < Math.min(full.length, actions.length); di++) {
          if (full[di].r !== actions[di].r || full[di].c !== actions[di].c) {
            divergence = { step: di + 1, reference: { r: actions[di].r, c: actions[di].c },
              constructed: { r: full[di].r, c: full[di].c } };
            break;
          }
        }
        var candidate = candidateOf(level, source.name, full, {
          step: snap.step, progress: +snap.progress.toFixed(3),
          action: actionOf(m), referenceAction: { r: snap.ref.r, c: snap.ref.c },
          changedAction: item.changed, divergence: divergence,
          searchNodes: searched ? searched.nodes : 0,
          searchStatus: searched ? searched.status : 'direct_win',
          searchElapsedMs: Date.now() - t0
        }, o);
        if (!candidate) {
          state.replayRejected++;
          continue;
        }
        out.push(candidate);
        state.unique++;
        if (better(candidate, state.best, o)) state.best = candidate;
        if (o.stopAfterFirstPass && candidate.pass) break;
      }
    }
  }
  function construct(level, sources, opts) {
    var o = cfg(opts), t0 = Date.now(), out = [], seen = {};
    var state = {
      deadline: t0 + Math.max(1, o.overallTimeBudgetMs), tested: 0, unique: 0,
      duplicates: 0, replayRejected: 0, highPressureStates: 0,
      invalidSources: [], searchMs: [], best: null, budgetExhausted: false
    };
    var input = (sources || []).slice().sort(function (a, b) {
      var am = metricsOf(level, SA.normalizeActions(a.pickOrder || a.route || a.actions || []), o);
      var bm = metricsOf(level, SA.normalizeActions(b.pickOrder || b.route || b.actions || []), o);
      return (bm.midBuffer34Pct || 0) - (am.midBuffer34Pct || 0);
    });
    var sourceBaselines = [];
    for (var si = 0; si < input.length; si++) {
      var sourceActions = SA.normalizeActions(input[si].pickOrder || input[si].route || input[si].actions || []);
      var refCandidate = candidateOf(level, input[si].name, sourceActions, { kind: 'reference' }, o);
      sourceBaselines.push({ source: input[si].name, steps: sourceActions.length,
        midBuffer34Pct: refCandidate && refCandidate.midBuffer34Pct,
        maxBuffer: refCandidate && refCandidate.maxBuffer,
        significantReleaseCount: refCandidate && refCandidate.significantReleaseCount,
        finalReplayValid: !!(refCandidate && refCandidate.finalReplayValid),
        pass: !!(refCandidate && refCandidate.pass) });
      if (refCandidate && refCandidate.pass) {
        out.push(refCandidate);
        seen[refCandidate.fullSig] = true;
        state.unique++;
        if (better(refCandidate, state.best, o)) state.best = refCandidate;
      }
    }
    for (var i = 0; i < input.length; i++) {
      if (Date.now() >= state.deadline || state.unique >= o.maxUniqueCandidates) {
        state.budgetExhausted = true;
        break;
      }
      if (o.stopAfterFirstPass && state.best && passOf(state.best, o)) break;
      collectFromSource(level, input[i], state, o, seen, out);
    }
    var sortedMs = state.searchMs.slice().sort(function (a, b) { return a - b; });
    out.sort(function (a, b) {
      if (passOf(a, o) !== passOf(b, o)) return passOf(a, o) ? -1 : 1;
      if (a.maxBuffer !== b.maxBuffer) return a.maxBuffer - b.maxBuffer;
      if (b.significantReleaseCount !== a.significantReleaseCount)
        return b.significantReleaseCount - a.significantReleaseCount;
      return (b.midBuffer34Pct || 0) - (a.midBuffer34Pct || 0);
    });
    return {
      schema: 'release-route-constructor-v1', config: o,
      summary: {
        wallMs: Date.now() - t0, highPressureStates: state.highPressureStates,
        tested: state.tested, unique: state.unique, duplicates: state.duplicates,
        replayRejected: state.replayRejected, invalidSources: state.invalidSources,
        withRelease: out.filter(function (x) { return (x.significantReleaseCount || 0) >= o.minSignificantReleases; }).length,
        withMid50: out.filter(function (x) { return (x.midBuffer34Pct || 0) >= o.minBuffer34Pct; }).length,
        pass: out.filter(function (x) { return x.pass; }).length,
        searchMsP50: pctRank(sortedMs, 0.50), searchMsP90: pctRank(sortedMs, 0.90),
        sourceBaselines: sourceBaselines,
        best: state.best, budgetExhausted: state.budgetExhausted
      },
      candidates: out
    };
  }
  return { DEFAULTS: DEFAULTS, construct: construct, metricsOf: metricsOf, sigOf: sigOf, passOf: passOf };
})();
