// 合球动画：把色块按「色 × 层」拼成车（对比“按色总量混装”）
const fs = require('fs'), path = require('path');
const TXT = process.argv[2] || '/Users/red/Downloads/蚂蚁图库/拼接图/拼接图图库/40x40拼接图纸_016.txt';
const OUT = process.argv[3] || path.join(__dirname, '..', '..', '01_交接文档', '合球动画.html');
const BMN = 24, BMX = 36;

const blocks = fs.readFileSync(TXT, 'utf8').split(/\r?\n/).map(l => l.trim())
  .filter(l => l && /^[\d\s,]+$/.test(l)).map(l => l.split(/[\s,]+/).filter(Boolean).map(Number))
  .filter(row => row.length && row.every(v => !isNaN(v)));
const R = blocks.length, C = blocks[0].length;

// 色块 + 层 + 同色距离
const comp = blocks.map(row => row.map(() => -1));
const comps = [];
for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
  if (blocks[r][c] <= 0 || comp[r][c] >= 0) continue;
  const color = blocks[r][c], id = comps.length, st = [[r, c]], pixels = [];
  comp[r][c] = id;
  while (st.length) { const [cr, cc] = st.pop(); pixels.push([cr, cc]);
    for (const [nr, nc] of [[cr-1,cc],[cr+1,cc],[cr,cc-1],[cr,cc+1]]) {
      if (nr<0||nr>=R||nc<0||nc>=C) continue;
      if (comp[nr][nc] >= 0 || blocks[nr][nc] !== color) continue;
      comp[nr][nc] = id; st.push([nr, nc]);
    } }
  comps.push({ id, color, px: pixels.length, pixels, layer: -1, mind: 99 });
}
// 层（按色块剥）
const adj = comps.map(() => new Set());
for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
  const a = comp[r][c]; if (a < 0) continue;
  for (const [dr, dc] of [[1,0],[0,1]]) { const nr=r+dr,nc=c+dc; if(nr>=R||nc>=C) continue;
    const b = comp[nr][nc]; if (b < 0 || b === a) continue; adj[a].add(b); adj[b].add(a); }
}
const q = [];
comps.forEach((cp, i) => { if (cp.pixels.some(([r,c])=>r===0||r===R-1||c===0||c===C-1)) { cp.layer=0; q.push(i); } });
let hd = 0; while (hd < q.length) { const i=q[hd++]; for (const j of adj[i]) if (comps[j].layer < 0) { comps[j].layer = comps[i].layer+1; q.push(j); } }
// 同色距离（每块内的最小距离）
for (const cp of comps) {
  for (const [r,c] of cp.pixels) {
    let edge = false;
    for (const [nr,nc] of [[r-1,c],[r+1,c],[r,c-1],[r,c+1]]) { if(nr<0||nr>=R||nc<0||nc>=C){edge=true;break;} if(blocks[nr][nc]!==cp.color){edge=true;break;} }
    if (edge) cp.mind = 0;
  }
  if (cp.mind !== 0) cp.mind = 9;
}

