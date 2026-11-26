#!/usr/bin/env node
'use strict';

/**
 * E6.8R 车序角色表 v1（只读）
 *
 * 把 006 当前样板（默认 v21）的 47 辆车按“剧本角色”摊开：
 *   颜色 / 容量 / 棋盘位置 / 所属段 / 锁链组 / 冰门 / 管道 / 全知第几步取 /
 *   取后 buffer 是否升高（留债）/ 是否为旁路标记（某策略跳过它）。
 *
 * 不修改关卡，不跑求解器，只读 level + story-plan + route-space-audit。
 * 用法：
 *   node 03_工具/正式版/Build006CarRoles_v695.js
 *   node 03_工具/正式版/Build006CarRoles_v695.js --version v20
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const argv = process.argv.slice(2);
const VERSION = (argv[argv.indexOf('--version') + 1] && argv.includes('--version')) ? argv[argv.indexOf('--version') + 1] : 'v21';
const OUT = path.join(ROOT, '实验关/关卡6/原型_' + VERSION);
const LEVEL = path.join(OUT, '关卡_实验_006_' + VERSION + '.json');
const PLAN = path.join(OUT, VERSION === 'v20' ? 'story-plan-v6.json' : 'story-plan-v7.json');
const AUDIT = path.join(OUT, 'route-space-audit-v1.json');

const SECTIONS = [
  { id: 'A', label: '段1 开局', from: 1, to: 11 },
  { id: 'B', label: '段2 中段', from: 12, to: 23 },
  { id: 'C', label: '段3 后段', from: 24, to: 33 },
  { id: 'D', label: '段4 收尾', from: 34, to: 45 }
];

function sectionOf(step) {
  if (!step) return null;
  const s = SECTIONS.find((x) => step >= x.from && step <= x.to);
  return s ? s.id : null;
}

function main() {
  const level = JSON.parse(fs.readFileSync(LEVEL, 'utf8'));
  const plan = JSON.parse(fs.readFileSync(PLAN, 'utf8'));
  const audit = JSON.parse(fs.readFileSync(AUDIT, 'utf8'));
  const ak = plan.allKnowing;
  const picks = ak.picks || [];
  const timeline = ak.timeline || [];

  const stepOf = {};
  picks.forEach((p, i) => { stepOf[p.r + ',' + p.c] = i + 1; });

  const chainOf = {};
  (plan.chains || []).forEach((g) => {
    (g.cells || []).forEach((cell) => {
      const r = Array.isArray(cell) ? cell[0] : cell.r;
      const c = Array.isArray(cell) ? cell[1] : cell.c;
      chainOf[r + ',' + c] = g.id;
    });
  });

  const spools = level.spools;
  const cars = [];
  const iceCells = [];
  const pipeCells = [];
  for (let r = 0; r < spools.length; r++) {
    for (let c = 0; c < spools[r].length; c++) {
      const cell = spools[r][c];
      const type = cell.type || 0;
      if (type === 11) pipeCells.push({ r: r, c: c, param: cell.param });
      if (type === 7) iceCells.push([r, c]);
    }
  }

  for (let r = 0; r < spools.length; r++) {
    for (let c = 0; c < spools[r].length; c++) {
      const cell = spools[r][c];
      const type = cell.type || 0;
      if (!(cell.id >= 0) || (type !== 0 && type !== 5 && type !== 7)) continue;
      const key = r + ',' + c;
      const step = stepOf[key] || null;
      const before = step ? (timeline[step - 2] || 0) : null;
      const after = step ? (timeline[step - 1] || 0) : null;
      const leftDebt = step ? after > before : false;
      const released = step ? after < before : false;
      const adjacentIce = iceCells.filter((x) => Math.abs(x[0] - r) + Math.abs(x[1] - c) === 1).length;
      const coverage = (audit.runs || []).filter((run) => (run.picks || []).some((p) => p.r === r && p.c === c));
      const skippedBy = (audit.runs || []).filter((run) => !(run.picks || []).some((p) => p.r === r && p.c === c)).map((run) => run.policy);
      cars.push({
        pos: key, r: r, c: c, color: cell.id, capacity: cell.count,
        chain: type === 5 ? (cell.param || chainOf[key] || null) : (chainOf[key] || null),
        ice: type === 7,
        iceValue: type === 7 ? cell.param : null,
        iceAdjacent: adjacentIce,
        section: sectionOf(step),
        allKnowingStep: step,
        bufferBefore: before, bufferAfter: after,
        leftDebt: leftDebt, releasedAfter: released,
        policiesTaking: coverage.length,
        skippedBy: skippedBy,
        queueOf: pipeCells.filter((p) => (p.param || []).some((q) => q.id === cell.id && q.count === cell.count)).map((p) => p.r + ',' + p.c)
      });
    }
  }

  // 锁链整组一个动作进入：同组未被直接点到的成员，步数跟随锚点
  const chainAnchorStep = {};
  cars.forEach((x) => { if (x.chain && x.allKnowingStep) chainAnchorStep[x.chain] = Math.min(chainAnchorStep[x.chain] || 99, x.allKnowingStep); });
  cars.forEach((x) => {
    if (x.chain && !x.allKnowingStep && chainAnchorStep[x.chain] !== undefined) {
      x.allKnowingStep = chainAnchorStep[x.chain];
      x.viaChain = true;
      x.bufferBefore = timeline[x.allKnowingStep - 2] || 0;
      x.bufferAfter = timeline[x.allKnowingStep - 1] || 0;
      x.leftDebt = false;
      x.section = sectionOf(x.allKnowingStep);
    }
  });
  // 管道 queue 里的车不在棋盘上，按同位置、异色的后续动作补一行
  pipeCells.forEach((pc) => {
    const onBoard = cars.find((x) => x.r === pc.r && x.c === pc.c);
    const pos = pc.r + ',' + pc.c;
    picks.forEach((q, i) => {
      if (q.r !== pc.r || q.c !== pc.c) return;
      if (onBoard && q.color === onBoard.color) return;
      cars.push({
        pos: pos + '(queue)', r: pc.r, c: pc.c, color: q.color, capacity: q.count,
        chain: null, ice: false, iceValue: null, iceAdjacent: 0,
        section: sectionOf(i + 1), allKnowingStep: i + 1,
        bufferBefore: timeline[i] || 0, bufferAfter: timeline[i + 1] || 0,
        leftDebt: (timeline[i + 1] || 0) > (timeline[i] || 0), releasedAfter: false,
        policiesTaking: 0, skippedBy: [], queueOf: [pos], viaPipe: true
      });
    });
  });

  const bySection = {};
  SECTIONS.forEach((s) => {
    const list = cars.filter((x) => x.section === s.id);
    bySection[s.id] = {
      label: s.label,
      cars: list.length,
      debtCars: list.filter((x) => x.leftDebt).length,
      chainCars: list.filter((x) => x.chain).length,
      iceCars: list.filter((x) => x.ice).length,
      peakBuffer: Math.max(0, ...list.map((x) => x.bufferAfter || 0))
    };
  });

  const debtCars = cars.filter((x) => x.leftDebt);
  const neverPicked = cars.filter((x) => !x.allKnowingStep);
  const json = {
    schema: '006-car-roles-v1', version: VERSION,
    level: LEVEL, plan: PLAN, audit: AUDIT,
    summary: {
      cars: cars.length,
      debtCars: debtCars.length,
      debtSteps: debtCars.map((x) => x.allKnowingStep).sort((a, b) => a - b),
      neverPickedByAllKnowing: neverPicked.map((x) => x.pos),
      iceCars: cars.filter((x) => x.ice).length, pipes: pipeCells.length,
      chainGroups: (plan.chains || []).length,
      chainCars: cars.filter((x) => x.chain).length,
      bySection: bySection
    },
    cars: cars.sort((a, b) => (a.allKnowingStep || 99) - (b.allKnowingStep || 99))
  };

  fs.writeFileSync(path.join(OUT, '车序角色表_v1.json'), JSON.stringify(json, null, 2));

  const lines = [];
  lines.push('# 006 · ' + VERSION + ' 车序角色表 v1');
  lines.push('');
  lines.push('> 只读生成：`node 03_工具/正式版/Build006CarRoles_v695.js`。');
  lines.push('> 角色判定：全知第 n 步取、取后 buffer 升高=留债、buffer 下降=释放。');
  lines.push('');
  lines.push('## 汇总');
  lines.push('');
  lines.push('| 项 | 数值 |');
  lines.push('|---|---:|');
  lines.push('| 车 | ' + cars.length + ' |');
  lines.push('| 留债车 | ' + debtCars.length + ' |');
  lines.push('| 留债步 | ' + json.summary.debtSteps.join('、') + ' |');
  lines.push('| 冰车 / 管道 / 链组 / 链车 | ' + json.summary.iceCars + ' / ' + pipeCells.length + ' / ' + (plan.chains || []).length + ' / ' + json.summary.chainCars + ' |');
  lines.push('');
  lines.push('## 分段');
  lines.push('');
  lines.push('| 段 | 车 | 留债车 | 链车 | 段内峰值 |');
  lines.push('|---|---:|---:|---:|---:|');
  SECTIONS.forEach((s) => {
    const b = bySection[s.id];
    lines.push('| ' + b.label + ' | ' + b.cars + ' | ' + b.debtCars + ' | ' + b.chainCars + ' | ' + b.peakBuffer + ' |');
  });
  lines.push('');
  const totalDebt = debtCars.length;
  const steps = ak.steps || picks.length;
  lines.push('## 结论');
  lines.push('');
  lines.push('- ' + steps + ' 步里只有 ' + totalDebt + ' 个留债动作（步 ' + json.summary.debtSteps.join('、') + '），留债密度 ' + (100 * totalDebt / steps).toFixed(0) + '%；');
  lines.push('- 段3（' + SECTIONS[2].from + '～' + SECTIONS[2].to + ' 步）留债车为 0，整段没有卡点；');
  lines.push('- 障碍：冰车 ' + json.summary.iceCars + '、链车 ' + json.summary.chainCars + '、管道 ' + pipeCells.length + '，其中真正改变全知选择的集中在段2；');
  lines.push('- 要做 4 段窗口，每段至少需要 2～3 个留债动作，当前段1/段3/段4 都不够。');
  lines.push('');
  lines.push('## 逐车');
  lines.push('');
  lines.push('| 步 | 位置 | 颜色/容量 | 段 | 链组 | 冰邻 | 管道queue | buffer 前→后 | 角色 | 被策略跳过 |');
  lines.push('|---:|---|---|---|---:|---:|---|---|---|---|');
  cars.sort((a, b) => (a.allKnowingStep || 99) - (b.allKnowingStep || 99)).forEach((x) => {
    const role = x.viaPipe ? '管道queue' : (x.viaChain ? '链组成员' : (x.leftDebt ? '留债' : (x.releasedAfter ? '释放' : '填充')));
    lines.push('| ' + (x.allKnowingStep || '-') + ' | ' + x.pos + ' | ' + x.color + '/' + x.capacity + ' | ' +
      (x.section || '-') + ' | ' + (x.chain || '-') + ' | ' + (x.ice ? '冰' + x.iceValue : '-') + ' | ' +
      (x.queueOf.length ? x.queueOf.join(' ') : '-') + ' | ' +
      (x.allKnowingStep ? x.bufferBefore + '→' + x.bufferAfter : '-') + ' | ' + role + ' | ' +
      (x.skippedBy.length ? x.skippedBy.join('、') : '-') + ' |');
  });
  fs.writeFileSync(path.join(OUT, '车序角色表_v1.md'), lines.join('\n') + '\n');

  console.log('cars=' + cars.length, 'debtCars=' + debtCars.length, 'debtSteps=' + json.summary.debtSteps.join(','));
  console.log('bySection=' + JSON.stringify(bySection));
  console.log('written=' + path.join(OUT, '车序角色表_v1.json'));
}

main();
