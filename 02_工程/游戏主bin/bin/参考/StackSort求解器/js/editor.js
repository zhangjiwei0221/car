/**
 * StackSort 求解器 - 关卡编辑器（纯逻辑，无 DOM）
 *
 * 核心原则：所有编辑都作用在原始 JSON 的【深拷贝副本】editRaw 上，
 * 绝不触碰源文件；导出即把 editRaw 序列化（原 schema + 改动，保证合法）。
 * 不导出不落盘——副本仅存内存，离开/丢弃即消失。
 *
 * 支持：替换颜色、交换卡片位置、增删障碍、撤回（快照栈）。
 */
var SS = SS || {};

SS.Editor = (function () {

  var st = { editRaw: null, boardIdx: 0, undo: [], baseName: '' };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function dataOf(raw) { return raw.data || raw; }
  function board() { return dataOf(st.editRaw).boards[st.boardIdx]; }
  function grid() { return board().grids[0]; }
  function cols() { return grid().columns; }
  function tilesOf(c) { return cols()[c].layers[0].tiles; }
  function colFeatures(c) {
    var layer = cols()[c].layers[0];
    if (!layer.columnFeatures) layer.columnFeatures = [];
    return layer.columnFeatures;
  }
  // c=-1 → 暂存区卡片
  function tileAt(c, r) { return c === -1 ? board().benchInitialTile : tilesOf(c)[r]; }
  function setTileAt(c, r, tile) { if (c === -1) board().benchInitialTile = tile; else tilesOf(c)[r] = tile; }

  function colorKeyOfTile(tile) {
    if (!tile || !tile.layers) return null;
    for (var i = 0; i < tile.layers.length; i++) {
      var c = tile.layers[i].color;
      if (tile.layers[i].type === 'BasicColorTile' && c) return c.colorId + '_' + (c.shadeIndex || 0);
    }
    return null;
  }

  // ---- 生命周期 ----
  function begin(raw, boardIdx, baseName) {
    st.editRaw = clone(raw);
    st.boardIdx = boardIdx || 0;
    st.undo = [];
    st.baseName = baseName || (dataOf(st.editRaw).name) || 'level';
    return st.editRaw;
  }
  function active() { return !!st.editRaw; }
  function discard() { st.editRaw = null; st.undo = []; }
  function getRaw() { return st.editRaw; }
  function snapshot() { if (st.editRaw) st.undo.push(JSON.stringify(st.editRaw)); if (st.undo.length > 100) st.undo.shift(); }
  function canUndo() { return st.undo.length > 0; }
  function undo() { if (st.undo.length) { st.editRaw = JSON.parse(st.undo.pop()); return true; } return false; }

  // ---- 编辑操作（调用前请先 snapshot()）----

  // 1) 一键替换颜色：把全盘 fromKey 颜色改成 (toId,toShade)
  function replaceColor(fromKey, toId, toShade) {
    function apply(tile) {
      if (!tile || !tile.layers) return;
      tile.layers.forEach(function (ly) {
        if (ly.type === 'BasicColorTile' && ly.color) {
          var k = ly.color.colorId + '_' + (ly.color.shadeIndex || 0);
          if (k === fromKey) { ly.color.colorId = toId; ly.color.shadeIndex = toShade; }
        }
      });
    }
    var cs = cols();
    for (var c = 0; c < cs.length; c++) tilesOf(c).forEach(apply);
    apply(board().benchInitialTile);
  }

  // 2) 交换两张卡片位置（含暂存区，c=-1）
  function swap(a, b) {
    var ta = tileAt(a.c, a.r), tb = tileAt(b.c, b.r);
    setTileAt(a.c, a.r, tb); setTileAt(b.c, b.r, ta);
  }

  // 1b) 只替换某一列的某色（用于一色占多列时只改一列）
  function replaceColorInColumn(c, fromKey, toId, toShade) {
    tilesOf(c).forEach(function (tile) {
      if (!tile || !tile.layers) return;
      tile.layers.forEach(function (ly) {
        if (ly.type === 'BasicColorTile' && ly.color) {
          var k = ly.color.colorId + '_' + (ly.color.shadeIndex || 0);
          if (k === fromKey) { ly.color.colorId = toId; ly.color.shadeIndex = toShade; }
        }
      });
    });
  }

  // ---- 行列结构编辑 ----
  function mkColorTile(id, sh) {
    return { layers: [{ type: 'BasicColorTile', color: { colorId: id, shadeIndex: sh || 0 } }], features: [] };
  }
  // 按比例缩放步数上限（格子数变化时同步，保持容错率，避免改尺寸后解不完）
  function scaleStepLimit(factor) {
    var cur = getStepLimit();
    if (cur > 0) setStepLimit(Math.max(1, Math.round(cur * factor)));
  }
  function boardColorCounts() {
    var cnt = {};
    cols().forEach(function (col) {
      col.layers[0].tiles.forEach(function (t) {
        var k = colorKeyOfTile(t);
        if (k) cnt[k] = (cnt[k] || 0) + 1;
      });
    });
    return cnt;
  }
  // 添加一行：每列+1格，用"已有颜色"按列占比补齐（保持每色=新行高整数倍），随机插入位置
  function addRow() {
    var g = grid();
    var H = g.rowCount || (cols()[0] ? cols()[0].layers[0].tiles.length : 0);
    var cnt = boardColorCounts();
    // 构造要新增的颜色多重集：每色新增"其占用列数"个 = Σ = 列数 K
    var addList = [];
    Object.keys(cnt).forEach(function (k) {
      var nCols = Math.max(1, Math.round(cnt[k] / H));
      for (var i = 0; i < nCols; i++) addList.push(k);
    });
    // 洗牌
    for (var i = addList.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = addList[i]; addList[i] = addList[j]; addList[j] = tmp;
    }
    var K = cols().length;
    for (var c = 0; c < K; c++) {
      var key = addList[c] || Object.keys(cnt)[0] || '0_0';
      var parts = key.split('_');
      var tiles = tilesOf(c);
      var pos = Math.floor(Math.random() * (tiles.length + 1));
      tiles.splice(pos, 0, mkColorTile(parseInt(parts[0], 10), parseInt(parts[1], 10) || 0));
    }
    g.rowCount = H + 1;
    scaleStepLimit((H + 1) / H);   // 格子变多 → 步数上限同比例增加
  }
  // 删除一行：每列去掉顶部一格
  function removeRow() {
    var g = grid();
    var H = g.rowCount;
    if (H <= 1) return;
    cols().forEach(function (col) { col.layers[0].tiles.shift(); });
    g.rowCount = H - 1;
    scaleStepLimit((H - 1) / H);
  }
  // 添加一列：生成一个"没有用过的颜色"，整列同色（已排序），列高=当前行高
  function addColumn() {
    var g = grid();
    var H = g.rowCount;
    var K = cols().length;
    var used = {};
    cols().forEach(function (col) { col.layers[0].tiles.forEach(function (t) { var k = colorKeyOfTile(t); if (k) used[k.split('_')[0]] = 1; }); });
    var nid = 0; while (used[nid]) nid++;
    var tiles = [];
    for (var r = 0; r < H; r++) tiles.push(mkColorTile(nid, 0));
    cols().push({ layers: [{ tiles: tiles, columnFeatures: [] }] });
    scaleStepLimit((K + 1) / K);
  }
  // 删除最后一列
  function removeColumn() {
    var K = cols().length;
    if (K <= 1) return;
    cols().pop();
    scaleStepLimit((K - 1) / K);
  }

  // 3) 增删障碍
  function hasCellFeature(tile, name) {
    return !!(tile.features && tile.features.some(function (f) { return f.type === name; }));
  }
  function addCellFeature(c, r, name, opts) {
    var tile = tileAt(c, r);
    if (!tile.features) tile.features = [];
    if (hasCellFeature(tile, name)) return;
    var feat = { type: name };
    if (name === 'Bomb') feat.endCondition = { type: 'StepCount', stepCount: (opts && opts.stepCount) || 20 };
    tile.features.push(feat);
  }
  function removeCellFeature(c, r, name) {
    var tile = tileAt(c, r);
    if (tile.features) tile.features = tile.features.filter(function (f) { return f.type !== name; });
  }
  function addColumnFeature(c, type, opts) {
    var cf = colFeatures(c);
    if (cf.some(function (f) { return f.type === type; })) return;
    var feat = { type: type };
    if (type === 'Ice') feat.durability = (opts && opts.durability) || 1;
    if (type === 'FixedColor') feat.acceptedColor = { colorId: (opts && opts.colorId) || 0, shadeIndex: (opts && opts.shadeIndex) || 0 };
    if (type === 'CoveredColor') feat.requiredColor = { colorId: (opts && opts.colorId) || 0, shadeIndex: (opts && opts.shadeIndex) || 0 };
    cf.push(feat);
  }
  function removeColumnFeature(c, type) {
    var layer = cols()[c].layers[0];
    if (layer.columnFeatures) layer.columnFeatures = layer.columnFeatures.filter(function (f) { return f.type !== type; });
  }

  // 列上现有障碍类型
  function columnObstacles(c) {
    var out = [];
    (cols()[c].layers[0].columnFeatures || []).forEach(function (f) { out.push(f.type); });
    return out;
  }
  // 卡片上现有特性类型
  function cellFeatures(c, r) {
    var tile = tileAt(c, r);
    return (tile.features || []).map(function (f) { return f.type; });
  }

  // 导出文件名（基于原名 + 后缀）
  function exportName(suffix) {
    return (st.baseName || 'level') + (suffix || '_edited') + '.json';
  }

  // 修改步数上限（endConditions 里的 StepCount）
  function setStepLimit(n) {
    var d = dataOf(st.editRaw);
    if (!d.endConditions) d.endConditions = [];
    var sc = d.endConditions.find(function (e) { return e.type === 'StepCount'; });
    if (sc) sc.stepCount = n;
    else d.endConditions.push({ type: 'StepCount', stepCount: n });
  }
  function getStepLimit() {
    var d = dataOf(st.editRaw);
    var sc = (d.endConditions || []).find(function (e) { return e.type === 'StepCount'; });
    return sc ? sc.stepCount : 0;
  }

  return {
    begin: begin, active: active, discard: discard, getRaw: getRaw,
    snapshot: snapshot, canUndo: canUndo, undo: undo,
    replaceColor: replaceColor, replaceColorInColumn: replaceColorInColumn, swap: swap,
    addRow: addRow, removeRow: removeRow, addColumn: addColumn, removeColumn: removeColumn,
    addCellFeature: addCellFeature, removeCellFeature: removeCellFeature,
    addColumnFeature: addColumnFeature, removeColumnFeature: removeColumnFeature,
    columnObstacles: columnObstacles, cellFeatures: cellFeatures,
    colorKeyOfTile: colorKeyOfTile, tileAt: tileAt, exportName: exportName,
    setStepLimit: setStepLimit, getStepLimit: getStepLimit,
    setBoardIdx: function (i) { st.boardIdx = i; }
  };
})();
