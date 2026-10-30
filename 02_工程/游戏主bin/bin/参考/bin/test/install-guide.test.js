'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');

const { buildInstallGuide } = require('../lib/launcher-core.js');

const NUM_RUNS = 200;
const NODE_DOWNLOAD_URL = 'https://nodejs.org/zh-cn/download';
const RESTART_HINT = '安装完成后重新双击';

// Feature: foolproof-launcher, Property 4: For any 受支持的操作系统 os ∈ {macos, windows}，buildInstallGuide(os) 返回的文本同时包含：Node 下载地址 https://nodejs.org/zh-cn/download、最低主版本号 18、与该 OS 匹配的安装包类型（macOS 为 .pkg、Windows 为 .msi）、以及"安装完成后重新双击对应入口"的重启动说明。
// Validates: Requirements 8.2, 8.3, 8.4, 8.5
test('Property 4: buildInstallGuide 包含 URL、18、匹配的安装包类型与重启动说明', () => {
  fc.assert(
    fc.property(fc.constantFrom('macos', 'windows'), (os) => {
      const guide = buildInstallGuide(os);

      assert.ok(typeof guide === 'string' && guide.length > 0, '指引应为非空字符串');
      assert.ok(guide.includes(NODE_DOWNLOAD_URL), '应包含 Node 下载地址');
      assert.ok(guide.includes('18'), '应包含最低主版本号 18');
      assert.ok(guide.includes(RESTART_HINT), '应包含重启动说明');

      if (os === 'macos') {
        assert.ok(guide.includes('.pkg'), 'macOS 指引应包含 .pkg');
        assert.ok(!guide.includes('.msi'), 'macOS 指引不应包含 .msi');
      } else {
        assert.ok(guide.includes('.msi'), 'Windows 指引应包含 .msi');
        assert.ok(!guide.includes('.pkg'), 'Windows 指引不应包含 .pkg');
      }
    }),
    { numRuns: NUM_RUNS }
  );
});

test('示例：macOS 与 Windows 指引内容', () => {
  const mac = buildInstallGuide('macos');
  assert.ok(mac.includes('.pkg'));
  assert.ok(mac.includes(NODE_DOWNLOAD_URL));
  assert.ok(mac.includes('18'));
  assert.ok(mac.includes(RESTART_HINT));

  const win = buildInstallGuide('windows');
  assert.ok(win.includes('.msi'));
  assert.ok(win.includes(NODE_DOWNLOAD_URL));
  assert.ok(win.includes('18'));
  assert.ok(win.includes(RESTART_HINT));
});
