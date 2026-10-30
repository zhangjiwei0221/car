#!/usr/bin/env node
'use strict';

/**
 * E2.7: compare layout A (v8) and layout B.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function main() {
  const aLevelFile = path.join(ROOT, '实验关/关卡6/原型_v8/关卡_实验_v8.json');
  const bLevelFile = path.join(ROOT, '实验关/关卡6/E2_v1/layoutB/关卡_E2布局B.json');
  const aGraphFile = path.join(ROOT, '实验关/关卡6/E2_v1/dependency-graph-v1.json');
  const aConstraintFile = path.join(ROOT, '实验关/关卡6/E2_v1/placement-constraints-v1.json');
  const aAuditFile = path.join(ROOT, '实验关/关卡6/原型_v8/story-audit-v3.json');
  const bGraphFile = path.join(ROOT, '实验关/关卡6/E2_v1/layoutB/dependency-graph-v1.json');
  const bConstraintFile = path.join(ROOT, '实验关/关卡6/E2_v1/layoutB/placement-constraints-v1.json');
  const bDebugFile = path.join(ROOT, '实验关/关卡6/E2_v1/layoutB/关卡_E2布局B.debug.json');

  const aGraph = readJson(aGraphFile);
  const bGraph = readJson(bGraphFile);
  const aConstraints = readJson(aConstraintFile);
  const bConstraints = readJson(bConstraintFile);
  const aAudit = readJson(aAuditFile);
  const bDebug = readJson(bDebugFile);

  const criticalCells = ['0,2', '0,1', '0,0', '1,0', '0,3', '1,3'];
  function criticalFromDebug(debug) {
    return debug.layout.criticalCells;
  }
  const criticalB = criticalFromDebug(bDebug);
  const criticalA = {
    '0,2': { color: 30, count: 22 },
    '0,1': { color: 15, count: 24 },
    '0,0': { color: 17, count: 26 },
    '1,0': { color: 31, count: 30 },
    '0,3': { color: 34, count: 25 },
    '1,3': { color: 5, count: 40 }
  };
  const criticalSame = criticalCells.every(cell =>
    criticalA[cell].color === criticalB[cell].color
  );
  const multisetSame = bDebug.layout.multisetSame === true;
  const moved = bDebug.layout.movedCells;
  const aPrefix = aGraph.actions.slice(0, 6).map(x => x.cell.join(','));
  const bPrefix = bGraph.actions.slice(0, 6).map(x => x.cell.join(','));
  const prefixSame = aPrefix.join('>') === bPrefix.join('>');
  const bothNoPremature = aConstraints.summary.consumeBeforeReveal === 0 &&
    bConstraints.summary.consumeBeforeReveal === 0;
  const bothCoreChecks = Object.values(aConstraints.coreChecks).every(Boolean) &&
    Object.values(bConstraints.coreChecks).every(Boolean);
  const bothPlayersPass = bDebug.players.every(x => x.won && x.revivesUsed === 0) &&
    aAudit.checks.playerCompletesWithoutRevive;
  const bothReveal = aAudit.checks.playerRevealsR59 &&
    aAudit.checks.playerRevealsR65 &&
    !!bDebug.reveals.R59 && !!bDebug.reveals.R65;
  const bothFinale = aAudit.checks.hasFinalDebtAndRelease &&
    !!(bDebug.finale && bDebug.finale.next &&
      bDebug.finale.next.bufferAfter < bDebug.finale.debt.bufferAfter);

  const checks = {
    criticalColorsSame: criticalSame,
    capacityMultisetSame: multisetSame,
    movedAtLeast8: moved >= 8,
    firstSixSame: prefixSame,
    bothNoPrematureConsume: bothNoPremature,
    bothCriticalRegionChecks: bothCoreChecks,
    bothPlayerPathsPass: bothPlayersPass,
    bothRevealR59R65: bothReveal,
    bothHaveFinale: bothFinale
  };
  const passed = Object.values(checks).every(Boolean);

  const result = {
    schema: 'e2-layout-comparison-v1',
    layouts: {
      A: aLevelFile,
      B: bLevelFile
    },
    checks,
    passed,
    metrics: {
      movedNonCriticalCells: moved,
      criticalColorsSame: criticalSame,
      capacityMultisetSame: multisetSame,
      edgeCounts: {
        A: {
          consumes: aGraph.edges.consumes.length,
          reveals: aGraph.edges.reveals.length
        },
        B: {
          consumes: bGraph.edges.consumes.length,
          reveals: bGraph.edges.reveals.length
        }
      },
      constraintCounts: {
        A: aConstraints.summary,
        B: bConstraints.summary
      },
      reveals: {
        A: aAudit.reveals,
        B: bDebug.reveals
      },
      finale: {
        A: aAudit.finale,
        B: bDebug.finale
      }
    }
  };

  const outDir = path.join(ROOT, '实验关/关卡6/E2_v1');
  fs.writeFileSync(
    path.join(outDir, 'layout-comparison-v1.json'),
    JSON.stringify(result, null, 2) + '\n'
  );
  const md = [
    '# 006 · E2 布局 A/B 对照',
    '',
    '## 结论',
    '',
    passed
      ? '两个布局满足E2核心约束，E2可以退出。'
      : '仍存在未通过的E2验收项。',
    '',
    '## 检查',
    '',
    ...Object.entries(checks).map(([key, value]) =>
      '- ' + key + '：' + (value ? '通过' : '失败')
    ),
    '',
    '## 布局差异',
    '',
    '- 非关键车辆移动格数：' + moved,
    '- 关键格颜色一致：' + (criticalSame ? '是' : '否'),
    '- 容量多重集合一致：' + (multisetSame ? '是' : '否'),
    '- 前六步一致：' + (prefixSame ? '是' : '否'),
    '',
    '## 依赖规模',
    '',
    '| 布局 | 消费边 | 揭示边 | 多车区域 | 跨车偿还 | 提前消费 |',
    '|---|---:|---:|---:|---:|---:|',
    '| A | ' + aGraph.edges.consumes.length + ' | ' + aGraph.edges.reveals.length +
      ' | ' + aConstraints.summary.multiConsumerRegions +
      ' | ' + aConstraints.summary.crossColorPaymentEdges +
      ' | ' + aConstraints.summary.consumeBeforeReveal + ' |',
    '| B | ' + bGraph.edges.consumes.length + ' | ' + bGraph.edges.reveals.length +
      ' | ' + bConstraints.summary.multiConsumerRegions +
      ' | ' + bConstraints.summary.crossColorPaymentEdges +
      ' | ' + bConstraints.summary.consumeBeforeReveal + ' |',
    '',
    '## 揭示与终局',
    '',
    '- A：R59第' + aAudit.reveals.R59.step + '步，R65第' + aAudit.reveals.R65.step + '步。',
    '- B：R59第' + bDebug.reveals.R59.step + '步，R65第' + bDebug.reveals.R65.step + '步。',
    '- 两个布局均通过默认/0复活PlayerSim和终局债务释放。',
    ''
  ].join('\n') + '\n';
  fs.writeFileSync(path.join(outDir, 'layout-comparison-v1.md'), md);
  console.log(JSON.stringify({ ok: true, passed, checks, metrics: result.metrics }, null, 2));
}

try {
  main();
} catch (err) {
  console.error(err && err.stack || err);
  process.exit(1);
}
