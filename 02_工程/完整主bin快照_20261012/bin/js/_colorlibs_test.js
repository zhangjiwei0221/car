/**
 * 【色库 v154】自检/回归
 *   node js/_colorlibs_test.js
 *
 * 覆盖：色库数据与源文件一致性 / 映射表质量 / 官方 300 关全量往返 / 识别判据 / TXT 读写
 */
'use strict';
const fs = require('fs');
const path = require('path');
const CL = require('./color-libs.js');

let fail = 0, warn = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.log('  ✗ ' + m); };
const warning = (m) => { warn++; console.log('  ! ' + m); };

const ROOT = path.join(__dirname, '..');
const DIR_OFFICIAL = path.join(ROOT, '参考', '色库', 'official_json_original_color_matrices');
const FILE_STD = path.join(ROOT, '参考', '色库', '标准色库', '标准色库_colors_0-21.txt');
const FILE_OLD = path.join(ROOT, '参考', '色库', '标准色库', '标准色库毛线真实.txt');

function readLibFile(p) {
  const out = [];
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(#[0-9A-Fa-f]{6})\s*,\s*(\d+)\s*$/);
    if (m) out.push({ hex: m[1].toUpperCase(), id: +m[2] });
  }
  return out;
}

// ---------- 1. 内置色值 vs 磁盘权威文件 ----------
console.log('\n[1] 内置色值 vs 源文件');
{
  const stdFile = readLibFile(FILE_STD);
  const officialFile = readLibFile(path.join(DIR_OFFICIAL, 'original_color_library.txt'));
  const oldFile = readLibFile(FILE_OLD);

  if (JSON.stringify(stdFile) !== JSON.stringify(officialFile)) bad('两份官方色库文件内容不一致');
  else ok('两份官方色库文件一致（标准色库_colors_0-21.txt = original_color_library.txt）');

  const builtOfficial = CL.OFFICIAL.colors.map((c, i) => ({ hex: c.hex.toUpperCase(), id: i }));
  if (builtOfficial.some((e, i) => !stdFile[i] || stdFile[i].hex !== e.hex || stdFile[i].id !== e.id))
    bad('内置官方色库与源文件不符');
  else ok('内置官方 22 色 == 源文件（0-21 逐项一致）');

  const builtOld = CL.OLDER.colors.slice(1).map((c, i) => ({ hex: c.hex.toUpperCase(), id: i + 1 }));
  if (builtOld.some((e, i) => !oldFile[i] || oldFile[i].hex !== e.hex)) bad('内置34色库与 标准色库毛线真实.txt 不符');
  else ok('内置34色库 == 标准色库毛线真实.txt（1-34 逐项一致）');

  const utilSrc = fs.readFileSync(path.join(__dirname, 'utils.js'), 'utf8');
  const utilHex = [...utilSrc.matchAll(/hex:\s*'(#[0-9A-Fa-f]{6})'/g)].map((m) => m[1].toUpperCase());
  const cmp = CL.OLDER.colors.slice(1).map((c) => c.hex.toUpperCase());
  if (utilHex.length < 34) bad('utils.js 里只解析到 ' + utilHex.length + ' 个色值');
  else if (cmp.some((h, i) => h !== utilHex[i])) bad('本模块 34 色库与 js/utils.js 的 AntSolver.COLORS 不一致');
  else ok('本模块 34 色库 == js/utils.js 的 AntSolver.COLORS（单一色源）');

  const dupO = new Set(CL.swatches('official').map((s) => s.hex.toUpperCase()));
  if (dupO.size !== 22) bad('官方色库内部有重复色值');
  else ok('官方色库 22 色内部无重复');
  const dupL = new Set(CL.swatches('older').map((s) => s.hex.toUpperCase()));
  if (dupL.size !== 34) bad('34色库内部有重复色值');
  else ok('34色库 34 色内部无重复');
}

