/**
 * 蚂蚁拿块关卡图修改工具 · 界面层（app.js）
 *
 * 职责（2026-10-28 收敛后）：导入 TXT 图纸 → 画布显示/悬停读数 → 美术编辑（绘制/框选/套索/换色）
 * → 主体提取 → 图纸库 → 图纸拼接 → 导出 TXT/PNG。
 *
 * 本工具**不再包含任何游玩/关卡逻辑**：求解路线、进度区间、多路线复核、自动演示、
 * 暂存压力图、重构关卡、待导出库、棋盘/暂存对比都已从界面与启动流程移除。
 * 只保留 bin/js/utils.js（颜色表）与 generator.js（TXT 解析 / 碎色口径）这两份纯数据工具。
 */
(function () {
  'use strict';

  var C = window.ArtToolCore;
  var $ = function (id) { return document.getElementById(id); };

  var S = {
    items: [],          // 每张图纸：{key,txtName,blocks,warns}
    index: {},          // key（去扩展名的文件名）→ item，用于同名索引匹配
    cur: -1,
    busy: false,
    edit: {              // 美术编辑状态：拖动绘制 / 框选编辑（局部统计/局部替换/局部绘制）+ 整图替换 + 靠色检查 + 撤销 + 导出
      on: false,
      color: 1,
      // 'paint'=拖动绘制（默认） 'select'=矩形框选 'lasso'=套索 'region'=同色连通块 'color'=按色选
      // 后三种是任务 ANT-ARTTOOL-SUBJECT-EXTRACT-20260902 新增的主体提取选法
      tool: 'paint',
      original: null,      // 进入编辑模式时的像素矩阵快照（还原用）
      undoStack: [],       // 每笔 {r,c,before,after} 数组（一次拖动 / 一次替换算一笔）
      redoStack: [],       // 2026-10-30：重做栈（撤销时把批次挪过来）
      // selection 仍是 {r0,c0,r1,c1}（闭区间），但自本轮起它是 **mask 的外接矩形**，
      //   保留它是因为若干既有面板按矩形显示「选区 W×H、行 a–b 列 c–d」；
      //   **真正的选区权威是 mask** —— 不规则选区（套索/同色块）无法用矩形表达。
      //   凡是要「选区内的格子」的地方一律走 selCells()，不要再直接 cellsInRect(selection)。
      selection: null,
      mask: null,          // C.maskNew() 掩码：本轮起的选区权威。null = 未选
      dragging: false, dragStart: null, dragCurrent: null,   // 拖拽框选中的临时状态
      lassoPath: null,     // 套索拖拽中的轨迹 [{r,c}]，松手后转成掩码
      paintDragging: false,   // 「选区内绘制」模式下正在拖拽连续绘制
      replacing: null,     // {scope:'global'|'selection', oldId} 正在等待用户从色库选目标色完成替换
      // ===== 2026-10-30 交互修复新增 =====
      eraser: false,          // 橡皮擦：落笔写 0（空位）
      strokeBatch: null,      // 一笔内累积的改动；松手才并入 undoStack（一笔 = 一次撤销）
      lastPaintCell: null,    // 拖动中上一落笔格，用于补齐指针跳格漏掉的格子
      hintAt: 0,              // 「未开编辑模式」提示的节流时间戳
      hintAt2: 0              // 「框选工具被当成绘制」提示的节流时间戳
    },
    // 主体提取：剔除操作的撤销栈。与 edit.undoStack 分开 ——
    //   那个是「逐像素改色」的批次栈，这里存的是整张图的快照（剔除一次可能动几百格，
    //   逐像素记反而更大），两者互不干扰，各自的撤销按钮也分开。
    extract: { undo: [], lastResult: null },
    pieceLib: [],          // 图纸库（type='artPiece' 的条目），见 PIECE_LIB_STORAGE_KEY
    // 界面偏好：collapsed = {卡片id:1} 折叠状态。只影响显示，持久化在 UI_PREF_STORAGE_KEY。
    ui: { collapsed: {} },
    /* 拼接工作台（任务 ANT-ARTTOOL-PIECE-COMPOSE-20260915）。
     * 与 S.items（导入的图纸）**完全分开**：拼接是在一张新画布上摆部件，
     * 不是在编辑某一张图，混进 S.items 会让列表与编辑状态错位。
     * layers 里每个 = { id, name, blocks, rows, cols, offR, offC, locked, visible }
     *   —— 位置只由 offR/offC 表示，拖拽不动像素，所以拖来拖去是无损的。 */
    compose: {
      active: false,
      rows: 0, cols: 0,        // 0 = 还没建画布
      sources: [],             // 可用部件（导入的 txt / 从图纸库取的），不直接参与出图
      layers: [],              // 画布上的图层，数组顺序 = 层序（后面盖前面）
      selected: [],            // 选中的图层 id（多选用于合并成新主体）
      drag: null,              // 移动图层的拖拽态
      selectBox: null,          // move 工具下从空白处拖出的框选态
      hitCycle: null,           // 同一格连续点选时，在重叠图层之间循环
      finalPreviewVisible: false,// 最终效果图面板是否展开
      colorPickerTarget: null,   // 当前正在选择哪一个规则颜色输入框
      sparseColorId: null,        // 稀少颜色检查当前高亮的颜色 id
      sparseScan: null,           // 最近一次稀少颜色扫描结果（只作展示缓存，导出仍实时拍平）
      paintDrag: null,         // 手动涂色的一笔（连续拖动期间）
      shapeDrag: null,         // 直线/边框的「拖范围」态，松手才落笔
      lastBorder: null,        // 上一次生成的边框形态，供「局部替换某一部件的颜色」
      // 撤销 / 重做栈（2026-10-16 追加：拼接里的操作要能一步步退回，Ctrl/Cmd+Z）
      //   两类条目，见 composePushUndo / composeSnapBefore 上方的说明：
      //     { kind:'blocks', … }  像素快照 —— 只动 pixels 的那几种操作（涂色/直线/填充/换色…）
      //     { kind:'struct', … }  结构快照 —— 图层清单 / 层序 / 位置 / 名字 / 固定隐藏 / 画布规格
      undo: [],
      redo: [],
      historyGroup: 0,         // >0 = 正在「多个操作共用一个撤销点」里（「一键生成」用）
      nextId: 1,
      lastAudit: null
    }
  };

  // 图纸库持久化：只存像素矩阵与元数据，刷新/重开后仍在。
  var PIECE_LIB_STORAGE_KEY = 'antArtTool_pieceLibrary_v1';
  // 界面偏好（各卡片折叠状态）。这是「怎么看」的偏好，不是数据。
  var UI_PREF_STORAGE_KEY = 'antArtTool_uiPrefs_v1';

  // 每新增一张卡片都要登记到这里，否则那张卡片点标题没反应，属于静默失效。
  var COLLAPSIBLE_CARDS = ['cardImport', 'pieceLibCard', 'viewExportDock', 'editCard', 'extractCard', 'checkCard', 'exportCard', 'composeSetupCard', 'composeCard'];

  // ==================== 日志与遮罩 ====================
  function log(msg) {
    var el = $('log');
    var t = new Date().toTimeString().slice(0, 8);
    el.textContent += '[' + t + '] ' + msg + '\n';
    el.scrollTop = el.scrollHeight;
  }
  function overlay(show, text) {
    $('overlay').classList.toggle('hidden', !show);
    if (text != null) $('overlayText').textContent = text;
  }

  // ==================== 破坏性操作的两段式二次确认 ====================
  // 破坏性操作（还原为原图、清空画布、还原剔除）都要二次确认，避免手误点一下就把成果弄没。
  //
  // 为什么不用原生 confirm()：本工具内零 confirm、零 alert，所有反馈都走页面内 log()。
  // 弹窗会打断这套既有风格，而且 confirm 会阻塞渲染。两段式按钮同样挡得住手误，且不打断流程。
  //
  // 时序：点击① → 待确认态 + 冷却期(期间点击一律忽略，这是挡连击/双击穿透的关键)
  //      → 冷却后 TIMEOUT 内 点击② → 执行动作并复位
  //      → 超时 / 按 Esc / 按钮失焦 → 自动复位，动作不执行
  var CONFIRM_COOLDOWN_MS = 400;    // 冷却：这段时间内的第二次点击判定为手误连击，忽略
  var CONFIRM_TIMEOUT_MS = 4000;    // 待确认态存活时长，超时自动放弃，按钮不长期停在危险态
  var armedConfirms = [];           // 当前处于待确认态的复位函数（供 Esc 一次性全部取消）

  /**
   * 给按钮套一道二次确认。只改「点击 → 执行」之间的触发路径，不碰被触发的操作本身。
   * @param {string} id 按钮 DOM id
   * @param {object} o
   *   o.confirmText 待确认态显示的按钮文案
   *   o.hint        进入待确认态时写入日志的说明；可以是字符串或返回字符串的函数（需要动态数量时用函数）
   *   o.action      确认后真正执行的函数
   *   o.guard       返回 false 则不进入待确认态（前置条件不满足，例如库本来就是空的）
   */
  function armConfirm(id, o) {
    var btn = $(id);
    if (!btn) return null;
    var originalText = btn.textContent;
    var armedAt = 0, timer = null;

    function reset() {
      if (timer) { clearTimeout(timer); timer = null; }
      armedAt = 0;
      btn.textContent = originalText;
      btn.classList.remove('confirming');
      var i = armedConfirms.indexOf(reset);
      if (i >= 0) armedConfirms.splice(i, 1);
    }

    btn.onclick = function () {
      if (armedAt) {
        // —— 第二段 ——
        if (Date.now() - armedAt < CONFIRM_COOLDOWN_MS) return;   // 冷却内 = 手误连击，吞掉
        reset();
        o.action();
        return;
      }
      // —— 第一段：只进入待确认态，绝不执行动作 ——
      if (typeof o.guard === 'function' && !o.guard()) return;
      armedAt = Date.now();
      btn.textContent = o.confirmText;
      btn.classList.add('confirming');
      armedConfirms.push(reset);
      timer = setTimeout(reset, CONFIRM_TIMEOUT_MS);
      if (o.hint) log(typeof o.hint === 'function' ? o.hint() : o.hint);
    };
    // 焦点离开按钮（去点了别处）即放弃确认，避免危险态被遗留在页面上
    btn.addEventListener('blur', function () { if (armedAt) reset(); });
    return reset;
  }

  /** 取消当前所有待确认态（Esc 用）。 */
  function cancelArmedConfirms() {
    if (!armedConfirms.length) return false;
    armedConfirms.slice().forEach(function (fn) { fn(); });
    return true;
  }
  function busy(on) {
    S.busy = on;
    ['btnSolve', 'btnLocate', 'btnRoutes', 'fileInput', 'dirInput'].forEach(function (id) {
      var el = $(id); if (el) el.disabled = on;
    });
  }
  function kvTable(rows) {
    var h = '<table>';
    for (var i = 0; i < rows.length; i++) {
      h += '<tr><td class="k">' + rows[i][0] + '</td><td class="v">' + rows[i][1] + '</td></tr>';
    }
    return h + '</table>';
  }

  // ==================== 导入 ====================
  /** 索引键 = 去掉扩展名的文件名（`.solve.json` 视为一个整体扩展名）。同键 = 同一关。 */
  function baseKey(name) {
    return String(name).replace(/\.solve\.json$/i, '').replace(/\.json$/i, '').replace(/\.txt$/i, '');
  }
  function getItem(key) {
    var it = S.index[key];
    if (it) return it;
    it = { key: key, warns: [] };
    S.index[key] = it;
    S.items.push(it);
    return it;
  }

  /**
   * 读取一批文件（来自「选择文件」或「选择文件夹」，文件夹会递归给出全部子文件）。
   * 只收 .txt / .json，其余（.DS_Store、图片、csv、md…）静默忽略并计数。
   * 用固定并发的队列逐个读，边读边报进度，避免一次性起上千个 FileReader。
   */
  function readFiles(fileList, fromDir) {
    var all = Array.prototype.slice.call(fileList);
    var files = all.filter(function (f) { return /\.txt$/i.test(f.name); });
    var ignored = all.length - files.length;
    if (!files.length) {
      log('本次选择的 ' + all.length + ' 个文件里没有 .txt 图纸，未导入');
      return;
    }

    var added = 0, bad = 0, processed = 0, active = 0, i = 0;
    var LIMIT = 8;
    busy(true);
    overlay(true, '读取 0/' + files.length + ' 个文件…');
    log('开始导入' + (fromDir ? '文件夹' : '') + '：TXT 图纸 ' + files.length + ' 个' +
      (ignored ? '，忽略 ' + ignored + ' 个非 TXT 文件' : ''));

    function handleOne(f, text) {
      var key = baseKey(f.name);
      try {
        var a = getItem(key);
        a.txtName = f.name;
        a.blocks = null;              // 先清掉旧图，解析失败时不会静默沿用上一版
        a.blocks = C.parseTxt(text);
        a.warns = [];
        added++;
      } catch (e) {
        bad++;
        if (bad <= 10) log('解析失败 ' + f.name + '：' + (e && e.message));
      }
    }

    function pump() {
      while (active < LIMIT && i < files.length) {
        var f = files[i++];
        active++;
        (function (f) {
          var fr = new FileReader();
          fr.onload = function () { handleOne(f, fr.result); step(); };
          fr.onerror = function () { bad++; step(); };
          fr.readAsText(f);
        })(f);
      }
      if (active === 0 && i >= files.length) {
        busy(false); overlay(false);
        finishImport(added, bad, ignored);
      }
    }
    function step() {
      active--; processed++;
      if (processed % 40 === 0) overlay(true, '读取 ' + processed + '/' + files.length + ' 个文件…');
      pump();
    }
    pump();
  }

  function finishImport(added, bad, ignored) {
    // 只有真正解析出像素矩阵的条目才留在列表里
    S.items = S.items.filter(function (it) { return !!(it.blocks && it.blocks.length); });
    S.items.sort(function (a, b) { return a.key < b.key ? -1 : (a.key > b.key ? 1 : 0); });

    var curKey = S.cur >= 0 && S.items[S.cur] ? S.items[S.cur].key : null;
    S.cur = -1;
    if (curKey) {
      for (var i = 0; i < S.items.length; i++) if (S.items[i].key === curKey) { S.cur = i; break; }
    }

    $('importStat').innerHTML = '共 <b>' + S.items.length + '</b> 张图纸' +
      (ignored ? '　<span class="muted">忽略非 TXT ' + ignored + ' 个</span>' : '') +
      '<br><span class="muted">本次读入 ' + added + ' 个文件' + (bad ? '，失败 ' + bad + ' 个' : '') + '</span>';
    renderList();
    if (S.cur < 0 && S.items.length) select(0);
    else { draw(); refreshEditPanels(); renderEditInfo(); }
    log('导入完成：' + S.items.length + ' 张图纸' + (bad ? '，解析失败 ' + bad + ' 个' : ''));
  }

  function renderList() {
    var kw = ($('listFilter') && $('listFilter').value || '').trim().toLowerCase();
    var h = '', shown = 0;
    for (var i = 0; i < S.items.length; i++) {
      var it = S.items[i];
      if (!it.blocks) continue;
      if (kw && it.key.toLowerCase().indexOf(kw) < 0) continue;
      shown++;
      if (shown > 500) { h += '<div class="item muted">…还有更多，请用过滤框缩小范围</div>'; break; }
      var size = it.blocks.length ? it.blocks.length + '×' + it.blocks[0].length : '';
      h += '<div class="item' + (i === S.cur ? ' active' : '') + '" data-i="' + i + '" title="' + size + '">' +
        '<span class="nm">' + it.key + '</span>' +
        '<span class="tag ok">图</span>' +
        '<span class="muted" style="font-size:11px">' + size + '</span></div>';
    }
    $('levelList').innerHTML = h || '<div class="item muted">' + (S.items.length ? '无匹配' : '暂无') + '</div>';
    Array.prototype.forEach.call($('levelList').querySelectorAll('.item[data-i]'), function (el) {
      el.onclick = function () { select(+el.getAttribute('data-i')); };
    });
  }

  function select(i) {
    S.cur = i;
    renderList();
    var it = S.items[i];
    // 切图：关闭编辑模式并清空选区/撤销栈 —— 编辑快照与上一张图的 blocks 不是同一份数据
    if ($('optEdit').checked) { $('optEdit').checked = false; }
    S.edit.on = false; S.edit.original = null; S.edit.undoStack = [];
    clearSelection(); S.edit.replacing = null; S.edit.paintDragging = false;
    S.edit.strokeBatch = null; S.edit.lastPaintCell = null; S.edit.redoStack = [];
    $('cv').classList.remove('editing');
    // 主体提取的撤销栈也只属于上一张图
    S.extract.undo = []; S.extract.lastResult = null;
    fragState.result = null; fragState.key = null;
    refreshEditPanels();
    renderEditInfo();
    draw();
    log('选中 ' + it.key + '（' + it.blocks.length + '×' + it.blocks[0].length + '）');
  }

  function cur() { return S.cur >= 0 ? S.items[S.cur] : null; }

  /** 视图对象：本工具只编辑当前图纸，没有「原关卡/重构后」双视图。 */
  function viewItem() {
    return cur();
  }

  // ==================== 求解信息面板 ====================
  /** 画布统计条：当前图纸的尺寸、用色种数、非空/空位格数。 */
  function renderCanvasStats(it) {
    var el = $('canvasColorStats');
    if (!el) return;
    if (!it || !it.blocks) { el.innerHTML = '<span class="muted">未导入图纸</span>'; return; }
    var blocks = it.blocks, rows = blocks.length, cols = blocks[0].length;
    var seen = {}, colorCount = 0, nz = 0;
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var v = blocks[r][c];
        if (v <= 0) continue;
        nz++;
        if (!seen[v]) { seen[v] = 1; colorCount++; }
      }
    }
    var total = rows * cols;
    el.innerHTML =
      '<span class="csLabel">画布</span> <b>' + rows + '×' + cols + '</b>' +
      '<span class="csDivider">|</span>' +
      '<span class="csMain">' + colorCount + '</span> 种颜色 <span class="muted">（不含空位 0）</span>' +
      '<span class="csDivider">|</span>' +
      '非空 <b>' + nz + '</b> / ' + total + ' 格' +
      (total > nz ? '　空位 <b>' + (total - nz) + '</b> 格' : '');
  }

  /** 当前缩放读数（px/格 + 图纸尺寸）。2026-10-30 新增：改前只有一根滑块，看不出现在是几倍。 */
  function syncZoomInfo() {
    var el = $('zoomInfo'); if (!el) return;
    var cell = parseInt($('cellSize').value, 10) || 11;
    var it = viewItem();
    el.textContent = cell + ' px/格' + (it && it.blocks ? ' · ' + it.blocks[0].length + '×' + it.blocks.length : '');
  }

  /**
   * 以光标为锚点缩放：缩放后让光标下的那一格仍然停在光标下。
   * 2026-10-30 新增：改前只有滑块，放大后想看的角落要重新滚很久才能找回来。
   */
  function zoomAt(newCell, clientX, clientY) {
    var cv = $('cv');
    if (!cv) return;
    var wrap = cv.parentNode;
    var old = parseInt($('cellSize').value, 10) || 11;
    if (newCell === old) return;
    var rect = cv.getBoundingClientRect();
    var fx = (clientX - rect.left) / old, fy = (clientY - rect.top) / old;
    $('cellSize').value = newCell;
    draw();
    var rect2 = cv.getBoundingClientRect();
    wrap.scrollLeft += (rect2.left + fx * newCell) - clientX;
    wrap.scrollTop += (rect2.top + fy * newCell) - clientY;
  }

  /** 适应窗口：把格子像素调到「整张图刚好装进画布容器」。 */
  function zoomFit() {
    var it = cur();
    if (!it || !it.blocks) { log('还没导入图纸，没法适应窗口。'); return; }
    var wrap = $('cv').parentNode;
    var availW = Math.max(80, wrap.clientWidth - 20);
    var availH = Math.max(80, Math.round(window.innerHeight * 0.62));
    var cols = it.blocks[0].length, rows = it.blocks.length;
    var cell = Math.max(4, Math.min(24, Math.floor(Math.min(availW / cols, availH / rows))));
    $('cellSize').value = cell;
    draw();
    log('适应窗口：' + cell + ' px/格（图纸 ' + cols + '×' + rows + '，可用 ' + availW + '×' + availH + 'px）');
  }

  function draw() {
    syncZoomInfo();
    var cv = $('cv'), ctx = cv.getContext('2d');
    var it = viewItem();
    if (!it || !it.blocks) {
      renderCanvasStats(null);
      cv.width = 600; cv.height = 200;
      ctx.fillStyle = '#0f1216'; ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.fillStyle = '#5d6779'; ctx.font = '13px sans-serif';
      ctx.fillText('导入 TXT 图纸后在此显示', 20, 40);
      $('legend').innerHTML = '';
      return;
    }
    renderCanvasStats(it);
    var blocks = it.blocks, rows = blocks.length, cols = blocks[0].length;
    var cell = parseInt($('cellSize').value, 10) || 11;
    cv.width = cols * cell + 1; cv.height = rows * cell + 1;

    ctx.fillStyle = '#0f1216'; ctx.fillRect(0, 0, cv.width, cv.height);

    // ① 原图像素（描边只画在格线上，不覆盖任何像素颜色）
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var id = blocks[r][c];
        if (!id) continue;
        ctx.fillStyle = window.AntSolver.getColorCSS(id);
        ctx.fillRect(c * cell, r * cell, cell, cell);
      }
    }

    // ①b 碎色像素高亮：画在原图之上、格线之下，让美术直接看到该修哪里
    var fragCells = [];
    if ($('fragHighlight') && $('fragHighlight').checked && fragState.result &&
        fragState.key === it.key && fragState.result.fragCells.length) {
      fragCells = fragState.result.fragCells;
      ctx.save();
      for (var fi = 0; fi < fragCells.length; fi++) {
        var fp = fragCells[fi];
        if (fp.r >= rows || fp.c >= cols) continue;
        ctx.fillStyle = 'rgba(255,64,64,0.42)';
        ctx.fillRect(fp.c * cell, fp.r * cell, cell, cell);
      }
      if (cell >= 5) {
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (var fj = 0; fj < fragCells.length; fj++) {
          var fq = fragCells[fj];
          if (fq.r >= rows || fq.c >= cols) continue;
          ctx.rect(fq.c * cell + 1.5, fq.r * cell + 1.5, cell - 3, cell - 3);
        }
        ctx.stroke();
      }
      ctx.restore();
    }

    // ② 格线
    if ($('optGrid').checked && cell >= 6) {
      ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1;
      ctx.beginPath();
      for (var x = 0; x <= cols; x++) { ctx.moveTo(x * cell + .5, 0); ctx.lineTo(x * cell + .5, rows * cell); }
      for (var y = 0; y <= rows; y++) { ctx.moveTo(0, y * cell + .5); ctx.lineTo(cols * cell, y * cell + .5); }
      ctx.stroke();
    }

    // ③ 空位斜纹：剔除后的格子值为 0，画成斜纹才能和「深色像素」区分开
    var hasVoid = false, voidCount = 0;
    for (var vr = 0; vr < rows; vr++) {
      for (var vc = 0; vc < cols; vc++) { if (blocks[vr][vc] <= 0) { hasVoid = true; voidCount++; } }
    }
    if (hasVoid && (!$('optShowVoid') || $('optShowVoid').checked)) {
      ctx.save();
      for (var zr = 0; zr < rows; zr++) {
        for (var zc = 0; zc < cols; zc++) {
          if (blocks[zr][zc] > 0) continue;
          var zx = zc * cell, zy = zr * cell;
          ctx.fillStyle = '#2b1e15';
          ctx.fillRect(zx, zy, cell, cell);
          if (cell >= 4) {
            ctx.strokeStyle = 'rgba(120,96,74,0.55)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(zx, zy + cell); ctx.lineTo(zx + cell, zy);
            ctx.moveTo(zx, zy + cell / 2); ctx.lineTo(zx + cell / 2, zy);
            ctx.moveTo(zx + cell / 2, zy + cell); ctx.lineTo(zx + cell, zy + cell / 2);
            ctx.stroke();
          }
        }
      }
      ctx.restore();
    }

    // ④ 选区预览（编辑模式下才画；不覆盖任何像素颜色，只淡淡着色 + 描边）
    if (S.edit.on) {
      if (S.edit.dragging && S.edit.dragStart && S.edit.dragCurrent) {
        if (S.edit.lassoPath && S.edit.lassoPath.length) {
          ctx.save();
          ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 3;
          ctx.beginPath();
          S.edit.lassoPath.forEach(function (p, i) {
            var x = p.c * cell + cell / 2, y = p.r * cell + cell / 2;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          });
          ctx.stroke();
          ctx.strokeStyle = '#3fb6c4'; ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.restore();
        } else {
          var dr = normalizeRect(S.edit.dragStart, S.edit.dragCurrent);
          drawSelectionRect(ctx, dr, cell, true);
        }
      } else if (S.edit.mask) {
        drawMaskOverlay(ctx, S.edit.mask, cell);
      }
    }

    // ⑤ 图例
    var legend = [];
    if (fragCells.length) legend.push(['#ff4040', '碎色像素 ' + fragCells.length + ' 格', 'solid']);
    if (hasVoid) legend.push(['#785f4a', '空位（值 0）' + voidCount + ' 格', 'solid']);
    if (S.edit.mask) legend.push(['#3fb6c4', '当前选区', 'dashed']);
    $('legend').innerHTML = legend.map(function (l) {
      return '<span><i class="sw" style="border-top-color:' + l[0] + ';border-top-style:' + l[2] + '"></i>' + l[1] + '</span>';
    }).join('');
  }

  /**
   * 按掩码画选区：逐格淡青色着色 + 沿掩码外边界描边。
   * 逐格着色是必要的 —— 不规则选区光靠描边，用户很难分清哪些格在里面
   * （尤其是同色块选出来的锯齿形状）。着色用低透明度，不遮住底下的颜色 id。
   */
  function drawMaskOverlay(ctx, mask, cell) {
    ctx.save();
    ctx.fillStyle = 'rgba(63,182,196,0.28)';
    for (var i = 0; i < mask.bits.length; i++) {
      if (!mask.bits[i]) continue;
      var r = Math.floor(i / mask.cols), c = i % mask.cols;
      ctx.fillRect(c * cell, r * cell, cell, cell);
    }
    // 描边：只在「选中 ↔ 未选中/越界」的交界处画线，所以不会盖住像素。
    // 复用 core 的 outlineSegments，与拼接里的图层描边同一套几何口径。
    if (!$('optShowMaskOutline') || $('optShowMaskOutline').checked) {
      var segs = C.outlineSegments(C.maskToIndices(mask), mask.rows, mask.cols);
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      strokeSegs(ctx, segs, cell);
      ctx.lineWidth = 1.5; ctx.strokeStyle = '#3fb6c4';
      strokeSegs(ctx, segs, cell);
    }
    ctx.restore();
  }

  /**
   * 画 outlineSegments 的线段。
   * ⚠ 它返回的是**数组** `[x1,y1,x2,y2]`（格线坐标，单位=格），不是 {x1,y1,…} 对象 ——
   * 见 core.js 里 `segs.push([c, r, c + 1, r])`。按对象取字段会得到 undefined、整条描边不显示。
   */
  function strokeSegs(ctx, segs, cell) {
    ctx.beginPath();
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      ctx.moveTo(s[0] * cell, s[1] * cell);
      ctx.lineTo(s[2] * cell, s[3] * cell);
    }
    ctx.stroke();
  }

  /** 画一个矩形选区边框：dashed=true 表示拖拽中的临时预览（虚线），否则是已确定选区（实线）。 */
  function drawSelectionRect(ctx, rect, cell, dashed) {
    var x = rect.c0 * cell, y = rect.r0 * cell;
    var w = (rect.c1 - rect.c0 + 1) * cell, h = (rect.r1 - rect.r0 + 1) * cell;
    ctx.save();
    ctx.setLineDash(dashed ? [5, 3] : []);
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    ctx.strokeStyle = '#ffffff';
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    ctx.restore();
  }

  // ==================== 悬停读数 ====================
  function onHover(ev) {
    var it = viewItem();
    if (!it || !it.blocks) return;
    var cv = $('cv'), rect = cv.getBoundingClientRect();
    var cell = parseInt($('cellSize').value, 10) || 11;
    var c = Math.floor((ev.clientX - rect.left) / cell), r = Math.floor((ev.clientY - rect.top) / cell);
    var rows = it.blocks.length, cols = it.blocks[0].length;
    if (r < 0 || c < 0 || r >= rows || c >= cols) return;
    var id = it.blocks[r][c];
    $('readout').textContent = '行 ' + r + ' 列 ' + c + '　' +
      (id > 0 ? colorLabel(id) : '空位（值 0）');
  }

  // ==================== 导出 ====================
  function download(name, blob) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  function exportPng() {
    var it = cur();
    if (!it || !it.blocks) return;
    $('cv').toBlob(function (b) { download(it.key + '_图纸.png', b); });
  }
  // ==================== 可悬浮面板（用户 2026-08-03 微调第 4、5 项） ====================
  // 「悬浮」按钮把面板从原位脱出来变成可拖动的浮层，拖标题栏移动，再点一次收回原位。
  // 只改这个面板自己的定位，不动页面其它布局，也不影响目标图的绘制与坐标换算。
  // FLOAT_STATE：id → { left, top, width, height } 记住上次拖到哪、拉成多大，收回再悬浮时回到同一状态
  var FLOAT_STATE = {};
  var FLOAT_MIN_W = 180, FLOAT_MIN_H = 90;

  function toggleFloat(id) {
    var el = $(id);
    if (!el) return;
    var on = !el.classList.contains('floating');
    var btn = el.querySelector('.floatToggle');
    if (on) {
      var st = FLOAT_STATE[id];
      var r = el.getBoundingClientRect();
      if (!st) {
        st = FLOAT_STATE[id] = {
          left: Math.max(8, r.left), top: Math.max(8, r.top),
          width: Math.max(FLOAT_MIN_W, Math.round(r.width)), height: 0   // height=0 表示高度跟内容走
        };
      }
      el.classList.add('floating');
      el.style.left = st.left + 'px';
      el.style.top = st.top + 'px';
      el.style.width = st.width + 'px';
      el.style.height = st.height ? st.height + 'px' : '';
      if (btn) btn.textContent = '收回原位';
      log('「' + floatTitleOf(el) + '」已变成悬浮框：拖标题栏移动，拖右边缘/下边缘/右下角可以放大缩小；' +
        '再点「收回原位」放回画布下方的参数区。');
    } else {
      el.classList.remove('floating');
      el.style.left = ''; el.style.top = ''; el.style.width = ''; el.style.height = '';
      if (btn) btn.textContent = '悬浮';
      log('「' + floatTitleOf(el) + '」已收回原位。');
    }
  }

  /** 给面板补上三个拉伸手柄（右边缘 / 下边缘 / 右下角）。只在悬浮态下由 CSS 显示。 */
  function ensureResizeHandles(el) {
    if (el.querySelector('.rzBR')) return;
    ['rzR', 'rzB', 'rzBR'].forEach(function (cls) {
      var h = document.createElement('div');
      h.className = 'rzHandle ' + cls;
      h.setAttribute('data-rz', cls);
      el.appendChild(h);
    });
  }

  function floatTitleOf(el) {
    var t = el.querySelector('.floatTitle');
    return t ? t.textContent.trim() : '面板';
  }

  /**
   * 给所有带「悬浮」按钮的面板绑定：切换悬浮、拖标题栏移动、拖边缘放大缩小。
   * 移动与拉伸都只在悬浮态下生效；非悬浮态下面板在画布下方的参数区里按格子宽度走，不允许乱拉。
   */
  /* ==================== 界面偏好：卡片折叠 ====================
   * 折叠状态只影响显示，持久化在 UI_PREF_STORAGE_KEY。
   */
  function loadUiPrefs() {
    var p = { collapsed: {} };
    try {
      var raw = localStorage.getItem(UI_PREF_STORAGE_KEY);
      if (raw) {
        var o = JSON.parse(raw) || {};
        if (o.collapsed && typeof o.collapsed === 'object') p.collapsed = o.collapsed;
      }
    } catch (e) {
      // 界面偏好坏掉不该拦住工具启动，用默认值继续，但要说出来
      log('界面偏好读取失败（' + (e && e.message) + '），已用默认布局');
    }
    return p;
  }

  function saveUiPrefs() {
    try {
      localStorage.setItem(UI_PREF_STORAGE_KEY, JSON.stringify({
        collapsed: S.ui.collapsed || {}
      }));
    } catch (e) { log('界面偏好保存失败（' + (e && e.message) + '），本次布局不会被记住'); }
  }

  /** 折叠/展开一张卡片。 */
  function setCardCollapsed(id, on) {
    var el = $(id);
    if (!el) return;
    el.classList.toggle('collapsed', !!on);
    S.ui.collapsed = S.ui.collapsed || {};
    if (on) S.ui.collapsed[id] = 1; else delete S.ui.collapsed[id];
  }

  /** 给每张卡片的标题装上折叠开关，并恢复上次的折叠状态。 */
  function initCardCollapse() {
    COLLAPSIBLE_CARDS.forEach(function (id) {
      var card = $(id);
      if (!card) return;
      // 普通卡片点 h3；美术编辑那张的标题在 .floatHead > .floatTitle 里。
      // 不用 ':scope > h3' —— 那个选择器在部分环境（含本项目的回归 DOM 桩）拿不到，
      // 会让折叠静默失效。直接遍历直接子节点，行为确定。
      var head = null, kids = card.children || [];
      for (var i = 0; i < kids.length; i++) {
        if ((kids[i].tagName || '').toLowerCase() === 'h3') { head = kids[i]; break; }
      }
      if (!head) head = card.querySelector('.floatHead > .floatTitle') || card.querySelector('.floatTitle');
      if (!head) return;
      head.title = (head.title ? head.title + '　' : '') + '点标题可折叠/展开这张卡片';
      head.onclick = function (ev) {
        // 标题行里还有「悬浮」按钮等控件，点它们不该触发折叠
        if (ev && ev.target && ev.target !== head) {
          var tag = (ev.target.tagName || '').toLowerCase();
          if (tag === 'button' || tag === 'input' || tag === 'a' || tag === 'select') return;
        }
        setCardCollapsed(id, !card.classList.contains('collapsed'));
        saveUiPrefs();
      };
      if (S.ui.collapsed && S.ui.collapsed[id]) setCardCollapsed(id, true);
    });
  }

  /** 顶栏「折叠全部」：只要还有展开的就全折起，全折了就全展开。 */
  function toggleCollapseAll() {
    // 只统计当前真正可见的卡片（拼接卡片在常规视图里是隐藏的）。
    var targets = COLLAPSIBLE_CARDS.filter(function (id) {
      var el = $(id);
      return !!el && el.offsetParent !== null;
    });
    var anyOpen = targets.some(function (id) { return !$(id).classList.contains('collapsed'); });
    targets.forEach(function (id) { setCardCollapsed(id, anyOpen); });
    saveUiPrefs();
    var btn = $('btnCollapseAll');
    if (btn) btn.textContent = anyOpen ? '展开全部' : '折叠全部';
    log(anyOpen ? '已折叠全部 ' + targets.length + ' 张可见卡片（点标题可单独展开）'
      : '已展开全部 ' + targets.length + ' 张可见卡片');
    draw();
  }

  /* ==================== 5. 图纸拼接工作台 ====================
   * 任务 ANT-ARTTOOL-PIECE-COMPOSE-20260915（用户 2026-09-15 六条需求）。
   *
   * 用户 2026-09-18 修订口径：部件可以叠加，导出时不再因重叠被阻止；
   * 最终结果按图层从底到顶合成，同一格只输出最顶层的像素 id。
   * → 所以本模块把「覆盖提示」和「阻断条件」分开：
   *     重叠、越界只提示；真正阻断只剩空图、背景未填满（若勾选）。
   *
   * 独立 canvas（#composeCv）、独立状态（S.compose），不碰 draw() 与 S.items。
   */

  var COMPOSE_SELECT_COLOR = '#a98bd8';
  var COMPOSE_TYPE_LABEL = {
    subject: '主体',
    halo: '包围',
    background: '背景',
    paint: '手绘',
    guide: '辅助'
  };
  var COMPOSE_COLOR_INPUTS = [
    { id: 'inComposeHaloColor', label: '包围色' },
    { id: 'inComposeBgColorA', label: '背景主色' },
    { id: 'inComposeBgColorB', label: '背景辅色' }
  ];

  function cpS() { return S.compose; }
  function cpHasCanvas() { return cpS().rows > 0 && cpS().cols > 0; }
  function cpLayerById(id) {
    var L = cpS().layers, i;
    for (i = 0; i < L.length; i++) if (L[i].id === id) return L[i];
    return null;
  }
  function cpIsSelected(id) { return cpS().selected.indexOf(id) >= 0; }
  function composeLayerType(L) { return (L && L.type) || 'subject'; }
  function composeTypeLabel(L) { return COMPOSE_TYPE_LABEL[composeLayerType(L)] || composeLayerType(L); }
  function composeColorNumber(id, fallback) {
    var el = $(id);
    var v = parseInt(el && el.value, 10);
    if (!isFinite(v) || v < 0 || v > 34) return fallback;
    return v;
  }
  function composeColorLabel(id) {
    id = +id;
    return id > 0 ? window.AntSolver.getColorName(id) + '(' + id + ')' : '空白(0)';
  }
  function composeLayerCloneBlocks(L) {
    return (L.blocks || []).map(function (r) { return r.slice(); });
  }
  function composeLayerChildren(parentId) {
    return cpS().layers.filter(function (L) { return L && L.parentId === parentId; });
  }
  function composeParentOf(L) {
    return L && L.parentId != null ? cpLayerById(L.parentId) : null;
  }
  function composeSyncChildRelative(L) {
    var p = composeParentOf(L);
    if (!p) return;
    L.relOffR = (L.offR | 0) - (p.offR | 0);
    L.relOffC = (L.offC | 0) - (p.offC | 0);
  }
  function composeMoveLinkedIds(ids) {
    var C2 = cpS(), seen = {};
    (ids || []).forEach(function (id) {
      var L = cpLayerById(id);
      if (!L || L.locked) return;
      seen[L.id] = true;
      if (composeLayerType(L) === 'subject') {
        composeLayerChildren(L.id).forEach(function (ch) {
          if (ch && !ch.locked) seen[ch.id] = true;
        });
      }
    });
    return Object.keys(seen).map(Number);
  }
  function composeLayerColorStats(blocks) {
    var counts = {}, total = 0, nz = 0;
    (blocks || []).forEach(function (row) {
      (row || []).forEach(function (v) {
        v = +v || 0;
        counts[v] = (counts[v] || 0) + 1;
        total++;
        if (v > 0) nz++;
      });
    });
    var rows = Object.keys(counts).map(Number).sort(function (a, b) {
      if (a === 0) return 1;
      if (b === 0) return -1;
      return counts[b] - counts[a] || a - b;
    });
    return { counts: counts, rows: rows, total: total, nonZero: nz, empty: counts[0] || 0 };
  }
  function composeFinalState() {
    var C2 = cpS();
    var blocks = C.composeNewCanvas(C2.rows, C2.cols);
    var owners = [];
    for (var rr = 0; rr < C2.rows; rr++) {
      owners[rr] = [];
      for (var cc = 0; cc < C2.cols; cc++) owners[rr][cc] = null;
    }
    C.composeSortedLayers(C2.layers).forEach(function (entry) {
      var L = entry.layer;
      if (!L || !L.blocks || L.visible === false || L.exportable === false || composeLayerType(L) === 'guide') return;
      for (var r = 0; r < L.blocks.length; r++) for (var c = 0; c < L.blocks[r].length; c++) {
        var v = L.blocks[r][c];
        if (v <= 0) continue;
        var R = r + (L.offR | 0), Cc = c + (L.offC | 0);
        if (R < 0 || Cc < 0 || R >= C2.rows || Cc >= C2.cols) continue;
        blocks[R][Cc] = v;
        owners[R][Cc] = { id: L.id, r: r, c: c };
      }
    });
    return { blocks: blocks, owners: owners };
  }
  function composeSparseThreshold() {
    var v = parseInt(($('inComposeSparseThreshold') || {}).value, 10);
    return isFinite(v) && v > 0 ? v : 8;
  }
  function composeClearSparseUi(clearList) {
    var C2 = cpS();
    C2.sparseColorId = null;
    C2.sparseScan = null;
    if (clearList !== false) {
      var info = $('composeSparseInfo'), list = $('composeSparseList');
      if (info) info.innerHTML = '';
      if (list) list.innerHTML = '';
    }
  }

  /** 进入 / 退出拼接工作台。用 body class 驱动显隐，与常规修图视图互不打扰。 */
  function syncComposeModeButton() {
    var b = $('btnComposeMode');
    if (!b) return;
    b.textContent = cpS().active ? '🎨 回到修图' : '🧩 拼接图纸';
    b.title = cpS().active
      ? '退出拼接，回到普通图纸修图'
      : '进入拼接：新建一张自定规格的画布，把部件拖上去摆成多主体';
  }

  function enterCompose() {
    var C2 = cpS();
    C2.active = true;
    document.body.classList.add('composeMode');
    syncComposeModeButton();
    if (!cpHasCanvas()) {
      composeInitDefaultCanvas();
    }
    if (!C2.layers.length) {
      log('已进入拼接工作台（画布 ' + C2.rows + '×' + C2.cols + '，还没有图层）：' +
        '从右边②放部件，或直接用⑤的画笔画。');
    } else {
      log('已回到拼接工作台（画布 ' + C2.rows + '×' + C2.cols + '，' + C2.layers.length + ' 个图层还在）。');
    }
    // 首次进入时，如果图纸库里有东西就直接带进来，省一步手动点
    if (!C2.sources.length && S.pieceLib && S.pieceLib.length) {
      composeAddFromLib(true);
    }
    renderComposeAll();
  }

  function exitCompose() {
    cpS().active = false;
    document.body.classList.remove('composeMode');
    syncComposeModeButton();
    log('已退出拼接工作台。画布与图层都留着，下次点「🧩 拼接图纸」还在。');
    draw();   // 回到常规视图要重绘目标图
  }

  /** 新建画布（用户需求③：可预设新 txt 图的规格）。 */
  /**
   * 默认画布规格（2026-10-30 用户要求：「默认就是建好画布，且大小 35×35」）。
   * 35×35 与《新构图方向》（30–35 见方：简单背景 + 单主体 + 少量点缀）一致，
   * 也比 55×55 更贴近现在真正在做的图。
   */
  var COMPOSE_DEFAULT_ROWS = 35, COMPOSE_DEFAULT_COLS = 35;

  /**
   * 工具启动时就把画布建好，省掉「先点新建画布」这一步。
   * 刻意**不记撤销点**：否则第一次 Ctrl+Z 会退成「没有画布」这种没意义的状态。
   */
  function composeInitDefaultCanvas() {
    var C2 = cpS();
    if (cpHasCanvas()) return;
    C2.rows = COMPOSE_DEFAULT_ROWS; C2.cols = COMPOSE_DEFAULT_COLS;
    C2.lastAudit = null;
    if ($('inComposeRows')) $('inComposeRows').value = C2.rows;
    if ($('inComposeCols')) $('inComposeCols').value = C2.cols;
    log('已默认建好画布 ' + C2.rows + '×' + C2.cols + '（' + (C2.rows * C2.cols) + ' 格）。' +
      '要换规格改①的行列再点「新建画布」。');
  }

  function composeNewCanvas() {
    var r = parseInt($('inComposeRows').value, 10);
    var c = parseInt($('inComposeCols').value, 10);
    if (!isFinite(r) || !isFinite(c) || r < 4 || c < 4) {
      log('画布规格要填 ≥4 的整数（行与列）'); return;
    }
    if (r > 200 || c > 200) { log('画布最大 200×200（再大浏览器绘制会明显变慢）'); return;
    }
    var C2 = cpS();
    var had = C2.layers.length;
    // 撤销点记在改尺寸之前（截图/尺寸写错是最常见的误操作之一）
    composeSnapBefore('新建画布 ' + r + '×' + c + (cpHasCanvas() ? '（原 ' + C2.rows + '×' + C2.cols + '）' : ''));
    C2.rows = r; C2.cols = c;
    // 换画布不清图层：部件的偏移是画布坐标，换了尺寸后可能有部件落到界外，
    // 但那属于「需要重新摆」而不是「数据没了」—— 直接清掉会让用户白摆一遍。
    // 落到界外多少格由体检如实报出来。
    C2.lastAudit = null;
    composeClearSparseUi(true);
    log('画布已设为 ' + r + '×' + c + '（' + (r * c) + ' 格）。' +
      (had ? '原有 ' + had + ' 个图层保留，若有部件落到界外会在图层列表里标出来。' : ''));
    renderComposeAll();
  }

  function composeClearCanvas() {
    var C2 = cpS();
    composeSnapBefore('清空画布（移除 ' + C2.layers.length + ' 个图层）');
    C2.layers = []; C2.selected = []; C2.lastAudit = null;
    composeClearSparseUi(true);
    C2.drag = C2.selectBox = C2.paintDrag = C2.shapeDrag = C2.hitCycle = null;
    log('画布上的图层已全部移除（部件列表不受影响，可以重新摆）。');
    renderComposeAll();
  }

  /* ---------- 部件来源（用户需求②：可导入 txt 图和图库） ---------- */

  function composeAddSource(name, blocks, from) {
    var C2 = cpS();
    var base = safeFileName(name || '部件');
    var nm = base, k = 2;
    while (C2.sources.some(function (s) { return s.name === nm; })) { nm = base + '_' + k; k++; }
    var nz = 0;
    for (var r = 0; r < blocks.length; r++) for (var c = 0; c < blocks[r].length; c++) if (blocks[r][c] > 0) nz++;
    C2.sources.push({
      name: nm, blocks: blocks,
      rows: blocks.length, cols: blocks[0] ? blocks[0].length : 0,
      pixelCount: nz, bbox: C.bboxOfBlocks(blocks), from: from || ''
    });
    return nm;
  }

  function composeImportTxt(files) {
    if (!files || !files.length) return;
    var all = Array.prototype.slice.call(files);
    // 文件夹导入会连 .DS_Store / 图片 / 说明.md 一起带进来，这里只收 .txt，其余静默计数
    var arr = all.filter(function (f) { return /\.txt$/i.test(f.name); });
    var ignored = all.length - arr.length;
    if (!arr.length) {
      log('所选内容里没有 .txt 图纸' + (ignored ? '（已忽略 ' + ignored + ' 个非 TXT 文件）' : ''));
      return;
    }
    var okN = 0, bad = [];
    var pending = arr.length;
    // 撤销点：读文件是异步的，所以先拍好快照，等**第一个**部件真的加进来时才压栈
    //（全都读失败的话就不该留一步没用的撤销）。
    var pre = composeSnapState(), snapPushed = false;
    arr.forEach(function (f) {
      var fr = new FileReader();
      fr.onload = function () {
        try {
          var bl = C.parseTxt(String(fr.result));
          if (!bl.length || !bl[0].length) throw new Error('解析出空矩阵');
          if (!snapPushed) { snapPushed = true; composePushStruct(pre, '导入部件 TXT（' + arr.length + ' 个文件）'); }
          composeAddSource(f.name.replace(/\.txt$/i, ''), bl, 'txt:' + f.name);
          okN++;
        } catch (e) {
          bad.push(f.name + '（' + (e && e.message) + '）');
        }
        if (--pending === 0) finish();
      };
      fr.onerror = function () { bad.push(f.name + '（读取失败）'); if (--pending === 0) finish(); };
      fr.readAsText(f);
    });
    function finish() {
      log('部件导入：成功 ' + okN +
        (bad.length ? '，失败 ' + bad.length + ' —— ' + bad.join('；') : '') +
        (ignored ? '，忽略非 TXT ' + ignored + ' 个' : ''));
      renderComposeAll();
    }
  }

  /** 从图纸库把部件加进来。quiet=true 用于进入拼接时的自动带入。 */
  function composeAddFromLib(quiet) {
    var lib = S.pieceLib || [];
    var pieces = lib.filter(function (p) { return p && p.type === C.ART_PIECE_TYPE && p.blocks; });
    if (!pieces.length) {
      if (!quiet) log('图纸库是空的。先去「4. 主体提取」抠几个部件存进图纸库，或用上面的「导入 TXT 图」。');
      return;
    }
    if (!quiet) composeSnapBefore('从图纸库添加 ' + pieces.length + ' 个部件到部件列表');
    var n = 0;
    pieces.forEach(function (p) { composeAddSource(p.key, p.blocks, 'lib'); n++; });
    log('已从图纸库添加 ' + n + ' 个部件到部件列表' + (quiet ? '（进入拼接时自动带入）' : '') + '。');
    if (!quiet) renderComposeAll();
  }

  function composeClearSources() {
    composeSnapBefore('清空部件列表（' + cpS().sources.length + ' 个部件）');
    cpS().sources = [];
    log('部件列表已清空（画布上已摆好的图层不受影响）。');
    renderComposeAll();
  }

  /** 把一个部件放上画布 → 成为一个图层（用户需求④）。 */
  function composePlace(srcIndex) {
    var C2 = cpS();
    if (!cpHasCanvas()) { log('先新建画布，再放部件'); return; }
    var s = C2.sources[srcIndex];
    if (!s) return;
    composeSnapBefore('放上「' + s.name + '」');
    // 默认落点：尽量放在画布内、且不与已有图层重叠的位置；找不到就放左上角并如实说明
    var spot = composeFindSpot(s);
    C2.layers.push({
      id: C2.nextId++, type: 'subject', name: s.name, blocks: s.blocks,
      rows: s.rows, cols: s.cols,
      offR: spot.r, offC: spot.c, locked: false, visible: true,
      selectable: true, exportable: true, source: s.from || ''
    });
    C2.selected = [C2.layers[C2.layers.length - 1].id];
    C2.lastAudit = null;
    log('已把「' + s.name + '」放上画布，位置 行' + spot.r + ' 列' + spot.c +
      (spot.found ? '（自动找了个不重叠的空位）' : '（**没找到不重叠的空位**，先叠着放在这里，拖到合适位置即可 —— 摆放期允许叠加）'));
    renderComposeAll();
  }

  /**
   * 给新部件找一个「在画布内且不与现有图层重叠」的落点。
   * 找不到就返回 (0,0) 并标记 found=false —— 按用户口径叠着放也是允许的，
   * 所以这里不拒绝，只是把情况说清。
   */
  function composeFindSpot(s) {
    var C2 = cpS();
    var bb = s.bbox;
    if (!bb) return { r: 0, c: 0, found: true };
    // 只需要让部件的**有效内容**落在画布里，所以按 bbox 算可行的偏移范围
    var maxR = C2.rows - bb.rows - bb.r0, maxC = C2.cols - bb.cols - bb.c0;
    var step = 1;
    for (var r = -bb.r0; r <= maxR; r += step) {
      for (var c = -bb.c0; c <= maxC; c += step) {
        var probe = C2.layers.concat([{ blocks: s.blocks, offR: r, offC: c, visible: true }]);
        var cf = C.composeConflicts(probe, C2.rows, C2.cols, 1);
        if (cf.count === 0) {
          var pl = C.composeLayerPlacement({ blocks: s.blocks, offR: r, offC: c }, C2.rows, C2.cols);
          if (pl.clipped === 0) return { r: r, c: c, found: true };
        }
      }
    }
    return { r: Math.max(0, -bb.r0), c: Math.max(0, -bb.c0), found: false };
  }

  /* ---------- 绘制 ---------- */

  function composeCell() { return parseInt($('composeCellSize').value, 10) || 9; }
  function composePaintChecker(ctx, w, h, size) {
    size = Math.max(1, size || 12);
    ctx.fillStyle = '#c4c7cb';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#dde0e3';
    for (var y = 0; y < h; y += size) {
      for (var x = 0; x < w; x += size) {
        if (((x / size) + (y / size)) % 2 === 0) ctx.fillRect(x, y, size, size);
      }
    }
  }

  /** 拼接画布绘制：底图 → 各图层 → 部件边界 → 覆盖提示 → 选中框。 */
  function drawCompose() {
    var cv = $('composeCv');
    if (!cv) return;
    var ctx = cv.getContext('2d');
    var C2 = cpS();
    if (!cpHasCanvas()) {
      cv.width = 600; cv.height = 160;
      composePaintChecker(ctx, cv.width, cv.height, 16);
      ctx.fillStyle = '#68707a'; ctx.font = '13px sans-serif';
      ctx.fillText('还没有画布 —— 在右边「5. 图纸拼接 · 画布与部件」①设定规格并点「新建画布」', 20, 40);
      return;
    }
    var cell = composeCell(), rows = C2.rows, cols = C2.cols;
    cv.width = cols * cell + 1; cv.height = rows * cell + 1;

    // 底：PS 风格灰色棋盘格。空位不是某种颜色，只是透明/空白的视觉提示。
    composePaintChecker(ctx, cv.width, cv.height, cell);

    // 各图层（按列表真实层序从底到顶绘制；生成时只负责把背景/包围放到合理默认位置）
    C.composeSortedLayers(C2.layers).forEach(function (entry) {
      var L = entry.layer;
      if (!L.visible) return;
      var bl = L.blocks;
      for (var r = 0; r < bl.length; r++) {
        for (var c = 0; c < bl[r].length; c++) {
          var v = bl[r][c];
          if (v <= 0) continue;
          var R = r + L.offR, Cc = c + L.offC;
          if (R < 0 || Cc < 0 || R >= rows || Cc >= cols) continue;
          ctx.fillStyle = window.AntSolver.getColorCSS(v);
          ctx.fillRect(Cc * cell, R * cell, cell, cell);
        }
      }
    });

    if ($('optComposeGrid').checked && cell >= 5) {
      ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1;
      for (var i = 0; i <= cols; i++) { ctx.beginPath(); ctx.moveTo(i * cell + .5, 0); ctx.lineTo(i * cell + .5, rows * cell); ctx.stroke(); }
      for (var j = 0; j <= rows; j++) { ctx.beginPath(); ctx.moveTo(0, j * cell + .5); ctx.lineTo(cols * cell, j * cell + .5); ctx.stroke(); }
    }

    // 各部件边界：多主体摆放时，不描边根本分不清哪块属于哪个部件
    if ($('optComposeOutline').checked) {
      C.composeSortedLayers(C2.layers).forEach(function (entry) {
        var L = entry.layer;
        if (!L.visible) return;
        var idx = [];
        for (var r = 0; r < L.blocks.length; r++) for (var c = 0; c < L.blocks[r].length; c++) {
          if (L.blocks[r][c] <= 0) continue;
          var R = r + L.offR, Cc = c + L.offC;
          if (R < 0 || Cc < 0 || R >= rows || Cc >= cols) continue;
          idx.push(R * cols + Cc);
        }
        if (!idx.length) return;
        var segs = C.outlineSegments(idx, rows, cols);
        ctx.strokeStyle = cpIsSelected(L.id) ? COMPOSE_SELECT_COLOR : 'rgba(40,48,58,0.55)';
        ctx.lineWidth = cpIsSelected(L.id) ? 2 : 1;
        ctx.beginPath();
        segs.forEach(function (s) {
          ctx.moveTo(s[0] * cell, s[1] * cell);
          ctx.lineTo(s[2] * cell, s[3] * cell);
        });
        ctx.stroke();
      });
    }

    // 覆盖高亮：摆放期不拦，导出也不拦。
    // 2026-11-02 用户要求「画布上重叠的地方不要打叉叉」：
    //   重叠是正常摆法，之前逐格画红框 + ✕ 会把整片重叠区变成红叉阵，既挡画面又像报错。
    //   现在只在勾选时淡淡着色，并沿重叠区外边界描一圈虚线 —— 不再有 ✕，也不再逐格切红格子。
    if ($('optComposeConflict').checked) {
      var cf = C.composeConflicts(C2.layers, rows, cols, 4000);
      if (cf.count) {
        var confIdx = [];
        ctx.save();
        ctx.fillStyle = 'rgba(255,72,72,0.14)';
        cf.cells.forEach(function (x) {
          ctx.fillRect(x.c * cell, x.r * cell, cell, cell);
          confIdx.push(x.r * cols + x.c);
        });
        if (cell >= 5) {
          var confSegs = C.outlineSegments(confIdx, rows, cols);
          ctx.strokeStyle = 'rgba(216,59,50,0.85)';
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 3]);
          ctx.beginPath();
          confSegs.forEach(function (s) {
            ctx.moveTo(s[0] * cell, s[1] * cell);
            ctx.lineTo(s[2] * cell, s[3] * cell);
          });
          ctx.stroke();
          ctx.setLineDash([]);
        }
        ctx.restore();
      }
    }

    // 稀少颜色定位：按“最终导出图”高亮，而不是按单个图层高亮。
    // 这样重叠区也遵守“只输出最顶层像素 id”的同一口径。
    if (C2.sparseColorId != null) {
      var finalState = composeFinalState();
      var sid = +C2.sparseColorId;
      ctx.save();
      ctx.fillStyle = 'rgba(47,111,174,0.24)';
      ctx.strokeStyle = '#0b62b4';
      ctx.lineWidth = 1;
      for (var hr = 0; hr < rows; hr++) for (var hc = 0; hc < cols; hc++) {
        if (finalState.blocks[hr][hc] !== sid) continue;
        var HX = hc * cell, HY = hr * cell;
        ctx.fillRect(HX, HY, cell, cell);
        ctx.strokeRect(HX + .5, HY + .5, cell - 1, cell - 1);
        if (cell >= 8) {
          ctx.beginPath();
          ctx.moveTo(HX + Math.floor(cell / 2) + .5, HY + 2);
          ctx.lineTo(HX + Math.floor(cell / 2) + .5, HY + cell - 2);
          ctx.moveTo(HX + 2, HY + Math.floor(cell / 2) + .5);
          ctx.lineTo(HX + cell - 2, HY + Math.floor(cell / 2) + .5);
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    // 直线/边框的拖拽预览：落笔前先看清会画成什么样，避免反复撤销试错
    if (C2.shapeDrag) {
      var sd = C2.shapeDrag;
      var preview = [];
      var previewBox = { r0: sd.from.r, c0: sd.from.c, r1: sd.to.r, c1: sd.to.c };
      if (sd.tool === 'line') {
        preview = C.lineCells(sd.from.r, sd.from.c, sd.to.r, sd.to.c, composeBrushWidth(), rows, cols);
      } else if (composeIsShapeTool(sd.tool)) {
        try { preview = composeShapeCells(sd.tool, previewBox); } catch (e) { preview = []; }
      } else {
        try {
          preview = C.borderShape($('selComposeBorder').value,
            previewBox, composeBrushWidth(), rows, cols).cells;
        } catch (e) { preview = []; }
      }
      var pc = composeBrushColor();
      ctx.globalAlpha = 0.62;
      ctx.fillStyle = pc === 0 ? '#8f7963' : window.AntSolver.getColorCSS(pc);
      preview.forEach(function (x) { ctx.fillRect(x.c * cell, x.r * cell, cell, cell); });
      ctx.globalAlpha = 1;
      if (cell >= 5) {
        ctx.strokeStyle = COMPOSE_SELECT_COLOR; ctx.lineWidth = 1;
        ctx.setLineDash([3, 2]);
        var rr0 = Math.min(sd.from.r, sd.to.r), rr1 = Math.max(sd.from.r, sd.to.r);
        var cc0 = Math.min(sd.from.c, sd.to.c), cc1 = Math.max(sd.from.c, sd.to.c);
        ctx.strokeRect(cc0 * cell + .5, rr0 * cell + .5, (cc1 - cc0 + 1) * cell - 1, (rr1 - rr0 + 1) * cell - 1);
        ctx.setLineDash([]);
      }
    }

    // 框选预览
    if (C2.selectBox) {
      var sb = C2.selectBox;
      var sr0 = Math.min(sb.from.r, sb.to.r), sr1 = Math.max(sb.from.r, sb.to.r);
      var sc0 = Math.min(sb.from.c, sb.to.c), sc1 = Math.max(sb.from.c, sb.to.c);
      ctx.fillStyle = 'rgba(95,111,225,0.10)';
      ctx.fillRect(sc0 * cell, sr0 * cell, (sc1 - sc0 + 1) * cell, (sr1 - sr0 + 1) * cell);
      ctx.strokeStyle = COMPOSE_SELECT_COLOR;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(sc0 * cell + .5, sr0 * cell + .5, (sc1 - sc0 + 1) * cell - 1, (sr1 - sr0 + 1) * cell - 1);
      ctx.setLineDash([]);
    }

    // 选中图层的外接框（拖拽时看得见抓的是谁）
    C2.selected.forEach(function (id) {
      var L = cpLayerById(id);
      if (!L) return;
      var pl = C.composeLayerPlacement(L, rows, cols);
      if (!pl.bbox) return;
      var b = pl.bbox;
      ctx.strokeStyle = COMPOSE_SELECT_COLOR; ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(b.c0 * cell + 1, b.r0 * cell + 1, b.cols * cell - 2, b.rows * cell - 2);
      ctx.setLineDash([]);
    });
  }

  /* ---------- 面板 ---------- */

  function composeThumb(blocks, max) {
    max = max || 34;
    var rows = blocks.length, cols = blocks[0] ? blocks[0].length : 0;
    var cv = document.createElement('canvas');
    var px = Math.max(1, Math.floor(max / Math.max(rows, cols)));
    cv.width = cols * px; cv.height = rows * px;
    var ctx = cv.getContext('2d');
    composePaintChecker(ctx, cv.width, cv.height, px);
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      var v = blocks[r][c];
      if (v <= 0) continue;
      ctx.fillStyle = window.AntSolver.getColorCSS(v);
      ctx.fillRect(c * px, r * px, px, px);
    }
    return cv;
  }

  function renderComposeSources() {
    var box = $('composeSourceList'), info = $('composeSourceInfo');
    if (!box) return;
    var C2 = cpS();
    info.innerHTML = C2.sources.length
      ? '<div class="kvRow"><span>可用部件</span><b>' + C2.sources.length + ' 个</b></div>'
      : '<div class="muted">还没有部件 —— 用上面的「导入 TXT 图」或「从图纸库全部添加」</div>';
    box.innerHTML = '';
    C2.sources.forEach(function (s, i) {
      var row = document.createElement('div');
      row.className = 'item';
      row.appendChild(composeThumb(s.blocks));
      var txt = document.createElement('div');
      txt.className = 'grow';
      txt.innerHTML = '<b>' + escHtml(s.name) + '</b>　' + s.rows + '×' + s.cols +
        '，' + s.pixelCount + ' 格' +
        (s.bbox ? '，占位 ' + s.bbox.rows + '×' + s.bbox.cols : '，<span style="color:#ff9a9a">空图</span>');
      row.appendChild(txt);
      var btn = document.createElement('button');
      btn.className = 'miniBtn';
      btn.textContent = '放上画布';
      btn.disabled = !cpHasCanvas() || !s.bbox;
      btn.title = !cpHasCanvas() ? '先新建画布' : (!s.bbox ? '这是一张空图，放上去没有意义' : '放到画布上成为一个新图层');
      btn.onclick = function () { composePlace(i); };
      row.appendChild(btn);
      var del = document.createElement('button');
      del.className = 'miniBtn';
      del.textContent = '移除';
      del.title = '从部件列表移除（不影响已经摆到画布上的图层）。误删可以用「撤销」找回';
      del.onclick = function () {
        composeSnapBefore('从部件列表移除「' + s.name + '」');
        C2.sources.splice(i, 1);
        renderComposeAll();
      };
      row.appendChild(del);
      box.appendChild(row);
    });
  }

  function renderComposeLayers() {
    var box = $('composeLayerList'), info = $('composeLayerInfo');
    if (!box) return;
    var C2 = cpS();
    if (!cpHasCanvas()) {
      info.innerHTML = '<div class="muted">还没有画布</div>';
      box.innerHTML = ''; return;
    }
    var audit = C.composeAudit(C2.layers, C2.rows, C2.cols);
    C2.lastAudit = audit;
    info.innerHTML =
      '<div class="kvRow"><span>画布</span><b>' + C2.rows + '×' + C2.cols + '</b></div>' +
      '<div class="kvRow"><span>图层</span><b>' + C2.layers.length + '</b>（可见 ' + audit.visibleLayers + '）</div>' +
      '<div class="kvRow"><span>实际非空像素</span><b>' + audit.pixelActual + '</b>' +
      '（占画布 ' + (audit.pixelActual / (C2.rows * C2.cols) * 100).toFixed(1) + '%）</div>' +
      '<div class="kvRow"><span>用色</span><b>' + audit.colorCount + ' 种</b>（不含空位 0）</div>' +
      '<div class="kvRow"><span>覆盖提示</span><b style="color:' +
      (audit.conflictCount ? '#b06000' : '#2f8652') + '">' + audit.conflictCount + ' 格</b>' +
      (audit.conflictCount ? '（导出只输出最顶层的像素 id）' : '') + '</div>' +
      (audit.clipped ? '<div class="kvRow"><span>画布外裁切</span><b style="color:#b06000">' +
        audit.clipped + ' 格</b>（不阻止导出，只输出画布内像素）</div>' : '');

    box.innerHTML = '';
    // 列表按「后画的在上面」展示，与图层直觉一致（数组末尾 = 最上层）
    for (var i = C2.layers.length - 1; i >= 0; i--) {
      (function (L, idx) {
        var pl = C.composeLayerPlacement(L, C2.rows, C2.cols);
        var badConf = audit.conflicts.perLayer[idx] || 0;
        var row = document.createElement('div');
        row.className = 'item' + (cpIsSelected(L.id) ? ' selected' : '') + (badConf ? ' conflict' : '') +
          (L.parentId != null ? ' childLayer' : '');
        row.appendChild(composeThumb(L.blocks, 26));
        var txt = document.createElement('div');
        txt.className = 'grow';
        var parent = composeParentOf(L);
        txt.innerHTML = '<span class="layerBadge type">' + composeTypeLabel(L) + '</span> ' +
          (parent ? '<span class="layerBadge child">子层: ' + escHtml(parent.name) + '</span> ' : '') +
          '<b>' + escHtml(L.name) + '</b>　行' + L.offR + ' 列' + L.offC +
          '　' + pl.inside + ' 格' +
          (pl.clipped ? ' <span class="layerBadge warn">超出 ' + pl.clipped + '</span>' : '') +
          (badConf ? ' <span class="layerBadge warn">覆盖 ' + badConf + '</span>' : '') +
          (L.locked ? ' <span class="layerBadge locked">已固定</span>' : '') +
          (!L.visible ? ' <span class="layerBadge">已隐藏</span>' : '');
        txt.onclick = function (ev) { composeSelectLayer(L.id, ev && (ev.shiftKey || ev.metaKey)); };
        txt.style.cursor = 'pointer';
        txt.title = '点击选中（Shift/Cmd 多选，多选后可合并成一个新主体）。选中后可用方向键逐格微调位置';
        row.appendChild(txt);
        [['rename', '改名', '重命名这个图层'],
        ['copy', '复制', '复制这个图层'],
        ['recolor', '换色', '把这个图层的全部非 0 像素换成当前画笔颜色'],
        ['top', '置顶', '移动到全部图层最上层'],
        ['bottom', '置底', '移动到全部图层最下层'],
        ['up', '↑', '上移一层（重叠时盖住下面的）'],
        ['down', '↓', '下移一层'],
        ['center', '居中', '把这个部件在画布上居中'],
        ['lock', L.locked ? '解固' : '固定', L.locked ? '解除固定，重新可拖' : '固定位置，防止误拖'],
        ['hide', L.visible ? '隐藏' : '显示', L.visible ? '暂时隐藏（不参与覆盖提示与导出）' : '重新显示'],
        ['del', '移除', '从画布移除（部件列表里还留着）']
        ].forEach(function (spec) {
          var b = document.createElement('button');
          b.className = 'miniBtn';
          b.textContent = spec[1];
          b.title = spec[2];
          b.onclick = function (ev) { ev.stopPropagation(); composeLayerAction(L.id, spec[0]); };
          row.appendChild(b);
        });
        box.appendChild(row);
      })(C2.layers[i], i);
    }
    syncComposeButtons();
  }

  function composeSelectLayer(id, additive) {
    var C2 = cpS();
    if (additive) {
      var k = C2.selected.indexOf(id);
      if (k >= 0) C2.selected.splice(k, 1); else C2.selected.push(id);
    } else {
      C2.selected = [id];
    }
    renderComposeAll();
  }

  /**
   * 撤销 / 重做按钮的同步。
   * 两处按钮共用：拼接工作台顶栏（看得见的地方，顶栏顺带显示还能撤几步）
   * 与画布下方「⑤ 在画布上画」那张卡片里的按钮（①–③ 在画布右侧）。
   */
  function syncComposeHistoryButtons() {
    var C2 = cpS();
    var un = (C2.undo || []).length, rn = (C2.redo || []).length;
    var undoTitle = un
      ? '撤销上一步（还可撤 ' + un + ' 步）：放上部件、生成背景/包围、拖动移动、合并、删除图层、画的那一笔…都能一步步退回。快捷键 Ctrl/⌘+Z'
      : '还没有可撤销的操作 —— 放上部件、生成背景、拖动或画一笔之后就能撤了';
    var redoTitle = rn
      ? '重做（还可重做 ' + rn + ' 步）。快捷键 Ctrl/⌘+Shift+Z 或 Ctrl+Y'
      : '没有可重做的操作（重做只在刚撤销之后有效）';
    [[$('btnComposeUndo'), false, '↶ 撤销'], [$('btnComposeUndoTop'), true, '↶ 撤销']].forEach(function (spec) {
      var b = spec[0];
      if (!b) return;
      b.disabled = !un;
      b.title = undoTitle;
      b.textContent = spec[1] && un ? spec[2] + ' (' + un + ')' : spec[2];
    });
    [[$('btnComposeRedo'), false, '↷ 重做'], [$('btnComposeRedoTop'), true, '↷ 重做']].forEach(function (spec) {
      var b = spec[0];
      if (!b) return;
      b.disabled = !rn;
      b.title = redoTitle;
      b.textContent = spec[1] && rn ? spec[2] + ' (' + rn + ')' : spec[2];
    });
  }

  function syncComposeButtons() {
    var C2 = cpS();
    var a = C2.lastAudit;
    var can = cpHasCanvas() && C2.layers.length > 0 && a && a.pixelActual > 0;
    var clean = can && (!composeRequireBackground() || a.backgroundHoles === 0);
    var e1 = $('btnComposeExportTxt'), e2 = $('btnComposeToLib');
    if (e1) {
      e1.disabled = !can;
      e1.title = !can ? '先新建画布并放上部件'
        : (clean ? '导出为 TXT 目标图；重叠取最顶层像素，画布外自动裁切' : '当前背景未填满或最终图为空 —— 点了会先告诉你哪里有问题');
    }
    if (e2) { e2.disabled = !can; }
    var em = $('btnComposeMerge');
    if (em) {
      em.disabled = C2.selected.length < 2;
      em.title = C2.selected.length < 2
        ? '先选中 2 个以上图层（Shift 点击多选）'
        : '把选中的 ' + C2.selected.length + ' 个图层合并成一个整体，之后不能再单独拖开';
    }
    syncComposeHistoryButtons();
    var el2 = $('btnComposeLayerExport');
    if (el2) {
      var one = C2.selected.length === 1 ? cpLayerById(C2.selected[0]) : null;
      el2.disabled = !one;
      el2.title = one ? '把「' + one.name + '」单独导出成 txt 模块，之后可当部件再导入'
        : '先选中恰好一个图层';
    }
    // 边框那一行只在「边框」工具下才有意义，其它工具下淡化提示
    var br = $('composeBorderRow');
    if (br) br.style.opacity = (composeTool() === 'border') ? '1' : '0.5';
    var info = $('composeCanvasInfo');
    if (info) {
      info.textContent = cpHasCanvas()
        ? (C2.rows + '×' + C2.cols + '　图层 ' + C2.layers.length +
          (a ? '　颜色 ' + a.colorCount + ' 种　像素 ' + a.pixelActual +
            (a.conflictCount ? '　覆盖 ' + a.conflictCount : '') : ''))
        : '还没有画布';
    }
  }

  function renderComposeAll() {
    renderComposeSources();
    renderComposeLayers();
    renderComposeBorderParts();
    renderComposePalette();
    drawCompose();
    composeRenderFinalPreview(false);
  }

  /* ---------- 拖拽摆放（用户需求④⑤：可以随意拖拽 / 固定） ---------- */

  /** 鼠标位置 → 拼接画布的格坐标。允许越界（拖到画布外也要能继续拖），所以不夹取。 */
  function composeEventToCell(ev) {
    var cell = composeCell();
    var rect = $('composeCv').getBoundingClientRect();
    return {
      r: Math.floor((ev.clientY - rect.top) / cell),
      c: Math.floor((ev.clientX - rect.left) / cell)
    };
  }

  /**
   * 命中测试：这一格上最上面的那个图层是谁。
   * 从数组末尾往前找 —— 数组末尾是最上层，与 composeFlatten 的覆盖顺序、
   * 以及图层列表的展示顺序（末尾在最上面）保持同一套口径。
   * 只认**非 0 像素**：点在部件的空隙上等于没点到它，否则一个带大片空白的部件会
   * 把它外接矩形内的所有点击都吃掉，下面的图层再也选不中。
   */
  function composeHitLayers(r, c) {
    var L = C.composeSortedLayers(cpS().layers).map(function (entry) { return entry.layer; });
    var out = [];
    for (var i = L.length - 1; i >= 0; i--) {
      var la = L[i];
      if (!la.visible || la.selectable === false) continue;
      var rr = r - la.offR, cc = c - la.offC;
      if (rr < 0 || cc < 0 || rr >= la.blocks.length) continue;
      var row = la.blocks[rr];
      if (!row || cc >= row.length) continue;
      if (row[cc] > 0) out.push(la);
    }
    return out;
  }

  function composeHitLayer(r, c, ev) {
    var hits = composeHitLayers(r, c);
    if (!hits.length) return null;
    var C2 = cpS();
    var ids = hits.map(function (L) { return L.id; }).join(',');
    var now = Date.now();
    var same = C2.hitCycle && C2.hitCycle.r === r && C2.hitCycle.c === c &&
      C2.hitCycle.ids === ids && now - C2.hitCycle.t < 900 && !(ev && (ev.shiftKey || ev.metaKey));
    if (same) C2.hitCycle.idx = (C2.hitCycle.idx + 1) % hits.length;
    else C2.hitCycle = { r: r, c: c, ids: ids, idx: 0 };
    C2.hitCycle.t = now;
    return hits[C2.hitCycle.idx];
  }

  function onComposeMouseDown(ev) {
    var C2 = cpS();
    if (!cpHasCanvas()) {
      // 原先这里是静默 return —— 用户在没建画布时点画布，什么反应都没有，
      // 只能自己猜是哪里不对。改成如实说清下一步。
      log('还没有画布，点不了。先在右边「5. 图纸拼接 · 画布与部件」①填好行列，点「新建画布」。');
      return;
    }
    var p = composeEventToCell(ev);

    // 绘制类工具优先接管：它们作用于「当前选中的图层」，与命中测试无关
    // （否则在空白处画不了 —— 那里没有任何图层可命中）。
    var tool = composeTool();
    if (tool !== 'move') {
      if (p.r < 0 || p.c < 0 || p.r >= C2.rows || p.c >= C2.cols) return;
      // 空白画布上直接就能画：没有可画图层时自动补一张（用户 2026-09-15 追加要求）
      var L = composeEnsureDrawTarget();
      if (!L) return;
      if (tool === 'paint') {
        // 按下那一格就不在目标图层里（例如选中了部件却在空白处落笔）→ 换成整张画布的绘制层，
        // 否则 composeStrokeTo 会直接 return，用户看到的是「点了没反应」。
        L = composeFitDrawLayer(L, [{ r: p.r, c: p.c }]);
        C2.paintDrag = { id: L.id, last: null };
        composeStrokeTo(L, p, true);
      } else if (tool === 'line' || tool === 'border' || composeIsShapeTool(tool)) {
        // 直线/边框/几何图形都是「拖一个范围」：按下记起点，松手才落笔，中途画预览
        C2.shapeDrag = { id: L.id, tool: tool, from: p, to: p };
        drawCompose();
      } else if (tool === 'fill') {
        composeFillAt(L, p);
      } else if (tool === 'stamp') {
        C2.shapeDrag = null;
        composeStampAt(p);
      }
      return;
    }

    var hit = composeHitLayer(p.r, p.c, ev);
    if (!hit) {
      C2.selectBox = { from: p, to: p, additive: !!(ev.shiftKey || ev.metaKey), moved: false };
      drawCompose();
      return;
    }
    // Shift/Cmd 点击 = 加减选（用户需求⑤：可加选减选不同的主体成为新主体）
    if (ev.shiftKey || ev.metaKey) { composeSelectLayer(hit.id, true); return; }
    if (!cpIsSelected(hit.id)) C2.selected = [hit.id];
    if (hit.locked) {
      log('「' + hit.name + '」已固定，拖不动。要挪它先在图层列表里点「解固」。');
      renderComposeAll();
      return;
    }
    // 记下按下时的偏移与鼠标格，拖动时用差值 —— 这样不会因为取整而抖动
    C2.drag = {
      id: hit.id, startR: p.r, startC: p.c,
      baseOff: {},                      // 支持多选一起拖
      moved: false,
      snap: composeSnapState()          // 按下时的位置快照：松手后若真挪动了，用它当撤销点
    };
    composeMoveLinkedIds(C2.selected).forEach(function (id) {
      var la = cpLayerById(id);
      if (la && !la.locked) C2.drag.baseOff[id] = { r: la.offR, c: la.offC };
    });
    $('composeCv').classList.add('dragging');
    renderComposeAll();
  }

  /** 是否有任何一种拖拽正在进行。事件兜底的判断条件必须用它，漏掉哪一种就会有一类操作卡住。 */
  function composeDragging() {
    var C2 = cpS();
    return !!(C2.drag || C2.selectBox || C2.paintDrag || C2.shapeDrag);
  }

  function onComposeMouseMove(ev) {
    var C2 = cpS();
    if (!cpHasCanvas()) return;

    // 兜底：鼠标按键已经松开却还处于拖拽态，说明 mouseup 丢了
    // （最常见的是在浏览器窗口外松手，document 也收不到）。
    // 不兜的话涂色会变成「跟随鼠标一直画」，用户完全无法控制。
    // ev.buttons 是位掩码，0 = 没有任何键按下；不支持该属性的环境返回 undefined，此时不做判断。
    if (composeDragging() && ev && typeof ev.buttons === 'number' && ev.buttons === 0) {
      onComposeMouseUp();
      return;
    }

    var p = composeEventToCell(ev);

    // 连续涂色：把上一格到这一格连成线，否则快速拖动会留下断点
    if (C2.paintDrag) {
      var pl = cpLayerById(C2.paintDrag.id);
      if (pl) composeStrokeTo(pl, p, false);
      composeReadoutAt(p.r, p.c);
      return;
    }
    // 直线/边框的拖拽预览
    if (C2.shapeDrag) {
      C2.shapeDrag.to = p;
      drawCompose();
      composeReadoutAt(p.r, p.c);
      return;
    }
    if (C2.selectBox) {
      C2.selectBox.to = p;
      C2.selectBox.moved = C2.selectBox.moved || C2.selectBox.from.r !== p.r || C2.selectBox.from.c !== p.c;
      drawCompose();
      composeReadoutAt(p.r, p.c);
      return;
    }
    if (!C2.drag) { composeReadoutAt(p.r, p.c); return; }
    var dR = p.r - C2.drag.startR, dC = p.c - C2.drag.startC;
    if (dR === 0 && dC === 0) return;
    var changed = false;
    Object.keys(C2.drag.baseOff).forEach(function (id) {
      var la = cpLayerById(+id);
      if (!la) return;
      var b = C2.drag.baseOff[id];
      var nr = b.r + dR, nc = b.c + dC;
      if (la.offR !== nr || la.offC !== nc) { la.offR = nr; la.offC = nc; changed = true; }
    });
    if (changed) Object.keys(C2.drag.baseOff).forEach(function (id) {
      var la = cpLayerById(+id);
      if (la && la.parentId != null) composeSyncChildRelative(la);
    });
    if (changed) {
      C2.drag.moved = true;
      C2.lastAudit = null;
      drawCompose();
      composeReadoutAt(p.r, p.c);
    }
  }

  function onComposeMouseUp() {
    var C2 = cpS();
    $('composeCv').classList.remove('dragging');

    if (C2.paintDrag) {
      var n = C2.paintDrag.painted || 0;
      C2.paintDrag = null;
      if (n) log('涂色：' + n + ' 个像素');
      renderComposeAll();
      return;
    }
    if (C2.shapeDrag) {
      var sd = C2.shapeDrag;
      C2.shapeDrag = null;
      var L = cpLayerById(sd.id);
      if (!L) { renderComposeAll(); return; }
      var box = { r0: sd.from.r, c0: sd.from.c, r1: sd.to.r, c1: sd.to.c };
      if (sd.tool === 'line') {
        var cells = C.lineCells(sd.from.r, sd.from.c, sd.to.r, sd.to.c,
          composeBrushWidth(), C2.rows, C2.cols);
        var k = composeApplyCells(L, cells, composeBrushColor(), '画直线');
        if (k) {
          log('直线：从 行' + sd.from.r + ' 列' + sd.from.c + ' 到 行' + sd.to.r + ' 列' + sd.to.c +
            '，线宽 ' + composeBrushWidth() + ' 格，' + k + ' 个像素');
        }
      } else if (composeIsShapeTool(sd.tool)) {
        var shapeName = { rect: '矩形', ellipse: '椭圆', triangle: '三角形', diamond: '菱形' }[sd.tool] || sd.tool;
        var shapeCells = composeShapeCells(sd.tool, box);
        var n = composeApplyCells(L, shapeCells, composeBrushColor(),
          '画' + (composeShapeSolid() ? '实心' : '空心') + shapeName);
        if (n) {
          log(shapeName + '：' + (composeShapeSolid() ? '实心' : '空心（线宽 ' + composeBrushWidth() + ' 格）') +
            '，行 ' + Math.min(box.r0, box.r1) + '–' + Math.max(box.r0, box.r1) +
            ' 列 ' + Math.min(box.c0, box.c1) + '–' + Math.max(box.c0, box.c1) +
            '，' + n + ' 个像素');
        }
      } else {
        composeMakeBorder(box);
        return;      // composeMakeBorder 内部已经刷过面板
      }
      renderComposeAll();
      return;
    }

    if (C2.selectBox) {
      var sb = C2.selectBox;
      C2.selectBox = null;
      if (!sb.moved) {
        if (C2.selected.length) { C2.selected = []; renderComposeAll(); }
        return;
      }
      var r0 = Math.min(sb.from.r, sb.to.r), r1 = Math.max(sb.from.r, sb.to.r);
      var c0 = Math.min(sb.from.c, sb.to.c), c1 = Math.max(sb.from.c, sb.to.c);
      var picked = [];
      C2.layers.forEach(function (L) {
        if (!L || L.visible === false || L.selectable === false) return;
        var pl = C.composeLayerPlacement(L, C2.rows, C2.cols);
        var b = pl.bbox;
        if (!b) return;
        if (b.r1 < r0 || b.r0 > r1 || b.c1 < c0 || b.c0 > c1) return;
        picked.push(L.id);
      });
      if (sb.additive) {
        picked.forEach(function (id) {
          if (C2.selected.indexOf(id) < 0) C2.selected.push(id);
        });
      } else {
        C2.selected = picked;
      }
      log(picked.length ? ('框选：选中 ' + picked.length + ' 个图层') : '框选范围里没有可选图层');
      renderComposeAll();
      return;
    }

    if (!C2.drag) return;
    var moved = C2.drag.moved;
    var ids = Object.keys(C2.drag.baseOff);
    var dragSnap = C2.drag.snap;
    C2.drag = null;
    if (moved) {
      // 拖完才刷面板：拖动中只重绘画布，避免每帧重建两个列表（几十个图层时会明显卡）
      var la = ids.length === 1 ? cpLayerById(+ids[0]) : null;
      if (dragSnap) {
        // 撤销点用的是 mousedown 时拍的那份快照 —— 位置改动已经发生，事后再拍就晚了
        composePushStruct(dragSnap, '拖动' + (la ? '「' + la.name + '」' : ids.length + ' 个图层'));
      }
      renderComposeAll();
      var a = cpS().lastAudit;
      log('已移动 ' + (la ? '「' + la.name + '」到 行' + la.offR + ' 列' + la.offC : ids.length + ' 个图层') +
        (a ? '。当前覆盖提示 ' + a.conflictCount + ' 格' + (a.clipped ? '，被画布切掉 ' + a.clipped + ' 格' : '') : ''));
    }
  }

  /**
   * 手动涂色的一笔：把上一格连到这一格。
   * 必须连线而不是只涂当前格 —— 鼠标事件是离散采样的，快速拖动时相邻两次事件可能隔好几格，
   * 只涂当前格会留下一串断点。
   */
  function composeStrokeTo(L, p, first) {
    var C2 = cpS();
    var pd = C2.paintDrag;
    if (!pd) return;
    var w = composeBrushWidth();
    var cells = (first || !pd.last)
      ? C.lineCells(p.r, p.c, p.r, p.c, w, C2.rows, C2.cols)
      : C.lineCells(pd.last.r, pd.last.c, p.r, p.c, w, C2.rows, C2.cols);
    pd.last = { r: p.r, c: p.c };
    // 一笔之内只压一次撤销快照：拖一条长线应当一次撤回，而不是撤几十次
    var local = [];
    for (var i = 0; i < cells.length; i++) {
      var r = cells[i].r - L.offR, c = cells[i].c - L.offC;
      if (r < 0 || c < 0 || r >= L.blocks.length) continue;
      if (!L.blocks[r] || c >= L.blocks[r].length) continue;
      local.push({ r: r, c: c });
    }
    if (!local.length) return;
    if (!pd.pushed) { composePushUndo(L, '涂色'); pd.pushed = true; }
    var res = C.paintCells(L.blocks, local, composeBrushColor());
    if (!res.changed) return;
    L.blocks = res.blocks;
    pd.painted = (pd.painted || 0) + res.changed;
    C2.lastAudit = null;
    drawCompose();      // 拖动中只重绘画布，松手才刷面板
  }

  /** 填充：把点中的那一片同值区域换成当前颜色（用户需求⑥末段）。 */
  function composeFillAt(L, p) {
    var C2 = cpS();
    var r = p.r - L.offR, c = p.c - L.offC;
    if (r < 0 || c < 0 || r >= L.blocks.length || !L.blocks[r] || c >= L.blocks[r].length) {
      log('那一格不在「' + L.name + '」的范围内。想填整张画布上的空白，请选中一个和画布同大的图层' +
        '（「新建空白图层」建出来的就是）。');
      return;
    }
    var color = composeBrushColor();
    var res = C.fillRegion(L.blocks, r, c, color);
    if (!res.changed) {
      log('填充没有改变任何像素（点中的那一片本来就是这个颜色）');
      return;
    }
    composePushUndo(L, '填充');
    L.blocks = res.blocks;
    C2.lastAudit = null;
    var fromName = res.fromColor === 0 ? '空白' : window.AntSolver.getColorName(res.fromColor) + '(' + res.fromColor + ')';
    var toName = color === 0 ? '空白' : window.AntSolver.getColorName(color) + '(' + color + ')';
    log('填充：把「' + L.name + '」里与 行' + r + ' 列' + c + ' 相连的 ' + res.changed +
      ' 格' + fromName + ' 换成了' + toName + '。' +
      (res.fromColor === 0 ? '（若填出了预期范围，说明那片空白是连通的 —— 先把缺口封上再填）' : ''));
    renderComposeAll();
  }

  function composeReadoutAt(r, c) {
    var el = $('composeReadout');
    if (!el) return;
    var C2 = cpS();
    if (r < 0 || c < 0 || r >= C2.rows || c >= C2.cols) { el.textContent = '（在画布外）'; return; }
    var flat = C.composeFlatten(C2.layers, C2.rows, C2.cols);
    var v = flat[r][c];
    var owners = [];
    C.composeSortedLayers(C2.layers).forEach(function (entry) {
      var la = entry.layer;
      if (!la.visible) return;
      var rr = r - la.offR, cc = c - la.offC;
      if (rr < 0 || cc < 0 || rr >= la.blocks.length) return;
      var row = la.blocks[rr];
      if (!row || cc >= row.length || row[cc] <= 0) return;
      owners.push(la.name);
    });
    var topOwner = owners.length ? owners[owners.length - 1] : '';
    el.textContent = '行 ' + r + ' 列 ' + c + '　' +
      (v > 0 ? window.AntSolver.getColorName(v) + '(' + v + ')' : '空') +
      (owners.length > 1 ? '　⚠ ' + owners.length + ' 个图层重叠，最终输出来自「' + topOwner + '」：' + owners.join(' / ')
        : owners.length === 1 ? '　来自「' + owners[0] + '」' : '');
  }

  /* ---------- 图层操作（用户需求⑤：固定 / 单个图层编辑 / 层序） ---------- */

  function composeLayerAction(id, act) {
    var C2 = cpS();
    var i = C2.layers.findIndex(function (x) { return x.id === id; });
    if (i < 0) return;
    var L = C2.layers[i];
    switch (act) {
      case 'rename': {
        var nn = window.prompt ? window.prompt('图层新名字', L.name || '') : '';
        if (nn == null) return;
        nn = safeFileName(String(nn).trim());
        if (!nn) { log('图层名不能为空'); return; }
        if (nn === L.name) { log('图层名没有变化'); return; }
        composeSnapBefore('「' + L.name + '」改名为「' + nn + '」');
        L.name = nn;
        log('图层已改名为「' + L.name + '」');
        break;
      }
      case 'copy': {
        composeSnapBefore('复制「' + L.name + '」');
        var cp = {
          id: C2.nextId++, type: composeLayerType(L), name: (L.name || '图层') + '_副本',
          blocks: composeLayerCloneBlocks(L),
          rows: L.rows, cols: L.cols,
          offR: (L.offR | 0) + 1, offC: (L.offC | 0) + 1,
          locked: false, visible: true,
          selectable: L.selectable !== false,
          exportable: L.exportable !== false,
          source: L.source || '',
          rule: L.rule ? JSON.parse(JSON.stringify(L.rule)) : null,
          parentId: L.parentId,
          relOffR: L.relOffR,
          relOffC: L.relOffC
        };
        if (cp.parentId != null) {
          var pp = cpLayerById(cp.parentId);
          if (pp) { cp.relOffR = cp.offR - pp.offR; cp.relOffC = cp.offC - pp.offC; }
        }
        C2.layers.splice(i + 1, 0, cp);
        C2.selected = [cp.id];
        log('已复制「' + L.name + '」为「' + cp.name + '」');
        break;
      }
      case 'recolor': {
        var to = composeBrushColor();
        var changed = 0;
        var nb = composeLayerCloneBlocks(L);
        for (var rr = 0; rr < nb.length; rr++) for (var cc = 0; cc < nb[rr].length; cc++) {
          if (nb[rr][cc] <= 0 || nb[rr][cc] === to) continue;
          nb[rr][cc] = to;
          changed++;
        }
        if (!changed) {
          log('「' + L.name + '」没有需要替换的非空像素。');
        } else {
          // 先算清要改多少格再压撤销点 —— 没有改动就不该留一步空撤销
          composePushUndo(L, '「' + L.name + '」整体换色');
          L.blocks = nb;
          log('已把「' + L.name + '」的 ' + changed + ' 个非空像素换成 ' +
            (to === 0 ? '空白(0)' : composeColorLabel(to)) + '。');
        }
        break;
      }
      case 'top': {
        if (i !== C2.layers.length - 1) {
          composeSnapBefore('「' + L.name + '」置顶');
          C2.layers.splice(i, 1);
          C2.layers.push(L);
          log('「' + L.name + '」已置于最上层；若与下方图层重叠，最终输出取它的像素 id。');
        } else log('「' + L.name + '」已经是最上层');
        break;
      }
      case 'bottom': {
        if (i !== 0) {
          composeSnapBefore('「' + L.name + '」置底');
          C2.layers.splice(i, 1);
          C2.layers.unshift(L);
          log('「' + L.name + '」已置于最下层');
        } else log('「' + L.name + '」已经是最下层');
        break;
      }
      case 'lock':
        composeSnapBefore('「' + L.name + '」' + (L.locked ? '解固' : '固定'));
        L.locked = !L.locked;
        log('「' + L.name + '」' + (L.locked ? '已固定（拖不动，防止误碰）' : '已解固'));
        break;
      case 'hide':
        composeSnapBefore('「' + L.name + '」' + (L.visible ? '隐藏' : '显示'));
        L.visible = !L.visible;
        log('「' + L.name + '」' + (L.visible ? '已显示' : '已隐藏（不参与覆盖提示也不会出现在导出结果里）'));
        break;
      case 'del':
        // 先把要一起移除的子图层找出来（数量要写进日志与撤销点），再动手删。
        // 原先是一边遍历一边 splice，撤销点只能事后补 —— 那样数据已经变了，撤不回去。
        var removedChildren = [];
        var removedChildIds = {};
        if (composeLayerType(L) === 'subject') {
          for (var ci = C2.layers.length - 1; ci >= 0; ci--) {
            if (C2.layers[ci] && C2.layers[ci].parentId === id) {
              removedChildIds[C2.layers[ci].id] = true;
              removedChildren.push(C2.layers[ci].name);
            }
          }
        }
        composeSnapBefore('从画布移除「' + L.name + '」' +
          (removedChildren.length ? '（连子图层 ' + removedChildren.length + ' 个）' : ''));
        for (var di = C2.layers.length - 1; di >= 0; di--) {
          if (C2.layers[di] && removedChildIds[C2.layers[di].id]) {
            C2.layers.splice(di, 1);
            if (di < i) i--;
          }
        }
        C2.layers.splice(i, 1);
        C2.selected = C2.selected.filter(function (x) { return x !== id && !removedChildIds[x]; });
        log('已从画布移除「' + L.name + '」' +
          (removedChildren.length ? '，并移除它的子图层 ' + removedChildren.length + ' 个' : '') +
          '（部件列表里还在，可以重新放；点错了按 Ctrl/⌘+Z 退回）');
        break;
      case 'up':
        if (i < C2.layers.length - 1) {
          composeSnapBefore('「' + L.name + '」上移一层');
          C2.layers[i] = C2.layers[i + 1]; C2.layers[i + 1] = L;
          log('「' + L.name + '」上移一层（越上层越后画，重叠时盖住下面的）');
        } else { log('「' + L.name + '」已经在最上层'); }
        break;
      case 'down':
        if (i > 0) {
          composeSnapBefore('「' + L.name + '」下移一层');
          C2.layers[i] = C2.layers[i - 1]; C2.layers[i - 1] = L;
          log('「' + L.name + '」下移一层');
        } else { log('「' + L.name + '」已经在最下层'); }
        break;
      case 'center': {
        var pl = C.composeLayerPlacement(L, C2.rows, C2.cols);
        var bb = C.bboxOfBlocks(L.blocks);
        if (!bb) { log('这个图层是空图，没法居中'); break; }
        composeSnapBefore('「' + L.name + '」居中');
        L.offR = Math.round((C2.rows - bb.rows) / 2) - bb.r0;
        L.offC = Math.round((C2.cols - bb.cols) / 2) - bb.c0;
        if (L.parentId != null) composeSyncChildRelative(L);
        log('「' + L.name + '」已居中到 行' + L.offR + ' 列' + L.offC);
        break;
      }
    }
    C2.lastAudit = null;
    renderComposeAll();
  }

  /** 方向键微调选中图层（像素级定位靠鼠标拖很难精确，这一步是必需的）。 */
  function composeNudge(dR, dC) {
    var C2 = cpS();
    if (!C2.active || !cpHasCanvas() || !C2.selected.length) return false;
    var ids = composeMoveLinkedIds(C2.selected).filter(function (id) {
      var L = cpLayerById(id);
      return !!L && !L.locked;
    });
    if (!ids.length) { log('选中的图层都被固定了，先解固再挪'); return true; }
    // 连按方向键只算一步撤销（同一个 key、1.5 秒内并入上一步），否则挪 20 格要撤 20 次
    composeSnapBefore('方向键微调 ' + ids.length + ' 个图层', 'nudge:' + ids.join(','), 1500);
    ids.forEach(function (id) {
      var L = cpLayerById(id);
      if (!L) return;
      L.offR += dR; L.offC += dC;
      if (L.parentId != null) composeSyncChildRelative(L);
    });
    C2.lastAudit = null;
    renderComposeAll();
    return true;
  }

  /* ---------- 出图（用户 2026-09-18 口径：顶层像素输出） ----------
   *
   * 重叠不再阻止导出；只提示“最终只输出最顶层的像素 id”。
   * 真正阻断的是越界、完全在画布外、空图，以及用户勾选时的背景空洞。
   */

  /** 体检并把结果写进面板。返回 audit 供调用方决定要不要继续。 */
  function composeRunAudit(verbose) {
    var C2 = cpS();
    var box = $('composeAuditInfo');
    if (!cpHasCanvas()) {
      if (box) box.innerHTML = '<div class="muted">还没有画布</div>';
      return null;
    }
    var a = C.composeAudit(C2.layers, C2.rows, C2.cols);
    C2.lastAudit = a;
    var lines = [];
    lines.push('<div class="kvRow"><span>画布</span><b>' + a.rows + '×' + a.cols + '</b></div>');
    lines.push('<div class="kvRow"><span>可见图层</span><b>' + a.visibleLayers + '</b></div>');
    lines.push('<div class="kvRow"><span>实际非空像素</span><b>' + a.pixelActual + '</b></div>');
    lines.push('<div class="kvRow"><span>用色</span><b>' + a.colorCount + ' 种</b>（不含空位 0）</div>');
    lines.push('<div class="kvRow"><span>背景空洞</span><b style="color:' +
      (a.backgroundHoles ? '#b06000' : '#2f8652') + '">' + a.backgroundHoles + ' 格</b>' +
      (composeRequireBackground() ? '（当前要求填满）' : '（仅提示）') + '</div>');

    var problems = [], warnings = [];
    if (a.conflictCount) {
      // 点名是哪两个部件发生覆盖 —— 不阻止导出，但要让用户知道最终取最顶层像素。
      var pairTxt = Object.keys(a.conflicts.pairs).map(function (k) {
        var ij = k.split('-').map(Number);
        var n1 = C2.layers[ij[0]] ? C2.layers[ij[0]].name : '?';
        var n2 = C2.layers[ij[1]] ? C2.layers[ij[1]].name : '?';
        return '「' + n1 + '」×「' + n2 + '」' + a.conflicts.pairs[k] + ' 格';
      }).join('；');
      warnings.push('<div class="kvRow"><span style="color:#b06000">覆盖提示</span><b style="color:#b06000">' +
        a.conflictCount + ' 格</b>（不阻止导出，只输出最顶层的像素 id）</div>' +
        '<div class="hint" style="margin:2px 0 4px">' + escHtml(pairTxt) + '</div>');
    }
    if (a.clipped) {
      warnings.push('<div class="kvRow"><span style="color:#b06000">画布外裁切</span><b style="color:#b06000">' +
        a.clipped + ' 格</b>（不阻止导出，TXT 只输出当前画布内的像素）</div>');
    }
    if (a.layersFullyOutside.length) {
      warnings.push('<div class="kvRow"><span style="color:#b06000">完全在画布外</span><b style="color:#b06000">' +
        a.layersFullyOutside.map(function (i) {
          return C2.layers[i] ? C2.layers[i].name : '?';
        }).join('、') + '</b>（不阻止导出，但这些图层不会出现在 TXT 里）</div>');
    }
    if (composeRequireBackground() && a.backgroundHoles) {
      problems.push('<div class="kvRow"><span style="color:#b3261e">背景未填满</span><b style="color:#b3261e">' +
        a.backgroundHoles + ' 格空位</b>（生成背景或手动填补后再出图）</div>');
    }
    if (!a.pixelActual) problems.push('<div class="kvRow"><span style="color:#b3261e">画布是空的</span><b>—</b></div>');

    if (problems.length) {
      lines.push('<div class="kvRow"><span>能否出图</span><b style="color:#b3261e">不能</b></div>');
      lines = lines.concat(warnings);
      lines = lines.concat(problems);
    } else {
      lines.push('<div class="kvRow"><span>能否出图</span><b style="color:#2f8652">可以</b></div>');
      lines = lines.concat(warnings);
    }
    if (box) box.innerHTML = lines.join('');

    if (verbose) {
      if (a.ok && (!composeRequireBackground() || a.backgroundHoles === 0)) {
        log('✅ 输出检查通过：当前画布内共 ' + a.pixelActual + ' 个非空像素，可以出图。' +
          (a.conflictCount ? '其中 ' + a.conflictCount + ' 格有重叠，导出只输出最顶层的像素 id。' : '') +
          (a.clipped ? '另有 ' + a.clipped + ' 格在画布外，导出时会自动裁切。' : '') +
          (a.layersFullyOutside.length ? '有 ' + a.layersFullyOutside.length + ' 个图层完全在画布外，不会进入 TXT。' : ''));
      } else {
        var msg = ['❌ 还不能出图：'];
        if (composeRequireBackground() && a.backgroundHoles) msg.push('还有 ' + a.backgroundHoles + ' 格背景空洞（生成背景或手动填满）');
        if (!a.pixelActual) msg.push('画布上没有任何像素');
        log(msg.join('；') + '。' +
          (a.conflictCount ? '另有 ' + a.conflictCount + ' 格重叠，这不会阻止导出，最终只取最顶层像素。' : '') +
          (a.clipped ? '另有 ' + a.clipped + ' 格在画布外，会在导出时自动裁切。' : ''));
      }
    }
    syncComposeButtons();
    return a;
  }

  function composeRenderFinalPreview(forceShow) {
    var box = $('composeFinalPreview');
    if (!box) return;
    var C2 = cpS();
    if (forceShow) C2.finalPreviewVisible = true;
    if (!C2.finalPreviewVisible) {
      box.innerHTML = '<div class="muted">点「最终效果图」查看无高光、无描边的真实输出结果。</div>';
      return;
    }
    if (!cpHasCanvas()) {
      box.innerHTML = '<div class="muted">还没有画布</div>';
      return;
    }
    var flat = C.composeFlatten(C2.layers, C2.rows, C2.cols);
    var st = composeLayerColorStats(flat);
    var px = Math.max(2, Math.min(12, Math.floor(360 / Math.max(C2.rows, C2.cols))));
    var rows = st.rows.map(function (id) {
      var cnt = st.counts[id] || 0;
      var pct = st.total ? (cnt / st.total * 100).toFixed(1) : '0.0';
      var sw = id > 0
        ? '<i class="sw2" style="background:' + window.AntSolver.getColorCSS(id) + '"></i>'
        : '<i class="sw2 emptySw"></i>';
      return '<div class="colorStatRow">' + sw +
        '<span>' + (id > 0 ? window.AntSolver.getColorName(id) : '空白') + '(' + id + ')</span>' +
        '<b>' + cnt + '</b><em>' + pct + '%</em></div>';
    }).join('');
    box.innerHTML =
      '<div class="finalPreviewHead">' +
      '<b>最终效果图</b><span>按底到顶合成；重叠格只输出最顶层像素 id</span>' +
      '<button id="btnComposeFinalHide" class="miniBtn">收起</button></div>' +
      '<canvas id="composeFinalCv" class="finalPreviewCanvas" width="' + (C2.cols * px) +
      '" height="' + (C2.rows * px) + '"></canvas>' +
      '<div class="kvRow"><span>非空像素</span><b>' + st.nonZero + '</b></div>' +
      '<div class="kvRow"><span>空白 0</span><b>' + st.empty + '</b></div>' +
      '<div class="colorStatList">' + rows + '</div>';
    var cv = $('composeFinalCv');
    if (cv) {
      var ctx = cv.getContext('2d');
      composePaintChecker(ctx, cv.width, cv.height, px);
      for (var r = 0; r < flat.length; r++) for (var c = 0; c < flat[r].length; c++) {
        var v = flat[r][c];
        if (v <= 0) continue;
        ctx.fillStyle = window.AntSolver.getColorCSS(v);
        ctx.fillRect(c * px, r * px, px, px);
      }
    }
    var hide = $('btnComposeFinalHide');
    if (hide) hide.onclick = function () {
      C2.finalPreviewVisible = false;
      composeRenderFinalPreview(false);
    };
  }

  function composeSparseBuildScan() {
    var threshold = composeSparseThreshold();
    var finalState = composeFinalState();
    var stats = composeLayerColorStats(finalState.blocks);
    var groups = [];
    stats.rows.forEach(function (id) {
      var cnt = stats.counts[id] || 0;
      if (id > 0 && cnt > 0 && cnt < threshold) {
        groups.push({ id: id, count: cnt, pct: stats.total ? (cnt / stats.total * 100) : 0 });
      }
    });
    groups.sort(function (a, b) { return a.count - b.count || a.id - b.id; });
    return { threshold: threshold, finalState: finalState, stats: stats, groups: groups };
  }

  function composeSparseSamples(finalState, colorId, max) {
    var out = [], total = 0;
    var blocks = finalState && finalState.blocks;
    for (var r = 0; r < (blocks || []).length; r++) for (var c = 0; c < blocks[r].length; c++) {
      if (blocks[r][c] !== colorId) continue;
      total++;
      if (out.length < max) out.push('行' + r + '列' + c);
    }
    return { total: total, samples: out };
  }

  function composeRenderSparseScan(scan) {
    var info = $('composeSparseInfo'), list = $('composeSparseList');
    if (!info || !list) return;
    var colorCount = scan.stats.rows.filter(function (id) { return id > 0; }).length;
    info.innerHTML =
      '<div class="kvRow"><span>检查口径</span><b>最终导出图</b>（重叠只看最顶层像素）</div>' +
      '<div class="kvRow"><span>筛选阈值</span><b>少于 ' + scan.threshold + ' 格</b></div>' +
      '<div class="kvRow"><span>非空像素 / 颜色数</span><b>' + scan.stats.nonZero + ' / ' + colorCount + '</b></div>' +
      '<div class="kvRow"><span>命中颜色</span><b>' + scan.groups.length + ' 个</b></div>';
    list.innerHTML = '';
    if (!scan.groups.length) {
      list.innerHTML = '<div class="item muted">没有低于当前阈值的非空颜色。</div>';
      return;
    }
    scan.groups.forEach(function (g) {
      var pos = composeSparseSamples(scan.finalState, g.id, 8);
      var row = document.createElement('div');
      row.className = 'item sparseColorRow' + (cpS().sparseColorId === g.id ? ' active' : '');
      var sw = document.createElement('i');
      sw.className = 'sw2';
      sw.style.background = window.AntSolver.getColorCSS(g.id);
      row.appendChild(sw);
      var txt = document.createElement('div');
      txt.className = 'grow';
      txt.innerHTML = '<b>' + escHtml(composeColorLabel(g.id)) + '</b>　' +
        g.count + ' 格　' + g.pct.toFixed(2) + '%' +
        '<div class="muted">位置示例：' + escHtml(pos.samples.join('、') || '无') +
        (pos.total > pos.samples.length ? ' 等 ' + pos.total + ' 格' : '') + '</div>';
      row.appendChild(txt);
      var hi = document.createElement('button');
      hi.className = 'miniBtn';
      hi.textContent = '高亮';
      hi.title = '在拼接画布上高亮最终图里这个颜色的位置';
      hi.onclick = function () { composeHighlightSparseColor(g.id); };
      row.appendChild(hi);
      var rep = document.createElement('button');
      rep.className = 'miniBtn';
      rep.textContent = '换成当前色';
      rep.title = '把最终图里这个颜色的位置替换为当前画笔颜色；重叠处只改最终可见的顶层像素';
      rep.onclick = function () { composeReplaceSparseColor(g.id); };
      row.appendChild(rep);
      list.appendChild(row);
    });
  }

  function composeRunSparseCheck() {
    if (!cpHasCanvas()) {
      var info = $('composeSparseInfo'), list = $('composeSparseList');
      if (info) info.innerHTML = '<div class="muted">还没有画布</div>';
      if (list) list.innerHTML = '';
      return;
    }
    var scan = composeSparseBuildScan();
    cpS().sparseScan = scan;
    if (cpS().sparseColorId != null && !(scan.stats.counts[cpS().sparseColorId] > 0)) cpS().sparseColorId = null;
    composeRenderSparseScan(scan);
    drawCompose();
    log('稀少颜色检查完成：阈值少于 ' + scan.threshold + ' 格，命中 ' + scan.groups.length +
      ' 个颜色（按最终导出图统计）。');
  }

  function composeHighlightSparseColor(colorId) {
    cpS().sparseColorId = +colorId;
    if (cpS().sparseScan) composeRenderSparseScan(cpS().sparseScan);
    drawCompose();
    log('已高亮稀少颜色 ' + composeColorLabel(colorId) + ' 的最终输出位置。');
  }

  function composeClearSparseHighlight() {
    cpS().sparseColorId = null;
    if (cpS().sparseScan) composeRenderSparseScan(cpS().sparseScan);
    drawCompose();
    log('稀少颜色高亮已清除。');
  }

  function composeReplaceSparseColor(colorId) {
    if (!cpHasCanvas()) { log('先新建画布'); return; }
    var target = composeBrushColor();
    colorId = +colorId;
    if (target === colorId) {
      log('当前画笔颜色已经是 ' + composeColorLabel(colorId) + '，不需要替换。');
      return;
    }
    var C2 = cpS();
    var finalState = composeFinalState();
    var touched = {}, touchedList = [], edits = [], locked = 0, missing = 0;
    for (var r = 0; r < finalState.blocks.length; r++) for (var c = 0; c < finalState.blocks[r].length; c++) {
      if (finalState.blocks[r][c] !== colorId) continue;
      var owner = finalState.owners[r][c];
      if (!owner) { missing++; continue; }
      var L = cpLayerById(owner.id);
      if (!L) { missing++; continue; }
      if (L.locked) { locked++; continue; }
      if (L.blocks[owner.r] && L.blocks[owner.r][owner.c] === colorId) {
        if (!touched[L.id]) {
          touched[L.id] = L;
          touchedList.push(L);
        }
        edits.push({ layer: L, r: owner.r, c: owner.c });
      }
    }
    if (!edits.length) {
      log('没有替换任何像素：' +
        (locked ? locked + ' 格在固定图层上，先给对应图层点「解固」。' : '') +
        (missing ? '另有 ' + missing + ' 格找不到可改图层。' : ''));
      return;
    }
    composePushMultiUndo(touchedList, '稀少颜色替换 ' + composeColorLabel(colorId));
    // 按图层分组后**整体换新数组**再写回（原先逐格原地改 —— 那样旧数组会被就地改写，
    // 撤销点里存着的引用就跟着变了，等于撤不回去。paintCells 是复制后改，正好用它。）
    var byLayer = {};
    edits.forEach(function (e) {
      var key = String(e.layer.id);
      if (!byLayer[key]) byLayer[key] = { L: e.layer, cells: [] };
      byLayer[key].cells.push({ r: e.r, c: e.c });
    });
    Object.keys(byLayer).forEach(function (key) {
      var g = byLayer[key];
      var painted = C.paintCells(g.L.blocks, g.cells, target);
      g.L.blocks = painted.blocks;
    });
    C2.lastAudit = null;
    C2.sparseColorId = target > 0 ? target : null;
    log('已把最终图里的 ' + edits.length + ' 格 ' + composeColorLabel(colorId) +
      ' 替换为 ' + composeColorLabel(target) + '。' +
      (locked ? '有 ' + locked + ' 格在固定图层上未改；先解固后可再替换。' : '') +
      (missing ? '有 ' + missing + ' 格未找到源图层。' : ''));
    renderComposeAll();
    composeRunSparseCheck();
  }

  /** 出图前的统一关卡：不合法就拦下并说清怎么改。返回 null 表示被拦。 */
  function composeGateForExport(what) {
    var a = composeRunAudit(false);
    if (!a) { log('先新建画布'); return null; }
    if (a.ok && (!composeRequireBackground() || a.backgroundHoles === 0)) return a;
    log('⛔ 已阻止' + what + '：最终图为空或背景未填满。重叠和画布外裁切不会阻止导出；' +
      '重叠只输出最顶层像素，画布外部分会自动裁切。点「检查输出」看具体问题。');
    composeRunAudit(true);
    return null;
  }

  function composeExportTxt() {
    var C2 = cpS();
    var a = composeGateForExport('导出');
    if (!a) return;
    var flat = C.composeFlatten(C2.layers, C2.rows, C2.cols);
    var nm = safeFileName(($('inComposeName').value || '').trim() ||
      ('拼接_' + C2.rows + 'x' + C2.cols + '_' + C2.layers.length + '主体_' + exportStamp()));
    download(nm + '.txt', new Blob([C.serializeTxt(flat)], { type: 'text/plain;charset=utf-8' }));
    log('已导出「' + nm + '.txt」：' + C2.rows + '×' + C2.cols + '，' +
      a.visibleLayers + ' 个可见图层，' + a.pixelActual + ' 个非空像素。' +
      (a.conflictCount ? '有 ' + a.conflictCount + ' 格重叠，已按最顶层像素 id 输出。' : '') +
      (a.clipped ? '有 ' + a.clipped + ' 格超出画布，已在导出时裁切。' : '') +
      (a.layersFullyOutside.length ? '有 ' + a.layersFullyOutside.length + ' 个图层完全在画布外，未写入 TXT。' : '') +
      '空位是 0，可以直接再导入回本工具或交给生产侧。');
  }

  function composeToLib() {
    var C2 = cpS();
    var a = composeGateForExport('存入图纸库');
    if (!a) return;
    var flat = C.composeFlatten(C2.layers, C2.rows, C2.cols);
    var base = safeFileName(($('inComposeName').value || '').trim() ||
      ('拼接_' + C2.layers.length + '主体'));
    var nm = base, k = 2;
    while ((S.pieceLib || []).some(function (p) { return p && p.key === nm; })) { nm = base + '_' + k; k++; }
    var piece;
    try {
      piece = C.toArtPiece(flat, {
        key: nm,
        sourceName: '拼接：' + C2.layers.map(function (L) { return L.name; }).join(' + '),
        ops: C2.layers.map(function (L) {
          return { piece: L.name, offR: L.offR, offC: L.offC };
        }),
        note: '由拼接工作台合成，' + a.visibleLayers + ' 个主体'
      });
    } catch (e) { log('存入图纸库失败：' + (e && e.message)); return; }
    S.pieceLib.push(piece);
    savePieceLib();
    renderPieceLib();
    log('已把拼接结果存入图纸库：「' + nm + '」' + piece.rows + '×' + piece.cols +
      '，' + piece.pixelCount + ' 格。' +
      (a.conflictCount ? '其中重叠格已按最顶层像素 id 入库。' : '') +
      (a.clipped ? '其中 ' + a.clipped + ' 格超出画布，已按画布边界裁切。' : '') +
      (a.layersFullyOutside.length ? '有 ' + a.layersFullyOutside.length + ' 个图层完全在画布外，未入库。' : '') +
      '它现在也能当部件再拿来拼（在部件列表里点「从图纸库全部添加」）。');
    renderComposeAll();
  }

  /** 把选中的多个图层合并成一个新主体（用户需求⑤：可加选减选不同的主体成为新主体）。 */
  function composeMergeSelected() {
    var C2 = cpS();
    if (C2.selected.length < 2) {
      log('先选中 2 个以上图层再合并（在图层列表里按住 Shift/Cmd 点，或在画布上 Shift 点击）');
      return;
    }
    var idxs = [];
    C2.selected.forEach(function (id) {
      var i = C2.layers.findIndex(function (x) { return x.id === id; });
      if (i >= 0) idxs.push(i);
    });
    idxs.sort(function (a, b) { return a - b; });     // 保持原层序，合并结果的覆盖关系才与画面一致
    // 合并前先看这几个之间有没有冲突：有冲突说明它们本来就叠着，
    // 合并后被盖住的像素会真的消失（不再是「暂时被挡住」），必须先说清楚。
    var picked = idxs.map(function (i) { return C2.layers[i]; });
    var cf = C.composeConflicts(picked, C2.rows, C2.cols);
    var res;
    try {
      res = C.composeMergeLayers(C2.layers, idxs, C2.rows, C2.cols);
    } catch (e) { log('合并失败：' + (e && e.message)); return; }
    var names = picked.map(function (L) { return L.name; });
    var newName = names.join('+');
    // 撤销点必须在删除原图层之前拍：合并会真的删掉那几个图层对象在清单里的位置
    // 移除被合并的（从后往前删，避免下标错位），插入合并结果到最上层
    composeSnapBefore('合并 ' + names.length + ' 个图层为新主体「' + newName + '」');
    for (var i = idxs.length - 1; i >= 0; i--) C2.layers.splice(idxs[i], 1);
    var merged = {
      id: C2.nextId++, type: 'subject', name: newName, blocks: res.blocks,
      rows: res.rows, cols: res.cols, offR: 0, offC: 0, locked: false, visible: true
    };
    C2.layers.push(merged);
    C2.selected = [merged.id];
    C2.lastAudit = null;
    log('已把 ' + names.length + ' 个图层合并成一个新主体「' + newName + '」（' +
      res.pixelCount + ' 格）。' +
      (cf.count ? '⚠ 它们之间原有 ' + cf.count + ' 格重叠，合并后被盖住的像素已**真的丢掉**（不再能拖开恢复）。' : '') +
      '合并后的部件尺寸是画布尺寸 ' + res.rows + '×' + res.cols + '，偏移归零 —— ' +
      '因为多个部件的相对位置只有在画布坐标系里才有意义。');
    renderComposeAll();
  }

  /* ---------- 在图层上画（用户需求⑥：涂色 / 直线 / 边框 / 填充） ----------
   *
   * 编辑对象是**当前选中的单个图层**（用户需求⑤原话「单个图层编辑」）。
   * 所有绘制都改那个图层的 blocks，并记一次整层快照供撤销 ——
   * 直线和边框一次动几十上百格，逐格记反而更大。
   *
   * 想凭空画新东西（自制边框）就先「新建空白图层」，它就是画布尺寸的全 0 图层。
   */

  function composeTool() {
    var el = document.querySelector('input[name="composeTool"]:checked');
    return el ? el.value : 'move';
  }
  function composeBrushWidth() {
    var v = parseInt(($('inComposeWidth') || {}).value, 10);
    return isFinite(v) && v > 0 ? v : 1;
  }
  /** 几何图形是否实心。默认勾选；取消勾选就是空心，粗细走 composeBrushWidth()。 */
  function composeShapeSolid() {
    var el = $('optComposeShapeSolid');
    return !el || !!el.checked;
  }
  function composeIsShapeTool(tool) {
    return (C.SHAPE_KINDS || []).indexOf(tool) >= 0;
  }
  /** 拖出来的范围 → 几何图形的格坐标。 */
  function composeShapeCells(tool, box) {
    var C2 = cpS();
    return C.shapeCells(tool, box, composeBrushWidth(), composeShapeSolid(), C2.rows, C2.cols);
  }
  /** 画笔颜色：勾了橡皮擦就是 0（擦成空），否则用美术编辑那边选中的颜色（同一套色库，不另存一份）。 */
  function composeBrushColor() {
    if ($('optComposeErase') && $('optComposeErase').checked) return 0;
    return S.edit.color;
  }
  function composeRequireBackground() {
    var el = $('optComposeRequireBg');
    return !!(el && el.checked);
  }
  /** 当前唯一选中的图层；绘制类操作要求恰好选中一个，否则说不清画到哪去。 */
  function composeTargetLayer(quiet) {
    var C2 = cpS();
    if (C2.selected.length !== 1) {
      if (!quiet) {
        log(C2.selected.length === 0
          ? '先选中一个图层再画（点画布上的部件，或点图层列表里的名字）。想凭空画就点「新建空白图层」。'
          : '选中了 ' + C2.selected.length + ' 个图层 —— 画的时候只能选一个，说不清该画到哪个上面。');
      }
      return null;
    }
    var L = cpLayerById(C2.selected[0]);
    if (L && L.locked) {
      if (!quiet) log('「' + L.name + '」已固定，不能在上面画。先点「解固」。');
      return null;
    }
    return L;
  }

  /**
   * 拿一个「现在就能往上画」的图层；没有就**自动准备好**。
   * （用户 2026-09-15 追加要求：「手动涂色/直线/填充/边框等功能需要能在空白画布上直接可操作」）
   *
   * 原先的做法是：没选图层就拒绝，让用户先去点「新建空白图层」。
   * 但在一张空白画布上「先建图层再画」是纯粹的手续 —— 用户的意图明摆着是「在这张画布上画」。
   * 所以这里分三种情况区别对待，而不是一律自动建：
   *
   *   1. 没有任何可画图层（画布空的，或一个都没选中）→ **自动建一张画布尺寸的空白图层**并选中。
   *      建完就选中，所以后续每一笔都落在同一张上，不会每画一笔多出一个图层。
   *   2. 选中的图层被**固定** → 仍然拒绝。用户明确锁了它，说明是有意保护，
   *      这时自动新建会让他以为画上去了却找不到。
   *   3. 选中了**多个** → 仍然拒绝。意图明确指向若干已有图层，自动新建只会更乱。
   */
  function composeEnsureDrawTarget() {
    var C2 = cpS();
    if (!cpHasCanvas()) return null;               // 画布本身的缺失由调用方处理（它要给出更具体的提示）
    if (C2.selected.length === 1) {
      var L = cpLayerById(C2.selected[0]);
      if (L && L.locked) {
        log('「' + L.name + '」已固定，不能在上面画。先在图层列表点「解固」，或点「新建空白图层」另起一层。');
        return null;
      }
      if (L) return L;
    }
    if (C2.selected.length > 1) {
      log('选中了 ' + C2.selected.length + ' 个图层 —— 画的时候只能选一个，说不清该画到哪个上面。' +
        '先点一个图层的名字单选它。');
      return null;
    }
    // 到这里 = 没有任何选中的图层。直接备好一张能画的空白层。
    composeNewBlankLayer(true);
    var made = C2.layers[C2.layers.length - 1];
    return (made && !made.locked) ? made : null;
  }

  /* ---------- 撤销 / 重做（2026-10-16 追加：拼接里的操作要能一步步退回） ----------
   *
   * 拼接里的操作分两类，记录方式必须不一样：
   *
   * ① **像素类**（手动涂色 / 直线 / 边框 / 填充 / 图层换色 / 稀少颜色替换）
   *    只改某几个图层的 blocks，别的一律没动 → 记「整层像素快照」最省事。
   *    （一次直线/边框动几十上百格，逐格记反而更大。）
   *
   * ② **结构类**（放上部件 / 从部件列表移除 / 生成背景·包围 / 新建或清空画布 /
   *    新建空白图层 / 复制·移除·合并图层 / 改层序 / 拖动与方向键移动 / 改名 / 固定·隐藏 /
   *    导入部件 …）
   *    动的是**图层清单本身**（增、删、换序）与各图层的几个字段 —— 这种操作**没法**
   *    靠整层像素快照退回：新加的图层不在旧快照里，被删掉的图层更不在。
   *    所以这类操作记一份「结构快照」：图层对象的**引用** + 当次的位置/名字/固定隐藏等字段值。
   *
   * 为什么结构快照只存引用、不复制像素：本模块里图层的 blocks 一律是「换成新数组」而不是
   * 原地改（`core.js` 的 paintCells / fillRegion 都返回新数组，app.js 里各绘制入口都写成
   * `L.blocks = …`），所以旧引用永远指着改动之前的那份内容。原先唯一一处原地改像素
   * （稀少颜色替换）已改成一并走「复制后再写」。这样一份结构快照只有几十个字段，
   * 留几十步也占不了多少内存。
   *
   * 撤销时按栈顶条目的类型分别还原；每撤销一步，都会把「撤销前的当前状态」压进重做栈，
   * 所以 Ctrl/Cmd+Z 退回几步后还能用 Ctrl/Cmd+Shift+Z（或 Ctrl+Y）走回来。
   */

  var CP_HISTORY_MAX = 60;      // 结构快照很轻，留得比像素快照多些
  var CP_PIXEL_MAX = 40;        // 像素快照沿用原来的步数上限（整层数组较大）

  /** 当前拼接状态的结构快照（不含像素内容，见上面的说明）。 */
  function composeSnapState() {
    var C2 = cpS();
    return {
      rows: C2.rows, cols: C2.cols, nextId: C2.nextId,
      selected: (C2.selected || []).slice(),
      sources: (C2.sources || []).slice(),
      lastBorder: C2.lastBorder || null,
      layers: (C2.layers || []).map(function (L) {
        return {
          ref: L, id: L.id, name: L.name, type: L.type,
          rows: L.rows, cols: L.cols, offR: L.offR, offC: L.offC,
          relOffR: L.relOffR, relOffC: L.relOffC,
          locked: !!L.locked, visible: L.visible !== false,
          selectable: L.selectable, exportable: L.exportable,
          parentId: L.parentId, source: L.source,
          rule: L.rule ? JSON.parse(JSON.stringify(L.rule)) : L.rule
        };
      })
    };
  }

  /**
   * 把结构快照写回当前状态。
   * 图层对象是复用同一批（引用），所以这里要把名字/位置/固定隐藏这些字段**逐个写回** ——
   * 它们在快照之后被原地改过（拖动、改名、固定…），不能只恢复数组顺序。
   */
  function composeRestoreState(s) {
    var C2 = cpS();
    C2.rows = s.rows; C2.cols = s.cols; C2.nextId = s.nextId;
    C2.sources = (s.sources || []).slice();
    C2.lastBorder = s.lastBorder || null;
    C2.layers = (s.layers || []).map(function (d) {
      var L = d.ref;
      L.id = d.id; L.name = d.name; L.type = d.type;
      L.rows = d.rows; L.cols = d.cols;
      L.offR = d.offR; L.offC = d.offC;
      L.relOffR = d.relOffR; L.relOffC = d.relOffC;
      L.locked = d.locked; L.visible = d.visible;
      L.selectable = d.selectable; L.exportable = d.exportable;
      L.parentId = d.parentId; L.source = d.source;
      L.rule = d.rule ? JSON.parse(JSON.stringify(d.rule)) : d.rule;
      return L;
    });
    C2.selected = (s.selected || []).slice();
    // 拖拽 / 框选 / 画笔这类「进行中」的临时态与历史无关，撤销后一律清掉，
    // 免得半截交互残留在画布上（比如画到一半的预览线）。
    C2.drag = C2.selectBox = C2.paintDrag = C2.shapeDrag = C2.hitCycle = null;
    C2.lastAudit = null;
  }

  /** 压一个撤销点（结构快照）。coalesceKey 用于把连续的小动作并成一步（方向键微调）。 */
  function composePushStruct(snap, what, coalesceKey) {
    var C2 = cpS();
    C2.undo = C2.undo || [];
    C2.undo.push({
      kind: 'struct', what: what, state: snap,
      coalesceKey: coalesceKey || null, t: Date.now()
    });
    if (C2.undo.length > CP_HISTORY_MAX) C2.undo.shift();
    C2.redo = [];        // 有了新动作，「重做」失效（与常规编辑器一致）
    syncComposeButtons();
  }

  /**
   * 结构类操作的统一入口：**先拍快照再动手**，保证撤销点一定是「动手之前」的状态。
   * 传了 coalesceKey 时，若栈顶就是同一个 key 且刚发生过（默认 1.5 秒内），
   * 就并入上一步 —— 方向键连按二十下只算一步，而不是撤二十次。
   * 返回是否有压入新撤销点。
   */
  function composeSnapBefore(what, coalesceKey, ms) {
    var C2 = cpS();
    if (C2.historyGroup) return false;        // 已在一个「共用撤销点」的分组里，由分组负责
    var top = (C2.undo || [])[C2.undo.length - 1];
    if (coalesceKey && top && top.kind === 'struct' && top.coalesceKey === coalesceKey &&
      (Date.now() - (top.t || 0)) < (ms || 1500)) {
      top.t = Date.now();
      return false;
    }
    composePushStruct(composeSnapState(), what, coalesceKey);
    return true;
  }

  /**
   * 把一组结构操作并成**一个**撤销点（例：「生成背景+包围」一键生成只留一步）。
   * 组内各操作自己的 composeSnapBefore 会被忽略（见上面的 historyGroup 判断）。
   */
  function composeSnapGroup(what, fn) {
    var C2 = cpS();
    if (C2.historyGroup) return fn();          // 嵌套时并入外层那一步
    composePushStruct(composeSnapState(), what);
    C2.historyGroup = 1;
    try { return fn(); } finally { C2.historyGroup = 0; }
  }

  /** 丢弃刚压入的那一步结构快照（操作最后什么都没改动时用，免得留一步空撤销）。 */
  function composeDropLastSnap() {
    var C2 = cpS();
    if (C2.historyGroup) return;
    var top = (C2.undo || [])[C2.undo.length - 1];
    if (top && top.kind === 'struct') { C2.undo.pop(); syncComposeButtons(); }
  }

  /** 记一次图层快照（整层像素），供撤销 —— 像素类操作专用。 */
  function composePushUndo(L, what) {
    var C2 = cpS();
    C2.undo = C2.undo || [];
    C2.undo.push({
      kind: 'blocks', what: what,
      blocks: [{ id: L.id, name: L.name, blocks: L.blocks.map(function (r) { return r.slice(); }) }]
    });
    if (C2.undo.length > CP_PIXEL_MAX) C2.undo.shift();   // 整层数组较大，只留 40 步
    C2.redo = [];
    syncComposeButtons();
  }

  function composePushMultiUndo(layers, what) {
    var C2 = cpS();
    C2.undo = C2.undo || [];
    C2.undo.push({
      kind: 'blocks', what: what,
      blocks: (layers || []).map(function (L) {
        return { id: L.id, name: L.name, blocks: L.blocks.map(function (r) { return r.slice(); }) };
      })
    });
    if (C2.undo.length > CP_PIXEL_MAX) C2.undo.shift();
    C2.redo = [];
    syncComposeButtons();
  }

  /**
   * 为一个「将被撤销的条目」拍一份反向快照（重做用）。
   * 结构条目就拍当前整份结构快照；像素条目只拍它涉及的那几层，够用且省内存。
   */
  function composeSnapForRedo(entry) {
    var C2 = cpS();
    if (entry.kind === 'struct') {
      return { kind: 'struct', what: entry.what, state: composeSnapState() };
    }
    var items = [];
    (entry.blocks || []).forEach(function (b) {
      var L = cpLayerById(b.id);
      if (!L) return;
      items.push({ id: b.id, name: L.name, blocks: L.blocks.map(function (r) { return r.slice(); }) });
    });
    if (!items.length) return null;
    return { kind: 'blocks', what: entry.what, blocks: items };
  }

  /** 执行一条撤销/重做条目（还原像素或还原结构）。返回给日志用的说明。 */
  function composeApplyEntry(entry) {
    var C2 = cpS();
    if (entry.kind === 'struct') {
      composeRestoreState(entry.state);
      return cpHasCanvas()
        ? '（回到 画布 ' + C2.rows + '×' + C2.cols + '，' + C2.layers.length + ' 个图层）'
        : '（回到还没有画布的状态）';
    }
    var restored = 0, missing = 0;
    (entry.blocks || []).forEach(function (b) {
      var L = cpLayerById(b.id);
      if (!L) { missing++; return; }
      L.blocks = b.blocks.map(function (r) { return r.slice(); });
      restored++;
    });
    C2.lastAudit = null;
    return '（恢复 ' + restored + ' 个图层的像素' +
      (missing ? '，另有 ' + missing + ' 个图层已被移除、无法恢复' : '') + '）';
  }

  function composeUndo() {
    var C2 = cpS();
    if (!C2.undo || !C2.undo.length) { log('拼接里还没有可撤销的操作'); return; }
    var last = C2.undo.pop();
    var back = composeSnapForRedo(last);
    if (back) {
      C2.redo = C2.redo || [];
      C2.redo.push(back);
      if (C2.redo.length > CP_HISTORY_MAX) C2.redo.shift();
    }
    var detail = composeApplyEntry(last);
    log('↶ 已撤销：' + last.what + detail +
      '。还可撤 ' + C2.undo.length + ' 步；要找回这一步，按 Ctrl/⌘+Shift+Z（或 Ctrl+Y）重做。');
    renderComposeAll();
    if (C2.sparseScan) composeRunSparseCheck();
  }

  function composeRedo() {
    var C2 = cpS();
    if (!C2.redo || !C2.redo.length) { log('拼接里没有可重做的操作（重做只在刚撤销之后有效）'); return; }
    var next = C2.redo.pop();
    var back = composeSnapForRedo(next);
    if (back) {
      C2.undo = C2.undo || [];
      C2.undo.push(back);
      if (C2.undo.length > CP_HISTORY_MAX) C2.undo.shift();
    }
    var detail = composeApplyEntry(next);
    log('↷ 已重做：' + next.what + detail);
    renderComposeAll();
    if (C2.sparseScan) composeRunSparseCheck();
  }

  /**
   * 新建一个画布尺寸的空白图层 —— 自制边框/模块的载体，也是「在空白画布上直接画」的落点。
   * `auto=true` 表示这是绘制时自动补出来的，日志措辞不同（要让用户明白多出来的这一层是哪来的）。
   */
  function composeNewBlankLayer(auto) {
    var C2 = cpS();
    if (!cpHasCanvas()) { log('先新建画布'); return null; }
    var base = auto ? '绘制层' : '空白图层', nm = base, k = 2;
    while (C2.layers.some(function (L) { return L.name === nm; })) { nm = base + '_' + k; k++; }
    // 撤销点拍在「建这一层之前」，连 id 计数也一起回到原样（重复撤销/重做时 id 不会错乱）
    composeSnapBefore((auto ? '自动新建绘制层「' : '新建空白图层「') + nm + '」');
    var L = {
      id: C2.nextId++, type: 'paint', name: nm,
      blocks: C.composeNewCanvas(C2.rows, C2.cols),
      rows: C2.rows, cols: C2.cols, offR: 0, offC: 0, locked: false, visible: true
    };
    C2.layers.push(L);
    C2.selected = [L.id];
    C2.lastAudit = null;
    if (auto) {
      // 自动建出来的图层必须说清，否则用户会奇怪图层列表里怎么多了一层
      log('画布上还没有可画的图层，已自动新建「' + nm + '」（' + C2.rows + '×' + C2.cols +
        ' 全空、覆盖整张画布）并选中它 —— 这一笔就画在它上面。' +
        '接着画都落在同一层；想另起一层再点「新建空白图层」。');
    } else {
      log('已新建「' + nm + '」（' + C2.rows + '×' + C2.cols + ' 全空）。' +
        '选「直线」「边框」「手动涂色」就能在它上面画；画完可用「把选中图层导出为模块 TXT」存成模块图纸。');
    }
    renderComposeAll();
    return L;
  }

  function composeCropNonZero(blocks) {
    var r0 = null, c0 = null, r1 = null, c1 = null, count = 0;
    for (var r = 0; r < blocks.length; r++) for (var c = 0; c < blocks[r].length; c++) {
      if (blocks[r][c] <= 0) continue;
      count++;
      if (r0 === null || r < r0) r0 = r;
      if (r1 === null || r > r1) r1 = r;
      if (c0 === null || c < c0) c0 = c;
      if (c1 === null || c > c1) c1 = c;
    }
    if (r0 === null) return null;
    var out = [];
    for (var rr = r0; rr <= r1; rr++) out.push(blocks[rr].slice(c0, c1 + 1));
    return { blocks: out, offR: r0, offC: c0, rows: out.length, cols: out[0] ? out[0].length : 0, count: count };
  }

  function composeAddOrReplaceGeneratedLayer(type, name, blocks, rule, opts) {
    opts = opts || {};
    var C2 = cpS();
    var replaced = 0;
    // 这一步会「删掉旧的同类规则层 + 插入新的」，属于典型的清单结构变化 —— 撤销点拍在动手前
    composeSnapBefore('生成「' + name + '」规则层');
    if (opts.replace !== false) {
      for (var i = C2.layers.length - 1; i >= 0; i--) {
        if (composeLayerType(C2.layers[i]) === type && C2.layers[i].rule && C2.layers[i].rule.kind === rule.kind) {
          C2.layers.splice(i, 1); replaced++;
        }
      }
    }
    var L = {
      id: C2.nextId++, type: type, name: name, blocks: blocks,
      rows: C2.rows, cols: C2.cols, offR: 0, offC: 0,
      locked: type === 'background',
      visible: true,
      selectable: type !== 'background',
      exportable: true,
      rule: rule
    };
    var insertAt = C2.layers.length;
    if (type === 'background') {
      insertAt = 0;
    } else if (type === 'separator') {
      insertAt = 0;
      for (var si = 0; si < C2.layers.length; si++) {
        var ty = composeLayerType(C2.layers[si]);
        if (ty === 'background' || ty === 'separator') insertAt = si + 1;
      }
    }
    C2.layers.splice(insertAt, 0, L);
    C2.selected = type === 'background' ? [] : [L.id];
    C2.lastAudit = null;
    log('已生成「' + name + '」' + (replaced ? '（替换旧的同类规则层 ' + replaced + ' 个）' : '') + '。');
    renderComposeAll();
    return L;
  }

  function composeAddOrReplaceChildLayer(parent, type, name, crop, rule) {
    var C2 = cpS();
    var replaced = 0;
    for (var i = C2.layers.length - 1; i >= 0; i--) {
      var L0 = C2.layers[i];
      if (L0 && L0.parentId === parent.id && composeLayerType(L0) === type &&
        L0.rule && L0.rule.kind === rule.kind) {
        C2.layers.splice(i, 1);
        replaced++;
      }
    }
    var L = {
      id: C2.nextId++, type: type, name: name, blocks: crop.blocks,
      rows: crop.rows, cols: crop.cols, offR: crop.offR, offC: crop.offC,
      relOffR: crop.offR - (parent.offR | 0), relOffC: crop.offC - (parent.offC | 0),
      parentId: parent.id,
      locked: false,
      visible: true,
      selectable: true,
      exportable: true,
      rule: rule
    };
    var parentIdx = C2.layers.findIndex(function (x) { return x.id === parent.id; });
    C2.layers.splice(parentIdx < 0 ? C2.layers.length : parentIdx, 0, L);
    C2.lastAudit = null;
    return { layer: L, replaced: replaced };
  }

  function composeGenerateHalo() {
    var C2 = cpS();
    if (!cpHasCanvas()) { log('先新建画布'); return; }
    var seen = {};
    var selectedSubjects = [];
    C2.selected.forEach(function (id) {
      var L = cpLayerById(id);
      if (L && composeLayerType(L) !== 'subject' && L.parentId != null) L = cpLayerById(L.parentId);
      if (L && composeLayerType(L) === 'subject' && !seen[L.id]) {
        seen[L.id] = true;
        selectedSubjects.push(L);
      }
    });
    if (!selectedSubjects.length) {
      log('先选中要生成包围的主体层。可以 Shift/Cmd 多选多个主体，再一次生成各自的包围子图层。');
      return;
    }
    var width = Math.max(1, parseInt(($('inComposeHaloWidth') || {}).value, 10) || 2);
    var color = composeColorNumber('inComposeHaloColor', 31);
    // 可能一次生成多个子图层，撤销点只拍一个（在循环之前）；一个都没生成的话下面会丢掉它
    composeSnapBefore('生成主体包围（' + selectedSubjects.length + ' 个主体）');
    var made = [], skipped = [], replaced = 0;
    selectedSubjects.forEach(function (subj) {
      var res = C.composeHaloBlocks([subj], C2.rows, C2.cols, {
        layerIds: [subj.id],
        radius: width,
        color: color
      });
      var crop = composeCropNonZero(res.blocks);
      if (!res.subjectPixels || !crop) {
        skipped.push(subj.name);
        return;
      }
      var added = composeAddOrReplaceChildLayer(subj, 'halo', subj.name + '_包围_' + width + '格', crop, {
        kind: 'halo',
        params: { width: width, color: color, parentId: subj.id },
        generatedAt: new Date().toISOString()
      });
      replaced += added.replaced;
      made.push(added.layer.id);
    });
    if (!made.length) {
      composeDropLastSnap();        // 什么都没生成，就别留一步空撤销
      log('包围层没有生成任何像素，可能主体已经铺满画布或画布太小。');
      return;
    }
    C2.selected = made;
    log('已生成 ' + made.length + ' 个主体包围子图层，颜色 ' + composeColorLabel(color) +
      '，宽 ' + width + ' 格。' +
      (replaced ? '已替换旧包围子图层 ' + replaced + ' 个。' : '') +
      (skipped.length ? '未生成：' + skipped.join('、') + '。' : '') +
      '移动父主体时包围会一起移动；选中包围子层也可以单独微调或换色。');
    renderComposeAll();
  }

  function composeGenerateBackground() {
    var C2 = cpS();
    if (!cpHasCanvas()) { log('先新建画布'); return; }
    var colorA = composeColorNumber('inComposeBgColorA', 14);
    var colorB = composeColorNumber('inComposeBgColorB', 31);
    var pattern = ($('selComposeBgPattern') || {}).value || 'diagonal';
    var res = C.composeBackgroundBlocks(C2.layers, C2.rows, C2.cols, {
      colorA: colorA,
      colorB: colorB,
      pattern: pattern
    });
    composeAddOrReplaceGeneratedLayer('background', '自动背景_' + pattern, res.blocks, {
      kind: 'background',
      params: { colorA: colorA, colorB: colorB, pattern: pattern },
      generatedAt: new Date().toISOString()
    });
  }

  function composeGenerateAllRules() {
    var keepSelected = cpS().selected.slice();
    // 一键生成 = 三步「结构」改动，但用户眼里是一下子 —— 所以并成一个撤销点
    composeSnapGroup('一键生成 背景+包围', function () {
      composeGenerateBackground();
      cpS().selected = keepSelected;
      composeGenerateHalo();
    });
  }

  /** 把选中图层单独导出成 txt 模块（用户需求⑥：自制边框导出为全新模块图纸，再重新导入）。 */
  function composeExportLayer() {
    var L = composeTargetLayer();
    if (!L) return;
    var nz = 0;
    L.blocks.forEach(function (r) { r.forEach(function (v) { if (v > 0) nz++; }); });
    if (!nz) { log('「' + L.name + '」是空的，导出一张全 0 的图没有意义'); return; }
    var nm = safeFileName('模块_' + L.name + '_' + exportStamp());
    download(nm + '.txt', new Blob([C.serializeTxt(L.blocks)], { type: 'text/plain;charset=utf-8' }));
    log('已导出模块「' + nm + '.txt」（' + L.blocks.length + '×' + L.blocks[0].length + '，' + nz + ' 格）。' +
      '用②的「导入 TXT 图」把它加回部件列表，就能当成自制边框反复使用。');
  }

  /** 把一批格坐标画到图层上。cells 是**画布坐标**，落到图层内要减去偏移。 */
  /* ==================== 装饰图章（2026-10-30 用户要求：星星 / 爱心等小配件填背景） ====================
   * 每个图章就是一张 '#'/'.' 的小位图，落笔时按「当前画笔色」写成像素，所以不用给每个图章配色。
   * 单个盖章走「贴图章」工具（点一下盖一个），批量走「随机撒到背景」（只撒空白处、一个撤销点）。 */
  var COMPOSE_STAMPS = [
    { id: 'star5', name: '五角星', rows: [
      '...###...',
      '...###...',
      '..#####..',
      '#########',
      '.#######.',
      '..#####..',
      '.##...##.'] },
    { id: 'star_s', name: '小星', rows: [
      '..#..',
      '.###.',
      '#####',
      '.###.',
      '.#.#.'] },
    { id: 'heart', name: '爱心', rows: [
      '.##.##.',
      '#######',
      '#######',
      '.#####.',
      '..###..',
      '...#...'] },
    { id: 'spark', name: '闪光', rows: [
      '..#..',
      '.#.#.',
      '#####',
      '.#.#.',
      '..#..'] },
    { id: 'diamond', name: '菱形', rows: [
      '..#..',
      '.###.',
      '#####',
      '.###.',
      '..#..'] },
    { id: 'cross', name: '十字', rows: [
      '..#..',
      '..#..',
      '#####',
      '..#..',
      '..#..'] },
    { id: 'dot', name: '小点', rows: [
      '.#.',
      '###',
      '.#.'] },
    { id: 'flower', name: '花瓣', rows: [
      '.#.#.',
      '#####',
      '.###.',
      '#####',
      '.#.#.'] }
  ];

  function composeStampById(id) {
    for (var i = 0; i < COMPOSE_STAMPS.length; i++) if (COMPOSE_STAMPS[i].id === id) return COMPOSE_STAMPS[i];
    return COMPOSE_STAMPS[0];
  }

  /** 某个图章盖在 (centerR, centerC) 时占哪些画布格（含缩放，越界丢弃）。 */
  function composeStampCellsAt(spec, scale, centerR, centerC, rows, cols) {
    var h = spec.rows.length, w = spec.rows[0].length, out = [];
    var baseR = centerR - Math.floor(h * scale / 2), baseC = centerC - Math.floor(w * scale / 2);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        if (spec.rows[y].charAt(x) !== '#') continue;
        for (var sy = 0; sy < scale; sy++) {
          for (var sx = 0; sx < scale; sx++) {
            var r = baseR + y * scale + sy, c = baseC + x * scale + sx;
            if (r < 0 || c < 0 || r >= rows || c >= cols) continue;
            out.push({ r: r, c: c });
          }
        }
      }
    }
    return out;
  }

  /** 当前选中的图章 id / 缩放倍数。 */
  function composeStampId() { return cpS().stampId || COMPOSE_STAMPS[0].id; }
  function composeStampScale() {
    var v = parseInt(($('inStampScale') || {}).value, 10);
    return (isFinite(v) && v >= 1) ? Math.min(6, v) : 1;
  }

  /** 图章选择区：缩略图就是按 '#' 位图画的，点一下选中并切到「贴图章」工具。 */
  function renderComposeStampPalette() {
    var box = $('composeStampPalette');
    if (!box) return;
    box.innerHTML = COMPOSE_STAMPS.map(function (sp) {
      var h = sp.rows.length, w = sp.rows[0].length;
      return '<button class="stampBtn' + (sp.id === composeStampId() ? ' active' : '') +
        '" data-stamp="' + sp.id + '" title="' + sp.name + '：选中后在画布上点一下就盖一个">' +
        '<canvas data-stampThumb="' + sp.id + '" width="' + (w * 3) + '" height="' + (h * 3) + '"></canvas>' +
        '<span>' + sp.name + '</span></button>';
    }).join('');
    Array.prototype.forEach.call(box.querySelectorAll('.stampBtn'), function (b) {
      var cv = b.querySelector('canvas');
      var sp = composeStampById(b.getAttribute('data-stamp'));
      var ctx = cv.getContext('2d');
      var cell = 3;
      ctx.fillStyle = '#8f7963';
      sp.rows.forEach(function (row, y) {
        for (var x = 0; x < row.length; x++) if (row.charAt(x) === '#') ctx.fillRect(x * cell, y * cell, cell, cell);
      });
      b.onclick = function () {
        cpS().stampId = b.getAttribute('data-stamp');
        var r = document.querySelector('input[name="composeTool"][value="stamp"]');
        if (r) { r.checked = true; if (r.onchange) r.onchange(); }
        renderComposeStampPalette();
        log('装饰图章：已选「' + sp.name + '」，在画布上点一下就盖一个（大小 ' + composeStampScale() + '×，颜色用当前画笔色）。');
      };
    });
  }

  /** 单个盖章：点哪盖哪，落在整张画布的绘制层上。 */
  function composeStampAt(p) {
    var C2 = cpS();
    var spec = composeStampById(composeStampId());
    var cells = composeStampCellsAt(spec, composeStampScale(), p.r, p.c, C2.rows, C2.cols);
    if (!cells.length) { log('这一下超出画布了，没盖上。'); return; }
    var L = composeCanvasPaintLayer();
    if (!L) return;
    C2.selected = [L.id];
    var n = composeApplyCells(L, cells, composeBrushColor(), '盖图章「' + spec.name + '」');
    if (n) log('盖了「' + spec.name + '」（' + composeStampScale() + '×，' + n + ' 格）。');
    renderComposeAll();
  }

  /** 固定种子的伪随机（mulberry32）：同参数同种子 → 同结果，可复现。 */
  function composeSeededRandom(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** 均匀分布：按 sqrt(面积/个数) 分格，每格里抖一点，疏密一致但不像网格那么死。 */
  function composeEvenCenters(n, rows, cols, rnd) {
    var area = Math.max(1, rows * cols);
    var step = Math.max(2, Math.sqrt(area / Math.max(1, n)));
    var nx = Math.max(1, Math.round(cols / step));
    var ny = Math.max(1, Math.round(rows / step));
    var out = [];
    for (var iy = 0; iy < ny; iy++) {
      for (var ix = 0; ix < nx; ix++) {
        var baseR = (iy + 0.5) * (rows / ny);
        var baseC = (ix + 0.5) * (cols / nx);
        // 抖动幅度取格子的 30%：够打破网格感，又不会让间距乱掉
        var jr = (rnd() - 0.5) * 0.6 * (rows / ny);
        var jc = (rnd() - 0.5) * 0.6 * (cols / nx);
        var r = Math.round(baseR + jr), c = Math.round(baseC + jc);
        r = Math.max(1, Math.min(rows - 2, r));
        c = Math.max(1, Math.min(cols - 2, c));
        out.push({ r: r, c: c });
      }
    }
    return out;
  }

  /**
   * 撒到背景：按「撒 N 个」落点，默认**均匀分布**（网格 + 抖动，可复现），也可切成纯随机。
   * 只落在非背景的空位（不压主体/已有图章），整批走一次 composeApplyCells → 一个撤销点。
   */
  function composeScatterStamps() {
    var C2 = cpS();
    if (!cpHasCanvas()) { log('先有画布才能撒。'); return; }
    var n = Math.max(1, Math.min(600, parseInt(($('inStampCount') || {}).value, 10) || 30));
    var emptyOnly = !$('optStampEmptyOnly') || $('optStampEmptyOnly').checked;
    var spec = composeStampById(composeStampId());
    var scale = composeStampScale();
    var color = composeBrushColor();
    var rows = C2.rows, cols = C2.cols;
    // 目标层：整张画布的绘制层（没有就建）。判断「空不空」时要**排除这一层**——
    // 改前把背景层也算进去，结果铺了背景纹理后永远找不到空格，怎么撒都没反应（实测）。
    // 用户要的是「撒在背景上」，所以这里只避开**其它图层**（部件/包围等）和本层已有的图章。
    var L = composeCanvasPaintLayer();
    if (!L) return;
    // 背景层不算「占位」——图章就是要盖在背景上的；只避开部件/包围/手绘这些真内容。
    var others = C2.layers.filter(function (x) {
      return x.id !== L.id && composeLayerType(x) !== 'background';
    });
    var flat = C.composeFlatten(others, rows, cols);
    var taken = {};                        // 这一批里已经盖过的格子，避免图章互相叠
    var all = [], placed = 0;
    // 落点策略（2026-10-30 用户问「为什么要纯随机」后改的）：
    //   默认 even = 按 sqrt(面积/个数) 分格 + 每格抖动 30%，疏密一致、可复现；
    //   random = 旧的候选点打乱 + 贪心，保留给「想要不规则」的场合。
    var seed = Math.max(1, Math.min(999999, parseInt(($('inStampSeed') || {}).value, 10) || 1));
    var rnd = composeSeededRandom(seed);
    var mode = ($('selStampMode') || {}).value || 'even';
    var cand;
    if (mode === 'random') {
      cand = [];
      for (var rr = 2; rr < rows - 2; rr++) for (var cc2 = 2; cc2 < cols - 2; cc2++) cand.push({ r: rr, c: cc2 });
      for (var si = cand.length - 1; si > 0; si--) {
        var sj = Math.floor(rnd() * (si + 1));
        var st = cand[si]; cand[si] = cand[sj]; cand[sj] = st;
      }
    } else {
      cand = composeEvenCenters(n, rows, cols, rnd);
    }
    for (var qi = 0; qi < cand.length && placed < n; qi++) {
      var cells = composeStampCellsAt(spec, scale, cand[qi].r, cand[qi].c, rows, cols);
      if (!cells.length) continue;
      var ok = true;
      for (var i = 0; i < cells.length; i++) {
        var k = cells[i].r + '_' + cells[i].c;
        if (taken[k]) { ok = false; break; }
        if (!emptyOnly) continue;
        var fr = flat[cells[i].r], fc = fr ? fr[cells[i].c] : 0;
        var lr = cells[i].r - L.offR, lc = cells[i].c - L.offC;
        var mine = (L.blocks[lr] && L.blocks[lr][lc]) || 0;
        if (fc || mine) { ok = false; break; }
      }
      if (!ok) continue;
      for (var j = 0; j < cells.length; j++) {
        taken[cells[j].r + '_' + cells[j].c] = 1;
        all.push(cells[j]);
      }
      placed++;
    }
    if (!placed) { log('没找到能撒的位置：可以取消「只撒在空白处」，或把图章调小 / 数量调少。'); return; }
    C2.selected = [L.id];
    var changed = composeApplyCells(L, all, color, '随机撒 ' + placed + ' 个「' + spec.name + '」');
    log('已撒 ' + placed + ' 个「' + spec.name + '」' + (scale > 1 ? '（' + scale + '×）' : '') +
      '，共 ' + changed + ' 格' + (emptyOnly ? '，避开了部件与已有图章' : '') +
      '。分布：' + (mode === 'random' ? '随机' : '均匀') + '，种子 ' + seed +
      '（同参数同种子结果一样；要变就改种子或点「换一批」）。Ctrl/⌘+Z 可整批撤回。');
    renderComposeAll();
  }

  /** 找一张「和画布一样大、能画」的绘制层；没有就自动建一张（并选中）。 */
  function composeCanvasPaintLayer() {
    var C2 = cpS();
    var found = null;
    C2.layers.forEach(function (L) {
      if (found || !L || L.locked || L.visible === false) return;
      if (!L.blocks || !L.blocks[0]) return;
      if (L.offR === 0 && L.offC === 0 &&
          L.blocks.length === C2.rows && L.blocks[0].length === C2.cols) found = L;
    });
    if (found) return found;
    return composeNewBlankLayer(true) || null;
  }

  /** 这一笔有多少格落在图层外面。 */
  function composeCellsOutside(L, cells) {
    var rows = L.blocks.length, cols = L.blocks[0] ? L.blocks[0].length : 0, n = 0;
    for (var i = 0; i < cells.length; i++) {
      var r = cells[i].r - L.offR, c = cells[i].c - L.offC;
      if (r < 0 || c < 0 || r >= rows || c >= cols) n++;
    }
    return n;
  }

  /**
   * 落笔前把目标图层换成「装得下这一笔」的那张。
   *
   * 2026-10-30 用户报：「我绘制矩形，结果他只出现在画布上的部件的区域」。
   * 原因：选中部件时绘制落在部件那一层，而 composeApplyCells 会把超出部件尺寸的格子**悄悄剪掉**；
   * 拖拽时的预览却是在整张画布上画的完整形状 —— 预览与结果对不上，看起来就是「只有部件那块」。
   * 现在改成：装不下就换到覆盖整张画布的绘制层（没有就自动建一张），一个格子都不剪。
   */
  function composeFitDrawLayer(L, cells) {
    if (!composeCellsOutside(L, cells)) return L;
    var canvasL = composeCanvasPaintLayer();
    if (!canvasL || canvasL.id === L.id) return L;
    log('这一笔有格子落在「' + L.name + '」外面（它只有 ' + L.blocks.length + '×' +
      (L.blocks[0] ? L.blocks[0].length : 0) + '），已改画在整张画布的「' + canvasL.name + '」上，不剪裁。');
    cpS().selected = [canvasL.id];
    renderComposeLayers();
    return canvasL;
  }

  function composeApplyCells(L, cells, color, what) {
    L = composeFitDrawLayer(L, cells);
    var local = [];
    for (var i = 0; i < cells.length; i++) {
      var r = cells[i].r - L.offR, c = cells[i].c - L.offC;
      if (r < 0 || c < 0 || r >= L.blocks.length) continue;
      if (!L.blocks[r] || c >= L.blocks[r].length) continue;
      local.push({ r: r, c: c });
    }
    if (!local.length) {
      log('这一笔全落在「' + L.name + '」的范围之外了 —— 图层只有 ' +
        L.blocks.length + '×' + (L.blocks[0] ? L.blocks[0].length : 0) +
        '，且它当前偏移在 行' + L.offR + ' 列' + L.offC + '。' +
        '想在整张画布上自由画，请用「新建空白图层」（它和画布一样大）。');
      return 0;
    }
    var res = C.paintCells(L.blocks, local, color);
    if (!res.changed) { log('这一笔没有改变任何像素（目标色与原色相同）'); return 0; }
    composePushUndo(L, what);
    L.blocks = res.blocks;
    cpS().lastAudit = null;
    return res.changed;
  }

  /* ---------- 边框生成 ---------- */

  function composeMakeBorder(box) {
    var C2 = cpS();
    // 与画布上拖出来的边框同一口径：空白画布上直接能生成，没有图层就自动补一张
    var L = composeEnsureDrawTarget();
    if (!L) return;
    var kind = $('selComposeBorder').value;
    var w = composeBrushWidth();
    var shape;
    try {
      shape = C.borderShape(kind, box, w, C2.rows, C2.cols);
    } catch (e) { log('生成边框失败：' + (e && e.message)); return; }
    var n = composeApplyCells(L, shape.cells, composeBrushColor(), '生成' + kind);
    if (!n) { renderComposeAll(); return; }
    // 记下这次的形态，供「局部替换某一部件的颜色」
    C2.lastBorder = { layerId: L.id, shape: shape, kind: kind };
    log('已在「' + L.name + '」上生成' + kind + '：线宽 ' + w + ' 格，' + n + ' 个像素，' +
      '范围 行' + shape.box.r0 + '–' + shape.box.r1 + ' 列' + shape.box.c0 + '–' + shape.box.c1 +
      '。下面列出了它的各部件，可以单独给某一部件换色。');
    renderComposeAll();
  }

  function composeBorderFull() {
    var C2 = cpS();
    if (!cpHasCanvas()) { log('先新建画布'); return; }
    composeMakeBorder({ r0: 0, c0: 0, r1: C2.rows - 1, c1: C2.cols - 1 });
  }

  /**
   * 自动田字格四框：按当前画布均分 2×2，四个框各自成环、互不重叠。
   * 画布尺寸就是唯一输入，所以换 40×40 / 55×55 / 100×100 都会自动跟着变。
   */
  function composeTianziAuto() {
    var C2 = cpS();
    if (!cpHasCanvas()) { log('先新建画布，再生成田字格'); return; }
    // 尽量画在一张「和画布一样大、未固定」的图层上；没有就自动新建一张。
    var L = null;
    if (C2.selected.length === 1) {
      var sel = cpLayerById(C2.selected[0]);
      if (sel && sel.locked) { log('「' + sel.name + '」已固定，先解固再生成'); return; }
      if (sel && sel.rows === C2.rows && sel.cols === C2.cols && sel.offR === 0 && sel.offC === 0) L = sel;
    }
    if (!L) L = composeNewBlankLayer(true);
    if (!L) return;

    var w = composeBrushWidth();
    var shape = C.tianziShape({ r0: 0, c0: 0, r1: C2.rows - 1, c1: C2.cols - 1 },
      w, C2.rows, C2.cols);
    var n = composeApplyCells(L, shape.cells, composeBrushColor(), '自动生成田字格四框');
    if (!n) { renderComposeAll(); return; }
    C2.lastBorder = { layerId: L.id, shape: shape, kind: '田字格四框' };
    var sizes = shape.sizes.map(function (s) { return s.name + ' ' + s.rows + '×' + s.cols; }).join('、');
    log('已按画布 ' + C2.rows + '×' + C2.cols + ' 均分生成田字格四框：' + sizes +
      '，线宽 ' + w + ' 格，' + n + ' 个像素。下面列出了四个框，可单独换色。');
    renderComposeAll();
  }

  /** 局部替换：把上一次生成的边框里某一个部件换成当前颜色（用户原话的「田字格四个小口」用法）。 */
  function composeRecolorPart(partIndex) {
    var C2 = cpS();
    var lb = C2.lastBorder;
    if (!lb) return;
    var L = cpLayerById(lb.layerId);
    if (!L) { log('那个图层已被移除'); C2.lastBorder = null; renderComposeAll(); return; }
    if (L.locked) { log('「' + L.name + '」已固定，先解固'); return; }
    var part = lb.shape.parts[partIndex];
    if (!part) return;
    var n = composeApplyCells(L, part.cells, composeBrushColor(), '把「' + part.name + '」换色');
    if (n) {
      log('已把' + lb.kind + '的「' + part.name + '」换成 ' +
        (composeBrushColor() === 0 ? '空' : window.AntSolver.getColorName(composeBrushColor())) +
        '（' + n + ' 格）。');
    }
    renderComposeAll();
  }

  function renderComposeBorderParts() {
    var box = $('composeBorderParts');
    if (!box) return;
    var lb = cpS().lastBorder;
    if (!lb) {
      box.innerHTML = '<div class="muted">还没有生成边框。选「边框」工具后在画布上拖一个范围，或点「铺满整张画布」。</div>';
      return;
    }
    var L = cpLayerById(lb.layerId);
    box.innerHTML = '';
    var head = document.createElement('div');
    head.className = 'item muted';
    head.textContent = '上一次生成：' + lb.kind + '（在「' + (L ? L.name : '已移除的图层') + '」上）—— 点部件名即可用当前颜色替换它';
    box.appendChild(head);
    lb.shape.parts.forEach(function (p, i) {
      var row = document.createElement('div');
      row.className = 'item';
      var txt = document.createElement('div');
      txt.className = 'grow';
      txt.textContent = p.name + '　' + p.cells.length + ' 格';
      row.appendChild(txt);
      var b = document.createElement('button');
      b.className = 'miniBtn';
      b.textContent = '换成当前色';
      b.title = '只把「' + p.name + '」这部分改成当前画笔颜色，其余不动';
      b.disabled = !L;
      b.onclick = function () { composeRecolorPart(i); };
      row.appendChild(b);
      box.appendChild(row);
    });
  }

  /** 拼接里的画笔色库（复用美术编辑的 S.edit.color，不另存一份，避免两处颜色不同步）。 */
  function renderComposePalette() {
    var pal = $('composePalette');
    if (!pal) return;
    var h = '<div class="paletteRow">';
    EDIT_PALETTE.forEach(function (id) {
      var name = window.AntSolver.getColorName(id);
      h += '<div class="swatchCell">' +
        '<div class="editSwatch' + (S.edit.color === id ? ' active' : '') +
        '" data-cpcolor="' + id + '" style="background:' + window.AntSolver.getColorCSS(id) +
        '" title="' + name + '（' + id + '号）　点击选为拼接的画笔颜色"></div>' +
        '<div class="swatchName">' + name + '(' + id + ')</div></div>';
    });
    h += '</div>';
    pal.innerHTML = h;
    Array.prototype.forEach.call(pal.querySelectorAll('[data-cpcolor]'), function (el) {
      el.onclick = function () {
        S.edit.color = +el.getAttribute('data-cpcolor');
        renderComposePalette();
        renderEditPalette();       // 两边共用一个颜色，另一边也要跟着高亮
        log('拼接画笔颜色：' + window.AntSolver.getColorName(S.edit.color) + '(' + S.edit.color + ')');
      };
    });
  }

  function composeColorInputMeta(id) {
    for (var i = 0; i < COMPOSE_COLOR_INPUTS.length; i++) if (COMPOSE_COLOR_INPUTS[i].id === id) return COMPOSE_COLOR_INPUTS[i];
    return null;
  }

  function composeRefreshRuleColorChips() {
    COMPOSE_COLOR_INPUTS.forEach(function (m) {
      var input = $(m.id);
      if (!input) return;
      var id = composeColorNumber(m.id, 0);
      var chip = $('chip_' + m.id);
      if (!chip) return;
      chip.style.background = id > 0 ? window.AntSolver.getColorCSS(id) : 'transparent';
      chip.title = m.label + '：' + composeColorLabel(id) + '。点击打开颜色列表';
      var label = $('label_' + m.id);
      if (label) label.textContent = composeColorLabel(id);
    });
  }

  function composeShowColorPicker(inputId) {
    var box = $('composeColorPicker');
    var input = $(inputId);
    var meta = composeColorInputMeta(inputId);
    if (!box || !input || !meta) return;
    cpS().colorPickerTarget = inputId;
    var cur = composeColorNumber(inputId, 0);
    var h = '<div class="colorPickerHead"><b>' + escHtml(meta.label) + '</b><span>点击色块写入色号</span></div>' +
      '<div class="composeColorGrid">';
    EDIT_PALETTE.forEach(function (id) {
      var name = window.AntSolver.getColorName(id);
      h += '<button type="button" class="composeColorChoice' + (id === cur ? ' active' : '') +
        '" data-pick-color="' + id + '" title="' + name + '(' + id + ')">' +
        '<i style="background:' + window.AntSolver.getColorCSS(id) + '"></i><span>' + name + '</span><b>' + id + '</b></button>';
    });
    h += '</div>';
    box.innerHTML = h;
    box.classList.remove('hidden');
    Array.prototype.forEach.call(box.querySelectorAll('[data-pick-color]'), function (el) {
      el.onclick = function () {
        input.value = el.getAttribute('data-pick-color');
        composeRefreshRuleColorChips();
        box.classList.add('hidden');
        log(meta.label + '已设为 ' + composeColorLabel(input.value));
      };
    });
  }

  function initComposeColorPickers() {
    COMPOSE_COLOR_INPUTS.forEach(function (m) {
      var input = $(m.id);
      if (!input) return;
      input.classList.add('composeColorNumber');
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.id = 'chip_' + m.id;
      chip.className = 'composeColorChip';
      chip.onclick = function (ev) { ev.stopPropagation(); composeShowColorPicker(m.id); };
      input.parentNode.insertBefore(chip, input.nextSibling);
      var label = document.createElement('span');
      label.id = 'label_' + m.id;
      label.className = 'composeColorName';
      input.parentNode.insertBefore(label, chip.nextSibling);
      input.addEventListener('focus', function () { composeShowColorPicker(m.id); });
      input.addEventListener('click', function () { composeShowColorPicker(m.id); });
      input.addEventListener('input', composeRefreshRuleColorChips);
    });
    document.addEventListener('mousedown', function (ev) {
      var box = $('composeColorPicker');
      if (!box || box.classList.contains('hidden')) return;
      if (ev.target.closest && (ev.target.closest('#composeColorPicker') ||
        ev.target.closest('.composeColorChip') || ev.target.closest('.composeColorNumber'))) return;
      box.classList.add('hidden');
    });
    composeRefreshRuleColorChips();
  }

  function initFloatPanels() {
    Array.prototype.forEach.call(document.querySelectorAll('.floatToggle'), function (btn) {
      var panel = $(btn.getAttribute('data-float'));
      if (panel) ensureResizeHandles(panel);
      btn.onclick = function (ev) { ev.stopPropagation(); toggleFloat(btn.getAttribute('data-float')); };
    });

    var act = null;   // { kind:'move'|'resize', panel, ... }

    document.addEventListener('mousedown', function (ev) {
      if (!ev.target.closest) return;
      // ① 拖边缘/角 = 放大缩小
      var rz = ev.target.closest('.rzHandle');
      if (rz) {
        var p1 = rz.parentNode;
        if (!p1 || !p1.classList.contains('floating')) return;
        var r1 = p1.getBoundingClientRect();
        act = {
          kind: 'resize', panel: p1, mode: rz.getAttribute('data-rz'),
          startX: ev.clientX, startY: ev.clientY, w0: r1.width, h0: r1.height, left: r1.left, top: r1.top
        };
        ev.preventDefault();
        return;
      }
      // ② 拖标题栏 = 移动
      var head = ev.target.closest('.floatHead');
      if (!head) return;
      var panel = head.parentNode;
      if (!panel || !panel.classList.contains('floating')) return;
      if (ev.target.classList && ev.target.classList.contains('floatToggle')) return;   // 点按钮不算拖动
      var r = panel.getBoundingClientRect();
      act = { kind: 'move', panel: panel, dx: ev.clientX - r.left, dy: ev.clientY - r.top };
      ev.preventDefault();
    });

    document.addEventListener('mousemove', function (ev) {
      if (!act) return;
      var st = FLOAT_STATE[act.panel.id] || (FLOAT_STATE[act.panel.id] = {});
      if (act.kind === 'move') {
        // 限制在窗口内，避免拖到屏幕外找不回来
        var left = Math.max(0, Math.min(window.innerWidth - 60, ev.clientX - act.dx));
        var top = Math.max(0, Math.min(window.innerHeight - 30, ev.clientY - act.dy));
        act.panel.style.left = left + 'px';
        act.panel.style.top = top + 'px';
        st.left = left; st.top = top;
        return;
      }
      // 放大缩小：右边缘只改宽，下边缘只改高，右下角同时改
      if (act.mode !== 'rzB') {
        var w = Math.max(FLOAT_MIN_W, Math.min(window.innerWidth - act.left - 4, act.w0 + (ev.clientX - act.startX)));
        act.panel.style.width = w + 'px';
        st.width = Math.round(w);
      }
      if (act.mode !== 'rzR') {
        var h = Math.max(FLOAT_MIN_H, Math.min(window.innerHeight - act.top - 4, act.h0 + (ev.clientY - act.startY)));
        act.panel.style.height = h + 'px';
        st.height = Math.round(h);
      }
    });

    document.addEventListener('mouseup', function () { act = null; });
  }

  // 完整色库：1–34 全部标准色。色值与中文名一律取 AntSolver.COLORS，不重复定义。
  var EDIT_PALETTE = (function () { var a = []; for (var i = 1; i <= 34; i++) a.push(i); return a; })();

  function renderEditPalette() {
    var pal = $('editPalette');
    var it = cur();
    if (!pal) return;
    if (!it) { pal.innerHTML = ''; return; }
    var counts = colorCountsOf(it);
    var total = 0; Object.keys(counts).forEach(function (k) { total += counts[k]; });
    var usedIds = [], freeIds = [];
    for (var i = 0; i < EDIT_PALETTE.length; i++) {
      (counts[EDIT_PALETTE[i]] ? usedIds : freeIds).push(EDIT_PALETTE[i]);
    }

    function swatch(id, withStat) {
      var name = window.AntSolver.getColorName(id);
      var cnt = counts[id] || 0;
      var pct = total && cnt ? (cnt / total * 100).toFixed(1) + '%' : '';
      var isActive = S.edit.color === id;
      var replacing = S.edit.replacing && S.edit.replacing.scope === 'global' && S.edit.replacing.oldId === id;
      var h = '<div class="swatchCell' + (replacing ? ' replacing' : '') + '">' +
        '<div class="editSwatch' + (isActive ? ' active' : '') + (cnt ? ' used' : '') +
        '" data-color="' + id + '" style="background:' + window.AntSolver.getColorCSS(id) +
        '" title="' + name + '（' + id + '号）' + (cnt ? '　已用 ' + cnt + ' 像素' : '　这张图未使用') +
        '　点击选为当前绘制颜色"></div>';
      // 凡是显示颜色数量的地方都必须同时显示中文颜色名（用户 2026-08-03 微调第 6 项）
      h += '<div class="swatchName">' + name + '(' + id + ')</div>';
      if (withStat) {
        h += '<div class="swatchStat">' + cnt + ' 像素<br>' + pct + '</div>' +
          '<button class="swatchReplace' + (replacing ? ' on' : '') + '" data-replace="' + id + '" ' +
          'title="把整张图里的「' + name + '」全部换成另一个颜色：点这里，再点你要换成的色块；再点一次本按钮取消">' +
          (replacing ? '取消替换' : '整图替换') + '</button>';
      }
      return h + '</div>';
    }

    var h = '';
    h += '<div class="paletteUsedBox">' +
      '<div class="paletteGroupTitle">当前目标图已有颜色（' + usedIds.length + ' 种）' +
      (usedIds.length ? '　<span class="muted">数字为像素数与占比</span>' : '') + '</div>' +
      '<div class="paletteRow">' +
      (usedIds.length ? usedIds.map(function (id) { return swatch(id, true); }).join('')
        : '<span class="muted">这张目标图还没有任何像素</span>') +
      '</div></div>';
    h += '<div class="paletteGroupTitle">完整色库中当前未使用的颜色（' + freeIds.length + ' 种，同样可以直接选用）</div>' +
      '<div class="paletteRow">' + freeIds.map(function (id) { return swatch(id, false); }).join('') + '</div>';
    pal.innerHTML = h;

    Array.prototype.forEach.call(pal.querySelectorAll('.editSwatch'), function (el) {
      el.onclick = function () {
        var id = +el.getAttribute('data-color');
        if (S.edit.replacing) { performColorReplace(id); return; }
        S.edit.color = id;
        // 点了颜色就是在选画什么色，橡皮擦要自动退出，否则「选了色却画出空白」很费解
        if (S.edit.eraser) {
          S.edit.eraser = false;
          if ($('optErase')) $('optErase').checked = false;
          $('cv').classList.remove('erasing');
        }
        renderEditPalette();
      };
    });
    // 全局替换入口（原独立面板的能力，现在挂在边框内的已有颜色上）
    Array.prototype.forEach.call(pal.querySelectorAll('.swatchReplace'), function (el) {
      el.onclick = function (ev) {
        ev.stopPropagation();
        startColorReplace('global', +el.getAttribute('data-replace'));
      };
    });
  }

  /** 当前 item 目标图的颜色统计（缓存复用 core.js colorCounts，供多处面板共用）。 */
  function colorCountsOf(it) { return it && it.blocks ? C.colorCounts(it.blocks) : {}; }

  /**
   * 颜色的统一写法：中文名 + 色号。
   * 用户 2026-08-03 微调第 6 项：只要露出颜色，就要带颜色名；凡是带颜色数量的地方更必须带名字，
   * 不允许只写一个色号让人去猜。页面与导出报告都走这一个函数，避免各处写法不一致。
   */
  function colorLabel(id) {
    if (!(id > 0)) return '空白(0)';
    return window.AntSolver.getColorName(id) + '(' + id + ')';
  }

  /** 「选区内颜色」统计面板（需求 §四.5 第3点）：仅在框选工具下有选区时显示，点击某色进入「区域替换」流程。 */
  function renderSelectionColorsPanel() {
    var box = $('editSelectionColors');
    var it = cur();
    if (!box) return;
    var sel = S.edit.selection;
    var cells = selCells();
    if (!it || !it.blocks || !sel || !cells) { box.innerHTML = ''; $('editSelectionInfo').innerHTML = ''; return; }
    var w = sel.c1 - sel.c0 + 1, h2 = sel.r1 - sel.r0 + 1;
    var rectN = w * h2;
    // 选区可能不规则：既报「实际选中几格」，也报外接矩形，两者不同时明确说出来，
    // 否则用户会以为工具算错了。
    $('editSelectionInfo').innerHTML = '选区实选 <b>' + cells.length + '</b> 格' +
      (cells.length !== rectN
        ? '（不规则；外接矩形 ' + w + '×' + h2 + ' = ' + rectN + ' 格）'
        : '（矩形 ' + w + '×' + h2 + '）') +
      '　行 ' + sel.r0 + '–' + sel.r1 + '，列 ' + sel.c0 + '–' + sel.c1;
    var counts = C.colorCountsInCells(it.blocks, cells);
    var total = cells.length;
    var ids = Object.keys(counts).map(Number).sort(function (a, b) { return a - b; });
    // 每项两个动作，分开放：
    //   条目主体 → 既有的「选区内替换颜色」（不动，免得破坏原有用法）；
    //   右侧「只选」→ 2026-09-15 新增的「把选区收窄成选区里的这个颜色」。
    //   后者是「区域内同色」最省力的入口：面板已经把选区里有哪些色、各多少格列出来了，
    //   点一下就等于「套索范围 ∩ 该色」，不用再切工具、也不用记叠加方式。
    var h = ids.length ? ids.map(function (id) {
      var cnt = counts[id], pct = total ? (cnt / total * 100).toFixed(1) : '0';
      var active = S.edit.replacing && S.edit.replacing.scope === 'selection' && S.edit.replacing.oldId === id;
      return '<div class="usedColorItem' + (active ? ' active' : '') + '" data-id="' + id + '" ' +
        'title="点击：只在当前选区内把该颜色替换为另一色；再点一次取消">' +
        '<i class="sw2" style="background:' + window.AntSolver.getColorCSS(id) + '"></i>' +
        '<span>' + window.AntSolver.getColorName(id) + '(' + id + ') ' + cnt + ' 像素 ' + pct + '%' +
        (active ? '　← 点其它颜色完成替换' : '') + '</span>' +
        '<button class="miniBtn pickOnly" data-pick="' + id + '" ' +
        'title="把选区收窄成「选区里的这个颜色」（' + cnt + ' 格）。Shift 加选、Alt 减选。' +
        '用来只清边缘的描边色而不动主体轮廓">只选</button>' +
        '</div>';
    }).join('') : '<div class="muted">选区内无像素</div>';
    box.innerHTML = h;
    Array.prototype.forEach.call(box.querySelectorAll('.usedColorItem'), function (el) {
      el.onclick = function (ev) {
        // 点到「只选」按钮时不要触发替换流程
        if (ev.target && ev.target.getAttribute && ev.target.getAttribute('data-pick')) return;
        startColorReplace('selection', +el.getAttribute('data-id'));
      };
    });
    Array.prototype.forEach.call(box.querySelectorAll('button[data-pick]'), function (b) {
      b.onclick = function (ev) {
        ev.stopPropagation();
        pickColorWithinSelection(+b.getAttribute('data-pick'), ev);
      };
    });
  }

  /**
   * 「只选」：把当前选区收窄成「选区 ∩ 某个颜色」。
   *
   * 这是用户 2026-09-15 需求③的直接入口。为什么需要它（实测，见
   * `_kiro临时/09.15-去毛边与同色区域选区/`）：描边色同时构成边缘杂物和主体轮廓，
   * 且在图上是碎的（熊猫图色 33 共 573 格却切成 94 块、最大块仅 89 格），
   * 于是「同色块」一次够不着整条边缘、「按色选」又会连主体轮廓一起选中。
   * 先圈范围再按色收窄，才能只清边缘：熊猫左右边缘带 ∩ 色33 = 68 格，
   * 主体腹地那 505 格描边一格不动。
   *
   * Shift/Alt 仍然生效：加选/减选的对象同样是「选区内的该色」，而不是全图该色。
   */
  function pickColorWithinSelection(colorId, ev) {
    var it = cur();
    if (!it || !it.blocks) return;
    var region = S.edit.mask;
    if (!region) { log('先框出一个范围，再点「只选」。没有范围时按色收窄没有意义（会变成全图该色）'); return; }
    var picked = C.maskFromColorInRegion(it.blocks, colorId, region);
    var n = C.maskCount(picked);
    if (!n) { log('当前选区里没有 ' + window.AntSolver.getColorName(colorId) + '(' + colorId + ')'); return; }
    var mode = combineModeOf(ev);
    var name = window.AntSolver.getColorName(colorId) + '(' + colorId + ')';
    if (mode === 'add' || mode === 'subtract') {
      // 加/减：对象是「选区内的该色」，语义上等同于在原选区基础上做局部调整
      applySelection(picked, ev, '选区内的 ' + name + ' ' + n + ' 格');
    } else {
      // 默认（含界面选的替换/交集）都收窄为「选区 ∩ 该色」——这才是「只选」的字面意思
      setSelectionMask(picked);
      draw(); refreshEditPanels(); renderExtractPanel();
      log('只选：选区已收窄为其中的 ' + name + '，' + n + ' 格' +
        '（原选区 ' + C.maskCount(region) + ' 格）。主体其它地方的同色不受影响，' +
        '接下来可在「4. 主体提取」点「挖空选区内」清掉它们');
    }
  }

  /** 靠色检查面板（需求 §四.4，固定 5 组靠色对，不自行扩展 RGB 距离规则）：全图 + 选区（若有）分别检查。 */
  function renderCloseCheckPanels() {
    var it = cur();
    var boxFull = $('editCloseCheckFull');
    if (!it || !it.blocks) { boxFull.innerHTML = ''; return; }
    var counts = colorCountsOf(it);
    var total = 0; Object.keys(counts).forEach(function (k) { total += counts[k]; });
    var hitsFull = C.checkClosePairs(counts, total);
    boxFull.innerHTML = hitsFull.length ? hitsFull.map(function (h) {
      return '<div class="closeHit"><span class="tag warn">靠色</span> ' + h.nameA + '(' + h.a + ') ' + h.countA + ' 像素 ' + h.pctA + '%　↔　' +
        h.nameB + '(' + h.b + ') ' + h.countB + ' 像素 ' + h.pctB + '%</div>';
    }).join('') : '<div class="muted">全图未命中固定靠色对</div>';

    var boxSel = $('editCloseCheckSelection');
    var cells = selCells();
    if (!cells) { boxSel.innerHTML = ''; return; }
    var countsSel = C.colorCountsInCells(it.blocks, cells);
    var hitsSel = C.checkClosePairs(countsSel, cells.length);
    boxSel.innerHTML = hitsSel.length ? hitsSel.map(function (h) {
      return '<div class="closeHit"><span class="tag warn">选区靠色</span> ' + h.nameA + '(' + h.a + ') ' + h.countA + ' 像素　↔　' +
        h.nameB + '(' + h.b + ') ' + h.countB + ' 像素</div>';
    }).join('') : '<div class="muted">选区内未命中固定靠色对</div>';
  }

  // ==================== 碎色率检查（任务 ANT-ARTTOOL-FRAGMENT-QUOTA-20260825） ====================
  // 用户 2026-08-25：「将碎色率检查接入到修图工具，用来提醒美术应该修改到什么程度」。
  //
  // 口径来自 js/fragment.js —— 它是 bin/js/generator.js 的 computeFragmentation 同源副本，
  //   所以这里显示的碎色率就是生产时【生产前置碎色闸门】会拿去判定的那个数字，不是另一套算法。
  //   一致性已用真实源图 60 张逐字段校验（差 0.00），脚本见
  //   _kiro临时/08.25-工具碎色与配额/_验碎色口径一致.js。
  //
  // 为什么不实时重算：55×55 全图一次约 0.1~0.3s（含 eliminationOrder 求消除轮次），
  //   拖动绘制时逐格重算会卡手。改为「改动后标记过期 + 手动重算」。

  var fragState = { result: null, assess: null, stale: true, key: null };

  /** 当前选定的达标阈值（0~1 比率）。下拉选"自定义"时取旁边输入框的百分比。 */
  function currentFragGate() {
    var sel = $('fragGateSel');
    var F = window.AntFragment;
    var DEF = F ? F.GATE_DEFAULT : 0.18;
    if (!sel) return DEF;
    if (sel.value === 'custom') {
      var v = parseFloat(($('fragGateCustom') || {}).value);
      if (isNaN(v) || v <= 0 || v >= 100) return DEF;
      return +(v / 100).toFixed(6);
    }
    var r = parseFloat(sel.value);
    return (isNaN(r) || r <= 0) ? DEF : r;
  }

  /**
   * 阈值改动统一入口（用户 2026-08-25：「方便美术随时可调整」）。
   * 碎色率本身与阈值无关，所以只重新 assess，不重算碎色 —— 改阈值是即时的，不用等。
   * 同时把选择记到 localStorage（只存一个数字），下次打开工具仍是上次选的值。
   */
  function onFragGateChanged() {
    var gate = currentFragGate();
    var F = window.AntFragment;
    var saved = F && F.saveGate ? F.saveGate(gate) : false;
    var tip = $('fragGateSaved');
    if (tip) tip.textContent = saved ? '已记住 ' + (gate * 100).toFixed(2) + '%' : '';
    if (fragState.result && F) {
      fragState.assess = F.assess(fragState.result, gate);
      renderFragPanel();
    }
  }

  /** 页面初始化时把上次记住的阈值恢复到控件上（没记过则用默认 18%）。 */
  function restoreFragGate() {
    var F = window.AntFragment;
    if (!F || !F.loadSavedGate) return;
    var saved = F.loadSavedGate();
    if (saved == null) return;
    var sel = $('fragGateSel');
    if (!sel) return;
    var matched = false;
    for (var i = 0; i < sel.options.length; i++) {
      if (Math.abs(parseFloat(sel.options[i].value) - saved) < 1e-9) { sel.value = sel.options[i].value; matched = true; break; }
    }
    if (!matched) {
      sel.value = 'custom';
      if ($('fragGateCustom')) {
        $('fragGateCustom').style.display = '';
        $('fragGateCustom').value = +(saved * 100).toFixed(2);
      }
    }
    var tip = $('fragGateSaved');
    if (tip) tip.textContent = '已恢复上次设置 ' + (saved * 100).toFixed(2) + '%';
  }

  /** 目标图有改动 → 把已算出的碎色率标为过期（不清空，仍显示旧值但标注"已过期"）。 */
  function markFragStale() {
    if (fragState.result) { fragState.stale = true; renderFragPanel(); }
  }

  /** 真正跑一次碎色计算。overlay 遮罩：全图计算有感知延迟，不给反馈会让人以为按钮没响应。 */
  function runFragCheck(silent) {
    var it = cur();
    var box = $('fragInfo');
    if (!box) return;
    if (!window.AntFragment) { box.innerHTML = '<div class="muted">碎色模块未加载（js/fragment.js）</div>'; return; }
    // 碎色率由 bin/js/generator.js 的 computeFragmentation 计算。若 bin 副本版本过旧（v102 之前
    // 没有这个函数），如实提示而不是静默出 0 —— 静默出 0 会让美术以为图很干净。
    if (!window.AntFragment.ready()) {
      box.innerHTML = '<div class="muted">碎色计算不可用：当前 <code>bin/js/generator.js</code> 副本里没有 ' +
        '<code>computeFragmentation</code>（该函数自主工程 v102 起提供）。请按 ' +
        '<code>关卡图修改工具/bin/来源说明.md</code> 的规程重拷一次 bin 副本。</div>';
      return;
    }
    if (!it || !it.blocks || !it.blocks.length) {
      fragState = { result: null, assess: null, stale: true, key: null };
      box.innerHTML = '<div class="muted">先导入一张目标图</div>';
      var pc0 = $('fragPerColor'); if (pc0) pc0.innerHTML = '';
      return;
    }
    var t0 = Date.now();
    var frag = window.AntFragment.computeFragmentation(it.blocks, {});
    if (!frag) { box.innerHTML = '<div class="muted">碎色计算失败（生成器模块未就绪）</div>'; return; }
    fragState.result = frag;
    fragState.assess = window.AntFragment.assess(frag, currentFragGate());
    fragState.stale = false;
    fragState.key = it.key;
    renderFragPanel();
    if (!silent) {
      var a = fragState.assess;
      log('碎色率检查：' + a.ratePct + '%（' + a.grade + '）　阈值 ' + a.limitPct + '% → ' +
        (a.pass ? '达标' : '超出 ' + a.gapPp + ' 个百分点，至少需把 ' + a.needFixPixels + ' 个碎色像素并入邻近同色块') +
        '　耗时 ' + ((Date.now() - t0) / 1000).toFixed(2) + 's');
    }
    if ($('fragHighlight') && $('fragHighlight').checked) draw();
  }

  /**
   * 渲染碎色面板。给美术的信息按「先看结论、再看该修哪里」排：
   *   达标与否 → 差多少 → 至少要救回多少像素 → 哪个颜色最碎 → 该等级的线上表现参考。
   */
  function renderFragPanel() {
    var box = $('fragInfo'), pcBox = $('fragPerColor');
    if (!box) return;
    var frag = fragState.result, a = fragState.assess;
    if (!frag || !a) { box.innerHTML = '<div class="muted">点「重新计算」查看当前目标图的碎色率</div>'; if (pcBox) pcBox.innerHTML = ''; return; }
    var it = cur();
    var otherLevel = it && fragState.key && it.key !== fragState.key;
    var staleTag = otherLevel
      ? '<span class="tag warn">这是「' + fragState.key + '」的结果，不是当前关卡</span>'
      : (fragState.stale ? '<span class="tag warn">目标图已改动，数值已过期</span>' : '');
    var verdict = a.pass
      ? '<span class="tag ok">达标</span> 已在阈值 ' + a.limitPct + '% 以内'
      : '<span class="tag warn">超标</span> 超出阈值 ' + a.gapPp + ' 个百分点';
    var rows = [
      ['碎色率', '<b style="font-size:15px" class="' + a.gradeCls + '">' + a.ratePct + '%</b>　等级 <b class="' +
        a.gradeCls + '">' + a.grade + '</b>　' + verdict + (staleTag ? '<br>' + staleTag : '')],
      ['该改到什么程度', a.pass
        ? '当前已达标，无需为碎色率继续修改。'
        : '至少要把 <b>' + a.needFixPixels + '</b> 个碎色像素并入邻近同色块（把碎色像素数从 ' +
          frag.fragPixels + ' 降到 ' + a.allowFragPixels + ' 以内）。<br>' +
          '<span class="hint">这是下界：实际把一个孤立像素接到旁边的同色块上，常会连带把同簇的其它小块一起救回，' +
          '所以真正要动的像素通常比这个数少。改完点「重新计算」看最新值。</span>'],
      ['碎色构成', '孤立块(≤' + window.AntFragment.DEFAULTS.fragmentIsoMax + '像素) ' +
        (frag.isoRate * 100).toFixed(2) + '%　小色块(≤' + window.AntFragment.DEFAULTS.fragmentSmallMax + '像素) ' +
        (frag.smallRate * 100).toFixed(2) + '%　共 ' + frag.fragBlocks + ' 个碎块 / ' + frag.blocks + ' 个色块'],
      ['最碎的单色', frag.perColor.length
        ? '<i class="sw2" style="background:' + window.AntSolver.getColorCSS(frag.perColor[0].color) + '"></i> ' +
          window.AntSolver.getColorName(frag.perColor[0].color) + '(' + frag.perColor[0].color + ')　' +
          (frag.perColor[0].rate * 100).toFixed(1) + '% 碎（' + frag.perColor[0].frag + '/' + frag.perColor[0].total + ' 像素）'
        : '—'],
      ['碎色平均消除轮次', frag.avgFragDepth + ' / 全图 ' + frag.rounds + ' 轮' +
        '<br><span class="hint">碎色落在越靠后的消除轮次，越容易在后期把订单卡住。这一项只作观察记录，不参与达标判定。</span>'],
      ['该等级的线上表现（参考）', '差关率 ' + a.gradeStats.bad + '%　严重差关率 ' + a.gradeStats.severe +
        '%　好关率 ' + a.gradeStats.good + '%' +
        '<br><span class="hint">来自 08-24 对上线 345 关的现象观察（按碎色率五等分）。' +
        '这是<b>相关性观察</b>，不是"碎色导致差关"的因果结论——差关成因是多维的，碎色只是其中一个可观测现象。</span>'],
      ['阈值来源', '<b>18%（当前采用）</b>：与生产端碎色闸门是同一个值，这里达标的图生产时不会因碎色被卡。' +
        '<br>11.47% = 新口径下按碎色率四等分后<b>好关率最高那一档(Q1)</b>的上界（好关率 32.6%、严重差关率 3.5%）。' +
        '<br>10.54% = 新口径五等分最整档上界（严重差关率仅 1.5%）。' +
        '<br>18.79% / 20.47% = 旧口径（小色块≤10）时期的 Q2 上界与差关率断点，保留为备选。' +
        '<br><span class="hint">⚠ 2026-08-25 小色块判定放宽到「小于 8 像素」后，同一张图的碎色率' +
        '比之前低约 <b>4.3 个百分点</b>（344 关实测中位 18.92% → 14.53%），' +
        '所以 <b>18% 在新口径下比较宽松</b>：放过约 79% 的图，过闸集的好关率 28.7% 已接近全样本基础率 27.0%。' +
        '想要原来那种筛选强度，选 11.47%。' +
        '<br>口径与生产端<b>同源</b>（js/fragment.js 直接调用 bin/js/generator.js 的同一个函数），' +
        '两边算出来的碎色率必然是同一个数。</span>']
    ];
    box.innerHTML = kvTable(rows);

    if (pcBox) {
      var top = frag.perColor.filter(function (x) { return x.frag > 0; }).slice(0, 10);
      // 2026-08-25 起分色明细与画布高亮都取自正式函数的块级明细，与碎色率同口径
      //   （此前是包装层按块大小近似，会把视觉上连续的条带误标，用户实机发现后已修）。
      var apNote = frag.detailUnavailable
        ? '<div class="hint">⚠ 当前 bin 副本版本较旧，取不到块级明细，分色明细与高亮暂不可用。' +
          '请按 <code>关卡图修改工具/bin/来源说明.md</code> 重拷一次 bin 副本。</div>'
        : '<div class="hint">分色明细与画布高亮与上方碎色率<b>同口径</b>：已经把"靠得够近、' +
          '并簇后总量够大"的小块救回了，所以这里标出来的都是<b>正式判定为碎色</b>的像素，' +
          '视觉上连续的条带不会被误标。</div>';
      pcBox.innerHTML = top.length
        ? '<div class="editSubhead">分色碎色明细（碎色率降序，先修排在前面的）</div>' + apNote +
          top.map(function (x) {
            return '<div class="closeHit"><i class="sw2" style="background:' + window.AntSolver.getColorCSS(x.color) + '"></i> ' +
              window.AntSolver.getColorName(x.color) + '(' + x.color + ')　碎 ' + x.frag + ' / 共 ' + x.total +
              ' 像素　<b>' + (x.rate * 100).toFixed(1) + '%</b></div>';
          }).join('')
        : '<div class="muted">没有碎色像素</div>';
    }
  }

  /**
   * 汇总刷新编辑相关的全部面板（每次改色/替换/框选变化后统一调用）。
   * 色库的「已有颜色 / 未使用颜色」分组就在 renderEditPalette 里重新识别，
   * 所以只要走到这里，分组一定跟着目标图当前内容刷新（需求 08.03 §二.3）。
   * 原来的「当前目标图颜色」独立面板已按需求删除，其全局替换入口搬进了色库边框内。
   */
  function refreshEditPanels() {
    renderEditPalette();
    renderSelectionColorsPanel();
    renderCloseCheckPanels();
    renderExtractPanel();
    // 碎色率不跟着每次落笔重算：55×55 全图一次约 0.1~0.3s（含消除轮次），
    //   拖动绘制时逐格重算会明显卡手。改为标记「已过期」，由用户点「重新计算」或松开笔刷后手动触发。
    markFragStale();
  }

  function toggleEditMode(on) {
    var it = cur();
    S.edit.on = on;
    $('cv').classList.toggle('editing', on);
    if (!it) return;
    if (on) {
      if (!S.edit.original) S.edit.original = JSON.parse(JSON.stringify(it.blocks));
      var toolCN = { paint: '拖动绘制', select: '矩形框选', lasso: '套索', region: '同色块', color: '按色选' };
      log('编辑模式已开启：当前工具「' + (toolCN[S.edit.tool] || S.edit.tool) + '」，' +
        (S.edit.eraser ? '当前是橡皮擦（落笔写空位 0）' : '当前颜色 ' + colorLabel(S.edit.color)) +
        '。快捷键：Ctrl/⌘+Z 撤销、Esc 取消选区、Alt+点击取色、Ctrl/⌘+滚轮缩放');
    } else {
      if (S.edit.paintDragging) endStroke();
      S.edit.dragging = false; S.edit.paintDragging = false; S.edit.replacing = null;
      S.edit.lassoPath = null; S.edit.lastPaintCell = null;
      renderReplaceStatus();
      log('编辑模式已关闭');
    }
    syncCanvasToolClass();
    refreshEditPanels();
    draw();
  }

  /** 落笔的「生效颜色」：勾了橡皮擦就是 0（空位），否则是色库里选的颜色。 */
  function effectiveEditColor() { return S.edit.eraser ? 0 : S.edit.color; }

  /**
   * 吸管：把光标下这一格的颜色取成当前绘制色（Alt + 点击画布，2026-10-30 新增）。
   * 以前要从画上取一个色只能去色库里凭眼睛找，34 个色块里认错是常事。
   */
  function pickColorAt(p) {
    var it = cur();
    if (!it || !it.blocks) return;
    var rows = it.blocks.length, cols = it.blocks[0].length;
    if (p.r < 0 || p.c < 0 || p.r >= rows || p.c >= cols) return;
    var id = it.blocks[p.r][p.c];
    if (!(id > 0)) { log('吸管：行 ' + p.r + ' 列 ' + p.c + ' 是空位（0），颜色不变'); return; }
    S.edit.eraser = false;
    if ($('optErase')) $('optErase').checked = false;
    S.edit.color = id;
    renderEditPalette();
    log('吸管取色：' + colorLabel(id) + '（行 ' + p.r + ' 列 ' + p.c + '）');
    $('readout').textContent = '吸管取色：' + colorLabel(id) + '　行 ' + p.r + ' 列 ' + p.c;
  }

  /** 开始一笔：这一笔的改动先攒在 strokeBatch 里。 */
  function beginStroke() { S.edit.strokeBatch = []; }

  /**
   * 结束一笔：并入撤销栈（一笔 = 一次撤销）。
   * 2026-10-30 前是每个 mousemove 各推一个批次 —— 使用说明写「一次拖动算一批」，
   * 实测拖 6 格后点一次「撤销」只退回 1 格，与实际不符。
   */
  function endStroke() {
    var b = S.edit.strokeBatch;
    S.edit.strokeBatch = null;
    S.edit.lastPaintCell = null;
    if (!b || !b.length) return;
    S.edit.undoStack.push(b);
    S.edit.redoStack = [];          // 新的一笔作废重做
    var it = cur();
    if (it) it._editedAt = new Date().toISOString();
    $('btnEditUndo').disabled = false;
    $('btnEditReset').disabled = false;
  }

  /** 落笔批量应用：记一次撤销批次，刷新画面与统计。 */
  function editApplyColor(cells) {
    var it = cur();
    if (!it || !cells.length) return;
    var color = effectiveEditColor();
    var rows = it.blocks.length, cols = it.blocks[0].length;
    var batch = [];
    for (var i = 0; i < cells.length; i++) {
      var r = cells[i].r, c = cells[i].c;
      if (r < 0 || c < 0 || r >= rows || c >= cols) continue;   // 拖出画布时的越界保护
      var before = it.blocks[r][c];
      if (before === color) continue;
      it.blocks[r][c] = color;
      batch.push({ r: r, c: c, before: before, after: color });
    }
    if (!batch.length) return;
    if (S.edit.strokeBatch) S.edit.strokeBatch = S.edit.strokeBatch.concat(batch);
    else {
      S.edit.undoStack.push(batch);
      S.edit.redoStack = [];
      $('btnEditUndo').disabled = false;
      $('btnEditReset').disabled = false;
    }
    it._editedAt = new Date().toISOString();     // 记录修改时间，供导出报告注明
    draw();
    renderEditInfo();
    refreshEditPanels();
  }

  /**
   * 拖动插值：上一格 → 当前格之间被指针跳过的格子（Bresenham，含两端）。
   * 2026-10-30：鼠标指针快时两帧之间会跳好几格，只画当前格会断线（实测拖 6 格只改 2 格）。
   */
  function lineCells(a, b) {
    var out = [], r = a.r, c = a.c;
    var dr = Math.abs(b.r - a.r), dc = Math.abs(b.c - a.c);
    var sr = a.r < b.r ? 1 : -1, sc = a.c < b.c ? 1 : -1, err = dr - dc;
    for (;;) {
      out.push({ r: r, c: c });
      if (r === b.r && c === b.c) break;
      var e2 = err * 2;
      if (e2 > -dc) { err -= dc; r += sr; }
      if (e2 < dr) { err += dr; c += sc; }
    }
    return out;
  }

  /** 没进编辑模式就点画布：闪一下边框 + 记一条日志（6 秒内只记一次，别刷屏）。 */
  function hintNeedEditMode() {
    var cv = $('cv');
    if (cv) {
      cv.classList.add('needEdit');
      setTimeout(function () { cv.classList.remove('needEdit'); }, 1200);
    }
    if (Date.now() - (S.edit.hintAt || 0) < 6000) return;
    S.edit.hintAt = Date.now();
    log('画布还没进入编辑状态：先勾选上方「开启编辑模式」再落笔（只选色不改图的话不用开）。');
  }

  /**
   * 进入替换流程：记住要替换哪个颜色（全局或选区内），等待用户在色库里点目标色完成替换。
   * 再点同一个替换按钮 = 取消（切换语义），避免误触后卡在待替换状态。
   */
  function startColorReplace(scope, oldId) {
    if (!cur()) return;
    var rp = S.edit.replacing;
    if (rp && rp.scope === scope && rp.oldId === oldId) { cancelColorReplace('再次点击同一个替换按钮'); return; }
    S.edit.replacing = { scope: scope, oldId: oldId };
    log((scope === 'global' ? '整图替换' : '选区内替换') + '：请点击你要换成的颜色，把 ' +
      window.AntSolver.getColorName(oldId) + '(' + oldId + ') 换掉。' +
      '不想换了就点空白处、按 Esc、或再点一次这个替换按钮。');
    renderReplaceStatus();
    refreshEditPanels();
  }

  /**
   * 取消待替换状态（用户 2026-08-03 微调第 2 项）。
   * 触发方式有四种：点空白处、点目标图、按 Esc、再点一次同一个替换按钮。
   * 取消不产生任何像素改动，因此**不需要用撤销来回退**——这正是本次要解决的问题。
   */
  function cancelColorReplace(how) {
    if (!S.edit.replacing) return;
    var old = S.edit.replacing.oldId;
    S.edit.replacing = null;
    renderReplaceStatus();
    refreshEditPanels();
    log('已取消替换 ' + window.AntSolver.getColorName(old) + '(' + old + ')' +
      (how ? '（' + how + '）' : '') + '，目标图没有任何改动。');
  }

  /** 待替换状态条：把「现在正等你点目标色」这件事显式摆出来，并给一个取消按钮。 */
  function renderReplaceStatus() {
    var box = $('editReplaceStatus');
    if (!box) return;
    var rp = S.edit.replacing;
    if (!rp) { box.style.display = 'none'; box.innerHTML = ''; return; }
    var name = window.AntSolver.getColorName(rp.oldId);
    box.style.display = '';
    box.innerHTML = '<i class="sw2" style="background:' + window.AntSolver.getColorCSS(rp.oldId) + '"></i>' +
      '<span>正在' + (rp.scope === 'global' ? '整图替换' : '选区内替换') + '：' + name + '(' + rp.oldId + ')' +
      '　请点击你要换成的颜色</span>' +
      '<button id="btnCancelReplace" class="btn tiny">取消替换</button>' +
      '<span class="muted">也可以点空白处或按 Esc 取消</span>';
    var b = $('btnCancelReplace');
    if (b) b.onclick = function (ev) { ev.stopPropagation(); cancelColorReplace('点了取消按钮'); };
  }

  /** 完成替换：把 replacing.oldId 替换为 newId（全局或仅选区内），记一次撤销批次。 */
  function performColorReplace(newId) {
    var it = cur();
    var rp = S.edit.replacing;
    if (!it || !rp) return;
    if (newId === rp.oldId) { cancelColorReplace('点回了原来那个颜色'); return; }   // 点回原色 = 取消
    // 走 selCells()（掩码）而不是外接矩形：套索/同色块的选区是不规则的，
    // 按矩形替换会连「矩形内但选区外」的像素一起改掉。
    var cells = rp.scope === 'selection' ? selCells() : null;   // null = 全局（内部遍历全图）
    var result = C.replaceColorInBlocks(it.blocks, rp.oldId, newId, cells);
    if (result.count > 0) {
      var batch = result.cells.map(function (p) { return { r: p.r, c: p.c, before: rp.oldId, after: newId }; });
      S.edit.undoStack.push(batch);
      $('btnEditUndo').disabled = false;
      $('btnEditReset').disabled = false;
      log((rp.scope === 'global' ? '全局' : '选区内') + '替换完成：' + window.AntSolver.getColorName(rp.oldId) + '(' + rp.oldId + ') → ' +
        window.AntSolver.getColorName(newId) + '(' + newId + ')，共 ' + result.count + ' 像素');
    } else {
      log('替换范围内没有找到该颜色，未作改动');
    }
    S.edit.replacing = null;
    renderReplaceStatus();
    draw();
    renderEditInfo();
    refreshEditPanels();
  }

  /** 把一批像素改动按 before/after 写回去。 */
  function applyEditBatch(it, batch, dir) {
    for (var i = 0; i < batch.length; i++) {
      it.blocks[batch[i].r][batch[i].c] = (dir === 'after') ? batch[i].after : batch[i].before;
    }
  }

  function editUndo() {
    var it = cur();
    if (!it || !S.edit.undoStack.length) return;
    if (S.edit.strokeBatch) { log('正在画这一笔：松开鼠标后再撤销。'); return; }
    var batch = S.edit.undoStack.pop();
    applyEditBatch(it, batch, 'before');
    S.edit.redoStack.push(batch);          // 2026-10-30：撤销后可重做（Ctrl/⌘+Shift+Z 或 Ctrl+Y）
    $('btnEditUndo').disabled = S.edit.undoStack.length === 0;
    draw();
    renderEditInfo();
    refreshEditPanels();
  }

  /** 重做（2026-10-30 新增）：把最近一次撤销的那一笔按 after 写回来。 */
  function editRedo() {
    var it = cur();
    if (!it || !S.edit.redoStack.length) { log('没有可重做的改动。'); return; }
    var batch = S.edit.redoStack.pop();
    applyEditBatch(it, batch, 'after');
    S.edit.undoStack.push(batch);
    $('btnEditUndo').disabled = false;
    $('btnEditReset').disabled = false;
    draw();
    renderEditInfo();
    refreshEditPanels();
    log('重做一步（Ctrl/⌘+Shift+Z）');
  }

  function editReset() {
    var it = cur();
    if (!it || !S.edit.original) return;
    it.blocks = JSON.parse(JSON.stringify(S.edit.original));
    S.edit.undoStack = []; S.edit.redoStack = [];
    S.edit.strokeBatch = null; S.edit.lastPaintCell = null;
    clearSelection(); S.edit.replacing = null;
    $('btnEditUndo').disabled = true;
    draw();
    renderEditInfo();
    refreshEditPanels();
    log('已还原为原图');
  }

  /** 清除选区（不撤销已做的像素改动，只是取消框选范围本身）。 */
  function editClearSelection() {
    // 必须走 clearSelection() 一并清掉 mask —— 只清 selection(外接矩形) 会留下掩码，
    // 界面上选区消失了但「只在选区内绘制」「剔除」仍按旧掩码生效，是很难查的错。
    clearSelection();
    S.edit.replacing = null;
    draw();
    refreshEditPanels();
  }

  /**
   * 编辑改动统计（已改动像素 / 总量守恒 / 逐色变化）。
   * 用户 2026-08-03 微调：这块固定放在目标图旁边，可点「悬浮」拖到任意位置；提示文字按要求去掉。
   * 2026-10-30：位置改到画布下方的参数区（布局改版）。
   * 逐色变化按要求带上中文颜色名（凡是出现颜色数量的地方都必须能看出是哪个颜色）。
   */
  function renderEditInfo() {
    var it = cur();
    var box = $('editInfo');
    if (!box) return;
    if (!it || !S.edit.original) { box.innerHTML = '<div class="muted">还没有改动。</div>'; return; }
    var d = C.diffBlocks(S.edit.original, it.blocks);
    var rows = [
      ['已改动像素', d.changedPixelCount + ' 个'],
      ['总量守恒', d.totalConserved ? '<span class="tag ok">守恒</span> ' + d.totalBefore + ' → ' + d.totalAfter
        : '<span class="tag warn">不一致</span> ' + d.totalBefore + ' → ' + d.totalAfter]
    ];
    var perColorLines = [];
    Object.keys(d.perColor).forEach(function (k) {
      var pc = d.perColor[k];
      if (pc.delta === 0) return;
      perColorLines.push('<i class="sw2" style="background:' + window.AntSolver.getColorCSS(+k) + '"></i> ' +
        window.AntSolver.getColorName(+k) + '(' + k + ')：' + pc.before + '→' + pc.after +
        '（' + (pc.delta > 0 ? '+' : '') + pc.delta + '）');
    });
    if (perColorLines.length) rows.push(['逐色变化', perColorLines.join('<br>')]);
    box.innerHTML = kvTable(rows);
  }

  function exportEditedTxt() {
    var it = cur();
    if (!it || !it.blocks) { log('没有可导出的目标图'); return; }
    var txt = C.serializeTxt(it.blocks);
    download(it.key + (S.edit.original ? '_已修改' : '') + '.txt', new Blob([txt], { type: 'text/plain' }));
    log('已导出目标图 TXT' + (S.edit.original ? '（含改动）' : ''));
  }

  function exportEditReport() {
    var it = cur();
    if (!it || !S.edit.original) { log('尚未做任何编辑，无对比可导出'); return; }
    var d = C.diffBlocks(S.edit.original, it.blocks);
    var lines = [
      '# ' + it.key + ' 美术编辑对比报告',
      '',
      '- 已改动像素：' + d.changedPixelCount + ' 个',
      '- 总量守恒：' + (d.totalConserved ? '守恒（' + d.totalBefore + ' → ' + d.totalAfter + '）' : '不一致（' + d.totalBefore + ' → ' + d.totalAfter + '）'),
      '- 重构策略：本版本（阶段二基础版）未接入自动重构，改动只落在目标图 TXT',
      '',
      '## 逐色变化',
      ''
    ];
    Object.keys(d.perColor).forEach(function (k) {
      var pc = d.perColor[k];
      // 报告里凡是出现颜色数量的地方都带上中文颜色名（用户 2026-08-03 微调第 6 项）
      lines.push('- ' + colorLabel(+k) + '：' + pc.before + ' → ' + pc.after + '（' + (pc.delta > 0 ? '+' : '') + pc.delta + '）');
    });
    lines.push('', '## 改动像素坐标（行,列：原色→新色）', '');
    d.changedPixels.forEach(function (p) {
      lines.push('- (' + p.r + ',' + p.c + ')：' + colorLabel(p.from) + ' → ' + colorLabel(p.to));
    });
    download(it.key + '_编辑对比报告.md', new Blob([lines.join('\n') + '\n'], { type: 'text/markdown' }));
    log('已导出编辑对比报告');
  }

  // ==================== 完整导出打包（ZIP） ====================
  // bin/js/zip.js（AntSolver.Zip）只支持纯文本条目（内部用 TextEncoder 编码），
  // 完整导出需要打包 PNG（二进制），故本工具自行实现一个同样走 store（不压缩）格式的二进制 ZIP 打包函数。
  // 这不是游戏算法，是通用的归档打包工具，写在 app.js 里（只在页面用，不需要放进 core.js 的口径层）。
  // ZIP 格式与 bin/js/zip.js 完全一致（本地文件头 + 中央目录 + EOCD，CRC32 表也用同一套标准算法），
  // 唯一区别是条目内容既支持字符串（自动转 UTF-8 字节）也支持 Uint8Array（PNG 等二进制直接收）。

  var ZIP_CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function zipCrc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = ZIP_CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  /** files: [{name, bytes:Uint8Array}] 或 [{name, text:string}]（二选一） */
  function zipCreateBinary(files) {
    var chunks = [], central = [], offset = 0;
    files.forEach(function (f) {
      var nameBytes = new TextEncoder().encode(f.name);
      var data = f.bytes ? f.bytes : new TextEncoder().encode(f.text || '');
      var crc = zipCrc32(data), size = data.length;
      var lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true);
      lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
      lh.setUint16(8, 0, true); lh.setUint16(10, 0, true); lh.setUint16(12, 0, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, size, true); lh.setUint32(22, size, true);
      lh.setUint16(26, nameBytes.length, true); lh.setUint16(28, 0, true);
      chunks.push(new Uint8Array(lh.buffer), nameBytes, data);

      var ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true);
      ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
      ch.setUint16(10, 0, true); ch.setUint16(12, 0, true); ch.setUint16(14, 0, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, size, true); ch.setUint32(24, size, true);
      ch.setUint16(28, nameBytes.length, true); ch.setUint16(30, 0, true); ch.setUint16(32, 0, true);
      ch.setUint16(34, 0, true); ch.setUint16(36, 0, true); ch.setUint32(38, 0, true);
      ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), nameBytes);
      offset += 30 + nameBytes.length + size;
    });
    var centralSize = central.reduce(function (s, a) { return s + a.length; }, 0);
    var eocd = new DataView(new ArrayBuffer(22));
    eocd.setUint32(0, 0x06054b50, true);
    eocd.setUint16(4, 0, true); eocd.setUint16(6, 0, true);
    eocd.setUint16(8, files.length, true); eocd.setUint16(10, files.length, true);
    eocd.setUint32(12, centralSize, true); eocd.setUint32(16, offset, true);
    eocd.setUint16(20, 0, true);
    return new Blob(chunks.concat(central, [new Uint8Array(eocd.buffer)]), { type: 'application/zip' });
  }

  /** 把当前 canvas 的当前画面转成 PNG 的 Uint8Array（供打包用；比 toBlob 更方便同步收集多张图）。 */
  function kb(chars) { return (chars / 1024).toFixed(0) + ' KB'; }

  // 导出文件名带时间戳：同一关多次导出会得到不同文件名，新导出不会覆盖旧导出（需求 §七第7点）。
  function exportStamp() {
    var d = new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return String(d.getFullYear()) + p(d.getMonth() + 1) + p(d.getDate()) + '-' +
      p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }

  /** 鼠标事件 → 图纸格坐标。允许越界，调用方自行判断。 */
  function eventToCell(ev, it) {
    var cell = parseInt($('cellSize').value, 10) || 11;
    var rect = $('cv').getBoundingClientRect();
    return {
      r: Math.floor((ev.clientY - rect.top) / cell),
      c: Math.floor((ev.clientX - rect.left) / cell)
    };
  }

  /** 鼠标事件 → 夹取到图纸范围内的格坐标（用于开始拖拽，越界不让拖飞）。 */
  function eventToCellClamped(ev, it) {
    var cell = parseInt($('cellSize').value, 10) || 11;
    var rect = $('cv').getBoundingClientRect();
    var rows = it.blocks.length, cols = it.blocks[0].length;
    var c = Math.floor((ev.clientX - rect.left) / cell), r = Math.floor((ev.clientY - rect.top) / cell);
    r = Math.max(0, Math.min(rows - 1, r)); c = Math.max(0, Math.min(cols - 1, c));
    return { r: r, c: c };
  }

  function normalizeRect(a, b) {
    return { r0: Math.min(a.r, b.r), c0: Math.min(a.c, b.c), r1: Math.max(a.r, b.r), c1: Math.max(a.c, b.c) };
  }

  function inRect(p, rect) { return p.r >= rect.r0 && p.r <= rect.r1 && p.c >= rect.c0 && p.c <= rect.c1; }

  /* ==================== 选区（掩码）助手 ====================
   * 任务 ANT-ARTTOOL-SUBJECT-EXTRACT-20260902
   *
   * 为什么要这一层：原来选区只有矩形，`S.edit.selection` 就够用。新增套索/同色块/按色选之后
   * 选区可能是任意形状，矩形表达不了。做法是：
   *   · `S.edit.mask` 成为选区**权威**；
   *   · `S.edit.selection` 继续维护，但语义收窄为「mask 的外接矩形」，只供既有面板显示尺寸用；
   *   · 所有「取选区内格子」的地方统一走 `selCells()`，不再直接 `cellsInRect(selection)`。
   * 这样既支持不规则选区，又不必把既有三处显示逻辑全部重写。
   */

  /** 按当前工具给画布加样式类（CSS 里 #cv.selecting / #cv.lassoing 会描边提示）。 */
  function syncCanvasToolClass() {
    var cv = $('cv');
    if (!cv) return;
    var t = S.edit.on ? S.edit.tool : null;
    cv.classList.toggle('selecting', t === 'select' || t === 'region' || t === 'color');
    cv.classList.toggle('lassoing', t === 'lasso');
  }

  /** 当前选区掩码（可能为 null）。 */
  function selMask() { return S.edit.mask; }

  /** 当前选区的格子 [{r,c}]；没有选区返回 null（调用方按「全图」处理，与改动前一致）。 */
  function selCells() {
    var m = S.edit.mask;
    if (!m) return null;
    return C.maskToCells(m);
  }

  /** 选区格数（不含「原图这格是不是 0」的判断，纯粹是选了多少格）。 */
  function selCount() { return S.edit.mask ? C.maskCount(S.edit.mask) : 0; }

  /**
   * 设置选区掩码，并把 `S.edit.selection` 同步成它的外接矩形。
   * 传 null = 清空选区。
   */
  function setSelectionMask(m) {
    if (!m || C.maskCount(m) === 0) {
      S.edit.mask = null; S.edit.selection = null; return;
    }
    S.edit.mask = m;
    // 外接矩形：给既有面板显示「选区 W×H / 行 a–b 列 c–d」用。
    var r0 = -1, c0 = -1, r1 = -1, c1 = -1;
    for (var i = 0; i < m.bits.length; i++) {
      if (!m.bits[i]) continue;
      var r = Math.floor(i / m.cols), c = i % m.cols;
      if (r0 < 0 || r < r0) r0 = r;
      if (c0 < 0 || c < c0) c0 = c;
      if (r > r1) r1 = r;
      if (c > c1) c1 = c;
    }
    S.edit.selection = { r0: r0, c0: c0, r1: r1, c1: c1 };
  }

  /** 鼠标事件 → 掩码合成方式：Shift 加选、Alt 减选，都不按就是替换。 */
  /**
   * 这次选取要怎么并进当前选区。
   *
   * 优先级：**修饰键 > 界面单选**。理由：
   *   - 界面单选（2026-09-15 新增）让「交集」可见可发现 —— 上一轮只做 Shift/Alt 隐式快捷键，
   *     用户反馈里明确说「shift和alt的加减工具只能加减不同的颜色」，说明隐藏的组合键既难发现、
   *     也表达不了「区域内同色」这种需要第三种运算的意图；
   *   - 但已经习惯 Shift/Alt 的手感不能破坏，所以按住修饰键时**临时覆盖**界面选择，松手即恢复。
   *
   * 没有给「交集」配修饰键：mac 上 Ctrl+click 会被系统当右键菜单，Cmd 与浏览器快捷键冲突，
   * 两者都不适合当拖拽期间长按的键。交集只走界面单选。
   */
  function combineModeOf(ev) {
    if (ev && ev.shiftKey) return 'add';
    if (ev && (ev.altKey || ev.metaKey)) return 'subtract';
    return selCombineMode();
  }

  /** 界面上「叠加方式」单选的当前值；控件不存在时回退 replace（与本功能上线前的行为一致）。 */
  function selCombineMode() {
    var el = document.querySelector('input[name="selCombine"]:checked');
    var v = el ? el.value : 'replace';
    return (v === 'add' || v === 'subtract' || v === 'intersect') ? v : 'replace';
  }

  /** 把一个新掩码按 Shift/Alt 合成进当前选区。 */
  function applySelection(newMask, ev, label) {
    var mode = combineModeOf(ev);

    // 「交集」在没有当前选区时是个陷阱：maskCombine 的 base=null 分支会直接返回新掩码，
    // 于是「交集 + 按色选」会静默变成**全图该色**——正好是用户想避免的那个结果
    // （实测熊猫图深灰全图 573 格，主体轮廓 505 格会被一起选中）。
    // 与其让它悄悄退化，不如明确拒绝并说清下一步该干什么，选区保持原样不动。
    if (mode === 'intersect' && !S.edit.mask) {
      log('⚠ 叠加方式是「交集」，但当前还没有选区 —— 交集需要先有一个范围才能相交。' +
        '请先用套索或矩形框出要清理的一带，再用这次的选法取交集。（本次未改动选区）');
      return;
    }

    var merged;
    try {
      merged = C.maskCombine(S.edit.mask, newMask, mode);
    } catch (e) {
      // 尺寸不一致：通常是换了关卡但选区没清。如实提示并清掉旧选区，不静默算错。
      log('选区尺寸与当前图不一致（' + e.message + '），已清空旧选区');
      merged = newMask;
    }
    var before = selCount();
    setSelectionMask(merged);
    draw();
    refreshEditPanels();
    renderExtractPanel();
    var n = selCount();
    log((label || '选区') + '：' +
      (mode === 'add' ? '加选' : mode === 'subtract' ? '减选' :
        mode === 'intersect' ? '取交集（' + before + ' → ' + n + ' 格）' : '设定') +
      ' → 当前共 ' + n + ' 格' + (n ? '（' + selRectText() + '）' : ''));
    if (mode === 'intersect' && n === 0) {
      log('　交集为空：这次选的东西与原选区没有重叠部分。选区已变空，可点「取消选区」重来。');
    }
  }

  function selRectText() {
    var s = S.edit.selection;
    if (!s) return '无选区';
    return '行 ' + s.r0 + '–' + s.r1 + '，列 ' + s.c0 + '–' + s.c1 +
      '，外接 ' + (s.c1 - s.c0 + 1) + '×' + (s.r1 - s.r0 + 1);
  }

  /** 清空选区（含套索轨迹与拖拽态）。 */
  function clearSelection() {
    S.edit.mask = null; S.edit.selection = null;
    S.edit.lassoPath = null; S.edit.dragging = false;
    S.edit.dragStart = null; S.edit.dragCurrent = null;
  }

  /**
   * 编辑模式下的画布交互（2026-08-03 微调后）：
   *   工具「拖动绘制」（默认，取代原来的「点选改色」）：按下即落笔，按住拖动连续改色，松开结束。
   *     单击一下仍然只改一格，所以原来点一格改一格的用法没有丢。
   *   工具「框选编辑」：拖拽用于定义/重新定义矩形选区。
   *   「只在选区内绘制」开关已上移到工具行，两种工具下都生效：勾上且已有选区时，
   *     落笔一律限制在选区内，选区外像素不受影响；此时框选工具下的拖拽也变成在选区内绘制。
   *   待替换状态下点画布 = 取消替换而不落笔，避免误触后只能靠撤销回退。
   */
  /** 全选（Ctrl/⌘+A）。 */
  function selectAllCells() {
    var it = cur();
    if (!it || !it.blocks) return;
    if (!S.edit.on) { log('先在「3. 美术编辑」勾上「开启编辑模式」再全选。'); return; }
    var rows = it.blocks.length, cols = it.blocks[0].length;
    setSelectionMask(C.maskFromRect(rows, cols, 0, 0, rows - 1, cols - 1));
    draw(); refreshEditPanels(); renderExtractPanel();
    log('已全选（' + rows + '×' + cols + '，' + selCount() + ' 格）。Ctrl/⌘+D 可取消。');
  }

  /** 缩放一档（Ctrl/⌘ + / -），以画布中心为锚点。 */
  function zoomBy(delta) {
    var cv = $('cv');
    if (!cv) return;
    var old = parseInt($('cellSize').value, 10) || 11;
    var next = Math.max(4, Math.min(24, old + delta));
    if (next === old) return;
    var r = cv.getBoundingClientRect();
    zoomAt(next, r.left + r.width / 2, r.top + r.height / 2);
  }

  /** 按 name 切换编辑工具（供快捷键用），与点单选按钮走同一套副作用。 */
  function setEditTool(tool) {
    var r = document.querySelector('input[name="editTool"][value="' + tool + '"]');
    if (!r) return;
    r.checked = true;
    if (r.onchange) r.onchange();
  }

  /** 当前是否只允许在选区内落笔（开关已上移到工具行，两种工具下都生效）。 */
  function paintLimitedToSelection() {
    var el = $('editPaintInSelection');
    return !!(el && el.checked && S.edit.mask);
  }
  /**
   * 落笔前的选区过滤：限制在选区内时，选区外一律不改（选区外像素不受影响）。
   *
   * ⚠ 本轮起按 **掩码** 判定而不是外接矩形。套索/同色块选出来的是不规则形状，
   * 若按外接矩形判，会允许在「矩形内但选区外」的地方落笔 —— 那是错的。
   */
  function paintAllowed(p) {
    if (!p) return false;
    if (!paintLimitedToSelection()) return true;
    var m = S.edit.mask;
    if (m) return C.maskHas(m, p.r, p.c);
    var s = S.edit.selection;
    return !!s && inRect(p, { r0: s.r0, c0: s.c0, r1: s.r1, c1: s.c1 });
  }

  function onCanvasMouseDown(ev) {
    var it = cur();
    // 2026-10-30：没开编辑模式就点画布，改前是【完全没反应】（不改色、无提示、无日志），
    // 用户会以为工具坏了。现在闪一下画布边框 + 记一条日志。
    if (!S.edit.on) {
      if (it && it.blocks) hintNeedEditMode();
      return;
    }
    if (!it || !it.blocks) return;
    // 待替换状态下点画布 = 取消替换，不落笔。避免误触替换后又在图上乱点、只能靠撤销回退。
    if (S.edit.replacing) { cancelColorReplace('在目标图上点击'); return; }

    // ===== 主体提取的三种新选法（任务 ANT-ARTTOOL-SUBJECT-EXTRACT-20260902）=====
    // 这三种都是「一次点击即出选区」或「拖出轨迹」，不落笔改色，所以放在绘制分支之前。
    var rowsN = it.blocks.length, colsN = it.blocks[0] ? it.blocks[0].length : 0;
    if (S.edit.tool === 'region') {
      var pr = eventToCell(ev, it);
      if (!pr) return;
      applySelection(C.maskFromSameColorRegion(it.blocks, pr.r, pr.c), ev,
        '同色块 (' + pr.r + ',' + pr.c + ') 色' + it.blocks[pr.r][pr.c]);
      return;
    }
    if (S.edit.tool === 'color') {
      var pc = eventToCell(ev, it);
      if (!pc) return;
      var cid = it.blocks[pc.r][pc.c];
      applySelection(C.maskFromColor(it.blocks, cid), ev, '按色选 色' + cid);
      return;
    }
    if (S.edit.tool === 'lasso') {
      var pl = eventToCellClamped(ev, it);
      S.edit.dragging = true;
      S.edit.lassoPath = [pl];
      S.edit.dragStart = pl; S.edit.dragCurrent = pl;
      draw();
      return;
    }
    // 2026-10-30：框选工具永远框选。改前勾着「只在选区内绘制」时，框选工具拖拽会变成画笔
    // （2026-08-03 的既定行为），但界面上看不出来，几乎每次都要误画一笔再去撤销 —— 不符合习惯。
    // 想在选区里补画，请用「拖动绘制」工具，那个仍然受「只在选区内绘制」约束。
    if (S.edit.tool === 'select') {
      var p0 = eventToCellClamped(ev, it);
      S.edit.dragging = true; S.edit.lassoPath = null;
      S.edit.dragStart = p0; S.edit.dragCurrent = p0;
      draw();
      return;
    }
    // 拖动绘制（默认工具）：按下即落笔并进入拖拽状态，移动时连续改色。
    // 原「点选改色」工具已按用户 2026-08-03 微调要求删除，改色一律走拖动绘制这一套。
    var p = eventToCell(ev, it);
    if (!p) return;
    // Alt + 点击 = 吸管取色（2026-10-30）。放在落笔之前，所以取色这一下不会改图。
    if (ev.altKey) { pickColorAt(p); return; }
    if (!paintAllowed(p)) return;
    beginStroke();
    S.edit.paintDragging = true;
    S.edit.lastPaintCell = p;
    editApplyColor([{ r: p.r, c: p.c }]);
  }

  function onCanvasMouseMove(ev) {
    if (!S.edit.on) return;
    var it = cur();
    if (!it || !it.blocks) return;
    if (S.edit.dragging) {
      var pm = eventToCellClamped(ev, it);
      S.edit.dragCurrent = pm;
      // 套索：把移动轨迹逐格记下来。同一格连续移动不重复 push，否则轨迹会膨胀到几千点、
      // 射线法逐点算会明显卡（20×20 的图不明显，55×55 会）。
      // 2026-10-30：与画笔同一个毛病 —— 指针快时两帧之间跳好几格，轨迹会只剩几个稀疏点，
      // 闭合成多边形后选出来的形状是残缺的。这里补上中间格（Bresenham）。
      if (S.edit.lassoPath) {
        var last = S.edit.lassoPath[S.edit.lassoPath.length - 1];
        if (!last) S.edit.lassoPath.push(pm);
        else if (last.r !== pm.r || last.c !== pm.c) {
          var seg = lineCells(last, pm);
          for (var si = 1; si < seg.length; si++) S.edit.lassoPath.push(seg[si]);
        }
      }
      draw();
      return;
    }
    if (!S.edit.paintDragging) return;
    var p = eventToCell(ev, it);
    if (!p) return;
    // 2026-10-30：指针跳格会断线。从上一格补到当前格，每格都过一遍「只在选区内绘制」的限制。
    var last = S.edit.lastPaintCell;
    var seg = last ? lineCells(last, p) : [p];
    S.edit.lastPaintCell = p;
    var cells = [];
    for (var i = 0; i < seg.length; i++) {
      if (paintAllowed(seg[i])) cells.push(seg[i]);
    }
    if (cells.length) editApplyColor(cells);
  }

  function finishSelectionDrag(ev) {
    if (!S.edit.dragging) return;
    S.edit.dragging = false;
    var it = cur();
    if (!it || !it.blocks) { S.edit.lassoPath = null; return; }
    var rowsN = it.blocks.length, colsN = it.blocks[0].length;

    if (S.edit.lassoPath) {
      var path = S.edit.lassoPath;
      S.edit.lassoPath = null;
      applySelection(C.maskFromPolygon(rowsN, colsN, path), ev,
        '套索（轨迹 ' + path.length + ' 格）');
      return;
    }
    var rect = normalizeRect(S.edit.dragStart, S.edit.dragCurrent);
    applySelection(C.maskFromRect(rowsN, colsN, rect.r0, rect.c0, rect.r1, rect.c1), ev,
      '矩形框选 行 ' + rect.r0 + '–' + rect.r1 + '，列 ' + rect.c0 + '–' + rect.c1);
  }

  function onCanvasMouseUp(ev) {
    finishSelectionDrag(ev);
    if (S.edit.paintDragging) endStroke();     // 一笔结束才并入撤销栈
    S.edit.paintDragging = false;
    S.edit.lastPaintCell = null;
  }

  /* ==================== 12. 主体提取 ====================
   * 任务 ANT-ARTTOOL-SUBJECT-EXTRACT-20260902
   *
   * 用户目的：把主体人工提取出来、去掉边缘杂物，输出只含主体的像素图纸；
   * 之后要能再导入回来**拼接**，让一关有多个主体去做目标引导趋势。
   * 因此：剔除**保持原尺寸**、空位写 **0** —— 拼接时行列坐标才对得上。
   */

  /** 当前是否具备剔除条件（有图 + 有选区）。 */
  function extractReady() {
    var it = cur();
    return !!(it && it.blocks && S.edit.mask && C.maskCount(S.edit.mask) > 0);
  }

  /**
   * 执行剔除。mode: 'outside' 只保留选区内 / 'inside' 挖空选区内。
   * 整张图快照进 S.extract.undo（剔除一次可能动几百格，逐像素记反而更大）。
   */
  function doExtract(mode) {
    var it = cur();
    if (!extractReady()) { log('请先框出选区（在「3. 美术编辑」里选一种选区工具）'); return; }
    var before = it.blocks.map(function (r) { return r.slice(); });
    var res;
    try { res = C.applyExtract(it.blocks, S.edit.mask, mode); }
    catch (e) { log('剔除失败：' + e.message); return; }
    if (res.removed === 0) {
      log('这一步没有剔掉任何像素（' + (mode === 'inside' ? '选区内本来就是空的' : '选区已覆盖全部非空像素') + '），未改动');
      return;
    }
    S.extract.undo.push(before);
    S.extract.lastResult = res;
    it.blocks = res.blocks;
    // 编辑模式的「还原为原图」也要能把提取一并还原，所以这里补上原图快照
    if (!S.edit.original) S.edit.original = before.map(function (r) { return r.slice(); });
    invalidateAfterBlocksChange();
    log('已' + (mode === 'inside' ? '挖空选区内' : '剔掉选区外') +
      '：剔除 ' + res.removed + ' 像素，剩余 ' + res.after + ' 像素（尺寸仍是 ' + res.rows + '×' + res.cols + '，空位写 0）');
  }

  function undoExtract() {
    if (!S.extract.undo.length) return;
    var it = cur();
    if (!it) return;
    it.blocks = S.extract.undo.pop();
    S.extract.lastResult = null;
    invalidateAfterBlocksChange();
    log('已撤销上一步剔除（剩 ' + S.extract.undo.length + ' 步可撤销）');
  }

  function resetExtract() {
    var it = cur();
    if (!it || !S.edit.original) { log('没有可还原的原图快照'); return; }
    it.blocks = S.edit.original.map(function (r) { return r.slice(); });
    S.extract.undo = [];
    S.extract.lastResult = null;
    invalidateAfterBlocksChange();
    log('已还原为原图');
  }

  /**
   * 目标图被改动后，需要一起失效/刷新的东西。
   * 剔除会大幅改变像素，任何基于旧图算出来的结论（碎色率、时间线、区间、重构结果）
   * 都不能继续显示，否则用户会看到与当前图不符的数字。
   */
  function invalidateAfterBlocksChange() {
    var it = cur();
    if (it) {
      // 像素变了，任何基于旧图算出来的结论都失效：碎色率必须重算
      fragState.result = null; fragState.key = null;
    }
    draw();
    renderEditInfo();
    refreshEditPanels();
    renderExtractPanel();
  }

  /** 自动选法辅助①：四个角各自的同色连通块合并成选区。 */
  function pickBgCorners() {
    var it = cur();
    if (!it || !it.blocks) return;
    var rowsN = it.blocks.length, colsN = it.blocks[0].length;
    var corners = [[0, 0], [0, colsN - 1], [rowsN - 1, 0], [rowsN - 1, colsN - 1]];
    var m = C.maskNew(rowsN, colsN);
    corners.forEach(function (p) {
      m = C.maskCombine(m, C.maskFromSameColorRegion(it.blocks, p[0], p[1]), 'add');
    });
    setSelectionMask(m);
    draw(); refreshEditPanels(); renderExtractPanel();
    var n = C.maskCount(m), tot = rowsN * colsN;
    log('已选四角同色块：' + n + ' 格（占全图 ' + (n / tot * 100).toFixed(0) + '%）。' +
      '若比例很低说明这张图的边缘是杂色或密铺纹理，自动选法帮不上，请手动框选或套索');
  }

  /** 自动选法辅助②：非 0 像素的最大四连通块 → 选区（配「只保留选区内」用）。 */
  function selectLargestComponent() {
    var it = cur();
    if (!it || !it.blocks) return;
    var comps = C.nonZeroComponents(it.blocks);
    if (!comps.length) { log('图里没有非 0 像素'); return; }
    var rowsN = it.blocks.length, colsN = it.blocks[0].length;
    setSelectionMask(C.maskFromIndices(comps[0], rowsN, colsN));
    draw(); refreshEditPanels(); renderExtractPanel();
    log('已选最大连通块：' + comps[0].length + ' 格（全图共 ' + comps.length + ' 块，' +
      '各块大小 ' + comps.slice(0, 6).map(function (x) { return x.length; }).join('/') +
      (comps.length > 6 ? '…' : '') + '）。' +
      (comps.length === 1 ? '⚠ 只有 1 块 —— 说明全图连通，这一招对这张图没用' : ''));
  }

  /**
   * 选中所有「不超过阈值格」的零碎小块（2026-09-15 需求①②的收尾手段）。
   *
   * 与 selectLargestComponent 的分工：
   *   - 只留最大连通块：只认第 1 块，第 2 大块再有用也一起清掉 —— 图上只有一个部件时才合适；
   *   - 选中零碎小块：按**尺寸阈值**判，能留下次大的有效部件，只清真正的碎渣。
   * 实测熊猫图（已剔掉背景）非 0 共 24 块：主体 2206 格，其余 23 块合计 103 格、单块最大 37 格，
   * 阈值 40 正好一次清净且不碰主体。
   *
   * 注意这一招只对**已经剔出空白**的图有效：蜗牛图与财神爷图非 0 像素仍连成 1 块，
   * 此时任何按连通块的手段都无从下手，只能靠套索 + 区域内同色。故这里如实提示，不假装有效。
   */
  function selectSmallComponents() {
    var it = cur();
    if (!it || !it.blocks) return;
    var maxEl = $('inSmallCompMax');
    var lim = maxEl ? parseInt(maxEl.value, 10) : 40;
    if (!isFinite(lim) || lim < 1) { log('「不超过 N 格」需要填一个 ≥1 的整数'); return; }
    var comps = C.nonZeroComponents(it.blocks);
    if (!comps.length) { log('图里没有非 0 像素'); return; }
    if (comps.length === 1) {
      log('⚠ 全图非 0 像素只有 1 块（' + comps[0].length + ' 格）—— 没有独立的零碎块可清。' +
        '这一招要等你先剔掉背景、图上出现空白之后才用得上。' +
        '现在请用套索圈边缘 + 叠加方式「交集」+ 按色选来去毛边。');
      return;
    }
    var rowsN = it.blocks.length, colsN = it.blocks[0].length;
    var m = C.maskFromSmallComponents(it.blocks, lim);
    var n = C.maskCount(m);
    var hit = comps.filter(function (x) { return x.length <= lim; }).length;
    if (!n) {
      log('没有不超过 ' + lim + ' 格的小块（当前各块大小：' +
        comps.slice(0, 8).map(function (x) { return x.length; }).join('/') +
        (comps.length > 8 ? '…' : '') + '）。可以把阈值调大一点。');
      return;
    }
    // 阈值过大把主体也圈进来时必须说清，否则一剔就把图清空了
    var takesMain = m.bits[comps[0][0]] === 1;
    setSelectionMask(m);
    draw(); refreshEditPanels(); renderExtractPanel();
    log('已选中 ' + hit + ' 个小块、共 ' + n + ' 格（阈值 ≤' + lim + ' 格；全图 ' + comps.length +
      ' 块，最大块 ' + comps[0].length + ' 格）。' +
      (takesMain
        ? '⚠ 阈值太大，**最大块也被选中了** —— 这样剔除会把主体一起清掉，请把阈值调小到 ' +
        comps[0].length + ' 以下'
        : '主体（最大块 ' + comps[0].length + ' 格）不在选区内，可以直接「挖空选区内」'));
  }

  /** 主体提取面板。 */
  function renderExtractPanel() {
    var box = $('extractInfo');
    if (!box) return;
    var it = cur();
    if (!it || !it.blocks) { box.innerHTML = '<div class="muted">请先导入并选中一张图纸</div>'; syncExtractButtons(); return; }
    var rowsN = it.blocks.length, colsN = it.blocks[0].length;
    var nz = 0;
    for (var r = 0; r < rowsN; r++) for (var c = 0; c < colsN; c++) if (it.blocks[r][c] > 0) nz++;
    var tot = rowsN * colsN;
    var selN = selCount();
    var selNz = 0;
    if (S.edit.mask) {
      var cells = selCells();
      for (var i = 0; i < cells.length; i++) if (it.blocks[cells[i].r][cells[i].c] > 0) selNz++;
    }
    var rows = [
      ['画布尺寸', rowsN + ' × ' + colsN + '（' + tot + ' 格，<b>剔除不改变尺寸</b>）'],
      ['当前非空像素', '<span class="num">' + nz + '</span> / ' + tot +
        '（空位 ' + (tot - nz) + ' 格 = 值为 0）'],
      ['选区', selN ? '<span class="num">' + selN + '</span> 格，其中有像素的 ' + selNz + ' 格　' + selRectText()
        : '<span class="warnText">未选</span> —— 在「3. 美术编辑」里勾「开启编辑模式」并选一种选区工具']
    ];
    if (S.edit.mask) {
      rows.push(['剔掉框外会剩', '<span class="num">' + selNz + '</span> 像素（剔除 ' + (nz - selNz) + '）']);
      rows.push(['挖空框内会剩', '<span class="num">' + (nz - selNz) + '</span> 像素（剔除 ' + selNz + '）']);
    }
    var lr = S.extract.lastResult;
    if (lr) {
      rows.push(['上一步', (lr.mode === 'inside' ? '挖空选区内' : '剔掉选区外') +
        '，剔除 ' + lr.removed + ' → 剩 ' + lr.after + ' 像素']);
    }
    var bb = C.bboxOfBlocks(it.blocks);
    rows.push(['主体外接矩形', bb
      ? '行 ' + bb.r0 + '–' + bb.r1 + '，列 ' + bb.c0 + '–' + bb.c1 + '（' + bb.rows + '×' + bb.cols + '）' +
        '<br><span class="hint">拼接时用它做平移。画布仍是 ' + rowsN + '×' + colsN + '，坐标口径不变</span>'
      : '<span class="badText">全空</span>']);
    box.innerHTML = kvTable(rows);
    syncExtractButtons();
  }

  function syncExtractButtons() {
    var ok = extractReady();
    var it = cur();
    if ($('btnExtractOutside')) $('btnExtractOutside').disabled = !ok;
    if ($('btnExtractInside')) $('btnExtractInside').disabled = !ok;
    if ($('btnExtractUndo')) $('btnExtractUndo').disabled = !S.extract.undo.length;
    if ($('btnExtractReset')) $('btnExtractReset').disabled = !(S.edit.original && it && it.blocks);
    if ($('btnAddPiece')) $('btnAddPiece').disabled = !(it && it.blocks && C.bboxOfBlocks(it.blocks));
  }

  /* ==================== 图纸库 ====================
   * 与关卡数据**分开存放**，单独一个 localStorage key。
   * 理由（实读确认）：批量导出关卡时会无条件读 `e.originalLevel` / `e.reconstructedLevel`，
   * 一个只有像素矩阵的图纸条目混进那个数组会让批量导出直接抛错。分开存最省事也最安全。
   */

  /** HTML 转义（图纸名是用户输入的，直接拼进 innerHTML 会有注入风险）。 */
  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** 文件名安全化（去掉路径分隔符与 Windows 非法字符）。 */
  function safeFileName(s) {
    return String(s == null || s === '' ? 'piece' : s).replace(/[\\/:*?"<>|]/g, '_');
  }

  function loadPieceLib() {
    try {
      var raw = localStorage.getItem(PIECE_LIB_STORAGE_KEY);
      S.pieceLib = raw ? (JSON.parse(raw) || []) : [];
    } catch (e) {
      S.pieceLib = [];
      log('图纸库读取失败（' + (e && e.message) + '），已重置为空');
    }
    // 只留结构完整的条目，坏条目如实报出来而不是静默丢
    var bad = S.pieceLib.filter(function (e) { return !e || e.type !== C.ART_PIECE_TYPE || !e.blocks; });
    if (bad.length) {
      S.pieceLib = S.pieceLib.filter(function (e) { return e && e.type === C.ART_PIECE_TYPE && e.blocks; });
      log('图纸库里有 ' + bad.length + ' 条结构不完整，已跳过（其余 ' + S.pieceLib.length + ' 条正常）');
    }
  }

  function savePieceLib() {
    try {
      localStorage.setItem(PIECE_LIB_STORAGE_KEY, JSON.stringify(S.pieceLib));
      return { ok: true };
    } catch (e) {
      var quota = /quota|exceeded/i.test(String(e && e.name) + String(e && e.message));
      return { ok: false, error: (e && e.message) || String(e), quota: quota };
    }
  }

  function pieceLibBytes() {
    try { return JSON.stringify(S.pieceLib).length; } catch (e) { return 0; }
  }

  /** 把当前目标图作为一张图纸入库。 */
  function addCurrentAsPiece() {
    var it = cur();
    if (!it || !it.blocks) { log('请先导入并选中一张图纸'); return; }
    var nameInput = $('inPieceName');
    var base = (nameInput && nameInput.value.trim()) || String(it.key || 'piece');
    // 同名自动加序号，避免静默覆盖用户已攒的图纸
    var key = base, n = 2;
    while (S.pieceLib.some(function (e) { return e.key === key; })) { key = base + '_' + n; n++; }
    var piece;
    try {
      piece = C.toArtPiece(it.blocks, {
        key: key,
        sourceName: it.key || null,
        ops: S.extract.lastResult
          ? [{ mode: S.extract.lastResult.mode, removed: S.extract.lastResult.removed }]
          : []
      });
    } catch (e) { log('入库失败：' + e.message); return; }

    S.pieceLib.push(piece);
    var res = savePieceLib();
    if (!res.ok) {
      S.pieceLib.pop();
      savePieceLib();
      renderPieceLib();
      log('⚠ 图纸库加入失败，已取消本次加入（内存与本地保存都没变，避免刷新后静默丢失）。原因：' + res.error +
        (res.quota ? '。这是浏览器本地存储配额（每站点约 5 MB），当前图纸库 ' + kb(pieceLibBytes()) +
          '。请先导出图纸库，再移除部分图纸腾空间。' : ''));
      return;
    }
    if (nameInput) nameInput.value = '';
    renderPieceLib();
    log('图纸库：已加入「' + key + '」（' + piece.pixelCount + ' 像素，' +
      piece.rows + '×' + piece.cols + '，外接 ' + piece.bbox.rows + '×' + piece.bbox.cols +
      '），当前共 ' + S.pieceLib.length + ' 张');
  }

  function removePiece(key) {
    S.pieceLib = S.pieceLib.filter(function (e) { return e.key !== key; });
    savePieceLib();
    renderPieceLib();
    log('图纸库：已移除「' + key + '」');
  }

  /** 把某张图纸载回当前关的目标图（供检查，也是「再导入回来」的第一步）。 */
  function loadPieceIntoCurrent(key) {
    var it = cur();
    if (!it) { log('请先导入并选中一张图纸'); return; }
    var p = S.pieceLib.filter(function (e) { return e.key === key; })[0];
    if (!p) return;
    if (p.rows !== it.blocks.length || p.cols !== it.blocks[0].length) {
      log('⚠ 图纸尺寸 ' + p.rows + '×' + p.cols + ' 与当前图纸 ' +
        it.blocks.length + '×' + it.blocks[0].length + ' 不一致，没有载入。' +
        '拼接需要同尺寸画布，请换一张图纸');
      return;
    }
    if (!S.edit.original) S.edit.original = it.blocks.map(function (r) { return r.slice(); });
    S.extract.undo.push(it.blocks.map(function (r) { return r.slice(); }));
    it.blocks = p.blocks.map(function (r) { return r.slice(); });
    clearSelection();
    invalidateAfterBlocksChange();
    log('已把图纸「' + key + '」载入当前画布（' + p.pixelCount + ' 像素）。可用「撤销上一步剔除」退回');
  }

  /** 图纸库面板：水位 + 列表（含缩略图）。 */
  function renderPieceLib() {
    var info = $('pieceLibInfo'), list = $('pieceLibList');
    if (!info || !list) return;
    var st = C.artPieceStats(S.pieceLib);
    var chars = pieceLibBytes();
    var usedMB = chars * 2 / 1024 / 1024;      // localStorage 按 UTF-16 计费
    var rows = [
      ['图纸数', st.count + ' 张（本地保存，刷新不丢）'],
      ['本地占用', usedMB.toFixed(3) + ' MB（浏览器每站点约 5 MB 配额）']
    ];
    if (st.count) {
      rows.push(['尺寸分布', Object.keys(st.sizes).map(function (k) { return k + '×' + st.sizes[k] + '张'; }).join('　')]);
      rows.push(['像素数', '最少 ' + st.pixel.min + '　中位 ' + st.pixel.median + '　最多 ' + st.pixel.max +
        '　合计 ' + st.pixel.sum]);
      rows.push(['用到的颜色', st.colorUnion.length + ' 种：' + st.colorUnion.join(' ')]);
    }
    info.innerHTML = kvTable(rows);

    if (!S.pieceLib.length) {
      list.innerHTML = '<div class="item muted">还没有图纸。框出主体 → 剔除 → 「加入图纸库」</div>';
      return;
    }
    list.innerHTML = S.pieceLib.map(function (e) {
      return '<div class="item" data-key="' + escHtml(e.key) + '">' +
        '<canvas class="pieceThumb" data-key="' + escHtml(e.key) + '" width="34" height="34"></canvas>' +
        '<span class="nm" title="' + escHtml(e.key) + '">' + escHtml(e.key) + '</span>' +
        '<span class="px">' + e.pixelCount + 'px</span>' +
        '<span class="bb">' + e.rows + '×' + e.cols + '</span>' +
        '<button class="btn tiny pieceLoad" data-key="' + escHtml(e.key) + '" title="把这张图纸载入当前画布">载入</button>' +
        '<button class="btn tiny ghost pieceDel" data-key="' + escHtml(e.key) + '">移除</button>' +
        '</div>';
    }).join('');
    // 缩略图：逐格画，尺寸小所以直接画不做缓存
    Array.prototype.forEach.call(list.querySelectorAll('.pieceThumb'), function (cv) {
      var e = S.pieceLib.filter(function (x) { return x.key === cv.getAttribute('data-key'); })[0];
      if (!e) return;
      var ctx = cv.getContext('2d');
      var cell = Math.max(1, Math.floor(Math.min(cv.width / e.cols, cv.height / e.rows)));
      ctx.fillStyle = '#241a12'; ctx.fillRect(0, 0, cv.width, cv.height);
      for (var r = 0; r < e.rows; r++) for (var c = 0; c < e.cols; c++) {
        var v = e.blocks[r][c];
        if (v <= 0) continue;
        ctx.fillStyle = window.AntSolver.getColorCSS(v);
        ctx.fillRect(c * cell, r * cell, cell, cell);
      }
    });
    Array.prototype.forEach.call(list.querySelectorAll('.pieceDel'), function (el) {
      el.onclick = function () { removePiece(el.getAttribute('data-key')); };
    });
    Array.prototype.forEach.call(list.querySelectorAll('.pieceLoad'), function (el) {
      el.onclick = function () { loadPieceIntoCurrent(el.getAttribute('data-key')); };
    });
  }

  /** 导出图纸库 ZIP：图纸/<名>.txt + 清单.csv + 说明.md。 */
  function exportPieceLibZip() {
    if (!S.pieceLib.length) { log('图纸库是空的'); return; }
    var files = [];
    var head = ['图纸名', '画布行', '画布列', '非空像素', '外接行起', '外接行止', '外接列起', '外接列止',
      '外接高', '外接宽', '颜色数', '来源图', '提取操作', '入库时间'];
    var csv = [head.join(',')];
    S.pieceLib.forEach(function (e) {
      files.push({ name: '图纸/' + safeFileName(e.key) + '.txt', text: C.serializeTxt(e.blocks) });
      var bb = e.bbox || {};
      csv.push([
        '"' + String(e.key).replace(/"/g, '""') + '"',
        e.rows, e.cols, e.pixelCount,
        bb.r0, bb.r1, bb.c0, bb.c1, bb.rows, bb.cols,
        e.colorCount,
        '"' + String((e.source && e.source.sourceName) || '').replace(/"/g, '""') + '"',
        '"' + ((e.source && e.source.ops) || []).map(function (o) {
          return (o.mode === 'inside' ? '挖空选区内' : o.mode === 'outside' ? '剔掉选区外' : (o.mode || '')) +
            (o.removed != null ? '(' + o.removed + ')' : '');
        }).join(';') + '"',
        (e.source && e.source.extractedAt) || ''
      ].join(','));
    });
    files.push({ name: '清单.csv', text: csv.join('\n') + '\n' });

    var st = C.artPieceStats(S.pieceLib);
    var L = [];
    L.push('# 主体图纸库导出');
    L.push('');
    L.push('- 导出时间：' + new Date().toISOString());
    L.push('- 图纸数：' + st.count);
    L.push('- 尺寸分布：' + Object.keys(st.sizes).map(function (k) { return k + ' × ' + st.sizes[k] + ' 张'; }).join('、'));
    if (st.pixel) L.push('- 非空像素：最少 ' + st.pixel.min + '　中位 ' + st.pixel.median + '　最多 ' + st.pixel.max + '　合计 ' + st.pixel.sum);
    L.push('- 用到的颜色：' + st.colorUnion.join(' '));
    L.push('');
    L.push('## 目录');
    L.push('');
    L.push('```');
    L.push('图纸/    <名>.txt   只含主体的像素图纸（首行「像素矩阵」+ 空格分隔色号）');
    L.push('清单.csv            逐张一行，含画布尺寸、非空像素、外接矩形、来源与提取操作');
    L.push('说明.md             本文件');
    L.push('```');
    L.push('');
    L.push('## 口径');
    L.push('');
    L.push('- **画布保持原尺寸**，被剔除的位置写 `0`。这样多张图纸的行列坐标是同一套，');
    L.push('  之后再导入回来做**拼接**时能直接叠加，不需要平移换算。');
    L.push('- `0` 在本项目里就是「空、不参与」：正式 `parseLevel` 只统计 `> 0` 的像素。');
    L.push('- 清单里的**外接矩形**是主体的实际占位，拼接时判断两个部件会不会重叠、要不要平移，看它。');
    L.push('- 本工具只做美术侧提取，**不生成关卡**。关卡生产侧的适配另行处理。');
    files.push({ name: '说明.md', text: L.join('\n') + '\n' });

    download('主体图纸库_' + S.pieceLib.length + '张_' + exportStamp() + '.zip', zipCreateBinary(files));
    log('已导出图纸库 ZIP：' + S.pieceLib.length + ' 张，' + files.length + ' 个文件');
  }

  function exportPieceLibJson() {
    if (!S.pieceLib.length) { log('图纸库是空的'); return; }
    download('主体图纸库_' + S.pieceLib.length + '张_' + exportStamp() + '.json',
      new Blob([JSON.stringify({
        type: 'antArtPieceLibrary', version: 1,
        count: S.pieceLib.length, exported: new Date().toISOString(),
        pieces: S.pieceLib
      }, null, 1)], { type: 'application/json' }));
    log('已导出图纸库 JSON（' + S.pieceLib.length + ' 张）');
  }

  function importPieceLibJson(file) {
    var fr = new FileReader();
    fr.onload = function () {
      var j = null;
      try { j = JSON.parse(fr.result); } catch (e) { log('图纸库 JSON 解析失败：' + (e && e.message)); return; }
      var arr = (j && Array.isArray(j.pieces)) ? j.pieces : (Array.isArray(j) ? j : null);
      if (!arr) { log('这个文件里找不到 pieces 数组，没有导入'); return; }
      var okN = 0, skip = 0, renamed = 0;
      arr.forEach(function (p) {
        if (!p || p.type !== C.ART_PIECE_TYPE || !p.blocks || !p.blocks.length) { skip++; return; }
        var key = p.key || 'piece', n = 2;
        while (S.pieceLib.some(function (e) { return e.key === key; })) { key = (p.key || 'piece') + '_' + n; n++; renamed++; }
        p.key = key;
        S.pieceLib.push(p); okN++;
      });
      var res = savePieceLib();
      renderPieceLib();
      log('图纸库导入：成功 ' + okN + ' 张' + (renamed ? '（其中 ' + renamed + ' 张同名已改名）' : '') +
        (skip ? '，跳过 ' + skip + ' 条结构不完整' : '') +
        (res.ok ? '' : '　⚠ 本地保存失败：' + res.error));
    };
    fr.readAsText(file);
  }

  function clearPieceLib() {
    if (!S.pieceLib.length) return;
    if (!window.confirm('清空图纸库？共 ' + S.pieceLib.length + ' 张，此操作不可撤销。建议先「导出图纸库」。')) return;
    S.pieceLib = [];
    savePieceLib();
    renderPieceLib();
    log('图纸库已清空');
  }

  // ==================== 绑定 ====================
  function init() {
    if (!window.AntSolver || !window.AntSolver.getColorCSS || !window.ArtToolCore) {
      $('envInfo').innerHTML = '<span style="color:#ff8080">没有载入图纸工具依赖：请用「一键启动.command」从工具目录打开</span>';
      log('无法启动：缺少 color/解析依赖（bin/js/utils.js、generator.js 或 js/core.js 未载入）');
      return;
    }
    $('envInfo').textContent = '图纸工作台 · 只做修改、主体提取与拼接';

    // ---- 1. 导入 ----
    $('fileInput').onchange = function (e) { readFiles(e.target.files, false); e.target.value = ''; };
    $('dirInput').onchange = function (e) { readFiles(e.target.files, true); e.target.value = ''; };
    $('listFilter').oninput = renderList;
    $('btnClear').onclick = function () {
      S.items = []; S.index = {}; S.cur = -1;
      S.edit.on = false; S.edit.original = null; S.edit.undoStack = [];
      clearSelection(); S.edit.replacing = null; S.edit.paintDragging = false;
      S.edit.strokeBatch = null; S.edit.lastPaintCell = null; S.edit.redoStack = [];
      S.extract.undo = []; S.extract.lastResult = null;
      fragState.result = null; fragState.key = null;
      if ($('optEdit')) $('optEdit').checked = false;
      $('cv').classList.remove('editing');
      renderList(); refreshEditPanels(); renderEditInfo();
      $('importStat').textContent = '未导入';
      $('readout').textContent = '把鼠标移到图纸上可查看该像素的行列与颜色。';
      draw();
    };

    // ---- 2. 显示与导出 ----
    $('btnPng').onclick = exportPng;
    $('cellSize').oninput = draw;
    ['optGrid', 'optShowVoid', 'optShowMaskOutline'].forEach(function (id) {
      if ($(id)) $(id).onchange = draw;
    });
    if ($('btnZoomFit')) $('btnZoomFit').onclick = zoomFit;
    // Ctrl/⌘ + 滚轮缩放画布（以光标为锚点）。普通滚轮不拦，仍然交给容器滚动。
    $('cv').addEventListener('wheel', function (ev) {
      if (!(ev.ctrlKey || ev.metaKey)) return;
      ev.preventDefault();
      var cur0 = parseInt($('cellSize').value, 10) || 11;
      var next = Math.max(4, Math.min(24, cur0 + (ev.deltaY < 0 ? 1 : -1)));
      if (next === cur0) return;
      zoomAt(next, ev.clientX, ev.clientY);
    }, { passive: false });
    $('cv').onmousemove = function (ev) { onHover(ev); onCanvasMouseMove(ev); };
    $('cv').onmousedown = onCanvasMouseDown;
    // 2026-10-30：指针移出画布再移回来时，不要从上一次的位置连一条直线过来
    $('cv').onmouseleave = function () { S.edit.lastPaintCell = null; };
    $('cv').onmouseup = onCanvasMouseUp;
    // 拖拽框选中途移出画布再松开鼠标时，画布自身的 mouseup 不会触发，靠 document 级兜底结束选区
    document.addEventListener('mouseup', function () { if (S.edit.dragging || S.edit.paintDragging) onCanvasMouseUp(); });

    // ---- 3. 美术编辑 ----
    $('optEdit').onchange = function () { toggleEditMode($('optEdit').checked); };
    Array.prototype.forEach.call(document.querySelectorAll('input[name="editTool"]'), function (r) {
      r.onchange = function () {
        S.edit.tool = r.value;
        S.edit.dragging = false; S.edit.paintDragging = false; S.edit.lassoPath = null;
        syncCanvasToolClass();
        draw();
        renderExtractPanel();
        var mo = selCombineMode();
        var moName = { replace: '替换', add: '加选', subtract: '减选', intersect: '交集' }[mo];
        var tips = {
          paint: '拖动绘制：按住在图上拖，连续改色',
          select: '矩形框选：拖出矩形',
          lasso: '套索：按住拖出任意形状，松手自动闭合',
          region: '同色块：点一下选中与该格同色且四连通的整块',
          color: '按色选：点一下选中该颜色的全部像素（不管连不连通）'
        };
        if (tips[r.value]) {
          var extra = '';
          if (r.value !== 'paint') {
            extra = '　当前叠加方式：' + moName + '（Shift 临时加选、Alt 临时减选）';
            if (r.value === 'color' && mo === 'replace') {
              extra += '。要只清边缘、保住主体轮廓，请先圈范围再把叠加方式改成「交集」';
            }
          }
          log(tips[r.value] + extra);
        }
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll('input[name="selCombine"]'), function (r) {
      r.onchange = function () {
        if (!r.checked) return;
        var msg = {
          replace: '叠加方式：替换 —— 每次选取都丢掉旧选区',
          add: '叠加方式：加选 —— 每次选取都并到当前选区上',
          subtract: '叠加方式：减选 —— 每次选取都从当前选区里挖掉',
          intersect: '叠加方式：交集 —— 只留下与当前选区重叠的部分。' +
            '配「按色选」用就是「只选当前选区里的这个颜色」，主体其它地方的同色不受影响'
        }[r.value];
        if (msg) log(msg);
        if (r.value === 'intersect' && !S.edit.mask) {
          log('　提醒：交集需要先有一个选区。请先用套索或矩形框出范围。');
        }
        renderExtractPanel();
      };
    });
    $('editPaintInSelection').onchange = function () { };
    // 橡皮擦（2026-10-30）：勾上后落笔写 0。改前清一个像素要「框选 → 主体提取 → 挖空选区内」。
    if ($('optErase')) {
      $('optErase').onchange = function () {
        S.edit.eraser = !!$('optErase').checked;
        $('cv').classList.toggle('erasing', S.edit.eraser);
        log(S.edit.eraser ? '橡皮擦已开：落笔把像素涂成空位（0）'
          : '橡皮擦已关：恢复用色库里选的颜色（当前 ' + colorLabel(S.edit.color) + '）');
      };
    }
    $('btnEditClearSelection').onclick = editClearSelection;
    initFloatPanels();

    // 待替换状态的取消途径：点空白处、按 Esc
    document.addEventListener('mousedown', function (ev) {
      if (!S.edit.replacing) return;
      var t = ev.target;
      if (!t.closest) return;
      if (t.closest('#editPalette') || t.closest('#editSelectionColors') || t.closest('#editReplaceStatus')) return;
      if (t === $('cv')) return;
      cancelColorReplace('点了空白处');
    });
    document.addEventListener('keydown', function (ev) {
      var tag = (ev.target && ev.target.tagName || '').toLowerCase();
      var inField = (tag === 'input' || tag === 'textarea' || tag === 'select');
      if (cpS().active) {
        if (!inField) {
          if ((ev.metaKey || ev.ctrlKey) && !ev.altKey) {
            var k = (ev.key || '').toLowerCase();
            if (k === 'z' && !ev.shiftKey) { ev.preventDefault(); composeUndo(); return; }
            if (k === 'y' || (k === 'z' && ev.shiftKey)) { ev.preventDefault(); composeRedo(); return; }
          }
          var step = ev.shiftKey ? 5 : 1;
          var d = { ArrowUp: [-step, 0], ArrowDown: [step, 0], ArrowLeft: [0, -step], ArrowRight: [0, step] }[ev.key];
          if (d && composeNudge(d[0], d[1])) { ev.preventDefault(); return; }
        }
      } else if (!inField) {
        // 无修饰键：单字母切工具（画笔 B / 框选 M / 套索 L / 同色块 W / 橡皮擦 E）
        if (!ev.metaKey && !ev.ctrlKey && !ev.altKey && S.edit.on) {
          var one = (ev.key || '').toLowerCase();
          var toolByKey = { b: 'paint', m: 'select', l: 'lasso', w: 'region' };
          if (toolByKey[one]) {
            ev.preventDefault();
            setEditTool(toolByKey[one]);
            return;
          }
          if (one === 'e') {
            ev.preventDefault();
            var er = $('optErase');
            if (er) { er.checked = !er.checked; er.onchange(); }
            return;
          }
        }
        // 2026-10-30：修图模式原来没有撤销快捷键（拼接模式有 Ctrl+Z），同一个键两种行为很别扭。
        if ((ev.metaKey || ev.ctrlKey) && !ev.altKey) {
          var kk = (ev.key || '').toLowerCase();
          // 图像编辑器惯例：Ctrl+A 全选、Ctrl+D 取消选区、Ctrl+= / - 缩放、Ctrl+0 适应窗口
          if (kk === 'a') { ev.preventDefault(); selectAllCells(); return; }
          if (kk === 'd') { ev.preventDefault(); editClearSelection(); log('已取消选区（Ctrl/⌘+D）'); return; }
          if (kk === '=' || kk === '+') { ev.preventDefault(); zoomBy(+1); return; }
          if (kk === '-' || kk === '_') { ev.preventDefault(); zoomBy(-1); return; }
          if (kk === '0') { ev.preventDefault(); zoomFit(); return; }
          if (kk === 'z' && !ev.shiftKey) {
            ev.preventDefault();
            if (S.edit.undoStack.length) { editUndo(); log('撤销一步（Ctrl/⌘+Z）'); }
            else log('没有可撤销的改动（这一笔还没结束？松开鼠标就是一笔）');
            return;
          }
          if (kk === 'y' || (kk === 'z' && ev.shiftKey)) {   // 重做
            ev.preventDefault();
            editRedo();
            return;
          }
        }
      }
      if (ev.key !== 'Escape') return;
      if (S.edit.replacing) cancelColorReplace('按了 Esc');
      // 2026-10-30：Esc 取消选区（以前 Esc 只管「待替换」与二次确认，选区只能去点按钮）
      else if (!cpS().active && S.edit.on && S.edit.mask) { editClearSelection(); log('已取消选区（Esc）'); }
      if (cancelArmedConfirms()) log('已取消二次确认，未执行任何操作。');
      if (cpS().active && cpS().selected.length) { cpS().selected = []; renderComposeAll(); }
    });
    $('btnEditUndo').onclick = editUndo;
    armConfirm('btnEditReset', {
      confirmText: '确认还原？',
      hint: '「还原为原图」会丢弃本张图纸全部像素修改，撤销记录也一并清空。再点一次按钮确认；' +
        '4 秒内不点则自动取消，也可按 Esc 或点击别处取消。',
      guard: function () {
        var it = cur();
        if (!it || !S.edit.original) { log('当前没有可还原的原图。'); return false; }
        return true;
      },
      action: editReset
    });
    $('btnEditExportTxt').onclick = exportEditedTxt;
    $('btnEditExportReport').onclick = exportEditReport;
    renderEditPalette();

    // ---- 4. 主体提取 + 图纸库 ----
    $('btnExtractOutside').onclick = function () { doExtract('outside'); };
    $('btnExtractInside').onclick = function () { doExtract('inside'); };
    $('btnExtractUndo').onclick = undoExtract;
    armConfirm('btnExtractReset', {
      confirmText: '确认还原？',
      hint: '「还原为原图」会丢弃本张图纸全部剔除结果。再点一次按钮确认；点其它地方取消。',
      onConfirm: resetExtract
    });
    $('btnPickBgCorners').onclick = pickBgCorners;
    $('btnKeepLargest').onclick = selectLargestComponent;
    $('btnPickSmallComps').onclick = selectSmallComponents;
    $('btnAddPiece').onclick = addCurrentAsPiece;
    $('btnPieceExportAll').onclick = exportPieceLibZip;
    $('btnPieceExportJson').onclick = exportPieceLibJson;
    $('filePieceLib').onchange = function (e) {
      var f = e.target.files[0];
      if (f) importPieceLibJson(f);
      e.target.value = '';
    };
    $('btnPieceClear').onclick = clearPieceLib;
    loadPieceLib();
    renderPieceLib();
    renderExtractPanel();
    syncCanvasToolClass();

    // ---- 5. 拼接 ----
    $('btnComposeMode').onclick = function () { cpS().active ? exitCompose() : enterCompose(); };
    $('btnComposeExit').onclick = exitCompose;
    $('btnComposeNew').onclick = composeNewCanvas;
    // 装饰图章（2026-10-30）：选图章 / 随机撒到背景
    if ($('btnStampScatter')) $('btnStampScatter').onclick = composeScatterStamps;
    if ($('btnStampReseed')) $('btnStampReseed').onclick = function () {
      var el = $('inStampSeed');
      var v = (parseInt(el.value, 10) || 1) + 1;
      el.value = v;
      log('种子 → ' + v + '，重新撒一批（上一批想撤就 Ctrl/⌘+Z）。');
      composeScatterStamps();
    };
    renderComposeStampPalette();
    // 2026-10-30 用户反馈「怎么画布的大小改变不了」：改前必须点「新建画布」才生效，
    // 只改数字完全没反应。现在松手 / 回车就自动应用，另加四个常用尺寸按钮。
    var composeResizeTimer = null;
    function scheduleCanvasResize() {
      clearTimeout(composeResizeTimer);
      composeResizeTimer = setTimeout(function () {
        var C2 = cpS();
        var r = parseInt($('inComposeRows').value, 10);
        var c = parseInt($('inComposeCols').value, 10);
        if (!isFinite(r) || !isFinite(c)) return;
        if (r === C2.rows && c === C2.cols) return;
        composeNewCanvas();
      }, 120);
    }
    ['inComposeRows', 'inComposeCols'].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.onchange = scheduleCanvasResize;   // change = 失焦/回车才触发，避免边打数字边改尺寸
      el.onkeydown = function (ev) {
        if (ev.key !== 'Enter') return;
        ev.preventDefault();
        clearTimeout(composeResizeTimer);
        composeNewCanvas();
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll('.sizePreset'), function (b) {
      b.onclick = function () {
        var n = parseInt(b.getAttribute('data-size'), 10);
        if (!isFinite(n)) return;
        $('inComposeRows').value = n;
        $('inComposeCols').value = n;
        clearTimeout(composeResizeTimer);
        composeNewCanvas();
      };
    });
    armConfirm('btnComposeClear', {
      confirmText: '再点一次＝清空画布',
      guard: function () {
        if (!cpS().layers.length) { log('画布上还没有图层，不用清'); return false; }
        return true;
      },
      hint: function () {
        return '将移除画布上全部 ' + cpS().layers.length + ' 个图层（部件列表保留）。再点一次确认，点别处或按 Esc 取消。';
      },
      action: composeClearCanvas
    });
    $('fileComposeTxt').onchange = function (ev) {
      composeImportTxt(ev.target.files);
      ev.target.value = '';
    };
    if ($('fileComposeDir')) $('fileComposeDir').onchange = function (ev) {
      composeImportTxt(ev.target.files);
      ev.target.value = '';
    };
    $('btnComposeFromLib').onclick = function () { composeAddFromLib(false); };
    $('btnComposeSrcClear').onclick = composeClearSources;
    $('composeCellSize').oninput = drawCompose;
    ['optComposeGrid', 'optComposeConflict', 'optComposeOutline'].forEach(function (id) {
      if ($(id)) $(id).onchange = drawCompose;
    });
    $('composeCv').addEventListener('mousedown', onComposeMouseDown);
    $('composeCv').addEventListener('mousemove', onComposeMouseMove);
    $('composeCv').addEventListener('mouseup', onComposeMouseUp);
    document.addEventListener('mousemove', function (ev) {
      if (composeDragging()) onComposeMouseMove(ev);
    });
    document.addEventListener('mouseup', function () {
      if (composeDragging()) onComposeMouseUp();
    });
    $('btnComposeCheck').onclick = function () { composeRunAudit(true); };
    $('btnComposeFinalPreview').onclick = function () { composeRenderFinalPreview(true); };
    $('btnComposeSparseCheck').onclick = composeRunSparseCheck;
    $('btnComposeSparseClear').onclick = composeClearSparseHighlight;
    $('inComposeSparseThreshold').onchange = function () {
      if (cpS().sparseScan) composeRunSparseCheck();
    };
    $('btnComposeExportTxt').onclick = composeExportTxt;
    $('btnComposeToLib').onclick = composeToLib;
    $('btnComposeMerge').onclick = composeMergeSelected;
    $('btnComposeHalo').onclick = composeGenerateHalo;
    $('btnComposeBackground').onclick = composeGenerateBackground;
    $('btnComposeRulesAll').onclick = composeGenerateAllRules;
    $('optComposeRequireBg').onchange = function () { composeRunAudit(false); syncComposeButtons(); };
    initComposeColorPickers();
    $('btnComposeNewLayer').onclick = composeNewBlankLayer;
    $('btnComposeLayerExport').onclick = composeExportLayer;
    $('btnComposeBorderFull').onclick = composeBorderFull;
    $('btnComposeTianzi').onclick = composeTianziAuto;
    ['btnComposeUndo', 'btnComposeUndoTop'].forEach(function (bid) {
      if ($(bid)) $(bid).onclick = composeUndo;
    });
    ['btnComposeRedo', 'btnComposeRedoTop'].forEach(function (bid) {
      if ($(bid)) $(bid).onclick = composeRedo;
    });
    Array.prototype.forEach.call(document.querySelectorAll('input[name="composeTool"]'), function (r) {
      r.onchange = function () {
        if (!r.checked) return;
        cpS().drag = null; cpS().selectBox = null; cpS().paintDrag = null; cpS().shapeDrag = null;
        var tips = {
          move: '移动图层：在画布上拖部件即可挪位；选中后方向键逐格微调',
          paint: '手动涂色：在画布上按住拖，经过的像素改成当前颜色（作用于选中的那一个图层）',
          line: '直线：按住拖出起点到终点，松手落笔。线宽在下面填，单位是格',
          fill: '填充：点一下，把与该点相连的同色（或空白）区域整片换成当前颜色',
          border: '边框：在画布上拖一个范围，松手即按所选形态生成；也可点「铺满整张画布」',
          rect: '矩形：在画布上拖一个范围，松手生成；勾「实心图形」画实心，不勾画空心（粗细用线宽）',
          ellipse: '椭圆：在画布上拖一个范围，松手生成；实心/空心同上',
          triangle: '三角形：在画布上拖一个范围，松手生成；实心/空心同上',
          diamond: '菱形：在画布上拖一个范围，松手生成；实心/空心同上'
        };
        if (tips[r.value]) log(tips[r.value]);
        if (r.value !== 'move') {
          var tgt = composeTargetLayer(true);
          if (tgt) {
            log('　这一笔会画在「' + tgt.name + '」上（当前选中的图层）。');
          } else if (cpS().selected.length > 1) {
            log('　注意：现在选中了 ' + cpS().selected.length + ' 个图层，画之前先单选一个。');
          } else if (cpS().selected.length === 1) {
            log('　注意：选中的图层已固定，画不上去 —— 先「解固」，或点「新建空白图层」另起一层。');
          } else if (cpHasCanvas()) {
            log('　画布上还没有图层，直接画即可 —— 会自动为你新建一张覆盖整张画布的绘制层。');
          }
        }
        drawCompose();
        syncComposeButtons();
      };
    });
    $('inComposeWidth').oninput = drawCompose;
    if ($('optComposeShapeSolid')) $('optComposeShapeSolid').onchange = drawCompose;
    $('optComposeErase').onchange = drawCompose;
    $('selComposeBorder').onchange = drawCompose;

    // ---- 碎色率检查 ----
    if ($('btnFragCheck')) $('btnFragCheck').onclick = function () { runFragCheck(false); };
    if ($('fragGateSel')) $('fragGateSel').onchange = function () {
      var custom = this.value === 'custom';
      if ($('fragGateCustom')) $('fragGateCustom').style.display = custom ? '' : 'none';
      onFragGateChanged();
    };
    if ($('fragGateCustom')) $('fragGateCustom').oninput = onFragGateChanged;
    restoreFragGate();
    if ($('fragHighlight')) $('fragHighlight').onchange = function () {
      if (this.checked && !fragState.result) runFragCheck(true);
      draw();
    };
    renderFragPanel();

    // ---- 卡片折叠（只登记本工具现有的卡片）----
    S.ui = loadUiPrefs();
    $('btnCollapseAll').onclick = toggleCollapseAll;
    initCardCollapse();

    composeInitDefaultCanvas();   // 2026-10-30：进来就有 35×35 画布
    renderComposeAll();
    draw();
    log('工具就绪：只做图纸修改、主体提取与拼接。');
    // 默认进入拼接模式（用户 2026-10-28 要求）；退出后用顶栏按钮可随时回来
    enterCompose();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
