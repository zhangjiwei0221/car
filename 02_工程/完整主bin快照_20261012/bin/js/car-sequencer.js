/** v492 · 车辆角色与首行排程（可选 roleSchedule） */
var AntSolver = AntSolver || {};
AntSolver.CarSequencer = (function () {
  function exposed(config) {
    var dc = config && config._demandCurve;
    return dc && dc.startExposed || {};
  }
  function roleOf(car, config) {
    var microMax = config && config.microCarMax != null ? +config.microCarMax : 2;
    if ((car.count || 0) <= microMax) return 'microCar';
    var start = exposed(config)[car.color] || 0;
    return (car.count || 0) <= start ? 'freeSupply' : 'debtCar';
  }
  function assignRoles(cars, config) {
    return (cars || []).map(function (car, index) {
      var start = exposed(config)[car.color] || 0, role = roleOf(car, config);
      return { car: car, index: index, role: role,
        deficit: role === 'debtCar' ? Math.max(0, car.count - start) : 0,
        startExposed: start };
    });
  }
  function schedule(cars, config, cols) {
    var n = Math.min(Math.max(0, cols || 0), (cars || []).length);
    if (!n) return { cars: (cars || []).slice(), plan: null };
    var roles = assignRoles(cars, config), selected = [], used = {}, colorCount = {};
    var maxSame = Math.max(1, parseInt(config.row0ColorMax, 10) || 2);
    var freeMax = Math.max(0, parseInt(config.row0FreeMax, 10));
    if (isNaN(freeMax)) freeMax = 1;
    var relaxed = 0;
    function take(pool, reason) {
      var chosen = null;
      for (var i = 0; i < pool.length; i++) {
        var item = pool[i];
        if (used[item.index]) continue;
        if ((colorCount[item.car.color] || 0) >= maxSame) continue;
        chosen = item; break;
      }
      if (!chosen) {
        for (var j = 0; j < pool.length; j++) if (!used[pool[j].index]) { chosen = pool[j]; relaxed++; break; }
      }
      if (!chosen) return false;
      used[chosen.index] = true; selected.push({ item: chosen, reason: reason });
      colorCount[chosen.car.color] = (colorCount[chosen.car.color] || 0) + 1;
      return true;
    }
    function bySeq(a, b) { return (a.car._seq != null ? a.car._seq : a.index) - (b.car._seq != null ? b.car._seq : b.index); }
    var free = roles.filter(function (x) { return x.role === 'freeSupply'; }).sort(bySeq);
    var debt = roles.filter(function (x) { return x.role === 'debtCar'; }).sort(function (a, b) { return a.deficit - b.deficit || bySeq(a, b); });
    var micro = roles.filter(function (x) { return x.role === 'microCar'; }).sort(bySeq);
    var freeTarget = Math.min(freeMax, free.length, n);
    for (var f = 0; f < freeTarget; f++) take(free, 'freeSupply');
    var pool = debt.concat(free).concat(micro);
    while (selected.length < n && pool.some(function (x) { return !used[x.index]; })) take(pool, 'menu');
    // 极端情况下颜色/角色池不足，仍按原序补齐，不能丢车。
    if (selected.length < n) for (var k = 0; k < roles.length && selected.length < n; k++) take(roles, 'fallback');
    var first = selected.map(function (x) { return x.item.car; });
    var rest = [];
    for (var i = 0; i < cars.length; i++) if (!used[i]) rest.push(cars[i]);
    var out = first.concat(rest);
    out._rolePlan = {
      schema: 'car-role-plan-v1', row0Cars: first.length, freeTarget: freeTarget,
      selected: selected.map(function (x) { return { index: x.item.index, role: x.item.role, reason: x.reason,
        color: x.item.car.color, count: x.item.car.count, deficit: x.item.deficit }; }),
      relaxedColorLimit: relaxed, remainder: 'preserve-original-order'
    };
    return { cars: out, plan: out._rolePlan };
  }
  function auditBoard(board, config) {
    var cells = board && board.cells || [], all = [], row0 = [];
    for (var r = 0; r < (board && board.rows || 0); r++) for (var c = 0; c < (board && board.cols || 0); c++) {
      var cell = cells[r] && cells[r][c];
      if (cell && cell.t === 'box') { all.push(cell); if (r === 0) row0.push(cell); }
    }
    function countRole(list) {
      var roles = assignRoles(list, config), out = { freeSupply: 0, debtCar: 0, microCar: 0, deficits: [] };
      for (var i = 0; i < roles.length; i++) {
        out[roles[i].role]++; if (roles[i].role === 'debtCar') out.deficits.push(roles[i].deficit);
      }
      return out;
    }
    var colors = {}, maxSame = 0;
    for (var i = 0; i < row0.length; i++) { colors[row0[i].color] = (colors[row0[i].color] || 0) + 1; maxSame = Math.max(maxSame, colors[row0[i].color]); }
    return { schema: 'car-role-audit-v1', all: countRole(all), row0: countRole(row0),
      row0Cars: row0.length, row0Colors: Object.keys(colors).length, row0MaxSameColor: maxSame };
  }
  return { roleOf: roleOf, assignRoles: assignRoles, schedule: schedule, auditBoard: auditBoard };
})();

