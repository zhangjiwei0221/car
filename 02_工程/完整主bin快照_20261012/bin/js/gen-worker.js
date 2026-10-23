/* 批量生产后台线程(Web Worker)
 * 把耗时的 produce() 放到独立线程运行，主线程保持响应：
 *   - 进度条/统计/日志能实时刷新（主线程不再被 produce 阻塞）；
 *   - 按时间模式："停止"仍可 terminate 立刻杀掉；
 *   - 按目标模式：主线程发 {cmd:'stop'}，worker 在两轮之间收尾并返回【当前最好】。
 * 通过 importScripts 复用与页面完全相同的一套 AntSolver 模块（保证生成结果一致）。
 *
 * 消息协议：
 *   主→worker: {cmd:'ping'} / {cmd:'produce', index, blocks, config}
 *              / {cmd:'produceGoal', index, blocks, config} / {cmd:'stop'}
 *   worker→主: {type:'ready'|'loadfail'} / {type:'result', index, result}
 *              / {type:'error', index, message} / {type:'stopping'}
 *
 * 【2026-10-22·重要】目标模式为什么不用 generator.produceGoal：
 *   Worker 的 onmessage 是同步跑完的。如果在一个同步 while 里调 produce，
 *   {cmd:'stop'} 永远排在消息队列里进不来 → 点结束也停不下。
 *   所以这里把"一轮 produce + setTimeout 让出"做成循环：
 *   每轮最多 20s，轮与轮之间 worker 能处理 stop 消息，收尾时返回当前最好。
 */
var _v = (self.location && self.location.search) || '';   // 页面传入的 ?v=版本，透传给依赖脚本(缓存版本一致)
var _loaded = false;
var _goal = null;     // 目标模式的运行态：{blocks, config, index, best, rounds, stop, t0, baseSeed, perMs}
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
if (_loaded && AntSolver.Generator.setProgressHook) {
  AntSolver.Generator.setProgressHook(function (p) { self.postMessage({ type: 'progress', p: p }); });
}

function _goalPassed(r) {
  try { return AntSolver.Generator.goalStructPass(r); } catch (e) { return false; }
}
function _goalScore(r) {
  if (!r || !r.level) return -1e15;
  var s = 0;
  if (r.valid) s += 1e6;
  if (!r.fallback) s += 1e5;
  // 【v437】目标模式按结构门选 best，不再按旧 goodV3
  try { if (AntSolver.Generator.goalStructPass(r)) s += 1e12; } catch (e) {}
  var p = (r.goodV3 && r.goodV3.persist) || {};
  var fc = (r.goodV3 && r.goodV3.fillCurve) || {};
  s += (fc.selectMedian || 0) * 1000;
  s += (fc.earlyPeak10 || 0) * 5000;
  s -= (fc.earlyFree10 || 0) * 1000;
  s -= (fc.freeLowPct || 0) * 100;
  s += (p.band3Pct || 0) * 10;
  s += (r.difficulty && r.difficulty.score) || 0;
  return s;
}
function _goalFinish(stopReason) {
  var g = _goal;
  if (!g) return;
  _goal = null;
  if (g.timer) { clearTimeout(g.timer); g.timer = null; }
  var best = g.best;
  if (best) {
    best.goalMode = true;
    best.goalRounds = g.rounds;
    best.goalStopped = !!g.stop;
    best.goalElapsedMs = Date.now() - g.t0;
  } else {
    best = { level: null, valid: false, lastFailReason: stopReason || 'goalNoRound', goalMode: true, goalRounds: g.rounds, goalStopped: !!g.stop };
  }
  try { best._workerBuild = (g.config && g.config._build) || null; } catch (e) {}
  self.postMessage({ type: 'result', index: g.index, result: best });
}
function _goalRound() {
  var g = _goal;
  if (!g) return;
  g.timer = null;
  if (g.stop) { _goalFinish('stopped'); return; }
  var perMs = g.perMs;
  if (g.maxMs && (Date.now() - g.t0) >= g.maxMs) { _goalFinish('goalTimeUp'); return; }
  if (g.maxRounds && g.rounds >= g.maxRounds) { _goalFinish('goalMaxRounds'); return; }
  var cfg = {};
  for (var k in g.config) cfg[k] = g.config[k];
  cfg.goalMode = false;
  // 【v438】ABC 三个基底：逻辑并行，单 worker 先顺序执行；每个基底各自跑 A1~A4
  var _goalK = Math.max(1, Math.min(3, parseInt(g.config.goalBases, 10) || 3));
  cfg.portfolioK = _goalK;
  cfg.timeBudgetMs = perMs * _goalK;
  cfg.seed = (g.baseSeed + g.rounds * 7919) >>> 0;
  cfg._trace = [];
  self.postMessage({ type: 'flow', index: g.index, round: g.rounds + 1,
    text: '目标第' + (g.rounds + 1) + '轮开始 · seed ' + cfg.seed });
  var r = null;
  try {
    r = AntSolver.Generator.produce(g.blocks, cfg);
  } catch (err) {
    r = { level: null, valid: false, lastFailReason: 'goalRoundError: ' + ((err && err.message) || err) };
  }
  // 【v439】目标模式：先在同一基底上继续修，修不动再换 seed
  if (r && r.level && !_goalPassed(r)) {
    var _repCur = r, _repSteps = 0;
    for (var _rr = 0; _rr < 3; _rr++) {
      var _rep = null;
      try { _rep = AntSolver.Generator.p7RepairLevel(_repCur.level, cfg); } catch (e) { _rep = null; }
      if (!_rep || !_rep.level || !_rep.valid || !_rep.p7 || !_rep.p7.accepted) break;
      _repCur = {
        level: _rep.level, valid: true, solveResult: _rep.solveResult,
        goodV3: _rep.goodV3, audit: _rep.audit, config: _repCur.config,
        p7: _rep.p7, fallback: false, goalRepair: true
      };
      _repSteps++;
      if (_goalPassed(_repCur)) break;
    }
    if (_repSteps) { r = _repCur; r.goalRepairSteps = _repSteps; }
  }
  g.rounds++;
  var _better = r && (!g.best || _goalScore(r) > _goalScore(g.best));
  if (_better) {
    try { self.postMessage({ type: 'goalBest', index: g.index, round: g.rounds, result: r }); } catch (e) {}
  }
  try {
    var _p = r && r.goodV3 && r.goodV3.persist, _q = _p && _p.quality, _f = r && r.goodV3 && r.goodV3.fillCurve;
    self.postMessage({ type: 'flow', index: g.index, round: g.rounds,
      text: '目标第' + g.rounds + '轮结果 · ' + (r && r.level ? '有关卡' : '无关卡') +
        ' · 首通' + (_p && _p.playerPassPct != null ? _p.playerPassPct + '%' : '-') +
        ' · T' + (_q && _q.T != null ? _q.T : '-') +
        ' · freeLow' + (_f && _f.freeLowPct != null ? _f.freeLowPct + '%' : '-') +
        ' · 压力' + (_f && _f.pressurePct3 != null ? _f.pressurePct3 + '%' : '-') });
  } catch (e) { }
  if (r) r.goalRound = g.rounds;
  if (!g.best || _goalScore(r) > _goalScore(g.best)) g.best = r;
  if (_goalPassed(r)) { _goalFinish('pass'); return; }
  // 让出事件循环：这一行之后 worker 才能处理 {cmd:'stop'}
  g.timer = setTimeout(_goalRound, 0);
}

