#!/usr/bin/env node
'use strict';

/**
 * StoryAtomRanker v0
 *
 * Read-only ranking of story atoms from TargetStoryAtlas output.
 * This does not choose a board and does not prove a route is playable.
 */

const fs = require('fs');
const path = require('path');

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

function round1(x) {
  return Math.round(x * 10) / 10;
}

function regionMap(atlas) {
  const out = {};
  for (const r of atlas.target.regions || []) out[r.id] = r;
  return out;
}

function regionExposureMap(atlas) {
  const out = {};
  for (const r of atlas.target.regionExposure || []) out[r.region] = r;
  return out;
}

function rankHollow(atlas) {
  const rm = regionMap(atlas);
  const em = regionExposureMap(atlas);
  return (atlas.target.entryAnalysis.hollowPaths || []).map(candidate => {
    const entry = rm[candidate.entryRegion] || {};
    const target = rm[candidate.targetRegion] || {};
    const targetExposure = em[candidate.targetRegion] || {};
    const entryArea = Number(entry.area || candidate.entryArea || 1);
    const expansion = candidate.targetArea / Math.max(1, entryArea);
    const hopScore = candidate.hopsFromBoundary === 1 ? 25 : candidate.hopsFromBoundary === 2 ? 15 : 5;
    const areaScore = clamp(candidate.targetArea, 0, 35);
    const expansionScore = clamp(expansion * 3, 0, 25);
    const timing = targetExposure.firstReachableStep;
    const timingScore = timing == null ? 0 : timing <= 2 ? 20 : timing <= 6 ? 12 : timing <= 12 ? 6 : 2;
    return {
      atom: 'hollowEntry',
      entry: candidate.entryRegion,
      entryColor: candidate.entryColor,
      entryArea,
      target: candidate.targetRegion,
      targetColor: candidate.targetColor,
      targetArea: candidate.targetArea,
      targetFirstReachableStep: timing,
      hopsFromBoundary: candidate.hopsFromBoundary,
      expansionRatio: round1(expansion),
      score: round1(clamp(areaScore + expansionScore + hopScore + timingScore, 0, 100)),
      reason: '边界入口向内打开目标区域；分数综合入口面积、目标面积、扩张比和暴露时机'
    };
  }).sort((a, b) => b.score - a.score).slice(0, 20);
}