// —— 合球 A：按「色 × 层」累加 ——
function mergeLayerAware() {
  const byColor = {};
  comps.forEach(cp => (byColor[cp.color] = byColor[cp.color] || []).push(cp));
  const cars = [];
  for (const color of Object.keys(byColor).map(Number).sort((a,b)=>a-b)) {
    const list = byColor[color].slice().sort((a,b)=> a.layer-b.layer || a.mind-b.mind || b.px-a.px || a.id-b.id);
    let cur = null;
    const flush = () => { if (cur && cur.comps.length) { cars.push(cur); cur = null; } };
    for (const cp of list) {
      if (!cur) cur = { color, cap: 0, comps: [], effLayer: -1, role: '壳' };
      if (cur.cap + cp.px > BMX && cur.cap >= BMN) flush();
      if (!cur) cur = { color, cap: 0, comps: [], effLayer: -1, role: '壳' };
      cur.cap += cp.px; cur.comps.push(cp.id); cur.effLayer = Math.max(cur.effLayer, cp.layer);
    }
    flush();
  }
  cars.forEach(c => {
    const layers = c.comps.map(id => comps[id].layer);
    c.effLayer = Math.max(...layers);
    c.role = c.effLayer <= 1 ? '浅层车' : (c.effLayer >= 3 ? '深层车' : '中层车');
  });
  // 【与引擎一致】先按「有效层升序 → 颜色」排；再把队首改成 2 浅 + 2 深（环上配额 C）
  cars.sort((a, b) => a.effLayer - b.effLayer || a.color - b.color);
  const sh = [], dp = [], rest = [];
  for (const c of cars) {
    if (c.role === '浅层车' && sh.length < 2) sh.push(c);
    else if (c.role === '深层车' && dp.length < 2) dp.push(c);
    else rest.push(c);
  }
  const head = [];
  for (let i = 0; i < Math.max(sh.length, dp.length); i++) {
    if (i < sh.length) head.push(sh[i]);
    if (i < dp.length) head.push(dp[i]);
  }
  return head.concat(rest);
}
// —— 合球 B：现在的做法（按色总量，不分层）——
function mergeByColor() {
  const byColor = {};
  comps.forEach(cp => (byColor[cp.color] = byColor[cp.color] || []).push(cp));
  const cars = [];
  for (const color of Object.keys(byColor).map(Number).sort((a,b)=>a-b)) {
    const list = byColor[color].slice().sort((a,b)=> a.id-b.id);
    let cur = { color, cap: 0, comps: [], effLayer: -1, role: '混装' };
    for (const cp of list) {
      if (cur.cap + cp.px > BMX && cur.cap >= BMN) { cars.push(cur); cur = { color, cap: 0, comps: [], effLayer: -1, role: '混装' }; }
      cur.cap += cp.px; cur.comps.push(cp.id); cur.effLayer = Math.max(cur.effLayer, cp.layer);
    }
    if (cur.comps.length) cars.push(cur);
  }
  return cars;
}
const carsA = mergeLayerAware(), carsB = mergeByColor();
const data = { rows:R, cols:C, blocks, comp, comps: comps.map(c=>({color:c.color,layer:c.layer,px:c.px,pixels:c.pixels})), carsA, carsB };

