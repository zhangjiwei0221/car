#!/usr/bin/env node
/**
 * 将关卡包补齐到目标总数（默认 20），复用 bin/js 生成器/求解器（headless）。
 * 合法性判定：以【内部 board（冰耐久=3，与程序端“激活1次+3步解锁”一致）】重新求解可通关为准。
 *  （fromGameFormat 的 ice:2 只是导入近似，对启发式求解器偏严，不作为拒绝依据。）
 *
 * 步骤：
 *  1) 载入模块
 *  2) 读现有 关卡数据.json，逐关用内部 board 重解校验；不合格者尝试用源图重生成修复
 *  3) 从源图目录挑未使用图纸，生产“内部可解”关卡补足到目标数
 *  4) 写关卡本体(toGameFormat)/源txt，重建 关卡数据.json / 分析报告.csv / 生产报告.md
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JS_DIR = path.join(__dirname, 'js');
const MODULES = ['utils.js', 'solver.js', 'simulator.js', 'playersim.js', 'analysis.js', 'generator.js'];
const sandbox = { console, Math, Date, JSON, Object, Array, String, Number, isNaN, parseInt, parseFloat };
sandbox.global = sandbox;
vm.createContext(sandbox);
for (const m of MODULES) vm.runInContext(fs.readFileSync(path.join(JS_DIR, m), 'utf8'), sandbox, { filename: m });
const AntSolver = sandbox.AntSolver;

const CONFIG = {
  boxSizeMin: 12, boxSizeMax: 26, boxSizeMode: 'random', bufferLimit: 5,
  swapRatio: 0, swapRegionMin: 50, swapRegionMax: 100,
  icePercent: 12, blackPercent: 8, chainCount: 1, questionPercent: 8,
  boardRowsMin: 4, boardRowsMax: 5, boardColsMin: 5, boardColsMax: 6,
  narrowPath: false, packFull: false,
  candidateCount: 6, chokeBranches: 3, rounds: 2, maxRetries: 6
};
const FALLBACKS = [
  {},
  { blackPercent: 5, icePercent: 8, questionPercent: 5, chainCount: 1 },
  { blackPercent: 3, icePercent: 6, questionPercent: 4, chainCount: 0 },
  { blackPercent: 0, icePercent: 4, questionPercent: 0, chainCount: 0 },
  { blackPercent: 0, icePercent: 0, questionPercent: 0, chainCount: 0, boardRowsMax: 6, boardColsMax: 7 }
];

// 源图目录（44 关为超集，含 9 关全部图纸）
const SRC_DIRS = [
  path.join(__dirname, '..', 'txt图', '20x20图纸_44关'),
  path.join(__dirname, '..', 'txt图', '20x20图纸_9关')
];
const PKG_DIR = process.argv[2] || path.join(__dirname, '..', 'output', '20x20关卡包_20关');
const TARGET_TOTAL = parseInt(process.argv[3], 10) || 20;

const levelsDir = path.join(PKG_DIR, '关卡');
const txtDir = path.join(PKG_DIR, 'txt图');
const dataDir = path.join(PKG_DIR, '关卡数据');
[levelsDir, txtDir, dataDir].forEach(d => fs.mkdirSync(d, { recursive: true }));

function baseOf(name) { return String(name).replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '_'); }
function numOf(name) { return parseInt(name, 10) || 0; }

function findSrcTxt(base) {
  for (const dir of SRC_DIRS) {
    const p = path.join(dir, base + '.txt');
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  }
  return null;
}

// 双重合法性判定：
//  A) 内部 board（冰耐久3）——与程序端 ice 逻辑一致的忠实判定（主）
//  B) 出厂件 round-trip（toGameFormat→fromGameFormat，冰耐久2）——更严的近似（冗余保险）
// 两者皆通过才算“稳合法”。
function solvableCheck(entry) {
  if (!entry || !entry.board) return { ok: false, internalOk: false, reimportOk: false, reason: '无内部board' };
  const level = { blocks: entry.blocks, board: entry.board, bufferLimit: entry.bufferLimit || 5 };
  const parsed = AntSolver.parseLevel(level);
  const si = AntSolver.Generator.structuralDeadlockCheck(level.board);
  const ri = AntSolver.Solver.solve(parsed, {});
  const internalOk = !!(si.ok && ri.completed);

  const g = AntSolver.toGameFormat(parsed);
  const lb = AntSolver.fromGameFormat(g);
  const pb = AntSolver.parseLevel(lb);
  const sb2 = AntSolver.Generator.structuralDeadlockCheck(lb.board);
  const rb = AntSolver.Solver.solve(pb, {});
  const reimportOk = !!(sb2.ok && rb.completed);

  return { ok: internalOk && reimportOk, internalOk, reimportOk, reason: si.ok ? '' : si.reason, parsed };
}

// 生产“稳合法”关卡（内部冰3 + 出厂冰2 双通过）；逐级降级重试
function produceValid(blocks) {
  let internalOnly = null;   // 兜底：至少内部可解者
  for (let fi = 0; fi < FALLBACKS.length; fi++) {
    const cfg = Object.assign({}, CONFIG, FALLBACKS[fi], { mapSize: blocks.length });
    for (let attempt = 0; attempt < 5; attempt++) {
      const r = AntSolver.Generator.produce(blocks, cfg);
      if (!r || !r.valid) continue;
      const e = entryFromProduce('_tmp', r);
      const chk = solvableCheck(e);
      if (chk.ok) return { result: r, fallbackIdx: fi };            // 双通过，最佳
      if (chk.internalOk && !internalOnly) internalOnly = { result: r, fallbackIdx: fi }; // 仅内部通过，暂存兜底
    }
  }
  return internalOnly;   // 全程无双通过 → 退回“至少内部(游戏冰逻辑)可解”者
}

function entryFromProduce(name, r) {
  return {
    name, valid: true,
    difficulty: r.difficulty ? r.difficulty.score : 0,
    grade: r.difficulty ? r.difficulty.grade : '-',
    obstacleNames: r.difficulty ? r.difficulty.obstacleNames : '',
    bufferLimit: r.level.bufferLimit,
    blocks: r.level.blocks, board: r.level.board,
    audit: r.audit || null, generationEval: r.generationEval || null
  };
}

function writeLevel(base, entry) {
  const level = { blocks: entry.blocks, board: entry.board, bufferLimit: entry.bufferLimit };
  const game = AntSolver.toGameFormat(AntSolver.parseLevel(level));
  fs.writeFileSync(path.join(levelsDir, base + '.json'), JSON.stringify(game, null, 2));
  const txt = findSrcTxt(base);
  if (txt != null) fs.writeFileSync(path.join(txtDir, base + '.txt'), txt);
  return game;
}

function countObstacles(g) {
  let black = 0, ice = 0, chain = 0, q = 0, pipe = 0, box = 0, empty = 0;
  for (const row of g.spools) for (const s of row) {
    if (s.id === -1) { black++; continue; }
    const t = Array.isArray(s.type) ? s.type : [s.type];
    if (t.some(x => x >= 11 && x <= 14)) { pipe++; continue; }
    if ((s.id === 0 || s.id == null) && t.every(x => x === 0)) { empty++; continue; }
    box++;
    if (t.includes(4)) ice++; if (t.includes(5)) chain++; if (t.includes(6)) q++;
  }
  return { black, ice, chain, q, pipe, box, empty };
}

function main() {
  // 读现有数据
  let oldData = { levels: [] };
  const dataPath = path.join(dataDir, '关卡数据.json');
  if (fs.existsSync(dataPath)) oldData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const entryByBase = {};
  oldData.levels.forEach(l => { entryByBase[baseOf(l.name)] = l; });

  // 现有关卡本体文件
  const presentBases = fs.readdirSync(levelsDir).filter(f => /\.json$/i.test(f)).map(baseOf);
  const kept = {};   // base -> entry (内部可解)
  const tried = new Set();

  console.log('== 校验并保留现有关卡（双重判定：内部冰3 + 出厂冰2）==');
  for (const base of presentBases) {
    tried.add(base);
    let entry = entryByBase[base];
    let chk = solvableCheck(entry);
    if (chk.ok) { kept[base] = entry; continue; }
    // 未达双通过 → 用源图重生成修复（力求双通过；退而求其次至少内部可解）
    const txt = findSrcTxt(base);
    if (!txt) {
      if (chk.internalOk) { kept[base] = entry; console.log(`  ${base}: 仅内部可解、无源图可修，保留`); }
      else console.log(`  ${base}: 不可解且无源图，剔除`);
      continue;
    }
    const blocks = AntSolver.Generator.blocksFromTXT(txt);
    const tp = produceValid(blocks);
    if (tp) {
      entry = entryFromProduce(base + '.txt', tp.result);
      kept[base] = entry;
      const c2 = solvableCheck(entry);
      console.log(`  ${base}: 修复重生成 ${c2.ok ? '✓双通过' : (c2.internalOk ? '✓仅内部' : '✗')} (降级#${tp.fallbackIdx})`);
    } else if (chk.internalOk) {
      kept[base] = entry; console.log(`  ${base}: 修复未改善，保留原(内部可解)`);
    } else {
      console.log(`  ${base}: 修复失败，剔除`);
    }
  }

  // 补足到目标数
  const need = TARGET_TOTAL - Object.keys(kept).length;
  console.log(`\n现有可解 ${Object.keys(kept).length} 关，目标 ${TARGET_TOTAL}，需补 ${Math.max(0, need)} 关`);

  if (need > 0) {
    // 候选：44 关目录中未使用图纸，数字升序
    const pool = [];
    const seen = new Set(Object.keys(kept).concat([...tried]));
    for (const dir of SRC_DIRS) {
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir)) {
        if (!/\.txt$/i.test(f)) continue;
        const b = baseOf(f);
        if (seen.has(b)) continue;
        seen.add(b);
        pool.push(b);
      }
    }
    pool.sort((a, b) => numOf(a) - numOf(b));

    let added = 0;
    for (const base of pool) {
      if (added >= need) break;
      const txt = findSrcTxt(base);
      if (!txt) continue;
      const blocks = AntSolver.Generator.blocksFromTXT(txt);
      if (!blocks.length) continue;
      const tp = produceValid(blocks);
      if (!tp) { console.log(`  补充候选 ${base}: 未取得可解，跳过`); continue; }
      kept[base] = entryFromProduce(base + '.txt', tp.result);
      added++;
      console.log(`  补充 ${base}: ✓ 难度${kept[base].difficulty}[${kept[base].grade}] (降级#${tp.fallbackIdx})`);
    }
    console.log(`本次补充 ${added} 关`);
  }

  // 清空目录后统一重写（去除剔除项/陈旧文件）
  for (const f of fs.readdirSync(levelsDir)) if (/\.json$/i.test(f)) fs.unlinkSync(path.join(levelsDir, f));
  for (const f of fs.readdirSync(txtDir)) if (/\.txt$/i.test(f)) fs.unlinkSync(path.join(txtDir, f));

  const bases = Object.keys(kept).sort((a, b) => numOf(a) - numOf(b));
  const csv = ['关卡,尺寸,棋盘,盒数(含管道),盘上盒,可解,难度分,难度等级,黑块,冰,锁链,问号,管道'];
  const mergedLevels = [];
  let passCount = 0;

  console.log('\n== 最终写出并逐关重解校验 ==');
  let dualCount = 0;
  for (const base of bases) {
    const entry = kept[base];
    const game = writeLevel(base, entry);
    const chk = solvableCheck(entry);
    entry.valid = chk.internalOk;   // 合法性以游戏冰逻辑(内部)为准
    if (chk.internalOk) passCount++; else console.log(`  ! ${base} 最终内部求解不合格：${chk.reason || '未通关'}`);
    if (chk.ok) dualCount++;
    mergedLevels.push(entry);
    const ob = countObstacles(game);
    const rows = game.blocks.length, cols = game.blocks[0] ? game.blocks[0].length : 0;
    csv.push([
      '"' + base + '.txt"', rows + 'x' + cols, game.maprow + 'x' + game.mapcol,
      (chk.parsed ? chk.parsed.totalBoxes : ob.box), ob.box, (chk.internalOk ? '是' : '否'),
      entry.difficulty || 0, entry.grade || '-',
      ob.black, ob.ice, ob.chain, ob.q, ob.pipe
    ].join(','));
    console.log(`  ${base}: ${chk.internalOk ? '✓可解' : '✗'}${chk.ok ? '(双通过)' : (chk.internalOk ? '(仅内部)' : '')} 棋盘${game.maprow}x${game.mapcol} 盒${chk.parsed ? chk.parsed.totalBoxes : ob.box} 难度${entry.difficulty}[${entry.grade}] | 障碍 黑${ob.black}冰${ob.ice}链${ob.chain}问${ob.q}管${ob.pipe}`);
  }
  console.log(`  双重判定(内部冰3+出厂冰2)全通过: ${dualCount}/${bases.length}`);

  fs.writeFileSync(dataPath, JSON.stringify({
    type: 'ant-level-data', exported: new Date().toISOString(), total: mergedLevels.length, levels: mergedLevels
  }, null, 2));
  fs.writeFileSync(path.join(dataDir, '分析报告.csv'), '\ufeff' + csv.join('\n'));

  const gradeCount = {};
  mergedLevels.forEach(l => { gradeCount[l.grade] = (gradeCount[l.grade] || 0) + 1; });
  const gradeStr = Object.keys(gradeCount).map(k => k + ':' + gradeCount[k]).join(' ');
  let md = '# 生产报告（20×20 图纸批量）\n\n';
  md += '- 生成时间: ' + new Date().toLocaleString() + '\n';
  md += '- 关卡总数: ' + mergedLevels.length + ' · 可解(合法): ' + passCount + '\n';
  md += '- 难度分布: ' + gradeStr + '\n';
  md += '- 目标: 20×20 小图，小棋盘（~5列4行），少量障碍，确保合法性（可解），不追求难度\n';
  md += '- 合法性判定: 以内部 board（冰耐久3，同程序端 ice 逻辑）重新求解可通关为准\n';
  md += '- 来源: txt图/20x20图纸_9关 + txt图/20x20图纸_44关\n\n';
  md += '## 生成参数（基础档）\n```json\n' + JSON.stringify(CONFIG, null, 2) + '\n```\n\n';
  md += '## 各关明细\n';
  mergedLevels.forEach(l => {
    md += '- ' + baseOf(l.name) + '：' + (l.valid ? '✓可解' : '✗不可解') +
      ' · 难度' + (l.difficulty || 0) + '[' + (l.grade || '-') + ']\n';
  });
  fs.writeFileSync(path.join(dataDir, '生产报告.md'), md);

  console.log(`\n完成：共 ${mergedLevels.length} 关，合法 ${passCount}/${mergedLevels.length}。目录：${PKG_DIR}`);
}

main();
