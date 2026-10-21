/**
 * 蚂蚁拿块求解器 · 手动摆盒编辑器（v132 新增，2026-10-13）
 *
 * 【需求】用户原话：「当前求解器中的关卡是自动生成的，我想手动的摆放关卡」。
 *   现状：一关 = 小人板(目标图, 来自导入的 TXT) + 车场(棋盘上每格的车：颜色 + 载客量)。
 *   小人板能导入，但车场永远由生成器自动铺 —— 手工摆一关只能先写成 official 5 键 JSON
 *   (toprow/blocks/maprow/mapcol/spools) 再从「导入关卡包📁」读进来，而且进来之后不能改。
 *   本模块给求解器补上「车场可以手摆」这一环。
 *
 * 【职责边界】本文件只做编辑交互与渲染；关卡状态、面板刷新、进入模拟、文件下载都由
 *   app.js 通过 init(host) 注入的 host 回调提供 —— 因为 currentLevel / levelList 都在
 *   AntSolver.App 的闭包里，外部文件拿不到，硬塞全局反而更容易出错。
 *
 * 【操作口径】
 *   · 点空格 → 按当前颜色/载客量放一辆车（按住拖动 = 连续刷）
 *   · 点已有车 → 按当前颜色与载客量【改写】它（同一格按下再拖到别处 = 换位）
 *   · 右键 → 清空该格；橡皮工具同理
 *   · 空位是合法的：真实关卡的车场本来就不铺满（例如关卡1 的 4×7 里第 4 行只占第 3、4 列）
 *   · 校验按「每色车的载客量之和 == 小人板上该色像素数」实时算 —— 这就是生产口径那条守恒
 *     （测试关卡/关卡1.json：六色 12/12/6/9/15/15，合计 69）
 */
