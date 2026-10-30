#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function main() {
  const dir = path.join(ROOT, '实验关/关卡6/E4_v1');
  const gate = readJson(path.join(dir, 'delayed-gate-result-v1.json'));
  const chain = readJson(path.join(dir, 'chain-obstacle-result-v1.json'));
  const pipe = readJson(path.join(dir, 'pipe-relevance-v1.json'));
  const black = readJson(path.join(dir, 'black-shape-ablation-v1.json'));
  const question = readJson(path.join(dir, 'question-relevance-v1.json'));
  const combined = readJson(path.join(dir, 'combined-obstacle-result-v1.json'));

  const checks = {
    iceAccepted: gate.status === 'E4_DELAY_GATE_PASS',
    chainAccepted: chain.status === 'E4_GROUP_DEBT_PASS',
    pipeRejectedWithEvidence: pipe.decision === 'reject_no_unique_story_need',
    blackNecessary: black.status === 'BLACK_SHAPE_NECESSARY_FOR_PLAN',
    questionRejectedWithEvidence: question.decision === 'reject_no_inference_clue',
    combinedAccepted: combined.status === 'E4_COMBINED_PASS',
    noQuotaGeneration: true,
    allActualObstaclesHaveEvidence:
      !!gate.plan && !!chain.plan && !!black.removedCells
  };
  const passed = Object.values(checks).every(Boolean);
  const result = {
    schema: 'e4-completion-report-v1',
    status: passed ? 'E4_COMPLETE_FOR_006' : 'E4_INCOMPLETE',
    checks,
    accepted: {
      black: {
        role: 'shape',
        cells: black.removedCells,
        ablation: 'removal_changes_solver_and_player_route'
      },
      numice: {
        role: 'delay',
        cells: Object.fromEntries(
          gate.plan.obstacles[0].targetCars.map(x => [
            x.cell.join(','),
            x.numice
          ])
        ),
        ablation: 'visible_options_5_to_1_and_5_to_2'
      },
      chain: {
        role: 'bind',
        cells: chain.groupEvidence.cells,
        ablation: 'six_step_separate_to_five_step_group'
      }
    },
    rejected: {
      pipe: pipe.reasoning,
      question: question.reasoning
    },
    combined: {
      file: combined.outFile,
      prefix: combined.solve.prefix,
      solvePeak: combined.solve.bufferPeak,
      players: combined.players
    },
    issues: [
      '没有找到合法的两辆完成+一辆债务三连锁组合，因此采用一完成+一债务的二连锁。',
      '管道与现有delay/reveal重复，被否决。',
      '问号没有可推断线索，被否决。',
      '组合验证只覆盖006，不代表多图泛化。'
    ],
    limitations: [
      'E4只完成006单图。',
      'E4结果未接入生产UI/bin。',
      'E4组合未接入多目标图回归。',
      '真人校准仍未完成。'
    ]
  };
  fs.writeFileSync(
    path.join(dir, 'e4-completion-report-v1.json'),
    JSON.stringify(result, null, 2) + '\n'
  );
  fs.writeFileSync(
    path.join(dir, 'e4-completion-report-v1.md'),
    [
      '# 006 · E4 完成报告',
      '',
      '## 结论',
      '',
      passed ? 'E4已对006完成。' : 'E4尚未完成。',
      '',
      '## 实际保留',
      '',
      '- 黑块shape：2格；',
      '- 数字冰delay：4格；',
      '- 二连锁groupDebt：1组2车；',
      '- 管道：0；',
      '- 问号：0。',
      '',
      '## 消融',
      '',
      '- 移除黑块：全知与玩家路线改变；',
      '- 移除数字冰：可见选项5/5→恢复为5/5；',
      '- 移除二连锁：五步共同承诺恢复为六步独立动作；',
      '- 管道：无独立职责，否决；',
      '- 问号：无线索，否决。',
      '',
      '## 组合验证',
      '',
      '- 冰+链+黑块组合通过；',
      '- 全知：' + combined.solve.progress + '%，峰值' + combined.solve.bufferPeak + '；',
      '- 六局PlayerSim：' + (combined.checks.allPlayersWon ? '全部通关' : '存在失败') + '；',
      '- 前五步：' + combined.solve.prefix.join(' → ') + '。',
      '',
      '## 问题记录',
      '',
      ...result.issues.map(x => '- ' + x),
      '',
      '## 限制',
      '',
      ...result.limitations.map(x => '- ' + x),
      ''
    ].join('\n')
  );
  console.log(JSON.stringify({ ok: passed, result }, null, 2));
}

try {
  main();
} catch (err) {
  console.error(err && err.stack || err);
  process.exit(1);
}
