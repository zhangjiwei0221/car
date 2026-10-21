#!/usr/bin/env node
'use strict';
/**
 * 蚂蚁拿块 · 生产器启动器（跨平台，纯 Node）
 * ------------------------------------------------------------------
 * 用法（在项目根目录或任意目录都行）：
 *     node 网页启动器/启动.js
 *     node 网页启动器/启动.js 8123      ← 指定端口
 *
 * 为什么有这个文件：原来只有 macOS 的 .command 双击入口，换电脑后常见三种拉不起来的情况——
 *   ① 传输过程丢了执行权限(+x)，双击没反应；
 *   ② macOS 隔离属性(com.apple.quarantine)拦下"身份不明的开发者"；
 *   ③ 目标机器是 Windows，.command 根本不会执行。
 * 本文件用 `node 脚本` 方式运行：不需要执行权限、不触发 Gatekeeper、三大平台通用。
 *
 * 为什么必须用 http 打开页面（而不是双击 bin/index.html）：
 *   · file:// 下浏览器禁用 Web Worker → 批量生产退回主线程，界面卡、"停止"不即时生效；
 *   · file:// 下没有落库服务 → 只能整批跑完点 ZIP 下载，浏览器崩溃就丢掉全部已完成关卡。
 *   用 http 打开才能"每关生产完立刻写盘"。
 */
const path = require('path');
const fs = require('fs');
const net = require('net');
const os = require('os');
const { spawn } = require('child_process');

const HERE = __dirname;
const ROOT = path.resolve(HERE, '..');
const SERVICE = path.join(HERE, '生产服务.js');
const PAGE_REL = 'bin/index.html';

function die(msg, hint) {
  console.error('\n✗ ' + msg);
  if (hint) console.error('  ' + hint);
  console.error('\n可以先跑一次自检看具体原因：\n    node "' + path.join(HERE, '自检.js') + '"\n');
  process.exit(1);
}

// ---------- 1. 关键文件检查 ----------
if (!fs.existsSync(SERVICE)) {
  die('找不到本地生产服务：' + SERVICE, '请确认 网页启动器/生产服务.js 一起拷过来了。');
}
if (!fs.existsSync(path.join(ROOT, PAGE_REL))) {
  die('找不到生产器页面：' + path.join(ROOT, PAGE_REL), '请确认 bin/ 目录完整。');
}

// ---------- 2. 选端口 ----------
// 指定了端口就只试这一个（占用则明确报错，不静默换端口，避免用户开着旧页面对着新端口发懵）；
// 没指定就从 8000 起找第一个空闲端口。
const wanted = parseInt(process.argv[2] || process.env.ANT_PORT || '', 10);

function probe(port) {
  return new Promise(function (resolve) {
    const srv = net.createServer();
    srv.once('error', function () { resolve(false); });
    srv.once('listening', function () { srv.close(function () { resolve(true); }); });
    srv.listen(port, '127.0.0.1');
  });
}

async function pickPort() {
  if (wanted) {
    if (await probe(wanted)) return wanted;
    die('端口 ' + wanted + ' 已被占用。', '换一个端口：node "网页启动器/启动.js" 8123');
  }
  // 每次启动随机挑一个空闲端口：端口变 → localhost:端口 这个 origin 变 →
  //   Safari 上旧端口的缓存碰不到（等于每次都在没有旧缓存的干净端口上跑）。
  //   从范围内随机起点开始，环绕扫描第一个空闲端口。
  const BASE = 8000, SPAN = 61;   // 8000..8060
  const start = BASE + Math.floor(Math.random() * SPAN);
  for (let i = 0; i < SPAN; i++) {
    const p = BASE + ((start - BASE + i) % SPAN);
    if (await probe(p)) return p;
  }
  die('8000-8060 全部被占用。', '手动指定一个端口：node "网页启动器/启动.js" 8123');
}

// ---------- 3. 打开浏览器（按平台） ----------
function openBrowser(url) {
  const plat = process.platform;
  const opts = { stdio: 'ignore', detached: true };
  function fallbackDefault() {
    // 回退默认浏览器
    try {
      const cmd = plat === 'darwin' ? 'open' : (plat === 'win32' ? 'cmd' : 'xdg-open');
      const args = plat === 'win32' ? ['/c', 'start', '', url] : [url];
      spawn(cmd, args, opts).unref();
    } catch (e) {
      console.log('  （自动打开浏览器失败，请手动复制上面的地址到浏览器）');
    }
  }
  // macOS：优先用 Chrome 打开 —— Safari 对 localhost:端口 有顽固缓存，导入功能会加载到旧版本；
  //   Chrome 没装（open -a 返回非 0）则回退默认浏览器。
  if (plat === 'darwin') {
    try {
      const c = spawn('open', ['-a', 'Google Chrome', url], opts);
      c.on('exit', function (code) { if (code) fallbackDefault(); });
      c.on('error', fallbackDefault);
      c.unref();
    } catch (e) { fallbackDefault(); }
    return;
  }
  // Windows/Linux：保持默认浏览器（用户环境为 macOS，Chrome 定向只针对 darwin）
  fallbackDefault();
}

// ---------- 4. 起服务 ----------
(async function main() {
  const port = await pickPort();
  const url = 'http://localhost:' + port + '/' + PAGE_REL;

  console.log('──────────────────────────────────────────────');
  console.log('  蚂蚁拿块 · 生产器本地服务（逐关落库）');
  console.log('  平台：  ' + process.platform + ' / Node ' + process.version);
  console.log('  项目根：' + ROOT);
  console.log('  地址：  ' + url);
  console.log('  输出：  输出文件/<批次名>-月-日/（每关即时写盘）');
  console.log('  关闭：  在本窗口按 Control + C');
  console.log('──────────────────────────────────────────────');
  console.log();

  // 用当前 node 自己拉起服务：不依赖 PATH 里有没有 node，换机器最稳
  const child = spawn(process.execPath, [SERVICE, String(port)], {
    cwd: ROOT,
    stdio: 'inherit'
  });

  child.on('error', function (e) {
    die('启动生产服务失败：' + e.message);
  });
  child.on('exit', function (code, signal) {
    if (signal) { console.log('\n生产服务已停止（' + signal + '）'); process.exit(0); }
    if (code !== 0) {
      console.error('\n✗ 生产服务异常退出（退出码 ' + code + '）。');
      console.error('  常见原因：端口在启动瞬间被别的程序抢占。重试一次，或指定端口：');
      console.error('      node "' + path.join('网页启动器', '启动.js') + '" 8123');
      process.exit(code || 1);
    }
    process.exit(0);
  });

  // 服务起来后再开浏览器；轮询探测端口，避免固定 sleep 在慢机器上开太早
  let tries = 0;
  (function waitReady() {
    tries++;
    const s = net.connect({ host: '127.0.0.1', port: port }, function () {
      s.destroy();
      openBrowser(url);
    });
    s.on('error', function () {
      if (tries > 60) {   // 约 6 秒
        console.log('  （服务迟迟未就绪，未自动打开浏览器；请手动访问上面的地址）');
        return;
      }
      setTimeout(waitReady, 100);
    });
  })();

  function shutdown() {
    console.log('\n正在停止生产服务…');
    try { child.kill(); } catch (e) { }
    setTimeout(function () { process.exit(0); }, 300);
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
})();
