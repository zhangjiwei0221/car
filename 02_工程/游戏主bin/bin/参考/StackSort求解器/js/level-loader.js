/**
 * StackSort 求解器 - 关卡加载与解析
 *
 * 把原始关卡 JSON 解析成简洁的内部棋盘模型，供界面渲染与求解器使用。
 *
 * 内部模型（normalized）:
 * {
 *   id, name, difficulty, stepCount,
 *   boards: [ Board, ... ]   // 一般 1 个；嵌套/分段关卡可能多个
 * }
 *
 * Board:
 * {
 *   rowCount,                // 列高 H
 *   colCount,               // 列数 K
 *   bench: Cell,            // 暂存区初始卡
 *   columns: [ Column ],
 *   columnFeatures: [ [..], ... ]  // 每列的列级障碍（Ice / StoneWall ...）
 * }
 *
 * Column: { tiles: [ Cell ] }   // index 0 = 顶部, 末尾 = 底部（与 JSON 一致）
 *
 * Cell:
 * {
 *   kind: 'color' | 'rainbow',
 *   colorKey: 'colorId_shade' | null,   // rainbow 时为 null
 *   features: ['Surprise', ...]          // 卡片级特性
 * }
 */
var SS = SS || {};

SS.LevelLoader = (function () {

  function parseCell(tile) {
    if (!tile || !tile.layers || !tile.layers.length) {
      return { kind: 'empty', colorKey: null, features: [] };
    }
    var layer = tile.layers[0];
    var features = (tile.features || []).map(function (f) { return f.type; });

    // 炸弹(Bomb)：附在卡片上，endCondition.stepCount = 倒计时步数。保留数值（features 只存类型字符串会丢失）。
    // timing：'afterReveal'=隐藏列独立计时(揭示后才倒数)；缺省/'global'=全局共享步数(开局即倒数)。
    var bomb = null, bombTiming = null;
    (tile.features || []).forEach(function (f) {
      if (f.type === 'Bomb' && f.endCondition && typeof f.endCondition.stepCount === 'number') {
        bomb = f.endCondition.stepCount;
        bombTiming = (f.timing === 'afterReveal') ? 'afterReveal' : 'global';
      }
    });

    // 双色块(Intertwined/DualColor)：tile.layers 有两层。
    // layers[0]=底层(当前生效色，先完成)，layers[1]=顶层(隐藏杂色，转换后揭示)。
    if (tile.layers.length > 1) {
      var b = tile.layers[0], t = tile.layers[1];
      var bKey = (b.type === 'BasicColorTile' && b.color) ? SS.Colors.colorKey(b.color.colorId, b.color.shadeIndex) : null;
      var tKey = (t.type === 'BasicColorTile' && t.color) ? SS.Colors.colorKey(t.color.colorId, t.color.shadeIndex) : null;
      return { kind: 'dual', colorKey: bKey, topColorKey: tKey, features: features, bomb: bomb, bombTiming: bombTiming };
    }

    if (layer.type === 'RainbowTile') {
      return { kind: 'rainbow', colorKey: null, features: features, bomb: bomb, bombTiming: bombTiming };
    }
    if (layer.type === 'BasicColorTile' && layer.color) {
      var key = SS.Colors.colorKey(layer.color.colorId, layer.color.shadeIndex);
      return { kind: 'color', colorKey: key, features: features, bomb: bomb, bombTiming: bombTiming };
    }
    // 其它未知类型，暂作占位
    return { kind: 'other', colorKey: null, features: features, raw: layer.type, bomb: bomb, bombTiming: bombTiming };
  }

  function parseBoard(rawBoard) {
    var grid = rawBoard.grids && rawBoard.grids[0];
    if (!grid) return null;

    var rowCount = grid.rowCount || 0;
    var columns = [];
    var columnFeatures = [];

    (grid.columns || []).forEach(function (col) {
      var layer = col.layers && col.layers[0];
      var tiles = (layer && layer.tiles) || [];
      columns.push({ tiles: tiles.map(parseCell) });
      var cf = (layer && layer.columnFeatures) || [];
      columnFeatures.push(cf.map(function (f) {
        var o = { type: f.type, durability: f.durability };
        if (f.type === 'FixedColor' && f.acceptedColor) {
          o.acceptedColorId = f.acceptedColor.colorId;
          o.acceptedShade = f.acceptedColor.shadeIndex || 0;
          o.acceptedColor = SS.Colors.colorKey(f.acceptedColor.colorId, f.acceptedColor.shadeIndex);
        }
        // 保护列(CoveredColor)：requiredColor = 必须先完成一列该色才解锁本列
        if (f.type === 'CoveredColor') {
          var rc = f.requiredColor || f.color;
          if (rc) {
            o.requiredColorId = rc.colorId;
            o.requiredShade = rc.shadeIndex || 0;
            o.requiredColor = SS.Colors.colorKey(rc.colorId, rc.shadeIndex);
          }
        }
        return o;
      }));
    });

    // 校准限定列接受色到棋盘真实颜色：
    //   - 若 accepted 的 (id,shade) 在棋盘存在 → 保留精确匹配；
    //   - 若 shade 对不上、但该 colorId 在棋盘只有一种 shade → 重映射到那一种（修正"画布canonical shade"）；
    //   - 该 colorId 有多种 shade（同 id 多色）→ 保持原样（按 shade 精确区分，如 L38）。
    var idShades = {}; // colorId -> {shade: true}
    columns.forEach(function (col) {
      col.tiles.forEach(function (t) {
        if (t.kind === 'color' && t.colorKey) {
          var parts = t.colorKey.split('_');
          var id = parts[0], sh = parts[1];
          (idShades[id] = idShades[id] || {})[sh] = true;
        }
      });
    });
    columnFeatures.forEach(function (cfList) {
      cfList.forEach(function (f) {
        if (f.type === 'FixedColor' && f.acceptedColorId != null) {
          calibrate(f, 'acceptedColorId', 'acceptedShade', 'acceptedColor');
        }
        if (f.type === 'CoveredColor' && f.requiredColorId != null) {
          calibrate(f, 'requiredColorId', 'requiredShade', 'requiredColor');
        }
      });
    });
    function calibrate(f, idKey, shadeKey, colorKey) {
      var id = String(f[idKey]);
      var shadesOnBoard = idShades[id] ? Object.keys(idShades[id]) : [];
      if (shadesOnBoard.indexOf(String(f[shadeKey])) !== -1) return; // 精确存在，保留
      if (shadesOnBoard.length === 1) {
        f[colorKey] = id + '_' + shadesOnBoard[0];                   // 唯一 shade → 重映射
      }
      // 多 shade 或无 → 保持原样
    }

    return {
      rowCount: rowCount,
      colCount: columns.length,
      bench: parseCell(rawBoard.benchInitialTile),
      columns: columns,
      columnFeatures: columnFeatures,
      links: parseLinks(grid)
    };
  }

  // 解析 grid 级捆绑特性 LinkedCards：{rowIndex, firstColumnIndex, secondColumnIndex}
  function parseLinks(grid) {
    var links = [];
    var feats = grid.features || [];
    for (var i = 0; i < feats.length; i++) {
      if (feats[i].type === 'LinkedCards') {
        links.push({
          rowIndex: feats[i].rowIndex,
          col1: feats[i].firstColumnIndex,
          col2: feats[i].secondColumnIndex
        });
      }
    }
    return links;
  }

  /**
   * 解析完整关卡 JSON
   */
  function parse(json) {
    var data = json.data || json;
    var step = 0;
    if (data.endConditions && data.endConditions.length) {
      var sc = data.endConditions.find(function (e) { return e.type === 'StepCount'; });
      if (sc) step = sc.stepCount;
    }
    var boards = (data.boards || []).map(parseBoard).filter(Boolean);
    return {
      id: data.id,
      name: data.name,
      difficulty: data.difficulty,
      stepCount: step,
      boards: boards
    };
  }

  /**
   * 收集关卡中出现的所有 colorKey（用于图例/统计）
   */
  function collectColorKeys(level) {
    var set = {};
    level.boards.forEach(function (b) {
      if (b.bench && b.bench.colorKey) set[b.bench.colorKey] = true;
      b.columns.forEach(function (col) {
        col.tiles.forEach(function (t) {
          if (t.colorKey) set[t.colorKey] = true;
        });
      });
    });
    return Object.keys(set);
  }

  return {
    parse: parse,
    collectColorKeys: collectColorKeys
  };
})();
