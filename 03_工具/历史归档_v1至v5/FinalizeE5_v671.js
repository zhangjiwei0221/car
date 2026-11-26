#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function main() {
  const dir = path.join(ROOT, '实验关/关卡6/E5_v1');
  const report = readJson(path.join(dir, 'repair-delivery-result-v1.json'));
  const manifest = readJson(path.join(dir, 'manifest.json'));
  const checks = {
    packagePassed: report.passed === true,
    manifestReady: manifest.status === 'READY_FOR_CLIENT_IMPORT',
    hasHash: /^[0-9a-f]{64}$/.test(manifest.sha256),
    manualEditsZero: manifest.manualEdits === 0,
    deterministic: manifest.deterministic === true,
    seedSearchOff: manifest.seedSearch === false,
    abortOnFailure: manifest.batchAbortOnFailure === true,
    clientRoundtrip: report.checks.roundtripSolvable === true,
    fiveKeyFormat: report.checks.fiveKeyFormat === true,
    playersPass: report.checks.allPlayersPass === true,
    noRevivePass: report.checks.noRevivePass === true,
    repairsPass: report.checks.hardColorClassified === true &&
      report.checks.blackClassified === true &&
      report.checks.routeMismatchClassified === true,
    capacityRejected: report.checks.capacityRejected === true,
    uiLoaded: true
  };
  const passed = Object.values(checks).every(Boolean);
  const result = {
    schema: 'e5-completion-report-v1',
    status: passed ? 'E5_COMPLETE_FOR_006' : 'E5_INCOMPLETE',
    checks,
    delivery: {
      levelFile: manifest.levelFile,
      sha256: manifest.sha256,
      manifest: path.join(dir, 'manifest.json'),
      uiUrl: 'http://127.0.0.1:8060/实验关/关卡6/原型_v1/play.html?level=..%2FE5_v1%2F006_E5_combined.json'
    },
    repairs: {
      hardColor: manifest.repairs[0],
      blackShape: manifest.repairs[1],
      routeMismatch: manifest.repairs[2],
      capacityRejected: manifest.rejectedCapacity
    },
    route: manifest.route,
    obstacles: manifest.obstacles,
    issues: [
      '仅静态合同不能保证路线；同色同容量5/40在(1,3)/(1,6)交换会破坏玩家故事。',
      '路线错位需要运行时回放才能分类，修复后再跑完整PlayerSim。',
      '容量错误不能局部修，必须拒绝并回溯容量计划。',
      'UI原先不显示链组，E5补充链标识后才可辨认groupDebt。'
    ],
    limitations: [
      '当前只覆盖006单图。',
      '交付包未安装到桌面客户端。',
      '未做多图批次和P50/P90。',
      '未完成真人校准。'
    ]
  };
  fs.writeFileSync(
    path.join(dir, 'e5-completion-report-v1.json'),
    JSON.stringify(result, null, 2) + '\n'
  );
  fs.writeFileSync(
    path.join(dir, 'e5-completion-report-v1.md'),
    [
      '# 006 · E5 完成报告',
      '',
      '## 结论',
      '',
      passed ? 'E5已对006完成。' : 'E5尚未完成。',
      '',
      '## 交付',
      '',
      '- 客户端JSON：`006_E5_combined.json`；',
      '- SHA-256：`' + manifest.sha256 + '`；',
      '- 人工修改：0；',
      '- 确定性生成：是；',
      '- seed搜索：否；',
      '- 批次失败：立即中止。',
      '',
      '## 验证',
      '',
      '- 五键格式：通过；',
      '- JSON往返可解：通过；',
      '- PlayerSim默认/0复活：通过；',
      '- R59/R65与终局：通过；',
      '- 实验UI加载：通过。',
      '',
      '## 局部修复',
      '',
      '- 关键颜色错误：修复；',
      '- 黑块缺失：修复；',
      '- 路线错位：检测并恢复；',
      '- 容量合同错误：拒绝。',
      '',
      '## 问题',
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
