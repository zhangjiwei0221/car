/**
 * 毛线关卡生成工具 - 验证按钮UI集成 + 验证记录显示
 */

var YarnLevel = YarnLevel || {};

// ==================== ValidatorUI 类 ====================
YarnLevel.ValidatorUI = function() {
  this._validateBtn = null;
  this._algorithmSelect = null;
  this._logZone = null;
  this._logContainer = null;
  this._resultSummary = null;
  this._clearLogBtn = null;
};

YarnLevel.ValidatorUI.prototype.init = function() {
  this._validateBtn = document.getElementById('validateLevelBtn');
  this._algorithmSelect = document.getElementById('validatorAlgorithm');
  this._logZone = document.getElementById('validatorLogZone');
  this._logContainer = document.getElementById('validatorLogContainer');
  this._resultSummary = document.getElementById('validatorResultSummary');
  this._clearLogBtn = document.getElementById('clearLogBtn');

  if (!this._validateBtn) {
    console.error('未找到验证按钮');
    return;
  }

  var self = this;
  this._validateBtn.addEventListener('click', function() { self._handleValidate(); });

  if (this._clearLogBtn) {
    this._clearLogBtn.addEventListener('click', function() { self._clearLog(); });
  }
};

YarnLevel.ValidatorUI.prototype._handleValidate = function() {
  var app = window.app;
  var targetData = app.targetZoneManager.getData();
  var elementData = app.elementZoneManager.getData();

  if (!targetData || !elementData || (targetData.length === 0 && elementData.length === 0)) {
    app.showError('没有关卡数据可验证');
    return;
  }

  this._validateBtn.disabled = true;

  try {
    var algorithm = this._algorithmSelect ? this._algorithmSelect.value : 'v1';
    var validator;
    if (algorithm === 'v2') {
      validator = new YarnLevel.LevelValidatorV2(targetData, elementData);
    } else {
      validator = new YarnLevel.LevelValidator(targetData, elementData);
    }
    var result = validator.validate();

    if (result.success) {
      app.showSuccess(result.message);
    } else {
      app.showError(result.message);
    }

    this._renderLog(result);
  } catch (error) {
    app.showError('验证过程中出现异常: ' + error.message);
  } finally {
    this._validateBtn.disabled = false;
  }
};

YarnLevel.ValidatorUI.prototype._renderLog = function(result) {
  if (!this._logZone || !this._logContainer) return;

  // 显示验证记录区
  this._logZone.style.display = '';

  // 结果摘要
  if (this._resultSummary) {
    var summaryText = result.success ? '✓ 验证通过' : '✗ ' + result.message;
    this._resultSummary.textContent = summaryText;
    this._resultSummary.style.color = result.success ? '#5cb85c' : '#d9534f';
  }

  // 清空旧日志
  this._logContainer.innerHTML = '';

  var log = result.log || [];
  if (log.length === 0) {
    var emptyDiv = document.createElement('div');
    emptyDiv.className = 'log-empty';
    emptyDiv.textContent = result.message || '无详细日志';
    this._logContainer.appendChild(emptyDiv);
    return;
  }

  // 按步骤分组
  var stepGroups = {};
  var stepOrder = [];
  for (var i = 0; i < log.length; i++) {
    var entry = log[i];
    var step = entry.step;
    if (!stepGroups[step]) {
      stepGroups[step] = [];
      stepOrder.push(step);
    }
    stepGroups[step].push(entry);
  }

  for (var s = 0; s < stepOrder.length; s++) {
    var step = stepOrder[s];
    var entries = stepGroups[step];

    var stepDiv = document.createElement('div');
    stepDiv.className = 'log-step';

    // 步骤标题
    var stepHeader = document.createElement('div');
    stepHeader.className = 'log-step-header';
    stepHeader.textContent = '第 ' + step + ' 步';
    stepDiv.appendChild(stepHeader);

    for (var e = 0; e < entries.length; e++) {
      var entry = entries[e];
      var lineDiv = document.createElement('div');
      lineDiv.className = 'log-line log-action-' + entry.action;

      // 动作图标
      var icon = this._getActionIcon(entry.action);
      var iconSpan = document.createElement('span');
      iconSpan.className = 'log-icon';
      iconSpan.textContent = icon;
      lineDiv.appendChild(iconSpan);

      // 描述
      var descSpan = document.createElement('span');
      descSpan.className = 'log-desc';
      descSpan.textContent = entry.desc;
      lineDiv.appendChild(descSpan);

      // 暂存区状态
      if (entry.buffer && entry.buffer.length > 0) {
        var bufferSpan = document.createElement('span');
        bufferSpan.className = 'log-buffer';
        bufferSpan.textContent = '暂存区[' + entry.buffer.map(function(id) { return id; }).join(', ') + ']';
        lineDiv.appendChild(bufferSpan);
      }

      stepDiv.appendChild(lineDiv);

      // 目标区消除后最后两行内容
      if (entry.targetLastRows && entry.targetLastRows.length > 0) {
        var rowsDiv = document.createElement('div');
        rowsDiv.className = 'log-target-rows';
        for (var tr = 0; tr < entry.targetLastRows.length; tr++) {
          var rowInfo = entry.targetLastRows[tr];
          var rowSpan = document.createElement('div');
          rowSpan.className = 'log-target-row';
          var cellTexts = rowInfo.cells.map(function(id) { return id > 0 ? id : '·'; });
          rowSpan.textContent = '第' + rowInfo.rowIndex + '行: [' + cellTexts.join(', ') + ']';
          rowsDiv.appendChild(rowSpan);
        }
        stepDiv.appendChild(rowsDiv);
      }
    }

    this._logContainer.appendChild(stepDiv);
  }

  // 自动滚动到底部
  this._logContainer.scrollTop = this._logContainer.scrollHeight;
};

YarnLevel.ValidatorUI.prototype._getActionIcon = function(action) {
  var icons = {
    move: '➡',
    chain: '⛓',
    eliminate: '✓',
    pipe: '🔧',
    unlock: '🔓',
    deadlock: '🚫',
    buffer_full: '⚠',
    complete: '🎉'
  };
  return icons[action] || '•';
};

YarnLevel.ValidatorUI.prototype._clearLog = function() {
  if (this._logContainer) this._logContainer.innerHTML = '';
  if (this._resultSummary) this._resultSummary.textContent = '';
  if (this._logZone) this._logZone.style.display = 'none';
};
