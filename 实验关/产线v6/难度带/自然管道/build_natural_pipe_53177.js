#!/usr/bin/env node
'use strict';
/**
 * build_natural_pipe_53177 —— 自然形态管道：1 个功能管 + 其余被搬格变黑块（id:-1）
 *
 * 与旧「空壳管」实验的区别（用户 2026-11-19）：
 *   真实关卡的管道没有 0 容量；被搬走的格子应当是黑块，而不是 param:[] 的空壳管。
 *
 * 规则：
 *   - 队列格列表里每格的原车按列表顺序进入功能管 param（含 P 自己的车，与 E4 同法）；
 *   - P 变功能管 {id:0,type:dir,param:[{id,count}...],count:0}；
 *   - 其余队列格变黑块 {id:-1,type:0,param:0,count:0}；
 *   - 不允许任何 param 为空的管道；逐色容量守恒（车 + 队列 = 像素总数）；
 *   - 除上述被改格外，其余格与底座逐格相等（输出文件按底座同样的 1 空格缩进序列化，
 *     可用 diff 核对“只改了这些格”）。
 *
 * 用法：
 *   node build_natural_pipe_53177.js <底座.json> <输出.json> \
 *        --pipe r,c --dir 11|12|13|14 --queue "r,c;r,c;...[,P]"
 *   （--queue 必须包含 P 本身，且顺序即管道吐车顺序；--dir 11上 12右 13下 14左）
 *
 * 自检：无空格（黑块/管道不算空）、开局可点 ≥5、无空管道、逐色守恒、逐格 diff 数量。
 * 只新增文件；不改 03_工具/正式版、现有文档/关卡/客户端。
 */
const fs = require('fs');
const path = require('path');
const B = require(path.resolve(__dirname, '../../../../03_工具/正式版/Build006Thickness_v688.js'));
const A = B.loadSolver('corner');
const Sim = A.Simulator;

const argv = process.argv.slice(2);
const pos = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) {
    const k = argv[i].slice(2);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new Error(`参数 --${k} 缺值`);
    argv[k] = v; i++;
  } else pos.push(argv[i]);
}
const [baseFile, outFile] = pos;
if (!baseFile || !outFile || !argv.pipe || !argv.dir || !argv.queue) {
  console.error('用法: node build_natural_pipe_53177.js <底座.json> <输出.json> --pipe r,c --dir 11|12|13|14 --queue "r,c;r,c;..."');
  process.exit(2);
}
const P = String(argv.pipe).split(',').map(Number);
const DIR = Number(argv.dir);
const QUEUE = String(argv.queue).split(';').filter(Boolean).map(s => s.split(',').map(Number));
if (P.length !== 2 || !Number.isFinite(P[0]) || !Number.isFinite(P[1])) throw new Error('--pipe 非法');
if (![11, 12, 13, 14].includes(DIR)) throw new Error('--dir 必须是 11/12/13/14');
if (!QUEUE.length) throw new Error('--queue 为空');
if (!QUEUE.some(([r, c]) => r === P[0] && c === P[1])) throw new Error('--queue 必须包含 P 本身（P 自己的车要进队列）');
const key = (r, c) => r + ',' + c;
const seen = new Set();
for (const [r, c] of QUEUE) {
  if (seen.has(key(r, c))) throw new Error(`--queue 重复格 ${key(r, c)}`);
  seen.add(key(r, c));
}

const game = JSON.parse(fs.readFileSync(baseFile, 'utf8'));
const sp = game.spools;
const R = sp.length, C = sp[0].length;

// 底座不允许已有管道（否则“无空管道”与 diff 解释会混淆）
for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
  const t = sp[r][c] && sp[r][c].type;
  const ts = Array.isArray(t) ? t : [t || 0];
  if (ts.some(x => x >= 11 && x <= 14)) throw new Error(`底座已有管道 (${r},${c})，本实验要求纯底座`);
}