const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>合球动画</title>
<style>
 body{margin:0;background:#0f1420;color:#e6ebf5;font:14px/1.7 -apple-system,"PingFang SC",sans-serif}
 .wrap{max-width:1120px;margin:0 auto;padding:20px}
 h1{font-size:20px;margin:0 0 4px}
 .sub{color:#8b97ab;font-size:13px;margin-bottom:12px}
 .bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
 button{background:#1e2a3d;color:#dbe6f7;border:1px solid #33445f;border-radius:8px;padding:6px 12px;cursor:pointer}
 button:hover{background:#26364e} label{color:#9fb0c8;font-size:13px}
 .stage{display:flex;gap:18px;align-items:flex-start;flex-wrap:wrap}
 canvas{background:#151b28;border-radius:10px;border:1px solid #263248;display:block}
 .panel{flex:1;min-width:380px}
 .card{background:#18202e;border:1px solid #2a3850;border-radius:12px;padding:14px;margin-top:10px}
 .card .idx{color:#8b97ab;font-size:12px}
 .row{display:flex;align-items:center;gap:10px;margin:6px 0;flex-wrap:wrap}
 .chip{width:24px;height:24px;border-radius:6px;flex:none}
 .num{font-size:24px;font-weight:700}
 .tag{font-size:12px;padding:2px 10px;border-radius:999px}
 .r0{background:#1d3b2a;color:#5ad18a}.r1{background:#3b341d;color:#e0b64a}.r2{background:#3b1d28;color:#f07a9a}
 .pieces{color:#c7d3e6;font-size:12.5px;margin-top:4px}
 .pieces .p{display:inline-block;background:#222c3d;border-radius:6px;padding:1px 7px;margin:3px 4px 0 0}
 .stat{color:#8b97ab;font-size:12.5px;margin:8px 0 2px}
 .hint{color:#6f7d93;font-size:12px;margin-top:10px;line-height:1.7}
</style></head><body><div class="wrap">
<h1>合球 · 每辆车多大</h1>
<div class="sub">下面每根柱子 = 一辆车，高度 = 它的容量（px）。绿=浅层(供给) 黄=中层 红=深层(债)。点柱子看细节。</div>

<div class="bar">
  <button id="prev">◀ 上一辆</button>
  <button id="play">▶ 播放</button>
  <button id="next">下一辆 ▶</button>
  <label>速度 <input id="speed" type="range" min="1" max="10" value="4"></label>
  <label>对照：<select id="mode">
    <option value="A">按层拼（设计）</option>
    <option value="B">按总量混装（现生产）</option>
  </select></label>
</div>

<div class="panel">
  <canvas id="chart"></canvas>
  <div class="stat" id="stat"></div>
</div>

<div class="stage">
  <div><canvas id="cv"></canvas></div>
  <div class="panel" style="min-width:300px">
    <div class="card" id="big"></div>
    <div class="hint">
      白框 = 这一辆车用到的像素。有效层 = 车里最深那块的层号：≤1 浅层（一出现就吃满）、2 中层、≥3 深层（要等剥开，是债）。
    </div>
  </div>
</div>
</div>
<script>
const D = ${JSON.stringify(data)};
const hue=id=>(id*137.508)%360, colOf=(id,a)=>'hsla('+hue(id)+',65%,55%,'+(a==null?1:a)+')';
const roleColor={浅层车:'#5ad18a',中层车:'#e0b64a',深层车:'#f07a9a'};
let mode='A', cars=D.carsA, idx=0, timer=null, used=new Set();

const cv=document.getElementById('cv'), ctx=cv.getContext('2d'), CELL=12;
cv.width=D.cols*CELL; cv.height=D.rows*CELL;

// 容量柱状图
const chart=document.getElementById('chart'), cctx=chart.getContext('2d');
const PAD=34, BW=10, GAP=3, CH=170;
function drawChart(){
  chart.width=Math.max(560, cars.length*(BW+GAP)+PAD+20); chart.height=CH+40;
  cctx.clearRect(0,0,chart.width,chart.height);
  const maxCap=Math.max(...cars.map(c=>c.cap), 1);
  cctx.strokeStyle='#2a3850'; cctx.lineWidth=1;
  cctx.beginPath(); cctx.moveTo(PAD,10); cctx.lineTo(PAD,CH); cctx.lineTo(chart.width-10,CH); cctx.stroke();
  cctx.fillStyle='#6f7d93'; cctx.font='11px sans-serif';
  cctx.fillText(maxCap+'px', 4, 16); cctx.fillText('0', 20, CH+4);
  const avg=cars.reduce((a,b)=>a+b.cap,0)/cars.length;
  cctx.strokeStyle='#3b4b66'; cctx.setLineDash([4,4]);
  const yAvg=CH-Math.round((avg/maxCap)*(CH-14));
  cctx.beginPath(); cctx.moveTo(PAD,yAvg); cctx.lineTo(chart.width-10,yAvg); cctx.stroke(); cctx.setLineDash([]);
  cctx.fillStyle='#8b97ab'; cctx.fillText('均值 '+avg.toFixed(1), chart.width-90, yAvg-4);
  cars.forEach((c,i)=>{
    const x=PAD+i*(BW+GAP), h=Math.max(2,Math.round((c.cap/maxCap)*(CH-14)));
    cctx.fillStyle = (i===idx) ? '#fff' : roleColor[c.role];
    cctx.fillRect(x, CH-h, BW, h);
    cctx.fillStyle = (i===idx) ? '#cfe0ff' : '#5b6b84';
    cctx.font='9px sans-serif';
    if(i===idx) cctx.fillText(String(c.cap), x-2, CH-h-4);
  });
}
chart.onclick=(e)=>{
  const x=e.offsetX; if(x<PAD) return;
  const i=Math.floor((x-PAD)/(BW+GAP));
  if(i>=0&&i<cars.length){ stop(); go(i); }
};

function draw(){
  ctx.fillStyle='#151b28'; ctx.fillRect(0,0,cv.width,cv.height);
  const cur=cars[idx], curSet=new Set(cur?cur.comps:[]);
  for(let r=0;r<D.rows;r++)for(let c=0;c<D.cols;c++){
    const v=D.blocks[r][c]; if(v<=0) continue;
    const ci=D.comp[r][c];
    const a = curSet.has(ci)?1:(used.has(ci)?0.12:0.34);
    ctx.fillStyle=colOf(v,a); ctx.fillRect(c*CELL+1,r*CELL+1,CELL-2,CELL-2);
  }
  if(cur) for(const ci of cur.comps) for(const [r,c] of D.comps[ci].pixels){
    ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.strokeRect(c*CELL+1.5,r*CELL+1.5,CELL-3,CELL-3);
  }
}
function render(){
  const cur=cars[idx]; if(!cur) return;
  const cls=cur.role==='浅层车'?'r0':(cur.role==='深层车'?'r2':'r1');
  const pieces=cur.comps.map(ci=>{const cp=D.comps[ci];return '<span class="p">'+cp.px+'px·层'+cp.layer+'</span>';}).join('');
  document.getElementById('big').innerHTML=
    '<div class="idx">第 '+(idx+1)+' 辆 / 共 '+cars.length+' 辆</div>'+
    '<div class="row"><span class="chip" style="background:'+colOf(cur.color)+'"></span>'+
      '<b>颜色 '+cur.color+'</b><span class="num">'+cur.cap+'</span><span style="color:#8b97ab">px</span>'+
      '<span class="tag '+cls+'">'+cur.role+'</span><span style="color:#8b97ab">有效层 '+cur.effLayer+'</span></div>'+
    '<div class="pieces">由 '+cur.comps.length+' 块拼成：'+pieces+'</div>';
  const caps=cars.map(c=>c.cap);
  const avg=caps.reduce((a,b)=>a+b,0)/caps.length;
  document.getElementById('stat').textContent =
    '共 '+cars.length+' 辆 ｜ 均值 '+avg.toFixed(1)+'px ｜ 最小 '+Math.min(...caps)+' ｜ 最大 '+Math.max(...caps)+
    ' ｜ 浅层 '+cars.filter(c=>c.role==='浅层车').length+' / 中层 '+cars.filter(c=>c.role==='中层车').length+
    ' / 深层 '+cars.filter(c=>c.role==='深层车').length;
  drawChart();
}
function go(i){
  if(i<0)i=0; if(i>=cars.length)i=cars.length-1;
  used=new Set(); for(let k=0;k<i;k++) for(const ci of cars[k].comps) used.add(ci);
  idx=i; draw(); render();
}
function stop(){ if(timer){clearInterval(timer);timer=null;} document.getElementById('play').textContent='▶ 播放'; }
function play(){
  stop(); if(idx>=cars.length-1) go(0);
  document.getElementById('play').textContent='⏸ 暂停';
  const delay=Math.max(80,1200/(+document.getElementById('speed').value));
  timer=setInterval(()=>{ if(idx>=cars.length-1){stop();return;} go(idx+1); }, delay);
}
document.getElementById('play').onclick=()=>{ timer?stop():play(); };
document.getElementById('prev').onclick=()=>{ stop(); go(idx-1); };
document.getElementById('next').onclick=()=>{ stop(); go(idx+1); };
document.getElementById('mode').onchange=()=>{ stop(); mode=document.getElementById('mode').value; cars= mode==='A'?D.carsA:D.carsB; go(0); };
go(0);
</script></body></html>`;
fs.writeFileSync(OUT, html, 'utf8');
const shell=carsA.filter(c=>c.role==='浅层车').length, pack=carsA.filter(c=>c.role==='深层车').length;
console.log('written', OUT, '| A:', carsA.length, '辆（浅层', shell, '深层', pack, '）| B:', carsB.length, '辆');
