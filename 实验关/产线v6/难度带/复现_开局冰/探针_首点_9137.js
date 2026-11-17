'use strict';
// 探针：p=0 随机玩家首点分布 + 首点后早死率；以及逐格强制首点的早死率（只读）
const fs=require('fs');
const B=require('/Users/red/Desktop/毛线汽车/03_工具/正式版/Build006Thickness_v688');
const A=B.loadSolver('corner');
const Sim=A.Simulator, St=A.SolverStrategy;
const isWon=s=>s.eliminatedPixels>=s.totalPixels;
const isDead=s=>!!(s.overflow||s.buffer.length>s.bufferLimit||Sim.isDeadEnd(s));
function lcg(seed){let rs=seed;return()=>{rs=(rs*1103515245+12345)&0x7fffffff;return rs/0x7fffffff;};}
function playRandom(lv,rnd,firstRC){
  let s=Sim.createState(lv,{useSlotStart:true,bottomOnly:false,instantChain:false});
  let steps=0, first=null;
  if(firstRC){ const ok=Sim.applyPick(s,firstRC[0],firstRC[1]); if(!ok) return null; first=firstRC.join(','); steps=1; }
  while(!isWon(s)&&steps<200){
    const ms=Sim.listMoves(s).filter(m=>!m.blocked);
    const idx=ms.map((_,i)=>i);
    for(let i=idx.length-1;i>0;i--){const j=Math.floor(rnd()*(i+1));const x=idx[i];idx[i]=idx[j];idx[j]=x;}
    let pick=null;
    for(const k of idx){const m=ms[k];const t=St.cloneState(s);if(!Sim.applyPick(t,m.r,m.c))continue;if(!isDead(t)||isWon(t)){pick={m,t};break;}}
    if(!pick) return {won:false,steps,first,deathProgress:s.eliminatedPixels/s.totalPixels};
    if(!first) first=pick.m.r+','+pick.m.c;
    s=pick.t; steps++;
  }
  return {won:isWon(s),steps,first,deathProgress:isWon(s)?null:s.eliminatedPixels/s.totalPixels};
}
const file=process.argv[2];
const g=JSON.parse(fs.readFileSync(file,'utf8'));
const lv=A.parseLevel(A.fromGameFormat(g));
const st=Sim.createState(lv,{useSlotStart:true,bottomOnly:false,instantChain:false});
const opening=Sim.listMoves(st).map(m=>[m.r,m.c,m.antBox.color,m.antBox.count]);
const N=500;
const rnd=lcg(977); const firstStats={}; let early=0,deaths=0,wins=0;
for(let i=0;i<N;i++){
  const r=playRandom(lv,rnd,null);
  const k=r.first||'none';
  const e=!r.won&&r.deathProgress*100<10;
  const o=firstStats[k]||(firstStats[k]={n:0,early:0,deaths:0,wins:0});
  o.n++; if(e)o.early++; if(!r.won)o.deaths++; if(r.won)o.wins++;
  if(e)early++; if(!r.won)deaths++; if(r.won)wins++;
}
const forced={};
for(const [r,c,id,cnt] of opening){
  const rr=lcg(977); let e=0,d=0,w=0;
  for(let i=0;i<200;i++){ const x=playRandom(lv,rr,[r,c]); if(!x)continue; if(x.won)w++; else {d++; if(x.deathProgress*100<10)e++;} }
  forced[r+','+c]={id,count:cnt,early:e,deaths:d,wins:w,n:200};
}
console.log(JSON.stringify({file:file.split('/').pop(),opening,random:{N,early,deaths,wins,firstStats},forced},null,1));
