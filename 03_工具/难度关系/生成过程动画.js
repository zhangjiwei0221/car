#!/usr/bin/env node
/**
 * 生成过程动画：把一关的"制作步骤"导成一个可播放的 HTML 动画。
 *
 *   node 03_工具/难度关系/生成过程动画.js <关卡json> [输出html]
 *
 * 步骤（可单步可自动播放）：
 *   ① 目标图（像素画逐块浮现）
 *   ② 分盒：每种颜色切成几辆车、每辆多大
 *   ③ 选盘：棋盘骨架出现
 *   ④ 摆障碍：墙/冰/链/管道
 *   ⑤ 放车：每格填上颜色与容量
 *   ⑥ 求解：压力曲线逐点绘制，峰窗/覆盖率长出来
 *   ⑦ 判定：门槛逐条亮灯，给结论
 */
'use strict';
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const BASE = path.join(__dirname, '..', '..', '02_工程', '完整主bin快照_20261012');
const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js', 'playersim.js', 'analysis.js', 'generator.js'];
const sandbox = { console: { log() {}, warn() {}, error() {} }, module: { exports: {} }, WeakMap, Map, Set, setTimeout, clearTimeout, Infinity, Math, JSON, Date };
vm.createContext(sandbox);
for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BASE, 'bin/js', f), 'utf8'), sandbox, { filename: f });
const A = sandbox.AntSolver;

const src = process.argv[2];
if (!src) { console.error('用法：node 生成过程动画.js <关卡json> [输出html]'); process.exit(1); }
const j = JSON.parse(fs.readFileSync(src, 'utf8'));
const out = process.argv[3] || path.join(path.dirname(src), '制作动画_' + path.basename(src, '.json') + '.html');

const parsed = A.parseLevel({ blocks: j.blocks, bufferLimit: j.bufferLimit, board: j.board });
const r = A.Solver.solve(parsed, { capturePreviewStats: true });
const ps = (r.pressureSamples || []).map(s => ({ d: s.done, b: s.buf }));
const totalBoxes = r.totalBoxes || parsed.totalBoxes || 0;

// 颜色统计 + 每色切出的车
const cnt = {}; let totPx = 0;
for (let rr = 0; rr < j.blocks.length; rr++) for (let cc = 0; cc < j.blocks[rr].length; cc++) {
  const v = j.blocks[rr][cc]; if (v > 0) { cnt[v] = (cnt[v] || 0) + 1; totPx++; }
}
const byColor = {}; let carTotal = 0;
j.board.cells.forEach(row => row.forEach(c => {
  if (!c) return;
  if (c.t === 'box') { (byColor[c.color] = byColor[c.color] || []).push(c.count); carTotal++; }
  else if (c.t === 'pipe') (c.queue || []).forEach(q => { (byColor[q.color] = byColor[q.color] || []).push(q.count); carTotal++; });
}));
const colors = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a]).map(id => ({
  id: +id, px: cnt[id], cars: (byColor[id] || []).slice().sort((x, y) => y - x)
}));

