// at4_扫描_v1 —— 在 p-贪心路线上统计 at4（暂存>=4 的步数）与峰值，用于“随意档压力”对照。实验脚本，未入 03_工具。
const fs=require('fs');
const B=require('/Users/red/Desktop/毛线汽车/03_工具/正式版/Build006Thickness_v688');
const A=B.loadSolver('corner'); const Sim=A.Simulator, St=A.SolverStrategy;
const isWon=s=>s.eliminatedPixels>=s.totalPixels;
const isDead=s=>!!(s.overflow||s.buffer.length>s.bufferLimit||Sim.isDeadEnd(s));
function lcg(seed){let rs=seed;return()=>{rs=(rs*1103515245+12345)&0x7fffffff;return rs/0x7fffffff;};}
function play(lv,p,rnd){
  let s=Sim.createState(lv,{useSlotStart:true,bottomOnly:false,instantChain:false});
  const bufs=[]; let steps=0;
  while(!isWon(s)&&steps<200){
    bufs.push(s.buffer.length);
    const ms=Sim.listMoves(s).filter(m=>!m.blocked);
    const alive=t=>!isDead(t)||isWon(t);
    let pick=null;
    if(rnd()<p){
      const cand=[];
      for(const m of ms){const t=St.cloneState(s);const e0=t.eliminatedPixels;if(!Sim.applyPick(t,m.r,m.c))continue;if(!alive(t))continue;cand.push({r:m.r,c:m.c,t,gain:t.eliminatedPixels-e0});}
      if(cand.length){let best=-Infinity;for(const o of cand)if(o.gain>best)best=o.gain;const tied=cand.filter(o=>o.gain===best);pick=tied[Math.floor(rnd()*tied.length)];}
    } else {
      const idx=ms.map((_,i)=>i);
      for(let i=idx.length-1;i>0;i--){const j=Math.floor(rnd()*(i+1));const x=idx[i];idx[i]=idx[j];idx[j]=x;}
      for(const k of idx){const m=ms[k];const t=St.cloneState(s);if(!Sim.applyPick(t,m.r,m.c))continue;if(alive(t)){pick={r:m.r,c:m.c,t};break;}}
    }
    if(!pick) return {won:false,bufs};
    s=pick.t; steps++;
  }
  return {won:isWon(s),bufs};
}
const [levelFile]=process.argv.slice(2);
const lv=A.parseLevel(A.fromGameFormat(JSON.parse(fs.readFileSync(levelFile,'utf8'))));
for(const p of [0.1,0.2]){
  const rnd=lcg(977); let at4=0,at3=0,steps=0,peakSum=0,wins=0,gWith4=0;
  for(let g=0;g<100;g++){
    const r=play(lv,p,rnd);
    const a4=r.bufs.filter(b=>b>=4).length, a3=r.bufs.filter(b=>b>=3).length;
    at4+=a4; at3+=a3; steps+=r.bufs.length; peakSum+=Math.max(0,...r.bufs); if(r.won)wins++; if(a4>0)gWith4++;
  }
  console.log(JSON.stringify({level:levelFile.split('/').pop(),p,winRate:wins/100,meanAt4:(at4/100).toFixed(2),meanAt3:(at3/100).toFixed(2),meanSteps:(steps/100).toFixed(1),meanPeak:(peakSum/100).toFixed(2),gamesWithAt4:gWith4}));
}
