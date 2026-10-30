'use strict';

/**
 * 任务 11.4：Windows 无 node 降级路径（静态）
 * _Requirements: 8.1, 8.3_
 *
 * 已知限制：包内便携 Node 仅含 macOS 二进制，Windows 无系统 node 时只能降级到安装指引。
 * launch.bat 不在本机执行，以静态文本断言验证其降级降落契约：
 *   - 便携流程在 Windows 上直接判定不可用并转向安装指引（goto :install_guide）（R8.1）
 *   - 安装指引分支写出 如何安装Node.js.txt（R8.7，降级可查阅）
 *   - 安装指引发射逻辑（:emit_guide）输出 Windows 指引正文（R8.3）
 *
 * 本测试只读脚本文本，不执行批处理，hermetic 且快。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'launch.bat'), 'utf8');

test('launch.bat 在无可用 node 时转向安装指引标签（R8.1）', () => {
  // 便携流程分支直接转入安装指引
  assert.match(SOURCE, /goto :install_guide/, '应在无可用 node 时 goto :install_guide');
  assert.match(SOURCE, /:install_guide/, '应定义 :install_guide 标签');
});

test('launch.bat 安装指引分支写出 如何安装Node.js.txt（R8.7）', () => {
  // 将指引发射重定向写入文件，供窗口关闭后查阅
  assert.match(SOURCE, /如何安装Node\.js\.txt/, '应写出 如何安装Node.js.txt 指引文件');
  assert.match(
    SOURCE,
    /call :emit_guide\s*>\s*"如何安装Node\.js\.txt"/,
    '应通过 :emit_guide 重定向写入指引文件'
  );
});

test('launch.bat 含 Windows 安装指引发射逻辑（:emit_guide）（R8.3）', () => {
  assert.match(SOURCE, /:emit_guide/, '应定义 :emit_guide 子过程输出指引正文');
  // 指引正文关键串
  assert.match(SOURCE, /https:\/\/nodejs\.org\/zh-cn\/download/, '指引应含下载地址');
  assert.match(SOURCE, /\.msi/, '指引应含 Windows 安装包类型 .msi');
});
