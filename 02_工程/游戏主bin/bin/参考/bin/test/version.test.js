'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');

const {
  parseNodeMajor,
  isNodeSupported,
  NODE_VERSION_FLOOR,
} = require('../lib/launcher-core.js');

const NUM_RUNS = 200;

// Feature: foolproof-launcher, Property 1: For any 形如 v{M}.{m}.{p} 的合法版本字符串（M、m、p 为非负整数，允许前后空白/换行），parseNodeMajor 返回的主版本恰为 M，且 isNodeSupported(parseNodeMajor(s)) 当且仅当 M >= 18 为真。
// Validates: Requirements 3.1, 3.2, 3.3
test('Property 1: parseNodeMajor 提取主版本且 isNodeSupported 当且仅当 M>=18', () => {
  // 智能生成器：随机非负整数三元组，并在版本串前后随机加入空白/换行边界。
  const wsArb = fc.constantFrom('', ' ', '\n', '\t', '  ', '\r\n', ' \n ');
  fc.assert(
    fc.property(
      fc.nat({ max: 1000 }),
      fc.nat({ max: 1000 }),
      fc.nat({ max: 1000 }),
      wsArb,
      wsArb,
      (M, m, p, lead, trail) => {
        const s = `${lead}v${M}.${m}.${p}${trail}`;
        const parsed = parseNodeMajor(s);
        assert.equal(parsed, M, `应解析出主版本 ${M}，实际 ${parsed}（输入 ${JSON.stringify(s)}）`);
        assert.equal(
          isNodeSupported(parsed),
          M >= NODE_VERSION_FLOOR,
          `isNodeSupported 应当且仅当 M>=${NODE_VERSION_FLOOR} 为真（M=${M}）`
        );
      }
    ),
    { numRuns: NUM_RUNS }
  );
});

// Feature: foolproof-launcher, Property 1: 非法版本串（不形如 v{M}.{m}.{p}）应返回 null。
// Validates: Requirements 3.1, 3.2, 3.3
test('Property 1: 非法版本串返回 null', () => {
  // 生成不含版本三元组结构的任意字符串。
  fc.assert(
    fc.property(fc.string(), (s) => {
      // 仅断言那些确实不匹配版本前缀的字符串返回 null。
      if (!/^\s*v?\d+\.\d+\.\d+/.test(s)) {
        assert.equal(parseNodeMajor(s), null, `非法串应返回 null：${JSON.stringify(s)}`);
      }
    }),
    { numRuns: NUM_RUNS }
  );
});

// 边界示例单元测试（Task 2.9）
// _Requirements: 3.1, 3.2, 3.3_
test('边界：v18.0.0 恰好门槛应支持', () => {
  const major = parseNodeMajor('v18.0.0');
  assert.equal(major, 18);
  assert.equal(isNodeSupported(major), true);
});

test('边界：v17.9.9 低于门槛不支持', () => {
  const major = parseNodeMajor('v17.9.9');
  assert.equal(major, 17);
  assert.equal(isNodeSupported(major), false);
});

test('边界：空字符串返回 null', () => {
  assert.equal(parseNodeMajor(''), null);
  assert.equal(isNodeSupported(parseNodeMajor('')), false);
});

test('边界："node: command not found" 返回 null', () => {
  assert.equal(parseNodeMajor('node: command not found'), null);
  assert.equal(isNodeSupported(parseNodeMajor('node: command not found')), false);
});

test('边界：容忍前后空白与换行 "  v22.11.0\\n"', () => {
  assert.equal(parseNodeMajor('  v22.11.0\n'), 22);
  assert.equal(isNodeSupported(22), true);
});
