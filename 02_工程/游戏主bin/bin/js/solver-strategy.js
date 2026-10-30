/**
 * 蚂蚁拿块求解器 - 搜索策略模块（三步前瞻·阶段化·暂存压力·锁链整组评估）
 * ================================================================
 * 依据《三步前瞻选盒策略需求优化稿》实现，取代旧的“毛线式启发式 + 噪声碰撞”。
 *
 * 核心：每次决策做【宽3 × 深3】前瞻树（≤27 条三步路径），每个候选都在【独立克隆状态】里真实执行一次，
 *   用【执行后的真实差值】评分；只执行最佳路径第一步，然后基于新真实状态重新建树。
 *
 * 分阶段主目标（盒进度 = 已完全消除盒数 / 总盒数，总盒含管道内部盒）：
 *   前期 <20% → 最大化棋盘盒拓展；中期 20~50% → 最大化目标图可达/可消色拓展；后期 ≥50% → 生存(避免暂存死亡)。
 * 暂存压力(N=上限)：轻 ≤N-2 允许激进；中 =N-1 转保守；高 =N 候选必须释放≥1 个本步前已存在的暂存盒，否则淘汰/判死。
 *
 * 性能：克隆用手写浅/结构拷贝(不走 JSON)；打分只用【廉价可点集(isPickable)+标量差值】，目标图可达统计仅中期算；
 *   完整 listMoves(含 canConsume) 仅对将要【展开】的 Top-K 节点惰性计算。
 *
 * 对外接口：chooseLookahead(level,opts) / pickBestMove(state,moves,ctx={lookahead,noise,rng}) → move|null
 */
var AntSolver = AntSolver || {};

