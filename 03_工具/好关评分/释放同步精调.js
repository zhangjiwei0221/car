#!/usr/bin/env node
/** v505 只读：release-sync候选 → 重解 → 目标/结构/容量复核。 */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');const ROOT=path.join(__dirname,'..','..'),BIN=path.join(ROOT,'02_工程','游戏主bin','bin','js');
const files=['utils.js','color-libs.js','simulator.js','solver-strategy.js','solver.js','playersim.js','analysis.js','car-sequencer.js','solver-analysis.js','experience-goal.js','capacity-tuner.js','release-tuner.js','generator.js'];
const sb={console:{log(){},warn(){},error(){}},module:{exports:{}},WeakMap,Map,Set,Date,Math,JSON};vm.createContext(sb);for(const f of files)vm.runInContext(fs.readFileSync(path.join(BIN,f),'utf8'),sb,{filename:f});const A=sb.AntSolver;
const args=process.argv.slice(2),file=args[0];function opt(n,d){const i=args.indexOf('--'+n);return i>=0?+args[i+1]:d;}function str(n,d){const i=args.indexOf('--'+n);return i>=0?args[i+1]:d;}if(!file)throw new Error('需要关卡');
const capMin=opt('cap-min',0),capMax=opt('cap-max',0),out=str('out',''),dump=str('dump-best','');if(!(capMin>0&&capMax>=capMin))throw new Error('需要容量上下界');
const raw=JSON.parse(fs.readFileSync(file,'utf8')),level=A.parseLevel(raw.spools?A.fromGameFormat(raw):raw),sr=A.Solver.solve(level),base=A.ExperienceGoal.evaluate(level,{solveResult:sr,decision:true});
const made=A.ReleaseTuner.variants(level,sr,{capMin,capMax,maxDelta:opt('max-delta',4),maxVariants:opt('variants',12)}),rec={file,capRange:[capMin,capMax],base:{pass:base.pass,metrics:base.metrics,release:base.releaseDecision.status},reason:made.reason,variants:[]};let win=null;
for(const v of made.variants){const vsr=A.Solver.solve(v.level),quick=A.ExperienceGoal.evaluate(v.level,{solveResult:vsr,decision:false}),item={meta:v.meta,quick:{curvePass:quick.curvePass,metrics:quick.metrics}};rec.variants.push(item);
 if(quick.curvePass){const full=A.ExperienceGoal.evaluate(v.level,{solveResult:vsr,decision:true}),ge=A.Generator.evaluateLevel(v.level,{}),q=A.Quality.fromGeneration({level:v.level,valid:ge.valid,goodV3:ge.goodV3}),ca=A.Quality.capacityEvidence(v.level,{boxSizeMin:capMin,boxSizeMax:capMax});item.full={pass:full.pass,metrics:full.metrics,release:full.releaseDecision.status,struct:q.gatePass,capacity:ca};if(full.pass&&q.gatePass&&ca.conserved&&ca.boardFloorPass&&ca.aboveMax===0){win={level:v.level,item};break;}}}
rec.won=!!win;if(win&&dump)fs.writeFileSync(dump,JSON.stringify(win.level,null,2)+'\n');if(out)fs.writeFileSync(out,JSON.stringify(rec,null,2)+'\n');console.log(JSON.stringify({base:rec.base,candidates:rec.variants.length,won:rec.won,best:win&&win.item},null,2));
