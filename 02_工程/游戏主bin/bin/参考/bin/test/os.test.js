'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');

const { classifyOS, pathSep } = require('../lib/launcher-core.js');

const NUM_RUNS = 200;

// Feature: foolproof-launcher, Property 2: For any 平台标识字符串，classifyOS 恰好返回 macos、windows、unsupported 三者之一；其结果为 macos 当且仅当输入为 darwin，为 windows 当且仅当输入为 win32，否则为 unsupported；且对应的 pathSep 在 macOS 为 / 、在 Windows 为 \。
// Validates: Requirements 2.1, 2.2, 2.3, 2.4
test('Property 2: classifyOS 完备且正确，pathSep 与之匹配', () => {
  // 生成器：偏向 darwin/win32 关键值，并混入任意随机字符串覆盖 unsupported。
  const platformArb = fc.oneof(
    fc.constantFrom('darwin', 'win32'),
    fc.string()
  );
  fc.assert(
    fc.property(platformArb, (platform) => {
      const result = classifyOS(platform);

      // 完备：恰好三态之一。
      assert.ok(
        result === 'macos' || result === 'windows' || result === 'unsupported',
        `结果必为三态之一，实际 ${result}`
      );

      // 正确：macos ⇔ darwin，windows ⇔ win32。
      assert.equal(result === 'macos', platform === 'darwin');
      assert.equal(result === 'windows', platform === 'win32');
      assert.equal(
        result === 'unsupported',
        platform !== 'darwin' && platform !== 'win32'
      );

      // pathSep 与分类匹配。
      if (result === 'macos') {
        assert.equal(pathSep(result), '/');
      } else if (result === 'windows') {
        assert.equal(pathSep(result), '\\');
      }
    }),
    { numRuns: NUM_RUNS }
  );
});

test('示例：classifyOS 与 pathSep 关键取值', () => {
  assert.equal(classifyOS('darwin'), 'macos');
  assert.equal(classifyOS('win32'), 'windows');
  assert.equal(classifyOS('linux'), 'unsupported');
  assert.equal(pathSep('macos'), '/');
  assert.equal(pathSep('windows'), '\\');
});