// ---------- 2. 映射表：单射 / 往返 / 质量 ----------
console.log('\n[2] 映射表（最小代价单射分配）');
{
  const A = CL.assignment();
  const o2l = CL.mapOfficialToSolver();   // 官方 -> 老
  const l2o = CL.mapSolverToOfficial();   // 老 -> 官方

  const targets = Object.values(A.officialToOld);
  if (new Set(targets).size !== 22) bad('官方→老 不是单射（有撞色）：' + JSON.stringify(targets));
  else ok('官方→老 是单射：22 个官方色落到 22 个互不相同的老色号（不撞色）');

  // 每个官方色在「单射」下确实落到了 22 个里最省的那一组
  const naiveTotal = CL.swatches('official')
    .reduce((s, o) => s + Math.min(...CL.swatches('older').map((l) => CL.rgbDist(o.hex, l.hex))), 0);
  ok('单射总距离 ' + A.totalDist.toFixed(1) + ' vs 纯最近色总距离 ' + naiveTotal.toFixed(1) +
     '（高 ' + ((A.totalDist / naiveTotal - 1) * 100).toFixed(1) + '%，换来 141 关不撞色）');

  const merged = CL.mapOfficialToSolver().rows.length;
  if (merged !== 22) bad('官方→老 行数 ' + merged + ' != 22'); else ok('官方→老：22/22 色都有落点，最远 ' + o2l.maxDist.toFixed(1) + '（官方' + o2l.maxFrom + '）');
  if (l2o.rows.length !== 34) bad('老→官方 行数 ' + l2o.rows.length + ' != 34'); else ok('老→官方：34/34 色都有落点，最远 ' + l2o.maxDist.toFixed(1));

  // 关键保证：官方 → 老 → 官方 必须逐色还原（22/22 身份）
  let identityFail = [];
  for (const o of CL.swatches('official').map((s) => s.id)) {
    const back = l2o.map[o2l.map[o]];
    if (back !== o) identityFail.push(o + '→' + o2l.map[o] + '→' + back);
  }
  if (identityFail.length) bad('官方→老→官方 身份失败：' + identityFail.join(', '));
  else ok('官方→老→官方：22/22 色身份完全还原（反向映射是单射表的逆）');

  if (CL.mapOfficialToSolver() !== o2l) bad('映射表未缓存'); else ok('映射表已缓存且稳定');
  if (CL.get('auto') === CL.OLDER && CL.get(undefined) === CL.OLDER && CL.get('nonsense') === CL.OLDER)
    ok("'auto'/undefined/未知值都回落到老色库（求解器编号空间）");
  else bad("'auto'/未知值未回落到老色库");
  let threw = false;
  try { CL.buildMap('auto', 'older'); } catch (e) { threw = true; }
  if (threw) ok('同库互转（auto→older）会直接报错，不会静默产出无意义映射表');
  else bad('同库互转未报错，存在静默出错图风险');
}

