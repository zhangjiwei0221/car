(function(root) {
  'use strict';

  var PIPE_TYPES = { 11: true, 12: true, 13: true, 14: true };
  var LINK_TYPE = 5;
  var ORTHOGONAL_DIRECTIONS = [
    { dr: -1, dc: 0 },
    { dr: 1, dc: 0 },
    { dr: 0, dc: -1 },
    { dr: 0, dc: 1 }
  ];

  function isArray(value) {
    return Array.isArray(value);
  }

  function typeList(type) {
    if (isArray(type)) return type.slice();
    if (type === 0 || type === undefined || type === null) return [];
    return [type];
  }

  function hasType(type, targetType) {
    var list = typeList(type);
    for (var i = 0; i < list.length; i++) {
      if (list[i] === targetType) return true;
    }
    return false;
  }

  function hasPipe(type) {
    var list = typeList(type);
    for (var i = 0; i < list.length; i++) {
      if (PIPE_TYPES[list[i]]) return true;
    }
    return false;
  }

  function formatType(type) {
    return isArray(type) ? '[' + type.join(',') + ']' : String(type);
  }

  function formatCell(pos, cell) {
    return '数组坐标 row=' + pos.row + ', col=' + pos.col +
      '；表格坐标 第' + (pos.row + 1) + '行 第' + (pos.col + 1) + '列' +
      '；id=' + cell.id + '；type=' + formatType(cell.type);
  }

  function classifyCell(cell) {
    if (cell.id === -1) return 'dead';
    if (hasPipe(cell.type)) return 'dead';
    if (cell.id === 0 && cell.type === 0) return 'empty';
    if (cell.id === 0) return 'invalid';
    if (hasType(cell.type, LINK_TYPE)) return 'link';
    return 'normal';
  }

  function cloneSpools(spools) {
    return spools.map(function(row) {
      return row.map(function(cell) {
        return {
          id: cell.id,
          type: isArray(cell.type) ? cell.type.slice() : cell.type,
          param: isArray(cell.param) ? cell.param.slice() : cell.param
        };
      });
    });
  }

  function LevelActivityValidator(levelData) {
    this.levelData = levelData;
    this.spools = [];
    this.rows = 0;
    this.cols = 0;
    this.classMap = [];
    this.activeMap = [];
    this.failures = [];
    this.warnings = [];
    this.linkPairs = [];
    this.linkPairByKey = {};
    this.linkEndpointActive = {};
  }

  LevelActivityValidator.prototype.validate = function() {
    var dataResult = this._validateAndLoadData();
    if (!dataResult.success) return dataResult;

    this._buildClassMap();
    var invalidCells = this._collectInvalidCells();
    if (invalidCells.length > 0) {
      return this._result(false, '关卡数据错误：存在无效元素数据', invalidCells);
    }

    var linkResult = this._buildLinkPairs();
    if (!linkResult.success) {
      return this._result(false, '验证失败：链条配对异常', linkResult.failures);
    }

    this._initializeActiveMap();
    this._runFixedPointSearch();

    var blocked = this._collectBlockedElements();
    if (blocked.length > 0) {
      return this._result(false, '验证失败：存在不可活动元素', blocked);
    }

    return this._result(true, '验证通过：全部元素均可活动', []);
  };

  LevelActivityValidator.prototype._result = function(success, message, failures) {
    return {
      success: success,
      message: message,
      failures: failures || [],
      warnings: this.warnings.slice(),
      rows: this.rows,
      cols: this.cols
    };
  };

  LevelActivityValidator.prototype._validateAndLoadData = function() {
    var data = this.levelData;
    if (!data || typeof data !== 'object' || isArray(data)) {
      return this._result(false, '关卡数据错误：JSON 根节点必须是对象', [
        { type: 'invalid_data', message: 'JSON 根节点必须是对象' }
      ]);
    }
    if (!isArray(data.spools)) {
      return this._result(false, '关卡数据错误：缺少 spools 二维数组', [
        { type: 'invalid_data', message: '缺少 spools 二维数组' }
      ]);
    }
    if (typeof data.maprow !== 'number' || typeof data.mapcol !== 'number') {
      return this._result(false, '关卡数据错误：maprow/mapcol 必须是数字', [
        { type: 'invalid_data', message: 'maprow/mapcol 必须是数字' }
      ]);
    }
    if (!Number.isInteger(data.maprow) || !Number.isInteger(data.mapcol) || data.maprow < 0 || data.mapcol < 0) {
      return this._result(false, '关卡数据错误：maprow/mapcol 必须是非负整数', [
        { type: 'invalid_data', message: 'maprow/mapcol 必须是非负整数' }
      ]);
    }
    if (data.spools.length !== data.maprow) {
      return this._result(false, '关卡数据错误：maprow 与 spools 行数不一致', [
        { type: 'invalid_data', message: 'maprow=' + data.maprow + '，spools行数=' + data.spools.length }
      ]);
    }
    if (data.maprow === 0 || data.mapcol === 0) {
      return this._result(false, '关卡数据错误：元素区不能为空', [
        { type: 'invalid_data', message: 'maprow/mapcol 不能为0' }
      ]);
    }

    var failures = [];
    for (var r = 0; r < data.spools.length; r++) {
      var row = data.spools[r];
      if (!isArray(row)) {
        failures.push({ type: 'invalid_data', message: 'spools[' + r + '] 不是数组' });
        continue;
      }
      if (row.length !== data.mapcol) {
        failures.push({ type: 'invalid_data', message: 'spools[' + r + ']长度=' + row.length + '，mapcol=' + data.mapcol });
      }
      for (var c = 0; c < row.length; c++) {
        var cell = row[c];
        var pos = { row: r, col: c };
        if (!cell || typeof cell !== 'object' || isArray(cell)) {
          failures.push({ type: 'invalid_data', pos: pos, cell: { id: 'n/a', type: 'n/a' }, message: '单元格必须是对象' });
          continue;
        }
        if (typeof cell.id !== 'number') {
          failures.push({ type: 'invalid_data', pos: pos, cell: cell, message: 'id 必须是数字' });
        }
        if (typeof cell.type !== 'number' && !isArray(cell.type)) {
          failures.push({ type: 'invalid_data', pos: pos, cell: cell, message: 'type 必须是数字或数组' });
        }
        if (isArray(cell.type)) {
          for (var i = 0; i < cell.type.length; i++) {
            if (typeof cell.type[i] !== 'number') {
              failures.push({ type: 'invalid_data', pos: pos, cell: cell, message: 'type 数组只能包含数字' });
              break;
            }
          }
        }
      }
    }

    if (failures.length > 0) {
      return this._result(false, '关卡数据错误：spools 格式不合法', failures);
    }

    this.spools = cloneSpools(data.spools);
    this.rows = this.spools.length;
    this.cols = this.rows > 0 ? this.spools[0].length : 0;
    return { success: true };
  };

  LevelActivityValidator.prototype._buildClassMap = function() {
    this.classMap = [];
    for (var r = 0; r < this.rows; r++) {
      this.classMap[r] = [];
      for (var c = 0; c < this.cols; c++) {
        this.classMap[r][c] = classifyCell(this.spools[r][c]);
      }
    }
  };

  LevelActivityValidator.prototype._collectInvalidCells = function() {
    var failures = [];
    for (var r = 0; r < this.rows; r++) {
      for (var c = 0; c < this.cols; c++) {
        if (this.classMap[r][c] === 'invalid') {
          failures.push({
            type: 'invalid_data',
            pos: { row: r, col: c },
            cell: this.spools[r][c],
            message: 'id 为0时仅允许 type=0 的空格或管道'
          });
        }
      }
    }
    return failures;
  };

  LevelActivityValidator.prototype._buildLinkPairs = function() {
    var linkKeys = {};
    var failures = [];
    this.linkPairs = [];
    this.linkPairByKey = {};

    for (var r = 0; r < this.rows; r++) {
      for (var c = 0; c < this.cols; c++) {
        if (this.classMap[r][c] === 'link') {
          linkKeys[this._key(r, c)] = { row: r, col: c };
        }
      }
    }

    var visited = {};
    for (var key in linkKeys) {
      if (!Object.prototype.hasOwnProperty.call(linkKeys, key) || visited[key]) continue;
      var pos = linkKeys[key];
      var neighbors = this._linkNeighbors(pos.row, pos.col);
      if (neighbors.length !== 1) {
        failures.push({
          type: 'invalid_link_pair',
          pos: pos,
          cell: this.spools[pos.row][pos.col],
          message: neighbors.length === 0 ? '链条元素没有上下左右相邻伙伴' : '链条元素有多个上下左右相邻伙伴'
        });
        visited[key] = true;
        continue;
      }

      var partner = neighbors[0];
      var partnerKey = this._key(partner.row, partner.col);
      var reverseNeighbors = this._linkNeighbors(partner.row, partner.col);
      if (reverseNeighbors.length !== 1 || this._key(reverseNeighbors[0].row, reverseNeighbors[0].col) !== key) {
        failures.push({
          type: 'invalid_link_pair',
          pos: pos,
          cell: this.spools[pos.row][pos.col],
          message: '链条伙伴关系不唯一'
        });
        visited[key] = true;
        visited[partnerKey] = true;
        continue;
      }

      var pair = {
        a: pos,
        b: partner,
        orientation: pos.row === partner.row ? 'horizontal' : 'vertical'
      };
      var index = this.linkPairs.length;
      this.linkPairs.push(pair);
      this.linkPairByKey[key] = { pairIndex: index, partner: partner };
      this.linkPairByKey[partnerKey] = { pairIndex: index, partner: pos };
      visited[key] = true;
      visited[partnerKey] = true;
    }

    return { success: failures.length === 0, failures: failures };
  };

  LevelActivityValidator.prototype._linkNeighbors = function(row, col) {
    var result = [];
    for (var i = 0; i < ORTHOGONAL_DIRECTIONS.length; i++) {
      var nr = row + ORTHOGONAL_DIRECTIONS[i].dr;
      var nc = col + ORTHOGONAL_DIRECTIONS[i].dc;
      if (this._inBounds(nr, nc) && this.classMap[nr][nc] === 'link') {
        result.push({ row: nr, col: nc });
      }
    }
    return result;
  };

  LevelActivityValidator.prototype._initializeActiveMap = function() {
    this.activeMap = [];
    this.linkEndpointActive = {};
    for (var r = 0; r < this.rows; r++) {
      this.activeMap[r] = [];
      for (var c = 0; c < this.cols; c++) {
        this.activeMap[r][c] = false;
      }
    }
    for (var c = 0; c < this.cols; c++) {
      var cls = this.classMap[0][c];
      if (cls === 'empty' || cls === 'normal') {
        this.activeMap[0][c] = true;
      } else if (cls === 'link') {
        this.linkEndpointActive[this._key(0, c)] = true;
      }
    }
  };

  LevelActivityValidator.prototype._runFixedPointSearch = function() {
    var changed = true;
    while (changed) {
      changed = false;
      if (this._spreadActivePaths()) changed = true;
      if (this._activateLinkPairs()) changed = true;
    }
  };

  LevelActivityValidator.prototype._spreadActivePaths = function() {
    var changed = false;
    var queue = [];
    for (var r = 0; r < this.rows; r++) {
      for (var c = 0; c < this.cols; c++) {
        if (this.activeMap[r][c]) queue.push({ row: r, col: c });
      }
    }

    while (queue.length > 0) {
      var current = queue.shift();
      for (var i = 0; i < ORTHOGONAL_DIRECTIONS.length; i++) {
        var nr = current.row + ORTHOGONAL_DIRECTIONS[i].dr;
        var nc = current.col + ORTHOGONAL_DIRECTIONS[i].dc;
        if (!this._inBounds(nr, nc)) continue;
        var cls = this.classMap[nr][nc];
        if (cls === 'dead') continue;
        if (cls === 'empty' || cls === 'normal') {
          if (!this.activeMap[nr][nc]) {
            this.activeMap[nr][nc] = true;
            changed = true;
            queue.push({ row: nr, col: nc });
          }
        } else if (cls === 'link') {
          var key = this._key(nr, nc);
          if (this._canLinkEndpointUseSource(nr, nc, current.row, current.col) && !this.linkEndpointActive[key]) {
            this.linkEndpointActive[key] = true;
            changed = true;
          }
        }
      }
    }

    return changed;
  };

  LevelActivityValidator.prototype._activateLinkPairs = function() {
    var changed = false;
    for (var i = 0; i < this.linkPairs.length; i++) {
      var pair = this.linkPairs[i];
      var aKey = this._key(pair.a.row, pair.a.col);
      var bKey = this._key(pair.b.row, pair.b.col);
      if (this.activeMap[pair.a.row][pair.a.col] && this.activeMap[pair.b.row][pair.b.col]) continue;
      if (this.linkEndpointActive[aKey] && this.linkEndpointActive[bKey]) {
        this.activeMap[pair.a.row][pair.a.col] = true;
        this.activeMap[pair.b.row][pair.b.col] = true;
        changed = true;
      }
    }
    return changed;
  };

  LevelActivityValidator.prototype._canLinkEndpointUseSource = function(linkRow, linkCol, sourceRow, sourceCol) {
    if (linkRow === 0) return true;
    var info = this.linkPairByKey[this._key(linkRow, linkCol)];
    if (!info) return false;
    return !(info.partner.row === sourceRow && info.partner.col === sourceCol);
  };

  LevelActivityValidator.prototype._collectBlockedElements = function() {
    var failures = [];
    for (var r = 0; r < this.rows; r++) {
      for (var c = 0; c < this.cols; c++) {
        var cls = this.classMap[r][c];
        if ((cls === 'normal' || cls === 'link') && !this.activeMap[r][c]) {
          failures.push({
            type: 'blocked',
            pos: { row: r, col: c },
            cell: this.spools[r][c],
            message: '元素无法连通到第一行活路'
          });
        }
      }
    }
    return failures;
  };

  LevelActivityValidator.prototype._key = function(row, col) {
    return row + ',' + col;
  };

  LevelActivityValidator.prototype._inBounds = function(row, col) {
    return row >= 0 && row < this.rows && col >= 0 && col < this.cols;
  };

  function formatResult(fileName, result) {
    var lines = [];
    if (fileName) lines.push('文件：' + fileName);
    lines.push(result.message);
    if (result.rows && result.cols) lines.push('元素区尺寸：' + result.rows + ' 行 × ' + result.cols + ' 列');

    if (result.warnings && result.warnings.length > 0) {
      lines.push('');
      lines.push('提示：');
      for (var w = 0; w < result.warnings.length; w++) {
        lines.push('- ' + result.warnings[w]);
      }
    }

    if (result.failures && result.failures.length > 0) {
      lines.push('');
      lines.push('失败明细：' + result.failures.length + ' 项');
      for (var i = 0; i < result.failures.length; i++) {
        var failure = result.failures[i];
        lines.push('');
        lines.push((i + 1) + '. ' + failure.type);
        if (failure.pos && failure.cell) {
          lines.push('   ' + formatCell(failure.pos, failure.cell));
        }
        if (failure.message) {
          lines.push('   原因：' + failure.message);
        }
      }
    }

    return lines.join('\n');
  }

  function parseJSON(content) {
    if (!content || content.trim() === '') {
      throw new Error('文件为空');
    }
    return JSON.parse(content);
  }

  function App() {
    this.levelData = null;
    this.fileName = '';
    this.loadButton = null;
    this.validateButton = null;
    this.fileInput = null;
    this.fileNameLabel = null;
    this.resultOutput = null;
  }

  App.prototype.init = function() {
    this.loadButton = document.getElementById('loadLevelBtn');
    this.validateButton = document.getElementById('validateBtn');
    this.fileInput = document.getElementById('levelFileInput');
    this.fileNameLabel = document.getElementById('fileNameLabel');
    this.resultOutput = document.getElementById('resultOutput');
    this._bindEvents();
  };

  App.prototype._bindEvents = function() {
    var self = this;
    if (this.loadButton && this.fileInput) {
      this.loadButton.addEventListener('click', function() {
        self.fileInput.click();
      });
      this.fileInput.addEventListener('change', function(event) {
        self._handleFileSelect(event);
      });
    }
    if (this.validateButton) {
      this.validateButton.addEventListener('click', function() {
        self._handleValidate();
      });
    }
  };

  App.prototype._handleFileSelect = function(event) {
    var self = this;
    var file = event.target.files && event.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(e) {
      try {
        self.levelData = parseJSON(e.target.result);
        self.fileName = file.name;
        self._setFileLabel('已加载：' + file.name);
        self._setOutput('已加载文件：' + file.name + '\n点击“验证元素”开始验证。');
      } catch (error) {
        self.levelData = null;
        self.fileName = '';
        self._setFileLabel('加载失败');
        self._setOutput('文件读取失败：' + error.message);
      }
    };
    reader.onerror = function() {
      self.levelData = null;
      self.fileName = '';
      self._setFileLabel('加载失败');
      self._setOutput('文件读取失败');
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  App.prototype._handleValidate = function() {
    if (!this.levelData) {
      this._setOutput('请先加载关卡 JSON 文件。');
      return;
    }
    var validator = new LevelActivityValidator(this.levelData);
    var result = validator.validate();
    this._setOutput(formatResult(this.fileName, result));
  };

  App.prototype._setFileLabel = function(text) {
    if (this.fileNameLabel) this.fileNameLabel.textContent = text;
  };

  App.prototype._setOutput = function(text) {
    if (this.resultOutput) this.resultOutput.value = text;
  };

  root.LevelActivityValidator = LevelActivityValidator;
  root.formatValidatorResult = formatResult;

  if (typeof document !== 'undefined') {
    var app = new App();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function() {
        app.init();
      });
    } else {
      app.init();
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
