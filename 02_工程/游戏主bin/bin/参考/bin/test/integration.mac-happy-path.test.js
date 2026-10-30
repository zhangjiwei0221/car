'use strict';

/**
 * 任务 11.1：mac arm64 全链路 happy path（HERMETIC）
 * _Requirements: 4.1, 4.3, 5.1, 5.2_
 *
 * 不依赖真实 server.js（其在测试环境因依赖缺失会崩溃），改用一个最小 TCP 桩
 * server 监听到一个参数化的空闲端口，复现「端口就绪 → 等待成功 → 打开浏览器」
 * 这一关键接线：
 *   - orchestrator.waitForPort 对就绪端口返回 true（R5.1）
 *   - orchestrator.openBrowser 在 macOS 下确实调用 `open <url>`（R5.2）——
 *     用 PATH 桩拦截真实 `open`，记录被调用的参数到 marker 文件验证。
 *
 * 清理：关闭桩 server、等待 spawn 的桩进程退出、删除临时目录，无悬挂端口/进程。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

const { waitForPort, openBrowser } = require('../orchestrator');

/** 在随机空闲端口启动一个最小 TCP 桩 server，返回 { port, close }。 */
function startStubServer() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer((socket) => socket.end());
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      resolve({ port, close: () => new Promise((res) => srv.close(() => res())) });
    });
  });
}

test('mac happy path：端口就绪后 waitForPort 为真且 openBrowser 调用 open（R5.1/R5.2）', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fpl-happy-'));
  const stub = await startStubServer();
  const origPath = process.env.PATH;
  let browserChild = null;

  try {
    // 1) 端口已就绪 → waitForPort 在缩短上限内返回 true（R5.1）
    const ready = await waitForPort(stub.port, 3000, { intervalMs: 100 });
    assert.strictEqual(ready, true, '对就绪端口应返回 true');

    // 2) 在 PATH 最前面放一个 `open` 桩，拦截 openBrowser 的浏览器调用（R5.2）
    const markerFile = path.join(tmp, 'open-called.txt');
    const stubOpen = path.join(tmp, 'open');
    fs.writeFileSync(
      stubOpen,
      `#!/usr/bin/env bash\nprintf '%s' "$*" > "${markerFile}"\n`,
      { mode: 0o755 }
    );
    process.env.PATH = `${tmp}${path.delimiter}${origPath}`;

    const url = `http://localhost:${stub.port}`;
    browserChild = openBrowser(url, 'macos');
    assert.ok(browserChild, 'macOS 下 openBrowser 应拉起子进程');

    // 等待桩 open 进程结束后校验其被调用且带上了正确 URL
    await new Promise((res) => browserChild.once('close', res));
    assert.strictEqual(fs.existsSync(markerFile), true, 'open 桩应被调用');
    assert.match(fs.readFileSync(markerFile, 'utf8'), new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'open 应收到目标 URL');
  } finally {
    process.env.PATH = origPath;
    if (browserChild) {
      try { browserChild.kill(); } catch (_) { /* 忽略 */ }
    }
    await stub.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
