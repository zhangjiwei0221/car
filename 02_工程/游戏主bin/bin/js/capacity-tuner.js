/** v502 · 小容量局部精调：少量关键车、±1/±2/±4px、同色守恒。只生成变体，不接生产。 */
var AntSolver = AntSolver || {};
AntSolver.CapacityTuner = (function () {
  function parsed(level) { return level && level.rows && level.totalPixels != null && level.board ? level : AntSolver.parseLevel(level); }
  function sumByColor(level) {
    var out = {}, cells = level.board.cells;
    for (var r = 0; r < level.board.rows; r++) for (var c = 0; c < level.board.cols; c++) {
      var x = cells[r][c]; if (!x) continue;
      if (x.t === 'box') out[x.color] = (out[x.color] || 0) + x.count;
      else if (x.t === 'pipe' && x.queue) for (var i = 0; i < x.queue.length; i++) out[x.queue[i].color] = (out[x.queue[i].color] || 0) + x.queue[i].count;
    }
    return out;
  }
  function obstacleSignature(level) {
    var out = [];
    for (var r = 0; r < level.board.rows; r++) for (var c = 0; c < level.board.cols; c++) {
      var x = level.board.cells[r][c];
      if (!x) { out.push('.'); continue; }
      if (x.t === 'box') out.push(['box', x.chain || 0, x.numice || 0, x.q ? 1 : 0, x.ice || 0]);
      else out.push(x);
    }
    return JSON.stringify(out);
  }
  function keyCars(level, route, opts) {
    var timeline = AntSolver.CarSequencer.dualTimeline(level, route, opts || {}), debt = AntSolver.CarSequencer.debtTimeline(level, route, opts || {});
    var debtByPos = {};
    (debt.items || []).forEach(function (d) {
      if (d.source) debtByPos[d.source.r + ',' + d.source.c] = d;
    });
    return (timeline.items || []).map(function (x) {
      var d = debtByPos[x.key], wait = d && d.waitSteps || 0, initial = d && d.initialDebt || 0;
      var timing = x.readyStep != null && x.pickStep != null ? Math.abs(x.readyStep - x.pickStep) : 0;
      var score = (x.opens || []).length * 8 + (x.solePickableSupplySteps ? 2 : 0) + Math.min(8, timing) + Math.min(12, wait * 2) + Math.min(12, initial / 2) + (initial > 0 ? 12 : 0);
      return { r: x.r, c: x.c, color: x.color, count: x.count, score: +score.toFixed(2),
        reasons: { opens: (x.opens || []).length, soleSupply: !!x.solePickableSupplySteps,
          timingGap: timing, waitSteps: wait, initialDebt: initial } };
    }).sort(function (a, b) { return b.score - a.score || a.r - b.r || a.c - b.c; });
  }
  function transfer(level, target, delta, opts) {
    var min = +opts.capMin, max = +opts.capMax;
    if (!(min > 0 && max >= min) || !delta) return null;
    var out = JSON.parse(JSON.stringify(level)), cells = out.board.cells;
    var cell = cells[target.r] && cells[target.r][target.c];
    if (!cell || cell.t !== 'box' || cell.q || cell.color !== target.color) return null;
    var next = cell.count + delta;
    // 历史候选可能已有 belowMin：只允许向上修复，不许进一步降低或超过上限。
    if (next > max || next <= 0 || (cell.count >= min && next < min) || (cell.count < min && delta < 0)) return null;
    var donors = [];
    for (var r = 0; r < out.board.rows; r++) for (var c = 0; c < out.board.cols; c++) {
      if (r === target.r && c === target.c) continue;
      var x = cells[r][c];
      if (!x || x.t !== 'box' || x.q || x.color !== cell.color) continue;
      var slack = delta > 0 ? x.count - min : max - x.count;
      if (slack > 0) donors.push({ r: r, c: c, slack: slack });
    }
    donors.sort(function (a, b) { return b.slack - a.slack || a.r - b.r || a.c - b.c; });
    var need = Math.abs(delta), moved = [];
    for (var i = 0; i < donors.length && need > 0; i++) {
      var d = donors[i], take = Math.min(need, d.slack);
      if (take <= 0) continue;
      var donorCell = cells[d.r][d.c];
      if (delta > 0) donorCell.count -= take; else donorCell.count += take;
      moved.push({ r: d.r, c: d.c, delta: delta > 0 ? -take : take }); need -= take;
    }
    if (need > 0 || !moved.length) return null;
    cell.count = next;
    var before = sumByColor(level), after = sumByColor(out);
    for (var col in before) if (before[col] !== after[col]) return null;
    if (obstacleSignature(level) !== obstacleSignature(out)) return null;
    return { level: out, meta: { target: { r: target.r, c: target.c, color: cell.color,
      before: target.count, after: next, delta: delta }, donors: moved,
      capRange: [min, max], conserved: true, obstaclesPreserved: true,
      existingBelowMinMayOnlyIncrease: true } };
  }
  function variants(level, route, opts) {
    opts = opts || {}; var lv = parsed(level), maxCars = Math.max(1, opts.maxCars || 4);
    var deltas = opts.deltas || [1, 2, 4, -1, -2, -4], maxVariants = Math.max(1, opts.maxVariants || 24);
    var cars = keyCars(lv, route, opts).slice(0, maxCars), out = [], rejected = [];
    for (var i = 0; i < cars.length && out.length < maxVariants; i++) {
      for (var j = 0; j < deltas.length && out.length < maxVariants; j++) {
        var v = transfer(lv, cars[i], deltas[j], opts);
        if (v) { v.meta.keyScore = cars[i].score; v.meta.keyReasons = cars[i].reasons; out.push(v); }
        else rejected.push({ r: cars[i].r, c: cars[i].c, delta: deltas[j] });
      }
    }
    return { variants: out, rejected: rejected, keyCars: cars };
  }
  return { keyCars: keyCars, transfer: transfer, variants: variants, sumByColor: sumByColor };
})();
