const fs=require('fs');
const B=require('/Users/red/Desktop/毛线汽车/03_工具/正式版/Build006Thickness_v688');
const A=B.loadSolver('corner');
const FILE=process.argv[2], OUT=process.argv[3], N=Number(process.argv[4]||2);
function metric(g){
  const o=A.Solver.runSolver(A.parseLevel(A.fromGameFormat(g)),0,1,false,false,{capturePreviewStats:true,instantChain:false});
  const buf=(o.pressureSamples||[]).map(s=>s.buf||0);
  const L=buf.length,eN=Math.max(1,Math.round(L*0.2)),tN=Math.floor(L*0.8);
  let a4=0,r4=0,c=0; for(const v of buf){ if(v>=4){a4++;c++;r4=Math.max(r4,c);} else c=0; }
  return {won:!!o.completed,peak:Math.max(0,...buf),a4,r4,
    e4:buf.slice(0,eN).filter(v=>v>=4).length, free:buf.slice(0,eN).filter(v=>v===0).length,
    t3:buf.slice(tN).filter(v=>v>=3).length};
}
let g=B.readJson(FILE);
const px={}; for(const r of g.blocks)for(const v of r)px[v]=(px[v]||0)+1;
const H=g.blocks.length,W=g.blocks[0].length;
const sumd={}; for(let y=0;y<H;y++)for(let x=0;x<W;x++){const c=g.blocks[y][x]; sumd[c]=(sumd[c]||0)+((H-1-y)+x);}
const dist={}; for(const c of Object.keys(px).map(Number)) dist[c]=sumd[c]/px[c];
const rows=g.spools.length, cols=g.spools[0].length;
const plain=(s)=>{ if(!s||!(s.id>0))return false; const t=Array.isArray(s.type)?s.type:[s.type||0];
  return !t.includes(5)&&!t.includes(7)&&!t.some(x=>x>=11&&x<=14)&&!s.q; };
const hard=[], big=[];
for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
  const s=g.spools[r][c]; if(!plain(s))continue;
  const info={r,c,id:s.id,count:s.count,px:px[s.id],depth:dist[s.id]};
  if(px[s.id]<70) hard.push(info); else if(px[s.id]>120) big.push(info);
}
hard.sort((a,b)=>b.depth-a.depth); big.sort((a,b)=>b.px-a.px);
console.log("小色车 "+hard.length+" 辆、大色车 "+big.length+" 辆");
let added=0; const log=[];
for(const h of hard){
  if(added>=N) break;
  for(const b of big){
    // 把 b 的车换到 h 的旁边（右下或下方优先，出场更晚）
    const cand=[[h.r,h.c+1],[h.r+1,h.c],[h.r,h.c-1],[h.r-1,h.c]].filter(([r,c])=>r>=0&&c>=0&&r<rows&&c<cols&&plain(g.spools[r][c]));
    if(!cand.length) continue;
    const [tr,tc]=cand[0];
    const tmp=g.spools[tr][tc]; g.spools[tr][tc]=g.spools[b.r][b.c]; g.spools[b.r][b.c]=tmp;
    const s1=g.spools[h.r][h.c], s2=g.spools[tr][tc];
    const o1={t:s1.type,p:s1.param}, o2={t:s2.type,p:s2.param};
    const grp=100+added;
    s1.type=5; s1.param=grp; s2.type=5; s2.param=grp;
    const m=metric(g);
    if(m.won&&m.peak===4&&m.a4>=20&&m.e4===0){ added++; log.push("小色"+h.id+"("+h.px+"px,深"+h.depth.toFixed(0)+")锁大色"+b.id+"("+b.px+"px) → at4="+m.a4); break; }
    s1.type=o1.t; s1.param=o1.p; s2.type=o2.t; s2.param=o2.p;
    const tm2=g.spools[tr][tc]; g.spools[tr][tc]=g.spools[b.r][b.c]; g.spools[b.r][b.c]=tm2;
  }
}
fs.writeFileSync(OUT,JSON.stringify(g));
log.forEach(l=>console.log("  ✅ "+l));
const m=metric(g);
console.log("共 "+added+" 组 | at4="+m.a4+" run4="+m.r4+" 前20%at4="+m.e4+" 免费"+m.free+" 后20%at3="+m.t3+" 可通="+(m.won?"✓":"✗")+" 峰值="+m.peak);
