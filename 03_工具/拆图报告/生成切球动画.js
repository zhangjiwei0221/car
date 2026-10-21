// 生成「切球动画」HTML：对比三种切法（依赖层 / 贪心轮次 / 按总量）
const fs = require('fs'), path = require('path'), vm = require('vm');
const TXT = process.argv[2] || '/Users/red/Downloads/蚂蚁图库/拼接图/拼接图图库/40x40拼接图纸_016.txt';
const OUT = process.argv[3] || path.join(__dirname, '..', '..', '01_交接文档', '切球动画.html');
const CAP = 30;

const blocks = fs.readFileSync(TXT, 'utf8').split(/\r?\n/).map(l => l.trim())
  .filter(l => l && /^[\d\s,]+$/.test(l)).map(l => l.split(/[\s,]+/).filter(Boolean).map(Number))
  .filter(row => row.length && row.every(v => !isNaN(v)));
const R = blocks.length, C = blocks[0].length;

// ---- ① 依赖层（按**色块**剥，不按颜色）----
//   同色但互不相连的两块，是完全独立的两个单元；只有挨着边界/已清块的才算可剥。
const comp = blocks.map(row => row.map(() => -1));
const compPixels = [];   // {color, pixels}
for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
  if (blocks[r][c] <= 0 || comp[r][c] >= 0) continue;
  const color = blocks[r][c], id = compPixels.length, stack = [[r, c]], pixels = [];
  comp[r][c] = id;
  while (stack.length) {
    const [cr, cc] = stack.pop(); pixels.push([cr, cc]);
    for (const [nr, nc] of [[cr-1,cc],[cr+1,cc],[cr,cc-1],[cr,cc+1]]) {
      if (nr < 0 || nr >= R || nc < 0 || nc >= C) continue;
      if (comp[nr][nc] >= 0 || blocks[nr][nc] !== color) continue;
      comp[nr][nc] = id; stack.push([nr, nc]);
    }
  }
  compPixels.push({ color, pixels });
}
const NCOMP = compPixels.length;
const compAdj = Array.from({length: NCOMP}, () => new Set());
for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
  const a = comp[r][c]; if (a < 0) continue;
  for (const [dr, dc] of [[1,0],[0,1]]) {
    const nr = r + dr, nc = c + dc; if (nr >= R || nc >= C) continue;
    const b = comp[nr][nc]; if (b < 0 || b === a) continue;
    compAdj[a].add(b); compAdj[b].add(a);
  }
}
const compLayer = new Array(NCOMP).fill(-1);
const q0 = [];
compPixels.forEach((cp, i) => {
  if (cp.pixels.some(([r, c]) => r === 0 || r === R-1 || c === 0 || c === C-1)) { compLayer[i] = 0; q0.push(i); }
});
let head = 0;
while (head < q0.length) {
  const i = q0[head++];
  for (const j of compAdj[i]) if (compLayer[j] < 0) { compLayer[j] = compLayer[i] + 1; q0.push(j); }
}
const dep = blocks.map((row, r) => row.map((v, c) => v > 0 ? compLayer[comp[r][c]] : -1));
const MAXDEP = Math.max(...compLayer);
const depStat = { comps: NCOMP, layers: MAXDEP + 1, byLayer: {} };
compLayer.forEach(L => depStat.byLayer[L] = (depStat.byLayer[L] || 0) + 1);

// ---- ①b 同色距离：在同一个颜色内部，离"能开口的那圈"有多远 ----
//   层算的是"要清几种别的颜色"，距离算的是"同色里要走多远"——两件事。
const dist = blocks.map(row => row.map(() => -1));
{
  const q = [];
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    const v = blocks[r][c]; if (v <= 0) continue;
    let edge = false;
    for (const [nr, nc] of [[r-1,c],[r+1,c],[r,c-1],[r,c+1]]) {
      if (nr < 0 || nr >= R || nc < 0 || nc >= C) { edge = true; break; }
      if (blocks[nr][nc] !== v) { edge = true; break; }
    }
    if (edge) { dist[r][c] = 0; q.push([r, c]); }
  }
  let head = 0;
  while (head < q.length) {
    const [r, c] = q[head++]; const v = blocks[r][c];
    for (const [nr, nc] of [[r-1,c],[r+1,c],[r,c-1],[r,c+1]]) {
      if (nr < 0 || nr >= R || nc < 0 || nc >= C) continue;
      if (blocks[nr][nc] !== v || dist[nr][nc] >= 0) continue;
      dist[nr][nc] = dist[r][c] + 1; q.push([nr, nc]);
    }
  }
}
const MAXDIST = Math.max(...dist.flat());

