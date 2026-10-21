/**
 * 蚂蚁拿块关卡图修改工具 · 求解 Worker
 * 任务：ANT-ARTTOOL-CLASSIFY-20260729 · 阶段3
 *
 * 把求解与回放放到后台线程，避免页面卡死。
 * 只 importScripts 本工具目录下的 bin/js/ 文件 + core.js，本文件不含任何求解算法。
 * 那份 bin/js 是正式代码的副本（2026-08-03 起随工具打包，便于整个文件夹迁移），
 *   正式来源仍是项目根目录的 bin/，两者同步按用户决定本轮不做，详见 ../bin/来源说明.md。
 * 只载入求解链所需的 4 个文件（utils / simulator / solver-strategy / solver）——
 *   已核对这 4 个文件不引用 AntSolver.Analysis 与 AntSolver.Generator，可独立运行。
 *
 * 注意：Worker 在 file:// 协议下会被浏览器拦截（importScripts 跨源限制），
 *       主页面检测到 Worker 不可用时会自动退回主线程同步求解（见 app.js）。
 */
'use strict';

try {
  // 本文件在 关卡图修改工具/js/ 下，'../bin/js/' 指向 关卡图修改工具/bin/js/（随工具打包的那一份）
  importScripts(
    '../bin/js/utils.js',
    '../bin/js/simulator.js',
    '../bin/js/solver-strategy.js',
    '../bin/js/solver.js',
    'core.js'
  );
} catch (e) {
  self.postMessage({ type: 'fatal', error: '载入求解器失败：' + (e && e.message) });
}

var C = self.ArtToolCore;

function post(o) { self.postMessage(o); }

self.onmessage = function (ev) {
  var msg = ev.data || {};
  try {
    // 探活：主页面据此判断 Worker 是否可用（file:// 下 importScripts 会失败），不可用则退回主线程
    if (msg.cmd === 'ping') {
      post({
        type: 'pong', reqId: msg.reqId,
        ready: !!(C && self.AntSolver && self.AntSolver.Solver && self.AntSolver.Simulator)
      });
      return;
    }

    if (msg.cmd === 'solve') {
      post({ type: 'stage', reqId: msg.reqId, text: '标准复核求解中（正式六遍编排，任一遍通关即止）…' });
      var t0 = Date.now();
      var sv = C.solveStandard(msg.level, msg.budgetMs);
      var solveMs = Date.now() - t0;
      if (!sv.completed) {
        post({
          type: 'solved', reqId: msg.reqId, completed: false,
          pass: sv.pass || null, progress: sv.result ? sv.result.progress : 0,
          steps: sv.result ? sv.result.steps : 0, solveMs: solveMs,
          message: '本关标准复核未通关，无法做进度区间定位（不伪造路线）'
        });
        return;
      }
      post({ type: 'stage', reqId: msg.reqId, text: '按真实 pickOrder 回放并采集消除像素…' });
      // captureBoard:true 一并拍下棋盘+暂存快照，供棋盘区展示/暂存前后对比/自动演示动画使用，
      // 避免为这三个功能再对同一条 pickOrder 重放第二次。
      var rp = C.replay(msg.level, sv.result.pickOrder, { captureBoard: true });
      post({
        type: 'solved', reqId: msg.reqId, completed: true,
        pass: sv.pass, solveMs: solveMs,
        summary: {
          steps: sv.result.steps, totalBoxes: sv.parsed.totalBoxes,
          totalPixels: sv.parsed.totalPixels, eliminatedPixels: sv.result.eliminatedPixels,
          progress: sv.result.progress, maxBuffer: sv.result.maxBuffer || 0,
          avgBuffer: sv.result.avgBuffer, completedBoxes: rp.completedBoxes
        },
        pickOrder: sv.result.pickOrder,
        stepBufferHistory: sv.result.stepBufferHistory,
        pressureSamples: sv.result.pressureSamples,
        replay: {
          ok: rp.ok, fail: rp.fail, allEliminated: rp.allEliminated, allBoxesDone: rp.allBoxesDone,
          rows: rp.rows, cols: rp.cols, pixelCoding: rp.pixelCoding,
          totalPixels: rp.totalPixels, eliminatedPixels: rp.eliminatedPixels,
          steps: rp.steps, initialBoard: rp.initialBoard
        }
      });
      return;
    }

    if (msg.cmd === 'routes') {
      // 多路线复核：逐遍尝试候选遍次，收集最多 maxRoutes 条【不重复】的可通关路线。
      var want = Math.max(1, Math.min(3, msg.maxRoutes || 3));
      var seenSig = {}, routes = [], tried = [];
      for (var i = 0; i < C.ROUTE_PASSES.length && routes.length < want; i++) {
        var p = C.ROUTE_PASSES[i];
        post({ type: 'stage', reqId: msg.reqId, text: '多路线复核：第 ' + (i + 1) + '/' + C.ROUTE_PASSES.length + ' 遍（' + p.tag + '·' + p.mode + ' noise=' + p.noise + ' seed=' + p.seed + '），已得 ' + routes.length + '/' + want + ' 条' });
        var one = null;
        try { one = C.solveOnePass(msg.level, p); } catch (e) { tried.push({ tag: p.tag, error: e && e.message }); continue; }
        if (!one.completed) { tried.push({ tag: p.tag, completed: false, progress: one.result ? one.result.progress : 0 }); continue; }
        var sig = one.result.pickOrder.map(function (x) { return x.r + ',' + x.c; }).join(';');
        if (seenSig[sig]) { tried.push({ tag: p.tag, completed: true, duplicateOf: seenSig[sig] }); continue; }
        seenSig[sig] = p.tag;
        var rp2 = C.replay(msg.level, one.result.pickOrder);
        routes.push({
          tag: p.tag, mode: p.mode, noise: p.noise, seed: p.seed,
          steps: one.result.steps, maxBuffer: one.result.maxBuffer || 0, avgBuffer: one.result.avgBuffer,
          replayOk: rp2.ok, replayFail: rp2.fail,
          rows: rp2.rows, cols: rp2.cols, totalBoxes: rp2.totalBoxes, totalPixels: rp2.totalPixels,
          timelineSteps: rp2.steps
        });
        tried.push({ tag: p.tag, completed: true, accepted: true, steps: one.result.steps });
      }
      post({ type: 'routes', reqId: msg.reqId, routes: routes, tried: tried });
      return;
    }

    post({ type: 'fatal', reqId: msg.reqId, error: '未知指令：' + msg.cmd });
  } catch (err) {
    post({ type: 'fatal', reqId: msg.reqId, error: (err && err.message) || String(err), stack: err && err.stack });
  }
};
