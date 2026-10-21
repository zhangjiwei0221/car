// ==================== 锚点切盒（AntSolver.AnchorCut）· 主bin v137 移植版 ====================
// 【来源】逐字节移植自 数字冰沙盒/bin/js/anchor-cut.js（sha256 9741406f35636a1a88be3df12b2fd3cceca8ba1b69d69eff355c7ff93e00d448），
//   本文件除本段说明外与来源逐字节一致；算法本体一行未改。
// 【移植范围】只接"切盒"这一刀：generator.pickBoxSplit 在 config.boxCutMode==='anchor' 时改调
//   AntSolver.AnchorCut.cutBoxes(blocks, config)。**不动填盘、不动 BFS 吐球、不动障碍系统**
//   （沙盒那边的 fillMode:'anchorBfs' 还顺带换了 BfsFill 填盘并封锁老冰，主bin 一律不涉及）。
// 【默认行为】boxCutMode 默认 'trend'（= 原 baseFillBoxes 趋势切），不选它则本文件永不被调用，
//   现有生产口径与本次改动前完全一致（验证见 01_交接文档/工作日志_20261012.md 对应章节）。
// 【产出契约】与 baseFillBoxes 一致：[{color, count, elimSeq}]，elimSeq = 该盒的出场顺序下标。
// 【分组语义】双锚点(左下/右下)把目标图测地切成 A 片(左) / B 片(右)，elimSeq 上 **A 片整车先出、B 片后出**
//   （"进度错位"）——同一种颜色会前半场出现一次、后半场再出现一次，用于把玩家的暂存压力顶起来。
// 【接入参数】generator.DEFAULT_CONFIG 里的 boxCutMode / anchorMode / anchorBigBoxMax /
//   anchorBoxAvg / anchorMinBoxCap / anchorRoleAwareCut 由 pickBoxSplit 组装后传入本模块。