(function () {
  var A = (typeof AntSolver !== 'undefined') ? AntSolver : (window.AntSolver = window.AntSolver || {});

  var host = null;
  var editing = false;
  var working = null;      // { rows, cols, cells[][] }：null = 空位 / {t:'box'} / {t:'black'}
  var snapshot = null;     // 进入编辑时的车场原样，供「回到关卡原样」
  var snapshotBlocks = null; // 【v133】进入编辑时的目标图原样（目标区可微调后，这个也要能回退）
  var curColor = 1;
  var curCount = 3;
  // 【v138】'ice' → 'numice'：手动摆盘只出【数字冰】(type 7)，老冰(type 4)已弃用（用户 2026-10-14）。
  var tool = 'place';      // place | erase | black | numice | chain | question | pipe | pick
  var curDir = 13;         // 【v134】管道方向：11↑ 12→ 13↓ 14←（与官方 type 一致）
  var curChain = 1;        // 当前锁链组号（同号成一组）
  // 【v138】数字冰：数值 = 还剩几个球。与实机一致：每取走一个球减 1，锁链一步拿 2 个就减 2，减到 0 破碎。
  var curNumIce = 3;
  var restoredIce4 = 0;    // 【v138】本次进入编辑器时，有多少格老冰被转成了数字冰（提示用，转完清零）
  var selCell = null;      // 当前选中的格子 {r,c}：选中管道时展开队列编辑面板
  var drag = null;         // { mode:'paint'|'erase'|'black'|'move', from:{r,c}, moved:bool }

  function $(id) { return document.getElementById(id); }

  function mkBox() { return { t: 'box', color: curColor, count: curCount, ice: 0, chain: 0, q: false, numice: 0 }; }

  function emptyCells(rows, cols) {
    var cells = [];
    for (var r = 0; r < rows; r++) { var row = []; for (var c = 0; c < cols; c++) row.push(null); cells.push(row); }
    return cells;
  }

  function cloneCell(cell) {
    if (!cell) return null;
    if (cell.t === 'box') return { t: 'box', color: cell.color, count: cell.count, chain: cell.chain || 0, q: !!cell.q, numice: cell.numice || 0 };
    if (cell.t === 'black') return { t: 'black' };
    if (cell.t === 'pipe') return { t: 'pipe', dir: cell.dir, queue: (cell.queue || []).map(function (x) { return { color: x.color, count: x.count }; }), next: cell.next || 0 };
    return null;
  }

  function cloneBoard(b) {
    var rows = (b && b.rows) || 0, cols = (b && b.cols) || 0;
    var cells = [];
    for (var r = 0; r < rows; r++) {
      var row = [];
      for (var c = 0; c < cols; c++) row.push(cloneCell(b.cells[r] ? b.cells[r][c] : null));
      cells.push(row);
    }
    return { rows: rows, cols: cols, cells: cells };
  }

  function cloneBlocks(blocks) {
    if (!blocks) return null;
    var out = [];
    for (var r = 0; r < blocks.length; r++) out.push((blocks[r] || []).slice());
    return out;
  }

  function boardFromLevel() {
    var lv = host.getLevel();
    if (lv && lv.board && lv.board.rows > 0 && lv.board.cols > 0) return convertLegacyIce(cloneBoard(lv.board));
    // 目标图导入(TXT)后 currentLevel.board 是空的 → 给一块默认车场（行4×列7 = 手工关卡1 的车场形状）
    return { rows: 4, cols: 7, cells: emptyCells(4, 7) };
  }

  /**
   * 【v138 引入 / v139 收口】老冰(type4) → 数字冰(type7) 的兜底转换。
   *   v139 老冰已彻底下线：官方 JSON 的 type:4 在 utils.fromGameFormat 转数字冰、
   *   历史 关卡数据.json 的 cell.ice 在 utils.normCell 转数字冰，本函数只是进入编辑器前的最后一道兜底
   *   （正常路径下 cell.ice 已不存在，n 恒为 0）。
   */
  function convertLegacyIce(board) {
    var n = 0;
    if (!board) return board;
    for (var r = 0; r < board.rows; r++) {
      for (var c = 0; c < board.cols; c++) {
        var cell = board.cells[r][c];
        if (!cell || cell.t !== 'box' || !(cell.ice > 0)) continue;
        cell.numice = cell.numice > 0 ? cell.numice : (cell.ice || A.NUMICE_DEFAULT || 3);
        cell.ice = 0;
        n++;
      }
    }
    if (n > 0) restoredIce4 = n;   // 供 renderAll 提示「原老冰 N 格已转数字冰」
    return board;
  }

  // ==================== 渲染 ====================
  // 与 renderQueues 同一套宽度口径（都取 #target-container；该元素当前不存在 → 回落到 480），
  // 保证「摆盒棋盘」与「模拟棋盘」看起来是同一块板，来回切换不跳尺寸。
  function metrics() {
    var frameEl = $('target-container');
    var frameW = frameEl ? frameEl.clientWidth : 0;
    if (!frameW || frameW < 100) frameW = 480;
    var gap = 6, pad = 8;
    var csz = Math.floor((frameW - pad * 2 - gap * (working.cols - 1)) / Math.max(1, working.cols));
    var cszH = Math.floor((540 - pad * 2 - gap * (working.rows - 1)) / Math.max(1, working.rows));
    if (cszH < csz) csz = cszH;
    if (csz < 14) csz = 14;
    if (csz > 80) csz = 80;
    return { csz: csz, gap: gap, frameW: frameW };
  }

  function textColorFor(colorId) {
    var rgb = hexToRgb(A.getColorCSS(colorId));
    if (!rgb) return '#fff';
    var lum = 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b;
    return lum < 140 ? '#fff' : '#000';
  }
  function hexToRgb(s) {
    if (!s) return null; s = String(s).trim();
    var m = /^#?([0-9a-f]{6})$/i.exec(s);
    if (m) { var n = parseInt(m[1], 16); return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }; }
    var m3 = /^#?([0-9a-f]{3})$/i.exec(s);
    if (m3) { var h = m3[1]; return { r: parseInt(h[0] + h[0], 16), g: parseInt(h[1] + h[1], 16), b: parseInt(h[2] + h[2], 16) }; }
    return null;
  }

  function cellHtml(cell, r, c) {
    var base = 'board-cell edit-cell';
    var pos = ' data-r="' + r + '" data-c="' + c + '"';
    if (!cell) return '<div class="' + base + ' empty"' + pos + '></div>';
    if (cell.t === 'black') return '<div class="' + base + ' black"' + pos + ' title="黑块(阻挡)"><span class="blk-x">✕</span></div>';
    if (cell.t === 'pipe') {
      // 【v134】管道现在可编辑：箭头=方向，右下数字=队列还没吐出来的盒数；点它就在右栏展开队列编辑器。
      var arrow = PIPE_ARROWS[cell.dir] || '▼';
      var remain = (cell.queue || []).length - (cell.next || 0);
      return '<div class="' + base + ' pipe edit-pipe-cell' + (selCell && selCell.r === r && selCell.c === c ? ' edit-sel' : '') + '"' + pos +
        ' title="管道（' + (PIPE_DIR_CN[cell.dir] || '?') + '）队列 ' + remain + ' 辆未出 —— 点它可编辑队列">' +
        arrow + '<span class="pipe-n">' + remain + '</span></div>';
    }
    var same = (cell.color === curColor && cell.count === curCount);
    var cls = base + ' box' + (tool === 'place' && same ? ' edit-hit' : '');
    // 问号未揭示：与模拟棋盘同口径（深底 + ?），不显示真实颜色
    var style = cell.q
      ? 'background:#6b5a4a;color:#fff'
      : 'background:' + A.getColorCSS(cell.color) + ';color:' + textColorFor(cell.color);
    if (cell.chain > 0) style += ';outline:3px solid ' + chainColor(cell.chain) + ';outline-offset:-3px';
    var label = cell.q ? '?' : cell.count;
    var title = (cell.q ? '问号(隐藏色，实际是' + A.getColorName(cell.color) + ') ' : '') +
      A.getColorName(cell.color) + ' ×' + cell.count +
      (cell.numice > 0 ? '｜数字冰🧊还剩' + cell.numice + '个球' : '') +
      (cell.chain > 0 ? '｜锁链组' + chainTag(cell.chain) : '');
    var ov = '';
    if (cell.numice > 0) ov += '<span class="ov numice" title="数字冰：每取走一个球减 1（锁链一步 2 个就减 2），减到 0 破碎">🧊' + cell.numice + '</span>';
    if (cell.chain > 0) ov += '<span class="ov chain" style="color:' + chainColor(cell.chain) + '">🔗' + chainTag(cell.chain) + '</span>';
    return '<div class="' + cls + '" style="' + style + '"' + pos + ' title="' + title + '">' +
      '<span class="cnt">' + label + '</span>' +
      '<span class="edit-cid">' + cell.color + '</span>' + ov +
      '</div>';
  }

  // 管道方向（与官方 type 11~14 一致）与锁链组标识（同模拟棋盘：A/B/C…）
  var PIPE_ARROWS = { 11: '▲', 12: '▶', 13: '▼', 14: '◀' };
  var PIPE_DIR_CN = { 11: '向上', 12: '向右', 13: '向下', 14: '向左' };
  var CHAIN_COLORS = ['#ff3b30', '#34c759', '#ffcc00', '#5ac8fa', '#af52de', '#ff9500', '#00e5ff', '#ff2d95', '#a3e635', '#f472b6'];
  function chainTag(group) { return String.fromCharCode(65 + ((group - 1) % 26)); }
  function chainColor(group) { return CHAIN_COLORS[((group - 1) % CHAIN_COLORS.length + CHAIN_COLORS.length) % CHAIN_COLORS.length]; }

  function renderBoard() {
    var wrap = $('edit-board-queues');
    if (!wrap || !working) return;
    var m = metrics();
    var html = '<div class="ant-board edit-board" style="width:' + m.frameW + 'px;--csz:' + m.csz + 'px;--cgap:' + m.gap + 'px;grid-template-columns:repeat(' + working.cols + ',var(--csz))">';
    for (var r = 0; r < working.rows; r++) {
      for (var c = 0; c < working.cols; c++) html += cellHtml(working.cells[r][c], r, c);
    }
    html += '</div>';
    wrap.innerHTML = html;
  }

  function updateCellDom(r, c) {
    var wrap = $('edit-board-queues');
    if (!wrap) return;
    var el = wrap.querySelector('.edit-cell[data-r="' + r + '"][data-c="' + c + '"]');
    if (!el) return;
    el.outerHTML = cellHtml(working.cells[r][c], r, c);
  }

  function paletteColors() {
    var seen = {};
    var lv = host.getLevel();
    if (lv && lv.colorCounts) {
      Object.keys(lv.colorCounts).forEach(function (k) { var id = parseInt(k, 10); if (id > 0) seen[id] = 1; });
    }
    if (working) {
      for (var r = 0; r < working.rows; r++) {
        for (var c = 0; c < working.cols; c++) {
          var cell = working.cells[r][c];
          if (cell && cell.t === 'box' && cell.color > 0) seen[cell.color] = 1;
        }
      }
    }
    var out = Object.keys(seen).map(function (k) { return parseInt(k, 10); })
      .sort(function (a, b) { return a - b; });
    if (!out.length) { for (var i = 1; i <= 12; i++) out.push(i); }   // 没有目标图时给一排默认色
    return out;
  }

  function renderPalette() {
    var el = $('edit-palette');
    if (!el) return;
    var colors = paletteColors();
    var html = '';
    for (var i = 0; i < colors.length; i++) {
      var id = colors[i];
      html += '<button class="edit-swatch' + (id === curColor ? ' active' : '') + '" data-color="' + id + '"' +
        ' style="background:' + A.getColorCSS(id) + '"' +
        ' title="' + A.getColorName(id) + '（编号 ' + id + '）">' + id + '</button>';
    }
    el.innerHTML = html;
  }

  function stats() {
    var lv = host.getLevel() || {};
    var need = {}, total = 0;
    if (lv.colorCounts) for (var k in lv.colorCounts) { need[k] = lv.colorCounts[k]; total += lv.colorCounts[k]; }
    var have = {}, haveBoard = {}, havePipe = {};
    var cars = 0, cap = 0, empty = 0, black = 0, pipes = 0, pipeBoxes = 0, pipeCap = 0;
    var qm = 0, chainGroups = {}, pipeExitBlocked = 0;
    // 【v138】数字冰统计：格数 + 最大数值（用于"永不破碎死墙"检查：数值 ≥ 全场球数就永远解不开）
    var numice = 0, numiceMax = 0;
    for (var r = 0; r < working.rows; r++) {
      for (var c = 0; c < working.cols; c++) {
        var cell = working.cells[r][c];
        if (!cell) { empty++; continue; }
        if (cell.t === 'black') { black++; continue; }
        // 【2026-10-13 修正】管道格自己不带人，但**管道队列里装的盒是真盒子、真要装人**。
        //   生产侧的守恒口径就是这么算的（generator.js · verifyConservation：「棋盘盒数 + 管道内盒数」，
        //   且每色 count 总和 == 目标图该色像素数）。只数棋盘上的盒会漏掉整条管道的载客量，
        //   于是一个完全正确的成品关（例如 55×55 那关：管道里另有 1023 人）会被误判成「还差 1023」。
        if (cell.t === 'pipe') {
          pipes++;
          // 出口检查：出口被占着就不吐盒；出口在盘外 / 被黑块永久占住 = 队列永远出不来
          var pv = A.PIPE_DIRS[cell.dir] || [1, 0];
          var pr2 = r + pv[0], pc2 = c + pv[1];
          if (pr2 < 0 || pr2 >= working.rows || pc2 < 0 || pc2 >= working.cols || working.cells[pr2][pc2]) pipeExitBlocked++;
          var q = cell.queue || [];
          for (var qi = 0; qi < q.length; qi++) {
            var qb = q[qi];
            if (!qb || !(qb.color > 0) || !(qb.count > 0)) continue;
            pipeBoxes++;
            pipeCap += qb.count;
            havePipe[qb.color] = (havePipe[qb.color] || 0) + qb.count;
            have[qb.color] = (have[qb.color] || 0) + qb.count;
          }
          continue;
        }
        if (cell.t === 'box') {
          cars++; cap += (cell.count || 0);
          if (cell.numice > 0) { numice++; if (cell.numice > numiceMax) numiceMax = cell.numice; }
          if (cell.q) qm++;
          if (cell.chain > 0) chainGroups[cell.chain] = (chainGroups[cell.chain] || 0) + 1;
          haveBoard[cell.color] = (haveBoard[cell.color] || 0) + (cell.count || 0);
          have[cell.color] = (have[cell.color] || 0) + (cell.count || 0);
        }
      }
    }
    var chainGroupCount = 0, loneChains = 0;
    Object.keys(chainGroups).forEach(function (g) { chainGroupCount++; if (chainGroups[g] < 2) loneChains++; });
    return { need: need, have: have, haveBoard: haveBoard, havePipe: havePipe, total: total,
             cap: cap, cars: cars, empty: empty, black: black, pipes: pipes,
             pipeBoxes: pipeBoxes, pipeCap: pipeCap,
             numice: numice, numiceMax: numiceMax,
             qm: qm, chainGroupCount: chainGroupCount, loneChains: loneChains,
             chainGroups: chainGroups, pipeExitBlocked: pipeExitBlocked };
  }

  function renderValidate() {
    var el = $('edit-validate');
    if (!el || !working) return;
    var s = stats();
    var ids = {};
    Object.keys(s.need).forEach(function (k) { ids[k] = 1; });
    Object.keys(s.have).forEach(function (k) { ids[k] = 1; });
    var list = Object.keys(ids).map(function (k) { return parseInt(k, 10); }).sort(function (a, b) { return a - b; });

    var html = '<div class="edit-vhead">每色人数核对 <span>(车上载客' + (s.pipeBoxes ? '，含管道内' : '') + ' / 板上像素)</span></div>';
    if (restoredIce4 > 0) {
      html += '<div class="edit-vrow nobad" style="display:block">🧊 本次载入：原冰块（老冰 type4）<b>' + restoredIce4
        + '</b> 格已自动转成数字冰（数值取原耐久），导出时不会再出现老冰</div>';
    }
    if (!list.length) html += '<div class="edit-vrow nobad">还没有目标图，先导入 TXT</div>';
    var badTotal = 0;
    for (var i = 0; i < list.length; i++) {
      var id = list[i];
      var nd = s.need[id] || 0, hv = s.have[id] || 0;
      var diff = nd - hv;
      var ok = diff === 0;
      if (!ok) badTotal += Math.abs(diff);
      var tag = ok ? '✓' : (diff > 0 ? ('还差 ' + diff) : ('多 ' + (-diff)));
      if (!nd && hv > 0) tag = '板上没这色';
      var bb = s.haveBoard[id] || 0, pb = s.havePipe[id] || 0;
      html += '<div class="edit-vrow' + (ok ? '' : ' bad') + (nd === 0 && hv > 0 ? ' warn' : '') + '" data-color="' + id + '"' +
        ' title="' + A.getColorName(id) + '：棋盘上的车 ' + bb + ' 人' + (pb ? (' + 管道里 ' + pb + ' 人') : '') +
        ' = ' + hv + '；板上该色像素 ' + nd + '。点这一行 = 换成这个颜色，并把载客量填成' +
        (diff > 0 ? ('还差的 ' + diff) : '默认值') + '">' +
        '<span class="edit-vsw" style="background:' + A.getColorCSS(id) + '"></span>' +
        '<span class="edit-vname">' + A.getColorName(id) + '</span>' +
        '<span class="edit-vnum">' + hv + ' / ' + nd + '</span>' +
        '<span class="edit-vtag">' + tag + '</span></div>';
    }
    html += '<div class="edit-vfoot">' +
      '车 ' + s.cars + ' 辆 · 载客合计 ' + (s.cap + s.pipeCap) + ' / 板上 ' + s.total + ' 人 · 空位 ' + s.empty +
      (s.black ? (' · 黑块 ' + s.black) : '') +
      (s.pipes ? (' · 管道 ' + s.pipes + ' 条（内含 ' + s.pipeBoxes + ' 盒 / ' + s.pipeCap + ' 人）') : '') +
      (s.numice ? (' · 数字冰 ' + s.numice) : '') +
      (s.chainGroupCount ? (' · 锁链 ' + s.chainGroupCount + ' 组') : '') +
      (s.qm ? (' · 问号 ' + s.qm) : '') + '<br>' +
      (badTotal === 0 && s.cars > 0
        ? '<b class="ok">✓ 配平：每色载客量（含管道内）都等于板上该色人数</b>'
        : ((s.cars + s.pipeBoxes) === 0 ? '<b class="warn2">还没放车：右栏选颜色后点棋盘空格</b>'
          : '<b class="warn2">✗ 还有 ' + badTotal + ' 人不匹配（<span class="edit-vlink">点上面某一行</span>可自动切换到该色并填好还差的数量）</b>')) +
      // 【v134】障碍类提示：这三条都是"摆得出来但玩不成/不合规"的坑
      (s.pipeExitBlocked ? ('<br><b class="warn2">⚠ 有 ' + s.pipeExitBlocked + ' 条管道的出口被占住（出口格有车/黑块，或指向盘外）：这些管道吐不出盒</b>') : '') +
      (s.loneChains ? ('<br><b class="warn2">⚠ 有 ' + s.loneChains + ' 个锁链组只有 1 个成员：规则上会被当成普通车（至少要 2 个才成链）</b>') : '') +
      // 【v138】数字冰两条硬警告：数太大=死墙；与老冰并存（转换后不该出现，出现就是漏改）
      ((s.numice && s.numiceMax >= (s.cars + s.pipeBoxes))
        ? ('<br><b class="warn2">⚠ 数字冰数值 ' + s.numiceMax + ' ≥ 全场球数 ' + (s.cars + s.pipeBoxes) + '：永远减不到 0，等于一堵解不开的死墙</b>') : '') +
      '</div>';
    el.innerHTML = html;
  }

  function syncControls() {
    var ri = $('edit-rows'), ci = $('edit-cols'), ki = $('edit-count');
    if (ri && working) ri.value = working.rows;
    if (ci && working) ci.value = working.cols;
    if (ki) ki.value = curCount;
  }

  function status(text) {
    var el = $('edit-board-hint');
    if (el) el.textContent = text;
  }

  function renderAll(commit) {
    renderBoard();
    renderPipePanel();
    renderValidate();
    syncControls();
    status('车场 ' + working.rows + '×' + working.cols + ' · 空格=空位 · 点空格放车 / 点车改写 / 拖动换位 / 右键清空');
    if (commit) host.setBoard(working);
  }

  // ==================== 编辑交互 ====================
  function cellAt(target) {
    var el = target && target.closest ? target.closest('.edit-cell') : null;
    if (!el) return null;
    var r = parseInt(el.getAttribute('data-r'), 10), c = parseInt(el.getAttribute('data-c'), 10);
    if (isNaN(r) || isNaN(c)) return null;
    // 【v134】越界防御：棋盘外的坐标一律忽略。没有这道闸门时，一个越界的格子会被
    //   直接写进 cells（那一行长度超过 cols），统计与导出都看不见它 —— 静默脏数据。
    if (!working || r < 0 || c < 0 || r >= working.rows || c >= working.cols) return null;
    return { r: r, c: c };
  }

  // 【v134】把「数字冰/锁链/问号」做成【可点击切换】的标记工具，管道做成「放/改方向 + 队列编辑」。
  //   这三个标记只作用在【车】上（空格先放车再加），这样口径简单：标记是车的属性。
  function applyTool(r, c) {
    var cell = working.cells[r][c];
    if (tool === 'erase') { working.cells[r][c] = null; return null; }
    if (tool === 'black') { working.cells[r][c] = { t: 'black' }; return null; }
    // 【v138】数字冰（取代老冰）：点车加/去；数值可调 —— 输入框改个数再点同一格＝改数值，
    //   数值没变再点一次＝去掉。加数字冰时顺带清掉该格老冰（两者互斥，实机也是）。
    if (tool === 'numice') {
      if (!cell || cell.t !== 'box') return '数字冰只能加在车上：先用「放车」放一辆，再点数字冰';
      if (cell.numice > 0) {
        if (cell.numice === curNumIce) { cell.numice = 0; return '已去掉数字冰'; }
        cell.numice = curNumIce;
        return '数字冰还剩球数已改为 ' + curNumIce;
      }
      cell.numice = curNumIce;
      return '已加数字冰：还剩 ' + curNumIce + ' 个球（每取走 1 个球减 1，减到 0 破碎）';
    }
    if (tool === 'chain') {
      if (!cell || cell.t !== 'box') return '锁链只能加在车上：先用「放车」放一辆，再点锁链';
      cell.chain = (cell.chain === curChain) ? 0 : curChain;
      return cell.chain ? ('已加入锁链组 ' + chainTag(cell.chain) + '（同组的车会被一起取走）') : '已移出锁链组';
    }
    if (tool === 'question') {
      if (!cell || cell.t !== 'box') return '问号只能加在车上：先用「放车」放一辆，再点问号';
      cell.q = !cell.q;
      return cell.q ? '已设为问号：玩法上先隐藏颜色，取到时才揭示' : '已取消问号';
    }
    if (tool === 'pipe') {
      if (cell && cell.t === 'pipe') { cell.dir = curDir; selCell = { r: r, c: c }; return '管道方向 → ' + PIPE_DIR_CN[curDir]; }
      working.cells[r][c] = { t: 'pipe', dir: curDir, queue: [], next: 0 };
      selCell = { r: r, c: c };
      return '已放管道（' + PIPE_DIR_CN[curDir] + '）：在右栏「管道队列」里加车，队首先出。管道本身永久占格';
    }
    working.cells[r][c] = mkBox();
    return null;
  }

  function onDown(e) {
    if (!editing) return;
    if (e.button !== 0) return;
    var pos = cellAt(e.target);
    if (!pos) return;
    e.preventDefault();
    var r = pos.r, c = pos.c;
    var cell = working.cells[r][c];

    if (tool === 'pick') {
      if (cell && cell.t === 'box') {
        curColor = cell.color; curCount = cell.count;
        // 【v138】吸管也把数字冰数值读进输入框（要"改数值"时先吸一格再改，比手输省事）
        if (cell.numice > 0) { curNumIce = cell.numice; var ni = $('edit-numice-val'); if (ni) ni.value = curNumIce; }
        renderPalette(); syncControls(); renderBoard();
      }
      else if (cell && cell.t === 'pipe') { selCell = { r: r, c: c }; renderBoard(); }
      renderPipePanel();
      return;
    }
    if (tool === 'erase' || tool === 'black') {
      drag = { mode: tool, from: { r: r, c: c }, moved: false };
      applyTool(r, c);
      updateCellDom(r, c);
      renderPipePanel();
      renderValidate();
      return;
    }
    // 标记类工具（数字冰/锁链/问号）与管道：单击生效，不做拖动刷
    if (tool === 'numice' || tool === 'chain' || tool === 'question' || tool === 'pipe') {
      drag = null;
      var hint = applyTool(r, c);
      if (hint) status(hint);
      renderBoard();          // 标记会改变格子外观（角标/描边），整块重绘最省心（棋盘不大）
      renderPipePanel();
      renderValidate();
      host.setBoard(working);
      return;
    }
    // 放车工具
    // 管道格不许被"放车"覆盖（里面有队列，误覆盖会静默丢数据）→ 改成选中它、展开队列编辑器
    if (cell && cell.t === 'pipe') { selCell = { r: r, c: c }; renderBoard(); renderPipePanel(); return; }
    if (cell && cell.t === 'box') {
      drag = { mode: 'move', from: { r: r, c: c }, moved: false };   // 按下已有车 → 可能是"改写"，也可能是"拖走"
      return;
    }
    drag = { mode: 'paint', from: { r: r, c: c }, moved: false };
    applyTool(r, c);
    updateCellDom(r, c);
    renderValidate();
  }

  function onOver(e) {
    if (!editing || !drag) return;
    var pos = cellAt(e.target);
    if (!pos) return;
    var r = pos.r, c = pos.c;
    if (r === drag.from.r && c === drag.from.c && !drag.moved) return;
    if (drag.mode === 'move') { drag.hover = { r: r, c: c }; return; }
    drag.moved = true;
    var cur = working.cells[r][c];
    if (drag.mode === 'paint' && cur && cur.t === 'box') return;   // 刷过已有车不误删
    if (cur && cur.t === 'pipe') return;                           // 【v134】拖动刷不许碰管道：里面有队列，蹭过去就丢数据
    applyTool(r, c);
    updateCellDom(r, c);
    renderValidate();
  }

  function onUp(e) {
    if (!editing || !drag) return;
    var d = drag; drag = null;
    if (d.mode === 'move') {
      var pos = cellAt(e.target);
      if (!pos) { renderBoard(); return; }
      if (pos.r === d.from.r && pos.c === d.from.c) {
        // 原地点击 = 按当前颜色/载客量改写这辆车
        working.cells[pos.r][pos.c] = mkBox();
      } else {
        var moving = working.cells[d.from.r][d.from.c];
        var dest = working.cells[pos.r][pos.c];
        var back = (dest && dest.t === 'box') ? dest : null;   // 目标格有车 → 互换；黑块/空位 → 直接盖过去
        working.cells[pos.r][pos.c] = moving;
        working.cells[d.from.r][d.from.c] = back;
      }
      renderAll(true);
      return;
    }
    if (d.moved) renderAll(true); else { renderValidate(); host.setBoard(working); }
  }

  function onContext(e) {
    if (!editing) return;
    var pos = cellAt(e.target);
    if (!pos) return;
    e.preventDefault();
    working.cells[pos.r][pos.c] = null;
    updateCellDom(pos.r, pos.c);
    renderValidate();
    host.setBoard(working);
  }

  function onPaletteClick(e) {
    var btn = e.target && e.target.closest ? e.target.closest('.edit-swatch') : null;
    if (!btn) return;
    curColor = parseInt(btn.getAttribute('data-color'), 10) || 1;
    tool = ($('edit-tool') || {}).value || tool;
    var sel = $('edit-tool'); if (sel && sel.value !== 'place') { sel.value = 'place'; tool = 'place'; }
    renderPalette();
    renderBoard();
    renderValidate();
  }

  function onValidateClick(e) {
    var row = e.target && e.target.closest ? e.target.closest('.edit-vrow[data-color]') : null;
    if (!row) return;
    var id = parseInt(row.getAttribute('data-color'), 10);
    if (!id) return;
    curColor = id;
    var s = stats();
    var diff = (s.need[id] || 0) - (s.have[id] || 0);
    if (diff > 0) curCount = diff;
    tool = 'place';
    var sel = $('edit-tool'); if (sel) sel.value = 'place';
    renderPalette();
    renderBoard();
    renderValidate();
  }

  // ==================== 工具条动作 ====================
  // ---------- 【v134】管道队列编辑器 ----------
  // 管道在官方格式里是 {id:0, type:11~14, param:[{id,count},…]}：type = 方向，param = 队列（队首先出）。
  // 这里就让"队列"可点可改：改颜色 / 改载客 / 上移下移（= 调出场顺序）/ 增删。
  function pipeAt() {
    if (!selCell || !working) return null;
    var row = working.cells[selCell.r];
    var cell = row ? row[selCell.c] : null;
    return (cell && cell.t === 'pipe') ? cell : null;
  }

  function renderPipePanel() {
    var panel = $('edit-pipe-panel');
    if (!panel) return;
    var cell = pipeAt();
    if (!cell) { panel.classList.add('hidden'); return; }
    panel.classList.remove('hidden');
    var q = cell.queue || [];
    var info = $('edit-pipe-info');
    if (info) {
      info.textContent = '第 ' + (selCell.r + 1) + ' 行 第 ' + (selCell.c + 1) + ' 列 · ' + (PIPE_DIR_CN[cell.dir] || '?') +
        ' · 队列 ' + q.length + ' 辆';
    }
    var html = '';
    if (!q.length) html = '<div class="edit-pq-empty">队列空的：点下面「＋ 加一辆」。空队列的管道只当障碍用。</div>';
    for (var i = 0; i < q.length; i++) {
      var b = q[i];
      var isNext = (i === (cell.next || 0));
      html += '<div class="edit-pq-row' + (isNext ? ' is-next' : '') + '" data-i="' + i + '">' +
        '<span class="edit-pq-no" title="出场顺序">' + (i + 1) + '</span>' +
        '<button class="edit-pq-sw" data-act="color" style="background:' + A.getColorCSS(b.color) + '"' +
          ' title="点一下 = 把右栏当前选中的颜色（' + A.getColorName(curColor) + '）换成这辆"></button>' +
        '<span class="edit-pq-name">' + A.getColorName(b.color) + '</span>' +
        '<input type="number" class="edit-pq-cnt" data-act="count" value="' + b.count + '" min="1" max="999" title="这辆装几个人">' +
        '<button data-act="up" title="上移（更早出场）"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
        '<button data-act="down" title="下移（更晚出场）"' + (i === q.length - 1 ? ' disabled' : '') + '>↓</button>' +
        '<button data-act="del" title="删掉这辆">✕</button>' +
        (isNext ? '<span class="edit-pq-tag">下一个出</span>' : '') +
        '</div>';
    }
    var qe = $('edit-pipe-queue');
    if (qe) qe.innerHTML = html;
    var w = $('edit-pipe-warn');
    if (w) {
      var dv = A.PIPE_DIRS[cell.dir] || [1, 0];
      var er = selCell.r + dv[0], ec = selCell.c + dv[1];
      var msgs = [];
      if (er < 0 || er >= working.rows || ec < 0 || ec >= working.cols) {
        msgs.push('出口在棋盘外 —— 队列永远出不来');
      } else {
        var ecell = working.cells[er][ec];
        if (ecell) msgs.push('出口格（第 ' + (er + 1) + ' 行 第 ' + (ec + 1) + ' 列）现在被' +
          (ecell.t === 'black' ? '黑块' : (ecell.t === 'pipe' ? '另一个管道' : '一辆车')) +
          '占着：被占着就不吐盒，永久占住 = 永远出不来');
      }
      if (!q.length) msgs.push('队列为空 = 这个管道只当障碍用（真机上线包里也有这种）');
      w.innerHTML = msgs.map(function (m) { return '<div>· ' + m + '</div>'; }).join('');
    }
  }

  function pipeMove(i, d) {
    var cell = pipeAt(); if (!cell) return;
    var q = cell.queue, j = i + d;
    if (j < 0 || j >= q.length) return;
    var t = q[i]; q[i] = q[j]; q[j] = t;
    afterPipeEdit();
  }
  function afterPipeEdit() { renderPipePanel(); renderValidate(); host.setBoard(working); status('管道队列已改：共 ' + (pipeAt() ? pipeAt().queue.length : 0) + ' 辆'); }

  function onPipeQueueClick(e) {
    var row = e.target && e.target.closest ? e.target.closest('.edit-pq-row') : null;
    if (!row) return;
    var cell = pipeAt(); if (!cell) return;
    var i = parseInt(row.getAttribute ? row.getAttribute('data-i') : null, 10);
    if (isNaN(i)) return;
    var btn = e.target.closest ? e.target.closest('[data-act]') : null;
    var act = btn ? btn.getAttribute('data-act') : null;
    if (act === 'count') return;                       // 数字框交给 input 事件
    if (act === 'up') pipeMove(i, -1);
    else if (act === 'down') pipeMove(i, 1);
    else if (act === 'del') { cell.queue.splice(i, 1); if ((cell.next || 0) > cell.queue.length) cell.next = cell.queue.length; afterPipeEdit(); }
    else if (act === 'color') { cell.queue[i].color = curColor; afterPipeEdit(); }
  }

  function onPipeQueueInput(e) {
    if (!e || !e.target || !e.target.getAttribute) return;
    if (e.target.getAttribute('data-act') !== 'count') return;
    var row = e.target.closest ? e.target.closest('.edit-pq-row') : null;
    var cell = pipeAt(); if (!row || !cell) return;
    var i = parseInt(row.getAttribute('data-i'), 10);
    if (isNaN(i)) return;
    var v = parseInt(e.target.value, 10);
    if (isNaN(v) || v < 1) v = 1;
    if (v > 999) v = 999;
    cell.queue[i].count = v;
    renderValidate(); host.setBoard(working);
  }

  // 【v133】目标区画笔相关的对外接口与提示（真正的上色在 app.js 里做，因为目标图画布归它管）
  function currentColor() { return curColor; }
  function setColor(id) {
    if (!(id > 0)) return;
    curColor = id;
    renderPalette(); renderBoard(); renderValidate(); onPaintChanged();
  }
  function toolMode() { return tool; }

  function paintToolHint() {
    if (tool === 'erase') return '擦成空位（0）';
    if (tool === 'pick') return '吸管：点一下就取该像素的颜色当画笔';
    if (tool === 'black') return '目标图没有黑块 → 按「擦掉」处理';
    return '用 ' + A.getColorName(curColor) + '（编号 ' + curColor + '）上色';
  }

  function onPaintChanged() {
    var on = !!(host && host.paint && host.paint.isOn && host.paint.isOn());
    var btn = $('edit-paint-target');
    if (btn) {
      btn.textContent = on ? '✏️ 改目标图：开' : '✏️ 改目标图：关';
      if (on) btn.classList.add('active'); else btn.classList.remove('active');
    }
    var undoBtn = $('edit-paint-undo');
    if (undoBtn) undoBtn.disabled = !(host && host.paint && host.paint.canUndo && host.paint.canUndo());
    var tip = $('edit-paint-tip');
    if (tip) {
      tip.innerHTML = on
        ? '<b>目标区画笔已开</b>：在目标图上<b>点或拖</b> = 改像素。当前工具 → ' + paintToolHint() +
          '。<br>撤回：右边的「↩ 撤回」按钮或 Ctrl/⌘+Z。格子太小就先用「🔍＋」放大再改（此时拖拽平移不可用，关掉画笔即可平移）。'
        : '目标区微调：点右边按钮开启画笔，之后在目标图上点/拖就能改像素（配合「工具」下拉：' +
          '橡皮 = 擦成空位、吸管 = 取该像素颜色）。<br>改完记得看下面「每色人数核对」——目标图变了，车场就要跟着补或减。';
    }
  }

  /** 目标区被改过（app.js 里改完会回来喊一声）：调色板要按新颜色重生成，核对要重算。 */
  function onLevelChanged() {
    if (!editing) return;
    renderPalette();
    renderValidate();
  }

  function resizeBoard() {
    var rows = parseInt(($('edit-rows') || {}).value, 10);
    var cols = parseInt(($('edit-cols') || {}).value, 10);
    if (isNaN(rows) || rows < 1) rows = 1;
    if (isNaN(cols) || cols < 1) cols = 1;
    if (rows > 40) rows = 40;
    if (cols > 40) cols = 40;
    var next = { rows: rows, cols: cols, cells: emptyCells(rows, cols) };
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        if (r < working.rows && c < working.cols) next.cells[r][c] = working.cells[r][c];   // 原地改尺寸时保留左上角已有内容
      }
    }
    working = next;
    renderAll(true);
  }

  function resetOrigin() {
    if (!snapshot) return;
    working = cloneBoard(snapshot);
    // 【v133】目标区也一起回到原样：否则「回到关卡原样」只回退了车场，
    //   目标图还留着改过的像素，用户会以为没生效。
    if (snapshotBlocks && host.setBlocks) host.setBlocks(cloneBlocks(snapshotBlocks));
    renderAll(true);
  }

  function trySolve() {
    var el = $('edit-validate');
    var lv = host.getLevel();
    if (!lv || !lv.blocks) return;
    host.setBoard(working);
    var parsed = A.parseLevel({ blocks: lv.blocks, bufferLimit: lv.bufferLimit || 5, board: A.normBoard(working) });
    var t0 = Date.now();
    var res = null;
    try { res = A.Solver.solve(parsed); } catch (err) { host.explain('<p class="fail">求解异常: ' + err.message + '</p>'); return; }
    var ms = Date.now() - t0;
    var s = stats();
    var html = '<p class="' + (res.completed ? 'pass' : 'fail') + '">' + (res.completed ? '✅ 试解：能全清（可解）' : '⚠️ 试解：解不掉（先看下面的配平）') + '</p>';
    html += '<p>取盒步数: ' + res.steps + ' · 用时 ' + ms + 'ms</p>';
    html += '<p style="font-size:11px;color:#8a7358">每色配平: ' + (function () {
      var parts = [], ids = {};
      Object.keys(s.need).forEach(function (k) { ids[k] = 1; });
      Object.keys(s.have).forEach(function (k) { ids[k] = 1; });
      Object.keys(ids).map(Number).sort(function (a, b) { return a - b; }).forEach(function (id) {
        parts.push(A.getColorName(id) + ' ' + (s.have[id] || 0) + '/' + (s.need[id] || 0));
      });
      return parts.join(' · ');
    })() + '</p>';
    if (!res.completed) html += '<p style="font-size:11px;color:#e6a23c">配平对但解不掉，通常是车场取不出去（同一列被堵死/暂存放不下）。把车分散到不同列、别把同色堆成一条竖列再试。</p>';
    host.explain(html);
    if (el) el.scrollTop = el.scrollHeight;
  }

  function exportJson() {
    var lv = host.getLevel();
    host.setBoard(working);
    var parsed = A.parseLevel({ blocks: lv.blocks, bufferLimit: lv.bufferLimit || 5, board: A.normBoard(working) });
    var json = A.toGameFormat(parsed);
    host.download(host.getName().replace(/\.[^.]+$/, '') + '.json', JSON.stringify(json, null, 2));
    status('已导出关卡JSON：' + host.getName().replace(/\.[^.]+$/, '') + '.json（官方 5 键 toprow/blocks/maprow/mapcol/spools）');
  }

  function exportTxt() {
    var lv = host.getLevel();
    var blocks = lv.blocks || [];
    var lines = [];
    for (var r = 0; r < blocks.length; r++) lines.push(blocks[r].join(' '));
    host.download(host.getName().replace(/\.[^.]+$/, '') + '.txt', lines.join('\n') + '\n');
    status('已导出TXT：' + blocks.length + ' 行（空格分隔数字，0 = 空）');
  }

  function applyToSim() {
    host.setBoard(working);
    host.play();
  }

  // ==================== 生命周期 ====================
  function enter() {
    if (editing) return;
    restoredIce4 = 0;                                  // 【v138】每次进入重新统计"老冰转数字冰"的格数
    working = boardFromLevel();
    snapshot = cloneBoard(working);
    snapshotBlocks = cloneBlocks(host.getBlocks ? host.getBlocks() : null);   // 【v133】目标区原样，供一键回退
    editing = true;
    tool = 'place';
    drag = null;
    selCell = null;
    var sel = $('edit-tool'); if (sel) sel.value = 'place';
    // 默认颜色取目标图里第一个出现的颜色（没有就用 1）
    var colors = paletteColors(); curColor = colors[0] || 1;
    var cnt = $('edit-count'); curCount = cnt ? (parseInt(cnt.value, 10) || 3) : 3;
    if (curCount < 1) curCount = 1;
    renderPalette();
    renderAll(true);
    onPaintChanged();     // 【v133】同步画笔按钮/撤回按钮/tip 文案（默认都是关）
  }

  function exit() {
    editing = false;
    drag = null;
    selCell = null;
    var pp = $('edit-pipe-panel'); if (pp) pp.classList.add('hidden');
    working = null;
    snapshot = null;
    snapshotBlocks = null;
  }

  function bind() {
    var wrap = $('edit-board-queues');
    if (wrap) {
      wrap.addEventListener('mousedown', onDown);
      wrap.addEventListener('mouseover', onOver);
      wrap.addEventListener('contextmenu', onContext);
    }
    document.addEventListener('mouseup', onUp);
    var pal = $('edit-palette');
    if (pal) pal.addEventListener('click', onPaletteClick);
    var val = $('edit-validate');
    if (val) val.addEventListener('click', onValidateClick);
    var tsel = $('edit-tool');
    if (tsel) tsel.addEventListener('change', function () { tool = this.value; renderBoard(); onPaintChanged(); });
    // 【v134】管道/锁链/数字冰的参数控件
    var dirSel = $('edit-pipe-dir');
    if (dirSel) {
      dirSel.value = String(curDir);
      dirSel.addEventListener('change', function () {
        curDir = parseInt(this.value, 10) || 13;
        status('管道方向 → ' + PIPE_DIR_CN[curDir] + '（点空格 = 放新管道；点已有管道 = 只改方向，队列不动）');
      });
    }
    var cgIn = $('edit-chain-group');
    if (cgIn) cgIn.addEventListener('input', function () {
      var v = parseInt(this.value, 10);
      curChain = (isNaN(v) || v < 1) ? 1 : Math.min(99, v);
    });
    var cgNew = $('edit-chain-new');
    if (cgNew) cgNew.addEventListener('click', function () {
      curChain = Math.min(99, curChain + 1);
      if (cgIn) cgIn.value = curChain;
      status('锁链组切到 ' + chainTag(curChain) + '（组号 ' + curChain + '）：接下来点的车都进这一组');
    });
    // 【v138/v139】数字冰数值输入框（取代「老冰耐久」）：可以随时改，改完点格子即写入
    var niIn = $('edit-numice-val');
    if (niIn) niIn.addEventListener('input', function () {
      var v = parseInt(this.value, 10);
      curNumIce = (isNaN(v) || v < 1) ? 1 : Math.min(999, v);
    });
    var pq = $('edit-pipe-queue');
    if (pq) { pq.addEventListener('click', onPipeQueueClick); pq.addEventListener('input', onPipeQueueInput); }
    var pAdd = $('edit-pipe-add');
    if (pAdd) pAdd.addEventListener('click', function () {
      var cell = pipeAt(); if (!cell) return;
      cell.queue.push({ color: curColor, count: curCount });
      afterPipeEdit();
    });
    var pClear = $('edit-pipe-clear');
    if (pClear) pClear.addEventListener('click', function () {
      var cell = pipeAt(); if (!cell) return;
      cell.queue = []; cell.next = 0;
      afterPipeEdit();
    });
    var cnt = $('edit-count');
    if (cnt) cnt.addEventListener('input', function () {
      var v = parseInt(this.value, 10); if (isNaN(v) || v < 1) v = 1; if (v > 99) v = 99;
      curCount = v;
      if (tool === 'place') renderBoard();     // 「点已有车=改写」的预览高亮跟着载客量变
      renderValidate();
    });
    var resize = $('edit-resize');
    if (resize) resize.addEventListener('click', resizeBoard);
    var clear = $('edit-clear');
    if (clear) clear.addEventListener('click', function () {
      if (!confirm('清空整个车场？（小人板不动，随时可以点「回到关卡原样」恢复）')) return;
      working = { rows: working.rows, cols: working.cols, cells: emptyCells(working.rows, working.cols) };
      renderAll(true);
    });
    var back = $('edit-defaults');
    if (back) back.addEventListener('click', function () {
      if (!confirm('把车场与目标区都恢复到进入摆盒时的原样？')) return;
      resetOrigin();
    });
    // 【v133】目标区画笔：开关 + 撤回（真正的上色逻辑在 app.js，它管着目标图画布）
    var ptBtn = $('edit-paint-target');
    if (ptBtn) ptBtn.addEventListener('click', function () {
      if (!host.paint) return;
      host.paint.toggle();
      onPaintChanged();
    });
    var puBtn = $('edit-paint-undo');
    if (puBtn) puBtn.addEventListener('click', function () {
      if (host.paint) host.paint.undo();
      onPaintChanged();
    });
    var solveBtn = $('edit-try-solve');
    if (solveBtn) solveBtn.addEventListener('click', trySolve);
    var apply = $('edit-apply');
    if (apply) apply.addEventListener('click', applyToSim);
    var ej = $('edit-export-json');
    if (ej) ej.addEventListener('click', exportJson);
    var et = $('edit-export-txt');
    if (et) et.addEventListener('click', exportTxt);
  }

  A.LevelEditor = {
    init: function (h) { host = h; if (document.readyState !== 'loading') bind(); else document.addEventListener('DOMContentLoaded', bind); },
    enter: enter,
    exit: exit,
    isEditing: function () { return editing; },
    board: function () { return working; },
    // 【v133】供 app.js 的目标区画笔调用
    currentColor: currentColor,
    setColor: setColor,
    toolMode: toolMode,
    onLevelChanged: onLevelChanged,
    onPaintChanged: onPaintChanged
  };
})();
