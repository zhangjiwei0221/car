#!/usr/bin/env node
/** v504：读取目标搜索A/B JSON，按结构/远近/释放/顶格/末段分类，不重跑生成。 */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const ROOT=path.join(__dirname,'..','..'),BIN=path.join(ROOT,'02_工程','完整主bin快照_20261012','bin','js');
const files=['utils.js','color-libs.js','simulator.js','solver-strategy.js','solver.js','playersim.js','analysis.js','car-sequencer.js','solver-analysis.js','experience-goal.js'];
const sb={console:{log(){},warn(){},error(){}},WeakMap,Map,Set,Date,Math,JSON};vm.createContext(sb);for(const f of files)vm.runInContext(fs.readFileSync(path.join(BIN,f),'utf8'),sb,{filename:f});const A=sb.AntSolver;
const args=process.argv.slice(2),oi=args.indexOf('--out'),outFile=oi>=0?args[oi+1]:'';
const inputs=args.filter((x,i)=>!x.startsWith('--')&&(i===0||args[i-1]!=='--out'));if(!inputs.length)throw new Error('需要目标搜索JSON');
const rows=[];
for(const input of inputs){const report=JSON.parse(fs.readFileSync(input,'utf8'));for(const run of report.rows||[])for(const q of run.rounds||[]){if(q.pass)continue;
 const ev={pass:false,metrics:q.after||{},releaseDecision:{status:q.release||'not_evaluated'},target:{minBuffer34Pct:50}};
 const diagnosis=A.ExperienceGoal.diagnose(ev,q.struct);rows.push({image:run.image,mode:run.mode,seed:q.seed,round:q.round,struct:q.struct,metrics:q.after,release:q.release,tune:q.tune,diagnosis});
}}
const uniqueMap={};for(const r of rows){const k=r.image+'/'+r.seed+'/r'+r.round;if(!uniqueMap[k])uniqueMap[k]=r;}
const unique=Object.keys(uniqueMap).map(k=>uniqueMap[k]);
function counts(key){const out={};for(const r of unique){const k=r.diagnosis[key];out[k]=(out[k]||0)+1;}return out;}
const flags={};for(const r of unique)for(const f of r.diagnosis.flags)flags[f]=(flags[f]||0)+1;
const byImage={};for(const r of unique){const x=byImage[r.image]||(byImage[r.image]={failedBases:0,primary:{},actions:{}});x.failedBases++;x.primary[r.diagnosis.primary]=(x.primary[r.diagnosis.primary]||0)+1;x.actions[r.diagnosis.action]=(x.actions[r.diagnosis.action]||0)+1;}
const report={schema:'experience-failure-diagnosis-v1',summary:{failedRoundObservations:rows.length,uniqueFailedBases:unique.length,primary:counts('primary'),actions:counts('action'),flags,byImage},rows,uniqueKeys:Object.keys(uniqueMap)};
if(outFile)fs.writeFileSync(outFile,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report.summary,null,2));