/** v493 · 只读债务生命周期：add/eat/done 真事件，不用容量差猜偿还。 */
AntSolver.CarSequencer.debtTimeline = function (level, route, opts) {
  opts = opts || {};
  var Sim = AntSolver.Simulator, lv = level.rows && level.totalPixels != null ? level : AntSolver.parseLevel(level);
  var actions = route.actions || route.pickOrder || route || [], seenStep = {};
  actions = actions.filter(function (a) {
    if (!a || a.r == null || a.c == null) return false;
    if (a.chainIndex != null && a.chainIndex !== 0) return false;
    if (a.chainSize > 1 && a.step != null) { if (seenStep[a.step]) return false; seenStep[a.step] = true; }
    return true;
  }).map(function (a) { return { r: a.r, c: a.c }; });
  var s = Sim.createState(lv, { useSlotStart: true, bottomOnly: !!opts.bottomOnly, instantChain: !!opts.instantChain });
  s.capture = true;
  var items = {}, active = {}, series = [], maxActive = 0, maxDebtPixels = 0;
  for (var step = 0; step < actions.length; step++) {
    if (s.gameWon || s.gameOver) break;
    s.capOps = [];
    var a = actions[step];
    if (!Sim.isPickable(s, a.r, a.c)) return { completed: false, reason: 'illegal_pick@' + step, items: Object.keys(items).map(function (k) { return items[k]; }) };
    Sim.applyPick(s, a.r, a.c);
    var ops = s.capOps || [];
    for (var oi = 0; oi < ops.length; oi++) {
      var op = ops[oi];
      if (op.t === 'add') {
        items[op.key] = { key: op.key, color: op.color, need: op.need, link: op.link || 0,
          enterStep: s.steps, progress: 0, initialDebt: 0, doneStep: null, status: 'open' };
        active[op.key] = true;
      } else if (op.t === 'eat') {
        if (items[op.key]) items[op.key].progress += (op.cells || []).length;
      } else if (op.t === 'done') {
        for (var dk = 0; dk < (op.keys || []).length; dk++) {
          var key = op.keys[dk];
          if (items[key]) { items[key].doneStep = s.steps; items[key].status = 'done'; delete active[key]; }
        }
      }
    }
    var activeDebt = 0, debtPixels = 0;
    for (var key in items) {
      var item = items[key];
      if (item.initialDebt === 0 && item.progress < item.need) {
        item.initialDebt = item.need - item.progress;
        item.debtStartStep = item.enterStep;
        item.status = item.doneStep != null ? 'repaidSameStep' : 'open';
      }
      if (active[key] && item.progress < item.need) { activeDebt++; debtPixels += item.need - item.progress; }
    }
    maxActive = Math.max(maxActive, activeDebt); maxDebtPixels = Math.max(maxDebtPixels, debtPixels);
    series.push({ step: s.steps, activeDebt: activeDebt, debtPixels: debtPixels, buffer: s.buffer.length, eliminated: s.eliminatedPixels });
    if (s.eliminatedPixels >= s.totalPixels) { s.gameWon = true; s.gameOver = true; }
  }
  var list = Object.keys(items).map(function (k) { return items[k]; });
  var debtCars = list.filter(function (x) { return x.initialDebt > 0; });
  for (var i = 0; i < debtCars.length; i++) {
    var d = debtCars[i];
    if (d.doneStep == null) d.status = 'unrepaid';
    else if (d.doneStep === d.debtStartStep) d.status = 'repaidSameStep';
    else { d.status = 'repaidLater'; d.waitSteps = d.doneStep - d.debtStartStep; }
  }
  function median(xs) { if (!xs.length) return null; xs = xs.slice().sort(function (a, b) { return a - b; }); var m = Math.floor(xs.length / 2); return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2; }
  var later = debtCars.filter(function (x) { return x.status === 'repaidLater'; });
  var same = debtCars.filter(function (x) { return x.status === 'repaidSameStep'; });
  var un = debtCars.filter(function (x) { return x.status === 'unrepaid'; });
  var micro = debtCars.filter(function (x) { return x.need <= (opts.microCarMax == null ? 2 : opts.microCarMax); });
  var waits = later.map(function (x) { return x.waitSteps; });
  return {
    schema: 'debt-timeline-v1', completed: !!s.gameWon, steps: s.steps,
    summary: {
      debtCars: debtCars.length, repaidLater: later.length, repaidSameStep: same.length,
      unrepaid: un.length, microDebtCars: micro.length,
      repaidLaterPct: debtCars.length ? +(later.length / debtCars.length * 100).toFixed(1) : null,
      medianWaitSteps: median(waits), maxWaitSteps: waits.length ? Math.max.apply(null, waits) : null,
      maxActiveDebtCars: maxActive, maxDebtPixels: maxDebtPixels
    },
    items: list, series: series
  };
};

