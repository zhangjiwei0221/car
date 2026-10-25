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
