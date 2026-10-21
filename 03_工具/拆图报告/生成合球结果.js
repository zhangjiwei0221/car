// 合球结果（静态）：一行统计 + 容量直方图 + 分档表，不做动画
const fs=require('fs'), path=require('path');
const TXT = process.argv[2] || '/Users/red/Downloads/蚂蚁图库/拼接图/拼接图图库/40x40拼接图纸_016.txt';
const OUT = process.argv[3] || path.join(__dirname,'..','..','01_交接文档','合球结果.html');
const BMN=24, BMX=36;
const blocks = fs.readFileSync(TXT,'utf8').split(/\r?\n/).map(l=>l.trim())
  .filter(l=>l && /^[\d\s,]+$/.test(l)).map(l=>l.split(/[\s,]+/).filter(Boolean).map(Number))
  .filter(r=>r.length && r.every(v=>!isNaN(v)));
const R=blocks.length, C=blocks[0].length;
// 色块 + 层
const comp=blocks.map(r=>r.map(()=>-1)), comps=[];
for(let r=0;r<R;r++)for(let c=0;c<C;c++){
  if(blocks[r][c]<=0||comp[r][c]>=0) continue;
  const color=blocks[r][c], id=comps.length, st=[[r,c]], px=[];
  comp[r][c]=id;
  while(st.length){ const [cr,cc]=st.pop(); px.push([cr,cc]);
    for(const [nr,nc] of [[cr-1,cc],[cr+1,cc],[cr,cc-1],[cr,cc+1]]){
      if(nr<0||nr>=R||nc<0||nc>=C) continue;
      if(comp[nr][nc]>=0||blocks[nr][nc]!==color) continue;
      comp[nr][nc]=id; st.push([nr,nc]);
    } }
  comps.push({color,n:px.length,pixels:px,layer:-1});
}
const adj=comps.map(()=>({}));
for(let r=0;r<R;r++)for(let c=0;c<C;c++){ const a=comp[r][c]; if(a<0)continue;
  for(const [dr,dc] of [[1,0],[0,1]]){ const nr=r+dr,nc=c+dc; if(nr>=R||nc>=C)continue;
    const b=comp[nr][nc]; if(b<0||b===a)continue; adj[a][b]=1; adj[b][a]=1; } }
const q=[]; comps.forEach((cp,i)=>{ if(cp.pixels.some(([r,c])=>r===0||r===R-1||c===0||c===C-1)){cp.layer=0;q.push(i);} });
for(let h=0;h<q.length;h++){ const i=q[h]; for(const k in adj[i]){ const j=+k; if(comps[j].layer<0){comps[j].layer=comps[i].layer+1;q.push(j);} } }
// 合球
const byColor={}; comps.forEach((cp,i)=>(byColor[cp.color]=byColor[cp.color]||[]).push({i,...cp}));
const cars=[];
for(const color of Object.keys(byColor).map(Number).sort((a,b)=>a-b)){
  const list=byColor[color].slice().sort((a,b)=>a.layer-b.layer||b.n-a.n||a.i-b.i);
  let cur=null;
  for(const cp of list){
    if(!cur) cur={color,cap:0,layer:0};
    if(cur.cap+cp.n>BMX && cur.cap>=BMN){ cars.push(cur); cur={color,cap:0,layer:0}; }
    cur.cap+=cp.n; cur.layer=Math.max(cur.layer,cp.layer);
  }
  if(cur&&cur.cap>0) cars.push(cur);
}
cars.sort((a,b)=>a.layer-b.layer||a.color-b.color);
cars.forEach(c=>{ c.role = c.layer<=1?'浅层车':(c.layer>=3?'深层车':'中层车'); });
const caps=cars.map(c=>c.cap), n=caps.length;
const avg=caps.reduce((a,b)=>a+b,0)/n, mn=Math.min(...caps), mx=Math.max(...caps);
const byRole=k=>cars.filter(c=>c.role===k).length;
const bucket=(lo,hi)=>caps.filter(v=>v>=lo&&v<hi).length;
const roleColor={'浅层车':'#2fa86a','中层车':'#c9971f','深层车':'#d05575'};

// SVG 直方图
const W=Math.max(720, n*13+90), H=230, PADL=54, PADB=40, BAND=H-PADB-16;
const y=v=>PADB+ (BAND - Math.round(v/mx*BAND));
let bars='';
cars.forEach((c,i)=>{ const x=PADL+i*13, hh=Math.max(2,Math.round(c.cap/mx*BAND));
  bars+='<rect x="'+x+'" y="'+(PADB+BAND-hh)+'" width="10" height="'+hh+'" rx="2" fill="'+roleColor[c.role]+'"><title>第'+(i+1)+'辆 颜色'+c.color+' '+c.cap+'px '+c.role+'</title></rect>'; });