// ---- ② 贪心日程轮次（引擎 eliminationOrder）----
const BIN = path.join(__dirname, '..', '..', '02_工程', '完整主bin快照_20261012', 'bin', 'js');
const FILES = ['utils.js','color-libs.js','simulator.js','solver-strategy.js','solver.js','playersim.js','analysis.js','generator.js'];
const sb = { console:{log(){},warn(){},error(){}}, module:{exports:{}}, WeakMap, Map, Set, setTimeout, clearTimeout, Infinity, Math, JSON };
vm.createContext(sb);
for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BIN, f), 'utf8'), sb, { filename: f });
const eo = sb.AntSolver.eliminationOrder(blocks, R, C, false);
const rounds = blocks.map((row, r) => row.map((v, c) => v > 0 ? (eo.round[r][c] || 1) : -1));
const MAXROUND = Math.max(...rounds.flat());

// ---- ③ 切车 ----
function chunk(a, n) { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; }
function cutBy(map, useLayer) {
  const g = {};
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    const v = blocks[r][c]; if (v <= 0) continue;
    const k = v + '_' + (useLayer ? map[r][c] : 0);
    (g[k] = g[k] || { color: v, layer: useLayer ? map[r][c] : null, pixels: [] }).pixels.push([r, c]);
  }
  const out = [];
  Object.values(g).sort((a, b) => (a.layer ?? 0) - (b.layer ?? 0) || a.color - b.color).forEach(grp => {
    chunk(grp.pixels, CAP).forEach(ps => out.push({ color: grp.color, layer: grp.layer, cap: ps.length, pixels: ps }));
  });
  return out;
}
const carsDep = cutBy(dep, true), carsRound = cutBy(rounds, true), carsColor = cutBy(dep, false);
// 按"同色距离段"切：0~1 近 / 2~3 中 / 4+ 远
const distBand = dist.map(row => row.map(d => d < 0 ? -1 : (d <= 1 ? 0 : (d <= 3 ? 1 : 2))));
const carsDist = (function () {
  const g = {};
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    const v = blocks[r][c]; if (v <= 0) continue;
    const k = v + '_' + distBand[r][c];
    (g[k] = g[k] || { color: v, layer: distBand[r][c], pixels: [] }).pixels.push([r, c]);
  }
  const out = [];
  Object.values(g).sort((a, b) => a.layer - b.layer || a.color - b.color).forEach(grp => {
    chunk(grp.pixels, CAP).forEach(ps => out.push({ color: grp.color, layer: grp.layer, band: true, cap: ps.length, pixels: ps }));
  });
  return out;
})();

