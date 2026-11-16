// 试玩路径_汇总_v1 —— 把导出的点击路径与待试玩四张关匹配，输出 步数/胜负/峰值/at4/at3。实验脚本，未入 03_工具。
const fs=require("fs"),path=require("path");
const B=require('/Users/red/Desktop/毛线汽车/03_工具/正式版/Build006Thickness_v688');
const A=B.loadSolver('corner'); const Sim=A.Simulator;
const dir='/Users/red/Desktop/毛线汽车/实验关/产线v6/待试玩_20261117';
const levels=fs.readdirSync(dir).filter(f=>f.endsWith('.json')).map(f=>({file:f,lv:A.parseLevel(A.fromGameFormat(JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'))))}));
function match(P){
  for(const L of levels){
    let s=Sim.createState(L.lv,{useSlotStart:true,instantChain:false});let ok=true;
    for(const ck of (P.clicks||[])){ if(!Sim.applyPick(s,ck.r,ck.c)){ok=false;break;} }
    if(ok) return L.file;
  }
  return null;
}
const files=process.argv.slice(2);
for(const f of files){
  const P=JSON.parse(fs.readFileSync(f,'utf8'));
  const m=match(P);
  const cs=P.clicks||[];
  const bufs=cs.map((c,i)=> i===0?0:(cs[i-1].bufferAfter||0));
  const peaks=[0,...cs.map(c=>c.bufferAfter||0)];
  const at4=peaks.filter(b=>b>=4).length, at3=peaks.filter(b=>b>=3).length;
  const last=cs[cs.length-1]||{};
  const won=!!last.gameWon || (last.eliminatedPixels===last.totalPixels);
  const dead=!!last.gameOver;
  console.log(JSON.stringify({file:path.basename(f),level:m,clicks:cs.length,won,gameOver:dead,progress:last.progress,peak:Math.max(...peaks),at4,at3,lastBuffer:last.bufferAfter}));
}
