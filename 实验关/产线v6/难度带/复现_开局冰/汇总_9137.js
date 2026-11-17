'use strict';
// 汇总：读取多个 pinterp 的 summary_all.json，输出逐 p 与三段（含 lt10）
const fs=require('fs');
const items=JSON.parse(process.argv[2]);
const rows=[];
for(const it of items){
  const all=JSON.parse(fs.readFileSync(it.dir+'/summary_all.json','utf8'));
  const byP={}; for(const r of all) byP[r.p]=r;
  const ps=Object.keys(byP).map(Number).sort((a,b)=>a-b);
  const w=p=>(byP[p]===undefined?null:byP[p].winRate);
  const avg=a=>{const v=a.filter(x=>x!==null);return v.length?v.reduce((s,x)=>s+x,0)/v.length:null;};
  const f=x=>x===null?null:+x.toFixed(3);
  const casual=avg([0,0.1,0.2].filter(p=>byP[p]!==undefined).map(w));
  const mid=avg([0.3,0.4,0.5,0.6,0.7].filter(p=>byP[p]!==undefined).map(w));
  const serious=avg([0.8,0.9,1].filter(p=>byP[p]!==undefined).map(w));
  let desc=0; for(let i=1;i<ps.length;i++) if(w(ps[i])!==null&&w(ps[i-1])!==null&&w(ps[i])<w(ps[i-1])-1e-9) desc++;
  const lt10={}; for(const p of [0,0.1,0.2]) lt10[p]=byP[p]&&byP[p].deathDist?byP[p].deathDist.lt10:null;
  rows.push({label:it.label, curve:ps.map(p=>({p,w:w(p)})), casual:f(casual), mid:f(mid), serious:f(serious), gap:(serious===null||casual===null)?null:f(serious-casual), desc, lt10});
}
console.log(JSON.stringify(rows,null,1));
