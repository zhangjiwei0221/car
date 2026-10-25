#!/usr/bin/env node
/** v514预实验：真实失败关上的现有P7部件对照；只在VM导出内部函数，不改生产。 */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),crypto=require('crypto');
const ROOT=path.join(__dirname,'..','..'),BIN=path.join(ROOT,'02_工程','完整主bin快照_20261012','bin','js');
const FILES=['utils.js','color-libs.js','simulator.js','solver-strategy.js','solver.js','playersim.js','analysis.js','car-sequencer.js','solver-analysis.js','experience-goal.js','capacity-tuner.js'];
function opt(n,d){const i=process.argv.indexOf('--'+n);return i>=0?process.argv[i+1]:d;}const out=opt('out',''),only=opt('levels','').split(',').filter(Boolean);
let gs=fs.readFileSync(path.join(BIN,'generator.js'),'utf8');
gs=gs.replace('p7RepairLevel: p7RepairLevel, goalStructPass:', 'p7RepairLevel: p7RepairLevel, p7BreakFreeRun: p7BreakFreeRun, p7EarlyPressure: p7EarlyPressure, p7SupplyStructure: p7SupplyStructure, goalStructPass:');
const sb={console:{log(){},warn(){},error(){}},module:{exports:{}},WeakMap,Map,Set,Date,Math,JSON,setTimeout,clearTimeout,Infinity};vm.createContext(sb);for(const f of FILES)vm.runInContext(fs.readFileSync(path.join(BIN,f),'utf8'),sb,{filename:f});vm.runInContext(gs,sb,{filename:'generator-instrumented.js'});const A=sb.AntSolver,G=A.Generator;
const samples=[
 {id:'v512-006',batch:'unnamed-10-26-8',file:'不合格关卡/35x35拼接图纸_006__超时兜底.json'},
 {id:'v512-007',batch:'unnamed-10-26-8',file:'不合格关卡/35x35拼接图纸_007__遍历兜底.json'},
 {id:'v513mid-006',batch:'unnamed-10-26-10',file:'不合格关卡/35x35拼接图纸_006__超时兜底.json'},
 {id:'v513mid-007',batch:'unnamed-10-26-10',file:'不合格关卡/35x35拼接图纸_007__超时兜底.json'},
 {id:'v513final-007',batch:'unnamed-10-26-12',file:'不合格关卡/35x35拼接图纸_007__目标未达·结构门未过.json'},
 {id:'protect-006',batch:'unnamed-10-26-12',file:'不合格关卡/35x35拼接图纸_006__目标未达·到时最好.json',protect:true}
];
function hash(x){return crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');}
function cand(level,ev,cfg){return {level,valid:!!(ev&&ev.valid),solveResult:ev&&ev.solveResult,audit:ev&&ev.audit,goodV3:ev&&ev.goodV3,config:cfg};}
function metrics(c){const fc=c.goodV3&&c.goodV3.fillCurve||{},p=c.goodV3&&c.goodV3.goodV3&&c.goodV3.persist||{};return {struct:G.goalStructPass(c),freeLowPct:fc.freeLowPct,freeRunMax:fc.freeRunMax,selectMedian:fc.selectMedian,fullMedian2:fc.fullMedian2,pressurePct3:fc.pressurePct3};}
function runSample(s){const file=path.join(ROOT,'02_工程','完整主bin快照_20261012','输出文件',s.batch,s.file),raw=JSON.parse(fs.readFileSync(file,'utf8'));
 const level=A.parseLevel(A.fromGameFormat(raw)),blocks=level.blocks,band=G.deriveCapacityBand(blocks),cfg=Object.assign({},G.DEFAULT_CONFIG,{trapEvalMs:1500,bottomOnly:false,instantChain:false,boxSizeMin:band.band[0],boxSizeMax:band.band[1]});
 const t0=Date.now(),ev0=G.evaluateLevel(level,cfg),base=cand(level,ev0,cfg),rec={id:s.id,batch:s.batch,file:s.file,protect:!!s.protect,baseHash:hash(level),base:metrics(base),variants:[]};
 if(!ev0){rec.error='base evaluateLevel null';return rec;}
 if(s.protect){rec.note='已结构通过，按预登记不运行结构修复';return rec;}
 const methods=[['breakFreeRun','p7BreakFreeRun'],['earlyPressure','p7EarlyPressure'],['supplyStructure','p7SupplyStructure'],['fullP7','p7RepairLevel']];
 for(const [name,fn] of methods){const t=Date.now();let rep=null,err=null;try{rep=G[fn](level,cfg,ev0);}catch(e){err=String(e&&e.message||e);}const repairMs=Date.now()-t,v={method:name,repairMs,hasVariant:!!(rep&&rep.level),error:err};
  if(rep&&rep.level){const ev=G.evaluateLevel(rep.level,cfg),cc=cand(rep.level,ev,cfg);v.after=metrics(cc);v.hash=hash(rep.level);v.capacity=A.Quality&&A.Quality.capacityEvidence?A.Quality.capacityEvidence(rep.level,cfg):null;
   if(cc.valid&&v.after.struct){const q=A.ExperienceGoal.evaluate(rep.level,{solveResult:cc.solveResult,decision:false});v.experienceQuick=q&&{pass:q.pass,nearMiss:q.nearMiss,metrics:q.metrics,diagnosis:q.diagnosis};
    const full=A.ExperienceGoal.evaluate(rep.level,{solveResult:cc.solveResult,decision:true});v.experienceFull=full&&{pass:full.pass,status:full.status,reasons:full.reasons,metrics:full.metrics,release:full.releaseDecision&&full.releaseDecision.status};
   }
  }
  v.totalMs=Date.now()-t;rec.variants.push(v);console.log(JSON.stringify({id:s.id,method:name,ms:v.totalMs,hasVariant:v.hasVariant,before:rec.base,after:v.after||null,experience:v.experienceFull&&v.experienceFull.pass}));
 }
 rec.totalMs=Date.now()-t0;return rec;
}
const rows=[];for(const s of samples){if(only.length&&!only.includes(s.id))continue;rows.push(runSample(s));}
const attempts=rows.flatMap(r=>r.variants.map(v=>({id:r.id,...v}))),summary={samples:rows.length,variants:attempts.length,structConversions:attempts.filter(v=>v.after&&v.after.struct&&!v.after.error).length,fullTargetPasses:attempts.filter(v=>v.experienceFull&&v.experienceFull.pass).length,
 byMethod:Object.fromEntries(['breakFreeRun','earlyPressure','supplyStructure','fullP7'].map(m=>{const a=attempts.filter(v=>v.method===m);return [m,{variants:a.filter(v=>v.hasVariant).length,structPass:a.filter(v=>v.after&&v.after.struct).length,targetPass:a.filter(v=>v.experienceFull&&v.experienceFull.pass).length,totalMs:a.reduce((n,v)=>n+v.totalMs,0)}];}))};
const report={schema:'structure-repair-parts-ab-v1',date:'2026-10-26',note:'真实失败关、每部件独立从原关开始；VM只读导出，未接生产。',summary,rows};if(out)fs.writeFileSync(path.resolve(ROOT,out),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(summary,null,2));
