'use strict';

/**
 * 任务 10.2：打包冒烟测试
 * _Requirements: 1.1, 4.1_
 *
 * 一次性配置检查（不做 100 次迭代）：
 *   - bin 下存在 .node-portable/node.tar.xz（R4.1，便携 Node 已随包分发）
 *   - `tar -tJf` 顶层目录为 node-v22.11.0-darwin-arm64/ 且含 bin/node（R4.1）
 *   - 包根恰好存在一个 .command 与一个根级 .bat 双击入口（R1.1）
 *   - .command 具可执行权限（R1.1 / 双击即执行）
 *
 * 测试只读文件系统与运行只读的 `tar -tJf`，hermetic 且快。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// 测试位于 bin/test/：bin/ 为代码根，其上一级为包根（含双击入口）
const BIN_ROOT = path.resolve(__dirname, '..');
const PACKAGE_ROOT = path.resolve(__dirname, '..', '..');
const ARCHIVE_PATH = path.join(BIN_ROOT, '.node-portable', 'node.tar.xz');
const EXPECTED_TOP_DIR = 'node-v22.11.0-darwin-arm64';

test('bin 下存在 .node-portable/node.tar.xz（R4.1）', () => {
  assert.strictEqual(fs.existsSync(ARCHIVE_PATH), true, '便携 Node 归档应随包分发于 bin/.node-portable/');
});

test('归档顶层目录为 node-v22.11.0-darwin-arm64/ 且含 bin/node（R4.1）', () => {
  const listing = execFileSync('tar', ['-tJf', ARCHIVE_PATH], { encoding: 'utf8' });
  const entries = listing.split('\n').filter(Boolean);

  // 顶层目录存在
  assert.ok(
    entries.some((e) => e === `${EXPECTED_TOP_DIR}/` || e.startsWith(`${EXPECTED_TOP_DIR}/`)),
    `归档应含顶层目录 ${EXPECTED_TOP_DIR}/`
  );
  // 顶层目录下含 bin/node 可执行文件
  assert.ok(
    entries.includes(`${EXPECTED_TOP_DIR}/bin/node`),
    `归档应含 ${EXPECTED_TOP_DIR}/bin/node`
  );
});

test('包根恰好一个 .command 与一个根级 .bat 双击入口（R1.1）', () => {
  const rootEntries = fs.readdirSync(PACKAGE_ROOT, { withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => d.name);

  const commands = rootEntries.filter((n) => n.toLowerCase().endsWith('.command'));
  const bats = rootEntries.filter((n) => n.toLowerCase().endsWith('.bat'));

  assert.strictEqual(commands.length, 1, `包根应恰好一个 .command 入口，实际：${commands.join(', ') || '无'}`);
  assert.strictEqual(bats.length, 1, `包根应恰好一个根级 .bat 入口，实际：${bats.join(', ') || '无'}`);
});

test('.command 入口具可执行权限（R1.1）', () => {
  const command = fs.readdirSync(PACKAGE_ROOT)
    .find((n) => n.toLowerCase().endsWith('.command'));
  assert.ok(command, '应存在 .command 入口');

  const st = fs.statSync(path.join(PACKAGE_ROOT, command));
  // 任一执行位（owner/group/other）置位即视为可执行
  const anyExec = (st.mode & 0o111) !== 0;
  assert.strictEqual(anyExec, true, `${command} 应具可执行权限（mode=${(st.mode & 0o777).toString(8)}）`);
});
