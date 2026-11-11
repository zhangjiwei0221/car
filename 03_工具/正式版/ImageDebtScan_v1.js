#!/usr/bin/env node
'use strict';
/**
 * ImageDebtScan_v1 —— 扫目标图的“债务材料”（不是生成器，是选图/设计前的体检）
 *
 * 用法：
 *   node ImageDebtScan_v1.js <图.txt|目录> [--out 报告.json]
 *
 * 口径：border = 目标图四条边；corner 模式下第 0 步可达 = 四条边。
 * 每色按“主要角色”分类（优先级 shared > cross > bgSubj > interior > free）：
 *   - free    ：整色基本贴在边界（interior < 10）——免费步原料
 *   - interior：边界少、内部多——位置债原料（要靠别的颜色开包）
 *   - cross   ：边界有、内部也有（≥10）——长债原料（“红在左下 + 红在主体点缀”）
 *   - shared  ：跨 ≥2 主体——池债/长债原料
 *   - bgSubj  ：主体外有、主体内有——主体债原料（A 背景+主体内色）
 *
 * 输出：每张图的分类清单、freePx/debtPx、框色候选、定性标签（参考，不当硬门）。
 */
const fs = require('fs');
const path = require('path');
const { detect } = require('./SubjectDetect_v800');

function parse(file) {
  const lines = fs.readFileSync(file, 'utf8').replace(/\r/g, '').trim().split('\n');
  const rows = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t || /[^\d\s]/.test(t)) continue;
    rows.push(t.split(/\s+/).map(Number));
  }
  return rows;
}

function scan(file) {
  const b = parse(file);
  const H = b.length, W = b[0].length;
  const subs = detect(b);
  const subOf = Array.from({ length: H }, () => Array(W).fill(-1));
  subs.forEach((s, i) => {
    for (const key of s.cells) {
      const [y, x] = key.split(',').map(Number);
      subOf[y][x] = i;
    }
  });
  const st = {};
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = b[y][x];
    if (c <= 0) continue;
    const o = st[c] = st[c] || { px: 0, border: 0, interior: 0, outside: 0, subs: new Set() };
    o.px++;
    const isBorder = y === 0 || x === 0 || y === H - 1 || x === W - 1;
    if (isBorder) o.border++; else o.interior++;
    if (subOf[y][x] >= 0) o.subs.add(subOf[y][x]); else o.outside++;
  }
  const colors = Object.keys(st).map(Number).sort((a, b) => a - b);
  const classes = { shared: [], cross: [], bgSubj: [], interior: [], free: [] };
  for (const c of colors) {
    const o = st[c];
    const isShared = o.subs.size >= 2;
    const isCross = o.border >= 10 && o.interior >= 10;
    const isBgSubj = o.outside > 0 && o.subs.size >= 1;
    const isInterior = o.border < 10 && o.interior >= 10;
    const primary = isShared ? 'shared' : isCross ? 'cross' : isBgSubj ? 'bgSubj' : isInterior ? 'interior' : 'free';
    classes[primary].push({
      color: c, px: o.px, border: o.border, interior: o.interior,
      outside: o.outside, subs: [...o.subs]
    });
  }
  const sumPx = arr => arr.reduce((a, x) => a + x.px, 0);
  const borderPx = colors.reduce((a, c) => a + st[c].border, 0);
  const debtPx = sumPx(classes.shared) + sumPx(classes.cross) + sumPx(classes.bgSubj);
  const debtColors = classes.shared.length + classes.cross.length + classes.bgSubj.length;
  const debtShare = debtPx / (H * W);
  const label = debtColors >= 8 ? 'rich' : debtColors >= 4 ? 'ok' : 'flat';
  const frameCandidates = subs.map((s, i) =>
    colors.filter(c => st[c].subs.size === 1 && st[c].subs.has(i))
      .sort((a, b) => st[b].px - st[a].px)
      .map(c => ({ color: c, px: st[c].px }))
  );
  return {
    file: path.basename(file), size: H + 'x' + W, totalPx: H * W, colorCount: colors.length,
    subjects: subs.map((s, i) => ({ name: s.name.split('/').pop(), size: s.size, frameCandidates: frameCandidates[i] })),
    borderPx,
    debtPx, debtColors, debtShare: Math.round(debtShare * 100) / 100, label,
    classes, colors: colors.map(c => ({ color: c, ...st[c], subs: [...st[c].subs] }))
  };
}

function main() {
  const target = process.argv[2];
  const outIdx = process.argv.indexOf('--out');
  const out = outIdx > 0 ? process.argv[outIdx + 1] : '';
  if (!target) {
    console.error('用法: node ImageDebtScan_v1.js <图.txt|目录> [--out 报告.json]');
    process.exit(2);
  }
  let files = [];
  if (fs.statSync(target).isDirectory()) {
    const all = fs.readdirSync(target).filter(f => f.endsWith('.txt'));
    // 旧目录按「分图4色」筛；普通关卡/新抽出的目标图没有这个字样时，扫全部 .txt。
    const four = all.filter(f => f.includes('分图4色'));
    files = (four.length ? four : all).map(f => path.join(target, f));
  } else files = [target];
  const reports = files.map(f => {
    try { return scan(f); } catch (e) { return { file: path.basename(f), error: e.message }; }
  });
  reports.sort((a, b) => (b.debtPx || 0) - (a.debtPx || 0));
  for (const r of reports) {
    if (r.error) { console.log(r.file, 'ERROR', r.error); continue; }
    console.log(r.file, r.size, 'colors', r.colorCount,
      '| borderPx', r.borderPx, 'debtPx', r.debtPx, 'debtShare', r.debtShare, r.label,
      '| shared', r.classes.shared.length, 'cross', r.classes.cross.length, 'bgSubj', r.classes.bgSubj.length, 'interior', r.classes.interior.length,
      '| subjects', r.subjects.map(s => s.name + '/' + s.size + '[' + s.frameCandidates.slice(0, 3).map(f => f.color + ':' + f.px).join(',') + ']').join(' '));
  }
  if (out) {
    fs.writeFileSync(out, JSON.stringify({ tool: 'ImageDebtScan_v1', generatedAt: new Date().toISOString(), reports }, null, 2));
    console.log('已写：' + out);
  }
}

try { main(); } catch (e) { console.error('失败：' + e.message); process.exit(1); }