// 队列格必须是普通车（type 0；数字冰=7 / 问号=6 / 链=5 一律拒绝）
const sources = QUEUE.map(([r, c]) => {
  const s = sp[r][c];
  if (!s) throw new Error(`队列格 (${r},${c}) 不存在`);
  if (!(s.id > 0 && s.count > 0)) throw new Error(`队列格 (${r},${c}) 不是车: ${JSON.stringify(s)}`);
  if ((s.type || 0) !== 0) throw new Error(`队列格 (${r},${c}) 不是普通车: type=${s.type}`);
  return { r, c, id: s.id, count: s.count };
});
const pipeSrc = sources.find(s => s.r === P[0] && s.c === P[1]);
if (!pipeSrc) throw new Error('P 不在队列列表');
const param = sources.map(s => ({ id: s.id, count: s.count }));

// 改关
const next = JSON.parse(JSON.stringify(game));
next.spools[P[0]][P[1]] = { id: 0, type: DIR, param, count: 0 };
const blacks = sources.filter(s => !(s.r === P[0] && s.c === P[1]))
  .map(s => { next.spools[s.r][s.c] = { id: -1, type: 0, param: 0, count: 0 }; return s; });

// ---- 自检 ----
const errors = [];
const warnings = [];

// 1) 无空管道
let emptyPipes = 0, pipeCells = [];
for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
  const s = next.spools[r][c];
  const ts = Array.isArray(s.type) ? s.type : [s.type || 0];
  if (ts.some(x => x >= 11 && x <= 14)) {
    pipeCells.push([r, c]);
    if (!Array.isArray(s.param) || !s.param.length) emptyPipes++;
  }
}
if (emptyPipes) errors.push(`空管道 ${emptyPipes} 个`);

// 2) 无空格（黑块 id:-1 与管道不算空）
const empties = [];
for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
  const s = next.spools[r][c];
  const ts = Array.isArray(s && s.type) ? s.type : [(s && s.type) || 0];
  const isPipe = ts.some(x => x >= 11 && x <= 14);
  if (!s || (!isPipe && s.id !== -1 && !(s.id > 0))) empties.push(`(${r},${c})`);
}
if (empties.length) errors.push(`空格 ${empties.length}: ${empties.join(' ')}`);

// 3) 逐色容量守恒（含管道队列）
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

// 5) 逐格 diff：只允许 P + 黑块格变化
const diffCells = [];
for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
  if (JSON.stringify(game.spools[r][c]) !== JSON.stringify(next.spools[r][c])) diffCells.push([r, c]);
}
const expectDiff = new Set([[P[0], P[1]], ...blacks.map(s => [s.r, s.c])].map(([r, c]) => key(r, c)));
const extraDiff = diffCells.filter(([r, c]) => !expectDiff.has(key(r, c)));
if (extraDiff.length) errors.push(`意外改格: ${extraDiff.map(([r, c]) => key(r, c)).join(' ')}`);
if (diffCells.length !== expectDiff.size) errors.push(`diff 格数 ${diffCells.length} != 预期 ${expectDiff.size}`);

// 6) blocks/尺寸/其它顶层字段未变
for (const k of Object.keys(game)) {
  if (k === 'spools') continue;
  if (JSON.stringify(game[k]) !== JSON.stringify(next[k])) errors.push(`顶层字段 ${k} 被改`);
}

// 7) 队列总量 = 底座被搬格总量
const srcTotal = sources.reduce((a, s) => a + s.count, 0);
const qTotal = param.reduce((a, q) => a + q.count, 0);
if (srcTotal !== qTotal) errors.push(`队列总量 ${qTotal} != 被搬车总量 ${srcTotal}`);

const report = {
  pid: 53177,
  base: path.resolve(baseFile),
  out: path.resolve(outFile),
  pipe: { r: P[0], c: P[1], dir: DIR, exit: [P[0] + ({ 11: -1, 12: 0, 13: 1, 14: 0 }[DIR]), P[1] + ({ 11: 0, 12: 1, 13: 0, 14: -1 }[DIR])] },
  queueSources: sources,
  queueParam: param,
  queueCars: param.length,
  blacks: blacks.map(s => ({ r: s.r, c: s.c, was: `${s.id}:${s.count}` })),
  openingPickable: opening,
  pipeCells,
  emptyPipes,
  empties,
  conserved: badColors.length === 0,
  badColors,
  pxTotal, capTotal,
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
