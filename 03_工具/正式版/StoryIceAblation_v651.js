#!/usr/bin/env node
'use strict';

/**
 * Compare the v8 no-ice board with the v9 numbered-ice gate.
 *
 * The ice is not intended to make the route solvable. It is intended to make
 * the planned order visible to a human by reducing the unlocked option set.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function main() {
  const noIceFile = path.join(
    ROOT,
    '实验关/关卡6/原型_v8/story-audit-v3.json'
  );
  const iceFile = path.join(
    ROOT,
    '实验关/关卡6/原型_v9/story-audit-v4.json'
  );
  const noIce = readJson(noIceFile);
  const ice = readJson(iceFile);

  const compare = {
    firstWindow: {
      noIce: noIce.firstWindow.counts,
      ice: ice.firstWindow.counts
    },
    secondWindow: {
      noIce: noIce.secondWindow.counts,
      ice: ice.secondWindow.counts
    },
    route: {
      noIceAllKnowingMatches: noIce.checks.allKnowingMatchesPlan,
      iceAllKnowingMatches: ice.checks.allKnowingMatchesPlan,
      noIcePlayerMatches: noIce.checks.playerPrefixMatchesPlan,
      icePlayerMatches: ice.checks.playerPrefixMatchesPlan,
      noIceMaxBuffer: noIce.allKnowing.maxBuffer,
      iceMaxBuffer: ice.allKnowing.maxBuffer
    }
  };

  const result = {
    schema: 'e1-r3-ice-ablation-v1',
    noIceFile,
    iceFile,
    compare,
    conclusion: '移除数字冰不会改变全知或PlayerSim的六步路线与峰值，' +
      '但会把第一债务窗口从1个可点选项扩大到5个，' +
      '把第二债务窗口从2个扩大到5个。数字冰的必要性因此是“让人看见顺序约束”，' +
      '不是“让关卡从无解变可解”。',
    keepIce: true
  };

  const outDir = path.join(ROOT, '实验关/关卡6/原型_v9');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'ice-ablation-v1.json'),
    JSON.stringify(result, null, 2) + '\n'
  );

  const md = [
    '# 006 · E1-R3 数字冰移除消融',
    '',
    '## 对比',
    '',
    '| 窗口 | 无冰 v8 | 数字冰 v9 |',
    '|---|---:|---:|',
    '| 第一债务可点选项 | ' + compare.firstWindow.noIce.moves +
      ' | ' + compare.firstWindow.ice.moves + ' |',
    '| 第一债务死债 | ' + compare.firstWindow.noIce.deadDebt +
      ' | ' + compare.firstWindow.ice.deadDebt + ' |',
    '| 第二债务可点选项 | ' + compare.secondWindow.noIce.moves +
      ' | ' + compare.secondWindow.ice.moves + ' |',
    '| 第二债务死债 | ' + compare.secondWindow.noIce.deadDebt +
      ' | ' + compare.secondWindow.ice.deadDebt + ' |',
    '',
    '## 路线',
    '',
    '| 项目 | 无冰 v8 | 数字冰 v9 |',
    '|---|---:|---:|',
    '| 全知符合计划 | ' + (compare.route.noIceAllKnowingMatches ? '是' : '否') +
      ' | ' + (compare.route.iceAllKnowingMatches ? '是' : '否') + ' |',
    '| PlayerSim符合计划 | ' + (compare.route.noIcePlayerMatches ? '是' : '否') +
      ' | ' + (compare.route.icePlayerMatches ? '是' : '否') + ' |',
    '| 全知峰值 | ' + compare.route.noIceMaxBuffer +
      ' | ' + compare.route.iceMaxBuffer + ' |',
    '',
    '## 结论',
    '',
    result.conclusion,
    ''
  ].join('\n') + '\n';
  fs.writeFileSync(path.join(outDir, 'ice-ablation-v1.md'), md);

  console.log(JSON.stringify({ ok: true, outDir, compare, conclusion: result.conclusion }, null, 2));
}

try {
  main();
} catch (err) {
  console.error(err && err.stack || err);
  process.exit(1);
}
