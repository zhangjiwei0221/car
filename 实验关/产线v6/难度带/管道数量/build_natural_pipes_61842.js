#!/usr/bin/env node
'use strict';
/**
 * build_natural_pipes_61842 —— 自然形态多管：N 个功能管 + 其余被搬格变黑块（id:-1）
 *
 * 由 自然管道/build_natural_pipe_53177.js 扩展（pid 53177 → 61842）：
 *   - 支持多根管：--pipe r,c --dir D --queue "r,c;r,c" 可重复 N 次；
 *   - 每根管的队列格列表顺序 = 该管吐车顺序，P 自己的车必须在自己的队列里；
 *   - 全局队列格不重复（一根管的队列格不能同时属于另一根管）；
 *   - 每根管的出口格（P 沿 dir 的邻格）必须在盘内、互不相同、
 *     且改关后仍是车（id>0，不能是黑块/管道，否则管永远不吐车）；
 *   - 唯一车守卫：底座里该色只有 1 辆车的，不许进队列（N5 断崖教训）；
 *   - 出口行 < 4 只警告（任务书要深行出口）。
 *
 * 其余规则与 53177 相同：不允许 0 容量管道；逐色守恒（车 + 队列 = 像素总数）；
 * 除被改格外逐格相等；开局可点 ≥5；无空格。
 *
 * 用法：
 *   node build_natural_pipes_61842.js <底座.json> <输出.json> \
 *        --pipe 5,3 --dir 13 --queue "0,2;5,3" \
 *        [--pipe 5,5 --dir 13 --queue "2,2;5,5" ...]
 *   --dir 11上 12右 13下 14左
 *
 * 只新增文件；不改 03_工具/正式版、现有文档/关卡/客户端。
 */
const fs = require('fs');
const path = require('path');
const B = require(path.resolve(__dirname, '../../../../03_工具/正式版/Build006Thickness_v688.js'));
const A = B.loadSolver('corner');
const Sim = A.Simulator;

const argv = process.argv.slice(2);
const pos = [];
const rawPipes = [], rawDirs = [], rawQueues = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const k = a.slice(2);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new Error(`参数 --${k} 缺值`);
    i++;
    if (k === 'pipe') rawPipes.push(v);
    else if (k === 'dir') rawDirs.push(v);
    else if (k === 'queue') rawQueues.push(v);
    else throw new Error(`未知参数 --${k}`);
  } else pos.push(a);
}
const [baseFile, outFile] = pos;
if (!baseFile || !outFile) {
  console.error('用法: node build_natural_pipes_61842.js <底座.json> <输出.json> --pipe r,c --dir D --queue "r,c;r,c" [--pipe ...]');
  process.exit(2);
}
if (!rawPipes.length) throw new Error('至少一根管');
if (rawPipes.length !== rawDirs.length || rawPipes.length !== rawQueues.length) {
  throw new Error(`--pipe/--dir/--queue 数量不一致: ${rawPipes.length}/${rawDirs.length}/${rawQueues.length}`);
}
const key = (r, c) => r + ',' + c;
const PIPE_SPECS = rawPipes.map((pv, i) => {
  const P = String(pv).split(',').map(Number);
  const DIR = Number(rawDirs[i]);
  const QUEUE = String(rawQueues[i]).split(';').filter(Boolean).map(s => s.split(',').map(Number));
  if (P.length !== 2 || !Number.isFinite(P[0]) || !Number.isFinite(P[1])) throw new Error(`第 ${i + 1} 根 --pipe 非法`);
  if (![11, 12, 13, 14].includes(DIR)) throw new Error(`第 ${i + 1} 根 --dir 必须是 11/12/13/14`);
  if (!QUEUE.length) throw new Error(`第 ${i + 1} 根 --queue 为空`);
  if (!QUEUE.some(([r, c]) => r === P[0] && c === P[1])) throw new Error(`第 ${i + 1} 根 --queue 必须包含 P 本身`);
  return { P, DIR, QUEUE };
});

// 全局队列格唯一
{
  const seen = new Map();
  for (let i = 0; i < PIPE_SPECS.length; i++) {
    for (const [r, c] of PIPE_SPECS[i].QUEUE) {
      const k = key(r, c);
      if (seen.has(k)) throw new Error(`队列格 ${k} 同时出现在第 ${seen.get(k) + 1} 和第 ${i + 1} 根管`);
      seen.set(k, i);
    }
  }
}

const game = JSON.parse(fs.readFileSync(baseFile, 'utf8'));
const sp = game.spools;
const R = sp.length, C = sp[0].length;

