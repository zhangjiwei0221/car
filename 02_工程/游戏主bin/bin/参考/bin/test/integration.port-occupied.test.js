'use strict';

/**
 * 任务 11.3：端口占用分支（HERMETIC）
 * _Requirements: 5.6_
 *
 * 预先占用一个参数化端口（系统分配的空闲端口，避免触碰真实 3000），
 * 越过空输入守卫后调用 orchestrator.main，断言：
 *   - 返回 reason='port_in_use'（R5.6）
 *   - 未 spawn server（result.child 为 undefined）——分支在 startServer 之前返回
 *
 * 清理：关闭占用监听、删除临时 packageRoot，无悬挂端口/进程。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

const { main } = require('../orchestrator');

/** 占用一个随机空闲端口，返回 { port, close }。 */
function occupyPort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer((s) => s.end());
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      resolve({ port, close: () => new Promise((res) => srv.close(() => res())) });
    });
  });
}

function muteConsole() {
  const origLog = console.log;
  const origErr = console.error;
  console.log = () => {};
  console.error = () => {};
  return () => {
    console.log = origLog;
    console.error = origErr;
  };
}

test('端口被占用时 main 返回 port_in_use 且不 spawn server（R5.6）', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fpl-port-'));
  const restore = muteConsole();
  let occupied;
  try {
    // 准备含 .txt 的输入目录，确保越过空输入守卫，进入端口占用检查
    const inputDir = path.join(root, 'input_txt');
    fs.mkdirSync(inputDir, { recursive: true });
    fs.writeFileSync(path.join(inputDir, '图纸.txt'), 'pixel');

    occupied = await occupyPort();

    const result = await main({ packageRoot: root, port: occupied.port, os: 'macos' });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'port_in_use', '应走端口占用分支');
    assert.strictEqual(result.child, undefined, '端口占用时不应启动 server');
  } finally {
    restore();
    if (occupied) await occupied.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
