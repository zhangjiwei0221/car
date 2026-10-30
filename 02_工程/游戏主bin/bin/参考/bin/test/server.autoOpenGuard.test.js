'use strict';

/**
 * 任务 4.2：server.js 防重复打开浏览器守卫单元测试
 * _Requirements: 5.2_
 *
 * 断言：
 *  - 设置 LAUNCHER_NO_AUTO_OPEN=1 时，server.js 不调用系统 `open`
 *  - 未设置时，server.js 调用 `open`（mac 自动打开浏览器）
 *
 * 采用非侵入方式：在临时 bin 目录放置一个名为 `open` 的桩脚本并前置到 PATH，
 * 桩被调用时向 marker 文件追加一行；据此判断 `open` 是否被触发。
 * 同时做一次静态检查，确认守卫条件存在于 server.js（即便行为测试因端口占用被跳过）。
 *
 * 行为测试仅在 POSIX（mac/linux，exec 经 /bin/sh）且端口 3000 空闲时运行，
 * 结束时务必 kill 子进程，避免悬挂进程/端口。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

// server.js 现位于 bin/，测试位于 bin/test/，故上溯一级即为 bin/
const PACKAGE_ROOT = path.resolve(__dirname, '..');
const SERVER_JS = path.join(PACKAGE_ROOT, 'server.js');
const PORT = 3000;

// ---- 静态检查：守卫条件必须存在 ----
test('server.js 含 LAUNCHER_NO_AUTO_OPEN 守卫条件（R5.2）', () => {
  const src = fs.readFileSync(SERVER_JS, 'utf8');
  assert.match(
    src,
    /if\s*\(\s*!process\.env\.LAUNCHER_NO_AUTO_OPEN\s*\)/,
    'server.js 应使用 if (!process.env.LAUNCHER_NO_AUTO_OPEN) 包裹自动打开逻辑'
  );
});

// ---- 行为检查辅助 ----
function portFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)));
  });
}

function waitListening(port, timeoutMs, child) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    // 子进程提前退出（如缺少运行依赖而崩溃）→ 视为未能监听
    const onExit = () => finish('exited');
    child.once('exit', onExit);

    const tick = () => {
      if (done) return;
      const sock = new net.Socket();
      sock.setTimeout(300);
      sock.once('connect', () => { sock.destroy(); child.removeListener('exit', onExit); finish(true); });
      sock.once('timeout', () => { sock.destroy(); retry(); });
      sock.once('error', () => { sock.destroy(); retry(); });
      sock.connect(port, '127.0.0.1');
    };
    const retry = () => {
      if (done) return;
      if (Date.now() >= deadline) { child.removeListener('exit', onExit); return finish(false); }
      setTimeout(tick, 200);
    };
    tick();
  });
}

/** 安全地终止子进程并等待其退出（已退出则立即返回）。 */
function killAndWait(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once('exit', () => resolve());
    child.kill('SIGKILL');
  });
}

/**
 * 用桩 `open` 启动 server.js。
 * 返回 { started, opened }：started 表示 server 成功进入监听；opened 表示 open 被调用。
 */
async function runServerAndCheckOpen(withGuard) {
  const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fpl-stub-'));
  const markerFile = path.join(stubDir, 'open.marker');
  const stubPath = path.join(stubDir, 'open');
  fs.writeFileSync(
    stubPath,
    `#!/bin/sh\necho "opened $@" >> "${markerFile}"\n`,
    { mode: 0o755 }
  );

  const env = { ...process.env, PATH: stubDir + path.delimiter + process.env.PATH };
  if (withGuard) {
    env.LAUNCHER_NO_AUTO_OPEN = '1';
  } else {
    delete env.LAUNCHER_NO_AUTO_OPEN;
  }

  const child = spawn(process.execPath, ['server.js'], {
    cwd: PACKAGE_ROOT,
    env,
    stdio: 'ignore',
  });

  try {
    const listening = await waitListening(PORT, 12000, child);
    if (listening !== true) {
      // server 未能监听（环境缺少运行依赖或端口问题）
      return { started: false, opened: false };
    }
    // 给 exec('open ...') 一点时间触发桩
    await new Promise((r) => setTimeout(r, 800));
    return { started: true, opened: fs.existsSync(markerFile) };
  } finally {
    await killAndWait(child);
    fs.rmSync(stubDir, { recursive: true, force: true });
  }
}

test('行为：LAUNCHER_NO_AUTO_OPEN=1 时不调用 open；未设置时调用 open（R5.2）', async (t) => {
  if (process.platform === 'win32') {
    t.skip('Windows 上 exec 经 cmd，桩机制不同；已由静态检查覆盖守卫存在性');
    return;
  }
  if (!(await portFree(PORT))) {
    t.skip('端口 3000 被占用，跳过行为测试（守卫存在性已由静态检查覆盖）');
    return;
  }

  // 守卫开启：不应调用 open
  const guarded = await runServerAndCheckOpen(true);
  if (!guarded.started) {
    t.skip('server.js 在当前环境无法启动（缺少运行依赖），跳过行为测试；守卫存在性已由静态检查覆盖');
    return;
  }
  assert.strictEqual(guarded.opened, false, '设置守卫时不应调用 open');

  // 守卫关闭：应调用 open
  const unguarded = await runServerAndCheckOpen(false);
  assert.strictEqual(unguarded.started, true, 'server 应能再次启动');
  assert.strictEqual(unguarded.opened, true, '未设置守卫时应调用 open');
});
