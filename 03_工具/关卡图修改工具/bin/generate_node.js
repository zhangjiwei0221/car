#!/usr/bin/env node
/**
 * headless 批量生产：复用浏览器端 AntSolver 模块（bin/js/*），在 Node 中把 TXT 图纸生产为合法关卡。
 * 复刻 app.js 的 batchProduce/finishBatch 关键流程（无 DOM/ZIP）。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ---- 1) 载入核心模块到共享 vm 上下文 ----
const JS_DIR = path.join(__dirname, 'js');
const MODULES = ['utils.js', 'solver.js', 'simulator.js', 'playersim.js', 'analysis.js', 'generator.js'];
const sandbox = { console, Math, Date, JSON, Object, Array, String, Number, isNaN, parseInt, parseFloat };
sandbox.global = sandbox;
vm.createContext(sandbox);
for (const m of MODULES) {
  const code = fs.readFileSync(path.join(JS_DIR, m), 'utf8');
  vm.runInContext(code, sandbox, { filename: m });
}
const AntSolver = sandbox.AntSolver;
if (!AntSolver || !AntSolver.Generator) throw new Error('AntSolver 载入失败');

// ---- 2) 参数：20×20 小图，小棋盘 ~5列4行，少量障碍 ----
const CONFIG = {
  boxSizeMin: 12,
  boxSizeMax: 26,
  boxSizeMode: 'random',
  bufferLimit: 5,
  swapRatio: 0,          // 不做解后换球（不追求难度/卡点，优先合法稳定）
  swapRegionMin: 50,
  swapRegionMax: 100,
  icePercent: 12,        // 少量冰
  blackPercent: 8,       // 少量黑块
  chainCount: 1,         // 少量锁链
  questionPercent: 8,    // 少量问号
  boardRowsMin: 4,
  boardRowsMax: 5,
  boardColsMin: 5,
  boardColsMax: 6,
  narrowPath: false,     // 小棋盘不做窄路墙，避免过约束破坏可解
  packFull: false,
  candidateCount: 6,
  chokeBranches: 3,
  rounds: 2,
  maxRetries: 6
};

// 少量障碍的“兜底降级”序列：若某图在当前参数下拿不到 valid，逐级更保守重试
const FALLBACKS = [
  {},
  { blackPercent: 5, icePercent: 8, questionPercent: 5, chainCount: 1 },
  { blackPercent: 3, icePercent: 6, questionPercent: 4, chainCount: 0 },
  { blackPercent: 0, icePercent: 4, questionPercent: 0, chainCount: 0 },
  { blackPercent: 0, icePercent: 0, questionPercent: 0, chainCount: 0, boardRowsMax: 6, boardColsMax: 7 }
];

const SRC_DIR = process.argv[2] || path.join(__dirname, '..', 'txt图', '20x20图纸_9关');
const OUT_DIR = process.argv[3] || path.join(__dirname, '..', 'output', '20x20关卡包_9关');

function safeName(n) { return String(n).replace(/\.txt$/i, '').replace(/[\\/:*?"<>|]/g, '_'); }

function tryProduce(blocks) {
  // 逐级降级，直到拿到 valid=true；返回 {result, cfgUsed, fallbackIdx}
  for (let fi = 0; fi < FALLBACKS.length; fi++) {
    const cfg = Object.assign({}, CONFIG, FALLBACKS[fi], { mapSize: blocks.length });
    // 每级最多再试 3 次（生成器内部有随机）
    let bestInvalid = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = AntSolver.Generator.produce(blocks, cfg);
      if (r && r.valid) return { result: r, cfgUsed: cfg, fallbackIdx: fi };
      bestInvalid = r;
    }
    if (fi === FALLBACKS.length - 1 && bestInvalid) return { result: bestInvalid, cfgUsed: cfg, fallbackIdx: fi };
  }
  return null;
}

function main() {
  const srcFiles = fs.readdirSync(SRC_DIR).filter(f => /\.txt$/i.test(f));
  srcFiles.sort((a, b) => (parseInt(a) || 0) - (parseInt(b) || 0));
  console.log('源图数量:', srcFiles.length, '→', srcFiles.join(', '));

  const levelsDir = path.join(OUT_DIR, '关卡');
  const txtDir = path.join(OUT_DIR, 'txt图');
  const dataDir = path.join(OUT_DIR, '关卡数据');
  [OUT_DIR, levelsDir, txtDir, dataDir].forEach(d => fs.mkdirSync(d, { recursive: true }));

  const results = [];
  const dataLevels = [];
  const csv = ['关卡,尺寸,棋盘,盒数,可解,难度分,难度等级,障碍,峰值暂存,降级档'];

  const used = {};
  for (const f of srcFiles) {
    const txt = fs.readFileSync(path.join(SRC_DIR, f), 'utf8');
    const blocks = AntSolver.Generator.blocksFromTXT(txt);
    const rows = blocks.length, cols = blocks[0] ? blocks[0].length : 0;
    process.stdout.write(`生产 ${f} (${rows}x${cols}) ... `);

    const tp = tryProduce(blocks);
    if (!tp) { console.log('失败(无结果)'); continue; }
    const r = tp.result;
    const parsed = AntSolver.parseLevel(r.level);
    const game = AntSolver.toGameFormat(parsed);

    let base = safeName(f);
    if (used[base]) base = base + '_dup';
    used[base] = true;

    fs.writeFileSync(path.join(levelsDir, base + '.json'), JSON.stringify(game, null, 2));
    fs.writeFileSync(path.join(txtDir, base + '.txt'), txt);

    const sr = r.solveResult || {};
    console.log(`${r.valid ? '✓可解' : '✗不可解'} 棋盘${r.level.board.rows}x${r.level.board.cols} 盒${parsed.totalBoxes} 难度${r.difficulty ? r.difficulty.score : '-'}[${r.difficulty ? r.difficulty.grade : '-'}] 降级#${tp.fallbackIdx}`);

    results.push({ name: f, base, valid: r.valid, parsed, game, sr, difficulty: r.difficulty, fallbackIdx: tp.fallbackIdx });
    dataLevels.push({
      name: f, valid: r.valid,
      difficulty: r.difficulty ? r.difficulty.score : 0,
      grade: r.difficulty ? r.difficulty.grade : '-',
      bufferLimit: r.level.bufferLimit,
      blocks: r.level.blocks, board: r.level.board,
      audit: r.audit || null, generationEval: r.generationEval || null
    });
    csv.push([
      '"' + f + '"', rows + 'x' + cols,
      r.level.board.rows + 'x' + r.level.board.cols, parsed.totalBoxes,
      (r.valid ? '是' : '否'), r.difficulty ? r.difficulty.score : 0, r.difficulty ? r.difficulty.grade : '-',
      '"' + (r.difficulty && r.difficulty.obstacleNames ? r.difficulty.obstacleNames : '无') + '"',
      sr.maxBuffer != null ? sr.maxBuffer : '', tp.fallbackIdx
    ].join(','));
  }

  const passCount = results.filter(r => r.valid).length;
  fs.writeFileSync(path.join(dataDir, '关卡数据.json'), JSON.stringify({
    type: 'ant-level-data', exported: new Date().toISOString(), total: results.length, levels: dataLevels
  }, null, 2));
  fs.writeFileSync(path.join(dataDir, '分析报告.csv'), '\ufeff' + csv.join('\n'));

  let md = '# 生产报告（20×20 图纸批量）\n\n';
  md += '- 生成时间: ' + new Date().toLocaleString() + '\n';
  md += '- 关卡总数: ' + results.length + ' · 可解(合法): ' + passCount + '\n';
  md += '- 目标: 20×20 小图，小棋盘（~5列4行），少量障碍，确保合法性（可解），不追求难度\n\n';
  md += '## 生成参数（基础档）\n```json\n' + JSON.stringify(CONFIG, null, 2) + '\n```\n\n';
  md += '## 各关明细\n';
  results.forEach(r => {
    md += '- ' + r.name + '：' + (r.valid ? '✓可解' : '✗不可解') +
      ' · 棋盘' + r.game.maprow + '×' + r.game.mapcol +
      ' · 盒数' + r.parsed.totalBoxes +
      ' · 难度' + (r.difficulty ? r.difficulty.score : '-') + '[' + (r.difficulty ? r.difficulty.grade : '-') + ']' +
      ' · 降级档#' + r.fallbackIdx + '\n';
  });
  fs.writeFileSync(path.join(dataDir, '生产报告.md'), md);

  console.log(`\n完成：${passCount}/${results.length} 合法。输出目录：${OUT_DIR}`);
}

main();
