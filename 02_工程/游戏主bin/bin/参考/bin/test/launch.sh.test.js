'use strict';

/**
 * 任务 7.2：launch.sh 静态校验测试（grep + 可解析性）
 * _Requirements: 4.1, 8.1, 8.2_
 *
 * launch.sh 属于第 1 层 shell 引导（不依赖 node），无法用纯函数单测覆盖其副作用，
 * 故以「静态文本断言 + bash -n 语法可解析性」方式验证其关键契约：
 *   - 内嵌 macOS 安装指引关键串（下载地址、.pkg、入口名、最低主版本 18）（R8.1/8.2）
 *   - 使用 `tar -xJf` 解压便携 Node 归档（R4.1）
 *   - 存在带 5s 上限的系统 node 版本探测（R3 系统 Node 检测）
 *   - 引用便携 Node 资产目录 `.node-portable/`（R4.1）
 *   - 通过 `bash -n` 语法检查（脚本可被 shell 正确解析）
 *
 * 本测试只读脚本文本、并调用 `bash -n` 做语法检查，不执行脚本本体，hermetic 且快。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SCRIPT_PATH = path.join(__dirname, '..', 'launch.sh');
const SOURCE = fs.readFileSync(SCRIPT_PATH, 'utf8');

test('launch.sh 内嵌 macOS 安装指引关键串（R8.1/8.2）', () => {
  assert.match(SOURCE, /https:\/\/nodejs\.org\/zh-cn\/download/, '应包含 Node 官方下载地址');
  assert.match(SOURCE, /\.pkg/, '应包含 macOS 安装包类型 .pkg');
  assert.match(SOURCE, /启动_Mac\.command/, '应引用 macOS 双击入口名');
  assert.match(SOURCE, /(^|[^0-9])18([^0-9]|$)/m, '应包含最低主版本 18');
});

test('launch.sh 使用 tar -xJf 解压便携 Node 归档（R4.1）', () => {
  assert.match(SOURCE, /tar\s+-xJf/, '应使用 tar -xJf 解压 .tar.xz 归档');
});

test('launch.sh 存在带 5s 上限的 node 版本探测（R3）', () => {
  // 5s 上限通过通用超时包装实现：run_with_timeout 5 node -v
  assert.match(SOURCE, /run_with_timeout\s+5\s+node\s+-v/, '应以 5s 上限探测系统 node 版本');
});

test('launch.sh 引用便携 Node 资产路径 .node-portable/（R4.1）', () => {
  assert.match(SOURCE, /\.node-portable\//, '应引用便携 Node 资产目录 .node-portable/');
  assert.match(SOURCE, /node\.tar\.xz/, '应引用便携 Node 归档文件名');
});

test('launch.sh 通过 bash -n 语法检查（可被 shell 正确解析）', () => {
  // bash -n 仅做语法解析、不执行脚本副作用；解析失败会抛出非零退出码。
  assert.doesNotThrow(() => {
    execFileSync('bash', ['-n', SCRIPT_PATH], { stdio: 'pipe' });
  }, 'launch.sh 应能通过 bash -n 语法检查');
});
