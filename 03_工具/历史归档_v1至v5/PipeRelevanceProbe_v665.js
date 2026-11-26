#!/usr/bin/env node
'use strict';

/**
 * E4.4: reject a pipe unless it owns a unique story responsibility.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function main() {
  const outDir = path.join(ROOT, '实验关/关卡6/E4_v1');
  const gate = readJson(path.join(outDir, 'delayed-gate-result-v1.json'));
  const chain = readJson(path.join(outDir, 'chain-obstacle-result-v1.json'));
  const result = {
    schema: 'pipe-relevance-probe-v1',
    decision: 'reject_no_unique_story_need',
    evidence: {
      delayAlreadyOwnedBy: 'OG1 numice delayedGate',
      bindAlreadyOwnedBy: 'OC1 two-chain groupDebt',
      revealAlreadyPresent: {
        R59: gate.reveals.R59,
        R65: gate.reveals.R65
      },
      delaysUseful: gate.checks.visibleChoiceReduced,
      bindUseful: chain.checks.removalChangesSequence
    },
    reasoning: [
      '第二组在计划时点之前已由数字冰锁住，管道会重复delay职责。',
      '第一笔债务已由二连锁形成共同承诺，管道不能替代bind。',
      'R59/R65已由棋盘暴露顺序按计划出现，不存在需要暂存供给的关键车。',
      '当前没有“出口格空出后才应释放某辆关键车”的剧情节拍。',
      '强行放管道只会制造重复机制或掩盖现有布局问题。'
    ],
    futureUseCondition: [
      '只有在Schema中出现需要管道queue的车辆且目标区域依赖明确时重新启用。',
      '管道车辆必须计入容量/逐色守恒。',
      '移除管道必须让揭示提前或消失。'
    ]
  };
  fs.writeFileSync(
    path.join(outDir, 'pipe-relevance-v1.json'),
    JSON.stringify(result, null, 2) + '\n'
  );
  const md = [
    '# 006 · E4.4 管道相关性探针',
    '',
    '## 结论',
    '',
    '本轮不生成管道：没有独立故事职责。',
    '',
    '## 已有职责',
    '',
    '- delay：OG1数字冰；',
    '- bind：OC1二连锁；',
    '- reveal：R59第30步、R65第31步由棋盘自然揭示。',
    '',
    '## 否决理由',
    '',
    ...result.reasoning.map(x => '- ' + x),
    '',
    '## 重新启用条件',
    '',
    ...result.futureUseCondition.map(x => '- ' + x),
    ''
  ].join('\n') + '\n';
  fs.writeFileSync(path.join(outDir, 'pipe-relevance-v1.md'), md);
  console.log(JSON.stringify({ ok: true, result }, null, 2));
}

try {
  main();
} catch (err) {
  console.error(err && err.stack || err);
  process.exit(1);
}
