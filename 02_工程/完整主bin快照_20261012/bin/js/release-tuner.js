/** v505 · 释放同步：寻找同一步第二辆接近完成的车，做小容量守恒精调。 */
var AntSolver = AntSolver || {};
AntSolver.ReleaseTuner = (function () {
  function parsed(level) { return level && level.rows && level.totalPixels != null && level.board ? level : AntSolver.parseLevel(level); }
  function variants(level, route, opts) {
    opts = opts || {}; var lv = parsed(level), Sim = AntSolver.Simulator, SA = AntSolver.SolverAnalysis;
    var actions = SA.normalizeActions(route), debt = AntSolver.CarSequencer.debtTimeline(lv, route, opts);
    var sourceByKey = {}; (debt.items || []).forEach(function (d) { if (d.source) sourceByKey[d.key] = d.source; });
    var s = Sim.createState(lv, { useSlotStart: true, bottomOnly: !!opts.bottomOnly, instantChain: !!opts.instantChain });
    s.capture = true;
    var candidates = [], seen = {}, maxDelta = Math.max(1, opts.maxDelta || 4), maxVariants = Math.max(1, opts.maxVariants || 12);
    for (var i = 0; i < actions.length && candidates.length < maxVariants; i++) {
      if (s.gameWon || s.gameOver) break;
      var a = actions[i]; if (!Sim.isPickable(s, a.r, a.c)) break;
      var before = s.buffer.length, progress = s.totalPixels ? s.eliminatedPixels / s.totalPixels : 0;
      s.capOps = [];
      Sim.applyPick(s, a.r, a.c);
      var after = s.buffer.length;
      // 只研究高压开始下降、但一次只退1格的步骤；目标是把第二辆同步补完。
      if (before >= 3 && after < before && before - after === 1 && progress >= 0.15 && progress <= 0.90) {
        for (var bi = 0; bi < s.buffer.length; bi++) {
          var item = s.buffer[bi], remaining = item.need - item.progress, source = sourceByKey[item.key];
          if (!source || remaining < 1 || remaining > maxDelta) continue;
          var car = { r: source.r, c: source.c, color: item.color, count: item.need };
          var key = car.r + ',' + car.c + ':-' + remaining;
          if (seen[key]) continue; seen[key] = true;
          var v = AntSolver.CapacityTuner.transfer(lv, car, -remaining, opts);
          if (v) {
            v.meta.releaseSync = { referenceStep: s.steps, beforeBuffer: before, afterBuffer: after,
              remainingAfterStep: remaining, key: item.key, expectedExtraRelease: 1 };
            candidates.push(v);
          }
        }
      }
    }
    return { variants: candidates, reason: candidates.length ? null : 'no_release_sync_candidate' };
  }
  return { variants: variants };
})();

/** v505 · 偿还供给：把能解锁暂存颜色的车适当前移，和近邻非关键车交换。 */
AntSolver.ReleaseTuner.supplyVariants = function (level, route, opts) {
  opts = opts || {};
  var lv = level && level.rows && level.totalPixels != null && level.board ? level : AntSolver.parseLevel(level);
  var Sim = AntSolver.Simulator, SA = AntSolver.SolverAnalysis, dual = AntSolver.CarSequencer.dualTimeline(lv, route, opts);
  if (!dual.completed) return { variants: [], reason: 'incomplete_reference' };
  var byKey = {}; (dual.items || []).forEach(function (x) { byKey[x.key] = x; });
  var actions = SA.normalizeActions(route), s = Sim.createState(lv, { useSlotStart: true,
    bottomOnly: !!opts.bottomOnly, instantChain: !!opts.instantChain });
  var out = [], seen = {}, maxVariants = Math.max(1, opts.maxSupplyVariants || 12);
  function plain(x) {
    if (!x) return false;
    var cell = lv.board.cells[x.r] && lv.board.cells[x.r][x.c];
    return cell && cell.t === 'box' && !cell.chain && !cell.numice && !cell.q;
  }
  function plainEarlier(x) {
    if (!x) return false;
    var cell = lv.board.cells[x.r] && lv.board.cells[x.r][x.c];
    // 允许交换到数字冰位置：冰原样保留且会按球数倒计时，重解验证实际时机；不移入锁链/隐藏色。
    return cell && cell.t === 'box' && !cell.chain && !cell.q;
  }
  for (var i = 0; i < actions.length && out.length < maxVariants; i++) {
    if (s.gameWon || s.gameOver) break;
    var a = actions[i]; if (!Sim.isPickable(s, a.r, a.c)) break;
    var debtColors = {}; for (var bi = 0; bi < s.buffer.length; bi++) debtColors[s.buffer[bi].color] = true;
    var progress = s.totalPixels ? s.eliminatedPixels / s.totalPixels : 0;
    if (s.buffer.length >= 3 && progress >= 0.15 && progress <= 0.90) {
      for (var color in debtColors) {
        for (var si = i + 1; si < dual.steps.length && out.length < maxVariants; si++) {
          var event = dual.steps[si];
          if (!event.added || !(event.added[color] > 0) || !event.removed.length) continue;
          for (var ri = 0; ri < event.removed.length && out.length < maxVariants; ri++) {
            var unlocker = byKey[event.removed[ri]];
            if (!plain(unlocker) || unlocker.color === +color || unlocker.pickStep == null) continue;
            for (var oi = 0; oi < dual.items.length && out.length < maxVariants; oi++) {
              var earlier = dual.items[oi];
              if (!plainEarlier(earlier) || earlier.key === unlocker.key || earlier.pickStep == null) continue;
              var gap = unlocker.pickStep - earlier.pickStep;
              if (gap < 1 || gap > (opts.maxMoveEarlierSteps || 8) || (earlier.opens || []).length > (opts.maxEarlierOpens == null ? 1 : opts.maxEarlierOpens) || debtColors[earlier.color]) continue;
              var swapKey = unlocker.key + ':' + earlier.key + ':' + color;
              if (seen[swapKey]) continue; seen[swapKey] = true;
              var v = JSON.parse(JSON.stringify(lv)), ua = v.board.cells[unlocker.r][unlocker.c], eb = v.board.cells[earlier.r][earlier.c];
              var temp = { color: ua.color, count: ua.count }; ua.color = eb.color; ua.count = eb.count; eb.color = temp.color; eb.count = temp.count;
              var before = AntSolver.CapacityTuner.sumByColor(lv), after = AntSolver.CapacityTuner.sumByColor(v), ok = true;
              for (var col in before) if (before[col] !== after[col]) ok = false;
              if (!ok) continue;
              out.push({ level: v, meta: { releaseSupply: { debtColor: +color, referenceStep: i + 1,
                unlockStep: event.step, unlocker: { r: unlocker.r, c: unlocker.c, color: unlocker.color, count: unlocker.count },
                earlier: { r: earlier.r, c: earlier.c, color: earlier.color, count: earlier.count }, moveEarlierSteps: gap },
                conserved: true, obstaclesPreserved: true } });
            }
          }
          break; // 每个暂存颜色只看最近一次新增供给，避免组合爆炸。
        }
      }
    }
    Sim.applyPick(s, a.r, a.c);
    if (s.eliminatedPixels >= s.totalPixels) { s.gameWon = true; s.gameOver = true; }
  }
  return { variants: out, reason: out.length ? null : 'no_release_supply_candidate' };
};
