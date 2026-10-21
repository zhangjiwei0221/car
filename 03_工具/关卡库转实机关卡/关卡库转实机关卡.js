// 关卡库(ant-level-library) → 实机关卡本体(toprow/blocks/maprow/mapcol/spools)
// 直接调用工程自己的 AntSolver.toGameFormat，保证与生成器「导出JSON」口径逐字节同源。
const fs = require('fs'), vm = require('vm'), path = require('path');
const BIN = process.argv[2];
const SRC = process.argv[3];
const OUT = process.argv[4];      // 输出文件（可选）
const LEVEL_NO = process.argv[5]; // 关号（可选，给文件名用）

const ctx = { window: {}, document: { createElement: () => ({ style: {} }) }, console, setTimeout, clearTimeout, alert: () => {}, navigator: {} };
ctx.self = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ['js/utils.js']) {
  vm.runInContext(fs.readFileSync(path.join(BIN, f), 'utf8'), ctx, { filename: f });
}
const A = ctx.AntSolver;
if (!A || !A.toGameFormat) { console.error('toGameFormat 未加载'); process.exit(2); }

const lib = JSON.parse(fs.readFileSync(SRC, 'utf8'));
if (lib.type !== 'ant-level-library') console.error('⚠ 输入不是 ant-level-library（type=' + lib.type + '），仍按单关 data 处理');
const lv = lib.levels[0];
const data = lv.data;
if (!data || !data.board || !data.blocks) { console.error('✗ 缺 data.board / data.blocks，无法转换'); process.exit(3); }

const g = A.toGameFormat({ blocks: data.blocks, board: data.board, bufferLimit: data.bufferLimit });

// 自检①：结构齐全
const keys = Object.keys(g);
console.log('键:', keys.join(','), '| toprow', g.toprow, '| 车场', g.maprow + 'x' + g.mapcol);
// 自检②：spools 尺寸 & 计数
let boxes = 0, blacks = 0, pipes = 0, chains = 0, qs = 0, numice = 0, capSum = 0;
for (const row of g.spools) for (const sp of row) {
  if (!sp) { console.error('✗ spools 有空槽'); process.exit(4); }
  const ts = Array.isArray(sp.type) ? sp.type : (sp.type ? [sp.type] : []);
  if (sp.id === -1) blacks++;
  else if (ts.some(t => t >= 11 && t <= 14)) { pipes++; for (const q of (sp.param || [])) capSum += q.count || 0; }
  else if (sp.id > 0) { boxes++; capSum += sp.count || 0; }
  if (ts.includes(5)) chains++;
  if (ts.includes(6)) qs++;
  if (ts.includes(7)) numice++;
}
let pixels = 0, colorSet = new Set();
for (const row of g.blocks) for (const v of row) if (v > 0) { pixels++; colorSet.add(v); }
console.log('盒子 ' + boxes + ' / 黑块 ' + blacks + ' / 管道 ' + pipes + ' / 链格 ' + chains + ' / 问号 ' + qs + ' / 数字冰 ' + numice);
console.log('车上载客合计 ' + capSum + ' | 板上像素 ' + pixels + ' | 颜色数 ' + colorSet.size + ' → 守恒 ' + (capSum === pixels ? '✓' : '✗ 差 ' + (capSum - pixels)));

if (OUT) {
  fs.writeFileSync(OUT, JSON.stringify(g, null, 2));
  console.log('已写出 ' + OUT + '（' + fs.statSync(OUT).size + ' 字节）' + (LEVEL_NO ? ' → 建议命名 G1_bq_level_' + LEVEL_NO + '.json' : ''));
}