const data = { rows:R, cols:C, blocks, dep, comp, compLayer, rounds, dist, distBand, MAXDEP, MAXROUND, MAXDIST, depStat, carsDep, carsRound, carsColor, carsDist, cap:CAP };
const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>切球动画</title>
<style>
 body{margin:0;background:#0f1420;color:#e6ebf5;font:14px/1.6 -apple-system,"PingFang SC",sans-serif}
 .wrap{max-width:1100px;margin:0 auto;padding:20px}
 h1{font-size:20px;margin:0 0 4px}.sub{color:#8b97ab;font-size:13px;margin-bottom:12px}
 .bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
 button{background:#1e2a3d;color:#dbe6f7;border:1px solid #33445f;border-radius:8px;padding:6px 14px;cursor:pointer}
 button:hover{background:#26364e} label{color:#9fb0c8;font-size:13px}
 .stage{display:flex;gap:18px;align-items:flex-start;flex-wrap:wrap}
 canvas{background:#151b28;border-radius:10px;border:1px solid #263248}
 .panel{flex:1;min-width:300px;max-height:560px;overflow:auto;border:1px solid #263248;border-radius:10px;padding:10px;background:#141a26}
 .car{display:flex;align-items:center;gap:8px;margin:4px 0;padding:4px 8px;border-radius:6px;background:#1a2232;font-size:12px}
 .chip{width:22px;height:22px;border-radius:5px;flex:none}.car .n{color:#8b97ab}
 .hint{color:#6f7d93;font-size:12px;margin-top:6px}
 .stat{color:#9fb0c8;font-size:12px;margin-top:8px}
</style></head><body><div class="wrap">
<h1>切球动画 · 40×40</h1>
<div class="sub">同一个目标图，三种切法。左边按当前口径逐层剥离，右边是切出来的车（容量上限 ${CAP}）。</div>
<div class="bar">
  <button id="play">▶ 播放</button><button id="reset">↺ 重来</button>
  <label>切法：<select id="mode">
    <option value="dep">依赖层（按色块剥）</option>
    <option value="round">贪心日程轮次（引擎 eliminationOrder）</option>
    <option value="dist">同色距离（离边缘多远，近/中/远）</option>
    <option value="color">按总量（不分层）</option>
  </select></label>
  <label>速度 <input id="speed" type="range" min="1" max="10" value="5"></label>
</div>
<div class="stage">
  <div><canvas id="cv"></canvas><div class="stat" id="stat"></div></div>
  <div class="panel" id="panel"><div class="hint">点「播放」开始。</div></div>
</div>
<div class="hint">数字冰/锁链等障碍不在本动画里——这里只画「像素怎么被切成车」。</div>
</div>
<script>
const D = ${JSON.stringify(data)};
const cv=document.getElementById('cv'), ctx=cv.getContext('2d'), CELL=12;
cv.width=D.cols*CELL; cv.height=D.rows*CELL;
const panel=document.getElementById('panel'), stat=document.getElementById('stat');
const hue=id=>(id*137.508)%360, colOf=(id,a)=>'hsla('+hue(id)+',65%,55%,'+(a==null?1:a)+')';
let timer=null, curMode='dep';
const MAPS={dep:D.dep,round:D.rounds,dist:D.distBand};
const CARLIST={dep:D.carsDep,round:D.carsRound,dist:D.carsDist,color:D.carsColor};

function draw(map, k){
  ctx.fillStyle='#151b28'; ctx.fillRect(0,0,cv.width,cv.height);
  for(let r=0;r<D.rows;r++)for(let c=0;c<D.cols;c++){
    const v=D.blocks[r][c]; if(v<=0) continue;
    const L=map?map[r][c]:0;
    const a = (k<0)?0.85:(L<k?0.10:(L===k?1:0.20));
    ctx.fillStyle=colOf(v,a); ctx.fillRect(c*CELL+1,r*CELL+1,CELL-2,CELL-2);
  }
}
function stroke(pixels){ for(const [r,c] of pixels){ ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.strokeRect(c*CELL+1.5,r*CELL+1.5,CELL-3,CELL-3);} }
function addCar(car,i){
  const el=document.createElement('div'); el.className='car';
  el.innerHTML='<span class="chip" style="background:'+colOf(car.color)+'"></span><b>'+(i+1)+'</b>'
    +'<span>颜色 '+car.color+'</span><span class="n">'+(car.layer!=null?('第 '+car.layer+' 层 · '):'')+car.cap+' px</span>';
  panel.appendChild(el); panel.scrollTop=panel.scrollHeight;
}
function reset(){ clearInterval(timer); timer=null; panel.innerHTML=''; draw(curMode==='color'?null:MAPS[curMode],-1);
  document.getElementById('play').textContent='▶ 播放';
  stat.textContent = curMode==='dep' ? ('依赖层 '+(D.MAXDEP+1)+' 层 / '+D.depStat.comps+' 个色块 · 车 '+D.carsDep.length)
    : curMode==='round' ? ('贪心轮次共 '+(D.MAXROUND)+' 轮 · 车 '+D.carsRound.length)
    : curMode==='dist' ? ('同色距离 0~'+D.MAXDIST+' · 按近/中/远切 '+D.carsDist.length+' 辆')
    : ('不分层 · 车 '+D.carsColor.length);
}
function play(){
  reset(); const mode=document.getElementById('mode').value; curMode=mode;
  const map = mode==='color'?null:MAPS[mode];
  const list = CARLIST[mode];
  const delay = Math.max(40, 700/(+document.getElementById('speed').value));
  let i=0;
  timer=setInterval(()=>{
    if(i>=list.length){ clearInterval(timer); timer=null; document.getElementById('play').textContent='▶ 播放'; return; }
    const car=list[i];
    if(mode==='color'){ draw(null,-1); } else { draw(map, car.layer); }
    stroke(car.pixels); addCar(car,i); i++;
  }, delay);
}
document.getElementById('play').onclick=()=>{ if(timer){clearInterval(timer);timer=null;document.getElementById('play').textContent='▶ 播放';} else {play();document.getElementById('play').textContent='⏸ 暂停';} };
document.getElementById('reset').onclick=reset;
document.getElementById('mode').onchange=()=>{ curMode=document.getElementById('mode').value; reset(); };
reset();
</script></body></html>`;
fs.writeFileSync(OUT, html, 'utf8');
console.log('written', OUT, '| dep层', MAXDEP+1, '车', carsDep.length, '| round', MAXROUND, '车', carsRound.length, '| color车', carsColor.length);
