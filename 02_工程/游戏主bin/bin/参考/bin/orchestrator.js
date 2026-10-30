'use strict';

/**
 * orchestrator.js — Node 编排脚本（第 2 层）
 *
 * 由第 1 层引导脚本（launch.sh / launch.bat）以选定的可运行 `node` 启动，
 * 负责 server 生命周期：确保输入目录、空输入守卫、spawn server、端口等待、
 * 打开浏览器、保活与心跳等。
 *
 * 设计参考：design.md "Components › 5. Node 编排脚本 orchestrator.js"。
 *
 * 注意：本模块为可被 require 的纯模块，导入时不产生副作用（不自动启动 server）。
 * 主流程接线（main）仅在本文件作为入口被直接执行时运行（require.main === module）。
 *
 * 已实现函数：
 *   - ensureInputDir / hasTxtInputs（任务 5.1）
 *   - startServer / waitForPort（任务 5.3）
 *   - openBrowser（任务 5.5）
 *   - heartbeat（任务 5.6）
 *   - main 主流程接线（任务 5.7，仅作为入口时运行）
 */

const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

// Input_Directory：产出包内用户放入 .txt 图纸的文件夹名。
const INPUT_DIR_NAME = 'input_txt';
// Production_Port：Web_Server 监听端口，固定为 3000。
const PRODUCTION_PORT = 3000;

/**
 * 确保 Input_Directory 存在：若 `<packageRoot>/input_txt` 不存在则递归创建。
 *
 * 对应 Requirement 6.2：启动流程开始时若 Input_Directory 不存在，则创建后继续。
 *
 * @param {string} packageRoot Package_Root（包根目录）绝对/相对路径
 * @returns {string} Input_Directory 的完整路径
 */
function ensureInputDir(packageRoot) {
  const inputDir = path.join(packageRoot, INPUT_DIR_NAME);
  if (!fs.existsSync(inputDir)) {
    fs.mkdirSync(inputDir, { recursive: true });
  }
  return inputDir;
}

/**
 * 判断输入目录中是否存在至少一个 `.txt` 文件（扩展名大小写不敏感）。
 *
 * 对应 Requirement 6.3：若不存在任何 `.txt` 文件则后续应提示并停止。
 * 目录缺失或为空时返回 false。
 *
 * @param {string} inputDir Input_Directory 路径
 * @returns {boolean} 存在至少一个 .txt 文件时为 true，否则为 false
 */
function hasTxtInputs(inputDir) {
  let entries;
  try {
    entries = fs.readdirSync(inputDir, { withFileTypes: true });
  } catch (err) {
    // 目录缺失（ENOENT）或不可读 → 视为无 .txt 输入。
    return false;
  }
  return entries.some(
    (entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === '.txt'
  );
}

/**
 * 探测某端口当前是否已被监听（是否可成功建立 TCP 连接）。
 *
 * 用于端口占用判定（R5.6）：若启动 server 之前 3000 已可连接，说明被他人占用。
 *
 * @param {number} [port=PRODUCTION_PORT] 待探测端口
 * @param {string} [host='127.0.0.1'] 主机
 * @param {number} [connectTimeoutMs=300] 单次连接超时
 * @returns {Promise<boolean>} 可连接（已被监听）时为 true
 */
function isPortInUse(port = PRODUCTION_PORT, host = '127.0.0.1', connectTimeoutMs = 300) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (inUse) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(inUse);
    };
    socket.setTimeout(connectTimeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host);
  });
}

/**
 * 以选定运行时启动 Web_Server（server.js）。
 *
 * 对应 Requirement 5.1：使用选定运行时在 Package_Root 中启动 Web_Server。
 * 通过环境变量 `LAUNCHER_NO_AUTO_OPEN=1` 告知 server.js 不要自行打开浏览器，
 * 由编排脚本统一负责跨平台打开（避免 mac 上重复打开）。
 *
 * @param {string} nodePath 选定的 node 可执行文件路径
 * @param {string} packageRoot Package_Root（作为子进程 cwd）
 * @returns {import('node:child_process').ChildProcess} 启动的子进程
 */
function startServer(nodePath, packageRoot) {
  // server.js 与本文件同处 bin/ 目录；用绝对路径启动，避免依赖子进程 cwd。
  const serverPath = path.join(__dirname, 'server.js');
  const child = spawn(nodePath, [serverPath], {
    cwd: packageRoot,
    env: { ...process.env, LAUNCHER_NO_AUTO_OPEN: '1' },
    stdio: 'inherit',
  });
  return child;
}

