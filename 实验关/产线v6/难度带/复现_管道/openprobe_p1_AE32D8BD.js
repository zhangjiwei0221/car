#!/usr/bin/env node
'use strict';
// 只读探针（AE32D8BD）：用 PInterp 的 p=1 贪心（当步不死过滤）走一局，记录管道出口格第几步被拿
const path=require('path');
const B=require(path.resolve(__dirname,'../../../../03_工具/正式版/Build006Thickness_v688.js'));
const A=B.loadSolver('corner'); const Sim=A.Simulator, St=A.SolverStrategy;
const isWon=s=>s.eliminatedPixels>=s.totalPixels;
const isDead=s=>!!(s.overflow||s.buffer.length>s.bufferLimit||Sim.isDeadEnd(s));
function lcg(seed){let rs=seed;return()=>{rs=(rs*1103515245+12345)&0x7fffffff;return rs/0x7fffffff;};}
const f=process.argv[2];
const g=JSON.parse(require('fs').readFileSync(f,'utf8'));
const lv=A.parseLevel(A.fromGameFormat(g));
// pipes
const pipes=[];
for(let r=0;r<g.spools.length;r++)for(let c=0;c<g.spools[r].length;c++){
  const s=g.spools[r][c]; if(!s)continue; const t=[].concat(s.type||0); const dir=t.find(x=>x>=11&&x<=14); if(!dir)continue;
  const dy={11:-1,12:0,13:1,14:0}[dir], dx={11:0,12:1,13:0,14:-1}[dir];
  pipes.push({pipe:[r,c],dir,queue:s.param,exit:[r+dy,c+dx]});
}
const pickSeq=[]; let s=Sim.createState(lv,{useSlotStart:true,bottomOnly:false,instantChain:false});
const rnd=lcg(977); let steps=0;
while(!isWon(s)&&steps<200){
  const ms=Sim.listMoves(s).filter(m=>!m.blocked);
  let pick=null;
  const cand=[];
  for(const m of ms){const t=St.cloneState(s);const e0=t.eliminatedPixels;if(!Sim.applyPick(t,m.r,m.c))continue;if(!isDead(t)||isWon(t))cand.push({r:m.r,c:m.c,t,gain:t.eliminatedPixels-e0});}
  if(cand.length){let best=-Infinity;for(const o of cand)if(o.gain>best)best=o.gain;const tied=cand.filter(o=>o.gain===best);pick=tied[Math.floor(rnd()*tied.length)];}
  if(!pick)break;
  pickSeq.push([pick.r,pick.c]); s=pick.t; steps++;
}
const total=pickSeq.length, out=[];
for(const p of pipes){
  const idx=pickSeq.findIndex(([r,c])=>r===p.exit[0]&&c===p.exit[1]);
  out.push({...p,exitStep:idx>=0?idx+1:null,exitProgress:idx>=0?+((idx+1)/total).toFixed(3):null,totalSteps:total,won:isWon(s)});
}
console.log(JSON.stringify(out));