self.onmessage = function (e) {
  var d = e.data || {};
  if (d.cmd === 'ping') {
    self.postMessage({ type: _loaded ? 'ready' : 'loadfail' });
    return;
  }
  if (d.cmd === 'stop') {
    if (_goal) {
      _goal.stop = true;
      if (_goal.timer) { clearTimeout(_goal.timer); _goal.timer = null; }
      self.postMessage({ type: 'stopping' });
      _goalFinish('stopped');   // 只在轮间收到（同步轮内消息进不来），可立即收尾
    }
    return;
  }
  if (d.cmd === 'produce') {
    if (!_loaded) { self.postMessage({ type: 'error', index: d.index, message: '后台线程模块未加载' }); return; }
    try {
      var result = AntSolver.Generator.produce(d.blocks, d.config);
      try { result._workerBuild = (d.config && d.config._build) || null; } catch (e) {}
      self.postMessage({ type: 'result', index: d.index, result: result });
    } catch (err) {
      self.postMessage({ type: 'error', index: d.index, message: String((err && err.message) || err) });
    }
    return;
  }
  if (d.cmd === 'produceGoal') {
    if (!_loaded) { self.postMessage({ type: 'error', index: d.index, message: '后台线程模块未加载' }); return; }
    if (_goal) { self.postMessage({ type: 'error', index: d.index, message: '上一关目标模式还没结束' }); return; }
    var per = parseInt(d.config && d.config.goalPerRoundMs, 10);
    if (!(per > 0)) per = 20000;
    var baseSeed = (d.config && d.config.seed != null && !isNaN(+d.config.seed)) ? (+d.config.seed) : ((Date.now() & 0x7fffffff) >>> 0);
    _goal = {
      blocks: d.blocks, config: d.config || {}, index: d.index,
      best: null, rounds: 0, stop: false, t0: Date.now(), perMs: per, baseSeed: baseSeed,
      maxMs: parseInt(d.config && d.config.goalMaxMs, 10) || 0,
      maxRounds: parseInt(d.config && d.config.goalMaxRounds, 10) || 0,
      timer: null
    };
    _goalRound();
  }
};