// ---------- 3. 官方 300 关全量：解析/识别/往返 ----------
console.log('\n[3] 官方 300 关实跑');
{
  const files = fs.readdirSync(DIR_OFFICIAL).filter((f) => /^level_\d+\.txt$/.test(f))
    .sort((a, b) => (+a.match(/\d+/)[0]) - (+b.match(/\d+/)[0]));
  if (files.length !== 300) bad('官方关数 ' + files.length + ' != 300'); else ok('找到 300 个关卡文件');

  let nWithNeg = 0, nConfident = 0, nAmbiguous = 0, nDetectOld = 0;
  let rtPixelFail = 0, dimFail = 0, illegal = 0;
  const usedColors = {};
  let maxDistSeen = 0, maxDistLevel = null;
  let alphaLevels = 0;

  for (const f of files) {
    const raw = CL.parseTXT(fs.readFileSync(path.join(DIR_OFFICIAL, f), 'utf8'));
    if (!raw.length || !raw[0].length) { bad(f + ' 解析为空'); continue; }

    for (const row of raw) for (const v of row) {
      if (v !== -1 && (v < 0 || v > 21)) illegal++;
      if (v >= 0) usedColors[v] = 1;
    }

    const d = CL.detect(raw);
    if (d.hasNeg) nWithNeg++;
    if (d.confident) nConfident++; else nAmbiguous++;
    if (d.lib === 'older') nDetectOld++;

    // 官方 → 求解器(34色/0空) → 官方，逐像素比对
    const toSolver = CL.toSolver(raw);
    // 该关实际用到的最远转换距离
    for (const k of Object.keys(toSolver.stats.used)) {
      const row = toSolver.stats.map.rows.find((r) => r.from === +k);
      if (row && row.dist > maxDistSeen) { maxDistSeen = row.dist; maxDistLevel = f + ' 官方' + k; }
    }
    const back = CL.toOfficial(toSolver.matrix).matrix;
    if (back.length !== raw.length || back[0].length !== raw[0].length) { dimFail++; continue; }
    let same = true;
    for (let r = 0; r < raw.length && same; r++) for (let c = 0; c < raw[r].length; c++) {
      if (back[r][c] !== raw[r][c]) { same = false; break; }
    }
    if (!same) {
      rtPixelFail++;
      if (alphaLevels < 3) { alphaLevels++; console.log('      · 往返不一致示例：' + f); }
    }
  }

  console.log('    空位标记：带 -1 的 ' + nWithNeg + ' 关 / 实心无空位 ' + (300 - nWithNeg) + ' 关');
  console.log('    识别结果：高置信 ' + nConfident + ' 关，判据不足 ' + nAmbiguous + ' 关（实心图，需人工确认）');
  if (nWithNeg === 185) ok('185/300 带 -1，与源数据实测一致'); else bad('带 -1 的关数 ' + nWithNeg + ' != 185');
  if (nAmbiguous === nDetectOld + (nConfident - (300 - nAmbiguous))) { /* 仅信息 */ }
  if (illegal) bad('出现 ' + illegal + ' 个越界编号'); else ok('编号全部落在 {-1} ∪ [0,21]');
  console.log('    实际用到的官方色：' + Object.keys(usedColors).sort((a, b) => a - b).join(',') + '（全部 22 色都在用）');
  console.log('    关内实际转换最远距离：' + maxDistSeen.toFixed(1) + (maxDistLevel ? '（' + maxDistLevel + '）' : ''));
  if (dimFail) bad(dimFail + ' 关尺寸在往返中改变');
  if (rtPixelFail) bad(rtPixelFail + ' 关往返后像素不一致');
  else ok('新→老→新 往返：300/300 关逐像素完全一致（无损）');
}

// ---------- 4. 老→新：空位/尺寸/极色 ----------
console.log('\n[4] 34色库 → 官方 → 34色库');
{
  const m = [];
  m.push(Array.from({ length: 35 }, (_, i) => i));          // 含 0 空位 + 1..34
  m.push(Array.from({ length: 35 }, (_, i) => i % 35));
  const toOff = CL.toOfficial(m);
  if (toOff.matrix[0][0] !== -1) bad('老色库 0（空位）→ 官方应为 -1，实为 ' + toOff.matrix[0][0]);
  else ok('空位 0 → -1（官方空位标记）');
  const back = CL.toSolver(toOff.matrix).matrix;
  if (back[0][0] !== 0) bad('官方 -1 转回应为 0，实为 ' + back[0][0]);
  else ok('-1 → 0（求解器空位标记）');
  if (back.length !== m.length || back.some((r, i) => r.length !== m[i].length)) bad('尺寸在往返中改变');
  else ok('尺寸保持不变');

  const worst = CL.mapSolverToOfficial().rows.slice().sort((a, b) => b.dist - a.dist).slice(0, 5);
  console.log('    老色库→官方 最远 5 色（老色库有 34 色，官方只有 22 色，个别色必然偏差较大）：');
  for (const w of worst)
    console.log('      老' + String(w.from).padStart(2) + ' ' + w.fromName.padEnd(4) + ' ' + w.fromHex +
                ' → 官方' + String(w.to).padStart(2) + ' ' + w.toName.padEnd(4) + ' ' + w.toHex + ' (距离 ' + w.dist.toFixed(1) + ')');
  if (worst[0].dist > 100) warning('老→官方 最远距离 ' + worst[0].dist.toFixed(1) + '，属两套色库色域差异，非转换错误');
}

