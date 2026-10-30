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
  function capacityPlanForColor(total, minCap, maxCap, targetCars) {
    if (!(total > 0)) return { total: total, caps: [], exact: true, reason: 'empty' };
    var minCars = Math.max(1, Math.ceil(total / maxCap));
    var maxCars = Math.max(1, Math.floor(total / minCap));
    var n = targetCars == null ? minCars : Math.max(1, parseInt(targetCars, 10) || minCars);
    if (targetCars != null && (n < minCars || n > maxCars)) {
      return { total: total, caps: [], exact: false, reason: 'target_car_count_unpartitionable',
        minCars: minCars, maxCars: maxCars, targetCars: n, cars: 0, average: null };
    }
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
    return { total: total, caps: caps, exact: exact, reason: reason, average: total / n, cars: n,
      minCars: minCars, maxCars: maxCars, targetCars: n };
  }

  /**
   * v576 实验：长尾容量拆分。
   * 优先保留少量 maxCap 锚点车，其余车辆落入 [minCap, smallMax]。
   * 找不到精确的“锚点 + 小车”组合时，退回现有区间内均衡拆分。
   */
  function mixedCapacityPlanForColor(total, minCap, maxCap, targetCars, opts) {
    var n = Math.max(1, parseInt(targetCars, 10) || 1);
    var smallMax = Math.max(minCap, Math.min(maxCap, (opts && opts.smallMax) || 18));
    var anchorRatio = (opts && opts.anchorRatio != null) ? +opts.anchorRatio : 0.3;
    var queueOrder = (opts && opts.queueOrder === 'asc') ? 'asc' : 'desc';
    if (!(anchorRatio >= 0 && anchorRatio <= 1)) anchorRatio = 0.3;
    var best = null;
    for (var anchors = 0; anchors <= n; anchors++) {
      var smalls = n - anchors, rest = total - anchors * maxCap;
      if (smalls === 0) {
        if (rest !== 0) continue;
      } else if (!(rest >= smalls * minCap && rest <= smalls * smallMax)) {
        continue;
      }
      var score = Math.abs(anchors / n - anchorRatio);
      if (!best || score < best.score || (score === best.score && smalls > best.smalls)) {
        best = { anchors: anchors, smalls: smalls, rest: rest, score: score };
      }
    }
    if (!best) {
      var fallback = capacityPlanForColor(total, minCap, maxCap, n);
      fallback.mix = { mode: 'balanced-fallback', smallMax: smallMax, anchorRatio: anchorRatio };
      return fallback;
    }
    var caps = [];
    for (var ai = 0; ai < best.anchors; ai++) caps.push(maxCap);
    if (best.smalls > 0) {
      var base = Math.floor(best.rest / best.smalls), rem = best.rest - base * best.smalls;
      for (var si = 0; si < best.smalls; si++) caps.push(base + (si < rem ? 1 : 0));
    }
    caps.sort(queueOrder === 'asc'
      ? function (a, b) { return a - b; }
      : function (a, b) { return b - a; });
    var exact = caps.length === n && caps.every(function (c) { return c >= minCap && c <= maxCap; });
    return {
      total: total, caps: caps, exact: exact, reason: exact ? null : 'mixed_partition_failed',
      average: total / n, cars: n,
      minCars: Math.max(1, Math.ceil(total / maxCap)),
      maxCars: Math.max(1, Math.floor(total / minCap)),
      targetCars: n,
      mix: { mode: 'anchor-small', anchors: best.anchors, smalls: best.smalls,
        smallMax: smallMax, anchorCap: maxCap, anchorRatio: anchorRatio, queueOrder: queueOrder }
    };
  }

  function buildCapacityQueues(blocks, rows, cols, minCap, maxCap, targetCars, mixOpts) {
    var totals = {};
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      var v = blocks[r][c]; if (v > 0) totals[v] = (totals[v] || 0) + 1;
    }
    var queues = {}, plans = [];
    var colors = Object.keys(totals).map(Number).sort(function (a, b) { return a - b; });
    var target = targetCars == null ? null : parseInt(targetCars, 10);
    var minTotal = 0, maxTotal = 0, colorRanges = {};
    for (var ti = 0; ti < colors.length; ti++) {
      var tc = colors[ti], tn = totals[tc];
      var lo = Math.max(1, Math.ceil(tn / maxCap));
      var hi = Math.max(1, Math.floor(tn / minCap));
      if (hi < lo) {
        if (target != null) return { queues: {}, plans: [], ok: false, reason: 'capacity_band_unpartitionable',
          minTotalCars: null, maxTotalCars: null, targetCars: target, colorRanges: colorRanges };
        // 目标车数为空时保留历史“近似分区”路径，由 capacityPlanForColor 自行均衡并标记 exact=false。
        colorRanges[tc] = { min: lo, max: hi, total: tn, nonExactHistory: true };
        minTotal += lo; maxTotal += Math.max(lo, hi);
        continue;
      }
      colorRanges[tc] = { min: lo, max: hi, total: tn };
      minTotal += lo; maxTotal += hi;
    }
    if (target != null && (target < minTotal || target > maxTotal)) {
      return { queues: {}, plans: [], ok: false, reason: 'target_car_count_infeasible',
        minTotalCars: minTotal, maxTotalCars: maxTotal, targetCars: target, colorRanges: colorRanges };
    }
    var perColorTarget = {};
    for (var ci = 0; ci < colors.length; ci++) perColorTarget[colors[ci]] = colorRanges[colors[ci]].min;
    if (target != null) {
      var extra = target - minTotal;
      // 优先把额外车辆给大色块，避免把总量小的颜色拆成细碎尾车。
      var order = colors.slice().sort(function (a, b) {
        return (colorRanges[b].total - colorRanges[a].total) || a - b;
      });
      while (extra > 0) {
        var progressed = false;
        for (var oi = 0; oi < order.length && extra > 0; oi++) {
          var oc = order[oi], r = colorRanges[oc];
          if (perColorTarget[oc] < r.max) { perColorTarget[oc]++; extra--; progressed = true; }
        }
        if (!progressed) break;
      }
      if (extra > 0) return { queues: {}, plans: [], ok: false, reason: 'target_car_allocation_failed',
        minTotalCars: minTotal, maxTotalCars: maxTotal, targetCars: target, colorRanges: colorRanges };
    }
    for (var i = 0; i < colors.length; i++) {
      var col = colors[i];
      var p = mixOpts
        ? mixedCapacityPlanForColor(totals[col], minCap, maxCap, target == null ? null : perColorTarget[col], mixOpts)
        : capacityPlanForColor(totals[col], minCap, maxCap, target == null ? null : perColorTarget[col]);
      queues[col] = p.caps.slice(); plans.push({ color: col, total: p.total, caps: p.caps, exact: p.exact, reason: p.reason });
      if (mixOpts) plans[plans.length - 1].mix = p.mix || null;
    }
    return { queues: queues, plans: plans, ok: true, minTotalCars: minTotal, maxTotalCars: maxTotal,
      targetCars: target, colorRanges: colorRanges, targetCarsFeasible: target == null || true,
      capacityMix: mixOpts ? { enabled: true, smallMax: mixOpts.smallMax || 18,
        anchorRatio: mixOpts.anchorRatio != null ? +mixOpts.anchorRatio : 0.3,
        queueOrder: mixOpts.queueOrder || 'desc' } : null };
  }
  function plan(level, config, opts) {
    opts = opts || {};
    var policy = opts.policy || config && config.instantPlanPolicy || 'supply';
    var lv = parsed(level), blocks = lv.blocks, rows = lv.rows || blocks.length, cols = lv.cols || (blocks[0] || []).length;
    var capMin = Math.max(1, parseInt(config && config.boxSizeMin, 10) || 1);
    var capMax = Math.max(capMin, parseInt(config && config.boxSizeMax, 10) || capMin);
    var bufferLimit = Math.max(1, parseInt(config && config.bufferLimit, 10) || lv.bufferLimit || 5);
    var elim = AntSolver.outsideReachSeed(blocks, rows, cols, false);
    var targetCars = config && config.targetCarCount != null && +config.targetCarCount > 0 ? +config.targetCarCount : null;
    var _mix = config && config.capacityMix;
    var mixOpts = _mix && _mix.enabled ? {
      smallMax: _mix.smallMax != null ? +_mix.smallMax : 18,
      anchorRatio: _mix.anchorRatio != null ? +_mix.anchorRatio : 0.3,
      queueOrder: _mix.queueOrder === 'asc' ? 'asc' : 'desc'
    } : null;
    var capBuilt = buildCapacityQueues(blocks, rows, cols, capMin, capMax, targetCars, mixOpts), capQueues = capBuilt.queues, capIndex = {};
    if (capBuilt.ok === false) {
      var badBoxes = [];
      badBoxes._instantPlayout = { schema: 'instant-playout-v2', ok: false, reason: capBuilt.reason,
        policy: policy, capRange: [capMin, capMax], targetCars: targetCars,
        minTotalCars: capBuilt.minTotalCars, maxTotalCars: capBuilt.maxTotalCars,
        targetCarsFeasible: false, capacityPlans: capBuilt.plans || [] };
      return { ok: false, reason: capBuilt.reason, boxes: badBoxes, cars: [], seq: null, audit: { targetCarsFeasible: false } };
    }
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
      var candidates = [];
      for (var bi = 0; bi < colors.length; bi++) {
        var n = reachableCount(colors[bi], start);
        var qci = capIndex[colors[bi]] || 0, qcap = (capQueues[colors[bi]] || [])[qci] || 0;
        candidates.push({ color: colors[bi], reach: n, cap: qcap, debt: qcap - n });
        if (n > bestReach) { bestReach = n; bestColor = colors[bi]; }
      }
      if (policy === 'shortDebt' || policy === 'mixedDebt') {
        var debtCandidates = candidates.filter(function (x) { return x.debt > 0 && x.reach > 0; });
        debtCandidates.sort(function (a, b) { return a.debt - b.debt || b.reach - a.reach || a.color - b.color; });
        var debtEvery = Math.max(2, parseInt(opts.debtEvery || config && config.instantPlanDebtEvery, 10) || 2);
        // v546：只剩最后一个空槽时不再主动塞新债务车；否则短债策略容易把
        // 5 个槽全部占成“能消一点但消不完”的车，随后 buffer_full_no_progress。
        var debtSlotSafe = active.length < bufferLimit - 1;
        var useDebt = debtSlotSafe && (policy === 'shortDebt' || (cars.length % debtEvery === debtEvery - 1));
        if (useDebt && debtCandidates.length) { bestColor = debtCandidates[0].color; bestReach = debtCandidates[0].reach; }
      }
      if (policy === 'targetBuffer') {
        var tProg = total ? done / total : 0;
        var pLo = opts.pressureLo != null ? +opts.pressureLo : (config && config.instantPlanPressureLo != null ? +config.instantPlanPressureLo : 0.15);
        var pHi = opts.pressureHi != null ? +opts.pressureHi : (config && config.instantPlanPressureHi != null ? +config.instantPlanPressureHi : 0.72);
        var tBuf = Math.max(1, parseInt(opts.targetBuffer || config && config.instantPlanTargetBuffer, 10) || 3);
        var maxDebt = Math.max(1, parseInt(opts.maxDebt || config && config.instantPlanMaxDebt, 10) || 8);
        var debts = candidates.filter(function (x) { return x.debt >= 2 && x.debt <= maxDebt && x.reach > 0; })
          .sort(function (a, b) { return b.debt - a.debt || b.reach - a.reach || a.color - b.color; });
        if (tProg >= pLo && tProg <= pHi && active.length < tBuf && debts.length) {
          bestColor = debts[0].color; bestReach = debts[0].reach;
        } else {
          var supplies = candidates.filter(function (x) { return x.debt <= 0; }).sort(function (a, b) { return b.reach - a.reach || a.color - b.color; });
          if (supplies.length) { bestColor = supplies[0].color; bestReach = supplies[0].reach; }
        }
      }
      if (bestColor == null || bestReach <= 0) { deadlock = true; deadlockReason = 'no_reachable_color'; break; }
      var ci = capIndex[bestColor] || 0, queue = capQueues[bestColor] || [];
      var cap = queue[ci] || 0;
      capIndex[bestColor] = ci + 1;
      if (!(cap > 0)) { deadlock = true; deadlockReason = 'capacity_unavailable'; break; }
      var car = { id: cars.length + 1, color: bestColor, cap: cap, remaining: cap, consumed: 0,
        slot: slot, start: start, pixels: [], finished: false, active: true, enterOrder: cars.length + 1,
        bufferBefore: active.length, entryReach: bestReach, colorRemaining: rem[bestColor], debt: cap - bestReach };
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
    var maxBuffer = Math.max.apply(null, cars.map(function (c) { return c.bufferBefore + 1; }).concat([0]));
    boxes._instantPlayout = { schema: 'instant-playout-v2', ok: ok, reason: ok ? null : (deadlockReason || 'coverage_incomplete'), policy: policy,
      cars: cars.length, covered: done, total: total, capRange: [capMin, capMax], audit: audit,
      targetCars: targetCars, minTotalCars: capBuilt.minTotalCars, maxTotalCars: capBuilt.maxTotalCars,
      targetCarsFeasible: capBuilt.ok !== false,
      capacityPlans: capBuilt.plans, exactCapacityColors: capBuilt.plans.filter(function (x) { return x.exact; }).length,
      infeasibleCapacityColors: capBuilt.plans.filter(function (x) { return !x.exact; }).length,
      bufferEvents: cars.filter(function (c) { return c.bufferBefore > 0; }).length,
      debtCars: cars.filter(function (c) { return c.debt > 0; }).length,
      maxBuffer: maxBuffer,
      medianEntryReach: median(cars.map(function (c) { return c.entryReach; })),
      medianConsumed: median(cars.map(function (c) { return c.consumed; })),
      carSequence: cars.map(function (c) { return { id: c.id, color: c.color, cap: c.cap, slot: c.slot,
        start: c.start, enterOrder: c.enterOrder, finishOrder: c.finishOrder || null, entryReach: c.entryReach,
        colorRemaining: c.colorRemaining, consumed: c.consumed, debt: c.debt }; }) };
    if (capBuilt.capacityMix) boxes._instantPlayout.capacityMix = capBuilt.capacityMix;
    return { ok: ok, reason: boxes._instantPlayout.reason, boxes: boxes, cars: cars, seq: seq, audit: audit };
  }
  return { plan: plan, capacityPlanForColor: capacityPlanForColor };
})();
