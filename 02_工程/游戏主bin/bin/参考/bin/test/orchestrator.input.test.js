'use strict';

/**
 * 任务 5.2：ensureInputDir / hasTxtInputs 单元测试
 * _Requirements: 6.2, 6.3_
 *
 * 示例/边界测试（非属性测试），使用临时目录，断言：
 *  - input_txt 缺失时被创建（R6.2）
 *  - 空目录 / 缺失目录 → hasTxtInputs 为 false（R6.3 停止分支前置条件）
 *  - 含 .txt 时 hasTxtInputs 为 true
 *  - 空输入场景下不产生任何输出文件
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { ensureInputDir, hasTxtInputs } = require('../orchestrator');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fpl-input-'));
}

test('ensureInputDir 在 input_txt 缺失时创建该目录（R6.2）', () => {
  const root = mkTmp();
  try {
    const inputDir = path.join(root, 'input_txt');
    assert.strictEqual(fs.existsSync(inputDir), false, '前置：目录尚不存在');

    const returned = ensureInputDir(root);

    assert.strictEqual(returned, inputDir);
    assert.strictEqual(fs.existsSync(inputDir), true, '应已创建 input_txt');
    assert.strictEqual(fs.statSync(inputDir).isDirectory(), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ensureInputDir 在目录已存在时保持幂等', () => {
  const root = mkTmp();
  try {
    const inputDir = ensureInputDir(root);
    // 放一个文件确认不被清空
    fs.writeFileSync(path.join(inputDir, 'keep.txt'), 'x');
    const again = ensureInputDir(root);
    assert.strictEqual(again, inputDir);
    assert.strictEqual(fs.existsSync(path.join(inputDir, 'keep.txt')), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('hasTxtInputs 对空目录返回 false（R6.3）', () => {
  const root = mkTmp();
  try {
    const inputDir = ensureInputDir(root);
    assert.strictEqual(hasTxtInputs(inputDir), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('hasTxtInputs 对缺失目录返回 false', () => {
  const root = mkTmp();
  try {
    const missing = path.join(root, 'does-not-exist');
    assert.strictEqual(hasTxtInputs(missing), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('hasTxtInputs 在存在 .txt 时返回 true（大小写不敏感）', () => {
  const root = mkTmp();
  try {
    const inputDir = ensureInputDir(root);
    fs.writeFileSync(path.join(inputDir, '图纸A.TXT'), 'data');
    assert.strictEqual(hasTxtInputs(inputDir), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('hasTxtInputs 仅有非 .txt 文件时返回 false', () => {
  const root = mkTmp();
  try {
    const inputDir = ensureInputDir(root);
    fs.writeFileSync(path.join(inputDir, 'readme.md'), 'data');
    fs.writeFileSync(path.join(inputDir, 'data.json'), '{}');
    assert.strictEqual(hasTxtInputs(inputDir), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('空输入场景：ensureInputDir 后不产生任何输出文件', () => {
  const root = mkTmp();
  try {
    const inputDir = ensureInputDir(root);
    // 仅创建输入目录这一步，不应有任何其它产物
    assert.strictEqual(hasTxtInputs(inputDir), false);
    const rootEntries = fs.readdirSync(root);
    assert.deepStrictEqual(rootEntries, ['input_txt'], '包根下只应有 input_txt');
    assert.deepStrictEqual(fs.readdirSync(inputDir), [], 'input_txt 内应为空');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
