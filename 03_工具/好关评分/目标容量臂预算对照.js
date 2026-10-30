#!/usr/bin/env node
/** v513预实验：同图同seed同produceGoal总预算，旧容量臂各自计时 vs 新容量臂共享计时。 */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),crypto=require('crypto'),cp=require('child_process');
const ROOT=path.join(__dirname,'..','..'),BIN=path.join(ROOT,'02_工程','游戏主bin','bin','js');
const FILES=['utils.js','color-libs.js','simulator.js','solver-strategy.js','solver.js','playersim.js','analysis.js','car-sequencer.js','solver-analysis.js','experience-goal.js','capacity-tuner.js'];
function opt(n,d){const i=process.argv.indexOf('--'+n);return i>=0?process.argv[i+1]:d;}function num(n,d){return +opt(n,d);}
const budgetMs=num('budget',60000),roundMs=num('round',20000),seed=num('seed',1001),out=opt('out',''),sharedBoth=opt('shared-both','0')==='1';
const candidatePath=opt('candidate','/tmp/generator_v513_candidate.js');
const rel='02_工程/游戏主bin/bin/js/generator.js';
const baselineSource=cp.execFileSync('git',['show','HEAD:'+rel],{cwd:ROOT,encoding:'utf8',maxBuffer:32*1024*1024});
const candidateSource=fs.readFileSync(path.resolve(ROOT,candidatePath),'utf8');
function load(source){const sb={console:{log(){},warn(){},error(){}},module:{exports:{}},WeakMap,Map,Set,Date,Math,JSON,setTimeout,clearTimeout,Infinity};vm.createContext(sb);for(const f of FILES)vm.runInContext(fs.readFileSync(path.join(BIN,f),'utf8'),sb,{filename:f});vm.runInContext(source,sb,{filename:'generator-under-test.js'});return sb.AntSolver;}
const oldA=load(baselineSource),newA=load(candidateSource);
const ids=opt('images','006,007,010').split(',').filter(Boolean);
function txt(id){return path.join(ROOT,'蚂蚁图库','拼接图','拼接图图库','35x35拼接图纸_'+id+'.txt');}
function hash(x){return crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');}
function run(A,id,arm){const G=A.Generator,blocks=G.blocksFromTXT(fs.readFileSync(txt(id),'utf8')),band=G.deriveCapacityBand(blocks),t0=Date.now();
 const cfg={seed,goalPerRoundMs:roundMs,goalMaxMs:budgetMs,goalMaxRounds:0,goalSharedBudget:sharedBoth||arm==='shared',experienceGoal:true,
  generatorFlow:'new_fixed',boxSizeMin:band.band[0],boxSizeMax:band.band[1],capNormMin:band.band[0],capNormMax:band.band[1],capScalePlan:[1.45,1.15],cutMode:'layerCut2',candidateCount:3,fullTime:true,portfolioK:1,
  acceptMode:'target',targetPeakMin:3.2,targetPeakMax:4.8,targetSteadyMin:0,targetSteadyMax:100,targetBand3Min:0,targetBand4Min:0,targetPlayerPassMin:.25,
  boardAllowSquare:true,boardRowsMin:6,boardRowsMax:9,boardColsMin:6,boardColsMax:11,boardHardRange:true,boardAuto:false,capacityTuneMs:5000,capacityTuneCars:8,capacityTuneVariants:48};
 let r;try{r=G.produceGoal(blocks,cfg);}catch(e){r={level:null,valid:false,error:String(e&&e.message||e)};}
 const wallMs=Date.now()-t0,ev=r&&r.level?A.ExperienceGoal.evaluate(r.level,{solveResult:r.solveResult,decision:false}):null;
 const rec={image:id,arm,seed,budgetMs,roundMs,wallMs,overrunMs:Math.max(0,wallMs-budgetMs),rounds:r&&r.goalRounds||0,goalElapsedMs:r&&r.goalElapsedMs||null,stop:r&&r.goalStopReason||null,
  valid:!!(r&&r.valid),struct:!!(r&&r.level&&G.goalStructPass(r)),pass:!!(r&&r.level&&G.goalExperiencePass(r,cfg)),distance:ev&&ev.metrics?ev.metrics.distance:null,midBuffer34Pct:ev&&ev.metrics?ev.metrics.midBuffer34Pct:null,
  release:ev&&ev.releaseDecision?ev.releaseDecision.status:null,tune:r&&r.capacityTune?{applied:!!r.capacityTune.applied,tested:r.capacityTune.tested,skipped:r.capacityTune.skipped}:null,
  board:r&&r.level&&r.level.board?{rows:r.level.board.rows,cols:r.level.board.cols}:null,
  capacity:r&&r.level?A.Quality.capacityEvidence(r.level,r.config||cfg):null,hash:r&&r.level?hash(r.level):null};
 console.log(JSON.stringify(rec));return rec;
}
const rows=[];for(const id of ids){rows.push(run(oldA,id,'legacy_per_arm'));rows.push(run(newA,id,'shared'));}
const pairs=ids.map(id=>{const a=rows.find(x=>x.image===id&&x.arm==='legacy_per_arm'),b=rows.find(x=>x.image===id&&x.arm==='shared');return {image:id,pass:[a.pass,b.pass],struct:[a.struct,b.struct],wallMs:[a.wallMs,b.wallMs],overrunMs:[a.overrunMs,b.overrunMs],rounds:[a.rounds,b.rounds],distance:[a.distance,b.distance],midBuffer34Pct:[a.midBuffer34Pct,b.midBuffer34Pct]};});
const summary={runs:rows.length,pass:Object.fromEntries(['legacy_per_arm','shared'].map(a=>[a,rows.filter(x=>x.arm===a&&x.pass).length])),struct:Object.fromEntries(['legacy_per_arm','shared'].map(a=>[a,rows.filter(x=>x.arm===a&&x.struct).length])),wallTotalMs:Object.fromEntries(['legacy_per_arm','shared'].map(a=>[a,rows.filter(x=>x.arm===a).reduce((n,x)=>n+x.wallMs,0)])),overrunTotalMs:Object.fromEntries(['legacy_per_arm','shared'].map(a=>[a,rows.filter(x=>x.arm===a).reduce((n,x)=>n+x.overrunMs,0)]))};
const report={schema:'goal-cap-budget-shared-ab-v1',config:{budgetMs,roundMs,seed,images:ids,candidatePath,sharedBoth},note:'A/B同总预算同初始seed；shared是实验候选，不是生产默认。墙钟包含最终路线证据，goalElapsed不含。',summary,pairs,rows};if(out)fs.writeFileSync(path.resolve(ROOT,out),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({summary,pairs},null,2));