AntSolver.SolverStrategy = (function () {
  var Sim = AntSolver.Simulator;
  var DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  var CFG = {
    width: 3, depth: 3, prescan: 5,
    wElim: 1.0, wFullConsume: 12, wRelease: 40, wChainNow: 30,
    wNumIce: 3, wChainAct: 4, wPipe: 3,
    // 锁链滞留周期奖励(§4)基础系数：release=整组释放基准分(乘 chainDwellWeight×timingMultiplier)；
    // advance=每单位剩余消除量推进的基准分(乘 chainDwellWeight)。均高于 wChainNow，保证暂存压力升高时
    // "促进锁链释放"优先于普通棋盘/目标图拓展(§4.6 末句)。
    wChainDwellRelease: 26, wChainDwellAdvance: 3.5
  };
  var PHASE_W = {
    early: { board: 8.0, color: 4.0, target: 0.05, tcolor: 2.0, survive: 1.0, elim: 0.6 },
    mid:   { board: 2.0, color: 1.5, target: 0.07, tcolor: 6.0, survive: 1.5, elim: 1.0 },
    late:  { board: 0.6, color: 0.5, target: 0.02, tcolor: 1.0, survive: 6.0, elim: 0.8 }
  };

  function chooseLookahead(level, opts) { return (opts && opts.lookahead != null) ? opts.lookahead : CFG.depth; }

  function phaseOf(state) {
    var p = state.totalBoxes ? state.completedBoxes / state.totalBoxes : 0;
    if (p < 0.20) return 'early';
    if (p < 0.50) return 'mid';
    return 'late';
  }
  function pressureOf(bufCount, N) { if (bufCount <= N - 2) return 'light'; if (bufCount === N - 1) return 'mid'; return 'high'; }

  // ---------- 快速克隆（不走 JSON.deepClone） ----------
  function cloneState(state) {
    var buf = new Array(state.buffer.length);
    for (var i = 0; i < state.buffer.length; i++) { var b = state.buffer[i]; buf[i] = { color: b.color, progress: b.progress, need: b.need, remaining: b.remaining, key: b.key, slot: b.slot, start: b.start, enterStep: b.enterStep, chain: b.chain, link: b.link }; }
    var activated = {}; for (var k in state.activated) activated[k] = state.activated[k];
    var removed = {}; if (state.removed) for (var k2 in state.removed) removed[k2] = state.removed[k2];
    // 数字冰运行态必须克隆：不带上它，前瞻分支会把"还没破碎的数字冰"当成可取 →
    //   求解器算出一条现实里走不通的路线（这类漏字段最难查，必须显式带上）。
    var numice = {}; if (state.numice) for (var k4 in state.numice) { var itn = state.numice[k4]; numice[k4] = { remaining: itn.remaining }; }
    var elim = new Array(state.rows);
    for (var r = 0; r < state.rows; r++) elim[r] = state.eliminated[r].slice();
    return {
      level: state.level, rows: state.rows, cols: state.cols, blocks: state.blocks,
      eliminated: elim, buffer: buf, bufferLimit: state.bufferLimit, totalPixels: state.totalPixels,
      boardRows: state.boardRows, boardCols: state.boardCols, cells: Sim.cloneCells(state.cells),
      activated: activated, removed: removed, chainGroups: state.chainGroups || [],
      numice: numice,
      steps: state.steps, totalBoxes: state.totalBoxes, eliminatedPixels: state.eliminatedPixels,
      completedBoxes: state.completedBoxes, _linkSeq: state._linkSeq || 0, _keySeq: state._keySeq || 0,
      capture: false, capturePreviewStats: false, pressureSamples: null, history: [],
      gameOver: state.gameOver, gameWon: state.gameWon, overflow: state.overflow || false,
      useSlotStart: state.useSlotStart, bottomOnly: state.bottomOnly,
      // 三步前瞻的每个节点必须与本关同一消除口径（需求 §八.1）：克隆态一并带上模式开关，
      // 否则会出现「主线按瞬时连锁结算、前瞻分支按原口径展开」的分裂。
      instantChain: state.instantChain,
      resSum: state.resSum || 0, resCount: state.resCount || 0
    };
  }

  // ---------- 廉价可点集：只用 isPickable(无 floodFill)，供拓展/死活判定 ----------
  function pickableSet(s) {
    var pos = {}, col = {}, list = [], n = 0;
    for (var r = 0; r < s.boardRows; r++) for (var c = 0; c < s.boardCols; c++) {
      var cell = s.cells[r][c];
      if (!cell || cell.t !== 'box') continue;
      if (!Sim.isPickable(s, r, c)) continue;
      pos[r + ',' + c] = 1; col[cell.color] = 1; n++;
      list.push({ r: r, c: c, color: cell.color, count: cell.count, chain: cell.chain || 0 });
    }
    return { pos: pos, col: col, count: n, list: list };
  }
  function countNew(after, before) { var n = 0; for (var k in after) if (!before[k]) n++; return n; }

  // 执行后是否还有“可行(不溢出)动作” —— 死活判定；避免全量 listMoves
  function viableAfter(s, pick, bufferAfter, N, won) {
    if (won) return true;
    if (pick.count === 0) return false;
    if (bufferAfter < N) return true;              // 暂存未满：普通盒可取(即便进暂存也不溢出)
    var open = Sim.computeExteriorOpen(s);         // 暂存满：只有能当场消完的普通盒可行(锁链放不下)
    for (var i = 0; i < pick.list.length; i++) {
      var pb = pick.list[i]; if (pb.chain > 0) continue;
      if (Sim.canConsumeReach(s, { color: pb.color, count: pb.count }, open)) return true;
    }
    return false;
  }

  // ---------- 目标图可达统计(一次 O(area))：可达像素数 + 可达颜色数 ----------
  function reachableTargetStats(state) {
    var rows = state.rows, cols = state.cols, blocks = state.blocks, elim = state.eliminated, bottomOnly = state.bottomOnly;
    var open = Sim.computeExteriorOpen(state);
    var visited = new Uint8Array(rows * cols), stack = [];
    var pixels = 0, colorSet = {};
    function edge(r, c) { return bottomOnly ? (r === rows - 1) : (r === 0 || r === rows - 1 || c === 0 || c === cols - 1); }
    function seedable(r, c) {
      if (edge(r, c)) return true;
      if (r > 0 && open[(r - 1) * cols + c]) return true;
      if (r < rows - 1 && open[(r + 1) * cols + c]) return true;
      if (c > 0 && open[r * cols + (c - 1)]) return true;
      if (c < cols - 1 && open[r * cols + (c + 1)]) return true;
      return false;
    }
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      var id = r * cols + c;
      if (visited[id] || elim[r][c]) continue;
      var color = blocks[r][c]; if (color <= 0) continue;
      if (!seedable(r, c)) continue;
      visited[id] = 1; stack.length = 0; stack.push(id);
      while (stack.length) {
        var cur = stack.pop(); pixels++; colorSet[color] = 1;
        var cr = (cur / cols) | 0, cc = cur % cols;
        for (var kk = 0; kk < 4; kk++) {
          var nr = cr + DIRS[kk][0], nc = cc + DIRS[kk][1];
          if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
          var nid = nr * cols + nc;
          if (visited[nid] || elim[nr][nc] || blocks[nr][nc] !== color) continue;
          visited[nid] = 1; stack.push(nid);
        }
      }
    }
    var cc2 = 0; for (var c3 in colorSet) cc2++;
    return { pixels: pixels, colorCount: cc2 };
  }

  /** 数字冰剩余球数之和：该值下降 = 本步推进了数字冰倒计时（老冰下线后取代原 iceThawSum）。 */
  function numIceRemainSum(s) { var t = 0; if (s.numice) for (var k in s.numice) { var it = s.numice[k]; if (it && it.remaining > 0) t += it.remaining; } return t; }
  function pipeNextSum(s) { var t = 0; for (var r = 0; r < s.boardRows; r++) for (var c = 0; c < s.boardCols; c++) { var cell = s.cells[r][c]; if (cell && cell.t === 'pipe') t += cell.next || 0; } return t; }
  function activatedCount(s) { var n = 0; for (var k in s.activated) n++; return n; }
  function bufKeySet(s) { var set = {}; for (var i = 0; i < s.buffer.length; i++) set[s.buffer[i].key] = 1; return set; }

  // ---------- 锁链滞留周期奖励（需求：三步前瞻选盒策略_需求优化稿 §4）----------
  // 按 link 分组汇总某状态暂存区里【正在滞留】的锁链组：剩余总消除量 / 占用槛位数 / 各成员颜色集合。
  // 只读 state.buffer，不区分"真实"或"假设(克隆)"状态——真假之分由 dwell(滞留步数) 的来源决定(见下)。
  function chainRemainingSnapshot(state) {
    var byLink = {};
    for (var i = 0; i < state.buffer.length; i++) {
      var b = state.buffer[i]; if (!b.link) continue;
      var g = byLink[b.link] || (byLink[b.link] = { remaining: 0, slots: 0, colors: {} });
      g.remaining += (b.need - b.progress); g.slots++; g.colors[b.color] = 1;
    }
    return byLink;
  }
  // 滞留基线：只在每次 treePick() 真正被调用时(即每个"真实决策步")从【真实根状态】读一次，
  //   树内任意假设深度都复用同一份基线——假设步骤永远不会推进/篡改真实滞留步数(§4.2/4.3)。
  //   dwell = 当前真实决策步(state.steps) − 锁链进入暂存的真实步骤(enterStep)。
  function buildDwellBaseline(state) {
    var rootStep = state.steps, groups = {};
    for (var i = 0; i < state.buffer.length; i++) {
      var b = state.buffer[i]; if (!b.link) continue;
      var g = groups[b.link] || (groups[b.link] = { link: b.link, enterStep: b.enterStep || 0, members: 0, totalRemaining: 0 });
      g.members++; g.totalRemaining += (b.need - b.progress);
    }
    var list = [];
    for (var lk in groups) { var g2 = groups[lk]; g2.dwell = Math.max(0, rootStep - g2.enterStep); g2.slots = g2.members; list.push(g2); }
    return { rootStep: rootStep, byLink: groups, groups: list };
  }

  // ---------- 父态快照(该节点所有候选共用) ----------
  function snapshot(state, phase) {
    return {
      bufKeys: bufKeySet(state), elim: state.eliminatedPixels, completed: state.completedBoxes,
      numIceRemain: numIceRemainSum(state), pipeNext: pipeNextSum(state), actCount: activatedCount(state),
      pick: pickableSet(state), reach: phase === 'mid' ? reachableTargetStats(state) : null,
      bufLen: state.buffer.length,
      chainByLink: chainRemainingSnapshot(state)   // 该节点(该父态)暂存里各锁链组的剩余量快照，供子候选比差值
    };
  }
  // 锁链滞留奖励权重：滞留步数越长/占槛位越多(3连>2连)/当前暂存压力越高，权重越高(§4.5-①②③)。
  //   dwell/slots 取自【真实根态】的 dwellBaseline(不随假设深度变化)；bufLen 取该决策节点(可能是假设态)当前暂存量。
  function chainDwellWeight(g, N, bufLen) {
    var w = 1 + Math.min(8, g.dwell) * 0.6;             // 滞留越久，奖励越高(封顶+4.8，避免无界发散)
    w *= (1 + Math.max(0, g.slots - 2) * 0.35);          // 3连(slots=3)比2连(slots=2)额外+35%
    var pressureRatio = bufLen / Math.max(1, N);
    w *= (1 + Math.max(0, pressureRatio - 0.4) * 1.8);   // 暂存压力越高，奖励放大越多
    return w;
  }
  // 单步锁链推进/释放明细：对比 pre(节点前)与 clone(节点后)里各"根态仍滞留"锁链组的剩余量，
  //   得到该步对每个锁链组的【推进量】与【是否整组释放】(剩余量由>0变为0)。只统计 dwellBaseline 里的组
  //   (即真实决策时刻已在暂存滞留的组)，新入场的锁链走既有 chainReleasedNow/fullConsume 路径，不重复计分。
  function chainDwellHitsOf(parent, clone, pre, dwellBaseline, N) {
    if (!dwellBaseline || !dwellBaseline.groups.length) return null;
    var postChain = chainRemainingSnapshot(clone), hits = null;
    for (var i = 0; i < dwellBaseline.groups.length; i++) {
      var dg = dwellBaseline.groups[i], link = dg.link;
      var beforeG = pre.chainByLink ? pre.chainByLink[link] : null;
      var beforeRem = beforeG ? beforeG.remaining : 0;
      if (beforeRem <= 0) continue;   // 该组在此节点前已不在暂存(路径更早已释放/或本就不在)，不重复计分
      var afterG = postChain[link];
      var afterRem = afterG ? afterG.remaining : 0;
      var advance = Math.max(0, beforeRem - afterRem);
      var released = afterRem === 0;   // 剩余量归零=整组释放(与模拟器 autoReleaseBuffer 的整组离场条件一致)
      if (advance > 0 || released) {
        (hits || (hits = [])).push({ link: link, advance: advance, released: released, weight: chainDwellWeight(dg, N, parent.buffer.length) });
      }
    }
    return hits;
  }

  // ---------- 候选特征：克隆父态、真实执行、与快照比差值(廉价) ----------
  function candidateFeatures(parent, move, pre, phase, N, dwellBaseline) {
    var clone = cloneState(parent);
    Sim.applyPick(clone, move.r, move.c);
    var eliminated = clone.eliminatedPixels - pre.elim;
    var completedDelta = clone.completedBoxes - pre.completed;
    var postBufKeys = bufKeySet(clone);
    var releasedPre = 0; for (var k in pre.bufKeys) if (!postBufKeys[k]) releasedPre++;
    var newBufN = 0; for (var k2 in postBufKeys) if (!pre.bufKeys[k2]) newBufN++;
    var bufferAfter = clone.buffer.length;
    var overflow = !!clone.overflow;
    var won = clone.eliminatedPixels >= clone.totalPixels;

    var pick = pickableSet(clone);
    var newClickable = countNew(pick.pos, pre.pick.pos);
    var newColors = countNew(pick.col, pre.pick.col);

    var newReachPixels = 0, newReachColors = 0;
    if (phase === 'mid' && pre.reach) { var ra = reachableTargetStats(clone); newReachPixels = ra.pixels - pre.reach.pixels; newReachColors = ra.colorCount - pre.reach.colorCount; }

    var numIceDelta = Math.max(0, pre.numIceRemain - numIceRemainSum(clone));   // 本步推进的数字冰倒计时量
    var pipeDelta = pipeNextSum(clone) - pre.pipeNext;
    var actDelta = activatedCount(clone) - pre.actCount;

    var isChain = (move.groupSize || 1) > 1;
    var chainReleasedNow = isChain && newBufN === 0;   // 锁链整组当步消完(未滞留)
    var viable = viableAfter(clone, pick, bufferAfter, N, won);
    var dead = overflow || (!won && !viable);
    // 锁链滞留周期奖励(§4.4)：本步是否推进/整组释放了【决策时刻已在滞留的】锁链组(不含本步新入场的锁链)。
    var chainDwellHits = dwellBaseline ? chainDwellHitsOf(parent, clone, pre, dwellBaseline, N) : null;

    return {
      move: move, clone: clone, pick: pick,
      eliminated: eliminated, completedDelta: completedDelta, releasedPre: releasedPre,
      bufferAfter: bufferAfter, overflow: overflow, won: won, dead: dead,
      fullConsume: (isChain ? chainReleasedNow : (eliminated >= (move.antBox ? move.antBox.count : 1))),
      newClickable: newClickable, newColors: newColors, newReachPixels: newReachPixels, newReachColors: newReachColors,
      numIceDelta: numIceDelta, pipeDelta: pipeDelta, actDelta: actDelta,
      isChain: isChain, chainReleasedNow: chainReleasedNow, chainDwellHits: chainDwellHits
    };
  }

  function bufferPenalty(bufferAfter, N, phase) {
    var over = bufferAfter - (N - 2);
    if (over <= 0) return 0;
    var base = over * over * 6;
    if (phase === 'late') base *= 2.2; else if (phase === 'mid') base *= 1.4;
    return base;
  }
  // 三步窗口内释放时机权重(§4.5-④)：当前真实步骤释放 > 下一步释放 > 第三步释放。stepIdx=1/2/3 对应窗口第几步。
  function timingMultiplier(stepIdx) { if (stepIdx <= 1) return 3.0; if (stepIdx === 2) return 2.0; return 1.3; }
  // 该步对滞留锁链组的专项奖励(§4.4/4.5)：推进(未整组释放)按剩余消除量记分；整组释放按窗口时机放大，
  //   是该锁链滞留周期内的最高奖励档(§4.5-⑥)。stepIdx=本步在当前三步窗口中的序号(1/2/3)。
  function chainDwellScoreOf(hits, stepIdx) {
    if (!hits || !hits.length) return 0;
    var s = 0;
    for (var i = 0; i < hits.length; i++) {
      var h = hits[i];
      if (h.released) s += h.weight * CFG.wChainDwellRelease * timingMultiplier(stepIdx);
      else if (h.advance > 0) s += h.weight * CFG.wChainDwellAdvance * h.advance;
    }
    return s;
  }
  function scoreCandidate(f, phase, pressure, N) {
    var w = PHASE_W[phase], s = 0;
    s += f.eliminated * CFG.wElim * w.elim;
    if (f.fullConsume) s += CFG.wFullConsume;
    s += f.releasedPre * CFG.wRelease;
    if (f.chainReleasedNow) s += CFG.wChainNow;
    s += f.newClickable * w.board + f.newColors * w.color;
    s += Math.max(0, f.newReachPixels) * w.target + Math.max(0, f.newReachColors) * w.tcolor;
    s += f.numIceDelta * CFG.wNumIce + f.actDelta * CFG.wChainAct + f.pipeDelta * CFG.wPipe;
    s += f.chainDwellScore || 0;   // 锁链滞留周期奖励(§4)：滞留越久/占位越多/暂存越紧张/窗口内越早整组释放，奖励越高
    s -= bufferPenalty(f.bufferAfter, N, phase) * w.survive * 0.5;
    if (pressure !== 'light' && f.releasedPre === 0) {
      if (f.bufferAfter >= N) s -= 200; else if (f.bufferAfter >= N - 1) s -= 30;
    }
    return s;
  }

  // 廉价预分(无克隆)：canConsume + 同色暂存 + 位置；高压不可消普通盒重罚
  function prescore(state, move, pressure) {
    var box = move.antBox, s = 0;
    if (move.canConsume) s += 30;
    for (var i = 0; i < state.buffer.length; i++) if (state.buffer[i].color === box.color) { s += 10; break; }
    s -= move.r * 0.1;
    if (pressure === 'high' && !move.canConsume && (move.groupSize || 1) === 1) s -= 100;
    return s;
  }

  // 候选生成：非阻塞盒 → 预筛 prescan → 真实模拟评分 → 过滤(溢出/高压不释放) → 按分降序
  // dwellBaseline：来自【真实根决策状态】的锁链滞留快照(整棵树共用同一份，假设步骤不改写它)；
  // stepIdx：该批候选执行后落在三步窗口的第几步(1/2/3)，供锁链释放时机加权(§4.5-④)。
  function genScoredCandidates(state, moves, N, dwellBaseline, stepIdx) {
    stepIdx = stepIdx || 1;
    var phase = phaseOf(state), pressure = pressureOf(state.buffer.length, N);
    var pre = snapshot(state, phase);
    var pool = [];
    for (var i = 0; i < moves.length; i++) { var m = moves[i]; if (m.blocked) continue; pool.push({ m: m, pre: prescore(state, m, pressure) }); }
    pool.sort(function (a, b) { return b.pre - a.pre; });
    var lim = CFG.prescan > 0 ? Math.min(CFG.prescan, pool.length) : pool.length;
    var out = [];
    for (var j = 0; j < lim; j++) {
      var f = candidateFeatures(state, pool[j].m, pre, phase, N, dwellBaseline);
      if (f.overflow) continue;
      // 高压(buffer=N)：需能续命——释放已有暂存盒 或 至少当步有实际消除(不溢出即安全)。
      // 注：溢出已在上一行过滤；纯占位不消除的动作会溢出→已排除。放宽 §4.3 的“必须释放已有盒”硬门以免误判死亡。
      if (pressure === 'high' && f.releasedPre < 1 && f.eliminated <= 0) continue;
      f.chainDwellScore = chainDwellScoreOf(f.chainDwellHits, stepIdx);
      out.push({ f: f, score: scoreCandidate(f, phase, pressure, N) });
    }
    out.sort(function (a, b) { return b.score - a.score; });
    return { list: out, phase: phase, pressure: pressure };
  }

  // ================= 贪心模式（快·第一优先，毛线口径单步评分） =================
  function greedyEvaluateMove(state, move) {
    var score = 0, antBox = move.antBox;
    if (move.canConsume) score += 30;
    else { var bufLen = state.buffer.length; if (bufLen >= 4) score -= 20; else if (bufLen >= 3) score -= 10; else if (bufLen >= 2) score -= 5; else score -= 2; }
    var tempElim = []; for (var r = 0; r < state.rows; r++) tempElim.push(state.eliminated[r].slice());
    // 打分用的试算也必须走本关的消除口径，否则打分依据与真实结算不一致（需求 §七.2 禁止口径分裂）
    var potential = Sim.elimOnMatrix(tempElim, state, antBox.color, antBox.count, null, move.start || null);
    score += potential * 2;
    if (state.buffer.length > 0) {
      var bufferRelease = 0, scratch = []; for (var r2 = 0; r2 < state.rows; r2++) scratch.push(tempElim[r2].slice());
      for (var i = 0; i < state.buffer.length; i++) { var item = state.buffer[i], remaining = item.need - item.progress; var canRelease = Sim.elimOnMatrix(scratch, state, item.color, remaining, null, item.start || null); if (canRelease >= remaining) bufferRelease++; }
      score += bufferRelease * 15;
    }
    for (var j = 0; j < state.buffer.length; j++) { if (state.buffer[j].color === antBox.color) { score += 8; break; } }
    if (!move.canConsume) { var fillRatio = state.buffer.length / (state.bufferLimit || 5); score -= fillRatio * fillRatio * 25; }
    score -= move.r * 0.05;
    return score;
  }
  function greedyPick(state, moves, ctx) {
    var noise = ctx.noise || 0, rng = ctx.rng || Math.random, best = null, bestScore = -Infinity;
    for (var m = 0; m < moves.length; m++) {
      var move = moves[m]; if (move.blocked) continue;
      var s = greedyEvaluateMove(state, move);
      if (noise > 0) s += (rng() - 0.5) * noise * 20;
      if (s > bestScore) { bestScore = s; best = move; }
    }
    return best;
  }

  // 选步分派：mode='tree' 走三步前瞻(多重策略)，否则走贪心(默认，快)。
  function pickBestMove(state, moves, ctx) {
    ctx = ctx || {};
    if (ctx.mode === 'tree') return treePick(state, moves, ctx);
    return greedyPick(state, moves, ctx);
  }

  // ================= 三步前瞻树（多重策略·强·较慢，仅贪心失败时兜底） =================
  // 每次真实决策(treePick 每次被调用)都是一次新的"真实第N步"：从【当前真实状态】重新建立三步窗口(§4.2)。
  // 锁链滞留基线(dwellBaseline)只取自本次调用的真实根 state，树内 1/2/3 层的假设步骤全部共用同一份基线、
  // 不会写回/推进真实滞留步数——真实滞留步数只在真实执行一步(applyMove 落地到真实 state)后才前移，
  // 即下一次 treePick 调用时用新的 state.steps 重新计算 dwell，天然满足"滚动前瞻"(§4.2/4.3/4.9-②③④)。
  function treePick(state, moves, ctx) {
    ctx = ctx || {};
    var N = state.bufferLimit || 5;
    var depth = ctx.lookahead != null ? ctx.lookahead : CFG.depth;
    var width = CFG.width;
    var noise = ctx.noise || 0, rng = ctx.rng || Math.random;
    var dwellBaseline = buildDwellBaseline(state);   // 本次真实决策的锁链滞留基线(§4.3)

    // firstReleaseAt：该路径【首次】让某个 dwellBaseline 锁链组整组释放的窗口步序号(1/2/3)，尚未释放则 null。
    function stepAgg(prev, f, d) {
      var releasedNow = !!(f.chainDwellHits && f.chainDwellHits.some(function (h) { return h.released; }));
      return {
        peak: Math.max(prev.peak, f.bufferAfter), leafBuf: f.bufferAfter,
        board: prev.board + f.newClickable + f.newColors * 0.5,
        target: prev.target + Math.max(0, f.newReachColors) + Math.max(0, f.newReachPixels) * 0.02,
        elim: prev.elim + f.eliminated, release: prev.release + f.releasedPre,
        chain: prev.chain + (f.chainReleasedNow ? 1 : 0),
        obstacle: prev.obstacle + f.numIceDelta + f.actDelta + f.pipeDelta,
        chainDwell: prev.chainDwell + (f.chainDwellScore || 0),
        firstReleaseAt: prev.firstReleaseAt != null ? prev.firstReleaseAt : (releasedNow ? d : null)
      };
    }
    function leafEval(agg, won) { return { peak: agg.peak, leafBuf: agg.leafBuf, board: agg.board, target: agg.target, elim: agg.elim, release: agg.release, chain: agg.chain, obstacle: agg.obstacle, chainDwell: agg.chainDwell, firstReleaseAt: agg.firstReleaseAt, won: won }; }

    // 展开一个已求得候选特征 f 的子树；d=已用深度(f 是第 d 步，即三步窗口内的 stepIdx)。返回最佳叶评价 或 null(全死)。
    function expandFrom(f, d, agg, phase) {
      if (f.won) return leafEval(agg, true);
      if (d >= depth) return leafEval(agg, false);
      var childMoves = Sim.listMoves(f.clone);          // 惰性：仅展开节点才算完整 listMoves
      var gen = genScoredCandidates(f.clone, childMoves, N, dwellBaseline, d + 1);
      if (!gen.list.length) return leafEval(agg, f.clone.eliminatedPixels >= f.clone.totalPixels);
      var topK = Math.min(width, gen.list.length), best = null;
      for (var i = 0; i < topK; i++) {
        var cf = gen.list[i].f;
        if (cf.dead && !cf.won) continue;
        var res = expandFrom(cf, d + 1, stepAgg(agg, cf, d + 1), phase);
        if (!res) continue;
        if (!best || pathScore(res, phase) > pathScore(best, phase)) best = res;
      }
      return best;   // 可能 null(全死)
    }

    var gen0 = genScoredCandidates(state, moves, N, dwellBaseline, 1);
    if (!gen0.list.length) return null;
    var phase = gen0.phase;
    var topK0 = Math.min(width, gen0.list.length);
    var initAgg = { peak: state.buffer.length, leafBuf: state.buffer.length, board: 0, target: 0, elim: 0, release: 0, chain: 0, obstacle: 0, chainDwell: 0, firstReleaseAt: null };
    var bestFirst = null, bestRes = null, bestVal = -Infinity, anyAlive = false;
    for (var i = 0; i < topK0; i++) {
      var f0 = gen0.list[i].f;
      var res;
      if (f0.won) res = leafEval(stepAgg(initAgg, f0, 1), true);
      else if (f0.dead) res = null;
      else res = expandFrom(f0, 1, stepAgg(initAgg, f0, 1), phase);
      if (!res) continue;
      anyAlive = true;
      var val = pathScore(res, phase) + (noise > 0 ? (rng() - 0.5) * noise * 8 : 0);
      if (val > bestVal) { bestVal = val; bestFirst = f0.move; bestRes = res; }
    }
    var chosen = anyAlive ? bestFirst : gen0.list[0].f.move;   // 全通向死亡：取单步最高，尽量续命(交暂存/兜底)

    // 锁链专项决策记录(§4.8，opt-in：ctx.recordChainDecisions=true 才采集，避免默认路径多余开销)。
    if (ctx.recordChainDecisions && dwellBaseline.groups.length) {
      var top3 = gen0.list.slice(0, Math.min(3, gen0.list.length));
      var chosenFeat = null;
      for (var ci = 0; ci < gen0.list.length; ci++) if (gen0.list[ci].f.move === chosen) { chosenFeat = gen0.list[ci].f; break; }
      var record = {
        step: state.steps, groups: dwellBaseline.groups.map(function (g) {
          return { link: g.link, dwell: g.dwell, slots: g.slots, remaining: g.totalRemaining };
        }),
        earliestReleaseStep: bestRes ? bestRes.firstReleaseAt : null,   // 最优路径内最早整组释放的窗口深度(1/2/3)，无则null
        top3Advance: top3.map(function (e) {
          var hits = e.f.chainDwellHits || [];
          return { move: { r: e.f.move.r, c: e.f.move.c }, chains: hits.map(function (h) { return { link: h.link, advance: h.advance, released: h.released }; }) };
        }),
        chosenAdvancesChain: !!(chosenFeat && chosenFeat.chainDwellHits && chosenFeat.chainDwellHits.length),
        chosenReleasesChainInWindow: !!(chosenFeat && chosenFeat.chainDwellHits && chosenFeat.chainDwellHits.some(function (h) { return h.released; })),
        chainDwellReward: chosenFeat ? (chosenFeat.chainDwellScore || 0) : 0,
        pressure: pressureOf(state.buffer.length, N)
      };
      (ctx.chainDecisionLog = ctx.chainDecisionLog || []).push(record);
    }
    return chosen;
  }

  function pathScore(p, phase) {
    var w = PHASE_W[phase], s = 0;
    if (p.won) s += 100000;                                    // 通关路径最高
    s -= p.peak * (phase === 'late' ? 22 : phase === 'mid' ? 10 : 5);
    s -= p.leafBuf * (phase === 'late' ? 14 : phase === 'mid' ? 7 : 4);
    s += p.release * CFG.wRelease + p.chain * CFG.wChainNow;
    s += p.board * w.board + p.target * w.tcolor + p.elim * w.elim;
    s += p.obstacle * ((CFG.wNumIce + CFG.wChainAct + CFG.wPipe) / 3);
    s += p.chainDwell || 0;   // 路径累计的锁链滞留奖励(§4.4/4.5)：窗口内越早整组释放/推进越多，路径评价越高(§4.9-⑩)
    return s;
  }

  return {
    chooseLookahead: chooseLookahead, pickBestMove: pickBestMove,
    greedyPick: greedyPick, treePick: treePick,
    cloneState: cloneState          // 【v138】导出供单测核对"深拷贝是否带全障碍状态"（数字冰漏拷最难查）
  };
})();
