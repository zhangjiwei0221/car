/** v526 · 瞬时连锁生成计划：按真实最左空槽 / 最近曼哈顿 / 容量封顶生成每车像素归属。 */
var AntSolver = AntSolver || {};
AntSolver.InstantPlayout = (function () {
  function parsed(level) { return level && level.rows && level.board ? level : AntSolver.parseLevel(level); }
  function median(a) { if (!a.length) return null; a = a.slice().sort(function (x, y) { return x - y; }); return a[Math.floor(a.length / 2)]; }
  function startOf(slot, rows, cols, bufferLimit) {
    return { r: rows - 1, c: Math.min(cols - 1, Math.floor(slot / bufferLimit * cols)) };
  }
  function remainingByColor(elim, blocks, rows, cols) {
    var m = {};
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      var v = blocks[r][c]; if (v > 0 && !elim[r][c]) m[v] = (m[v] || 0) + 1;
    }
    return m;
  }
  /** 当前余量的可行单车容量；低于下限的尾车保留给step3容量规划处理并如实审计。 */
  function planCap(remain, minCap, maxCap) {
    if (!(remain > 0)) return 0;
    if (remain <= maxCap) return remain;
    var n = Math.ceil(remain / maxCap), cap = Math.ceil(remain / n);
    if (cap < minCap) cap = minCap;
    if (cap > maxCap) cap = maxCap;
    return cap;
  }
  function plan(level, config) {
    var lv = parsed(level), blocks = lv.blocks, rows = lv.rows || blocks.length, cols = lv.cols || (blocks[0] || []).length;
    var capMin = Math.max(1, parseInt(config && config.boxSizeMin, 10) || 1);
    var capMax = Math.max(capMin, parseInt(config && config.boxSizeMax, 10) || capMin);
    var bufferLimit = Math.max(1, parseInt(config && config.bufferLimit, 10) || lv.bufferLimit || 5);
    var elim = AntSolver.outsideReachSeed(blocks, rows, cols, false);
    var seq = AntSolver.create2D(rows, cols, 0), slots = [], active = [], cars = [], done = 0, total = 0;
    for (var rr = 0; rr < rows; rr++) for (var cc = 0; cc < cols; cc++) if (blocks[rr][cc] > 0) total++;
    function freeSlot() { for (var k = 0; k < bufferLimit; k++) if (!slots[k]) return k; return -1; }
    function reachableCount(color, start) {
      var scratch = elim.map(function (row) { return row.slice(); });
      return AntSolver.Simulator.instantChainEliminate(scratch, blocks, rows, cols, color, Infinity, null, start, null);
    }
    function advance(car) {
      if (!(car.remaining > 0)) return 0;
      var trace = [];
      var got = AntSolver.Simulator.instantChainEliminate(elim, blocks, rows, cols, car.color, car.remaining, trace, car.start, null);
      if (!car.pixels) car.pixels = [];
      for (var i = 0; i < trace.length; i++) {
        seq[trace[i][0]][trace[i][1]] = ++done;
        car.pixels.push(trace[i]);
      }
      car.remaining -= got; car.consumed += got;
      if (car.remaining <= 0) { car.finished = true; car.finishOrder = cars.indexOf(car) + 1; }
      return got;
    }
    var guard = rows * cols * 4 + 100, deadlock = false, deadlockReason = null;
    while (done < total && guard-- > 0) {
      var progressed = false;
      // 实机瞬时连锁对暂存车严格先进先得；槽位只决定该车的消除起点。
      for (var ai = 0; ai < active.length; ai++) {
        var ac = active[ai];
        if (ac.finished) continue;
        if (advance(ac) > 0) progressed = true;
        if (ac.finished) { slots[ac.slot] = null; ac.active = false; }
      }
      active = active.filter(function (x) { return !x.finished; });
      if (progressed) continue;
      var slot = freeSlot();
      if (slot < 0) { deadlock = true; deadlockReason = 'buffer_full_no_progress'; break; }
      var start = startOf(slot, rows, cols, bufferLimit), rem = remainingByColor(elim, blocks, rows, cols);
      var bestColor = null, bestReach = 0;
      var colors = Object.keys(rem).map(Number).sort(function (a, b) { return a - b; });
      for (var bi = 0; bi < colors.length; bi++) {
        var n = reachableCount(colors[bi], start);
        if (n > bestReach) { bestReach = n; bestColor = colors[bi]; }
      }
      if (bestColor == null || bestReach <= 0) { deadlock = true; deadlockReason = 'no_reachable_color'; break; }
      var cap = planCap(rem[bestColor], capMin, capMax);
      if (!(cap > 0)) { deadlock = true; deadlockReason = 'capacity_unavailable'; break; }
      var car = { id: cars.length + 1, color: bestColor, cap: cap, remaining: cap, consumed: 0,
        slot: slot, start: start, pixels: [], finished: false, active: true, enterOrder: cars.length + 1,
        bufferBefore: active.length };
      cars.push(car); slots[slot] = car; active.push(car);
      if (advance(car) <= 0) { deadlock = true; deadlockReason = 'new_car_no_progress'; break; }
      if (car.finished) { slots[car.slot] = null; car.active = false; active = active.filter(function (x) { return x !== car; }); }
      if (done >= total) break;
    }
    var unfinished = cars.filter(function (c) { return !c.finished; });
    var counts = cars.map(function (c) { return c.cap; });
    var audit = { aboveMax: counts.filter(function (x) { return x > capMax; }).length,
      belowMin: counts.filter(function (x) { return x < capMin; }).length,
      unfinished: unfinished.length, covered: done, total: total, deadlock: !!deadlock };
    var ok = !deadlock && done === total && !unfinished.length && !audit.aboveMax;
    var boxes = cars.map(function (c, i) {
      return { color: c.color, count: c.cap, elimSeq: i, instantEnterOrder: c.enterOrder,
        instantSlot: c.slot, instantPixels: c.pixels };
    });
    boxes._instantPlayout = { schema: 'instant-playout-v1', ok: ok, reason: ok ? null : (deadlockReason || 'coverage_incomplete'),
      cars: cars.length, covered: done, total: total, capRange: [capMin, capMax], audit: audit,
      bufferEvents: cars.filter(function (c) { return c.bufferBefore > 0; }).length,
      medianReachableAtEntry: median(cars.map(function (c) { return c.consumed; })) };
    return { ok: ok, reason: boxes._instantPlayout.reason, boxes: boxes, cars: cars, seq: seq, audit: audit };
  }
  return { plan: plan };
})();
