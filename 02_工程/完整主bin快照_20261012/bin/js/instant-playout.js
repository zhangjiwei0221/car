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
  /**
   * 每色容量队列：车数取 ceil(P/max)，容量尽量均衡，严格 Σ=P、每车≤max。
   * 若 P < 车数×min（区间数学不可分），仍取均衡解以最大化最小车容量并如实标记；
   * 不把余数塞成 1~2px 尾车，也不越过用户上限。
   */
  function capacityPlanForColor(total, minCap, maxCap) {
    if (!(total > 0)) return { total: total, caps: [], exact: true, reason: 'empty' };
    var n = Math.max(1, Math.ceil(total / maxCap));
    var base = Math.floor(total / n), rem = total - base * n;
    var caps = [];
    if (total >= n * minCap) {
      for (var i = 0; i < n; i++) caps.push(base + (i < rem ? 1 : 0));
    } else {
      // 无法全部落入区间：先最小化 belowMin 车数（m辆≥min + 一个余量），
      // 余量过小则改均衡拆分，避免 1~2px 尾车。只调整拆分，不改用户上下界。
      var m = Math.min(n, Math.floor(total / minCap));
      var tail = total - m * minCap;
      if (tail > 0 && tail >= minCap / 2) {
        for (var j = 0; j < m; j++) caps.push(minCap);
        caps.push(tail);
      } else {
        for (var k = 0; k < n; k++) caps.push(base + (k < rem ? 1 : 0));
      }
    }
    caps.sort(function (a, b) { return b - a; });
    var exact = caps.every(function (c) { return c >= minCap && c <= maxCap; });
    var reason = exact ? null : (total < minCap ? 'color_below_min' : 'no_exact_partition');
    return { total: total, caps: caps, exact: exact, reason: reason, average: total / n, cars: n };
  }
  function buildCapacityQueues(blocks, rows, cols, minCap, maxCap) {
    var totals = {};
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      var v = blocks[r][c]; if (v > 0) totals[v] = (totals[v] || 0) + 1;
    }
    var queues = {}, plans = [];
    var colors = Object.keys(totals).map(Number).sort(function (a, b) { return a - b; });
    for (var i = 0; i < colors.length; i++) {
      var col = colors[i], p = capacityPlanForColor(totals[col], minCap, maxCap);
      queues[col] = p.caps.slice(); plans.push({ color: col, total: p.total, caps: p.caps, exact: p.exact, reason: p.reason });
    }
    return { queues: queues, plans: plans };
  }
  function plan(level, config) {
    var lv = parsed(level), blocks = lv.blocks, rows = lv.rows || blocks.length, cols = lv.cols || (blocks[0] || []).length;
    var capMin = Math.max(1, parseInt(config && config.boxSizeMin, 10) || 1);
    var capMax = Math.max(capMin, parseInt(config && config.boxSizeMax, 10) || capMin);
    var bufferLimit = Math.max(1, parseInt(config && config.bufferLimit, 10) || lv.bufferLimit || 5);
    var elim = AntSolver.outsideReachSeed(blocks, rows, cols, false);
    var capBuilt = buildCapacityQueues(blocks, rows, cols, capMin, capMax), capQueues = capBuilt.queues, capIndex = {};
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
      var ci = capIndex[bestColor] || 0, queue = capQueues[bestColor] || [];
      var cap = queue[ci] || 0;
      capIndex[bestColor] = ci + 1;
      if (!(cap > 0)) { deadlock = true; deadlockReason = 'capacity_unavailable'; break; }
      var car = { id: cars.length + 1, color: bestColor, cap: cap, remaining: cap, consumed: 0,
        slot: slot, start: start, pixels: [], finished: false, active: true, enterOrder: cars.length + 1,
        bufferBefore: active.length, entryReach: bestReach, colorRemaining: rem[bestColor] };
      cars.push(car); slots[slot] = car; active.push(car);
      if (advance(car) <= 0) { deadlock = true; deadlockReason = 'new_car_no_progress'; break; }
      if (car.finished) { slots[car.slot] = null; car.active = false; active = active.filter(function (x) { return x !== car; }); }
      if (done >= total) break;
    }
    var unfinished = cars.filter(function (c) { return !c.finished; });
    var counts = cars.map(function (c) { return c.cap; });
    var microThreshold = Math.min(2, capMax);
    var audit = { aboveMax: counts.filter(function (x) { return x > capMax; }).length,
      belowMin: counts.filter(function (x) { return x < capMin; }).length,
      microCount: counts.filter(function (x) { return x <= microThreshold; }).length,
      unfinished: unfinished.length, covered: done, total: total, deadlock: !!deadlock };
    var ok = !deadlock && done === total && !unfinished.length && !audit.aboveMax;
    var boxes = cars.map(function (c, i) {
      return { color: c.color, count: c.cap, elimSeq: i, instantEnterOrder: c.enterOrder,
        instantSlot: c.slot, instantPixels: c.pixels, instantEntryReach: c.entryReach, instantColorRemaining: c.colorRemaining };
    });
    boxes._instantPlayout = { schema: 'instant-playout-v2', ok: ok, reason: ok ? null : (deadlockReason || 'coverage_incomplete'),
      cars: cars.length, covered: done, total: total, capRange: [capMin, capMax], audit: audit,
      capacityPlans: capBuilt.plans, exactCapacityColors: capBuilt.plans.filter(function (x) { return x.exact; }).length,
      infeasibleCapacityColors: capBuilt.plans.filter(function (x) { return !x.exact; }).length,
      bufferEvents: cars.filter(function (c) { return c.bufferBefore > 0; }).length,
      medianEntryReach: median(cars.map(function (c) { return c.entryReach; })),
      medianConsumed: median(cars.map(function (c) { return c.consumed; })),
      carSequence: cars.map(function (c) { return { id: c.id, color: c.color, cap: c.cap, slot: c.slot,
        start: c.start, enterOrder: c.enterOrder, finishOrder: c.finishOrder || null, entryReach: c.entryReach,
        colorRemaining: c.colorRemaining, consumed: c.consumed }; }) };
    return { ok: ok, reason: boxes._instantPlayout.reason, boxes: boxes, cars: cars, seq: seq, audit: audit };
  }
  return { plan: plan, capacityPlanForColor: capacityPlanForColor };
})();
