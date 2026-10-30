#!/usr/bin/env node
/** v502 只读实验：目标体验评价 + 关键车±px同色守恒精调。
 * node 03_工具/好关评分/目标体验与容量精调.js <关或目录> --cap-min 31 --cap-max 58 --budget 30000 --out 报告.json
 */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const ROOT=path.join(__dirname,'..','..'),BIN=path.join(ROOT,'02_工程','游戏主bin','bin','js');
const FILES=['utils.js','color-libs.js','simulator.js','solver-strategy.js','solver.js','playersim.js','analysis.js','car-sequencer.js','solver-analysis.js','experience-goal.js','capacity-tuner.js','generator.js'];
const sb={console:{log(){},warn(){},error(){}},module:{exports:{}},WeakMap,Map,Set,Date,Math,JSON,setTimeout,clearTimeout,Infinity};vm.createContext(sb);
for(const f of FILES)vm.runInContext(fs.readFileSync(path.join(BIN,f),'utf8'),sb,{filename:f});
const A=sb.AntSolver,args=process.argv.slice(2),input=args[0];if(!input)throw new Error('需要关卡 JSON 或目录');
function opt(name,fallback){const i=args.indexOf('--'+name);return i>=0?+args[i+1]:fallback;}
function strOpt(name,fallback){const i=args.indexOf('--'+name);return i>=0?args[i+1]:fallback;}
const capMin=opt('cap-min',0),capMax=opt('cap-max',0);if(!(capMin>0&&capMax>=capMin))throw new Error('必须显式提供合法 --cap-min/--cap-max，防止越过用户容量边界');
const budget=opt('budget',30000),maxCars=opt('cars',4),maxVariants=opt('variants',24),outFile=strOpt('out','');
const dumpBest=strOpt('dump-best','');
const full=path.resolve(input),files=fs.statSync(full).isDirectory()?fs.readdirSync(full).filter(f=>f.endsWith('.json')).sort().map(f=>path.join(full,f)):[full];
function slim(ev){return {pass:ev.pass,curvePass:ev.curvePass,status:ev.status,reasons:ev.reasons,metrics:ev.metrics,releaseDecision:ev.releaseDecision,nearMiss:ev.nearMiss,elapsedMs:ev.elapsedMs};}
const rows=[];
let winningLevel=null;
for(const file of files){
  const raw=JSON.parse(fs.readFileSync(file,'utf8')),level=A.parseLevel(raw.spools?A.fromGameFormat(raw):raw),t0=Date.now();
  const sr=A.Solver.solve(level,{timeBudgetMs:3000}),base=A.ExperienceGoal.evaluate(level,{solveResult:sr,decision:true});
  const rec={file:path.relative(ROOT,file),capRange:[capMin,capMax],base:slim(base),tested:0,curveCandidates:0,variants:[],best:null,elapsedMs:0};
  let best={ev:base,meta:null};
  if(sr&&sr.completed&&!base.pass){
    const made=A.CapacityTuner.variants(level,sr,{capMin,capMax,maxCars,maxVariants});rec.keyCars=made.keyCars;
    for(const v of made.variants){
      if(Date.now()-t0>=budget){rec.stopped='budget_exhausted';break;}
      const vsr=A.Solver.solve(v.level,{timeBudgetMs:3000});
      const quick=A.ExperienceGoal.evaluate(v.level,{solveResult:vsr,decision:false});rec.tested++;
      const item={meta:v.meta,quick:slim(quick)};rec.variants.push(item);
      if(quick.curvePass){
        rec.curveCandidates++;
        const fullEv=A.ExperienceGoal.evaluate(v.level,{solveResult:vsr,decision:true});item.full=slim(fullEv);
        if(fullEv.pass){
          const ge=A.Generator.evaluateLevel(v.level,{}),q=ge&&ge.goodV3?A.Quality.fromGeneration({level:v.level,valid:true,goodV3:ge.goodV3}):null;
          const ca=A.Quality.capacityEvidence(v.level,{boxSizeMin:capMin,boxSizeMax:capMax});
          const baseCa=A.Quality.capacityEvidence(level,{boxSizeMin:capMin,boxSizeMax:capMax});
          const combined=!!(q&&q.gatePass&&ca.conserved&&ca.boardFloorPass&&ca.aboveMax===0&&ca.belowMin<=baseCa.belowMin);
          item.structure={gatePass:q&&q.gatePass,gateReasons:q&&q.gateReasons,capacity:ca,combinedPass:combined};
          if(combined){best={ev:fullEv,meta:v.meta};rec.best={meta:v.meta,result:slim(fullEv),structure:item.structure};rec.variantsWon=true;winningLevel=v.level;break;}
        }
        if(!best.ev.pass&&fullEv.metrics.distance<best.ev.metrics.distance)best={ev:fullEv,meta:v.meta};
      }else if(quick.metrics&&quick.metrics.distance<(best.ev.metrics?best.ev.metrics.distance:1e9))best={ev:quick,meta:v.meta};
    }
  }
  if(!rec.best&&best.meta)rec.best={meta:best.meta,result:slim(best.ev)};
  rec.elapsedMs=Date.now()-t0;rows.push(rec);
  console.log(JSON.stringify({file:rec.file,basePass:rec.base.pass,base34:rec.base.metrics&&rec.base.metrics.midBuffer34Pct,baseRelease:rec.base.releaseDecision&&rec.base.releaseDecision.status,tested:rec.tested,curveCandidates:rec.curveCandidates,won:!!rec.variantsWon,ms:rec.elapsedMs}));
}
const summary={levels:rows.length,basePass:rows.filter(r=>r.base.pass).length,variantsWon:rows.filter(r=>r.variantsWon).length,
  variantsTested:rows.reduce((n,r)=>n+r.tested,0),totalMs:rows.reduce((n,r)=>n+r.elapsedMs,0)};
const report={schema:'experience-capacity-tuning-v1',config:{capMin,capMax,budget,maxCars,maxVariants},summary,rows};
if(dumpBest&&winningLevel)fs.writeFileSync(dumpBest,JSON.stringify(winningLevel,null,2)+'\n');
if(outFile)fs.writeFileSync(outFile,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(summary,null,2));