function rankReveal(atlas) {
  const em = regionExposureMap(atlas);
  return (atlas.target.regions || [])
    .filter(r => !r.touchesBorder && r.area >= 8)
    .map(r => {
      const step = em[r.id] ? em[r.id].firstReachableStep : null;
      if (step == null || step < 7) return null;
      const areaScore = clamp(r.area * 1.5, 0, 45);
      const delayScore = clamp(step, 0, 30);
      return {
        atom: 'reveal',
        region: r.id,
        color: r.color,
        area: r.area,
        firstReachableStep: step,
        center: r.center,
        score: round1(clamp(areaScore + delayScore, 0, 100)),
        reason: '非边界区域在后续步骤才首次可达；分数综合面积和首次暴露深度'
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);
}

function rankDebt(plan) {
  if (!plan) return [];
  const cars = plan.plan && plan.plan.cars || [];
  return cars
    .filter(car => Number(car.debt) >= 5 && Number(car.debt) <= 18)
    .map(car => {
      const regions = car.regions || [];
      const top = regions[0] || null;
      const consumed = Math.max(1, Number(car.cap) - Number(car.debt));
      const coherence = top ? top.pixels / consumed : 0;
      const debt = Number(car.debt);
      const debtScore = debt >= 7 && debt <= 15 ? 35 : 22;
      const coherenceScore = clamp(Math.min(1, coherence) * 35, 0, 35);
      const earlyScore = car.id <= 12 ? 20 : 10;
      return {
        atom: 'shortDebt',
        carId: car.id,
        color: car.color,
        capacity: car.cap,
        entryReach: car.entryReach,
        debt,
        slot: car.slot,
        start: car.start,
        regions,
        coherence: round1(clamp(coherence, 0, 1)),
        score: round1(clamp(debtScore + coherenceScore + earlyScore, 0, 100)),
        reason: '当前同色可达不足但能立即消掉一部分；优先债务适中且集中在单一区域的候选'
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);
}

function rankGroupDebt(plan) {
  if (!plan) return [];
  return (plan.candidates.groupDebtWindows || []).map((window, index) => {
    const members = window.window || [];
    const debt = members.find(x => Number(x.debt) > 0) || {};
    const debtValue = Number(debt.debt) || 0;
    const sameColor = members.length >= 2 && new Set(members.map(x => x.color)).size < members.length;
    const coherenceValues = members.map(x => {
      const regions = x.regions || [];
      const consumed = Math.max(1, Number(x.capacity) - Math.max(0, Number(x.debt)));
      return regions.length ? regions[0].pixels / consumed : 0;
    });
    const coherence = coherenceValues.reduce((a, b) => a + b, 0) / Math.max(1, coherenceValues.length);
    const debtScore = debtValue >= 5 && debtValue <= 22 ? 35 : 20;
    const coherenceScore = clamp(Math.min(1, coherence) * 35, 0, 35);
    const duplicationPenalty = sameColor ? 10 : 0;
    return {
      atom: 'groupDebt',
      startIndex: window.startIndex,
      members,
      expectedDebt: debtValue,
      duplicateColor: sameColor,
      coherence: round1(clamp(coherence, 0, 1)),
      score: round1(clamp(debtScore + coherenceScore + 15 - duplicationPenalty, 0, 100)),
      reason: '目标序列窗口中的 2 满 1 欠候选；必须做真实 3 连锁整组入场后才可使用'
    };
  }).sort((a, b) => b.score - a.score).slice(0, 20);
}

function chooseRecommendation(rankings) {
  const hollow = rankings.hollowEntry[0];
  const debt = rankings.shortDebt[0];
  const reveal = rankings.reveal[0];
  const group = rankings.groupDebt[0];
  let main = 'shortDebt';
  if (hollow && hollow.score >= 60 && hollow.expansionRatio >= 2) main = 'hollowEntry';
  if (!debt && main === 'shortDebt') main = group ? 'groupDebt' : 'reveal';
  return {
    main,
    support: [reveal ? 'reveal' : null, debt ? 'shortDebt' : null].filter(Boolean),
    groupDebtRole: group ? 'alternative' : 'unavailable',
    rationale: main === 'hollowEntry'
      ? '存在从边界口进入并打开大内部区域的候选，优先作为看图和推进主线；三连锁只作为备选'
      : '没有足够强的 hollowEntry，改用目标序列上更自然的短债务/揭示'
  };
}

function mdTable(headers, rows) {
  return [
    '| ' + headers.join(' | ') + ' |',
    '| ' + headers.map(() => '---').join(' | ') + ' |',
    ...rows.map(row => '| ' + row.join(' | ') + ' |')
  ].join('\n');
}

function markdown(result) {
  const lines = [];
  lines.push('# 006 Story Atom Ranking v0');
  lines.push('');
  lines.push('> 只读排序。不是关卡，不是路线验证，也不默认三连锁。');
  lines.push('');
  lines.push('## 推荐');
  lines.push('');
  lines.push('- 主线：`' + result.recommendation.main + '`');
  lines.push('- 辅助：' + (result.recommendation.support.join('、') || '无'));
  lines.push('- groupDebt 角色：`' + result.recommendation.groupDebtRole + '`');
  lines.push('- 理由：' + result.recommendation.rationale);
  lines.push('');
  lines.push('## hollowEntry');
  lines.push('');
  lines.push(mdTable(
    ['入口', '目标', '入口面积', '目标面积', '扩张比', '跳数', '分数'],
    result.rankings.hollowEntry.slice(0, 10).map(x => [
      x.entry + '(' + x.entryColor + ')', x.target + '(' + x.targetColor + ')',
      x.entryArea, x.targetArea, x.expansionRatio, x.hopsFromBoundary, x.score
    ])
  ));
  lines.push('');
  lines.push('## shortDebt');
  lines.push('');
  lines.push(mdTable(
    ['车辆', '色号', '容量', '当前可达', '债务', '离散度', '分数'],
    result.rankings.shortDebt.slice(0, 10).map(x => [
      x.carId, x.color, x.capacity, x.entryReach, x.debt, x.coherence, x.score
    ])
  ));
  lines.push('');
  lines.push('## groupDebt');
  lines.push('');
  lines.push(mdTable(
    ['窗口', '成员', '预计债务', '重复色', '分数'],
    result.rankings.groupDebt.slice(0, 10).map(x => [
      x.startIndex,
      x.members.map(y => y.color + ':' + y.capacity).join(' + '),
      x.expectedDebt,
      x.duplicateColor ? '是' : '否',
      x.score
    ])
  ));
  lines.push('');
  lines.push('## reveal');
  lines.push('');
  lines.push(mdTable(
    ['区域', '色号', '面积', '首次可达步骤', '分数'],
    result.rankings.reveal.slice(0, 10).map(x => [
      x.region, x.color, x.area, x.firstReachableStep, x.score
    ])
  ));
  lines.push('');
  lines.push('## 解释');
  lines.push('');
  lines.push('- 分数是目标图候选的自然度排序，不是最终可玩性。');
  lines.push('- `shortDebt` 和 `groupDebt` 目前使用 `InstantPlayout` 的参考序列；仍需真实剧情回放。');
  lines.push('- `groupDebt` 即使排名靠前，也只是可选机制，不是每关必选。');
  return lines.join('\n');
}

function main() {
  const atlasFile = path.resolve(arg('--atlas', '实验关/关卡6/分析_v632/target-atlas.json'));
  const candidatesFile = path.resolve(arg('--candidates', '实验关/关卡6/分析_v632/story-candidates.json'));
  const outDir = path.resolve(arg('--out-dir', path.dirname(atlasFile)));
  const planLabel = arg('--plan-label', '20-40 / 7×7');
  const atlas = readJson(atlasFile);
  const candidates = readJson(candidatesFile);
  const plan = candidates.storyPlans.find(x => x.label === planLabel) || candidates.storyPlans[0] || null;
  if (!plan) throw new Error('没有找到可分析的 story plan');

  const rankings = {
    hollowEntry: rankHollow(atlas),
    shortDebt: rankDebt(plan),
    groupDebt: rankGroupDebt(plan),
    reveal: rankReveal(atlas),
    forcedGate: []
  };
  const recommendation = chooseRecommendation(rankings);
  const result = {
    schema: 'story-atom-ranking-v0',
    generatedAt: new Date().toISOString(),
    source: { atlasFile, candidatesFile, planLabel: plan.label },
    recommendation,
    rankings,
    limitations: [
      'hollowEntry 基于目标区域相邻图，尚未验证棋盘入口',
      'shortDebt/groupDebt 基于 InstantPlayout 参考序列，尚未验证真实剧情路线',
      'forcedGate 需要棋盘布局后才能产生候选',
      '分数不是最终质量阈值'
    ]
  };
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'story-atom-ranking.json'), JSON.stringify(result, null, 2) + '\n');
  fs.writeFileSync(path.join(outDir, 'story-atom-ranking.md'), markdown(result) + '\n');
  console.log(JSON.stringify({ ok: true, outDir, recommendation, counts: {
    hollowEntry: rankings.hollowEntry.length,
    shortDebt: rankings.shortDebt.length,
    groupDebt: rankings.groupDebt.length,
    reveal: rankings.reveal.length
  } }, null, 2));
}

try {
  main();
} catch (err) {
  console.error(err && err.stack || err);
  process.exit(1);
}