/**
 * 轮询等待端口进入监听状态。
 *
 * 对应 Requirement 5.1/5.3：每 ~300ms 用 net.connect 探测，等待上限默认 15s。
 * 端口在上限内变为可连接则 resolve(true)；超时 resolve(false)。
 *
 * @param {number} [port=PRODUCTION_PORT] 待等待端口
 * @param {number} [timeoutMs=15000] 等待上限（毫秒）
 * @param {object} [opts]
 * @param {string} [opts.host='127.0.0.1'] 主机
 * @param {number} [opts.intervalMs=300] 轮询间隔（毫秒）
 * @returns {Promise<boolean>} 端口在上限内进入监听为 true，超时为 false
 */
function waitForPort(port = PRODUCTION_PORT, timeoutMs = 15000, opts = {}) {
  const host = opts.host || '127.0.0.1';
  const intervalMs = opts.intervalMs || 300;
  const deadline = Date.now() + timeoutMs;

  return new Promise((resolve) => {
    const attempt = async () => {
      const inUse = await isPortInUse(port, host, Math.min(intervalMs, 1000));
      if (inUse) {
        resolve(true);
        return;
      }
      if (Date.now() >= deadline) {
        resolve(false);
        return;
      }
      setTimeout(attempt, intervalMs);
    };
    attempt();
  });
}

/**
 * 跨平台打开系统默认浏览器访问指定 URL。
 *
 * 对应 Requirement 5.2：端口就绪后由编排脚本统一打开浏览器。
 *   - macOS（'macos' / 'darwin'）：`open <url>`
 *   - Windows（'windows' / 'win32'）：`start "" <url>`
 *   - 其它平台：跳过（no-op）
 *
 * @param {string} url 目标地址
 * @param {string} os OS 标识：'macos'/'darwin' 或 'windows'/'win32'，其它视为不支持并跳过
 * @returns {import('node:child_process').ChildProcess | null} 实际拉起的子进程；跳过时为 null
 */
function openBrowser(url, os) {
  if (os === 'macos' || os === 'darwin') {
    return spawn('open', [url], { stdio: 'ignore', detached: true });
  }
  if (os === 'windows' || os === 'win32') {
    // Windows 上 start 是 cmd 内建命令；首个引号参数为窗口标题占位。
    return spawn('cmd', ['/c', 'start', '""', url], { stdio: 'ignore', detached: true });
  }
  // 其它平台：不支持自动打开，跳过。
  return null;
}

/**
 * 心跳：在 server 子进程存活期间，周期性打印"后端运行中"；
 * 子进程退出时打印"已停止"并给出重启建议。
 *
 * 对应 Requirement 5.4：保活并每隔 ≤5s 更新一次运行状态。
 * 对应 Requirement 5.5：子进程异常退出 → 状态更新为"已停止" + 重启建议。
 *
 * @param {import('node:child_process').ChildProcess} child server 子进程
 * @param {number} [intervalMs=5000] 心跳间隔（≤5000ms）
 * @returns {{ stop: () => void }} 可停止心跳的句柄
 */
function heartbeat(child, intervalMs = 5000) {
  const safeInterval = Math.min(intervalMs, 5000);
  let stopped = false;

  const timer = setInterval(() => {
    if (stopped) return;
    console.log('后端运行中（http://localhost:%d）', PRODUCTION_PORT);
  }, safeInterval);
  // 避免心跳定时器阻止进程在其它逻辑完成后自然退出。
  if (typeof timer.unref === 'function') timer.unref();

  const onExit = (code, signal) => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    const reason = signal ? `信号 ${signal}` : `退出码 ${code}`;
    console.error('后端已停止（%s）。', reason);
    console.error('建议：重新双击启动入口（mac 的 启动_Mac.command / Windows 的 启动_Windows.bat）以重启后端。');
  };

  if (child && typeof child.once === 'function') {
    child.once('exit', onExit);
  }

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      if (child && typeof child.removeListener === 'function') {
        child.removeListener('exit', onExit);
      }
    },
  };
}

/**
 * 编排主流程接线（任务 5.7）。
 *
 * 仅在本文件作为入口被直接执行时运行（见文件末尾 require.main 守卫）。
 * 串联：ensureInputDir → 空输入守卫 → 端口占用检查 → startServer →
 *       waitForPort → openBrowser + heartbeat。
 * 各步骤以中文输出"进行中/已完成/失败"状态（R7.1/R7.3）。
 *
 * @param {object} [opts]
 * @param {string} [opts.nodePath=process.execPath] 运行 server 的 node 路径
 * @param {string} [opts.packageRoot] Package_Root，默认本文件上一级目录
 * @param {string} [opts.os] OS 标识，默认 process.platform
 * @param {number} [opts.port=PRODUCTION_PORT] 端口
 * @param {number} [opts.waitTimeoutMs=15000] 端口等待上限
 * @returns {Promise<{ ok: boolean, reason?: string, child?: object }>}
 */
