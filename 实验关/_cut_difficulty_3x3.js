const vm=require('vm'),fs=require('fs'),path=require('path');
const BIN='02_工程/完整主bin快照_20261012/bin/js';
const FILES=['utils.js','color-libs.js','simulator.js','solver-strategy.js','solver.js','playersim.js','analysis.js','generator.js'];
const sb={console:{log(){},warn(){},error(){}},module:{exports:{}},WeakMap,Map,Set,setTimeout,clearTimeout,Infinity,Math,JSON,Date};
vm.createContext(sb); for(const f of FILES) vm.runInContext(fs.readFileSync(path.join(BIN,f),'utf8'),sb,{filename:f});
const G=sb.AntSolver.Generator;
const blocks=G.blocksFromTXT(fs.readFileSync('实验关/35x35拼接图纸_006.txt','utf8'));
const out='实验关/cut_difficulty_3x3.jsonl'; fs.writeFileSync(out,'');
for(const cut of [null,'layerCut2','exposeCut']){
 for(const seed of [1001,1002,1003]){
  const cfg=Object.assign({},G.DEFAULT_CONFIG,{
   boxSizeMin:40,boxSizeMax:40,capNormMin:40,capNormMax:40,
   boardRowsMin:6,boardRowsMax:9,boardColsMin:6,boardColsMax:10,
   candidateCount:4,portfolioK:3,difficultyRounds:1,timeBudgetMs:60000,
   generatorFlow:'old',targetCarCount:0,hardOnly:true,acceptMode:'target',
   targetPeakMin:3.2,targetPeakMax:4.8,targetSteadyMin:0,targetSteadyMax:100,
   targetBand3Min:0,targetBand4Min:0,targetPlayerPassMin:0.2,targetPlayerPassMax:80,
   targetWMin:0,targetWLowMax:100,targetHiddenDeathMax:20,
   p7Repair:true,p7BaseCount:3,boardFirst:true,row0FreeMax:1,row0FreeIce:1,
   costlyAlt:true,semanticObstacles:false,semanticEarly:false,semanticRouteLock:false,
   fullTime:true,trapPost:false,cutMode:cut||undefined,seed
  });
  const t0=Date.now(); let r=null,err=null;
  try{ r=G.produce(blocks,cfg); }catch(e){ err=String(e&&e.message||e); }
  const p=r&&r.goodV3&&r.goodV3.persist||{},q=p.quality||{},fc=r&&r.goodV3&&r.goodV3.fillCurve||{};
  let J=null;if(p.deathCauses){let t=0,d=0;for(const k in p.deathCauses){t+=p.deathCauses[k];if(k==='管道'||k==='问号')d+=p.deathCauses[k];}J=t?Math.round(d/t*100):0;}
  const row={cut:cut||'auto',seed,ms:Date.now()-t0,valid:!!(r&&r.level),gate:G.goalStructPass(r),J,
   first:p.playerPassPct,learned:p.learnedPassPct,look:p.lookaheadPassPct,T:q.T,R:q.R,
   select:fc.selectMedian,full:fc.fullMedian2,forced:fc.forcedPct,partial:fc.partialStepPct,freeLow:fc.freeLowPct,freeRun:fc.freeRunMax,
   death:p.deathTop,board:r&&r.level&&r.level.board?r.level.board.rows+'x'+r.level.board.cols:null,err};
  fs.appendFileSync(out,JSON.stringify(row)+'\n'); console.log(JSON.stringify(row));
 }
}
