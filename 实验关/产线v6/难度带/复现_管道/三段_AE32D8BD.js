'use strict';
// 读 PInterp 输出目录（p*/<level>/summary.json），输出三段口径 + lt10 合计（AE32D8BD）
const fs=require('fs'), path=require('path');
const dir=process.argv[2];
const pdirs=fs.readdirSync(dir).filter(d=>/^p\d/.test(d)).sort();
const rec=[];
for(const pd of pdirs){
  const sub=fs.readdirSync(path.join(dir,pd)).filter(d=>fs.existsSync(path.join(dir,pd,d,'summary.json')));
  if(!sub.length) continue;
  const s=JSON.parse(fs.readFileSync(path.join(dir,pd,sub[0],'summary.json'),'utf8'));
  rec.push({p:+s.p,win:s.winRate,lt10:s.deathDist?s.deathDist.lt10:null,lt25:s.deathDist?((s.deathDist.lt10||0)+(s.deathDist.p10_25||0)):null,deathMean:s.deathMean});
}
rec.sort((a,b)=>a.p-b.p);
const avg=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const at=(x)=>rec.filter(r=>Math.abs(r.p-x)<1e-9)[0];
const w=p=>at(p)?at(p).win:null;
const bands={casual:avg([0,.1,.2].map(w)),mid:avg([.3,.4,.5,.6,.7].map(w)),serious:avg([.8,.9,1].map(w))};
let desc=0;for(let i=1;i<rec.length;i++)if(rec[i].win<rec[i-1].win-1e-9)desc++;
const lt10=rec.reduce((s,r)=>s+(r.lt10||0),0);
const lt25=rec.reduce((s,r)=>s+(r.lt25||0),0);
const games=rec.length*100;
console.log(JSON.stringify({dir:dir.split('/').slice(-2).join('/'),curve:rec.map(r=>[r.p,r.win]),casual:+(bands.casual||0).toFixed(3),mid:+(bands.mid||0).toFixed(3),serious:+(bands.serious||0).toFixed(3),gap:+((bands.serious||0)-(bands.casual||0)).toFixed(3),desc,lt10:`${lt10}/${games}`,lt25:`${lt25}/${games}`,deathMean0:at(0)&&at(0).deathMean}));
