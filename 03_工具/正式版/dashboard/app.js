'use strict';
const $ = s => document.querySelector(s);
const state = { levels: [], current: null, route: 'freefirst', overlaySolver: true, step: 1, series: { buffer: true, M: true, C: true, F: true, D: true } };
const C = { f: '#3fb950', d: '#f85149', c0: '#8b949e', buf: '#a371f7', M: '#58a6ff', C: '#39c5cf', F: '#3fb950', D: '#f85149', solver: '#f0883e' };
const NS = 'http://www.w3.org/2000/svg';

function status(s, bad) { const el = $('#status'); el.textContent = s || ''; el.style.color = bad ? '#f85149' : ''; }
function colorHex(id) { const p = state.current && state.current.palette; return (p && p[id] && p[id].hex) || '#6e7681'; }
function colorName(id) { const p = state.current && state.current.palette; return (p && p[id] && p[id].name) || ('色' + id); }
function fmt(x, d) { return x == null || Number.isNaN(x) ? '–' : (d != null ? Number(x).toFixed(d) : String(x)); }
function svgEl(tag, attrs) { const e = document.createElementNS(NS, tag); for (const k in attrs || {}) e.setAttribute(k, attrs[k]); return e; }
function badge(band) { return `<span class="badge ${band || ''}">${band || ''}</span>`; }

async function analyzeFile(file) {
  const name = file.webkitRelativePath || file.name;
  status('分析 ' + name + ' …');
  const res = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, content: await file.text() }) });
  const j = await res.json();
  if (!j.ok) throw new Error(j.error || '分析失败');
  const i = state.levels.findIndex(x => x.id === j.id);
  if (i >= 0) state.levels[i] = j; else state.levels.push(j);
  if (!state.current || state.levels.length === 1) select(j.id);
  renderList();
  status('完成 ' + name);
  return j;
}
$('#fileSingle').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try { await analyzeFile(f); } catch (err) { status('失败：' + err.message, true); }
});
$('#fileDir').addEventListener('change', async e => {
  const files = [...e.target.files].filter(f => f.name.toLowerCase().endsWith('.json')).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  e.target.value = '';
  if (!files.length) { status('目录里没有 .json', true); return; }
  for (let i = 0; i < files.length; i++) {
    status(`分析中 ${i + 1}/${files.length}：${files[i].name}`);
    try { await analyzeFile(files[i]); } catch (err) { status(`失败 ${files[i].name}：${err.message}`, true); }
  }
  status(`目录完成：${files.length} 个`);
});