const data = {
  name: path.basename(src), rows: j.board.rows, cols: j.board.cols,
  cells: j.board.cells, blocks: j.blocks, bufferLimit: j.bufferLimit,
  ps, totalBoxes, colors, totPx, carTotal
};

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>制作动画 · ${data.name}</title>
<style>
:root{--accent:#c96a2b;--line:#d6d6d6}
*{box-sizing:border-box}
body{margin:0;padding:18px 22px 40px;font:14px/1.6 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#222;background:#fafafa}
h1{font-size:18px;margin:0 0 2px}.sub{color:#888;font-size:12.5px;margin-bottom:14px}
.stage{display:grid;grid-template-columns:300px 1fr 330px;gap:18px;align-items:start}
.card{background:#fff;border:1px solid var(--line);border-radius:10px;padding:12px}
.card h3{font-size:13px;margin:0 0 8px;color:#555;font-weight:600;letter-spacing:.4px}
#pix{display:grid;gap:0;image-rendering:pixelated}
#pix div{width:6px;height:6px}
#board{display:grid;gap:3px}
.cell{border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;
  min-height:40px;border:1px solid rgba(0,0,0,.08);transition:transform .18s ease, opacity .18s ease}
.cell.hidden{opacity:0;transform:scale(.6)}
.cell.black{background:#333}
.cell.pipe{background:#cfd8dc;color:#37474f;font-size:11px}
.cell.ice::after{content:"❄";position:absolute}
.badge{position:absolute;font-size:10px;margin-top:-26px;margin-left:22px;color:#0b5}
#steps{list-style:none;margin:0;padding:0}
#steps li{padding:6px 8px;border-radius:6px;color:#999;font-size:13px;margin-bottom:4px}
#steps li.on{background:#fdf3e3;color:#222;font-weight:700}
#steps li.done{color:#3c9a5f}
.ctrl{display:flex;gap:8px;margin:12px 0}
button{font:inherit;padding:6px 12px;border-radius:6px;border:1px solid var(--line);background:#fff;cursor:pointer}
button.primary{background:var(--accent);color:#fff;border-color:var(--accent)}
.kv{display:flex;justify-content:space-between;font-size:13px;padding:3px 0;border-bottom:1px dashed #eee}
.kv b{color:var(--accent)}
.bar{height:8px;background:#eee;border-radius:4px;overflow:hidden;margin-top:4px}
.bar i{display:block;height:100%;background:var(--accent);width:0;transition:width .4s}
</style></head><body>
<h1>关卡制作动画 · ${data.name}</h1>
<div class="sub">点「播放」自动走一遍；也可以单步。数据来自真实生成结果与求解器。</div>

<div class="ctrl">
  <button id="play" class="primary">▶ 播放</button>
  <button id="prev">◀ 上一步</button>
  <button id="next">下一步 ▶</button>
  <button id="reset">⟳ 重来</button>
  <span id="phase" style="margin-left:10px;color:#888;align-self:center"></span>
</div>

<div class="stage">
  <div class="card"><h3>目标图</h3><div id="pix"></div></div>
  <div class="card"><h3 id="boardTitle">棋盘</h3><div id="board"></div></div>
  <div class="card">
    <h3>步骤</h3>
    <ol id="steps">
      <li data-s="0">① 目标图：${data.totPx} 像素 / ${data.colors.length} 色</li>
      <li data-s="1">② 分盒：切成 ${data.carTotal} 辆车</li>
      <li data-s="2">③ 选盘：${data.rows} × ${data.cols}</li>
      <li data-s="3">④ 摆障碍：墙 / 冰 / 链 / 管道</li>
      <li data-s="4">⑤ 放车：每格填色与容量</li>
      <li data-s="5">⑥ 求解：压力曲线</li>
      <li data-s="6">⑦ 判定：门槛逐条</li>
    </ol>
    <div style="margin-top:12px" id="stats"></div>
  </div>
</div>

<script>
const D = ${JSON.stringify(data)};
const $ = s => document.querySelector(s);
const color = id => 'hsl(' + ((id * 47) % 360) + ',72%,72%)';
let phase = -1, timer = null;

// 目标图
(function(){
  const p = $('#pix'); p.style.gridTemplateColumns = 'repeat(' + D.blocks[0].length + ',6px)';
  D.blocks.forEach(row => row.forEach(v => {
    const d = document.createElement('div');
    d.style.background = v > 0 ? color(v) : '#f4f4f4';
    d.style.opacity = 0; d.style.transition = 'opacity .25s';
    p.appendChild(d);
  }));
})();

const boxCells = [], obsCells = [];
D.cells.forEach((row, r) => row.forEach((c, cIdx) => {
  if (!c) return;
  if (c.t === 'box') boxCells.push([r, cIdx, c]);
  else obsCells.push([r, cIdx, c]);
}));

function buildBoard(){
  const b = $('#board');
  b.style.gridTemplateColumns = 'repeat(' + D.cols + ',1fr)';
  b.innerHTML = '';
  D.cells.forEach((row, r) => row.forEach((c, ci) => {
    const el = document.createElement('div');
    el.className = 'cell hidden';
    el.dataset.r = r; el.dataset.c = ci;
    el.style.background = '#f2f2f2';
    b.appendChild(el);
  }));
}
function cellEl(r, c){ return $('#board').children[r * D.cols + c]; }

const STEPS = [
  { t: '目标图', f: () => {
      $('#pix').childNodes.forEach((d, i) => setTimeout(() => d.style.opacity = 1, (i % 400) * 2));
      $('#boardTitle').textContent = '棋盘（还没造）';
      setStats([['像素', D.totPx], ['颜色', D.colors.length]]);
  }},
  { t: '分盒', f: () => {
      let html = '';
      D.colors.slice(0, 10).forEach(c => {
        const cars = c.cars.length ? c.cars.join(', ') : '—';
        html += '<div class="kv"><span>色 ' + c.id + ' · ' + c.px + 'px</span><b>' + c.cars.length + ' 辆</b></div>' +
                '<div style="font-size:11.5px;color:#777;margin:-2px 0 6px">' + cars + '</div>';
      });
      setStats(html, true);
  }},
  { t: '选盘', f: () => {
      buildBoard();
      $('#boardTitle').textContent = '棋盘 ' + D.rows + ' × ' + D.cols;
      const all = $('#board').children;
      for (let i = 0; i < all.length; i++) setTimeout(() => all[i].classList.remove('hidden'), i * 12);
      setStats([['棋盘', D.rows + '×' + D.cols], ['格数', all.length]]);
  }},
  { t: '摆障碍', f: () => {
      let nb = 0, ni = 0, nc = 0, np = 0;
      obsCells.forEach(([r, c, cell], i) => setTimeout(() => {
        const el = cellEl(r, c); el.classList.remove('hidden');
        if (cell.t === 'black') { el.classList.add('black'); nb++; }
        else { el.classList.add('pipe'); el.textContent = '管' + (cell.queue || []).length; np++; }
      }, i * 25));
      boxCells.forEach(([r, c, cell], i) => {
        if (cell.numice > 0) ni++; if (cell.chain > 0) nc++;
      });
      setStats([['墙', nb || countObs('black')], ['管道', countObs('pipe')], ['冰', ni], ['锁链格', nc]]);
  }},
  { t: '放车', f: () => {
      boxCells.forEach(([r, c, cell], i) => setTimeout(() => {
        const el = cellEl(r, c);
        el.classList.remove('hidden');
        el.style.background = color(cell.color);
        el.textContent = cell.count;
        if (cell.numice > 0) el.textContent += ' ❄' + cell.numice;
        if (cell.chain > 0) el.textContent += ' ⛓';
      }, i * 18));
      setStats([['盘上车', boxCells.length], ['总车数', D.carTotal]]);
  }},
  { t: '求解', f: () => {
      drawCurve();
  }},
  { t: '判定', f: () => {
      setStats([['暂存峰值', maxBuf()], ['步数', D.ps.length], ['总盒数', D.totalBoxes]]);
  }}
];

function countObs(t){ return D.cells.flat().filter(c => c && c.t === t).length; }
function maxBuf(){ return D.ps.reduce((m, s) => Math.max(m, s.b), 0); }
function setStats(rows, raw){
  if (raw) { $('#stats').innerHTML = rows; return; }
  $('#stats').innerHTML = rows.map(([k, v]) => '<div class="kv"><span>' + k + '</span><b>' + v + '</b></div>').join('');
}

// 压力曲线
let curveSvg = null;
function drawCurve(){
  const W = 300, H = 120, pad = 6, maxB = Math.max(5, maxBuf());
  let svg = '<svg width="' + W + '" height="' + H + '" style="background:#fff;border:1px solid #eee">';
  svg += '<line x1="0" y1="' + (H - pad - (3 / maxB) * (H - pad * 2)) + '" x2="' + W + '" y2="' + (H - pad - (3 / maxB) * (H - pad * 2)) + '" stroke="#e8c9a8" stroke-dasharray="4 3"/>';
  svg += '<polyline id="curveLine" fill="none" stroke="#e08a2b" stroke-width="2" points=""/></svg>';
  $('#stats').innerHTML = svg + '<div class="kv"><span>虚线 = 暂存 3</span><b id="liveB">0</b></div>';
  const line = document.querySelector('#curveLine');
  let i = 0;
  const pts = [];
  const tick = () => {
    if (i >= D.ps.length) { 
      const band = D.ps.filter(s => s.d / D.totalBoxes >= 0.3 && s.d / D.totalBoxes <= 0.8);
      const ge3 = band.filter(s => s.b >= 3).length;
      document.querySelector('#stats').insertAdjacentHTML('beforeend',
        '<div class="kv"><span>30~80% 覆盖率</span><b>' + (band.length ? Math.round(ge3 / band.length * 100) : 0) + '%</b></div>' +
        '<div class="kv"><span>峰值</span><b>' + maxBuf() + '</b></div>');
      return; }
    const s = D.ps[i];
    const x = pad + (s.d / D.totalBoxes) * (W - pad * 2);
    const y = H - pad - (s.b / maxB) * (H - pad * 2);
    pts.push(x.toFixed(1) + ',' + y.toFixed(1));
    line.setAttribute('points', pts.join(' '));
    document.querySelector('#liveB').textContent = s.b;
    i++;
    setTimeout(tick, 55);
  };
  tick();
}

function apply(n){
  phase = n;
  document.querySelectorAll('#steps li').forEach(li => {
    const s = +li.dataset.s;
    li.classList.toggle('on', s === n);
    li.classList.toggle('done', s < n);
  });
  $('#phase').textContent = n >= 0 ? ('第 ' + (n + 1) + ' / ' + STEPS.length + ' 步：' + STEPS[n].t) : '';
  if (n >= 0) STEPS[n].f();
}
function play(){
  clearInterval(timer);
  let n = 0; apply(0);
  timer = setInterval(() => {
    n++;
    if (n >= STEPS.length) { clearInterval(timer); return; }
    apply(n);
  }, 1800);
}
$('#play').onclick = play;
$('#next').onclick = () => { clearInterval(timer); apply(Math.min(STEPS.length - 1, phase + 1)); };
$('#prev').onclick = () => { clearInterval(timer); apply(Math.max(0, phase - 1)); };
$('#reset').onclick = () => { location.reload(); };
apply(0);
<\/script>
</body></html>`;

fs.writeFileSync(out, html, 'utf8');
console.log('已生成：' + out);