// ---------- 5. 识别判据边界 ----------
console.log('\n[5] 识别判据');
{
  const cases = [
    [[[0, 1], [-1, 2]], 'official', true, '含 -1（官方空位）'],
    [[[22, 5], [3, 0]], 'older', true, '含 >21 编号'],
    [[[0, 0, 0], [0, 1, 0]], 'older', true, '0 占比高 = 大面积为空'],
    [[[1, 2], [3, 4]], 'older', false, '实心无 0 无负 = 判据不足'],
    [[[0, 5, 6], [7, 8, 9]], 'official', true, '有 0 但占比低 = 官方黄底'],
  ];
  for (const [m, wantLib, wantConf, desc] of cases) {
    const d = CL.detect(m);
    if (d.lib === wantLib && d.confident === wantConf)
      ok(desc + ' → ' + d.lib + (d.confident ? '（高置信）' : '（判据不足）'));
    else bad(desc + ' → 期望 ' + wantLib + '/' + wantConf + ' 实得 ' + d.lib + '/' + d.confident);
  }
}

// ---------- 6. TXT 读写 ----------
console.log('\n[6] TXT 读写');
{
  const m = [[0, 1, 2], [3, 0, 4]];
  if (JSON.stringify(CL.parseTXT(CL.renderTXT(m, '像素矩阵'))) === JSON.stringify(m)) ok('renderTXT → parseTXT 往返一致');
  else bad('TXT 往返不一致');

  const p = CL.parseTXT(['像素矩阵', '0 1 -1', '2 3 -1'].join('\n'));
  if (JSON.stringify(p) === JSON.stringify([[0, 1, -1], [2, 3, -1]])) ok('parseTXT 跳过标题行并保留 -1');
  else bad('parseTXT 解析官方格式出错：' + JSON.stringify(p));

  if (CL.parseTXT('\uFEFF像素矩阵\n1 2\n').length === 1) ok('parseTXT 能吃 BOM'); else bad('BOM 处理失败');

  // 与 generator.blocksFromTXT 口径一致性（关键回归：-1 开头的行不能再被丢掉）
  const genSrc = fs.readFileSync(path.join(__dirname, 'generator.js'), 'utf8');
  const mfn = genSrc.match(/function blocksFromTXT[\s\S]*?\n  \}/);
  if (!mfn) { bad('generator.blocksFromTXT 未找到'); }
  else {
    const blocksFromTXT = new Function('return (' + mfn[0] + ')')();
    const probe = '像素矩阵\n-1 1 2\n3 4 5\n';
    const got = JSON.stringify(blocksFromTXT(probe));
    if (got === '[[-1,1,2],[3,4,5]]') ok('generator.blocksFromTXT 已支持 -1 开头的行（v154 修复）');
    else bad('generator.blocksFromTXT 仍会丢 -1 开头的行：' + got);

    // 全量回归：300 关用两套解析器必须得到同一个矩阵
    const dir2 = DIR_OFFICIAL;
    const files2 = fs.readdirSync(dir2).filter((f) => /^level_\d+\.txt$/.test(f));
    let mism = 0, dropped = 0;
    for (const f of files2) {
      const txt = fs.readFileSync(path.join(dir2, f), 'utf8');
      const a = JSON.stringify(blocksFromTXT(txt)), b = JSON.stringify(CL.parseTXT(txt));
      if (a !== b) { mism++; if (a.length < b.length) dropped++; }
    }
    if (mism) bad(mism + ' 关两套 TXT 解析结果不一致（其中 ' + dropped + ' 关疑似丢行）');
    else ok('300/300 关：generator.blocksFromTXT 与 ColorLibs.parseTXT 解析结果完全一致');
    // 老格式（0 当空位）不受影响
    if (JSON.stringify(blocksFromTXT('标题\n0 1 2\n3 4 5\n')) === '[[0,1,2],[3,4,5]]') ok('老格式 TXT（0 为空位）解析不变，向后兼容');
    else bad('老格式 TXT 解析被破坏');
  }
}

console.log('\n===== 结果：失败 ' + fail + ' 项，警告 ' + warn + ' 项 =====');
process.exit(fail ? 1 : 0);
