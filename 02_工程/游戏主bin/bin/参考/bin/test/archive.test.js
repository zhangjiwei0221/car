'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');

const { parseArchiveTarget, archiveMatches } = require('../lib/launcher-core.js');

const NUM_RUNS = 200;

// Feature: foolproof-launcher, Property 3: For any 当前平台与架构 (platform, arch) 及任一形如 node-v{ver}-{plat}-{arch} 的归档目录名，archiveMatches(parseArchiveTarget(name), current) 为真当且仅当 plat 等于当前平台且 arch 等于当前架构；特别地，当当前平台为 Windows 而归档为 darwin-arm64 时结果必为假。
// Validates: Requirements 4.2, 4.4, 8.1
test('Property 3: archiveMatches 当且仅当 platform 与 arch 同时相等为真', () => {
  const platformArb = fc.constantFrom('darwin', 'win32', 'linux');
  const archArb = fc.constantFrom('arm64', 'x64', 'x86_64');
  const verArb = fc.tuple(
    fc.nat({ max: 99 }),
    fc.nat({ max: 99 }),
    fc.nat({ max: 99 })
  ).map(([a, b, c]) => `${a}.${b}.${c}`);

  fc.assert(
    fc.property(
      platformArb, // 归档平台
      archArb, // 归档架构
      verArb, // 归档版本
      platformArb, // 当前平台
      archArb, // 当前架构
      (plat, arch, ver, curPlat, curArch) => {
        const name = `node-v${ver}-${plat}-${arch}`;
        const target = parseArchiveTarget(name);
        assert.deepEqual(target, { platform: plat, arch: arch });

        const current = { platform: curPlat, arch: curArch };
        const expected = plat === curPlat && arch === curArch;
        assert.equal(
          archiveMatches(target, current),
          expected,
          `archiveMatches 应当且仅当 platform/arch 都相等为真（归档 ${name}，当前 ${curPlat}-${curArch}）`
        );
      }
    ),
    { numRuns: NUM_RUNS }
  );
});

// 显式反例：Windows × darwin-arm64 必为假
// Validates: Requirements 4.4, 8.1
test('Property 3 反例：Windows 上 darwin-arm64 归档不匹配', () => {
  const target = parseArchiveTarget('node-v22.11.0-darwin-arm64');
  assert.deepEqual(target, { platform: 'darwin', arch: 'arm64' });
  const current = { platform: 'win32', arch: 'x64' };
  assert.equal(archiveMatches(target, current), false);
});

test('示例：合法/非法归档目录名解析', () => {
  assert.deepEqual(parseArchiveTarget('node-v22.11.0-darwin-arm64'), {
    platform: 'darwin',
    arch: 'arm64',
  });
  assert.equal(parseArchiveTarget('not-a-node-archive'), null);
  assert.equal(parseArchiveTarget(''), null);
  assert.equal(archiveMatches(null, { platform: 'darwin', arch: 'arm64' }), false);
});
