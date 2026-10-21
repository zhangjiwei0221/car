/* 批量生产后台线程(Web Worker)
 * 把耗时的 produce() 放到独立线程运行，主线程保持响应：
 *   - 进度条/统计/日志能实时刷新（主线程不再被 produce 阻塞）；
 *   - "停止"点击即时生效（主线程调用 worker.terminate() 立刻杀掉当前计算）。
 * 通过 importScripts 复用与页面完全相同的一套 AntSolver 模块（保证生成结果一致）。
 *
 * 消息协议：
 *   主→worker: {cmd:'ping'} / {cmd:'produce', index, blocks, config}
 *   worker→主: {type:'ready'|'loadfail'} / {type:'result', index, result} / {type:'error', index, message}
 */
var _v = (self.location && self.location.search) || '';   // 页面传入的 ?v=版本，透传给依赖脚本(缓存版本一致)
var _loaded = false;
try {
  importScripts(
    'utils.js' + _v, 'simulator.js' + _v, 'solver-strategy.js' + _v,
    'solver.js' + _v, 'playersim.js' + _v, 'analysis.js' + _v, 'generator.js' + _v
  );
  _loaded = !!(typeof AntSolver !== 'undefined' && AntSolver.Generator && AntSolver.Generator.produce);
} catch (e) {
  _loaded = false;   // 加载失败(如本地 file:// 方式打开时被浏览器拦截) → 主线程会回退到主线程模式
}

// 【v153】注册进度钩子：produce 内部每跑完一个候选/变体就上报一次，主线程据此刷新"跑到哪了"。
//   为什么要它：单关最坏要烧满时间预算（默认 5 分钟），期间界面只有一句"处理中"，看起来像卡死。
if (_loaded && AntSolver.Generator.setProgressHook) {
  AntSolver.Generator.setProgressHook(function (p) { self.postMessage({ type: 'progress', p: p }); });
}

self.onmessage = function (e) {
  var d = e.data || {};
  if (d.cmd === 'ping') {
    self.postMessage({ type: _loaded ? 'ready' : 'loadfail' });
    return;
  }
  if (d.cmd === 'produce') {
    if (!_loaded) { self.postMessage({ type: 'error', index: d.index, message: '后台线程模块未加载' }); return; }
    try {
      var result = AntSolver.Generator.produce(d.blocks, d.config);
      self.postMessage({ type: 'result', index: d.index, result: result });
    } catch (err) {
      self.postMessage({ type: 'error', index: d.index, message: String((err && err.message) || err) });
    }
  }
};
