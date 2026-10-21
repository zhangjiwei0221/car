#!/usr/bin/env node
'use strict';
/**
 * 蚂蚁拿块 · 启动环境自检
 * 用法：node 网页启动器/自检.js
 *
 * 换电脑后拉不起网页时先跑这个：它只做检查、不改任何文件，
 * 最后直接告诉你下一步该敲什么命令。
 */
const path = require('path');
const fs = require('fs');
const net = require('net');
const { execSync } = require('child_process');

const HERE = __dirname;
const ROOT = path.resolve(HERE, '..');
let problems = [];
let notes = [];

function ok(label, detail) { console.log('  ✓ ' + label + (detail ? '　' + detail : '')); }
function bad(label, detail, fix) {
  console.log('  ✗ ' + label + (detail ? '　' + detail : ''));
  problems.push({ label: label, fix: fix });
}
function warn(label, detail) { console.log('  ! ' + label + (detail ? '　' + detail : '')); notes.push(label); }

console.log('══════════════════════════════════════════════');
console.log('  蚂蚁拿块 · 启动环境自检');
console.log('══════════════════════════════════════════════\n');

// ---------- 1. 运行环境 ----------
console.log('【1】运行环境');
const major = parseInt(process.version.replace(/^v/, '').split('.')[0], 10);
if (major >= 14) ok('Node.js ' + process.version);
else bad('Node.js 版本过低：' + process.version, '建议 v14 以上', '去 https://nodejs.org/ 装新版 Node');
ok('操作系统', process.platform + ' (' + process.arch + ')');
ok('Node 可执行文件', process.execPath);

// ---------- 2. 关键文件 ----------
console.log('\n【2】关键文件');
const need = [
  ['网页启动器/生产服务.js', path.join(HERE, '生产服务.js')],
  ['网页启动器/启动.js', path.join(HERE, '启动.js')],
  ['bin/index.html', path.join(ROOT, 'bin', 'index.html')],
  ['bin/js/app.js', path.join(ROOT, 'bin', 'js', 'app.js')],
  ['bin/js/generator.js', path.join(ROOT, 'bin', 'js', 'generator.js')]
];
need.forEach(function (n) {
  if (fs.existsSync(n[1])) ok(n[0]);
  else bad('缺失 ' + n[0], '', '把该文件/目录补齐后重试（整个工作区一起拷贝）');
});

// ---------- 3. 端口 ----------
console.log('\n【3】端口可用性（8000-8010 抽查）');
function probe(port) {
  return new Promise(function (resolve) {
    const srv = net.createServer();
    srv.once('error', function () { resolve(false); });
    srv.once('listening', function () { srv.close(function () { resolve(true); }); });
    srv.listen(port, '127.0.0.1');
  });
}

// ---------- 4. macOS 专项：执行权限与隔离属性 ----------
function macChecks() {
  console.log('\n【4】macOS 专项（.command 双击入口）');
  const cmdFile = path.join(HERE, '启动生产器(http).command');
  if (!fs.existsSync(cmdFile)) { warn('没有 .command 文件', '不影响，用 node 启动即可'); return; }
  // 执行权限
  try {
    fs.accessSync(cmdFile, fs.constants.X_OK);
    ok('.command 有执行权限');
  } catch (e) {
    bad('.command 丢了执行权限', '（传输过程常见）',
      'chmod +x "' + cmdFile + '"');
  }
  // 隔离属性
  try {
    const out = execSync('xattr "' + cmdFile + '" 2>/dev/null', { encoding: 'utf8' });
    if (/com\.apple\.quarantine/.test(out)) {
      bad('.command 带 macOS 隔离属性', '双击会报"来自身份不明的开发者"',
        'xattr -d com.apple.quarantine "' + cmdFile + '"');
    } else ok('.command 无隔离属性');
  } catch (e) {
    warn('无法读取扩展属性', '跳过该项检查');
  }
}

(async function main() {
  for (const p of [8000, 8001, 8002, 8010]) {
    const free = await probe(p);
    if (free) ok('端口 ' + p + ' 空闲');
    else warn('端口 ' + p + ' 被占用', '启动器会自动跳过被占端口');
  }
  const anyFree = (await Promise.all([8000, 8001, 8002, 8003, 8004].map(probe))).some(Boolean);
  if (!anyFree) bad('8000-8004 全被占用', '', '指定别的端口：node "网页启动器/启动.js" 8123');

  if (process.platform === 'darwin') macChecks();
  else console.log('\n【4】macOS 专项：跳过（当前不是 macOS）');

  // ---------- 结论 ----------
  console.log('\n══════════════════════════════════════════════');
  if (!problems.length) {
    console.log('  结论：环境正常，可以直接启动。');
    console.log('══════════════════════════════════════════════\n');
    console.log('推荐启动方式（跨平台、不需要执行权限）：\n');
    console.log('    cd "' + ROOT + '"');
    console.log('    node "网页启动器/启动.js"\n');
    console.log('启动后浏览器会自动打开 http://localhost:<端口>/bin/index.html');
    console.log('若没自动打开，把终端里打印的地址手动复制到浏览器即可。\n');
    console.log('⚠ 不要直接双击 bin/index.html —— file:// 下浏览器禁用 Web Worker，');
    console.log('  批量生产会退回主线程（界面卡、"停止"不即时），也没有逐关落库服务。\n');
  } else {
    console.log('  结论：发现 ' + problems.length + ' 个问题，按下面处理：');
    console.log('══════════════════════════════════════════════\n');
    problems.forEach(function (p, i) {
      console.log((i + 1) + '. ' + p.label);
      if (p.fix) console.log('   处理：' + p.fix);
    });
    console.log('\n处理完再跑一次本自检。');
    console.log('提示：即使 .command 双击不可用，也可以直接用命令启动，不受权限与隔离属性影响：\n');
    console.log('    cd "' + ROOT + '"');
    console.log('    node "网页启动器/启动.js"\n');
  }
  if (notes.length) console.log('（另有 ' + notes.length + ' 条提示，不阻塞启动）\n');
})();
