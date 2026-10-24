const vm=require('vm'),fs=require('fs'),path=require('path');
const BIN='02_工程/完整主bin快照_20261012/bin/js';
const FILES=['utils.js','color-libs.js','simulator.js','solver-strategy.js','solver.js','playersim.js','analysis.js','generator.js'];
const sb={console:{log(){},warn(){},error(){}},module:{exports:{}},WeakMap,Map,Set,setTimeout,clearTimeout,Infinity,Math,JSON,Date};
vm.createContext(sb); for(const f of FILES) vm.runInContext(fs.readFileSync(path.join(BIN,f),'utf8'),sb,{filename:f});
const G=sb.AntSolver.Generator;const blocks=G.blocksFromTXT(fs.readFileSync('实验关/35x35拼接图纸_006.txt','utf8'));
fs.writeFileSync('实验关/placement_ab_controlled.jsonl','');
for(const cap of [1,0]){
 for(const seed of [1001,1002,1003]){
  const cfg=Object.assign({},G.DEFAULT_CONFIG,{
   boxSizeMin:40,boxSizeMax:40,capNormMin:40,capNormMax:40,
   boardRowsMin:6,boardRowsMax:9,boardColsMin:6,boardColsMax:10,
   candidateCount:1,portfolioK:1,difficultyRounds:1,timeBudgetMs:60000,
   generatorFlow:'old',targetCarCount:0,hardOnly:true,acceptMode:'target',
   targetPeakMin:3.2,targetPeakMax:4.8,targetSteadyMin:0,targetSteadyMax:100,
   targetBand3Min:0,targetBand4Min:0,targetPlayerPassMin:0.2,targetPlayerPassMax:80,
   targetWMin:0,targetWLowMax:100,targetHiddenDeathMax:20,
   p7Repair:true,p7BaseCount:1,boardFirst:true,
   costlyAlt:false,semanticObstacles:false,semanticEarly:false,semanticRouteLock:false,
   fullTime:false,trapPost:false,cutMode:undefined,seed,
   row0FreeMax:cap,row0FreeIce:1,row0ColorMax:2,iceSchedule:true
  });
  const t0=Date.now();let r=null,err=null;
  try{ r=G.produce(blocks,cfg); }catch(e){ err=String(e&&e.message||e); }
  const p=r&&r.goodV3&&r.goodV3.persist||{},q=p.quality||{},fc=r&&r.goodV3&&r.goodV3.fillCurve||{};const b=r&&r.level&&r.level.board;
  const row={cap,seed,ms:Date.now()-t0,valid:!!(r&&r.level),gate:G.goalStructPass(r),row0:b&&b.row0FreeStat,earlyFree:fc.earlyFree10,earlyPeak:fc.earlyPeak10,
   first:p.playerPassPct,learned:p.learnedPassPct,look:p.lookaheadPassPct,T:q.T,R:q.R,freeLow:fc.freeLowPct,freeRun:fc.freeRunMax,full:fc.fullMedian2,select:fc.selectMedian,death:p.deathTop,err};
  fs.appendFileSync('实验关/placement_ab_controlled.jsonl',JSON.stringify(row)+'\n');console.log(JSON.stringify(row));
 }
}
