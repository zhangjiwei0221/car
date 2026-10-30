/** v509 · TXT目标图只读预检：静态风险提示，不武断判不可生成，不改图。 */
var AntSolver = AntSolver || {};
AntSolver.SourcePreflight = (function () {
  function demandAnalysis(blocks) {
    var rows = blocks.length, cols = blocks[0].length, total = 0, byColor = {}, consumed = {}, contribution = {};
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      var color = blocks[r][c]; if (color > 0) { total++; byColor[color] = (byColor[color] || 0) + 1; contribution[color] = 0; }
    }
    var s = AntSolver.Simulator.createState({ blocks: blocks, rows: rows, cols: cols, totalPixels: total,
      totalBoxes: 0, bufferLimit: 5, board: { rows: 0, cols: 0, cells: [] } }, {});
    var previous = {}, events = [], done = 0, guard = 0, initial = null;
    function available() {
      var pv = AntSolver.Simulator.previewNextEliminationOrder(s), out = {};
      for (var col in byColor) out[col] = (consumed[col] || 0) + ((pv.byColor[col] && pv.byColor[col].reachable) || 0);
      return { values: out, preview: pv };
    }
    while (done < total && guard++ < 400) {
      var av = available(), best = -1, bestN = 0;
      if (!initial) initial = av.values;
      for (var col in byColor) {
        var n = av.preview.byColor[col] && av.preview.byColor[col].reachable || 0;
        if (n > bestN) { bestN = n; best = +col; }
      }
      if (best < 0) break;
      var got = AntSolver.Simulator.elimDispatch(s, best, Infinity);
      if (!(got > 0)) break;
      consumed[best] = (consumed[best] || 0) + got; done += got;
      var after = available(), added = {};
      for (var cc in byColor) {
        var delta = Math.max(0, (after.values[cc] || 0) - (av.values[cc] || 0));
        if (delta > 0) { added[cc] = delta; if (+cc !== best) contribution[best] = (contribution[best] || 0) + delta; }
      }
      events.push({ step: guard, progress: total ? done / total : 0, unlockerColor: best, added: added });
    }
    return { total: total, byColor: byColor, initialExposed: initial || {}, events: events,
      unlockContribution: contribution, completed: done >= total, donePixels: done };
  }
  function analyze(blocks, opts) {
    opts = opts || {};
    if (!blocks || !blocks.length || !blocks[0] || !blocks[0].length) return { status: 'invalid', reasons: ['empty_or_invalid_blocks'] };
    var d = demandAnalysis(blocks), band = AntSolver.Generator ? AntSolver.Generator.deriveCapacityBand(blocks) : null;
    var lo = band && band.band[0] || null, hi = band && band.band[1] || null, chosen = band && band.chosen || null;
    var openingColors = Object.keys(d.initialExposed).filter(function (c) { return d.initialExposed[c] > 0; });
    var lateMap = {};
    for (var i = 0; i < d.events.length; i++) if (d.events[i].progress >= 0.8) {
      for (var col in d.events[i].added) if (d.events[i].added[col] > 0) lateMap[col] = true;
    }
    var lateColors = Object.keys(lateMap).map(Number), smallCritical = [];
    for (var c in d.byColor) if (lo != null && d.byColor[c] < lo && d.unlockContribution[c] > 0) {
      smallCritical.push({ color: +c, total: d.byColor[c], unlockPixels: d.unlockContribution[c],
        note: '小色也可承担关键债务，不因面积排除。' });
    }
    var estimatedCars = chosen ? Math.max(1, Math.round(d.total / chosen)) : null;
    var boardCells = 36, estimatedBlackPct = estimatedCars ? Math.max(0, Math.round((boardCells - estimatedCars) / boardCells * 100)) : null;
    var warnings = [], suggestions = [], notes = [];
    if (band && (!band.feasible || (band.free != null && band.free > 2))) {
      warnings.push('opening_free_supply');
      suggestions.push('开局按当前容量估计白给车较多：可减少开局暴露色/面积，或增加分层依赖；先用短预算探针。');
    }
    if (band && band.bandExactFeasible === false) {
      notes.push('capacity_remainder');
      suggestions.push('部分颜色无法在容量带内精确拆完：检查余量车，不为追求全在区间而破坏守恒。');
    }
    if (d.events.length < 3) {
      warnings.push('flat_demand');
      suggestions.push('需求解锁层次较少：若目标为持续3/4，建议增加分层或分支解锁，而非继续加障碍。');
    }
    if (lateColors.length === 1) {
      warnings.push('late_single_color');
      suggestions.push('末段只有一个新增供给色：容易形成末段强堵，建议保留第二推进色或提前安排偿还。');
    }
    if (estimatedBlackPct != null && estimatedBlackPct > 25) {
      warnings.push('car_board_conflict');
      suggestions.push('按容量中值估计车数偏少、6×6补位黑块可能较多：需要联合调整车数/容量/棋盘，而非单纯压黑块。');
    }
    if (!d.completed) { warnings.push('demand_analysis_incomplete'); suggestions.push('静态需求分析未走完，先检查目标图可达结构；不把未知当不可解。'); }
    if (smallCritical.length) suggestions.push('存在小但关键的颜色：可围绕其解锁贡献设计关键债务，不要按面积删除。');
    var status = warnings.length ? 'review' : 'ready';
    return { schema: 'source-preflight-v1', status: status, warnings: warnings, notes: notes, suggestions: suggestions,
      totalPixels: d.total, colorCount: Object.keys(d.byColor).length, colorTotals: d.byColor,
      capacity: band ? { m: band.m, band: band.band, chosen: chosen, free: band.free, feasible: band.feasible,
        exactFeasible: band.bandExactFeasible, infeasibleColors: band.bandInfeasibleColors } : null,
      opening: { colors: openingColors.map(Number), exposed: d.initialExposed },
      demand: { completed: d.completed, unlockEvents: d.events.length, lateColors: lateColors,
        unlockContribution: d.unlockContribution, smallCriticalColors: smallCritical },
      estimate: { carsAtChosenCapacity: estimatedCars, boardCellsForBlackEstimate: boardCells, blackPctEstimate: estimatedBlackPct },
      searchAdvice: warnings.length ? '先短预算探针并复核，不建议直接长时间搜索' : '可进入常规生成',
      note: '静态预检只提示风险，不证明能/不能生成目标关；小色关键性由解锁贡献判断。' };
  }
  return { analyze: analyze, demandAnalysis: demandAnalysis };
})();