for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
  const t = sp[r][c] && sp[r][c].type;
  const ts = Array.isArray(t) ? t : [t || 0];
  if (ts.some(x => x >= 11 && x <= 14)) throw new Error(`底座已有管道 (${r},${c})，本实验要求纯底座`);
}

// 底座逐色车辆数（唯一车守卫）
const baseCarCount = {};
for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
  const s = sp[r][c];
  if (s && s.id > 0 && s.count > 0) baseCarCount[s.id] = (baseCarCount[s.id] || 0) + 1;
}

// 解析每根管的队列源
const errors = [];
const warnings = [];
const pipes = PIPE_SPECS.map((spec, i) => {
  const sources = spec.QUEUE.map(([r, c]) => {
    const s = sp[r][c];
    if (!s) throw new Error(`第 ${i + 1} 根队列格 (${r},${c}) 不存在`);
    if (!(s.id > 0 && s.count > 0)) throw new Error(`第 ${i + 1} 根队列格 (${r},${c}) 不是车: ${JSON.stringify(s)}`);
    if ((s.type || 0) !== 0) throw new Error(`第 ${i + 1} 根队列格 (${r},${c}) 不是普通车: type=${s.type}`);
    if (baseCarCount[s.id] === 1) throw new Error(`第 ${i + 1} 根队列格 (${r},${c}) 是色 ${s.id} 唯一车（禁止）`);
    return { r, c, id: s.id, count: s.count };
  });
  const [pr, pc] = spec.P;
  const dy = { 11: -1, 12: 0, 13: 1, 14: 0 }[spec.DIR];
  const dx = { 11: 0, 12: 1, 13: 0, 14: -1 }[spec.DIR];
  const exit = [pr + dy, pc + dx];
  if (exit[0] < 0 || exit[0] >= R || exit[1] < 0 || exit[1] >= C) throw new Error(`第 ${i + 1} 根管出口 (${exit}) 越界`);
  if (exit[0] < 4) warnings.push(`第 ${i + 1} 根管出口行 ${exit[0]} < 4（不够深）`);
  return { i, P: spec.P, DIR: spec.DIR, exit, sources, param: sources.map(s => ({ id: s.id, count: s.count })) };
});

// 出口互不相同 + 不能指向会被改成黑块/管道的格
{
  const exits = new Set();
  for (const p of pipes) {
    const k = key(p.exit[0], p.exit[1]);
    if (exits.has(k)) errors.push(`出口格 ${k} 重复`);
    exits.add(k);
  }
  for (const p of pipes) {
    for (const other of pipes) {
      const k = key(p.exit[0], p.exit[1]);
      if (key(other.P[0], other.P[1]) === k) errors.push(`第 ${p.i + 1} 根出口是第 ${other.i + 1} 根管身 ${k}`);
      for (const s of other.sources) {
        if (!(s.r === other.P[0] && s.c === other.P[1]) && key(s.r, s.c) === k) {
          errors.push(`第 ${p.i + 1} 根出口 ${k} 会被第 ${other.i + 1} 根的黑块占据（永不吐车）`);
        }
      }
    }
  }
}

// 改关
const next = JSON.parse(JSON.stringify(game));
const allSources = [];
const blacks = [];
for (const p of pipes) {
  next.spools[p.P[0]][p.P[1]] = { id: 0, type: p.DIR, param: p.param, count: 0 };
  for (const s of p.sources) {
    allSources.push({ pipe: p.i, ...s });
    if (s.r === p.P[0] && s.c === p.P[1]) continue;
    next.spools[s.r][s.c] = { id: -1, type: 0, param: 0, count: 0 };
    blacks.push({ pipe: p.i, ...s });
  }
}

// ---- 自检 ----
// 1) 无空管道
let emptyPipes = 0; const pipeCells = [];
for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
  const s = next.spools[r][c];
  const ts = Array.isArray(s.type) ? s.type : [s.type || 0];
  if (ts.some(x => x >= 11 && x <= 14)) {
    pipeCells.push([r, c]);
    if (!Array.isArray(s.param) || !s.param.length) emptyPipes++;
  }
}
if (emptyPipes) errors.push(`空管道 ${emptyPipes} 个`);

// 2) 无空格
const empties = [];
for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
  const s = next.spools[r][c];
  const ts = Array.isArray(s && s.type) ? s.type : [(s && s.type) || 0];
  const isPipe = ts.some(x => x >= 11 && x <= 14);
  if (!s || (!isPipe && s.id !== -1 && !(s.id > 0))) empties.push(`(${r},${c})`);
}
if (empties.length) errors.push(`空格 ${empties.length}: ${empties.join(' ')}`);