function select(id) {
  state.current = state.levels.find(x => x.id === id) || null;
  state.step = 1;
  renderAll();
}
function renderList() {
  const ul = $('#levelList'); ul.innerHTML = '';
  if (!state.levels.length) { ul.innerHTML = '<div class="empty">还没有关卡。导入单关 JSON 或目录。</div>'; return; }
  for (const l of state.levels) {
    const li = document.createElement('li');
    if (state.current && state.current.id === l.id) li.className = 'active';
    const n = document.createElement('span'); n.className = 'level-name'; n.textContent = l.name;
    const meta = document.createElement('div'); meta.className = 'level-meta';
    const d = l.metrics && l.metrics.difficulty;
    meta.innerHTML = `<span>${d ? 'D ' + d.D : ''}</span>${d ? badge(d.band) : ''}`;
    li.appendChild(n); li.appendChild(meta);
    li.onclick = () => select(l.id);
    ul.appendChild(li);
  }
}
function renderMetrics() {
  const el = $('#metrics'); el.innerHTML = '';
  if (!state.current) return;
  const m = state.current.metrics, a = m.arl || {}, p = m.policy || {}, ch = m.choice || {}, d = m.difficulty || {};
  const ff = state.current.routes.freefirst && state.current.routes.freefirst.summary || {};
  const cards = [
    ['难度分', fmt(d.D, 1), d.band || ''],
    ['峰值', fmt(a.peak), '目标 4'],
    ['中段', a.mid >= 0 ? a.mid + '%' : '–', '45–80'],
    ['tol', a.tol >= 0 ? a.tol + '/20' : '–', '8–18'],
    ['开局', fmt(a.open), '≥5'],
    ['C0<5', fmt(ff.c0AtBufLt5), '硬门 0'],
    ['F0≥3', fmt(ff.f0AtBuf3), '硬门 <3'],
    ['policy0/2', (p.policy0 ? 'Y' : 'N') + '/' + (p.policy2 ? 'Y' : 'N'), '策略族'],
    ['可通关', a.canPass || '–', '最小路线'],
    ['entropy', ch.H != null ? ch.H.toFixed(2) : '–', '越高越好']
  ];
  for (const [k, v, s] of cards) {
    const c = document.createElement('div'); c.className = 'card';
    c.innerHTML = `<div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div>`;
    el.appendChild(c);
  }
}
function renderRouteSummary() {
  const el = $('#routeSummary'); el.innerHTML = '';
  if (!state.current) return;
  for (const key of ['freefirst', 'solver']) {
    const r = state.current.routes[key]; if (!r) continue;
    const s = r.summary || {};
    const rows = [
      ['路线', key === 'freefirst' ? 'free-first' : 'solver-min'],
      ['步数', s.steps], ['通关', s.won ? 'Y' : 'N'], ['峰值', s.bufferPeak],
      ['F0@≥3', s.f0AtBuf3], ['C0<5', s.c0AtBufLt5]
    ];
    const div = document.createElement('div');
    for (const [k, v] of rows) {
      const row = document.createElement('div'); row.className = 'row';
      row.innerHTML = `<span>${k}</span><span class="k">${v == null ? '–' : v}</span>`;
      div.appendChild(row);
    }
    el.appendChild(div);
  }
}
function chartGeom(svg, maxY, maxStep) {
  const W = 1000, H = svg.viewBox.baseVal.height || 220, l = 44, r = 18, t = 14, b = 26;
  const x = step => l + (step - 1) / Math.max(1, maxStep - 1) * (W - l - r);
  const y = v => H - b - (Math.max(0, v) / Math.max(1, maxY)) * (H - t - b);
  return { W, H, l, r, t, b, x, y, maxY, maxStep };
}
function drawAxes(svg, g, geom, yTicks) {
  for (let i = 0; i <= yTicks; i++) {
    const v = geom.maxY * i / yTicks, yy = geom.y(v);
    g.appendChild(svgEl('line', { x1: geom.l, y1: yy, x2: geom.W - geom.r, y2: yy, stroke: '#252a34', 'stroke-width': 1 }));
    const tx = svgEl('text', { x: geom.l - 8, y: yy + 4, 'text-anchor': 'end', fill: '#9aa4b2', 'font-size': 11 });
    tx.textContent = String(Math.round(v)); g.appendChild(tx);
  }
  const stepCount = geom.maxStep, every = Math.max(1, Math.ceil(stepCount / 12));
  for (let s = 1; s <= stepCount; s += every) {
    const tx = svgEl('text', { x: geom.x(s), y: geom.H - 8, 'text-anchor': 'middle', fill: '#9aa4b2', 'font-size': 10 });
    tx.textContent = String(s); g.appendChild(tx);
  }
}
function routeList() {
  const rs = [];
  if (!state.current) return rs;
  const want = state.route;
  if (want === 'freefirst' && state.current.routes.freefirst) rs.push({ key: 'freefirst', label: 'free-first', data: state.current.routes.freefirst, dash: false });
  if (want === 'solver' && state.current.routes.solver) rs.push({ key: 'solver', label: 'solver-min', data: state.current.routes.solver, dash: false });
  if (state.overlaySolver && want === 'freefirst' && state.current.routes.solver) rs.push({ key: 'solver', label: 'solver-min', data: state.current.routes.solver, dash: true });
  return rs;
}
function drawChart(which) {
  const svg = which === 'buffer' ? $('#chartBuffer') : $('#chartChoice');
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  const rs = routeList();
  if (!rs.length) {
    const t = svgEl('text', { x: 20, y: 40, fill: '#9aa4b2', 'font-size': 14 }); t.textContent = '导入关卡后显示';
    svg.appendChild(t); return;
  }
  const maxStep = Math.max(...rs.map(r => (r.data.timeline || []).length), 1);
  let maxY = 1;
  if (which === 'buffer') maxY = Math.max(5, ...rs.flatMap(r => (r.data.timeline || []).map(t => t.buf)));
  else maxY = Math.max(6, ...rs.flatMap(r => (r.data.timeline || []).flatMap(t => [t.M, t.C, t.F, t.D])));
  const geom = chartGeom(svg, maxY, maxStep);
  const g = svgEl('g'); svg.appendChild(g);
  drawAxes(svg, g, geom, which === 'buffer' ? Math.min(5, maxY) : Math.min(8, maxY));
  const series = which === 'buffer' ? [{ key: 'buf', color: C.buf }] : [
    { key: 'M', color: C.M }, { key: 'C', color: C.C }, { key: 'F', color: C.F }, { key: 'D', color: C.D }
  ].filter(s => state.series[s.key]);
  for (const r of rs) {
    const tl = r.data.timeline || [];
    for (const s of series) {
      const pts = tl.map((t, i) => [geom.x(i + 1), geom.y(t[s.key])]);
      if (!pts.length) continue;
      const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
      g.appendChild(svgEl('path', { d, fill: 'none', stroke: r.key === 'solver' ? C.solver : s.color, 'stroke-width': 2, 'stroke-dasharray': r.dash ? '6 4' : 'none', opacity: r.dash ? 0.75 : 1, 'vector-effect': 'non-scaling-stroke' }));
      for (let i = 0; i < pts.length; i++) {
        const c = svgEl('circle', { cx: pts[i][0], cy: pts[i][1], r: 2.5, fill: r.key === 'solver' ? C.solver : s.color, opacity: 0.85, 'data-step': i + 1, class: 'point' });
        c.appendChild(svgEl('title')).textContent = `${r.label} · 第${i + 1}步 · ${s.key}=${tl[i][s.key]}`;
        g.appendChild(c);
      }
    }
    // markers
    if (which === 'buffer') {
      tl.forEach((t, i) => {
        const x = geom.x(i + 1), y = geom.y(t.buf);
        if (t.buf >= 3 && t.F === 0) {
          const p = svgEl('path', { d: `M${x} ${y - 7} L${x - 5} ${y + 2} L${x + 5} ${y + 2} Z`, class: 'marker-f0', 'data-step': i + 1 });
          p.appendChild(svgEl('title')).textContent = `第${i + 1}步：buffer≥3 且 F=0（没有不加债选项）`;
          g.appendChild(p);
        }
        if (t.buf < 5 && t.C === 0) {
          const c = svgEl('circle', { cx: x, cy: y, r: 4, class: 'marker-c0', 'data-step': i + 1 });
          c.appendChild(svgEl('title')).textContent = `第${i + 1}步：buffer<5 且 C=0（所有候选都 0 消除）`;
          g.appendChild(c);
        }
      });
    }
  }
  // selected step line
  if (state.step <= maxStep) {
    const x = geom.x(state.step);
    g.appendChild(svgEl('line', { x1: x, y1: geom.t, x2: x, y2: geom.H - geom.b, stroke: '#e6e8ee', 'stroke-width': 1, 'stroke-dasharray': '3 4', opacity: 0.7 }));
  }
  // legend
  const lg = svgEl('g');
  let lx = geom.l + 4;
  for (const s of series) { const l = svgEl('text', { x: lx, y: 12, fill: s.color, 'font-size': 11 }); l.textContent = '— ' + s.key; lg.appendChild(l); lx += 52; }
  if (rs.some(r => r.key === 'solver')) { const l = svgEl('text', { x: lx, y: 12, fill: C.solver, 'font-size': 11 }); l.textContent = '--- solver'; lg.appendChild(l); }
  svg.appendChild(lg);
  // events
  svg.onclick = e => {
    const t = e.target; const step = t && t.getAttribute && t.getAttribute('data-step');
    if (step) selectStep(+step);
    else if (e.clientX) {
      const rect = svg.getBoundingClientRect(); const xx = (e.clientX - rect.left) / rect.width * 1000;
      const s = Math.round(1 + (xx - geom.l) / Math.max(1, geom.W - geom.l - geom.r) * (maxStep - 1));
      if (s >= 1 && s <= maxStep) selectStep(s);
    }
  };
  svg.onmousemove = e => {
    const rect = svg.getBoundingClientRect(); const xx = (e.clientX - rect.left) / rect.width * 1000;
    const s = Math.round(1 + (xx - geom.l) / Math.max(1, geom.W - geom.l - geom.r) * (maxStep - 1));
    if (s < 1 || s > maxStep) { hideTip(); return; }
    const lines = [`第 ${s} 步`];
    for (const r of rs) { const t = (r.data.timeline || [])[s - 1]; if (t) lines.push(`${r.label}: buf ${t.buf} · M${t.M} C${t.C} F${t.F} D${t.D}`); }
    showTip(e, lines.join('\n'));
  };
  svg.onmouseleave = hideTip;
}
function showTip(e, text) { const t = $('#tooltip'); t.textContent = text; t.style.display = 'block'; t.style.left = Math.min(window.innerWidth - 260, e.clientX + 14) + 'px'; t.style.top = Math.min(window.innerHeight - 100, e.clientY + 14) + 'px'; }
function hideTip() { $('#tooltip').style.display = 'none'; }
function selectStep(s) { state.step = s; renderCharts(); renderStep(); }