// ==================== 锚点扫描切盒（AntSolver.AnchorCut）====================
// 移植自原型 _kiro临时/09.16-数字冰沙盒/_原型-锚点扫描初始球队列.js（选项A + 模型A + 进度错位）。
// 数字冰分支(fillMode:'anchorBfs')用它替换 pickBoxSplit：
//   目标图(实心, bg=0) → 分隔色感知 band → 双锚点(左下/右下)测地分区 → 每(组,色)切盒
//   → 小色整块归一(选项A) → 大盒≤5 促成 → 进度错位合成 elimSeq(A组先, B组后)。
// 产出契约与 baseFillBoxes 一致：[{color, count, elimSeq}]。目标图无背景(合格库空格0=0)，全部当色。
(function () {
  'use strict';
  var AntSolver = (typeof window !== 'undefined' ? window : globalThis).AntSolver || {};
  (typeof window !== 'undefined' ? window : globalThis).AntSolver = AntSolver;
  var DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  function grid(rows, cols, v) { var g = []; for (var r = 0; r < rows; r++) { var row = []; for (var c = 0; c < cols; c++) row.push(v); g.push(row); } return g; }

  // 分隔色感知 band：从外部 0-1 BFS，同色前进 band 不变、跨色 band+1。bg=0 视为空(实心图无 0 格→全部当色)。
  function colorBands(b, rows, cols, bg) {
    var isPic = function (r, c) { return r >= 0 && r < rows && c >= 0 && c < cols && b[r][c] !== bg; };
    var band = grid(rows, cols, Infinity), dq = [], r, c;
    for (r = 0; r < rows; r++) for (c = 0; c < cols; c++) {
      if (!isPic(r, c)) continue;
      var t = (r === 0 || r === rows - 1 || c === 0 || c === cols - 1);
      if (!t) for (var d = 0; d < 4; d++) if (!isPic(r + DIRS[d][0], c + DIRS[d][1])) { t = true; break; }
      if (t) { band[r][c] = 0; dq.push([r, c]); }
    }
    var h = 0;
    while (h < dq.length) {
      var cur = dq[h++], cr = cur[0], cc = cur[1], bc = band[cr][cc], col = b[cr][cc];
      for (var dd = 0; dd < 4; dd++) {
        var nr = cr + DIRS[dd][0], nc = cc + DIRS[dd][1];
        if (!isPic(nr, nc)) continue;
        var w = (b[nr][nc] === col) ? 0 : 1;
        if (bc + w < band[nr][nc]) { band[nr][nc] = bc + w; if (w === 0) dq.splice(h, 0, [nr, nc]); else dq.push([nr, nc]); }
      }
    }
    return band;
  }

  // 测地多源 BFS：每像素归最近锚点(走图案像素)；组内球按 (band,dist) 有序。
  function anchorScan(b, rows, cols, bg, band, anchorPts) {
    var isPic = function (r, c) { return r >= 0 && r < rows && c >= 0 && c < cols && b[r][c] !== bg; };
    var seeds = anchorPts.map(function (a) {
      var best = null, bd = Infinity, r, c;
      for (r = 0; r < rows; r++) for (c = 0; c < cols; c++) if (isPic(r, c)) { var dd = Math.abs(r - a.r) + Math.abs(c - a.c); if (dd < bd) { bd = dd; best = { r: r, c: c }; } }
      return best;
    });
    var owner = grid(rows, cols, -1), dist = grid(rows, cols, Infinity), q = [];
    seeds.forEach(function (s, i) { if (s && dist[s.r][s.c] === Infinity) { dist[s.r][s.c] = 0; owner[s.r][s.c] = i; q.push([s.r, s.c]); } });
    var h = 0;
    while (h < q.length) {
      var cur = q[h++], r = cur[0], c = cur[1], o = owner[r][c], nd = dist[r][c] + 1;
      for (var d = 0; d < 4; d++) { var nr = r + DIRS[d][0], nc = c + DIRS[d][1]; if (!isPic(nr, nc) || dist[nr][nc] !== Infinity) continue; dist[nr][nc] = nd; owner[nr][nc] = o; q.push([nr, nc]); }
    }
    // 兜底：孤立块就近曼哈顿归属
    for (var rr = 0; rr < rows; rr++) for (var cc = 0; cc < cols; cc++) if (isPic(rr, cc) && owner[rr][cc] < 0) {
      var bi = 0, bdv = Infinity; anchorPts.forEach(function (a, i) { var dd = Math.abs(rr - a.r) + Math.abs(cc - a.c); if (dd < bdv) { bdv = dd; bi = i; } }); owner[rr][cc] = bi; dist[rr][cc] = 9999;
    }
    var groups = anchorPts.map(function () { return []; });
    for (var r2 = 0; r2 < rows; r2++) for (var c2 = 0; c2 < cols; c2++) if (isPic(r2, c2)) groups[owner[r2][c2]].push({ r: r2, c: c2, color: b[r2][c2], band: band[r2][c2], dist: dist[r2][c2] });
    groups.forEach(function (g) { g.sort(function (x, y) { return (x.band - y.band) || (x.dist - y.dist) || (y.r - x.r) || (x.c - y.c); }); });
    return { groups: groups };
  }

  // 选项A：某色在各组计数出现 (0,30) 碎片 → 整色并入其最大组，不跨组拆。
  function mergeSliverColors(groups) {
    var info = {}, G = groups.length;
    groups.forEach(function (g, gi) { g.forEach(function (x) { var it = info[x.color] || (info[x.color] = { cnt: [], balls: [] }); if (!it.cnt.length) { for (var i = 0; i < G; i++) { it.cnt.push(0); it.balls.push([]); } } it.cnt[gi]++; it.balls[gi].push(x); }); });
    var out = groups.map(function () { return []; });
    for (var col in info) {
      var it = info[col], sliver = it.cnt.some(function (c) { return c > 0 && c < 30; });
      if (sliver) { var mg = 0; for (var i = 1; i < G; i++) if (it.cnt[i] > it.cnt[mg]) mg = i; for (var j = 0; j < G; j++) out[mg].push.apply(out[mg], it.balls[j]); }
      else for (var k = 0; k < G; k++) out[k].push.apply(out[k], it.balls[k]);
    }
    out.forEach(function (g) { g.sort(function (x, y) { return (x.band - y.band) || (x.dist - y.dist) || (y.r - x.r) || (x.c - y.c); }); });
    return out;
  }

  function colorName(id) {
    return AntSolver.getColorName ? AntSolver.getColorName(id) : String(id);
  }
  function colorBrightness(id) {
    var hex = AntSolver.getColorCSS ? AntSolver.getColorCSS(id) : '';
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return 0.5;
    var n = parseInt(m[1], 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }
  function clamp(v, lo, hi) {
    if (v < lo) return lo;
    if (v > hi) return hi;
    return v;
  }

  // 目标图颜色角色识别：
  // - blocker：轮廓/阻隔色。典型特征是深色/灰黑、高跨色边界、跨多个 band，适合拆成小容量多盒并分散释放。
  // - mass：大块连色。典型特征是最大同色连通块占比高、同色邻接强，适合合并成少量大盒快速消除。
  function analyzeColorRoles(blocks, band, opts) {
    opts = opts || {};
    var rows = blocks.length, cols = blocks[0].length, bg = 0, stats = {}, r, c;
    function ensure(color) {
      var k = String(color);
      if (!stats[k]) stats[k] = {
        color: color, name: colorName(color), total: 0, minBand: Infinity, maxBand: -Infinity,
        sameEdges: 0, diffEdges: 0, emptyEdges: 0, components: 0, maxComp: 0
      };
      return stats[k];
    }
    for (r = 0; r < rows; r++) for (c = 0; c < cols; c++) {
      var color = blocks[r][c];
      if (color === bg) continue;
      var s = ensure(color);
      s.total++;
      var b = band && band[r] ? band[r][c] : 0;
      if (b < s.minBand) s.minBand = b;
      if (b > s.maxBand) s.maxBand = b;
      for (var d = 0; d < DIRS.length; d++) {
        var nr = r + DIRS[d][0], nc = c + DIRS[d][1];
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols || blocks[nr][nc] === bg) s.emptyEdges++;
        else if (blocks[nr][nc] === color) s.sameEdges++;
        else s.diffEdges++;
      }
    }
    var seen = grid(rows, cols, 0), q = [];
    for (r = 0; r < rows; r++) for (c = 0; c < cols; c++) {
      var col = blocks[r][c];
      if (col === bg || seen[r][c]) continue;
      var head = 0, cnt = 0; seen[r][c] = 1; q.length = 0; q.push([r, c]);
      while (head < q.length) {
        var cur = q[head++], cr = cur[0], cc = cur[1]; cnt++;
        for (var dd = 0; dd < DIRS.length; dd++) {
          var rr = cr + DIRS[dd][0], cc2 = cc + DIRS[dd][1];
          if (rr < 0 || rr >= rows || cc2 < 0 || cc2 >= cols || seen[rr][cc2] || blocks[rr][cc2] !== col) continue;
          seen[rr][cc2] = 1; q.push([rr, cc2]);
        }
      }
      var ss = ensure(col);
      ss.components++;
      if (cnt > ss.maxComp) ss.maxComp = cnt;
    }
    var maxTotal = 1;
    Object.keys(stats).forEach(function (k) { if (stats[k].total > maxTotal) maxTotal = stats[k].total; });
    var blockerMax = opts.blockerMaxColors != null ? opts.blockerMaxColors : 1;
    var massMax = opts.massMaxColors != null ? opts.massMaxColors : 3;
    var list = Object.keys(stats).map(function (k) {
      var s = stats[k], name = s.name || '', bright = colorBrightness(s.color);
      var darkName = /黑|深灰/.test(name) ? 1 : (/中灰|灰色|深棕|灰蓝/.test(name) ? 0.55 : 0);
      var darkScore = Math.max(darkName, bright < 0.14 ? 1 : (bright < 0.32 ? 0.65 : 0));
      var boundaryRatio = s.diffEdges / Math.max(1, s.diffEdges + s.sameEdges);
      var bandSpan = (s.maxBand > s.minBand && isFinite(s.minBand)) ? clamp((s.maxBand - s.minBand) / Math.max(1, s.maxBand), 0, 1) : 0;
      var compScore = clamp(s.components / 10, 0, 1);
      var maxCompRatio = s.total ? s.maxComp / s.total : 0;
      var blockerScore = 0.42 * boundaryRatio + 0.22 * bandSpan + 0.26 * darkScore + 0.10 * compScore;
      var massScore = 0.38 * (s.total / maxTotal) + 0.38 * maxCompRatio + 0.24 * (1 - boundaryRatio);
      s.brightness = +bright.toFixed(3);
      s.boundaryRatio = +boundaryRatio.toFixed(3);
      s.bandSpan = +bandSpan.toFixed(3);
      s.maxCompRatio = +maxCompRatio.toFixed(3);
      s.blockerScore = +blockerScore.toFixed(3);
      s.massScore = +massScore.toFixed(3);
      s.role = 'normal';
      return s;
    });
    var blockerCandidates = list.filter(function (s) {
      var darkEnough = s.color === 33 || /黑|深灰/.test(s.name || '') || s.brightness < 0.16;
      return s.total >= 20 && (
        (darkEnough && s.boundaryRatio >= 0.08) ||
        (s.boundaryRatio >= 0.38 && s.bandSpan >= 0.18 && s.maxCompRatio <= 0.98)
      );
    }).sort(function (a, b) { return b.blockerScore - a.blockerScore || b.total - a.total; });
    if (!blockerCandidates.length) {
      blockerCandidates = list.filter(function (s) { return s.total >= 20; })
        .sort(function (a, b) { return b.blockerScore - a.blockerScore || b.total - a.total; })
        .slice(0, 1);
    }
    for (var bi = 0; bi < Math.min(blockerMax, blockerCandidates.length); bi++) blockerCandidates[bi].role = 'blocker';
    var massCandidates = list.filter(function (s) {
      return s.role !== 'blocker' && s.total >= 45 && s.maxComp >= 30 && s.maxCompRatio >= 0.30;
    }).sort(function (a, b) { return b.massScore - a.massScore || b.total - a.total; });
    if (!massCandidates.length) {
      massCandidates = list.filter(function (s) { return s.role !== 'blocker' && s.total >= 45; })
        .sort(function (a, b) { return b.massScore - a.massScore || b.total - a.total; })
        .slice(0, 1);
    }
    for (var mi = 0; mi < Math.min(massMax, massCandidates.length); mi++) massCandidates[mi].role = 'mass';
    var roleByColor = {};
    list.forEach(function (s) { roleByColor[s.color] = s; });
    return { colors: list.sort(function (a, b) { return b.total - a.total; }), byColor: roleByColor };
  }

  // 模型A切盒：每(组,色)偶分成 [30,70]；再促成 ≤bigMax 个大盒(相邻合并到[71,100])。
  function cutBoxesA(groupsIn, opts) {
    var bigMax = opts.bigMax != null ? opts.bigMax : 5;
    // 目标平均容量（用户裁定 35-45，取 ~40）。每(组,色)按 N/avg 切，clamp 使单盒容量落在 [30, hi]。
    //   hi 由 avg 定：avg≤~45 时上界取 ~2×avg-30 附近（这里用 min(70, avg+15) 让盒不偏离均值太远，但≥50 兼容中盒）。
    var avg = opts.avg != null ? opts.avg : 40;
    // 单盒下限（用户「55px 图不够大→统一降低平均盒容量」需要放开原写死的 30）。默认 30 = 旧行为。
    var minBox = opts.minBox != null ? opts.minBox : 30;
    // 单盒上界：不再无条件≥50（那会顶死低 avg）。取 max(avg+15, minBox+10) 上限 70 →
    //   avg40/minBox30 得 55(与旧一致)；avg25/minBox20 得 40(允许小盒)。
    var hiCap = Math.min(70, Math.max(avg + 15, minBox + 10));
    var tierOf = function (n) { return n >= 71 ? '大' : (n >= 51 ? '中' : (n >= minBox ? '小' : '欠')); };
    var roles = opts.colorRoles && opts.colorRoles.byColor ? opts.colorRoles.byColor : {};
    function roleFor(color) { return roles[color] || null; }
    function splitParams(color) {
      var role = roleFor(color), roleName = role && role.role;
      if (roleName === 'blocker') {
        var heavyRatio = role && role.total >= 600 ? 0.68 : (role && role.total >= 450 ? 0.62 : 0.56);
        var bMin = opts.blockerMinBox != null ? opts.blockerMinBox : Math.max(18, Math.round(avg * 0.45));
        var bAvg = opts.blockerAvg != null ? opts.blockerAvg : Math.max(bMin + 2, Math.round(avg * heavyRatio));
        var bHi = opts.blockerHiCap != null ? opts.blockerHiCap : Math.max(bAvg + 4, Math.round(avg * 0.92));
        return { role: 'blocker', min: bMin, avg: bAvg, hi: bHi };
      }
      if (roleName === 'mass') {
        var mMin = opts.massMinBox != null ? opts.massMinBox : Math.max(minBox, Math.round(avg * 0.80));
        var mAvg = opts.massAvg != null ? opts.massAvg : Math.max(mMin + 4, Math.round(avg * 1.45));
        var mHi = opts.massHiCap != null ? opts.massHiCap : Math.max(mAvg + 8, Math.min(110, Math.round(avg * 1.85)));
        return { role: 'mass', min: mMin, avg: mAvg, hi: mHi };
      }
      return { role: 'normal', min: minBox, avg: avg, hi: hiCap };
    }
    var groups = mergeSliverColors(groupsIn), boxes = [];
    groups.forEach(function (g, gi) {
      var byColor = {}; g.forEach(function (x) { (byColor[x.color] || (byColor[x.color] = [])).push(x); });
      for (var colS in byColor) {
        var arr = byColor[colS], N = arr.length, color = +colS;
        var sp = splitParams(color);
        if (N < sp.min) { boxes.push({ group: gi, color: color, count: N, minBand: arr[0].band, tier: '欠', role: sp.role }); continue; }
        // k = 目标盒数(按 avg)，clamp 到 [ceil(N/hiCap), floor(N/minBox)] 保证单盒 ∈ [minBox, hiCap]。
        var k = Math.round(N / sp.avg); k = Math.max(Math.ceil(N / sp.hi), Math.min(k, Math.floor(N / sp.min))); if (k < 1) k = 1;
        var base = Math.floor(N / k), extra = N % k, idx = 0;
        for (var j = 0; j < k; j++) { var cnt = base + (j < extra ? 1 : 0); var slice = arr.slice(idx, idx + cnt); idx += cnt; boxes.push({ group: gi, color: color, count: cnt, minBand: slice[0].band, tier: tierOf(cnt), role: sp.role }); }
      }
    });
    // 大盒促成：阻隔色不参与；大块连色优先，避免把轮廓/黑色重新合并成大容量突破球。
    var made = 0, byGC = {};
    boxes.forEach(function (b, i) { var key = b.group + '|' + b.color; (byGC[key] || (byGC[key] = [])).push(i); });
    var keys = Object.keys(byGC).filter(function (key) {
      var first = boxes[byGC[key][0]];
      return first && first.role !== 'blocker';
    }).sort(function (a, z) {
      var ba = boxes[byGC[a][0]], bz = boxes[byGC[z][0]];
      var ra = ba && ba.role === 'mass' ? 1 : 0, rz = bz && bz.role === 'mass' ? 1 : 0;
      return (rz - ra) || (byGC[z].length - byGC[a].length);
    });
    for (var ki = 0; ki < keys.length && made < bigMax; ki++) {
      var idxs = byGC[keys[ki]];
      for (var t = 0; t + 1 < idxs.length && made < bigMax; t++) {
        var i1 = idxs[t], i2 = idxs[t + 1];
        if (!boxes[i1] || !boxes[i2]) continue;
        var s = boxes[i1].count + boxes[i2].count;
        if (s >= 71 && s <= 110) { boxes[i1] = { group: boxes[i1].group, color: boxes[i1].color, count: s, minBand: Math.min(boxes[i1].minBand, boxes[i2].minBand), tier: '大', role: boxes[i1].role }; boxes[i2] = null; made++; t++; }
      }
    }
    return { boxes: boxes.filter(Boolean), bigUsed: made, colorRoles: opts.colorRoles || null };
  }

  /**
   * 主入口。blocks=目标图(实心)，config 可选 { anchors:[{r,c}...] 或 anchorMode:'double'|'single', bigBoxMax }。
   * 返回 [{color, count, elimSeq}]（进度错位：A 组按 minBand 升序在前，B 组在后）。
   */
  function cutBoxes(blocks, config) {
    config = config || {};
    var rows = blocks.length, cols = blocks[0].length, bg = 0;
    var band = colorBands(blocks, rows, cols, bg);
    var anchors = config.anchors;
    if (!anchors) {
      if (config.anchorMode === 'single') anchors = [{ r: rows - 1, c: Math.floor(cols / 2) }];
      else anchors = [{ r: rows - 1, c: 0 }, { r: rows - 1, c: cols - 1 }]; // 默认双锚点 左下+右下
    }
    var scan = anchorScan(blocks, rows, cols, bg, band, anchors);
    var colorRoles = config.roleAwareCutEnabled === false ? null : analyzeColorRoles(blocks, band, {
      blockerMaxColors: config.blockerRoleMaxColors,
      massMaxColors: config.massRoleMaxColors
    });
    var cr = cutBoxesA(scan.groups, {
      bigMax: config.bigBoxMax != null ? config.bigBoxMax : 5,
      avg: config.boxAvg != null ? config.boxAvg : 40,   // 平均容量目标（用户 35-45，默认 40）
      minBox: config.boxMinCap != null ? config.boxMinCap : 30,   // 单盒下限（大棋盘小图时下调，默认 30）
      colorRoles: colorRoles,
      blockerMinBox: config.blockerBoxMin,
      blockerAvg: config.blockerBoxAvg,
      blockerHiCap: config.blockerBoxHi,
      massMinBox: config.massBoxMin,
      massAvg: config.massBoxAvg,
      massHiCap: config.massBoxHi
    });
    function orderGroupBoxes(g) {
      function baseSort(x, y) { return (x.minBand - y.minBand) || (y.count - x.count); }
      var blockers = [], others = [];
      g.forEach(function (b) { (b.role === 'blocker' ? blockers : others).push(b); });
      others.sort(baseSort);
      blockers.sort(baseSort);
      if (!blockers.length) return others;
      if (!others.length) return blockers;
      // 核心阻隔色拆小后必须跨阶段释放：把 blocker 均匀插入其它颜色序列，
      // 避免同一进度窗口连续出现大量黑/深灰小盒，既保留阻隔预算，又不制造同色刷屏。
      var L = g.length, slots = new Array(L), used = {};
      function nearestFree(pos) {
        pos = Math.max(0, Math.min(L - 1, pos));
        if (!used[pos]) return pos;
        for (var d = 1; d < L; d++) {
          if (pos - d >= 0 && !used[pos - d]) return pos - d;
          if (pos + d < L && !used[pos + d]) return pos + d;
        }
        return -1;
      }
      for (var i = 0; i < blockers.length; i++) {
        var want = Math.floor((i + 0.5) * L / blockers.length);
        var at = nearestFree(want);
        if (at >= 0) { slots[at] = blockers[i]; used[at] = 1; }
      }
      var oi = 0;
      for (var p = 0; p < L; p++) if (!slots[p]) slots[p] = others[oi++];
      return slots.filter(Boolean);
    }
    // 进度错位：按组序(A=0先, B=1后)，组内基础按 minBand 升序(外→内)，并将阻隔色均匀插入各阶段。
    var byGroup = anchors.map(function () { return []; });
    cr.boxes.forEach(function (b) { byGroup[b.group].push(b); });
    var ordered = [];
    byGroup.forEach(function (g) { ordered.push.apply(ordered, orderGroupBoxes(g)); });
    return ordered.map(function (b, i) { return { color: b.color, count: b.count, elimSeq: i, role: b.role, group: b.group, minBand: b.minBand }; });
  }

  AntSolver.AnchorCut = {
    colorBands: colorBands, anchorScan: anchorScan, mergeSliverColors: mergeSliverColors,
    analyzeColorRoles: analyzeColorRoles,
    cutBoxesA: cutBoxesA, cutBoxes: cutBoxes
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = AntSolver.AnchorCut;
})();
