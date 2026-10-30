/**
 * StackSort 求解器 - 界面与交互
 * 负责：加载关卡库、渲染棋盘+暂存区、处理点击移动、显示胜负。
 */
(function () {
  var TOTAL_LEVELS = 100;
  var LEVEL_DIR = '../levels（实验1-100关）/';

  var dom = {};
  // 关卡库：[{ name, raw(原始json) }]，下拉框与上/下关都基于它
  var library = [];
  var libIndex = -1;

  var current = {
    level: null,      // 解析后的关卡
    board: null,      // 当前棋盘模型（boards[boardIdx]）
    boardIdx: 0,
    state: null       // 引擎可玩状态
  };

  // 求解回放
  var solution = {
    moves: [],        // 求解出的点击列序列
    idx: 0,           // 当前回放到第几步
    baseState: null,  // 求解时的起始状态（用于回放重置）
    playing: false,
    timer: null
  };

  function $(id) { return document.getElementById(id); }

  function init() {
    // ★每次打开自动重置本地缓存：旧版本把历史方案不断堆进 localStorage，会把浏览器存储撑爆，
    //   进而拖垮页面、导致关卡下载 / 批量导入下载失效。现在方案改为【文件存储】(见生成器面板)。
    //   开页时把残留在 localStorage 的旧方案迁移进内存一次，然后彻底删除该缓存键 →
    //   每次打开都是干净状态，永不再累积撑爆。需要长期保存请用"方案文件 / 导出文件"。
    try {
      var _old = JSON.parse(localStorage.getItem('ss_gen_schemes') || '[]');
      if (Array.isArray(_old) && _old.length) gen.schemes = _old;
    } catch (e) { }
    try { localStorage.removeItem('ss_gen_schemes'); } catch (e2) { }
    dom.levelSelect = $('levelSelect');
    dom.prevBtn = $('prevBtn');
    dom.nextBtn = $('nextBtn');
    dom.resetBtn = $('resetBtn');
    dom.fileInput = $('fileInput');
    dom.board = $('board');
    dom.bench = $('bench');
    dom.moves = $('movesVal');
    dom.sizeVal = $('sizeVal');
    dom.colorVal = $('colorVal');
    dom.banner = $('banner');
    dom.legend = $('legend');
    dom.levelName = $('levelName');
    dom.solveBtn = $('solveBtn');
    dom.solveStatus = $('solveStatus');
    dom.solveSteps = $('solveSteps');
    dom.solveAttempts = $('solveAttempts');
    dom.solvePlayBtn = $('solvePlayBtn');
    dom.solveStepBtn = $('solveStepBtn');
    dom.solveSpeed = $('solveSpeed');
    dom.solveMode = $('solveMode');
    // 批量分析
    dom.batchBtn = $('batchBtn');
    dom.batchModal = $('batchModal');
    dom.batchRunBtn = $('batchRunBtn');
    dom.batchRuns = $('batchRuns');
    dom.batchCsvBtn = $('batchCsvBtn');
    dom.batchJpgBtn = $('batchJpgBtn');
    dom.batchCloseBtn = $('batchCloseBtn');
    dom.batchProgress = $('batchProgress');
    dom.batchChart = $('batchChart');
    dom.batchNotes = $('batchNotes');
    dom.batchTableWrap = $('batchTableWrap');
    // 编辑器
    dom.editBtn = $('editBtn');
    dom.editPanel = $('editPanel');
    dom.editDirty = $('editDirty');
    dom.undoBtn = $('undoBtn');
    dom.exportOneBtn = $('exportOneBtn');
    dom.exportAllBtn = $('exportAllBtn');
    dom.exitEditBtn = $('exitEditBtn');
    dom.srcColors = $('srcColors');
    dom.dstColors = $('dstColors');
    dom.selInfo = $('selInfo');
    dom.cellObsTools = $('cellObsTools');
    dom.colObsTools = $('colObsTools');
    dom.editSolveBtn = $('editSolveBtn');
    dom.editStatsFloat = $('editStatsFloat');
    dom.statsFloatClose = $('statsFloatClose');
    dom.statsFloatBody = $('statsFloatBody');
    dom.stepLimitInput = $('stepLimitInput');
    dom.editWarn = $('editWarn');
    dom.replaceOneCol = $('replaceOneCol');
    dom.addRowBtn = $('addRowBtn');
    dom.delRowBtn = $('delRowBtn');
    dom.addColBtn = $('addColBtn');
    dom.delColBtn = $('delColBtn');
    // 生成器
    dom.genBtn = $('genBtn');
    dom.genModal = $('genModal');
    dom.genBatch = $('genBatch');
    dom.genRuns = $('genRuns');
    dom.genAttempts = $('genAttempts');
    dom.genMarginMin = $('genMarginMin');
    dom.genMarginMax = $('genMarginMax');
    dom.genStrict = $('genStrict');
    dom.genRunBtn = $('genRunBtn');
    dom.genRefreshMargin = $('genRefreshMargin');
    dom.genZipBtn = $('genZipBtn');
    dom.genCloseBtn = $('genCloseBtn');
    dom.genAddGroup = $('genAddGroup');
    dom.genImportLib = $('genImportLib');
    dom.genGroupBody = $('genGroupBody');
    dom.genProgress = $('genProgress');
    dom.genChart = $('genChart');
    dom.genTableWrap = $('genTableWrap');
    dom.genCurve = $('genCurve');
    dom.genCurveGroups = $('genCurveGroups');
    dom.genSchemeSel = $('genSchemeSel');
    dom.genSchemeLoad = $('genSchemeLoad');
    dom.genSchemeSave = $('genSchemeSave');
    dom.genSchemeDel = $('genSchemeDel');
    dom.genSchemeClearAll = $('genSchemeClearAll');
    dom.genSchemeFile = $('genSchemeFile');
    dom.genSchemeExport = $('genSchemeExport');
    dom.genCurveWin = $('genCurveWin');
    dom.genCurveClear = $('genCurveClear');

    // 关卡下拉（初始为内置 1-100，库变化时重建）
    rebuildLevelSelect(TOTAL_LEVELS, function (i) { return 'Level ' + (i + 1); });

    dom.levelSelect.addEventListener('change', function () {
      selectLibIndex(parseInt(this.value, 10));
    });
    dom.prevBtn.addEventListener('click', function () {
      if (libIndex > 0) selectLibIndex(libIndex - 1);
    });
    dom.nextBtn.addEventListener('click', function () {
      if (libIndex < library.length - 1) selectLibIndex(libIndex + 1);
    });
    dom.resetBtn.addEventListener('click', function () {
      if (current.level) startBoard(current.boardIdx);
    });
    dom.fileInput.addEventListener('change', handleFileUpload);
    dom.solveBtn.addEventListener('click', runSolve);
    dom.solvePlayBtn.addEventListener('click', togglePlay);
    dom.solveStepBtn.addEventListener('click', function () { stepSolution(1); });
    if (dom.solveMode) dom.solveMode.addEventListener('change', function () {
      // 切换求解模式 → 清空上次回放，从初始局面重置，等待重新求解
      resetSolution();
      if (current.state && current.board) { current.state = SS.Engine.createState(current.board, current.level.stepCount); render(); }
    });
    dom.batchBtn.addEventListener('click', openBatch);
    dom.batchCloseBtn.addEventListener('click', function () { dom.batchModal.style.display = 'none'; });
    dom.batchRunBtn.addEventListener('click', runBatch);
    dom.batchCsvBtn.addEventListener('click', exportBatchCsv);
    dom.batchJpgBtn.addEventListener('click', exportBatchJpg);
    dom.editBtn.addEventListener('click', toggleEdit);
    dom.undoBtn.addEventListener('click', editUndo);
    dom.exportOneBtn.addEventListener('click', exportCurrentLevel);
    dom.exportAllBtn.addEventListener('click', exportAllEdited);
    dom.exitEditBtn.addEventListener('click', function () { exitEdit(true); });
    dom.editSolveBtn.addEventListener('click', runEditStats);
    dom.statsFloatClose.addEventListener('click', function () { dom.editStatsFloat.style.display = 'none'; });
    dom.stepLimitInput.addEventListener('change', function () {
      var n = parseInt(this.value, 10);
      if (!current.editing || isNaN(n) || n < 1) return;
      SS.Editor.snapshot();
      SS.Editor.setStepLimit(n);
      afterEditOp();
    });
    makeFloatDraggable();
    dom.addRowBtn.addEventListener('click', function () { editStructOp('addRow', '加一行'); });
    dom.delRowBtn.addEventListener('click', function () { editStructOp('removeRow', '删一行'); });
    dom.addColBtn.addEventListener('click', function () { editStructOp('addColumn', '加一列'); });
    dom.delColBtn.addEventListener('click', function () { editStructOp('removeColumn', '删一列'); });
    dom.genBtn.addEventListener('click', openGen);
    dom.genCloseBtn.addEventListener('click', function () { dom.genModal.style.display = 'none'; });
    dom.genAddGroup.addEventListener('click', function () { addGenGroup(); });
    if (dom.genImportLib) dom.genImportLib.addEventListener('click', importLibraryToGen);
    dom.genCurveClear.addEventListener('click', function () {
      gen.groups.forEach(function (g) { g.dmin = 0; g.dmax = 100; });
      Object.keys(gen.overrides).forEach(function (k) {     // 清除逐关难度覆盖
        if (gen.overrides[k]) { delete gen.overrides[k].dmin; delete gen.overrides[k].dmax; }
      });
      renderGenGroups(); drawGenCurve();
    });
    if (dom.genCurveGroups) dom.genCurveGroups.addEventListener('change', function () { drawGenCurve(); });
    if (dom.genMarginMin) dom.genMarginMin.addEventListener('change', function () { renderGenGroups(); });
    if (dom.genMarginMax) dom.genMarginMax.addEventListener('change', function () { renderGenGroups(); });
    if (dom.genSchemeSave) dom.genSchemeSave.addEventListener('click', function () { saveScheme(false); });
    if (dom.genSchemeLoad) dom.genSchemeLoad.addEventListener('click', loadSelectedScheme);
    if (dom.genSchemeDel) dom.genSchemeDel.addEventListener('click', deleteSelectedScheme);
    if (dom.genSchemeClearAll) dom.genSchemeClearAll.addEventListener('click', clearAllSchemes);
    if (dom.genSchemeFile) dom.genSchemeFile.addEventListener('click', linkSchemeFile);
    if (dom.genSchemeExport) dom.genSchemeExport.addEventListener('click', exportSchemeFile);
    setupCurveDrag();
    dom.genRunBtn.addEventListener('click', runGen);
    if (dom.genRefreshMargin) dom.genRefreshMargin.addEventListener('click', refreshMargins);
    dom.genZipBtn.addEventListener('click', downloadGenZip);

    // 初次：把内置 1-100 当作"惰性库"，点到哪关才 fetch 哪关
    initBuiltinLibrary();
    selectLibIndex(0);
  }

  // 用一组标签重建下拉框
  function rebuildLevelSelect(count, labelFn) {
    dom.levelSelect.innerHTML = '';
    for (var i = 0; i < count; i++) {
      var opt = document.createElement('option');
      opt.value = i;
      opt.textContent = labelFn(i);
      dom.levelSelect.appendChild(opt);
    }
  }

  // 内置 1-100 关：占位条目，raw=null 表示需要时 fetch
  function initBuiltinLibrary() {
    library = [];
    for (var i = 1; i <= TOTAL_LEVELS; i++) {
      library.push({ name: 'level_' + i, raw: null, url: LEVEL_DIR + 'level_' + i + '.json' });
    }
    libIndex = -1;
    rebuildLevelSelect(library.length, function (i) { return library[i].name; });
  }

  // 选择库中第 idx 关并加载
  function selectLibIndex(idx) {
    if (idx < 0 || idx >= library.length) return;
    libIndex = idx;
    dom.levelSelect.value = idx;
    updateNavButtons();

    var entry = library[idx];
    if (entry.raw) {
      loadFromRaw(entry.raw, entry.name);
    } else if (entry.url) {
      fetch(entry.url)
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (json) {
          entry.raw = json; // 缓存
          loadFromRaw(json, entry.name);
        })
        .catch(function (err) {
          showError('无法加载 ' + entry.name + '（' + err.message +
            '）。请通过本地服务器打开，或用"导入关卡"批量选择 JSON 文件。');
        });
    }
  }

  function loadFromRaw(json, name) {
    SS.Colors.reset();
    current.raw = json;
    current.level = SS.LevelLoader.parse(json);
    if (name) current.level.name = current.level.name || name;
    current.levelName = name || current.level.name;
    startBoard(0);
    if (current.editing) beginEditCurrent(); // 编辑模式下切关：对新关开编辑
  }

  function updateNavButtons() {
    dom.prevBtn.disabled = (libIndex <= 0);
    dom.nextBtn.disabled = (libIndex >= library.length - 1);
  }

  // 批量导入：选中多个 JSON 文件，构成新的关卡库
  function handleFileUpload(e) {
    var files = Array.prototype.slice.call(e.target.files || []);
    if (!files.length) return;

    var loaded = [];
    var pending = files.length;
    var errors = [];

    files.forEach(function (file, fi) {
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var json = JSON.parse(reader.result);
          var nm = file.name.replace(/\.json$/i, '');
          loaded.push({ name: nm, raw: json, url: null, _idx: fi, _lv: levelKey(nm) });
        } catch (err) {
          errors.push(file.name + ': ' + err.message);
        }
        if (--pending === 0) finishBatch(loaded, errors);
      };
      reader.onerror = function () {
        errors.push(file.name + ': 读取失败');
        if (--pending === 0) finishBatch(loaded, errors);
      };
      reader.readAsText(file);
    });
  }

  // 从文件名提取关卡序号用于排序：优先"第N关"(StackSort命名)，否则取首个数字，都没有则置末。
  // （文件选择/OS 顺序对"第1关/第10关"是字母序乱序，必须按关号还原成 1,2,…,N 顺序）
  function levelKey(name) {
    var m = name.match(/第\s*(\d+)\s*关/);
    if (m) return parseInt(m[1], 10);
    var m2 = name.match(/(\d+)/);
    return m2 ? parseInt(m2[1], 10) : Number.MAX_SAFE_INTEGER;
  }

  function finishBatch(loaded, errors) {
    if (!loaded.length) {
      showError('导入失败：' + (errors.join('; ') || '无有效 JSON'));
      return;
    }
    // 按【关卡序号】排序（第N关 → 首数字），还原 1,2,…,N 顺序；序号相同用文件选择顺序兜底。
    loaded.sort(function (a, b) { return (a._lv - b._lv) || (a._idx - b._idx); });
    library = loaded;
    libIndex = -1;
    rebuildLevelSelect(library.length, function (i) { return library[i].name; });
    selectLibIndex(0);
    if (errors.length) {
      console.warn('部分文件导入失败：\n' + errors.join('\n'));
    }
  }

  function startBoard(boardIdx) {
    current.boardIdx = boardIdx;
    current.board = current.level.boards[boardIdx];
    current.state = SS.Engine.createState(current.board, current.level.stepCount);
    dom.banner.className = 'banner';
    dom.banner.textContent = '';
    resetSolution();
    render();
    renderMeta();
  }

  // ===== 求解器 =====
  function resetSolution() {
    stopPlay();
    solution.moves = [];
    solution.idx = 0;
    solution.baseState = null;
    if (dom.solveStatus) {
      dom.solveStatus.textContent = '—';
      dom.solveSteps.textContent = '—';
      dom.solveAttempts.textContent = '—';
      dom.solvePlayBtn.disabled = true;
      dom.solveStepBtn.disabled = true;
    }
  }

  function runSolve() {
    if (!current.state) return;
    stopPlay();

    var stepLimit = current.level.stepCount;
    // ★求解用【宽步数预算】，与可玩步数上限解耦：避免"最优步>上限"被误报无解，先确认是否合法可解
    var startState = SS.Engine.createState(current.board, 999);
    var valid = SS.Solver.validateLevel(startState);
    if (!valid.valid) {
      dom.solveStatus.textContent = '关卡不合法';
      dom.solveStatus.title = valid.reason;
      dom.solveSteps.textContent = '—';
      dom.solveAttempts.textContent = '—';
      return;
    }

    dom.solveStatus.textContent = '求解中…';
    var mode = dom.solveMode ? dom.solveMode.value : 'omni';
    // 用 setTimeout 让"求解中"先渲染出来
    setTimeout(function () {
      var t0 = performance.now();
      var res;
      if (mode === 'player' && SS.PlayerSolver) {
        var pr = SS.PlayerSolver.solveBest(startState, 16);
        res = { solved: pr.solved, moves: pr.moves, steps: pr.steps, attempts: pr.mode || '-', successRate: pr.successRate };
      } else {
        res = SS.Solver.solve(startState, { maxRestarts: 40 });
      }
      var ms = Math.round(performance.now() - t0);

      if (res.solved) {
        solution.moves = res.moves;
        solution.idx = 0;
        // 回放/显示用【真实步数上限】的状态（顶部"剩余步数"显示真实上限，不被求解的 999 预算覆盖）；
        // 求解步数另在求解器面板显示。两个 UI 分开。
        solution.baseState = SS.Engine.createState(current.board, stepLimit);
        current.state = SS.Engine.cloneState(solution.baseState);
        render();

        var tag = (mode === 'player') ? '玩家版' : '全知版';
        var over = res.steps > stepLimit;   // 最优步超过可用步数 → 合法但步数上限偏紧（非无解）
        dom.solveStatus.textContent = over
          ? ('⚠ 合法可解，但最优 ' + res.steps + ' 步 > 可用 ' + stepLimit + ' 步（步数上限偏紧）')
          : ('已求解 ✓ ' + tag + ' (' + ms + 'ms)');
        dom.solveSteps.textContent = res.steps + ' 步' + (over ? ' / 上限' + stepLimit : '');
        dom.solveAttempts.textContent = (mode === 'player')
          ? ('模式 ' + res.attempts + '，通关率 ' + Math.round((res.successRate || 0) * 100) + '%')
          : ('第 ' + res.attempts + ' 轮');
        dom.solvePlayBtn.disabled = false;
        dom.solveStepBtn.disabled = false;
        dom.banner.className = 'banner';
        dom.banner.textContent = '';
      } else {
        // 宽预算下仍无解 → 才是真·无解/求解器未命中（已排除"步数上限偏紧"）
        dom.solveStatus.textContent = (mode === 'player') ? '玩家版未通关（问号不确定性）' : '未找到解（宽步数下仍无解，疑似无解或未命中）';
        dom.solveSteps.textContent = '—';
        dom.solveAttempts.textContent = (mode === 'player') ? '—' : (res.attempts + ' 轮');
        dom.solvePlayBtn.disabled = true;
        dom.solveStepBtn.disabled = true;
      }
    }, 30);
  }

  // 步进回放：前进 n 步
  function stepSolution(n) {
    for (var k = 0; k < n; k++) {
      if (solution.idx >= solution.moves.length) { stopPlay(); return; }
      var col = solution.moves[solution.idx];
      var res = SS.Engine.move(current.state, col);
      var extra = res.ok ? (res.autoCols || []).concat(res.linkedCols || []) : [];
      if (res.ok) current.state = res.state;
      solution.idx++;
      // 高亮刚点击的列 + 自动扶正/捆绑联动列
      render(col, extra);
      if (SS.Engine.isWin(current.state)) {
        dom.banner.className = 'banner win';
        dom.banner.textContent = '🎉 求解完成！共 ' + solution.idx + ' 步，剩余 ' + current.state.moves;
        stopPlay();
        return;
      }
    }
  }

  function togglePlay() {
    if (solution.playing) { stopPlay(); return; }
    if (solution.idx >= solution.moves.length) {
      // 重新从头播放
      current.state = SS.Engine.cloneState(solution.baseState);
      solution.idx = 0;
      render();
    }
    solution.playing = true;
    dom.solvePlayBtn.textContent = '⏸ 暂停';
    var tick = function () {
      if (!solution.playing) return;
      if (solution.idx >= solution.moves.length) { stopPlay(); return; }
      stepSolution(1);
      var delay = 980 - parseInt(dom.solveSpeed.value, 10);
      solution.timer = setTimeout(tick, delay);
    };
    tick();
  }

  function stopPlay() {
    solution.playing = false;
    if (solution.timer) { clearTimeout(solution.timer); solution.timer = null; }
    if (dom.solvePlayBtn) dom.solvePlayBtn.textContent = '▶ 播放';
  }

  // ===== 渲染棋盘 =====
  function render(highlightCol, autoCols) {
    var st = current.state;
    var autoSet = {};
    if (autoCols && autoCols.length) for (var ai = 0; ai < autoCols.length; ai++) autoSet[autoCols[ai]] = 1;
    dom.board.innerHTML = '';
    dom.board.style.gridTemplateColumns = 'repeat(' + st.colCount + ', auto)';

    for (var c = 0; c < st.colCount; c++) {
      var colEl = document.createElement('div');
      colEl.className = 'column';
      var frozen = SS.Engine.isFrozen(st, c);
      var rockLocked = SS.Engine.isRockLocked(st, c);
      var covered = SS.Engine.isCovered(st, c);       // 保护列：隐藏，需先完成指定色才解锁
      var keyLocked = SS.Engine.keyLockedCol(st, c);  // Key-Lock 锁定列：颜色可见但不可点
      var hidden = frozen || rockLocked || covered;   // 隐藏列（冰块/石墙/保护列）
      if (st.completed[c]) colEl.classList.add('completed');
      else if (frozen) colEl.classList.add('frozen');
      else if (rockLocked) colEl.classList.add('rock');
      else if (covered) colEl.classList.add('covered');
      else if (keyLocked) colEl.classList.add('keylocked');
      else if (SS.Engine.isColumnPlayable(st, c)) colEl.classList.add('playable');
      if (c === highlightCol) colEl.classList.add('justmoved');
      else if (autoSet[c]) colEl.classList.add('autoswap');  // 自动扶正/捆绑联动列：高亮提示同一次点击导致此列重排

      // 列标识：冰块=还需完成列数；石墙=🪨；保护列=需先完成的色；限定颜色列=彩色箭头；Key-Lock=🔒
      var flag = document.createElement('div');
      flag.className = 'col-flag';
      if (frozen) {
        flag.classList.add('ice-flag');
        flag.textContent = '❄ ' + SS.Engine.iceRemaining(st, c);
      } else if (rockLocked) {
        flag.classList.add('rock-flag');
        flag.textContent = '🪨';
      } else if (covered) {
        flag.classList.add('cover-flag');
        var need = SS.Engine.coverRequiredColor(st, c);
        var lbl = document.createElement('div');
        lbl.className = 'cover-need';
        if (need) {
          lbl.style.background = SS.Colors.cssForKey(need);
          lbl.textContent = '需';
          lbl.title = '指定颜色消除：需先完成一列该颜色才解锁';
        } else {
          lbl.classList.add('cover-need-any');
          lbl.textContent = '锁';
          lbl.title = '指定颜色消除：完成任意一列即解锁';
        }
        flag.appendChild(lbl);
      } else if (keyLocked) {
        flag.classList.add('lock-flag');
        flag.textContent = '🔒';
      } else if (st.fixedColor && st.fixedColor[c]) {
        flag.classList.add('fixed-flag');
        var arrow = document.createElement('div');
        arrow.className = 'fixed-arrow';
        arrow.style.borderTopColor = SS.Colors.cssForKey(st.fixedColor[c]);
        arrow.title = '限定颜色列：只能放该色或万能牌';
        flag.appendChild(arrow);
      }
      colEl.appendChild(flag);

      var col = st.columns[c];
      var lockType = frozen ? 'ice' : (rockLocked ? 'rock' : (covered ? 'cover' : null));
      var coverNeedKey = covered ? SS.Engine.coverRequiredColor(st, c) : null;
      for (var r = 0; r < col.length; r++) {
        var cardEl = makeCard(col[r], lockType, c, r, coverNeedKey);
        if (current.editing) {
          attachEditHandlers(cardEl, c, r);
          if (edit.sel && edit.sel.c === c && edit.sel.r === r) cardEl.classList.add('edit-sel');
        }
        colEl.appendChild(cardEl);
      }

      (function (ci) {
        colEl.addEventListener('click', function () { onColumnClick(ci); });
      })(c);

      dom.board.appendChild(colEl);
    }

    // 暂存区
    dom.bench.innerHTML = '';
    if (st.bench) {
      var benchEl = makeCard(st.bench, null, -1, 0);
      if (current.editing) {
        attachEditHandlers(benchEl, -1, 0);
        if (edit.sel && edit.sel.c === -1) benchEl.classList.add('edit-sel');
      }
      dom.bench.appendChild(benchEl);
    }

    dom.moves.textContent = st.moves;

    drawLinks(st);   // 绘制捆绑绳连线
  }

  // 绘制捆绑绳：在两端被绑卡之间画连线
  function drawLinks(st) {
    // 清除旧连线
    var old = dom.board.querySelectorAll('.rope');
    old.forEach(function (e) { e.remove(); });
    if (!st.links) return;

    var boardRect = dom.board.getBoundingClientRect();
    st.links.forEach(function (l) {
      if (!l.active) return;
      var elA = findLinkCard(l.col1, l.id);
      var elB = findLinkCard(l.col2, l.id);
      if (!elA || !elB) return;
      var ra = elA.getBoundingClientRect(), rb = elB.getBoundingClientRect();
      var x1 = ra.left + ra.width / 2 - boardRect.left;
      var y1 = ra.top + ra.height / 2 - boardRect.top;
      var x2 = rb.left + rb.width / 2 - boardRect.left;
      var y2 = rb.top + rb.height / 2 - boardRect.top;
      var len = Math.hypot(x2 - x1, y2 - y1);
      var ang = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
      var rope = document.createElement('div');
      rope.className = 'rope';
      rope.style.left = x1 + 'px';
      rope.style.top = y1 + 'px';
      rope.style.width = len + 'px';
      rope.style.transform = 'rotate(' + ang + 'deg)';
      dom.board.appendChild(rope);
    });

    function findLinkCard(colIdx, id) {
      var col = st.columns[colIdx];
      for (var r = 0; r < col.length; r++) {
        if (col[r] && col[r]._link === id) {
          return dom.board.querySelector('.card[data-c="' + colIdx + '"][data-r="' + r + '"]');
        }
      }
      return null;
    }
  }

  // 当前状态中某炸弹色的剩余倒计时（取该色未拆除炸弹的最小剩余）
  function bombRemainingForColor(colorKey) {
    var st = current.state;
    if (!st || !st.bombs) return null;
    var m = null;
    for (var i = 0; i < st.bombs.length; i++) {
      var b = st.bombs[i];
      if (b.color === colorKey && !b.defused) {
        if (m == null || b.remaining < m) m = b.remaining;
      }
    }
    return m;
  }

  function makeCard(cell, lockType, c, r, coverNeedKey) {
    var el = document.createElement('div');
    el.className = 'card';
    if (c != null) { el.dataset.c = c; el.dataset.r = r; }
    if (!cell || cell.kind === 'empty') { el.style.opacity = '0'; return el; }

    var isSurprise = cell.features && cell.features.indexOf('Surprise') !== -1;

    // 锁定列：整列隐藏，不显示真实颜色（冰块=冰层，石墙=石块）
    if (lockType === 'ice') {
      el.classList.add('frozen-card');
      var ice = document.createElement('div');
      ice.className = 'ice';
      el.appendChild(ice);
      return el;
    }
    if (lockType === 'rock') {
      el.classList.add('rock-card');
      var stone = document.createElement('div');
      stone.className = 'stone';
      el.appendChild(stone);
      return el;
    }
    if (lockType === 'cover') {
      el.classList.add('cover-card');
      var cov = document.createElement('div');
      cov.className = 'cover-lid';
      if (coverNeedKey) {
        // 盖子用需求色的醒目斜纹，让"要先完成哪个颜色"一眼可见
        var cssNeed = SS.Colors.cssForKey(coverNeedKey);
        cov.style.background = 'repeating-linear-gradient(135deg,' + cssNeed + ',' + cssNeed + ' 8px,#0006 8px,#0006 13px)';
      }
      el.appendChild(cov);
      return el;
    }

    if (cell.kind === 'rainbow') {
      el.classList.add('rainbow');
    } else if (cell.kind === 'dual') {
      // 双色块：主体=底层生效色，顶部条=隐藏的顶层色
      el.style.background = SS.Colors.cssForKey(cell.colorKey);
      var topStripe = document.createElement('div');
      topStripe.className = 'dual-top';
      topStripe.style.background = cell.topColorKey ? SS.Colors.cssForKey(cell.topColorKey) : '#888';
      el.appendChild(topStripe);
      el.classList.add('dual-card');
    } else if (cell.colorKey && !isSurprise) {
      el.style.background = SS.Colors.cssForKey(cell.colorKey);
    }

    // 未知卡：未揭示前用 ? 遮罩盖住真实颜色
    if (isSurprise) {
      el.style.background = '#2c3142';
      var s = document.createElement('div');
      s.className = 'surprise';
      s.textContent = '?';
      el.appendChild(s);
    }
    // 捆绑卡：仅描边标记（绳子连线已表达，去掉角标）
    if (cell._link != null) {
      el.classList.add('linked');
    }
    // Key-Lock 卡片标记：🔑 钥匙 / 🔒 锁
    if (cell.features && cell.features.indexOf('Key') !== -1) {
      var keyBadge = document.createElement('div');
      keyBadge.className = 'kl-badge';
      keyBadge.textContent = '🔑';
      el.appendChild(keyBadge);
    }
    if (cell.features && cell.features.indexOf('Lock') !== -1) {
      el.classList.add('lock-card');
      var lockBadge = document.createElement('div');
      lockBadge.className = 'kl-badge';
      lockBadge.textContent = '🔒';
      el.appendChild(lockBadge);
    }
    // 炸弹：💣 + 当前剩余倒计时（按该色追踪，取该色最小剩余）
    if (cell.bomb != null) {
      el.classList.add('bomb-card');
      var bombBadge = document.createElement('div');
      bombBadge.className = 'bomb-badge';
      var rem = bombRemainingForColor(cell.colorKey);
      bombBadge.textContent = '💣' + (rem != null ? rem : '');
      if (rem != null && rem <= 5) bombBadge.classList.add('bomb-danger');
      el.appendChild(bombBadge);
    }
    return el;
  }

  function shakeColumn(c) {
    var el = dom.board.querySelector('.column:nth-child(' + (c + 1) + ')');
    if (!el) return;
    el.classList.remove('shake');
    void el.offsetWidth; // 重置动画
    el.classList.add('shake');
    setTimeout(function () { el.classList.remove('shake'); }, 400);
  }

  function onColumnClick(c) {
    var st = current.state;
    if (current.editing) return;   // 编辑模式下不游玩，卡片点击=选中
    if (SS.Engine.isWin(st) || SS.Engine.isLose(st)) return;
    stopPlay(); // 手动接管时停止自动回放

    var res = SS.Engine.move(st, c);
    if (!res.ok) {
      // 限定颜色列放入不匹配的色 → 晃动反馈
      if (st.fixedColor && st.fixedColor[c] && !SS.Engine.acceptsBench(st, c)) {
        shakeColumn(c);
      }
      return;
    }
    current.state = res.state;
    var extraCols = (res.autoCols || []).concat(res.linkedCols || []);
    render(c, extraCols);

    if (SS.Engine.isWin(current.state)) {
      dom.banner.className = 'banner win';
      dom.banner.textContent = '🎉 通关！剩余步数 ' + current.state.moves;
    } else if (SS.Engine.isLose(current.state)) {
      dom.banner.className = 'banner lose';
      dom.banner.textContent = SS.Engine.bombFailed(current.state)
        ? '💥 炸弹爆炸 — 该颜色订单未在倒计时内完成'
        : 'Out of Moves — 步数用尽';
    }
  }

  // ===== 渲染元信息 / 图例 =====
  function renderMeta() {
    var lvl = current.level, b = current.board;
    dom.levelName.textContent = lvl.name || '(未命名)';
    dom.sizeVal.textContent = b.colCount + ' × ' + b.rowCount;

    var keys = SS.LevelLoader.collectColorKeys(lvl);
    dom.colorVal.textContent = keys.length + ' 种';

    dom.legend.innerHTML = '';
    keys.forEach(function (k) {
      var sw = document.createElement('div');
      sw.className = 'swatch';
      sw.style.background = SS.Colors.cssForKey(k);
      sw.title = k;
      dom.legend.appendChild(sw);
    });
  }

  // ===== 批量分析 =====
  var batchState = { rows: [], header: [], chartData: [] };

  function openBatch() {
    stopPlay();
    dom.batchModal.style.display = 'flex';
    if (!batchState.rows.length) {
      dom.batchProgress.textContent = '点击"开始分析"分析当前关卡库（共 ' + library.length + ' 关）';
    }
  }

  // 异步逐关分析，保持 UI 不卡死
  function runBatch() {
    var runs = Math.max(3, Math.min(40, parseInt(dom.batchRuns.value, 10) || 10));
    dom.batchRunBtn.disabled = true;
    dom.batchCsvBtn.disabled = true;
    dom.batchJpgBtn.disabled = true;

    var header = ['关卡', '尺寸(列x行)', '颜色种类', '障碍组合', '障碍分级', '最优步数', '平均步数', '成功率', '步数上限', '容错', '容错率', '难度分', '难度等级', '难度构成(障/压/为/行/色)', '玩家通关率', '玩家版难度'];
    var rows = [];
    var chartData = [];
    var idx = 0;

    function ensureRaw(entry, cb) {
      if (entry.raw) return cb(entry.raw);
      if (entry.url) {
        fetch(entry.url).then(function (r) { return r.json(); })
          .then(function (j) { entry.raw = j; cb(j); })
          .catch(function () { cb(null); });
      } else cb(null);
    }

    function step() {
      if (idx >= library.length) return finishBatch();
      var entry = library[idx];
      dom.batchProgress.textContent = '分析中… ' + (idx + 1) + '/' + library.length + '（' + entry.name + '）';
      ensureRaw(entry, function (raw) {
        if (raw) {
          try {
            SS.Colors.reset();
            var lvl = SS.LevelLoader.parse(raw);
            if (lvl.boards.length === 1) {
              // ★求解用【宽步数预算】，与"可玩步数上限"解耦——求解器找最优不该被关卡步数上限卡死
              //   （全知版在双色块/锁定列等关上路由不如玩家贪心高效，按上限预算会误报不可解）。
              var st = SS.Engine.createState(lvl.boards[0], 999);
              if (SS.Solver.validateLevel(st).valid) {
                var obs = SS.Analysis.obstaclesFromState(st);
                var r = SS.Analysis.multiSolve(st, runs, 20);
                var limit = lvl.stepCount;
                // 玩家版：含问号 或 任意障碍 → 跑玩家版(宽预算)取最优模式一次过率
                var hasSurp = SS.PlayerSolver && SS.PlayerSolver.hasSurprise(st);
                var playerSucc = 1, psForBonus = null, pm = null;
                if (SS.PlayerSolver && (obs.length > 0 || hasSurp)) {
                  var stP = SS.Engine.createState(lvl.boards[0], 999);
                  pm = SS.PlayerSolver.multiSolve(stP, runs, 20);
                  if (pm.bestModeSucc != null) playerSucc = pm.bestModeSucc;
                  if (obs.length > 1) psForBonus = pm.bestModeSucc;
                }
                // 真最优步 = 全知/玩家更小者（玩家贪心常更高效）
                var optBest = r.best;
                if (pm && pm.best != null && (optBest == null || pm.best < optBest)) optBest = pm.best;
                var margin = (optBest != null) ? (limit - optBest) : null;
                var ratio = (optBest != null && optBest > 0) ? (margin / optBest) : null;
                var d = SS.Analysis.difficulty(st, obs, optBest, limit, r, psForBonus, pm);
                // 玩家版难度：混合关官方分已含玩家成分；其余关(尤其纯问号)按一次过率追加不确定性惩罚，
                //   让"看不见的问号"在折线上体现为更高难度。pure 无障碍满信息关 playerSucc≈1 → 与标准分一致。
                var playerScore;
                if (obs.length > 1) playerScore = d.score;
                else playerScore = Math.max(0, Math.min(100, d.score + Math.round((1 - playerSucc) * 25)));
                var playerLevel = (SS.Analysis.gradeOf ? SS.Analysis.gradeOf(playerScore) : d.level);
                rows.push([
                  entry.name, st.colCount + 'x' + st.rowCount, d.colorKinds,
                  SS.Analysis.obstacleNamesCN(obs), SS.Analysis.obsLevelTag(obs),
                  optBest != null ? optBest : '未解',
                  r.avg != null ? r.avg.toFixed(1) : '-',
                  (r.successRate * 100).toFixed(0) + '%',
                  limit, margin != null ? margin : '-',
                  ratio != null ? (ratio * 100).toFixed(0) + '%' : '-',
                  d.score, d.level,
                  d.parts.obs + '/' + d.parts.pressure + '/' + (d.parts.behavior != null ? d.parts.behavior : '-') + '/' + d.parts.row + '/' + d.parts.color,
                  Math.round(playerSucc * 100) + '%', playerScore
                ]);
                chartData.push({ name: entry.name, score: d.score, level: d.level, playerScore: playerScore, playerLevel: playerLevel, playerSucc: playerSucc });
              }
            }
          } catch (e) { /* 跳过异常关卡 */ }
        }
        idx++;
        setTimeout(step, 0); // 让出主线程，刷新进度
      });
    }

    function finishBatch() {
      batchState = { rows: rows, header: header, chartData: chartData };
      dom.batchProgress.textContent = '完成：分析 ' + rows.length + ' 关';
      dom.batchRunBtn.disabled = false;
      dom.batchCsvBtn.disabled = rows.length === 0;
      dom.batchJpgBtn.disabled = rows.length === 0;
      renderBatchNotes();
      renderBatchTable();
      drawBatchChart();
    }

    rows.length = 0; chartData.length = 0; idx = 0;
    setTimeout(step, 0);
  }

  function renderBatchNotes() {
    var notes = SS.Analysis.FIELD_NOTES;
    var html = '<h3 style="margin-bottom:6px;">字段说明</h3><div class="notes-grid">';
    Object.keys(notes).forEach(function (k) {
      html += '<div class="note-item"><b>' + k + '</b>：' + notes[k] + '</div>';
    });
    html += '</div>';
    // 难度分布
    var dist = {};
    batchState.chartData.forEach(function (d) { dist[d.level] = (dist[d.level] || 0) + 1; });
    html += '<div class="note-dist">难度分布：' +
      ['简单', '普通', '困难', '极难'].map(function (g) { return g + ' ' + (dist[g] || 0); }).join(' · ') + '</div>';
    dom.batchNotes.innerHTML = html;
  }

  function renderBatchTable() {
    var h = batchState.header, rows = batchState.rows;
    var notes = SS.Analysis.FIELD_NOTES;
    var html = '<table class="batch-table"><thead><tr>';
    h.forEach(function (col) {
      var key = col.replace(/\(.*\)/, '');
      var tip = notes[key] || notes[col] || '';
      html += '<th' + (tip ? ' title="' + tip.replace(/"/g, '') + '"' : '') + '>' + col + (tip ? ' ⓘ' : '') + '</th>';
    });
    html += '</tr></thead><tbody>';
    rows.forEach(function (r) {
      var grade = r[12];
      html += '<tr class="grade-' + grade + '">' + r.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>';
    });
    html += '</tbody></table>';
    dom.batchTableWrap.innerHTML = html;
  }

  // 难度折线图（关号 x，难度分 y），导出 JPG 用同一 canvas
  function drawBatchChart() {
    var cv = dom.batchChart, ctx = cv.getContext('2d');
    var W = cv.width, H = cv.height, padL = 44, padR = 16, padT = 24, padB = 56;
    // 视图模式：micro=逐关(100点)；g10/g20=宏观聚合(10/20组,每组平均难度)
    var mode = (dom.batchView && dom.batchView.value) || 'micro';
    var src = batchState.chartData;
    var data, title;
    if (mode === 'g10' || mode === 'g20') {
      var groups = mode === 'g10' ? 10 : 20;
      data = aggregateCurve(src, groups);
      title = '关卡难度折线图 · 宏观 ' + groups + ' 组（每组平均难度，颜色=等级）';
    } else {
      data = src;
      title = '关卡难度折线图 · 微观逐关（' + src.length + ' 关，颜色=等级）';
    }
    ctx.fillStyle = '#1b1f2a'; ctx.fillRect(0, 0, W, H);
    if (!data.length) return;
    var plotW = W - padL - padR, plotH = H - padT - padB;

    // 网格 + Y 轴刻度（0-100）
    ctx.strokeStyle = '#3a4258'; ctx.fillStyle = '#9aa3b5'; ctx.font = '11px sans-serif';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (var g = 0; g <= 100; g += 20) {
      var y = padT + plotH * (1 - g / 100);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
      ctx.fillText(String(g), padL - 6, y);
    }
    // 等级分隔参考线（30/60/80）
    var bands = [{ v: 30, c: '#3ddc84' }, { v: 60, c: '#ffcc4d' }, { v: 80, c: '#ff7a4d' }];
    bands.forEach(function (b) {
      var y = padT + plotH * (1 - b.v / 100);
      ctx.strokeStyle = b.c + '55'; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
      ctx.setLineDash([]);
    });

    var n = data.length;
    function px(i) { return padL + (n === 1 ? plotW / 2 : plotW * i / (n - 1)); }
    function py(s) { return padT + plotH * (1 - s / 100); }

    // 玩家版折线（橙色虚线，体现问号等隐藏障碍的真实难度）——先画，作为标准线的底衬
    var hasPlayer = data.some(function (d) { return d.playerScore != null; });
    if (hasPlayer) {
      ctx.strokeStyle = '#ffae4d'; ctx.lineWidth = 2; ctx.setLineDash([5, 3]); ctx.beginPath();
      data.forEach(function (d, i) { var x = px(i), y = py(d.playerScore != null ? d.playerScore : d.score); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
      ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#ffae4d';
      data.forEach(function (d, i) { ctx.beginPath(); ctx.arc(px(i), py(d.playerScore != null ? d.playerScore : d.score), (mode === 'micro' ? 2.2 : 3.6), 0, Math.PI * 2); ctx.fill(); });
    }

    // 标准难度折线（蓝色）
    ctx.strokeStyle = '#4cc2ff'; ctx.lineWidth = 2; ctx.beginPath();
    data.forEach(function (d, i) { var x = px(i), y = py(d.score); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
    ctx.stroke();

    // 数据点（按等级着色）；宏观点更大
    var gradeColor = { '简单': '#3ddc84', '普通': '#ffcc4d', '困难': '#ff9f4d', '极难': '#ff5a4d' };
    var ptR = (mode === 'micro') ? 2.6 : 4.5;
    data.forEach(function (d, i) {
      ctx.fillStyle = gradeColor[d.level] || '#4cc2ff';
      ctx.beginPath(); ctx.arc(px(i), py(d.score), ptR, 0, Math.PI * 2); ctx.fill();
    });
    // 宏观：在点上标平均分
    if (mode !== 'micro') {
      ctx.fillStyle = '#e8ebf2'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      data.forEach(function (d, i) { ctx.fillText(Math.round(d.score), px(i), py(d.score) - 6); });
    }

    // X 轴标签（稀疏）
    ctx.fillStyle = '#9aa3b5'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    var stepLbl = Math.max(1, Math.ceil(n / 20));
    data.forEach(function (d, i) {
      if (i % stepLbl === 0 || i === n - 1) {
        ctx.save(); ctx.translate(px(i), H - padB + 6); ctx.rotate(-Math.PI / 4);
        ctx.textAlign = 'right'; ctx.fillText(d.name, 0, 0); ctx.restore();
      }
    });
    // 标题
    ctx.fillStyle = '#e8ebf2'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(title, padL, 4);

    // 图例（右上角）：标准难度(蓝) / 玩家版难度(橙虚线)
    var lx = W - padR - 168, ly = 8;
    ctx.textBaseline = 'middle'; ctx.font = '11px sans-serif';
    ctx.strokeStyle = '#4cc2ff'; ctx.lineWidth = 2; ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(lx, ly + 6); ctx.lineTo(lx + 22, ly + 6); ctx.stroke();
    ctx.fillStyle = '#cdd4e2'; ctx.textAlign = 'left'; ctx.fillText('标准难度', lx + 26, ly + 6);
    ctx.strokeStyle = '#ffae4d'; ctx.setLineDash([5, 3]);
    ctx.beginPath(); ctx.moveTo(lx + 88, ly + 6); ctx.lineTo(lx + 110, ly + 6); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#cdd4e2'; ctx.fillText('玩家版', lx + 114, ly + 6);
  }

  // 把逐关难度聚合成 N 组（连续等分），每组取平均难度；名称为关号区间
  function aggregateCurve(src, groups) {
    if (!src.length) return [];
    var n = src.length, out = [];
    var size = n / groups;
    for (var gi = 0; gi < groups; gi++) {
      var s = Math.floor(gi * size), e = Math.floor((gi + 1) * size);
      if (gi === groups - 1) e = n;
      if (e <= s) continue;
      var sum = 0, psum = 0; for (var j = s; j < e; j++) { sum += src[j].score; psum += (src[j].playerScore != null ? src[j].playerScore : src[j].score); }
      var avg = sum / (e - s), pavg = psum / (e - s);
      var lvl = (SS.Analysis && SS.Analysis.gradeOf) ? SS.Analysis.gradeOf(avg) : '';
      out.push({ name: src[s].name + '–' + src[e - 1].name, score: avg, level: lvl, playerScore: pavg });
    }
    return out;
  }

  function exportBatchCsv() {
    var notes = SS.Analysis.FIELD_NOTES;
    var lines = ['【字段说明】'];
    Object.keys(notes).forEach(function (k) { lines.push(k + ',' + notes[k].replace(/,/g, '，')); });
    lines.push(''); lines.push('【批量分析结果】');
    var all = [batchState.header].concat(batchState.rows);
    var body = all.map(function (r) { return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(','); });
    var csv = '\uFEFF' + lines.join('\n') + '\n' + body.join('\n');
    downloadBlob(new Blob([csv], { type: 'text/csv' }), '关卡分析结果.csv');
  }

  function exportBatchJpg() {
    dom.batchChart.toBlob(function (blob) {
      downloadBlob(blob, '关卡难度折线图.jpg');
    }, 'image/jpeg', 0.92);
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  // ===== 关卡编辑器 =====
  var edit = { editedLevels: {}, sel: null, fromColor: null, drag: null, lastStats: null };

  function toggleEdit() {
    if (current.editing) { exitEdit(true); return; }
    if (!current.raw) { showError('请先加载关卡'); return; }
    stopPlay();
    current.editing = true;
    dom.editBtn.textContent = '✏️ 编辑中';
    dom.editBtn.classList.add('editing');
    dom.editPanel.style.display = 'block';
    beginEditCurrent();
  }

  function exitEdit(discardCheck) {
    if (discardCheck) {
      var n = Object.keys(edit.editedLevels).length;
      if (n > 0 && !confirm('退出编辑会丢弃 ' + n + ' 个未导出的临时关卡副本（不影响源文件）。确定退出？')) return;
    }
    current.editing = false;
    edit.editedLevels = {}; edit.sel = null; edit.fromColor = null; edit.lastStats = null;
    SS.Editor.discard();
    dom.editBtn.textContent = '✏️ 编辑';
    dom.editBtn.classList.remove('editing');
    dom.editPanel.style.display = 'none';
    dom.editStatsFloat.style.display = 'none';
    // 还原为正常显示当前关
    if (current.raw) loadFromRaw(current.raw, current.levelName);
  }

  // 对当前库关卡开始/恢复编辑副本
  function beginEditCurrent() {
    var key = libIndex;
    var base = edit.editedLevels[key] || current.raw;
    SS.Editor.begin(base, 0, (library[key] && library[key].name) || current.levelName || 'level');
    edit.editedLevels[key] = SS.Editor.getRaw();
    edit.sel = null; edit.fromColor = null; edit.lastStats = null;
    if (dom.editWarn) dom.editWarn.style.display = 'none';
    renderFromEditRaw();
    refreshEditPanel();
  }

  // 用编辑副本刷新棋盘显示（只读展示，不可游玩）
  // 注意：不调用 SS.Colors.reset()，保持调色板槽位稳定——替换某色只改该色卡片，
  // 其它颜色不会因重新解析而整盘错位（之前"没反应/串色"的根因）。
  function renderFromEditRaw() {
    current.level = SS.LevelLoader.parse(SS.Editor.getRaw());
    current.board = current.level.boards[0];
    current.state = SS.Engine.createState(current.board, current.level.stepCount);
    dom.banner.className = 'banner'; dom.banner.textContent = '';
    render();
    renderMeta();
  }

  function afterEditOp() {
    edit.editedLevels[libIndex] = SS.Editor.getRaw();
    if (dom.editWarn) dom.editWarn.style.display = 'none';   // 改动后清掉旧警告
    renderFromEditRaw();
    refreshEditPanel();
  }

  // 加障碍后做快速可解性检测，无解则警告该步可撤回
  function checkSolvableWarn(label) {
    if (!current.editing) return;
    dom.editWarn.style.display = 'block';
    dom.editWarn.style.color = '#9aa3b5';
    dom.editWarn.textContent = '检测「' + label + '」是否仍可解…';
    setTimeout(function () {
      try {
        var st = SS.Engine.createState(current.board, current.level.stepCount);
        var valid = SS.Solver.validateLevel(st);
        if (!valid.valid) {
          dom.editWarn.style.color = '#ffb3b3';
          dom.editWarn.textContent = '⚠ 「' + label + '」后关卡不合法：' + valid.reason + '（可点撤回）';
          return;
        }
        var r = SS.Analysis.multiSolve(st, 6);
        if (r.best == null) {
          dom.editWarn.style.color = '#ff7a7a';
          dom.editWarn.textContent = '⚠ 添加「' + label + '」导致该关无解！建议点 ↶ 撤回。';
        } else {
          dom.editWarn.style.color = '#3ddc84';
          dom.editWarn.textContent = '✓ 「' + label + '」后仍可解（最优约 ' + r.best + ' 步）';
          setTimeout(function () { if (dom.editWarn.textContent.indexOf('仍可解') !== -1) dom.editWarn.style.display = 'none'; }, 2500);
        }
      } catch (e) { dom.editWarn.style.display = 'none'; }
    }, 30);
  }

  function editUndo() {
    if (SS.Editor.undo()) afterEditOp();
  }

  // 行列结构编辑
  function editStructOp(op, label) {
    if (!current.editing) return;
    SS.Editor.snapshot();
    SS.Editor[op]();
    edit.sel = null;   // 行列变化后旧选中可能失效
    afterEditOp();
    checkSolvableWarn(label);
  }

  // 浮窗拖动（抓标题栏）
  function makeFloatDraggable() {
    var head = dom.editStatsFloat.querySelector('.stats-float-head');
    if (!head) return;
    head.style.cursor = 'move';
    head.addEventListener('pointerdown', function (e) {
      if (e.target === dom.statsFloatClose) return;
      e.preventDefault();
      var rect = dom.editStatsFloat.getBoundingClientRect();
      var offX = e.clientX - rect.left, offY = e.clientY - rect.top;
      function move(ev) {
        dom.editStatsFloat.style.left = (ev.clientX - offX) + 'px';
        dom.editStatsFloat.style.top = (ev.clientY - offY) + 'px';
        dom.editStatsFloat.style.right = 'auto';
      }
      function up() {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
      }
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
    });
  }

  // 求解当前编辑副本 + 难度评估 → 浮窗输出
  function runEditStats() {
    if (!current.editing) return;
    var body = dom.statsFloatBody;
    dom.editStatsFloat.style.display = 'block';
    body.innerHTML = '求解中…（多模式多轮）';
    setTimeout(function () {
      try {
        var st = SS.Engine.createState(current.board, 999);  // 宽预算求解(与可玩步数上限解耦)
        var valid = SS.Solver.validateLevel(st);
        var obs = SS.Analysis.obstaclesFromState(st);
        var r = SS.Analysis.multiSolve(st, 12, 20);
        var limit = current.level.stepCount;
        var ps = null, pmEdit = null;
        if ((obs.length > 1 || (SS.PlayerSolver && SS.PlayerSolver.hasSurprise(st))) && SS.PlayerSolver) {
          var stP = SS.Engine.createState(current.board, 999);
          pmEdit = SS.PlayerSolver.multiSolve(stP, 12, 20);
          if (obs.length > 1) ps = pmEdit.bestModeSucc;
        }
        var optBest = r.best;
        if (pmEdit && pmEdit.best != null && (optBest == null || pmEdit.best < optBest)) optBest = pmEdit.best;
        var margin = (optBest != null) ? (limit - optBest) : null;
        var ratio = (optBest != null && optBest > 0) ? (margin / optBest) : null;
        var d = SS.Analysis.difficulty(st, obs, optBest, limit, r, ps, pmEdit);
        var gradeColor = { '简单': '#3ddc84', '普通': '#ffcc4d', '困难': '#ff9f4d', '极难': '#ff5a4d' };
        var prev = edit.lastStats;
        function delta(cur, old, invert) {
          if (old == null || cur == null || cur === old) return '';
          var diff = cur - old;
          var up = diff > 0;
          var good = invert ? !up : up; // 难度上升用红、下降用绿（invert 用于"步数"等中性，仅显示箭头）
          var color = invert ? '#9aa3b5' : (up ? '#ff7a7a' : '#3ddc84');
          return ' <span style="color:' + color + ';font-size:11px;">(' + (up ? '+' : '') + diff.toFixed(diff % 1 ? 1 : 0) + ')</span>';
        }
        function row(k, v) { return '<div class="sf-row"><span>' + k + '</span><b>' + v + '</b></div>'; }
        var html = '';
        if (!valid.valid) html += '<div class="sf-warn">⚠ 关卡不合法：' + valid.reason + '</div>';
        if (optBest == null) html += '<div class="sf-warn">⚠ 当前未能求解出通关路径（可能无解）</div>';
        html += row('尺寸', st.colCount + '×' + st.rowCount + '（列×行）');
        html += row('颜色种类', d.colorKinds);
        html += row('障碍', SS.Analysis.obstacleNamesCN(obs) + '（' + SS.Analysis.obsLevelTag(obs) + '）');
        html += '<hr>';
        html += row('最优步数', (optBest != null ? optBest : '未解') + (prev ? delta(optBest, prev.best, true) : ''));
        html += row('平均步数', (r.avg != null ? r.avg.toFixed(1) : '-') + (prev ? delta(r.avg, prev.avg, true) : ''));
        html += row('成功率', (r.successRate * 100).toFixed(0) + '%');
        html += row('步数上限', limit);
        html += row('容错', margin != null ? margin : '-');
        html += row('容错率', ratio != null ? (ratio * 100).toFixed(0) + '%' : '-');
        html += '<hr>';
        html += '<div class="sf-row"><span>难度分</span><b style="color:' + (gradeColor[d.level] || '#fff') + '">' + d.score + (prev ? delta(d.score, prev.score) : '') + ' · ' + d.level + '</b></div>';
        html += row('构成(障/压/为/行/色)', d.parts.obs + '/' + d.parts.pressure + '/' + (d.parts.behavior != null ? d.parts.behavior : '-') + '/' + d.parts.row + '/' + d.parts.color);
        if (prev) html += '<div class="sf-prev">上次：难度' + prev.score + ' · 最优' + (prev.best != null ? prev.best : '-') + ' 步</div>';
        body.innerHTML = html;
        edit.lastStats = { score: d.score, best: optBest, avg: r.avg };
      } catch (e) {
        body.innerHTML = '出错：' + e.message;
      }
    }, 30);
  }

  // 选中卡片（并自动把它的颜色设为"源色"，方便直接点目标色替换）
  function selectCell(c, r) {
    edit.sel = { c: c, r: r };
    var cell = (c === -1) ? current.state.bench : (current.state.columns[c] && current.state.columns[c][r]);
    if (cell && (cell.kind === 'color' || cell.kind === 'dual') && cell.colorKey) {
      edit.fromColor = cell.colorKey;   // 选中即设为源色
    }
    render();
    refreshEditPanel();
  }

  // 交换两卡（编辑）
  function editSwap(a, b) {
    SS.Editor.snapshot();
    SS.Editor.swap(a, b);
    edit.sel = { c: b.c, r: b.r };
    afterEditOp();
  }

  function refreshEditPanel() {
    if (!current.editing) return;
    dom.undoBtn.disabled = !SS.Editor.canUndo();
    dom.editDirty.textContent = '（临时副本 · ' + Object.keys(edit.editedLevels).length + ' 关待导出）';
    if (dom.stepLimitInput) dom.stepLimitInput.value = SS.Editor.getStepLimit();

    // 源色（当前盘面颜色）
    var keys = SS.LevelLoader.collectColorKeys(current.level);
    dom.srcColors.innerHTML = '';
    keys.forEach(function (k) {
      var sw = document.createElement('div');
      sw.className = 'swatch sel-swatch' + (edit.fromColor === k ? ' active' : '');
      sw.style.background = SS.Colors.cssForKey(k);
      sw.title = '源色 ' + k;
      sw.addEventListener('click', function () { edit.fromColor = k; refreshEditPanel(); });
      dom.srcColors.appendChild(sw);
    });
    // 目标色（真实色库 10 色：来自项目色值表，仅含有美术资源的颜色）
    dom.dstColors.innerHTML = '';
    SS.Colors.LIBRARY.forEach(function (lc) {
      var sw = document.createElement('div');
      sw.className = 'swatch';
      sw.style.background = lc.hex;
      sw.title = '替换为 ' + lc.name + '（colorId ' + lc.colorId + ' shade ' + lc.shadeIndex + '）';
      sw.addEventListener('click', function () {
        if (!edit.fromColor) { showError('请先点棋盘上的卡片或"源色"选要替换的颜色'); return; }
        SS.Editor.snapshot();
        if (dom.replaceOneCol && dom.replaceOneCol.checked && edit.sel && edit.sel.c >= 0) {
          SS.Editor.replaceColorInColumn(edit.sel.c, edit.fromColor, lc.colorId, lc.shadeIndex);  // 只替换选中列
        } else {
          SS.Editor.replaceColor(edit.fromColor, lc.colorId, lc.shadeIndex);                       // 全盘替换
        }
        edit.fromColor = lc.colorId + '_' + lc.shadeIndex;
        afterEditOp();
      });
      dom.dstColors.appendChild(sw);
    });

    // 障碍工具
    renderObsTools();
  }

  function renderObsTools() {
    var sel = edit.sel;
    dom.cellObsTools.innerHTML = '';
    dom.colObsTools.innerHTML = '';
    if (!sel) { dom.selInfo.textContent = '未选中卡片（点击棋盘上的卡片）'; return; }
    var where = sel.c === -1 ? '暂存区' : ('第' + (sel.c + 1) + '列 第' + (sel.r + 1) + '行');
    var cellFeats = SS.Editor.cellFeatures(sel.c, sel.r);
    dom.selInfo.textContent = '选中：' + where + (cellFeats.length ? '（' + cellFeats.map(cnObs).join('、') + '）' : '');

    // 卡片级特性
    [['Surprise', '问号'], ['Key', '钥匙'], ['Lock', '锁'], ['Bomb', '炸弹']].forEach(function (p) {
      var on = cellFeats.indexOf(p[0]) !== -1;
      var b = mkToolBtn((on ? '− ' : '+ ') + p[1], on);
      b.addEventListener('click', function () {
        SS.Editor.snapshot();
        if (on) { SS.Editor.removeCellFeature(sel.c, sel.r, p[0]); afterEditOp(); return; }
        SS.Editor.addCellFeature(sel.c, sel.r, p[0], p[0] === 'Bomb' ? { stepCount: askInt('炸弹倒计时步数', 20) } : null);
        afterEditOp();
        checkSolvableWarn('添加' + p[1]);
      });
      dom.cellObsTools.appendChild(b);
    });

    if (sel.c === -1) return; // 暂存区无列障碍
    // 列级障碍
    var colObs = SS.Editor.columnObstacles(sel.c);
    [['Ice', '冰块'], ['Rock', '石墙'], ['FixedColor', '限定色'], ['CoveredColor', '指定颜色消除']].forEach(function (p) {
      var on = colObs.indexOf(p[0]) !== -1;
      var b = mkToolBtn((on ? '− ' : '+ ') + p[1] + '列', on);
      b.addEventListener('click', function () {
        if (on) { SS.Editor.snapshot(); SS.Editor.removeColumnFeature(sel.c, p[0]); afterEditOp(); return; }
        if (p[0] === 'FixedColor' || p[0] === 'CoveredColor') {
          // 弹出颜色选择器：点哪个色就用哪个作为限定/保护色
          startColorPick('选择「' + p[1] + '」的颜色：', function (cid, sh) {
            SS.Editor.snapshot();
            SS.Editor.addColumnFeature(sel.c, p[0], { colorId: cid, shadeIndex: sh });
            afterEditOp();
            checkSolvableWarn('添加' + p[1] + '列');
          });
          return;
        }
        SS.Editor.snapshot();
        var opts = {};
        if (p[0] === 'Ice') opts.durability = askInt('冰块需完成列数', 2);
        SS.Editor.addColumnFeature(sel.c, p[0], opts);
        afterEditOp();
        checkSolvableWarn('添加' + p[1] + '列');
      });
      dom.colObsTools.appendChild(b);
    });
  }

  // 列障碍颜色选择器：独立弹出浮层（与"替换颜色"面板分开，避免误触替换）
  function startColorPick(label, onPick) {
    closeColorPopup();
    var mask = document.createElement('div');
    mask.className = 'color-popup-mask';
    mask.id = 'colorPopup';
    var box = document.createElement('div');
    box.className = 'color-popup';
    var title = document.createElement('div');
    title.className = 'color-popup-title';
    title.textContent = label;
    box.appendChild(title);
    var grid = document.createElement('div');
    grid.className = 'legend';
    var keys = SS.LevelLoader.collectColorKeys(current.level);
    keys.forEach(function (k) {
      var sw = document.createElement('div');
      sw.className = 'swatch sel-swatch';
      sw.style.background = SS.Colors.cssForKey(k);
      sw.title = k;
      sw.addEventListener('click', function () {
        var parts = k.split('_');
        closeColorPopup();
        onPick(parseInt(parts[0], 10), parseInt(parts[1], 10) || 0);
      });
      grid.appendChild(sw);
    });
    box.appendChild(grid);
    var cancel = mkToolBtn('取消');
    cancel.style.marginTop = '10px';
    cancel.addEventListener('click', closeColorPopup);
    box.appendChild(cancel);
    mask.appendChild(box);
    mask.addEventListener('click', function (e) { if (e.target === mask) closeColorPopup(); });
    document.body.appendChild(mask);
  }
  function closeColorPopup() {
    var ex = document.getElementById('colorPopup');
    if (ex) ex.remove();
  }

  function cnObs(t) { return (SS.Analysis && SS.Analysis.OBS_CN[t]) || t; }
  function mkToolBtn(label, on) {
    var b = document.createElement('button');
    b.textContent = label; b.className = 'tool-btn' + (on ? ' on' : '');
    return b;
  }
  function askInt(msg, def) {
    var v = parseInt(window.prompt(msg, def), 10);
    return (isNaN(v) || v < 1) ? def : v;
  }

  // 导出
  function exportCurrentLevel() {
    if (!current.editing) return;
    edit.editedLevels[libIndex] = SS.Editor.getRaw();
    var name = ((library[libIndex] && library[libIndex].name) || 'level') + '_edited.json';
    downloadBlob(new Blob([JSON.stringify(SS.Editor.getRaw(), null, 2)], { type: 'application/json' }), name);
  }
  function exportAllEdited() {
    var keys = Object.keys(edit.editedLevels);
    if (!keys.length) { showError('没有可导出的编辑副本'); return; }
    keys.forEach(function (k, i) {
      var raw = edit.editedLevels[k];
      var name = ((library[k] && library[k].name) || ('level_' + k)) + '_edited.json';
      // 稍微错开，避免浏览器合并多文件下载
      setTimeout(function () {
        downloadBlob(new Blob([JSON.stringify(raw, null, 2)], { type: 'application/json' }), name);
      }, i * 250);
    });
  }

  // ===== 编辑模式：棋盘卡片选中 + 长按拖动交换 =====
  function attachEditHandlers(cardEl, c, r) {
    cardEl.style.cursor = 'grab';
    cardEl.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      var startC = c, startR = r, started = Date.now(), dragging = false;
      var timer = setTimeout(function () { dragging = true; cardEl.classList.add('dragging'); }, 200);

      function move(ev) {
        if (!dragging) return;
      }
      function up(ev) {
        clearTimeout(timer);
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        cardEl.classList.remove('dragging');
        if (dragging) {
          var el = document.elementFromPoint(ev.clientX, ev.clientY);
          var card = el && el.closest ? el.closest('.card') : null;
          if (card && card.dataset.c != null) {
            var tc = parseInt(card.dataset.c, 10), tr = parseInt(card.dataset.r, 10);
            if (!(tc === startC && tr === startR)) { editSwap({ c: startC, r: startR }, { c: tc, r: tr }); return; }
          }
        }
        // 未拖动 = 选中
        selectCell(startC, startR);
      }
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
    });
  }

  // ===== 关卡生成器 =====
  var gen = {
    results: [], groups: [], overrides: {}, expanded: -1, _curveMap: null,
    schemes: [], fileHandle: null, fileName: '',
    OBS: [['Surprise', '问号'], ['Ice', '冰块'], ['Rock', '石墙'], ['FixedColor', '限定色'], ['CoveredColor', '指定颜色消除'], ['KeyLock', '锁定列'], ['Linked', '捆绑'], ['Dual', '双色块'], ['Bomb', '炸弹']]
  };

  function batchDateStr() {
    var d = new Date();
    return ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2);
  }
  function defaultGroup(from, span, base) {
    base = base || {}; var s = span || 5;
    var dmin = base.dmin != null ? base.dmin : 0, dmax = base.dmax != null ? base.dmax : 100;
    var gm = gradeMargin((dmin + dmax) / 2);   // 余量按目标难度等级容错初始对齐
    return {
      from: from, to: from + s - 1,
      H: base.H || 6, K: base.K || 6, colorCount: base.colorCount || (base.K || 6),
      chaos: base.chaos || 'high', margin: base.margin != null ? base.margin : 30,
      dmin: dmin, dmax: dmax, marginMin: gm[0], marginMax: gm[1],
      combo: {}, iceDurMin: 1, iceDurMax: 4,
      bombCountMin: 1, bombCountMax: 2, bombHidden: false, bombTiming: 'global'
    };
  }
  // 把所有分组/逐关的步数余量(容错)对齐到各自【目标难度等级】容错——仅在【调取/导入对齐】时调用一次。
  function autoAlignMargins() {
    gen.groups.forEach(function (g) {
      var gm = gradeMargin(((g.dmin != null ? g.dmin : 0) + (g.dmax != null ? g.dmax : 100)) / 2);
      g.marginMin = gm[0]; g.marginMax = gm[1];
    });
    Object.keys(gen.overrides).forEach(function (no) {
      var o = gen.overrides[no];
      if (o && (o.dmin != null || o.dmax != null)) {
        var gm = gradeMargin(((o.dmin != null ? o.dmin : 0) + (o.dmax != null ? o.dmax : 100)) / 2);
        o.marginMin = gm[0]; o.marginMax = gm[1];
      }
    });
  }
  // 手动刷新：按当前各组/逐关难度区间，重新对齐步数余量(容错)到对应难度等级。调完难度区间点一次。
  function refreshMargins() {
    if (!gen.groups.length) { dom.genProgress.textContent = '请先添加分组'; return; }
    autoAlignMargins();
    renderGenGroups(); drawGenCurve();
    dom.genProgress.textContent = '✓ 步数余量已按当前难度区间重新对齐到对应等级容错（向下严格命中、向上+4可命中）';
  }
  // 分组级刷新：只对齐该组及组内逐关的步数余量
  function refreshMarginsForGroup(g) {
    var gm = gradeMargin(((g.dmin != null ? g.dmin : 0) + (g.dmax != null ? g.dmax : 100)) / 2);
    g.marginMin = gm[0]; g.marginMax = gm[1];
    for (var no = g.from; no <= g.to; no++) {
      var o = gen.overrides[no];
      if (o && (o.dmin != null || o.dmax != null)) {
        var gmo = gradeMargin(((o.dmin != null ? o.dmin : 0) + (o.dmax != null ? o.dmax : 100)) / 2);
        o.marginMin = gmo[0]; o.marginMax = gmo[1];
      }
    }
    renderGenGroups(); drawGenCurve();
    dom.genProgress.textContent = '✓ 第 ' + g.from + '-' + g.to + ' 组步数余量已按其难度区间对齐到对应等级容错';
  }
  function openGen() {
    stopPlay();
    dom.genModal.style.display = 'flex';
    if (!dom.genBatch.value) dom.genBatch.value = batchDateStr();
    if (!gen.groups.length) gen.groups.push(defaultGroup(1, 10, { H: 5, K: 5, colorCount: 5, dmin: 20, dmax: 45 }));
    renderGenGroups(); drawGenCurve(); renderSchemeSelect();
  }

  // ===== 生产记忆方案（文件存储，可随时调取某日方案）=====
  // ★方案不再写入 localStorage（旧版本无上限累积会撑爆浏览器存储，导致下载/导入失效）。
  //   现在方案保存在内存数组 gen.schemes 中；通过"方案文件 / 导出文件"把它持久化为一个 JSON 文件。
  //   若已用"方案文件"链接了一个读写文件句柄(File System Access API)，则保存/删除/清空会自动写回该文件，
  //   实现"增删都对齐到同一个文件"；浏览器不支持时退化为手动"导出文件 / 导入文件"。
  function loadSchemes() {
    if (!Array.isArray(gen.schemes)) gen.schemes = [];
    return gen.schemes;
  }
  function saveSchemesArr(arr) {
    gen.schemes = Array.isArray(arr) ? arr : [];
    persistSchemes();   // 已链接文件则自动写回，保持文件与内存对齐
  }
  // 已链接读写文件句柄时，把当前方案写回该文件（异步、容错）。
  function persistSchemes() {
    if (gen.fileHandle && gen.fileHandle.createWritable) {
      writeSchemeHandle(gen.fileHandle, gen.schemes).catch(function (e) {
        if (dom.genProgress) dom.genProgress.textContent = '⚠ 写回方案文件失败：' + (e && e.message || e) + '（可点"导出文件"手动保存）';
      });
    }
  }
  function writeSchemeHandle(handle, data) {
    return handle.createWritable().then(function (w) {
      return Promise.resolve(w.write(new Blob([JSON.stringify(data || [], null, 2)], { type: 'application/json' })))
        .then(function () { return w.close(); });
    });
  }
  // 链接一个方案文件：读入其内容到内存，并保留读写句柄 → 之后保存/删除自动写回。
  // 不支持 File System Access API 的浏览器退化为一次性导入。
  function linkSchemeFile() {
    if (window.showOpenFilePicker) {
      window.showOpenFilePicker({
        types: [{ description: 'StackSort 方案文件', accept: { 'application/json': ['.json'] } }],
        multiple: false
      }).then(function (handles) {
        var h = handles[0];
        if (h.requestPermission) {
          return h.requestPermission({ mode: 'readwrite' }).then(function (p) {
            if (p !== 'granted') throw new Error('未授予读写权限');
            return h;
          });
        }
        return h;
      }).then(function (h) {
        gen.fileHandle = h; gen.fileName = h.name;
        return h.getFile();
      }).then(function (file) {
        return file.text();
      }).then(function (text) {
        var arr = []; try { arr = JSON.parse(text || '[]'); } catch (e) { arr = []; }
        if (!Array.isArray(arr)) arr = [];
        gen.schemes = arr; renderSchemeSelect();
        dom.genProgress.textContent = '✓ 已链接方案文件「' + gen.fileName + '」：共 ' + arr.length + ' 条；之后保存/删除会自动写回该文件';
      }).catch(function (e) {
        if (e && e.name === 'AbortError') return;
        dom.genProgress.textContent = '链接方案文件失败：' + (e && e.message || e);
      });
    } else {
      importSchemeFileFallback();
    }
  }
  // 导出/写回方案文件：已链接句柄→直接写回；否则用 showSaveFilePicker 新建并链接；都不支持→普通下载。
  function exportSchemeFile() {
    var data = loadSchemes();
    if (gen.fileHandle && gen.fileHandle.createWritable) {
      writeSchemeHandle(gen.fileHandle, data).then(function () {
        dom.genProgress.textContent = '✓ 已写回方案文件「' + gen.fileName + '」：共 ' + data.length + ' 条';
      }).catch(function (e) {
        dom.genProgress.textContent = '写回方案文件失败：' + (e && e.message || e);
      });
      return;
    }
    if (window.showSaveFilePicker) {
      window.showSaveFilePicker({
        suggestedName: 'StackSort方案记忆.json',
        types: [{ description: 'StackSort 方案文件', accept: { 'application/json': ['.json'] } }]
      }).then(function (h) {
        gen.fileHandle = h; gen.fileName = h.name;
        return writeSchemeHandle(h, data);
      }).then(function () {
        renderSchemeSelect();
        dom.genProgress.textContent = '✓ 已保存并链接方案文件「' + gen.fileName + '」：共 ' + data.length + ' 条；之后保存/删除会自动写回';
      }).catch(function (e) {
        if (e && e.name === 'AbortError') return;
        dom.genProgress.textContent = '导出方案文件失败：' + (e && e.message || e);
      });
      return;
    }
    // 最后兜底：普通下载（本浏览器不支持文件句柄，增删后需再次导出）
    downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), 'StackSort方案记忆.json');
    dom.genProgress.textContent = '✓ 已下载方案文件（共 ' + data.length + ' 条）；下次用"方案文件"按钮导入即可继续';
  }
  // 兜底导入（无 File System Access API 时）：仅读入内存，增删后需手动"导出文件"。
  function importSchemeFileFallback() {
    var inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json,application/json';
    inp.addEventListener('change', function () {
      var f = inp.files && inp.files[0]; if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        var arr = []; try { arr = JSON.parse(rd.result || '[]'); } catch (e) { arr = []; }
        if (!Array.isArray(arr)) arr = [];
        gen.schemes = arr; gen.fileName = f.name; renderSchemeSelect();
        dom.genProgress.textContent = '✓ 已导入方案文件「' + f.name + '」：共 ' + arr.length + ' 条（本浏览器不支持自动写回，增删后请点"导出文件"重新保存）';
      };
      rd.readAsText(f);
    });
    inp.click();
  }
  function renderSchemeSelect() {
    if (!dom.genSchemeSel) return;
    var arr = loadSchemes();
    dom.genSchemeSel.innerHTML = '';
    if (!arr.length) { var op = document.createElement('option'); op.value = ''; op.textContent = '（暂无已存方案）'; dom.genSchemeSel.appendChild(op); return; }
    arr.slice().reverse().forEach(function (s) {
      var op = document.createElement('option'); op.value = s.id;
      op.textContent = s.name + ' · ' + s.total + '关 · ' + s.savedAt;
      dom.genSchemeSel.appendChild(op);
    });
  }
  // 保存当前参数为方案；auto=true 为生产后自动存档
  function saveScheme(auto) {
    var gm = globalMargin();
    var scheme = {
      id: 's' + Date.now() + '_' + Math.floor(Math.random() * 1000),
      name: (dom.genBatch.value || batchDateStr()) + (auto ? '(产)' : ''),
      savedAt: new Date().toLocaleString('zh-CN', { hour12: false }),
      total: totalLevels(),
      runs: +dom.genRuns.value || 6, attempts: +dom.genAttempts.value || 25,
      marginMin: gm.min, marginMax: gm.max,
      curveGroups: dom.genCurveGroups ? dom.genCurveGroups.value : 10,
      groups: JSON.parse(JSON.stringify(gen.groups)),
      overrides: JSON.parse(JSON.stringify(gen.overrides))
    };
    var arr = loadSchemes(); arr.push(scheme); saveSchemesArr(arr); renderSchemeSelect();
    if (!auto) dom.genProgress.textContent = '已保存方案：' + scheme.name + ' · ' + scheme.savedAt;
  }
  function loadSelectedScheme() {
    var id = dom.genSchemeSel && dom.genSchemeSel.value; if (!id) return;
    var s = loadSchemes().filter(function (x) { return x.id === id; })[0]; if (!s) return;
    gen.groups = JSON.parse(JSON.stringify(s.groups || []));
    gen.overrides = JSON.parse(JSON.stringify(s.overrides || {}));
    gen.expanded = -1;
    if (s.runs != null) dom.genRuns.value = s.runs;
    if (s.attempts != null) dom.genAttempts.value = s.attempts;
    if (s.marginMin != null) dom.genMarginMin.value = s.marginMin;
    if (s.marginMax != null) dom.genMarginMax.value = s.marginMax;
    if (s.curveGroups != null && dom.genCurveGroups) dom.genCurveGroups.value = s.curveGroups;
    dom.genBatch.value = (s.name || '').replace('(产)', '');
    autoAlignMargins();   // ★初次调取：自动把容错对齐到各关目标难度等级（之后手动调整不再跟随）
    renderGenGroups(); drawGenCurve();
    dom.genProgress.textContent = '已调取方案：' + s.name + ' · ' + s.savedAt + '（容错已按难度等级自动对齐）';
  }
  function deleteSelectedScheme() {
    var id = dom.genSchemeSel && dom.genSchemeSel.value; if (!id) { dom.genProgress.textContent = '请先在"方案记忆"下拉选择要删除的方案'; return; }
    var all = loadSchemes();
    var s = all.filter(function (x) { return x.id === id; })[0];
    if (s && !window.confirm('确定删除方案「' + s.name + ' · ' + s.savedAt + '」？此操作不可撤销。')) return;
    var arr = all.filter(function (x) { return x.id !== id; });
    saveSchemesArr(arr); renderSchemeSelect();
    dom.genProgress.textContent = '已删除方案' + (s ? '「' + s.name + '」' : '') + '，剩余 ' + arr.length + ' 条';
  }
  function clearAllSchemes() {
    var n = loadSchemes().length;
    if (!n) { dom.genProgress.textContent = '没有可清空的方案'; return; }
    if (!window.confirm('确定清空全部 ' + n + ' 条方案记忆？此操作不可撤销。')) return;
    saveSchemesArr([]); renderSchemeSelect();
    dom.genProgress.textContent = '已清空全部方案记忆（共 ' + n + ' 条）';
  }
  // 添加分组：区间自动顺延上一组
  function addGenGroup() {
    var last = gen.groups[gen.groups.length - 1];
    var from = last ? last.to + 1 : 1;
    var span = last ? (last.to - last.from + 1) : 5;
    gen.groups.push(defaultGroup(from, span, last));
    renderGenGroups(); drawGenCurve();
  }

  // ===== 导入关卡库 → 对齐参数并自动分组 =====
  // 逐关提取 行/列/颜色/障碍组合(含数量)/冰块步数/炸弹倒计时/难度，按相同结构(行x列x色+障碍组合)
  // 连续聚合成分组；每关难度写入逐关目标(±3)，使生成结果对齐原库难度曲线。导入后可微调。
  function extractGenParams(st) {
    var K = st.colCount, H = st.rowCount;
    var ice = 0, rock = 0, cover = 0, fixed = 0, keylock = 0, surprise = 0;
    var iceDurs = [], dualBases = {}, bombStepsArr = [], topColors = {}, baseColors = {};
    for (var c = 0; c < K; c++) {
      if (st.iceReq && st.iceReq[c] > 0) { ice++; iceDurs.push(st.iceReq[c]); }
      if (st.rockLocked && st.rockLocked[c]) rock++;
      if (st.coverReq && st.coverReq[c]) cover++;
      if (st.fixedColor && st.fixedColor[c]) fixed++;
      var col = st.columns[c];
      for (var i = 0; i < col.length; i++) {
        var cell = col[i]; if (!cell) continue;
        if (cell.kind === 'color' && cell.colorKey) baseColors[cell.colorKey] = 1;
        if (cell.kind === 'dual') { dualBases[cell.colorKey] = 1; if (cell.topColorKey) topColors[cell.topColorKey] = 1; }
        if (cell.bomb != null) bombStepsArr.push(cell.bomb);
        if (cell.features) {
          if (cell.features.indexOf('Surprise') !== -1) surprise++;
          if (cell.features.indexOf('Lock') !== -1) keylock++;
        }
      }
    }
    var links = (st.links && st.links.length) ? st.links.length : 0;
    var bombs = (st.bombs && st.bombs.length) ? st.bombs.length : 0;
    // 真实调色板 = 普通色 + 双色顶层色，剔除双色底色(生成时自动新增)
    var palette = {};
    Object.keys(baseColors).forEach(function (k) { palette[k] = 1; });
    Object.keys(topColors).forEach(function (k) { palette[k] = 1; });
    Object.keys(dualBases).forEach(function (k) { delete palette[k]; });
    var colorCount = Math.max(2, Math.min(K, Object.keys(palette).length || K));
    var combo = {};
    if (surprise) combo.Surprise = surprise;
    if (ice) combo.Ice = ice;
    if (rock) combo.Rock = rock;
    if (fixed) combo.FixedColor = fixed;
    if (cover) combo.CoveredColor = cover;
    if (keylock) combo.KeyLock = keylock;
    if (links) combo.Linked = links;
    if (Object.keys(dualBases).length) combo.Dual = Object.keys(dualBases).length;
    if (bombs) combo.Bomb = bombs;
    return {
      H: H, K: K, colorCount: colorCount, combo: combo,
      iceMin: iceDurs.length ? Math.min.apply(null, iceDurs) : 1,
      iceMax: iceDurs.length ? Math.max.apply(null, iceDurs) : 4,
      bombCount: bombs || 1, bombHidden: false, bombTiming: 'global'
    };
  }
  function comboSig(combo) {
    return Object.keys(combo).sort().map(function (k) { return k + ':' + combo[k]; }).join(',');
  }
  function importLibraryToGen() {
    if (!library.length) { dom.genProgress.textContent = '没有可导入的关卡库（请先加载关卡）'; return; }
    if (gen.groups.length && !window.confirm('导入将【替换】当前所有分组与逐关设置，确定继续？')) return;
    var runs = Math.max(3, Math.min(12, +dom.genRuns.value || 6));
    dom.genImportLib.disabled = true; dom.genRunBtn.disabled = true;
    var recs = [], idx = 0;

    function ensureRaw(entry, cb) {
      if (entry.raw) return cb(entry.raw);
      if (entry.url) {
        fetch(entry.url).then(function (r) { return r.json(); })
          .then(function (j) { entry.raw = j; cb(j); }).catch(function () { cb(null); });
      } else cb(null);
    }
    function step() {
      if (idx >= library.length) return finish();
      var entry = library[idx];
      dom.genProgress.textContent = '导入对齐… ' + (idx + 1) + '/' + library.length + '（' + entry.name + '）';
      ensureRaw(entry, function (raw) {
        if (raw) {
          try {
            SS.Colors.reset();
            var lvl = SS.LevelLoader.parse(raw);
            if (lvl.boards.length === 1) {
              var st = SS.Engine.createState(lvl.boards[0], lvl.stepCount);
              if (SS.Solver.validateLevel(st).valid) {
                var info = extractGenParams(st);
                var obs = SS.Analysis.obstaclesFromState(st);
                var stSolve = SS.Engine.createState(lvl.boards[0], 999);   // 宽预算求解
                var r = SS.Analysis.multiSolve(stSolve, runs, 20);
                var ps = null, pmImp = null;
                if ((obs.length > 1 || (SS.PlayerSolver && SS.PlayerSolver.hasSurprise(st))) && SS.PlayerSolver) {
                  pmImp = SS.PlayerSolver.multiSolve(SS.Engine.createState(lvl.boards[0], 999), runs, 20);
                  if (obs.length > 1) ps = pmImp.bestModeSucc;
                }
                var optBest = r.best;
                if (pmImp && pmImp.best != null && (optBest == null || pmImp.best < optBest)) optBest = pmImp.best;
                var d = SS.Analysis.difficulty(st, obs, optBest, lvl.stepCount, r, ps, pmImp);
                info.score = d.score;
                info.sig = info.H + 'x' + info.K + 'x' + info.colorCount + '|' + comboSig(info.combo);
                recs.push(info);
              }
            }
          } catch (e) { /* 跳过异常关卡 */ }
        }
        idx++; setTimeout(step, 0);
      });
    }
    function finish() {
      dom.genImportLib.disabled = false; dom.genRunBtn.disabled = false;
      if (!recs.length) { dom.genProgress.textContent = '导入失败：无有效关卡'; return; }
      buildGroupsFromRecs(recs);
      autoAlignMargins();   // ★初次对齐：容错按各关目标难度等级自动对齐（之后手动调整不再跟随）
      gen.expanded = -1;
      renderGenGroups(); drawGenCurve();
      dom.genProgress.textContent = '✓ 已导入 ' + recs.length + ' 关，自动对齐为 ' + gen.groups.length + ' 组（难度已逐关对齐，可微调）';
    }
    recs.length = 0; idx = 0; setTimeout(step, 0);
  }
  // 把逐关参数记录【按每组 10 关】分组（对齐关卡库默认分组）；难度逐关对齐(±3)，
  // 块内取出现最多的"代表签名"作组参数，与代表不同的关覆盖其结构参数(行/列/色/障碍)。
  function buildGroupsFromRecs(recs) {
    gen.groups = []; gen.overrides = {};
    var SIZE = 10;
    for (var start = 0; start < recs.length; start += SIZE) {
      var members = recs.slice(start, start + SIZE);
      var from = start + 1, to = start + members.length;
      // 代表签名 = 块内出现最多的 sig
      var sigCount = {}, repSig = members[0].sig, repN = 0;
      members.forEach(function (m) { sigCount[m.sig] = (sigCount[m.sig] || 0) + 1; if (sigCount[m.sig] > repN) { repN = sigCount[m.sig]; repSig = m.sig; } });
      var rep = members.filter(function (m) { return m.sig === repSig; })[0];
      var scores = members.map(function (m) { return m.score; });
      var dmin = Math.max(0, Math.min.apply(null, scores) - 3);
      var dmax = Math.min(100, Math.max.apply(null, scores) + 3);
      var g = defaultGroup(from, to - from + 1, { H: rep.H, K: rep.K, colorCount: rep.colorCount, dmin: dmin, dmax: dmax });
      g.from = from; g.to = to;
      g.combo = JSON.parse(JSON.stringify(rep.combo));
      g.iceDurMin = rep.iceMin; g.iceDurMax = rep.iceMax;
      g.bombCountMin = rep.bombCount; g.bombCountMax = rep.bombCount; g.bombHidden = rep.bombHidden; g.bombTiming = rep.bombTiming;
      gen.groups.push(g);
      members.forEach(function (m, mi) {
        var no = from + mi, ov = {};
        ov.dmin = Math.max(0, m.score - 3); ov.dmax = Math.min(100, m.score + 3);   // 逐关难度对齐
        if (m.sig !== repSig) {                                                     // 与代表不同 → 覆盖结构参数
          ov.H = m.H; ov.K = m.K; ov.colorCount = m.colorCount;
          ov.combo = JSON.parse(JSON.stringify(m.combo));
          ov.iceDurMin = m.iceMin; ov.iceDurMax = m.iceMax;
          ov.bombCountMin = m.bombCount; ov.bombCountMax = m.bombCount; ov.bombHidden = m.bombHidden; ov.bombTiming = m.bombTiming;
        }
        gen.overrides[no] = ov;
      });
    }
  }

  function totalLevels() { return gen.groups.reduce(function (m, g) { return Math.max(m, g.to); }, 0); }
  function groupIndexFor(idx) { for (var i = 0; i < gen.groups.length; i++) if (idx >= gen.groups[i].from && idx <= gen.groups[i].to) return i; return -1; }

  // 全局步数余量（作为分组/逐关未设定时的回退）
  function globalMargin() {
    var lo = Math.max(0, Math.min(60, +(dom.genMarginMin && dom.genMarginMin.value) || 0));
    var hi = Math.max(lo, Math.min(60, +(dom.genMarginMax && dom.genMarginMax.value) || 20));
    return { min: lo, max: hi };
  }

  // 数字步进器：左右两个大号 −/+ 按钮 + 中间数字（隐藏原生上下箭头），比原生 spinner 易点
  function numInput(val, w, on, opts) {
    opts = opts || {};
    var step = opts.step || 1, min = opts.min, max = opts.max;
    var wrap = document.createElement('span'); wrap.className = 'num-stepper';
    var dec = document.createElement('button'); dec.type = 'button'; dec.className = 'num-step-btn'; dec.textContent = '−';
    var inp = document.createElement('input'); inp.type = 'number'; inp.className = 'num-step-input'; inp.value = val; inp.style.width = (w || 40) + 'px';
    var inc = document.createElement('button'); inc.type = 'button'; inc.className = 'num-step-btn'; inc.textContent = '+';
    function clampv(v) { if (min != null) v = Math.max(min, v); if (max != null) v = Math.min(max, v); return v; }
    function set(v) { v = clampv(v); inp.value = v; on(v); }
    inp.addEventListener('input', function () { on(+inp.value); });
    dec.addEventListener('click', function () { set((+inp.value || 0) - step); });
    inc.addEventListener('click', function () { set((+inp.value || 0) + step); });
    wrap.appendChild(dec); wrap.appendChild(inp); wrap.appendChild(inc);
    return wrap;
  }

  // 障碍选择器（组级 / 逐关共用）：combo=障碍map(写入), extra=ice步数范围/炸弹倒计(写入), dflt=默认回退, onChange=重渲染
  function renderObstaclePicker(container, combo, extra, dflt, onChange) {
    gen.OBS.forEach(function (p) {
      var key = p[0];
      var lbl = document.createElement('label');
      var on = combo[key] != null && combo[key] !== false;
      var cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = on;
      cb.addEventListener('change', function () { if (cb.checked) combo[key] = true; else delete combo[key]; onChange(); });
      lbl.appendChild(cb); lbl.appendChild(document.createTextNode(p[1]));
      if (on) {
        if (key === 'Bomb') {
          // 炸弹专用控件：仅数量 min~max。倒计时不再手填——由生成器按该关步数上限 sc 自动算
          // （当前需求：炸弹只放可达列(明牌)，倒计时 0.4~0.9×sc）。
          // 注：隐藏列炸弹(独立/全局计时)功能底层已实现并保留作储备，暂不在 UI 暴露（见 难度评分体系.md 待优化）。
          lbl.appendChild(document.createTextNode('数量'));
          lbl.appendChild(numInput(extra.bombCountMin != null ? extra.bombCountMin : (dflt.bombCountMin != null ? dflt.bombCountMin : 1), 26, function (v) { extra.bombCountMin = Math.max(1, Math.min(8, v)); }, { min: 1, max: 8 }));
          lbl.appendChild(document.createTextNode('-'));
          lbl.appendChild(numInput(extra.bombCountMax != null ? extra.bombCountMax : (dflt.bombCountMax != null ? dflt.bombCountMax : 2), 26, function (v) { extra.bombCountMax = Math.max(1, Math.min(8, v)); }, { min: 1, max: 8 }));
          container.appendChild(lbl);
          return;
        }
        var isAuto = (combo[key] === true);
        var aLbl = document.createElement('span'); aLbl.style.marginLeft = '4px';
        var ac = document.createElement('input'); ac.type = 'checkbox'; ac.checked = isAuto;
        ac.addEventListener('change', function () { combo[key] = ac.checked ? true : (typeof combo[key] === 'number' ? combo[key] : 1); onChange(); });
        aLbl.appendChild(ac); aLbl.appendChild(document.createTextNode('默认'));
        lbl.appendChild(aLbl);
        // 数量输入：冰块始终显示(可直接自选数量)；其它障碍仅"非默认"时显示。编辑数量即切手动(取消"默认"，不整体重渲染以免丢焦点)。
        if (key === 'Ice' || !isAuto) {
          lbl.appendChild(document.createTextNode('×'));
          lbl.appendChild(numInput(typeof combo[key] === 'number' ? combo[key] : 1, 30, function (v) { combo[key] = Math.max(1, v); ac.checked = false; }, { min: 1 }));
        }
        if (key === 'Ice') {
          lbl.appendChild(document.createTextNode('步'));
          lbl.appendChild(numInput(extra.iceDurMin != null ? extra.iceDurMin : (dflt.iceDurMin != null ? dflt.iceDurMin : 1), 26, function (v) { extra.iceDurMin = Math.max(1, Math.min(4, v)); }, { min: 1, max: 4 }));
          lbl.appendChild(document.createTextNode('-'));
          lbl.appendChild(numInput(extra.iceDurMax != null ? extra.iceDurMax : (dflt.iceDurMax != null ? dflt.iceDurMax : 2), 26, function (v) { extra.iceDurMax = Math.max(1, Math.min(4, v)); }, { min: 1, max: 4 }));
        }
      }
      container.appendChild(lbl);
    });
  }
  function renderGenGroups() {
    var tb = dom.genGroupBody; tb.innerHTML = '';
    gen.groups.forEach(function (g, gi) {
      var tr = document.createElement('tr');
      var rangeTd = document.createElement('td'); rangeTd.className = 'gen-range';
      // 关卡区间可编辑：from–to 步进器（随意调每组容量）+ 单独展开按钮
      rangeTd.appendChild(numInput(g.from, 30, function (v) { g.from = Math.max(1, v); drawGenCurve(); }, { min: 1 }));
      rangeTd.appendChild(document.createTextNode('–'));
      rangeTd.appendChild(numInput(g.to, 30, function (v) { g.to = Math.max(g.from, v); drawGenCurve(); }, { min: 1 }));
      var expBtn = document.createElement('button'); expBtn.className = 'tool-btn'; expBtn.style.marginLeft = '4px';
      expBtn.textContent = (gen.expanded === gi ? '▴ 收起' : '▾ 逐关');
      expBtn.title = '展开/收起逐关设置';
      expBtn.addEventListener('click', function () { gen.expanded = (gen.expanded === gi ? -1 : gi); renderGenGroups(); });
      rangeTd.appendChild(expBtn);
      tr.appendChild(rangeTd);
      function ntd(key, w) { var td = document.createElement('td'); td.appendChild(numInput(g[key], w, function (v) { g[key] = v; })); return td; }
      tr.appendChild(ntd('H', 36)); tr.appendChild(ntd('K', 36)); tr.appendChild(ntd('colorCount', 36));
      // 难度区间
      var dtd = document.createElement('td');
      dtd.appendChild(numInput(g.dmin, 34, function (v) { g.dmin = v; drawGenCurve(); }));
      dtd.appendChild(document.createTextNode('–'));
      dtd.appendChild(numInput(g.dmax, 34, function (v) { g.dmax = v; drawGenCurve(); }));
      tr.appendChild(dtd);
      // 步数余量（分组级；未设=继承全局，显示有效值，编辑即设为分组级）
      var gm = globalMargin();
      var mtd = document.createElement('td');
      mtd.appendChild(numInput(g.marginMin != null ? g.marginMin : gm.min, 28, function (v) { g.marginMin = Math.max(0, Math.min(60, v)); }, { min: 0, max: 60 }));
      mtd.appendChild(document.createTextNode('-'));
      mtd.appendChild(numInput(g.marginMax != null ? g.marginMax : gm.max, 28, function (v) { g.marginMax = Math.max(0, Math.min(60, v)); }, { min: 0, max: 60 }));
      // 分组级刷新：按本组难度区间重新对齐本组(及组内逐关)的步数余量到对应等级容错
      (function (gobj) {
        var rb = document.createElement('button'); rb.className = 'tool-btn'; rb.textContent = '🔄'; rb.style.marginLeft = '4px';
        rb.title = '按本组难度区间刷新本组(及组内逐关)的步数余量到对应难度等级容错';
        rb.addEventListener('click', function () { refreshMarginsForGroup(gobj); });
        mtd.appendChild(rb);
      })(g);
      tr.appendChild(mtd);
      // 障碍 + 参数（每个障碍：启用 + 默认(自动数量)/手动数量；冰块带步数范围；炸弹带倒计时）
      var otd = document.createElement('td'); otd.className = 'gen-obs';
      renderObstaclePicker(otd, g.combo, g, g, renderGenGroups);
      tr.appendChild(otd);
      var delTd = document.createElement('td');
      var del = document.createElement('button'); del.className = 'tool-btn'; del.textContent = '✕';
      del.addEventListener('click', function () { gen.groups.splice(gi, 1); if (gen.expanded === gi) gen.expanded = -1; renderGenGroups(); drawGenCurve(); });
      delTd.appendChild(del); tr.appendChild(delTd);
      tb.appendChild(tr);
      if (gen.expanded === gi) tb.appendChild(genExpandRow(g));
    });
  }

  // 展开：逐关覆盖（留空=用分组值）
  function genExpandRow(g) {
    var tr = document.createElement('tr'); var td = document.createElement('td'); td.colSpan = 10;
    var wrap = document.createElement('div'); wrap.className = 'gen-expand';
    wrap.innerHTML = '<div class="hint">逐关设置（改了即覆盖该关，其余跟随分组）</div>';
    var tbl = document.createElement('table'); tbl.className = 'gen-sub-table';
    tbl.innerHTML = '<thead><tr><th>关</th><th>行</th><th>列</th><th>颜色</th><th>难度区间</th><th>步数余量</th><th>障碍组合(自定)</th></tr></thead>';
    var tbody = document.createElement('tbody');
    for (var n = g.from; n <= g.to; n++) (function (no) {
      var o = gen.overrides[no] || {};
      function ov(k, d) { return o[k] != null ? o[k] : d; }
      function setov(k, v) { gen.overrides[no] = gen.overrides[no] || {}; gen.overrides[no][k] = v; o = gen.overrides[no]; }
      var rtr = document.createElement('tr');
      function cell(ch) { var c = document.createElement('td'); c.appendChild(ch); return c; }
      rtr.appendChild(cell(document.createTextNode(no)));
      rtr.appendChild(cell(numInput(ov('H', g.H), 34, function (v) { setov('H', v); })));
      rtr.appendChild(cell(numInput(ov('K', g.K), 34, function (v) { setov('K', v); })));
      rtr.appendChild(cell(numInput(ov('colorCount', g.colorCount), 34, function (v) { setov('colorCount', v); })));
      var dt = document.createElement('td'); dt.appendChild(numInput(ov('dmin', g.dmin), 34, function (v) { setov('dmin', v); })); dt.appendChild(document.createTextNode('–')); dt.appendChild(numInput(ov('dmax', g.dmax), 34, function (v) { setov('dmax', v); })); rtr.appendChild(dt);
      // 逐关步数余量（继承 分组→全局；编辑即设为逐关级，粘性）
      var gm2 = globalMargin();
      var emin = o.marginMin != null ? o.marginMin : (g.marginMin != null ? g.marginMin : gm2.min);
      var emax = o.marginMax != null ? o.marginMax : (g.marginMax != null ? g.marginMax : gm2.max);
      var mt = document.createElement('td');
      mt.appendChild(numInput(emin, 28, function (v) { setov('marginMin', Math.max(0, Math.min(60, v))); }, { min: 0, max: 60 }));
      mt.appendChild(document.createTextNode('-'));
      mt.appendChild(numInput(emax, 28, function (v) { setov('marginMax', Math.max(0, Math.min(60, v))); }, { min: 0, max: 60 }));
      rtr.appendChild(mt);
      // 逐关障碍自定：勾选=独立障碍(从分组克隆)；不勾=跟随分组
      var ot = document.createElement('td'); ot.className = 'gen-obs';
      var custom = !!o.combo;
      var clbl = document.createElement('label');
      var ccb = document.createElement('input'); ccb.type = 'checkbox'; ccb.checked = custom;
      ccb.addEventListener('change', function () {
        if (ccb.checked) {
          gen.overrides[no] = gen.overrides[no] || {};
          gen.overrides[no].combo = Object.assign({}, g.combo);   // 从分组克隆为起点
          if (g.iceDurMin != null) gen.overrides[no].iceDurMin = g.iceDurMin;
          if (g.iceDurMax != null) gen.overrides[no].iceDurMax = g.iceDurMax;
          if (g.bombCountMin != null) gen.overrides[no].bombCountMin = g.bombCountMin;
          if (g.bombCountMax != null) gen.overrides[no].bombCountMax = g.bombCountMax;
          if (g.bombHidden != null) gen.overrides[no].bombHidden = g.bombHidden;
          if (g.bombTiming != null) gen.overrides[no].bombTiming = g.bombTiming;
        } else if (gen.overrides[no]) {
          delete gen.overrides[no].combo; delete gen.overrides[no].iceDurMin;
          delete gen.overrides[no].iceDurMax;
          delete gen.overrides[no].bombCountMin; delete gen.overrides[no].bombCountMax;
          delete gen.overrides[no].bombHidden; delete gen.overrides[no].bombTiming;
        }
        renderGenGroups();
      });
      clbl.appendChild(ccb); clbl.appendChild(document.createTextNode('自定'));
      ot.appendChild(clbl);
      if (custom) { var pk = document.createElement('div'); pk.style.marginTop = '2px'; renderObstaclePicker(pk, o.combo, o, g, renderGenGroups); ot.appendChild(pk); }
      rtr.appendChild(ot);
      tbody.appendChild(rtr);
    })(n);
    tbl.appendChild(tbody); wrap.appendChild(tbl); td.appendChild(wrap); tr.appendChild(td);
    return tr;
  }

  function applyMarginAll() { /* 容错UI已移除：步数余量由生成器自动在 0-20 步内扫描 */ }

  // 宏观难度曲线：每分组一个控制点（x=区间中点，y=目标难度=(dmin+dmax)/2），上下拖动调该组难度
  // 每关目标难度中值 = 覆盖值优先(overrides) → 否则分组值
  function levelTargetMid(L) {
    var gi = groupIndexFor(L); if (gi < 0) return 50;
    var g = gen.groups[gi], ov = gen.overrides[L] || {};
    var dmin = ov.dmin != null ? ov.dmin : g.dmin;
    var dmax = ov.dmax != null ? ov.dmax : g.dmax;
    return (dmin + dmax) / 2;
  }
  function setLevelTarget(L, val, half) {
    var gi = groupIndexFor(L); if (gi < 0) return;
    gen.overrides[L] = gen.overrides[L] || {};
    gen.overrides[L].dmin = Math.max(0, Math.round(val - half));
    gen.overrides[L].dmax = Math.min(100, Math.round(val + half));
  }
  // 把 1..total 关按 N 段等分，返回每段 {lo,hi,xLvl,y=段内平均目标难度}
  function curveSegments() {
    var total = totalLevels() || 1;
    var N = Math.max(1, Math.min(total, parseInt(dom.genCurveGroups && dom.genCurveGroups.value, 10) || 10));
    var segs = [];
    for (var s = 0; s < N; s++) {
      var lo = Math.floor(s * total / N) + 1, hi = Math.floor((s + 1) * total / N);
      if (s === N - 1) hi = total;
      if (hi < lo) continue;
      var sum = 0, c = 0; for (var L = lo; L <= hi; L++) { sum += levelTargetMid(L); c++; }
      segs.push({ lo: lo, hi: hi, xLvl: (lo + hi) / 2, y: c ? sum / c : 50 });
    }
    return segs;
  }

  // 宏观难度曲线：横轴按"分组数"自由等分(N 段)，每段一个控制点；上下拖动 = 设定该段所有关的目标难度。
  // N=总关数 → 每点=1关(微观精调)；N=5 → 每点=总数/5 关(宏观)。点写入 overrides，覆盖分组难度。
  function drawGenCurve() {
    var cv = dom.genCurve; if (!cv) return; var ctx = cv.getContext('2d');
    var W = cv.width, Hh = cv.height, padL = 32, padR = 12, padT = 12, padB = 22;
    ctx.fillStyle = '#1b1f2a'; ctx.fillRect(0, 0, W, Hh);
    var total = totalLevels() || 1, plotW = W - padL - padR, plotH = Hh - padT - padB;
    ctx.strokeStyle = '#3a4258'; ctx.fillStyle = '#9aa3b5'; ctx.font = '10px sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (var gg = 0; gg <= 100; gg += 25) { var y = padT + plotH * (1 - gg / 100); ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke(); ctx.fillText(gg, padL - 4, y); }
    function px(lvl) { return padL + plotW * ((lvl - 1) / Math.max(1, total - 1)); }
    function py(s) { return padT + plotH * (1 - s / 100); }
    var segs = curveSegments();
    ctx.strokeStyle = '#4cc2ff'; ctx.lineWidth = 2; ctx.beginPath();
    segs.forEach(function (p, i) { var x = px(p.xLvl), y = py(p.y); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }); ctx.stroke();
    ctx.fillStyle = '#ffcc4d'; segs.forEach(function (p) { ctx.beginPath(); ctx.arc(px(p.xLvl), py(p.y), 4.5, 0, Math.PI * 2); ctx.fill(); });
    // 段标签（稀疏，显示关号区间）
    ctx.fillStyle = '#9aa3b5'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    var stepLbl = Math.max(1, Math.ceil(segs.length / 12));
    segs.forEach(function (p, i) { if (i % stepLbl === 0 || i === segs.length - 1) ctx.fillText(p.lo === p.hi ? ('' + p.lo) : (p.lo + '-' + p.hi), px(p.xLvl), Hh - padB + 4); });
    gen._curveMap = { px: px, py: py, padT: padT, plotH: plotH, segs: segs };
  }
  function setupCurveDrag() {
    var cv = dom.genCurve; if (!cv) return;
    cv.addEventListener('pointerdown', function (e) {
      var m = gen._curveMap; if (!m || !m.segs) return;
      var rect = cv.getBoundingClientRect(), sx = cv.width / rect.width, sy = cv.height / rect.height;
      var mx = (e.clientX - rect.left) * sx, my = (e.clientY - rect.top) * sy;
      var best = -1, bd = 1e9;
      m.segs.forEach(function (p, i) { var x = m.px(p.xLvl), y = m.py(p.y); var d = Math.hypot(x - mx, y - my); if (d < bd) { bd = d; best = i; } });
      if (best < 0 || bd > 40) return;
      function move(ev) {
        var yy = (ev.clientY - rect.top) * sy;
        var val = Math.round(Math.max(0, Math.min(100, (1 - (yy - m.padT) / m.plotH) * 100)));
        var half = Math.max(2, parseInt(dom.genCurveWin && dom.genCurveWin.value, 10) || 6);
        var seg = gen._curveMap.segs[best];
        for (var L = seg.lo; L <= seg.hi; L++) setLevelTarget(L, val, half);   // 该段所有关写入目标难度
        drawGenCurve(); renderGenGroups();
      }
      function up() { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); }
      document.addEventListener('pointermove', move); document.addEventListener('pointerup', up); move(e);
    });
  }
  // 读取生成器全局参数（runGen 与单关重生成共用）
  function genReadGlobals() {
    return {
      runs: Math.max(3, Math.min(20, +dom.genRuns.value || 6)),
      attempts: Math.max(5, Math.min(80, +dom.genAttempts.value || 25)),
      mMin: Math.max(0, Math.min(60, +dom.genMarginMin.value || 0)),
      mMax: Math.max(0, Math.min(60, +dom.genMarginMax.value || 20)),
      strict: dom.genStrict.checked,
      batch: dom.genBatch.value || batchDateStr()
    };
  }
  // 难度等级对应的容错(步数余量)目标区间（与 generator.gradeMargin 一致）
  function gradeMargin(score) {
    if (score < 31) return [13, 20];   // 简单 0-30
    if (score < 61) return [9, 12];    // 普通 31-60
    if (score < 81) return [5, 8];     // 困难 61-80
    return [1, 4];                     // 极难 81-100
  }
  // 单关有效参数（逐关 override → 分组 → 全局；步数余量默认按【目标难度等级】容错自动对齐）
  function genParamForLevel(i, gl) {
    var gi = groupIndexFor(i); if (gi < 0) return null;
    var g = gen.groups[gi], o = gen.overrides[i] || {};
    function pick(k) { return o[k] != null ? o[k] : g[k]; }
    var combo = o.combo ? o.combo : g.combo;   // 自定已勾(o.combo存在)→用逐关；未勾→跟随分组
    // 步数余量：逐关 → 分组 → 全局(改离默认时) → 目标难度等级容错(自动默认)
    var tmid = ((pick('dmin') != null ? pick('dmin') : 0) + (pick('dmax') != null ? pick('dmax') : 100)) / 2;
    var gmt = gradeMargin(tmid);
    var globalSet = !(gl.mMin === 0 && gl.mMax === 20);   // 全局余量是否被改离默认 0-20
    var defMin = globalSet ? gl.mMin : gmt[0];
    var defMax = globalSet ? Math.max(gl.mMin, gl.mMax) : gmt[1];
    var mMinEff = o.marginMin != null ? o.marginMin : (g.marginMin != null ? g.marginMin : defMin);
    var mMaxEff = o.marginMax != null ? o.marginMax : (g.marginMax != null ? g.marginMax : defMax);
    if (mMaxEff < mMinEff) mMaxEff = mMinEff;
    return {
      H: pick('H'), K: pick('K'), colorCount: pick('colorCount'), chaos: pick('chaos'),
      combo: combo, minMargin: mMinEff, maxMargin: mMaxEff, maxSolverGap: 20,
      difficultyMin: pick('dmin'), difficultyMax: pick('dmax'),
      runsPerMode: gl.runs, maxAttempts: gl.attempts, validateStrict: gl.strict, name: 'gen',
      opts: {
        iceDurMin: pick('iceDurMin'), iceDurMax: pick('iceDurMax'),
        bombCountMin: pick('bombCountMin'), bombCountMax: pick('bombCountMax'),
        bombHidden: pick('bombHidden'), bombTiming: pick('bombTiming')
      }
    };
  }
  // 给 rec 补齐元信息（关号/命中/文件名/raw 名）
  function finalizeGenRec(rec, res, levelNo, params, batch) {
    rec.levelNo = levelNo; rec.hit = res.ok;
    rec.targetMin = params.difficultyMin; rec.targetMax = params.difficultyMax;
    rec.fileName = batch + '_第' + levelNo + '关_' + rec.difficulty + '.json';
    rec.raw.name = batch + '_第' + levelNo + '关_' + rec.difficulty;
    rec.raw.id = rec.raw.name;
    if (rec.raw.data) { rec.raw.data.name = rec.raw.name; rec.raw.data.id = rec.raw.name; }
  }

  function runGen() {
    if (!gen.groups.length) { dom.genProgress.textContent = '请先添加分组'; return; }
    var total = totalLevels();
    var gl = genReadGlobals();
    gen.results = [];
    dom.genRunBtn.disabled = true; dom.genZipBtn.disabled = true;
    var idx = 1;

    function step() {
      if (idx > total) return finish();
      var params = genParamForLevel(idx, gl);
      dom.genProgress.textContent = '生成中… 第 ' + idx + '/' + total + ' 关' + (params ? '' : '（无分组覆盖，跳过）');
      if (!params) { idx++; return setTimeout(step, 0); }
      setTimeout(function () {
        try {
          var res = SS.Generator.generateOne(params);
          if (res.rec) {
            finalizeGenRec(res.rec, res, idx, params, gl.batch);
            gen.results.push(res.rec);
          }
        } catch (e) { /* 单关生成异常 → 跳过该关，不中断整批生成 */ }
        idx++; setTimeout(step, 0);
      }, 0);
    }
    function finish() {
      var hitN = gen.results.filter(function (r) { return r.hit; }).length;
      var missN = gen.results.length - hitN;
      dom.genProgress.textContent = '完成：生成 ' + gen.results.length + '/' + total + ' 关（合格 ' + hitN + '）' +
        (missN > 0 ? '  ⚠ ' + missN + ' 关不合格（难度或容错未对齐，红色行；点该行"重生成"换随机分布，或调参数后重试）' : '');
      dom.genRunBtn.disabled = false;
      dom.genZipBtn.disabled = gen.results.length === 0;
      renderGenTable();
      drawDifficultyChart(dom.genChart, gen.results.map(function (r) { return { name: 'L' + r.levelNo, score: r.difficulty, level: r.level }; }), 'micro');
      // ★不再自动存档：方案记忆只保留用户【主动保存】的方案（点"保存当前"），避免无限累积撑爆存储。
    }
    setTimeout(step, 0);
  }

  // 单关重新生成：用该关当前有效参数(逐关override→分组→全局)重生成，替换结果并刷新表格/曲线。
  // 用于修正未达难度阈值的关：在逐关设置里改参数 → 回到结果表点该行"重生成"。
  function regenerateLevel(levelNo) {
    if (!gen.results.length) return;
    var gl = genReadGlobals();
    var params = genParamForLevel(levelNo, gl);
    if (!params) { dom.genProgress.textContent = '第' + levelNo + ' 关无分组覆盖，无法重生成'; return; }
    dom.genProgress.textContent = '重新生成 第' + levelNo + ' 关…';
    setTimeout(function () {
      var res;
      try { res = SS.Generator.generateOne(params); }
      catch (e) { dom.genProgress.textContent = '第' + levelNo + ' 关重新生成异常：' + e.message + '（可调参数重试）'; return; }
      if (res.rec) {
        finalizeGenRec(res.rec, res, levelNo, params, gl.batch);
        var idx = -1;
        for (var i = 0; i < gen.results.length; i++) if (gen.results[i].levelNo === levelNo) { idx = i; break; }
        if (idx >= 0) gen.results[idx] = res.rec; else { gen.results.push(res.rec); gen.results.sort(function (a, b) { return a.levelNo - b.levelNo; }); }
        renderGenTable();
        drawDifficultyChart(dom.genChart, gen.results.map(function (r) { return { name: 'L' + r.levelNo, score: r.difficulty, level: r.level }; }), 'micro');
        dom.genProgress.textContent = '第' + levelNo + ' 关已重新生成：难度 ' + res.rec.difficulty + (res.ok ? ' ✓ 命中阈值' : ' ⚠ 仍未达目标，可继续调参数重试');
      } else {
        dom.genProgress.textContent = '第' + levelNo + ' 关重新生成失败（合法性/可解性未通过），可调参数重试';
      }
    }, 0);
  }

  // ===== 一键重生成（不合格自动调参）=====
  function comboNum(c, k) { return (typeof c[k] === 'number') ? c[k] : (c[k] ? 1 : 0); }
  function presentObstacles(combo) { return Object.keys(combo).filter(function (k) { return comboNum(combo, k) > 0; }); }
  // ★只修改障碍【参数值(数量)】，不修改障碍组合(不增删障碍类型)。
  // 加难：给数量最少的已有障碍 +1（问号 +4）。无障碍则不动。
  function nudgeHarder(combo) {
    var keys = presentObstacles(combo); if (!keys.length) return;
    keys.sort(function (a, b) { return comboNum(combo, a) - comboNum(combo, b); });
    var k = keys[0];
    combo[k] = comboNum(combo, k) + (k === 'Surprise' ? 4 : 1);
  }
  // 减难：给数量最多的已有障碍 -1（问号 -4），但不删除该类型（最少保留 1 / 问号最少 2）。
  function nudgeEasier(combo) {
    var keys = presentObstacles(combo); if (!keys.length) return;
    keys.sort(function (a, b) { return comboNum(combo, b) - comboNum(combo, a); });
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i], n = comboNum(combo, k), step = (k === 'Surprise' ? 4 : 1), floor = (k === 'Surprise' ? 2 : 1);
      if (n - step >= floor) { combo[k] = n - step; return; }
    }
    // 全部已到下限 → 不改(不删除障碍类型，保持组合不变)
  }
  // 不合格关自动调参：难度不达→增减障碍【数量】(不改组合)；容错不符→撑/松障碍数量 + 余量对齐目标等级容错
  function autoFixUnqualified(no, rec) {
    var gl = genReadGlobals();
    var eff = genParamForLevel(no, gl); if (!eff) return;
    var o = gen.overrides[no] = gen.overrides[no] || {};
    var combo = o.combo ? o.combo : JSON.parse(JSON.stringify(eff.combo || {}));
    var tMin = rec.targetMin != null ? rec.targetMin : eff.difficultyMin;
    var tMax = rec.targetMax != null ? rec.targetMax : eff.difficultyMax;
    var gm = gradeMargin((tMin + tMax) / 2);
    var TOL = 4;   // 与生成器一致：难度命中向下严格、向上+4
    if (rec.difficulty < tMin) nudgeHarder(combo);               // 太易(不够难) → 加障碍数量
    else if (rec.difficulty > tMax + TOL) nudgeEasier(combo);    // 太难(超出+4) → 减障碍数量
    else {                                                        // 难度命中([lo,hi+4])、仅容错不符
      var mLo = rec.marginRange ? rec.marginRange[0] : gm[0];
      if (rec.margin < mLo) nudgeHarder(combo);                   // 余量太紧(撑不住高余量难度) → 加障碍数量
      else nudgeEasier(combo);                                    // 余量太松 → 减障碍数量
    }
    o.combo = combo;
    o.marginMin = gm[0]; o.marginMax = gm[1];                     // 余量对齐目标等级容错
  }
  // 一键重生成：mode='unqualified' 仅不合格关(自动调参)；'full' 全量(不合格关也自动调参，合格关重random)
  function batchRegen(mode) {
    if (!gen.results.length) return;
    var gl = genReadGlobals();
    var targets = (mode === 'full')
      ? gen.results.map(function (r) { return r.levelNo; })
      : gen.results.filter(function (r) { return !r.hit; }).map(function (r) { return r.levelNo; });
    if (!targets.length) { dom.genProgress.textContent = '没有需要重生成的关卡（全部合格）'; return; }
    dom.genRunBtn.disabled = true; dom.genZipBtn.disabled = true; if (dom.genImportLib) dom.genImportLib.disabled = true;
    function recOf(no) { for (var k = 0; k < gen.results.length; k++) if (gen.results[k].levelNo === no) return gen.results[k]; return null; }
    var i = 0;
    function step() {
      if (i >= targets.length) return done();
      var no = targets[i], rec = recOf(no);
      if (rec && !rec.hit) autoFixUnqualified(no, rec);       // 不合格 → 自动调参
      dom.genProgress.textContent = '一键重生成中… ' + (i + 1) + '/' + targets.length + '（第' + no + '关）';
      setTimeout(function () {
        var params = genParamForLevel(no, gl);
        if (params) {
          try {
            var res = SS.Generator.generateOne(params);
            if (res.rec) {
              finalizeGenRec(res.rec, res, no, params, gl.batch);
              var idx = -1; for (var k = 0; k < gen.results.length; k++) if (gen.results[k].levelNo === no) { idx = k; break; }
              if (idx >= 0) gen.results[idx] = res.rec; else gen.results.push(res.rec);
            }
          } catch (e) { /* 单关异常 → 跳过，不中断一键重生成 */ }
        }
        i++; setTimeout(step, 0);
      }, 0);
    }
    function done() {
      gen.results.sort(function (a, b) { return a.levelNo - b.levelNo; });
      dom.genRunBtn.disabled = false; dom.genZipBtn.disabled = gen.results.length === 0; if (dom.genImportLib) dom.genImportLib.disabled = false;
      var hitN = gen.results.filter(function (r) { return r.hit; }).length;
      renderGenTable();
      drawDifficultyChart(dom.genChart, gen.results.map(function (r) { return { name: 'L' + r.levelNo, score: r.difficulty, level: r.level }; }), 'micro');
      dom.genProgress.textContent = '一键重生成完成：合格 ' + hitN + '/' + gen.results.length +
        (hitN < gen.results.length ? '（仍有不合格，可再点一键重生成或手动调参）' : ' ✓ 全部合格');
    }
    step();
  }

  function renderGenTable() {
    var h = ['关卡', '尺寸', '颜色', '障碍', '最优', '平均', '成功率', '上限', '容错', '难度', '等级', '命中阈值', '操作'];
    var html = '<table class="batch-table"><thead><tr>' + h.map(function (x) { return '<th>' + x + '</th>'; }).join('') + '</tr></thead><tbody>';
    gen.results.forEach(function (r) {
      var warn;
      if (r.hit) warn = '✓';
      else {
        var diffOff = (r.targetMin != null) && (r.difficulty < r.targetMin || r.difficulty > r.targetMax + 4);
        if (diffOff) warn = '⚠ 难度未达' + (r.targetMin != null ? (' ' + r.targetMin + '-' + r.targetMax) : '');
        else if (r.marginRange) warn = '⚠ 容错' + r.margin + '步(应' + r.marginRange[0] + '-' + r.marginRange[1] + ')';
        else warn = '⚠ 不合格';
      }
      // 生成警告(问号/捆绑未完全按规律、列同色过多、炸弹数量减少等) → ⚠️ 提示人工检查
      if (r.warnings && r.warnings.length) {
        warn += ' <span title="' + r.warnings.join('；').replace(/"/g, '') + '" style="color:#ffb84d;">⚠️</span>';
      }
      html += '<tr class="grade-' + r.level + '"' + (r.hit ? '' : ' style="color:#ff7a7a;"') + '>' + [
        '第' + r.levelNo + '关', r.sizeK + '×' + r.sizeH, r.colorKinds,
        SS.Analysis.obstacleNamesCN(r.obs), r.best, r.avg != null ? r.avg.toFixed(1) : '-',
        (r.successRate * 100).toFixed(0) + '%', r.stepCount, (r.stepCount - r.best),
        r.difficulty, r.level, warn,
        '<button class="tool-btn gen-regen-btn" data-lv="' + r.levelNo + '" title="用该关当前参数(可先在上方逐关设置修改)重新生成并更新本行">🔄重生成</button>'
      ].map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>';
    });
    html += '</tbody></table>';
    var unq = gen.results.filter(function (r) { return !r.hit; }).length;
    var mode = gen._regenMode || 'unqualified';
    var ctrl = '<div style="margin-bottom:6px; display:flex; gap:8px; align-items:center; flex-wrap:wrap;">' +
      '<button class="tool-btn" id="genBatchRegenBtn">🔧 一键重生成</button>' +
      '<select id="genBatchRegenMode">' +
      '<option value="unqualified"' + (mode === 'unqualified' ? ' selected' : '') + '>仅不合格关 (' + unq + ')</option>' +
      '<option value="full"' + (mode === 'full' ? ' selected' : '') + '>全量重生成 (' + gen.results.length + ')</option>' +
      '</select>' +
      '<span class="hint">不合格关自动调参：难度不达→增/减障碍；容错不符→对齐该难度等级容错(简单13-20/普通9-12/困难5-8/极难1-4步)</span></div>';
    dom.genTableWrap.innerHTML = ctrl + html;
    // 绑定单关重生成按钮
    var btns = dom.genTableWrap.querySelectorAll('.gen-regen-btn');
    for (var i = 0; i < btns.length; i++) {
      (function (b) { b.addEventListener('click', function () { regenerateLevel(parseInt(b.getAttribute('data-lv'), 10)); }); })(btns[i]);
    }
    // 绑定一键重生成
    var modeSel = document.getElementById('genBatchRegenMode');
    if (modeSel) modeSel.addEventListener('change', function () { gen._regenMode = modeSel.value; });
    var fixBtn = document.getElementById('genBatchRegenBtn');
    if (fixBtn) fixBtn.addEventListener('click', function () { batchRegen(modeSel ? modeSel.value : 'unqualified'); });
  }

  function downloadGenZip() {
    if (!gen.results.length) return;
    var batch = dom.genBatch.value || batchDateStr();
    var diffs = gen.results.map(function (r) { return r.difficulty; });
    var dlo = Math.min.apply(null, diffs), dhi = Math.max.apply(null, diffs);
    var folder = batch + '_' + gen.results.length + '关_难度' + dlo + '-' + dhi;
    var files = [];
    gen.results.forEach(function (r) {
      files.push({ name: folder + '/合格关卡/' + r.fileName, text: JSON.stringify(r.raw, null, 2) });
    });
    // 批量分析报告 CSV
    var notes = SS.Analysis.FIELD_NOTES;
    var lines = ['\uFEFF【字段说明】'];
    Object.keys(notes).forEach(function (k) { lines.push(k + ',' + notes[k].replace(/,/g, '，')); });
    lines.push(''); lines.push('【生成关卡分析报告】');
    lines.push(['关卡', '尺寸', '颜色种类', '障碍', '最优步数', '平均步数', '成功率', '步数上限', '容错', '难度分', '难度等级', '命中阈值'].join(','));
    gen.results.forEach(function (r) {
      lines.push(['第' + r.levelNo + '关', r.sizeK + '×' + r.sizeH, r.colorKinds, SS.Analysis.obstacleNamesCN(r.obs),
        r.best, r.avg != null ? r.avg.toFixed(1) : '-', (r.successRate * 100).toFixed(0) + '%', r.stepCount,
        (r.stepCount - r.best), r.difficulty, r.level, r.hit ? '命中' : '最接近'].join(','));
    });
    files.push({ name: folder + '/批量分析报告.csv', text: lines.join('\n') });
    downloadBlob(SS.Zip.create(files), folder + '.zip');
  }

  // 通用难度折线图（mode: micro 逐关 / g10 / g20 宏观聚合）
  function drawDifficultyChart(cv, rawData, mode) {
    mode = mode || 'micro';
    var ctx = cv.getContext('2d');
    var W = cv.width, H = cv.height, padL = 44, padR = 16, padT = 24, padB = 56;
    ctx.fillStyle = '#1b1f2a'; ctx.fillRect(0, 0, W, H);
    var data, title;
    if (mode === 'g10' || mode === 'g20') {
      data = aggregateCurve(rawData || [], mode === 'g10' ? 10 : 20);
      title = '生成结果难度曲线 · 宏观 ' + (mode === 'g10' ? 10 : 20) + ' 组（每组平均难度）';
    } else {
      data = rawData || [];
      title = '生成结果难度曲线 · 微观逐关（' + data.length + ' 关）';
    }
    if (!data.length) return;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    ctx.strokeStyle = '#3a4258'; ctx.fillStyle = '#9aa3b5'; ctx.font = '11px sans-serif';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (var g = 0; g <= 100; g += 20) {
      var y = padT + plotH * (1 - g / 100);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
      ctx.fillText(String(g), padL - 6, y);
    }
    [[30, '#3ddc84'], [60, '#ffcc4d'], [80, '#ff7a4d']].forEach(function (b) {
      var y = padT + plotH * (1 - b[0] / 100);
      ctx.strokeStyle = b[1] + '55'; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke(); ctx.setLineDash([]);
    });
    var n = data.length;
    function px(i) { return padL + (n === 1 ? plotW / 2 : plotW * i / (n - 1)); }
    function py(s) { return padT + plotH * (1 - s / 100); }
    ctx.strokeStyle = '#4cc2ff'; ctx.lineWidth = 2; ctx.beginPath();
    data.forEach(function (d, i) { var x = px(i), y = py(d.score); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
    ctx.stroke();
    var gc = { '简单': '#3ddc84', '普通': '#ffcc4d', '困难': '#ff9f4d', '极难': '#ff5a4d' };
    var ptR = (mode === 'micro') ? 2.6 : 4.5;
    data.forEach(function (d, i) { ctx.fillStyle = gc[d.level] || '#4cc2ff'; ctx.beginPath(); ctx.arc(px(i), py(d.score), ptR, 0, Math.PI * 2); ctx.fill(); });
    if (mode !== 'micro') {
      ctx.fillStyle = '#e8ebf2'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      data.forEach(function (d, i) { ctx.fillText(Math.round(d.score), px(i), py(d.score) - 6); });
    }
    ctx.fillStyle = '#9aa3b5'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    var stepLbl = Math.max(1, Math.ceil(n / 20));
    data.forEach(function (d, i) { if (i % stepLbl === 0 || i === n - 1) { ctx.save(); ctx.translate(px(i), H - padB + 6); ctx.rotate(-Math.PI / 4); ctx.textAlign = 'right'; ctx.fillText(d.name, 0, 0); ctx.restore(); } });
    ctx.fillStyle = '#e8ebf2'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(title, padL, 4);
  }

  function showError(msg) {
    dom.banner.className = 'banner lose';
    dom.banner.textContent = msg;
  }

  document.addEventListener('DOMContentLoaded', init);
})();