function drawTarget() {
  const cv = $('#targetCanvas'); const ctx = cv.getContext('2d');
  const b = state.current && state.current.level.blocks; if (!b) { ctx.clearRect(0, 0, 320, 320); return; }
  const H = b.length, W = b[0].length, sx = cv.width / W, sy = cv.height / H;
  ctx.clearRect(0, 0, cv.width, cv.height);
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const v = b[r][c]; ctx.fillStyle = v > 0 ? colorHex(v) : '#000';
    ctx.fillRect(c * sx, r * sy, Math.ceil(sx), Math.ceil(sy));
  }
}
function iconOf(cell) {
  if (!cell) return '';
  const t = cell.type;
  if (Array.isArray(t) && t.includes(6)) return '?';
  if (t === 6) return '?';
  if (t === 7) return '❄';
  if (t === 5) return '🔗';
  if (typeof t === 'number' && t >= 11 && t <= 14) return '▤';
  return '';
}
function renderStep() {
  const r = state.current && (state.route === 'solver' ? state.current.routes.solver : state.current.routes.freefirst);
  if (!r || !r.timeline || !r.timeline.length) { $('#stepMeta').textContent = '没有路线数据'; return; }
  const tl = r.timeline; state.step = Math.max(1, Math.min(state.step, tl.length));
  const t = tl[state.step - 1];
  $('#stepNo').textContent = state.step;
  $('#stepMeta').textContent = `${r.route} · buf ${t.buf} · M${t.M} C${t.C} F${t.F} D${t.D}${t.dead ? ' · 选项会死' : ''}`;
  drawTarget();
  const grid = $('#carGrid'); grid.innerHTML = '';
  const cells = t.cells || [];
  const rows = cells.length, cols = rows ? cells[0].length : 0;
  grid.style.gridTemplateColumns = `repeat(${cols || 7},1fr)`;
  for (let rr = 0; rr < rows; rr++) for (let cc = 0; cc < cols; cc++) {
    const cell = cells[rr][cc];
    const d = document.createElement('div'); d.className = 'car-cell';
    if (!cell || !(cell.color > 0)) d.classList.add('black');
    else d.style.background = colorHex(cell.color);
    if (cell && typeof cell.type === 'number' && cell.type >= 11 && cell.type <= 14) d.classList.add('pipe');
    const ic = iconOf(cell); if (ic) { const i = document.createElement('span'); i.className = 'icon'; i.textContent = ic; d.appendChild(i); }
    if (cell && cell.count > 0) { const n = document.createElement('span'); n.className = 'cnt'; n.textContent = cell.count; d.appendChild(n); }
    d.title = `${rr},${cc} · ${cell && cell.color > 0 ? colorName(cell.color) + ':' + cell.count : '黑格/空'}`;
    grid.appendChild(d);
  }
  const buf = t.buffer || [];
  $('#bufCount').textContent = buf.length;
  const bl = $('#bufferList'); bl.innerHTML = '';
  if (!buf.length) bl.innerHTML = '<span class="empty">暂存为空</span>';
  for (const b of buf) {
    const d = document.createElement('div'); d.className = 'buf-card';
    d.innerHTML = `<span class="swatch" style="background:${colorHex(b.color)}"></span><span>${colorName(b.color)}</span><span>${b.progress}/${b.need}</span><span style="color:#9aa4b2">余${b.remaining}</span>`;
    bl.appendChild(d);
  }
  const opts = t.options || [];
  $('#optionCount').textContent = opts.length;
  const tb = $('#optionTable').querySelector('tbody'); tb.innerHTML = '';
  for (const o of opts) {
    const tr = document.createElement('tr');
    const chosen = t.pick && o.r === t.pick.r && o.c === t.pick.c;
    const rowKind = o.addsDebt ? 'D' : (o.gain === 0 ? 'C0' : 'F');
    tr.className = rowKind + (chosen ? ' chosen' : '');
    const kindText = o.kind + (o.addsDebt && o.kind === 'C0' ? '+D' : '');
    const cells = [o.r + ',' + o.c, `<span class="swatch" style="display:inline-block;background:${colorHex(o.color)}"></span> ${colorName(o.color)}`, o.count, o.gain, o.bufferAfter, o.debtPx, kindText, o.nextM, o.dead ? '是' : ''];
    cells.forEach((v, i) => { const td = document.createElement('td'); if (i === 6) td.className = 'kind'; if (i === 8 && o.dead) td.className = 'dead'; td.innerHTML = v; tr.appendChild(td); });
    tb.appendChild(tr);
  }
}
function renderCharts() { drawChart('buffer'); drawChart('choice'); }
function renderAll() { renderMetrics(); renderRouteSummary(); renderCharts(); renderStep(); renderList(); }

