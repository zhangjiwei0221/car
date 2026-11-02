const fs=require('fs');
const B=require('/Users/red/Desktop/毛线汽车/03_工具/正式版/Build006Thickness_v688');
const A=B.loadSolver('corner');
const FILE=process.argv[2], OUT=process.argv[3], MAX=Number(process.argv[4]||10), PARAM=Number(process.argv[5]||2);

function metric(g){
  const o=A.Solver.runSolver(A.parseLevel(A.fromGameFormat(g)),0,1,false,false,{capturePreviewStats:true,instantChain:false});
  const buf=(o.pressureSamples||[]).map(s=>s.buf||0);
  const N=buf.length, eN=Math.max(1,Math.round(N*0.2)), tN=Math.floor(N*0.8);
  let a4=0,r4=0,c=0; for(const v of buf){ if(v>=4){a4++;c++;r4=Math.max(r4,c);} else c=0; }
  const e4=buf.slice(0,eN).filter(v=>v>=4).length;
  const free=buf.slice(0,eN).filter(v=>v===0).length;
  const t3=buf.slice(tN).filter(v=>v>=3).length;
  let tr=0; c=0; for(const v of buf.slice(tN)){ if(v>=3){c++;tr=Math.max(tr,c);} else c=0; }
  return {won:!!o.completed,peak:Math.max(0,...buf),a4,r4,e4,free,t3,tr,steps:N,o};
}
const pass=m=>m.won&&m.peak===4&&m.a4>=20&&m.r4>=10&&m.e4===0&&m.free<=6&&m.t3>=3&&m.tr>=3;

const g=B.readJson(FILE);
let base=metric(g);
console.log('基线: at4='+base.a4+' run4='+base.r4+' 免费'+base.free+' 后段at3='+base.t3+' 判定='+(pass(base)?'过':'不过'));

// 找出每辆车第一次被取的步数（越晚越"不影响压力"）
const nat=new Map();
for(const p of (base.o.pickOrder||[])) if(!nat.has(p.r+','+p.c)) nat.set(p.r+','+p.c, p.step);
const rows=g.spools.length, cols=g.spools[0].length;
const cand=[];
for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
  const s=g.spools[r][c];
  if(!s||!(s.id>0))continue;
  const t=Array.isArray(s.type)?s.type:[s.type||0];
  if(t.includes(5)||t.includes(7)||t.some(x=>x>=11&&x<=14)||s.q)continue;
  cand.push({r,c,step:nat.get(r+','+c)||999,count:s.count});
}
// 优先取出场晚的（步数大）
cand.sort((a,b)=>b.step-a.step);
let added=0, cur=base;
for(const x of cand){
  if(added>=MAX) break;
  const s=g.spools[x.r][x.c];
  const oldT=s.type, oldP=s.param;
  s.type=7; s.param=PARAM;
  const m=metric(g);
  if(pass(m) && m.a4>=cur.a4-1) { cur=m; added++; continue; }
  s.type=oldT; s.param=oldP;
}
fs.writeFileSync(OUT, JSON.stringify(g));
let ice=0; const gr=new Set();
for(const row of g.spools)for(const s of row){const t=s?(Array.isArray(s.type)?s.type:[s.type||0]):[];
  if(s&&s.id>0){ if(t.includes(7))ice++; if(t.includes(5))gr.add(s.param);} }
console.log('加冰 '+added+' 块(param='+PARAM+') → 冰总数 '+ice+' | at4='+cur.a4+' run4='+cur.r4+' 免费'+cur.free+' 后段at3='+cur.t3+' 判定='+(pass(cur)?'✅过':'❌不过'));
