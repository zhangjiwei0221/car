'use strict';

/**
 * 任务 5.8：编排接线与端口占用单元测试
 * _Requirements: 5.6, 6.3_
 *
 * - 空输入：main 走停止分支（reason='empty_input'），不创建输出、不启动 server（R6.3）
 * - 端口占用：预占测试端口，main 走端口占用分支（reason='port_in_use'），不启动 server（R5.6）
 *
 * 测试保持 hermetic 且快：端口可参数化（用系统分配的空闲端口而非真实 3000），
 * 使用临时 packageRoot，结束时清理监听与临时目录，避免悬挂进程/端口。
 * 这两个分支均在 startServer 之前返回，因此不会真正 spawn server.js。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

const orchestrator = require('../orchestrator');
const { main } = orchestrator;

function mkTmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fpl-wiring-'));
}

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

/** 静默 console.log/error，返回恢复函数。 */
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

test('空输入：main 走停止分支且不创建输出（R6.3）', async () => {
  const root = mkTmpRoot();
  const restore = muteConsole();
  try {
    // 使用一个未监听端口，确保即便流程继续也不会因端口占用而误判
    const result = await main({ packageRoot: root, port: 0, os: 'unsupported' });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'empty_input');

    // input_txt 被创建（R6.2），但没有任何输出产物
    const inputDir = path.join(root, 'input_txt');
    assert.strictEqual(fs.existsSync(inputDir), true);
    assert.deepStrictEqual(fs.readdirSync(root), ['input_txt']);
    assert.deepStrictEqual(fs.readdirSync(inputDir), []);
    // 未启动 server
    assert.strictEqual(result.child, undefined);
  } finally {
    restore();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('端口占用：main 走端口占用分支且不启动 server（R5.6）', async () => {
  const root = mkTmpRoot();
  const restore = muteConsole();
  let occupied;
  try {
    // 准备一个含 .txt 的输入目录，确保越过空输入守卫
    const inputDir = path.join(root, 'input_txt');
    fs.mkdirSync(inputDir, { recursive: true });
    fs.writeFileSync(path.join(inputDir, '图纸.txt'), 'pixel');

    occupied = await occupyPort();

    const result = await main({ packageRoot: root, port: occupied.port, os: 'unsupported' });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'port_in_use');
    // 未启动 server
    assert.strictEqual(result.child, undefined);
  } finally {
    restore();
    if (occupied) await occupied.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
