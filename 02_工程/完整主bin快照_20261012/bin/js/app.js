/**
 * 蚂蚁拿块求解器 - 主应用UI模块
 * 
 * 队列棋盘：顺时针旋转90度（竖排列：每条队列从上往下）
 * 自动求解：逐步动画演示
 */

var AntSolver = AntSolver || {};

AntSolver.App = (function() {
  var currentLevel = null;
  var currentImportedSolve = null;  // 从关卡包导入的【求解数据】(审核那一轮)：有则复用、免网页重算；无则重新求解
  var currentGenerationEval = null; // 当前生成/导入关卡的统一全知+玩家压力/封锁诊断，压力图优先复用同一口径
  // 【v120】当前关卡的卡点类型信息与位置（仅本次在页面上生成的关卡才有；导入的关卡本体不含这些）。
  //   { plan, marks, dropped, pos } —— 供 renderLevelInfo 在「关卡信息」面板显示「什么卡点、在哪、参数多少」。
  var currentChokeInfo = null;
  // 当前单关的【目标图入口模式】：'fourSide'|'bottomOnly'。生成时按当次配置记下，导入/换关时清回默认。
  // 只用于单关导出记录与显示；关卡 JSON 本体不含该字段（用户决定 D1）。
  var currentEntryMode = 'fourSide';
  // v99：三种玩法模式互斥，统一从 config 推导 entryMode，避免各处各写一遍三元表达式导致漏改。
  function entryModeOf(cfg) {
    if (cfg && cfg.instantChain) return 'fourSideInstantChain';
    if (cfg && cfg.bottomOnly) return 'bottomOnly';
    return 'fourSide';
  }
  // ===== v121·任务AK① 入口模式（玩法）识别的三个转换工具 =====
  // 工程里同一个概念有三套命名，混用过一次就会静默按错玩法加载，故集中在这里显式转换：
  //   · entryMode（落库/导出/generator 口径）：'fourSide' | 'bottomOnly' | 'fourSideInstantChain'
  //   · 手点消除模式下拉 #sim-elim-mode：'fourSide' | 'bottomOnly' | 'instantChain'
  //   · 生成页入口下拉 #gen-bottom-only：'0'(缺省) | '1' | '2'
  /** 规范化任意来源的入口模式取值 → entryMode 口径；认不出返回 null（**不猜**，由调用方如实回落）。 */
  function normEntryMode(v) {
    if (v == null || v === '') return null;
    var s = String(v);
    if (s === 'fourSideInstantChain' || s === 'instantChain' || s === '2') return 'fourSideInstantChain';
    if (s === 'bottomOnly' || s === '1') return 'bottomOnly';
    if (s === 'fourSide' || s === '0') return 'fourSide';
    return null;
  }
  /** entryMode → 手点消除模式下拉取值 */
  function elimModeOfEntry(em) {
    if (em === 'fourSideInstantChain') return 'instantChain';
    if (em === 'bottomOnly') return 'bottomOnly';
    return 'fourSide';
  }
  /** entryMode → 中文名（面板显示用） */
  function entryModeLabel(em) {
    if (em === 'fourSideInstantChain') return '四方向瞬时连锁';
    if (em === 'bottomOnly') return '仅底部入口';
    if (em === 'fourSide') return '四边入口';
    return '未知玩法';
  }
  /** entryMode → 求解器入口（按本关玩法求全知解，而不是一律走四边） */
  function solveByEntryMode(level, em) {
    if (em === 'fourSideInstantChain' && AntSolver.Solver.solveInstantChain) return AntSolver.Solver.solveInstantChain(level);
    if (em === 'bottomOnly' && AntSolver.Solver.solveBottom) return AntSolver.Solver.solveBottom(level);
    return AntSolver.Solver.solve(level);
  }
  /** entryMode → PlayerSim 的模式开关 */
  function playerOptsOfEntry(em) {
    return { bottomOnly: em === 'bottomOnly', instantChain: em === 'fourSideInstantChain' };
  }
  var simulating = false;
  // 【v132】手动摆盒编辑态：true 时棋盘区显示 js/level-editor.js 的编辑板，
  //   模拟控制栏换成摆盒工具条（详见 enterEditMode / exitEditMode）。
  var editMode = false;
  // 【v135】摆盒进入时的关卡指纹：用来判断"手改过没有"。
  //   压力图优先复用【导入时那份求解数据/生成诊断】。手改车场之后那份数据描述的是旧布局，
  //   直接复用会在图上画出**旧曲线**（比"不刷新"更糟：看起来像新结果）。所以一旦指纹变了就作废它。
  var editSig = null;
  var autoPlayTimer = null;
  // 求解路线叠加状态（任务 ANT-SIM-CHAIN-ROUTE-20260805）。
  // 声明放在这里而不是紧邻其函数：renderQueues 渲染每个格子时会读它，
  // 必须保证在任何渲染发生前就已初始化，否则首次渲染会读到 undefined。
  var routeOverlay = { active: false, map: null, total: 0, mode: null };
  var lastAnalysis = null; // 最近一次批量分析结果
  // v121：最近一次分析的元信息 { recalibrate, runs, ms }。CSV 表头随它变（重标定多 12 列），
  // 不记下来就无法在导出时判断这份结果是单轮还是多轮重标定。
  var lastAnalysisMeta = null;
  // 目标图布局(供暂存槽对齐起点列)：{width, step, cols}
  var targetLayout = null;
  // 目标图放大镜 + 拖拽平移
  var targetZoom = 1, targetPan = { x: 0, y: 0 }, lastTargetElim = null;
  // 消除顺序可视化（独立视图）
  var elimCellSize = 26, elimTrendData = null, elimOrderData = null;
  var elimBoxCap = 35, elimBuiltLevel = null;   // 基础铺盒：按底→顶趋势压缩为单色容量盒(默认容量≤35，无障碍)
  var elimSim = {
    active: false, timer: null, visualElim: null, actualRank: null, nextRank: 0, token: 0, lastStart: null,
    previewRank: null, previewLocked: null, previewStats: null, previewSlot: null, previewStart: null, previewRefreshes: 0
  };  // 视图内【就地模拟】状态
  var elimSimSpeed = 15;                           // 全知版回放速度(ms/格起底面)：<=0=瞬时(整批一起消失)；数值越小每tick消得越快
  // 生成器独立页面状态
  var genFileFilter = { color: null };  // 文件列表当前筛选(点分组标题筛该组；null=不筛选)
  var genBatchRunning = false, genBatchAborted = false;
  var genBatchResults = [];             // 本批已产出记录(收尾打包用；语义不变)
  // 【v153】展示用的"跨批次历史"：用户 2026-10-16「生成过的关卡能不能先保留，每次生成都覆盖掉之前的，很难对比」。
  //   只影响展示：每次开批往里 push 一条批次头 + 逐关记录；ZIP/落库仍走 genBatchResults（本批语义不变）。
  var genResultHistory = [];            // [{__batch:true, label}, {__batch:false, ...rec}]
  // 【v140】结果表「带入棋盘」按钮的回查表：按【渲染顺序】存放记录。
  //   必须单独存一份：表格支持按难度/名称排序与按档位分组，渲染下标与 results 下标不再对应。
  var genResultRows = [];
  var genBatchStartAt = 0;
  // ===== 批量生产后台线程池（ANT-GEN-PARALLEL-WORKERPOOL-20260820，用户 2026-08-20 批准）=====
  // 改动前：单个 genWorker + 单个游标，严格「produce 一关 → 落库确认 → 再派下一关」，同一时刻只有 1 关在算。
  //   实测 08-20 批次 39 关耗时 17.4 分钟，各关 produce 耗时【求和等于墙上时间】→ 落库开销≈0，
  //   瓶颈就是串行本身。故改为 N 个线程各自领关并行 produce。
  // 不变的部分（重要）：
  //   · 单关时间预算仍由 produceFixed 内部各自计时（每个线程跑自己的 produce、各自 t0），每关拿满预算；
  //   · gen-worker.js 协议未改（每消息无状态、每线程一份独立全局），线程池无需改 worker 侧；
  //   · 落库仍是「每关写盘确认」，只是由【全局串行门】改为【按关独立】——服务端 persistResult 全同步，
  //     Node 事件循环天然把并发写序列化，因此不存在 CSV/JSONL/计数竞态（已核对 生产服务.js:185）。
  var genPool = [];                     // 线程池槽位：[{ no, w, epoch, ready, busy, idx, watchdog }]
  var genPoolSize = 1;                  // 本批并发线程数（UI 可配；1 = 与改动前的串行行为完全等价）
  var genPoolReadyCount = 0;            // 已握手就绪的槽位数：为 0 时才判定「这个环境用不了 Worker」并整批回退主线程
  var genPoolFellBack = false;          // 是否已回退主线程（只允许发生一次）
  var genBatch = null;                  // 本批运行态 { config, easySlot, nextIdx, total, doneCount }
  var genInFlightT0 = {};
  var genPoolProgressTimer = null;   // 【v308】进度行 1 秒刷新定时器               // 输入下标 → 该关派发时刻；N 关在飞时各自计耗时(不能再用单个 itemT0，否则耗时全错)
  var genPendingZip = null;             // 【兜底模式专用】收尾打包好的关卡包 { blob, filename, fileCount }；仅在本地生产服务不可用时才会有值
  // 逐关落库运行态：正式生产走「每关写盘确认」，不再整批打 ZIP。
  //   enabled=false 时(如 file:// 打开、没起本地生产服务)自动回退旧的内存+ZIP模式，保证仍能用。
  var genPersist = {
    enabled: false, batchId: null, batchToken: null, relDir: '', dirName: '',
    // pendingPayloads: 输入下标 → 待重试的落库请求。并发下可能同时有多关落库失败，
    //   单槽会把先失败的那关覆盖掉、永久丢失，故改为按下标存多笔。
    persistedCount: 0, pendingPayloads: {}, failed: false
  };

  /**
   * 【v144】生成器并入主界面。
   *
   * 用户 2026-10-15 原话：「我觉得这个求解器的生成器可以和模拟器结合……点生成器时，右侧的区域
   * 变成原来生成器的模样，也就是调整参数和批量生成的按钮之类的，我想的是生成一个关卡之后，
   * 能直接映射到中间的棋盘区，为了不太拥挤，左侧的关卡信息可以收起进行隐藏。」
   *
   * 于是不再有"生成器独立页面"：顶栏两个按钮改成切换【右栏面板】，中间棋盘区始终可见。
   *   · 模拟器模式 → 右栏 = 模拟控制 + 暂存压力图（原行为）
   *   · 生成器模式 → 右栏 = 导入/参数手风琴 + 开始生成 + 进度 + 结果表（原生成器页整块）
   */
  /**
   * 【v150·取代 v144 的顶栏按钮切换】右栏跟着【状态】走，不再需要用户切：
   *   · 进「模拟游玩」→ 模拟控制 + 暂存压力图
   *   · 退出模拟     → 自动回到生成器（导入 / 参数 / 开始生成 / 进度 / 结果）
   *   · 手动摆盒     → 摆盒工具条
   * 用户原话：「只需要在点击『模拟游玩』的时候，才显示模拟控制以及压力曲线的卡片；
   *            退出模拟的时候，就又恢复成生成器的那些参数数据」。
   */
  function rightPanelMode() {
    if (editMode) return 'edit';
    if (simulating) return 'sim';
    return 'gen';
  }

  /**
   * 【v144 引入 / v150 改为随状态】右栏显示哪一块。单一入口，避免 enter/exit 各处各写一遍导致显隐打架。
   *   优先级：摆盒编辑 > 模拟游玩 > 生成器（默认）。没有"空闲态"了 —— 平时就显示生成器。
   */
  function applyRightPanels() {
    var mode = rightPanelMode();
    var rail = document.getElementById('panel-right');
    if (rail) rail.classList.remove('hidden');   // v144 起右栏常驻
    var gen = document.getElementById('gen-controls');
    var sim = document.getElementById('sim-controls');
    var charts = document.getElementById('board-charts');
    var edit = document.getElementById('edit-controls');
    if (gen) gen.classList.toggle('hidden', mode !== 'gen');
    if (edit) edit.classList.toggle('hidden', mode !== 'edit');
    if (sim) sim.classList.toggle('hidden', mode !== 'sim');
    if (charts) charts.classList.toggle('hidden', mode !== 'sim');
    if (mode === 'gen') { try { renderGenFileList(); } catch (e) {} }
  }

  /**
   * 【v144 引入 / v146 修正】左栏收起/展开。
   *
   * v144 的实现是 `#panel-left { display:none }` —— **错的**：display:none 会把这一块
   * 从网格里整个摘掉，中列与右栏于是自动前移一格，中列掉进那个 0 宽的第一列，
   * 表现就是用户看到的「收起左栏，连中间的目标区和棋盘一起塌了」。
   * v146 改为：左栏仍占第 1 列，但被压成 34px 窄条（只留折叠按钮），按钮就地翻转方向当"展开"用。
   */
  function setLeftPanelCollapsed(on) {
    var ml = document.querySelector('.main-layout');
    var cur = ml ? ml.classList.contains('left-collapsed') : false;
    on = (on == null) ? !cur : !!on;      // 不传参数 = 开关（v146 起折叠/展开是同一个按钮，必须能来回切）
    if (ml) ml.classList.toggle('left-collapsed', on);
    var btn = document.getElementById('btn-collapse-left');
    if (btn) {
      btn.textContent = on ? '▶' : '◀ 收起';
      btn.title = on ? '展开左侧「关卡信息」栏' : '收起左侧栏，把宽度让给棋盘';
    }
    applyTargetViewportSize();     // 中列变宽了，目标图框体跟着重算
    if (typeof lastTargetElim !== 'undefined' && currentLevel) renderTarget(lastTargetElim);
  }

  // ==================== 【v158】左右两栏宽度可拖拽 ====================
  // 用户 2026-10-16：「左侧右侧的框，宽度要可调整」。
  // 宽度由 `.main-layout` 上的 CSS 变量 --left-w / --right-w 驱动（网格轨道也跟着它们走），
  // 分隔条（#resizer-left / #resizer-right）绝对定位贴在边界上，所以拖动时条和面板始终对齐。
  // 夹取规则：两栏各自 min/max，且**中列至少留 360px**（不够就先削右栏、再削左栏）——
  //   避免把目标图/棋盘挤成一条缝（v146 那次"收起左栏把中间也塌了"是同源教训）。
  // 宽度记进 localStorage，刷新保留；双击分隔条复位成默认 280 / 352。
  var LAYOUT_W_KEY = 'antLayoutWidths';
  var LAYOUT_DEF = { left: 280, right: 352 };
  var LAYOUT_LIM = { leftMin: 180, leftMax: 620, rightMin: 240, rightMax: 720, centerMin: 360 };
  var layoutW = { left: LAYOUT_DEF.left, right: LAYOUT_DEF.right };

  function layoutMainEl() { return document.querySelector('.main-layout'); }
  function layoutApply() {
    var ml = layoutMainEl();
    if (!ml || !ml.style || !ml.style.setProperty) return;
    ml.style.setProperty('--left-w', layoutW.left + 'px');
    ml.style.setProperty('--right-w', layoutW.right + 'px');
  }
  function layoutLoadSaved() {
    try {
      var s = JSON.parse(localStorage.getItem(LAYOUT_W_KEY) || 'null');
      if (s && s.left && s.right) { layoutW.left = +s.left || LAYOUT_DEF.left; layoutW.right = +s.right || LAYOUT_DEF.right; }
    } catch (e) { /* 存坏了就用默认值，不打扰用户 */ }
  }
  function layoutSave() {
    try { localStorage.setItem(LAYOUT_W_KEY, JSON.stringify({ left: Math.round(layoutW.left), right: Math.round(layoutW.right) })); } catch (e) { }
  }
  /** 夹取：先保左栏下限、再保右栏下限、最后保证中列 ≥ centerMin（不够先削右栏） */
  function layoutClamp(w) {
    var ml = layoutMainEl();
    var total = (ml && ml.clientWidth) ? ml.clientWidth : (window.innerWidth || 1440);
    w.left = Math.max(LAYOUT_LIM.leftMin, Math.min(w.left, LAYOUT_LIM.leftMax));
    w.right = Math.max(LAYOUT_LIM.rightMin, Math.min(w.right, LAYOUT_LIM.rightMax));
    var over = (w.left + w.right + LAYOUT_LIM.centerMin) - total;
    if (over > 0) {
      var cutR = Math.min(over, Math.max(0, w.right - LAYOUT_LIM.rightMin));
      w.right -= cutR; over -= cutR;
      if (over > 0) w.left -= Math.min(over, Math.max(0, w.left - LAYOUT_LIM.leftMin));
    }
    return w;
  }
  /** 【v216】外部设置右栏宽度（给生成器里的滑杆用） */
  function layoutSetRight(px) {
    layoutW.right = Math.round(px) || LAYOUT_DEF.right;
    layoutW = layoutClamp(layoutW);
    layoutApply();
    layoutSave();
    var v = document.getElementById('gen-right-width-val');
    if (v) v.textContent = String(Math.round(layoutW.right));
    var el = document.getElementById('gen-right-width');
    if (el && +el.value !== Math.round(layoutW.right)) el.value = String(Math.round(layoutW.right));
  }

  try { window.__dshSetRightWidth = layoutSetRight; window.__dshGetRightWidth = function () { return Math.round(layoutW.right); }; } catch (e) { }

  function initPanelResizers() {
    var ml = layoutMainEl();
    if (!ml) return;
    layoutLoadSaved();
    layoutW = layoutClamp(layoutW);
    layoutApply();
    function afterResize() {          // 中列宽度变了 → 目标图框体/画布跟着重算（拖动过程中不做，避免每帧重绘卡顿）
      applyTargetViewportSize();
      if (typeof lastTargetElim !== 'undefined' && currentLevel) renderTarget(lastTargetElim);
    }
    function bindResizer(id, side) {
      var h = document.getElementById(id);
      if (!h || !h.addEventListener) return;
      var dragging = false, startX = 0, startW = 0;
      // 【v251·重写】改用 mouse 事件 + document 级监听：
      //   之前用 pointerdown + setPointerCapture + window 捕获监听，在部分环境里
      //   指针捕获会把事件重定向掉，而捕获阶段的 window 监听收不到 → 表现就是"拖不动、没反应"。
      //   mouse 事件没有捕获语义，document 级 mousemove/mouseup 最稳；触摸设备再由 pointer 兜底。
      function readW() {                       // 以面板实测宽度为准，不信任缓存值
        var el = document.getElementById(side === 'right' ? 'panel-right' : 'panel-left');
        if (el && el.getBoundingClientRect) return el.getBoundingClientRect().width || layoutW[side];
        return layoutW[side];
      }
      function onMove(e) {
        if (!dragging) return;
        var d = (e.clientX || 0) - startX;
        var next = { left: layoutW.left, right: layoutW.right };
        next[side] = startW + (side === 'left' ? d : -d);
        layoutW = layoutClamp(next);
        layoutApply();
        if (e.preventDefault) e.preventDefault();
        return false;
      }
      function onUp() {
        if (!dragging) return;
        dragging = false;
        if (h.classList && h.classList.remove) h.classList.remove('active');
        if (document.body && document.body.classList) document.body.classList.remove('resizing');
        document.removeEventListener('mousemove', onMove, true);
        document.removeEventListener('mouseup', onUp, true);
        document.removeEventListener('pointermove', onMove, true);
        document.removeEventListener('pointerup', onUp, true);
        layoutSave();
        afterResize();
      }
      function start(e) {
        if (e.button != null && e.button !== 0) return;   // 只响应左键
        dragging = true;
        startX = e.clientX;
        startW = readW();                                  // 用真实宽度起步，避免"拖了但数值没动"
        layoutW[side] = startW;
        if (h.classList && h.classList.add) h.classList.add('active');
        if (document.body && document.body.classList) document.body.classList.add('resizing');
        document.addEventListener('mousemove', onMove, true);
        document.addEventListener('mouseup', onUp, true);
        document.addEventListener('pointermove', onMove, true);
        document.addEventListener('pointerup', onUp, true);
        if (e.preventDefault) e.preventDefault();
        if (e.stopPropagation) e.stopPropagation();
        try { console.log('[resizer] start ' + id + ' clientX=' + e.clientX + ' width=' + Math.round(startW)); } catch (x) { }
      }
      h.addEventListener('mousedown', start);
      // 触摸屏 / 触控笔：pointerdown 兜底（不调 setPointerCapture）
      h.addEventListener('pointerdown', function (e) {
        if (e.pointerType === 'mouse') return;             // 鼠标走 mousedown，避免重复触发
        start(e);
      });
      h.addEventListener('dblclick', function () {
        layoutW = layoutClamp({ left: LAYOUT_DEF.left, right: LAYOUT_DEF.right });
        layoutApply(); layoutSave(); afterResize();
      });
    }
    bindResizer('resizer-left', 'left');
    bindResizer('resizer-right', 'right');
    // 窗口变小：夹一遍，避免中列被挤没（比如从外接屏拔回笔记本屏）
    window.addEventListener('resize', function () {
      var n = layoutClamp({ left: layoutW.left, right: layoutW.right });
      if (n.left !== layoutW.left || n.right !== layoutW.right) { layoutW = n; layoutApply(); }
    });
  }

  function applyTargetTransform() {
    var canvas = document.getElementById('target-canvas');
    if (canvas) canvas.style.transform = 'translate(' + targetPan.x + 'px,' + targetPan.y + 'px)';
  }
  function clampTargetPan() {
    var vp = document.getElementById('target-viewport'), canvas = document.getElementById('target-canvas');
    if (!vp || !canvas) return;
    var vw = vp.clientWidth, vh = vp.clientHeight, cw = canvas.width, ch = canvas.height;
    targetPan.x = cw <= vw ? (vw - cw) / 2 : Math.min(0, Math.max(vw - cw, targetPan.x));
    targetPan.y = ch <= vh ? (vh - ch) / 2 : Math.min(0, Math.max(vh - ch, targetPan.y));
    applyTargetTransform();
  }
  // 目标图放大（任务 ANT-TARGET-UI-GROW-20260805）
  // 改动前：只放大 canvas 内容（cellSize 随 targetZoom 变），视口框固定 520×380，
  //         放大后只能看到局部、必须拖拽平移。
  // 改动后：targetZoom 同时驱动【视口框体尺寸】——框和图一起变大，通常无需再拖拽。
  //         框体上限按当前窗口可用空间收敛，避免放大到超出屏幕、把下方暂存区和棋盘挤走。
  var TGT_BASE_W = 640, TGT_BASE_H = 460;   // 基础框体尺寸（与 style.css 的 --tgt-w/h 默认值一致）
  function applyTargetViewportSize() {
    var vp = document.getElementById('target-viewport');
    if (!vp) return;
    // 可用宽度取父容器实际宽度；可用高度留出暂存区与棋盘的空间（约 420px），至少保 300px
    var host = vp.parentElement;
    var availW = host ? host.clientWidth : TGT_BASE_W;
    var availH = Math.max(300, (window.innerHeight || 900) - 420);
    var w = Math.min(Math.round(TGT_BASE_W * targetZoom), availW || TGT_BASE_W);
    var h = Math.min(Math.round(TGT_BASE_H * targetZoom), availH);
    vp.style.setProperty('--tgt-w', w + 'px');
    vp.style.setProperty('--tgt-h', h + 'px');
  }
  /**
   * 布局：两列 ↔ 三列。
   * 平时是「左关卡信息 | 中目标图/暂存/棋盘」两列；进入模拟游玩后右侧再展开一栏
   * （模拟控制 + 暂存压力图），变成「左 | 中 | 右」三列 —— 原来横铺在棋盘下方的那排
   * 控制按钮搬到了右栏竖排，中栏就能把宽度全让给目标图和棋盘。
   */
  function setSimLayout(on) {
    // 【v144】右栏已常驻、布局固定三列，这里不再切列数/隐藏右栏，只把面板显隐统一交给 applyRightPanels。
    var ml = document.querySelector('.main-layout');
    if (ml) ml.classList.add('with-right');
    applyRightPanels();
  }
  function zoomTarget(mult, reset) {
    if (reset) { targetZoom = 1; targetPan = { x: 0, y: 0 }; }
    else targetZoom = Math.max(1, Math.min(5, +(targetZoom * mult).toFixed(3)));
    var zv = document.getElementById('zoom-val'); if (zv) zv.textContent = Math.round(targetZoom * 100) + '%';
    applyTargetViewportSize();      // 先把框体调到目标尺寸，再按新框重绘与夹取平移
    renderTarget(lastTargetElim);   // 重绘(cellSize 随 zoom)，内部会 clampTargetPan
  }
  function initTargetZoomDrag() {
    var canvas = document.getElementById('target-canvas');
    if (!canvas || canvas._zoomBound) return;
    canvas._zoomBound = true;
    var dragging = false, sx = 0, sy = 0;
    canvas.addEventListener('pointerdown', function (e) {
      // 【v133】目标区画笔开启时，在目标图上按下 = 上色（或擦除/吸管），此时不平移。
      if (tgtPaint) { tgtPainting = true; tgtPaintAt(e); try { canvas.setPointerCapture(e.pointerId); } catch (x) { } return; }
      dragging = true; canvas.classList.add('grabbing'); sx = e.clientX - targetPan.x; sy = e.clientY - targetPan.y; try { canvas.setPointerCapture(e.pointerId); } catch (x) { }
    });
    canvas.addEventListener('pointermove', function (e) {
      if (tgtPaint) { if (tgtPainting) tgtPaintAt(e); return; }   // 按住拖动 = 连续刷
      if (!dragging) return; targetPan.x = e.clientX - sx; targetPan.y = e.clientY - sy; clampTargetPan();
    });
    function endDrag() { dragging = false; tgtPainting = false; canvas.classList.remove('grabbing'); }
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    // 滚轮缩放（以视口为中心）
    canvas.addEventListener('wheel', function (e) { e.preventDefault(); zoomTarget(e.deltaY < 0 ? 1.2 : 1 / 1.2); }, { passive: false });
  }
  // 消除动画（事件驱动：盒进暂存→计数随消除递增→完成离场）
  var visualElim = null;   // 当前"视觉已消除"矩阵
  var visualBuffer = [];   // 视觉暂存条目 [{key,color,need,revealed,link}]
  var animQueue = [];      // 待播放事件 add/eat/done
  var animActiveEats = []; // 正在【并发】播放的 eat 列表: [{key, cells, idx}]（锁链组/多球同步消除）
  var animPendingDones = [];// 本批并发消除播完后统一移除的 done 事件（锁链整组一起离场）
  var animTimer = null;
  // 每帧消除像素数。默认 999 = 【整批一起消失】（真机的观感：一辆车要的那些小人一次性消失/下来）
  // 想看"一个一个消"的过程，把「速度」滑块往左拉即可（1 = 每帧只消 1 像素）。
  var animPxPerTick = 999;
  var animFrameMs = 45;    // 帧间隔(ms)
  var demoMode = 'off';    // off | auto | replay
  var replayList = null, replayIdx = 0;
  // 玩家版并发演示（回放 PlayerSim frames：多球同时消像素、暂存槽按起点排布）
  var playerFrames = null, playerFrameIdx = 0, playerSlots = null, playerWon = false, playerTimer = null;
  var playerCells = null, playerBoardDims = null;
  // 复活演示状态：当前已播放的复活次数/上限(取自 PlayerSim.run 结果，与 revivesUsed 严格一致)；
  // reviveHighlight 记录"最近一次复活"要短暂高亮的暂存槛位/棋盘坐标，到期后自然随下次渲染消失(不手动清除DOM)。
  var playerRevivesUsed = 0, playerReviveCap = 2;
  var reviveHighlight = null; // { until: 时间戳, slots:[slot...], cells:[{r,c}...] }
  var REVIVE_FLASH_MS = 650;

  function init() {
    document.getElementById('btn-import-txt').addEventListener('click', importTXT);
    document.getElementById('btn-generate').addEventListener('click', runGenerate);
    // 【v335】导出"制作过程"HTML（用最近一次生成的结果）
    var _expBtn = document.getElementById('btn-export-process');
    if (_expBtn) _expBtn.addEventListener('click', function () { genExportProcess(window.__lastGenRec); });
    var _cpBtn = document.getElementById('btn-cutplan');
    if (_cpBtn) _cpBtn.addEventListener('click', cutplanRun);
    // 【v295】中段压力覆盖率滑杆：实时回显当前门槛，方便你边调边看。
    var _coverEl0 = document.getElementById('gen-choke-cover');
    var _coverVal = document.getElementById('gen-choke-cover-val');
    if (_coverEl0) {
      var syncCover = function () {
        var v = parseInt(_coverEl0.value, 10) || 45;
        if (_coverVal) _coverVal.textContent = '≥' + v + '% 的 20~80%';
      };
      _coverEl0.addEventListener('input', syncCover);
      _coverEl0.addEventListener('change', function () {
        syncCover();
        if (typeof genLog === 'function') genLog('中段压力覆盖门槛：20%~80% 里暂存≥3 的占比需 ≥' + (parseInt(_coverEl0.value, 10) || 70) + '%', 'gen-log-ok');
      });
      syncCover();
    }
    // 【v320·用户裁决】搜索时间旋钮：把内部三个数（候选数 / portfolioK / 单次预算）合成一个入口。
    var _smEl = document.getElementById('gen-search-min');
    var _smPlan = document.getElementById('gen-search-plan');
    var syncSearchPlan = function () {
      var m = parseInt(_smEl && _smEl.value, 10) || 3;
      var per = 45, pk = Math.max(2, Math.min(12, Math.round(m * 60 / per)));
      if (_smPlan) _smPlan.textContent = '≈ ' + pk + ' 轮 × ' + per + ' 秒（合格早停）';
    };
    if (_smEl) { _smEl.addEventListener('change', syncSearchPlan); syncSearchPlan(); }
    // 【v153】自动档：切到手动档时把「关卡时长」那行收起来（避免误以为它还有效）
    // 【v153】生产档位：一次设定候选数 / 难度轮数 / 单关时间预算（三个数决定一批多久）
    var _stEl = document.getElementById('gen-speed-tier');
    if (_stEl) _stEl.addEventListener('change', function () {
      var M = { fast: [3, 2, 2], std: [4, 4, 3], pro: [6, 7, 5] }[this.value] || [6, 7, 5];
      var setv = function (id, v) { var e = document.getElementById(id); if (e) e.value = v; };
      setv('gen-candidates', M[0]); setv('gen-difficulty-rounds', M[1]); setv('gen-timebudget', M[2]);
      genLog('生产档位：候选 ' + M[0] + ' × 难度轮数 ' + M[1] + ' × 单关 ' + M[2] + ' 分钟（每关完成即可用，可随时停止）', 'gen-log-ok');
    });
    var _pmEl = document.getElementById('gen-param-mode');
    if (_pmEl) {
      var syncAutoRow = function () {
        var auto = _pmEl.value !== 'manual';
        var row = document.getElementById('gen-auto-row');
        if (row) row.style.display = auto ? '' : 'none';
        var info = document.getElementById('gen-auto-info');
        if (info) info.textContent = auto
          ? '自动档：盒容量 / 冰 / 锁链 / 问号 / 管道 数量都由规则推，日志里会写出每一个数是怎么来的。'
          : '手动档：盒容量与障碍数量完全按下面「障碍设置 / 棋盘尺寸」里的数值走（原有行为）。';
      };
      _pmEl.addEventListener('change', syncAutoRow);
      syncAutoRow();
    }
    document.getElementById('btn-simulate').addEventListener('click', enterSimulation);
    document.getElementById('btn-exit-sim').addEventListener('click', exitSimulation);
    // ===== 【v154】色库：读图色库下拉 + 新老色库转换面板 =====
    if (!COLORS) {
      console.error(CL_ERR + '：导入 TXT 将无法识别/转换官方色库，请检查 index.html 里的脚本引入。');
    }
    var clSel = document.getElementById('colorlib-select');
    if (clSel) {
      clSel.value = readLibChoice;
      clSel.addEventListener('change', function () {
        readLibChoice = this.value || 'auto';
        // 已经导入的图要按新选择重判（否则改了下拉却看不出任何变化，等于摆设）
        if (levelList.length) reimportWithCurrentLib();
        else renderColorlibPanel();
      });
    }
    bindClick('btn-colorlib', function () {
      if (!COLORS) { alert(CL_ERR); return; }
      toggleColorlibPanel();
    });
    bindClick('colorlib-close', function () { toggleColorlibPanel(false); });
    var clDir = document.getElementById('colorlib-direction');
    if (clDir && clDir.addEventListener) {
      // 换方向只刷新对照表（不动数据），要真正转换得点「🔁 转换」
      clDir.addEventListener('change', function () { renderColorlibPanel(); });
    }
    bindClick('colorlib-swap', function () {
      var p = document.getElementById('colorlib-direction');
      if (p) { p.value = (p.value === 'older') ? 'official' : 'older'; renderColorlibPanel(); }
    });
    bindClick('colorlib-apply', function () {
      var scopeSel = document.getElementById('colorlib-scope');
      var mode = scopeSel ? scopeSel.value : 'all';
      var note = document.getElementById('colorlib-note');
      // 【重要】目标色库必须在任何渲染之前读定：renderColorlibPanel() 会把下拉重设成
      //   「跟当前图相反」的方向，转换完再读就会读到被翻过的值，导致"转过去又被转回来"。
      var toLib = (document.getElementById('colorlib-direction') || {}).value || 'older';
      if (mode === 'current') {
        // 单张：只转当前图，并把它设成该色库（同时把预览换成转换结果）
        if (currentLevelIdx < 0 || currentLevelIdx >= levelList.length) { alert('还没有导入任何目标图'); return; }
        var en = levelList[currentLevelIdx];
        try {
          var cv = convertEntryBlocks(en, toLib);
          setEntryBlocks(en, cv.outBlocks);   // 【v155】两份 blocks 一起换（见 setEntryBlocks）
          en.usedLib = toLib;
          en._colorCount = null;
          reloadCurrentEntry();
          renderGenFileList(); renderColorlibHint(); renderColorlibPanel();
          if (note) { note.className = 'colorlib-note good'; note.textContent = '已转换当前图《' + en.name + '》→ ' + libTag(toLib); }
        } catch (e) {
          if (note) { note.className = 'colorlib-note warn'; note.textContent = '转换失败：' + e.message; }
        }
        return;
      }
      var msg = applyColorlibBatch(mode === 'download' ? 'download' : 'preview', toLib);
      if (note) { note.className = 'colorlib-note good'; note.textContent = msg; }
    });
    // 【v132】手动摆盒：进入/退出编辑态，并把宿主能力交给 js/level-editor.js。
    //   currentLevel / levelList 都在本闭包里，外部文件取不到，所以用回调注入而不是挂全局。
    bindClick('btn-manual-edit', enterEditMode);
    bindClick('btn-exit-edit', exitEditMode);
    // 【v133】目标区画笔：Ctrl/⌘+Z 撤回（只在摆盒 + 画笔开启时接管，避免影响其它输入框）
    document.addEventListener('keydown', function (e) {
      if (!editMode || !tgtPaint) return;
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); tgtPaintUndo(); }
    });
    if (AntSolver.LevelEditor) {
      AntSolver.LevelEditor.init({
        getLevel: function () { return currentLevel; },
        getName: function () {
          var e = (levelList && currentLevelIdx >= 0) ? levelList[currentLevelIdx] : null;
          return (e && e.name) ? e.name : '手动关卡';
        },
        setBoard: editInstallBoard,
        getBlocks: function () { return currentLevel ? currentLevel.blocks : null; },
        setBlocks: editInstallBlocks,
        paint: {
          toggle: tgtPaintToggle,
          isOn: function () { return tgtPaint; },
          undo: tgtPaintUndo,
          canUndo: function () { return tgtPaintStack.length > 0; }
        },
        play: function () { exitEditMode(); if (currentLevel) enterSimulation(); },
        explain: function (html) {
          var box = document.getElementById('solve-result');
          if (box) box.classList.remove('hidden');
          document.getElementById('solve-details').innerHTML = html;
        },
        download: downloadText
      });
    }
    document.getElementById('btn-undo').addEventListener('click', doUndo);
    document.getElementById('btn-reset').addEventListener('click', doReset);
    document.getElementById('btn-auto-step').addEventListener('click', autoStep);
    bindClick('btn-omni', runOmniDemo);          // 自动求解·全知版(子按钮)
    bindClick('btn-omni-bottom', runBottomDemo); // 自动求解·底部专用版(子按钮)
    bindClick('btn-omni-chain', runChainDemo);   // 自动求解·四方向瞬时连锁版(v99 第三种玩法)
    bindClick('btn-show-route', toggleRouteOverlay); // 显示/隐藏求解路线叠加
    // 手点模拟的消除模式切换（会重置本局，见 onElimModeChange 说明）
    var emSel = document.getElementById('sim-elim-mode');
    if (emSel) emSel.addEventListener('change', onElimModeChange);
    // 【2026-10-14】「圈」多久重算一次（整盒冻结 / 每层重算 / 每人重算）—— 用来对照实机。
    //   规则变了旧进度不再成立，所以和「消除模式」一样：切换即重开本局。
    var plmSel = document.getElementById('pick-layer-mode');
    if (plmSel) plmSel.addEventListener('change', function () {
      applyPickLayerMode(this.value);
      if (!AntSolver.Simulator.isActive()) return;
      stopAutoPlay(); stopAnim(); stopPlayerDemo(); stopLive();
      AntSolver.Simulator.reset();
      applyElimModeToState(elimModeSelected());
      applyPickLayerMode(this.value);
      liveMode = false; lastBoardSig = null;
      removeGameMsg(); refreshSimUI();
      var el = document.getElementById('solve-details');
      if (el) el.innerHTML = '<p style="color:#8bc34a">已切换选取层级：' + pickLayerLabel(this.value) + '</p>' +
        '<p style="font-size:11px;color:#8a7358">这个只改"最外层多久重算一次"，大多数取法完全一样；' +
        '只在层与层交界、额度快用完时差两三个格子。本局已重置，可以对着实机看哪种口径一致。</p>';
    });
    applyPickLayerMode(plmSel ? plmSel.value : 'frozen');
    // 切换路线模式：若路线正在显示，立即按新模式重算并刷新（不必先关再开）
    var rmSel = document.getElementById('route-mode');
    if (rmSel) rmSel.addEventListener('change', function () {
      if (!routeOverlay.active) return;
      var r = buildRouteOverlay();
      if (!r.ok) { alert('该模式下无法求出路线：' + r.reason); return; }
      refreshSimUI();
      var el = document.getElementById('solve-details');
      var which = (r.showOmni && r.showPlayer) ? '全知版 + 玩家版（双路线）' : (r.showPlayer ? '玩家版' : '全知版');
      if (el) el.innerHTML = '<p style="color:#8bc34a">🗺 路线已切换为「' + which + '·' + modeCN(r.mode) + '」</p>' +
        (r.showOmni ? ('<p>全知版共 ' + r.steps + ' 步' + (r.completed ? '' : '（未通关，尽力解）') + '</p>') : '') +
        (r.showPlayer ? ('<p style="color:#4aa3df">玩家版共 ' + r.psteps + ' 盒' + (r.pwon ? '（通关）' : '（未通关）') + '</p>') : '') +
        (r.warn ? ('<p style="color:#e6a23c;font-size:11px">' + r.warn + '</p>') : '');
    });
    bindClick('btn-player-demo', togglePlayerDemo); // 自动求解·玩家版(子按钮)
    bindClick('btn-chart-mode', toggleChartMode);   // 折线/柱状/都显示 切换
    bindClick('btn-zoom-in', function () { zoomTarget(1.4); });
    bindClick('btn-zoom-out', function () { zoomTarget(1 / 1.4); });
    bindClick('btn-zoom-reset', function () { zoomTarget(1, true); });
    initTargetZoomDrag();
    // 目标图框体尺寸：初始化套用一次；窗口尺寸变化时重新收敛，
    // 否则窗口缩小后放大过的框体会溢出、把下方暂存区与棋盘挤出可视范围。
    applyTargetViewportSize();
    var tgtResizeTimer = null;
    window.addEventListener('resize', function () {
      if (tgtResizeTimer) clearTimeout(tgtResizeTimer);
      tgtResizeTimer = setTimeout(function () {
        applyTargetViewportSize();
        if (currentLevel) renderTarget(lastTargetElim);
      }, 120);
    });
    // 消除顺序可视化（独立视图）
    bindClick('btn-elim-order', openElimOrderView);
    bindClick('elim-order-close', closeElimOrderView);
    bindClick('elim-zoom-in', function () { elimCellSize = Math.min(64, elimCellSize + 4); renderElimOrder(); });
    bindClick('elim-zoom-out', function () { elimCellSize = Math.max(10, elimCellSize - 4); renderElimOrder(); });
    var elimSC = document.getElementById('elim-show-color');
    if (elimSC) elimSC.addEventListener('change', renderElimOrder);
    var elimSS = document.getElementById('elim-show-seg');
    if (elimSS) elimSS.addEventListener('change', renderElimOrder);
    bindClick('elim-rebuild', function () { if (elimSim.active) stopElimSim(); readElimCap(); buildElimLevel(); renderElimBoard(); });
    bindClick('elim-sim', startElimSim);
    bindClick('elim-sim-stop', stopElimSim);
    bindClick('elim-sim-reset', elimSimReset);
    bindClick('elim-sim-omni', elimSimOmni);
    var elimCap = document.getElementById('elim-boxcap');
    if (elimCap) elimCap.addEventListener('change', function () { if (elimSim.active) stopElimSim(); readElimCap(); buildElimLevel(); renderElimBoard(); });
    var elimBoardCanvas = document.getElementById('elim-board-canvas');
    if (elimBoardCanvas) elimBoardCanvas.addEventListener('click', elimBoardClick);
    var elimSpeed = document.getElementById('elim-sim-speed');
    if (elimSpeed) elimSpeed.addEventListener('input', function () {
      // 注意 0 是合法值（=瞬时整批一起消失），不能用 `|| 默认值`（0 会被吞成默认）
      var ev = parseInt(this.value, 10); elimSimSpeed = isNaN(ev) ? 15 : ev;
      var lbl = document.getElementById('elim-sim-speed-val');
      if (lbl) lbl.textContent = elimSimSpeed <= 0 ? '瞬时·整批一起' : elimSimSpeed + 'ms/格';
    });
    var spd = document.getElementById('anim-speed');
    if (spd) spd.addEventListener('input', function() {
      var sv = parseInt(this.value, 10); animPxPerTick = isNaN(sv) ? 999 : Math.max(1, sv);
      var lbl = document.getElementById('anim-speed-val');
      if (lbl) lbl.textContent = (this.value >= 999) ? '整批一起' : (this.value + 'px/帧');
    });
    // 顺序闪白速度：小车进轨道后每个小人亮起的间隔(ms)。0 = 关闭闪白（直接整批消失）。
    var fspd = document.getElementById('flash-speed');
    if (fspd) {
      // 控件缺省/读数非法 → 取 40ms（开着闪白）；显式的 0 才是「关闭」
      var fv0 = parseInt(fspd.value, 10); flashMs = isNaN(fv0) ? 40 : Math.max(0, fv0);
      fspd.addEventListener('input', function () {
        var fv = parseInt(this.value, 10); flashMs = isNaN(fv) ? 40 : Math.max(0, fv);
        var flbl = document.getElementById('flash-speed-val');
        if (flbl) flbl.textContent = flashMs <= 0 ? '关闭' : (flashMs + 'ms/个');
      });
      var flbl0 = document.getElementById('flash-speed-val');
      if (flbl0) flbl0.textContent = flashMs <= 0 ? '关闭' : (flashMs + 'ms/个');
    }
    document.getElementById('btn-export').addEventListener('click', exportLevel);
    document.getElementById('file-input').addEventListener('change', handleFileSelect);
    document.getElementById('txt-input').addEventListener('change', handleTXTSelect);

    // 关卡包导入（唯一导入入口）；lib-input 仍作多选文件兜底(内部复用同一配对逻辑)
    var libInput = document.getElementById('lib-input');
    if (libInput) libInput.addEventListener('change', handleLibSelect);
    // 导入整个关卡包(文件夹)：webkitdirectory 递归取全部文件，复用同一配对逻辑
    bindClick('btn-import-pack', function () { var d = document.getElementById('lib-dir-input'); if (d) d.click(); });
    var libDir = document.getElementById('lib-dir-input');
    if (libDir) libDir.addEventListener('change', handleLibSelect);
    bindClick('btn-export-lib', exportLibrary);
    // v121：显式包一层再传参 —— bindClick 会把 Event 当第一个实参传进去，
    // 直接 bindClick('btn-analyze', batchAnalyze) 会让 opts 变成 MouseEvent（当前恰好等价于单轮，但属隐患）。
    bindClick('btn-analyze', function () { batchAnalyze({ recalibrate: false }); });
    bindClick('btn-recalibrate', function () { batchAnalyze({ recalibrate: true }); });
    // 【v156】关卡体检：卡点判据 v2 的只读报告（零参数）。见 runChokeAudit 上方说明。
    bindClick('btn-choke-audit', runChokeAudit);

    // 参数区间双端滑块（v116）：七项区间参数的下限/上限都用滑钮拖。
    //   用户裁决「把上下限做成左右端可拖动的，而不是左端可拖动，右端变成填入」。
    //   两钮重合 = 不启用区间（见 readRange）。
    DUAL_RANGES.forEach(function (d) { bindDualRange(d[0], d[1], d[2], d[3]); });

    // 参数方案（保存/读取/导出/导入）
    bindClick('gen-scheme-save', saveSchemeHandler);
    bindClick('gen-scheme-load', loadSelectedScheme);
    bindClick('gen-scheme-del', delSchemeHandler);
    bindClick('gen-scheme-export', exportSchemeHandler);
    bindClick('gen-scheme-import', function () { document.getElementById('scheme-input').click(); });
    var schemeSel = document.getElementById('gen-scheme-sel');
    if (schemeSel) schemeSel.addEventListener('change', function () { if (this.value) loadSelectedScheme(); });
    var schemeInput = document.getElementById('scheme-input');
    if (schemeInput) schemeInput.addEventListener('change', handleSchemeSelect);
    renderSchemeSelect();

    // ---- 生成器独立页面 ----
    // 【v144】左栏收起/展开（收起后把宽度让给棋盘；中列左上角浮现「展开」按钮）
    bindClick('btn-collapse-left', function () { setLeftPanelCollapsed(); });   // 不传 = 开关
    initPanelResizers();   // 【v158】左右两栏宽度可拖拽（分隔条 + 双击复位 + 记 localStorage）
    // 【v147】难度档 / 压力来源 / 高级参数
    (function () {
      var presetSel = document.getElementById('gen-preset');
      if (presetSel) presetSel.addEventListener('change', function () { applyGenPreset(presetSel.value); });
      GEN_SRC_KEYS.forEach(function (k) {
        var el = document.getElementById('gen-src-' + k);
        if (el) el.addEventListener('change', applyStressSources);
      });
      // 【v217】右栏宽度滑杆（用 window 上的函数，避免作用域问题把整个面板初始化带崩）
      try {
        var rw = document.getElementById('gen-right-width');
        if (rw) {
          if (window.__dshGetRightWidth) rw.value = String(window.__dshGetRightWidth());
          rw.addEventListener('input', function () {
            if (window.__dshSetRightWidth) window.__dshSetRightWidth(+rw.value);
          });
        }
      } catch (e) { /* 滑杆坏了不影响生产 */ }
      var adv = document.getElementById('gen-show-advanced');
      if (adv) adv.addEventListener('change', function () {
        genAdvancedForce = !!adv.checked;   // 【v195】勾选要真的控制开关
        if (!genAdvancedForce) genAllForce = false;
        applyAdvancedVisibility();
      });
      var advAll = document.getElementById('gen-show-all');
      if (advAll) advAll.addEventListener('change', function () {
        genAllForce = !!advAll.checked;
        applyAdvancedVisibility();
      });
      // 【v196】把"怪参数"行标成 adv-full：卡点类型相关、并发、碎色
      (function markExoticRows() {
        function mark(el) {
          var row = el && el.closest ? el.closest('.gen-row') : null;
          if (row) row.classList.add('adv-full');
        }
        document.querySelectorAll('[id^="gen-choke-"]').forEach(mark);
        ['gen-pool-size', 'gen-frag-max'].forEach(function (id) { mark(document.getElementById(id)); });
      })();
      // 【v197】参数已固定：高级参数入口关闭（Ctrl+Shift+A 后门也一并移除）
      applyAdvancedVisibility();      // 默认收起高级段
      updatePresetInfo();
    })();
    bindClick('btn-gen-import-txt', importTXT);
    bindClick('btn-gen-start', batchProduce);
    bindClick('btn-gen-stop', stopBatchProduce);
    bindClick('btn-gen-download', genDownloadPending);
    bindClick('btn-gen-persist-retry', genRetryPersist);   // 落库失败后重试同一关(服务端幂等)
    bindClick('btn-gen-log-clear', function () { var el = document.getElementById('gen-log'); if (el) el.innerHTML = ''; });
    // 【v153】清空结果表（只清展示历史；已落库的关卡在 输出文件/ 里不受影响）
    bindClick('btn-gen-result-clear', function () {
      genResultHistory.length = 0;
      if (!genBatchRunning) { genBatchResults = []; }
      genRenderResultsLive();
      genLog('结果表已清空（已落库的关卡仍在「输出文件/」里）', 'gen-log-warn');
    });
    var fileSortSel = document.getElementById('gen-file-sort');
    if (fileSortSel) fileSortSel.addEventListener('change', renderGenFileList);
    var fileGroupChk = document.getElementById('gen-file-group');
    if (fileGroupChk) fileGroupChk.addEventListener('change', renderGenFileList);
    var resultSortSel = document.getElementById('gen-result-sort');
    if (resultSortSel) resultSortSel.addEventListener('change', function () { renderGenResultTable(genResultHistory, true); });
    var resultGroupSel = document.getElementById('gen-result-group');
    if (resultGroupSel) resultGroupSel.addEventListener('change', function () { renderGenResultTable(genResultHistory, true); });
    // 【v140】结果表「🎮 带入棋盘」：用事件委托绑一次即可 —— 表格每次排序/分组都整体重绘，
    //   逐行绑会随重绘反复叠加监听。按 data-rec 从 genResultRows 回查记录（渲染顺序 ≠ results 顺序）。
    (function () {
      var body = document.getElementById('gen-result-body');
      if (!body) return;
      body.addEventListener('click', function (ev) {
        var btn = ev.target && ev.target.closest ? ev.target.closest('.gen-result-load') : null;
        if (!btn || btn.classList.contains('off')) return;
        var idx = parseInt(btn.getAttribute('data-rec'), 10);
        if (isNaN(idx) || !genResultRows[idx]) return;
        genLoadToBoard(genResultRows[idx]);
      });
    })();
    applyRightPanels();   // 【v150】初始即按状态摆右栏（没在模拟/摆盒 → 显示生成器）
    // 参数分组手风琴：点标题展开/收起对应分组体
    var accHeads = document.querySelectorAll('.gen-accordion-head');
    for (var ai = 0; ai < accHeads.length; ai++) {
      accHeads[ai].addEventListener('click', function () {
        var body = document.getElementById(this.dataset.target);
        if (body) body.classList.toggle('collapsed');
        this.classList.toggle('collapsed');
      });
    }
  }

  // ==================== 参数方案（保存/读取/导出/导入）====================
  // 左侧生成器参数整套保存为"方案"，存 localStorage；可读取、导出JSON文件、再导入。
  var SCHEME_KEY = 'antGenSchemes_v1';
  var SCHEME_INPUTS = ['gen-boxmin','gen-boxmax','gen-boxmode','gen-buffer',
    'gen-swap-min','gen-swap-max','gen-ice','gen-black','gen-chains','gen-surprise',
    'gen-rows-min','gen-rows-max','gen-cols-min','gen-cols-max',
    'gen-narrow','gen-narrow-gap-min','gen-narrow-gap-max','gen-candidates',
    // v99 补入：目标图入口模式 + 瞬时连锁专用参数。
    // 【注意】`gen-bottom-only` 是**既有缺陷**——它从任务 A 引入至今一直没进方案白名单，
    // 导致「仅底部入口」模式存了方案也存不住、加载后会回落到四边入口。
    // 本轮必须补上：否则新模式同样存不住模式本身，五个专用参数虽被恢复但模式回落，等于全部失效，
    // 「接入网页端」这个已批准需求就是残缺的。这不是顺手优化，是新功能可用的必要条件。
    'gen-bottom-only',
    'gen-narrow-prob','gen-min-pipes','gen-usable-target','gen-usable-tol','gen-death-rescue',
    // v105 补入：管道容量口径与兜底（ANT-GEN-PIPE-DEPTH-FALLBACK-20260825）。
    // 与上面 `gen-bottom-only` 同理——不进白名单则这四个参数存了方案也存不住、
    // 加载后回落到 HTML 默认值，「可调管道深度」这个需求等于不成立。
    'gen-pipe-depth','gen-pipe-minfill','gen-pipe-fb-count','gen-pipe-fb-depth',
    'gen-pipe-floor-count','gen-pipe-floor-depth',
    // 【v295】中段压力覆盖率滑杆 + 只要难关（不进白名单 = 存了方案也存不住）
    'gen-choke-cover','gen-hard-only','gen-search-min',
    // v109 补入：v103 卡点类型体系的全部控件（ANT-GEN-SCHEME-CHOKE-TYPES-20260826）。
    // 与上面 `gen-bottom-only`(v99) 和六个管道参数(v105) 同一性质的既有缺陷——
    // v103 引入卡点类型至今，这 16 个控件一个都没进白名单，导致：
    //   勾好 11 种类型 → 存方案 → 重新加载后勾选全部回落 HTML 默认值、卡点数量归零。
    // 实证：`方案文件夹/方案_v104.json` 的 inputs 只有 24 个键、零个卡点相关键。
    // 于是任务 W 已批准的「每关各类型卡点数量可配」在方案层面根本不成立，
    // 用户每批都得手动重勾、且无法复现上一批的卡点配置。补白名单是该需求可用的必要条件。
    // 注：captureScheme/applyScheme 本就有勾选框分支（按 el.type 判定），无需改动它们，
    //     缺的只是这些 ID 从未被登记进本白名单。
    // v120 补入：窄路进池的勾选 + 逐类参数 + 卡点进度位置。
    //   不进白名单则「存了方案也存不住」——与 v99 的 gen-bottom-only、v105 的管道参数、
    //   v109 的卡点类型是同一性质的缺口，这里一次补齐。
    'gen-choke-narrowPath',
    'gen-ice-cluster-min','gen-ice-cluster-max','gen-question-cluster-radius',
    'gen-chain-cluster-min','gen-chain-cluster-max','gen-chain-ice-ends',
    'gen-narrow-gap-ice-count','gen-bigbox-cap-min','gen-bigbox-cap-max',
    'gen-numice-delay',   // 【v139】数字冰延后%（不进白名单 = 存了方案也存不住）
    'gen-board-mode',     // 【v145】棋盘自适应/手动（不进白名单 = 存了方案也存不住）
    'gen-curve-score',    // 【v151】按选择余地曲线挑关卡（实验）
    'gen-inflate-count','gen-inflate-amount','gen-rare-targets',
    'gen-choke-pos-min','gen-choke-pos-max',
    'gen-choke-iceCluster','gen-choke-chainCluster','gen-choke-questionCluster',
    'gen-choke-chainIce','gen-choke-pipeChain','gen-choke-narrowGapIce',
    'gen-choke-narrowGapChain','gen-choke-bigBox','gen-choke-rareColorKey',
    'gen-choke-swap','gen-choke-inflate',
    // 卡点类型的数量与门控：只存类型不存数量，等于每关抽几种仍然丢失。
    'gen-choke-count','gen-choke-count-boss','gen-choke-gate-narrow',
    // `bigBox` 这一类型自身的倍率参数；不存则该类型行为不可复现。
    'gen-bigbox-min','gen-bigbox-max',
    // 难关间隔（UI 文案 v124 起叫「难关间隔」，原称 BOSS 间隔）：决定哪些关按难关规格生产、
    // 从而使用 chokeTypeCountBoss。不存则难关卡点配额存住了也不知道发给谁。
    // ⚠ 变量名、控件 id（gen-boss-interval）、落库字段（isBossSlot / BOSS规格）**一律保持 boss** ——
    //   方案文件按 id 存取、已产出批次的 CSV/JSONL 按字段名落库，改名会让历史数据读不出来。
    //   术语只在**可见文案**层改。
    'gen-boss-interval',
    // v109 追加：v102 碎色前置闸门阈值（用户 2026-08-26 裁决「碎色门阈值当然补进参数」）。
    // 同为白名单既有缺口：阈值不进方案 → 存了也存不住、加载后回落 index.html 默认值 18%。
    // 该阈值决定哪些源图在生产前被直接跳过，是批次可复现性的关键参数之一。
    'gen-frag-max',
    // v110 补入：底部并行吐球路数（ANT-GEN-BOTTOM-PARALLEL-V3-20260826）。
    // 它决定底部消除的盒队列交错程度，直接影响产出结构，必须随方案走。
    'gen-box-parallel',
    // v137 补入：切盒方式（趋势切 / 锚点切盒）。
    // 与上面几个是同一性质的坑：不进白名单 = 存了方案也存不住、加载后回落 HTML 默认值「趋势切」，
    // 用户以为在用锚点切盒、实际跑的是趋势切（静默回退，最难查的那种）。
    'gen-box-cut',
    // v114 补入：填盘局部交错窗口（ANT-GEN-FILL-INTERLEAVE-20260827）。
    // 它决定盒怎么摆到棋盘（前几行是否一整排同色），直接影响产出结构，必须随方案走。
    'gen-fill-interleave',
    // v115 补入：参数区间的七个「上限」框 + 卡点类型概率三项
    // （ANT-GEN-PARAM-RANGE-CHOKE-PROB-20260827）。
    // 上限框决定该参数是否按区间随机，卡点三项决定卡点类型数量的期望与波动 ——
    // 都直接影响产出结构，不进白名单则方案存不住、批次不可复现。
    'gen-ice-max', 'gen-black-max', 'gen-chains-max', 'gen-surprise-max',
    'gen-min-pipes-max', 'gen-pipe-depth-max', 'gen-usable-target-max',
    'gen-choke-rolls', 'gen-choke-rolls-boss', 'gen-choke-prob'];

  // ===== 参数区间：双端滑块（v116）=====
  // 任务 ANT-GEN-PARAM-RANGE-CHOKE-PROB-20260827，用户追加裁决
  //   「把上下限做成左右端可拖动的，而不是左端可拖动，右端变成填入」。
  //
  // v115 第一版是「左侧原控件=下限 + 右侧数字框=上限，上限留空=不启用区间」。
  // v116 改为一条轨道上两个滑钮：左钮=下限（同时也是不启用区间时的单值）、右钮=上限。
  //
  // 【口径】上限不再有「留空」态，改为 **两钮重合（hi === lo）= 不启用区间**。
  //   与 v115 的留空逐值等价：readRange 此时返回 {min:null,max:null}，
  //   generator 的 sampleRangedConfig 见 null 退回读同名单值参数 → 行为同 v114。
  //   之所以不额外做个「启用区间」勾选框：重合态本身就是「区间宽度为 0」，
  //   语义自洽且少一个控件；采样时 lo===hi 也不会掷随机（sampleRangedConfig 内 lo===hi 直接返回）。
  //
  // 每项：[下限控件ID, 上限控件ID, 读数span ID, 单位后缀]
  var DUAL_RANGES = [
    ['gen-ice', 'gen-ice-max', 'gen-ice-val', '%'],
    ['gen-black', 'gen-black-max', 'gen-black-val', '%'],
    ['gen-chains', 'gen-chains-max', 'gen-chains-val', ''],
    ['gen-surprise', 'gen-surprise-max', 'gen-surprise-val', '%'],
    ['gen-min-pipes', 'gen-min-pipes-max', 'gen-min-pipes-val', ''],
    ['gen-pipe-depth', 'gen-pipe-depth-max', 'gen-pipe-depth-val', ''],
    ['gen-usable-target', 'gen-usable-target-max', 'gen-usable-target-val', '']
  ];
  // 上限ID → 下限ID（applyScheme 兼容旧方案空值时要用）
  var DUAL_HI_TO_LO = {};
  DUAL_RANGES.forEach(function (d) { DUAL_HI_TO_LO[d[1]] = d[0]; });

  /**
   * 绑定一对双端滑块。
   * 拖动语义为**推挤**：拖下限越过上限则把上限一起顶着走，反之亦然。
   *   为什么不是「夹住不动」：夹住时两钮贴死后就再也拉不开（尤其在轨道两端），
   *   推挤则任何位置都能继续拖，不会锁死。
   * 同时维护：高亮段位置、读数文本（重合时显示单值、张开时显示 "下限~上限"）、
   *   `.at-max` 层级反转（下限拖到最右端时把它提到上层，否则会被上限钮压住拖不回来）。
   */
  function bindDualRange(loId, hiId, valId, unit) {
    var lo = document.getElementById(loId), hi = document.getElementById(hiId);
    if (!lo || !hi) return;
    var wrap = lo.parentNode, val = document.getElementById(valId);
    var fill = wrap ? wrap.querySelector('.gen-dual-fill') : null;
    var isInt = (parseFloat(lo.step || '1') % 1) === 0;
    function fmt(v) { return isInt ? String(parseInt(v, 10)) : String(+parseFloat(v).toFixed(2)); }
    function redraw() {
      var min = parseFloat(lo.min), max = parseFloat(lo.max), span = (max - min) || 1;
      var a = parseFloat(lo.value), b = parseFloat(hi.value);
      if (fill) {
        fill.style.left = ((a - min) / span * 100) + '%';
        fill.style.width = ((b - a) / span * 100) + '%';
      }
      var same = (a === b);
      if (val) {
        val.textContent = same ? (fmt(a) + unit) : (fmt(a) + '~' + fmt(b) + unit);
        val.classList.toggle('is-range', !same);
      }
      if (wrap && wrap.classList) wrap.classList.toggle('at-max', a >= max);
    }
    lo.addEventListener('input', function () {
      if (parseFloat(lo.value) > parseFloat(hi.value)) hi.value = lo.value;   // 推挤上限
      redraw();
    });
    hi.addEventListener('input', function () {
      if (parseFloat(hi.value) < parseFloat(lo.value)) lo.value = hi.value;   // 推挤下限
      redraw();
    });
    redraw();
  }
  /** 重画全部双端滑块（读方案后调用；applyScheme 直接改 value 不触发 input） */
  // ==================== 【v147】难度档 + 压力来源（参数分层的第一层）====================
  // 用户 2026-10-15：「我还是觉得这个参数太多了，很难调整」。做法：把 20 个难度旋钮打包成 4 档，
  //   平时只动「难度档 + 压力来源」；档位会把具体数值【写进下面那些控件】，所以自动与手动微调
  //   是同一套数字（不会出现"档位说 18% 实际跑 10%"这种两套口径）。
  // 数值来源：方案文件夹里那几份实产方案 + v137 锚点切盒的实测（锚点切是唯一能自动做出真卡点的切法）。
  var GEN_PRESETS = {
    '简单': { ice: [0, 8],   black: [0, 0],   chain: [0, 1], q: [0, 6],   pipes: [2, 3], rolls: 0, prob: 0.4, easy: 60, cut: 'trend',
              types: [] },
    '标准': { ice: [10, 18], black: [0, 8],   chain: [2, 4], q: [6, 12],  pipes: [3, 4], rolls: 2, prob: 0.4, easy: 30, cut: 'trend',
              types: ['iceCluster', 'chainCluster', 'questionCluster', 'bigBox'] },
    '困难': { ice: [18, 28], black: [8, 14],  chain: [4, 6], q: [10, 18], pipes: [4, 5], rolls: 3, prob: 0.5, easy: 10, cut: 'trend',
              types: ['narrowPath', 'iceCluster', 'chainCluster', 'questionCluster', 'chainIce', 'narrowGapIce', 'bigBox', 'rareColorKey'] },
    '极难': { ice: [22, 32], black: [10, 16], chain: [5, 8], q: [12, 20], pipes: [4, 5], rolls: 4, prob: 0.6, easy: 0,  cut: 'anchor',
              types: ['narrowPath', 'iceCluster', 'chainCluster', 'questionCluster', 'chainIce', 'pipeChain', 'narrowGapIce', 'narrowGapChain', 'bigBox', 'rareColorKey', 'swap', 'inflate'] }
  };
  var GEN_CHOKE_KEYS = ['narrowPath','iceCluster','chainCluster','questionCluster','chainIce','pipeChain',
                        'narrowGapIce','narrowGapChain','bigBox','rareColorKey','swap','inflate'];
  var GEN_SRC_KEYS = ['numice','chain','question','narrow','pipe'];
  function genVal(id, v) { var e = document.getElementById(id); if (e) e.value = String(v); }
  function genRange(loId, hiId, v) { genVal(loId, v[0]); genVal(hiId, v[1]); }
  function genChk(id, v) { var e = document.getElementById(id); if (e) e.checked = !!v; }
  function genChkVal(id) { var e = document.getElementById(id); return !!(e && e.checked); }
  function genPresetName() { var e = document.getElementById('gen-preset'); return e ? e.value : '标准'; }

  /** 把某一档的数值写进各控件（含双端滑块 → 写完统一重画）。 */
  function applyGenPreset(name) {
    var p = GEN_PRESETS[name];
    if (!p) { updatePresetInfo(); return; }        // 自定义：不动任何数值
    genRange('gen-ice', 'gen-ice-max', p.ice);
    genRange('gen-black', 'gen-black-max', p.black);
    genRange('gen-chains', 'gen-chains-max', p.chain);
    genRange('gen-surprise', 'gen-surprise-max', p.q);
    genRange('gen-min-pipes', 'gen-min-pipes-max', p.pipes);
    genVal('gen-choke-rolls', p.rolls);
    genVal('gen-choke-prob', p.prob);
    genVal('gen-easy-ratio', p.easy);
    genVal('gen-box-cut', p.cut);
    GEN_CHOKE_KEYS.forEach(function (k) { genChk('gen-choke-' + k, p.types.indexOf(k) >= 0); });
    GEN_SRC_KEYS.forEach(function (k) { genChk('gen-src-' + k, true); });   // 换档 = 恢复该档该有的全部压力来源
    if (typeof refreshDualRanges === 'function') refreshDualRanges();
    updatePresetInfo();
  }

  /** 压力来源：在难度档之上做减法 —— 取消勾选 = 把那一类障碍清零。 */
  function applyStressSources() {
    var p = GEN_PRESETS[genPresetName()] || GEN_PRESETS['标准'];
    function v(k) { return genChkVal('gen-src-' + k); }
    if (v('numice')) genRange('gen-ice', 'gen-ice-max', p.ice); else genRange('gen-ice', 'gen-ice-max', [0, 0]);
    if (v('chain')) genRange('gen-chains', 'gen-chains-max', p.chain); else genRange('gen-chains', 'gen-chains-max', [0, 0]);
    if (v('question')) genRange('gen-surprise', 'gen-surprise-max', p.q); else genRange('gen-surprise', 'gen-surprise-max', [0, 0]);
    if (v('pipe')) genRange('gen-min-pipes', 'gen-min-pipes-max', p.pipes); else genRange('gen-min-pipes', 'gen-min-pipes-max', [0, 0]);
    genChk('gen-narrow', v('narrow'));
    genVal('gen-narrow-prob', v('narrow') ? 1 : 0);
    if (!v('narrow')) genChk('gen-choke-narrowPath', false);
    if (typeof refreshDualRanges === 'function') refreshDualRanges();
    updatePresetInfo();
  }

  /** 难度档那一行下面的一行小字：把"当前实际生效的难度画像"摊开，免得藏在折叠里看不见。 */
  function updatePresetInfo() {
    var el = document.getElementById('gen-preset-info');
    if (!el) return;
    var name = genPresetName();
    var p = GEN_PRESETS[name];
    function num(id) { var e = document.getElementById(id); return e ? e.value : '-'; }
    function num2(id) { var e = document.getElementById(id); return e ? e.value : '-'; }
    var srcOff = GEN_SRC_KEYS.filter(function (k) { return !genChkVal('gen-src-' + k); });
    if (p) {
      el.textContent = '难度档「' + name + '」：数字冰 ' + num('gen-ice') + '~' + num2('gen-ice-max') + '%　黑块 ' +
        num('gen-black') + '~' + num2('gen-black-max') + '%　锁链 ' + num('gen-chains') + '~' + num2('gen-chains-max') +
        ' 对　问号 ' + num('gen-surprise') + '~' + num2('gen-surprise-max') + '%　管道下限 ' + num('gen-min-pipes') +
        '　卡点类型 ' + num('gen-choke-rolls') + '×' + num('gen-choke-prob') + '　简单关 ' + num('gen-easy-ratio') + '%' +
        (srcOff.length ? '　（已关：' + srcOff.join('、') + '）' : '');
    } else {
      el.textContent = '自定义：下面的数值由你直接控制。';
    }
  }

  /**
   * 【v153】高级参数：界面上**永不出现**（用户 2026-10-16：「那些高级参数就不要了吧」）。
   *   默认只留 5 张卡：导入目标图 / 生成设置 / 开始生产 / 进度 / 结果。
   *   自动档会自己填盒容量、可用空间、冰/链/问号/管道的数量，所以那六段平时不用看。
   *   需要精调时按 **Ctrl+Shift+A** 临时打开（只是不显示，DOM 与 getGenConfig 的读取一律保留，
   *   所以"看不见" ≠ "配置变了"）。
   */
  var genAdvancedForce = false;
  var genAllForce = false;
  /**
   * 【v196】两级可见性：
   *   一级（显示高级参数）：只开【参数方案】+【批量生产参数】——日常真要动的；
   *   二级（显示全部参数）：才开基础参数/障碍/棋盘/卡点类型/切球规划器；
   *   批量段里的"怪参数"行（卡点类型 12 勾选、检查次数×概率、位置区间、并发、碎色）标 .adv-full，二级才显示。
   */
  function applyAdvancedVisibility() {
    var on = !!genAdvancedForce;
    ['gen-sec-scheme', 'gen-sec-batch'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.classList.toggle('hidden', !on);
    });
    var all = on && !!genAllForce;
    ['gen-sec-basic', 'gen-sec-obstacle', 'gen-sec-board', 'cutplanner-card'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.classList.toggle('hidden', !all);
    });
    var nodes = document.querySelectorAll('.adv-full');
    for (var i = 0; i < nodes.length; i++) nodes[i].classList.toggle('hidden', !all);
    var wrap = document.getElementById('gen-show-all-wrap');
    if (wrap) wrap.style.display = on ? '' : 'none';
    var allChk = document.getElementById('gen-show-all');
    if (allChk) allChk.checked = !!genAllForce;
  }

  function refreshDualRanges() {
    DUAL_RANGES.forEach(function (d) {
      var lo = document.getElementById(d[0]), hi = document.getElementById(d[1]);
      if (!lo || !hi) return;
      if (parseFloat(hi.value) < parseFloat(lo.value)) hi.value = lo.value;   // 方案里若上下限颠倒，按上限=下限收敛（不静默放大区间）
      try { lo.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
    });
  }

  /**
   * 【v120】读一个数值控件；读不到控件、空值或非法 → 返回给定默认值。
   * 用于卡点类型的逐类参数：这些参数**必须有值**（不像区间上限那样「留空=不启用」），
   * 缺控件时也要能跑（例如旧页面缓存、或在 Node 侧直接调 produce）。
   * @param {string} id 控件 ID
   * @param {number} dflt 默认值
   * @param {boolean} isInt 是否取整
   */
  function numOr(id, dflt, isInt) {
    var el = document.getElementById(id);
    if (!el || el.value === '' || el.value == null) return dflt;
    var v = isInt ? parseInt(el.value, 10) : parseFloat(el.value);
    return isNaN(v) ? dflt : v;
  }

  /**
   * 读一对区间控件 → {min, max}。**两钮重合或读不出数 → 双 null（不启用区间）**。
   * 返回 null 时 generator 退回读同名单值参数（`icePercent` 等），逐值等价 v114。
   */
  function readRange(minId, maxId, isInt) {
    var loEl = document.getElementById(minId), hiEl = document.getElementById(maxId);
    if (!loEl || !hiEl) return { min: null, max: null };
    var parse = isInt ? function (s) { return parseInt(s, 10); } : parseFloat;
    var a = parse(loEl.value), b = parse(hiEl.value);
    if (isNaN(a) || isNaN(b)) return { min: null, max: null };
    if (b > a) return { min: a, max: b };
    if (b < a) return { min: b, max: a };     // 防御：真出现颠倒也按区间处理，不丢用户意图
    return { min: null, max: null };          // 重合 = 不启用区间
  }

  // 抓取当前所有生成器输入 → {id: value|checked}

  function captureScheme() {
    var o = {};
    var psel = document.getElementById('gen-preset'); if (psel) psel.value = '自定义';   // 【v147】读了方案 = 不再是某一档
    SCHEME_INPUTS.forEach(function (id) {
      var el = document.getElementById(id); if (!el) return;
      o[id] = (el.type === 'checkbox') ? !!el.checked : el.value;
    });
    return o;
  }
  // 应用方案到输入控件（并触发 input 事件更新滑块标签）
  function applyScheme(inputs) {
    if (!inputs) return;
    // 【v185】载入方案 = 你要的就是这份数值：自动切到「方案/手调」。
    //   原因：自动档会用"按图推"的值覆盖方案里的盒容量/障碍数量，载入后看起来"没生效"。
    var _pm = document.getElementById('gen-param-mode');
    if (_pm && _pm.value !== 'manual') {
      _pm.value = 'manual';
      try { _pm.dispatchEvent(new Event('change')); } catch (e) {}
      genLog('参数来源已切到「方案 / 手调」（自动档会覆盖方案里的盒容量与障碍数量）', 'gen-log-warn');
    }
    SCHEME_INPUTS.forEach(function (id) {
      if (!(id in inputs)) return;
      var el = document.getElementById(id); if (!el) return;
      if (el.type === 'checkbox') { el.checked = !!inputs[id]; }
      else if (DUAL_HI_TO_LO[id] && (inputs[id] == null || inputs[id] === '')) {
        // 【v116 旧方案兼容 · 必需】v115 的方案里上限存的是空串（= 当时的「不启用区间」）。
        // 直接把 '' 赋给 range 控件，浏览器会把它落到**区间中点**（如冰 0~40 → 20），
        // 于是「原本不启用区间」被静默变成「18~20 启用区间」——批次参数与方案不符且无从察觉。
        // 故这里显式收敛为「上限 = 下限」，即双端滑块下的不启用区间态，与 v115 语义逐值等价。
        var loEl = document.getElementById(DUAL_HI_TO_LO[id]);
        el.value = loEl ? loEl.value : el.min;
      }
      else el.value = inputs[id];
      try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
    });
    refreshDualRanges();   // 统一重画高亮段与读数（方案里上下限颠倒时也在此收敛）
  }
  function loadSchemes() {
    try { return JSON.parse(localStorage.getItem(SCHEME_KEY) || '[]'); } catch (e) { return []; }
  }
  function saveSchemesArr(arr) {
    try { localStorage.setItem(SCHEME_KEY, JSON.stringify(arr)); } catch (e) { alert('方案保存失败(localStorage): ' + e.message); }
  }
  function renderSchemeSelect(selId) {
    var sel = document.getElementById('gen-scheme-sel'); if (!sel) return;
    var arr = loadSchemes();
    var html = '<option value="">— 已保存方案 (' + arr.length + ') —</option>';
    arr.forEach(function (s) { html += '<option value="' + s.id + '">' + (s.name || s.id) + '</option>'; });
    sel.innerHTML = html;
    if (selId) sel.value = selId;
  }
  // 保存：有方案名→新建/同名覆盖；名空且选中了方案→覆盖所选；否则自动命名
  function saveSchemeHandler() {
    var nameEl = document.getElementById('gen-scheme-name');
    var sel = document.getElementById('gen-scheme-sel');
    var name = (nameEl && nameEl.value || '').trim();
    var arr = loadSchemes();
    var inputs = captureScheme();
    var picked = null;
    if (!name && sel && sel.value) picked = arr.filter(function (s) { return s.id === sel.value; })[0];
    if (!picked && name) picked = arr.filter(function (s) { return s.name === name; })[0];
    if (picked) {
      picked.inputs = inputs; picked.savedAt = new Date().toISOString();
      saveSchemesArr(arr); renderSchemeSelect(picked.id);
    } else {
      if (!name) name = '方案' + (arr.length + 1);
      var id = 'sc_' + Date.now();
      arr.push({ id: id, name: name, inputs: inputs, savedAt: new Date().toISOString() });
      saveSchemesArr(arr); renderSchemeSelect(id);
    }
    if (nameEl) nameEl.value = '';
  }
  function loadSelectedScheme() {
    var sel = document.getElementById('gen-scheme-sel');
    if (!sel || !sel.value) { alert('请先在下拉框选择一个方案'); return; }
    var s = loadSchemes().filter(function (x) { return x.id === sel.value; })[0];
    if (s) { applyScheme(s.inputs); var n = document.getElementById('gen-scheme-name'); if (n) n.value = s.name || ''; }
  }
  function delSchemeHandler() {
    var sel = document.getElementById('gen-scheme-sel');
    if (!sel || !sel.value) return;
    if (!confirm('删除方案「' + (sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : '') + '」?')) return;
    var arr = loadSchemes().filter(function (x) { return x.id !== sel.value; });
    saveSchemesArr(arr); renderSchemeSelect();
  }
  // 导出：优先导出所选方案；否则导出当前参数
  function exportSchemeHandler() {
    var sel = document.getElementById('gen-scheme-sel');
    var nameEl = document.getElementById('gen-scheme-name');
    var name, inputs;
    if (sel && sel.value) { var s = loadSchemes().filter(function (x) { return x.id === sel.value; })[0]; name = s ? s.name : '方案'; inputs = s ? s.inputs : captureScheme(); }
    else { name = (nameEl && nameEl.value || '当前参数').trim(); inputs = captureScheme(); }
    // 【v186】version 2：界面删掉了 C 档控件；旧方案里多出来的字段载入时会被忽略（applyScheme 按现存控件取）
    var obj = { type: 'antGenScheme', version: 2, name: name, savedAt: new Date().toISOString(), inputs: inputs, config: getGenConfig() };
    downloadJSON(obj, '方案_' + safeName(name) + '.json');
  }
  function handleSchemeSelect(e) {
    var file = e.target.files[0]; if (!file) return;
    var reader = new FileReader();
    reader.onload = function (ev) {
      try {
        var obj = JSON.parse(ev.target.result);
        var inputs = obj.inputs || obj;   // 兼容直接是 inputs 映射
        applyScheme(inputs);
        var nm = (obj.name || file.name.replace(/\.json$/i, '') || '导入方案');
        var arr = loadSchemes();
        var exist = arr.filter(function (s) { return s.name === nm; })[0];
        if (exist) { exist.inputs = inputs; exist.savedAt = new Date().toISOString(); saveSchemesArr(arr); renderSchemeSelect(exist.id); }
        else { var id = 'sc_' + Date.now(); arr.push({ id: id, name: nm, inputs: inputs, savedAt: new Date().toISOString() }); saveSchemesArr(arr); renderSchemeSelect(id); }
        alert('已导入并应用方案: ' + nm);
      } catch (err) { alert('方案JSON解析失败: ' + err.message); }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  function bindClick(id, fn) {
    var el = document.getElementById(id);
    if (el && fn) el.addEventListener('click', fn);
  }

  // 单端滑块 → 读数绑定。**v116 起暂无调用方**：原三处调用（冰/黑/问号比例）已改用
  // bindDualRange（双端滑块自带读数）。保留本函数不删：它是通用工具，后续新增单值滑块仍会用到，
  // 且删除属于本轮未获批的清理动作。
  function bindSlider(sliderId, valId, fmt) {
    var s = document.getElementById(sliderId);
    var v = document.getElementById(valId);
    if (s && v) s.addEventListener('input', function() { v.textContent = fmt(this.value); });
  }

  // ==================== 关卡导入 ====================
  function importLevel() { document.getElementById('file-input').click(); }

  function handleFileSelect(e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(ev) {
      try { loadLevel(JSON.parse(ev.target.result)); }
      catch (err) { alert('JSON解析失败: ' + err.message); }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  function importTXT() { document.getElementById('txt-input').click(); }

  // 关卡列表存储
  // 【v154】每条多了色库相关字段：
  //   rawBlocks   原始编号矩阵（**永不改变**，反复互转都以它为准，避免转了又转叠加误差）
  //   detectedLib 自动识别的色库；confident=false 表示判据不足（实心图）
  //   usedLib     实际按哪套色库解释（= 「读图色库」下拉的选择或自动结果）
  //   convStats   官方→老 的转换统计（老色库读入时为 null）
  var levelList = []; // [{name, blocks, txt, rawBlocks, detectedLib, confident, usedLib, convStats}]
  var currentLevelIdx = -1;

  // ==================== 【v154】色库：读图色库 + 新老互转 ====================
  // 两套色库：老色库 34 色（0 = 空位，1-34 = 颜色，求解器内部一直用的编号空间）
  //           官方色库 0-21（-1 = 空位，0 = 黄色，官方 JSON 原始颜色矩阵那套）
  // 两套色库**没有一个同 Hex 的色**（已逐一比对），所以「按哪套读」会实打实改变颜色，
  // 必须显式可选。求解器内部一律只跑老色库编号，转换只发生在导入/导出 TXT 的边界上。
  var COLORS = AntSolver.ColorLibs;
  var readLibChoice = 'auto';    // 顶栏下拉当前值：'auto' | 'older' | 'official'
  var CL_ERR = '色库模块 js/color-libs.js 未加载';

  /** 按「读图色库」下拉决定一张图该按哪套色库解释。 */
  function pickReadLib(rawBlocks) {
    if (!COLORS) return { lib: 'older', confident: false, detected: 'older', reason: CL_ERR };
    var d = COLORS.detect(rawBlocks);
    if (readLibChoice === 'older' || readLibChoice === 'official') {
      return { lib: readLibChoice, confident: d.confident, detected: d.lib,
               reason: '按「读图色库」手动指定（自动判定为' + (d.lib === 'official' ? '官方色库' : '老色库') +
                       (d.confident ? '' : '，但判据不足') + '）' };
    }
    return { lib: d.lib, confident: d.confident, detected: d.lib, reason: d.reason };
  }

  /** 源编号矩阵 → 求解器内部编号空间（老色库 0 空 / 1-34 色）。 */
  function toSolverBlocks(rawBlocks, lib) {
    if (!COLORS || lib === 'older') return { blocks: rawBlocks, stats: null };
    var r = COLORS.toSolver(rawBlocks);
    return { blocks: r.matrix, stats: r.stats };
  }

  /** 刷新「导入目标图」里的色库提示行。 */
  function renderColorlibHint() {
    var el = document.getElementById('gen-colorlib-hint');
    if (!el) return;
    var nOff = 0, nUnclear = 0;
    for (var i = 0; i < levelList.length; i++) {
      if (levelList[i].usedLib === 'official') nOff++;
      if (levelList[i].confident === false) nUnclear++;
    }
    var parts = [];
    if (nOff) parts.push('已按官方色库 0-21 读入并转成老色库 34 色：' + nOff + ' 张');
    if (nUnclear) parts.push('⚠ ' + nUnclear + ' 张判据不足（实心图，两套色库都能解释），可开「🎨 色库转换」核对');
    el.className = 'gen-hint' + (nUnclear ? ' colorlib-warn' : '');
    el.textContent = parts.join(' · ');
  }

  function handleTXTSelect(e) {
    var files = e.target.files;
    if (!files || files.length === 0) return;

    // 【v154】两遍处理：第一遍只读文本（异步），第二遍才解析+判色库。
    //   原实现边读边解析，导致「读图色库」下拉在解析完之前改不了、也没法回头重判；
    //   现在先收集文本，全部到齐后统一处理，色库判定一次成型。
    var read = [], loaded = 0, total = files.length;
    for (var i = 0; i < files.length; i++) {
      (function (file, idx) {
        var reader = new FileReader();
        reader.onload = function (ev) {
          read[idx] = { name: file.name, txt: String(ev.target.result) };
          loaded++;
          if (loaded >= total) applyImportedTXT(read);
        };
        reader.onerror = function () {
          read[idx] = null; loaded++;
          if (loaded >= total) applyImportedTXT(read);
        };
        reader.readAsText(file);
      })(files[i], i);
    }
    e.target.value = '';
  }

  /** 第二遍：解析文本 → 判色库 → 转成求解器编号 → 填 levelList。 */
  function applyImportedTXT(read) {
    levelList = [];
    currentLevelIdx = -1;
    var badFiles = [];

    for (var i = 0; i < read.length; i++) {
      var item = read[i];
      if (!item) continue;
      var rawBlocks = null;
      try { rawBlocks = COLORS ? COLORS.parseTXT(item.txt) : AntSolver.Generator.blocksFromTXT(item.txt); }
      catch (err) { rawBlocks = null; }
      if (!rawBlocks || !rawBlocks.length || !rawBlocks[0].length) { badFiles.push(item.name); continue; }

      var pick = pickReadLib(rawBlocks);
      var conv = { blocks: rawBlocks, stats: null };
      try { conv = toSolverBlocks(rawBlocks, pick.lib); }
      catch (err2) { badFiles.push(item.name + '（色库转换失败）'); continue; }

      levelList.push({
        name: item.name,
        blocks: conv.blocks,
        txt: item.txt,
        rawBlocks: rawBlocks,          // 原始编号（不随转换改变，供反复互转）
        convStats: conv.stats,         // 官方→老的转换统计（老色库读入时为 null）
        detectedLib: pick.detected,
        confident: pick.confident,
        libReason: pick.reason,
        usedLib: pick.lib
      });
    }

    if (levelList.length === 0) { alert('未解析到有效TXT文件'); return; }
    // 显示关卡列表
    document.getElementById('level-list-panel').classList.remove('hidden');
    document.getElementById('level-list-count').textContent = '(' + levelList.length + ')';
    renderLevelList();
    renderGenFileList();
    renderColorlibHint();
    if (badFiles.length) console.warn('[色库] 以下文件解析失败，已跳过：', badFiles);
    // 自动加载第一关（这一步会把 currentLevelIdx 从 -1 设成 0）
    selectLevel(0);
    // 【顺序要紧】色库面板必须在 selectLevel 之后渲染：它读的是 currentLevelIdx，
    //   在 -1 时渲染会显示成"当前没有导入的图"，用户打开面板会看到空白。
    renderColorlibPanel();
  }

  /** 按各自的原始编号 + 色库判定，重放一遍导入结果（改下拉后调用）。 */
  function reinterpretAll() {
    for (var i = 0; i < levelList.length; i++) {
      var en = levelList[i];
      if (!en.rawBlocks) continue;
      var pick = pickReadLib(en.rawBlocks);
      var conv = { blocks: en.rawBlocks, stats: null };
      try { conv = toSolverBlocks(en.rawBlocks, pick.lib); } catch (err) { continue; }
      setEntryBlocks(en, conv.blocks);   // 【v155】两份 blocks 必须同一份，否则改目标图会丢（见 setEntryBlocks）
      en.convStats = conv.stats;
      en.detectedLib = pick.detected;
      en.confident = pick.confident;
      en.libReason = pick.reason;
      en.usedLib = pick.lib;
      en._colorCount = null;          // 颜色数缓存失效
    }
  }

  /** 把当前关按最新 blocks 重新装进界面（board 传 null = 清掉棋盘缓存，需要重新生成）。 */
  function reloadCurrentEntry() {
    if (currentLevelIdx < 0 || currentLevelIdx >= levelList.length) return;
    var en = levelList[currentLevelIdx];
    var tbuf = parseInt((document.getElementById('gen-buffer') || {}).value) || 5;
    loadLevel({ blocks: en.blocks, bufferLimit: tbuf, board: null });
    // loadLevel 会先把「求解结果」隐藏掉，这里再填上色库说明并显示，口径与原导入提示一致。
    var trr = en.blocks.length, tcc = en.blocks[0] ? en.blocks[0].length : 0;
    var html = '<p>' + en.name + '</p>';
    html += '<p style="font-size:11px;color:#888">已导入目标图 ' + trr + '×' + tcc + '（未生产棋盘）。点「生成」按当前参数生产棋盘。</p>';
    html += colorlibDetailHtml(en);
    document.getElementById('solve-result').classList.remove('hidden');
    document.getElementById('solve-details').innerHTML = html;
  }

  /** 色库说明行（导入提示 / 重判提示共用）。 */
  function colorlibDetailHtml(en) {
    var html = '';
    if (en.usedLib === 'official') {
      html += '<p style="font-size:11px;color:#666">🎨 色库：按官方色库 0-21 读入 → 已转成老色库 34 色' +
        (en.convStats && en.convStats.colors ? '（' + en.convStats.colors + ' 色）' : '') + '</p>';
    } else {
      html += '<p style="font-size:11px;color:#666">🎨 色库：老色库 34 色（0 = 空位）</p>';
    }
    if (en.confident === false) {
      html += '<p style="font-size:11px;color:#e6a23c">⚠ ' + (en.libReason || '色库判据不足') + '</p>';
    }
    return html;
  }

  /**
   * 改了「读图色库」后：按新的选择重判本批全部图，并刷新当前关。
   * 不调 loadLevel（那样会清掉左栏的求解结果、也不重置入口模式），只就地换 blocks，
   * 同时把棋盘缓存打空 —— 色号变了，旧棋盘上的盒颜色已经对不上了，必须重新生成。
   */
  function reimportWithCurrentLib() {
    if (!COLORS || !levelList.length) return;
    reinterpretAll();
    renderColorlibHint();
    renderColorlibPanel();
    if (currentLevelIdx < 0 || currentLevelIdx >= levelList.length) return;
    var en = levelList[currentLevelIdx];
    currentLevel = AntSolver.parseLevel({ blocks: en.blocks, bufferLimit: currentLevel.bufferLimit, board: null });
    currentGenerationEval = null;
    currentChokeInfo = null;
    renderLevelInfo();
    renderTarget(null);
    renderQueues(null);
    document.getElementById('solve-result').classList.remove('hidden');
    document.getElementById('solve-details').innerHTML =
      '<p>' + en.name + '</p><p style="font-size:11px;color:#888">已按新的「读图色库」重判本批全部图。' +
      '棋盘缓存已清空，点「生成」重新生产。</p>' + colorlibDetailHtml(en);
  }

  /** 「🎨 色库转换」开关面板。 */
  function toggleColorlibPanel(force) {
    var p = document.getElementById('colorlib-panel');
    if (!p) return;
    var show = (force === undefined) ? p.classList.contains('hidden') : !!force;
    p.classList.toggle('hidden', !show);
    if (show) renderColorlibPanel();
  }

  /** 面板内容：当前图色库、方向默认值、色值对照表（标出本图真正用到的色）。 */
  function renderColorlibPanel() {
    var cur = document.getElementById('colorlib-current-lib');
    var mapEl = document.getElementById('colorlib-map');
    var note = document.getElementById('colorlib-note');
    var dirSel = document.getElementById('colorlib-direction');
    if (!mapEl) return;
    if (!COLORS) { mapEl.innerHTML = '<p style="font-size:11px;color:#a33">' + CL_ERR + '</p>'; return; }

    var en = (currentLevelIdx >= 0 && currentLevelIdx < levelList.length) ? levelList[currentLevelIdx] : null;
    var curLib = en ? en.usedLib : 'older';
    if (cur) {
      cur.textContent = (curLib === 'official' ? '官方色库 0-21' : '老色库 34 色') +
        (en ? '（' + en.name + (en.confident === false ? ' · 判据不足' : '') + '）' : '（当前没有导入的图）');
    }
    if (dirSel) {
      // 只在**确实有当前图**时才自动翻方向：没有图时翻了也没用，还会让"看起来没反应"变成困惑。
      if (en) dirSel.value = (curLib === 'official') ? 'older' : 'official';
    }
    if (note) {
      note.className = 'colorlib-note' + (en && en.confident === false ? ' warn' : '');
      note.textContent = en ? (en.libReason || '') : '先导入目标图 TXT，这里会显示判定依据';
    }

    var toLib = dirSel ? dirSel.value : 'older';
    var fromLib = (curLib === 'official') ? 'official' : 'older';
    var M = null;
    try { M = COLORS.map(fromLib, toLib); } catch (e) { M = null; }
    if (!M) { mapEl.innerHTML = '<p style="font-size:11px;color:#a33">映射表构建失败</p>'; return; }

    var used = {};
    if (en && en.rawBlocks) {
      for (var r = 0; r < en.rawBlocks.length; r++) for (var c = 0; c < en.rawBlocks[r].length; c++) {
        var v = en.rawBlocks[r][c];
        used[v] = (used[v] || 0) + 1;
      }
    }
    var html = '<table><thead><tr><th>源色号</th><th>源色值</th><th>→</th><th>目标色号</th><th>目标色值</th><th>色差</th><th>本图用量</th></tr></thead><tbody>';
    for (var i = 0; i < M.rows.length; i++) {
      var r2 = M.rows[i];
      var cnt = used[r2.from];
      html += '<tr class="' + (cnt ? 'colorlib-used' : '') + '">' +
        '<td>' + r2.from + ' ' + r2.fromName + '</td>' +
        '<td><span class="colorlib-sw" style="background:' + r2.fromHex + '"></span>' + r2.fromHex + '</td>' +
        '<td>→</td>' +
        '<td>' + r2.to + ' ' + r2.toName + '</td>' +
        '<td><span class="colorlib-sw" style="background:' + r2.toHex + '"></span>' + r2.toHex + '</td>' +
        '<td>' + r2.dist.toFixed(0) + '</td>' +
        '<td>' + (cnt ? cnt + (r2.exact ? ' 精确' : '') : '-') + '</td>' +
        '</tr>';
    }
    html += '</tbody></table>';
    mapEl.innerHTML = html;
  }

  /** 单张图转换（永远从 rawBlocks 出发，避免转了又转叠加误差）。 */
  function convertEntryBlocks(en, toLib) {
    var fromLib = (en.usedLib === 'official') ? 'official' : 'older';
    var res = COLORS.convertMatrix(en.rawBlocks, fromLib, toLib);
    return { outBlocks: res.matrix, fromLib: fromLib, toLib: toLib, stats: res.stats };
  }

  function libTag(lib) { return lib === 'official' ? '官方色库0-21' : '老色库34色'; }

  /** 本批全部转换：'preview' 只改页面预览；'download' 改预览并下载转换后的 TXT。
   *  toLib 由调用方在渲染前读定并传入（见 colorlib-apply 里那段注释：面板渲染会翻方向下拉）。 */
  function applyColorlibBatch(mode, toLib) {
    if (!toLib) toLib = (document.getElementById('colorlib-direction') || {}).value || 'older';
    if (!levelList.length) { alert('还没有导入任何目标图'); return '还没有导入任何目标图'; }
    if (!COLORS) { alert(CL_ERR); return CL_ERR; }

    var nSame = 0, outs = [];
    for (var i = 0; i < levelList.length; i++) {
      var en = levelList[i];
      if (!en.rawBlocks) continue;
      try {
        var cv = convertEntryBlocks(en, toLib);
        outs.push({ name: en.name, txt: COLORS.renderTXT(cv.outBlocks, '像素矩阵') });
        if (cv.fromLib === toLib) nSame++;
        setEntryBlocks(en, cv.outBlocks);  // 预览与后续生产都用转换后的编号（【v155】两份引用一起换）
        en.usedLib = toLib;
        en._colorCount = null;
      } catch (err) {
        console.warn('[色库] 转换失败：' + en.name, err);
      }
    }

    if (mode === 'download') {
      for (var j = 0; j < outs.length; j++) {
        var base = String(outs[j].name).replace(/\.txt$/i, '');
        downloadText(base + '_' + libTag(toLib) + '.txt', outs[j].txt);
      }
      reloadCurrentEntry();
      renderGenFileList(); renderColorlibHint(); renderColorlibPanel();
      return '已下载 ' + outs.length + ' 个 TXT（目标色库：' + libTag(toLib) + '）。';
    }

    reloadCurrentEntry();
    renderGenFileList();
    renderColorlibHint();
    renderColorlibPanel();
    return '已把本批 ' + levelList.length + ' 张的预览改成「' + libTag(toLib) + '」' +
      (nSame ? '（其中 ' + nSame + ' 张本来就是这个色库）' : '') +
      '，棋盘缓存已清空，按需重新点「生成」。';
  }

  // ==================== 生成器页面：文件列表(排序/分组/筛选/删除) ====================
  // 统计某目标图条目的颜色数(用于排序/分组)：blocks 中出现的正整数色值去重计数。
  function genFileColorCount(entry) {
    if (entry._colorCount != null) return entry._colorCount;
    var set = {}, blocks = entry.blocks || [];
    for (var r = 0; r < blocks.length; r++) for (var c = 0; c < blocks[r].length; c++) { var v = blocks[r][c]; if (v > 0) set[v] = 1; }
    entry._colorCount = Object.keys(set).length;
    return entry._colorCount;
  }
  function genFileSize(entry) {
    var blocks = entry.blocks || [];
    return blocks.length + (blocks[0] ? blocks[0].length : 0);
  }
  function renderGenFileList() {
    var container = document.getElementById('gen-file-list');
    var emptyEl = document.getElementById('gen-file-empty');
    if (!container) return;
    if (!levelList.length) {
      container.innerHTML = '';
      if (emptyEl) emptyEl.classList.remove('hidden');
      return;
    }
    if (emptyEl) emptyEl.classList.add('hidden');
    var sortBy = (document.getElementById('gen-file-sort') || {}).value || 'name';
    var groupOn = !!(document.getElementById('gen-file-group') || {}).checked;
    var items = levelList.map(function (e, i) { return { entry: e, idx: i }; });
    items.sort(function (a, b) {
      if (sortBy === 'colors') return genFileColorCount(a.entry) - genFileColorCount(b.entry);
      if (sortBy === 'size') return genFileSize(a.entry) - genFileSize(b.entry);
      return String(a.entry.name).localeCompare(String(b.entry.name), 'zh');
    });
    if (genFileFilter.color != null) items = items.filter(function (x) { return genFileColorCount(x.entry) === genFileFilter.color; });

    var html = '';
    if (groupOn) {
      var groups = {}, order = [];
      items.forEach(function (x) {
        var key = genFileColorCount(x.entry);
        if (!groups[key]) { groups[key] = []; order.push(key); }
        groups[key].push(x);
      });
      order.sort(function (a, b) { return a - b; });
      order.forEach(function (key) {
        var active = genFileFilter.color === key;
        html += '<div class="gen-file-group-head' + (active ? ' active' : '') + '" data-color="' + key + '">' +
          key + ' 种颜色 <span>(' + groups[key].length + ')</span></div>';
        groups[key].forEach(function (x) { html += genFileItemHtml(x.entry, x.idx); });
      });
    } else {
      items.forEach(function (x) { html += genFileItemHtml(x.entry, x.idx); });
    }
    if (genFileFilter.color != null) html = '<div class="gen-file-filter-bar">筛选: ' + genFileFilter.color + '种颜色 <button id="gen-file-filter-clear">✕清除</button></div>' + html;
    container.innerHTML = html;

    var heads = container.querySelectorAll('.gen-file-group-head');
    for (var i = 0; i < heads.length; i++) {
      heads[i].addEventListener('click', function () {
        var c = parseInt(this.dataset.color, 10);
        genFileFilter.color = (genFileFilter.color === c) ? null : c;
        renderGenFileList();
      });
    }
    var clearBtn = document.getElementById('gen-file-filter-clear');
    if (clearBtn) clearBtn.addEventListener('click', function () { genFileFilter.color = null; renderGenFileList(); });
    var delBtns = container.querySelectorAll('.gen-file-del');
    for (var j = 0; j < delBtns.length; j++) {
      delBtns[j].addEventListener('click', function (ev) {
        ev.stopPropagation();
        var idx = parseInt(this.dataset.idx, 10);
        levelList.splice(idx, 1);
        renderGenFileList();
        renderLevelList();
      });
    }
  }
  function genFileItemHtml(entry, idx) {
    var rows = entry.blocks.length, cols = entry.blocks[0] ? entry.blocks[0].length : 0;
    return '<div class="gen-file-item">' +
      '<span class="gen-file-name" title="' + entry.name + '">' + entry.name + '</span>' +
      '<span class="gen-file-meta">' + rows + '×' + cols + ' · ' + genFileColorCount(entry) + '色</span>' +
      '<button class="gen-file-del" data-idx="' + idx + '" title="从本批移除">✕</button>' +
      '</div>';
  }

  function renderLevelList() {
    var container = document.getElementById('level-list');
    var html = '';
    for (var i = 0; i < levelList.length; i++) {
      var cls = i === currentLevelIdx ? 'level-item active' : 'level-item';
      html += '<div class="' + cls + '" data-idx="' + i + '">' + levelList[i].name + '</div>';
    }
    container.innerHTML = html;
    // 绑定点击
    var items = container.querySelectorAll('.level-item');
    for (var i = 0; i < items.length; i++) {
      items[i].addEventListener('click', function() {
        selectLevel(parseInt(this.dataset.idx));
      });
    }
  }

  function selectLevel(idx) {
    if (idx < 0 || idx >= levelList.length) return;
    currentLevelIdx = idx;
    var entry = levelList[idx];

    // 关卡库导入的条目：已有完整关卡数据，直接加载（不重新生成）
    if (entry.level) {
      loadLevel(entry.level);
      currentImportedSolve = entry.solve || null;   // 有求解数据→模拟图表复用、免重算
      currentGenerationEval = entry.generationEval || null;
      // ===== v121·任务AK① 按导入数据里记录的玩法加载 =====
      // loadLevel 会把 currentEntryMode 复位成 'fourSide'（它无从得知本关玩法），故必须在其后设置。
      // 识别不到时**如实回落四边入口并标注「未知玩法」**，不靠棋盘结构去猜（猜错会让整关的
      // 求解/玩家模拟/难度全部按错规则跑，而页面上看不出任何异常）。
      currentEntryMode = entry.entryMode || 'fourSide';
      // 同步手点消除模式下拉：enterSimulation / doReset 都按下拉取值套用模式，
      // 这里不同步的话，进入模拟后手点消除仍按四边入口走。
      syncElimModeSelect(elimModeOfEntry(currentEntryMode));
      renderLevelList();
      // ===== v121·任务AK② 惰性难度改为「与生产审核同口径」=====
      // 原实现：difficulty(parsed, resLz, null) —— playerStats 传 null。
      //   后果：f1(权重65%)、f2(权重25%) 全为 0，分数只剩 f3×0.10，且 rankable 恒 false。
      //   即左侧显示的难度分实际上只是「障碍强度的十分之一」，与生产侧的评分不是同一个东西。
      // 现在：按本关 entryMode 跑全知 + 玩家各一遍，playerStats 如实传入。
      //   注意这是单轮(seed 7)口径，与生产审核一致；要去掉单轮抖动请用「批量重标定」(任务AK④)。
      if (!entry.difficulty && AntSolver.Analysis && AntSolver.Solver) {
        try {
          var parsedLz = AntSolver.parseLevel(entry.level);
          var resLz = solveByEntryMode(parsedLz, currentEntryMode);
          var plLz = AntSolver.PlayerSim ? AntSolver.PlayerSim.run(parsedLz, Object.assign(
            { seed: 7 }, playerOptsOfEntry(currentEntryMode))) : null;
          var psLz = plLz ? {
            won: plLz.won, avgBuffer: plLz.playerAvgBuffer, peak: plLz.bufferPeak,
            revives: plLz.revivesUsed || 0, avgResidence: plLz.avgResidence,
            effectiveTicks: plLz.effectiveTicks, residenceCount: plLz.residenceCount
          } : null;
          entry.difficulty = AntSolver.Analysis.difficulty(parsedLz, resLz, psLz);
          entry.difficultySource = psLz ? '现算·单轮(seed7)·' + entryModeLabel(currentEntryMode)
            : '现算·仅全知（玩家模拟未加载）';
        } catch (eLz) { /* 算不出就不显示难度，不影响加载 */ }
      }
      var html2 = '<p>' + entry.name + '</p>';
      // 玩法一行放在最前：它决定了下面所有数字按哪套规则算出来的
      html2 += '<p><b>玩法: ' + entryModeLabel(currentEntryMode) + '</b>' +
        (entry.entryMode
          ? '<span style="font-size:10px;color:#888"> · 来源 ' + (entry.entryModeFrom || '导入数据') + '</span>'
          : '<span style="font-size:10px;color:#e6a23c"> · 未知玩法（按四边入口加载）</span>') + '</p>';
      if (entry.entryModeConflict) {
        html2 += '<p style="font-size:10px;color:#e6a23c">⚠ 关卡数据与求解数据的玩法标记不一致（求解数据为 ' +
          entryModeLabel(entry.entryModeConflict) + '），已按关卡数据加载</p>';
      }
      if (entry.difficulty) {
        var dz = entry.difficulty;
        html2 += '<p><b>难度: ' + dz.score + '/100 [' + dz.grade + ']</b>' +
          (dz.rankable === false ? '<span style="font-size:10px;color:#e0592c"> · 不可排序</span>' : '') + '</p>';
        if (dz.parts) {
          html2 += '<p style="font-size:10px;color:#8a7358">f1 ' + dz.parts.f1 + '(×65%) · f2 ' + dz.parts.f2 +
            '(×25%) · f3 ' + dz.parts.f3 + '(×10%)' +
            (dz.parts.reviveBonus ? ' · 复活+' + dz.parts.reviveBonus : '') + '</p>';
          html2 += '<p style="font-size:10px;color:#8a7358">玩家通关 ' + (dz.playerWon ? '✓' : '✗') +
            ' · 均暂 ' + (dz.playerAvgBuffer != null ? dz.playerAvgBuffer : '-') +
            ' · 峰 ' + (dz.playerBufferPeak != null ? dz.playerBufferPeak : '-') +
            ' · 复活 ' + (dz.playerRevives || 0) + '</p>';
        }
        if (dz.scoreVersion) html2 += '<p style="font-size:10px;color:#666">评分口径: ' + dz.scoreVersion +
          (entry.difficultySource ? ' · ' + entry.difficultySource : '') + '</p>';
        if (dz.obstacleNames) html2 += '<p style="font-size:10px;color:#888">障碍: ' + dz.obstacleNames + '</p>';
      }
      if (entry.recalibrate) {
        var rc = entry.recalibrate, st = rc.stability || {};
        html2 += '<p style="font-size:10px;color:#8bc34a">🎯 重标定: ' + rc.runs + ' 轮 / ' +
          (st.distinctRoutes != null ? st.distinctRoutes : '?') + ' 条不同路线 · 通关率 ' +
          Math.round((st.winRate || 0) * 100) + '% · 分数 ' + st.scoreMin + '~' + st.scoreMax +
          '(中位 ' + st.scoreMedian + ') · 采用阈值 ' + (rc.chosen ? rc.chosen.pickThreshold : '-') + '</p>';
        if (rc.note) html2 += '<p style="font-size:10px;color:#e6a23c">' + rc.note + '</p>';
      }
      if (entry.audit) {
        var ap = entry.audit.pass;
        html2 += '<p style="font-size:10px;color:' + (ap ? '#8bc34a' : '#e0592c') + '">审核: ' + (ap ? '✓合格' : ('✗ ' + ((entry.audit.reasons && entry.audit.reasons[0]) || '不合格'))) + '</p>';
      }
      html2 += '<p style="font-size:10px;color:#666">已从关卡库导入' + (entry.solve ? '（含求解数据，免重算）' : '') + '</p>';
      document.getElementById('solve-result').classList.remove('hidden');
      document.getElementById('solve-details').innerHTML = html2;
      return;
    }

    // TXT 图条目：仅显示目标图，【不默认生产棋盘】——避免导入/切换关卡时被自动生成拖慢。
    // 需要棋盘时点「生成」按钮（runGenerate 对当前 TXT 用 produce 生成）。
    var tbuf = parseInt((document.getElementById('gen-buffer') || {}).value) || 5;
    loadLevel({ blocks: entry.blocks, bufferLimit: tbuf, board: null });
    renderLevelList();
    var trr = entry.blocks.length, tcc = entry.blocks[0] ? entry.blocks[0].length : 0;
    var html = '<p>' + entry.name + '</p>';
    html += '<p style="font-size:11px;color:#888">已导入目标图 ' + trr + '×' + tcc + '（未生产棋盘）。点「生成」按当前参数生产棋盘。</p>';
    html += colorlibDetailHtml(entry);   // 【v154】这张图按哪套色库读的 + 判据不足提醒
    document.getElementById('solve-result').classList.remove('hidden');
    document.getElementById('solve-details').innerHTML = html;
    renderColorlibPanel();               // 【v154】换关后面板里的"当前图色库/用量"要跟着换
  }

  function getGenConfig() {
    return {
      // 目标图消除入口模式（三态单选，整批统一）：
      //   '1' = 仅底部入口（上/左/右封闭）
      //   '2' = 四方向瞬时连锁消除（v99 新增第三种玩法，与仅底部入口互斥）
      //   其余/缺控件 = 四边入口（默认，v95 行为）
      // 生成器侧会据此贯通盒切分、候选筛选、卡点、全知求解、玩家模拟、审核与难度。
      bottomOnly: ((document.getElementById('gen-bottom-only') || {}).value === '1'),
      instantChain: ((document.getElementById('gen-bottom-only') || {}).value === '2'),
      // ===== 【v137】切盒方式（用户 2026-10-14 批准）=====
      // 'anchor' = 锚点切盒（双锚点分成 A/B 两片，A 片整车先出、B 片后出；用来把暂存压力顶起来）
      // 其余/缺控件 = 'trend'（现有几何趋势切）——不选它，生产口径与本次改动前逐字节一致。
      boxCutMode: ((document.getElementById('gen-box-cut') || {}).value === 'anchor') ? 'anchor' : 'trend',
      // ===== v99 瞬时连锁专用参数（其他两种模式忽略；缺控件时退回原行为）=====
      // 管道数下限：0 = 不约束（原行为）
      minPipes: parseInt((document.getElementById('gen-min-pipes') || {}).value) || 0,
      // ===== 管道队列深度参数化 + 管道不足兜底（ANT-GEN-PIPE-DEPTH-FALLBACK-20260825，用户 2026-08-25）=====
      // 缺控件或非法值时全部回落到参数化前的写死值（深度 6 / 单管最少 4 / 兜底 2 条深度 3），
      // 保证「不改 UI = 与本参数引入前同口径」，只有兜底本身是用户明确要求的行为变更。
      pipeMaxDepth: (function () {
        var v = parseInt((document.getElementById('gen-pipe-depth') || {}).value, 10);
        return (isNaN(v) || v <= 0) ? 6 : v;
      })(),
      pipeMinFill: (function () {
        var v = parseInt((document.getElementById('gen-pipe-minfill') || {}).value, 10);
        return (isNaN(v) || v <= 0) ? 4 : v;
      })(),
      pipeFallbackCount: (function () {
        var el = document.getElementById('gen-pipe-fb-count');
        if (!el) return 2;
        var v = parseInt(el.value, 10);
        return (isNaN(v) || v < 0) ? 2 : v;      // 0 = 关闭兜底（合法取值，不能被 || 吞掉）
      })(),
      pipeFallbackDepth: (function () {
        var v = parseInt((document.getElementById('gen-pipe-fb-depth') || {}).value, 10);
        return (isNaN(v) || v <= 0) ? 3 : v;
      })(),
      // 绝对下限（用户 2026-08-25：「最低 2 个管道 2 层深度，低于这个下限就直接去除管道」）
      pipeFloorCount: (function () {
        var el = document.getElementById('gen-pipe-floor-count');
        if (!el) return 2;
        var v = parseInt(el.value, 10);
        return (isNaN(v) || v < 0) ? 2 : v;      // 0 = 关闭这一级（合法取值，不能被 || 吞掉）
      })(),
      pipeFloorDepth: (function () {
        var v = parseInt((document.getElementById('gen-pipe-floor-depth') || {}).value, 10);
        return (isNaN(v) || v <= 0) ? 2 : v;
      })(),
      // 底部并行吐球路数（v110，仅 bottomOnly 分支生效）。
      // 0 = 关闭并回退旧的单色批量路径；缺控件/留空 → 传 null，由 generator 取 bufferLimit。
      // 注意必须区分「0」与「空」：0 是用户明确要关，空是没设过。故不能用 `|| null` 折叠。
      boxParallelCount: (function () {
        var raw = (document.getElementById('gen-box-parallel') || {}).value;
        if (raw == null || raw === '') return null;
        var v = parseInt(raw, 10);
        return isNaN(v) || v < 0 ? null : v;
      })(),
      // 填盘局部交错窗口（v114）。同样要区分「0」与「空」：0 是明确要关，空是没设过。
      // 缺控件/留空 → 传 null，由 generator 取默认 6。
      fillInterleaveWindow: (function () {
        var raw = (document.getElementById('gen-fill-interleave') || {}).value;
        if (raw == null || raw === '') return null;
        var v = parseInt(raw, 10);
        return isNaN(v) || v < 0 ? null : v;
      })(),
      // ===== 参数区间（v115 引入，v116 改双端滑块）=====
      // 任务 ANT-GEN-PARAM-RANGE-CHOKE-PROB-20260827。
      // 口径：双端滑块左钮 = 下限（也是不启用区间时的单值），右钮 = 上限；
      //       **两钮重合 = 不启用区间** → Min/Max 都传 null →
      //       generator 的 sampleRangedConfig 退回读单值，行为与 v114 逐值一致。
      // 每个候选各采样一组（用户裁决），以此消除「整批同参数导致结构同质化」。
      icePercentMin: readRange('gen-ice', 'gen-ice-max', true).min,
      icePercentMax: readRange('gen-ice', 'gen-ice-max', true).max,
      blackPercentMin: readRange('gen-black', 'gen-black-max', true).min,
      blackPercentMax: readRange('gen-black', 'gen-black-max', true).max,
      chainCountMin: readRange('gen-chains', 'gen-chains-max', true).min,
      chainCountMax: readRange('gen-chains', 'gen-chains-max', true).max,
      questionPercentMin: readRange('gen-surprise', 'gen-surprise-max', true).min,
      questionPercentMax: readRange('gen-surprise', 'gen-surprise-max', true).max,
      minPipesMin: readRange('gen-min-pipes', 'gen-min-pipes-max', true).min,
      minPipesMax: readRange('gen-min-pipes', 'gen-min-pipes-max', true).max,
      pipeMaxDepthMin: readRange('gen-pipe-depth', 'gen-pipe-depth-max', true).min,
      pipeMaxDepthMax: readRange('gen-pipe-depth', 'gen-pipe-depth-max', true).max,
      usableSpaceTargetMin: readRange('gen-usable-target', 'gen-usable-target-max', false).min,
      usableSpaceTargetMax: readRange('gen-usable-target', 'gen-usable-target-max', false).max,
      // ===== 【v139】数字冰数值规则（老冰下线后唯一放冰口径）=====
    // 数值 = 该盒自然进度位次（_seq）+ 总盒数 × 本值%。0=到点就化（形同虚设）；太大则关卡被锁死。
    // 实测（76 盒 / 14 格冰的真实关）：+10% 可通关且有压力，+20% 两个求解器都过不了 → 默认 10。
    numIceDelayPct: numOr('gen-numice-delay', 10, false),
    // ===== 卡点类型出现概率（v115，替代固定数量）=====
      chokeTypeRollsNormal: (function () {
        var v = parseInt((document.getElementById('gen-choke-rolls') || {}).value, 10);
        return isNaN(v) || v < 0 ? 0 : v;
      })(),
      chokeTypeRollsBoss: (function () {
        var v = parseInt((document.getElementById('gen-choke-rolls-boss') || {}).value, 10);
        return isNaN(v) || v < 0 ? 0 : v;
      })(),
      chokeTypeProb: (function () {
        var v = parseFloat((document.getElementById('gen-choke-prob') || {}).value);
        if (isNaN(v)) return 0.5;
        return v < 0 ? 0 : (v > 1 ? 1 : v);
      })(),
      // 可用棋盘空间目标与容差：0 = 关闭（原行为）
      usableSpaceTarget: (function () {
        var v = parseFloat((document.getElementById('gen-usable-target') || {}).value);
        return (isNaN(v) || v <= 0 || v >= 1) ? 0 : v;
      })(),
      usableSpaceTolPp: (function () {
        var v = parseInt((document.getElementById('gen-usable-tol') || {}).value);
        return (isNaN(v) || v <= 0) ? 5 : v;
      })(),
      // 黑块比例突破预算固定为 2 次 × 5 个百分点（用户 2026-08-04 定，用于保护小棋盘），不开放到 UI
      usableSpaceBlackTolPp: 5, usableSpaceBreachStepPp: 5, usableSpaceBreachBudget: 2,
      // 死亡边界救援：默认勾选；缺控件时按 false（原行为）
      deathEdgeRescue: !!((document.getElementById('gen-death-rescue') || {}).checked),
      deathEdgeRescueIceCut: 2, deathEdgeRescueChainCut: 1,
      // ===== 卡点体系类型化（ANT-GEN-CHOKE-TYPES-20260824，用户 2026-08-24）=====
      // 每关抽取的卡点类型数：BOSS 与普通关分别设定（要求③）；类型不重合由 pickChokeTypes 保证（要求②）。
      // 两者均缺省/为 0 时不启用类型化，走原有行为。
      chokeTypeCountNormal: (function () {
        var v = parseInt((document.getElementById('gen-choke-count') || {}).value, 10);
        return isNaN(v) || v < 0 ? 0 : v;
      })(),
      chokeTypeCountBoss: (function () {
        var v = parseInt((document.getElementById('gen-choke-count-boss') || {}).value, 10);
        return isNaN(v) || v < 0 ? 0 : v;
      })(),
      // 各类型权重：UI 用勾选框（勾中=权重1，等权抽取）。需要非等权时改这里的取值来源即可。
      chokeTypes: (function () {
        // 【v120】'narrowPath' 进池：窄路不再是默认开启的独立参数（用户 q1）
        var out = {}, list = [
          'narrowPath',
          'iceCluster', 'chainCluster', 'questionCluster', 'chainIce', 'pipeChain',
          'narrowGapIce', 'narrowGapChain', 'bigBox', 'rareColorKey', 'swap', 'inflate'
        ];
        for (var i = 0; i < list.length; i++) {
          var el = document.getElementById('gen-choke-' + list[i]);
          out[list[i]] = (el && el.checked) ? 1 : 0;
        }
        return out;
      })(),
      chokeGateNarrowByType: !!((document.getElementById('gen-choke-gate-narrow') || {}).checked),
      // ===== v120 逐类参数（用户 2026-08-27 q2）=====
      // 统一口径：读不到控件或值非法 → 用 DEFAULT_CONFIG 的默认值（这里传 undefined 让 Object.assign 不覆盖）
      iceClusterSizeMin: numOr('gen-ice-cluster-min', 4, true),
      iceClusterSizeMax: numOr('gen-ice-cluster-max', 6, true),
      questionClusterRadius: numOr('gen-question-cluster-radius', 2, true),
      chainClusterGroupsMin: numOr('gen-chain-cluster-min', 2, true),
      chainClusterGroupsMax: numOr('gen-chain-cluster-max', 3, true),
      chainIceEnds: numOr('gen-chain-ice-ends', 1, true),
      narrowGapIceCount: numOr('gen-narrow-gap-ice-count', 2, true),
      bigBoxCapMin: numOr('gen-bigbox-cap-min', 80, true),
      bigBoxCapMax: numOr('gen-bigbox-cap-max', 110, true),
      inflateBoxCount: numOr('gen-inflate-count', 1, true),
      inflateAmount: numOr('gen-inflate-amount', 30, true),
      rareColorTargets: (function () {
        var el = document.getElementById('gen-rare-targets');
        var v = el && el.value ? String(el.value) : 'narrowGap,pipeExit,chainEnd';
        return v;
      })(),
      // 卡点组合出现的进度位置（用户 q2 末句，默认 15%~80%）
      chokePosMin: numOr('gen-choke-pos-min', 0.15, false),
      chokePosMax: numOr('gen-choke-pos-max', 0.80, false),
      // 超大盒倍率（旧口径）：v120 起仅当上面的 bigBoxCap* 清空时才回退到此
      bigBoxMulMin: (function () {
        var v = parseFloat((document.getElementById('gen-bigbox-min') || {}).value);
        return isNaN(v) || v <= 0 ? 1.5 : v;
      })(),
      bigBoxMulMax: (function () {
        var v = parseFloat((document.getElementById('gen-bigbox-max') || {}).value);
        return isNaN(v) || v <= 0 ? 2.0 : v;
      })(),
      // ===== 生产前置碎色闸门（ANT-GEN-FRAGMENT-GATE-20260824，用户 2026-08-24）=====
      // UI 填百分比（更直观），内部转成 0~1 比率。空/0/非法 → 0 = 闸门关闭（原行为）。
      // 碎色率超过该上限的源图在【生成候选之前】被跳过，不消耗时间预算、不产出关卡结构。
      fragmentMaxRate: (function () {
        var el = document.getElementById('gen-frag-max');
        if (!el) return 0;
        var v = parseFloat(el.value);
        if (isNaN(v) || v <= 0 || v >= 100) return 0;
        return +(v / 100).toFixed(6);
      })(),
      // 窄路出现概率：缺控件或非法值时按 1 = 必定出现（与该参数引入前一致）
      narrowPathProb: (function () {
        var el = document.getElementById('gen-narrow-prob');
        if (!el) return 1;
        var v = parseFloat(el.value);
        return (isNaN(v) || v < 0) ? 1 : v;
      })(),
      // 【v194】一图多产：同图跑 N 关按 goodV3 择优（1=关）
      portfolioK: (function () {
        var el = document.getElementById('gen-portfolio');
        var v = parseInt(el && el.value, 10);
        return (isNaN(v) || v < 1) ? 1 : Math.min(10, v);
      })(),
      boxSizeMin: parseInt(document.getElementById('gen-boxmin').value) || 40,
      boxSizeMax: parseInt(document.getElementById('gen-boxmax').value) || 56,
      boxSizeMode: (document.getElementById('gen-boxmode') || {}).value || 'random',
      bufferLimit: parseInt(document.getElementById('gen-buffer').value) || 5,
      shuffleIntensity: 0,   // 已弃用洗牌
      // 换球区域：仅供【卡点B支】chokeSwap 划分早/后期用；基础阶段不换球(v86起)
      swapRegionMin: parseInt((document.getElementById('gen-swap-min') || {}).value) || 0,
      swapRegionMax: (function () { var v = (document.getElementById('gen-swap-max') || {}).value; return (v === '' || v == null) ? 100 : parseInt(v); })(),
      icePercent: parseInt(document.getElementById('gen-ice').value) || 0,
      blackPercent: parseInt(document.getElementById('gen-black').value) || 0,
      chainCount: parseInt(document.getElementById('gen-chains').value) || 0,
      questionPercent: parseInt((document.getElementById('gen-surprise') || {}).value) || 0,
      // 【v145】棋盘自适应：默认 true —— 行列范围由车数反推，手填范围降级为"偏好"（装不下会自动兜底）。
      // 【v151】按「选择余地」曲线挑关卡（实验，默认关）
      curveScore: !!((document.getElementById('gen-curve-score') || {}).checked),
      boardAuto: ((document.getElementById('gen-board-mode') || {}).value !== 'manual'),
      boardRowsMin: parseInt((document.getElementById('gen-rows-min') || {}).value) || 9,
      boardRowsMax: parseInt((document.getElementById('gen-rows-max') || {}).value) || 9,
      boardColsMin: parseInt((document.getElementById('gen-cols-min') || {}).value) || 9,
      boardColsMax: parseInt((document.getElementById('gen-cols-max') || {}).value) || 19,
      narrowPath: !!(document.getElementById('gen-narrow') || {}).checked,
      narrowPathGapsMin: parseInt((document.getElementById('gen-narrow-gap-min') || {}).value) || 1,
      narrowPathGapsMax: parseInt((document.getElementById('gen-narrow-gap-max') || {}).value) || 2,
      packFull: !!(document.getElementById('gen-narrow') || {}).checked,
      // 候选数：每源图初生成几个候选(各过合法性门)，不合格则进入卡点树(见 produce())
      candidateCount: parseInt((document.getElementById('gen-candidates') || {}).value) || 1,
      // 单关生产时间预算(分→毫秒；0=不限时)；批量生产按简单关比例逐关决定是否要求真实卡点(requireHardPass)
      timeBudgetMs: (function () { var v = parseInt((document.getElementById('gen-timebudget') || {}).value); return (isNaN(v) ? 5 : v) * 60000; })(),
      easyRatioPercent: (function () { var v = parseInt((document.getElementById('gen-easy-ratio') || {}).value); return isNaN(v) ? 30 : Math.max(0, Math.min(100, v)); })(),
      // 多轮难度标定轮次(任务 ANT-DIFF-MULTIROUND-PROD-20260901)：最终选中关卡按 N 轮玩家路线取最稳标定难度。
      //   缺控件时不写(=undefined)，由 generator DEFAULT_CONFIG 填默认 7；填 1 = 回到旧单轮。
      difficultyRounds: (function () { var v = parseInt((document.getElementById('gen-difficulty-rounds') || {}).value, 10); return isNaN(v) ? undefined : Math.max(1, Math.min(25, v)); })(),
      // 【v341·实验】通道模式：第 0 行只留一个入口，第 1 行从入口右侧封 k 格
      channelMode: !!(document.getElementById('gen-channel') || {}).checked,
      channelEntryCol: parseInt((document.getElementById('gen-channel-col') || {}).value, 10) || 0,
      channelK: parseInt((document.getElementById('gen-channel-k') || {}).value, 10) || 0
      // 难度参数已删除：难度由生产合格后的求解器反推(Analysis.difficulty)计算；diffLevel 用内部默认(2)
    };
  }

  function loadLevel(json) {
    // 【v132】换关/导入时若正处在手动摆盒编辑态，先退出编辑态（否则编辑板会留在屏幕上、
    //   且它的「原样快照」还是上一关的，容易把上一关的车场摆到这一关）。
    if (editMode) exitEditMode();
    stopAutoPlay();
    currentImportedSolve = null;   // 默认无导入求解数据（生成/TXT关卡→需要时重新求解）
    currentGenerationEval = null;
    currentChokeInfo = null;      // v120：换关先清空卡点信息，避免把上一关的卡点显示到这一关上
    // 入口模式回默认：导入的关卡本体不含该字段，无从得知；生成路径会在 loadLevel 之后按本次配置重设。
    currentEntryMode = 'fourSide';
    currentLevel = AntSolver.parseLevel(json);
    document.getElementById('btn-simulate').disabled = false;
    document.getElementById('btn-export').disabled = false;
    document.getElementById('solve-result').classList.add('hidden');
    exitSimulation();
    renderLevelInfo();
    renderTarget(null);
    renderQueues(null);
  }

  // ==================== 渲染 ====================
  function renderLevelInfo() {
    if (!currentLevel) return;
    var html = '';
    html += '<p>尺寸: ' + currentLevel.rows + '×' + currentLevel.cols + '</p>';
    html += '<p>像素: ' + currentLevel.totalPixels + '</p>';
    if (currentLevel.board) {
      html += '<p>棋盘: ' + currentLevel.board.rows + '×' + currentLevel.board.cols + '</p>';
    }
    html += '<p>蚂蚁盒: ' + (currentLevel.totalBoxes || 0) + '个</p>';
    html += '<p>暂存: ' + currentLevel.bufferLimit + '格</p>';
    // 【v120】卡点类型信息与位置（用户：「输出报告和模拟游玩的关卡信息要显示卡点类型的信息和位置等」）。
    //   数据来自生成期的 chokeMarks / chokePlan / chokeStat，只有【本次在页面上生成】的关卡才有；
    //   导入的关卡本体不含这些（卡点信息只进生产侧记录，不入关卡 JSON），此时如实不显示，
    //   而不是显示成「无卡点」——那会让人误判导入的关卡没有卡点。
    if (currentChokeInfo && (currentChokeInfo.marks || currentChokeInfo.plan)) {
      var ci = currentChokeInfo;
      html += '<hr style="border-color:#4a3a2c;margin:8px 0">';
      html += '<p style="color:#d2701f;font-weight:600">卡点类型' +
        (ci.plan ? '（抽中 ' + ci.plan.count + '/' + ci.plan.pool + '，期望 ' + ci.plan.expected + '）' : '') + '</p>';
      if (ci.plan && ci.plan.cn && ci.plan.cn.length) {
        html += '<p style="font-size:11px;color:#66513a">' + ci.plan.cn.join('、') + '</p>';
      }
      if (ci.dropped && ci.dropped.length) {
        // 被聚集类风险回退摘掉的类型必须显示：否则「勾了却没出现」会被当成 bug 找半天
        html += '<p style="font-size:11px;color:#a33">结构失败被摘掉：' + ci.dropped.join('、') + '</p>';
      }
      var marks = ci.marks || [];
      if (marks.length) {
        var grp = {};
        marks.forEach(function (m) { (grp[m.cn || m.type] = grp[m.cn || m.type] || []).push(m); });
        Object.keys(grp).forEach(function (k) {
          var list = grp[k];
          var pos = list.map(function (m) { return '(' + m.r + ',' + m.c + ')'; }).join(' ');
          var det = list[0].detail ? Object.keys(list[0].detail).map(function (dk) {
            return dk + '=' + list[0].detail[dk];
          }).join(' ') : '';
          html += '<p style="font-size:11px;color:#66513a;margin:2px 0">' +
            '<b>' + k + '</b>×' + list.length + (det ? ' <span style="color:#8a7358">[' + det + ']</span>' : '') +
            '<br><span style="color:#8a7358">位置 ' + pos + '</span></p>';
        });
      } else {
        html += '<p style="font-size:11px;color:#8a7358">本关未落地任何卡点手段</p>';
      }
      if (ci.pos) {
        html += '<p style="font-size:11px;color:#8a7358">卡点进度带 ' +
          Math.round(ci.pos.min * 100) + '%~' + Math.round(ci.pos.max * 100) + '%' +
          '（带内候选格 ' + ci.pos.bandCells + '/' + ci.pos.allCells + '）</p>';
      }
    }
    html += '<hr style="border-color:#4a3a2c;margin:8px 0">';
    for (var id in currentLevel.colorCounts) {
      var c = AntSolver.getColorCSS(parseInt(id));
      html += '<span style="display:inline-block;width:10px;height:10px;background:' + c + ';border-radius:2px;margin-right:4px;vertical-align:middle"></span>';
      html += '<span style="font-size:11px;color:#999">' + AntSolver.getColorName(parseInt(id)) + ': ' + currentLevel.colorCounts[id] + '</span><br>';
    }
    document.getElementById('status-content').innerHTML = html;
  }

  function renderTarget(eliminated) {
    if (!currentLevel) return;
    lastTargetElim = eliminated;   // 记录当前消除态，缩放时重绘
    var canvas = document.getElementById('target-canvas');
    var rows = currentLevel.rows, cols = currentLevel.cols;
    // 基准尺寸跟随【视口框体实际大小】，而不是写死的常量。
    // 原来固定 maxW=500/maxH=340，与框体脱钩：框变大了图还是老样子，
    // 放大只能靠 targetZoom 把内容撑出框外再拖拽看局部（正是用户指出的问题）。
    // 现在框体由 applyTargetViewportSize() 随倍率放大，这里按框体算基准格子 →
    // 框变大图跟着变大、且尽量填满框，通常不需要再拖拽。
    var vpEl = document.getElementById('target-viewport');
    var maxW = (vpEl && vpEl.clientWidth ? vpEl.clientWidth : 640) - 20;
    var maxH = (vpEl && vpEl.clientHeight ? vpEl.clientHeight : 460) - 20;
    if (maxW < 120) maxW = 120;
    if (maxH < 120) maxH = 120;
    // 上限 22 是原有口径（避免小图把格子撑得过大）；框体放大后按比例放宽该上限
    var capCell = Math.max(22, Math.round(22 * targetZoom));
    var baseCell = Math.min(Math.floor(maxW / cols), Math.floor(maxH / rows), capCell);
    if (baseCell < 4) baseCell = 4;
    var cellSize = Math.max(3, baseCell);
    var gap = cellSize > 6 ? 1 : 0;
    var step = cellSize + gap;

    canvas.width = cols * step;
    canvas.height = rows * step;
    canvas.style.width = canvas.width + 'px';
    canvas.style.height = canvas.height + 'px';
    targetLayout = { width: canvas.width, step: step, cols: cols }; // 供暂存槽对齐起点列

    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#e9dcc6'; // 浅暖底
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 目标图为纯颜色（障碍已全部移到棋盘）
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var colorId = currentLevel.blocks[r][c];
        if (colorId <= 0) continue;
        var key = r + ',' + c;
        var isElim = eliminated && eliminated[r][c];
        // 【顺序闪白】即将被这台小车选走的小人先保持本色（哪怕逻辑上已结算），
        // 已被扫到的高亮成白色并标出它是第几个被选的 —— 见 playPickAnim/pumpFlash。
        if (flashPendingCells && flashPendingCells[key]) isElim = false;
        var mark = flashMarkCells ? flashMarkCells[key] : 0;
        var x = c * step, y = r * step;
        if (mark) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(x, y, cellSize, cellSize);
          if (cellSize >= 11) {
            ctx.fillStyle = '#d2701f';
            ctx.font = 'bold ' + Math.max(7, Math.round(cellSize * 0.52)) + 'px sans-serif';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(String(mark), x + cellSize / 2, y + cellSize / 2);
          }
        } else if (isElim) {
          ctx.fillStyle = '#d5c8b0'; // 已消除像素(浅灰米=空洞)
          ctx.fillRect(x, y, cellSize, cellSize);
        } else {
          ctx.fillStyle = AntSolver.getColorCSS(colorId);
          ctx.fillRect(x, y, cellSize, cellSize);
        }
      }
    }

    // (演示进度竖线由压力折线图的游标 cursorProgress 呈现，目标图不再叠加虚线)

    clampTargetPan(); // 缩放/重绘后校正平移

    var info = document.getElementById('target-info');
    if (eliminated) {
      var elim = 0;
      for (var er = 0; er < rows; er++) for (var ec = 0; ec < cols; ec++) if (eliminated[er][ec] && currentLevel.blocks[er][ec] > 0) elim++;
      info.textContent = elim + '/' + currentLevel.totalPixels + ' (' + Math.round(elim/currentLevel.totalPixels*100) + '%)';
    } else {
      info.textContent = currentLevel.rows + '×' + currentLevel.cols + ' | ' + currentLevel.totalPixels + 'px';
    }
  }

  // ==================== 消除顺序可视化（独立视图） ====================
  // 计算目标图【全颜色消除顺序】(由外向内、按颜色可达依赖逐轮推进)，进入独立全屏视图，
  // 放大目标区，为每个彩色像素在【左下角】标注其全局消除序号。用于识别强依赖、指导铺盒。
  function openElimOrderView() {
    if (!currentLevel) { alert('请先导入/生成关卡'); return; }
    // 基础铺盒改为按目标图底→顶趋势；建盒后再逐盒回放生成左侧实际像素序号。
    elimTrendData = null;
    elimOrderData = null;
    buildElimLevel();
    var view = document.getElementById('elim-order-view');
    if (view) view.classList.remove('hidden');
    renderElimOrder();
    renderElimBoard();
  }
  function closeElimOrderView() {
    if (elimSim.active) stopElimSim();
    var view = document.getElementById('elim-order-view');
    if (view) view.classList.add('hidden');
  }
  // 模拟中的目标图溶解渲染：已消格保留真实序；下一槽位预览明确区分可消序与当前封锁像素。
  function renderElimTargetDissolve() {
    var state = AntSolver.Simulator.getState(); if (!state) return;
    var rows = currentLevel.rows, cols = currentLevel.cols, blocks = currentLevel.blocks;
    // visualElim 是逐像素动画进度；state.eliminated 是已即时结算的真实逻辑状态。
    var elim = elimSim.visualElim || state.eliminated;
    var staticRank = elimOrderData ? elimOrderData.colorRank : null;
    var previewRank = elimSim.previewRank, previewLocked = elimSim.previewLocked;
    var plannedRank = previewRank || staticRank, actualRank = elimSim.actualRank;
    var cell = elimCellSize;
    var canvas = document.getElementById('elim-order-canvas'); if (!canvas) return;
    canvas.width = cols * cell; canvas.height = rows * cell;
    canvas.style.width = canvas.width + 'px'; canvas.style.height = canvas.height + 'px';
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#e6dcc8'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    var fontPx = Math.max(6, Math.round(cell * 0.34));
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var color = blocks[r][c]; if (color <= 0) continue;
        var x = c * cell, y = r * cell;
        var visuallyGone = elim[r][c], logicallyGone = state.eliminated[r][c];
        ctx.fillStyle = visuallyGone ? '#d5c8b0' : AntSolver.getColorCSS(color);
        ctx.fillRect(x + 0.5, y + 0.5, cell - 1, cell - 1);
        // 逻辑已消而尚在动画队列中的格不再参与动态预览，避免误画成“封锁”。
        var actual = actualRank && actualRank[r][c];
        var dynamic = !logicallyGone && !actual && previewRank && previewRank[r][c];
        var lockedNow = !logicallyGone && previewLocked && previewLocked[r][c];
        var shownRank = actual || (!logicallyGone && plannedRank ? plannedRank[r][c] : 0);
        if (shownRank && cell >= 12) {
          ctx.font = 'bold ' + fontPx + 'px monospace';
          ctx.textBaseline = 'bottom'; ctx.textAlign = 'left';
          var tx = x + 2, ty = y + cell - 2;
          ctx.lineWidth = Math.max(2, fontPx / 3.5);
          ctx.strokeStyle = visuallyGone ? 'rgba(0,0,0,.35)' : 'rgba(0,0,0,.88)';
          ctx.strokeText(shownRank, tx, ty);
          ctx.fillStyle = actual ? (visuallyGone ? 'rgba(110,95,74,.9)' : '#fff') : (dynamic ? '#ffe36b' : '#fff');
          ctx.fillText(shownRank, tx, ty);
        }
        // 当前封锁只描范围外边缘：不覆盖原色/编号，连续封锁格之间也不画内部网格线。
        if (lockedNow) {
          function neighborLocked(rr, cc) {
            return rr >= 0 && rr < rows && cc >= 0 && cc < cols &&
              !state.eliminated[rr][cc] && previewLocked && previewLocked[rr][cc];
          }
          var edgeWidth = Math.max(2, Math.round(cell * 0.10));
          var inset = edgeWidth / 2;
          var x0 = x + inset, x1 = x + cell - inset, y0 = y + inset, y1 = y + cell - inset;
          ctx.strokeStyle = '#e0592c'; ctx.lineWidth = edgeWidth;
          ctx.lineCap = 'square'; ctx.beginPath();
          if (!neighborLocked(r - 1, c)) { ctx.moveTo(x0, y0); ctx.lineTo(x1, y0); }
          if (!neighborLocked(r + 1, c)) { ctx.moveTo(x0, y1); ctx.lineTo(x1, y1); }
          if (!neighborLocked(r, c - 1)) { ctx.moveTo(x0, y0); ctx.lineTo(x0, y1); }
          if (!neighborLocked(r, c + 1)) { ctx.moveTo(x1, y0); ctx.lineTo(x1, y1); }
          ctx.stroke();
        }
      }
    }
    // 暂存滞留时，以黄色圆环标出下一盒实际会进入的 S 槽映射位置。
    if (elimSim.previewStart && elimSim.previewSlot != null) {
      var sx = elimSim.previewStart.c * cell, sy = elimSim.previewStart.r * cell;
      ctx.save();
      ctx.strokeStyle = '#f0ad00'; ctx.lineWidth = Math.max(2, Math.round(cell * 0.12));
      ctx.beginPath(); ctx.arc(sx + cell / 2, sy + cell / 2, Math.max(4, cell * 0.35), 0, Math.PI * 2); ctx.stroke();
      if (cell >= 18) {
        ctx.font = 'bold ' + Math.max(7, Math.round(cell * 0.24)) + 'px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(0,0,0,.8)';
        ctx.strokeText('S' + (elimSim.previewSlot + 1), sx + cell / 2, sy + cell / 2);
        ctx.fillStyle = '#ffe36b'; ctx.fillText('S' + (elimSim.previewSlot + 1), sx + cell / 2, sy + cell / 2);
      }
      ctx.restore();
    }
    var info = document.getElementById('elim-order-info');
    var tot = currentLevel.totalPixels || 0, visualDone = 0;
    for (var vr = 0; vr < rows; vr++) for (var vc = 0; vc < cols; vc++) if (blocks[vr][vc] > 0 && elim[vr][vc]) visualDone++;
    if (info) {
      var preview = elimSim.previewStats;
      var previewText = elimSim.previewStart && elimSim.previewSlot != null
        ? ' · 暂存滞留：下盒 S' + (elimSim.previewSlot + 1) + ' (' + elimSim.previewStart.r + ',' + elimSim.previewStart.c + ') · 黄色序号=当前可消顺序 · 红色边缘=当前不可达范围（不覆盖原图，并非漏号）' +
          (preview ? ' · 可消 ' + preview.reachable + ' · 当前封锁 ' + preview.locked + ' (' + Math.round(preview.lockRatio * 100) + '%)' : '')
        : ' · 未消保留基础趋势规划序';
      info.textContent = '模拟中 · 逐像素动画 ' + visualDone + '/' + tot + ' (' + (tot ? Math.round(visualDone / tot * 100) : 0) + '%) · 已消显示实际槽位起点序' + previewText;
    }
  }

  // 基础铺盒：按【目标图底→顶趋势】把像素流压缩为单色容量盒(容量≤elimBoxCap)，从首行左→右铺入。
  // 盒按接到第一个趋势像素的位置排序，避免旧版按“可达最多颜色”把数百个同色盒塞进最前。
  // 铺好后会按该盒序列逐盒回放，得到供可视化/模拟使用的【真实像素级】消除编号。
  // 当前阶段不放任何障碍/管道，只用能容纳全部盒的基础棋盘(列≥行、行≤9，不足则加列)。
  // 末尾盒不满容量则与前一个同色盒合并平分：按【连续同色段】处理(相邻消除轮次颜色必不同→连续同色=同段)
  function mergeElimTailBoxes(boxes, cap) {
    var out = [];
    var i = 0;
    while (i < boxes.length) {
      var j = i;
      while (j < boxes.length && boxes[j].color === boxes[i].color) j++;   // 连续同色段 [i,j)
      var run = [];
      for (var k = i; k < j; k++) run.push(boxes[k].count);
      if (run.length >= 2 && run[run.length - 1] < cap) {                  // 尾盒不满容量 → 与前一盒合并平分
        var merged = run[run.length - 1] + run[run.length - 2];
        var h1 = Math.ceil(merged / 2), h2 = merged - h1;
        run[run.length - 2] = h1; run[run.length - 1] = h2;
      }
      for (var m = 0; m < run.length; m++) out.push({ color: boxes[i].color, count: run[m] });
      i = j;
    }
    return out;
  }
  function fitElimDims(N) {
    // 优先用较多行(≤9，贴合真实关卡)，取满足 列≥行 的最大行数 → 行9列=ceil(N/9)(N≥81)；小图行数自适应下降
    for (var rr = 9; rr >= 1; rr--) {
      var cc = Math.ceil(N / rr);
      if (cc >= rr) return { rows: rr, cols: cc };   // 列≥行
    }
    return { rows: 1, cols: Math.max(1, N) };
  }
  function buildElimLevel() {
    if (!currentLevel) { elimBuiltLevel = null; return; }
    var cap = elimBoxCap > 0 ? elimBoxCap : 35;
    // 像素趋势流（底→顶，行内左→右）→ 按颜色分别累计到容量 → 盒按首像素趋势位置排序。
    elimTrendData = AntSolver.buildTrendBoxes(currentLevel.blocks, currentLevel.rows, currentLevel.cols, cap);
    var boxes = elimTrendData.boxes;
    var N = boxes.length;
    var dims = fitElimDims(N);
    var brows = dims.rows, bcols = dims.cols;
    var cells = [];
    for (var r = 0; r < brows; r++) { var row = []; for (var c = 0; c < bcols; c++) row.push(null); cells.push(row); }
    var bi = 0;
    for (var r2 = 0; r2 < brows && bi < N; r2++) {
      for (var c2 = 0; c2 < bcols && bi < N; c2++) {
        var b = boxes[bi];
        cells[r2][c2] = { t: 'box', color: b.color, count: b.count, chain: 0, q: false, numice: 0, _seq: bi };
        bi++;
      }
    }
    var bufferLimit = currentLevel.bufferLimit || 5;
    var level = { blocks: currentLevel.blocks, bufferLimit: bufferLimit, board: { rows: brows, cols: bcols, cells: cells } };
    // 趋势只确定【初始铺入位置】；进入真实槽位起点规则后，同一行可取盒可能需要全知重排，
    // 否则 0001 机械左→右会在中段塞满暂存。先求出真实取盒序，再按该序重放目标图。
    var solveResult = AntSolver.Solver.solve(AntSolver.parseLevel(level));
    var boxSequence = [];
    // v112：pickOrder 改为「一条 = 一个盒」后，本门槛（长度 == 总盒数）对含锁链的关卡重新成立。
    // 改前锁链组只记 1 条，长度恒小于总盒数 → 该分支永不进入、静默退回下方机械左→右序。
    // 实测 v110 底部 49 关批次 46/46 关都中招，消除序号视图用的都不是真实求解路线。
    // 这里逐盒展开正好对应每个 sourceBox，锁链成员各自成条，不需要额外去重。
    if (solveResult.completed && solveResult.pickOrder && solveResult.pickOrder.length === N) {
      for (var pi = 0; pi < solveResult.pickOrder.length; pi++) {
        var pick = solveResult.pickOrder[pi];
        var sourceBox = pick.r * bcols + pick.c + 1;
        if (boxes[sourceBox - 1]) boxSequence.push({ box: boxes[sourceBox - 1], sourceBox: sourceBox });
      }
    }
    if (boxSequence.length !== N) {
      boxSequence = [];
      for (var qi = 0; qi < boxes.length; qi++) boxSequence.push({ box: boxes[qi], sourceBox: qi + 1 });
    }
    elimBuiltLevel = { level: level, boxes: boxes, rows: brows, cols: bcols, solveResult: solveResult };
    // 与就地「全知版」同一份 pickOrder + 同一暂存槽状态机回放。趋势盒仍按首行左→右摆放，
    // 但序号展示真实取盒、自动释放和 S1/S2… 起点产生的逐像素结果。
    elimOrderData = AntSolver.replayEliminationOrder(
      currentLevel.blocks, currentLevel.rows, currentLevel.cols, boxes,
      { bufferLimit: bufferLimit, useSlotStart: true, boxSequence: boxSequence }
    );
  }
  function renderElimBoard() {
    if (!elimBuiltLevel) return;
    var view = document.getElementById('elim-order-view');
    if (view && view.classList.contains('hidden')) return;
    var canvas = document.getElementById('elim-board-canvas');
    if (!canvas) return;
    var brows = elimBuiltLevel.rows, bcols = elimBuiltLevel.cols;
    var cells = elimBuiltLevel.level.board.cells;
    var cell = 34, gap = 2, step = cell + gap;
    canvas.width = bcols * step; canvas.height = brows * step;
    canvas.style.width = canvas.width + 'px'; canvas.style.height = canvas.height + 'px';
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ece1cd'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (var r = 0; r < brows; r++) {
      for (var c = 0; c < bcols; c++) {
        var b = cells[r][c]; if (!b) continue;
        var x = c * step, y = r * step;
        ctx.fillStyle = AntSolver.getColorCSS(b.color);
        ctx.fillRect(x, y, cell, cell);
        // 盒容量(中央)
        ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(0,0,0,.85)'; ctx.strokeText(b.count, x + cell / 2, y + cell / 2 + 2);
        ctx.fillStyle = '#fff'; ctx.fillText(b.count, x + cell / 2, y + cell / 2 + 2);
        // 铺入序号(左上角)
        ctx.font = '9px monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.strokeText('#' + (b._seq + 1), x + 2, y + 2);
        ctx.fillStyle = 'rgba(255,255,255,.92)'; ctx.fillText('#' + (b._seq + 1), x + 2, y + 2);
      }
    }
    var info = document.getElementById('elim-board-info');
    if (info) info.textContent = '棋盘 ' + brows + '×' + bcols + ' · 盒数 ' + elimBuiltLevel.boxes.length + ' · 盒容量≤' + (elimBoxCap || 35) + ' · 基础(无障碍) · 按目标图底→顶趋势首行左→右铺入';
  }
  function readElimCap() {
    var el = document.getElementById('elim-boxcap');
    var v = el ? parseInt(el.value, 10) : 35;
    if (isNaN(v) || v < 2) v = 35; if (v > 200) v = 200;
    elimBoxCap = v;
  }
  // ===== 视图内【就地模拟】模块（独立于主界面，复用 Simulator 引擎）=====
  // 手点：点右侧棋盘上白框高亮的盒即取；⏩全知版：求解后逐步回放。左侧目标图随消除同步溶解。
  var ELIM_BOARD_CELL = 34, ELIM_BOARD_STEP = 36; // 与 renderElimSimBoard 一致
  function initElimSimVisual(state) {
    elimSim.visualElim = [];
    for (var r = 0; r < state.rows; r++) elimSim.visualElim.push(state.eliminated[r].slice());
    elimSim.actualRank = AntSolver.create2D(state.rows, state.cols, 0);
    elimSim.nextRank = 0;
    elimSim.lastStart = null;
    elimSim.previewRank = null; elimSim.previewLocked = null; elimSim.previewStats = null;
    elimSim.previewSlot = null; elimSim.previewStart = null; elimSim.previewRefreshes = 0;
  }
  /**
   * 暂存有滞留盒时，下一盒不会再从 S1 入场。以当前最左空槽的新起点重算各色像素：
   * 黄色编号=当前可消，红色边缘=当前不可达范围。已消格仍只使用 actualRank，刷新不会改写历史。
   */
  function refreshElimSimPreview(state) {
    if (!state || !state.buffer || !state.buffer.length || state.gameOver) {
      elimSim.previewRank = null; elimSim.previewLocked = null; elimSim.previewStats = null;
      elimSim.previewSlot = null; elimSim.previewStart = null;
      return false;
    }
    var preview = AntSolver.Simulator.previewNextEliminationOrder(state);
    elimSim.previewRank = preview.rank;
    elimSim.previewLocked = preview.locked;
    elimSim.previewStats = preview.stats;
    elimSim.previewSlot = preview.slot;
    elimSim.previewStart = preview.start;
    elimSim.previewRefreshes++;
    return true;
  }
  function clearElimSimTimer() {
    elimSim.token++;
    if (elimSim.timer) { clearTimeout(elimSim.timer); elimSim.timer = null; }
  }
  function startElimSim() {
    if (!elimBuiltLevel) { alert('尚未生成棋盘'); return; }
    var lv = AntSolver.parseLevel(elimBuiltLevel.level);
    // 真实口径：每个盒落入最左空暂存槽，槽位映射为蚂蚁起点；只有滞留盒占槽才会让后续起点右移。
    AntSolver.Simulator.enter(lv, { useSlotStart: true });
    elimSim.active = true;
    initElimSimVisual(AntSolver.Simulator.getState());
    var ctrl = document.getElementById('elim-sim-controls'); if (ctrl) ctrl.classList.remove('hidden');
    var startBtn = document.getElementById('elim-sim'); if (startBtn) startBtn.classList.add('hidden');
    elimSimRender();
  }
  function stopElimSim() {
    clearElimSimTimer();
    AntSolver.Simulator.exit();
    elimSim.active = false; elimSim.visualElim = null; elimSim.actualRank = null; elimSim.nextRank = 0;
    elimSim.previewRank = null; elimSim.previewLocked = null; elimSim.previewStats = null;
    elimSim.previewSlot = null; elimSim.previewStart = null; elimSim.previewRefreshes = 0;
    var ctrl = document.getElementById('elim-sim-controls'); if (ctrl) ctrl.classList.add('hidden');
    var startBtn = document.getElementById('elim-sim'); if (startBtn) startBtn.classList.remove('hidden');
    renderElimOrder(); renderElimBoard();  // 恢复：左=消除序号，右=铺盒预览
  }
  function elimSimReset() {
    clearElimSimTimer();
    AntSolver.Simulator.reset(); // reset 会保留 startElimSim 传入的 {useSlotStart:true}
    initElimSimVisual(AntSolver.Simulator.getState());
    elimSimRender();
  }
  // 将某次取盒的 capOps.eat.cells 按原始 trace 顺序逐格播放；真实状态已结算，视觉矩阵延迟跟进。
  function animateElimPick(ops, done) {
    var cells = [];
    for (var i = 0; i < ops.length; i++) {
      if (ops[i].t !== 'eat' || !ops[i].cells) continue;
      for (var j = 0; j < ops[i].cells.length; j++) cells.push(ops[i].cells[j]);
    }
    var token = elimSim.token, idx = 0;
    // 【加速】elimSimSpeed<=0 → 本批像素一次性全部消失（视觉上与真机"一批一起没"一致）；
    //   否则每 tick 推进 per 格，per 随速度自动放大（0→整批，15ms→4格/次，60ms→1格/次逐格）。
    function perTick() { return elimSimSpeed <= 0 ? cells.length : Math.max(1, Math.round(60 / elimSimSpeed)); }
    function tick() {
      if (!elimSim.active || token !== elimSim.token) return;
      var per = perTick();
      for (var n = 0; n < per && idx < cells.length; n++) {
        var p = cells[idx++], r = p[0], c = p[1];
        if (elimSim.visualElim && !elimSim.visualElim[r][c]) {
          elimSim.visualElim[r][c] = true;
          if (elimSim.actualRank) elimSim.actualRank[r][c] = ++elimSim.nextRank;
        }
      }
      elimSimRender();
      if (idx >= cells.length) { elimSim.timer = null; elimSimRender(); if (done) done(); return; }
      elimSim.timer = setTimeout(tick, Math.max(16, elimSimSpeed)); // 每 tick 读取速度参数，可实时调速
    }
    tick();
  }
  function elimSimPick(r, c, done) {
    if (!elimSim.active) return false;
    var state = AntSolver.Simulator.getState();
    if (!state || state.gameOver || !AntSolver.Simulator.isPickable(state, r, c)) return false;
    if (!AntSolver.Simulator.pickBox(r, c)) return false;
    var ops = AntSolver.Simulator.getCapOps();
    for (var oi = 0; oi < ops.length; oi++) if (ops[oi].t === 'add') { elimSim.lastStart = { slot: ops[oi].slot, start: ops[oi].start }; break; }
    // 进盒后若仍有滞留，下一盒会进入新的最左空槽：立即重算未消目标图的候选序。
    // 动画中的已消格仍由 actualRank 覆盖，因此历史真实序不会被这份预览改写。
    refreshElimSimPreview(AntSolver.Simulator.getState());
    animateElimPick(ops, done);
    return true;
  }
  function elimSimOmni() {
    if (!elimSim.active) return;
    if (elimSim.timer) { clearElimSimTimer(); elimSimRender(); return; } // 再点=停止当前逐像素回放
    elimSimReset();
    var lv = AntSolver.parseLevel(elimBuiltLevel.level);
    // 构建序号时已确定这份无障碍趋势棋盘的全知取盒序；复用它保证左侧编号与演示逐像素 trace 一致。
    var res = elimBuiltLevel.solveResult || AntSolver.Solver.solve(lv);
    if (!res.pickOrder || !res.pickOrder.length) { elimSimRender(); return; }
    var idx = 0;
    function nextBox() {
      if (!elimSim.active) return;
      if (idx >= res.pickOrder.length) { elimSim.timer = null; elimSimRender(); return; }
      var p = res.pickOrder[idx++];
      if (!elimSimPick(p.r, p.c, nextBox)) { elimSim.timer = null; elimSimRender(); }
    }
    nextBox();
  }
  function elimBoardClick(e) {
    if (!elimSim.active) return;
    var state = AntSolver.Simulator.getState();
    if (!state || state.gameOver) return;
    if (elimSim.timer) return; // 回放中不响应手点
    var canvas = document.getElementById('elim-board-canvas');
    var rect = canvas.getBoundingClientRect();
    var c = Math.floor((e.clientX - rect.left) / ELIM_BOARD_STEP);
    var r = Math.floor((e.clientY - rect.top) / ELIM_BOARD_STEP);
    if (r < 0 || c < 0 || r >= state.boardRows || c >= state.boardCols) return;
    if (!AntSolver.isBox(state.cells[r][c])) return;
    elimSimPick(r, c); // 真实状态立即结算，目标图按 capOps 的逐像素 trace 慢放跟进
  }
  function elimSimRender() {
    var state = AntSolver.Simulator.getState();
    if (!state) return;
    renderElimOrder();          // 左：目标图溶解(active 分支)
    renderElimSimBoard(state);  // 右：交互棋盘
    // 暂存 + 统计
    var buf = document.getElementById('elim-sim-buffer');
    if (buf) {
      var html = '暂存 ' + state.buffer.length + '/' + state.bufferLimit + '：';
      for (var i = 0; i < state.buffer.length; i++) {
        var b = state.buffer[i];
        var slotLabel = b.slot != null ? 'S' + (b.slot + 1) + ' ' : '';
        html += '<span title="暂存槽 ' + (b.slot != null ? (b.slot + 1) : '-') + '，起点(' + (b.start ? (b.start.r + ',' + b.start.c) : '-') + ')" style="display:inline-block;margin:0 2px;padding:1px 5px;border-radius:3px;color:#fff;font-size:10px;background:' + AntSolver.getColorCSS(b.color) + '">' + slotLabel + b.progress + '/' + b.need + '</span>';
      }
      buf.innerHTML = html;
    }
    var st = document.getElementById('elim-sim-stats');
    if (st) {
      var tot = (currentLevel && currentLevel.totalPixels) || 0;
      var msg = '';
      if (state.gameOver) msg = state.gameWon ? ' · <b style="color:#8bc34a">通关 ✓</b>' : ' · <b style="color:#e0592c">失败(暂存溢出)</b>';
      var visualDone = 0;
      if (elimSim.visualElim && currentLevel) for (var vr = 0; vr < currentLevel.rows; vr++) for (var vc = 0; vc < currentLevel.cols; vc++) if (currentLevel.blocks[vr][vc] > 0 && elimSim.visualElim[vr][vc]) visualDone++;
      var startMsg = '';
      if (elimSim.lastStart) {
        var ss = elimSim.lastStart.slot, sp = elimSim.lastStart.start;
        startMsg = ' · 本盒起点 S' + (ss != null ? (ss + 1) : '-') + (sp ? ' (' + sp.r + ',' + sp.c + ')' : '');
      }
      var nextMsg = '';
      if (elimSim.previewStart && elimSim.previewSlot != null) {
        var np = elimSim.previewStart;
        nextMsg = ' · <b style="color:#a66b00">下盒刷新 S' + (elimSim.previewSlot + 1) + ' (' + np.r + ',' + np.c + ')</b>';
      }
      var previewMsg = '';
      if (elimSim.previewStats) {
        var ps = elimSim.previewStats;
        previewMsg = ' · <b style="color:#a66b00">可消 ' + ps.reachable + '</b> / <b style="color:#c94b27">当前封锁 ' + ps.locked + ' (' + Math.round(ps.lockRatio * 100) + '%)</b>';
      }
      st.innerHTML = '步数 ' + state.steps + ' · 逻辑消除 ' + state.eliminatedPixels + '/' + tot + ' · 动画 ' + visualDone + '/' + tot + startMsg + nextMsg + previewMsg + msg;
    }
  }
  function renderElimSimBoard(state) {
    var canvas = document.getElementById('elim-board-canvas'); if (!canvas) return;
    var brows = state.boardRows, bcols = state.boardCols, cells = state.cells;
    var cell = ELIM_BOARD_CELL, step = ELIM_BOARD_STEP;
    canvas.width = bcols * step; canvas.height = brows * step;
    canvas.style.width = canvas.width + 'px'; canvas.style.height = canvas.height + 'px';
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ece1cd'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (var r = 0; r < brows; r++) {
      for (var c = 0; c < bcols; c++) {
        var b = cells[r][c]; if (!b || !AntSolver.isBox(b)) continue;
        var x = c * step, y = r * step;
        var pickable = AntSolver.Simulator.isPickable(state, r, c);
        ctx.fillStyle = AntSolver.getColorCSS(b.color);
        ctx.fillRect(x, y, cell, cell);
        if (!pickable) { ctx.fillStyle = 'rgba(0,0,0,.42)'; ctx.fillRect(x, y, cell, cell); }
        else { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, cell - 2, cell - 2); }
        // 盒容量(中央)
        ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(0,0,0,.85)'; ctx.strokeText(b.count, x + cell / 2, y + cell / 2 + 2);
        ctx.fillStyle = '#fff'; ctx.fillText(b.count, x + cell / 2, y + cell / 2 + 2);
        // 消除顺序序号(左上角小标)：铺盒为行优先，(r,c) 的铺入序 = r*cols+c+1
        ctx.font = '9px monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(0,0,0,.8)';
        var ordN = r * bcols + c + 1;
        ctx.strokeText('#' + ordN, x + 2, y + 2);
        ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.fillText('#' + ordN, x + 2, y + 2);
      }
    }
  }
  function renderElimOrder() {
    if (!currentLevel || !elimOrderData) return;
    var view = document.getElementById('elim-order-view');
    if (view && view.classList.contains('hidden')) return;
    if (elimSim.active) { renderElimTargetDissolve(); return; }  // 模拟中：左侧改显目标图溶解
    var rows = currentLevel.rows, cols = currentLevel.cols, blocks = currentLevel.blocks;
    var rankGrid = elimOrderData.colorRank;   // 同色内消除排名(1..k)，主编号
    var segGrid = elimOrderData.colorSeg;      // 同色内分段(区域)号
    var showSeg = (document.getElementById('elim-show-seg') || {}).checked === true;
    var cell = elimCellSize;
    var showColor = (document.getElementById('elim-show-color') || {}).checked !== false;
    var canvas = document.getElementById('elim-order-canvas');
    if (!canvas) return;
    canvas.width = cols * cell; canvas.height = rows * cell;
    canvas.style.width = canvas.width + 'px'; canvas.style.height = canvas.height + 'px';
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#e6dcc8'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    var fontPx = Math.max(6, Math.round(cell * 0.34));
    ctx.textBaseline = 'bottom'; ctx.textAlign = 'left';
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var color = blocks[r][c];
        var x = c * cell, y = r * cell;
        if (color > 0) {
          ctx.fillStyle = showColor ? AntSolver.getColorCSS(color) : '#d3c6ad';
          ctx.fillRect(x + 0.5, y + 0.5, cell - 1, cell - 1);
          // 左下角小标：【同色内】消除排名(每色各自 1..k)；可选右上角小标显示分段(区域)号
          var s = rankGrid[r][c];
          if (cell >= 12) {
            ctx.font = 'bold ' + fontPx + 'px monospace';
            ctx.textBaseline = 'bottom'; ctx.textAlign = 'left';
            var tx = x + 2, ty = y + cell - 2;
            ctx.lineWidth = Math.max(2, fontPx / 3.5); ctx.strokeStyle = 'rgba(0,0,0,.88)'; ctx.strokeText(s, tx, ty);
            ctx.fillStyle = '#fff'; ctx.fillText(s, tx, ty);
            if (showSeg && cell >= 18) {
              var segFont = Math.max(6, Math.round(cell * 0.26));
              ctx.font = 'bold ' + segFont + 'px monospace';
              ctx.textBaseline = 'top'; ctx.textAlign = 'right';
              var sg = 'S' + segGrid[r][c];
              ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(0,0,0,.85)'; ctx.strokeText(sg, x + cell - 2, y + 2);
              ctx.fillStyle = '#ffd24d'; ctx.fillText(sg, x + cell - 2, y + 2);
            }
          }
        } else {
          ctx.fillStyle = '#ddd1bc';
          ctx.fillRect(x + 0.5, y + 0.5, cell - 1, cell - 1);
        }
      }
    }
    var info = document.getElementById('elim-order-info');
    if (info) {
      var colorN = Object.keys(elimOrderData.colorGroups).length;
      var multiSeg = 0;
      for (var cid in elimOrderData.colorSegments) if (elimOrderData.colorSegments[cid] > 1) multiSeg++;
      info.textContent = rows + '×' + cols + ' · ' + colorN + ' 种颜色（每色各自 1..k 独立编号）· 其中 ' + multiSeg + ' 色被闭合分成多段(区域) · 共 ' + elimOrderData.rounds + ' 段';
    }
    var zv = document.getElementById('elim-zoom-val'); if (zv) zv.textContent = cell + 'px';
  }

  /**
   * 渲染棋盘（元素区网格）：盒子/管道/黑块/空格 + 障碍图标；模拟中高亮可取盒。
   */
  // reviveHighlight: 可选 { until, cells:[{r,c}...] }——只在玩家版演示传入，标记"复活刚移除的棋盘残留盒"位置
  //   (该格此时已被置空，用一个短暂的高亮外框叠在空格上，让用户看清是复活生效的位置，而非普通取盒)。
  function renderQueues(state, override, reviveHighlight) {
    var container = document.getElementById('board-queues');
    if (!currentLevel || !currentLevel.board) { container.innerHTML = ''; return; }

    // 当前布局：override(玩家演示棋盘) > 模拟 state.cells > 关卡静态 board
    var cells = override ? override.cells : (state ? state.cells : currentLevel.board.cells);
    var brows = override ? override.rows : (state ? state.boardRows : currentLevel.board.rows);
    var bcols = override ? override.cols : (state ? state.boardCols : currentLevel.board.cols);
    var rcState = override ? null : state;   // override 模式不高亮可取

    // 可取集合（模拟中计算顶部可达）
    var reach = null;
    if (rcState) reach = AntSolver.Simulator.computeReach(rcState);

    // 锁链组 → 顺序编号(A,B,C…)映射：让不同锁链组有清晰标识
    buildChainTagMap(cells, brows, bcols);

    // 棋盘外框与目标区/暂存区外框等宽（对齐边缘框，而非内部像素图）
    var frameEl = document.getElementById('target-container');
    var frameW = frameEl ? frameEl.clientWidth : 0;
    if (!frameW || frameW < 100) frameW = 480;
    var gap = 6, pad = 8;
    var csz = Math.floor((frameW - pad * 2 - gap * (bcols - 1)) / bcols);
    // 电梯棋盘可能很高(行数多) → 同时按高度约束，保证整体可见
    var maxH = 540;
    var cszH = Math.floor((maxH - pad * 2 - gap * (brows - 1)) / Math.max(1, brows));
    if (cszH < csz) csz = cszH;
    if (csz < 14) csz = 14;
    if (csz > 80) csz = 80;

    var reviveActive = reviveHighlight && reviveHighlight.until > Date.now();
    var reviveCellKey = {};
    if (reviveActive) for (var rc = 0; rc < reviveHighlight.cells.length; rc++) { var rcc = reviveHighlight.cells[rc]; reviveCellKey[rcc.r + ',' + rcc.c] = true; }

    var html = '<div class="ant-board" style="width:' + frameW + 'px;justify-content:center;grid-template-columns:repeat(' + bcols + ',var(--csz));--csz:' + csz + 'px;--cgap:' + gap + 'px">';
    for (var r = 0; r < brows; r++) {
      for (var c = 0; c < bcols; c++) {
        var cell = cells[r][c];
        var cellHtml = renderCell(rcState, cell, r, c, reach);
        // 复活刚移除的棋盘残留盒此时已是空格；只给这个空格叠一次性高亮外框，标记"是复活生效的位置"。
        if (reviveActive && reviveCellKey[r + ',' + c]) cellHtml = cellHtml.replace('class="board-cell', 'title="复活腾出的棋盘残留盒" class="board-cell reviving');
        // 求解路线序号角标（纯可视化叠加，不改任何模拟状态；未开启时原样返回）
        cellHtml = applyRouteMark(cellHtml, r, c, rcState);
        html += cellHtml;
      }
    }
    html += '</div>';
    container.innerHTML = html;

    // 【v123】棋盘点击改**事件委托**：在容器上绑一次，不再逐格绑。
    // 原实现每次 renderQueues 都对每个 .pickable 重新 addEventListener，而 v122 的时间驱动
    // 会以 40ms 频率重建 innerHTML → **子节点在 mousedown 与 mouseup 之间被替换掉，click 事件根本不会触发**
    // （click 只在 mousedown/mouseup 的共同祖先上派发；节点被换掉后共同祖先退到容器）。
    // 这就是「动画播放过程中点不动其他盒」的直接原因。委托到容器后，即使子节点被换，
    // click 仍会冒泡到容器 → 处理器照样收到。
    boardClickEnabled = !!(simulating && !override);
    if (!container._antDelegated) {
      container._antDelegated = true;
      container.addEventListener('click', onBoardDelegatedClick);
    }
  }

  // 盒色亮度 → 自适应文字色（深色盒用白字，浅色盒用黑字）
  function hexToRgb(s) {
    if (!s) return null; s = s.trim();
    var m = /^#?([0-9a-f]{6})$/i.exec(s); if (m) { var n = parseInt(m[1], 16); return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }; }
    var m3 = /^#?([0-9a-f]{3})$/i.exec(s); if (m3) { var h = m3[1]; return { r: parseInt(h[0] + h[0], 16), g: parseInt(h[1] + h[1], 16), b: parseInt(h[2] + h[2], 16) }; }
    return null;
  }
  function textColorFor(colorId) {
    var rgb = hexToRgb(AntSolver.getColorCSS(colorId));
    if (!rgb) return '#fff';
    var lum = 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b;
    return lum < 140 ? '#fff' : '#000'; // 暗色盒 → 白字
  }

  // 锁链组标识：组号 → 顺序字母(A,B,…) + 配色（同组同色，不同组不同色）
  var _chainTagMap = {};
  var CHAIN_COLORS = ['#ff3b30', '#34c759', '#ffcc00', '#5ac8fa', '#af52de', '#ff9500', '#00e5ff', '#ff2d95', '#a3e635', '#f472b6'];
  function buildChainTagMap(cells, rows, cols) {
    _chainTagMap = {};
    var groups = [];
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      var cell = cells[r][c];
      if (cell && cell.t === 'box' && cell.chain > 0 && groups.indexOf(cell.chain) < 0) groups.push(cell.chain);
    }
    groups.sort(function (a, b) { return a - b; });
    for (var i = 0; i < groups.length; i++) _chainTagMap[groups[i]] = i;
  }
  function chainTag(group) {
    var idx = _chainTagMap[group];
    if (idx == null) idx = (group - 1);
    return String.fromCharCode(65 + (idx % 26)); // A,B,C…
  }
  function chainColor(group) {
    var idx = _chainTagMap[group];
    if (idx == null) idx = (group - 1);
    return CHAIN_COLORS[((idx % CHAIN_COLORS.length) + CHAIN_COLORS.length) % CHAIN_COLORS.length];
  }

  function renderCell(state, cell, r, c, reach) {
    if (cell == null) return '<div class="board-cell empty"></div>';
    if (cell.t === 'black') return '<div class="board-cell black" title="黑块(阻挡)"><span class="blk-x">✕</span></div>';
    if (cell.t === 'pipe') {
      var arrow = { 11:'▲', 12:'▶', 13:'▼', 14:'◀' }[cell.dir] || '▼';
      var remain = (cell.queue ? cell.queue.length : 0) - (cell.next || 0);
      return '<div class="board-cell pipe" title="管道 剩余' + remain + '">' + arrow + '<span class="pipe-n">' + remain + '</span></div>';
    }
    // box
    var pickable = state && AntSolver.Simulator.isPickable(state, r, c);
    // 【v121】暂存放不下 → 标 .noslot 并去掉 .pickable。
    // 原实现只看 isPickable（不判暂存容量），于是暂存满时这些盒**看起来照样能点**，
    // 点下去会走到「先放进第 6 个盒变 6/5、再判死」那条路。现在点击会被拒绝，
    // 所以必须在 UI 上先告诉用户「这个点不了」，否则点了没反应会以为卡住。
    var noSlot = false;
    if (pickable && liveMode && AntSolver.Simulator.pickCapacityOf) {
      var capChk = AntSolver.Simulator.pickCapacityOf(state, r, c);
      if (!capChk.ok && (capChk.reason === 'noSlot' || capChk.reason === 'noSlotChain')) {
        noSlot = true; pickable = false;
      }
    }
    var cls = 'board-cell box' + (pickable ? ' pickable' : '') + (noSlot ? ' noslot' : '');
    // 问号：激活后揭示原有颜色（模拟中用 state.activated；非模拟态显示未揭示）
    var revealed = cell.q ? (state ? AntSolver.Simulator.isRevealed(state, r, c) : false) : true;
    var style, label, title;
    if (cell.q && !revealed) {
      style = 'background:#6b5a4a;color:#fff';
      label = '?';
      title = '问号(未激活·隐藏色) ×' + cell.count;
    } else {
      style = 'background:' + AntSolver.getColorCSS(cell.color) + ';color:' + textColorFor(cell.color);
      label = cell.count;
      title = (cell.q ? '问号(已揭示) ' : '') + AntSolver.getColorName(cell.color) + ' ×' + cell.count;
    }
    var overlay = '';
    // 【v138】数字冰：右上角显示"还剩几个球"。模拟态读 state.numice（每取走一球递减，锁链一步扣 2）；
    //   非模拟态显示作者预设值。破碎后从 state.numice 消失 → 不再显示，也不再灰显。
    var numIceRemain = null;
    if (cell.numice > 0 || (state && state.numice && state.numice[r + ',' + c])) {
      numIceRemain = (state && state.numice && state.numice[r + ',' + c])
        ? state.numice[r + ',' + c].remaining
        : cell.numice;
    }
    if (numIceRemain != null) {
      overlay += '<span class="ov numice" title="数字冰：还剩 ' + numIceRemain + ' 个球（每取走一个球减 1，锁链一步 2 个就减 2）">🧊' + numIceRemain + '</span>';
      title += '｜数字冰还剩 ' + numIceRemain + ' 球';
    }
    // 锁链：同组同色边框标识"锁在一起的块"，不同组不同色（生成阶段已保证不同组不相邻）。
    if (cell.chain > 0) {
      var ccol = chainColor(cell.chain);
      style += ';outline:3px solid ' + ccol + ';outline-offset:-3px';
      var gtag = chainTag(cell.chain);
      overlay += '<span class="ov chain" style="color:' + ccol + '" title="锁链组 ' + gtag + '（同组全解锁才可连体入暂存）">🔗' + gtag + '</span>';
      title += '｜锁链组' + gtag;
    }
    // 数字冰未破碎 → 灰显（锁着就看着"取不了"）。老冰已下线，这是唯一的锁定灰显来源。
    if (state && state.numice && state.numice[r + ',' + c] && state.numice[r + ',' + c].remaining > 0) cls += ' locked';
    // 【v141】锁链组里"陪锁"的那一辆：它自己没冰，但同组有人被数字冰锁着 → 整组点不了，
    //   同样灰显。不显示的话它看着完全正常、点下去没反应（与上面 .noslot 要解决的问题同类）。
    if (state && !pickable && !noSlot && cell.chain > 0 &&
        AntSolver.Simulator.isChainLocked && AntSolver.Simulator.isChainLocked(state, r, c)) cls += ' locked';
    return '<div class="' + cls + '" style="' + style + '" data-r="' + r + '" data-c="' + c + '" title="' + title + '">' +
           '<span class="cnt">' + label + '</span>' + overlay + '</div>';
  }

  // ==================== v121 · 手点模拟：时间驱动的并发结算 ====================
  // 任务 ANT-SIM-LIVE-CONCURRENT-20260828。真机规则（用户 2026-08-28 给出）：
  //   每个盒都要出蚂蚁，约 1 秒出 5~8 只（= 消 5~8 像素）；在这个出蚂蚁的周期内玩家会继续放盒。
  // 改前的手点模拟有两个问题：
  //   ① **动画太快**：animPxPerTick=2 / animFrameMs=45 → 44.4 像素/秒每盒，是真机的 5.5~8.9 倍；
  //   ② **没有并行**：逻辑层 applyPick 一次点击就结算到底（实测 69.7% 的盒当步就消完、
  //      根本不进暂存），动画层又靠 animQueue 排队补播 → 连点时只能等前一个播完。
  // 现在手点走「逻辑本身按时间推进 + 动画直接渲染逻辑态」，取消原来的双轨（逻辑瞬时 + 动画补播）。
  // **只有手点路径如此**：回放与三个演示按钮仍走原 pickBox/applyPick 串行路径（见 liveMode 的置位点）。
  var liveMode = false;           // true = 手点时间驱动；false = 回放/演示的原串行路径
  var liveTimer = null, liveLastTs = 0;
  var LIVE_FRAME_MS = 40;         // 渲染帧间隔；真正的推进量由**真实时间戳差**决定，不依赖这个数
  var liveHintUntil = 0;          // 「放不下」提示的显示截止时间

  /** 读「出蚂蚁速率」控件：缺控件/非法 → 6.5（真机 5~8 的中值） */
  function antRatePerSec() {
    var v = parseFloat((document.getElementById('sim-ant-rate') || {}).value);
    if (isNaN(v) || v <= 0) return 6.5;
    return Math.max(0.5, Math.min(60, v));
  }
  function startLive() {
    if (liveTimer) return;
    liveLastTs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    liveTimer = setInterval(liveTick, LIVE_FRAME_MS);
  }
  function stopLive() {
    if (liveTimer) { clearInterval(liveTimer); liveTimer = null; }
  }
  function liveTick() {
    var st = AntSolver.Simulator.getState();
    if (!st || !liveMode) { stopLive(); return; }
    var now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    var dt = now - liveLastTs;
    liveLastTs = now;
    if (st.gameOver) { stopLive(); renderLive(st); showGameMsg(st.gameWon); return; }
    // 暂存空且棋盘无人可点也不用继续跑（省电）；但要先让 checkWinLose 判过死锁
    var res = AntSolver.Simulator.settleStep(dt, antRatePerSec());
    renderLive(st);
    if (res.over) { stopLive(); showGameMsg(st.gameWon); return; }
    if (!st.buffer.length && liveHintUntil < now) stopLive();   // 没有正在出蚂蚁的盒 → 停表，下次点击再启动
  }
  // 【v123】棋盘 DOM 只在**真的变了**的时候重建。
  // v122 第一版每帧（40ms）都调 renderQueues → `container.innerHTML = html` 把整块棋盘拆了重建 25 次/秒。
  // 后果有两层：① 点击被吃（见 onBoardDelegatedClick 的说明）；② 无意义的重排开销。
  // 棋盘的可见内容只由这几件事改变：取盒（steps）、盒离场（completedBoxes / buffer 占用影响
  // .pickable 与 .noslot）、管道吐球与数字冰倒计时（都发生在取盒那一步，已被 steps 覆盖）。
  // 故用这三个量做签名；目标图与暂存槽仍每帧刷新（它们是 canvas / 少量节点，不吃点击）。
  var lastBoardSig = null;
  function boardSigOf(st) {
    return st.steps + '|' + st.buffer.length + '|' + st.completedBoxes + '|' + (st.gameOver ? 1 : 0);
  }
  /** 直接按逻辑态渲染（不再有 visualElim/visualBuffer 补播） */
  function renderLive(st, forceBoard) {
    renderTarget(st.eliminated);
    var sig = boardSigOf(st);
    if (forceBoard || sig !== lastBoardSig) { lastBoardSig = sig; renderQueues(st); }
    renderBuffer(st);
    renderStats(st);
    var cur = simChartCursor('both');
    if (cur) redrawCharts(cur);
  }

  // 棋盘点击的唯一入口（事件委托，见 renderQueues 尾部说明）。
  // 从事件目标往上找最近的 .board-cell，再按当前**逻辑态**重新判定该格能不能取
  // —— 不依赖 DOM 上的 class，因为高频重绘时 class 可能已经是上一帧的。
  var boardClickEnabled = false;
  function onBoardDelegatedClick(e) {
    if (!boardClickEnabled || !simulating) return;
    var el = e.target;
    while (el && el !== e.currentTarget && !(el.classList && el.classList.contains('board-cell'))) el = el.parentNode;
    if (!el || el === e.currentTarget) return;
    var r = parseInt(el.dataset ? el.dataset.r : NaN, 10);
    var c = parseInt(el.dataset ? el.dataset.c : NaN, 10);
    if (isNaN(r) || isNaN(c)) return;
    var st = AntSolver.Simulator.getState();
    if (!st || st.gameOver) return;
    if (liveMode && AntSolver.Simulator.pickCapacityOf) {
      var cap = AntSolver.Simulator.pickCapacityOf(st, r, c);
      if (!cap.ok) {
        // 只有「放不下」值得提示；锁着/空格/管道等一律静默忽略（点它们本来就没意义）
        if (cap.reason === 'noSlot' || cap.reason === 'noSlotChain') showNoSlotHint(cap);
        return;
      }
    } else if (!AntSolver.Simulator.isPickable(st, r, c)) {
      // 【v160】点不动的格子：可能"其实已经死了"（满格 + 剩下全是消不掉的）→ 查一次并结算
      if (settleDeadEnd()) refreshSimUI();
      return;
    }
    handleBoxClick(r, c);
  }

  function handleBoxClick(r, c) {
    if (!simulating) return;
    if (isNaN(r) || isNaN(c)) return;
    if (liveMode) {
      // 时间驱动：只入场占槽，不做消除；放不下则被 pickBoxLive 拒绝（棋盘一格不动）
      var res = AntSolver.Simulator.pickBoxLive(r, c);
      if (!res.ok) { showNoSlotHint(res); return; }
      var st2 = AntSolver.Simulator.getState();
      renderLive(st2, true);          // 取盒必然改变棋盘 → 强制重绘一次
      startLive();
      return;
    }
    var ok = AntSolver.Simulator.pickBox(r, c);
    // 【2026-10-13】手点改走「顺序闪白」：车先进轨道 → 即将被选走的小人按消除顺序依次闪白 →
    //   全部闪完一起消失（与「单步(全知)」同一条视觉路径）。闪白关闭(速度=0)时退回原整批动画。
    if (ok) { renderQueues(AntSolver.Simulator.getState()); playPickAnim(); }
  }
  function showNoSlotHint(res) {
    var st = AntSolver.Simulator.getState();
    var el = document.getElementById('solve-details');
    if (!el) return;
    document.getElementById('solve-result').classList.remove('hidden');
    var need = res && res.need ? res.need : 1;
    var free = res && res.free != null ? res.free : (st ? (st.bufferLimit - st.buffer.length) : 0);
    var why = (res && res.reason === 'noSlotChain')
      ? ('锁链整组需要 ' + need + ' 个连续空位，当前只剩 ' + free + ' 个')
      : ('暂存已满（' + (st ? st.buffer.length : '?') + '/' + (st ? st.bufferLimit : '?') + '），没有空位');
    el.innerHTML = '<p style="color:#e0592c">✋ 放不下，这一步取不了</p>' +
      '<p style="font-size:11px;color:#8a7358">' + why + '。' +
      '真机同样点不动 —— 每个盒都要占一个暂存位直到蚂蚁把它搬完。</p>' +
      '<p style="font-size:11px;color:#8a7358">等某个盒消完腾出位置再点，或它们都消不动时本关判死锁失败。</p>';
    liveHintUntil = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) + 1200;
  }

  // ==================== 事件驱动消除动画 ====================
  // 每次取盒 → 盒作为暂存条目进场(0/N)，其吃掉的像素逐帧消除、计数递增，满 N 后离场。
  function initVisual(state) {
    visualElim = [];
    for (var r = 0; r < state.rows; r++) visualElim.push(state.eliminated[r].slice());
    visualBuffer = state.buffer.map(function(b) {
      return { key: b.key, color: b.color, need: b.need, revealed: b.progress, link: b.link || 0 };
    });
    animQueue = []; animActiveEats = []; animPendingDones = [];
  }
  // 即时同步（撤销/重置/进入）：先取消正在进行的闪白与排队，直接把视觉对齐逻辑态
  function syncVisual(state) { stopFlash(); initVisual(state); }

  function visualCount(state) {
    var n = 0;
    for (var r = 0; r < state.rows; r++)
      for (var c = 0; c < state.cols; c++)
        if (visualElim[r][c] && state.blocks[r][c] > 0) n++;
    return n;
  }

  function findVB(key) { for (var i = 0; i < visualBuffer.length; i++) if (visualBuffer[i].key === key) return visualBuffer[i]; return null; }

  // 把最近一次取盒的事件序列加入动画队列
  function enqueuePickOps() {
    var ops = AntSolver.Simulator.getCapOps();
    for (var i = 0; i < ops.length; i++) animQueue.push(ops[i]);
  }

  // 结算本批并发消除后完成离场的球（锁链整组共享一个 done，整组一起移除）
  function flushPendingDones() {
    if (!animPendingDones.length) return;
    var set = {};
    for (var i = 0; i < animPendingDones.length; i++)
      for (var d = 0; d < animPendingDones[i].keys.length; d++) set[animPendingDones[i].keys[d]] = 1;
    visualBuffer = visualBuffer.filter(function (e) { return !set[e.key]; });
    animPendingDones = [];
  }

  function startAnim() { if (!animTimer) animTimer = setInterval(animTick, animFrameMs); }
  function stopAnim() { if (animTimer) { clearInterval(animTimer); animTimer = null; } }

  // ==================== 顺序闪白：小车进轨道后，即将被选中小人的选取顺序预览 ====================
  // 用户 2026-10-13 需求：小车进入暂存区(轨道)后，那些**即将被选走的小人按消除顺序一个一个闪白**，
  //   闪完再一起消失（保持真机「整批一起下楼」的观感）。闪白速度可调（速度滑块），0 = 关闭。
  // 顺序来源 = 求解器这一笔取盒实际吃掉的像素序列（Simulator.getCapOps 里的 eat.cells，
  //   即「圈 → 由下到上 → 由左到右」那套口径），**不另算一份**，所以闪白顺序永远等于真实消除顺序。
  var flashMs = 40;              // 每个小人亮起的间隔(ms)；<=0 表示关闭闪白
  var flashTimer = null;         // 闪白计时器
  var flashSeq = null;           // 本轮闪白的像素序列 [[r,c], ...]（按消除顺序）
  var flashPendingCells = null;  // 本轮将要被选走的格子 {key:true}（闪白期间保持本色）
  var flashMarkCells = null;     // 已扫过的格子 {key:第几个}（渲染成白色+序号）
  var pfQueue = [];              // 待闪白+结算的取盒批次（连点时排队，不丢动画）
  var pfBusy = false;            // 是否正在闪白

  function flashSequenceOf(ops) {
    var seq = [];
    for (var i = 0; i < ops.length; i++) {
      if (ops[i].t === 'eat' && ops[i].cells) {
        for (var j = 0; j < ops[i].cells.length; j++) seq.push(ops[i].cells[j]);
      }
    }
    return seq;
  }
  // 把本批所有盒先落到暂存槽（车已进轨道，显示 0/need），消除等闪完再结算
  function applyAddOps(ops) {
    for (var i = 0; i < ops.length; i++) {
      var op = ops[i];
      if (op.t !== 'add') continue;
      if (findVB(op.key)) continue;
      visualBuffer.push({ key: op.key, color: op.color, need: op.need, revealed: 0, link: op.link || 0 });
    }
  }
  // 结算本批：吃掉的像素置为已消、暂存计数递增、完成的盒离场（与 animTickCore 同一口径）
  function commitOps(ops) {
    for (var i = 0; i < ops.length; i++) {
      var op = ops[i];
      if (op.t === 'eat' && op.cells) {
        var vb = findVB(op.key);
        for (var j = 0; j < op.cells.length; j++) {
          visualElim[op.cells[j][0]][op.cells[j][1]] = true;
          if (vb) vb.revealed++;
        }
      } else if (op.t === 'done' && op.keys) {
        for (var k = 0; k < op.keys.length; k++) {
          for (var v = visualBuffer.length - 1; v >= 0; v--) if (visualBuffer[v].key === op.keys[k]) visualBuffer.splice(v, 1);
        }
      }
    }
  }
  // 停止闪白并清空排队（撤销/重置/换关调用；视觉随后由 syncVisual 直接对齐逻辑态）
  function stopFlash() {
    if (flashTimer) { clearInterval(flashTimer); flashTimer = null; }
    pfQueue = []; pfBusy = false;
    flashSeq = null; flashPendingCells = null; flashMarkCells = null;
  }
  function renderFlashFrame() {
    var st = AntSolver.Simulator.getState();
    if (!st || !visualElim) return;
    renderTarget(visualElim);
    renderVisualBuffer(st); renderVisualStats(st);
  }
  // 取盒后调用：开启顺序闪白（关闭时退回原来的整批事件驱动动画）
  function playPickAnim() {
    var ops = (AntSolver.Simulator.getCapOps() || []).slice();
    pfQueue.push(ops);
    pumpFlash();
  }
  function pumpFlash() {
    if (pfBusy || !pfQueue.length) return;
    var st = AntSolver.Simulator.getState();
    if (!st) { pfQueue = []; return; }
    settleDeadEnd();                       // 【v160】死局立刻结算（手点主路径：闪白泵每次进来先查一次）
    if (!visualElim) initVisual(st);
    var ops = pfQueue.shift();
    applyAddOps(ops);                     // 车先进轨道
    renderVisualBuffer(st);
    var seq = flashSequenceOf(ops);
    if (flashMs <= 0 || !seq.length) {    // 关闭闪白 / 本批没有要选的小人 → 直接整批消失
      commitOps(ops);
      renderFlashFrame();
      if (st.gameOver && !pfQueue.length) showGameMsg(st.gameWon);
      pumpFlash();
      return;
    }
    pfBusy = true;
    var pending = {}, mark = {};
    for (var i = 0; i < seq.length; i++) pending[seq[i][0] + ',' + seq[i][1]] = true;
    flashSeq = seq; flashPendingCells = pending; flashMarkCells = mark;
    renderFlashFrame();                   // 先出一帧：车已进轨道、小人还都是本色
    var idx = 0;
    flashTimer = setInterval(function () {
      var s = AntSolver.Simulator.getState();
      if (!s) { stopFlash(); return; }
      if (idx >= seq.length) {            // 全部小人闪完 → 一起消失（整批结算）
        clearInterval(flashTimer); flashTimer = null;
        flashSeq = null; flashPendingCells = null; flashMarkCells = null;
        commitOps(ops);
        renderFlashFrame();
        pfBusy = false;
        if (s.gameOver && !pfQueue.length) showGameMsg(s.gameWon);
        pumpFlash();
        return;
      }
      var cell = seq[idx++];
      mark[cell[0] + ',' + cell[1]] = idx;   // 第 idx 个被选走
      renderFlashFrame();
    }, Math.max(16, flashMs));
  }

  // 【v121·任务AK③】把模拟器当前进度换算成压力图游标。
  // 横轴口径必须与两幅图一致：图上每个样本的 x = sample.done / totalBoxes（done = 完成盒数），
  // 所以这里也用 completedBoxes/totalBoxes，而不是像素进度 —— 用像素进度会与曲线错位。
  // side: 'omni' | 'player' | 'both'（手点游玩时两幅图都标，因为手点不对应任何一条既定路线）。
  function simChartCursor(side) {
    var st = AntSolver.Simulator.getState();
    if (!st) return null;
    var tot = (currentLevel && currentLevel.totalBoxes) || st.totalBoxes || 0;
    if (!tot) return null;
    return { side: side || 'both', p: (st.completedBoxes || 0) / tot, step: st.steps || 0 };
  }

  // 【v121·任务AK③】animTick 外壳：每帧把压力图游标同步到当前回放进度。
  // 原实现只有玩家版演示（playerAnimTick）会调 redrawCharts，全知回放与贪心演示都不调 →
  // 右侧压力图在全知回放时完全静止，看不出「现在走到曲线的哪一段」。
  // 之所以做成外壳而不在 animTickCore 里逐个 return 前补一句：core 有 6 个返回点，逐个补必漏。
  function animTick() {
    animTickCore();
    var cur = simChartCursor('omni');
    if (cur) redrawCharts(cur);
  }

  function animTickCore() {
    var state = AntSolver.Simulator.getState();
    if (!state) { stopAnim(); return; }

    // 1) 【并发】播放本批 eat：每帧让所有正在消除的球各推进若干像素 → 同步消除效果
    //    （一次取盒/锁链整组进场 = 一个并发批次，多球同时吃像素而非排队轮流）
    if (animActiveEats.length) {
      var per = Math.max(1, animPxPerTick);   // 每球每帧推进像素（各球独立并发推进）
      for (var e = 0; e < animActiveEats.length; e++) {
        var ae = animActiveEats[e], did = 0;
        while (did < per && ae.idx < ae.cells.length) {
          var cell = ae.cells[ae.idx++];
          visualElim[cell[0]][cell[1]] = true;
          var vb = findVB(ae.key); if (vb) vb.revealed++;
          did++;
        }
      }
      animActiveEats = animActiveEats.filter(function (x) { return x.idx < x.cells.length; });
      if (!animActiveEats.length) {
        // 本批并发消除播完 → 统一移除完成的球（锁链整组一起离场）
        flushPendingDones();
      }
      renderTarget(visualElim); renderVisualBuffer(state); renderVisualStats(state);
      return;
    }

    // 2) 抽干队列组成【一个并发批次】：所有 add 立即入场(3个锁链盒一次性同时显示)，
    //    所有 eat 收集为并发列表(同步消除)，所有 done 暂存到批次末尾统一离场。
    if (animQueue.length) {
      var eats = [];
      while (animQueue.length) {
        var op = animQueue.shift();
        if (op.t === 'add') {
          visualBuffer.push({ key: op.key, color: op.color, need: op.need, revealed: 0, link: op.link || 0 });
        } else if (op.t === 'done') {
          animPendingDones.push(op);
        } else if (op.t === 'eat') {
          if (op.cells && op.cells.length) eats.push({ key: op.key, cells: op.cells, idx: 0 });
        }
      }
      renderVisualBuffer(state);            // 先把本批所有进场的盒(含锁链整组)一次性显示
      if (eats.length) { animActiveEats = eats; return; }
      flushPendingDones();                  // 无消除像素(极少见) → 直接结算离场
      renderVisualBuffer(state); renderVisualStats(state);
      return;
    }

    // 3) 队列空、无正在播放 → 视觉已追上逻辑
    renderVisualBuffer(state); renderVisualStats(state);
    if (state.gameOver) { showGameMsg(state.gameWon); demoMode = 'off'; setAutoBtn(false); stopAnim(); return; }
    if (demoMode === 'auto') {
      if (doAutoPick(state)) { renderQueues(state); enqueuePickOps(); }
      else { demoMode = 'off'; setAutoBtn(false); stopAnim(); }
    } else if (demoMode === 'replay') {
      if (replayList && replayIdx < replayList.length) {
        // v112：pickOrder 改为「一条 = 一个盒」后，锁链 2/3 连的成员是同一 step 的多条记录。
        // 整组在触发盒那一次 pickBox 里已经全部离场，故同 step 的后续条目必须跳过 ——
        // 否则会对已空的格子调 pickBox（返回 false），白耗动画帧且步数显示错位。
        // 旧格式数据每步只有一条，此处逐值等价、行为不变。
        var p = replayList[replayIdx++];
        while (replayIdx < replayList.length && replayList[replayIdx].step === p.step) replayIdx++;
        AntSolver.Simulator.pickBox(p.r, p.c); renderQueues(state); enqueuePickOps();
      } else { demoMode = 'off'; setAutoBtn(false); stopAnim(); }
    } else {
      stopAnim(); // 手动：无更多可动画
    }
  }

  function renderVisualStats(state) {
    var vc = visualCount(state);
    document.getElementById('stat-steps').textContent = state.steps;
    document.getElementById('stat-eliminated').textContent = vc;
    document.getElementById('stat-total').textContent = state.totalPixels;
    document.getElementById('stat-progress').textContent = Math.round(vc / state.totalPixels * 100) + '%';
  }

  /**
   * 统一暂存槽渲染：limit 个等宽槽平铺、对齐目标图宽度 →【槽 i 左缘 = 起点列 i/limit×cols】。
   * slotArr[i] = {color,revealed,need,link} 或 null。
   */
  // reviveHighlight: 可选 { until, slots:[slot...] }——只在玩家版演示传入，标记"复活刚释放的暂存槛位"
  //   (此时该槛位已置空)，短暂加一层高亮外框区分于普通完成离场。
  function renderBufferSlots(slotArr, limit, fillCount, reviveHighlight) {
    var cont = document.getElementById('buffer-slots');
    if (!cont) return;
    var w = (targetLayout && targetLayout.width) ? targetLayout.width : (limit * 46);
    var cols = targetLayout ? targetLayout.cols : limit;
    var reviveActive = reviveHighlight && reviveHighlight.until > Date.now();
    var reviveSlotSet = {};
    if (reviveActive) for (var rs = 0; rs < reviveHighlight.slots.length; rs++) reviveSlotSet[reviveHighlight.slots[rs]] = true;
    var html = '';
    for (var i = 0; i < limit; i++) {
      var startCol = Math.floor(i / limit * cols); // 该槽映射到目标图的起点列
      var b = slotArr[i];
      var revivingCls = (reviveActive && reviveSlotSet[i]) ? ' reviving' : '';
      if (b) {
        var done = b.revealed >= b.need;
        var cls = 'buffer-slot filled' + (b.link ? ' linked' : '') + (done ? ' done' : '') + revivingCls;
        html += '<div class="' + cls + '" style="width:100%;background:' + AntSolver.getColorCSS(b.color) + ';color:' + textColorFor(b.color) + '" title="起点列 ' + startCol + '">' +
                '<span class="buf-cnt">' + b.revealed + '/' + b.need + '</span>' +
                (b.link ? '<span class="buf-link">🔗</span>' : '') +
                '<span class="buf-start">▏' + startCol + '</span></div>';
      } else {
        html += '<div class="buffer-slot empty' + revivingCls + '" style="width:100%" title="' + (revivingCls ? '复活刚释放的暂存槛位·' : '') + '起点列 ' + startCol + '"><span class="buf-start">▏' + startCol + '</span></div>';
      }
    }
    cont.style.width = w + 'px';
    cont.style.margin = '0 auto';   // 暂存槽整体居中
    cont.style.display = 'grid';
    cont.style.gridTemplateColumns = 'repeat(' + limit + ',1fr)';
    cont.style.gap = '4px';
    cont.innerHTML = html;
    var cnt = document.getElementById('buffer-count');
    if (cnt) cnt.textContent = fillCount + '/' + limit;
  }

  // 视觉暂存渲染：显示 revealed/need（随消除递增），锁链标🔗，完成态高亮；槽对齐起点列
  function renderVisualBuffer(state) {
    if (!state) return;
    var limit = state.bufferLimit;
    var slotArr = [];
    for (var i = 0; i < limit; i++) slotArr.push(i < visualBuffer.length ? visualBuffer[i] : null);
    renderBufferSlots(slotArr, limit, visualBuffer.length);
  }

  function setAutoBtn(running) {
    var btn = document.getElementById('btn-omni');
    if (btn) btn.textContent = running ? '⏸ 停止' : '⏩ 全知版';
  }
  function setPlayerBtn(running) {
    var btn = document.getElementById('btn-player-demo');
    if (btn) btn.textContent = running ? '⏸ 停止' : '⏩ 玩家版';
  }

  // ==================== 暂存压力复合图（折线/柱状/都显示；全知/玩家两幅）====================
  // 横轴=进度(完成盒数/总盒数 → 0-100%，5%一个点位刻度)，纵轴=暂存压力(0..N，N=暂存上限)
  var chartMode = 'both';      // both | line | bar
  var chartCache = null;       // 缓存两幅图数据，供切换模式/演示游标重绘
  function toggleChartMode() {
    chartMode = chartMode === 'both' ? 'line' : (chartMode === 'line' ? 'bar' : 'both');
    var btn = document.getElementById('btn-chart-mode');
    if (btn) btn.textContent = '图形: ' + (chartMode === 'both' ? '都显示' : (chartMode === 'line' ? '折线' : '柱状'));
    // v121：切换图形时保留游标，否则一按这个按钮虚线就消失
    redrawCharts(simulating ? simChartCursor('both') : null);
  }

  /**
   * 【v147】逐次取盒序列 → 序列数据。
   *   上面两张压力图是按【进度】的滑动窗口均值 —— 它回答"压力出现在哪个进度段"，
   *   但看不出"是哪几次取盒把它顶上去的"。这张图补的就是这一层：一步一根柱子。
   *   柱高 = 该步结算后的暂存占用；颜色 = 这一步暂存【降没降】：
   *     绿 = 取这一盒换来了释放（暂存下降）；红 = 取了一盒却没换出释放（暂存不降反升）
   *   「空转比」= 红柱占比。它高 = 玩家一直在往暂存里塞、很少兑现 = 压力就是这么攒出来的。
   */
  function buildStepSeries(stats, limit) {
    if (!stats || !stats.length) return null;
    var bars = [], rise = 0, peak = 0;
    for (var i = 0; i < stats.length; i++) {
      var st = stats[i];
      var before = (st.bufBefore != null) ? st.bufBefore : 0;
      var after = (st.bufAfter != null) ? st.bufAfter : 0;
      var up = after > before;
      if (up) rise++;
      if (after > peak) peak = after;
      bars.push({ i: i + 1, buf: after, up: up, boxes: st.boxes || 1, isChain: !!st.isChain });
    }
    return { bars: bars, rise: rise, total: stats.length, peak: peak,
             limit: limit || 5,
             idleRatio: stats.length ? (rise / stats.length) : 0 };
  }

  function drawStepChart(canvasId, capId, data) {
    var cv = document.getElementById(canvasId);
    var cap = document.getElementById(capId);
    if (!cv) return;
    var ctx = cv.getContext('2d'); var W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#f0e8d8'; ctx.fillRect(0, 0, W, H);
    if (!data || !data.bars.length) {
      if (cap) cap.textContent = '本关没有逐次取盒记录（导入的关卡若无求解数据，跑一次求解即可）';
      return;
    }
    var N = Math.max(1, data.limit);
    var padL = 30, padB = 18, padT = 8, padR = 8;
    var pw = W - padL - padR, ph = H - padT - padB;
    function py(v) { return padT + ph - (Math.min(v, N) / N) * ph; }
    // Y 刻度 + 上限红线
    ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
    for (var y = 0; y <= N; y++) {
      var yy = py(y);
      ctx.strokeStyle = (y === N) ? 'rgba(192,69,26,.65)' : 'rgba(60,46,31,.12)';
      ctx.lineWidth = (y === N) ? 1.5 : 1;
      ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(W - padR, yy); ctx.stroke();
      ctx.fillStyle = (y === N) ? '#c0451a' : '#66513a'; ctx.font = 'bold 9px sans-serif';
      ctx.fillText(String(y), padL - 4, yy);
    }
    // 柱子
    var n = data.bars.length;
    var bw = Math.max(1, pw / n - 0.6);
    for (var i = 0; i < n; i++) {
      var b = data.bars[i];
      var x = padL + (i / n) * pw;
      var top = py(b.buf);
      ctx.fillStyle = b.up ? '#d9534f' : '#5a9e4a';        // 红=这一步没换出释放；绿=降了
      ctx.fillRect(x, top, bw, padT + ph - top);
    }
    // X 轴底线
    ctx.strokeStyle = 'rgba(60,46,31,.35)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, padT + ph); ctx.lineTo(W - padR, padT + ph); ctx.stroke();
    ctx.fillStyle = '#66513a'; ctx.font = '9px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText('第 1 次取盒', padL, padT + ph + 3);
    ctx.textAlign = 'right'; ctx.fillText('第 ' + n + ' 次', W - padR, padT + ph + 3);
    if (cap) {
      cap.textContent = n + ' 次取盒 · 其中 ' + data.rise + ' 次暂存没降（空转 ' +
        Math.round(data.idleRatio * 100) + '%）· 峰值 ' + data.peak + '/' + N +
        '　（红=取了一盒却没换出释放，绿=降了）';
    }
  }

  function drawPressureChart(canvasId, samples, limit, totalBoxes, capId, won, choke, itemUses, opts) {
    opts = opts || {};
    var cv = document.getElementById(canvasId); if (!cv) return;
    var ctx = cv.getContext('2d'); var W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#f0e8d8'; ctx.fillRect(0, 0, W, H);
    var preview = opts.preview || null;
    var hasPreview = !!(preview && preview.sampleCount);
    var padL = 30, padB = 26, padT = hasPreview ? 22 : 10, padR = 8;
    var pw = W - padL - padR, ph = H - padT - padB, N = Math.max(1, limit);
    function px(prog) { return padL + prog * pw; }
    // 可选“封锁热度”带：不改变暂存 Y 轴，仅以样本的 locked/remaining 比例标出重构难点。
    if (hasPreview) {
      var stripY = 4, stripH = 8, stripW = Math.max(1.2, pw / Math.max(1, samples.length) - 0.4);
      for (var si = 0; si < samples.length; si++) {
        var sm = samples[si];
        if (typeof sm.lockRatio !== 'number') continue;
        var sprog = totalBoxes > 0 ? (sm.done / totalBoxes) : (si / Math.max(1, samples.length));
        var alpha = Math.max(0.12, Math.min(0.9, sm.lockRatio));
        ctx.fillStyle = 'rgba(224,89,44,' + alpha + ')';
        ctx.fillRect(px(sprog) - stripW / 2, stripY, stripW, stripH);
      }
      ctx.fillStyle = '#9f3a1d'; ctx.font = 'bold 8px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText('封锁热度', padL, stripY + stripH + 1);
    }
    // 卡点窗口高亮
    if (choke && choke.qualified && choke.at != null) {
      var cbx = px(choke.at / 100), cbw = (choke.window || 0.1) * pw;
      ctx.fillStyle = 'rgba(224,89,44,.20)'; ctx.fillRect(cbx, padT, cbw, ph);
      ctx.fillStyle = '#e0592c'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText('卡点', cbx + cbw / 2, padT + 1);
    }
    // X 竖直虚线网格：进度每 5% 一条(点位标记)
    ctx.setLineDash([2, 2]); ctx.lineWidth = 1;
    for (var p = 0; p <= 100; p += 5) {
      ctx.strokeStyle = (p % 25 === 0) ? 'rgba(60,46,31,.18)' : 'rgba(60,46,31,.08)';
      var gx = px(p / 100); ctx.beginPath(); ctx.moveTo(gx, padT); ctx.lineTo(gx, padT + ph); ctx.stroke();
    }
    ctx.setLineDash([]);
    // Y 刻度线 + 标签
    ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
    for (var y = 0; y <= N; y++) {
      var yy = padT + ph - (y / N) * ph;
      ctx.strokeStyle = (y === N) ? 'rgba(192,69,26,.65)' : 'rgba(60,46,31,.12)';
      ctx.lineWidth = (y === N) ? 1.5 : 1;
      ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(W - padR, yy); ctx.stroke();
      ctx.fillStyle = (y === N) ? '#c0451a' : '#66513a'; ctx.font = 'bold 9px sans-serif';
      ctx.fillText(String(y), padL - 4, yy);
    }
    // 柱状
    if (samples && samples.length && chartMode !== 'line') {
      var barW = Math.max(1.2, pw / samples.length - 0.5);
      for (var i = 0; i < samples.length; i++) {
        var sp = samples[i];
        var prog = totalBoxes > 0 ? (sp.done / totalBoxes) : (i / samples.length);
        var x = px(prog), h = Math.min(1, sp.buf / N) * ph;
        ctx.fillStyle = sp.buf >= N ? '#e0592c' : (sp.buf >= N * 0.7 ? '#ff9f4d' : (sp.buf >= N * 0.4 ? '#ffcc4d' : '#8bc34a'));
        ctx.fillRect(x - barW / 2, padT + ph - h, barW, h);
      }
    }
    // 折线
    if (samples && samples.length && chartMode !== 'bar') {
      ctx.strokeStyle = '#8a4f22'; ctx.lineWidth = 1.5; ctx.beginPath();
      for (var j = 0; j < samples.length; j++) {
        var s2 = samples[j], pr = totalBoxes > 0 ? (s2.done / totalBoxes) : (j / samples.length);
        var xx = px(pr), y2 = padT + ph - Math.min(1, s2.buf / N) * ph;
        if (j === 0) ctx.moveTo(xx, y2); else ctx.lineTo(xx, y2);
      }
      ctx.stroke();
    }
    // 道具使用标记：青色竖直虚线
    if (opts.items && opts.items.length) {
      ctx.setLineDash([3, 2]); ctx.strokeStyle = '#00e1ef'; ctx.lineWidth = 1;
      for (var it = 0; it < opts.items.length; it++) {
        var ip = totalBoxes > 0 ? (opts.items[it].done / totalBoxes) : 0, ix = px(ip);
        ctx.beginPath(); ctx.moveTo(ix, padT); ctx.lineTo(ix, padT + ph); ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.fillStyle = '#00e1ef'; ctx.font = 'bold 8px sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'top';
      ctx.fillText('道具', W - padR - 1, padT + 1);
    }
    // 复活标记（需求 §6.2）：在复活对应的操作步画竖线 + 标注「第几次 / 复活前→复活后 / 释放数」。
    // 曲线本身的真实下降由 PlayerSim 保证——复活后立刻记了一次压力样本，故此处只做标注、不改曲线。
    if (opts.revives && opts.revives.length) {
      for (var rv = 0; rv < opts.revives.length; rv++) {
        var re = opts.revives[rv];
        var rp = totalBoxes > 0 ? (re.done / totalBoxes) : 0, rx = px(Math.max(0, Math.min(1, rp)));
        ctx.strokeStyle = '#e0592c'; ctx.lineWidth = 1.5; ctx.setLineDash([2, 2]);
        ctx.beginPath(); ctx.moveTo(rx, padT); ctx.lineTo(rx, padT + ph); ctx.stroke();
        ctx.setLineDash([]);
        // 复活前/后的暂存值各画一个点，直观看出这一步掉了多少
        var yBefore = padT + ph - (Math.min(re.bufferBefore, N) / N) * ph;
        var yAfter = padT + ph - (Math.min(re.bufferAfter, N) / N) * ph;
        ctx.fillStyle = '#e0592c';
        ctx.beginPath(); ctx.arc(rx, yBefore, 2.5, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(rx, yAfter, 2.5, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#e0592c'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(rx, yBefore); ctx.lineTo(rx, yAfter); ctx.stroke();
        ctx.fillStyle = '#e0592c'; ctx.font = 'bold 8px sans-serif';
        ctx.textAlign = rx > padL + pw * 0.8 ? 'right' : 'left'; ctx.textBaseline = 'bottom';
        ctx.fillText('复活' + re.index + ' ' + re.bufferBefore + '→' + re.bufferAfter
          + (re.releasedCount ? '(释' + re.releasedCount + ')' : ''), rx + (rx > padL + pw * 0.8 ? -2 : 2), yBefore - 2);
      }
    }
    // 演示游标：当前进度亮色竖直实线 + 步数
    if (opts.cursorProgress != null) {
      var cxp = px(Math.max(0, Math.min(1, opts.cursorProgress)));
      ctx.strokeStyle = '#d2701f'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(cxp, padT); ctx.lineTo(cxp, padT + ph); ctx.stroke();
      if (opts.cursorStep != null) { ctx.fillStyle = '#c25a12'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText('步' + opts.cursorStep, cxp, padT + 9); }
    }
    // 坐标轴 + X 刻度标签(0/25/50/75/100，小字)
    ctx.strokeStyle = 'rgba(60,46,31,.35)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, padT); ctx.lineTo(padL, padT + ph); ctx.lineTo(W - padR, padT + ph); ctx.stroke();
    ctx.fillStyle = '#66513a'; ctx.font = '8px sans-serif'; ctx.textBaseline = 'top';
    [0, 25, 50, 75, 100].forEach(function (pp) {
      ctx.textAlign = pp === 0 ? 'left' : (pp === 100 ? 'right' : 'center');
      ctx.fillText(pp === 0 ? '0' : pp + '%', px(pp / 100), padT + ph + 4);
    });
    ctx.save(); ctx.translate(8, padT + ph / 2); ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#66513a'; ctx.font = '9px sans-serif';
    ctx.fillText('暂存压力', 0, 0); ctx.restore();
    var cap = document.getElementById(capId);
    if (cap) {
      var peak = 0; (samples || []).forEach(function (s) { if (s.buf > peak) peak = s.buf; });
      var chokeTxt = choke ? (choke.qualified ? ' · 卡点@' + choke.at + '%(均' + choke.maxWindowMean + ')' : ' · 无卡点(' + choke.maxWindowMean + ')') : '';
      var itemTxt = itemUses ? ' · 道具×' + itemUses : '';
      var lockTxt = '';
      if (preview && preview.sampleCount) {
        lockTxt = ' · 封锁均' + Math.round(preview.avgLockRatio * 100) + '% 峰' + Math.round(preview.maxLockRatio * 100) + '%' + (preview.peakAt != null ? '@' + preview.peakAt + '%' : '');
      }
      var auditTxt = '';
      if (opts.audit) {
        var a = opts.audit;
        auditTxt = a.pass ? ' · 审核✓合格' : (' · 审核✗ ' + (a.reasons[0] || '不合格'));
      }
      cap.textContent = (won ? '通关' : '未通关') + ' · 峰值' + peak + '/' + N + chokeTxt + lockTxt + auditTxt + itemTxt;
      cap.style.color = won ? '#8bc34a' : '#e0592c';
    }
  }

  // 用缓存重绘两幅图（切换模式/演示游标时调用）；cursor:{side,p,step}
  // v121：side 支持 'both' —— 手点游玩不对应任何一条既定路线，两幅图都要能看到当前位置。
  function redrawCharts(cursor) {
    if (!chartCache) return;
    var c = chartCache;
    function cur(side) {
      if (!cursor || (cursor.side !== side && cursor.side !== 'both')) return { p: null, step: null };
      return { p: cursor.p, step: cursor.step };
    }
    var co = cur('omni'), cp = cur('player');
    drawPressureChart('chart-omni', c.omni.samples, c.limit, c.totalBoxes, 'chart-omni-cap', c.omni.won, c.omni.choke, c.omni.itemUses,
      { audit: c.omni.audit, items: c.omni.items, preview: c.omni.preview, cursorProgress: co.p, cursorStep: co.step });
    drawPressureChart('chart-player', c.player.samples, c.limit, c.totalBoxes, 'chart-player-cap', c.player.won, c.player.choke, c.player.itemUses,
      { audit: c.player.audit, items: c.player.items, preview: c.player.preview, revives: c.player.reviveEvents || [], cursorProgress: cp.p, cursorStep: cp.step });
    drawStepChart('chart-steps', 'chart-steps-cap', c.steps);   // 【v147】逐次取盒 × 暂存
  }

  // 由本关实际入口模式（currentEntryMode）推出 PlayerSim 的模式开关（需求 §6.1）。
  // currentEntryMode 取值来自 entryModeOf()：'fourSide' | 'bottomOnly' | 'fourSideInstantChain'。
  // 注意与 currentSimMode() 的取值命名不同（后者用 'instantChain'），此处按前者判断，不要混用。
  function playerModeOpts() {
    return {
      bottomOnly: currentEntryMode === 'bottomOnly',
      instantChain: currentEntryMode === 'fourSideInstantChain'
    };
  }

  function renderPressureCharts() {
    if (!currentLevel) return;
    var limit = currentLevel.bufferLimit || 5, totalBoxes = currentLevel.totalBoxes || 0;
    function previewMetrics(samples) {
      return AntSolver.Analysis.dynamicPreviewMetrics
        ? AntSolver.Analysis.dynamicPreviewMetrics(samples, totalBoxes)
        : { sampleCount: 0, avgLockRatio: 0, maxLockRatio: 0, peakAt: null };
    }
    chartCache = { limit: limit, totalBoxes: totalBoxes, omni: { samples: [], won: false, items: [], itemUses: 0 }, player: { samples: [], won: false, items: [], itemUses: 0, reviveEvents: [], trajectory: [] }, steps: null };
    try {
      // 旧导入审核数据仍可复用；现场新算时显式采集动态封锁快照，才显示封锁热度带。
      var oSamples, oWon, oItems = [], oItemUses = 0, reused = false, oStepStats = null;   // 【v147】逐次取盒序列
      if (currentGenerationEval && currentGenerationEval.omni && currentGenerationEval.omni.pressureSamples && currentGenerationEval.omni.pressureSamples.length) {
        oSamples = currentGenerationEval.omni.pressureSamples;
        oWon = !!currentGenerationEval.omni.won; reused = true;
        oStepStats = currentGenerationEval.omni.stepStats || null;
      } else if (currentImportedSolve && currentImportedSolve.pressureSamples && currentImportedSolve.pressureSamples.length) {
        oSamples = currentImportedSolve.pressureSamples; oWon = !!currentImportedSolve.completed; reused = true;
        oStepStats = currentImportedSolve.stepStats || null;
      } else {
        // 【v121·任务AK①】全知压力曲线也必须按本关玩法跑。
        // 原实现写死 `bottomOnly=false` 且不传 instantChain → 底部/瞬时连锁关卡的全知压力图
        // 是用四边入口规则算出来的，与该关实际玩法不符（玩家图早就按 playerModeOpts 走对了，两幅图口径不一致）。
        var pmo = playerModeOpts();
        var omni = AntSolver.Solver.runSolver(currentLevel, 0, 1, true, pmo.bottomOnly,
          { capturePreviewStats: true, instantChain: pmo.instantChain });
        oSamples = omni.pressureSamples || []; oWon = omni.completed; oItems = omni.itemMarks || []; oItemUses = omni.itemUses || 0;
        oStepStats = omni.stepStats || null;
      }
      // 【v147】generationEval.omni 只带压力样本、不带 stepStats（那是 solveResult 上的字段），
      //   所以这里补一层兜底：三处来源取不到就回落到本关的求解记录，否则图会空着。
      if (!oStepStats || !oStepStats.length) {
        oStepStats = (currentImportedSolve && currentImportedSolve.stepStats) ||
                     (currentGenerationEval && currentGenerationEval.omni && currentGenerationEval.omni.stepStats) || null;
      }
      chartCache.steps = buildStepSeries(oStepStats, limit);
      chartCache.omni = {
        samples: oSamples, won: oWon,
        choke: AntSolver.Analysis.chokepointMetric(oSamples, totalBoxes, limit),
        audit: AntSolver.Analysis.chokepointAudit(oSamples, totalBoxes, limit),
        preview: previewMetrics(oSamples), items: oItems, itemUses: oItemUses, reused: reused
      };
    } catch (e) { }
    try {
      var pl = null;
      if (currentGenerationEval && currentGenerationEval.player && currentGenerationEval.player.pressureSamples && currentGenerationEval.player.pressureSamples.length) {
        var gp = currentGenerationEval.player;
        // 复用生成诊断的玩家结果时，把 v4 新增的复活事件与逐 tick 轨迹一并带过来（generator 已在
        // generationEval.player 上保留）。老数据没有这两项时退化为空数组，图上不画复活标记而非报错。
        pl = {
          pressureSamples: gp.pressureSamples, won: gp.won, itemMarks: [], itemUses: 0,
          reviveEvents: gp.reviveEvents || [], tickTrajectory: gp.tickTrajectory || [],
          elimMode: gp.elimMode || 'fourSide'
        };
      } else {
        // 需求 §6.1：现场重算必须继承本关【实际玩法模式】，瞬时连锁关卡不得静默回退普通四方向。
        // 需求 §6.3：口径与正式玩家验证对齐——原实现写死 useItems:true（启用了正式验证里不存在的旧道具），
        //   现改为跟随正式验证的默认值（关）。复活机制保留（reviveCap 默认 2），不受此项影响。
        pl = AntSolver.PlayerSim ? AntSolver.PlayerSim.run(currentLevel, Object.assign({
          seed: 7, capturePreviewStats: true
        }, playerModeOpts())) : null;
      }
      if (pl) chartCache.player = {
        samples: pl.pressureSamples, won: pl.won,
        choke: AntSolver.Analysis.chokepointMetric(pl.pressureSamples, totalBoxes, limit),
        audit: AntSolver.Analysis.chokepointAudit(pl.pressureSamples, totalBoxes, limit),
        preview: previewMetrics(pl.pressureSamples), items: pl.itemMarks || [], itemUses: pl.itemUses || 0,
        // 需求 §5/§6.2：复活标记与逐操作 tick 轨迹（供压力图在复活步画真实下降并续接后续曲线）
        trajectory: pl.tickTrajectory || [],
        reviveEvents: (pl.reviveEvents || []).map(function (e) {
          return { index: e.index, done: e.done, tick: e.tick, bufferBefore: e.bufferBefore, bufferAfter: e.bufferAfter, releasedCount: e.releasedCount };
        }),
        elimMode: pl.elimMode || 'fourSide'
      };
    } catch (e) { }
    // v121：首绘就带上游标（进入模拟时进度为 0，游标落在最左端），避免「图有了但没有当前位置标记」。
    redrawCharts(simulating ? simChartCursor('both') : null);
  }

  function renderBuffer(state) {
    if (!state) return;
    var limit = state.bufferLimit;
    var slotArr = []; for (var i = 0; i < limit; i++) slotArr.push(null);
    for (var b = 0; b < state.buffer.length; b++) {
      var item = state.buffer[b];
      // 手动游玩：球放在其映射槽位(起点列对齐)；否则依次填入
      var slot = (item.slot != null && item.slot < limit) ? item.slot : (b < limit ? b : limit - 1);
      slotArr[slot] = { color: item.color, revealed: item.progress, need: item.need, link: item.link };
    }
    renderBufferSlots(slotArr, limit, state.buffer.length);
  }

  function renderStats(state) {
    if (!state) return;
    document.getElementById('stat-steps').textContent = state.steps;
    document.getElementById('stat-eliminated').textContent = state.eliminatedPixels;
    document.getElementById('stat-total').textContent = state.totalPixels;
    document.getElementById('stat-progress').textContent = Math.round(state.eliminatedPixels / state.totalPixels * 100) + '%';
  }

  // ==================== 模拟模式 ====================
  // ==================== 手点模拟的消除模式 ====================
  // 用户 2026-08-05：「用户手点模拟也要增加同步切换的选项。确保消除逻辑和选择的求解路线是一致的」
  // 手点取盒的消除逻辑由 Simulator 状态上的两个开关决定（v99 起结算已按模式分发），
  // 因此这里只需把状态切对；求解路线下拉默认「跟随当前」，自然与之一致。
  // 演示按钮会直接改状态模式（底部版/瞬时连锁版），此时要把下拉显示同步过去，
  // 否则下拉写着「四边入口」而实际在别的模式，用户看到的与执行的不一致。
  // 用 _silent 标记避免触发 change 回调（否则会连带重置本局、把刚求好的回放清掉）。
  function syncElimModeSelect(mode) {
    var el = document.getElementById('sim-elim-mode');
    if (!el || el.value === mode) return;
    el.value = mode;
  }
  function elimModeSelected() {
    var el = document.getElementById('sim-elim-mode');
    var v = el ? el.value : 'fourSide';
    return (v === 'bottomOnly' || v === 'instantChain') ? v : 'fourSide';
  }
  // 【2026-10-14】「圈」多久重算一次：frozen（整盒冻结，默认）| layer（每层重算）| pixel（每人重算）
  function pickLayerLabel(v) {
    return v === 'layer' ? '每层重算' : (v === 'pixel' ? '每人重算（拟实机）' : '整盒冻结（现状）');
  }
  function applyPickLayerMode(v) {
    if (AntSolver.Simulator.setPickLayerMode) AntSolver.Simulator.setPickLayerMode(v || 'frozen');
  }
  // 把模拟器状态切到指定模式。底部模式必须【重播种】目标图（只从底边开口），
  // 另两种模式用默认四边种子。切换后已消像素按新规则重新计算，故调用方需先 reset。
  function applyElimModeToState(mode) {
    var st = AntSolver.Simulator.getState();
    if (!st) return;
    st.instantChain = (mode === 'instantChain');
    st.bottomOnly = (mode === 'bottomOnly');
    if (mode === 'bottomOnly') {
      st.eliminated = AntSolver.outsideReachSeed(currentLevel.blocks, st.rows, st.cols, true);
      st.eliminatedPixels = 0;
    }
  }
  // 切换消除模式：规则变了，旧的消除进度不再成立 → 必须重置本局，否则棋盘与目标图口径会错乱。
  function onElimModeChange() {
    if (!AntSolver.Simulator.isActive()) return;
    stopAutoPlay(); stopAnim(); stopPlayerDemo(); stopLive();
    AntSolver.Simulator.reset();
    applyElimModeToState(elimModeSelected());
    // 【2026-10-13】手点默认改回【经典串行路径】（= 与「单步(全知)」同一套）：
    //   整盒一次性结算 + 按「圈 → 由下到上 → 由左到右」的像素顺序。
    //   原来默认的"时间驱动(每盒每秒 5~8 像素)"会让手点看起来是"一点一点消、顺序像旧版"。
    liveMode = false;
    removeGameMsg();
    refreshSimUI();
    // 路线若正在显示且设为「跟随当前」，重算以保持与消除逻辑一致
    if (routeOverlay.active) {
      var sel = document.getElementById('route-mode');
      if (!sel || sel.value === 'auto') buildRouteOverlay();
      refreshSimUI();
    }
    var el = document.getElementById('solve-details');
    if (el) el.innerHTML = '<p style="color:#8bc34a">已切换消除模式：' + modeCN(elimModeSelected()) + '</p>' +
      '<p style="font-size:11px;color:#8a7358">规则变化会使原有消除进度失效，本局已重置到初始状态。' +
      '手点取盒与求解路线现在都按该模式执行。</p>';
  }

  function enterSimulation() {
    if (!currentLevel) return;
    simulating = true;
    AntSolver.Simulator.enter(currentLevel);
    // 进入模拟时按下拉当前选择初始化消除模式（默认四边入口 = 原行为）
    applyElimModeToState(elimModeSelected());
    document.getElementById('section-buffer').classList.remove('hidden');
    setSimLayout(true);          // 【v144】右栏常驻；这里由 applyRightPanels 按状态切到「模拟控制+压力图」
    applyTargetViewportSize();   // 中间一列变窄了，目标图框体按新可用宽度重算一次
    document.getElementById('btn-simulate').disabled = true;
    document.getElementById('btn-exit-sim').classList.remove('hidden');
    document.getElementById('status-title').textContent = '模拟游玩';
    // 【2026-10-13】进入模拟默认走【经典串行路径】：点一个盒 → 这一盒的小人整批按新顺序消完（与「单步」一致）。
    //   想回到"时间驱动(真机速率一滴一滴)"，把这里改成 true 即可。
    liveMode = false;
    lastBoardSig = null;   // v123：进入模拟先作废签名，保证首帧一定绘制棋盘
    refreshSimUI();
    renderPressureCharts();   // 进入模拟即计算并绘制 全知/玩家 暂存压力复合图
  }

  function exitSimulation() {
    stopAutoPlay();
    stopAnim();
    stopFlash();                    // 退出模拟必须停掉闪白计时器，否则它会在别的视图里继续改目标图
    stopLive(); liveMode = false;   // v121：退出模拟必须停掉时间驱动结算表，否则它会继续吃像素
    lastBoardSig = null;            // v123：换关/再次进入时棋盘必须重绘
    visualElim = null;
    simulating = false;
    setSimLayout(false);            // 【v144】右栏常驻，这里按状态决定显示哪块面板
    // 退出模拟时清掉求解路线叠加，避免下次进入或换关时残留上一关的路线
    routeOverlay = { active: false, map: null, total: 0, mode: null, pmap: null, ptotal: 0 };
    var rb = document.getElementById('btn-show-route'); if (rb) rb.classList.remove('active');
    AntSolver.Simulator.exit();
    document.getElementById('section-buffer').classList.add('hidden');
    document.getElementById('btn-simulate').disabled = !currentLevel;
    document.getElementById('btn-exit-sim').classList.add('hidden');
    document.getElementById('status-title').textContent = '关卡信息';
    removeGameMsg();
    if (currentLevel) { renderTarget(null); renderQueues(null); renderLevelInfo(); }
  }

  // ==================== 【v132·手动摆盒】编辑态 ====================
  // 需求（用户 2026-10-13）：「当前求解器中的关卡是自动生成的，我想手动的摆放关卡」。
  //   一关 = 小人板(目标图，来自导入的 TXT) + 车场(棋盘上每格的车：颜色 + 载客量)。
  //   小人板本来就能导入，缺的是【车场能自己摆】。编辑器本体在 js/level-editor.js，
  //   这里只负责：进出编辑态、把编辑结果装回 currentLevel、以及给它调用宿主的能力。
  function editBoxCount(board) {
    var n = 0;
    for (var r = 0; r < board.rows; r++) {
      for (var c = 0; c < board.cols; c++) {
        var cell = board.cells[r][c];
        if (AntSolver.isBox(cell)) n++;
        else if (AntSolver.isPipe(cell)) n += (cell.queue ? cell.queue.length : 0);
      }
    }
    return n;
  }

  /** 把编辑中的车场装回当前关卡（顺手刷新「关卡信息」与棋盘统计）。 */
  function editInstallBoard(board) {
    if (!currentLevel || !board) return;
    currentLevel.board = AntSolver.normBoard(board);
    currentLevel.totalBoxes = editBoxCount(currentLevel.board);
    renderLevelInfo();
    if (!simulating) renderQueues(null);
    editCheckDirty();
  }

  /**
   * 【v135】手改之后，把"导入/生成时算出来的旧结论"作废：
   *   · currentImportedSolve —— 关卡包里那一轮求解（旧布局的压力样本）
   *   · currentGenerationEval —— 生成诊断里的全知/玩家压力样本（旧布局的）
   *   · currentChokeInfo —— 卡点类型与位置（只描述"生成时把卡点造在哪"，手改后位置已不可信）
   * 不清的话，进入「模拟游玩」时两张压力图会拿旧曲线当新结果画出来 —— 实测过：清空车场之后
   * 图上仍显示原关的"通关·峰值3"。清掉之后会按当前布局【现算】。
   */
  function editCheckDirty() {
    if (!currentLevel) return;
    var sig = JSON.stringify([currentLevel.blocks, currentLevel.board]);
    if (editSig == null) { editSig = sig; return; }   // 首次（刚进摆盒）：只记基线，不算改动
    if (sig === editSig) return;
    editSig = sig;
    currentImportedSolve = null;
    currentGenerationEval = null;
    currentChokeInfo = null;
  }

  /** 重算「每色像素数 / 总像素」——目标区被改过之后必须重算，否则核对面板还在按老图算。 */
  function editRecomputeCounts() {
    var counts = {}, total = 0;
    for (var r = 0; r < currentLevel.rows; r++) {
      for (var c = 0; c < currentLevel.cols; c++) {
        var id = currentLevel.blocks[r][c];
        if (id > 0) { total++; counts[id] = (counts[id] || 0) + 1; }
      }
    }
    currentLevel.colorCounts = counts;
    currentLevel.totalPixels = total;
  }

  /**
   * 【v155】写进条目：`entry.blocks`（生成 / 批量生产派发用的那份）
   * 与 `entry.level.blocks`（中间棋盘、目标图渲染、手动摆盒用的那份）**必须是同一份数组**。
   *
   * 为什么不写会出事：这两份只要不是同一个数组，用户在手动摆盒里改的目标图就只改了一边 ——
   *   · 导入关卡包（`合格关卡/x.json` 本体 + `生产文档/关卡数据/x.json` 无损 同名同批）时，
   *     第 3b 步会把 entry.level 整体换成无损的，旧写法只换 level、entry.blocks 还指着本体那份；
   *   · 色库互转（`reinterpretAll` / 🎨色库转换）会给 entry.blocks 换一个新数组，level.blocks 不动。
   * 症状（用户 2026-10-16 报）：「手动摆盒改完目标图 → 点批量生产 → 映射到中间，目标图还是原来的 txt」。
   * 收口办法：所有对条目 blocks 的写入都走这里，两边永远同一份引用。
   */
  function setEntryBlocks(en, blocks) {
    if (!en || !blocks) return;
    en.blocks = blocks;
    if (en.level) en.level.blocks = blocks;
  }
  /** 【v155】当前关的 blocks 变了 → 写回当前条目（画笔/撤回/手改目标图都会调它）。 */
  function syncEntryBlocks(blocks) {
    if (!blocks || currentLevelIdx < 0 || currentLevelIdx >= levelList.length) return;
    setEntryBlocks(levelList[currentLevelIdx], blocks);
  }

  /** 把（改过的）目标图装回当前关卡。注意：车场不动，所以改完目标区后「每色人数核对」会立刻不等。 */
  function editInstallBlocks(blocks) {
    if (!currentLevel || !blocks || !blocks.length) return;
    currentLevel.blocks = blocks;
    currentLevel.rows = blocks.length;
    currentLevel.cols = blocks[0] ? blocks[0].length : 0;
    editRecomputeCounts();
    syncEntryBlocks(blocks);   // 【v155】手改/回退目标图后立刻同步到条目，批量生产才不会用旧图
    renderTarget(lastTargetElim);
    renderLevelInfo();
    if (AntSolver.LevelEditor && AntSolver.LevelEditor.onLevelChanged) AntSolver.LevelEditor.onLevelChanged();
    editCheckDirty();     // 【v135】目标区被改过 → 旧求解数据同样作废
  }

  // ==================== 【v133·摆盒】目标区微调画笔 ====================
  // 需求（用户 2026-10-13）：「在求解器上加入这个功能吧，就是我可能会微调目标区的一点像素」。
  //   改前目标图只能整张导入；现在在「手动摆盒」里可以直接点/拖改单个像素
  //   （画笔 = 当前颜色；橡皮工具 = 擦成空位；吸管工具 = 把该像素的颜色读给画笔），带撤回。
  //   只做微调：不提供改尺寸/整片填充（要那些用 参考/目标图TXT编辑器_可手动框选版）。
  //   与目标图原有的「拖拽平移」互斥：画笔开启时按下 = 上色，不再平移；滚轮缩放照旧，方便放大到单格细调。
  var tgtPaint = false;         // 画笔开关
  var tgtPainting = false;      // 本次按下是否正在连续刷
  var tgtPaintStack = [];       // 撤回栈 [{r,c,from,to}]
  var TGT_PAINT_STACK_MAX = 500;

  function tgtCellFromEvent(e) {
    var canvas = document.getElementById('target-canvas');
    if (!canvas || !currentLevel || !targetLayout || !targetLayout.step) return null;
    var rect = canvas.getBoundingClientRect();
    if (!rect || !rect.width || !canvas.width) return null;
    // 画布没有 CSS 缩放（style.width = canvas.width），这里的比值是防御性的，正常就是 1
    var x = (e.clientX - rect.left) * (canvas.width / rect.width);
    var y = (e.clientY - rect.top) * (canvas.height / rect.height);
    var step = targetLayout.step;
    var c = Math.floor(x / step), r = Math.floor(y / step);
    if (r < 0 || c < 0 || r >= currentLevel.rows || c >= currentLevel.cols) return null;
    return { r: r, c: c };
  }

  function tgtPaintAt(e) {
    if (!tgtPaint) return;
    var pos = tgtCellFromEvent(e);
    if (!pos) return;
    var L = AntSolver.LevelEditor;
    var mode = (L && L.toolMode) ? L.toolMode() : 'place';
    if (mode === 'pick') {                                  // 吸管：只把颜色读给画笔，不改图
      var picked = currentLevel.blocks[pos.r][pos.c];
      if (picked > 0 && L && L.setColor) L.setColor(picked);
      return;
    }
    var col;
    if (mode === 'erase') col = 0;
    else if (mode === 'black') col = 0;                      // 目标图没有黑块，按「擦掉」处理，免得点了没反应
    else col = (L && L.currentColor) ? L.currentColor() : 1;
    var from = currentLevel.blocks[pos.r][pos.c];
    if (from === col) return;
    tgtPaintStack.push({ r: pos.r, c: pos.c, from: from, to: col });
    if (tgtPaintStack.length > TGT_PAINT_STACK_MAX) tgtPaintStack.shift();
    currentLevel.blocks[pos.r][pos.c] = col;
    syncEntryBlocks(currentLevel.blocks);   // 【v155】改一格就同步到条目（批量生产派发的是条目里的 blocks）
    editRecomputeCounts();
    renderTarget(lastTargetElim);
    renderLevelInfo();
    if (L && L.onLevelChanged) L.onLevelChanged();
    if (L && L.onPaintChanged) L.onPaintChanged(tgtPaintStack.length);
  }

  function tgtPaintUndo() {
    if (!tgtPaintStack.length || !currentLevel) return;
    var op = tgtPaintStack.pop();
    currentLevel.blocks[op.r][op.c] = op.from;
    syncEntryBlocks(currentLevel.blocks);   // 【v155】撤回同样同步
    editRecomputeCounts();
    renderTarget(lastTargetElim);
    renderLevelInfo();
    if (AntSolver.LevelEditor && AntSolver.LevelEditor.onLevelChanged) AntSolver.LevelEditor.onLevelChanged();
    if (AntSolver.LevelEditor && AntSolver.LevelEditor.onPaintChanged) AntSolver.LevelEditor.onPaintChanged(tgtPaintStack.length);
  }

  /** 开关目标区画笔（由摆盒面板的按钮调用）。on 省略 = 取反。 */
  function tgtPaintToggle(on) {
    tgtPaint = (on == null) ? !tgtPaint : !!on;
    if (!tgtPaint) tgtPainting = false;
    var vp = document.getElementById('target-viewport');
    if (vp) vp.classList.toggle('painting', tgtPaint);
    if (AntSolver.LevelEditor && AntSolver.LevelEditor.onPaintChanged) AntSolver.LevelEditor.onPaintChanged(tgtPaintStack.length);
    return tgtPaint;
  }

  /** 下载一个文本文件（导出关卡JSON / TXT 用）。 */
  function downloadText(fname, text) {
    var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = fname;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); if (a.parentNode) a.parentNode.removeChild(a); }, 60000);
  }

  function enterEditMode() {
    if (!currentLevel || !currentLevel.blocks || !currentLevel.rows) {
      alert('请先导入目标图（TXT）或导入关卡，再来手动摆盒');
      return;
    }
    if (simulating) exitSimulation();
    editMode = true;
    editSig = null;          // 【v135】重新记基线：进入摆盒这一刻的关卡状态
    setSimLayout(true);   // 【v144】右栏常驻；applyRightPanels 会按 editMode 显示「手动摆盒」面板
    document.getElementById('btn-exit-edit').classList.remove('hidden');
    document.getElementById('btn-manual-edit').classList.add('active');
    document.getElementById('board-row').classList.add('hidden');
    document.getElementById('edit-board-wrap').classList.remove('hidden');
    document.getElementById('btn-simulate').disabled = true;
    document.getElementById('status-title').textContent = '手动摆盒';
    applyTargetViewportSize();
    AntSolver.LevelEditor.enter();
    var box = document.getElementById('solve-result');
    if (box) {
      box.classList.remove('hidden');
      document.getElementById('solve-details').innerHTML =
        '<p style="color:#d2701f">✏️ 手动摆盒</p>' +
        '<p style="font-size:11px;color:#8a7358">右栏选颜色与载客量 → 点棋盘空格放车；点已有车 = 按当前颜色改写；' +
        '按住拖动 = 换位（拖到别的车上则互换）；右键 = 清空该格。空位是合法的，不必铺满。<br>' +
        '摆完点「▶ 带入模拟器」直接玩/求解，或「⬇ 导出关卡JSON」存成官方 5 键格式。<br>' +
        '<span style="color:#8a7358">改过之后，右侧那两张暂存压力图会在「带入模拟器」时<b>按新布局现算</b>' +
        '（导入时那份旧曲线会作废，不会拿旧数据糊弄你）。</span></p>';
    }
  }

  function exitEditMode() {
    if (!editMode) return;
    editMode = false;
    tgtPaintToggle(false);          // 【v133】退出摆盒时顺手关掉目标区画笔，免得回到普通视图后拖不动图
    if (AntSolver.LevelEditor) AntSolver.LevelEditor.exit();

    document.getElementById('btn-exit-edit').classList.add('hidden');
    document.getElementById('btn-manual-edit').classList.remove('active');
    document.getElementById('board-row').classList.remove('hidden');
    document.getElementById('edit-board-wrap').classList.add('hidden');
    document.getElementById('btn-simulate').disabled = !currentLevel;
    document.getElementById('status-title').textContent = '关卡信息';
    setSimLayout(false);
    if (currentLevel) { renderLevelInfo(); renderQueues(null); renderTarget(null); }
  }

  /**
   * 【v160】死局结算：满格且无路可走 → **立刻判失败**，不需要玩家再点任何东西。
   *   用户 2026-10-16 报的 bug：「无法消除且暂存区五个满的时候，它并没有弹出失败的弹窗」——
   *   原因是原来只在 `pickBox` 之后判一次死局；若死局在"玩家没点成功任何盒"的情况下成立
   *   （盘面被冰/链锁住、或最后一格垫满后已无处可取），就永远不会结算、也就永远不弹窗。
   *   现在把判定挂到每次模拟态刷新上（纯读判定，不改棋盘）。
   */
  function settleDeadEnd() {
    var st = AntSolver.Simulator.getState();
    if (!st || st.gameOver) return false;
    if (!(AntSolver.Simulator.isDeadEnd && AntSolver.Simulator.isDeadEnd(st))) return false;
    st.gameOver = true; st.gameWon = false; st.deadEnd = true;
    return true;
  }

  function refreshSimUI() {
    var state = AntSolver.Simulator.getState();
    if (!state) return;
    syncVisual(state);          // 即时同步（无动画）
    renderTarget(state.eliminated);
    renderQueues(state);
    renderVisualBuffer(state);
    renderVisualStats(state);
    // 【v121·任务AK③】手点取盒 / 撤销 / 重置 / 切模式后也把压力图游标挪到当前进度。
    // 原实现这里不调 redrawCharts → 手点游玩时右侧压力图始终没有游标，看不出走到哪。
    // 手点不对应任何一条既定路线，故两幅图都标（side='both'）。
    var cur = simChartCursor('both');
    if (cur) redrawCharts(cur);
    settleDeadEnd();                       // 【v160】死局立刻结算（再统一弹窗）
    if (state.gameOver) showGameMsg(state.gameWon);
  }

  // revive: 可选 { revivesUsed, reviveCap }——仅玩家版演示传入(需求 §5.6：结束信息同步 通关/复活次数/上限/是否用尽/失败原因)。
  function showGameMsg(won, revive) {
    removeGameMsg();
    var div = document.createElement('div');
    div.className = 'game-msg'; div.id = 'game-msg';
    var state = AntSolver.Simulator.getState();
    // 【v160】失败原因分两种：满格且消不掉（死局）/ 超过上限（溢出）。文案与客户端口径对齐
    //   （客户端：key15「暂存区上限」= 暂存区已满、key8「失败」= 仓库已满）。
    div.innerHTML = won
      ? '<h2 style="color:#8bc34a">🎉 通关！</h2><p>步数: ' + state.steps + '</p>'
      : ('<h2 style="color:#e0592c">💀 失败</h2><p>' +
         (state.deadEnd ? '暂存区已满，且无法继续消除' : '暂存区溢出') +
         (state.buffer ? ('（暂存 ' + state.buffer.length + '/' + state.bufferLimit + '）') : '') + '</p>');
    if (revive) {
      var used = revive.revivesUsed || 0, cap = revive.reviveCap != null ? revive.reviveCap : 2;
      var usedUp = used >= cap;
      div.innerHTML += '<p style="color:#ff8a65">复活次数: ' + used + '/' + cap + (usedUp ? '（已用尽）' : '') + '</p>';
      if (!won && usedUp) div.innerHTML += '<p style="color:#e0592c;font-size:12px">失败原因：复活次数已耗尽</p>';
    }
    div.innerHTML += '<button onclick="document.getElementById(\'game-msg\').remove()">关闭</button>';
    document.body.appendChild(div);
  }

  function removeGameMsg() { var el = document.getElementById('game-msg'); if (el) el.remove(); }

  // 撤销：v121 起手点路径的历史点由 pickBoxLive 的 saveHistory() 产生，
  // 粒度是**每次点击一个点**（回退到该次点击之前的完整状态，含各盒的出蚂蚁进度 acc —— saveHistory 深拷 buffer）。
  // 必须先 stopLive，否则撤销完表还在跑、会立刻在旧状态上继续吃像素。
  function doUndo() {
    stopAutoPlay(); stopAnim(); stopLive();
    AntSolver.Simulator.undo(); removeGameMsg();
    lastBoardSig = null;   // 撤销后签名可能与撤销前相同（steps 回退）→ 必须作废，否则棋盘漏绘
    if (liveMode) { var st = AntSolver.Simulator.getState(); if (st) renderLive(st, true); else refreshSimUI(); }
    else refreshSimUI();
  }
  // 重置：Simulator.reset() 会重建状态、把模式开关清成默认（四边入口）。
  // 若不在这里按下拉重新套用模式，用户在底部/瞬时连锁模式下点一次重置就会静默退回四边入口，
  // 之后的手点消除全按错规则走且无任何提示。
  function doReset() {
    stopAutoPlay(); stopAnim(); stopLive();
    AntSolver.Simulator.reset();
    applyElimModeToState(elimModeSelected());
    liveMode = false;             // 【2026-10-13】重置也回到经典串行路径（与「单步」一致）
    lastBoardSig = null;          // v123：重置后棋盘必须重绘
    removeGameMsg(); refreshSimUI();
  }

  // 贪心选一步并执行（不刷新UI，由动画驱动揭示）
  function doAutoPick(state) {
    var moves = AntSolver.Simulator.getAvailableMoves();
    if (moves.length === 0) return false;
    var best = null, bestScore = -Infinity;
    for (var i = 0; i < moves.length; i++) {
      var m = moves[i];
      if (m.blocked) continue;
      var score = m.canConsume ? 100 : 0;
      var tempElim = AntSolver.deepClone(state.eliminated);
      var potential = AntSolver.Simulator.floodFillEliminate(
        tempElim, state.blocks, state.rows, state.cols, m.antBox.color, m.antBox.count, null, null, state.bottomOnly
      );
      score += potential * 2;
      if (score > bestScore) { bestScore = score; best = m; }
    }
    if (!best) { for (var j = 0; j < moves.length; j++) if (!moves[j].blocked) { best = moves[j]; break; } }
    if (best) { AntSolver.Simulator.pickBox(best.r, best.c); renderQueues(state); return true; }
    return false;
  }

  // ▶ 自动一步：执行一步并事件驱动动画
  function autoStep() {
    if (!AntSolver.Simulator.isActive()) return false;
    stopLive(); liveMode = false;   // v121：单步(全知)也是串行口径
    var state = AntSolver.Simulator.getState();
    if (state.gameOver) return false;
    if (doAutoPick(state)) { playPickAnim(); return true; }   // 手点/单步统一走顺序闪白
    return false;
  }

  // ⏩ 自动求解·全知版：求解器求最优 → 逐步回放(棋盘/暂存同步)；再点=停
  function runOmniDemo() {
    if (!AntSolver.Simulator.isActive()) return;
    if (demoMode === 'replay' || demoMode === 'auto') { stopAutoPlay(); return; }
    stopPlayerDemo();
    // v121：演示/回放走原串行路径（求解器的 pickOrder 是串行模型下算的，
    // 用时间驱动并发模型回放会偏离甚至溢出死）。先停掉手点结算表。
    stopLive(); liveMode = false;
    var result = AntSolver.Solver.solve(currentLevel);
    displaySolveResult(result);
    AntSolver.Simulator.reset();
    // 全知版按四边入口求解 → 状态也必须回到四边入口，并同步下拉，
    // 否则从底部/瞬时连锁模式点进来会出现「状态是别的模式、回放按四边解」的错配。
    var st0 = AntSolver.Simulator.getState();
    if (st0) { st0.instantChain = false; st0.bottomOnly = false; }
    syncElimModeSelect('fourSide');
    refreshSimUI();
    if (result.completed && result.pickOrder && result.pickOrder.length) {
      replaySolution(result.pickOrder);        // demoMode=replay, 逐步回放
    } else {
      demoMode = 'auto'; setAutoBtn(true); startAnim(); // 无完整解 → 贪心尽力演示
    }
  }

  // ⏩ 四方向瞬时连锁版（v99 第三种玩法）：每次取盒后一次性快照批量结算 → 逐步回放；再点=停
  // 与全知版/底部版并列，算法完全复用 v99 已有能力（Solver.solveInstantChain + state.instantChain），
  // 本函数只做网页层接线：求解 → 重置 → 把模拟器状态切到该模式并重播种 → 回放。
  function runChainDemo() {
    if (!AntSolver.Simulator.isActive()) return;
    if (demoMode === 'replay' || demoMode === 'auto') { stopAutoPlay(); return; }
    stopPlayerDemo();
    stopLive(); liveMode = false;   // v121 同 runOmniDemo：演示走原串行路径
    if (!AntSolver.Solver.solveInstantChain) { alert('四方向瞬时连锁求解模块未加载（需 v99 及以上）'); return; }
    var result = AntSolver.Solver.solveInstantChain(currentLevel);
    displaySolveResult(result);
    AntSolver.Simulator.reset();
    // 与底部版同理：reset() 按默认口径建的是四边开口种子，这里要把状态切到瞬时连锁模式。
    // 瞬时连锁本身就是四方向可达，种子口径与默认一致，因此只需置开关、不需要重播种；
    // 但必须显式关掉 bottomOnly（两者互斥），否则回放口径会串。
    var st = AntSolver.Simulator.getState();
    if (st) { st.instantChain = true; st.bottomOnly = false; }
    syncElimModeSelect('instantChain');   // 让消除模式下拉与实际状态一致，避免显示与行为不符
    refreshSimUI();
    if (result.completed && result.pickOrder && result.pickOrder.length) {
      replaySolution(result.pickOrder);
    } else {
      if (!result.completed) {
        var el = document.getElementById('solve-details');
        if (el) el.innerHTML += '<p style="color:#e0592c;font-size:11px">瞬时连锁模式下该关未能通关</p>';
      }
      demoMode = 'auto'; setAutoBtn(true); startAnim();
    }
  }

  // ==================== 求解路线叠加显示 ====================
  // 只做可视化：把「当前模式的全知解」的取盒顺序以序号角标叠在棋盘格子上，不改任何模拟状态。
  // 之所以按当前模式求解，是因为三种玩法的最优取盒顺序本来就不同，显示错模式的路线会误导。
  // 注：状态变量 routeOverlay 声明在文件顶部的状态区（renderQueues 会用到，必须先于它初始化）。
  function currentSimMode() {
    var st = AntSolver.Simulator.getState();
    if (st && st.instantChain) return 'instantChain';
    if (st && st.bottomOnly) return 'bottomOnly';
    return 'fourSide';
  }
  function solveByMode(mode) {
    if (mode === 'instantChain' && AntSolver.Solver.solveInstantChain) return AntSolver.Solver.solveInstantChain(currentLevel);
    if (mode === 'bottomOnly' && AntSolver.Solver.solveBottom) return AntSolver.Solver.solveBottom(currentLevel);
    return AntSolver.Solver.solve(currentLevel);
  }
  // 路线用哪种模式求解：下拉选 auto 时跟随模拟器当前模式，否则用用户显式指定的模式。
  // 允许显式指定的意义在于对照——同一关在三种玩法下的最优取盒顺序不同，可以并排比较。
  function routeModeSelected() {
    var el = document.getElementById('route-mode');
    var v = el ? el.value : 'auto';
    if (!v || v === 'auto' || v === 'player' || v === 'both') return currentSimMode();
    return v;
  }
  // 【v121·任务AK③】下拉新增「玩家版」与「双路线」两项 → 这里解析出「要画哪几条」。
  // 玩家版路线用 PlayerSim 跑（它的决策与全知完全不同，这正是要对照的点），
  // 按【模拟器当前模式】跑，保证与手点消除规则一致。
  function routeSelection() {
    var el = document.getElementById('route-mode');
    var v = el ? el.value : 'auto';
    if (v === 'player') return { omni: false, player: true, mode: currentSimMode(), followed: true };
    if (v === 'both') return { omni: true, player: true, mode: currentSimMode(), followed: true };
    return { omni: true, player: false, mode: routeModeSelected(), followed: (!v || v === 'auto') };
  }
  /** pickOrder → { '<r>,<c>': [步号...] }。同一格可能被取多次（管道补位），故记全部步号。 */
  function routeMapOf(order) {
    var map = {};
    for (var i = 0; i < order.length; i++) {
      var p = order[i], k = p.r + ',' + p.c;
      if (!map[k]) map[k] = [];
      map[k].push(i + 1);
    }
    return map;
  }
  function buildRouteOverlay() {
    var sel = routeSelection();
    var mode = sel.mode;
    var next = {
      active: false, map: null, total: 0, mode: mode, completed: false,
      pmap: null, ptotal: 0, pwon: false, showOmni: sel.omni, showPlayer: sel.player, followed: sel.followed
    };
    var msgs = [];
    if (sel.omni) {
      var result = solveByMode(mode);
      var order = (result && result.pickOrder) || [];
      if (order.length) {
        next.map = routeMapOf(order); next.total = order.length; next.completed = !!result.completed;
      } else msgs.push('全知版在该模式下没有求出可用的取盒顺序');
    }
    if (sel.player) {
      // 玩家版路线的坐标来自 v121 新增的 PlayerSim.pickOrder（逐盒一条、同 step 共享）。
      // 旧版 playersim 没有这个字段 → 如实提示而不是画一条空路线。
      var pr = null;
      try {
        pr = AntSolver.PlayerSim ? AntSolver.PlayerSim.run(currentLevel, {
          seed: 7,
          bottomOnly: mode === 'bottomOnly',
          instantChain: mode === 'instantChain'
        }) : null;
      } catch (ep) { pr = null; }
      var porder = (pr && pr.pickOrder) || [];
      if (porder.length) {
        next.pmap = routeMapOf(porder); next.ptotal = porder.length; next.pwon = !!pr.won;
      } else msgs.push(pr ? '玩家版没有产出取盒序列（该关玩家模拟一步未取）' : '玩家模拟模块未加载或运行失败');
    }
    if (!next.map && !next.pmap) return { ok: false, reason: msgs.join('；') || '没有可显示的路线' };
    next.active = true;
    routeOverlay = next;
    return {
      ok: true, mode: mode, followed: sel.followed,
      steps: next.total, completed: next.completed,
      psteps: next.ptotal, pwon: next.pwon,
      showOmni: !!next.map, showPlayer: !!next.pmap,
      warn: msgs.join('；')
    };
  }
  function modeCN(m) {
    return m === 'instantChain' ? '四方向瞬时连锁' : (m === 'bottomOnly' ? '仅底部入口' : '四边入口');
  }
  function toggleRouteOverlay() {
    var btn = document.getElementById('btn-show-route');
    if (routeOverlay.active) {
      routeOverlay = { active: false, map: null, total: 0, mode: null, pmap: null, ptotal: 0 };
      if (btn) btn.classList.remove('active');
      refreshSimUI();
      return;
    }
    if (!AntSolver.Simulator.isActive()) { alert('请先进入模拟游玩'); return; }
    var r = buildRouteOverlay();
    if (!r.ok) { alert('无法显示求解路线：' + r.reason); return; }
    if (btn) btn.classList.add('active');
    refreshSimUI();
    var el = document.getElementById('solve-details');
    if (el) {
      var which = (r.showOmni && r.showPlayer) ? '全知版 + 玩家版（双路线）' : (r.showPlayer ? '玩家版' : '全知版');
      el.innerHTML = '<p style="color:#8bc34a">🗺 已显示求解路线 · ' + which + '</p>' +
        '<p>路线模式: ' + modeCN(r.mode) + (r.followed ? '（跟随当前）' : '（手动指定）') + '</p>' +
        (r.followed || r.mode === currentSimMode() ? '' :
          '<p style="color:#e6a23c;font-size:11px">提示：路线用的是「' + modeCN(r.mode) +
          '」，而模拟器当前处于「' + modeCN(currentSimMode()) + '」，两者不一致，仅供对照</p>') +
        (r.showOmni ? ('<p>全知版共 ' + r.steps + ' 步' + (r.completed ? '' : '（未通关，尽力解）') + '</p>') : '') +
        (r.showPlayer ? ('<p style="color:#4aa3df">玩家版共 ' + r.psteps + ' 盒' + (r.pwon ? '（通关）' : '（未通关）') + '</p>') : '') +
        (r.warn ? ('<p style="color:#e6a23c;font-size:11px">' + r.warn + '</p>') : '') +
        '<p style="font-size:11px;color:#8a7358">格子中间的数字＝<b>全知版</b>第几步取该盒（绿→橙→红＝早期→中期→后期，' +
        '黄色描边＝下一步）；右下角蓝色角标＝<b>玩家版</b>第几盒取该格。同一格被取多次会显示多个步号（悬停可看全部）。</p>';
    }
  }
  // 给棋盘格子注入路线角标。放在 renderQueues 的格子循环里调用。
  // 【v121·任务AK③】支持两条路线同时叠加：
  //   · 全知版走原有 `data-route` + `::after`（格子正中，按进度分段配色）；
  //   · 玩家版新注入一个 `.route-pbadge` <span>（右下角、蓝色）——`::after` 已被全知版独占，
  //     再抢同一个伪元素会互相覆盖，所以玩家版用真实元素而不是第二个伪元素。
  function applyRouteMark(cellHtml, r, c, state) {
    if (!routeOverlay.active) return cellHtml;
    var key = r + ',' + c;
    var done = state ? (state.steps || 0) : 0;
    /** 从该格的步号列表里挑要显示的那个：优先「还没走到的最靠前一个」，全走过则显示最后一个。 */
    function pickShow(steps) {
      for (var i = 0; i < steps.length; i++) if (steps[i] > done) return steps[i];
      return steps[steps.length - 1];
    }
    if (routeOverlay.map) {
      var steps = routeOverlay.map[key];
      if (steps && steps.length) {
        var show = pickShow(steps);
        var isNext = show === done + 1;
        var frac = routeOverlay.total ? show / routeOverlay.total : 0;
        var seg = frac <= 0.34 ? 'route-early' : (frac <= 0.67 ? 'route-mid' : 'route-late');
        var cls = 'route-step ' + seg + (isNext ? ' route-next' : '');
        var title = '全知路线：第 ' + steps.join('/') + ' 步取此盒（共 ' + routeOverlay.total + ' 步）';
        cellHtml = cellHtml.replace('class="board-cell', 'data-route="' + show + '" title="' + title + '" class="board-cell ' + cls + ' ');
      }
    }
    if (routeOverlay.pmap) {
      var psteps = routeOverlay.pmap[key];
      if (psteps && psteps.length) {
        var pshow = pickShow(psteps);
        var ptitle = '玩家路线：第 ' + psteps.join('/') + ' 盒取此格（共 ' + routeOverlay.ptotal + ' 盒）';
        var badge = '<span class="route-pbadge" title="' + ptitle + '">' + pshow + '</span>';
        var at = cellHtml.lastIndexOf('</div>');
        cellHtml = at >= 0 ? (cellHtml.slice(0, at) + badge + cellHtml.slice(at)) : (cellHtml + badge);
      }
    }
    return cellHtml;
  }

  // ⏩ 自动求解·底部专用版：只能从底部拿块(上/左/右封闭) → 逐步回放；再点=停
  function runBottomDemo() {
    if (!AntSolver.Simulator.isActive()) return;
    if (demoMode === 'replay' || demoMode === 'auto') { stopAutoPlay(); return; }
    stopPlayerDemo();
    stopLive(); liveMode = false;   // v121 同 runOmniDemo：演示走原串行路径
    if (!AntSolver.Solver.solveBottom) { alert('底部专用求解模块未加载'); return; }
    var result = AntSolver.Solver.solveBottom(currentLevel);
    displaySolveResult(result);
    AntSolver.Simulator.reset();
    // 底部版：棋盘取盒逻辑不变(仍首行/顶部口径)，仅【目标图溶解】自底向上。
    // reset() 以默认口径重建目标图种子(四边开口) → 需切 bottomOnly 并【重播种】(只从底边)，否则回放会从上/左/右越位消除。
    var st = AntSolver.Simulator.getState();
    if (st) {
      st.bottomOnly = true;
      st.instantChain = false;   // 三态互斥：显式关掉瞬时连锁，避免从该模式切来时两个开关同时为真
      st.eliminated = AntSolver.outsideReachSeed(currentLevel.blocks, st.rows, st.cols, true);
      st.eliminatedPixels = 0;
    }
    syncElimModeSelect('bottomOnly');
    refreshSimUI();
    if (result.completed && result.pickOrder && result.pickOrder.length) {
      replaySolution(result.pickOrder);
    } else {
      // 底部模式常有"开放型"图不可解 → 提示 + 贪心尽力演示
      if (!result.completed) { var el = document.getElementById('solve-details'); if (el) el.innerHTML += '<p style="color:#e0592c;font-size:11px">底部模式下该关不可解(需顶部/侧面通路)</p>'; }
      demoMode = 'auto'; setAutoBtn(true); startAnim();
    }
  }

  // ==================== 玩家版并发演示 ====================
  function stopPlayerDemo() {
    if (playerTimer) { clearInterval(playerTimer); playerTimer = null; }
    playerFrames = null; playerSlots = null; setPlayerBtn(false);
    var rw = document.getElementById('stat-revive'); if (rw) rw.classList.add('hidden');
  }
  function togglePlayerDemo() {
    if (playerTimer) { stopPlayerDemo(); return; } // 再点=停
    stopAnim(); demoMode = 'off';
    stopLive(); liveMode = false;   // v121：玩家版演示有自己的 frames 回放，不走手点结算表
    // 从头开始：重置模拟器到初始，取初始已消(外部空格)作视觉底
    AntSolver.Simulator.reset();
    var state = AntSolver.Simulator.getState();
    // 玩家版也按当前选定的消除模式跑，否则会出现「消除模式选了瞬时连锁、玩家演示却按四边入口」的错配。
    var pmMode = elimModeSelected();
    var res = AntSolver.PlayerSim.run(currentLevel, {
      capture: true, seed: 7,
      bottomOnly: pmMode === 'bottomOnly',
      instantChain: pmMode === 'instantChain'
    });
    playerFrames = res.frames || []; playerFrameIdx = 0; playerWon = res.won;
    playerRevivesUsed = 0; playerReviveCap = res.reviveCap != null ? res.reviveCap : 2;
    reviveHighlight = null;
    // 视觉已消除底：外部连通空格
    visualElim = AntSolver.outsideReachSeed(currentLevel.blocks, state.rows, state.cols);
    playerSlots = []; for (var i = 0; i < state.bufferLimit; i++) playerSlots.push(null);
    // 棋盘副本(随取球/管道吐球变化)
    playerCells = AntSolver.Simulator.cloneCells(currentLevel.board.cells);
    playerBoardDims = { cells: playerCells, rows: state.boardRows, cols: state.boardCols };
    playerElimCount = 0; playerDoneCount = 0;
    removeGameMsg();
    renderTarget(visualElim);
    renderQueues(null, playerBoardDims);
    renderBufferSlots(playerSlots, state.bufferLimit, 0);
    renderReviveStat();
    setPlayerBtn(true);
    playerTimer = setInterval(playerAnimTick, animFrameMs);
  }
  var playerElimCount = 0, playerDoneCount = 0;
  // 复活次数显示(需求 §5.6)：常驻"已使用/上限"，每次复活事件触发后立即更新(playerAnimTick 内调用)。
  function renderReviveStat(flash) {
    var wrap = document.getElementById('stat-revive');
    var cntEl = document.getElementById('stat-revive-count');
    var capEl = document.getElementById('stat-revive-cap');
    if (!wrap || !cntEl || !capEl) return;
    wrap.classList.remove('hidden');
    cntEl.textContent = playerRevivesUsed;
    capEl.textContent = playerReviveCap;
    if (flash) { wrap.classList.remove('flash'); void wrap.offsetWidth; wrap.classList.add('flash'); }
  }
  // 处理一次【复活事件】(需求 §5.3-5.5)：不重新选择/计算目标，只按 PlayerSim 捕获的 ev 数据原样标记/移除/更新计数。
  function applyReviveEvent(ev) {
    playerRevivesUsed = ev.index;
    var slots = [], cells = [];
    for (var i = 0; i < ev.releasedSlots.length; i++) slots.push(ev.releasedSlots[i]);
    for (var i2 = 0; i2 < ev.removedBoardCells.length; i2++) cells.push(ev.removedBoardCells[i2]);
    // 复活消除的目标图像素：与普通 eats 同样揭示(playerAnimTick 里已通过 curFrame.eats 统一处理，这里只需处理暂存/棋盘的“结果”)。
    for (var s = 0; s < slots.length; s++) if (playerSlots) playerSlots[slots[s]] = null;   // 释放暂存槛位
    for (var b = 0; b < cells.length; b++) if (playerCells) playerCells[cells[b].r][cells[b].c] = null;   // 棋盘残留盒移除
    reviveHighlight = { until: Date.now() + REVIVE_FLASH_MS, slots: ev.releasedSlots.slice(), cells: ev.removedBoardCells.slice() };
    renderReviveStat(true);
  }
  function playerAnimTick() {
    var state = AntSolver.Simulator.getState();
    if (!state || !playerFrames) { stopPlayerDemo(); return; }
    var steps = Math.max(1, animPxPerTick);   // 每帧推进的 tick 数（复用速度滑块）
    for (var s = 0; s < steps && playerFrameIdx < playerFrames.length; s++) {
      var f = playerFrames[playerFrameIdx++];
      for (var pi = 0; pi < f.picks.length; pi++) {
        var p = f.picks[pi];
        playerSlots[p.slot] = { key: p.key, color: p.color, need: p.need, revealed: 0, link: p.link };
      }
      for (var ei = 0; ei < f.eats.length; ei++) {
        var e = f.eats[ei];
        if (!visualElim[e.r][e.c]) { visualElim[e.r][e.c] = true; playerElimCount++; }
        for (var k = 0; k < playerSlots.length; k++) if (playerSlots[k] && playerSlots[k].key === e.key) { playerSlots[k].revealed++; break; }
      }
      for (var di = 0; di < f.done.length; di++) {
        var d = f.done[di];
        playerDoneCount++;
        for (var k2 = 0; k2 < playerSlots.length; k2++) if (playerSlots[k2] && playerSlots[k2].key === d.key) { playerSlots[k2] = null; break; }
      }
      // 棋盘变化：移除被取盒 + 管道新吐盒
      if (f.board && playerCells) {
        for (var ri = 0; ri < f.board.removed.length; ri++) { var rm = f.board.removed[ri]; playerCells[rm.r][rm.c] = null; }
        for (var ai = 0; ai < f.board.added.length; ai++) { var ad = f.board.added[ai]; playerCells[ad.r][ad.c] = { t: 'box', color: ad.color, count: ad.count, chain: 0, q: false, numice: 0 }; }
      }
      // 复活事件(需求 §5.2-5.5)：与普通取盒/消除/完成事件区分识别，直接套用 PlayerSim 捕获好的结果，动画层不重新决策。
      if (f.revive) applyReviveEvent(f.revive);
    }
    renderTarget(visualElim);
    renderQueues(null, playerBoardDims, reviveHighlight);
    renderBufferSlots(playerSlots, state.bufferLimit, playerSlots.filter(function (x) { return !!x; }).length, reviveHighlight);
    renderReviveStat();
    document.getElementById('stat-eliminated').textContent = playerElimCount;
    document.getElementById('stat-total').textContent = state.totalPixels;
    document.getElementById('stat-progress').textContent = Math.round(playerElimCount / state.totalPixels * 100) + '%';
    // 玩家图上竖直游标：同步标记当前演示步数(完成盒数)
    var totB = (currentLevel && currentLevel.totalBoxes) || 1;
    redrawCharts({ side: 'player', p: playerDoneCount / totB, step: playerDoneCount });
    if (playerFrameIdx >= playerFrames.length) {
      stopPlayerDemo();
      showGameMsg(playerWon, { revivesUsed: playerRevivesUsed, reviveCap: playerReviveCap });
    }
  }

  // 停止一切自动演示（供 loadLevel/退出调用）
  function stopAutoPlay() {
    demoMode = 'off';
    replayList = null; replayIdx = 0;
    stopAnim();
    if (typeof stopPlayerDemo === 'function') stopPlayerDemo();
    setAutoBtn(false);
  }

  // ==================== 求解（带动画回放）====================
  function runSolve() {
    if (!currentLevel) { alert('请先导入关卡'); return; }

    // 先运行求解器获取操作序列
    document.getElementById('solve-result').classList.remove('hidden');
    document.getElementById('solve-details').innerHTML = '<p style="color:#888">正在求解...</p>';

    setTimeout(function() {
      var result = AntSolver.Solver.solve(currentLevel);
      displaySolveResult(result);

      if (result.completed && result.pickOrder.length > 0) {
        // 进入模拟模式并自动回放
        enterSimulation();
        replaySolution(result.pickOrder);
      }
    }, 50);
  }

  /**
   * 逐步回放求解结果（逐像素动画）
   */
  function replaySolution(pickOrder) {
    stopAutoPlay();
    replayList = pickOrder; replayIdx = 0;
    demoMode = 'replay'; setAutoBtn(true); startAnim();
  }

  function displaySolveResult(result) {
    var html = '';
    html += result.completed
      ? '<p class="pass">✅ 通关</p>'
      : '<p class="fail">❌ 未通关 (' + result.progress + '%)</p>';
    html += '<p>步数: ' + result.steps + '</p>';
    html += '<p>消除: ' + result.eliminatedPixels + '/' + result.totalPixels + '</p>';
    html += '<p>暂存峰: ' + result.maxBuffer + '</p>';
    html += '<p>均暂: ' + result.avgBuffer + '</p>';
    html += '<p>耗时: ' + (result.time || 0) + 'ms</p>';
    if (result.retryRound) html += '<p>重试: 第' + result.retryRound + '轮</p>';
    html += '<hr style="border-color:#4a3a2c;margin:6px 0">';
    html += '<div style="font-size:10px;max-height:120px;overflow:auto;color:#777;line-height:1.8">';
    for (var i = 0; i < result.pickOrder.length; i++) {
      var p = result.pickOrder[i];
      html += '<span style="color:' + AntSolver.getColorCSS(p.color) + '">●</span>';
      html += '(' + p.r + ',' + p.c + ')×' + p.count + ' ';
      if ((i+1) % 5 === 0) html += '<br>';
    }
    html += '</div>';
    document.getElementById('solve-details').innerHTML = html;
  }

  // ==================== 生成器 ====================
  // ==================== 【v153】自动档：盒容量 + 功能块数量全部由规则推 ====================
  // 依据（全部是本工程实测，见 01_交接文档/工作日志_20261012.md 第二十二节）：
  //   · 车数 = 彩色像素数 ÷ 平均车容量；棋盘格数 ≈ 车数 ÷ 0.74，且列数 = 行数+1~2。
  //     实测：1155 像素的图，容量 25~52（≈30 辆）→ 30 次尝试全灭；容量 10~30（≈50 辆）→ 7×8 通关、开局选项 4。
  //     小鹿 1105 像素 / 40 辆 / 6×7 也是好关 ⇒ **目标车数 40~55 最舒服**。
  //   · 功能块数量由「债务节拍」推（债车=颜色还没露脸的车；冰=延迟选项、锁链=绑一辆同背、管道=藏供给）。
  //     小鹿实际用量：冰 5、链 3 组、问号 2、管道 2 —— 正好是这个量级；问号与管道必须少（玩家要靠可见线索思考）。
  var GEN_AUTO = null;   // 最近一次自动档推出来的参数（供日志/界面显示）

  function genParamMode() { var e = document.getElementById('gen-param-mode'); return e && e.value === 'manual' ? 'manual' : 'auto'; }
  function genTargetSteps() { var e = document.getElementById('gen-target-steps'); var v = parseInt(e && e.value, 10); return (v > 0) ? v : 0; }

  /** 目标图 → 自动参数（纯函数，逐图现算） */
  function genAutoParams(blocks, stepsN) {
    var R = blocks.length, C = blocks[0].length, P = 0;
    for (var r = 0; r < R; r++) for (var c = 0; c < C; c++) if (blocks[r][c] > 0) P++;
    var N = stepsN > 0 ? stepsN : Math.max(40, Math.min(55, Math.round(P / 22)));   // 目标车数
    var cap = P / Math.max(1, N);
    var capMin = Math.max(4, Math.round(cap * 0.65)), capMax = Math.max(capMin + 2, Math.round(cap * 1.35));
    var beats = N >= 45 ? 3 : 2;                       // 债务节拍数（= 卡点数）
    // 【v164】用户 2026-10-16：「黑块太多，很 low 的手法增加阻碍，可以多使用数字冰」
    //   → 冰的配额从 beats×3（夹 6~14%）提到 beats×4（夹 10~20%）：44 盒的关从 ~4 格提到 ~7~9 格。
    var ice = Math.max(10, Math.min(20, beats * 4));   // 冰（%盒）
    var chain = Math.max(2, Math.min(4, beats));       // 锁链（组）
    var q = Math.max(2, Math.min(8, Math.round(beats * 1.5)));   // 问号（%盒，硬上限 8 ≈ 2~4 个）
    var pipes = Math.max(1, Math.min(3, Math.round(N / 25)));    // 管道下限（条）
    // 【v153】卡点机制**固定开启**、不再让用户选（用户 2026-10-16：「只要有卡就行了，
    //   你要保证在 30%-80% 的区域有卡点」）——页面上的「按债务节拍落位道具」勾选框已下线。
    var wantBeatProps = true;
    // 债务节拍 → 道具落位：在 35%/60%/80% 附近各安排一辆"颜色还没露脸"的债车，
    //   第一笔用锁链（与相邻的早色车绑一组 → 一笔取两债），后面两笔用冰（延迟到指定时点进菜单）。
    var beatProps = [];
    try {
      var eo = AntSolver.eliminationOrder(blocks, R, C, false), rd = eo.round, rounds = eo.rounds;
      var vein = [], layerTot = {};
      for (var r2 = 0; r2 < R; r2++) for (var c2 = 0; c2 < C; c2++) {
        var v2 = blocks[r2][c2]; if (v2 <= 0) continue;
        var d2 = rd[r2][c2] || 0, hit = null;
        for (var q2 = 0; q2 < vein.length; q2++) if (vein[q2].round === d2 && vein[q2].color === v2) { hit = vein[q2]; break; }
        if (!hit) { hit = { round: d2, color: v2, size: 0 }; vein.push(hit); }
        hit.size++; layerTot[d2] = (layerTot[d2] || 0) + 1;
      }
      var firstRound = {};
      vein.forEach(function (v) { if (firstRound[v.color] == null || v.round < firstRound[v.color]) firstRound[v.color] = v.round; });
      var cumAll = [], acc = 0;
      for (var d3 = 1; d3 <= rounds; d3++) { acc += (layerTot[d3] || 0); cumAll[d3] = acc; }
      // 【v159】第一笔节拍从 35% 提前到 15%（用户 2026-10-16 批准：「第一笔提前到 ~15% 可以」）——
      //   配合生成器的 earlyPressure（开局半满车 + 开局锁链）一起给前期造压力。
      //   注意：这里是"目标图像素进度"轴，v2 指标里的 0~30% 是"盒进度"轴，两者不同轴但同向。
      var poss = beats >= 3 ? [15, 60, 80] : [15, 70];
      for (var b2 = 0; b2 < poss.length; b2++) {
        var targetPx = poss[b2] / 100 * P, rStar = 1;
        for (var d4 = 1; d4 <= rounds; d4++) if (cumAll[d4] >= targetPx) { rStar = d4; break; }
        var cand = Object.keys(firstRound).map(Number).filter(function (c) { return firstRound[c] > rStar; })
          .sort(function (a, b) { return firstRound[a] - firstRound[b]; });
        if (!cand.length) continue;
        beatProps.push({ kind: b2 === 0 ? 'chain' : 'ice', debtColor: cand[0],
          steps: b2 === 1 ? 6 : (b2 === 2 ? 10 : 0), pos: poss[b2], round: firstRound[cand[0]] });
      }
    } catch (e) { beatProps = []; }
    if (!wantBeatProps) beatProps = [];
    return {
      beatProps: beatProps,
      // 【v153】可用空间目标：0.74 → 0.82。实测（两张图 × 2 种子）：
      //   0.74 → 管道盒占总车 33~37%、曲线 ≤1占 37~42%；0.82~0.84 → 管道 10~15%、≤1占 19~29%、出关率还更高。
      //   机理：可用空间 = 非黑块非管道格占比；黑块有比例上限，配额凑不满的部分**只能给管道**，
      //   所以"管道总是很多"不是选出来的，是 0.74 这条配额代数推出来的。管道下限设 0 也一样（实测）。
      // 【v164】0.82 → 0.86：非盒格（墙+管道）从 18% 降到 14%，**黑块直接少一大截**。
      //   用户 2026-10-16：「黑块太多，很 low 的手法增加阻碍，可以多使用数字冰」——
      //   省下的格子优先变成"盒"（= 多一个选择），阻碍改由数字冰/锁链承担。
      //   代价：阻挡变弱、每步可点更多（压力会降），由 v163 的抉择投放 + 更高的冰配额补偿。
      // 【v168】**关闭**可用空间目标（用户 2026-10-16：「怎么可能关卡一定要有黑块和管道来占用棋盘呢？
      //   就算整个棋盘没有色块也没有管道，它也能组成一个关卡，根据这些色块之间的阻挡关系产生暂存压力」）。
      //   关闭后不再有"非盒格额度"，也就不再逼着放墙/塞管道；压力来自颜色与容量关系。
      //   实测：出关率 1/4 → 4/4，黑块 5 → 0，管道 2 → 0.75 格，窄选择 25% → 11%，开局可点 5 → 5.5。
      usableSpaceTarget: 0,
      boxSizeMin: capMin, boxSizeMax: capMax,
      // 【v166 实测否决】用户要求"黑块最多 4%"→ 直接把这里改成 4% **会崩出关率**（实测 4 关里 3 关候选全灭）。
      //   原因：`blackPercent` 只是**目标带**，真正决定墙数的是 `solveSpaceQuota` 的额度
      //   K = 格数 ×(1 − 可用空间目标) = 14%，其中 **B(墙) + P(管道) = K**；调小 blackPercent 只会把
      //   可行带压窄（bMax≈9%），而 K 没变 → 常常无解 → 候选全灭。
      //   → 要真正做到"墙 ≤4%"，必须改成"**墙当上限、允许不足**，余量给**空位**"（而不是让管道或黑块把额度吃满）。
      //   在那之前保持 8%（该值只作目标带用）。
      // 【v168】黑块 0：自动档不再放任何墙（用户：「黑块依旧，整把有 5 个…我不信这个黑块不能去掉」）。
      blackPercent: 0, blackPercentMin: 0, blackPercentMax: 0,
      // 【v245】黑块真正的来源不是 blackPercent，而是「可用空间配额」：usableSpaceTarget 0.86
      //   意味着 14% 的格子"不该有车"，配额把它全塞成墙 → 6×8 盘实测 5~6 块黑。
      //   把目标抬到 0.97，配额只剩 1 格可分配 → 实测黑块 5~6 → 1。
      //   配套：车数占格比 0.86 → 0.97（车要填得满，否则空格仍会被补成墙）。
      // 【v249】0.97 会把棋盘填满到"一格不剩"，连管道都没地方放 → 任何一点溢出直接判死。
      //   实测 40×40（6~7×7~8）：fill 0.97 → pipeCapacity 10/10；0.90 → 3/3 出关（黑块 2、稳健 33~67）。
      //   0.90 是"黑块少 + 留得出管道"的平衡点；像素密度低的图还会被 applyFillRatio 再压一档。
      usableSpaceTarget: 0.90, carFillRatio: 0.90,
      blackAsCapOnly: true, blackPercentCapPct: 0,
      icePercent: ice, icePercentMin: ice, icePercentMax: ice,
      chainCount: chain, chainCountMin: chain, chainCountMax: chain,
      questionPercent: q, questionPercentMin: q, questionPercentMax: q,
      minPipes: 0, minPipesMin: 0, minPipesMax: 0,   // 【v168】管道下限 0：管道只在真有溢出盒时出现
      narrowPath: false, narrowPathProb: 0,          // 【v168】窄路墙关掉（墙的唯一结构性来源）

      fragmentMaxRate: 0,
      _why: { P: P, N: N, cap: +cap.toFixed(1), capMin: capMin, capMax: capMax, beats: beats, ice: ice, chain: chain, q: q, pipes: pipes }
    };
  }

  /** 把自动参数并进 config（手动档原样返回）；tag 用于日志前缀 */
  // 【v197】参数全部固定：界面不再暴露任何旋钮。按图尺寸选两套内置预设之一。
  //   小图预设 = 方案_小图33-40四方向_v1 的实测值；大图预设 = 方案_v120四方向低管道去微棋盘 的实测值。
  //   生产控制也固定：候选 6 · 每图多产 3 · 单关 5 分钟 · 难度标定 7 轮。
  var FIXED_PRESETS = {
    small: {
      boxSizeMin: 24, boxSizeMax: 36,
      boardRowsMin: 7, boardRowsMax: 9, boardColsMin: 8, boardColsMax: 10,
      usableSpaceTarget: 0.86,
      blackPercent: 5, blackPercentMin: 5, blackPercentMax: 8,
      icePercent: 8, icePercentMin: 8, icePercentMax: 16,
      chainCount: 1, chainCountMin: 0, chainCountMax: 3,
      questionPercent: 6, questionPercentMin: 6, questionPercentMax: 6,
      narrowPath: false, narrowPathProb: 0, minPipes: 0, boardAllowSquare: true,  // 【v236】允许正方形，写进预设
      pipeFloorCount: 2, pipeFallbackCount: 2, pipeMaxDepth: 2, pipeMinFill: 2
    },
    large: {
      boxSizeMin: 40, boxSizeMax: 60,
      boardRowsMin: 8, boardRowsMax: 9, boardColsMin: 8, boardColsMax: 10,
      usableSpaceTarget: 0.86,
      blackPercent: 0, blackPercentMin: 0, blackPercentMax: 10,
      icePercent: 10, icePercentMin: 10, icePercentMax: 25,
      chainCount: 0, chainCountMin: 0, chainCountMax: 4,
      questionPercent: 8, questionPercentMin: 8, questionPercentMax: 16,
      narrowPath: true, narrowPathProb: 1, minPipes: 0,
      pipeFloorCount: 2, pipeFallbackCount: 2, pipeMaxDepth: 6, pipeMinFill: 4
    }
  };
  function genApplyFixed(cfg, blocks, tag) {
    var R = blocks.length, C = blocks[0].length;
    var _autoEl = document.getElementById('gen-board-auto');
    var _boardAuto = !!(_autoEl && _autoEl.checked);
    // 【v304】「容量自适应」勾选框：勾上 = 程序按棋盘反推容量；勾掉 = 用界面填的球容量区间
    var _autoboxEl = document.getElementById('gen-autobox');
    var _autobox = !!(_autoboxEl && _autoboxEl.checked);
    var _cutEl = document.getElementById('gen-cutmode');
    var _cutMode = (_cutEl && _cutEl.value) ? _cutEl.value : '';
    // 【v295·用户裁决】中段压力覆盖率门槛 + 只要难关开关（界面读取，缺元素时回退默认值）
    var _coverEl = document.getElementById('gen-choke-cover');
    var _coverMin = _coverEl ? (parseInt(_coverEl.value, 10) || 70) : 70;
    // 【v320】每图搜索时间 → 单次预算 / 轮数 / 候选数
    var _searchPlan = (function () {
      var el = document.getElementById('gen-search-min');
      var m = parseInt(el && el.value, 10);
      if (!(m > 0 && m <= 20)) m = 3;
      var perMs = 45000;
      var pk = Math.max(2, Math.min(12, Math.round(m * 60000 / perMs)));
      var cand = Math.max(8, Math.min(14, Math.round(perMs / 4300) + 4));
      return { min: m, perMs: perMs, pk: pk, cand: cand };
    })();
    // 【v336】主死因：要求"玩家主要死在某一类障碍上"（空 = 不限）
    var _dcEl = document.getElementById('gen-death-cause');
    var _wantDeath = _dcEl ? (_dcEl.value || null) : null;
    var _dsEl = document.getElementById('gen-death-share');
    var _wantDeathMin = _dsEl ? (parseInt(_dsEl.value, 10) || 60) : 60;
    var _hardEl = document.getElementById('gen-hard-only');
    var _hardOnly = _hardEl ? !!_hardEl.checked : true;

    // 【v215】行列范围规范化：保证范围内至少有一对 (行,列) 满足 列=行+1 或 行+2
    var _norm = (function () {
      // 【v309】行列输入已经从界面移除 → 用固定范围（球数决定具体尺寸）
      var rMin = parseInt((document.getElementById('gen-rows-min') || {}).value, 10) || 4;
      var rMax = parseInt((document.getElementById('gen-rows-max') || {}).value, 10) || 9;
      if (rMax < rMin) { var t = rMin; rMin = rMax; rMax = t; }
      var cMin = parseInt((document.getElementById('gen-cols-min') || {}).value, 10) || 5;
      var cMax = parseInt((document.getElementById('gen-cols-max') || {}).value, 10) || 10;
      if (cMax < cMin) { var t2 = cMin; cMin = cMax; cMax = t2; }
      var ok = false;
      for (var r = rMin; r <= rMax && !ok; r++) for (var c = cMin; c <= cMax; c++) { if (c - r === 0 || c - r === 1 || c - r === 2) { ok = true; break; } }
      if (!ok) {
        var fixedMin = rMax + 1, fixedMax = rMax + 2;
        try { genLog('棋盘范围里没有合法形态（列必须 ≥ 行，且比行多不超过 2 格），已自动把列改成 ' + fixedMin + '~' + fixedMax, 'gen-log-warn'); } catch (e) {}
        return { rowsMin: rMin, rowsMax: rMax, colsMin: fixedMin, colsMax: fixedMax };
      }
      return { rowsMin: rMin, rowsMax: rMax, colsMin: cMin, colsMax: cMax };
    })();
    var big = Math.max(R, C) > 45;
    var preset = big ? FIXED_PRESETS.large : FIXED_PRESETS.small;
    // 【v221】容量自适应（常开）：由「图像总像素」和「棋盘可放格数」反推每辆车的容量。
    //   目标车数 ≈ 棋盘格数 × 可用率；平均容量 = 总像素 ÷ 目标车数；
    //   容量区间 = 平均 ±15%；债车目标容量 = 平均 ×1.05（夹在 26~40）。
    //   这样改棋盘大小，容量和车数会自动跟着变，不会出现"装不下/空太多"。
    var _cellsAll = _norm.rowsMax * _norm.colsMax;
    var _pxAll = 0;
    for (var _r0 = 0; _r0 < R; _r0++) for (var _c0 = 0; _c0 < C; _c0++) if (blocks[_r0][_c0] > 0) _pxAll++;
    var _usable0 = 0.86;   // v290 回退：方案 A 造成 96 的大车与第一行同色，恢复到 0.86
    var _targetCars0 = Math.max(6, Math.round(_cellsAll * _usable0));
    var _capAvg = Math.max(14, Math.min(72, Math.round(_pxAll / _targetCars0)));
    // 【v238】容量下限抬到 33：小图（35×35=1225 px）实测 容量 30~38 全灭在 pipeCapacity、
    //   33~41 反而出关 —— 容量压得太低会把小图切碎成装不下的盒数。大图不受影响（均值本来就高）。
    var _capMin = Math.max(33, Math.round(_capAvg * 0.85));
    // 【v284·用户要求】不要 96 这种超大车：硬上限从 96 收到 64，并把归一化区间设成
    //   [0.6×均值, 1.6×均值] —— 任何一辆车都被夹在这个区间里（实测 12~96 → 23~62）。
    var _capMax = Math.min(64, Math.max(_capMin + 6, Math.round(_capAvg * 1.15)));
    var _debtCap = Math.max(26, Math.min(40, Math.round(_capAvg * 1.05)));
    preset = Object.assign({}, preset, { boxSizeMin: _capMin, boxSizeMax: _capMax });
    try {
      genLog('容量自适应：' + _norm.rowsMax + '×' + _norm.colsMax + ' ≈ ' + _targetCars0 + ' 辆 → 每辆 ' + _capMin + '~' + _capMax +
        ' px（均值 ' + _capAvg + '，债车目标 ' + _debtCap + '）', 'gen-log-ok');
    } catch (e) {}
    // 【v238】删掉 v223 的"容量写死 34~50"：它把上面这段「容量随棋盘反推」整段覆盖了，
    //   于是 6×6（36 格）也按 7×7 的容量切 → 出 ~42 辆装不下 36 格 → 结构层 pipeCapacity 10/10 全灭。
    //   实测对照：批次 unnamed-10-19-109 是 6×6 合格关，31 辆、容量 28~60（均值 46.3）——
    //   正是「容量跟着棋盘走」才成立的形态（工作日志 96）。棋盘不同，容量必须不同。
    var out = Object.assign({}, cfg, preset, {
      // 【v257】候选 2→3；早停要求"峰窗≥3.5 且 稳健≤70"，不再拿第一个勉强及格的收工
      // 【v312】把候选数对齐成日志里显示的 6（原来代码给 4、日志按界面默认印 6，两处不一致）
      // 【v319·用户裁决】「别 6 个候选了，太少了，很难有覆盖率达标的」。
      //   候选数由时间预算决定：一次 produce 45 秒 ≈ 跑 10~11 个候选（单个候选精算 ≈4.3 秒）。
      //   实际候选池 = portfolioK × 每次 produce 内跑满的候选数。
      //   旧值 8×6=48；新值 6×12 上限，45 秒内实跑 ~10 → 约 60 个，总时长不涨（4 分钟/图）。
      // 【v320·用户裁决】候选数/轮数/预算由界面的「每图搜索时间」一个旋钮推导：
      //   3 分钟 → 4 轮 × 45 秒；5 分钟 → 7 轮；8 分钟 → 11 轮（上限 12 轮）。
      //   单轮 45 秒 ≈ 精算 10 个候选（单个候选 ≈4.3 秒），所以候选上限给 14。
      candidateCount: _searchPlan.cand, portfolioK: _searchPlan.pk, timeBudgetMs: _searchPlan.perMs, difficultyRounds: 7,
      earlyStopPeak: 3.5, earlyStopSteady: 70,
      // 【v262·用户裁决】"压力要持久"：不够持久就继续搜，而不是拿第一个高而不久的收工
      earlyStopGe3: 20, earlyStopLongest: 5, earlyStopChokeWin: 2,
      // 【v264·用户目标】30~80% 区间"基本都 ≥3、最高 4"
      // 【v295】早停与目标门都跟滑杆走（原来写死 45，与界面上调的门槛打架）
      earlyStopBand3: _coverMin, earlyStopBandPeak: 4.8,
      // 【v273·用户选 A】合格口径：30~80% 区间暂存≥3 的覆盖率 ≥45%
      targetBand3Min: _coverMin,   // v295：跟界面滑杆走（原 45）// v269：结构多样性把中位从 14% 拉到 40%，门槛随之调到 45   // 实测当前管线 30~80≥3 最高约 57%，先按 60 设（可调到 85 让搜索更久）
      // 【v260·实验】把最晚熟的几辆车借到"扇出最大"的格子上 → 想让全知线被逼出长债。
      //   ⚠ 实测尚未生效（两个版本的闸门都返回 0 组），先默认关，别影响生产。
      gateBorrow: 0,   // 【v231】一图最多产 8 关，命中目标即停（命中不了就取最接近的）
      goodV3: true, requireHardPass: false, seed: null,
      designSweep: false, designDebt: false, // 【v224】单套参数，取消扫描（之前每张图跑 11 变体 × 6 候选 × 7 轮，太慢）
      boardHardRange: !_boardAuto,          // 【v207】不勾自适应 = 硬范围（不许缩小、不许自动换范围）
      boardAllowSquare: true,               // 【v211】允许正方形（列=行）
      boardAuto: _boardAuto,                // 【v207】勾了自适应 = 按车数反推范围，忽略手填数字
      // 【v215】形态约束：列 − 行 只能是 1 或 2；手填的范围里一个合法组合都没有时，
      //   自动把列改成"最大行+1 ~ 最大行+2"，并在日志里说明（否则用户会看到"候选全灭"却不知为什么）。
      boardRowsMin: _norm.rowsMin,
      boardRowsMax: _norm.rowsMax,
      boardColsMin: _norm.colsMin,
      boardColsMax: _norm.colsMax,
      cutPixelOrder: 'peel',                // 【v220】像素顺序：外层优先 + 由下到上 + 由左到右
      // 【v244·用户裁决 2】同色跨层拆两辆：一个颜色既有浅层又有深层像素时，按层各切一块，
      //   深层那块必须等浅层清完才攒得够 → 天然长债。不改车数、不改容量区间。
      //   ⚠ 实测（40×40，6 seed）：开 = 0/6 合格（峰窗被推到 5、单关 40~60s、405 还撞 screen 8/10）；
      //     关 = 2/6。拆出来的盒数 +4~5，把压力推过头了。**默认关**，留作实验开关。
      //     要再试的话先改这个：splitByLayer: true + layerSplitShallow: 2
      splitByLayer: false, layerSplitShallow: 2,
      fillOrder: 'exposure',                // 【v220】铺球：按暴露距离（第 k 辆 ≈ 第 k 步出现）
      debtCarCap: _debtCap,                 // 【v221】债车目标容量（由自适应均值推出）
      cutMode: _cutMode                     // 【v207】'' = 默认趋势切；'layerAware' = 按层切车；'component' = 合球
    });
    try {
      genLog('棋盘：行 ' + _norm.rowsMin + '~' + _norm.rowsMax + ' · 列 ' + _norm.colsMin + '~' + _norm.colsMax +
        (_boardAuto ? '（棋盘自适应：开，将自动换尺寸）' : '（棋盘自适应：关，严格用此范围）'), 'gen-log-ok');
    } catch (e) {}
    // 【v234】棋盘自动选：只有勾了「自适应」才用自动尺寸列表；不勾则严格用你填的行列范围
    if (_boardAuto) {
      // 【v293·A/B 实测】小图配小盘：像素少 → 单车容量小 → 免费车多 → 没有压力。
      //   把棋盘缩到 5×6/5×7，同样像素能切出更大的车（35×35：5%→13%，30×30：10%→23%）。
      //   ⚠ 【v294 更正】这个结论是在 targetBand3Min=0（不卡覆盖率）下测的，且没走生产验收。
      //     实测 35×35 配 5×6 时切出 41 盒 > 30 格，溢出全部挤管道，
      //     而 usableSpaceTarget=0.86 的容差又卡死 → pipeCapacity 20/20 全灭。
      //     小图配小盘要成立，必须同时把 usableSpaceTarget 按盘型放大（见下方 seqFill 分支）。
      // 【v300 回退】原工程的 7×8~8×10 盘在本引擎里覆盖率只有 3~8%（缺它的"按盒数选盘"算法），
      //   先恢复到实测更好的 6×7 系列
      // 【v301】旧流程按盒数选盘，这里给范围；实测 5~6 行 × 7~8 列既能填满又守形态
      out.boardTryDims = null;
      out.boardRowsMin = (_pxAll < 1300) ? 4 : 5; out.boardRowsMax = (_pxAll < 1300) ? 5 : 6;
      out.boardColsMin = (_pxAll < 1300) ? 6 : 7; out.boardColsMax = (_pxAll < 1300) ? 7 : 8;
    }
    // 【v223】棋盘与目标车数 + 冰锁最大供给色 + 管道≤2
    // 【v301】旧流程（原工程）有自己的一套参数，这一块不能再覆盖它
    // 【v315·修 bug】原来 _legacyFlow 在 4676 行读 out.generatorFlow，而 generatorFlow:'old'
    //   是在**下面这个 Object.assign 里**才写进去的 → _legacyFlow 永远 false，
    //   于是旧流程的所有专属参数（棋盘范围、targetCarCount=0、禁止正方形、管道数）全部没生效。
    //   现在先落值再判断。
    out.generatorFlow = 'old';
    // 【v316·用户裁决】上限放宽到 6 行 × 8 列：原来写死 5×7，车一多就只能往管道里塞。
    //   具体挑哪个尺寸仍由「可用率配额 + 装得下优先」决定，不会无脑选最大的。
    // 【v338·用户裁决】范围下探到 4 行 / 6 列：原来大图最小只能 5×7=35 格，
    //   而 30~60 的容量只切出 28 辆车 → 7 个空格没地方去，全补成黑块压在底部。
    //   现在允许 5×6=30、4×6=24 这类更贴合的尺寸（形态仍守 列−行 ≤ 2）。
    out.boardRowsMin = (_pxAll < 1300) ? 4 : 4; out.boardRowsMax = (_pxAll < 1300) ? 6 : 7;
    out.boardColsMin = (_pxAll < 1300) ? 6 : 6; out.boardColsMax = (_pxAll < 1300) ? 8 : 9;
    var _legacyFlow = (out.generatorFlow === 'old');
    out = Object.assign(out, {
      // 【v237】只有勾了"棋盘自适应"才覆盖行列；否则严格用用户填的范围
      // 【v301】旧流程：范围由上面按像素数给（5~6×7~8），这里不再改
      boardRowsMin: _legacyFlow ? out.boardRowsMin : (_boardAuto ? 6 : _norm.rowsMin),
      boardRowsMax: _legacyFlow ? out.boardRowsMax : (_boardAuto ? 7 : _norm.rowsMax),
      boardColsMin: _legacyFlow ? out.boardColsMin : (_boardAuto ? 7 : _norm.colsMin),
      boardColsMax: _legacyFlow ? out.boardColsMax : (_boardAuto ? 8 : _norm.colsMax),
      // 【v305·用户裁决】棋盘尺寸由球数决定后，不允许正方形（保持 列−行 ∈ {1,2}）
      boardHardRange: !_boardAuto, boardAuto: false, boardAllowSquare: !_legacyFlow,
      // 【v238】目标车数也随棋盘走
      // 【v313·用户裁决】旧流程不按"目标车数"拆车：它的棋盘是由盒数反推的（chooseBoardDimsFixed），
      //   再把车拆到 _targetCars0（= 行列上限 9×10×0.86 = 77 辆）只会把 30~50 的车对半劈成 12~25。
      targetCarCount: _legacyFlow ? 0 : (_boardAuto ? 36 : _targetCars0),
      // 【v254】阀门补冰关掉：它是"没有绑定能力时硬凑压力"的老补丁，会在排程之外
      //   再往第 0 行塞 1~2 块冰（实测 6 个格子 4 块冰就是这么来的）。排程已能定点施压。
      valvePlan: false, valveMode: 'largest', valveIceSteps: 10,
      // 【v301】旧流程保留原工程的管道参数（2 条 / 深度 6），不被 v228 的"只留 1 条"覆盖
      maxPipes: _legacyFlow ? 2 : 1,
      // 【v316·用户裁决】不再强制「至少一条管道」：盘面装得下就全放盘上，
      //   装不下才用管道（原来是 2 条，于是永远有车被塞进管道）。
      minPipes: 0,
      pipeFloorCount: _legacyFlow ? 2 : 1,
      pipeFallbackCount: _legacyFlow ? 2 : 1,
      pipeMinFill: _legacyFlow ? 4 : (out.pipeMinFill != null ? out.pipeMinFill : 2),
      // 【v248】管道深度 2 → 6：实测 35×35（1225 px）在 6×7 盘上切出 34~37 盒，
      //   而 42 格 - 配额墙 5 格 = 37 个位置，经常差 3~5 盒装不下；管道深度只有 2 → pipeCapacity 10/10 全灭。
      //   深度 6 后同样 5 个 seed：全灭 5/5 → 出关 5/5（3 个合格）。
      //   代价：管道里最多藏 6 个盒（进度感偏移），但比"什么都产不出来"强。
      pipeMaxDepth: 6, pipeMinFill: 2,
      // 【v242】目标带下界 3 → 3.2：审核的卡点线是 5−1.8=3.2，原来写 3 会让"峰窗正好 3.0"的关
      //   被搜索当成"进带收工"，却被审核判成"无卡点 → 简单关·趋势过平"。这正是"简单合格"的主要来源。
      // 【v295·用户裁决】「难点没事，目前只要有解」——
      //   峰窗上界 4 → 4.8（4.8 是审核自己的上限，再高就触死亡边界 safeEdge），
      //   稳健通关下界 30 → 0（不再因为"太难以致稳健玩家过不去"而判不合格）。
      //   仍然保留：可解（全知必须通关）+ 峰窗下界 3.2（不能又变回简单关）。
      acceptMode: 'target', targetPeakMin: 3.2, targetPeakMax: 4.8, targetSteadyMin: 0, targetSteadyMax: 100,
      // 【v321·用户裁决】「覆盖率满足了，但还是希望有 ≥3 的时候冲到 4 甚至 5」——
      //   只看覆盖率会产出"一条 3 的平台线"（用户贴的图）。再加一条硬门槛：
      //   30~80% 这段里，至少有 5% 的采样点冲到 ≥4。0 = 关掉这条。
      // 【v327·实测调整】尖峰门槛默认关（0）。开了之后"简单关·趋势过平"这一档几乎全被拦，
      //   实测 00:30 那批直接掉进超时兜底。指标仍然统计并显示在目标图上方的结果条里，只是不卡合格。
      targetBand4Min: 0,
      // 【v324·用户裁决】容错门槛：玩家线（不给复活，5 种手痒度 × 2 种子）通关率至少 25%。
      //   0 = 关掉。用户那关 16/16 死于三锁链，就是这条没拦住。
      targetPlayerPassMin: 0.25,
      // 【v336】只收"玩家主要死在某一类障碍"的关（空 = 不限）
      targetDeathCause: _wantDeath, targetDeathCauseMin: _wantDeathMin,

      // 【v239·用户裁决】「尽量用数字冰代替黑块」：黑块全撤（v228 的 2~4% 也不留），
      //   障碍改用数字冰承担（冰是可消的锁，黑块是永久死格，且配额会把墙堆到 14%）。
      blackPercent: 0, blackPercentMin: 0, blackPercentMax: 0,
      // 【v252】冰 18% 实测"一堆"（39 辆车里 9 块=23%，第 0 行还站 2 块）。
      //   降到 10%（8~12）：约 4 块，第 0 行最多 1 块。
      // 【v253】随机冰降到 0：冰只由「顺序闸门」（下面三项）和阀门补冰产生，不再随机撒。
      // row0IceMax 必须 >= 排程数量：排程冻的就是「需求最早」的车，而它们在 v239 之后正好排在第 0 行。
      // 【v256·用户裁决】墙全部压到最底层：中间不再被切出窄走廊
      wallBottomFirst: true,
      // 【v275·用户设计】容量跟"开局暴露量"挂钩：每色容量 ≥ 开局暴露量 ÷ 2，
      //   让开局最多只能装满 2 辆车（实测从 17~19 辆降到 5 辆，覆盖率中位 37%→58%）
      // 【v280·用户要求】不要 160 这种超大车：上限压到 84（≈2× 中位容量），
      //   同时第 0 行同色最多 2 辆 —— 开局能装满的数量靠"同色不扎堆"控制，不靠"把车做大"。
      // 【v283·用户裁决 B】容量回到"按像素比例均分"（全车 ~40），压力改由摆位承担（三明治）。
      //   capTie 关掉后 capPerColor/capCeil 不再生效。
      // 【v288·用户批准】按层铺盘：第 L 层的车，释放时刻 r ≈ (L+0.5)/行数
      //   （棋盘是偏序，玩家可从前沿任选 → 用层号代替线性格序，对开局位置不敏感）
      // 【v290·回退】layerFill 会让第 0 行全同色（它绕过 row0ColorMax 的同色限量）→ 关掉
      layerFill: false, layerLag: 0.5,
      // 【v289·实验】冰锁"开局免费车"：锁住最早能点的免费车，逼玩家开局就背债。
      //   ⚠ 实测（3 seed）：不锁 60% / 锁 6 辆 56%（且 1 关死）/ 锁 9 辆 50%（且 1 关死）。
      //   第 0 行必须留至少 1 辆不冻（iceKeepFreeRow0），否则 screen 全灭。默认关，留档。
      iceFreeFirst: false, iceKeepFreeRow0: 1,
      // 【v291·继承前辈】卡点补救：网关色搬盒 / 同色容量集中。
      //   ⚠ 首测（3 seed）：搬盒触发 0 次（gatewayColorRank 没返回可用色，待查）；
      //     增容触发 2 次但覆盖率下降（15% vs 基线）。默认关，等批量 A/B 再定。
      repairSwap: 0, repairInflate: 0,
      // 【v292·用户选定 bigcap】容量耦合是 12-seed A/B 里唯一有量级提升的改动（中位 11%→33%）。
      //   上限 84（78~84 实测等价，72 会全灭）。代价：会出现 ~86 的大车与 ~10 的碎车。
      // 【v300 回退】照搬原工程参数单独跑只有 22%（+数字冰 35%），仍低于 capTie 的 43% —— 先把 capTie 恢复
      // 【v301·正式采用原工程流程】两个 bug 已修（日志 219）：
      //   ① 旧流程改用 chooseBoardDimsFixed（按盒数选盘 + 守 列−行∈{1,2}）；
      //   ② 冰值夹到 [2,12]。
      //   实测（5×7 盘、容量 40~60、数字冰）：6 seed 覆盖 26/11/100/11/58/58，中位 58%，形态全部合法。
      generatorFlow: 'old',
      // 【v303·用户要求】球容量改成"用户预设"，界面上 gen-boxmin / gen-boxmax 就是它；
      //   只有没填时才回落到原工程的 40~60。
      boxSizeMin: _autobox ? _capMin : (cfg.boxSizeMin || 40),
      boxSizeMax: _autobox ? _capMax : (cfg.boxSizeMax || 60),
      blackPercent: 5, blackPercentMin: 5, blackPercentMax: 8,
      icePercent: 0, chainCount: 2, chainCountMin: 1, chainCountMax: 3,
      questionPercent: 8, questionPercentMin: 6, questionPercentMax: 10,
      narrowPath: true, narrowPathProb: 0.5,
      pipeFloorCount: 2, pipeFallbackCount: 2, pipeMaxDepth: 6, pipeMinFill: 4,
      // 盘型：原工程的 7~9×8~10 会把盒子填不满 → 裁行 → 出现 4×10 怪盘，实测改成 5~6×7~8 才对
      capTie: false, capPerColor: 2, capCeil: 84, row0ColorMax: 2,
      // 【v328·用户裁决】第 0 行最多留 2 辆"点了就能吃满"的车。开局只有第 0 行能点，
      //   这一行全是免费车 = 开局零压力（覆盖率卡 22% 的根因）。设大 = 更松，0 = 一辆免费车都不许。
      row0FreeMax: 2,
      // 【v329】换完还剩的免费车 → 加数字冰冻住（0 = 不冻）。用户配方：换深层色上来 + 给大色车加冰。
      row0FreeIce: 6,
      // 【v294·序号铺盘】默认关，留作 A/B 实验开关。
      //   背景（工作日志 217 节）：压力 = 序差，实测模型命中 93%。但现行 BFS 铺法只用"暴露距离"
      //   近似"第几步能点到"，中段前沿同时展开一大片 → 车单顺序与实际取用顺序脱钩。
      //   seqFill 把格子铺放顺序换成沿前沿推进的单链遍历，使 seq[k] 在取走 seq[k-1] 后才激活，
      //   从而"车单顺序 = 取用顺序"在几何上成立；车单本身改按当用时刻 r 升序（免费车先上场）。
      seqFill: false,
      // 【v297·用户设计B】依赖层铺盘：给棋盘格子算"挖掘层"（从第0行BFS），
      //   第 L 层的格子只放 L_min ≤ L+tol 的车，用它控制空间阻隔（深层车埋在必须挖很久的位置）。
      //   默认关，留作 A/B 对照臂。depFillTol 允许"深一点的车放到浅一层"，否则浅层格子会空着。
      depFill: false, depFillTol: 1,
      // 【v298•用户裁决A】可达性下限闸门：模拟"会背债的保守玩家"，走不通就淘汰该候选。
      //   默认跟随 depFill 自动开关；设 true/false 可强制。判据见 conservativeSolvable。
      accessGate: null,
      // 【v295·用户裁决】卡点判定改「覆盖率」：20%~80% 里暂存≥3 的采样点占比 ≥ chokeCoverMin(%) 才算有卡点。
      //   用户原话：「现在要求 20%-80% 的过程中有 70% 突破暂存≥3（也许 70 太多，加一个滑轮）」。
      //   滑杆值由 genApplyFixed 从界面读取覆盖（见 gen-choke-cover），这里给默认 70。
      chokeCoverMin: _coverMin, chokeCoverLo: 0.20, chokeCoverHi: 0.80, chokeCoverBuf: 3,
      // 【v295·用户裁决】暂时不要简单合格：「现在只生成难的关卡，理解后再生成简单的」。
      //   打开时 flatTrend 不再算合格（详见 candTier / evaluateGeneration 里的 hardOnly 分支）。
      //   想恢复简单关，把这个改成 false 即可。
      hardOnly: _hardOnly,
      // 小盘上 usableSpaceTarget 必须放大：0.86 是按 6×7 调的，小盘溢出装不下时
      //   "可用空间偏离"与"管道容量"会互相锁死（35×35 + 5×6 实测 20/20 全灭）。
      usableSpaceTarget: (_norm.rowsMax * _norm.colsMax <= 35) ? 0.94 : 0.86,
      // 【v284】容量归一化：同色内拆分/合并，保证每辆都在 [0.6×均值, 1.6×均值]
      capNormalize: true,
      // 【v315·用户裁决】归一化必须用**用户设的球容量区间**。
      //   原来写死 [_capAvg×0.6, _capAvg×1.6]：35×35 图 _capAvg = px÷77 = 16 →
      //   [16, 26]，于是不管界面填 30~50 还是 40~60，最后一步 normalize 会把每辆车
      //   重新切成 16~26（58 辆小车、管道塞满）。用户三次说「还是不对」都是它。
      capNormMin: _autobox ? Math.max(16, Math.round(_capAvg * 0.60)) : (cfg.boxSizeMin || 40),
      capNormMax: _autobox ? Math.round(_capAvg * 1.60) : (cfg.boxSizeMax || 60),
      icePercent: 0, icePercentMin: 0, icePercentMax: 0, row0IceMax: 2,
      // 【v253·用户裁决】冰当"顺序闸门"：只冻开局就能装满的车，冻 3 辆、各滞后 2 步。
      //   随机撒冰停用（icePercent 仍留一点做背景障碍）。
      // 【v283·用户反馈】「冰上的数字只有 4」——数字冰是"全局倒计时"，每取走 1 个球减 1，
      //   4 步在一局 30~40 步里只占 10%，锁不住人。加到 7 步（numice=8），才有"逼改路线"的力度。
      // 【v285·用户澄清】冰的数字 = **时差**（这辆车被锁到它的颜色露够为止），不是难度值。
      //   iceSync 打开后由引擎按 demandAt 自动算数字；iceScheduleCount 只是上限。
      iceSchedule: true, iceScheduleCount: 4, iceScheduleDelay: 7, iceSync: true, row0IceMax: 3,
      // 【v299·用户裁决】按「当用时刻 r」分档选冰——解决"数字冰都一样""冰集中在前几行"。
      //   为什么之前的冰会扎堆：规划期就从**窄路缺口**BFS 取格（那时棋盘是空的，不知道会放哪辆车），
      //   而缺口本身就在前几行 → 冰必然集中，且冻到的常是同色同容量车（r 相同 → 冰值相同）。
      //   新逻辑在**铺完车之后**选：每辆车算 r → 按 r 分 3 档 → 每档挑 1 辆 →
      //   冰值 = round(r × 总车数) + iceForceSteps（先卡在它变有用的那一刻，再多压几步）。
      iceByReadyTime: true, iceReadyBuckets: 3, iceReadyPerBucket: 1,
      iceSync: false,          // 旧的"按 gap 排序取前 N 辆"让位给分档选车
      narrowGapIceCount: 0,    // 窄路缺口不再叠冰（它就是把冰挤到前几行的元凶）
      // 【v276·用户设计】冰按"目标区在某一时刻的现状"落：在 35~70% 进度带里，
      //   把那时"一点就满"的免费车冻住，逼玩家改走吃不饱的路线（实测中位 47%→63%）
      iceBandMode: true, iceBandLo: 0.35, iceBandHi: 0.70,
      // 【v281】多点投放：35% / 50% / 65% 各冻 1 辆"那时能吃的车"；块数由组合轮换（2~4）
      // 【v295·用户裁决】「冰不用最多 3、4」——上限 4→8，每点 1→2 辆，投放点加密到 5 个
      //   （25/35/45/55/65%），让中段的每一段都有锁，而不是只在三个点上各扎一根钉。
      //   数字冰仍是"时差锁"：值 = (该时刻还能吃的车数 − 1) + iceForceSteps，夹 2~12。
      iceBandPoints: [0.25, 0.35, 0.45, 0.55, 0.65], icePerPoint: 2, iceMultiPoint: true,
      iceScheduleCount: 8,
      // 【v296·用户裁决】冰值改"相对步长"：上限随关卡长度走，不再一律撞 12。
      //   v = round(时差 × 总车数 × iceScaleCoef)，上限 = ceil(总车数 × iceCapRatio) 夹 [3,12]。
      //   36 车的关卡 → 上限 9；55 车 → 上限 12（封顶）。调大 coef = 冰更久，调大 capRatio = 允许更久。
      iceScaleCoef: 0.6, iceCapRatio: 0.25,
      // 【v277·用户设计】锁链按"大色块 × 小色块"配对（一头随手可吃、一头得等），最多 2 组
      // 【v295·用户裁决】「锁链也可以多一点，但要慎用，因为它是能造成亮点压力（如果有一组接不满）」。
      //   2→4 组；配对约束不放宽（需求差 ≥0.25、一头 need≤0.45 一头 ≥0.55），
      //   即只增加「合格的配对」数量，不降低配对质量 —— 避免出现"接不满"的亮点。
      chainByDemand: 4, chainBandLo: 0.20, chainBandHi: 0.90,
      // 【v278·实测】主动凑对（把极端车换进相邻格再上链）会把 capTie 的对应关系打散，
      //   覆盖率 63%→32%，所以默认关；只保留"自然配对"（相邻两格本来就一大一小时才上链）
      chainCompose: false
    });
    try {
      genLog('模式：容量 ' + _capMin + '~' + _capMax + ' · 目标 ' + (_boardAuto ? 36 : _targetCars0) +
        ' 辆 · 冰锁最大色(10步) · 管道≤2', 'gen-log-warn');
    } catch (e) {}
    try {
      genLog('固定参数：' + (big ? '大图' : '小图') + '预设（' + R + '×' + C + '）· 每图多产 3 次 · 候选 6 · 单关 5 分钟',
        'gen-log-ok');
    } catch (e) {}
    // 【v333】把"本关实际用的参数"打进日志：用户反复问"我填 30~60 怎么出 30 的车"，
    //   有这一行就能直接对上——是他填的值、还是被预设/自适应改过、还是页面根本没刷新。
    try {
      genLog('本关参数　容量 ' + out.boxSizeMin + '~' + out.boxSizeMax +
        ' · 归一化 ' + out.capNormMin + '~' + out.capNormMax +
        ' · 目标车数 ' + out.targetCarCount +
        ' · 棋盘 ' + out.boardRowsMin + '~' + out.boardRowsMax + ' × ' + out.boardColsMin + '~' + out.boardColsMax +
        ' · 流 ' + out.generatorFlow + ' · 单轮 ' + Math.round((out.timeBudgetMs || 0) / 1000) + 's', 'gen-log-ok');
    } catch (e) { }
    return out;
  }

  function genApplyAuto(cfg, blocks, tag) {
    if (genParamMode() !== 'auto') return cfg;
    var a = genAutoParams(blocks, genTargetSteps());
    GEN_AUTO = a._why;
    var deltas = {};
    for (var k in a) if (k !== '_why') deltas[k] = a[k];
    // 黑块不能设 0（实测：黑块 0 → 管道容量 20/20 全灭），兜一个下限
    if (!(deltas.blackPercent > 0)) deltas.blackPercent = 3;
    // 只报"安排了几处卡点、落在哪个区间"，不再报"第几 % 卡哪个颜色"（那是内部实现，用户不需要知道）
    var beatTxt = '';
    if (a.beatProps && a.beatProps.length) {
      beatTxt = '；卡点：自动安排 ' + a.beatProps.length + ' 处（落在 30~80% 区间：' +
        a.beatProps.map(function (b) { return b.pos + '%'; }).join('/') + '）';
    }
    genLog('自动档' + (tag ? '·' + tag : '') + '：像素 ' + a._why.P + ' ÷ 目标车数 ' + a._why.N + ' → 平均容量 ' + a._why.cap +
      '，盒容量 ' + a._why.capMin + '~' + a._why.capMax + '；可用空间 0.86（黑块 8%、管道约占 10~15%；原 0.82/0.74 墙会更多）；冰 ' + a._why.ice + '%、锁链 ' + a._why.chain +
      ' 组、问号 ' + a._why.q + '%、管道下限 ' + a._why.pipes + ' 条' + beatTxt + '（碎色闸门一并关闭：碎色是规划内的压力素材）', 'gen-log-ok');
    return Object.assign({}, cfg, deltas);
  }

  // ==================== 【v153】切球规划器 ====================
  // 按导师 2026-10-15 的模型：关卡制作 = 把目标图像素切到若干车里（切球），再决定这些车在
  // 棋盘上的出现顺序（顺序）。供给时间线（矿脉表）由图的几何决定，切球只是在消耗它。
  // 验收三数：菜单宽 ≥4；同存 1~2 笔可解债（解药 ≤5 轮）；未偿总额 ≤ 暂存-2。
  var cutPlanParams = null;   // {steps, beatsText} —— 勾选后批量/单关生成时逐图现算车单

  function cutplanParseBeats(txt) {
    return String(txt || '').split(/[\s,]+/).filter(Boolean).map(function (s2) {
      var pp = s2.split(':');
      return { pos: parseFloat(pp[0]) || 0, size: parseFloat(pp[1]) || 0 };
    }).filter(function (b) { return b.pos > 0 && b.size > 0; });
  }

  /** 核心：目标图 + 目标步数 + 债务节拍 → 车单（纯函数，逐图现算） */
  function cutplanBuild(blocks, stepsN, beatsArr) {
    var R = blocks.length, C = blocks[0].length, P = 0;
    var colTot = {};
    for (var r0 = 0; r0 < R; r0++) for (var c0 = 0; c0 < C; c0++) { var v0 = blocks[r0][c0]; if (v0 > 0) { P++; colTot[v0] = (colTot[v0] || 0) + 1; } }
    var eo = AntSolver.eliminationOrder(blocks, R, C, false), rd = eo.round, rounds = eo.rounds;
    var veins = [], layerTot = {};
    for (var r1 = 0; r1 < R; r1++) for (var c1 = 0; c1 < C; c1++) {
      var v1 = blocks[r1][c1]; if (v1 <= 0) continue;
      var d1 = rd[r1][c1] || 0;
      var vn = null;
      for (var q1 = 0; q1 < veins.length; q1++) if (veins[q1].round === d1 && veins[q1].color === v1) { vn = veins[q1]; break; }
      if (!vn) { vn = { round: d1, color: v1, size: 0 }; veins.push(vn); }
      vn.size++; layerTot[d1] = (layerTot[d1] || 0) + 1;
    }
    veins.sort(function (a, b) { return a.round - b.round; });
    // 【v153 口径统一】默认目标车数与自动档【同一个口径】（像素÷22，夹在 40~55）。
    //   原先这里写死 ÷28（1155 像素 → 41 辆、平均容量 28），比自动档的目标车数少 12 辆，
    //   于是"自动档说 53 辆 / 规划器说 41 辆"两套数字打架；而实测这张图容量 ~28 那一档是【会全灭】的
    //   （容量 25~52 → 30 次尝试全灭；10~30 才出关）。统一后两处一致。
    var N = stepsN > 0 ? stepsN : Math.max(40, Math.min(55, Math.round(P / 22)));
    var avgCap = P / N;
    var k = veins.map(function (v) { return Math.max(1, Math.round(v.size / avgCap)); });
    var K = k.reduce(function (a, b) { return a + b; }, 0), guard = 0;
    while (K !== N && guard++ < 500) {
      if (K < N) { var bi = -1, bv = -1; for (var i1 = 0; i1 < veins.length; i1++) { var vv = veins[i1].size / k[i1]; if (vv > bv) { bv = vv; bi = i1; } } k[bi]++; K++; }
      else { var bj = -1, bvj = -1; for (var i2 = 0; i2 < veins.length; i2++) if (k[i2] > 1 && k[i2] > bvj) { bvj = k[i2]; bj = i2; } if (bj < 0) break; k[bj]--; K--; }
    }
    var cars = [];
    veins.forEach(function (v, i3) {
      var base = Math.floor(v.size / k[i3]), extra = v.size - base * k[i3];
      for (var j3 = 0; j3 < k[i3]; j3++) cars.push({ color: v.color, count: base + (j3 < extra ? 1 : 0), round: v.round, veinIdx: i3 });
    });
    // 债务节拍：债车 = 一辆「颜色还没露脸」的车（取它 → 纯债；该色第一层矿脉开出 → 自动结清）
    //   【v153 更正】先把"每笔债用哪个颜色"定下来（beatPlan），供上一步的排序把债车提前到位。
    var cumAll = [], acc = 0, beatOut = [], beatOK = 0, beatPlan = [];
    for (var d2 = 1; d2 <= rounds; d2++) { acc += (layerTot[d2] || 0); cumAll[d2] = acc; }
    var firstRound = {};
    for (var q3 = 0; q3 < veins.length; q3++) { var vv3 = veins[q3]; if (firstRound[vv3.color] == null || vv3.round < firstRound[vv3.color]) firstRound[vv3.color] = vv3.round; }
    for (var b5 = 0; b5 < beatsArr.length; b5++) {
      var bt0 = beatsArr[b5], tp0 = bt0.pos / 100 * P, rs0 = 1;
      for (var d5 = 1; d5 <= rounds; d5++) if (cumAll[d5] >= tp0) { rs0 = d5; break; }
      var cd0 = Object.keys(firstRound).map(Number).filter(function (c) { return firstRound[c] > rs0; })
        .sort(function (a, b) { return firstRound[a] - firstRound[b]; });
      if (cd0.length && !(bt0.size > colTot[cd0[0]])) beatPlan.push({ pos: bt0.pos, size: bt0.size, debtColor: cd0[0], firstRound: firstRound[cd0[0]], rStar: rs0 });
    }
    // ---------- 排列：按【供给时刻】排位，再按债务节拍把债车提前（用户 2026-10-16 更正） ----------
    //   用户原话：「顶行可以没有过多颜色，我们的目的就是控制各个球的出现时机，来造成卡点和解决」。
    //   所以排序的目标不是"顶行颜色多"，而是**时机**：
    //     ① 默认：每辆车排在"它的供给到来"的那一步附近（车到时货刚到 → 平顺、无债）；
    //     ② 债务节拍：把指定的债车【提前】到节拍进度处（车比货早到 → 全额进暂存 = 这笔债）；
    //     ③ 解药：债色的后续矿脉（更深的像素）由别的颜色的车剥开 —— 那些车按供给序天然排在债车之后，
    //        于是"取债车 → 再去吃几辆解药车 → 债自动结清"这条链就成立了。
    var cum = [], acc2 = 0;
    for (var vi = 0; vi < veins.length; vi++) { acc2 += veins[vi].size; cum[vi] = acc2; }
    cars.forEach(function (c) { c.supplyPct = P ? (cum[c.veinIdx] / P * 100) : 0; });
    var ordered = cars.slice().sort(function (a, b) {
      return (a.supplyPct - b.supplyPct) || (a.color - b.color) || (b.count - a.count);
    });
    // 债务节拍（进 beatProps 的那几笔）：把该色的车从供给时刻提前到节拍位置
    var beatsForOrder = beatPlan;
    var moved = [];
    for (var bi = 0; bi < beatsForOrder.length; bi++) {
      var bt2 = beatsForOrder[bi];
      var hostIdx = Math.max(0, Math.min(ordered.length - 1, Math.round(bt2.pos / 100 * ordered.length)));
      // 挑一辆该色的车（优先容量最接近节拍量、且还没被挪过的）
      var pickI = -1, bestD = Infinity;
      for (var ci = 0; ci < ordered.length; ci++) {
        var cc = ordered[ci];
        if (cc.color !== bt2.debtColor || cc._moved) continue;
        var dd = Math.abs(cc.count - (bt2.size || cc.count));
        if (dd < bestD) { bestD = dd; pickI = ci; }
      }
      if (pickI < 0) continue;
      var car = ordered.splice(pickI, 1)[0];
      car._moved = 1;
      var to = Math.max(0, Math.min(ordered.length, hostIdx));
      ordered.splice(to, 0, car);
      moved.push({ color: car.color, cap: car.count, pos: bt2.pos, from: Math.round(car.supplyPct) });
    }
    cars.length = 0; cars.push.apply(cars, ordered);
    if (moved.length) {
      console.log('[切球规划器] 债务节拍提前：' + moved.map(function (m) { return m.color + '号(容量' + m.cap + ') 供给' + m.from + '%→ 排在' + m.pos + '%'; }).join('；'));
    }

    for (var b4 = 0; b4 < beatsArr.length; b4++) {
      var bt = beatsArr[b4], targetPx = bt.pos / 100 * P, rStar = 1;
      for (var d3 = 1; d3 <= rounds; d3++) if (cumAll[d3] >= targetPx) { rStar = d3; break; }
      var cand = Object.keys(firstRound).map(Number).filter(function (c) { return firstRound[c] > rStar; })
        .sort(function (a, b) { return firstRound[a] - firstRound[b]; });
      if (!cand.length) { beatOut.push('✗ 进度' + bt.pos + '%：这个进度之后没有还没露脸的颜色了'); continue; }
      var color = cand[0];
      if (bt.size > colTot[color]) { beatOut.push('✗ 进度' + bt.pos + '%：债太大（' + color + ' 号色总共 ' + colTot[color] + ' 像素）'); continue; }
      var mine = cars.filter(function (c) { return c.color === color; })
        .sort(function (a, b) { return Math.abs(a.count - bt.size) - Math.abs(b.count - bt.size); });
      if (!mine.length) { beatOut.push('✗ 进度' + bt.pos + '%：该色没有车辆'); continue; }
      mine[0].count = bt.size;
      var rest = colTot[color] - bt.size, others = cars.filter(function (c) { return c.color === color && c !== mine[0]; });
      var ob = others.length ? Math.max(1, Math.floor(rest / others.length)) : 0;
      others.forEach(function (c, i) { c.count = (i === others.length - 1) ? Math.max(1, rest - ob * (others.length - 1)) : ob; });
      beatOut.push('✓ 进度' + bt.pos + '%：' + color + ' 号色（还没露脸）1 辆容量 ' + bt.size + '，解药 = 第' + firstRound[color] + ' 轮露脸（距离 ' + (firstRound[color] - rStar) + ' 轮）');
      beatOK++;
    }
    return { cars: cars, veins: veins, rounds: rounds, beatOut: beatOut, beatOK: beatOK, pixelTotal: P, colorTotal: Object.keys(colTot).length };
  }

  /** 规划按钮：对当前选中（或第一张）目标图规划，并把结果写到面板 */
  function cutplanRun() {
    var el = function (id) { return document.getElementById(id); };
    var idx = currentLevelIdx >= 0 ? currentLevelIdx : 0;
    if (!levelList[idx] || !levelList[idx].blocks) { genLog('切球规划器：请先导入目标图', 'gen-log-warn'); return; }
    var stepsN = parseInt((el('cutplan-steps') || {}).value, 10) || 0;
    var beats = cutplanParseBeats((el('cutplan-beats') || {}).value);
    var plan = cutplanBuild(levelList[idx].blocks, stepsN, beats);
    cutPlanParams = { steps: stepsN, beatsText: (el('cutplan-beats') || {}).value || '' };
    var useEl = el('cutplan-use'); if (useEl) useEl.disabled = false, useEl.checked = true;
    var lines = ['第 ' + (idx + 1) + ' 张图：矿脉 ' + plan.veins.length + ' 条（' + plan.rounds + ' 轮）→ 车单 ' + plan.cars.length + ' 辆（平均容量 ' + (plan.pixelTotal / plan.cars.length).toFixed(1) + '）'];
    plan.veins.forEach(function (v) { lines.push('  第' + v.round + '轮 ' + v.color + ' 号色 ×' + v.size + ' → ' + (plan.cars.filter(function (c) { return c.round === v.round && c.color === v.color; }).length) + ' 辆'); });
    if (plan.beatOut.length) { lines.push('债务节拍：'); plan.beatOut.forEach(function (t) { lines.push('  ' + t); }); }
    lines.push('已勾选「生成时使用这份车单」——点「▶ 批量生产」即按这份切法生成。');
    el('cutplan-body').textContent = lines.join('\n');
    genLog('切球规划器：第 ' + (idx + 1) + ' 张图 车单 ' + plan.cars.length + ' 辆（平均容量 ' + (plan.pixelTotal / plan.cars.length).toFixed(1) + '）' +
      (plan.beatOK ? '｜债务节拍 ' + plan.beatOK + ' 笔' : ''), 'gen-log-ok');
  }

  function runGenerate() {
    var config = getGenConfig();

    // 【v153】切球规划器：勾了「使用这份车单」→ 把规划车单作为切法（forcedBoxes 直通）。
    //   同时临时关闭碎色闸门：规划内的碎色是「背债车」的压力素材，不是缺陷（用户 2026-10-15 模型）。
    if (cutPlanParams && (document.getElementById('cutplan-use') || {}).checked && currentLevelIdx >= 0 && levelList[currentLevelIdx]) {
      var plan = cutplanBuild(levelList[currentLevelIdx].blocks, cutPlanParams.steps, cutplanParseBeats(cutPlanParams.beatsText));
      config.forcedBoxes = plan.cars;
      if (config.fragmentMaxRate) {
        config.fragmentMaxRate = 0;
        genLog('切球规划器：碎色闸门已临时关闭（规划内的碎色 = 背债车素材，不再按缺陷拦截）', 'gen-log-warn');
      }
      genLog('切球规划器：使用车单 ' + plan.cars.length + ' 辆（目标步数 ' + cutPlanParams.steps + '，债务节拍 ' + plan.beatOK + ' 笔）', 'gen-log-ok');
    }

    // 如果当前有导入的TXT图，使用它
    if (currentLevelIdx >= 0 && levelList[currentLevelIdx]) {
      var entry = levelList[currentLevelIdx];
      config = genApplyFixed(config, entry.blocks, entry.name);   // 【v153】自动档：容量/障碍数量由规则推
      config.mapSize = entry.blocks.length;

      document.getElementById('solve-result').classList.remove('hidden');
      // 【v175】单关「生成关卡」改成走**新家族**（produceFixed：纠偏版 + 候选优选 + 卡点变体），
      //   并把尝试面设下限（原实现走旧家族 produce、且"合格即早停"，实测 10 秒就结束 → 尝试太少）。
      //   用户 2026-10-16：「会不会是你遍历的那些结果太少了？跑生成关卡 10 秒钟就搞定了」。
      config.candidateCount = Math.max(config.candidateCount || 1, 6);
      config.rounds = Math.max(config.rounds || 0, 2);
      if (!(config.timeBudgetMs > 0) || config.timeBudgetMs > 90000) config.timeBudgetMs = 90000;   // 单关 90 秒预算
      genLog('单关生成（新家族）：候选 ' + config.candidateCount + ' × 轮 ' + config.rounds + '，时限 ' + Math.round(config.timeBudgetMs / 1000) + 's', 'gen-log-ok');
      document.getElementById('solve-details').innerHTML = '<p style="color:#888">正在生成...</p>';

      setTimeout(function() {
        var result = AntSolver.Generator.produceFixed(entry.blocks, config);
        try {
          var pf = result && result.perf;
          var _candN = (pf && (pf.candidates != null ? pf.candidates : pf.baseCandidates)) != null
            ? (pf.candidates != null ? pf.candidates : pf.baseCandidates) : '?';
          genLog('单关生成完成：实际跑的基础候选 ' + _candN
            + '，评估到的局面 ' + ((pf && pf.evaluatedPositions) != null ? pf.evaluatedPositions : '?')
            + '，停止原因 ' + ((pf && pf.stopReason) || '?') + '，用时 ' + ((result && result.elapsedMs) ? Math.round(result.elapsedMs / 1000) + 's' : '?'), 'gen-log-ok');
        } catch (e) {}
        if (!result || !result.level) { alert('这一关没生成出来：' + ((result && result.lastFailReason) || '候选全灭')); return; }
        genLogGreedyLine(result.level);   // 【v176】单关生成也报贪心线一行
        genLogPlayBatch(result.level);    // 【v177】同一关玩 16 遍：波动区间 + 结束位置分布
        genLogGoodV3(result);             // 【v184】好关判据 v3（六条全过？）
        if (result.portfolio) genLog('　　一图多产　试了 ' + result.portfolio.tried + ' 次（全过 ' + result.portfolio.passes + ' 次，取最优）', 'gen-log-ok');
        loadLevel(result.level);
        currentGenerationEval = result.generationEval || null;
        currentEntryMode = result.entryMode || entryModeOf(config);
        currentChokeInfo = chokeInfoOf(result);
        renderLevelInfo();   // loadLevel 里已渲染过一次，那时 currentChokeInfo 还没赋值，需再渲染一次带上卡点信息
        displayGenerateResult(result);
      }, 50);
    } else {
      document.getElementById('solve-result').classList.remove('hidden');
      document.getElementById('solve-details').innerHTML = '<p style="color:#888">正在生成...</p>';

      setTimeout(function() {
        var result = AntSolver.Generator.generate(config);
        loadLevel(result.level);
        currentGenerationEval = result.generationEval || null;
        currentEntryMode = entryModeOf(config);
        currentChokeInfo = chokeInfoOf(result);
        renderLevelInfo();   // loadLevel 里已渲染过一次，那时 currentChokeInfo 还没赋值，需再渲染一次带上卡点信息
        displayGenerateResult(result);
      }, 50);
    }
  }

  /**
   * 【v120】从 produce 结果里抽出「卡点类型信息 + 位置」给关卡信息面板用。
   * 用户要求：「输出报告和模拟游玩的关卡信息要显示卡点类型的信息和位置等」。
   * 注意 `dropped`：被 v103 的聚集类风险回退摘掉的类型必须显示 ——
   * 否则「勾了某类型却没出现」会被当成 bug 找半天，而它其实是结构失败后的正常降级。
   */
  function chokeInfoOf(result) {
    if (!result) return null;
    var cp = result.chokePlan || null;
    var cs = result.chokeStat || null;
    return {
      plan: cp ? { count: cp.count, pool: cp.pool, expected: cp.expected, cn: cp.cn || [] } : null,
      marks: result.chokeMarks || null,
      dropped: (result.chokeFallback && result.chokeFallback.dropped) || null,
      pos: (cs && cs.chokePos) || null
    };
  }

  function displayGenerateResult(result) {
    var html = '';
    if (result.valid) {
      html += '<p class="pass">✅ 关卡可解</p>';
    } else {
      html += '<p class="fail">⚠️ 关卡可能不可解</p>';
    }
    html += '<p>步数: ' + result.solveResult.steps + '</p>';
    html += '<p>暂存峰: ' + result.solveResult.maxBuffer + '</p>';
    html += '<p>均暂: ' + result.solveResult.avgBuffer + '</p>';
    if (result.difficulty) {
      var d = result.difficulty;
      html += '<hr style="border-color:#4a3a2c;margin:6px 0">';
      html += '<p><b>难度: ' + d.score + '/100 [' + d.grade + ']</b></p>';
      if (d.obstacleNames) html += '<p style="font-size:10px;color:#888">障碍: ' + d.obstacleNames + ' (' + d.obsTag + ')</p>';
      if (d.parts && d.parts.f1 != null) {
        html += '<p style="font-size:10px;color:#666">';
        // v4：f1/f2 都是【玩家版】原始值。原实现 f1 括号里错标了 omniAvgBuffer（全知暂存），一并纠正。
        html += 'f1玩家均暂:' + d.parts.f1 + '(原' + (d.playerAvgBuffer != null ? d.playerAvgBuffer : '-') + '×65%)';
        html += ' f2玩家滞留:' + d.parts.f2 + '(原' + (d.playerAvgResidence != null ? d.playerAvgResidence : '-') + '×25%)';
        html += ' f3障碍:' + d.parts.f3 + '(×10%)';
        html += ' f4:已停用';
        if (d.playerRevives) html += ' 复活+' + (d.playerRevives * 8);
        html += '</p>';
        html += '<p style="font-size:10px;color:#666">全知对照(不参与评分) 均暂' + d.omniAvgBuffer + ' 滞留' + d.omniAvgResidence
          + ' ｜ 有效操作步' + (d.playerEffectiveTicks || 0) + ' 统计盒数' + (d.playerResidenceCount || 0) + '</p>';
        html += '<p style="font-size:10px;color:' + (d.playerWon ? '#8bc34a' : '#e0592c') + '">玩家版: ' + (d.playerWon ? '✓通关(合格前提)' : '✗未通关(真人打不通=不合格，不出正式排序分)') + '</p>';
      }
      html += buildBufferCurve(d.bufferHistory, result.level.bufferLimit || 5);
    }
    if (result.generationEval) {
      var ge = result.generationEval, op = ge.omni.preview || {}, pp = ge.player.preview || {};
      html += '<hr style="border-color:#4a3a2c;margin:6px 0">';
      html += '<p><b>生成诊断: ' + ge.score + (ge.pass ? ' ✓' : '') + '</b></p>';
      html += '<p style="font-size:10px;color:#666">全知封锁 前/中/后 ' + Math.round((op.earlyAvgLockRatio || 0) * 100) + '%/' + Math.round((op.midAvgLockRatio || 0) * 100) + '%/' + Math.round((op.lateAvgLockRatio || 0) * 100) + '% · 暂存峰 ' + ge.omni.peak + '</p>';
      html += '<p style="font-size:10px;color:#666">玩家封锁 前/中/后 ' + Math.round((pp.earlyAvgLockRatio || 0) * 100) + '%/' + Math.round((pp.midAvgLockRatio || 0) * 100) + '%/' + Math.round((pp.lateAvgLockRatio || 0) * 100) + '% · 暂存峰 ' + ge.player.peak + ' · ' + (ge.player.won ? '通关' : '未通关') + '</p>';
    }
    if (result.retries > 0) html += '<p>重试: ' + result.retries + '次</p>';
    html += '<p>耗时: ' + (result.solveResult.time || 0) + 'ms</p>';
    document.getElementById('solve-result').classList.remove('hidden');
    document.getElementById('solve-details').innerHTML = html;
  }

  /**
   * 构建暂存区压力曲线（柱状图）
   */
  function buildBufferCurve(history, bufferLimit) {
    if (!history || history.length === 0) return '';
    var limit = bufferLimit || 5;
    var html = '<div style="font-size:10px;color:#888;margin:6px 0 3px">暂存压力曲线 (峰值' +
      Math.max.apply(null, history.concat([0])) + '/' + limit + '):</div>';
    html += '<div style="display:flex;align-items:flex-end;gap:1px;height:40px;background:#1e1712;border-radius:3px;padding:2px">';
    // 采样到最多80个点
    var maxShow = 80;
    var step = Math.max(1, Math.floor(history.length / maxShow));
    for (var i = 0; i < history.length; i += step) {
      var v = history[i];
      var h = Math.round((v / limit) * 36);
      // 颜色随压力变化
      var color = v >= limit ? '#e0592c' : (v >= limit * 0.7 ? '#ff9f4d' : (v >= limit * 0.4 ? '#ffcc4d' : '#8bc34a'));
      html += '<div style="flex:1;min-width:1px;height:' + Math.max(1, h) + 'px;background:' + color + '"></div>';
    }
    html += '</div>';
    return html;
  }

  // ==================== 批量生产（生成器页面：实时进度可视化） ====================
  // 日志/进度面板辅助
  function genLog(msg, cls) {
    var el = document.getElementById('gen-log');
    if (!el) return;
    var line = document.createElement('div');
    line.className = 'gen-log-line' + (cls ? ' ' + cls : '');
    var t = new Date();
    var ts = ('0' + t.getHours()).slice(-2) + ':' + ('0' + t.getMinutes()).slice(-2) + ':' + ('0' + t.getSeconds()).slice(-2);
    line.textContent = '[' + ts + '] ' + msg;
    el.appendChild(line);
    el.scrollTop = el.scrollHeight;
  }
  /**
   * 【v326·用户要求】把这一关的生成结果直接显示在目标图上方，不用去翻日志。
   *   显示：判定 / 覆盖率 / 尖峰(≥4 占比) / 玩家通关率 / 峰窗 / 棋盘 / 车数 / 用时。
   *   只在批次跑完一关时刷新；没跑过就保持隐藏。
   */
  /**
   * 【v335·用户要求】导出"关卡制作过程"可视化文件（单文件 HTML，离线可看/可打印）。
   *
   *   内容（就是生成一关的步骤）：
   *     ① 目标图 → 颜色统计（每种颜色多少像素 → 会切成几辆、每辆多大）
   *     ② 棋盘骨骼（尺寸、可用率、障碍：黑块/数字冰/锁链/管道）
   *     ③ 放车（每格色 + 容量）
   *     ④ 压力曲线（全知线逐盒暂存）
   *     ⑤ 判定（覆盖率 / 峰窗 / 玩家通关率 / 合格与否）
   */
  function genExportProcess(rec) {
    if (!rec || !rec.level) { alert('还没有可导出的关卡'); return; }
    var lv = rec.level, b = lv.board, cells = b.cells;
    var ps = rec.persist || {}, ap = rec.appliedParams || {};
    function esc(x) { return String(x == null ? '' : x).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
    function colorOf(id) { return 'hsl(' + ((id * 47) % 360) + ',72%,72%)'; }
    // ① 颜色统计
    var cnt = {}, tot = 0;
    for (var r = 0; r < lv.blocks.length; r++) for (var c = 0; c < lv.blocks[r].length; c++) {
      var v = lv.blocks[r][c]; if (v > 0) { cnt[v] = (cnt[v] || 0) + 1; tot++; }
    }
    // ② 每色切出的车（从棋盘 + 管道统计）
    var byColor = {}, carTotal = 0;
    for (var rr = 0; rr < cells.length; rr++) for (var cc = 0; cc < cells[rr].length; cc++) {
      var ce = cells[rr][cc]; if (!ce) continue;
      if (ce.t === 'box') { (byColor[ce.color] = byColor[ce.color] || []).push(ce.count); carTotal++; }
      else if (ce.t === 'pipe') (ce.queue || []).forEach(function (q) { (byColor[q.color] = byColor[q.color] || []).push(q.count); carTotal++; });
    }
    var colorRows = Object.keys(cnt).sort(function (a, b2) { return cnt[b2] - cnt[a]; }).map(function (id) {
      var arr = (byColor[id] || []).slice().sort(function (x, y) { return y - x; });
      return '<tr><td><span style="display:inline-block;width:14px;height:14px;background:' + colorOf(id) + ';border:1px solid #999;vertical-align:middle"></span> ' + id + '</td>' +
        '<td>' + cnt[id] + '</td><td>' + arr.length + '</td><td>' + (arr.length ? arr.join(', ') : '（未上车）') + '</td></tr>';
    }).join('');
    // 棋盘格
    var obs = { black: 0, ice: 0, chain: 0, pipe: 0 };
    var gridRows = '';
    for (var r2 = 0; r2 < cells.length; r2++) {
      var tds = '';
      for (var c2 = 0; c2 < cells[r2].length; c2++) {
        var e2 = cells[r2][c2] || {};
        var bg = '#fff', txt = '', tip = [];
        if (e2.t === 'box') {
          bg = colorOf(e2.color); txt = e2.count;
          tip.push('色' + e2.color + ' ' + e2.count + '球');
          if (e2.numice > 0) { obs.ice++; txt += '<br><b>❄' + e2.numice + '</b>'; tip.push('冰' + e2.numice); }
          if (e2.chain > 0) { obs.chain++; txt += '<br><b>⛓' + e2.chain + '</b>'; tip.push('链组' + e2.chain); }
          if (e2.q) { txt += '<br><b>?</b>'; tip.push('问号'); }
        } else if (e2.t === 'black') { bg = '#333'; obs.black++; tip.push('墙'); }
        else if (e2.t === 'pipe') { bg = '#cfd8dc'; obs.pipe++; txt = '管' + ((e2.queue || []).length); tip.push('管道 ' + (e2.queue || []).length + ' 球'); }
        else { bg = '#f5f5f5'; }
        tds += '<td title="' + esc(tip.join(' · ')) + '" style="background:' + bg + '">' + txt + '</td>';
      }
      gridRows += '<tr>' + tds + '</tr>';
    }
    // ④ 压力曲线
    var svg = '';
    var smp = rec.pressureSamples || [];
    if (smp.length && rec.totalBoxes) {
      var W = 620, Hh = 120, pad = 6, pts = [], maxB = 1;
      for (var i = 0; i < smp.length; i++) if (smp[i].buf > maxB) maxB = smp[i].buf;
      for (var j = 0; j < smp.length; j++) {
        var px = pad + (smp[j].done / rec.totalBoxes) * (W - pad * 2);
        var py = Hh - pad - (smp[j].buf / Math.max(5, maxB)) * (Hh - pad * 2);
        pts.push(px.toFixed(1) + ',' + py.toFixed(1));
      }
      svg = '<svg width="' + W + '" height="' + Hh + '" style="background:#fff;border:1px solid #ddd">' +
        '<polyline fill="none" stroke="#e08a2b" stroke-width="2" points="' + pts.join(' ') + '"/></svg>';
    }
    var verdict = rec.fallback ? ('兜底·' + (rec.fallbackType || '')) : ((rec.audit && rec.audit.tier) || (rec.valid ? '合格' : '不可解'));
    var html = '<!doctype html><meta charset="utf-8"><title>制作过程 ' + esc(rec.name) + '</title>' +
      '<style>body{font:14px/1.7 -apple-system,"PingFang SC",sans-serif;margin:24px;color:#222}h1{font-size:20px}h2{font-size:16px;margin-top:26px;border-left:4px solid #e08a2b;padding-left:8px}' +
      'table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:4px 8px;font-size:13px}th{background:#f6f6f6}' +
      '#grid td{width:44px;height:38px;text-align:center;font-weight:700;color:#000;font-size:12px}' +
      '.kv{margin:2px 0}.kv b{color:#c96a2b}</style>' +
      '<h1>关卡制作过程 · ' + esc(rec.name) + '</h1>' +
      '<div class="kv">结果：<b>' + esc(verdict) + '</b></div>' +
      '<div class="kv">棋盘：<b>' + b.rows + '×' + b.cols + '</b>　车：<b>' + carTotal + '</b>　容量区间：<b>' + esc(ap.capMin) + '~' + esc(ap.capMax) + '</b></div>' +
      '<div class="kv">覆盖率 <b>' + (ps.band3Pct == null ? '-' : ps.band3Pct + '%') + '</b>　尖峰≥4 <b>' + (ps.band4Pct == null ? '-' : ps.band4Pct + '%') + '</b>　峰窗 <b>' + (rec.audit && rec.audit.midLateMax != null ? rec.audit.midLateMax : '-') + '</b>　玩家 <b>' + (ps.playerPassPct == null ? '-' : ps.playerPassPct + '%') + '</b></div>' +
      '<h2>① 目标图 → 颜色统计（共 ' + tot + ' 像素，' + Object.keys(cnt).length + ' 色）</h2>' +
      '<table><tr><th>颜色</th><th>像素</th><th>切成几辆</th><th>每辆容量（降序）</th></tr>' + colorRows + '</table>' +
      '<h2>② ③ 棋盘与放车（墙 ' + obs.black + ' · 冰 ' + obs.ice + ' · 链 ' + obs.chain + ' · 管道 ' + obs.pipe + '）</h2>' +
      '<div style="color:#888;font-size:12px;margin-bottom:4px">格内数字 = 该车容量；❄ = 数字冰步数；⛓ = 锁链组号；鼠标悬停看明细</div>' +
      '<table id="grid">' + gridRows + '</table>' +
      '<h2>④ 全知线压力曲线（横轴＝进度，纵轴＝暂存）</h2>' + (svg || '<div style="color:#888">（无采样数据）</div>') +
      '<h2>⑤ 判定</h2><div class="kv">' + esc(((rec.goodV3Fails || []).join('、') || '全部通过')) + '</div>' +
      '<hr><div style="color:#999;font-size:12px">由「车接小人」生成器导出 · ' + new Date().toLocaleString() + '</div>';
    var blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '制作过程_' + (rec.name || 'level').replace(/\.txt$/, '') + '.html';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    genLog('已导出制作过程：' + a.download, 'gen-log-ok');
  }

  function genShowResultBanner(rec) {
    var el = document.getElementById('gen-result-banner');
    if (!el || !rec) return;
    var t = rec.audit && rec.audit.tier;
    var pass = !!(rec.valid && !rec.fallback && (t === '合格' || t === '困难合格'));
    var cls = !rec.valid ? 'fallback' : (rec.fallback ? 'fallback' : (pass ? 'ok' : 'bad'));
    var verdict = !rec.valid ? '无关卡' : (rec.fallback ? ('兜底·' + (rec.fallbackType === 'timeout' ? '超时' : '穷尽')) : (pass ? (t || '合格') : '不合格'));
    var ps = rec.persist || {};
    var bs = rec.boardStat || {};
    var cov = ps.band3Pct, spk = ps.band4Pct, ply = ps.playerPassPct;
    var peak = (rec.audit && (rec.audit.midLateMax != null ? rec.audit.midLateMax : rec.audit.lateMax));
    function chip(label, val, warn) {
      return '<span class="grb-chip' + (warn ? ' warn' : '') + '">' + label + ' <b>' + val + '</b></span>';
    }
    var html = '<span class="grb-verdict">' + verdict + '</span>' +
      chip('覆盖', cov == null ? '-' : cov + '%', cov != null && cov < 45) +
      chip('尖峰≥4', spk == null ? '-' : spk + '%', false) +
      chip('玩家', ply == null ? '-' : ply + '%', ply != null && ply < 25) +
      chip('主死因', ps.deathTop ? (ps.deathTop + (ps.deathTopPct != null ? ' ' + ps.deathTopPct + '%' : '')) : '-', false) +
      chip('峰窗', peak == null ? '-' : peak, false) +
      chip('棋盘', bs.rows ? (bs.rows + '×' + bs.cols) : '-', false) +
      chip('车', bs.boardBoxes == null ? '-' : bs.boardBoxes, false) +
      chip('容量', rec.appliedParams ? (rec.appliedParams.capMin + '~' + rec.appliedParams.capMax) : '-', false) +
      chip('难度', rec.difficulty || '-', false) +
      chip('用时', ((rec._elapsedMs || 0) / 1000).toFixed(0) + 's', false);
    var fails = (rec.goodV3Fails || []).join('、');
    if (fails) html += '<span class="grb-note">' + fails + '</span>';
    el.className = 'gen-result-banner ' + cls;
    el.innerHTML = html;
  }

  /**
   * 【v334·用户要求】把"这关生成了哪些候选、每个改了什么、结果如何"列出来。
   *   数据来自 generator 的 trace：每次评估一条（轮次/棋盘/车数/覆盖率/峰值/档次）。
   */
  function genRenderTrace(rec) {
    var sec = document.getElementById('section-trace');
    var list = document.getElementById('trace-list');
    var sum = document.getElementById('trace-summary');
    if (!sec || !list) return;
    var tr = (rec && rec.trace) || [];
    var evals = tr.filter(function (x) { return x && x.t === 'eval'; });
    if (!evals.length) { sec.classList.add('hidden'); return; }
    sec.classList.remove('hidden');
    // 按轮次分组，保持顺序
    var html = '', lastRound = null;
    evals.forEach(function (e, i) {
      var pass = !!e.pass;
      var cls = pass ? 'pass' : 'bad';
      var mix = (tr.filter(function (x) { return x.t === 'round' && x.round === e.round; })[0] || {}).mix || '';
      if (e.round !== lastRound) { lastRound = e.round; }
      html += '<div class="trace-row ' + cls + '">' +
        '<span class="trace-round">轮' + (e.round || 1) + '</span>' +
        '<span class="trace-mix">' + (mix || '-') + '</span>' +
        '<span class="trace-dim">' + (e.rows ? (e.rows + '×' + e.cols) : '-') + '</span>' +
        '<span class="trace-cars">' + (e.cars == null ? '-' : (e.cars + '车')) + (e.hidden ? ('+' + e.hidden + '管') : '') + '</span>' +
        '<span class="trace-cov">覆盖 ' + (e.cov == null ? '-' : e.cov + '%') + '</span>' +
        '<span class="trace-peak">峰 ' + (e.peak == null ? '-' : e.peak) + '</span>' +
        '<span class="trace-tier">' + (pass ? '✅ ' : '✗ ') + (e.tier || '') + '</span>' +
        '</div>';
    });
    list.innerHTML = html;
    if (sum) sum.textContent = '共 ' + evals.length + ' 个候选被精算 · 选中的在最后（绿底=合格）';
  }

  function genUpdateStatChips(results) {
    var hard = 0, easy = 0, fallback = 0, fail = 0;
    results.forEach(function (r) {
      if (!r.valid) { fail++; return; }
      if (r.fallback) { fallback++; return; }
      // v104：档次字样改为「合格 / 简单关·趋势过平」；旧字样一并认，历史批次口径不变
      var _t = r.audit && r.audit.tier;
      if (_t === '合格' || _t === '困难合格') hard++;
      else if (_t === '简单关·趋势过平' || _t === '简单合格') easy++;
    });
    var setTxt = function (id, v) { var el = document.getElementById(id); if (el) el.textContent = v; };
    setTxt('gen-stat-hard', hard); setTxt('gen-stat-easy', easy);
    setTxt('gen-stat-fallback', fallback); setTxt('gen-stat-fail', fail);
  }
  function genUpdateProgressBar(done, total) {
    var pct = total ? Math.round(done / total * 100) : 0;
    var fill = document.getElementById('gen-progress-fill');
    var pctEl = document.getElementById('gen-progress-pct');
    if (fill) fill.style.width = pct + '%';
    if (pctEl) pctEl.textContent = pct + '% (' + done + '/' + total + ')';
  }
  function genUpdateTime(done, total) {
    var el = document.getElementById('gen-progress-time');
    if (!el) return;
    var elapsedMs = Date.now() - genBatchStartAt;
    var elapsedS = Math.round(elapsedMs / 1000);
    var remainTxt = '—';
    if (done > 0 && done < total) {
      var avgPer = elapsedMs / done;
      var remainMs = avgPer * (total - done);
      remainTxt = Math.round(remainMs / 1000) + 's';
    } else if (done >= total) {
      remainTxt = '0s';
    }
    el.textContent = '已用时 ' + elapsedS + 's · 预估剩余 ' + remainTxt;
  }
  // 读取页面 app.js 脚本标签的 ?v= 版本，透传给 worker(及其 importScripts)保证缓存版本一致
  function genScriptVersion() {
    var s = document.querySelector('script[src*="app.js"]');
    var m = s && s.src.match(/[?&]v=([^&]+)/);
    return m ? ('?v=' + m[1]) : '';
  }

  // 停止批量生产：
  //   后台线程模式 → 立即 terminate 当前计算 + 用【已产出结果】收尾(即时停止，不必等当前关跑完)。
  //   主线程模式   → 只置标记，在下一关 produce 之前的边界处生效(当前正在跑的这一关无法中途打断)。
  function stopBatchProduce() {
    if (!genBatchRunning) return;
    genBatchAborted = true;
    // 若有关卡已生成但落库失败、还挂在待重试队列里 → 先提示，别把它们丢掉（已落库的关卡一律保留）
    var pendingN = genPersist.enabled ? Object.keys(genPersist.pendingPayloads).length : 0;
    if (pendingN) {
      genLog('注意：有 ' + pendingN + ' 关已生成但尚未落库成功，停止后仍可点「重试落库」把它们写盘。', 'gen-log-warn');
    }
    if (genPool.length) {
      genFinalizeBatch('已停止（已落库 ' + (genBatch ? genBatch.doneCount : 0) + '/' + (genBatch ? genBatch.total : 0) + ' 关；已落库的关卡全部保留）');
    } else {
      genLog('已请求停止，将在当前关处理完后生效（主线程模式无法中途打断当前关）...', 'gen-log-warn');
    }
  }

  // 从 produce 已返回的压力样本直接算 CSV 压力指标——替代此前每关额外跑 3 遍求解的 pressureMetrics(重复求解=主要慢因)。
  function pmFromSamples(samples, totalBoxes, completed) {
    var N = totalBoxes || 1;
    if (!samples || !samples.length) return { avgAll: 0, avg50: 0, maxWin: 0, completedRate: completed ? 1 : 0, runs: 1 };
    var bufs = samples.map(function (x) { return x.buf; });
    var avgAll = bufs.reduce(function (a, b) { return a + b; }, 0) / bufs.length;
    var s50 = samples.filter(function (x) { return x.done / N >= 0.5; }).map(function (x) { return x.buf; });
    var avg50 = s50.length ? s50.reduce(function (a, b) { return a + b; }, 0) / s50.length : 0;
    var maxWin = 0;
    for (var w = 0.5; w < 0.999; w += 0.1) {
      var ws = samples.filter(function (x) { var pr = x.done / N; return pr >= w && pr < w + 0.1; }).map(function (x) { return x.buf; });
      if (ws.length) { var a = ws.reduce(function (p, q) { return p + q; }, 0) / ws.length; if (a > maxWin) maxWin = a; }
    }
    return { avgAll: +avgAll.toFixed(2), avg50: +avg50.toFixed(2), maxWin: +maxWin.toFixed(2), completedRate: completed ? 1 : 0, runs: 1 };
  }

  // 把一关 produce 结果转为批次记录(rec)：主线程侧的廉价后处理(不再重跑求解)。
  //
  // 【2026-08-24 修复】produce 可能【正常地】返回 level:null —— 例如源图被前置闸门卡掉
  //   （碎色闸门 fragmentGateBlocked、仅底部入口不可达 bottomEntryInfeasible），或候选全部淘汰。
  //   原实现无条件 parseLevel(result.level)，null 时抛 "null is not an object (evaluating 'json.blocks')"，
  //   被 genOnResult 的 catch 转成 genOnError，于是【真实原因被 JS 异常信息盖掉】——
  //   08-13 三个批次里 15/15 记成"不可解"实为此故。这里改为如实返回"无关卡结构"记录并带上原因。
  /**
   * 【v116】棋盘结构实测指标（任务 ANT-GEN-USABLE-REPORT-CHOKE-WINDOW-20260827）。
   * 用户反馈「当前报告内没有可用空间的指标」：设了 `usableSpaceTarget` 却无法从产物核对是否兑现。
   *
   * **一律现场从 `board.cells` 重数**，不直接抄 `spaceQuota.realUsable` —— 那是结构候选阶段算的，
   * 最终 board 可能来自卡点变体或压力重生成；现场数才是这关真正交付出去的样子。
   * 同时把 `spaceQuota` 记录的值一并带出，两者不一致本身就是有价值的信号。
   *
   * 口径与 generator 出口闸门一致：可用空间 = (总格 − 墙 − 管道格) / 总格。
   *
   * @param {object} level  最终关卡（含 board.cells）
   * @param {object} parsed AntSolver.parseLevel 结果（取 totalBoxes）
   * @param {number|null} target 本关实际生效的可用空间目标（优先取采样值；0 或缺省 = 未开启该能力）
   * @returns {object|null}
   */
  function boardStructStat(level, parsed, target) {
    var b = level && level.board;
    if (!b || !b.cells || !b.rows || !b.cols) return null;
    var cap = b.rows * b.cols, black = 0, pipe = 0, box = 0;
    for (var r = 0; r < b.rows; r++) {
      var row = b.cells[r]; if (!row) continue;
      for (var c = 0; c < b.cols; c++) {
        var cell = row[c]; if (!cell) continue;
        if (cell.t === 'black') black++;
        else if (cell.t === 'pipe') pipe++;
        else if (cell.t === 'box') box++;
      }
    }
    var sq = b.spaceQuota || null, ps = b.pipeStat || null;
    var total = parsed && parsed.totalBoxes != null ? parsed.totalBoxes : null;
    // 管道藏盒 = 总盒 − 盘面盒格。管道里的球计入全局进度但玩家看不见 → 进度感偏移的来源。
    var hidden = (total != null) ? Math.max(0, total - box) : null;
    var usable = (cap - black - pipe) / cap;
    var tgt = (typeof target === 'number' && target > 0) ? target : null;   // 0 = 未开启该能力，不是目标值
    return {
      rows: b.rows, cols: b.cols, cells: cap,
      black: black, pipeCells: pipe, boardBoxes: box,
      usable: +usable.toFixed(4),
      blackPct: +(black / cap * 100).toFixed(2),
      // 目标与偏差：未开启该能力时为 null，不写 0 —— 0 是「关闭」的合法取值，混同会分不清
      usableTarget: tgt,
      usableDevPp: tgt != null ? +((usable - tgt) * 100).toFixed(2) : null,
      quotaUsable: (sq && sq.usable != null) ? +sq.usable.toFixed(4) : null,
      quotaBlackTarget: (sq && sq.blackTarget != null) ? sq.blackTarget : null,
      quotaBreachLevel: (sq && sq.breachLevel != null) ? sq.breachLevel : null,
      quotaRealUsable: (sq && sq.realUsable != null) ? +sq.realUsable.toFixed(4) : null,
      pipeWant: (sq && sq.pipeWant != null) ? sq.pipeWant : (ps && ps.want != null ? ps.want : null),
      pipePlaced: (ps && ps.placed != null) ? ps.placed : pipe,
      pipeTier: (ps && ps.fallbackTier) ? ps.fallbackTier : ((ps && ps.noPipeAccepted) ? 'noPipe' : 'normal'),
      pipeCapacityPerPipe: (ps && ps.capacityPerPipe != null) ? ps.capacityPerPipe : null,
      totalBoxes: total, hiddenBoxes: hidden,
      hiddenPct: (hidden != null && total) ? +(hidden / total * 100).toFixed(2) : null
    };
  }

  function genBuildRec(entry, result) {
    if (!result || !result.level) {
      var why = (result && result.lastFailReason) || 'noCandidate';
      var detail = (result && result.structural && result.structural.reason) || '';
      var cn = { fragmentGateBlocked: '碎色超限', bottomEntryInfeasible: '底部入口不可达',
                 boardRangeMismatch: '棋盘范围与车数不匹配',   // 【v137】可读原因：预检判定必然淘汰，附建议行列
                 noCandidate: '候选全灭' };
      return {
        name: entry.name, txt: entry.txt || null, level: null, valid: false,
        gateBlocked: true, gateReason: why, gateReasonCN: cn[why] || why,
        gateDetail: detail,
        fragmentGate: (result && result.fragmentGate) || null,
        bottomEntryFeasibility: (result && result.bottomEntryFeasibility) || null,
        entryMode: (result && result.entryMode) || 'fourSide',
        audit: null, difficulty: 0, grade: '-', fallback: false,
        perf: (result && result.perf) || null
      };
    }
    var parsed = AntSolver.parseLevel(result.level);
    var sr = result.solveResult || {};
    var samples = sr.pressureSamples || [];
    var pm = pmFromSamples(samples, parsed.totalBoxes, !!sr.completed);
    var audit = result.audit || (AntSolver.Analysis ? AntSolver.Analysis.chokepointAudit(samples, parsed.totalBoxes, result.level.bufferLimit) : null);
    // 卡点类型：本关实际抽中了哪几种（ANT-GEN-CHOKE-TYPES-20260824）。
    //   只进生产侧记录，不入关卡本体。用于度量多样性——改动前只能靠结构指纹反推用了什么手段。
    var cp = result.chokePlan || null;
    return {
      name: entry.name, txt: entry.txt || null, level: result.level, valid: result.valid,
      chokeTypes: cp ? cp.types : null, chokeTypesCN: cp ? cp.cn : null,
      chokeCount: cp ? cp.count : 0, isBossSlot: cp ? !!cp.isBoss : false,
      chokeStat: result.chokeStat || null,
      // 【v120】卡点手段的落地位置清单（用户：报告与模拟游玩的关卡信息要显示卡点类型的信息和位置）。
      //   每条 {type,cn,r,c,detail}；detail 里带该类型的实际参数取值（簇大小/半径/端数/叠冰数…）。
      chokeMarks: result.chokeMarks || null,
      // 【v157】卡点判据 v2（用户 R1~R9）指标：{omni, player, worst, gates}。
      //   生产侧记录 + 每关日志 + 批次 CSV 都用它，方便"边生产边看这批关在 v2 口径下长什么样"。
      chokeV2: (result.generationEval && result.generationEval.auditV2) || null,
      // 【v238】每步"能吃满"的曲线（压力的直接来源）：中位/≤1 占比/被迫点。
      //   实测 31 关：合格关 吃满≤1 占 44~81%、中位 1；太松的不合格关 2~21%、中位 3~7。
      fillCurve: (result.goodV3 && result.goodV3.fillCurve) || null,
      // 【v259】全知线压力持久度：{peak, ge3Pct, longest, steps}
      persist: (result.goodV3 && result.goodV3.persist) || null,
      // 【v326】不合格的具体原因（给目标图上方的结果条用）：'30-80覆盖<65%'、'玩家通关率0%<25%' 等
      goodV3Fails: (result.goodV3 && result.goodV3.fails) || null,
      // 【v332】实际生效的生成参数（排查"我填 25~70 怎么没生效"用）：
      //   容量区间、目标车数、棋盘范围、生成流、单轮预算
      trace: result.trace || null,          // 【v334】生成过程轨迹
      // 【v335】导出"制作过程"用：全知压力采样 + 总盒数
      pressureSamples: (result.solveResult && result.solveResult.pressureSamples) || null,
      totalBoxes: parsed.totalBoxes || null,
      appliedParams: result.config ? {
        capMin: result.config.boxSizeMin, capMax: result.config.boxSizeMax,
        capNormMin: result.config.capNormMin, capNormMax: result.config.capNormMax,
        targetCarCount: result.config.targetCarCount,
        rows: result.config.boardRowsMin + '~' + result.config.boardRowsMax,
        cols: result.config.boardColsMin + '~' + result.config.boardColsMax,
        flow: result.config.generatorFlow, budgetMs: result.config.timeBudgetMs
      } : null,
      goodV3Pass: !!(result.goodV3 && result.goodV3.pass),
      // 【v115】卡点类型改「检查次数 × 概率」后，数量本身是随机量，只记 chokeCount 无法判断
      //   「这关只出 1 种」是参数设小了还是抽样波动。这里把设定值(rolls/prob)、实测命中(hits)、
      //   理论期望(expected，含池截断的精确式)与池大小一并记下，供批量实测均值与期望对照。
      chokePlan: cp ? {
        rolls: cp.rolls, prob: cp.prob, hits: cp.hits, expected: cp.expected,
        pool: cp.pool, legacyMode: !!cp.legacyMode
      } : null,
      // 【v115】本关最终采用的那个候选实际采样到的一组区间参数。批次内每个候选各采一组，
      //   不落库就无法回答「这关的冰/黑/链/问号/管道/可用空间到底取了区间里的哪个值」。
      sampledConfig: result.sampledConfig || null,
      // 管道落位与兜底（ANT-GEN-PIPE-DEPTH-FALLBACK-20260825）：want/placed/capacityPerPipe +
      //   fallback/fallbackFrom/fallbackShallow。兜底会让「管道数下限」实际不达标，
      //   不记录就无法回答"这关为什么只有 2 条管道"，也无法统计兜底触发率。
      pipeStat: (result.level && result.level.board && result.level.board.pipeStat) || null,
      // 【v116】棋盘结构实测指标（任务 ANT-GEN-USABLE-REPORT-CHOKE-WINDOW-20260827）。
      //   用户反馈「当前报告内没有可用空间的指标」——设了 usableSpaceTarget 却无法从产物核对是否兑现，
      //   只能事后自己解 JSON 重数格子。这里现场从 cells 数一遍并落库，口径与 generator 出口闸门一致：
      //   可用空间 = (总格 − 墙 − 管道格) / 总格。
      //   同时记管道藏盒数与占比：管道里的球计入全局进度但玩家看不见，是进度感偏移的来源（同轮卡点窗口改动的依据）。
      //   目标值优先取本关实际采样到的 usableSpaceTarget（v115 起可按区间随机，每候选不同），
      //   拿不到才退回 config 里的单值 —— 用错目标会算出错误的偏差。
      boardStat: boardStructStat(result.level, parsed,
        (result.sampledConfig && result.sampledConfig.usableSpaceTarget != null)
          ? result.sampledConfig.usableSpaceTarget
          : (result.config ? result.config.usableSpaceTarget : null)),
      // 【v145】棋盘自适应：本关用的行列是反推来的、还是手填范围兜底来的，随记录带走（只进生产侧记录）
      _autoBoardRange: (result.config && result.config._autoBoardRange) || null,
      _autoPipeClamp: (result.config && result.config._autoPipeClamp) || null,   // 【v149】管道下限被降级的记录
      choiceCurve: result.choiceCurve || null,   // 【v151】选择余地曲线（统计+火花线，进逐关记录）
      boardAutoFallback: (result.boardFit && result.boardFit.autoFallback) || null,
      steps: sr.steps, maxBuffer: sr.maxBuffer, progress: sr.progress,
      difficulty: result.difficulty ? result.difficulty.score : 0,
      grade: result.difficulty ? result.difficulty.grade : '-',
      // 多轮难度标定口径(任务 ANT-DIFF-MULTIROUND-PROD-20260901)：难度分现由 finalizeProduce 多轮取最稳标定。
      //   记下轮数/单轮对照/稳定性，供报告与回溯（不改 CSV 列约定，只是 rec 上的附加对象）。
      difficultyCalibration: (result.difficulty && result.difficulty.calibration) || null,
      difficultySingle: result.difficultySingle ? result.difficultySingle.score : null,
      obstacleNames: result.difficulty ? result.difficulty.obstacleNames : '',
      pm: pm, audit: audit,
      // 目标图入口模式(ANT-GEN-BOTTOM-ONLY-20260729)：'fourSide'|'bottomOnly'，由生成器在 produce 出口标记。
      // 只记录在生产侧记录里（CSV/关卡数据.json/报告），关卡本体不含该字段。
      entryMode: result.entryMode || 'fourSide',
      // 兜底标记(v86)：fallback=true 表示这关不是正常合格输出，是"最接近标准/安全垫底"的兜底交付。
      fallback: !!result.fallback,
      fallbackTier: result.fallbackTier != null ? result.fallbackTier : null,
      fallbackType: result.fallbackType || null,
      fallbackReason: result.fallbackReason || null,
      generationEval: result.generationEval || null,
      solve: {
        completed: !!sr.completed, retryRound: sr.retryRound || 0, steps: sr.steps,
        maxBuffer: sr.maxBuffer, avgBuffer: sr.avgBuffer, progress: sr.progress,
        completedBoxes: sr.completedBoxes, totalBoxes: sr.totalBoxes, itemUses: sr.itemUses || 0,
        pickOrder: sr.pickOrder || [], stepStats: sr.stepStats || [], stepBufferHistory: sr.stepBufferHistory || [], pressureSamples: samples
      }
    };
  }

  // ==================== 逐关落库（本地生产服务） ====================
  // 正式生产链路：Worker 返回一关 → 主线程转落库数据 → POST 本地服务 → 服务原子写盘 → 回 persisted=true
  //   → 主线程才标记"已落库"并派发下一关。写盘失败则暂停派发并允许重试，绝不静默跳过。

  // 落库请求：单关生产可能耗时数分钟，期间连接空闲；若恰好撞上连接被回收，第一次发送会以网络错误失败。
  //   这里对【网络层失败】自动重试一次（服务端按 batchId+inputIndex 幂等，重发不会重复写）；仍失败才交给上层暂停+人工重试。
  function genApi(pathname, body) {
    var payload = JSON.stringify(body || {});
    // 【v153 修复「批量一直转、已处理 0」】原实现没有超时：服务没响应时 fetch 永远不 settle，
    //   落库回调既不成功也不失败 → 该槽位永远停在这一关，界面只有"处理中"，看不出任何错误。
    //   现在：15 秒超时 → 判定失败（上层降级为内存模式继续生产）。
    var TIMEOUT_MS = 15000;
    function once() {
      var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var timer = ctl ? setTimeout(function () { try { ctl.abort(); } catch (e) {} }, TIMEOUT_MS) : null;
      return fetch(pathname, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload,
                               signal: ctl ? ctl.signal : undefined })
        .then(function (r) { if (timer) clearTimeout(timer); return r.json().catch(function () { return { ok: false, error: 'HTTP ' + r.status }; }); },
              function (err) { if (timer) clearTimeout(timer); return { ok: false, error: String((err && err.message) || err) }; });
    }
    return once().then(function (r) { return (r && r.ok) ? r : once(); });   // 失败重试一次（服务端按 batchId+inputIndex 幂等）
  }

  // 探测本地生产服务是否可用（file:// 或未起服务时会失败 → 回退旧模式）
  function genPersistProbe() {
    if (location.protocol === 'file:') return Promise.resolve(false);
    return fetch('/api/production/ping').then(function (r) { return r.json(); })
      .then(function (j) { return !!(j && j.ok && j.service === 'ant-production'); })
      .catch(function () { return false; });
  }

  // 组装落库记录：程序端干净关卡 + 源图 + 审核/难度/性能 + 完整内部数据(调试)
  function genPersistPayload(entry, rec, result) {
    var parsed = null, gameLevel = null;
    try { parsed = AntSolver.parseLevel(rec.level); gameLevel = AntSolver.toGameFormat(parsed); } catch (e) { gameLevel = null; }
    var ge = rec.generationEval || {};
    var omniWon = !!(rec.solve && rec.solve.completed);
    var playerWon = !!(ge.player && ge.player.won);
    var pm = rec.pm || {};
    return {
      name: entry.name, txt: entry.txt || null,
      valid: !!rec.valid, omniWon: omniWon, playerWon: playerWon,
      audit: rec.audit || null,
      entryMode: rec.entryMode || 'fourSide',   // 目标图入口模式（落库记录用；关卡本体不含）
      // 卡点类型记录（ANT-GEN-CHOKE-TYPES-20260824）：供统计多样性与后续排序按 BOSS 规格放位
      chokeTypes: rec.chokeTypes || null, chokeTypesCN: rec.chokeTypesCN || null,
      chokeCount: rec.chokeCount || 0, isBossSlot: !!rec.isBossSlot, chokeStat: rec.chokeStat || null,
      chokeMarks: rec.chokeMarks || null,   // v120 卡点位置清单
      // v115：卡点概率机制的设定/实测/期望 + 本关候选采样到的区间参数（服务端落 JSONL 与 CSV）
      chokePlan: rec.chokePlan || null, sampledConfig: rec.sampledConfig || null,
      choiceCurve: rec.choiceCurve || null,   // 【v151】选择余地曲线
      chokeV2: rec.chokeV2 || null,           // 【v157】卡点判据 v2（R1~R9）：独木桥/预算判断点/无满解/高压位置
      // v116：棋盘结构实测（可用空间/墙/管道/藏盒）—— 用户要的「报告里的可用空间指标」
      boardStat: rec.boardStat || null,
      difficulty: rec.difficulty, grade: rec.grade, obstacleNames: rec.obstacleNames,
      maxBuffer: rec.maxBuffer, totalBoxes: parsed ? parsed.totalBoxes : null,
      size: parsed ? (parsed.rows + 'x' + parsed.cols) : '',
      boardSize: (rec.level && rec.level.board) ? (rec.level.board.rows + 'x' + rec.level.board.cols) : '',
      avgAll: pm.avgAll, avg50: pm.avg50, maxWin: pm.maxWin,
      fallback: !!rec.fallback, fallbackTier: rec.fallbackTier, fallbackType: rec.fallbackType, fallbackReason: rec.fallbackReason,
      perf: (result && result.perf) || null,
      elapsedMs: rec._elapsedMs != null ? rec._elapsedMs : null,
      finishedAt: new Date().toISOString(),
      gameLevel: gameLevel,
      // 完整内部数据（等价于旧 关卡数据.json 的字段完整性，服务写进 生产文档/关卡数据/）
      debugData: {
        name: entry.name, valid: !!rec.valid, difficulty: rec.difficulty, grade: rec.grade,
        // 多轮难度标定口径(任务 ANT-DIFF-MULTIROUND-PROD-20260901)：轮数/单轮对照/稳定性
        difficultyCalibration: rec.difficultyCalibration || null, difficultySingle: rec.difficultySingle != null ? rec.difficultySingle : null,
        entryMode: rec.entryMode || 'fourSide',
        bufferLimit: rec.level ? rec.level.bufferLimit : null,
        blocks: rec.level ? rec.level.blocks : null, board: rec.level ? rec.level.board : null,
        audit: rec.audit || null, generationEval: rec.generationEval || null, solve: rec.solve || null,
        chokeV2: rec.chokeV2 || null,   // 【v157】卡点判据 v2（R1~R9）明细（无损数据里，单关级复查用）
        fallback: !!rec.fallback, fallbackTier: rec.fallbackTier, fallbackType: rec.fallbackType, fallbackReason: rec.fallbackReason,
        // v115：完整内部数据里同样保留采样值与卡点计划，便于单关级复查（不只看汇总 CSV）
        sampledConfig: rec.sampledConfig || null, chokePlan: rec.chokePlan || null,
        boardStat: rec.boardStat || null,   // v116 棋盘结构实测
        chokeTypes: rec.chokeTypes || null, chokeTypesCN: rec.chokeTypesCN || null,
        chokeStat: rec.chokeStat || null, chokeMarks: rec.chokeMarks || null,   // v120 卡点位置与逐类落地
        perf: (result && result.perf) || null
      }
    };
  }

  // 只保留结果表需要的轻量摘要（阶段4：完整 board/solve/pickOrder/pressureSamples 落库后即释放）
  function genLightSummary(rec, paths) {
    return {
      name: rec.name, valid: !!rec.valid,
      audit: rec.audit ? { tier: rec.audit.tier, pass: rec.audit.pass, easyPass: rec.audit.easyPass,
        usable: rec.audit.usable, easyQuota: rec.audit.easyQuota, hasChoke: rec.audit.hasChoke } : null,
      difficulty: rec.difficulty, grade: rec.grade,
      fallback: !!rec.fallback, fallbackType: rec.fallbackType,
      elapsedMs: rec._elapsedMs || null, outPath: (paths && (paths.level || paths.txt)) || '', persisted: true
    };
  }

  function genPersistStatusEl(text, cls) {
    var el = document.getElementById('gen-persist-status');
    if (el) { el.textContent = text; el.className = 'gen-persist-status' + (cls ? (' ' + cls) : ''); }
  }

  // 落库一关（结果或异常），成功后调 next() 继续；失败则暂停并显示重试
  function genPersistOne(kind, inputIndex, payload, next) {
    var body = { batchId: genPersist.batchId, batchToken: genPersist.batchToken, inputIndex: inputIndex, record: payload };
    // 按下标登记待重试：并发下可能同时有多关落库失败，单槽会互相覆盖、把先失败那关永久丢掉。
    genPersist.pendingPayloads[inputIndex] = { kind: kind, inputIndex: inputIndex, payload: payload, next: next };
    genApi('/api/production/' + (kind === 'error' ? 'error' : 'result'), body)
      .then(function (j) {
        if (!j || !j.ok || j.persisted !== true) throw new Error((j && j.error) || '服务未确认写盘');
        delete genPersist.pendingPayloads[inputIndex];
        genPersist.failed = Object.keys(genPersist.pendingPayloads).length > 0;
        genPersist.persistedCount++;
        var retryBtn = document.getElementById('btn-gen-persist-retry');
        if (retryBtn && !genPersist.failed) retryBtn.classList.add('hidden');
        genPersistStatusEl('已落库 ' + genPersist.persistedCount + ' 关 → ' + genPersist.relDir, 'ok');
        // 把这一关的轻量摘要替换进结果数组（释放完整数据引用）。
        // 必须按 _idx 精确匹配：并发下多关同时挂着 _full，原先「从尾部找第一个 _full」会把
        // 本关的输出路径写到另一关的记录上，且本关的完整数据永远不被释放。
        for (var i = 0; i < genBatchResults.length; i++) {
          var r = genBatchResults[i];
          if (r && r._full && r._idx === inputIndex) { genBatchResults[i] = genLightSummary(r, j.paths); break; }
        }
        if (typeof next === 'function') next();
      })
      .catch(function (e) {
        genPersist.failed = true;
        genLog('第 ' + (inputIndex + 1) + ' 关「' + (payload && payload.name) + '」落库失败：' + e.message +
          '　该关已挂入待重试队列（共 ' + Object.keys(genPersist.pendingPayloads).length + ' 关待重试），修好后点「重试落库」。', 'gen-log-err');
        genPersistStatusEl('落库失败 ' + Object.keys(genPersist.pendingPayloads).length + ' 关：' + e.message, 'err');
        var retryBtn = document.getElementById('btn-gen-persist-retry');
        if (retryBtn) retryBtn.classList.remove('hidden');
        // 【v153】落库服务不可用（超时/断线）时**不把整批停死**：降级为内存模式继续生产，
        //   结果照常出在结果表里、可「带入棋盘」，收尾给 ZIP 下载；待服务恢复后点「重试落库」补写。
        genPersist.enabled = false;
        genLog('⚠ 落库服务不可用 → 已切换为「内存模式」继续生产（结果仍在结果表里、可带入棋盘；服务恢复后点「重试落库」补写，或最后下载 ZIP）。', 'gen-log-warn');
        if (typeof next === 'function') next();
      });
  }

  // 「重试落库」按钮：把待重试队列里【全部】关卡重发一遍（服务端按 batchId+inputIndex 幂等，不会重复写）
  function genRetryPersist() {
    var keys = Object.keys(genPersist.pendingPayloads);
    if (!keys.length) { genPersistStatusEl('没有待重试的落库请求', ''); return; }
    genLog('重试落库：共 ' + keys.length + ' 关', 'gen-log-warn');
    genPersistStatusEl('正在重试落库（' + keys.length + ' 关）…', '');
    keys.forEach(function (k) {
      var p = genPersist.pendingPayloads[k];
      if (p) genPersistOne(p.kind, p.inputIndex, p.payload, p.next);
    });
  }

  function genOnResult(entry, result, inputIndex, next) {
    var rec;
    try { rec = genBuildRec(entry, result); }
    catch (e) { genOnError(entry, e.message, inputIndex, next); return; }
    // 前置闸门卡掉的源图：没有关卡结构，走"跳过"路径如实落库原因，不当成异常、也不造假关。
    if (rec.gateBlocked) {
      var ms = Date.now() - (genInFlightT0[inputIndex] || Date.now());
      rec._idx = inputIndex; rec._elapsedMs = ms;
      genBatchResults.push(rec); genResultHistory.push(rec);   // 【v153】同一条记录也进跨批次历史（展示用）
      genRenderResultsLive();
      genLog(entry.name + '  ' + (ms / 1000).toFixed(1) + 's  已跳过·' + rec.gateReasonCN +
        (rec.gateDetail ? ('（' + rec.gateDetail + '）') : ''), 'gen-log-warn');
      if (genPersist.enabled) {
        genPersistOne('error', inputIndex, {
          name: rec.name, txt: entry.txt || null, valid: false, omniWon: false, playerWon: false,
          audit: null, gameLevel: null, debugData: null,
          status: 'GATE_SKIPPED', gateReason: rec.gateReason, gateReasonCN: rec.gateReasonCN,
          error: rec.gateReasonCN + '：' + rec.gateDetail,
          fragmentGate: rec.fragmentGate, entryMode: rec.entryMode,
          elapsedMs: ms, finishedAt: new Date().toISOString()
        }, next);
      } else if (typeof next === 'function') next();
      return;
    }
    rec._full = true;
    rec._idx = inputIndex;             // 并发下必须带下标：落库回调要靠它精确定位本关记录（原先按「最后一个 _full」找会错行）
    // 耗时按【本关自己的派发时刻】算。原先用全局 genBatch.itemT0，并发下会被后派发的关覆写 → 所有关耗时全错。
    rec._elapsedMs = Date.now() - (genInFlightT0[inputIndex] || Date.now());
    genBatchResults.push(rec); genResultHistory.push(rec);   // 【v153】同记录进跨批次历史
    genRenderResultsLive();
    genMaybeAutoMap(rec);
    var dt = (rec._elapsedMs / 1000).toFixed(1);
    var tierTxt = rec.fallback ? ('兜底·' + (rec.fallbackType === 'timeout' ? '超时' : '穷尽')) : ((rec.audit && rec.audit.tier) || (rec.valid ? '合格' : '不可解'));
    // 【v151】"选择余地"曲线（用户 2026-10-15 定的核心指标）：每步有几个"能吃满"的选项。
    //   ≥3 有得选 / ≤1 只能按既定路线走。这是判断"有没有灵气"的唯一判据，黑块/冰/链都只是工具。
    var curveTxt = '';
    if (rec.choiceCurve) {
      var c2 = rec.choiceCurve;
      curveTxt = '　选择余地 开局' + c2.opening + ' 中位' + c2.medFull +
        (rec.fragmentWarn ? (' ⚠ 碎色 ' + (rec.fragmentWarn.match(/碎色率[^，]*/) || [''])[0] + '（已放行：碎色=压力素材）') : '') +
        ' ≤1占' + c2.lowPct + '% ' + (c2.forcedMid > 0
          ? ('卡点 ' + c2.forcedMid + ' 处@30~80%')
          : ('⚠ 30~80% 无卡点（全长 ' + c2.forcedN + ' 处被迫点）')) +
        (typeof AntSolver.Generator.choiceCurveScore === 'function' ? (' 分' + Math.round(AntSolver.Generator.choiceCurveScore(c2))) : '');
    }
    // 【v147】空转比（取盒后暂存没降的步数占比）—— 批量时横向比较"压力是从哪来的"
    var idleTxt = '';
    if (rec.solve && rec.solve.stepStats && rec.solve.stepStats.length) {
      var ss = rec.solve.stepStats, up = 0;
      for (var si = 0; si < ss.length; si++) if ((ss[si].bufAfter || 0) > (ss[si].bufBefore || 0)) up++;
      idleTxt = '　空转 ' + Math.round(up / ss.length * 100) + '%';
    }
    genLog(entry.name + '  ' + dt + 's  ' + tierTxt + (rec.valid ? ('  难度' + rec.difficulty + '[' + rec.grade + ']') : '') + idleTxt,
      rec.fallback ? 'gen-log-warn' : (rec.audit && (rec.audit.tier === '合格' || rec.audit.tier === '困难合格') ? 'gen-log-ok' : ''));
    // 【v157】卡点判据 v2 一行（用户 R1~R9）：独木桥 / 预算判断点 / 无满解 / 70%前≥4，全知线与玩家线都报，
    //   判定按"取最差"。用户要"边生产边看数据是否符合预期"，所以这里直接打在日志里，不用另外导表。
    if (rec.chokeV2) {
      var v2w = rec.chokeV2.worst, v2o = rec.chokeV2.omni, v2p = rec.chokeV2.player;
      var v2vio = AntSolver.Generator.chokeV2Violations ? AntSolver.Generator.chokeV2Violations(v2w) : [];
      genLog('　　卡点v2　独木桥 ' + (v2o ? v2o.bridges : '-') + '/' + (v2p ? v2p.bridges : '-') +
        '（最差 ' + v2w.bridges + '）· 预算判断点 ' + (v2o ? v2o.r9 : '-') + '/' + (v2p ? v2p.r9 : '-') +
        '（最差 ' + v2w.r9 + '）· 无满解 ' + (v2o ? v2o.noGood : '-') + '/' + (v2p ? v2p.noGood : '-') +
        '（最差 ' + v2w.noGood + '）· 前期限压 ' + (v2o ? v2o.early34Pct + '%' : '-') + '/' + (v2p ? v2p.early34Pct + '%' : '-') +
        '（最差 ' + v2w.early34Pct + '%）· 70%前≥4 ' + v2w.hiBefore70Pct + '%　' +
        (v2vio.length ? ('⚠ ' + v2vio.join('、')) : '✓ 达标'),
        v2vio.length ? 'gen-log-warn' : 'gen-log-ok');
    }
    genLogGreedyLine(rec.level);   // 【v176】第三条线「贪心玩家」一行
    genLogPlayBatch(rec.level);    // 【v177】同一关玩 16 遍：波动区间 + 结束位置分布
    window.__lastGenRec = rec;     // 【v335】给"导出制作过程"按钮用
    genShowResultBanner(rec);      // 【v326】把结果直接显示到目标图上方
    genRenderTrace(rec);           // 【v334】生成过程列表
    genLogGoodV3(result);          // 【v184】好关判据 v3（六条全过？）
    if (result.portfolio) genLog('　　一图多产　试了 ' + result.portfolio.tried + ' 次（全过 ' + result.portfolio.passes + ' 次，取最优）', 'gen-log-ok');
    // 【v320·用户裁决】把搜索规模打在日志里：「候选 6」只是其中一层，真正要看的是造了多少盘、精算了几个。
    if (result && result.perf) {
      var _pf = result.perf;
      var _made = (_pf.generateCalls || 0) + (_pf.chokeVariants || 0) + (_pf.regenVariants || 0);
      genLog('　　搜索规模　造盘 ' + _made + ' 个（基础 ' + (_pf.generateCalls || 0) + ' + 卡点变体 ' + (_pf.chokeVariants || 0) + '）· 精算 ' +
        (_pf.evalCalls || 0) + ' 个 · 求解 ' + ((_pf.solver && _pf.solver.solveCalls) || 0) + ' 次 · 用 ' +
        ((_pf.totalMs ? _pf.totalMs / 1000 : 0).toFixed(0)) + 's' + (_pf.stopReason === 'budget_timeout' ? '（预算到点）' : ''), 'gen-log-ok');
    }
    if (curveTxt) {
      var c3 = rec.choiceCurve;
      genLog('　　' + c3.spark + curveTxt, (c3.lowPct >= 35 || c3.medFull <= 2) ? 'gen-log-warn' : 'gen-log-ok');
    }
    // 【v137】棋盘范围偏大/偏小的提醒（没到"必然淘汰"那一档，所以照常跑，只是先让你看见）。
    // 命中"必然淘汰"的那一档走上面 gateBlocked 分支，直接给可读原因 + 建议行列。
    if (result && result.boardFit && result.boardFit.warn) {
      genLog('⚠ ' + entry.name + '  ' + result.boardFit.warn, 'gen-log-warn');
    }
    // 【v145】棋盘自适应：把"反推出来的棋盘"和"手填范围装不下、已自动兜底"如实摊开，
    //   免得又变成"结果不对但看不出为什么"。
    if (rec._autoBoardRange) {
      var ab = rec._autoBoardRange.range;
      genLog('棋盘自适应：切出约 ' + rec._autoBoardRange.cars + ' 辆车 → 行列取 ' +
        ab.rowsMin + '~' + ab.rowsMax + ' × ' + ab.colsMin + '~' + ab.colsMax +
        '（' + ab.cells + ' 格，含管道可带走 ' + ab.pipeCap + ' 辆）', 'gen-log-ok');
    }
    // 【v153】源图体检：开局暴露颜色数 —— "这张图能不能出有选择的关"的第一判据（源图属性，不是参数问题）。
    //   只在小到"开局几乎没得选"时才报成警告色，其余按正常信息显示，避免天天报警没人看。
    if (result && result.boardFit && result.boardFit.openingExposure) {
      var oe = result.boardFit.openingExposure;
      var oeTxt = '开局可选性：这张图开局只暴露 ' + oe.exposedColors + '/' + oe.totalColors +
        ' 种颜色' + (oe.top ? ('（最多 ' + oe.top.color + ' 号色 ' + oe.top.px + ' 像素）') : '') +
        (oe.exposedColors <= 2 ? ' → 前段几乎没得选，属源图剪影问题，调参改不了' : ' → 开局有分支');
      genLog(oeTxt, oe.exposedColors <= 2 ? 'gen-log-warn' : 'gen-log-ok');
    }
    // 【v149】管道下限被自动降级时如实说出来（否则用户会以为"我明明设了 4 条"）
    if (rec._autoPipeClamp) {
      var pc = rec._autoPipeClamp;
      genLog('管道下限自适应：这张图只切出 ' + pc.cars + ' 辆车，撑不起 ' + pc.from +
        ' 条管道（每条至少要 ' + pc.fill + ' 个盒）→ 已自动降到 ' + pc.to + ' 条' +
        (pc.to === 0 ? '（改为不放管道）' : '，不再整关淘汰'), 'gen-log-warn');
    }
    if (result && result.boardFit && result.boardFit.autoFallback) {
      var af = result.boardFit.autoFallback;
      genLog('⚠ ' + entry.name + '  手填的棋盘范围（' + af.from.rowsMin + '×' + af.from.colsMin +
        ' 起）装不下这把切出的 ' + (af.carsMed || af.cars) + ' 辆车，已自动换成 ' +
        af.to.rowsMin + '×' + af.to.colsMin + ' 起（不再整关淘汰）', 'gen-log-warn');
    }
    if (genPersist.enabled) {
      genPersistOne('result', inputIndex, genPersistPayload(entry, rec, result), next);
    } else if (typeof next === 'function') next();
  }

  /**
   * 【v144】生成后自动映射到中间的棋盘区（用户 2026-10-15：「生成一个关卡之后，
   * 能直接映射到中间的棋盘区」）。开关 = 生成器面板里的「生成后自动映射到棋盘」（默认勾上）。
   *   只在【生成器模式】下生效：此时右栏是生成器，中间棋盘空着，正好一边生产一边看盘面。
   *   不进模拟态 —— 要玩就点结果行末尾的「🎮 带入棋盘」。
   */
  function genMaybeAutoMap(rec) {
    if (simulating || editMode || !rec || !rec.level) return;   // 模拟/摆盒时不抢棋盘
    var chk = document.getElementById('gen-auto-map');
    if (chk && !chk.checked) return;
    try {
      if (genMapToBoard(rec, false)) {
        genLog('已映射到棋盘：' + rec.name + (rec.valid ? '' : '（未合格，仅结构预览）'), 'gen-log-ok');
      }
    } catch (e) { genLog('映射到棋盘失败：' + ((e && e.message) || e), 'gen-log-warn'); }
  }

  function genOnError(entry, msg, inputIndex, next) {
    var rec = { name: entry ? entry.name : '(未知)', valid: false, audit: null, difficulty: 0, grade: '-', fallback: false, error: msg, _idx: inputIndex };
    genBatchResults.push(rec); genResultHistory.push(rec);   // 【v153】同记录进跨批次历史
    genRenderResultsLive();
    genLog(rec.name + '  异常: ' + msg, 'gen-log-err');
    if (genPersist.enabled) {
      // 无关卡结构：服务只存源图 + 失败记录，绝不生成假关卡 JSON
      genPersistOne('error', inputIndex, {
        name: rec.name, txt: (entry && entry.txt) || null, valid: false, omniWon: false, playerWon: false,
        audit: null, gameLevel: null, debugData: null, error: msg,
        status: /超时未返回/.test(msg || '') ? 'WATCHDOG_TIMEOUT' : 'ERROR',
        finishedAt: new Date().toISOString()
      }, next);
    } else if (typeof next === 'function') next();
  }

  // 收尾(可被停止/完成/回退多路径触发，用 genBatchRunning 保证只收尾一次——避免重复打包下载)
  function genFinalizeBatch(reason) {
    if (genPoolProgressTimer) { clearInterval(genPoolProgressTimer); genPoolProgressTimer = null; }
    if (!genBatchRunning) return;
    genBatchRunning = false;
    // 收尾/停止：逐槽清看门狗、递增代次作废迟到消息、终止线程。池化后这三件事必须对每个槽都做一遍。
    genPool.forEach(function (s) {
      clearTimeout(s.watchdog);
      s.epoch++;
      if (s.w) { try { s.w.terminate(); } catch (e) {} s.w = null; }
    });
    genPool = []; genPoolReadyCount = 0;
    var startBtn = document.getElementById('btn-gen-start');
    var stopBtn = document.getElementById('btn-gen-stop');
    if (startBtn) startBtn.disabled = false;
    if (stopBtn) stopBtn.classList.add('hidden');
    if (reason) genLog(reason, 'gen-log-warn'); else genLog('全部处理完毕，收尾打包中...');
    finishBatch(genBatchResults);
  }

  function batchProduce() {
    if (levelList.length === 0) {
      alert('请先导入TXT图文件（支持多选）');
      document.getElementById('txt-input').click();
      return;
    }
    if (genBatchRunning) return;

    var config = getGenConfig();
    // 【v153】切球规划器：哪几张图勾了「使用这份车单」，就把规划车单作为该关的切法（forcedBoxes 直通），
    //   并临时关闭碎色闸门——规划内的碎色是「背债车」的压力素材，不是缺陷（用户 2026-10-15 模型）。
    var cutUseChecked = !!(document.getElementById('cutplan-use') || {}).checked;
    var planIdx = {};
    if (cutPlanParams && cutUseChecked) for (var pi = 0; pi < levelList.length; pi++) planIdx[pi] = true;
    var progressCard = document.getElementById('gen-progress-card');
    var resultCard = document.getElementById('gen-result-card');
    if (progressCard) progressCard.classList.remove('hidden');
    if (resultCard) resultCard.classList.add('hidden');
    // 新批开始：清掉上一批打包好的待下载关卡包 + 隐藏下载按钮
    genPendingZip = null;
    var dlBtn0 = document.getElementById('btn-gen-download');
    if (dlBtn0) dlBtn0.classList.add('hidden');
    var hint0 = document.getElementById('gen-download-hint');
    if (hint0) hint0.textContent = '';
    var logEl = document.getElementById('gen-log');
    if (logEl) logEl.innerHTML = '';
    // 【v153】切球规划器提示（放在日志清空之后，保证可见）
    if (cutPlanParams && cutUseChecked) genLog('切球规划器：本批 ' + levelList.length + ' 张图按规划车单切球（碎色闸门临时关闭）', 'gen-log-ok');
    genUpdateStatChips([]);
    genUpdateProgressBar(0, levelList.length);

    var startBtn = document.getElementById('btn-gen-start');
    var stopBtn = document.getElementById('btn-gen-stop');
    if (startBtn) startBtn.disabled = true;
    if (stopBtn) stopBtn.classList.remove('hidden');

    genBatchRunning = true; genBatchAborted = false; genBatchStartAt = Date.now();
    // 【v308】进度行每秒刷新一次，让"（12s）"真的在走
    if (genPoolProgressTimer) clearInterval(genPoolProgressTimer);
    genPoolProgressTimer = setInterval(function () {
      try { genPoolProgressText(); } catch (e) {}
    }, 1000);
    genBatchResults = [];
    genResultHistory.push({ __batch: true, label: '批次 ' + (genBatch && genBatch.dirName ? genBatch.dirName : '') + ' · ' +
      new Date().toLocaleTimeString('zh-CN', { hour12: false }) + ' · ' + levelList.length + ' 张图' });

    // 按【简单关比例】把本批次里的部分关卡预先标记为"简单关名额"(requireHardPass=false)/其余"困难关名额"，
    // 用等间距分布(Bresenham 式)让名额均匀撒在整批里。比例由 UI「简单关比例(%)」控制，默认30%。
    var easyRatio = (config.easyRatioPercent != null ? config.easyRatioPercent : 30) / 100;
    var easySlot = [];
    (function () {
      var total = levelList.length, acc = 0;
      for (var i = 0; i < total; i++) { acc += easyRatio; if (acc >= 1) { easySlot[i] = true; acc -= 1; } else easySlot[i] = false; }
    })();
    // ===== BOSS 名额（ANT-GEN-CHOKE-TYPES-20260824，用户 2026-08-24 要求③）=====
    // produce 是单关函数、不知道自己在批次里的位置，故 BOSS 规格必须由调度层逐关透传。
    // ⚠ 语义前提：上线批的 BOSS 是【排序阶段】按"逢5"贴的标签，生产阶段本无 BOSS 概念。
    //   这里按 bossInterval 预先指定一批"按 BOSS 规格生产"，并把标记写进逐关记录与索引；
    //   **生产顺序 ≠ 最终上线顺序**，排序阶段若不按该标记放位，BOSS 配额就落不到 5 的倍数位上。
    var bossInterval = parseInt((document.getElementById('gen-boss-interval') || {}).value, 10);
    if (isNaN(bossInterval) || bossInterval <= 0) bossInterval = 0;
    var bossSlot = [];
    for (var bi = 0; bi < levelList.length; bi++) {
      bossSlot[bi] = bossInterval > 0 ? ((bi + 1) % bossInterval === 0) : false;
    }
    var bossCount = bossSlot.filter(function (x) { return x; }).length;
    if (bossInterval > 0) {
      genLog('难关名额：每 ' + bossInterval + " 关一个，共 " + bossCount + ' 关按难关规格生产（卡点类型数 ' +
        (config.chokeTypeCountBoss || 0) + ' vs 普通 ' + (config.chokeTypeCountNormal || 0) + '）。' +
        '注意：生产顺序≠上线顺序，排序时需按记录里的 isBossSlot 放到逢5位。', 'gen-log-warn');
    }
    // 并发线程数：UI 可配。默认 6（本机 10 核，留余量给主线程、本地生产服务与系统）。
    //   设 1 → 与改多线程之前的串行行为完全等价，便于对照与回退。
    //   刻意不允许超过 hardwareConcurrency：超订会让各关在同样的墙上预算内算得更少 →
    //   budget_timeout 与兜底关变多，是质量回退（单关预算是墙上时间，不是 CPU 时间）。
    var hw = (navigator.hardwareConcurrency || 8);
    var poolInput = parseInt((document.getElementById('gen-pool-size') || {}).value, 10);
    // 【v311·用户疑问】"只有一张图，为什么写并发 1/6"：
    //   原来线程池按 CPU 核数开（默认 6），不看到底有几张图 → 1 张图也开 6 个线程，5 个空转。
    //   现在按「图数」收窄：线程数 = min(设定, 核数, 图数)。
    genPoolSize = Math.max(1, Math.min(isNaN(poolInput) ? 6 : poolInput, hw, levelList.length));
    genInFlightT0 = {};
    genBatch = {
      config: config, easySlot: easySlot, bossSlot: bossSlot, bossInterval: bossInterval,
      nextIdx: 0,            // 下一个待派发的输入下标（取代原来的单游标 idx）
      doneCount: 0,          // 已结算（落库完成/失败跳过）的关数——并发下进度只能按这个算
      retryQueue: [],        // 因线程死亡而需要另一个槽重跑的下标，优先于 nextIdx
      total: levelList.length
    };
    genLog('开始批量生产，共 ' + levelList.length + ' 张源图，并发 ' + genPoolSize + ' 线程' +
      (genPoolSize < (isNaN(poolInput) ? 6 : poolInput) ? '（已按本机 ' + hw + ' 核上限收窄）' : '') + '。');

    // 先探测本地生产服务：可用 → 开批次(逐关落库，正式路径)；不可用 → 回退旧内存+ZIP模式并明确告知
    genPersist = { enabled: false, batchId: null, batchToken: null, relDir: '', dirName: '', persistedCount: 0, pendingPayloads: {}, failed: false };
    genPersistProbe().then(function (ok) {
      if (!ok) {
        genPersistStatusEl('未连接本地生产服务：本批用旧的内存模式，完成后需手动点「下载关卡包」保存（有崩溃丢失风险）', 'warn');
        genLog('未检测到本地生产服务，本批回退为「内存 + 手动下载ZIP」旧模式。要逐关自动落库，请用 网页启动器/启动生产器(http).command 启动后再生产。', 'gen-log-warn');
        return null;
      }
      var nameInput = document.getElementById('gen-batch-name');
      var batchName = nameInput ? nameInput.value.trim() : '';
      return genApi('/api/production/start', {
        batchName: batchName,
        inputs: levelList.map(function (e) { return e.name; }),
        config: config,
        pageVersion: genScriptVersion(),
        seedPolicy: 'Math.random（未固定种子）',
        rulesVersion: '审核/难度/暂存口径 v93'
      }).then(function (j) {
        if (!j || !j.ok) throw new Error((j && j.error) || '开批次失败');
        genPersist.enabled = true; genPersist.batchId = j.batchId; genPersist.batchToken = j.batchToken;
        genPersist.relDir = j.relDir; genPersist.dirName = j.dirName;
        genLog('逐关落库已启用 → ' + j.relDir + '（每关写盘确认后才生产下一关，不再整批打包下载）', 'gen-log-ok');
        genPersistStatusEl('逐关落库中 → ' + j.relDir, 'ok');
        return j;
      });
    }).catch(function (e) {
      genLog('开批次失败：' + e.message + '，本批回退为内存模式。', 'gen-log-warn');
      genPersist.enabled = false;
      return null;
    }).then(function () {
      if (!genBatchRunning) return;   // 期间被停止
      // 优先用后台线程(主线程不阻塞、停止即时生效)；创建失败(如 file:// 被拦截)则回退主线程模式。
      if (!genSpawnPool(genPoolSize)) { genLog('无法创建后台线程，改用主线程模式(停止将在当前关处理完后生效)', 'gen-log-warn'); genRunSync(); }
    });
  }

  /**
   * 【v153】单关进度心跳 + 每一跳日志。
   *   用户 2026-10-16：「这也太慢了吧，也没进度条，为什么这么久」——单关最坏烧满预算（默认 5 分钟），
   *   期间界面只有一句"处理中"，看不出是在跑还是卡死。这里做三件事：
   *     ① 派发/返回/落库各打一条带用时的日志（卡在哪一跳一眼可见）；
   *     ② produce 内部的进度钩子（候选 k/K、轮 r/N、已试变体数、当前最好档）刷新"处理中"那行；
   *     ③ 心跳更新时间行，证明还在跑。
   */
  var genLastProgressPaint = 0;
  function genSlotProgress(slot, p) {
    if (!p || !genBatchRunning) return;
    var now = Date.now();
    if (now - genLastProgressPaint < 250) return;
    genLastProgressPaint = now;
    var idx = (slot && slot.idx != null && slot.idx >= 0) ? slot.idx : 0;
    var total = (genBatch && genBatch.total) || levelList.length;
    var nm = (levelList[idx] && levelList[idx].name) || '';
    var el = document.getElementById('gen-progress-current');
    if (el) el.textContent = '处理中 (' + (idx + 1) + '/' + total + '): ' + nm +
      '　· 候选 ' + (p.k || 1) + '/' + (p.K || 1) + ' · 轮 ' + (p.round || 0) + '/' + (p.N || 0) +
      ' · 已试 ' + (p.evaluated || 0) + ' 个变体 · 本关 ' + ((p.elapsedMs || 0) / 1000).toFixed(0) + 's' +
      ((p.tier != null) ? (' · 当前最好档 ' + p.tier + '/3') : '');
    var te = document.getElementById('gen-progress-time');
    if (te) te.textContent = '已用时 ' + Math.round((Date.now() - (genBatchStartAt || Date.now())) / 1000) + 's · 本关已跑 ' + ((p.elapsedMs || 0) / 1000).toFixed(0) + 's（每关完成即可用，可随时停止）';
  }

  // ==================== 后台线程池 ====================
  // 池内每个槽位是一个独立 Worker，同一时刻各自处理【一关】。槽位空闲就领走下一个待处理下标，
  // 因此快关不会被慢关堵住（改动前的串行结构里，一关跑满 5 分钟预算会把后面全部关卡一起拖住）。
  //
  // 每槽独立持有：epoch（代次，看门狗重启后作废旧线程迟到消息）、watchdog（单关看门狗）、idx（在飞下标）。
  // 改动前这三者都是全局单例，池化后必须下沉到槽位，否则一个槽的看门狗会误杀另一个槽。

  /** 创建一个槽位的 Worker 并完成握手；成功返回槽位对象，失败返回 null。 */
  function genSpawnSlot(slotNo) {
    var w = null;
    try { w = new Worker('js/gen-worker.js' + genScriptVersion()); } catch (e) { w = null; }
    if (!w) return null;
    var slot = { no: slotNo, w: w, epoch: 0, ready: false, busy: false, idx: -1, watchdog: null };
    genBindSlot(slot);
    w.postMessage({ cmd: 'ping' });
    return slot;
  }

  /** 给槽位绑定消息处理。看门狗重启时复用本函数重新绑定新 Worker。 */
  function genBindSlot(slot) {
    var epoch = ++slot.epoch;
    var readyTimer = setTimeout(function () {
      if (epoch !== slot.epoch || slot.ready) return;
      genSlotDead(slot, '后台线程无响应(8s)');
    }, 8000);   // 8s：避免慢速机器首次加载脚本被误判

    slot.w.onmessage = function (e) {
      if (epoch !== slot.epoch) return;   // 过期代次的迟到消息 → 忽略，防重复推进
      var d = e.data || {};
      if (d.type === 'ready') {
        if (slot.ready) return;
        slot.ready = true; clearTimeout(readyTimer);
        genPoolReadyCount++;
        genSlotDispatch(slot);            // 就绪即领第一关
        return;
      }
      if (d.type === 'loadfail') { clearTimeout(readyTimer); genSlotDead(slot, '后台线程脚本加载失败'); return; }
      if (d.type === 'progress') { genSlotProgress(slot, d.p); return; }   // 【v153】单关进度心跳
      if (d.type === 'result') {
        clearTimeout(slot.watchdog);
        var _dt = ((Date.now() - (genInFlightT0[d.index] || Date.now())) / 1000).toFixed(1);
        genLog('✔ 线程' + (slot.no + 1) + ' 返回：' + ((levelList[d.index] && levelList[d.index].name) || '') + '　' +
          (d.result && d.result.level ? '有关卡' : ('无关卡 ' + ((d.result && d.result.lastFailReason) || '?'))) + '　用时 ' + _dt + 's', 'gen-log-ok');
        genSlotSettle(slot, d.index, function (next) { genOnResult(levelList[d.index], d.result, d.index, next); }); return;
      }
      if (d.type === 'error') {
        clearTimeout(slot.watchdog);
        genLog('✗ 线程' + (slot.no + 1) + ' 报错：' + d.message, 'gen-log-warn');
        genSlotSettle(slot, d.index, function (next) { genOnError(levelList[d.index], d.message, d.index, next); }); return;
      }
    };
    slot.w.onerror = function (err) {
      if (epoch !== slot.epoch) return;
      clearTimeout(readyTimer); clearTimeout(slot.watchdog);
      genSlotDead(slot, '后台线程出错' + (err && err.message ? ('：' + err.message) : ''));
    };
  }

  /**
   * 一个槽位彻底不可用。
   * 若【池内还没有任何槽位就绪】→ 判定这个环境用不了 Worker（如 file:// 被拦），整批回退主线程（只回退一次）。
   * 若已有槽位在正常干活 → 只丢掉这一个槽，其余继续；在飞的那一关交回待处理队列，不算失败、不丢关。
   */
  function genSlotDead(slot, reason) {
    try { slot.w.terminate(); } catch (e) {}
    slot.ready = false; slot.w = null;
    var wasIdx = slot.idx; slot.idx = -1; slot.busy = false;
    genPool = genPool.filter(function (s) { return s !== slot; });

    if (genPoolReadyCount === 0 && !genPoolFellBack) {
      genPoolFellBack = true;
      genPool.forEach(function (s) { try { if (s.w) s.w.terminate(); } catch (e) {} });
      genPool = [];
      var tip = (location.protocol === 'file:')
        ? reason + '：本地 file:// 方式打开时浏览器会禁用后台线程。已改用主线程模式继续生产（生产每一关时页面会短暂无响应，"停止"在当前关跑完后生效）。想要后台线程+即时停止，请用本地服务器以 http:// 方式打开本页。'
        : reason + '，已改用主线程模式继续生产（"停止"将在当前关处理完后生效）。';
      genLog(tip, 'gen-log-warn');
      genRunSync();
      return;
    }
    if (wasIdx >= 0) {                       // 这一关还没跑完就没了线程 → 退回队列让别的槽重跑，不静默丢关
      genBatch.retryQueue.push(wasIdx);
      delete genInFlightT0[wasIdx];
    }
    genLog('线程 #' + (slot.no + 1) + ' 已停用（' + reason + '），剩余 ' + genPool.length + ' 个线程继续。', 'gen-log-warn');
    if (!genPool.length && !genPoolFellBack) { genFinalizeBatch('所有后台线程都已停用（已落库的关卡全部保留）'); return; }
    genPoolProgressText();
    genMaybeFinalize();
  }

  /** 结算一关：先落库（异步），确认后释放槽位并领下一关。 */
  function genSlotSettle(slot, idx, runSettle) {
    runSettle(function () {
      slot.busy = false; slot.idx = -1;
      genBatch.doneCount++;
      delete genInFlightT0[idx];
      genUpdateProgressBar(genBatch.doneCount, genBatch.total);
      genUpdateStatChips(genBatchResults);
      genUpdateTime(genBatch.doneCount, genBatch.total);
      genPoolProgressText();
      if (genBatchAborted) { genMaybeFinalize(); return; }
      genSlotDispatch(slot);
    });
  }

  /** 槽位领取下一关。没有可领的就置空闲，并检查整批是否该收尾。 */
  function genSlotDispatch(slot) {
    if (genBatchAborted || !genBatchRunning || !slot.w || !slot.ready) return;
    var b = genBatch;
    var idx = b.retryQueue.length ? b.retryQueue.shift() : (b.nextIdx < b.total ? b.nextIdx++ : -1);
    if (idx < 0) { slot.busy = false; slot.idx = -1; genMaybeFinalize(); return; }

    var entry = levelList[idx], isEasy = !!b.easySlot[idx];
    // 【v153 修复】切球规划器的"本批要不要用车单"必须在**本函数作用域内**重新取一次。
    //   planIdx/cutPlanParams/cutUseChecked 都是 batchProduce 的局部变量，这里根本看不见 ——
    //   原写法 `planIdx[idx] ? ... : null` 会在【第一关派发时】抛 ReferenceError: planIdx is not defined，
    //   异常沿 ready 回调冒出去 → 整条派发链死掉 → 界面永远"处理中"、不写盘、连错误都不报
    //   （用户 2026-10-16 全部批次"已处理 0"的真因；用假 Worker 的派发链路测试复现）。
    var wantPlan = !!(cutPlanParams && (document.getElementById('cutplan-use') || {}).checked);
    slot.busy = true; slot.idx = idx;
    genInFlightT0[idx] = Date.now();
    genPoolProgressText();
    slot.w.postMessage({
      cmd: 'produce', index: idx, blocks: entry.blocks,
      config: Object.assign({}, genApplyFixed(b.config, entry.blocks, entry.name), {   // 【v153】自动档逐图现算
        mapSize: entry.blocks.length, requireHardPass: !isEasy,
        isBossSlot: !!(b.bossSlot && b.bossSlot[idx]),    // BOSS 规格逐关透传（卡点类型配额用）
        forcedBoxes: wantPlan ? cutplanBuild(entry.blocks, cutPlanParams.steps, cutplanParseBeats(cutPlanParams.beatsText)).cars : null,  // 【v153】逐图现算车单直通
        fragmentMaxRate: wantPlan ? 0 : (b.config.fragmentMaxRate || 0)  // 规划内碎色=压力素材，闸门临时关
      })
    });
    genLog('▶ 线程' + (slot.no + 1) + ' 接单：' + entry.name + '（车单' + (wantPlan ? '=' + cutplanBuild(entry.blocks, cutPlanParams.steps, cutplanParseBeats(cutPlanParams.beatsText)).cars.length + '辆' : '自动') +
      ' · 候选' + (b.config.candidateCount || 1) + ' × 轮' + (b.config.difficultyRounds || 1) + '）', '');
    // 单关看门狗：超过【单关预算 + 2 分钟余量】仍无返回 → 判定该关卡死，跳过并只重启这一个槽（预算=0/不限时则不设）
    clearTimeout(slot.watchdog);
    // 【v327】看门狗必须跟着「每图搜索时间」走：原来用批次默认 300s，选 8 分钟（≈495s）
    //   必然先被看门狗判"卡死"，实测 00:38 那批就是 WATCHDOG_TIMEOUT。
    var _smEl = document.getElementById('gen-search-min');
    var _smMin = parseInt(_smEl && _smEl.value, 10);
    var budget = (_smMin > 0) ? (_smMin * 60000) : ((b.config && b.config.timeBudgetMs != null) ? b.config.timeBudgetMs : 300000);
    // 【v329】余量 120s → 240s：一轮 produce 可能超出预算（带外纠偏会再跑一次整轮），实测 40×40 被误判卡死。
    if (budget > 0) slot.watchdog = setTimeout(function () { genOnLevelStuck(slot, idx); }, budget + 240000);
  }

  /** 进度行：并发下同时有多关在飞，逐个列出，不再只显示一关。 */
  function genPoolProgressText() {
    var curEl = document.getElementById('gen-progress-current');
    if (!curEl || !genBatch) return;
    // 【v308·用户反馈】"没有真实的进度"：原来只显示"已完成 X/Y"，Y 是**图片数**不是关卡数，
    //   而且飞行中的关没有耗时。这里给每一关补上已用秒数，并加 1 秒刷新（见 batchProduce）。
    var flying = genPool.filter(function (s) { return s.busy && s.idx >= 0; })
      .map(function (s) {
        var e = levelList[s.idx];
        var t0 = genInFlightT0 && genInFlightT0[s.idx];
        var sec = t0 ? Math.round((Date.now() - t0) / 1000) : 0;
        return '#' + (s.no + 1) + '→' + (s.idx + 1) + '.' + (e ? e.name.replace(/\.txt$/i, '') : '?') + '（' + sec + 's）';
      });
    curEl.textContent = flying.length
      ? ('并发 ' + flying.length + '/' + genPoolSize + ' 在算：' + flying.join('　') + '　｜ 已完成 ' + genBatch.doneCount + '/' + genBatch.total)
      : ('已完成 ' + genBatch.doneCount + '/' + genBatch.total);
  }

  /** 看门狗触发：该槽处理的那一关超时未返回 → 记为失败落库、重启这一个槽继续。 */
  function genOnLevelStuck(slot, stuckIdx) {
    if (!genBatchRunning || genBatchAborted) return;
    if (slot.idx !== stuckIdx) return;   // 结果其实已到、已释放 → 过期看门狗，忽略
    var entry = levelList[stuckIdx];
    genLog('第 ' + (stuckIdx + 1) + '/' + genBatch.total + ' 关「' + (entry ? entry.name : '') + '」超过时限仍无返回，判定卡死：跳过该关，重启线程 #' + (slot.no + 1) + ' 继续。', 'gen-log-err');
    try { slot.w.terminate(); } catch (e) {}
    slot.ready = false; genPoolReadyCount--;
    // 看门狗超时也要落库：源图进 不合格txt图/ + 记 WATCHDOG_TIMEOUT，写盘成功后才重启该槽
    genOnError(entry, '单关超时未返回(疑似卡死)，已跳过', stuckIdx, function () {
      slot.busy = false; slot.idx = -1;
      genBatch.doneCount++;
      delete genInFlightT0[stuckIdx];
      genUpdateProgressBar(genBatch.doneCount, genBatch.total);
      genUpdateStatChips(genBatchResults);
      genUpdateTime(genBatch.doneCount, genBatch.total);
      if (!genBatchRunning || genBatchAborted) { genMaybeFinalize(); return; }
      var w = null;
      try { w = new Worker('js/gen-worker.js' + genScriptVersion()); } catch (e) { w = null; }
      if (!w) { genSlotDead(slot, '重启后台线程失败'); return; }
      slot.w = w; genBindSlot(slot); w.postMessage({ cmd: 'ping' });   // 握手成功后自行领下一关
    });
  }

  /** 全部派完 + 无人在飞 + 无待重试 → 收尾。并发下必须用这个判据，不能再看单个游标。 */
  function genMaybeFinalize() {
    if (!genBatchRunning) return;
    var b = genBatch;
    if (!b) return;
    if (b.retryQueue.length) return;
    if (b.nextIdx < b.total) return;
    var flying = genPool.some(function (s) { return s.busy; });
    if (flying) return;
    if (Object.keys(genPersist.pendingPayloads).length) return;   // 还有关卡等着重试落库 → 不收尾，别把它丢了
    genFinalizeBatch(genBatchAborted ? ('已停止（已落库 ' + b.doneCount + '/' + b.total + ' 关；已落库的关卡全部保留）') : null);
  }

  /** 建池并启动。返回 false 表示连一个 Worker 都创建不出来（调用方回退主线程）。 */
  function genSpawnPool(size) {
    genPool = []; genPoolReadyCount = 0; genPoolFellBack = false;
    for (var i = 0; i < size; i++) {
      var slot = genSpawnSlot(i);
      if (slot) genPool.push(slot);
    }
    if (!genPool.length) return false;
    genLog('已启动 ' + genPool.length + ' 个后台线程并发生产（单关预算仍为每关各自 ' +
      (((genBatch.config && genBatch.config.timeBudgetMs) || 300000) / 1000) + 's，不因并发缩短）。', 'gen-log-ok');
    return true;
  }

  // ---- 主线程模式(后台线程不可用时的回退)：只能串行，每关 produce 前先检查停止标记，避免多跑一关 ----
  //   本模式【不并发】——主线程跑 produce 本身就阻塞页面，多开无意义。仅在 Worker 完全不可用时兜底。
  function genRunSync() {
    var cutUseChecked = !!(document.getElementById('cutplan-use') || {}).checked;   // 【v153】切球规划器开关
    function step() {
      if (!genBatchRunning) return;
      var b = genBatch;
      if (genBatchAborted) { genFinalizeBatch('已停止（已落库 ' + b.doneCount + '/' + b.total + ' 关）'); return; }
      // 先消化因线程死亡退回队列的下标，再按 nextIdx 前进（与池化模式同一取关口径）
      var idx = b.retryQueue.length ? b.retryQueue.shift() : (b.nextIdx < b.total ? b.nextIdx++ : -1);
      if (idx < 0) { genFinalizeBatch(null); return; }
      var entry = levelList[idx], isEasy = !!b.easySlot[idx];
      var curEl = document.getElementById('gen-progress-current');
      if (curEl) curEl.textContent = '处理中 (' + (idx + 1) + '/' + b.total + '): ' + entry.name + (isEasy ? ' [简单关名额]' : ' [困难关名额]') + '　[主线程串行]';
      setTimeout(function () {
        // 关键修复：在跑下一关 produce 之前再查一次停止标记(此前 abort 检查放在 produce 之后 → 会多跑一关)
        if (genBatchAborted) { genFinalizeBatch('已停止（已落库 ' + b.doneCount + '/' + b.total + ' 关）'); return; }
        genInFlightT0[idx] = Date.now();
        var curIdx = idx;
        // 落库门：同后台线程模式——写盘确认后才推进到下一关（未启用落库时 next 会被立即调用）
        function afterOne() {
          b.doneCount++;
          delete genInFlightT0[curIdx];
          genUpdateProgressBar(b.doneCount, b.total);
          genUpdateStatChips(genBatchResults);
          genUpdateTime(b.doneCount, b.total);
          step();
        }
        try {
          // 【v153】主线程路径也接进度钩子（同一套显示；跑完清掉，避免影响后面的求解/模拟）
          if (AntSolver.Generator.setProgressHook) AntSolver.Generator.setProgressHook(function (p) { genSlotProgress({ idx: curIdx, no: 0 }, p); });
          var usePlan = cutPlanParams && cutUseChecked;   // 【v153】主线程串行路径同样逐图现算车单直通
          var cfgAuto = genApplyFixed(b.config, entry.blocks, entry.name);   // 【v153】自动档
          var cfg = Object.assign({}, cfgAuto, {
            mapSize: entry.blocks.length, requireHardPass: !isEasy,
            isBossSlot: !!(b.bossSlot && b.bossSlot[curIdx]),
            forcedBoxes: usePlan ? cutplanBuild(entry.blocks, cutPlanParams.steps, cutplanParseBeats(cutPlanParams.beatsText)).cars : null,
            fragmentMaxRate: usePlan ? 0 : (b.config.fragmentMaxRate || 0)
          });
          var result = AntSolver.Generator.produce(entry.blocks, cfg);
          if (AntSolver.Generator.setProgressHook) AntSolver.Generator.setProgressHook(null);
          genLog('✔ 主线程完成：' + entry.name + '　' + (result && result.level ? '有关卡' : ('无关卡 ' + ((result && result.lastFailReason) || '?'))) +
            '　用时 ' + ((Date.now() - (genInFlightT0[curIdx] || Date.now())) / 1000).toFixed(1) + 's', 'gen-log-ok');
          genOnResult(entry, result, curIdx, afterOne);
        } catch (err) { genOnError(entry, err.message, curIdx, afterOne); }
      }, 10);
    }
    step();
  }

  // 生成安全文件名（去扩展名/非法字符）
  function safeName(n) {
    return String(n).replace(/\.txt$/i, '').replace(/[\\/:*?"<>|]/g, '_');
  }

  function finishBatch(results) {
    // 逐关落库模式(正式路径)：结果早已逐关写盘，这里只做收尾——通知服务 finish/stop、展示输出目录与计数。
    //   不再构建整批 ZIP、不再 JSON.stringify 全批大对象（那是内存峰值与长卡顿的来源）。
    if (genPersist.enabled) {
      var st = genBatchAborted ? 'stop' : 'finish';
      genApi('/api/production/' + st, { batchId: genPersist.batchId, batchToken: genPersist.batchToken, reason: genBatchAborted ? '用户停止' : null })
        .then(function (j) {
          var relDir = (j && j.relDir) || genPersist.relDir;
          var q = (j && j.qualified != null) ? j.qualified : '?';
          var u = (j && j.unqualified != null) ? j.unqualified : '?';
          var er = (j && j.errors != null) ? j.errors : '?';
          // 【v137】把「跳过」和它的原因一起写在完成行里。
          //   原先只有「合格 0 / 不合格 0 / 异常 0」——被前置闸门/预检挡掉的输入完全隐形，
          //   用户看到的就是「什么都没产出，也没说为什么」（原话就是这一条）。
          var skipped = [], skipByName = {};
          results.forEach(function (r) {
            if (r && r.gateBlocked) {
              var why = r.gateReasonCN || r.gateReason || '未知原因';
              // 【v247】把结构侧的详细原因也带上：原来只有「候选全灭」四个字，
              //   用户原话「还是候选全灭，也不知为什么」。这里取 structural.reason 的摘要
              //   （形如「候选淘汰主因「pipeCapacity」10/10 次」），最多 60 字。
              var det = String(r.gateDetail || '').replace(/；?全部计数[\s\S]*$/, '');
              if (det.length > 60) det = det.slice(0, 60) + '…';
              skipped.push(r.name + '（' + why + (det ? '：' + det : '') + '）');
              skipByName[why] = (skipByName[why] || 0) + 1;
            }
          });
          var skipStr = skipped.length
            ? ('　跳过 ' + skipped.length + '（' + Object.keys(skipByName).map(function (k) { return k + ' ×' + skipByName[k]; }).join('；') + '）')
            : '';
          var msg = (genBatchAborted ? '生产已停止' : '生产完成') + '　输出目录：' + relDir + '　合格 ' + q + ' / 不合格 ' + u + ' / 异常 ' + er + skipStr;
          genLog(msg, 'gen-log-ok');
          genPersistStatusEl(msg, 'ok');
          // 跳过的每一关都把原因摊开写（最多 5 条），不用去翻逐关记录才知道为什么没产出。
          if (skipped.length) {
            genLog('（跳过明细）' + skipped.slice(0, 5).join('；') + (skipped.length > 5 ? ('；…共 ' + skipped.length + ' 关') : ''), 'gen-log-warn');
          }
          var curEl2 = document.getElementById('gen-progress-current');
          if (curEl2) curEl2.textContent = (genBatchAborted ? '已停止' : '已完成') + '，输出目录：' + relDir;
        })
        .catch(function (e) { genLog('收尾通知服务失败：' + e.message + '（已落库的关卡不受影响）', 'gen-log-warn'); });
      renderGenResultTable(genResultHistory, true);   // 【v153】收尾也用历史渲染（跨批次保留）
      var resultCardP = document.getElementById('gen-result-card');
      if (resultCardP) resultCardP.classList.remove('hidden');
      var cntElP = document.getElementById('gen-result-count');
      if (cntElP) cntElP.textContent = '（共 ' + results.length + ' 关，已逐关落库，无需下载）';
      return;
    }
    // ── 以下为【兜底模式】(未连接本地生产服务，如 file:// 打开)：保留旧的内存汇总 + 手动下载 ZIP ──
    if (!results.length) { genLog('本批没有产出任何结果，已中止。'); return; }
    var passCount = results.filter(function(r) { return r.valid; }).length;
    // 困难/简单合格认 audit.tier(不被 finalizeProduce 改写)；audit.pass 在 produce() 收尾后已是"整体合格"(两档合并)。
    var hardCount = results.filter(function(r) { return r.audit && (r.audit.tier === '合格' || r.audit.tier === '困难合格'); }).length;
    var easyCount = results.filter(function(r) { return r.audit && (r.audit.tier === '简单关·趋势过平' || r.audit.tier === '简单合格'); }).length;
    // 兜底统计(v86)：fallback=true 的关卡按 fallbackType 细分(超时兜底 / 遍历完兜底)
    var fallbackTimeout = results.filter(function(r) { return r.fallback && r.fallbackType === 'timeout'; }).length;
    var fallbackExhausted = results.filter(function(r) { return r.fallback && r.fallbackType === 'exhausted'; }).length;
    var gradeCount = {};
    results.forEach(function(r) { gradeCount[r.grade] = (gradeCount[r.grade]||0)+1; });
    var gradeStr = Object.keys(gradeCount).map(function(g){return g+':'+gradeCount[g];}).join(' ');
    var curEl = document.getElementById('gen-progress-current');
    if (curEl) curEl.textContent = '打包中...';
    genLog('完成! 通过: ' + passCount + '/' + results.length +
      ' · 有卡点合格: ' + hardCount + ' · 简单关·趋势过平: ' + easyCount +
      ((fallbackTimeout + fallbackExhausted) ? ' · 兜底(超时' + fallbackTimeout + '/穷尽' + fallbackExhausted + ')' : '') +
      ' · 难度分布: ' + gradeStr);
    // 【v137】兜底模式同样把「跳过」与原因摊开（与正式落库路径口径一致）
    var skippedFB = results.filter(function (r) { return r && r.gateBlocked; });
    if (skippedFB.length) {
      var fbByName = {};
      skippedFB.forEach(function (r) { var w = r.gateReasonCN || r.gateReason || '未知原因'; fbByName[w] = (fbByName[w] || 0) + 1; });
      genLog('跳过 ' + skippedFB.length + ' 关（' + Object.keys(fbByName).map(function (k) { return k + ' ×' + fbByName[k]; }).join('；') + '）；明细：'
        + skippedFB.slice(0, 5).map(function (r) { return r.name + '（' + (r.gateReasonCN || '') + '）'; }).join('；'), 'gen-log-warn');
    }

    // 结果表(排序/分组展示，见 renderGenResultTable)：先出结果表，再打包下载，用户能立刻看到每关明细。
    var resultCard = document.getElementById('gen-result-card');
    if (resultCard) resultCard.classList.remove('hidden');
    var countEl = document.getElementById('gen-result-count');
    if (countEl) countEl.textContent = '(' + results.length + ')';
    renderGenResultTable(genResultHistory, true);   // 【v153】收尾也用历史渲染（跨批次保留）

    if (!AntSolver.Zip) { alert('ZIP模块未加载'); return; }

    var config = getGenConfig();
    var files = [];
    var used = {};
    var nowIso = new Date().toISOString();   // 整批统一时间戳（求解数据 meta 与包内各处保持一致）
    var dataLevels = [];   // 汇总到 关卡数据/关卡数据.json（含【完整内部 board】→ 无损还原 + 审核/求解/难度），本地调试用

    // CSV 分析报告表头
    // 【v157】表尾追加卡点判据 v2 五列（新列一律加在表尾，避免历史表错位）
    var csv = ['关卡,目标图入口模式,尺寸,棋盘,盒数,可解,难度分,难度等级,障碍,峰值暂存,均暂存,50%后均暂,50%后峰窗,求解遍可通率,审核合格,合格档,是否兜底,兜底类型,生成诊断分,全知后期封锁,玩家后期封锁,玩家暂存峰,玩家通关,卡点@,前期峰窗,中期峰窗,后期峰窗,不合格原因,卡点v2_独木桥_,卡点v2_预算判断点_,卡点v2_无满解_,卡点v2_70%前≥4占比,卡点v2_判定'];
    // 索引.csv（2026-08-05 §导出对齐）：与 348关工具导入包 的 索引.csv 同口径，
    // 一行一关标出三件套是否齐全，供人工/QA 核对。工具导入时会忽略本文件（只认 .txt/.json）。
    var idxRows = ['关卡名,目标图入口模式,难度分,难度等级,审核合格,合格档,是否可解,求解步数,总盒数,总像素,TXT,关卡,求解数据'];
    // 入口模式中文名（CSV/报告统一口径）：四边入口 / 仅底部入口
    function entryModeCN(m) {
      if (m === 'fourSideInstantChain') return '四方向瞬时连锁';
      if (m === 'bottomOnly') return '仅底部入口';
      return '四边入口';
    }

    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      // 【v153 修复】前置闸门拦下/候选全灭的结果没有关卡体（level=undefined）——
      //   旧代码直接 parseLevel(undefined) 抛错 → 收尾中断 → 界面永远停在「生产中」，
      //   用户以为挂了只能手动停止（实测 2026-10-15 19:18 批次：规划车单 + 重度障碍 → 候选全灭 → 卡 12 分钟）。
      //   失败结果本来就在结果表里如实列出原因，ZIP 里没有可打包的关卡体，跳过即可。
      if (!r.level) continue;
      var base = safeName(r.name);
      if (used[base]) base = base + '_' + i;   // 去重
      used[base] = true;
      var lv = r.level;
      var pr = AntSolver.parseLevel(lv);
      // 1) 关卡本体：干净的程序端结构（toprow/blocks/maprow/mapcol/spools），不含难度/求解/bufferLimit
      files.push({ name: '关卡/' + base + '.json', text: JSON.stringify(AntSolver.toGameFormat(pr), null, 2) });
      // 2) 源目标图 TXT（若有原始文本则用，否则由 blocks 还原）
      var txt = r.txt || blocksToTXT(lv.blocks);
      files.push({ name: 'txt图/' + base + '.txt', text: txt });
      // 3) 求解数据：每关一份 <关卡名>.solve.json（2026-08-05 §导出对齐）
      // 目的：修图工具导入时直接读现成 pickOrder，不再现场求解。
      // 现场求解走 core.js 的 solveStandard，是【按时间预算】(DEFAULT_BUDGET_MS=180000) 跑九遍梯队，
      // 不同机器/负载可能停在不同遍 → pickOrder 漂移且原理上不可复现（梯队种子本身是写死的，
      // 所以漂移不是随机种子造成的）。带上本文件即彻底消除该项不确定性。
      // 【契约】pickOrder 是唯一权威；不输出 replay/defaultInterval——工具本来就自己按真机口径
      // 毫秒级重放，多写一份反而多一处会漂的数据（历史 348 包的 replay.steps 就因漏传
      // useSlotStart 而是旧口径，工具已明确只采信 pickOrder）。
      // 【只有真拿到 pickOrder 才写】：修图工具 core.js 的 detectKind 判 'solve' 的条件是
      // meta && summary && (replay || pickOrder)。若这里在无求解结果时写出 summary:null 的空壳，
      // 该文件会被判成 'unknown' 落进「读不出来」计数，反而制造噪音。宁可不写，索引里如实标「无pickOrder」。
      var slv = (r.solve && r.solve.pickOrder && r.solve.pickOrder.length) ? r.solve : null;
      if (slv) files.push({ name: '求解数据/' + base + '.solve.json', text: JSON.stringify({
        type: 'ant-solve-data',
        contract: 'pickOrder 为唯一权威；不含 replay/defaultInterval，逐步轨迹由使用方按真机口径自行重放。',
        meta: {
          levelFile: '关卡/' + base + '.json',
          txtFile: 'txt图/' + base + '.txt',
          levelName: r.name,
          entryMode: r.entryMode || 'fourSide',
          bufferLimit: lv.bufferLimit,
          exported: nowIso,
          源: '生成器批量导出（合格轮求解数据，未重新求解）'
        },
        summary: {
          completed: !!slv.completed, retryRound: slv.retryRound != null ? slv.retryRound : null,
          steps: slv.steps, maxBuffer: slv.maxBuffer, avgBuffer: slv.avgBuffer,
          progress: slv.progress, completedBoxes: slv.completedBoxes, totalBoxes: slv.totalBoxes,
          eliminatedPixels: slv.eliminatedPixels, totalPixels: slv.totalPixels,
          itemUses: slv.itemUses != null ? slv.itemUses : null
        },
        audit: r.audit || null,
        difficulty: { score: r.difficulty, grade: r.grade },
        pickOrder: slv.pickOrder,
        stepStats: slv.stepStats || [],
        stepBufferHistory: slv.stepBufferHistory || [],
        pressureSamples: slv.pressureSamples || []
      }, null, 1) });
      // 3b) 汇总求解/关卡数据到 关卡数据.json（本地调试）：存【完整内部 board】以便导入无损还原
      dataLevels.push({
        name: r.name, valid: r.valid,
        difficulty: r.difficulty, grade: r.grade,
        entryMode: r.entryMode || 'fourSide',   // 目标图入口模式（关卡本体不含此字段，靠批次分组传给程序端）
        bufferLimit: lv.bufferLimit,
        blocks: lv.blocks,               // 目标图（导入无损还原需要）
        board: lv.board,                 // 完整内部结构（含冰耐久等），无损
        audit: r.audit || null,          // 卡点审核结论
        // 兜底标记(v86)：不是正常合格输出的关卡，这里能一眼看出来是不是兜底、兜底类型、对应档次和原因。
        fallback: !!r.fallback, fallbackTier: r.fallbackTier != null ? r.fallbackTier : null,
        fallbackType: r.fallbackType || null, fallbackReason: r.fallbackReason || null,
        generationEval: r.generationEval || null, // 全知/玩家暂存+动态封锁诊断
        solve: r.solve || null           // 合格轮求解数据：pickOrder/stepBufferHistory/pressureSamples 等
      });
      // 3) CSV 行
      var pm = r.pm || { avgAll: 0, avg50: 0, maxWin: 0, completedRate: 0 };
      var au = r.audit || { pass: false, lateAt: null, earlyMax: 0, midMax: 0, lateMax: 0, reasons: [] };
      var ge = r.generationEval || { score: 0, omni: { preview: {} }, player: { preview: {}, peak: 0, won: false } };
      var gop = ge.omni.preview || {}, gpp = ge.player.preview || {};
      csv.push([
        '"' + r.name + '"', entryModeCN(r.entryMode), pr.rows + 'x' + pr.cols,
        (lv.board ? lv.board.rows + 'x' + lv.board.cols : ''), pr.totalBoxes,
        (r.valid ? '是' : '否'), r.difficulty, r.grade,
        '"' + (r.obstacleNames || '无') + '"',
        r.maxBuffer, pm.avgAll, pm.avg50, pm.maxWin, Math.round(pm.completedRate * 100) + '%',
        (au.usable != null ? (au.usable ? '合格' : '不合格') : ((au.pass || au.easyPass) ? '合格' : '不合格')),
        (au.tier || (au.pass ? '合格' : (au.easyPass ? '简单关·趋势过平' : '不合格'))),
        (r.fallback ? '是' : '否'), (r.fallbackType || '-'), ge.score || 0,
        Math.round((gop.lateAvgLockRatio || 0) * 100) + '%', Math.round((gpp.lateAvgLockRatio || 0) * 100) + '%',
        ge.player.peak || 0, (ge.player.won ? '是' : '否'),
        (au.lateAt != null ? au.lateAt + '%' : '-'),
        au.earlyMax, au.midMax, au.lateMax, '"' + (au.reasons.join('；') || '') + '"',
        // 【v157】卡点判据 v2（R1~R9）：全知线_玩家线 形式，判定按取最差
        (function () {
          var v2 = r.chokeV2 || (r.generationEval && r.generationEval.auditV2);
          if (!v2) return ',,,,';
          var o = v2.omni, p = v2.player, w = v2.worst;
          var vio = AntSolver.Generator.chokeV2Violations ? AntSolver.Generator.chokeV2Violations(w) : [];
          return (o ? o.bridges : '-') + '_' + (p ? p.bridges : '-') + ',' +
            (o ? o.r9 : '-') + '_' + (p ? p.r9 : '-') + ',' +
            (o ? o.noGood : '-') + '_' + (p ? p.noGood : '-') + ',' +
            w.hiBefore70Pct + '%,' +
            '"' + (vio.length ? ('不通过:' + vio.join('、')) : '通过') + '"';
        })()
      ].join(','));
      // 索引行：三件套齐全性按本轮【实际写出的文件】判断，不假定
      idxRows.push([
        '"' + base + '"', entryModeCN(r.entryMode), r.difficulty, r.grade,
        (au.usable != null ? (au.usable ? '合格' : '不合格') : ((au.pass || au.easyPass) ? '合格' : '不合格')),
        (au.tier || (au.pass ? '合格' : (au.easyPass ? '简单关·趋势过平' : '不合格'))),
        (r.valid ? '是' : '否'),
        (slv && slv.steps != null ? slv.steps : ''),
        pr.totalBoxes, pr.totalPixels,
        '有', '有', (slv ? '有' : '无（该关无可用pickOrder，按契约不写空壳）')
      ].join(','));
    }

    // 4) 关卡数据.json：汇总本批所有关的完整内部数据 + 审核/求解/难度（本地调试，无损重导入）
    files.push({ name: '关卡数据/关卡数据.json', text: JSON.stringify({
      type: 'ant-level-data', exported: new Date().toISOString(), total: results.length, levels: dataLevels
    }, null, 2) });
    // 5) 分析报告 CSV
    files.push({ name: '关卡数据/分析报告.csv', text: '\ufeff' + csv.join('\n') });
    // 5b) 索引.csv（放包根，与 348关工具导入包 同位置同口径）
    files.push({ name: '索引.csv', text: '\ufeff' + idxRows.join('\n') });

    // 5) 生产报告 MD —— 中后期卡点审核（标准见 生产审核评分体系.md）
    var auditPass = results.filter(function(r) { return r.audit && r.audit.pass; });
    var bl = config.bufferLimit || 5;
    var md = '# 生产报告\n\n';
    md += '- 生成时间: ' + new Date().toLocaleString() + '\n';
    // 目标图入口模式：整批统一（UI 开关决定）。关卡 JSON 本体不含该字段，程序端按【批次分组】识别本批规则。
    md += '- **目标图入口模式: ' + entryModeCN(entryModeOf(config)) + '**'
      + (config.instantChain
        ? '（每次取盒后一次性瞬时结算：每轮快照当前可达同色全集，按离订单起点距离近优先，'
          + '消到订单剩余容量为止，目标图整体刷新后再重扫；多订单严格先进先得。'
          + '棋盘取盒方向不变。本批关卡 JSON 不含入口模式字段，需按本批次整体传给程序端）'
        : (config.bottomOnly
          ? '（目标图上/左/右封闭，只能从底边向内消除；棋盘取盒方向不变。本批关卡 JSON 不含入口模式字段，需按本批次整体传给程序端）'
          : '（现有默认玩法）')) + '\n';
    // v99 瞬时连锁模式：把本批实际生效的专用参数一并写进报告，便于复现与验收
    if (config.instantChain) {
      md += '- 瞬时连锁专用参数: 管道数下限 ' + (config.minPipes || 0)
        + ' · 可用空间目标 ' + (config.usableSpaceTarget ? (config.usableSpaceTarget * 100).toFixed(0) + '%' : '关闭')
        + (config.usableSpaceTarget ? '（容差 ±' + (config.usableSpaceTolPp != null ? config.usableSpaceTolPp : 5) + 'pp，黑块突破预算 2×5pp）' : '')
        + ' · 盒容量采样 ' + (config.boxSizeMode || 'random')
        + ' · 死亡边界救援 ' + (config.deathEdgeRescue ? '开' : '关')
        + ' · 窄路概率 ' + (config.narrowPathProb != null ? config.narrowPathProb : 1) + '\n';
      md += '  > 已知限制：本模式暂存压力天然偏低，困难合格占比会明显低于原四方向；'
        + '窄路实际落地率低于设定概率（详见 `bin/文档/版本记录/更新记录.md` v99 §五）。\n';
    }
    // 管道容量口径与兜底（ANT-GEN-PIPE-DEPTH-FALLBACK-20260825）。写在 instantChain 分支【之外】：
    //   这三项对所有入口模式都生效，且它们直接决定「minPipes 条管道需要多少溢出盒」——
    //   正是 08-25 方案_v104 全批 0 产出的直接成因，任何模式的批次都必须能从报告里复现该口径。
    var _pFb = config.pipeFallbackCount != null ? config.pipeFallbackCount : 2;
    var _pFl = config.pipeFloorCount != null ? config.pipeFloorCount : 2;
    md += '- 管道容量口径: 队列深度上限 ' + (config.pipeMaxDepth != null ? config.pipeMaxDepth : 6)
      + ' · 单管最少 ' + (config.pipeMinFill != null ? config.pipeMinFill : 4)
      + ' · 管道数下限 ' + (config.minPipes || 0) + '\n';
    md += '- 管道阶梯: 主轮 ' + (config.minPipes || 0) + '条/每管≥' + (config.pipeMinFill != null ? config.pipeMinFill : 4)
      + ' → 兜底 ' + (_pFb > 0 ? _pFb + '条/每管≥' + (config.pipeFallbackDepth != null ? config.pipeFallbackDepth : 3) : '关闭')
      + ' → 绝对下限 ' + (_pFl > 0 ? _pFl + '条/每管≥' + (config.pipeFloorDepth != null ? config.pipeFloorDepth : 2) : '关闭')
      + ' → 去除管道(P=0)\n'
      + '  > 硬约束：P 条管道需溢出盒 ≥ P×每管最少；低于绝对下限则整体撤除管道，撤除后仍有盒无处安放才淘汰候选\n'
      + '  > 逐关记录 `pipeStat` 可查：placed(实落条数) / fallbackTier(fallback|floor) / pipeDropped(是否被撤) / noPipeAccepted\n';
    md += '- 关卡总数: ' + results.length + ' · 可解: ' + passCount + ' · 审核合格: ' + auditPass.length + '\n';
    md += '- 难度分布: ' + gradeStr + '\n';
    md += '- 卡点审核标准(暂存上限 ' + bl + ')：高压阈值=' + (bl - 1.5) + '(上限−1.5) · 中压阈值=' + (bl - 2.5) + '(上限−2.5)\n';
    md += '  - ①50%后至少1个10%窗口均值≥高压(卡点) ②前期0-20%无窗口≥中压 ③中期20-50%无窗口≥高压\n';
    md += '- 审核+求解数据：见 `关卡数据/关卡数据.json`（汇总本批各关审核结论 + 合格轮 pickOrder/压力样本 + 完整关卡数据，供回溯复盘/重放/无损重导入）\n\n';
    md += '## 生成参数\n```json\n' + JSON.stringify(config, null, 2) + '\n```\n\n';
    md += '## 审核合格关卡（' + auditPass.length + '）\n';
    if (auditPass.length) auditPass.forEach(function(r) {
      var a = r.audit;
      md += '- ' + r.name + '：难度' + r.difficulty + '[' + r.grade + '] 卡点@' + a.lateAt + '%(峰窗' + a.lateMax + ') · 前期' + a.earlyMax + ' 中期' + a.midMax + '\n';
    }); else md += '（本批无合格关卡：多为「50%后无高压卡点」——需增压，如调大换球比例/区域、盒容量差距）\n';
    // 兜底关卡明细(v86)：fallback=true 的关卡不是正常合格输出，单独列出，避免和上面的合格清单混在一起看。
    var fallbackList = results.filter(function(r) { return r.fallback; });
    if (fallbackList.length) {
      md += '\n## 兜底关卡（' + fallbackList.length + '，不是正常合格输出，见下方标注）\n';
      fallbackList.forEach(function(r) {
        var typeCN = r.fallbackType === 'timeout' ? '超时兜底' : '遍历完兜底';
        var tierCN = r.fallbackTier === 1 ? '安全兜底(可通关未形成卡点)' : '最接近标准(仍不合格)';
        md += '- ' + r.name + '：[' + typeCN + '·' + tierCN + '] ' + (r.fallbackReason || '') + '\n';
      });
    }
    // 不合格明细（列出原因，便于返工；不含上面已列出的兜底关卡，避免重复）
    var auditFail = results.filter(function(r) { return r.valid && (!r.audit || !r.audit.pass) && !r.fallback; });
    if (auditFail.length) {
      md += '\n## 不合格明细（' + auditFail.length + '）\n';
      auditFail.forEach(function(r) {
        var a = r.audit || { reasons: ['无审核数据'] };
        md += '- ' + r.name + '：' + (a.reasons.join('；') || '不合格') + '\n';
      });
    }
    files.push({ name: '关卡数据/生产报告.md', text: md });

    // 打包（默认中文包名；自定义名保留原样）。注意：不再自动下载——打包好后存到 genPendingZip，
    //   显示「下载关卡包」按钮，由用户点击才落盘(genDownloadPending)。避免生产一完成就弹下载框。
    var nameInput = document.getElementById('batch-zip-name');
    var zipName = (nameInput && nameInput.value.trim()) ? safeName(nameInput.value.trim()) : ('蚂蚁关卡包_' + results.length + '关_' + auditPass.length + '合格');
    var blob = AntSolver.Zip.create(files);
    genPendingZip = { blob: blob, filename: zipName + '.zip', fileCount: files.length };
    var dlBtn = document.getElementById('btn-gen-download');
    if (dlBtn) { dlBtn.classList.remove('hidden'); dlBtn.disabled = false; dlBtn.textContent = '⬇ 下载关卡包 ZIP'; }
    var hintEl = document.getElementById('gen-download-hint');
    if (hintEl) hintEl.textContent = '已打包 ' + zipName + '.zip（关卡/ + txt图/ + 关卡数据/），点击左侧按钮下载';
    if (curEl) curEl.textContent = '生产完成，待下载：' + zipName + '.zip';
    genLog('生产完成，已打包 ' + zipName + '.zip，点「下载关卡包」保存', 'gen-log-ok');
  }

  // 点击「下载关卡包」按钮：把收尾时打包好的 ZIP 落盘(唯一触发下载的入口，生产过程不自动下载)
  function genDownloadPending() {
    if (!genPendingZip) { alert('还没有可下载的关卡包，请先完成一次批量生产。'); return; }
    var url = URL.createObjectURL(genPendingZip.blob);
    var a = document.createElement('a');
    a.href = url; a.download = genPendingZip.filename;
    a.style.display = 'none';
    document.body.appendChild(a);   // 部分浏览器要求 <a> 在文档内 .click() 才生效
    a.click();
    // 关键修复：整批 ZIP 较大时，若同一时刻立即 revokeObjectURL，浏览器往往还没开始读取 blob，
    //   下载会被悄悄中断——表现就是"点了下载没反应、还停在生产界面"。改为延后 revoke + 移除临时 <a>，确保下载真正开始。
    setTimeout(function () { URL.revokeObjectURL(url); if (a.parentNode) a.parentNode.removeChild(a); }, 60000);
    genLog('已开始下载 ' + genPendingZip.filename, 'gen-log-ok');
    var hintEl = document.getElementById('gen-download-hint');
    if (hintEl) hintEl.textContent = '已开始下载 ' + genPendingZip.filename + '（如需再次保存可再点一次）';
  }

  // 由 blocks 还原 TXT（空格=0，用于无原始 txt 的关卡）
  function blocksToTXT(blocks) {
    return blocks.map(function(row) { return row.map(function(v) { return v > 0 ? v : 0; }).join(' '); }).join('\n');
  }

  // ==================== 生成器页面：结果表(排序/分组，仅影响展示，不影响导出数据) ====================
  function genTierLabel(r) {
    if (r.fallback) return r.fallbackType === 'timeout' ? '兜底·超时' : '兜底·穷尽';
    if (!r.valid) return '不可解';
    return (r.audit && r.audit.tier) || '不合格';
  }
  function genTierClass(r) {
    if (r.fallback) return 'gen-tier-fallback';
    if (!r.valid) return 'gen-tier-fail';
    if (r.audit && r.audit.tier === '困难合格') return 'gen-tier-hard';
    if (r.audit && r.audit.tier === '简单合格') return 'gen-tier-easy';
    return 'gen-tier-fail';
  }
  /**
   * 【v142】结果表随生产【实时刷新】。
   *
   * 原来结果表只在整批结束时才渲染一次 —— 一批几十关要跑十几分钟，期间「生产结果」那张卡片
   * 一直是 hidden、表里一行都没有，用户会以为"没有这个功能"。
   * 现在每落一关就刷新一行；并保留滚动位置，避免往下翻看时被拽回顶部。
   */
  function genRenderResultsLive() {
    var card = document.getElementById('gen-result-card');
    if (card) card.classList.remove('hidden');
    var cntEl = document.getElementById('gen-result-count');
    if (cntEl) cntEl.textContent = '（进行中：本批 ' + genBatchResults.length + ' 关 · 表内累计 ' + genResultHistory.filter(function (x) { return !x.__batch; }).length + ' 关）';
    var body = document.getElementById('gen-result-body');
    var keepTop = body ? body.scrollTop : 0;
    renderGenResultTable(genResultHistory, true);   // 【v153】渲染跨批次历史（含批次头）
    if (body) body.scrollTop = keepTop;
  }

  function renderGenResultTable(results, withBatchHeads) {
    var body = document.getElementById('gen-result-body');
    if (!body) return;
    if (!results || !results.length) { body.innerHTML = ''; return; }
    // 【v153】带批次头模式：批次头原样插在它的关卡行之前（历史累积展示用）
    if (withBatchHeads) {
      // 跨批次历史：按批次分段，段内仍按「排序」下拉排（批次之间不打乱顺序，方便上下对比）
      var sortBy0 = (document.getElementById('gen-result-sort') || {}).value || 'order';
      var segs = [], cur = { head: null, rows: [] };
      for (var hi = 0; hi < results.length; hi++) {
        var it = results[hi];
        if (it.__batch) { if (cur.head || cur.rows.length) segs.push(cur); cur = { head: it.label, rows: [] }; continue; }
        cur.rows.push(it);
      }
      segs.push(cur);
      var html = '', orderN = 0;
      genResultRows = [];                       // 【v153】重建：按钮以 data-rec 指向本表下标
      segs.forEach(function (sg) {
        if (sg.head) html += '<div class="gen-result-batch" style="margin:6px 0 2px;font-size:11px;color:#8a7358;border-top:1px dashed #d8c8b0;padding-top:4px">' + sg.head + '</div>';
        var rs = sg.rows.slice();
        rs.sort(function (a, b) {
          if (sortBy0 === 'name') return String(a.name).localeCompare(String(b.name), 'zh');
          if (sortBy0 === 'difficulty-desc') return (b.difficulty || 0) - (a.difficulty || 0);
          if (sortBy0 === 'difficulty-asc') return (a.difficulty || 0) - (b.difficulty || 0);
          return 0;
        });
        rs.forEach(function (r2) { genResultRows.push(r2); html += rowHtml({ r: r2, order: orderN++ }); });
      });
      body.innerHTML = html;
      return;
    }
    var sortBy = (document.getElementById('gen-result-sort') || {}).value || 'order';
    var groupBy = (document.getElementById('gen-result-group') || {}).value || 'none';
    var items = results.map(function (r, i) { return { r: r, order: i }; });
    items.sort(function (a, b) {
      if (sortBy === 'name') return String(a.r.name).localeCompare(String(b.r.name), 'zh');
      if (sortBy === 'difficulty-desc') return (b.r.difficulty || 0) - (a.r.difficulty || 0);
      if (sortBy === 'difficulty-asc') return (a.r.difficulty || 0) - (b.r.difficulty || 0);
      return a.order - b.order;
    });

    genResultRows = [];   // 每渲染一次重建（按钮以 data-rec 指向本表下标）
    function rowHtml(x) {
      var r = x.r;
      var ri = genResultRows.length; genResultRows.push(r);
      // 【v140】「带入棋盘」：把关卡直接装进模拟器，省掉「导出 → 导入关卡包 → 重算压力图」三步。
      //   被前置闸门拦下的源图（没有关卡结构）不显示按钮，改成一句说明，避免点了没反应。
      var act = r.level
        ? '<button class="gen-result-load" data-rec="' + ri + '" title="把关卡直接载入模拟器棋盘（连同生成时的入口模式、压力样本与卡点信息一起带过去），不用先导出再导入">🎮 带入棋盘</button>'
        : '<span class="gen-result-load off" title="这一关被前置闸门拦下，没有关卡结构可载入">无结构</span>';
      return '<div class="gen-result-row">' +
        '<span class="gen-tier-dot ' + genTierClass(r) + '"></span>' +
        '<span class="gen-result-name" title="' + r.name + '">' + r.name + '</span>' +
        '<span class="gen-result-tier">' + genTierLabel(r) + '</span>' +
        '<span class="gen-result-diff">' + (r.valid ? (r.difficulty + '[' + r.grade + ']') : '-') + '</span>' +
        act +
        '</div>';
    }

    var html = '';
    if (groupBy === 'none') {
      items.forEach(function (x) { html += rowHtml(x); });
    } else {
      var groups = {}, order = [];
      items.forEach(function (x) {
        var key = groupBy === 'tier' ? genTierLabel(x.r) : (x.r.valid ? x.r.grade : '不可解');
        if (!groups[key]) { groups[key] = []; order.push(key); }
        groups[key].push(x);
      });
      order.forEach(function (key) {
        html += '<div class="gen-result-group-head">' + key + ' <span>(' + groups[key].length + ')</span></div>';
        groups[key].forEach(function (x) { html += rowHtml(x); });
      });
    }
    body.innerHTML = html;
  }

  /**
   * 【v140】生成结果 → 直接带入棋盘（用户 2026-10-15：「生成器生成之后，能不能加入直接带入棋盘」）。
   *
   * 以前要看刚生产出来的关卡，必须「下载 ZIP / 导出 JSON」→ 切到模拟器 →「导入关卡包」→ 等它重算
   * 两幅压力图。这里把这四步并成一步：直接把该关的结构装进模拟器并进入模拟态。
   *
   * 一并带过去的三样生成侧信息（导入路径拿不到，因为关卡本体不含它们）：
   *   · 入口模式（四边 / 仅底部 / 瞬时连锁）—— 必须同步到「消除模式」下拉，
   *     否则底部模式生产的关卡会被当成四边入口来玩，看到的局面是错的；
   *   · 生成时的全知/玩家压力样本 —— 直接复用，压力图秒出，且与生产报告里的曲线是同一份数据；
   *   · 卡点类型与位置 —— 关卡信息面板照生产期口径显示。
   *
   * 兜底关与不合格关同样可载入：它们有完整结构，正是需要人工看看"到底差在哪"的那一批。
   */
  function genLoadToBoard(rec) {
    if (!rec) return;
    if (!rec.level) { alert('这一关被前置闸门拦下，没有关卡结构可载入。'); return; }
    if (!genMapToBoard(rec, true)) alert('载入失败：这一关没有可用的棋盘结构。');
  }

  /**
   * 【v144】把关卡装到中间棋盘 —— 「带入模拟」与「生成后自动映射」共用这一条路径。
   *   enterSim=false：只装到棋盘（留在生成器模式，便于一边生产一边看棋盘）
   *   enterSim=true ：装完并进入模拟游玩（结果行的「🎮 带入棋盘」）
   * 返回是否装载成功。
   */
  function genMapToBoard(rec, enterSim) {
    if (!rec || !rec.level) return false;
    var lv;
    try { lv = AntSolver.parseLevel(rec.level); }
    catch (e) { return false; }
    if (!lv || !lv.board || !lv.board.rows) return false;

    if (enterSim) { stopAutoPlay(); stopAnim(); stopFlash(); stopLive(); }
    // loadLevel 会把三项生成侧缓存清空、并把入口模式复位成四边 —— 所以赋值必须【在它之后】。
    loadLevel(lv);
    currentEntryMode = rec.entryMode || 'fourSide';
    syncElimModeSelect(elimModeOfEntry(currentEntryMode));
    currentGenerationEval = rec.generationEval || null;
    currentImportedSolve = (rec.solve && rec.solve.pressureSamples && rec.solve.pressureSamples.length) ? {
      completed: !!rec.solve.completed, steps: rec.solve.steps, maxBuffer: rec.solve.maxBuffer,
      progress: rec.solve.progress, pressureSamples: rec.solve.pressureSamples,
      stepStats: rec.solve.stepStats || [],           // 【v147】逐次取盒图要用
      pickOrder: rec.solve.pickOrder || []
    } : null;
    // 卡点信息：口径与生成路径的 chokeInfoOf(result) 一致，只是数据来自落库前的 rec。
    currentChokeInfo = (rec.chokeMarks || rec.chokePlan) ? {
      plan: rec.chokePlan ? {
        count: rec.chokeCount || 0, pool: rec.chokePlan.pool, expected: rec.chokePlan.expected,
        cn: rec.chokeTypesCN || []
      } : null,
      marks: rec.chokeMarks || null,
      dropped: (rec.chokeFallback && rec.chokeFallback.dropped) || null
    } : null;
    renderLevelInfo();   // 重渲染一次，把上面三项（入口模式/卡点信息）带进「关卡信息」面板
    if (enterSim) enterSimulation();   // 【v150】右栏会随 simulating 自动切成模拟控制
    return true;
  }

  // ==================== 【v156】关卡体检（卡点判据 v2 · 只读报告） ====================
  // 需求来源（用户 2026-10-16 口述，见 01_交接文档/工作日志_20261012.md 第二十五节）：
  //   · 独木桥：场上**只有 1 个方块能点**（其余被数字冰锁/链锁/不可达挡住）→ 一关最多 1 处；
  //     **按"步"计**（点 A 解锁 B、再解锁 C 那种走廊算多处）；末段豁免。
  //   · 预算判断点（R9）：可点 ≥2，但"取了立刻能消掉（不占暂存）"的选项**恰 1 个**，
  //     且至少有 1 个"取了会占暂存位"的陷阱项 —— 这是用户要刻意做的核心体验。
  //   · 无满解步数：这一步一个都消不掉、必须硬垫 → 要少（好关 1~3 步）。
  //   · 暂存 ≥4 的高压尽量留在 70% 之后。
  //   · 两条线（全知线 / 玩家线）都测，判据**取较差的那条**（用户 2026-10-16 定：「取最差吧」）。
  //
  // ⚠ 本功能【只读】：不生成、不写盘、不改关卡；门槛一律是"参考门"（阈值由用户认可的好关反推），
  //   等用户确认阈值后才接进生产合格判定。**没有任何新参数入口**（用户明确不想再调参数）。
  var AUDIT_V2_TAIL_PCT = 0.90;    // 末段豁免：进度 ≥90%
  var AUDIT_V2_TAIL_BOXES = 3;     // 末段豁免：棋盘剩余盒总数 ≤3
  // 参考门（从"小鹿"这一关反推的初值；样本少，待用户再多给几关好关后校准）
  var AUDIT_V2_GATES = { bridgeMax: 1, r9Min: 12, noGoodMax: 3, hiBefore70PctMax: 10, early34MinPct: 20 };
  var lastChokeAudit = null;

  /** 沿一条既定路线（pickOrder）逐步回放，量出这条线上的指标。 */
  function auditV2MeasureLine(lv, order) {
    var S = AntSolver.Simulator;
    if (!S || !S.enter || !S.listMoves || !S.applyPick || !order || !order.length) return null;
    var st;
    try { st = S.enter(lv, { useSlotStart: true }); } catch (e) { return null; }
    var n = 0, bridges = 0, bridgeAt = [], run = 0, maxRun = 0, soft = 0, r9 = [];
    var minPick = 99, buf34 = 0, buf4 = 0, hiBefore70 = 0, stepsBefore70 = 0, noGood = 0;
    var earlySteps = 0, early34 = 0;   // 【v159】0~30% 段：步数 与 其中暂存落在 3~4 的步数
    try {
      for (var i = 0; i < order.length; i++) {
        var p = order[i];
        if (!p || p.r == null) continue;
        var moves = S.listMoves(st);
        var pickable = moves.length, safe = 0, good = 0, traps = 0;
        for (var j = 0; j < moves.length; j++) {
          var m = moves[j];
          if (m.blocked) continue;
          safe++;
          if (m.canConsume) good++; else traps++;
        }
        var prog = st.totalBoxes ? (st.completedBoxes / st.totalBoxes) : 0;
        var leftBoxes = 0;
        for (var r = 0; r < st.boardRows; r++) for (var c = 0; c < st.boardCols; c++) {
          var cc = st.cells[r][c]; if (cc && cc.t === 'box') leftBoxes++;
        }
        var tail = (prog >= AUDIT_V2_TAIL_PCT) || (leftBoxes <= AUDIT_V2_TAIL_BOXES);
        var buf = st.buffer.length, pc = Math.round(prog * 100);
        n++;
        if (buf >= 3 && buf <= 4) buf34++;
        if (buf >= 4) buf4++;
        if (prog < 0.70) { stepsBefore70++; if (buf >= 4) hiBefore70++; }
        if (prog < 0.30) { earlySteps++; if (buf >= 3 && buf <= 4) early34++; }   // 【v159】前期限压
        if (pickable < minPick) minPick = pickable;
        if (pickable === 1) {                    // 独木桥：按步计（末段豁免）
          if (!tail) { bridges++; bridgeAt.push(pc); }
          run++; if (run > maxRun) maxRun = run;
        } else run = 0;
        if (pickable >= 2 && safe === 1) soft++;               // 软独木桥（只记录，不设门）
        if (pickable >= 2 && good === 1 && traps >= 1) r9.push(pc);   // 预算判断点 R9
        if (good === 0) noGood++;                              // 一个都消不掉 → 必须硬垫
        S.applyPick(st, p.r, p.c);                             // 锁链组已整组拿走的情形会返回 false，忽略即可
        if (st.gameOver) break;
      }
    } catch (e) { /* 回放中断：用已采到的部分，不伪造 */ }
    if (!n) return null;
    return {
      steps: n, bridges: bridges, bridgeAt: bridgeAt, maxRun: maxRun, soft: soft,
      r9: r9.length, r9At: r9, minPick: minPick === 99 ? 0 : minPick,
      buf34Pct: Math.round(buf34 / n * 100), buf4Pct: Math.round(buf4 / n * 100),
      hiBefore70Pct: stepsBefore70 ? Math.round(hiBefore70 / stepsBefore70 * 100) : 0,
      noGood: noGood,
      earlySteps: earlySteps, early34: early34,
      early34Pct: earlySteps ? Math.round(early34 / earlySteps * 100) : 0
    };
  }

  /** 一关体检：全知线 + 玩家线各量一遍，再按"取最差"合成一组判据值。 */
  /**
   * 【v176】第三条线「贪心玩家」的一关报告（垫槽 / 赌管道 / 峰窗）。
   *   只在**生产出一关之后**与**关卡体检**时各算一次（一次 ~几十毫秒），**不进候选循环** ——
   *   所以生成速度与生成结果都不受它影响（用户正在手测 v174/v175 的关，不能让度量把它搅了）。
   *   口径陷阱（见 generator.js 里 chokeV2GreedyLine 的注释）：贪心线会"走完棋盘但收尾卡死"，
   *   中途真卡死的关（覆盖 <100%）峰窗会被低估 → 只报数、不进"取最差"的判定。
   */
  function greedyLineReport(lv) {
    var G = AntSolver.Generator;
    if (!G || !G.chokeV2GreedyLine || !lv) return null;
    var g = null;
    try { g = G.chokeV2GreedyLine(lv); } catch (e) { g = null; }
    if (!g) return null;
    var a = null;
    try {
      a = (AntSolver.Analysis && AntSolver.Analysis.chokepointAudit)
        ? AntSolver.Analysis.chokepointAudit(g.samples || [], lv.totalBoxes || 0, lv.bufferLimit || 5) : null;
    } catch (e) { a = null; }
    return {
      pads: g.pads, pipeBets: g.pipeBets, pipeBetBufMax: g.pipeBetBufMax, pipeBetWhileFull: g.pipeBetWhileFull,
      won: g.won, steps: g.steps, coveragePct: g.coveragePct,
      lateMax: a ? a.lateMax : null, peakBuf: a ? a.peakBuf : null
    };
  }
  /**
   * 【v176】把贪心线一行打进实时日志（**单关生成**与**批量生产**共用，两处都要能看见）。
   *   它不是"再判一次合格"，而是回答两个问题：
   *   ① 这关会不会逼真人先垫（暂存压力真不真）；② 会不会逼真人在**快满槽**时去赌管道（用户 R6）。
   */
  /**
   * 【v184】好关判据 v3 的收尾标记（由生成器 finalizeProduce 打，18 局口径）。
   *   只报数、不影响生产；六条全过 = ✅，否则列出未过项。
   */
  function genLogGoodV3(res) {
    try {
      var g = res && res.goodV3;
      if (!g) return;
      genLog('　　好关v3　' + (g.pass ? '✅ 6/6 全过' : ('✗ ' + g.fails.join('、'))) +
        '　· 稳健 ' + (g.steadyWonPct == null ? '-' : g.steadyWonPct + '%') +
        ' · 峰窗 ' + (g.midLateMax == null ? '-' : g.midLateMax) +
        (g.peakMin != null ? '(' + g.peakMin + '~' + g.peakMax + ')' : '') +
        ' · 被埋 ' + (g.buried == null ? '-' : g.buried) +
        // 【v325】玩家通关率（10 局不同手痒度、不给复活）。只有其它条全过时才会真跑，
        //   没过其它条的关这里显示 '-'（省时间）。
        ' · 玩家 ' + ((g.persist && g.persist.playerPassPct != null) ? (g.persist.playerPassPct + '%') : '-') +
        ' · 主死因 ' + ((g.persist && g.persist.deathTop) ? (g.persist.deathTop + (g.persist.deathTopPct != null ? ' ' + g.persist.deathTopPct + '%' : '')) : '-') +
        ' · 策略差 ' + (g.spreadPct == null ? '-' : g.spreadPct) +
        ' · 前期 ' + (g.earlyMax == null ? '-' : g.earlyMax),
        g.pass ? 'gen-log-ok' : 'gen-log-warn');
    } catch (eG) { /* 度量失败不影响生产 */ }
  }
  function genLogGreedyLine(level) {
    try {
      var gRep = level ? greedyLineReport(AntSolver.parseLevel(level)) : null;
      if (!gRep) return;
      genLog('　　贪心线　峰窗 ' + (gRep.lateMax == null ? '-' : gRep.lateMax) +
        '（峰值 ' + (gRep.peakBuf == null ? '-' : gRep.peakBuf) + '）· 覆盖 ' + gRep.coveragePct + '% · ' +
        (gRep.won ? '走通' : '收尾卡死') +
        ' · 垫槽 ' + gRep.pads + ' 次 · 赌管道口 ' + gRep.pipeBets + ' 次' +
        (gRep.pipeBetWhileFull ? ('　⚠ 其中"只剩 1 个空位还得赌" ' + gRep.pipeBetWhileFull + ' 步') : ''),
        gRep.pipeBetWhileFull ? 'gen-log-warn' : '');
    } catch (eG) { /* 度量失败不影响生产 */ }
  }
  /**
   * 【v177】"同一关玩 N 遍"的报告（用户 2026-10-17：「你看怎么做」→ 第 1 步"把玩 100 遍做出来"）。
   *   换玩家性格 × 换随机种子跑 16 局，出**区间**：峰窗最小~最大、通关数、结束位置分布。
   *   读法：区间窄 = 这关稳定（压力是设计出来的）；区间宽 = 看运气（压力来自抽样）。
   */
  var playBatchCache = new Map();
  function playBatchReport(lv, n) {
    var G = AntSolver.Generator;
    if (!G || !G.chokeV2PlayBatch || !lv) return null;
    var N = n || 16;
    var hit = playBatchCache.get(lv);
    if (hit && hit.n === N) return hit;
    var b = null;
    try { b = G.chokeV2PlayBatch(lv, { n: N }); } catch (e) { b = null; }
    if (b) playBatchCache.set(lv, b);
    return b;
  }
  function genLogPlayBatch(level) {
    try {
      if (!level) return;
      var b = playBatchReport(AntSolver.parseLevel(level), 18);
      if (!b) return;
      var f = function (x) { return x == null ? '-' : x; };
      var spread = (b.lateMax.max != null && b.lateMax.min != null) ? +(b.lateMax.max - b.lateMax.min).toFixed(1) : null;
      genLog('　　玩' + b.n + '遍　' + policyLineOf(b) +
        ' · 峰窗 ' + f(b.lateMax.min) + '~' + f(b.lateMax.max) + '（均 ' + f(b.lateMax.mean) + '）' +
        (spread != null && spread >= 1.5 ? (' ⚠ 波动 ' + spread + ' 个点=看运气') : '') +
        (b.spreadPct != null && b.spreadPct >= 50 ? (' ⚠ 策略差 ' + b.spreadPct + ' 个点=稳健玩家被坑') : ''),
        (b.steadyWonPct != null && b.steadyWonPct < 50) || (b.spreadPct != null && b.spreadPct >= 50)
          ? 'gen-log-warn' : 'gen-log-ok');
      // 【v179】可疑关（稳健被坑）再走一次机制归因：拿掉一种功能块重玩，看通关率回升多少
      var at = attributeReport(AntSolver.parseLevel(level), b);
      if (at) {
        var detail = at.items.filter(function (x) { return x.kind !== 'all'; })
          .map(function (x) { return x.cn + (x.deltaWon >= 0 ? '+' : '') + x.deltaWon; }).join('、');
        genLog('　　归因　' + attrLineOf(at) + (detail ? ('　（单拿各：' + detail + '）') : ''),
          (at.main && at.main.deltaWon > 0) ? 'gen-log-warn' : '');
      }
      // 【v180】矿脉层表（只由图决定）+ 卡死账（这条路线到底欠在哪）
      var vr = veinReport(AntSolver.parseLevel(level));
      if (vr) {
        var stl = stuckLineOf(b.stuck);
        var bu = buriedOf(AntSolver.parseLevel(level));
        genLog('　　矿脉　' + veinLineOf(vr) + (bu ? ('　· 被埋 ' + bu.buried + ' 辆') : '') +
          (stl ? ('　· 卡死账：' + stl) : '　· 没卡死'),
          (bu && bu.buried >= 3) || stl ? 'gen-log-warn' : 'gen-log-ok');
      }
    } catch (ePB) { /* 度量失败不影响生产 */ }
  }
  /** 「稳健 5/6 · 冒险 3/6 · 乱点 4/6」——按玩家类型分开报，别把不同打法混成一个数。 */
  function policyLineOf(b) {
    var names = { steady: '稳健', bold: '冒险', random: '乱点' };
    var out = [];
    (b.byPolicy || []).forEach(function (x) {
      out.push((names[x.policy] || x.policy) + ' ' + x.won + '/' + x.n);
    });
    return out.join(' · ') || ('通关 ' + (b.finish ? b.finish.win : '?') + '/' + b.n);
  }
  /**
   * 【v179】机制归因（只对"稳健被坑"的关跑，省时间）：拿掉一种功能块重玩，看通胜率回升多少。
   *   缓存按关卡对象存，体检表格与 CSV 共用一份结果。
   */
  var attrCache = new Map();
  function attributeReport(lv, pb) {
    var G = AntSolver.Generator;
    if (!G || !G.chokeV2Attribute || !lv) return null;
    // 只在"可疑"时归因：稳健通关 <50%，或三种打法差距 ≥50 个点
    var need = pb && ((pb.steadyWonPct != null && pb.steadyWonPct < 50) ||
                      (pb.spreadPct != null && pb.spreadPct >= 50));
    if (!need) return null;
    var hit = attrCache.get(lv);
    if (hit) return hit;
    var a = null;
    try { a = G.chokeV2Attribute(lv, { per: 6 }); } catch (e) { a = null; }
    if (a) attrCache.set(lv, a);
    return a;
  }
  /** 归因一句话：主因 / 叠加型 / 不是功能块（→ 在切球·容量·摆位）。 */
  function attrLineOf(at) {
    if (!at || !at.items || !at.items.length) return '';
    if (at.baseline && at.baseline.wonPct >= 50) return '';
    var all = null, singles = [];
    at.items.forEach(function (x) { if (x.kind === 'all') all = x; else singles.push(x); });
    singles.sort(function (a, b) { return b.deltaWon - a.deltaWon; });
    var best = singles.length ? singles[0] : null;
    var allD = all ? all.deltaWon : 0, bestD = best ? best.deltaWon : 0;
    if (bestD <= 0 && allD <= 0) return '不是功能块（拿掉全部仍无回升）→ 在切球/容量/摆位';
    if (allD > bestD) return '叠加型：全拿掉 +' + allD + '（单拿最多 +' + bestD + '）';
    return '主因 ' + best.cn + ' +' + bestD + '（全拿掉 +' + allD + '）';
  }
  /**
   * 【v180】矿脉层表（只由图决定，与玩家/切法无关）：几条矿脉、最深第几层、每层多少像素。
   *   这是"拆图"的第一个坐标：层越深 = 越晚才能碰到；最深层的像素就是"最后才开门"的那批。
   */
  var veinCache = new Map();
  function veinReport(lv) {
    var G = AntSolver.Generator;
    if (!G || !G.veinLayers || !lv) return null;
    var hit = veinCache.get(lv);
    if (hit) return hit;
    var v = null;
    try { v = G.veinLayers(lv, {}); } catch (e) { v = null; }
    if (v) veinCache.set(lv, v);
    return v;
  }
  function veinLineOf(v) {
    if (!v) return '';
    var deepest = 0;
    for (var k in v.byLevel) { var lv2 = +k; if (lv2 < 99 && lv2 > deepest) deepest = lv2; }
    var px = v.pxByLevel[deepest] || 0;
    return v.count + ' 条 · 最深 ' + deepest + ' 层（该层 ' + px + 'px）';
  }
  /** 【v182】被埋辆数（一局稳健玩家的终局统计）；≥3 = 61 号关那种"稳健必死"结构。 */
  var buriedCache = new Map();
  function buriedOf(lv) {
    var G = AntSolver.Generator;
    if (!G || !G.buriedCountOf || !lv) return null;
    var hit = buriedCache.get(lv);
    if (hit !== undefined) return hit;
    var b = null;
    try { b = G.buriedCountOf(lv); } catch (e) { b = null; }
    buriedCache.set(lv, b);
    return b;
  }
  /** 卡死账一句话：色X 还差 a / 盘上剩 b / 可达 c（取最狠的一条）。 */
  function stuckLineOf(stuck) {
    if (!stuck || !stuck.length) return '';
    var s = stuck[0];
    var verdict = (s.reachable > 0)
      ? '还有救'
      : (s.boardLeft >= s.needLeft ? '被埋（够得着 0 个）' : '不够（盘上比它要的还少）');
    return '色' + s.color + ' 还差 ' + s.needLeft + ' / 盘上剩 ' + s.boardLeft + ' / 可达 ' + s.reachable + ' → ' + verdict;
  }
  function auditV2OfLevel(lv, em) {
    var omni = null, pl = null;
    try { omni = solveByEntryMode(lv, em); } catch (e) { omni = null; }
    try { if (AntSolver.PlayerSim) pl = AntSolver.PlayerSim.run(lv, Object.assign({ seed: 7 }, playerOptsOfEntry(em))); } catch (e) { pl = null; }
    var mo = omni ? auditV2MeasureLine(lv, omni.pickOrder || []) : null;
    var mp = pl ? auditV2MeasureLine(lv, pl.pickOrder || []) : null;
    if (!mo && !mp) return null;
    var worst = {   // 取最差：坏的取大、好的取小
      bridges: Math.max(mo ? mo.bridges : -1, mp ? mp.bridges : -1),
      maxRun: Math.max(mo ? mo.maxRun : -1, mp ? mp.maxRun : -1),
      noGood: Math.max(mo ? mo.noGood : -1, mp ? mp.noGood : -1),
      hiBefore70Pct: Math.max(mo ? mo.hiBefore70Pct : -1, mp ? mp.hiBefore70Pct : -1),
      early34Pct: Math.min(mo ? mo.early34Pct : 999, mp ? mp.early34Pct : 999),   // 【v159】下限指标→取小
      r9: Math.min(mo ? mo.r9 : 1e9, mp ? mp.r9 : 1e9),
      minPick: Math.min(mo ? mo.minPick : 99, mp ? mp.minPick : 99)
    };
    if (worst.r9 >= 1e9) worst.r9 = 0;
    if (worst.early34Pct >= 999) worst.early34Pct = 0;
    if (worst.minPick >= 99) worst.minPick = 0;
    var gd = null;
    try { gd = greedyLineReport(lv); } catch (e) { gd = null; }   // 【v176】第三条线（只报数）
    var pb = null;
    try { pb = playBatchReport(lv, 16); } catch (e) { pb = null; }   // 【v177】同一关玩 16 遍
    var at = null;
    try { at = attributeReport(lv, pb); } catch (e) { at = null; }     // 【v179】机制归因（只对可疑关跑）
    var vr = null;
    try { vr = veinReport(lv); } catch (e) { vr = null; }               // 【v180】矿脉层表
    return { omni: mo, player: mp, greedy: gd, playBatch: pb, attr: at, vein: vr, worst: worst };
  }

  /** 违反项（参考门；阈值集中在上面的 AUDIT_V2_GATES）。 */
  function auditV2Violations(w) {
    var v = [];
    if (w.bridges > AUDIT_V2_GATES.bridgeMax) v.push('独木桥×' + w.bridges + '处');
    if (w.r9 < AUDIT_V2_GATES.r9Min) v.push('预算判断点仅' + w.r9 + '处');
    if (w.noGood > AUDIT_V2_GATES.noGoodMax) v.push('无满解' + w.noGood + '步');
    if (w.hiBefore70Pct > AUDIT_V2_GATES.hiBefore70PctMax) v.push('70%前≥4占' + w.hiBefore70Pct + '%');
    if (w.early34Pct < AUDIT_V2_GATES.early34MinPct) v.push('前期限压仅' + w.early34Pct + '%');
    return v;
  }

  /**
   * 关卡体检：把左侧关卡列表里【有关卡的条目】逐关体检，出表格 + CSV。
   * 只有 TXT 图（还没生产出关卡）的条目【跳过并计数】—— 现场生成一关再体检既慢又误导
   * （那条路径用的是最老的生成流程，跟你「批量生产」得到的不是同一关）。
   */
  function runChokeAudit() {
    if (!AntSolver.Simulator || !AntSolver.Solver) { alert('模拟/求解模块未加载'); return; }
    if (!levelList.length) { alert('请先导入目标图（TXT）或导入关卡包'); return; }
    var card = document.getElementById('choke-audit-card');
    var body = document.getElementById('choke-audit-body');
    if (card) card.classList.remove('hidden');
    if (body) body.innerHTML = '<p style="color:#888">体检中…</p>';
    var rows = [], skipped = 0, idx = 0, t0 = Date.now();
    function next() {
      if (idx >= levelList.length) { renderChokeAudit(rows, skipped, Date.now() - t0); return; }
      var en = levelList[idx];
      if (body) body.innerHTML = '<p style="color:#888">体检 ' + (idx + 1) + '/' + levelList.length + '：' + en.name + '</p>';
      setTimeout(function () {
        try {
          if (en.level) {
            var lv = AntSolver.parseLevel(en.level);
            var em = en.entryMode || 'fourSide';
            var m = auditV2OfLevel(lv, em);
            if (m) rows.push({ name: en.name, em: em, boxes: lv.totalBoxes, level: m,
                               difficulty: (en.difficulty && en.difficulty.score != null) ? en.difficulty.score : null });
          } else skipped++;
        } catch (e) { skipped++; }
        idx++; next();
      }, 0);
    }
    next();
  }

  function renderChokeAudit(rows, skipped, ms) {
    var body = document.getElementById('choke-audit-body');
    if (!body) return;
    lastChokeAudit = rows;
    if (!rows.length) {
      body.innerHTML = '<p class="fail">没有可体检的关卡（关卡列表里全是只有 TXT 图、还没生产出关卡的条目）' +
        (skipped ? '（跳过 ' + skipped + ' 张）' : '') + '</p>';
      return;
    }
    var passN = 0;
    rows.forEach(function (r) {
      r.violations = auditV2Violations(r.level.worst);
      if (!r.violations.length) passN++;
    });
    var g = AUDIT_V2_GATES;
    var html = '<div style="font-size:11px;color:#aaa;margin-bottom:6px">';
    html += '🔬 卡点判据 v2 · 两条线（全知/玩家）都测、判据<b>取最差</b> · 共 ' + rows.length + ' 关';
    if (skipped) html += ' · 跳过 ' + skipped + ' 张只有 TXT 的图（没关卡可体检）';
    html += ' · 参考门通过 <b style="color:' + (passN === rows.length ? '#8bc34a' : '#e0592c') + '">' + passN + '/' + rows.length + '</b>';
    html += ' · 用时 ' + Math.round(ms / 1000) + 's';
    html += ' <button id="btn-choke-audit-csv" style="margin-left:6px;padding:2px 8px;background:#6b4f34;color:#f3e9db;border:none;border-radius:3px;cursor:pointer">⬇ 体检报告CSV</button>';
    html += '<br>参考门（阈值从"小鹿"反推，待你确认）：非末段独木桥 ≤' + g.bridgeMax + ' 处 · 预算判断点 ≥' + g.r9Min +
      ' 处 · 无满解 ≤' + g.noGoodMax + ' 步 · 70% 之前 ≥4 占比 ≤' + g.hiBefore70PctMax + '% · 前期限压 ≥' + g.early34MinPct + '%</div>';
    html += '<div style="overflow:auto"><table style="border-collapse:collapse;font-size:11px;width:100%">';
    html += '<thead><tr style="background:#3a2c22;color:#f3e9db">' +
      ['关卡', '玩法', '盒', '独木桥(全知/玩家)', '最长走廊', '最低可点', '无满解(全/玩)', '预算点(全/玩)',
       '前期限压(全/玩)', '暂存3~4(全/玩)', '暂存≥4(全/玩)', '70%前≥4',
       '贪心线 峰窗/垫槽/赌管道', '18 遍波动', '归因', '矿脉（条/最深）', '卡死账', '参考门判定'].map(function (h) {
        return '<th style="padding:3px 6px;border:1px solid #5a4636">' + h + '</th>';
      }).join('') + '</tr></thead><tbody>';
    rows.forEach(function (r) {
      var w = r.level.worst, o = r.level.omni, p = r.level.player, gd = r.level.greedy;   // 【v176】第三条线
      var pb = r.level.playBatch || null;                                                   // 【v177】16 遍波动
      var at = r.level.attr || null;                                                        // 【v179】机制归因
      var vr = r.level.vein || null;                                                        // 【v180】矿脉层表
      var pbSpread = (pb && pb.lateMax.max != null && pb.lateMax.min != null) ? +(pb.lateMax.max - pb.lateMax.min).toFixed(1) : null;
      var pbBad = !!(pb && ((pb.steadyWonPct != null && pb.steadyWonPct < 50) ||
                            (pb.spreadPct != null && pb.spreadPct >= 50) ||
                            (pbSpread != null && pbSpread >= 1.5)));
      var pair = function (a, b) { return (a == null ? '-' : a) + ' / ' + (b == null ? '-' : b); };
      var td = function (txt, bad, extra) {
        return '<td style="padding:3px 6px;border:1px solid #5a4636' +
          (bad ? ';color:#e0592c' : '') + (extra || '') + '">' + txt + '</td>';
      };
      var ok = !r.violations.length;
      html += '<tr>' +
        td(r.name + (r.difficulty != null ? ('<br><span style="color:#8a7358">难度 ' + r.difficulty + '</span>') : '')) +
        td(entryModeLabel(r.em)) + td(r.boxes) +
        td(pair(o ? o.bridges : null, p ? p.bridges : null), w.bridges > g.bridgeMax) +
        td(w.maxRun) + td(w.minPick) +
        td(pair(o ? o.noGood : null, p ? p.noGood : null), w.noGood > g.noGoodMax) +
        td(pair(o ? o.r9 : null, p ? p.r9 : null), w.r9 < g.r9Min) +
        td(pair(o ? o.early34Pct + '%' : null, p ? p.early34Pct + '%' : null), w.early34Pct < g.early34MinPct) +
        td(pair(o ? o.buf34Pct + '%' : null, p ? p.buf34Pct + '%' : null)) +
        td(pair(o ? o.buf4Pct + '%' : null, p ? p.buf4Pct + '%' : null)) +
        td(w.hiBefore70Pct + '%', w.hiBefore70Pct > g.hiBefore70PctMax) +
        td(gd ? ((gd.lateMax == null ? '-' : gd.lateMax) + ' / ' + gd.pads + ' / ' + gd.pipeBets +
             (gd.pipeBetWhileFull ? '<br><span style="color:#e0592c">满槽边缘还得赌 ' + gd.pipeBetWhileFull + ' 步</span>' : '') +
             '<br><span style="color:#8a7358">覆盖 ' + gd.coveragePct + '% · ' + (gd.won ? '走通' : '收尾卡死') + '</span>')
             : '（关掉v2时不测）', !!(gd && gd.pipeBetWhileFull)) +
        td(pb ? ((pb.lateMax.min == null ? '-' : pb.lateMax.min) + '~' + (pb.lateMax.max == null ? '-' : pb.lateMax.max) +
             '（均 ' + (pb.lateMax.mean == null ? '-' : pb.lateMax.mean) + '）' +
             '<br>' + policyLineOf(pb) +
             '<br><span style="color:#8a7358">卡死：中段' + pb.finish.mid + ' 前段' + pb.finish.front + '</span>' +
             (pbSpread != null && pbSpread >= 1.5 ? '<br><span style="color:#e0592c">波动 ' + pbSpread + ' 个点=看运气</span>' : '') +
             (pb.spreadPct != null && pb.spreadPct >= 50 ? '<br><span style="color:#e0592c">策略差 ' + pb.spreadPct + ' 个点=稳健被坑</span>' : ''))
             : '-', pbBad) +
        td(at ? attrLineOf(at) : (pb ? '<span style="color:#8a7358">稳，不用归因</span>' : '-'),
           !!(at && at.main && at.main.deltaWon > 0)) +
        td(vr ? veinLineOf(vr) : '-') +
        td(pb && pb.stuck ? ('<span style="color:#e0592c">' + stuckLineOf(pb.stuck) + '</span>') : '—', !!(pb && pb.stuck)) +
        td(ok ? '✓ 通过' : '✗ ' + r.violations.join('、'), !ok) +
        '</tr>';
    });
    html += '</tbody></table></div>';
    html += '<div style="font-size:11px;color:#8a7358;margin-top:6px">独木桥 = 场上只有 1 个方块能点（按"步"计，点 A 解锁 B 那种走廊算多处）；末段（进度 ≥90% 或剩余盒 ≤3）豁免。' +
      '预算判断点 = 可点 ≥2，但"取了立刻能消掉"的选项恰 1 个、其余是"取了会占暂存位"的陷阱项。' +
      '前期限压 = 0~30% 进度段里暂存落在 3~4 的步数占比（≥' + g.early34MinPct + '% 才算前期有预算压力）。' +
      '贪心线 = 第三条线（像真人：能消就消、消不掉先垫、没得挑时照拿管道口）= 唯一会"垫槽/赌管道"的线；' +
      '它的峰窗在"中途就卡死"的关上会被低估，所以<b>只报数、不进上面那套取最差判定</b>。' +
      '<b>16 遍波动</b> = 同一关换玩家性格（稳健/冒险/乱点）× 换随机种子玩 16 局：峰窗区间窄=这关稳定，' +
      '区间宽（≥1.5 个点）=压力来自运气；结束位置集中"收尾"=预算判断型，集中"中段"=路线被堵型。' +
      '最低可点数 ≥2 与"独木桥 0 处"等价，故只作显示、不重复计违反。</div>';
    body.innerHTML = html;
    var csvBtn = document.getElementById('btn-choke-audit-csv');
    if (csvBtn) csvBtn.addEventListener('click', exportChokeAuditCSV);
  }

  function exportChokeAuditCSV() {
    if (!lastChokeAudit || !lastChokeAudit.length) return;
    var head = ['关卡,玩法,盒数,独木桥_全知,独木桥_玩家,独木桥_取最差,最长走廊,最低可点,无满解_全知,无满解_玩家,无满解_取最差,预算点_全知,预算点_玩家,预算点_取最差,前期限压_全知%,前期限压_玩家%,前期限压_取最差%,暂存3to4_全知%,暂存3to4_玩家%,暂存4plus_全知%,暂存4plus_玩家%,70%前4plus占比%,贪心峰窗,贪心垫槽,贪心赌管道,贪心满槽边缘赌步数,贪心覆盖%,贪心结局,波动局数,稳健通关%,最好通关%,最差通关%,策略差%,波动峰窗最小,波动峰窗最大,波动峰窗均值,波动峰窗中位,卡死中段,卡死前段,归因,归因主因Δ%,全拿掉Δ%,矿脉条数,矿脉最深层,卡死账,独木桥位置,参考门,违反项,难度分'];
    var lines = head;
    lastChokeAudit.forEach(function (r) {
      var w = r.level.worst, o = r.level.omni, p = r.level.player, gd = r.level.greedy;   // 【v176】第三条线
      var pb = r.level.playBatch || null;                                                   // 【v177】16 遍波动
      var V = function (x) { return x == null ? '' : x; };
      lines.push(['"' + r.name + '"', '"' + entryModeLabel(r.em) + '"', r.boxes,
        V(o ? o.bridges : null), V(p ? p.bridges : null), w.bridges, w.maxRun, w.minPick,
        V(o ? o.noGood : null), V(p ? p.noGood : null), w.noGood,
        V(o ? o.r9 : null), V(p ? p.r9 : null), w.r9,
        V(o ? o.early34Pct : null), V(p ? p.early34Pct : null), w.early34Pct,
        V(o ? o.buf34Pct : null), V(p ? p.buf34Pct : null), V(o ? o.buf4Pct : null), V(p ? p.buf4Pct : null),
        w.hiBefore70Pct,
        V(gd ? gd.lateMax : null), V(gd ? gd.pads : null), V(gd ? gd.pipeBets : null),
        V(gd ? gd.pipeBetWhileFull : null), V(gd ? gd.coveragePct : null),
        '"' + (gd ? (gd.won ? '走通' : '收尾卡死') : '') + '"',
        V(pb ? pb.n : null), V(pb ? pb.steadyWonPct : null), V(pb ? pb.bestWonPct : null),
        V(pb ? pb.worstWonPct : null), V(pb ? pb.spreadPct : null),
        V(pb && pb.lateMax ? pb.lateMax.min : null), V(pb && pb.lateMax ? pb.lateMax.max : null),
        V(pb && pb.lateMax ? pb.lateMax.mean : null), V(pb && pb.lateMax ? pb.lateMax.p50 : null),
        V(pb ? pb.finish.mid : null), V(pb ? pb.finish.front : null),
        '"' + (r.level.attr ? attrLineOf(r.level.attr) : '') + '"',
        V(r.level.attr && r.level.attr.main ? r.level.attr.main.deltaWon : null),
        V(r.level.attr ? (r.level.attr.items.filter(function (x) { return x.kind === 'all'; })[0] || {}).deltaWon : null),
        V(r.level.vein ? r.level.vein.count : null),
        V(r.level.vein ? r.level.vein.maxLevel : null),
        '"' + ((r.level.playBatch && r.level.playBatch.stuck) ? stuckLineOf(r.level.playBatch.stuck) : '') + '"',
        '"' + ((o && o.bridgeAt.length) ? o.bridgeAt.join('/') + '%' : '') +
          ((p && p.bridgeAt.length) ? (' 玩家:' + p.bridgeAt.join('/') + '%') : '') + '"',
        (r.violations.length ? '不通过' : '通过'), '"' + r.violations.join('、') + '"', V(r.difficulty)
      ].join(','));
    });
    downloadText('蚂蚁关卡体检v2_' + lastChokeAudit.length + '关_' + Date.now() + '.csv', lines.join('\n') + '\n');
  }

  // ==================== 关卡库 导入/导出 ====================
  /**
   * 导入关卡库（JSON）：支持三种格式
   * 1. 批量导出格式 { levels: [{name, data:{blocks,queues,...}, difficulty, ...}] }
   * 2. 关卡数组 [ {blocks,queues,...}, ... ]
   * 3. 单个关卡 { blocks, queues, ... }
   */
  function importLibrary() {
    var el = document.getElementById('lib-input');
    if (el) el.click();
  }

  // 支持多选：一次导入【整个关卡包】(关卡/*.json + 审核数据/*_审核.json)、拆分单关、整合库，或混合。
  // 先收集全部文件再配对：识别到求解(审核)文件就把 solve/audit 附到对应关卡(免网页重算)；无则网页需要时再求解。
  function handleLibSelect(e) {
    var raw = e.target.files;
    if (!raw || !raw.length) return;
    // 只取 .json（文件夹导入会带上 txt/csv/md，跳过）
    var files = [];
    for (var f = 0; f < raw.length; f++) if (/\.json$/i.test(raw[f].name)) files.push(raw[f]);
    if (!files.length) { alert('未找到 .json 文件（关卡包应含 关卡/*.json）'); e.target.value = ''; return; }
    var parsedFiles = [], loaded = 0, total = files.length, errs = 0;
    for (var i = 0; i < files.length; i++) {
      (function(file) {
        var reader = new FileReader();
        reader.onload = function(ev) {
          try { parsedFiles.push({ fname: file.name, json: JSON.parse(ev.target.result) }); }
          catch (err) { errs++; }
          loaded++;
          if (loaded >= total) finishPackImport(parsedFiles, errs);
        };
        reader.readAsText(file);
      })(files[i]);
    }
    e.target.value = '';
  }

  // 分离审核/求解数据文件与关卡文件，按关卡名配对
  function finishPackImport(parsedFiles, errs) {
    // 去扩展名归一化：关卡数据.json 里的关卡名多带原图扩展(如"x.txt")，而 关卡/x.json 本体文件名是去扩展的"x"，
    //   若不归一会把同一关判成两关(既重复、又让本体白跑一次 solve)。统一去掉结尾 .txt/.json 再作为配对键。
    // 【v121·任务AK①】必须连 `.solve` 一起剥掉。导出包里求解数据的文件名是 `<关卡名>.solve.json`，
    //   原实现只剥 `.txt|.json` → 键变成 `001_x.solve`，与关卡本体的 `001_x` **配不上**，
    //   于是求解数据（以及其中的 meta.entryMode）在导入时被整份丢弃。这是「导入后玩法识别不到」的根因之一。
    // 【v123】再剥落库时加的**分类后缀**。`不合格关卡/` 下的兜底关文件名是 `<名>__遍历兜底.json`，
    //   而 `生产文档/关卡数据/` 里同一关叫 `<名>.json` —— 不剥就配不上，同一关会被拆成两个条目。
    //   实测 v119底部消除298-08-28 批次有 83 关带该后缀。
    function normKey(n) {
      return String(n)
        .replace(/\.(txt|json)$/i, '')
        .replace(/\.solve$/i, '')
        .replace(/__(遍历兜底|超时兜底|兜底)$/, '');
    }
    var auditMap = {};    // 向后兼容：旧 _审核.json（无 board，仅 solve/audit）
    var solveMap = {};    // v121：新格式求解数据 *.solve.json（type='ant-solve-data'，顶层 pickOrder + meta.entryMode）
    var dataFiles = [];   // 关卡数据.json（聚合无损主数据：levels[] 里带完整内部 board + 求解/审核/难度）
    var perLevelFiles = []; // 【v123】逐关无损数据：生产文档/关卡数据/<名>.json（顶层直接是一个关卡对象）
    var levelFiles = [];  // 关卡本体（官方 spools / 旧 blocks-board）或旧库
    for (var i = 0; i < parsedFiles.length; i++) {
      var pf = parsedFiles[i], j = pf.json; if (!j) continue;
      var lv0 = Array.isArray(j.levels) ? j.levels[0] : null;
      var isDataPack = j.type === 'ant-level-data' ||
        (lv0 && lv0.board && ('solve' in lv0 || 'audit' in lv0 || 'generationEval' in lv0));
      // v121：求解数据（新格式）。此前它既不满足 isDataPack、也不满足 isOldAudit（该格式**没有** j.solve
      //   这个键，pickOrder 在顶层），于是掉进 levelFiles → parseLibrary 认不出 → 静默丢弃。
      var isSolveData = j.type === 'ant-solve-data' || (!!j.pickOrder && !!j.meta && !j.blocks && !j.spools);
      // 【v123】逐关无损数据（`生产文档/关卡数据/<名>.json`）：顶层直接是一个关卡对象，
      //   同时带 blocks + board，并带 solve/audit/entryMode/generationEval 之一。
      //   改前它三个分类都不匹配 → 掉进 levelFiles 被当成【普通关卡本体】，于是：
      //     ① 与 `合格关卡/<名>.json` **平级竞争同一个键**，而 add(entry, true) 是「本体不覆盖已有」
      //        → **先到先得**；文件走 FileReader 异步读、完成顺序不定 → 玩法标记时有时无
      //        （实测 218 关里只有 85 关拿到，就是这个随机结果）；
      //     ② parseLibrary **不读 solve/audit** → 求解数据与审核结论全丢（实测 paired=0）；
      //     ③ 它自带 blocks+board = 完整关卡内容 → 该目录下的**全部**关卡（含不合格）都变成条目。
      var isPerLevelData = !j.type && !j.levels && !Array.isArray(j) && !!j.blocks && !!j.board &&
        ('solve' in j || 'audit' in j || 'entryMode' in j || 'generationEval' in j);
      var isOldAudit = !j.blocks && !j.spools && !Array.isArray(j) && !j.levels && (j.solve || j.audit);
      if (isDataPack) dataFiles.push(pf);
      else if (isPerLevelData) perLevelFiles.push(pf);
      else if (isSolveData) {
        var sm = j.meta || {};
        var snm = sm.levelName || pf.fname.replace(/\.solve\.json$/i, '').replace(/\.json$/i, '');
        var sy = j.summary || {};
        solveMap[normKey(snm)] = {
          entryMode: normEntryMode(sm.entryMode),
          bufferLimit: sm.bufferLimit != null ? sm.bufferLimit : null,
          difficulty: j.difficulty || null,
          audit: j.audit || null,
          solve: {
            completed: !!sy.completed, steps: sy.steps, maxBuffer: sy.maxBuffer, avgBuffer: sy.avgBuffer,
            progress: sy.progress, completedBoxes: sy.completedBoxes, totalBoxes: sy.totalBoxes,
            eliminatedPixels: sy.eliminatedPixels, totalPixels: sy.totalPixels,
            pickOrder: j.pickOrder || [], stepStats: j.stepStats || [],
            stepBufferHistory: j.stepBufferHistory || [], pressureSamples: j.pressureSamples || []
          }
        };
      }
      else if (isOldAudit) {
        var nm = j.name || pf.fname.replace(/_审核\.json$/i, '').replace(/\.audit\.json$/i, '').replace(/\.json$/i, '');
        auditMap[normKey(nm)] = { solve: j.solve || null, audit: j.audit || null, generationEval: j.generationEval || null };
      } else levelFiles.push(pf);
    }
    var byName = {}, order = [];
    function add(entry, lossy) {
      var key = normKey(entry.name);
      if (byName[key]) { if (!lossy) byName[key] = entry; return; } // 无损数据可覆盖，本体不覆盖已有
      byName[key] = entry; order.push(key);
    }
    // 1) 关卡数据.json（无损主）：parseLibrary 得完整 level(含 board/难度/generationEval)，再补 solve/audit
    for (var d = 0; d < dataFiles.length; d++) {
      var es = parseLibrary(dataFiles[d].json);
      var lvArr = dataFiles[d].json.levels || [];
      for (var e = 0; e < es.length; e++) {
        var src = lvArr[e] || {};
        es[e].solve = src.solve || null;
        es[e].audit = src.audit || null;
        // v121：entryMode 已由 parseLibrary 从条目上读出（见其内部），这里不再覆盖
        add(es[e], false);
      }
    }
    // 2) 关卡本体/旧关卡/旧库（仅补充未被无损数据覆盖的 name；官方本体经 fromGameFormat 还原）
    for (var k = 0; k < levelFiles.length; k++) {
      var lf = levelFiles[k], entries = parseLibrary(lf.json);
      var baseName = lf.fname.replace(/\.json$/i, '');
      for (var m = 0; m < entries.length; m++) {
        if (!entries[m].name || /^关卡\d+$/.test(entries[m].name)) entries[m].name = baseName + (entries.length > 1 ? ('_' + (m + 1)) : '');
        add(entries[m], true);
      }
    }
    // 3) 旧审核文件按名配对（补 solve/audit）
    for (var n = 0; n < order.length; n++) {
      var au = auditMap[order[n]];
      if (au) {
        byName[order[n]].solve = byName[order[n]].solve || au.solve;
        byName[order[n]].audit = byName[order[n]].audit || au.audit;
        byName[order[n]].generationEval = byName[order[n]].generationEval || au.generationEval;
      }
    }
    // 3b) 【v123】逐关无损数据（`生产文档/关卡数据/<名>.json`）：**只补不建**。
    //   口径（这条规则是本轮的核心修复，用户原话：「正常应该是只导入对应的关卡即可，
    //   你应该是记录的关卡数据包含了关卡内容本身，导致他们一起带进去了」）：
    //     · 同批**存在关卡本体**（合格关卡/、关卡/ 等）→ 无损数据只给**已有条目**补数据，
    //       没有对应本体的（例如不合格关卡的无损数据）**跳过并计数**，不新建条目；
    //     · 同批**完全没有本体**（只导入了 生产文档）→ 才用无损数据建条目，保证「只导入生产文档也能用」。
    //   配对键用**文件名**而不是 `j.name`：`j.name` 是源图名（带 `.txt`，且重名关会被生产侧改名），
    //   而 `合格关卡/`、`txt图/`、`求解数据/` 三处都按文件名同名约定落库（任务 O 定的三件套同名规则）。
    var hadBodies = order.length > 0;
    var perLevelSkipped = 0, perLevelFilled = 0, perLevelCreated = 0;
    for (var pl = 0; pl < perLevelFiles.length; pl++) {
      var plf = perLevelFiles[pl], pj = plf.json;
      var plKey = normKey(plf.fname);                    // ← 文件名，不用 j.name
      var tgt0 = byName[plKey];
      if (!tgt0) {
        if (hadBodies) { perLevelSkipped++; continue; }  // 有本体却没这一关 → 用户没选它，不硬塞
        var made = parseLibrary(pj);
        if (!made.length) continue;
        made[0].name = pj.name || plKey;
        made[0].solve = pj.solve || null;
        made[0].audit = pj.audit || null;
        add(made[0], false);
        perLevelCreated++;
        continue;
      }
      // 已有本体 → 用无损数据把它补全。level 用无损的覆盖：本体是官方格式经 fromGameFormat 还原，
      // 冰耐久等字段是按默认值补的（有损）；无损数据的 board 是生成期原样，优先级更高。
      var lossless = parseLibrary(pj);
      // 【v155】★ 换 level 时必须**把 entry.blocks 一起换成同一份数组**。
      //   原来只换 level → 同一关存在两份 blocks：中间棋盘/目标图画的是 entry.level.blocks（改目标图改的是它），
      //   而批量生产派发的是 entry.blocks（本体那份旧数组）→ 用户在手动摆盒里改的目标图，
      //   一点「批量生产」就被原 TXT 顶掉（用户 2026-10-16 报："映射到中间的时候目标图还是原来的 txt"）。
      //   判据：`合格关卡/x.json`（本体）与 `生产文档/关卡数据/x.json`（无损）同名同时导入时才走到这里。
      if (lossless.length && lossless[0].level) {
        tgt0.level = lossless[0].level;
        setEntryBlocks(tgt0, tgt0.level.blocks);
      }
      tgt0.solve = tgt0.solve || pj.solve || null;
      tgt0.audit = tgt0.audit || pj.audit || null;
      tgt0.generationEval = tgt0.generationEval || pj.generationEval || null;
      if (!tgt0.difficulty && pj.difficulty != null) {
        tgt0.difficulty = (typeof pj.difficulty === 'object')
          ? pj.difficulty : { score: pj.difficulty, grade: pj.grade || '' };
      }
      if (pj.valid != null) tgt0.valid = pj.valid;
      var plEm = normEntryMode(pj.entryMode);
      if (plEm && !tgt0.entryMode) { tgt0.entryMode = plEm; tgt0.entryModeFrom = '关卡数据'; }
      perLevelFilled++;
    }
    // 4) v121：新格式求解数据按名配对 —— 补 solve（免重算）**并补 entryMode（玩法识别）**。
    //    entryMode 的优先级：关卡数据.json 的 levels[].entryMode > 求解数据 meta.entryMode。
    //    前者是关卡本体侧的记录，后者是求解侧的记录；两者应当一致，不一致时以关卡侧为准并记下冲突。
    for (var sIdx = 0; sIdx < order.length; sIdx++) {
      var sd = solveMap[order[sIdx]];
      if (!sd) continue;
      var tgt = byName[order[sIdx]];
      tgt.solve = tgt.solve || sd.solve;
      tgt.audit = tgt.audit || sd.audit;
      if (!tgt.entryMode && sd.entryMode) { tgt.entryMode = sd.entryMode; tgt.entryModeFrom = '求解数据'; }
      else if (tgt.entryMode && sd.entryMode && tgt.entryMode !== sd.entryMode) {
        tgt.entryModeConflict = sd.entryMode;   // 如实记录冲突，面板会提示，不静默取一个
      }
      if (!tgt.difficulty && sd.difficulty && sd.difficulty.score != null) tgt.difficulty = sd.difficulty;
    }
    var all = order.map(function (nm) { return byName[nm]; });
    var withSolve = all.filter(function (x) { return x.solve; }).length;
    var withMode = all.filter(function (x) { return x.entryMode; }).length;
    finishLibImport(all, errs, withSolve, withMode, {
      skipped: perLevelSkipped, filled: perLevelFilled, created: perLevelCreated
    });
  }

  function finishLibImport(entries, errs, paired, withMode, plStat) {
    if (!entries.length) { alert('未解析到有效关卡（支持整个关卡包 / 单关json / 关卡库json，可多选）'); return; }
    // 按名称自然排序（L01, L02 …）
    entries.sort(function(a, b) { return String(a.name).localeCompare(String(b.name), undefined, { numeric: true }); });
    levelList = entries;
    currentLevelIdx = -1;
    document.getElementById('level-list-panel').classList.remove('hidden');
    // 【v123】计数如实分项。原来只显示总数与两个可选项，看不出「有多少关是被补全的、
    //   有多少关的无损数据因为没选中而跳过」—— 而这两个数正是判断导入是否符合预期的关键。
    var n = entries.length;
    var extra = (paired ? ('，' + paired + '/' + n + ' 含求解数据') : '，无求解数据') +
      (withMode ? ('，' + withMode + '/' + n + ' 含玩法标记') : '，无玩法标记') +
      (plStat && plStat.skipped ? ('，跳过 ' + plStat.skipped + ' 关未选中的无损数据') : '') +
      (errs ? ('，' + errs + '个失败') : '');
    document.getElementById('level-list-count').textContent = '(' + levelList.length + extra + ')';
    renderLevelList();
    selectLevel(0);
  }

  /**
   * 把导入的 JSON 归一化成 levelList 条目 [{name, blocks, level, difficulty, valid}]
   */
  function parseLibrary(json) {
    var out = [];
    var rawLevels = [];
    if (json && Array.isArray(json.levels)) rawLevels = json.levels;
    else if (Array.isArray(json)) rawLevels = json;
    else if (json && json.blocks) rawLevels = [json];

    for (var i = 0; i < rawLevels.length; i++) {
      var item = rawLevels[i];
      // 关卡数据可能在 item.data 或 item 本身
      var data = item.data || item;
      if (!data) continue;
      var level;
      if (data.spools && (data.maprow != null || data.mapcol != null)) {
        // 官方关卡本体(干净结构) → 内部（冰耐久默认；若同批有 关卡数据.json 会以其完整 board 无损覆盖）
        level = AntSolver.fromGameFormat(data);
        if (data.bufferLimit) level.bufferLimit = data.bufferLimit;
      } else if (data.blocks) {
        level = {
          blocks: data.blocks,
          bufferLimit: data.bufferLimit || 5,
          board: data.board || null,
          queues: data.queues || null   // 兼容旧格式（parseLevel 会转换为 board）
        };
      } else continue;
      var name = item.name || ('关卡' + (i + 1));
      var entry = { name: name, blocks: level.blocks, level: level };
      // 保留已有难度信息；数字难度→包成 {score,grade}；都没有则【留空】。
      //   关键修复：不再在导入时对每个缺难度的关卡跑一次 solve()——那会在主线程上逐关求解，导入几十关的关卡包时直接卡死页面。
      //   缺失难度改由 selectLevel 打开该关时按需惰性计算并缓存(见 selectLevel)。
      if (item.difficulty && typeof item.difficulty === 'object') {
        entry.difficulty = item.difficulty;
      } else if (typeof item.difficulty === 'number') {
        entry.difficulty = { score: item.difficulty, grade: item.grade || '' };
      }
      entry.valid = item.valid != null ? item.valid : true;
      entry.generationEval = item.generationEval || data.generationEval || null;
      // 【v121·任务AK①】读入口模式（玩法）。`关卡数据.json` 的每条 levels[] 自 v110 起就带 entryMode，
      //   但此前 parseLibrary 从不读它 → 导入后一律按四边入口加载。
      //   还兼容 generationEval.entryMode（部分批次的诊断对象上带）。认不出就留空，由 selectLevel 如实标注「未知玩法」。
      var emRaw = (item.entryMode != null ? item.entryMode : (data.entryMode != null ? data.entryMode :
        (entry.generationEval && entry.generationEval.entryMode)));
      var em = normEntryMode(emRaw);
      if (em) { entry.entryMode = em; entry.entryModeFrom = '关卡数据'; }
      out.push(entry);
    }
    return out;
  }

  /**
   * 导出关卡库：把 levelList 中的关卡打包成关卡库 JSON。
   * 优先用已有完整关卡（导入/生成缓存），缺失的用当前配置现场生成。
   */
  function exportLibrary() {
    if (levelList.length === 0) {
      // 无关卡列表：导出当前单个关卡
      if (currentLevel) { exportLevel(); return; }
      alert('请先导入TXT图 / 关卡库，或生成关卡');
      return;
    }
    var config = getGenConfig();
    var levels = [];
    for (var i = 0; i < levelList.length; i++) {
      var entry = levelList[i];
      var lv = entry.level || entry.generated;
      var diff = entry.difficulty || null;
      var generationEval = entry.generationEval || null;
      if (!lv && entry.blocks) {
        try {
          var cfg = Object.assign({}, config, { mapSize: entry.blocks.length });
          var r = AntSolver.Generator.generateFromBlocks(entry.blocks, cfg);
          lv = r.level; diff = r.difficulty; generationEval = r.generationEval || null;
        } catch (e) { continue; }
      }
      if (!lv) continue;
      levels.push({
        name: entry.name,
        valid: entry.valid != null ? entry.valid : true,
        difficulty: diff ? diff.score : null,
        grade: diff ? diff.grade : null,
        generationEval: generationEval,
        data: {
          blocks: lv.blocks,
          board: lv.board || null,
          bufferLimit: lv.bufferLimit
        }
      });
    }
    if (!levels.length) { alert('没有可导出的关卡'); return; }
    var output = {
      type: 'ant-level-library',
      exported: new Date().toISOString(),
      total: levels.length,
      levels: levels
    };
    downloadJSON(output, '蚂蚁关卡库_' + levels.length + '关_' + Date.now() + '.json');
  }

  function downloadJSON(obj, filename) {
    var blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ==================== 批量模拟分析 ====================
  /**
   * 对关卡列表逐一"模拟游玩"（多轮求解）并给出难度评分，输出统计表 + CSV。
   */
  // 读「重标定轮数」控件：缺控件/非法 → 5（用户口径「多轮」，5 轮是 recalibrateDifficulty 的默认）
  function analyzeRoundsInput() {
    var v = parseInt((document.getElementById('gen-analyze-rounds') || {}).value, 10);
    return (isNaN(v) || v < 1) ? 5 : Math.min(30, v);
  }
  /**
   * 批量分析（opts.recalibrate=false，单轮 seed7，与生产审核同口径）
   * 批量难度重标定（opts.recalibrate=true，多轮取最稳一条玩家路线）
   *
   * 【v121·任务AK④】相对原实现的三处修正：
   *   ① 全知那遍原来是 `Solver.solve(parsed)`【无 opts → 恒按四边入口】，
   *      底部/瞬时连锁关卡的全知结果是错规则算的。现改为按【本关 entryMode】求解。
   *   ② 玩家那遍原来把整批 config 的模式当成每关的模式；导入的关卡各自玩法可能不同，
   *      现改为逐关取 `entry.entryMode`，取不到才回落整批 config。
   *   ③ 新增多轮重标定：跑 N 轮不同种子，在通关轮里挑「最稳」那条来标定难度
   *      （判据见 analysis.js recalibrateDifficulty），消除单跑 seed 7 的抽样扰动。
   */
  function batchAnalyze(opts) {
    opts = opts || {};
    var recal = !!opts.recalibrate;
    var runs = recal ? (opts.runs || analyzeRoundsInput()) : 1;
    if (levelList.length === 0) {
      alert('请先导入TXT图或关卡库');
      return;
    }
    if (!AntSolver.Analysis) { alert('分析模块未加载'); return; }
    if (recal && !AntSolver.Analysis.recalibrateDifficulty) { alert('重标定模块未加载（需 v121 及以上的 analysis.js）'); return; }

    var panel = document.getElementById('analysis-result');
    var body = document.getElementById('analysis-body');
    if (panel) panel.classList.remove('hidden');
    if (body) body.innerHTML = '<p style="color:#888">分析中...</p>';

    var config = getGenConfig();
    var batchMode = entryModeOf(config);
    var results = [];
    var idx = 0;
    var t0 = Date.now();

    function next() {
      if (idx >= levelList.length) { finishAnalyze(results, { recalibrate: recal, runs: runs, ms: Date.now() - t0 }); return; }
      var entry = levelList[idx];
      if (body) body.innerHTML = '<p style="color:#888">' + (recal ? '重标定' : '分析') + ' ' + (idx + 1) + '/' + levelList.length +
        (recal ? ('（每关 ' + runs + ' 轮）') : '') + ': ' + entry.name + '</p>';
      setTimeout(function() {
        try {
          var level = entry.level || entry.generated;
          if (!level && entry.blocks) {
            var cfg = Object.assign({}, config, { mapSize: entry.blocks.length });
            var gen = AntSolver.Generator.generateFromBlocks(entry.blocks, cfg);
            level = gen.level;
            entry.generated = level;
            // 现场生成的关卡：玩法就是本次生成配置的玩法，如实记下（后续打开该关时按它加载）
            if (!entry.entryMode) { entry.entryMode = batchMode; entry.entryModeFrom = '本次生成配置'; }
          }
          if (level) {
            var parsed = AntSolver.parseLevel(level);
            // ① 全知按本关玩法求解（不再恒四边）
            var em = entry.entryMode || batchMode;
            var pmo = playerOptsOfEntry(em);
            var solveRes = solveByEntryMode(parsed, em);
            var diff = null, rc = null;
            if (recal) {
              // ③ 多轮重标定：复用同一份全知结果，避免重复求解
              rc = AntSolver.Analysis.recalibrateDifficulty(parsed, {
                runs: runs, omni: solveRes, bottomOnly: pmo.bottomOnly, instantChain: pmo.instantChain
              });
              diff = rc.difficulty;
              entry.recalibrate = rc;
              if (diff) { entry.difficulty = diff; entry.difficultySource = '重标定·' + rc.runs + '轮·' + entryModeLabel(em); }
            } else {
              // ② 单轮：玩家模拟继承本关玩法（原实现取的是整批 config）
              var plRun = AntSolver.PlayerSim ? AntSolver.PlayerSim.run(parsed, Object.assign({ seed: 7 }, pmo)) : null;
              var playerStats = plRun ? {
                won: plRun.won, avgBuffer: plRun.playerAvgBuffer, peak: plRun.bufferPeak,
                revives: plRun.revivesUsed || 0,
                avgResidence: plRun.avgResidence, effectiveTicks: plRun.effectiveTicks,
                residenceCount: plRun.residenceCount
              } : null;
              diff = AntSolver.Analysis.difficulty(parsed, solveRes, playerStats);
              entry.difficulty = diff;
              entry.difficultySource = '单轮(seed7)·' + entryModeLabel(em);
            }
            if (!diff) { idx++; next(); return; }   // 重标定连诊断代表都没有（玩家模拟异常）→ 如实跳过，不写伪造行
            var st = rc && rc.stability ? rc.stability : null;
            results.push({
              name: entry.name,
              entryMode: em, entryModeKnown: !!entry.entryMode,
              rows: parsed.rows, cols: parsed.cols,
              pixels: parsed.totalPixels,
              score: diff.score, grade: diff.grade,
              parts: diff.parts,
              obstacleNames: diff.obstacleNames,
              omniAvgBuffer: diff.omniAvgBuffer, omniAvgResidence: diff.omniAvgResidence,
              playerAvgBuffer: diff.playerAvgBuffer, offset: diff.offset,
              playerWon: diff.playerWon,
              // v4 新增：玩家滞留、明细、评分版本与可排序标记（需求 §七）
              playerAvgResidence: diff.playerAvgResidence,
              playerBufferPeak: diff.playerBufferPeak,
              playerEffectiveTicks: diff.playerEffectiveTicks,
              playerResidenceCount: diff.playerResidenceCount,
              playerRevives: diff.playerRevives,
              detail: diff.detail,
              scoreVersion: diff.scoreVersion,
              rankable: diff.rankable,
              maxBuffer: solveRes.maxBuffer,
              completed: solveRes.completed,
              // v121 重标定字段（单轮模式下全为 null，CSV 里留空而不是填 0 —— 0 会被误读成「通关率 0%」）
              recalRuns: rc ? rc.runs : null,
              recalSeed: rc && rc.chosen ? rc.chosen.seed : null,
              recalThreshold: rc && rc.chosen ? rc.chosen.pickThreshold : null,
              recalRoutes: st ? st.distinctRoutes : null,
              recalDegenerate: st ? !!st.degenerate : null,
              recalWinRate: st ? st.winRate : null,
              recalScoreMedian: st ? st.scoreMedian : null,
              recalScoreMin: st ? st.scoreMin : null,
              recalScoreMax: st ? st.scoreMax : null,
              recalScoreRange: st ? st.scoreRange : null,
              recalPeakMin: st ? st.peakMin : null,
              recalPeakMax: st ? st.peakMax : null,
              recalPeakRange: st ? st.peakRange : null,
              recalReviveMin: st ? st.reviveMin : null,
              recalReviveMax: st ? st.reviveMax : null,
              recalNote: rc ? rc.note : ''
            });
          }
        } catch (e) { /* 跳过异常关 */ }
        idx++;
        next();
      }, 10);
    }
    next();
  }

  function finishAnalyze(results, meta) {
    meta = meta || {};
    lastAnalysis = results;
    lastAnalysisMeta = meta;
    var body = document.getElementById('analysis-body');
    if (!body) return;
    if (!results.length) { body.innerHTML = '<p class="fail">无有效分析结果</p>'; return; }
    var recal = !!meta.recalibrate;

    // 难度分布
    var gradeCount = { '简单': 0, '普通': 0, '困难': 0, '极难': 0 };
    var passCount = 0, rankableCount = 0, unknownMode = 0;
    results.forEach(function(r) {
      gradeCount[r.grade] = (gradeCount[r.grade] || 0) + 1;
      if (r.completed) passCount++;
      if (r.rankable) rankableCount++;
      if (!r.entryModeKnown) unknownMode++;
    });

    var degen = results.filter(function (r) { return r.recalDegenerate; }).length;
    var html = '<div style="font-size:11px;color:#aaa;margin-bottom:6px">';
    html += (recal ? ('🎯 难度重标定 · 每关 ' + meta.runs + ' 轮 · ') : '单轮(seed7) · ');
    html += '共 ' + results.length + ' 关 · 全知可解 ' + passCount + ' · 可排序(玩家通关) ' + rankableCount + ' · ';
    html += Object.keys(gradeCount).map(function(g) { return g + ':' + gradeCount[g]; }).join(' ');
    if (meta.ms != null) html += ' · 用时 ' + Math.round(meta.ms / 1000) + 's';
    html += ' <button id="btn-analyze-csv" style="margin-left:6px;padding:2px 8px;background:#6b4f34;color:#f3e9db;border:none;border-radius:3px;cursor:pointer">⬇ ' +
      (recal ? '重标定报告CSV' : 'CSV') + '</button></div>';
    if (unknownMode) {
      html += '<div style="font-size:11px;color:#e6a23c;margin-bottom:6px">⚠ ' + unknownMode +
        ' 关没有玩法标记，已按四边入口分析（导入包若含 关卡数据.json / 求解数据 即可自动识别）</div>';
    }
    if (recal) {
      html += '<div style="font-size:11px;color:#8a7358;margin-bottom:6px">多轮扰动轴＝取盒阈值 pickThreshold（0.50~0.70 均匀取点）。' +
        '<b>随机种子在当前玩家模拟里无效</b>（rng 有定义但零调用，实测同关不同种子结果逐字段相同），' +
        '故不能用种子作多轮扰动，否则 N 轮等于 1 轮。' +
        (degen ? ('<span style="color:#e6a23c">本次有 ' + degen + ' 关多轮退化为单一路线，其重标定分等同单轮。</span>') : '') +
        '</div>';
    }

    html += '<div style="max-height:260px;overflow:auto"><table class="analysis-table"><thead><tr>';
    html += '<th>关卡</th><th title="本关按哪种玩法分析（来自导入数据，认不出则按四边入口）">玩法</th><th>尺寸</th><th>难度</th><th>等级</th>' +
      '<th title="f1 玩家平均暂存(权重65%)">f1</th><th title="f2 玩家平均滞留占比(权重25%)">f2</th><th title="f3 基础障碍(权重10%)">f3</th>' +
      '<th title="玩家版是否通关(合格前提；未通关不出正式排序分)">玩家通关</th>';
    if (recal) html += '<th title="多轮通关率">通关率</th><th title="多轮难度分区间(中位)">分数区间</th>' +
      '<th title="多轮峰值暂存极差；越大说明这关对玩家风格越敏感">峰差</th>' +
      '<th title="多轮实际产出了几条不同的取盒路线。=1 表示这一关对扰动不敏感，N 轮等于 1 轮，重标定分与单轮同值">路线数</th>' +
      '<th title="被采用的那一轮的取盒阈值 pickThreshold（多轮的扰动轴；随机种子在当前 PlayerSim 里无效）">采用阈值</th>';
    html += '</tr></thead><tbody>';
    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      var gcls = 'grade-' + r.grade;
      html += '<tr>';
      html += '<td>' + r.name + '</td>';
      html += '<td' + (r.entryModeKnown ? '' : ' style="color:#e6a23c"') + '>' + entryModeLabel(r.entryMode) + (r.entryModeKnown ? '' : '?') + '</td>';
      html += '<td>' + r.rows + '×' + r.cols + '</td>';
      html += '<td>' + r.score + '</td>';
      html += '<td class="' + gcls + '">' + r.grade + '</td>';
      html += '<td>' + r.parts.f1 + '</td>';
      html += '<td>' + r.parts.f2 + '</td>';
      html += '<td>' + r.parts.f3 + '</td>';   // v4：f4 已停用，此列改显 f3
      html += '<td style="color:' + (r.playerWon ? '#8bc34a' : '#e0592c') + '">' + (r.playerWon ? '✓' : '✗') + '</td>';
      if (recal) {
        html += '<td>' + Math.round((r.recalWinRate || 0) * 100) + '%</td>';
        html += '<td>' + r.recalScoreMin + '~' + r.recalScoreMax + '(' + r.recalScoreMedian + ')</td>';
        html += '<td' + ((r.recalPeakRange || 0) >= 2 ? ' style="color:#e6a23c"' : '') + '>' + (r.recalPeakRange != null ? r.recalPeakRange : '-') + '</td>';
        html += '<td' + (r.recalDegenerate ? ' style="color:#e6a23c" title="多轮退化为单一路线，重标定分等同单轮"' : '') + '>' +
          (r.recalRoutes != null ? r.recalRoutes : '-') + (r.recalDegenerate ? '⚠' : '') + '</td>';
        html += '<td>' + (r.recalThreshold != null ? r.recalThreshold : '-') + '</td>';
      }
      html += '</tr>';
    }
    html += '</tbody></table></div>';
    body.innerHTML = html;
    var csvBtn = document.getElementById('btn-analyze-csv');
    if (csvBtn) csvBtn.addEventListener('click', exportAnalysisCSV);
  }

  function exportAnalysisCSV() {
    if (!lastAnalysis || !lastAnalysis.length) return;
    var recal = !!(lastAnalysisMeta && lastAnalysisMeta.recalibrate);
    // v4 表头：f1/f2 均为玩家版；f4 保留列但恒为「已停用」（需求 §七 允许保留空值或明确标记）
    // v121：表头前部新增「玩法/玩法来源」两列（新列一律加在既有列之前会错位，故加在表尾与「玩法」并列处 ——
    //   这里选择把两列插在「关卡」之后，因为这份 CSV 不是生产落库的 分析报告.csv（那份新列一律加表尾），
    //   它是页面按需导出、每次自带表头的独立报告，不存在跨批次续写错位问题）。
    var head = ['关卡,玩法,玩法来源,行,列,像素,难度分,难度等级,评分版本,可否排序,障碍,f1归一,f2归一,f3归一,f4,玩家均暂原始,玩家滞留原始,f3障碍原始,复活次数,复活加成,有效操作步,滞留统计盒数,全知均暂(对照),全知滞留(对照),玩家通关,峰值暂存,可解'];
    // v121 重标定报告追加 16 列。「不同路线数/多轮退化」两列是判断这份重标定有没有意义的关键：
    // 退化=是 时该关的 N 轮实际是同一条路线，重标定分等同单轮，不能当成「更可信」。
    if (recal) head[0] += ',重标定轮数,不同路线数,多轮退化,采用取盒阈值,采用种子(当前无效),多轮通关率,分数中位,分数最小,分数最大,分数极差,峰值最小,峰值最大,峰值极差,复活最小,复活最大,重标定备注';
    var lines = head;
    lastAnalysis.forEach(function(r) {
      var p = r.parts;
      var row = [
        '"' + r.name + '"',
        '"' + entryModeLabel(r.entryMode) + '"', (r.entryModeKnown ? '导入数据' : '未知(按四边入口)'),
        r.rows, r.cols, r.pixels, r.score, r.grade,
        (r.scoreVersion || 'diff-v5-scalefree'), (r.rankable ? '是' : '否'),
        '"' + (r.obstacleNames || '无') + '"',
        p.f1, p.f2, p.f3, '已停用',
        (r.playerAvgBuffer != null ? r.playerAvgBuffer : ''),
        (r.playerAvgResidence != null ? r.playerAvgResidence : ''),
        (r.detail && r.detail.f3 ? r.detail.f3.raw : ''),
        (r.playerRevives || 0), ((r.playerRevives || 0) * 8),
        (r.playerEffectiveTicks || 0), (r.playerResidenceCount || 0),
        r.omniAvgBuffer, r.omniAvgResidence,
        (r.playerWon ? '是' : '否'), r.maxBuffer, (r.completed ? '是' : '否')
      ];
      if (recal) {
        // 单轮字段在重标定报告里理论上不会为 null；真为 null 时留空而不是补 0（0 会被误读成真实值）
        function v(x) { return x == null ? '' : x; }
        row = row.concat([
          v(r.recalRuns), v(r.recalRoutes), (r.recalDegenerate == null ? '' : (r.recalDegenerate ? '是' : '否')),
          v(r.recalThreshold), v(r.recalSeed),
          (r.recalWinRate != null ? (Math.round(r.recalWinRate * 1000) / 10 + '%') : ''),
          v(r.recalScoreMedian), v(r.recalScoreMin), v(r.recalScoreMax), v(r.recalScoreRange),
          v(r.recalPeakMin), v(r.recalPeakMax), v(r.recalPeakRange),
          v(r.recalReviveMin), v(r.recalReviveMax),
          '"' + (r.recalNote || '') + '"'
        ]);
      }
      lines.push(row.join(','));
    });
    var blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = (recal ? '蚂蚁难度重标定报告_' : '蚂蚁分析报告_') + lastAnalysis.length + '关_' +
      (recal ? (lastAnalysisMeta.runs + '轮_') : '') + Date.now() + '.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  // ==================== 导出 ====================
  // 单关导出：打包 ZIP（与批量同构）——关卡/(干净官方本体) + txt图/ + 求解数据/ + 关卡数据/关卡数据.json(调试,无损)
  // 2026-08-05 §导出对齐：单关导出同样产出 求解数据/<名>.solve.json，否则会出现
  // 「批量导出有求解数据、单关导出没有」的不一致，修图工具导入单关包时又要现场求解。
  function exportLevel() {
    if (!currentLevel) { alert('无关卡数据'); return; }
    if (!AntSolver.Zip) { alert('ZIP模块未加载'); return; }
    var pr = AntSolver.parseLevel(currentLevel);
    var base = currentLevel.name ? safeName(String(currentLevel.name).replace(/\.txt$/i, '')) : ('蚂蚁关卡_' + Date.now());
    var files = [];
    var nowIso1 = new Date().toISOString();
    files.push({ name: '关卡/' + base + '.json', text: JSON.stringify(AntSolver.toGameFormat(pr), null, 2) });
    files.push({ name: 'txt图/' + base + '.txt', text: (currentLevel.txt || blocksToTXT(currentLevel.blocks)) });
    // 求解数据：只有确实拿到求解结果时才写，没有就不写空壳（避免下游误以为有权威 pickOrder）
    var slv1 = currentImportedSolve || null;
    if (slv1 && slv1.pickOrder && slv1.pickOrder.length) {
      files.push({ name: '求解数据/' + base + '.solve.json', text: JSON.stringify({
        type: 'ant-solve-data',
        contract: 'pickOrder 为唯一权威；不含 replay/defaultInterval，逐步轨迹由使用方按真机口径自行重放。',
        meta: {
          levelFile: '关卡/' + base + '.json', txtFile: 'txt图/' + base + '.txt',
          levelName: base, entryMode: currentEntryMode || 'fourSide',
          bufferLimit: currentLevel.bufferLimit, exported: nowIso1, 源: '单关导出（当前已加载的求解结果，未重新求解）'
        },
        summary: {
          completed: !!slv1.completed, steps: slv1.steps, maxBuffer: slv1.maxBuffer, avgBuffer: slv1.avgBuffer,
          progress: slv1.progress, completedBoxes: slv1.completedBoxes, totalBoxes: slv1.totalBoxes,
          eliminatedPixels: slv1.eliminatedPixels, totalPixels: slv1.totalPixels
        },
        difficulty: currentLevel.difficulty ? { score: currentLevel.difficulty.score, grade: currentLevel.difficulty.grade } : null,
        pickOrder: slv1.pickOrder,
        stepStats: slv1.stepStats || [],
        stepBufferHistory: slv1.stepBufferHistory || [],
        pressureSamples: slv1.pressureSamples || []
      }, null, 1) });
    }
    files.push({ name: '关卡数据/关卡数据.json', text: JSON.stringify({
      type: 'ant-level-data', exported: new Date().toISOString(), total: 1,
      levels: [{
        name: base,
        valid: currentLevel.valid != null ? currentLevel.valid : true,
        difficulty: (currentLevel.difficulty && currentLevel.difficulty.score != null) ? currentLevel.difficulty.score : null,
        grade: (currentLevel.difficulty && currentLevel.difficulty.grade) ? currentLevel.difficulty.grade : null,
        entryMode: currentEntryMode || 'fourSide',
        bufferLimit: currentLevel.bufferLimit,
        blocks: currentLevel.blocks,               // 目标图（导入无损还原需要）
        board: currentLevel.board,                 // 完整内部结构，无损
        generationEval: currentGenerationEval || null,
        solve: currentImportedSolve || null
      }]
    }, null, 2) });
    var blob = AntSolver.Zip.create(files);
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = base + '.zip';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    // 同 genDownloadPending：延后 revoke + 移除临时 <a>，避免大 ZIP 下载被立即 revoke 中断。
    setTimeout(function () { URL.revokeObjectURL(url); if (a.parentNode) a.parentNode.removeChild(a); }, 60000);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