// 3) 逐色守恒
const px = {};
for (const row of next.blocks) for (const v of row) if (v > 0) px[v] = (px[v] || 0) + 1;
const caps = {};
for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
  const s = next.spools[r][c];
  const ts = Array.isArray(s.type) ? s.type : [s.type || 0];
  if (ts.some(x => x >= 11 && x <= 14)) {
    for (const q of (Array.isArray(s.param) ? s.param : [])) if (q && q.id > 0) caps[q.id] = (caps[q.id] || 0) + q.count;
  } else if (s.id > 0) caps[s.id] = (caps[s.id] || 0) + s.count;
}
const badColors = [];
for (const k of new Set([...Object.keys(px), ...Object.keys(caps)])) {
  const a = px[k] || 0, b = caps[k] || 0;
  if (a !== b) badColors.push({ color: Number(k), pixels: a, caps: b });
}
if (badColors.length) errors.push(`守恒失败 ${badColors.length} 色`);
const pxTotal = Object.values(px).reduce((a, b) => a + b, 0);
const capTotal = Object.values(caps).reduce((a, b) => a + b, 0);

// 4) 开局可点 ≥5
const lv = A.parseLevel(A.fromGameFormat(next));
const st0 = Sim.createState(lv, { useSlotStart: true, bottomOnly: false, instantChain: false });
const opening = Sim.listMoves(st0).filter(m => !m.blocked).length;
if (opening < 5) errors.push(`开局可点 ${opening} < 5`);

// 5) 逐格 diff：只允许队列格 + P 变化
const diffCells = [];
for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
  if (JSON.stringify(game.spools[r][c]) !== JSON.stringify(next.spools[r][c])) diffCells.push([r, c]);
}
const expectDiff = new Set(allSources.map(s => key(s.r, s.c)));
const extraDiff = diffCells.filter(([r, c]) => !expectDiff.has(key(r, c)));
if (extraDiff.length) errors.push(`意外改格: ${extraDiff.map(([r, c]) => key(r, c)).join(' ')}`);
if (diffCells.length !== expectDiff.size) errors.push(`diff 格数 ${diffCells.length} != 预期 ${expectDiff.size}`);

// 6) 出口格改关后仍是车
const exitStates = pipes.map(p => {
  const s = next.spools[p.exit[0]][p.exit[1]];
  const ok = !!(s && s.id > 0 && (s.type || 0) === 0);
  if (!ok) errors.push(`第 ${p.i + 1} 根出口 (${p.exit}) 改关后不是普通车: ${JSON.stringify(s)}`);
  return { pipe: p.i, exit: p.exit, ok, id: s && s.id, count: s && s.count, type: s && s.type };
});

// 7) 顶层字段未变
for (const k of Object.keys(game)) {
  if (k === 'spools') continue;
  if (JSON.stringify(game[k]) !== JSON.stringify(next[k])) errors.push(`顶层字段 ${k} 被改`);
}

// 8) 队列总量 = 被搬格总量（每根管）
for (const p of pipes) {
  const srcTotal = p.sources.reduce((a, s) => a + s.count, 0);
  const qTotal = p.param.reduce((a, q) => a + q.count, 0);
  if (srcTotal !== qTotal) errors.push(`第 ${p.i + 1} 根队列总量 ${qTotal} != 被搬车总量 ${srcTotal}`);
}

const report = {
  pid: 61842,
  base: path.resolve(baseFile),
  out: path.resolve(outFile),
  pipes: pipes.map(p => ({
    pipe: { r: p.P[0], c: p.P[1], dir: p.DIR, exit: p.exit },
    queueSources: p.sources,
    queueParam: p.param,
    queueCars: p.param.length,
    blacks: p.sources.filter(s => !(s.r === p.P[0] && s.c === p.P[1])).map(s => ({ r: s.r, c: s.c, was: `${s.id}:${s.count}` }))
  })),
  pipeCount: pipes.length,
  blackCount: blacks.length,
  openingPickable: opening,
  pipeCells,
  emptyPipes,
  empties,
  conserved: badColors.length === 0,
  badColors,
  pxTotal, capTotal,
  exitStates,
  diffCells: diffCells.map(([r, c]) => key(r, c)),
  errors, warnings
};

if (errors.length) {
  console.log(JSON.stringify(report, null, 1));
  console.error('自检失败: ' + errors.join('; '));
  process.exit(1);
}
fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(next, null, 1));
console.log(JSON.stringify(report));
