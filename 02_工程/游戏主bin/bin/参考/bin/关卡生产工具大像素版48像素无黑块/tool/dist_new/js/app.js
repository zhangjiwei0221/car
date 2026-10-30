/**
 * 像素毛线关卡生成工具 - 应用入口
 */

var YarnLevel = YarnLevel || {};

// ==================== App 类 ====================
YarnLevel.App = function() {
  this.targetZoneManager = null;
  this.elementZoneManager = null;
  this.terrainZoneManager = null;
  this.levelState = null;
  this.terrainState = null;
  this.targetZoneUI = null;
  this.elementZoneUI = null;
  this.terrainZoneUI = null;
  this.toolbar = null;
  this._toastTimer = null;
};

YarnLevel.App.prototype.init = function() {
  try {
    this._initState();
    this._initManagers();
    this._initUI();
    this._wireUpDependencies();
    console.log('像素毛线关卡生成工具初始化完成');
  } catch (error) {
    console.error('应用初始化失败:', error);
    this.showError('应用初始化失败: ' + error.message);
  }
};

YarnLevel.App.prototype._initState = function() {
  this.levelState = new YarnLevel.LevelState();
  this.terrainState = new YarnLevel.TerrainState();
};

YarnLevel.App.prototype._initManagers = function() {
  this.targetZoneManager = new YarnLevel.TargetZoneManager();
  this.elementZoneManager = new YarnLevel.ElementZoneManager();
  this.terrainZoneManager = new YarnLevel.TerrainZoneManager();
};

YarnLevel.App.prototype._initUI = function() {
  var self = this;
  var onError = function(msg) { self.showError(msg); };
  var onSuccess = function(msg) { self.showSuccess(msg); };

  this.targetZoneUI = new YarnLevel.TargetZoneUI({
    manager: this.targetZoneManager,
    onError: onError,
    onSuccess: onSuccess
  });
  this.targetZoneUI.init();

  this.elementZoneUI = new YarnLevel.ElementZoneUI({
    manager: this.elementZoneManager,
    targetManager: this.targetZoneManager,
    onError: onError,
    onSuccess: onSuccess
  });
  this.elementZoneUI.init();

  this.terrainZoneUI = new YarnLevel.TerrainZoneUI({
    manager: this.terrainZoneManager,
    onError: onError,
    onSuccess: onSuccess
  });
  this.terrainZoneUI.init();

  this.toolbar = new YarnLevel.Toolbar({
    levelState: this.levelState,
    targetZoneManager: this.targetZoneManager,
    elementZoneManager: this.elementZoneManager,
    targetZoneUI: this.targetZoneUI,
    elementZoneUI: this.elementZoneUI,
    onError: onError,
    onSuccess: onSuccess
  });
  this.toolbar.init();
};

YarnLevel.App.prototype._wireUpDependencies = function() {
  this.elementZoneUI.setTargetManager(this.targetZoneManager);
  this.toolbar.setTargetZoneManager(this.targetZoneManager);
  this.toolbar.setElementZoneManager(this.elementZoneManager);
  this.toolbar.setTargetZoneUI(this.targetZoneUI);
  this.toolbar.setElementZoneUI(this.elementZoneUI);
  this.toolbar.setLevelState(this.levelState);
};

YarnLevel.App.prototype.showError = function(message) {
  this._showToast(message, 'error');
};

YarnLevel.App.prototype.showSuccess = function(message) {
  this._showToast(message, 'success');
};

YarnLevel.App.prototype._showToast = function(message, type) {
  var toast = document.getElementById('errorToast');
  if (!toast) return;
  if (this._toastTimer) clearTimeout(this._toastTimer);
  toast.textContent = message;
  toast.classList.remove('hidden', 'toast-error', 'toast-success');
  if (type === 'error') {
    toast.classList.add('toast-error');
    toast.style.backgroundColor = '#d9534f';
  } else {
    toast.classList.add('toast-success');
    toast.style.backgroundColor = '#5cb85c';
  }
  var self = this;
  this._toastTimer = setTimeout(function() {
    toast.classList.add('hidden');
    toast.style.backgroundColor = '';
  }, 3000);
};

// ==================== 应用初始化 ====================
var app = new YarnLevel.App();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function() { app.init(); });
} else {
  app.init();
}

if (typeof window !== 'undefined') {
  window.app = app;
  window.YarnLevel = YarnLevel;
}
