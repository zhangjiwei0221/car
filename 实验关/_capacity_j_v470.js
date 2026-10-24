const vm=require('vm'),fs=require('fs'),path=require('path');
const BIN='02_工程/完整主bin快照_20261012/bin/js';
const FILES=['utils.js','color-libs.js','simulator.js','solver-strategy.js','solver.js','playersim.js','analysis.js','generator.js'];
const sb={console:{log(){},warn(){},error(){}},module:{exports:{}},WeakMap,Map,Set,setTimeout,clearTimeout,Infinity,Math,JSON,Date};
vm.createContext(sb); for(const f of FILES) vm.runInContext(fs.readFileSync(path.join(BIN,f),'utf8'),sb,{filename:f});
const G=sb.AntSolver.Generator;
const cases=[
 {name:'006',file:'实验关/35x35拼接图纸_006.txt',cap:40,cut:null},
];
const out='实验关/容量J_006_v470.jsonl'; fs.writeFileSync(out,'');
for(const c of cases){
 const blocks=G.blocksFromTXT(fs.readFileSync(c.file,'utf8'));
 const cfg=Object.assign({},G.DEFAULT_CONFIG,{
  boxSizeMin:c.cap,boxSizeMax:c.cap,capNormMin:c.cap,capNormMax:c.cap,
  boardRowsMin:6,boardRowsMax:9,boardColsMin:6,boardColsMax:10,
  candidateCount:1,portfolioK:1,difficultyRounds:1,timeBudgetMs:60000,
  generatorFlow:'old',targetCarCount:0,hardOnly:true,acceptMode:'target',
  targetPeakMin:3.2,targetPeakMax:4.8,targetSteadyMin:0,targetSteadyMax:100,
  targetBand3Min:0,targetBand4Min:0,targetPlayerPassMin:0.2,targetPlayerPassMax:80,
  targetWMin:0,targetWLowMax:100,targetHiddenDeathMax:20,
  p7Repair:true,p7BaseCount:1,boardFirst:true,row0FreeMax:1,row0FreeIce:1,
  costlyAlt:false,semanticObstacles:false,semanticEarly:false,semanticRouteLock:false,
  fullTime:false,trapPost:false,cutMode:c.cut||undefined,seed:1001
 });
 const t0=Date.now(); const r=G.produce(blocks,cfg);
 const p=r&&r.goodV3&&r.goodV3.persist||{}, q=p.quality||{}, fc=r&&r.goodV3&&r.goodV3.fillCurve||{};
 let J=null; if(p.deathCauses){let t=0,d=0;for(const k in p.deathCauses){t+=p.deathCauses[k];if(k==='管道'||k==='问号')d+=p.deathCauses[k];}J=t?Math.round(d/t*100):0;}
 const reasons=[];
 if(J!=null&&J>20)reasons.push('J='+J);
 if(fc.selectMedian!=null&&fc.selectMedian<2)reasons.push('select='+fc.selectMedian);
 if(fc.forcedPct!=null&&fc.forcedPct>20)reasons.push('forced='+fc.forcedPct);
 if(fc.partialStepPct!=null&&fc.partialStepPct<20)reasons.push('partial='+fc.partialStepPct);
 if(fc.fullMedian2!=null&&fc.fullMedian2>2)reasons.push('full='+fc.fullMedian2);
 if(fc.freeLowPct!=null&&fc.freeLowPct>30)reasons.push('freeLow='+fc.freeLowPct);
 if(fc.freeRunMax!=null&&fc.freeRunMax>5)reasons.push('freeRun='+fc.freeRunMax);
 const row={img:c.name,cap:c.cap,cut:c.cut||'auto',ms:Date.now()-t0,valid:!!(r&&r.level),gate:G.goalStructPass(r),reasons,
  J,death:p.deathCauses||null,select:fc.selectMedian,full:fc.fullMedian2,forced:fc.forcedPct,partial:fc.partialStepPct,
  freeLow:fc.freeLowPct,freeRun:fc.freeRunMax,first:p.playerPassPct,learned:p.learnedPassPct,look:p.lookaheadPassPct,T:q.T,R:q.R,
  fallback:!!(r&&r.fallback),fallbackType:r&&r.fallbackType,board:r&&r.level&&r.level.board?r.level.board.rows+'x'+r.level.board.cols:null,p7ms:r&&r.p7&&r.p7.ms};
 fs.appendFileSync(out,JSON.stringify(row)+'\n'); console.log(JSON.stringify(row));
}
