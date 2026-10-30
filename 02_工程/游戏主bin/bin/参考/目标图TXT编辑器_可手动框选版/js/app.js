/**
 * 目标图 TXT 编辑器 - 应用入口
 */

var YarnLevel = YarnLevel || {};

YarnLevel.App = function() {
  this.targetZoneManager = null;
  this.targetZoneUI = null;
  this._toastTimer = null;
};

YarnLevel.App.prototype.init = function() {
  try {
    this.targetZoneManager = new YarnLevel.TargetZoneManager();
    this.targetZoneUI = new YarnLevel.TargetZoneUI({
      manager: this.targetZoneManager,
      onError: this.showError.bind(this),
      onSuccess: this.showSuccess.bind(this)
    });
    this.targetZoneUI.init();
    this.targetZoneUI.render();
    console.log('目标图 TXT 编辑器初始化完成');
  } catch (error) {
    console.error('应用初始化失败:', error);
    this.showError('应用初始化失败: ' + error.message);
  }
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
