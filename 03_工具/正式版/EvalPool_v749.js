// EvalPool_v749.js —— 并行评估池（worker_threads）
// 用法：
//   const {createPool} = require('./EvalPool_v749');
//   const pool = createPool({ workers: 7, ref: 'corner', mode: 'a' });
//   const ms = await pool.evalAll([level1, level2, ...]);   // 顺序与输入一致
//   await pool.close();
'use strict';
const path = require('path');
const { Worker } = require('worker_threads');

function createPool(opts) {
  const n = Math.max(1, opts.workers || 4);
  const ref = opts.ref || 'ring';
  const workers = [];
  const idle = [];
  const queue = [];
  let seq = 0;
  const pending = new Map();

  function spawn() {
    const w = new Worker(path.join(__dirname, '_EvalWorker_v749.js'), {
      workerData: { ref, mode: opts.mode || 'a', guideSteps: opts.guideSteps || 3, noEarly: opts.noEarly || 0, shellColors: opts.shellColors || [], bufThreshold: opts.bufThreshold || 4 },
    });
    w.on('message', (msg) => {
      const res = pending.get(msg.id);
      if (res) { pending.delete(msg.id); res(msg && msg.error ? { error: msg.error } : (msg && msg.m)); }
      idle.push(w); pump();
    });
    w.on('error', (e) => { console.error('[worker error]', e && e.message); });
    workers.push(w); idle.push(w);
  }
  for (let i = 0; i < n; i++) spawn();

  function pump() {
    while (idle.length && queue.length) {
      const w = idle.pop();
      const job = queue.shift();
      pending.set(job.id, job.resolve);
      w.postMessage({ id: job.id, g: job.g });
    }
  }
  function evalOne(g) {
    return new Promise((resolve) => {
      const id = ++seq;
      queue.push({ id, g, resolve });
      pump();
    });
  }
  async function evalAll(list) {
    const out = new Array(list.length);
    let idx = 0;
    const width = Math.max(1, n * 2);
    async function workerLoop() {
      while (idx < list.length) {
        const i = idx++;
        const r = await evalOne(list[i]);
        out[i] = r.error ? { error: r.error } : r.m;
      }
    }
    await Promise.all(Array.from({ length: width }, workerLoop));
    return out;
  }
  async function close() { await Promise.all(workers.map(w => w.terminate())); }
  return { evalOne, evalAll, close, size: n };
}
module.exports = { createPool };