/** v494 · 双时间线：参考解中的真实供给激活 × 目标图可达需求。只读，不把层号当激活时刻。 */
AntSolver.CarSequencer.dualTimeline = function (level, route, opts) {
  opts = opts || {};
  var Sim = AntSolver.Simulator;
  var lv = level && level.rows && level.totalPixels != null ? level : AntSolver.parseLevel(level);
  var actions = AntSolver.SolverAnalysis ? AntSolver.SolverAnalysis.normalizeActions(route) : (route.actions || route.pickOrder || route || []);
  var s = Sim.createState(lv, { useSlotStart: true, bottomOnly: !!opts.bottomOnly, instantChain: !!opts.instantChain });
  var items = {}, order = [], steps = [], demand = {}, firstReachStep = {}, lastAvailable = {};
  var r, c, key, cell;
  for (r = 0; r < lv.board.rows; r++) for (c = 0; c < lv.board.cols; c++) {
    cell = lv.board.cells[r] && lv.board.cells[r][c];
    if (!cell || cell.t !== 'box') continue;
    key = r + ',' + c;
    items[key] = { key: key, r: r, c: c, color: cell.color, count: cell.count,
      activateStep: null, pickStep: null, removedStep: null, openedBy: [], opens: [], solePickableSupplySteps: 0 };
    order.push(key);
  }
  function colorsNow() {
    var out = {};
    for (var rr = 0; rr < lv.rows; rr++) for (var cc = 0; cc < lv.cols; cc++) {
      var col = lv.blocks[rr][cc]; if (col > 0) out[col] = true;
    }
    return out;
  }
  var allColors = colorsNow();
  function snapshot(step, removedKeys, actionColor) {
    var pv = Sim.previewNextEliminationOrder(s), available = {}, added = {}, unlockedColors = [];
    for (var col in allColors) {
      var av = (s.eliminatedPixelsByColor && s.eliminatedPixelsByColor[col]) || 0;
      // consumed 必须按 blocks 实算；Simulator 没有稳定的分色消耗字段。
      av = 0;
      for (var rr = 0; rr < lv.rows; rr++) for (var cc = 0; cc < lv.cols; cc++) {
        if (lv.blocks[rr][cc] === +col && s.eliminated[rr][cc]) av++;
      }
      av += (pv.byColor[col] && pv.byColor[col].reachable) || 0;
      available[col] = av;
      var prev = lastAvailable[col] || 0, delta = Math.max(0, av - prev);
      if (delta > 0) {
        added[col] = delta;
        if (firstReachStep[col] == null) firstReachStep[col] = step;
        (demand[col] || (demand[col] = [])).push({ step: step, added: delta, available: av });
        if (step > 0 && prev === 0) unlockedColors.push(+col);
      }
      lastAvailable[col] = av;
    }
    var activated = [];
    for (var k in s.activated) {
      if (!items[k] || items[k].activateStep != null || !AntSolver.isBox(s.cells[k.split(',')[0]] && s.cells[k.split(',')[0]][k.split(',')[1]])) continue;
      items[k].activateStep = step; items[k].openedBy = (removedKeys || []).slice(); activated.push(k);
    }
    for (var ai = 0; ai < activated.length; ai++) {
      var opened = items[activated[ai]];
      for (var bi = 0; bi < opened.openedBy.length; bi++) {
        var blocker = items[opened.openedBy[bi]];
        if (blocker && blocker.opens.indexOf(opened.key) < 0) blocker.opens.push(opened.key);
      }
    }
    var rec = { step: step, available: available, added: added, activated: activated,
      removed: (removedKeys || []).slice(), actionColor: actionColor == null ? null : actionColor,
      unlockedColors: unlockedColors, buffer: s.buffer.length, eliminated: s.eliminatedPixels };
    steps.push(rec); return rec;
  }
  function remainingKeys() {
    var out = {};
    for (var rr = 0; rr < s.boardRows; rr++) for (var cc = 0; cc < s.boardCols; cc++) {
      if (AntSolver.isBox(s.cells[rr][cc])) out[rr + ',' + cc] = true;
    }
    return out;
  }
  snapshot(0, [], null);
  for (var i = 0; i < actions.length; i++) {
    if (s.gameWon || s.gameOver) break;
    var a = actions[i];
    if (!Sim.isPickable(s, a.r, a.c)) return { schema: 'dual-timeline-v1', completed: false,
      reason: 'illegal_pick@' + i, items: order.map(function (k) { return items[k]; }), demand: demand, steps: steps };
    var before = remainingKeys(), sameColorPickable = 0;
    for (var pk in before) {
      var pp = pk.split(',');
      if (s.cells[+pp[0]][+pp[1]].color === s.cells[a.r][a.c].color && Sim.isPickable(s, +pp[0], +pp[1])) sameColorPickable++;
    }
    var pickedColor = s.cells[a.r][a.c].color;
    Sim.applyPick(s, a.r, a.c);
    if (s.eliminatedPixels >= s.totalPixels) { s.gameWon = true; s.gameOver = true; }
    var after = remainingKeys(), removed = [];
    for (var bk in before) if (!after[bk]) {
      removed.push(bk);
      if (items[bk]) { items[bk].removedStep = s.steps; if (items[bk].pickStep == null) items[bk].pickStep = s.steps; }
    }
    if (sameColorPickable === 1) {
      for (var ri = 0; ri < removed.length; ri++) if (items[removed[ri]] && items[removed[ri]].color === pickedColor) items[removed[ri]].solePickableSupplySteps++;
    }
    snapshot(s.steps, removed, pickedColor);
  }
  // readyStep = 该色累计曾可达像素首次足够装满此车的参考解步数；不是全局最优或玩家必然时刻。
  for (var oi = 0; oi < order.length; oi++) {
    var item = items[order[oi]]; item.readyStep = null;
    for (var si = 0; si < steps.length; si++) {
      if ((steps[si].available[item.color] || 0) >= item.count) { item.readyStep = steps[si].step; break; }
    }
  }
  var pipeCars = 0;
  for (var pr = 0; pr < lv.board.rows; pr++) for (var pc = 0; pc < lv.board.cols; pc++) {
    var pcell = lv.board.cells[pr] && lv.board.cells[pr][pc];
    if (pcell && pcell.t === 'pipe' && pcell.queue) pipeCars += pcell.queue.length;
  }
  var activeN = 0, unlockSteps = 0, soleN = 0;
  for (var ii = 0; ii < order.length; ii++) {
    if (items[order[ii]].activateStep != null) activeN++;
    if (items[order[ii]].solePickableSupplySteps > 0) soleN++;
  }
  for (var us = 1; us < steps.length; us++) if (steps[us].unlockedColors.length || steps[us].activated.length) unlockSteps++;
  return { schema: 'dual-timeline-v1', completed: !!s.gameWon, routeSteps: s.steps,
    summary: { cars: order.length, activatedCars: activeN, unlockOrActivationSteps: unlockSteps,
      demandColors: Object.keys(demand).length, solePickableSupplyCars: soleN,
      pipeQueueCars: pipeCars, coverage: pipeCars ? 'initial-board-cars-only' : 'all-cars' },
    firstReachStep: firstReachStep, demand: demand, steps: steps,
    items: order.map(function (k) { return items[k]; }) };
};

