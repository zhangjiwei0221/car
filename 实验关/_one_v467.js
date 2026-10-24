const vm=require('vm'),fs=require('fs'),path=require('path');
const BIN='02_工程/完整主bin快照_20261012/bin/js';
const FILES=['utils.js','color-libs.js','simulator.js','solver-strategy.js','solver.js','playersim.js','analysis.js','generator.js'];
const sb={console:{log(){},warn(){},error(){}},module:{exports:{}},WeakMap,Map,Set,setTimeout,clearTimeout,Infinity,Math,JSON,Date};
vm.createContext(sb); for(const f of FILES) vm.runInContext(fs.readFileSync(path.join(BIN,f),'utf8'),sb,{filename:f});
const G=sb.AntSolver.Generator;
const txt=fs.readFileSync('实验关/我做_006_第三版A_中等.json','utf8');
const lv=JSON.parse(txt);
// use the image behind 006 from the known txt
const blocks=G.blocksFromTXT(fs.readFileSync('实验关/好图_35x35_碎块_20261023.txt','utf8'));
const cap=G.deriveCapacityBand(blocks);
function verdict(r){
  if(!r||!r.level) return {gate:false,pass:false,reasons:['no level']};
  const gate=G.goalStructPass(r);
  const g=r.goodV3||{}, p=g.persist||{}, q=p.quality||{}, fc=g.fillCurve||{};
  const R=[];
  function chk(name,val,ok){ if(!ok) R.push(name+'='+val); }
  chk('learned',p.learnedPassPct,p.learnedPassPct!=null&&p.learnedPassPct>=55&&p.learnedPassPct<=85);
  chk('look',p.lookaheadPassPct,p.lookaheadPassPct!=null&&p.lookaheadPassPct>=40&&p.lookaheadPassPct<=85);
  chk('select',fc.selectMedian,fc.selectMedian!=null&&fc.selectMedian>=2);
  chk('forced',fc.forcedPct,fc.forcedPct==null||fc.forcedPct<=20);
  chk('partial',fc.partialStepPct,fc.partialStepPct==null||fc.partialStepPct>=20);
  chk('full',fc.fullMedian2,fc.fullMedian2==null||fc.fullMedian2<=2);
  chk('T',q.T,q.T!=null&&q.T>=10);
  chk('R',q.R,q.R!=null&&q.R>=15);
  chk('freePct',fc.freePct,fc.freePct==null||fc.freePct<=50);
  chk('freeRun',fc.freeRunMax,fc.freeRunMax==null||fc.freeRunMax<=5);
  return {gate:!!gate,pass:R.length===0,reasons:R};
}
const cfg=Object.assign({},G.DEFAULT_CONFIG,{
  boxSizeMin:cap.band[0],boxSizeMax:cap.band[1],capNormMin:cap.band[0],capNormMax:cap.band[1],
  boardRowsMin:4,boardRowsMax:9,boardColsMin:5,boardColsMax:10,
  candidateCount:6,portfolioK:10,difficultyRounds:1,timeBudgetMs:180000,generatorFlow:'old',
  targetCarCount:0,hardOnly:true,acceptMode:'target',
  targetPeakMin:3.2,targetPeakMax:4.8,targetSteadyMin:0,targetSteadyMax:100,
  targetBand3Min:0,targetBand4Min:0,targetPlayerPassMin:0.2,targetPlayerPassMax:80,
  targetWMin:0,targetWLowMax:100,targetHiddenDeathMax:20,
  p7Repair:true,p7BaseCount:3,boardFirst:true,row0FreeMax:1,row0FreeIce:1,
  costlyAlt:true,semanticObstacles:false,semanticEarly:false,semanticRouteLock:false,
  fullTime:true,trapPost:true
});
const out='实验关/基线_v466_10seed.jsonl';
fs.writeFileSync(out,'');
for(let i=1;i<=1;i++){
  const t0=Date.now();
  const c=Object.assign({},cfg,{seed:1000+i});
  let r=null,err=null;
  try{ r=G.produce(blocks,c); }catch(e){ err=String(e&&e.message||e); }
  const v=verdict(r);
  const p=r&&r.goodV3&&r.goodV3.persist||{},q=p.quality||{},fc=r&&r.goodV3&&r.goodV3.fillCurve||{};
  const row={seed:1000+i,ms:Date.now()-t0,valid:!!(r&&r.level),gate:v.gate,pass:v.pass,reasons:v.reasons,
    first:p.playerPassPct,learned:p.learnedPassPct,look:p.lookaheadPassPct,T:q.T,R:q.R,
    select:fc.selectMedian,full:fc.fullMedian2,forced:fc.forcedPct,partial:fc.partialStepPct,
    freeLow:fc.freeLowPct,freeRun:fc.freeRunMax,p7ms:r&&r.p7&&r.p7.ms,p7stage:r&&r.p7&&r.p7.stage,
    tried:r&&r.p7&&r.p7.tried,accepted:r&&r.p7&&r.p7.accepted,err};
  fs.appendFileSync(out,JSON.stringify(row)+'\n');
  console.log(JSON.stringify(row));
}
