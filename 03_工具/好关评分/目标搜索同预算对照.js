#!/usr/bin/env node
/** v502 S2：同图同seed序列同墙钟预算，A纯换seed vs B局部容量+换seed。 */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),crypto=require('crypto');
const ROOT=path.join(__dirname,'..','..'),BIN=path.join(ROOT,'02_工程','完整主bin快照_20261012','bin','js');
const FILES=['utils.js','color-libs.js','simulator.js','solver-strategy.js','solver.js','playersim.js','analysis.js','car-sequencer.js','solver-analysis.js','experience-goal.js','capacity-tuner.js','generator.js'];
const sb={console:{log(){},warn(){},error(){}},module:{exports:{}},WeakMap,Map,Set,Date,Math,JSON,setTimeout,clearTimeout,Infinity};vm.createContext(sb);for(const f of FILES)vm.runInContext(fs.readFileSync(path.join(BIN,f),'utf8'),sb,{filename:f});const A=sb.AntSolver,G=A.Generator;
function strOpt(n,d){const i=process.argv.indexOf('--'+n);return i>=0?process.argv[i+1]:d;}function numOpt(n,d){const i=process.argv.indexOf('--'+n);return i>=0?+process.argv[i+1]:d;}
const budgetMs=numOpt('budget',45000),perArmMs=numOpt('round',10000),tuneMs=numOpt('tune',5000),initialSeed=numOpt('seed',1001),outFile=strOpt('out',''),dumpDir=strOpt('dump-dir','');
const images=[{id:'006',file:'蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_006.txt'},{id:'010',file:'蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_010.txt'},{id:'007',file:'蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_007.txt'}];
function hash(x){return crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');}
function run(img,mode){
 const blocks=G.blocksFromTXT(fs.readFileSync(path.join(ROOT,img.file),'utf8')),band=G.deriveCapacityBand(blocks),t0=Date.now(),rounds=[];
 let best=null,bestEv=null,pass=false;
 while(Date.now()-t0<budgetMs&&!pass){
  const round=rounds.length,remaining=budgetMs-(Date.now()-t0),cfg={seed:(initialSeed+round*7919)>>>0,generatorFlow:'new_fixed',experienceGoal:true,
   boxSizeMin:band.band[0],boxSizeMax:band.band[1],capScalePlan:[1.45,1.15],cutMode:'layerCut2',candidateCount:3,timeBudgetMs:Math.max(1000,Math.min(perArmMs,remaining)),fullTime:true,portfolioK:1,
   acceptMode:'target',targetPeakMin:3.2,targetPeakMax:4.8,targetSteadyMin:0,targetSteadyMax:100,targetBand3Min:0,targetBand4Min:0,targetPlayerPassMin:.25,
   boardAllowSquare:true,boardRowsMin:4,boardRowsMax:6,boardColsMin:6,boardColsMax:8,boardHardRange:true,boardAuto:false,capacityTuneMs:Math.min(tuneMs,remaining),capacityTuneCars:8,capacityTuneVariants:48};
  const rt=Date.now();let r=null;try{r=G.produce(blocks,cfg);}catch(e){r={level:null,valid:false,lastFailReason:String(e&&e.message||e)};}
  const generateMs=Date.now()-rt,before=r&&r.level?A.ExperienceGoal.evaluate(r.level,{solveResult:r.solveResult,decision:false}):null;
  let tune=null;
  if(mode==='tune'&&r&&r.level&&r.valid){const tt=Date.now();try{r=G.tuneExperienceCandidate(r,cfg);}catch(e){r.capacityTune={applied:false,error:String(e&&e.message||e)};}tune={ms:Date.now()-tt,report:r.capacityTune||null};}
  const ev=r&&r.level?A.ExperienceGoal.evaluate(r.level,{solveResult:r.solveResult,decision:true}):null;
  const passed=!!(r&&r.level&&G.goalExperiencePass(r,cfg)),struct=!!(r&&r.level&&G.goalStructPass(r));
  const rec={round:round+1,seed:cfg.seed,generateMs,tuneMs:tune?tune.ms:0,totalMs:Date.now()-rt,valid:!!(r&&r.valid),struct,pass:passed,
   before:before&&before.metrics,after:ev&&ev.metrics,release:ev&&ev.releaseDecision&&ev.releaseDecision.status,
   tune:tune&&{applied:!!(tune.report&&tune.report.applied),tested:tune.report&&tune.report.tested,stopped:tune.report&&tune.report.stopped,skipped:tune.report&&tune.report.skipped},hash:r&&r.level?hash(r.level):null};
  rounds.push(rec);
  function better(x,xev,y,yev){if(!y)return true;if(!!x.pass!==!!y.pass)return x.pass;if(!!x.struct!==!!y.struct)return x.struct;return (xev&&xev.metrics?xev.metrics.distance:1e9)<(yev&&yev.metrics?yev.metrics.distance:1e9);}
  if(r&&r.level&&better(rec,ev,best,bestEv)){best=r;bestEv=ev;}
  if(passed){pass=true;best=r;bestEv=ev;break;}
 }
 const result={image:img.id,mode,budgetMs,elapsedMs:Date.now()-t0,pass,rounds,final:best&&best.level?{hash:hash(best.level),metrics:bestEv.metrics,struct:G.goalStructPass(best),valid:best.valid}:null};
 if(pass&&dumpDir){fs.mkdirSync(dumpDir,{recursive:true});fs.writeFileSync(path.join(dumpDir,img.id+'_'+mode+'.json'),JSON.stringify(best.level,null,2)+'\n');}
 console.log(JSON.stringify({image:img.id,mode,pass,elapsedMs:result.elapsedMs,rounds:rounds.length,final:result.final&&result.final.metrics}));return result;
}
const rows=[];for(const img of images){rows.push(run(img,'seed'));rows.push(run(img,'tune'));}
const pairs=images.map(img=>{const a=rows.find(x=>x.image===img.id&&x.mode==='seed'),b=rows.find(x=>x.image===img.id&&x.mode==='tune');return {image:img.id,seed:{pass:a.pass,ms:a.elapsedMs,rounds:a.rounds.length},tune:{pass:b.pass,ms:b.elapsedMs,rounds:b.rounds.length},deltaMs:b.elapsedMs-a.elapsedMs};});
const summary={runs:rows.length,seedPass:rows.filter(x=>x.mode==='seed'&&x.pass).length,tunePass:rows.filter(x=>x.mode==='tune'&&x.pass).length,
 seedTotalMs:rows.filter(x=>x.mode==='seed').reduce((n,x)=>n+x.elapsedMs,0),tuneTotalMs:rows.filter(x=>x.mode==='tune').reduce((n,x)=>n+x.elapsedMs,0)};
const report={schema:'experience-search-budget-ab-v1',config:{budgetMs,perArmMs,tuneMs,initialSeed},summary,pairs,rows};if(outFile)fs.writeFileSync(outFile,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({summary,pairs},null,2));