/** v494 · 实验排程：只换普通上盘车的 color/count；障碍、管道、容量与棋盘完全不动。 */
AntSolver.CarSequencer.rescheduleByTimeline = function (level, timeline, config) {
  config = config || {};
  if (!level || !level.board || !timeline || !timeline.completed) return { level: null, plan: { applied: false, reason: 'incomplete-reference' } };
  var microMax = config.microCarMax == null ? 2 : +config.microCarMax;
  var wait = config.debtWaitTarget == null ? 3 : Math.max(1, +config.debtWaitTarget);
  var tolerance = config.timelineTolerance == null ? 2 : Math.max(0, +config.timelineTolerance);
  var out = JSON.parse(JSON.stringify(level)), cells = out.board.cells;
  var byKey = {}; (timeline.items || []).forEach(function (x) { byKey[x.key] = x; });
  var positions = [], cars = [], beforeTotals = {}, afterTotals = {};
  for (var r = 0; r < out.board.rows; r++) for (var c = 0; c < out.board.cols; c++) {
    var cell = cells[r][c];
    if (!cell || cell.t !== 'box' || cell.chain || cell.numice || cell.q) continue;
    var tm = byKey[r + ',' + c]; if (!tm) continue;
    var ready = tm.readyStep == null ? timeline.routeSteps + 1 : tm.readyStep;
    var target = Math.max(0, ready - (ready > 0 && cell.count > microMax ? wait : 0));
    var activation = tm.activateStep == null ? timeline.routeSteps + 1 : tm.activateStep;
    var pickStep = tm.pickStep == null ? timeline.routeSteps + 1 : tm.pickStep;
    positions.push({ r: r, c: c, activation: activation, pickStep: pickStep });
    cars.push({ color: cell.color, count: cell.count, target: target, frozen: Math.abs(pickStep - target) <= tolerance });
    beforeTotals[cell.color] = (beforeTotals[cell.color] || 0) + cell.count;
  }
  if (cars.length < 2) return { level: null, plan: { applied: false, reason: 'insufficient-plain-cars', plainCars: cars.length } };
  function cost(car, pos) {
    var e = Math.abs(car.target - pos.pickStep), value = Math.min(e, 20) * Math.min(e, 20);
    // 激活只是供给约束：希望在第 target 步取时必须先可用；早激活本身不罚。
    if (pos.activation > car.target) value += (pos.activation - car.target) * 100;
    return value;
  }
  function score() { var n = 0; for (var i = 0; i < cars.length; i++) n += cost(cars[i], positions[i]); return n; }
  var beforeScore = score(), swaps = [], guard = 0;
  while (guard++ < cars.length * 2) {
    var best = null, bestDelta = 0;
    for (var i = 0; i < cars.length; i++) for (var j = i + 1; j < cars.length; j++) {
      if (cars[i].frozen && cars[j].frozen) continue;
      var old = cost(cars[i], positions[i]) + cost(cars[j], positions[j]);
      var neu = cost(cars[j], positions[i]) + cost(cars[i], positions[j]);
      var delta = neu - old;
      if (delta < bestDelta) { bestDelta = delta; best = [i, j]; }
    }
    if (!best) break;
    var x = best[0], y = best[1], tmp = cars[x]; cars[x] = cars[y]; cars[y] = tmp;
    swaps.push({ from: [positions[x].r, positions[x].c], to: [positions[y].r, positions[y].c],
      color: cars[y].color, count: cars[y].count, delta: bestDelta });
  }
  for (var wi = 0; wi < cars.length; wi++) {
    var dst = cells[positions[wi].r][positions[wi].c];
    dst.color = cars[wi].color; dst.count = cars[wi].count;
    afterTotals[dst.color] = (afterTotals[dst.color] || 0) + dst.count;
  }
  for (var col in beforeTotals) if (beforeTotals[col] !== afterTotals[col]) return { level: null, plan: { applied: false, reason: 'conservation-check-failed' } };
  var afterScore = score();
  if (!swaps.length || afterScore >= beforeScore) return { level: null, plan: { applied: false, reason: 'no-improving-swap', plainCars: cars.length, beforeScore: beforeScore } };
  function obstacleSignature(lv) {
    var sig = [];
    for (var rr = 0; rr < lv.board.rows; rr++) for (var cc = 0; cc < lv.board.cols; cc++) {
      var x = lv.board.cells[rr][cc];
      if (!x) { sig.push('.'); continue; }
      if (x.t === 'box') sig.push(['box', x.chain || 0, x.numice || 0, x.q ? 1 : 0, x.ice || 0]);
      else sig.push(x); // 管道及 queue 原样参与比较。
    }
    return JSON.stringify(sig);
  }
  function capacityTotal(lv) {
    var total = 0;
    for (var rr = 0; rr < lv.board.rows; rr++) for (var cc = 0; cc < lv.board.cols; cc++) {
      var x = lv.board.cells[rr][cc]; if (!x) continue;
      if (x.t === 'box') total += x.count || 0;
      else if (x.t === 'pipe' && x.queue) for (var qi = 0; qi < x.queue.length; qi++) total += x.queue[qi].count || 0;
    }
    return total;
  }
  var contract = { conserved: capacityTotal(level) === capacityTotal(out),
    obstaclesPreserved: obstacleSignature(level) === obstacleSignature(out),
    rows: out.board.rows, cols: out.board.cols,
    boardFloorPass: out.board.rows >= 6 && out.board.cols >= 6 };
  if (!contract.conserved || !contract.obstaclesPreserved) return { level: null, plan: { applied: false, reason: 'post-swap-contract-failed', contract: contract } };
  return { level: out, plan: { schema: 'timeline-schedule-plan-v1', applied: true, plainCars: cars.length,
    debtWaitTarget: wait, tolerance: tolerance, swaps: swaps.length, beforeScore: beforeScore, afterScore: afterScore,
    frozenCars: cars.filter(function (x) { return x.frozen; }).length, contract: contract, details: swaps } };
};
