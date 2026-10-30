#!/usr/bin/env node
'use strict';

/**
 * E2.2: turn the action-region graph into placement constraints.
 *
 * For each target region:
 *   - which action first reveals it;
 *   - which actions consume it;
 *   - whether a consumer runs before its reveal;
 *   - whether another car color pays the region as debt.
 *
 * For each color:
 *   - all same-color vehicle actions and cross-color debt payments.
 *
 * Read-only. No level or obstacle is modified.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function main() {
  const graphFile = path.resolve(arg(
    '--graph',
    '实验关/关卡6/E2_v1/dependency-graph-v1.json'
  ));
  const outDir = path.resolve(arg('--out-dir', path.dirname(graphFile)));
  const graph = readJson(graphFile);
  const nodes = Object.fromEntries(graph.nodes.actions.map(x => [x.id, x]));
  const regions = Object.fromEntries(graph.nodes.regions.map(x => [x.id, x]));
  const byRegion = {};
  const byColor = {};

  function regionEntry(id) {
    return byRegion[id] || (byRegion[id] = {
      id,
      color: regions[id] ? regions[id].color : null,
      reveals: [],
      consumes: []
    });
  }

  function colorEntry(color) {
    return byColor[color] || (byColor[color] = {
      color,
      vehicleActions: [],
      payments: [],
      regions: {}
    });
  }

  for (const edge of graph.edges.reveals) {
    regionEntry(edge.to).reveals.push({
      action: edge.from,
      step: nodes[edge.from].step,
      vehicleColor: nodes[edge.from].color
    });
  }
  for (const edge of graph.edges.consumes) {
    const entry = regionEntry(edge.to);
    entry.consumes.push({
      action: edge.from,
      step: nodes[edge.from].step,
      vehicleColor: nodes[edge.from].color,
      pixels: edge.pixels,
      crossColorPayment: nodes[edge.from].color !== edge.color
    });
  }

  const regionConstraints = [];
  const placementRules = [];
  let consumeBeforeReveal = 0;
  let crossColorPaymentEdges = 0;
  let multiRegionCount = 0;
  let sameColorMultiCarRegions = 0;

  for (const id of Object.keys(byRegion).sort()) {
    const entry = byRegion[id];
    entry.reveals.sort((a, b) => a.step - b.step);
    entry.consumes.sort((a, b) => a.step - b.step);
    const firstReveal = entry.reveals[0] || null;
    for (const consume of entry.consumes) {
      if (firstReveal && consume.step < firstReveal.step) consumeBeforeReveal++;
      if (consume.crossColorPayment) crossColorPaymentEdges++;
      const c = colorEntry(entry.color);
      c.regions[id] = (c.regions[id] || 0) + consume.pixels;
      if (consume.crossColorPayment) {
        c.payments.push({
          region: id,
          action: consume.action,
          step: consume.step,
          vehicleColor: consume.vehicleColor,
          pixels: consume.pixels
        });
      } else {
        c.vehicleActions.push({
          region: id,
          action: consume.action,
          step: consume.step,
          pixels: consume.pixels
        });
      }
    }
    if (entry.consumes.length > 1) multiRegionCount++;
    const owners = [...new Set(entry.consumes.map(x => x.action))];
    const sameColorOwners = [...new Set(
      entry.consumes
        .filter(x => !x.crossColorPayment && x.vehicleColor === entry.color)
        .map(x => x.action)
    )];
    if (sameColorOwners.length > 1) sameColorMultiCarRegions++;
    const constraint = {
      region: id,
      color: entry.color,
      pixelsConsumed: entry.consumes.reduce((n, x) => n + x.pixels, 0),
      firstReveal,
      consumes: entry.consumes,
      owners,
      crossColorOwners: [...new Set(
        entry.consumes.filter(x => x.crossColorPayment).map(x => x.action)
      )],
      sameColorOwners,
      status: firstReveal && entry.consumes.some(x => x.step < firstReveal.step)
        ? 'premature_consume'
        : 'ok'
    };
    regionConstraints.push(constraint);

    if (entry.consumes.length && firstReveal) {
      placementRules.push({
        rule: 'revealBeforeConsume',
        region: id,
        revealAction: firstReveal.action,
        consumeActions: owners,
        revealStep: firstReveal.step,
        firstConsumeStep: entry.consumes[0].step
      });
    }
  }

  function regionConstraint(id) {
    return regionConstraints.find(x => x.region === id) || null;
  }
  const coreChecks = {
    R10OpenedByA01ThenConsumedByA02:
      regionConstraint('R10').firstReveal.action === 'A01' &&
      regionConstraint('R10').consumes[0].action === 'A02',
    R225DebtCarA03:
      regionConstraint('R225').consumes.some(x => x.action === 'A03' && x.pixels === 16),
    R134PaymentByA04:
      regionConstraint('R134').consumes.some(x => x.action === 'A04' &&
        x.crossColorPayment && x.pixels === 10),
    R223RevealedByA04BeforeA05:
      regionConstraint('R223').firstReveal.action === 'A04' &&
      regionConstraint('R223').consumes[0].action === 'A05',
    R227RevealedByA04BeforeA06:
      regionConstraint('R227').firstReveal.action === 'A04' &&
      regionConstraint('R227').consumes[0].action === 'A06',
    R59RevealedBeforeConsume:
      regionConstraint('R59').firstReveal.step < regionConstraint('R59').consumes[0].step,
    R65RevealedBeforeConsume:
      regionConstraint('R65').firstReveal.step < regionConstraint('R65').consumes[0].step,
    noPrematureConsume: consumeBeforeReveal === 0
  };

  if (!Object.values(coreChecks).every(Boolean)) {
    throw new Error('E2摆车约束检查失败: ' + JSON.stringify(coreChecks));
  }

  const result = {
    schema: 'target-vehicle-placement-constraints-v1',
    graphFile,
    summary: {
      regionsWithConsumption: regionConstraints.length,
      placementRules: placementRules.length,
      multiConsumerRegions: multiRegionCount,
      sameColorMultiCarRegions,
      crossColorPaymentEdges,
      consumeBeforeReveal
    },
    coreChecks,
    regionConstraints,
    placementRules,
    colorChains: Object.keys(byColor)
      .map(Number)
      .sort((a, b) => a - b)
      .map(color => ({
        color,
        vehicleActions: byColor[color].vehicleActions
          .sort((a, b) => a.step - b.step),
        payments: byColor[color].payments
          .sort((a, b) => a.step - b.step),
        regions: byColor[color].regions
      }))
  };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'placement-constraints-v1.json'),
    JSON.stringify(result, null, 2) + '\n'
  );

  const keyRegions = ['R10', 'R225', 'R134', 'R223', 'R227', 'R59', 'R65']
    .map(regionConstraint);
  const md = [
    '# 006 · E2 摆车约束 v1',
    '',
    '> 从车辆—目标区域依赖图反推的摆车约束；只读原型，不修改关卡。',
    '',
    '## 汇总',
    '',
    '- 有消费的区域：' + result.summary.regionsWithConsumption,
    '- 揭示先于消费的规则：' + result.summary.placementRules,
    '- 多车共同消费的区域：' + result.summary.multiConsumerRegions,
    '- 同色多车共同消费的区域：' + result.summary.sameColorMultiCarRegions,
    '- 跨车偿还边：' + result.summary.crossColorPaymentEdges,
    '- 消费早于首次揭示：' + result.summary.consumeBeforeReveal,
    '',
    '## 关键区域',
    '',
    '| 区域 | 颜色 | 首次揭示 | 消费者 | 消费像素 | 跨车偿还 |',
    '|---|---:|---|---|---:|---|',
    ...keyRegions.map(x => '| ' + x.region + ' | ' + x.color + ' | ' +
      (x.firstReveal ? x.firstReveal.action + '(' + x.firstReveal.step + ')' : '-') + ' | ' +
      x.consumes.map(y => y.action + '(' + y.step + ')').join('、') + ' | ' +
      x.pixelsConsumed + ' | ' +
      (x.crossColorOwners.join('、') || '-') + ' |'),
    '',
    '## 关键约束',
    '',
    '- R10：A01 先打开，A02 才能消费；A02 的24像素正好对应15/24。',
    '- R225：A03 的17/26消费16像素，留下10债务。',
    '- R134：A04 的31/30以跨车偿还方式清掉17色10像素。',
    '- R223/R227：A04 打开后，A05/A06分别消费第二组。',
    '- R59：A30打开，A31开始消费。',
    '- R65：A31打开，A38继续消费。',
    '',
    '## 检查',
    '',
    ...Object.entries(coreChecks).map(([key, value]) => '- ' + key + '：' + (value ? '通过' : '失败')),
    ''
  ].join('\n') + '\n';
  fs.writeFileSync(path.join(outDir, 'placement-constraints-v1.md'), md);

  console.log(JSON.stringify({
    ok: true,
    outDir,
    summary: result.summary,
    coreChecks,
    keyRegions: keyRegions.map(x => ({
      region: x.region,
      color: x.color,
      firstReveal: x.firstReveal,
      consumes: x.consumes,
      crossColorOwners: x.crossColorOwners
    }))
  }, null, 2));
}

try {
  main();
} catch (err) {
  console.error(err && err.stack || err);
  process.exit(1);
}
