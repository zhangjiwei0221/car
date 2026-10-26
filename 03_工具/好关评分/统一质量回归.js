#!/usr/bin/env node
/**
 * v480 统一质量口径回归：用输出文件中的真关卡比较 v479 旧公式与 AntSolver.Quality。
 * 在仓库根目录运行：node 03_工具/好关评分/统一质量回归.js > /tmp/quality-regression.json
 * 旧公式只用于回归，不再参与生产；任何有意调阈值都必须同步更新基准与日志。
 */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const ROOT=process.cwd();
const BASE=path.join(ROOT,'02_工程/完整主bin快照_20261012');
const FILES=['utils.js','color-libs.js','simulator.js','solver-strategy.js','solver.js','playersim.js','analysis.js','generator.js'];
const sandbox={console:{log(){},warn(){},error(){}},module:{exports:{}},WeakMap,Map,Set,setTimeout,clearTimeout,Infinity,Math,JSON};
vm.createContext(sandbox);for(const f of FILES)vm.runInContext(fs.readFileSync(path.join(BASE,'bin/js',f),'utf8'),sandbox,{filename:f});
const A=sandbox.AntSolver;
function legacyVerdict(o){
  var r=[];if(!o||!o.level)return{pass:false,label:'无关卡',reasons:['无关卡']};if(!o.valid)return{pass:false,label:'不可解',reasons:['全知未通关']};
  if(o.learned==null)r.push('学会后未测');else if(o.learned<55)r.push('学会后'+o.learned+'%<55%（学不会）');else if(o.learned>85)r.push('学会后'+o.learned+'%>85%（一学就会）');
  if(o.look==null)r.push('前瞻未测');else if(o.look<40)r.push('前瞻'+o.look+'%<40%（偏黑）');else if(o.look>85)r.push('前瞻'+o.look+'%>85%（一眼看穿）');
  if(o.wMed==null)r.push('W未测');if(o.selectMed==null)r.push('可选项中位未测');else if(o.selectMed<2)r.push('可选中位'+o.selectMed+'<2（被迫单线）');
  if(o.forcedPct!=null&&o.forcedPct>20)r.push('被迫步'+o.forcedPct+'%>20%');if(o.fullMed2!=null&&o.fullMed2>2)r.push('吃满中位'+o.fullMed2+'>2（太白给）');
  if(o.t==null)r.push('T未测');else if(o.t<10)r.push('T陷阱'+o.t+'%<10%（没压力）');if(o.r==null)r.push('R未测');else if(o.r<15)r.push('R后悔'+o.r+'pp<15（没岔路）');
  if(o.hidden!=null&&o.hidden>20)r.push('隐藏信息死亡'+o.hidden+'%>20%');if(o.freePct!=null&&o.freePct>50)r.push('免费步'+o.freePct+'%>50%');
  if(o.freeRunMax!=null&&o.freeRunMax>5)r.push('最长免费连'+o.freeRunMax+'步>5');if(o.partialStepPct!=null&&o.partialStepPct<20)r.push('partial步'+o.partialStepPct+'%<20');
  var pass=r.length===0,g=[];if(o.hidden!=null&&o.hidden>20)g.push('J '+o.hidden+'%>20%');if(o.selectMed!=null&&o.selectMed<2)g.push('可选中位 '+o.selectMed+'<2');
  if(o.forcedPct!=null&&o.forcedPct>20)g.push('被迫步 '+o.forcedPct+'%>20%');if(o.partialStepPct!=null&&o.partialStepPct<20)g.push('partial步 '+o.partialStepPct+'%<20');
  if(o.fullMed2!=null&&o.fullMed2>3)g.push('吃满中位 '+o.fullMed2+'>3');if(o.freeLowPct!=null&&o.freeLowPct>30)g.push('freeLow '+o.freeLowPct+'%>30%');
  if(o.freeRunMax!=null&&o.freeRunMax>6)g.push('最长免费连 '+o.freeRunMax+'>6');var gatePass=g.length===0;
  var label=pass?'合格':(o.learned!=null&&o.learned>85)?'可玩·一学就会':(o.look!=null&&o.look>85)?'可玩·偏透':(o.t!=null&&o.t<10)?'可玩·没压力':(o.r!=null&&o.r<15)?'可玩·没岔路':(o.selectMed!=null&&o.selectMed<2)?'可玩·被迫单线':(o.hidden!=null&&o.hidden>20)?'可玩·偏黑':'可玩·待评';
  return{pass,gatePass,gateReasons:g,label,reasons:r};
}
function legacyGoal(r){
  if(!r||!r.level||!r.valid)return false;var p=r.goodV3&&r.goodV3.persist,fc=r.goodV3&&r.goodV3.fillCurve;if(!p||!fc)return false;
  var dc=p.deathCauses||{},dt=0,dh=0;for(var k in dc){dt+=dc[k];if(k==='管道'||k==='问号')dh+=dc[k];}var J=dt?Math.round(dh/dt*100):0;
  if(J>20)return false;if(fc.selectMedian!=null&&fc.selectMedian<2)return false;if(fc.forcedPct!=null&&fc.forcedPct>20)return false;
  if(fc.partialStepPct!=null&&fc.partialStepPct<20)return false;if(fc.fullMedian2!=null&&fc.fullMedian2>3)return false;
  if(fc.freeLowPct!=null&&fc.freeLowPct>30)return false;if(fc.freeRunMax!=null&&fc.freeRunMax>6)return false;return true;
}
function inputOf(x){
  const g=x.goodV3||(x.generationEval&&x.generationEval.goodV3)||{},p=g.persist||{},fc=g.fillCurve||{},q=p.quality||{},dc=p.deathCauses||{};let dt=0,dh=0;
  for(const k in dc){dt+=dc[k];if(k==='管道'||k==='问号')dh+=dc[k];}
  return{valid:!!x.valid,level:x.level||x,learned:p.learnedPassPct==null?null:p.learnedPassPct,look:p.lookaheadPassPct==null?null:p.lookaheadPassPct,
    wMed:fc.medFull==null?null:fc.medFull,selectMed:fc.selectMedian==null?null:fc.selectMedian,forcedPct:fc.forcedPct==null?null:fc.forcedPct,
    fullMed2:fc.fullMedian2==null?null:fc.fullMedian2,t:q.T==null?null:q.T,r:q.R==null?null:q.R,hidden:dt?Math.round(dh/dt*100):null,
    freePct:fc.freePct==null?null:fc.freePct,freeRunMax:fc.freeRunMax==null?null:fc.freeRunMax,freeLowPct:fc.freeLowPct==null?null:fc.freeLowPct,
    partialStepPct:fc.partialStepPct==null?null:fc.partialStepPct};
}
const dir=path.join(BASE,'输出文件'),files=[];
const fileListArg=process.argv.indexOf('--file-list'),fileListReport=fileListArg>=0?process.argv[fileListArg+1]:null;
for(const batch of fs.readdirSync(dir)){const d=path.join(dir,batch,'生产文档/关卡数据');if(!fs.existsSync(d))continue;for(const f of fs.readdirSync(d))if(f.endsWith('.json'))files.push(path.join(d,f));}
files.sort();const selected=fileListReport?JSON.parse(fs.readFileSync(path.resolve(ROOT,fileListReport),'utf8')).rows.map(x=>path.join(ROOT,x.file)):files.slice(-20);const rows=selected.map(file=>{const x=JSON.parse(fs.readFileSync(file,'utf8')),o=inputOf(x),oldApp=legacyVerdict(o),genInput={level:x,valid:x.valid,goodV3:x.goodV3||(x.generationEval&&x.generationEval.goodV3)},oldGen=legacyGoal(genInput);
  const sharedApp=A.Quality?A.Quality.verdict(o):null,sharedGen=A.Quality?A.Quality.fromGeneration(x).gatePass:null;
  return{file:path.relative(ROOT,file),boardBelow6:!!(x.board&&(x.board.rows<6||x.board.cols<6)),oldGen,oldApp,sharedGen,sharedApp,storedGate:x.qGatePass==null?null:x.qGatePass};});
const out={count:rows.length,fileListReport:fileListReport||null,oldGatePass:rows.filter(x=>x.oldGen).length,oldQPass:rows.filter(x=>x.oldApp.pass).length,sharedGatePass:rows.filter(x=>x.sharedGen).length,
  genMismatch:rows.filter(x=>!x.boardBelow6&&x.sharedGen!=null&&x.sharedGen!==x.oldGen).length,appMismatch:rows.filter(x=>!x.boardBelow6&&x.sharedApp&&JSON.stringify(x.sharedApp)!==JSON.stringify(x.oldApp)).length,boardFloorChanges:rows.filter(x=>x.boardBelow6&&(x.sharedGen!==x.oldGen||JSON.stringify(x.sharedApp)!==JSON.stringify(x.oldApp))).length,
  storedGateMismatch:rows.filter(x=>x.storedGate!=null&&x.storedGate!==x.oldGen).length,rows};
console.log(JSON.stringify(out,null,2));
if(out.genMismatch||out.appMismatch)process.exitCode=1;
