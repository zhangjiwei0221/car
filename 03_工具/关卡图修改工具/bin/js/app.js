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
  // 当前单关的【目标图入口模式】：'fourSide'|'bottomOnly'。生成时按当次配置记下，导入/换关时清回默认。
  // 只用于单关导出记录与显示；关卡 JSON 本体不含该字段（用户决定 D1）。
  var currentEntryMode = 'fourSide';
  // v99：三种玩法模式互斥，统一从 config 推导 entryMode，避免各处各写一遍三元表达式导致漏改。
  function entryModeOf(cfg) {
    if (cfg && cfg.instantChain) return 'fourSideInstantChain';
    if (cfg && cfg.bottomOnly) return 'bottomOnly';
    return 'fourSide';
  }
  var simulating = false;
  var autoPlayTimer = null;
  // 求解路线叠加状态（任务 ANT-SIM-CHAIN-ROUTE-20260805）。
  // 声明放在这里而不是紧邻其函数：renderQueues 渲染每个格子时会读它，
  // 必须保证在任何渲染发生前就已初始化，否则首次渲染会读到 undefined。
  var routeOverlay = { active: false, map: null, total: 0, mode: null };
  var lastAnalysis = null; // 最近一次批量分析结果
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
  var elimSimSpeed = 60;                           // 全知版逐像素回放每格间隔(ms)，慢放参数
  // 生成器独立页面状态
  var genFileFilter = { color: null };  // 文件列表当前筛选(点分组标题筛该组；null=不筛选)
  var genBatchRunning = false, genBatchAborted = false;
  var genBatchResults = [];             // 本批已产出记录(实时展示 + 收尾打包共用同一引用)
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
  var genInFlightT0 = {};               // 输入下标 → 该关派发时刻；N 关在飞时各自计耗时(不能再用单个 itemT0，否则耗时全错)
  var genPendingZip = null;             // 【兜底模式专用】收尾打包好的关卡包 { blob, filename, fileCount }；仅在本地生产服务不可用时才会有值
  // 逐关落库运行态：正式生产走「每关写盘确认」，不再整批打 ZIP。
  //   enabled=false 时(如 file:// 打开、没起本地生产服务)自动回退旧的内存+ZIP模式，保证仍能用。
  var genPersist = {
    enabled: false, batchId: null, batchToken: null, relDir: '', dirName: '',
    // pendingPayloads: 输入下标 → 待重试的落库请求。并发下可能同时有多关落库失败，
    //   单槽会把先失败的那关覆盖掉、永久丢失，故改为按下标存多笔。
    persistedCount: 0, pendingPayloads: {}, failed: false
  };

  function switchView(view) {
    var sim = document.getElementById('view-simulator');
    var gen = document.getElementById('view-generator');
    var headerActions = document.getElementById('header-actions');
    var btnSim = document.getElementById('btn-view-simulator');
    var btnGen = document.getElementById('btn-view-generator');
    var isGen = view === 'generator';
    if (sim) sim.classList.toggle('hidden', isGen);
    if (gen) gen.classList.toggle('hidden', !isGen);
    if (headerActions) headerActions.classList.toggle('hidden', isGen);
    if (btnSim) btnSim.classList.toggle('active', !isGen);
    if (btnGen) btnGen.classList.toggle('active', isGen);
    if (isGen) renderGenFileList();
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
    canvas.addEventListener('pointerdown', function (e) { dragging = true; canvas.classList.add('grabbing'); sx = e.clientX - targetPan.x; sy = e.clientY - targetPan.y; try { canvas.setPointerCapture(e.pointerId); } catch (x) { } });
    canvas.addEventListener('pointermove', function (e) { if (!dragging) return; targetPan.x = e.clientX - sx; targetPan.y = e.clientY - sy; clampTargetPan(); });
    function endDrag() { dragging = false; canvas.classList.remove('grabbing'); }
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
  var animPxPerTick = 2;   // 每帧消除像素数（1=单像素逐个消除）
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
    document.getElementById('btn-sample').addEventListener('click', loadSample);
    document.getElementById('btn-generate').addEventListener('click', runGenerate);
    document.getElementById('btn-simulate').addEventListener('click', enterSimulation);
    document.getElementById('btn-exit-sim').addEventListener('click', exitSimulation);
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
    // 切换路线模式：若路线正在显示，立即按新模式重算并刷新（不必先关再开）
    var rmSel = document.getElementById('route-mode');
    if (rmSel) rmSel.addEventListener('change', function () {
      if (!routeOverlay.active) return;
      var r = buildRouteOverlay();
      if (!r.ok) { alert('该模式下无法求出路线：' + r.reason); return; }
      refreshSimUI();
      var el = document.getElementById('solve-details');
      if (el) el.innerHTML = '<p style="color:#8bc34a">🗺 路线已切换为「' + modeCN(r.mode) + '」</p>' +
        '<p>共 ' + r.steps + ' 步</p>' + (r.completed ? '' :
          '<p style="color:#e0592c;font-size:11px">该模式下未通关，路线仅为尽力解</p>');
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
      elimSimSpeed = parseInt(this.value, 10) || 60;
      var lbl = document.getElementById('elim-sim-speed-val'); if (lbl) lbl.textContent = elimSimSpeed + 'ms/格';
    });
    var spd = document.getElementById('anim-speed');
    if (spd) spd.addEventListener('input', function() {
      animPxPerTick = parseInt(this.value) || 2;
      var lbl = document.getElementById('anim-speed-val');
      if (lbl) lbl.textContent = this.value + 'px/帧';
    });
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
    bindClick('btn-analyze', batchAnalyze);

    // 滑块实时显示
    bindSlider('gen-ice', 'gen-ice-val', function(v) { return v + '%'; });
    bindSlider('gen-black', 'gen-black-val', function(v) { return v + '%'; });
    bindSlider('gen-surprise', 'gen-surprise-val', function(v) { return v + '%'; });

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
    bindClick('btn-view-simulator', function () { switchView('simulator'); });
    bindClick('btn-view-generator', function () { switchView('generator'); });
    bindClick('btn-gen-import-txt', importTXT);
    bindClick('btn-gen-start', batchProduce);
    bindClick('btn-gen-stop', stopBatchProduce);
    bindClick('btn-gen-download', genDownloadPending);
    bindClick('btn-gen-persist-retry', genRetryPersist);   // 落库失败后重试同一关(服务端幂等)
    bindClick('btn-gen-log-clear', function () { var el = document.getElementById('gen-log'); if (el) el.innerHTML = ''; });
    var fileSortSel = document.getElementById('gen-file-sort');
    if (fileSortSel) fileSortSel.addEventListener('change', renderGenFileList);
    var fileGroupChk = document.getElementById('gen-file-group');
    if (fileGroupChk) fileGroupChk.addEventListener('change', renderGenFileList);
    var resultSortSel = document.getElementById('gen-result-sort');
    if (resultSortSel) resultSortSel.addEventListener('change', function () { renderGenResultTable(genBatchResults); });
    var resultGroupSel = document.getElementById('gen-result-group');
    if (resultGroupSel) resultGroupSel.addEventListener('change', function () { renderGenResultTable(genBatchResults); });
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
    // v109 补入：v103 卡点类型体系的全部控件（ANT-GEN-SCHEME-CHOKE-TYPES-20260826）。
    // 与上面 `gen-bottom-only`(v99) 和六个管道参数(v105) 同一性质的既有缺陷——
    // v103 引入卡点类型至今，这 16 个控件一个都没进白名单，导致：
    //   勾好 11 种类型 → 存方案 → 重新加载后勾选全部回落 HTML 默认值、卡点数量归零。
    // 实证：`方案文件夹/方案_v104.json` 的 inputs 只有 24 个键、零个卡点相关键。
    // 于是任务 W 已批准的「每关各类型卡点数量可配」在方案层面根本不成立，
    // 用户每批都得手动重勾、且无法复现上一批的卡点配置。补白名单是该需求可用的必要条件。
    // 注：captureScheme/applyScheme 本就有勾选框分支（按 el.type 判定），无需改动它们，
    //     缺的只是这些 ID 从未被登记进本白名单。
    'gen-choke-iceCluster','gen-choke-chainCluster','gen-choke-questionCluster',
    'gen-choke-chainIce','gen-choke-pipeChain','gen-choke-narrowGapIce',
    'gen-choke-narrowGapChain','gen-choke-bigBox','gen-choke-rareColorKey',
    'gen-choke-swap','gen-choke-inflate',
    // 卡点类型的数量与门控：只存类型不存数量，等于每关抽几种仍然丢失。
    'gen-choke-count','gen-choke-count-boss','gen-choke-gate-narrow',
    // `bigBox` 这一类型自身的倍率参数；不存则该类型行为不可复现。
    'gen-bigbox-min','gen-bigbox-max',
    // BOSS 规格间隔：决定哪些关按 BOSS 规格生产、从而使用 chokeTypeCountBoss。
    // 不存则 BOSS 卡点配额存住了也不知道发给谁。
    'gen-boss-interval',
    // v109 追加：v102 碎色前置闸门阈值（用户 2026-08-26 裁决「碎色门阈值当然补进参数」）。
    // 同为白名单既有缺口：阈值不进方案 → 存了也存不住、加载后回落 index.html 默认值 18%。
    // 该阈值决定哪些源图在生产前被直接跳过，是批次可复现性的关键参数之一。
    'gen-frag-max',
    // v110 补入：底部并行吐球路数（ANT-GEN-BOTTOM-PARALLEL-V3-20260826）。
    // 它决定底部消除的盒队列交错程度，直接影响产出结构，必须随方案走。
    'gen-box-parallel'];

  // 抓取当前所有生成器输入 → {id: value|checked}
  function captureScheme() {
    var o = {};
    SCHEME_INPUTS.forEach(function (id) {
      var el = document.getElementById(id); if (!el) return;
      o[id] = (el.type === 'checkbox') ? !!el.checked : el.value;
    });
    return o;
  }
  // 应用方案到输入控件（并触发 input 事件更新滑块标签）
  function applyScheme(inputs) {
    if (!inputs) return;
    SCHEME_INPUTS.forEach(function (id) {
      if (!(id in inputs)) return;
      var el = document.getElementById(id); if (!el) return;
      if (el.type === 'checkbox') el.checked = !!inputs[id];
      else el.value = inputs[id];
      try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
    });
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
    var obj = { type: 'antGenScheme', version: 1, name: name, savedAt: new Date().toISOString(), inputs: inputs, config: getGenConfig() };
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
  var levelList = []; // [{name, blocks}]
  var currentLevelIdx = -1;

  function handleTXTSelect(e) {
    var files = e.target.files;
    if (!files || files.length === 0) return;

    levelList = [];
    currentLevelIdx = -1;
    var loaded = 0;
    var total = files.length;

    for (var i = 0; i < files.length; i++) {
      (function(file, idx) {
        var reader = new FileReader();
        reader.onload = function(ev) {
          try {
            var blocks = AntSolver.Generator.blocksFromTXT(ev.target.result);
            if (blocks && blocks.length > 0) {
              levelList.push({ name: file.name, blocks: blocks, txt: ev.target.result });
            }
          } catch(err) { /* skip bad files */ }
          loaded++;
          if (loaded >= total) {
            // 全部加载完毕
            levelList.sort(function(a, b) {
              var na = parseInt(a.name) || 0, nb = parseInt(b.name) || 0;
              return na - nb;
            });
            onAllTXTLoaded();
          }
        };
        reader.readAsText(file);
      })(files[i], i);
    }
    e.target.value = '';
  }

  function onAllTXTLoaded() {
    if (levelList.length === 0) { alert('未解析到有效TXT文件'); return; }
    // 显示关卡列表
    document.getElementById('level-list-panel').classList.remove('hidden');
    document.getElementById('level-list-count').textContent = '(' + levelList.length + ')';
    renderLevelList();
    renderGenFileList();
    // 自动加载第一关
    selectLevel(0);
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
      renderLevelList();
      // 惰性难度：导入时【不】逐关 solve(那会卡死主线程)，改为打开某关时按需算一次并缓存到 entry.difficulty。
      //   数据包导入的关卡通常已带难度→跳过；只有导入纯关卡本体(无难度)时才在这里算，且只算当前打开的这一关。
      if (!entry.difficulty && AntSolver.Analysis && AntSolver.Solver) {
        try {
          var parsedLz = AntSolver.parseLevel(entry.level);
          var resLz = AntSolver.Solver.solve(parsedLz);
          entry.difficulty = AntSolver.Analysis.difficulty(parsedLz, resLz, null);
        } catch (eLz) { /* 算不出就不显示难度，不影响加载 */ }
      }
      var html2 = '<p>' + entry.name + '</p>';
      if (entry.difficulty) {
        html2 += '<p><b>难度: ' + entry.difficulty.score + '/100 [' + entry.difficulty.grade + ']</b></p>';
        if (entry.difficulty.obstacleNames) html2 += '<p style="font-size:10px;color:#888">障碍: ' + entry.difficulty.obstacleNames + '</p>';
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
    document.getElementById('solve-result').classList.remove('hidden');
    document.getElementById('solve-details').innerHTML = html;
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
        var out = {}, list = [
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
      // 超大盒倍率（q9 参数化）：缺控件时用 1.5~2.0，与参数化前完全一致
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
      easyRatioPercent: (function () { var v = parseInt((document.getElementById('gen-easy-ratio') || {}).value); return isNaN(v) ? 30 : Math.max(0, Math.min(100, v)); })()
      // 难度参数已删除：难度由生产合格后的求解器反推(Analysis.difficulty)计算；diffLevel 用内部默认(2)
    };
  }

  function loadSample() {
    var samples = AntSolver.getSampleLevels();
    if (!samples.length) { alert('示例关卡未加载（levels.js）'); return; }
    levelList = samples.map(function(s) { return { name: s.name, blocks: s.blocks, level: s.level }; });
    currentLevelIdx = -1;
    document.getElementById('level-list-panel').classList.remove('hidden');
    document.getElementById('level-list-count').textContent = '(' + levelList.length + ')';
    renderLevelList();
    selectLevel(0);
  }

  function loadLevel(json) {
    stopAutoPlay();
    currentImportedSolve = null;   // 默认无导入求解数据（生成/TXT关卡→需要时重新求解）
    currentGenerationEval = null;
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
        var isElim = eliminated && eliminated[r][c];
        var x = c * step, y = r * step;
        if (isElim) {
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
        cells[r2][c2] = { t: 'box', color: b.color, count: b.count, ice: 0, chain: 0, q: false, _seq: bi };
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
    function tick() {
      if (!elimSim.active || token !== elimSim.token) return;
      if (idx >= cells.length) { elimSim.timer = null; elimSimRender(); if (done) done(); return; }
      var p = cells[idx++], r = p[0], c = p[1];
      if (elimSim.visualElim && !elimSim.visualElim[r][c]) {
        elimSim.visualElim[r][c] = true;
        if (elimSim.actualRank) elimSim.actualRank[r][c] = ++elimSim.nextRank;
      }
      elimSimRender();
      elimSim.timer = setTimeout(tick, elimSimSpeed); // 每一像素读取慢放参数，可实时调速
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

    if (simulating && !override) {
      var boxes = container.querySelectorAll('.board-cell.pickable');
      for (var i = 0; i < boxes.length; i++) boxes[i].addEventListener('click', handleBoxClick);
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
    var cls = 'board-cell box' + (pickable ? ' pickable' : '');
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
    if (cell.ice > 0) {
      // 冰块：显示解冻进度 thaw/durability（模拟中）
      var thawTxt = '❄';
      if (state && state.frozen && state.frozen[r + ',' + c]) {
        var f = state.frozen[r + ',' + c];
        thawTxt = '❄' + Math.max(0, f.thaw) + '/' + f.durability;
      } else {
        thawTxt = '❄' + cell.ice;
      }
      overlay += '<span class="ov ice">' + thawTxt + '</span>';
    }
    // 锁链：同组同色边框标识"锁在一起的块"，不同组不同色（生成阶段已保证不同组不相邻）。
    if (cell.chain > 0) {
      var ccol = chainColor(cell.chain);
      style += ';outline:3px solid ' + ccol + ';outline-offset:-3px';
      var gtag = chainTag(cell.chain);
      overlay += '<span class="ov chain" style="color:' + ccol + '" title="锁链组 ' + gtag + '（同组全解锁才可连体入暂存）">🔗' + gtag + '</span>';
      title += '｜锁链组' + gtag;
    }
    // 锁定态（冰未解冻）灰显
    var iceLocked = state && state.frozen && state.frozen[r + ',' + c] &&
                    !(state.frozen[r + ',' + c].activated && state.frozen[r + ',' + c].thaw >= state.frozen[r + ',' + c].durability);
    if (iceLocked) cls += ' locked';
    return '<div class="' + cls + '" style="' + style + '" data-r="' + r + '" data-c="' + c + '" title="' + title + '">' +
           '<span class="cnt">' + label + '</span>' + overlay + '</div>';
  }

  function handleBoxClick(e) {
    if (!simulating) return;
    var r = parseInt(e.currentTarget.dataset.r);
    var c = parseInt(e.currentTarget.dataset.c);
    if (isNaN(r) || isNaN(c)) return;
    var ok = AntSolver.Simulator.pickBox(r, c);
    if (ok) { renderQueues(AntSolver.Simulator.getState()); enqueuePickOps(); startAnim(); }
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
  function syncVisual(state) { initVisual(state); } // 即时同步（撤销/重置/进入）

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

  function animTick() {
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
    redrawCharts();
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
  function redrawCharts(cursor) {
    if (!chartCache) return;
    var c = chartCache;
    drawPressureChart('chart-omni', c.omni.samples, c.limit, c.totalBoxes, 'chart-omni-cap', c.omni.won, c.omni.choke, c.omni.itemUses,
      { audit: c.omni.audit, items: c.omni.items, preview: c.omni.preview, cursorProgress: cursor && cursor.side === 'omni' ? cursor.p : null, cursorStep: cursor && cursor.side === 'omni' ? cursor.step : null });
    drawPressureChart('chart-player', c.player.samples, c.limit, c.totalBoxes, 'chart-player-cap', c.player.won, c.player.choke, c.player.itemUses,
      { audit: c.player.audit, items: c.player.items, preview: c.player.preview, revives: c.player.reviveEvents || [], cursorProgress: cursor && cursor.side === 'player' ? cursor.p : null, cursorStep: cursor && cursor.side === 'player' ? cursor.step : null });
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
    chartCache = { limit: limit, totalBoxes: totalBoxes, omni: { samples: [], won: false, items: [], itemUses: 0 }, player: { samples: [], won: false, items: [], itemUses: 0, reviveEvents: [], trajectory: [] } };
    try {
      // 旧导入审核数据仍可复用；现场新算时显式采集动态封锁快照，才显示封锁热度带。
      var oSamples, oWon, oItems = [], oItemUses = 0, reused = false;
      if (currentGenerationEval && currentGenerationEval.omni && currentGenerationEval.omni.pressureSamples && currentGenerationEval.omni.pressureSamples.length) {
        oSamples = currentGenerationEval.omni.pressureSamples;
        oWon = !!currentGenerationEval.omni.won; reused = true;
      } else if (currentImportedSolve && currentImportedSolve.pressureSamples && currentImportedSolve.pressureSamples.length) {
        oSamples = currentImportedSolve.pressureSamples; oWon = !!currentImportedSolve.completed; reused = true;
      } else {
        var omni = AntSolver.Solver.runSolver(currentLevel, 0, 1, true, false, { capturePreviewStats: true });
        oSamples = omni.pressureSamples || []; oWon = omni.completed; oItems = omni.itemMarks || []; oItemUses = omni.itemUses || 0;
      }
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
    redrawCharts();
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
    stopAutoPlay(); stopAnim(); stopPlayerDemo();
    AntSolver.Simulator.reset();
    applyElimModeToState(elimModeSelected());
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
    document.getElementById('sim-controls').classList.remove('hidden');
    document.getElementById('btn-simulate').disabled = true;
    document.getElementById('btn-exit-sim').classList.remove('hidden');
    var bc = document.getElementById('board-charts'); if (bc) bc.classList.remove('hidden');
    document.getElementById('status-title').textContent = '模拟游玩';
    refreshSimUI();
    renderPressureCharts();   // 进入模拟即计算并绘制 全知/玩家 暂存压力复合图
  }

  function exitSimulation() {
    stopAutoPlay();
    stopAnim();
    visualElim = null;
    simulating = false;
    // 退出模拟时清掉求解路线叠加，避免下次进入或换关时残留上一关的路线
    routeOverlay = { active: false, map: null, total: 0, mode: null };
    var rb = document.getElementById('btn-show-route'); if (rb) rb.classList.remove('active');
    AntSolver.Simulator.exit();
    document.getElementById('section-buffer').classList.add('hidden');
    document.getElementById('sim-controls').classList.add('hidden');
    document.getElementById('btn-simulate').disabled = !currentLevel;
    document.getElementById('btn-exit-sim').classList.add('hidden');
    var bc2 = document.getElementById('board-charts'); if (bc2) bc2.classList.add('hidden');
    document.getElementById('status-title').textContent = '关卡信息';
    removeGameMsg();
    if (currentLevel) { renderTarget(null); renderQueues(null); renderLevelInfo(); }
  }

  function refreshSimUI() {
    var state = AntSolver.Simulator.getState();
    if (!state) return;
    syncVisual(state);          // 即时同步（无动画）
    renderTarget(state.eliminated);
    renderQueues(state);
    renderVisualBuffer(state);
    renderVisualStats(state);
    if (state.gameOver) showGameMsg(state.gameWon);
  }

  // revive: 可选 { revivesUsed, reviveCap }——仅玩家版演示传入(需求 §5.6：结束信息同步 通关/复活次数/上限/是否用尽/失败原因)。
  function showGameMsg(won, revive) {
    removeGameMsg();
    var div = document.createElement('div');
    div.className = 'game-msg'; div.id = 'game-msg';
    var state = AntSolver.Simulator.getState();
    div.innerHTML = won
      ? '<h2 style="color:#8bc34a">🎉 通关！</h2><p>步数: ' + state.steps + '</p>'
      : '<h2 style="color:#e0592c">💀 失败</h2><p>暂存区溢出</p>';
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

  function doUndo() { stopAutoPlay(); stopAnim(); AntSolver.Simulator.undo(); removeGameMsg(); refreshSimUI(); }
  // 重置：Simulator.reset() 会重建状态、把模式开关清成默认（四边入口）。
  // 若不在这里按下拉重新套用模式，用户在底部/瞬时连锁模式下点一次重置就会静默退回四边入口，
  // 之后的手点消除全按错规则走且无任何提示。
  function doReset() {
    stopAutoPlay(); stopAnim();
    AntSolver.Simulator.reset();
    applyElimModeToState(elimModeSelected());
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
    var state = AntSolver.Simulator.getState();
    if (state.gameOver) return false;
    if (doAutoPick(state)) { enqueuePickOps(); startAnim(); return true; }
    return false;
  }

  // ⏩ 自动求解·全知版：求解器求最优 → 逐步回放(棋盘/暂存同步)；再点=停
  function runOmniDemo() {
    if (!AntSolver.Simulator.isActive()) return;
    if (demoMode === 'replay' || demoMode === 'auto') { stopAutoPlay(); return; }
    stopPlayerDemo();
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
    return (!v || v === 'auto') ? currentSimMode() : v;
  }
  function buildRouteOverlay() {
    var mode = routeModeSelected();
    var result = solveByMode(mode);
    var order = (result && result.pickOrder) || [];
    if (!order.length) return { ok: false, reason: '该模式下没有求出可用的取盒顺序' };
    // 同一格可能被取多次（管道会补位）→ 记录该格出现过的所有步号
    var map = {};
    for (var i = 0; i < order.length; i++) {
      var p = order[i], k = p.r + ',' + p.c;
      if (!map[k]) map[k] = [];
      map[k].push(i + 1);
    }
    routeOverlay = { active: true, map: map, total: order.length, mode: mode, completed: !!result.completed };
    return { ok: true, steps: order.length, completed: !!result.completed, mode: mode };
  }
  function modeCN(m) {
    return m === 'instantChain' ? '四方向瞬时连锁' : (m === 'bottomOnly' ? '仅底部入口' : '四边入口');
  }
  function toggleRouteOverlay() {
    var btn = document.getElementById('btn-show-route');
    if (routeOverlay.active) {
      routeOverlay = { active: false, map: null, total: 0, mode: null };
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
      var sel = document.getElementById('route-mode');
      var followed = (!sel || sel.value === 'auto');
      el.innerHTML = '<p style="color:#8bc34a">🗺 已显示求解路线</p>' +
        '<p>路线模式: ' + modeCN(r.mode) + (followed ? '（跟随当前）' : '（手动指定）') + '</p>' +
        (followed || r.mode === currentSimMode() ? '' :
          '<p style="color:#e6a23c;font-size:11px">提示：路线用的是「' + modeCN(r.mode) +
          '」，而模拟器当前处于「' + modeCN(currentSimMode()) + '」，两者不一致，仅供对照</p>') +
        '<p>共 ' + r.steps + ' 步</p>' +
        (r.completed ? '' : '<p style="color:#e0592c;font-size:11px">注意：该模式下未通关，路线仅为尽力解</p>') +
        '<p style="font-size:11px;color:#8a7358">格子上的数字＝第几步取该盒；同一格被取多次会显示多个步号。' +
        '绿→橙→红代表早期→中期→后期。黄色描边＝下一步。</p>';
    }
  }
  // 给棋盘格子注入路线角标。放在 renderQueues 的格子循环里调用。
  function applyRouteMark(cellHtml, r, c, state) {
    if (!routeOverlay.active || !routeOverlay.map) return cellHtml;
    var steps = routeOverlay.map[r + ',' + c];
    if (!steps || !steps.length) return cellHtml;
    var done = state ? (state.steps || 0) : 0;
    // 只显示还没走到的步号里最靠前的那个；全部走过则显示最后一个（便于回看）
    var show = null;
    for (var i = 0; i < steps.length; i++) { if (steps[i] > done) { show = steps[i]; break; } }
    var isNext = show === done + 1;
    if (show == null) show = steps[steps.length - 1];
    var frac = routeOverlay.total ? show / routeOverlay.total : 0;
    var seg = frac <= 0.34 ? 'route-early' : (frac <= 0.67 ? 'route-mid' : 'route-late');
    var cls = 'route-step ' + seg + (isNext ? ' route-next' : '');
    var title = '求解路线：第 ' + steps.join('/') + ' 步取此盒（共 ' + routeOverlay.total + ' 步）';
    return cellHtml.replace('class="board-cell', 'data-route="' + show + '" title="' + title + '" class="board-cell ' + cls + ' ');
  }

  // ⏩ 自动求解·底部专用版：只能从底部拿块(上/左/右封闭) → 逐步回放；再点=停
  function runBottomDemo() {
    if (!AntSolver.Simulator.isActive()) return;
    if (demoMode === 'replay' || demoMode === 'auto') { stopAutoPlay(); return; }
    stopPlayerDemo();
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
        for (var ai = 0; ai < f.board.added.length; ai++) { var ad = f.board.added[ai]; playerCells[ad.r][ad.c] = { t: 'box', color: ad.color, count: ad.count, ice: 0, chain: 0, q: false }; }
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
  function runGenerate() {
    var config = getGenConfig();

    // 如果当前有导入的TXT图，使用它
    if (currentLevelIdx >= 0 && levelList[currentLevelIdx]) {
      var entry = levelList[currentLevelIdx];
      config.mapSize = entry.blocks.length;

      document.getElementById('solve-result').classList.remove('hidden');
      document.getElementById('solve-details').innerHTML = '<p style="color:#888">正在生成...</p>';

      setTimeout(function() {
        var result = AntSolver.Generator.produce(entry.blocks, config);
        loadLevel(result.level);
        currentGenerationEval = result.generationEval || null;
        currentEntryMode = result.entryMode || entryModeOf(config);
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
        displayGenerateResult(result);
      }, 50);
    }
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
  function genBuildRec(entry, result) {
    if (!result || !result.level) {
      var why = (result && result.lastFailReason) || 'noCandidate';
      var detail = (result && result.structural && result.structural.reason) || '';
      var cn = { fragmentGateBlocked: '碎色超限', bottomEntryInfeasible: '底部入口不可达', noCandidate: '候选全灭' };
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
      // 管道落位与兜底（ANT-GEN-PIPE-DEPTH-FALLBACK-20260825）：want/placed/capacityPerPipe +
      //   fallback/fallbackFrom/fallbackShallow。兜底会让「管道数下限」实际不达标，
      //   不记录就无法回答"这关为什么只有 2 条管道"，也无法统计兜底触发率。
      pipeStat: (result.level && result.level.board && result.level.board.pipeStat) || null,
      steps: sr.steps, maxBuffer: sr.maxBuffer, progress: sr.progress,
      difficulty: result.difficulty ? result.difficulty.score : 0,
      grade: result.difficulty ? result.difficulty.grade : '-',
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
    function once() {
      return fetch(pathname, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload })
        .then(function (r) { return r.json().catch(function () { return { ok: false, error: 'HTTP ' + r.status }; }); });
    }
    return once().catch(function () { return once(); });
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
        entryMode: rec.entryMode || 'fourSide',
        bufferLimit: rec.level ? rec.level.bufferLimit : null,
        blocks: rec.level ? rec.level.blocks : null, board: rec.level ? rec.level.board : null,
        audit: rec.audit || null, generationEval: rec.generationEval || null, solve: rec.solve || null,
        fallback: !!rec.fallback, fallbackTier: rec.fallbackTier, fallbackType: rec.fallbackType, fallbackReason: rec.fallbackReason,
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
        // 注意：不调 next()。该槽位就此停住不再领新关，避免在服务已经写不进去的情况下继续空转产出。
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
      genBatchResults.push(rec);
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
    genBatchResults.push(rec);
    var dt = (rec._elapsedMs / 1000).toFixed(1);
    var tierTxt = rec.fallback ? ('兜底·' + (rec.fallbackType === 'timeout' ? '超时' : '穷尽')) : ((rec.audit && rec.audit.tier) || (rec.valid ? '合格' : '不可解'));
    genLog(entry.name + '  ' + dt + 's  ' + tierTxt + (rec.valid ? ('  难度' + rec.difficulty + '[' + rec.grade + ']') : ''),
      rec.fallback ? 'gen-log-warn' : (rec.audit && (rec.audit.tier === '合格' || rec.audit.tier === '困难合格') ? 'gen-log-ok' : ''));
    if (genPersist.enabled) {
      genPersistOne('result', inputIndex, genPersistPayload(entry, rec, result), next);
    } else if (typeof next === 'function') next();
  }

  function genOnError(entry, msg, inputIndex, next) {
    var rec = { name: entry ? entry.name : '(未知)', valid: false, audit: null, difficulty: 0, grade: '-', fallback: false, error: msg, _idx: inputIndex };
    genBatchResults.push(rec);
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
    genUpdateStatChips([]);
    genUpdateProgressBar(0, levelList.length);

    var startBtn = document.getElementById('btn-gen-start');
    var stopBtn = document.getElementById('btn-gen-stop');
    if (startBtn) startBtn.disabled = true;
    if (stopBtn) stopBtn.classList.remove('hidden');

    genBatchRunning = true; genBatchAborted = false; genBatchStartAt = Date.now();
    genBatchResults = [];

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
      genLog('BOSS 名额：每 ' + bossInterval + " 关一个，共 " + bossCount + ' 关按 BOSS 规格生产（卡点类型数 ' +
        (config.chokeTypeCountBoss || 0) + ' vs 普通 ' + (config.chokeTypeCountNormal || 0) + '）。' +
        '注意：生产顺序≠上线顺序，排序时需按记录里的 isBossSlot 放到逢5位。', 'gen-log-warn');
    }
    // 并发线程数：UI 可配。默认 6（本机 10 核，留余量给主线程、本地生产服务与系统）。
    //   设 1 → 与改多线程之前的串行行为完全等价，便于对照与回退。
    //   刻意不允许超过 hardwareConcurrency：超订会让各关在同样的墙上预算内算得更少 →
    //   budget_timeout 与兜底关变多，是质量回退（单关预算是墙上时间，不是 CPU 时间）。
    var hw = (navigator.hardwareConcurrency || 8);
    var poolInput = parseInt((document.getElementById('gen-pool-size') || {}).value, 10);
    genPoolSize = Math.max(1, Math.min(isNaN(poolInput) ? 6 : poolInput, hw));
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
      if (d.type === 'result') { clearTimeout(slot.watchdog); genSlotSettle(slot, d.index, function (next) { genOnResult(levelList[d.index], d.result, d.index, next); }); return; }
      if (d.type === 'error') { clearTimeout(slot.watchdog); genSlotSettle(slot, d.index, function (next) { genOnError(levelList[d.index], d.message, d.index, next); }); return; }
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
    slot.busy = true; slot.idx = idx;
    genInFlightT0[idx] = Date.now();
    genPoolProgressText();
    slot.w.postMessage({
      cmd: 'produce', index: idx, blocks: entry.blocks,
      config: Object.assign({}, b.config, {
        mapSize: entry.blocks.length, requireHardPass: !isEasy,
        isBossSlot: !!(b.bossSlot && b.bossSlot[idx])      // BOSS 规格逐关透传（卡点类型配额用）
      })
    });
    // 单关看门狗：超过【单关预算 + 2 分钟余量】仍无返回 → 判定该关卡死，跳过并只重启这一个槽（预算=0/不限时则不设）
    clearTimeout(slot.watchdog);
    var budget = (b.config && b.config.timeBudgetMs != null) ? b.config.timeBudgetMs : 300000;
    if (budget > 0) slot.watchdog = setTimeout(function () { genOnLevelStuck(slot, idx); }, budget + 120000);
  }

  /** 进度行：并发下同时有多关在飞，逐个列出，不再只显示一关。 */
  function genPoolProgressText() {
    var curEl = document.getElementById('gen-progress-current');
    if (!curEl || !genBatch) return;
    var flying = genPool.filter(function (s) { return s.busy && s.idx >= 0; })
      .map(function (s) { var e = levelList[s.idx]; return '#' + (s.no + 1) + '→' + (s.idx + 1) + '.' + (e ? e.name.replace(/\.txt$/i, '') : '?'); });
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
          var cfg = Object.assign({}, b.config, {
            mapSize: entry.blocks.length, requireHardPass: !isEasy,
            isBossSlot: !!(b.bossSlot && b.bossSlot[curIdx])
          });
          var result = AntSolver.Generator.produce(entry.blocks, cfg);
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
          var msg = (genBatchAborted ? '生产已停止' : '生产完成') + '　输出目录：' + relDir + '　合格 ' + q + ' / 不合格 ' + u + ' / 异常 ' + er;
          genLog(msg, 'gen-log-ok');
          genPersistStatusEl(msg, 'ok');
          var curEl2 = document.getElementById('gen-progress-current');
          if (curEl2) curEl2.textContent = (genBatchAborted ? '已停止' : '已完成') + '，输出目录：' + relDir;
        })
        .catch(function (e) { genLog('收尾通知服务失败：' + e.message + '（已落库的关卡不受影响）', 'gen-log-warn'); });
      renderGenResultTable(results);
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

    // 结果表(排序/分组展示，见 renderGenResultTable)：先出结果表，再打包下载，用户能立刻看到每关明细。
    var resultCard = document.getElementById('gen-result-card');
    if (resultCard) resultCard.classList.remove('hidden');
    var countEl = document.getElementById('gen-result-count');
    if (countEl) countEl.textContent = '(' + results.length + ')';
    renderGenResultTable(results);

    if (!AntSolver.Zip) { alert('ZIP模块未加载'); return; }

    var config = getGenConfig();
    var files = [];
    var used = {};
    var nowIso = new Date().toISOString();   // 整批统一时间戳（求解数据 meta 与包内各处保持一致）
    var dataLevels = [];   // 汇总到 关卡数据/关卡数据.json（含【完整内部 board】→ 无损还原 + 审核/求解/难度），本地调试用

    // CSV 分析报告表头
    var csv = ['关卡,目标图入口模式,尺寸,棋盘,盒数,可解,难度分,难度等级,障碍,峰值暂存,均暂存,50%后均暂,50%后峰窗,求解遍可通率,审核合格,合格档,是否兜底,兜底类型,生成诊断分,全知后期封锁,玩家后期封锁,玩家暂存峰,玩家通关,卡点@,前期峰窗,中期峰窗,后期峰窗,不合格原因'];
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
        au.earlyMax, au.midMax, au.lateMax, '"' + (au.reasons.join('；') || '') + '"'
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
  function renderGenResultTable(results) {
    var body = document.getElementById('gen-result-body');
    if (!body) return;
    if (!results || !results.length) { body.innerHTML = ''; return; }
    var sortBy = (document.getElementById('gen-result-sort') || {}).value || 'order';
    var groupBy = (document.getElementById('gen-result-group') || {}).value || 'none';
    var items = results.map(function (r, i) { return { r: r, order: i }; });
    items.sort(function (a, b) {
      if (sortBy === 'name') return String(a.r.name).localeCompare(String(b.r.name), 'zh');
      if (sortBy === 'difficulty-desc') return (b.r.difficulty || 0) - (a.r.difficulty || 0);
      if (sortBy === 'difficulty-asc') return (a.r.difficulty || 0) - (b.r.difficulty || 0);
      return a.order - b.order;
    });

    function rowHtml(x) {
      var r = x.r;
      return '<div class="gen-result-row">' +
        '<span class="gen-tier-dot ' + genTierClass(r) + '"></span>' +
        '<span class="gen-result-name" title="' + r.name + '">' + r.name + '</span>' +
        '<span class="gen-result-tier">' + genTierLabel(r) + '</span>' +
        '<span class="gen-result-diff">' + (r.valid ? (r.difficulty + '[' + r.grade + ']') : '-') + '</span>' +
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
    function normKey(n) { return String(n).replace(/\.(txt|json)$/i, ''); }
    var auditMap = {};    // 向后兼容：旧 _审核.json（无 board，仅 solve/audit）
    var dataFiles = [];   // 关卡数据.json（无损主数据：完整内部 board + 求解/审核/难度）
    var levelFiles = [];  // 关卡本体（官方 spools / 旧 blocks-board）或旧库
    for (var i = 0; i < parsedFiles.length; i++) {
      var pf = parsedFiles[i], j = pf.json; if (!j) continue;
      var lv0 = Array.isArray(j.levels) ? j.levels[0] : null;
      var isDataPack = j.type === 'ant-level-data' ||
        (lv0 && lv0.board && ('solve' in lv0 || 'audit' in lv0 || 'generationEval' in lv0));
      var isOldAudit = !j.blocks && !j.spools && !Array.isArray(j) && !j.levels && (j.solve || j.audit);
      if (isDataPack) dataFiles.push(pf);
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
    var all = order.map(function (nm) { return byName[nm]; });
    var withSolve = all.filter(function (x) { return x.solve; }).length;
    finishLibImport(all, errs, withSolve);
  }

  function finishLibImport(entries, errs, paired) {
    if (!entries.length) { alert('未解析到有效关卡（支持整个关卡包 / 单关json / 关卡库json，可多选）'); return; }
    // 按名称自然排序（L01, L02 …）
    entries.sort(function(a, b) { return String(a.name).localeCompare(String(b.name), undefined, { numeric: true }); });
    levelList = entries;
    currentLevelIdx = -1;
    document.getElementById('level-list-panel').classList.remove('hidden');
    var extra = (paired ? ('，' + paired + '含求解数据') : '') + (errs ? ('，' + errs + '个失败') : '');
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
  function batchAnalyze() {
    if (levelList.length === 0) {
      alert('请先导入TXT图或关卡库');
      return;
    }
    if (!AntSolver.Analysis) { alert('分析模块未加载'); return; }

    var panel = document.getElementById('analysis-result');
    var body = document.getElementById('analysis-body');
    if (panel) panel.classList.remove('hidden');
    if (body) body.innerHTML = '<p style="color:#888">分析中...</p>';

    var config = getGenConfig();
    var results = [];
    var idx = 0;

    function next() {
      if (idx >= levelList.length) { finishAnalyze(results); return; }
      var entry = levelList[idx];
      if (body) body.innerHTML = '<p style="color:#888">分析 ' + (idx + 1) + '/' + levelList.length + ': ' + entry.name + '</p>';
      setTimeout(function() {
        try {
          var level = entry.level || entry.generated;
          if (!level && entry.blocks) {
            var cfg = Object.assign({}, config, { mapSize: entry.blocks.length });
            var gen = AntSolver.Generator.generateFromBlocks(entry.blocks, cfg);
            level = gen.level;
            entry.generated = level;
          }
          if (level) {
            var parsed = AntSolver.parseLevel(level);
            var solveRes = AntSolver.Solver.solve(parsed);
            // 难度 v4：玩家版单跑(seed7)。必须继承本关实际玩法模式（需求 §6.1），
            // 否则瞬时连锁关卡会被静默按普通四方向评分。f1/f2 直接取 PlayerSim 的统一口径输出，
            // 不再在此就地手算平均暂存（原实现用 pressureSamples 即「完成事件轴」，与 §3 的操作 tick 轴不符）。
            var plRun = AntSolver.PlayerSim ? AntSolver.PlayerSim.run(parsed, {
              seed: 7,
              bottomOnly: !!(config && config.bottomOnly),
              instantChain: !!(config && config.instantChain)
            }) : null;
            var playerStats = plRun ? {
              won: plRun.won, avgBuffer: plRun.playerAvgBuffer, peak: plRun.bufferPeak,
              revives: plRun.revivesUsed || 0,
              avgResidence: plRun.avgResidence, effectiveTicks: plRun.effectiveTicks,
              residenceCount: plRun.residenceCount
            } : null;
            var diff = AntSolver.Analysis.difficulty(parsed, solveRes, playerStats);
            entry.difficulty = diff;
            results.push({
              name: entry.name,
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
              completed: solveRes.completed
            });
          }
        } catch (e) { /* 跳过异常关 */ }
        idx++;
        next();
      }, 10);
    }
    next();
  }

  function finishAnalyze(results) {
    lastAnalysis = results;
    var body = document.getElementById('analysis-body');
    if (!body) return;
    if (!results.length) { body.innerHTML = '<p class="fail">无有效分析结果</p>'; return; }

    // 难度分布
    var gradeCount = { '简单': 0, '普通': 0, '困难': 0, '极难': 0 };
    var passCount = 0;
    results.forEach(function(r) {
      gradeCount[r.grade] = (gradeCount[r.grade] || 0) + 1;
      if (r.completed) passCount++;
    });

    var html = '<div style="font-size:11px;color:#aaa;margin-bottom:6px">';
    html += '共 ' + results.length + ' 关 · 可解 ' + passCount + ' · ';
    html += Object.keys(gradeCount).map(function(g) { return g + ':' + gradeCount[g]; }).join(' ');
    html += ' <button id="btn-analyze-csv" style="margin-left:6px;padding:2px 8px;background:#6b4f34;color:#f3e9db;border:none;border-radius:3px;cursor:pointer">⬇ CSV</button></div>';

    html += '<div style="max-height:260px;overflow:auto"><table class="analysis-table"><thead><tr>';
    html += '<th>关卡</th><th>尺寸</th><th>难度</th><th>等级</th><th title="f1 玩家平均暂存(权重65%)">f1</th><th title="f2 玩家平均滞留(权重25%)">f2</th><th title="f3 基础障碍(权重10%)">f3</th><th title="玩家版是否通关(合格前提；未通关不出正式排序分)">玩家通关</th></tr></thead><tbody>';
    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      var gcls = 'grade-' + r.grade;
      html += '<tr>';
      html += '<td>' + r.name + '</td>';
      html += '<td>' + r.rows + '×' + r.cols + '</td>';
      html += '<td>' + r.score + '</td>';
      html += '<td class="' + gcls + '">' + r.grade + '</td>';
      html += '<td>' + r.parts.f1 + '</td>';
      html += '<td>' + r.parts.f2 + '</td>';
      html += '<td>' + r.parts.f3 + '</td>';   // v4：f4 已停用，此列改显 f3
      html += '<td style="color:' + (r.playerWon ? '#8bc34a' : '#e0592c') + '">' + (r.playerWon ? '✓' : '✗') + '</td>';
      html += '</tr>';
    }
    html += '</tbody></table></div>';
    body.innerHTML = html;
    var csvBtn = document.getElementById('btn-analyze-csv');
    if (csvBtn) csvBtn.addEventListener('click', exportAnalysisCSV);
  }

  function exportAnalysisCSV() {
    if (!lastAnalysis || !lastAnalysis.length) return;
    // v4 表头：f1/f2 均为玩家版；f4 保留列但恒为「已停用」（需求 §七 允许保留空值或明确标记）
    var lines = ['关卡,行,列,像素,难度分,难度等级,评分版本,可否排序,障碍,f1归一,f2归一,f3归一,f4,玩家均暂原始,玩家滞留原始,f3障碍原始,复活次数,复活加成,有效操作步,滞留统计盒数,全知均暂(对照),全知滞留(对照),玩家通关,峰值暂存,可解'];
    lastAnalysis.forEach(function(r) {
      var p = r.parts;
      lines.push([
        '"' + r.name + '"', r.rows, r.cols, r.pixels, r.score, r.grade,
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
      ].join(','));
    });
    var blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = '蚂蚁分析报告_' + lastAnalysis.length + '关_' + Date.now() + '.csv';
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
