/**
 * 死锁可视化：对指定关卡跑一次确定性玩家求解，逐步打印决策与棋盘，直到通关或卡死。
 * 用法：node diag-deadlock.js L39 [seed] [mode]
 *   棋盘：每列从顶(左)到底(右)；问号显示 ?(真色)；万能=*；冰块列标 [ICE:n]；已完成列标 ✓
 *   决策来源：🔍探路翻问号 / 🎯正常路由
 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const ctx = { SS: {}, console, Object };
vm.createContext(ctx);
['colors.js', 'level-loader.js', 'engine.js', 'solver.js', 'analysis.js', 'player-solver.js'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'js', f), 'utf8'), ctx, { filename: f });
});
const E = ctx.SS.Engine, L = ctx.SS.LevelLoader, S = ctx.SS.Solver, P = ctx.SS.PlayerSolver;
const dir = path.join(__dirname, '..', 'levels（实验1-100关）');

const i = parseInt(process.argv[2].replace(/\D/g, ''), 10);
const mode = process.argv[4] || 'gated';
const raw = JSON.parse(fs.readFileSync(path.join(dir, 'level_' + i + '.json'), 'utf8'));
ctx.SS.Colors.reset();
const lvl = L.parse(raw);
let cur = E.createState(lvl.boards[0], lvl.stepCount);
const H = cur.rowCount, K = cur.colCount;

function cellStr(cell, masked) {
  if (!cell || cell.kind === 'empty') return ' . ';
  if (cell.kind === 'rainbow') return ' * ';
  const sur = cell.features && cell.features.indexOf('Surprise') !== -1;
  if (masked && sur) return '?' + (cell.colorKey || '') + ''; // 玩家看不到，但括号给我们看真值
  return cell.colorKey || '?';
}
function rowOfCell(cell) {
  if (!cell || cell.kind === 'empty') return '·';
  if (cell.kind === 'rainbow') return '*';
  const sur = cell.features && cell.features.indexOf('Surprise') !== -1;
  const k = cell.colorKey || '?';
  return sur ? ('?' + k) : (' ' + k);
}
function printBoard(state) {
  for (let c = 0; c < state.colCount; c++) {
    const col = state.columns[c];
    let tag = '';
    if (state.completed[c]) tag = ' ✓完成';
    else if (E.isFrozen(state, c)) tag = ' ❄ICE(还需' + E.iceRemaining(state, c) + ')';
    const cells = col.map(rowOfCell).join(' | ');
    console.log('  列' + c + ': ' + cells + tag);
  }
}
function benchStr(state) {
  const b = state.bench;
  if (!b || b.kind === 'empty') return '空';
  if (b.kind === 'rainbow') return '*万能';
  return (b.colorKey || '?');
}
function completed(state) { let n = 0; for (let c = 0; c < state.colCount; c++) if (state.completed[c]) n++; return n; }

console.log('===== L' + i + ' ' + K + 'x' + H + ' 上限' + lvl.stepCount + ' 模式=' + mode + ' =====');
console.log('（? 前缀=玩家看不见的问号，后面的色是真实值，仅供我们核对）');
console.log('\n初始棋盘：'); printBoard(cur);

const commit = new Array(K).fill(null);
if (cur.fixedColor) for (let c = 0; c < K; c++) if (cur.fixedColor[c]) commit[c] = cur.fixedColor[c];

const modeOpts = P.MODES.find(m => m.name === mode).opts;
const relax = P.hasSurprise(cur);   // 含问号关：问号当软障碍
const hidden = P.hasHiddenObstacle(cur);
let step = 0;
const seenKey = {};
let stuckReason = '';

while (!E.isWin(cur) && cur.moves > 0) {
  const view = P.maskSurprise(cur);
  const src = '🎯路由';
  // 玩家版代表性策略(greedyA)：贪心锁列 + always + 伪万能块 + 防杂色循环；混合关附带挤压问号
  const mv = S.chooseRoutingMove(view, commit, null, {
    relaxUseful: relax, squeezeUnknown: relax && hidden,
    pseudoWild: relax, antiJunkLoop: relax, expandTransit: relax,
    commitMode: 'always',
    dualPriority: !!modeOpts.dualPriority, eps: 0
  });
  if (mv < 0) { stuckReason = '无可行动作 (mv<0)'; break; }

  const handBefore = benchStr(cur);
  const r = E.move(cur, mv);
  if (!r.ok) { stuckReason = '点击列' + mv + '非法: ' + r.reason; break; }
  cur = r.state;
  step++;

  console.log('\n步' + step + '  手牌=' + handBefore + ' → 点击列' + mv + '  [' + src + ']  (锁列commit=' + JSON.stringify(commit.map(x => x || '-')) + ')');
  printBoard(cur);
  console.log('  余步=' + cur.moves + '  已完成=' + completed(cur) + '/' + K + '  新手牌=' + benchStr(cur));

  const key = JSON.stringify(cur.columns.map(col => col.map(c => c ? (c.features && c.features.indexOf('Surprise') !== -1 ? '?' : c.colorKey || '*') : '.'))) + '|' + benchStr(cur);
  seenKey[key] = (seenKey[key] || 0) + 1;
  if (seenKey[key] > 4) { stuckReason = '局面循环重复 >4 次（死循环）'; break; }
  if (step > 200) { stuckReason = '步数保护上限'; break; }
}

console.log('\n========== 结束 ==========');
if (E.isWin(cur)) console.log('✅ 通关，用 ' + step + ' 步');
else console.log('❌ 未通关：' + (stuckReason || (cur.moves <= 0 ? '步数耗尽' : '?')) +
  '  已完成 ' + completed(cur) + '/' + K + '  余步 ' + cur.moves);
