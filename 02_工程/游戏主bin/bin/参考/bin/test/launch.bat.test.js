'use strict';

/**
 * 任务 8.2：launch.bat 静态校验测试（grep）
 * _Requirements: 8.3_
 *
 * launch.bat 属于第 1 层 Windows 引导（批处理，不在本机执行），以静态文本断言
 * 验证其关键契约：
 *   - 内嵌 Windows 安装指引关键串（下载地址、.msi、入口名）（R8.3）
 *   - `chcp 65001` 切换 UTF-8 代码页以正确显示中文
 *   - `%PROCESSOR_ARCHITECTURE%` 架构探测
 *   - 结尾 `pause` 保持窗口（R7.2/R8.6）
 *
 * 本测试只读脚本文本，不执行批处理，hermetic 且快。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SCRIPT_PATH = path.join(__dirname, '..', 'launch.bat');
const SOURCE = fs.readFileSync(SCRIPT_PATH, 'utf8');

test('launch.bat 内嵌 Windows 安装指引关键串（R8.3）', () => {
  assert.match(SOURCE, /https:\/\/nodejs\.org\/zh-cn\/download/, '应包含 Node 官方下载地址');
  assert.match(SOURCE, /\.msi/, '应包含 Windows 安装包类型 .msi');
  assert.match(SOURCE, /启动_Windows\.bat/, '应引用 Windows 双击入口名');
});

test('launch.bat 使用 chcp 65001 切换 UTF-8 代码页', () => {
  assert.match(SOURCE, /chcp\s+65001/, '应使用 chcp 65001 以正确显示中文');
});

test('launch.bat 使用 %PROCESSOR_ARCHITECTURE% 探测架构', () => {
  assert.match(SOURCE, /%PROCESSOR_ARCHITECTURE%/, '应通过 %PROCESSOR_ARCHITECTURE% 探测 CPU 架构');
});

test('launch.bat 含 pause 以保持窗口不自动关闭（R7.2/R8.6）', () => {
  assert.match(SOURCE, /\bpause\b/, '应在停止/指引分支使用 pause 保持窗口');
});