document.querySelectorAll('.route-tabs button').forEach(b => b.onclick = () => {
  state.route = b.dataset.route;
  document.querySelectorAll('.route-tabs button').forEach(x => x.classList.toggle('active', x === b));
  renderAll();
});
$('#overlaySolver').addEventListener('change', e => { state.overlaySolver = e.target.checked; renderCharts(); });
document.querySelectorAll('[data-series]').forEach(cb => cb.addEventListener('change', e => { state.series[e.target.dataset.series] = e.target.checked; renderCharts(); }));
$('#prevStep').onclick = () => { state.step = Math.max(1, state.step - 1); renderCharts(); renderStep(); };
$('#nextStep').onclick = () => { const r = state.current && (state.route === 'solver' ? state.current.routes.solver : state.current.routes.freefirst); const n = r && r.timeline ? r.timeline.length : 1; state.step = Math.min(n, state.step + 1); renderCharts(); renderStep(); };

renderList();

async function loadExamples() {
  try {
    const list = await fetch('/api/examples').then(r => r.json());
    const box = $('#examples'); box.innerHTML = '';
    for (const ex of list) {
      const b = document.createElement('button'); b.className = 'btn'; b.textContent = ex.name;
      b.onclick = () => analyzeExample(ex); box.appendChild(b);
    }
  } catch (e) { }
}
async function analyzeExample(ex) {
  status('分析示例 ' + ex.name + ' …');
  try {
    const j = await fetch('/api/analyze-path?path=' + encodeURIComponent(ex.path)).then(r => r.json());
    if (!j.ok) throw new Error(j.error || '分析失败');
    const i = state.levels.findIndex(x => x.id === j.id);
    if (i >= 0) state.levels[i] = j; else state.levels.push(j);
    select(j.id);
    renderList(); status('完成 ' + ex.name);
  } catch (e) { status('失败：' + e.message, true); }
}
loadExamples();
