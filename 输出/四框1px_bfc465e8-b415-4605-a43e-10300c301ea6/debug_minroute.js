'use strict';
const B=require('/Users/red/Desktop/毛线汽车/03_工具/正式版/Build006Thickness_v688');
const A=B.loadSolver('corner');
const f=process.argv[2];
const g=B.readJson(f);
const lv=A.parseLevel(A.fromGameFormat(g));
const Sim=A.Simulator;
const clone=o=>JSON.parse(JSON.stringify(o));
function rollout(s0,depth){
  let s=clone(s0); let maxBuf=s.buffer.length;
  for(let d=0;d<depth;d++){
    const mv=Sim.listMoves(s).filter(m=>!m.blocked);
    if(!mv.length)return{maxBuf:99};
    mv.sort((a,b)=>(b.canConsume?1:0)-(a.canConsume?1:0)||a.groupSize-b.groupSize);
    Sim.applyPick(s,mv[0].r,mv[0].c);
    if(s.gameOver)return{maxBuf:99};
    maxBuf=Math.max(maxBuf,s.buffer.length);
    if(s.completedBoxes>=s.totalBoxes)break;
  }
  return{maxBuf};
}
const s=Sim.enter(lv,{useSlotStart:true,instantChain:false});
let step=0;
while(step++<100){
  const mv=Sim.listMoves(s).filter(m=>!m.blocked);
  if(!mv.length){console.log('DEAD no moves');break;}
  let best=null,bestScore=Infinity;
  for(const m of mv){
    const s2=clone(s); Sim.applyPick(s2,m.r,m.c);
    if(s2.gameOver)continue;
    const r=rollout(s2,3); const peak=Math.max(s2.buffer.length,r.maxBuf);
    const score=peak*100-(s2.completedBoxes-s.completedBoxes)*10+s2.buffer.length;
    if(score<bestScore){bestScore=score;best=m;}
  }
  if(!best){console.log('DEAD no safe move');break;}
  const cc=mv.filter(m=>m.canConsume).length;
  const pos=`${best.r},${best.c}`;
  const cell=g.spools[best.r][best.c];
  console.log(`step${step} pick ${cell.id}:${cell.count}@${pos} can=${!!best.canConsume} group=${best.groupSize} avail=${mv.length} canCount=${cc} bufBefore=${s.buffer.length}`);
  Sim.applyPick(s,best.r,best.c);
  console.log(`  => buf=${s.buffer.length} completed=${s.completedBoxes}/${s.totalBoxes} gameOver=${s.gameOver}`);
  if(s.gameOver)break;
  if(s.completedBoxes>=s.totalBoxes)break;
}
