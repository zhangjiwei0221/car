const vm=require('vm'),fs=require('fs'),path=require('path');
const BIN='02_工程/完整主bin快照_20261012/bin/js';
const FILES=['utils.js','color-libs.js','simulator.js','solver-strategy.js','solver.js','playersim.js','analysis.js','generator.js'];
const sb={console:{log(){},warn(){},error(){}},module:{exports:{}},WeakMap,Map,Set,setTimeout,clearTimeout,Infinity,Math,JSON,Date};
vm.createContext(sb); for(const f of FILES) vm.runInContext(fs.readFileSync(path.join(BIN,f),'utf8'),sb,{filename:f});
const G=sb.AntSolver.Generator;
const blocks=G.blocksFromTXT(fs.readFileSync('实验关/35x35拼接图纸_006.txt','utf8'));
const profiles={
 A:{row0FreeMax:1,row0FreeIce:1},
 B:{row0FreeMax:0,row0FreeIce:1},
 C:{row0FreeMax:1,row0FreeIce:1,rowMajorMix:true,freePerRow:1,mixRows:2}
};
fs.writeFileSync('实验关/placement_3x3.jsonl','');
for(const tag of ['A','B','C']){
 for(const seed of [1001,1002,1003]){
  const cfg=Object.assign({},G.DEFAULT_CONFIG,{
   boxSizeMin:40,boxSizeMax:40,capNormMin:40,capNormMax:40,
   boardRowsMin:6,boardRowsMax:9,boardColsMin:6,boardColsMax:10,
   candidateCount:4,portfolioK:3,difficultyRounds:1,timeBudgetMs:60000,
   generatorFlow:'old',targetCarCount:0,hardOnly:true,acceptMode:'target',
   targetPeakMin:3.2,targetPeakMax:4.8,targetSteadyMin:0,targetSteadyMax:100,
   targetBand3Min:0,targetBand4Min:0,targetPlayerPassMin:0.2,targetPlayerPassMax:80,
   targetWMin:0,targetWLowMax:100,targetHiddenDeathMax:20,
   p7Repair:true,p7BaseCount:3,boardFirst:true,
   costlyAlt:true,semanticObstacles:false,semanticEarly:false,semanticRouteLock:false,
   fullTime:true,trapPost:false,cutMode:undefined,seed
  },profiles[tag]);
  const t0=Date.now(); let r=null,err=null;
  try{ r=G.produce(blocks,cfg); }catch(e){ err=String(e&&e.message||e); }
  const p=r&&r.goodV3&&r.goodV3.persist||{},q=p.quality||{},fc=r&&r.goodV3&&r.goodV3.fillCurve||{};
  let J=null;if(p.deathCauses){let t=0,d=0;for(const k in p.deathCauses){t+=p.deathCauses[k];if(k==='管道'||k==='问号')d+=p.deathCauses[k];}J=t?Math.round(d/t*100):0;}
  const row={profile:tag,seed,ms:Date.now()-t0,valid:!!(r&&r.level),gate:G.goalStructPass(r),J,
   first:p.playerPassPct,learned:p.learnedPassPct,look:p.lookaheadPassPct,T:q.T,R:q.R,
   select:fc.selectMedian,full:fc.fullMedian2,forced:fc.forcedPct,partial:fc.partialStepPct,freeLow:fc.freeLowPct,freeRun:fc.freeRunMax,
   earlyFree:fc.earlyFree10,earlyPeak:fc.earlyPeak10,death:p.deathTop,
   row0Free:(r&&r.level&&r.level.board&&r.level.board.row0FreeStat)?r.level.board.row0FreeStat.after:null,err};
  fs.appendFileSync('实验关/placement_3x3.jsonl',JSON.stringify(row)+'\n'); console.log(JSON.stringify(row));
 }
}
