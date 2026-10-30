'use strict';

/**
 * 任务 5.4：waitForPort 单元测试
 * _Requirements: 5.1, 5.3_
 *
 * - 对一个临时监听的 TCP server，waitForPort 返回 true（R5.1）
 * - 无监听时在缩短的超时上限内返回 false（R5.3，快测）
 *
 * 端口可参数化，使用 0 让系统分配空闲端口，避免与真实 server（3000）冲突，
 * 且测试结束后清理监听，避免悬挂端口/进程。
 */

const test = require('node:test');
const assert = require('node:assert');
const net = require('node:net');

const { waitForPort } = require('../orchestrator');

/** 在随机空闲端口启动一个临时 TCP server，返回 { port, close }。 */
function startTempServer() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer((socket) => socket.end());
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      resolve({
        port,
        close: () =>
          new Promise((res) => srv.close(() => res())),
      });
    });
  });
}

/** 获取一个当前未被监听的端口号（开后立即关）。 */
function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

test('waitForPort 对正在监听的端口返回 true（R5.1）', async () => {
  const { port, close } = await startTempServer();
  try {
    const ok = await waitForPort(port, 3000, { intervalMs: 100 });
    assert.strictEqual(ok, true);
  } finally {
    await close();
  }
});

test('waitForPort 在缩短超时内对无监听端口返回 false（R5.3）', async () => {
  const port = await getFreePort();
  const startedAt = Date.now();
  const ok = await waitForPort(port, 500, { intervalMs: 100 });
  const elapsed = Date.now() - startedAt;

  assert.strictEqual(ok, false);
  // 快测：应在超时上限附近返回，不应接近默认的 15s
  assert.ok(elapsed < 3000, `应在缩短超时内返回，实际 ${elapsed}ms`);
});

test('waitForPort 等待期间端口上线后返回 true', async () => {
  const port = await getFreePort();
  let srv;
  // 200ms 后才开始监听，验证轮询能捕捉到上线
  const timer = setTimeout(() => {
    srv = net.createServer((s) => s.end());
    srv.listen(port, '127.0.0.1');
  }, 200);

  try {
    const ok = await waitForPort(port, 3000, { intervalMs: 100 });
    assert.strictEqual(ok, true);
  } finally {
    clearTimeout(timer);
    if (srv) await new Promise((res) => srv.close(() => res()));
  }
});
