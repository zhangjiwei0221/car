'use strict';
// 逐色守恒（管道感知，AE32D8BD）：管道 param 里的队列车计入对应颜色
const fs=require('fs');
const g=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const H=g.blocks.length,W=g.blocks[0].length;
const px={}; let bg=0;
for(let y=0;y<H;y++)for(let x=0;x<W;x++){const v=g.blocks[y][x]; if(!v){bg++;continue;} px[v]=(px[v]||0)+1;}
const car={};
for(const row of g.spools)for(const s of row){
  if(!s)continue;
  const tl=[].concat(s.type||0);
  if(tl.some(v=>v>=11&&v<=14)){ for(const b of (s.param||[])) car[b.id]=(car[b.id]||0)+(b.count||0); continue; }
  if(!(s.id>0))continue; car[s.id]=(car[s.id]||0)+s.count;
}
const colors=[...new Set([...Object.keys(px),...Object.keys(car)])].sort((a,b)=>a-b);
const rows=colors.map(c=>({color:+c,pixels:px[c]||0,carSum:car[c]||0,ok:(px[c]||0)===(car[c]||0)}));
const pxTotal=rows.reduce((s,r)=>s+r.pixels,0), carTotal=rows.reduce((s,r)=>s+r.carSum,0);
const out={file:process.argv[2].split('/').pop(),size:H+'x'+W,bgPixels:bg,pxTotal,carTotal,ok:pxTotal===carTotal&&rows.every(r=>r.ok),colors:rows};
if(process.argv[3]) fs.writeFileSync(process.argv[3],JSON.stringify(out,null,1));
console.log(JSON.stringify({ok:out.ok,pxTotal,carTotal,colors:rows.length,bad:rows.filter(r=>!r.ok)}));
