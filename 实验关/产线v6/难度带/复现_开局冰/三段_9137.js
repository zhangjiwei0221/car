'use strict';
// 读 pinterp 的 summary_all.json，输出三段、曲线、deathDist lt10
const fs=require('fs');
const dir=process.argv[2];
const all=JSON.parse(fs.readFileSync(dir+'/summary_all.json','utf8'));
const byP={}; for(const r of all) byP[r.p]=r;
const ps=Object.keys(byP).map(Number).sort((a,b)=>a-b);
const avg=a=>a.reduce((s,x)=>s+x,0)/a.length;
const w=p=>byP[p].winRate;
const casual=avg([0,0.1,0.2].map(w));
const mid=avg([0.3,0.4,0.5,0.6,0.7].map(w));
const serious=avg([0.8,0.9,1].map(w));
let desc=0; for(let i=1;i<ps.length;i++) if(w(ps[i])<w(ps[i-1])-1e-9) desc++;
const lt10={}; for(const p of [0,0.1,0.2]) lt10[p]=byP[p].deathDist?byP[p].deathDist.lt10:null;
console.log(JSON.stringify({dir:dir.split('/').pop(),curve:ps.map(p=>[p,w(p)]),casual:+casual.toFixed(3),mid:+mid.toFixed(3),serious:+serious.toFixed(3),gap:+(serious-casual).toFixed(3),desc,lt10}));
