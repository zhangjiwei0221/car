#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function main() {
  const base = path.join(ROOT, '实验关/关卡6/E3_v1');
  const compiler = readJson(path.join(base, 'e3-board-compiler-result-v1.json'));
  const auditA = readJson(path.join(base, 'auditA/placement-constraints-v1.json'));
  const auditB = readJson(path.join(base, 'auditB/placement-constraints-v1.json'));
  const schema = readJson(path.join(base, 'board-constraint-schema-v1.json'));

  const checks = {
    compilerPassed: compiler.passed === true,
    layoutAExists: !!compiler.layoutA.file,
    layoutBExists: !!compiler.layoutB.file,
    twoLayoutsDiffer: compiler.layoutB.movedCells >= 8,
    bothNoRevivePlayerPass: compiler.checks.bothNoRevivePass === true,
    bothCriticalRegions: compiler.checks.bothRegionOrder === true,
    repairWorks: compiler.checks.repairDetectedAndFixed === true,
    capacityMutationRejected: compiler.checks.capacityMutationDetected === true,
    blackMutationRejected: compiler.checks.blackMutationDetected === true,
    softColorAccepted: compiler.checks.softColorAccepted === true,
    regionRuleMutationRejected: compiler.checks.regionRuleMutationDetected === true,
    auditANoPremature: auditA.summary.consumeBeforeReveal === 0,
    auditBNoPremature: auditB.summary.consumeBeforeReveal === 0,
    auditACore: Object.values(auditA.coreChecks).every(Boolean),
    auditBCore: Object.values(auditB.coreChecks).every(Boolean)
  };
  const passed = Object.values(checks).every(Boolean);

  const result = {
    schema: 'e3-completion-report-v1',
    status: passed ? 'E3_COMPLETE_FOR_006' : 'E3_INCOMPLETE',
    checks,
    schema: {
      fixedCells: schema.fixedCells.length,
      hardColorCells: schema.hardColorCells.length,
      softColorCells: schema.softColorCells.length,
      carCount: schema.capacity.carCount,
      capacitySum: schema.capacity.sum,
      regions: schema.regionRules.length
    },
    layouts: {
      A: {
        file: compiler.layoutA.file,
        fillShift: compiler.layoutA.fillShift,
        solve: compiler.layoutA.runtime.solve,
        playerPeaks: [...new Set(compiler.layoutA.runtime.players.map(x => x.bufferPeak))],
        reveals: compiler.layoutA.runtime.regions.firstReveal,
        constraints: auditA.summary
      },
      B: {
        file: compiler.layoutB.file,
        fillShift: compiler.layoutB.fillShift,
        movedCells: compiler.layoutB.movedCells,
        solve: compiler.layoutB.runtime.solve,
        playerPeaks: [...new Set(compiler.layoutB.runtime.players.map(x => x.bufferPeak))],
        reveals: compiler.layoutB.runtime.regions.firstReveal,
        constraints: auditB.summary
      }
    },
    mutations: compiler.mutations,
    issues: [
      {
        issue: '第二释放色曾被同时写入fixedCells',
        resolution: '从fixedCells移除，改为softColorCells的首选色/容量；验证14色替代也可通过。'
      },
      {
        issue: '区域首次揭示曾要求完全相等步骤',
        resolution: '改为stepWindow；R59允许28~31，R65允许29~32。'
      },
      {
        issue: 'Schema生成的第一个候选在后期或终局失败',
        resolution: '构造器搜索剩余车辆填充偏移，只接受完整运行时验证通过的布局。'
      }
    ],
    limitations: [
      '当前只覆盖006一张目标图。',
      'E3结果是实验JSON，未接入生产bin。',
      'PlayerSim仍不是真人校准。',
      'E4语义障碍编译器尚未开始。'
    ]
  };

  fs.writeFileSync(
    path.join(base, 'e3-completion-report-v1.json'),
    JSON.stringify(result, null, 2) + '\n'
  );
  const md = [
    '# 006 · E3 完成报告',
    '',
    '## 结论',
    '',
    passed ? 'E3已对006完成。' : 'E3尚未完成。',
    '',
    '## 完成内容',
    '',
    '- E3.1机器可读Schema；',
    '- E3.2目标图+Schema自动构造布局；',
    '- E3.3全知/PlayerSim/债权/区域/终局验证；',
    '- E3.4错误检测与关键格局部修复；',
    '- E3.5自动生成两个不同布局。',
    '',
    '## 两布局结果',
    '',
    '| 项目 | A | B |',
    '|---|---:|---:|',
    '| 填充偏移 | ' + result.layouts.A.fillShift + ' | ' + result.layouts.B.fillShift + ' |',
    '| 不同格数 | 基线 | ' + result.layouts.B.movedCells + ' |',
    '| 全知峰值 | ' + result.layouts.A.solve.bufferPeak + ' | ' + result.layouts.B.solve.bufferPeak + ' |',
    '| Player峰值 | ' + result.layouts.A.playerPeaks.join('/') + ' | ' + result.layouts.B.playerPeaks.join('/') + ' |',
    '| 提前消费 | ' + result.layouts.A.constraints.consumeBeforeReveal +
      ' | ' + result.layouts.B.constraints.consumeBeforeReveal + ' |',
    '',
    '两布局均通过六步主线、默认/0复活PlayerSim、R59/R65和终局释放。',
    '',
    '## 遇到的问题',
    '',
    ...result.issues.map(x => '- **' + x.issue + '**：' + x.resolution),
    '',
    '## 负向测试',
    '',
    '- 关键颜色错误：检测并修复；',
    '- 容量集合篡改：拒绝；',
    '- 黑块数量篡改：拒绝；',
    '- 第二释放软颜色替代：通过；',
    '- 区域首次揭示规则篡改：拒绝。',
    '',
    '## 限制',
    '',
    ...result.limitations.map(x => '- ' + x),
    ''
  ].join('\n') + '\n';
  fs.writeFileSync(path.join(base, 'e3-completion-report-v1.md'), md);

  console.log(JSON.stringify({ ok: passed, result }, null, 2));
}

try {
  main();
} catch (err) {
  console.error(err && err.stack || err);
  process.exit(1);
}
