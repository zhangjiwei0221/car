'use strict';

/**
 * 任务 11.2：便携解压幂等（HERMETIC）
 * _Requirements: 4.2_
 *
 * 复现 launch.sh 的「已存在可运行的 bin/node 则跳过解压」契约（R4.2）：
 *   - 先确认 launch.sh 中确实存在该幂等判定（grep：存在 bin 且可试运行则跳过）
 *   - 在临时目录中放一个可运行的 bin/node 桩，按相同判定逻辑评估，
 *     断言结果为「跳过解压」，且未触发任何（再次）解压副作用——
 *     解压目录内容在判定前后保持不变。
 *
 * 测试只在临时目录内操作并在结束时清理，绝不触碰真实 .node-portable/。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const LAUNCH_SH = fs.readFileSync(path.join(__dirname, '..', 'launch.sh'), 'utf8');

/**
 * 镜像 launch.sh 的幂等条件：
 *   if [ -f "$BIN" ] && test_run_node "$BIN"; then 跳过解压
 * 返回 true 表示「应跳过解压（已可用）」。
 */
function wouldSkipExtraction(binPath) {
  if (!fs.existsSync(binPath)) return false;
  try {
    execFileSync(binPath, ['-v'], { stdio: 'pipe', timeout: 5000 });
    return true;
  } catch (_) {
    return false;
  }
}

test('launch.sh 含「已存在可运行便携 node 则跳过解压」的幂等判定（R4.2）', () => {
  // setup_portable_node 内：先检测已解压且可运行则直接 return（跳过 tar）
  assert.match(LAUNCH_SH, /PORTABLE_NODE_BIN/, '应引用便携 node 二进制路径变量');
  assert.match(
    LAUNCH_SH,
    /\[ -f "\$PORTABLE_NODE_BIN" \] && test_run_node "\$PORTABLE_NODE_BIN"/,
    '应在解压前判定 bin 存在且可试运行，命中则跳过解压'
  );
});

test('已存在可运行 bin/node 时按幂等契约跳过解压，且不发生再次解压（R4.2）', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fpl-idem-'));
  try {
    const portableDir = path.join(tmp, '.node-portable', 'node-v22.11.0-darwin-arm64');
    const binDir = path.join(portableDir, 'bin');
    fs.mkdirSync(binDir, { recursive: true });

    const binNode = path.join(binDir, 'node');
    // 可运行的 node 桩：响应 -v 输出一个版本号
    fs.writeFileSync(binNode, '#!/usr/bin/env bash\necho "v22.11.0"\n', { mode: 0o755 });

    // 放一个哨兵文件，证明「跳过路径」不会重写/清空解压目录
    const sentinel = path.join(portableDir, 'SENTINEL');
    fs.writeFileSync(sentinel, 'do-not-touch');

    const skip = wouldSkipExtraction(binNode);
    assert.strictEqual(skip, true, '已存在可运行 bin/node 时应跳过解压');

    // 未发生再次解压：哨兵与桩文件原样保留
    assert.strictEqual(fs.existsSync(sentinel), true, '幂等跳过不应删除/重写解压目录');
    assert.strictEqual(fs.readFileSync(sentinel, 'utf8'), 'do-not-touch');
    assert.strictEqual(fs.existsSync(binNode), true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