async function main(opts = {}) {
  const nodePath = opts.nodePath || process.execPath;
  const packageRoot = opts.packageRoot || path.resolve(__dirname, '..');
  const os = opts.os || process.platform;
  const port = opts.port || PRODUCTION_PORT;
  const waitTimeoutMs = opts.waitTimeoutMs || 15000;
  const url = `http://localhost:${port}`;

  const step = (name, state, extra = '') =>
    console.log('[%s] %s%s', state, name, extra ? ' — ' + extra : '');

  // 步骤 1：确保输入目录存在（R6.2）
  step('准备输入目录', '进行中');
  const inputDir = ensureInputDir(packageRoot);
  step('准备输入目录', '已完成');

  // 步骤 2：空输入守卫（R6.3）——无 .txt 则提示并停止，不创建任何输出
  step('检查输入图纸', '进行中');
  if (!hasTxtInputs(inputDir)) {
    step('检查输入图纸', '失败');
    console.error('未在 input_txt/ 中找到任何 .txt 图纸。');
    console.error('请先把 .txt 图纸放入 input_txt/ 文件夹，然后重新双击启动入口。');
    return { ok: false, reason: 'empty_input' };
  }
  step('检查输入图纸', '已完成');

  // 步骤 3：端口占用检查（R5.6）——3000 已被他人监听则提示并停止
  step('检查端口占用', '进行中');
  if (await isPortInUse(port)) {
    step('检查端口占用', '失败');
    console.error('端口 %d 已被占用，无法启动后端。', port);
    console.error('请关闭占用该端口的已有进程后重试（例如已在运行的本工具或其它服务），然后重新双击启动入口。');
    return { ok: false, reason: 'port_in_use' };
  }
  step('检查端口占用', '已完成');

  // 步骤 4：启动 Web_Server（R5.1）
  step('启动后端服务', '进行中');
  let child;
  try {
    child = startServer(nodePath, packageRoot);
  } catch (err) {
    step('启动后端服务', '失败');
    console.error('启动后端进程失败：%s', err && err.message ? err.message : String(err));
    console.error('建议：确认 server.js 存在且 node 运行时可用，然后重新双击启动入口。');
    return { ok: false, reason: 'spawn_failed' };
  }

  // 监听子进程在端口就绪前的异常退出（含 EADDRINUSE / 启动失败）
  let earlyExit = null;
  const onEarlyExit = (code, signal) => {
    earlyExit = { code, signal };
  };
  child.once('exit', onEarlyExit);

  // 步骤 5：等待端口进入监听（R5.1/R5.3）
  step('等待后端就绪', '进行中');
  const ready = await waitForPort(port, waitTimeoutMs);
  child.removeListener('exit', onEarlyExit);

  if (!ready) {
    step('等待后端就绪', '失败');
    if (earlyExit) {
      const reason = earlyExit.signal ? `信号 ${earlyExit.signal}` : `退出码 ${earlyExit.code}`;
      console.error('后端进程在就绪前异常退出（%s）。', reason);
      console.error('若提示端口被占用（EADDRINUSE），请关闭占用 %d 端口的进程后重试。', port);
    } else {
      console.error('后端在 %d 秒内未进入监听状态。', Math.round(waitTimeoutMs / 1000));
      console.error('建议：稍后重试；若反复失败，请确认 server.js 能正常启动。');
    }
    try { child.kill(); } catch (_) { /* 忽略 */ }
    return { ok: false, reason: earlyExit ? 'server_exited' : 'timeout', child };
  }
  step('等待后端就绪', '已完成');

  // 步骤 6：打开浏览器（R5.2，端口就绪后立即调用，远小于 2s）
  step('打开浏览器', '进行中');
  openBrowser(url, os);
  step('打开浏览器', '已完成', url);

  // 步骤 7：保活 + 心跳（R5.4/R5.5）
  step('保持后端运行', '进行中');
  const hb = heartbeat(child);
  console.log('后端已就绪：%s（关闭本窗口即可停止后端）', url);

  return { ok: true, child, heartbeatHandle: hb };
}

module.exports = {
  ensureInputDir,
  hasTxtInputs,
  isPortInUse,
  startServer,
  waitForPort,
  openBrowser,
  heartbeat,
  main,
  PRODUCTION_PORT,
};

// 仅当作为入口被直接执行时运行主流程；被 require 时不产生副作用。
if (require.main === module) {
  main().catch((err) => {
    console.error('启动器发生未识别错误：%s', err && err.stack ? err.stack : String(err));
    console.error('建议：重试启动；若反复失败，请联系支持并附上以上错误信息。');
    process.exitCode = 1;
  });
}
