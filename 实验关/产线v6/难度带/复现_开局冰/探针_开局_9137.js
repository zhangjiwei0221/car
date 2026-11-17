'use strict';
// 探针：开局可点车 + 全格 type/param 概况（只读）
const fs=require('fs');
const B=require('/Users/red/Desktop/毛线汽车/03_工具/正式版/Build006Thickness_v688');
const A=B.loadSolver('corner');
const Sim=A.Simulator;
const file=process.argv[2];
const g=JSON.parse(fs.readFileSync(file,'utf8'));
const lv=A.parseLevel(A.fromGameFormat(g));
const st=Sim.enter(lv,{useSlotStart:true,bottomOnly:false,instantChain:false});
const moves=Sim.listMoves(st);
const out={
  file:file.split('/').pop(),
  openingMoves:moves.map(m=>({r:m.r,c:m.c,id:m.antBox&&m.antBox.color,count:m.antBox&&m.antBox.count,canConsume:m.canConsume,blocked:m.blocked,groupSize:m.groupSize})),
  openingCount:moves.length,
  openingUnblocked:moves.filter(m=>!m.blocked).length,
  ice:[],q:[],chain:[],pipes:[]
};
const sp=g.spools;
for(let r=0;r<sp.length;r++)for(let c=0;c<sp[0].length;c++){
  const cell=sp[r][c], t=cell.type, p=cell.param;
  const ts=Array.isArray(t)?t:[t], ps=Array.isArray(p)?p:[p];
  ts.forEach((tt,i)=>{ if(tt===7)out.ice.push({r,c,id:cell.id,count:cell.count,param:ps[i]}); if(tt===6)out.q.push({r,c,id:cell.id,count:cell.count}); if(tt===5)out.chain.push({r,c,id:cell.id,count:cell.count,gid:ps[i]}); if(tt>=11&&tt<=14)out.pipes.push({r,c,type:tt}); });
}
console.log(JSON.stringify(out,null,1));