const yAvg=y(avg);
const svg='<svg width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'" xmlns="http://www.w3.org/2000/svg">'
 +'<rect width="'+W+'" height="'+H+'" fill="#fff"/>'
 +'<line x1="'+PADL+'" y1="'+(PADB+BAND)+'" x2="'+(W-20)+'" y2="'+(PADB+BAND)+'" stroke="#ccd3e0"/>'
 +'<line x1="'+PADL+'" y1="'+PADB+'" x2="'+PADL+'" y2="'+(PADB+BAND)+'" stroke="#ccd3e0"/>'
 +'<text x="8" y="'+(PADB+4)+'" font-size="11" fill="#6b7688">'+mx+'px</text>'
 +'<text x="30" y="'+(PADB+BAND+4)+'" font-size="11" fill="#6b7688">0</text>'
 +'<line x1="'+PADL+'" y1="'+yAvg+'" x2="'+(W-20)+'" y2="'+yAvg+'" stroke="#8b97ab" stroke-dasharray="5 4"/>'
 +'<text x="'+(W-120)+'" y="'+(yAvg-5)+'" font-size="11" fill="#6b7688">均值 '+avg.toFixed(1)+'px</text>'
 +bars
 +'<text x="'+PADL+'" y="'+(H-8)+'" font-size="11" fill="#6b7688">每根柱子 = 一辆车（左→右 = 出场顺序）</text>'
 +'</svg>';

const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>合球结果</title>
<style>
 body{margin:0;background:#f6f7fb;color:#1f2430;font:14px/1.7 -apple-system,"PingFang SC",sans-serif}
 .wrap{max-width:980px;margin:0 auto;padding:24px}
 h1{font-size:20px;margin:0 0 6px}
 .big{font-size:15px;background:#fff;border:1px solid #e3e6ee;border-radius:10px;padding:12px 16px;margin:12px 0}
 .big b{font-size:18px}
 table{border-collapse:collapse;width:100%;background:#fff;border:1px solid #e3e6ee;border-radius:10px;overflow:hidden;margin:10px 0}
 th,td{border-bottom:1px solid #eef1f6;padding:7px 10px;text-align:left;font-size:13px}
 th{background:#fafbfe;color:#5b6472;font-weight:600}
 .k{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px;vertical-align:middle}
 .sub{color:#5b6472;font-size:13px}
 .card{background:#fff;border:1px solid #e3e6ee;border-radius:10px;padding:12px;margin:12px 0;overflow:auto}
</style></head><body><div class="wrap">
<h1>合球结果</h1>
<div class="sub">图：${path.basename(TXT)}</div>

<div class="big">共 <b>${n}</b> 辆 ｜ 均值 <b>${avg.toFixed(1)}</b>px ｜ 最小 <b>${mn}</b> ｜ 最大 <b>${mx}</b> ｜
 <span class="k" style="background:${roleColor['浅层车']}"></span>浅层 ${byRole('浅层车')} ·
 <span class="k" style="background:${roleColor['中层车']}"></span>中层 ${byRole('中层车')} ·
 <span class="k" style="background:${roleColor['深层车']}"></span>深层 ${byRole('深层车')}
</div>

<div class="card">${svg}</div>

<table>
 <tr><th>容量分档</th><th>辆数</th></tr>
 <tr><td>&lt;10px</td><td>${bucket(0,10)}</td></tr>
 <tr><td>10~20px</td><td>${bucket(10,20)}</td></tr>
 <tr><td>20~30px</td><td>${bucket(20,30)}</td></tr>
 <tr><td>30~40px</td><td>${bucket(30,40)}</td></tr>
 <tr><td>≥40px</td><td>${bucket(40,1e9)}</td></tr>
</table>

<table>
 <tr><th>角色</th><th>有效层</th><th>辆数</th><th>均值容量</th></tr>
 ${['浅层车','中层车','深层车'].map(r=>{const g=cars.filter(c=>c.role===r);const a=g.length?(g.reduce((s,c)=>s+c.cap,0)/g.length).toFixed(1):'-';
  const L=r==='浅层车'?'≤1':(r==='中层车'?'2':'≥3');
  return '<tr><td><span class="k" style="background:'+roleColor[r]+'"></span>'+r+'</td><td>'+L+'</td><td>'+g.length+'</td><td>'+a+'</td></tr>';}).join('')}
</table>
</div></body></html>`;
fs.writeFileSync(OUT, html, 'utf8');
console.log('written', OUT, '| 车数', n, '均值', avg.toFixed(1), '最小', mn, '最大', mx);
