#!/usr/bin/env node
/* 验证：通道模式 off vs on，同一张目标图、同一套参数，各跑 N 次，比 band3。
   只读（不改生产代码）。用法：node 验证_通道模式.js <关卡json> [--runs 5] */
'use strict';
const vm = require('vm'), fs = require('fs'), path = require('path');
const BASE = path.join(__dirname, '..', '..', '02_工程', '完整主bin快照_20261012');
const FILES = ['utils.js','color-libs.js','simulator.js','solver-strategy.js','solver.js','playersim.js','analysis.js','generator.js'];
const sandbox = { console:{log(){},warn(){},error(){}}, module:{exports:{}}, WeakMap, Map, Set, setTimeout, clearTimeout, Infinity, Math, JSON, Date };
vm.createContext(sandbox);
for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BASE,'bin/js',f),'utf8'), sandbox, {filename:f});
const A = sandbox.AntSolver, G = A.Generator;

const file = process.argv[2];
const ri = process.argv.indexOf('--runs'); const RUNS = ri>0 ? (parseInt(process.argv[ri+1],10)||5) : 5;
const j = JSON.parse(fs.readFileSync(file,'utf8'));
const blocks = j.blocks;
const cfg0 = { boxSizeMin:30, boxSizeMax:60, blackPercent:13, icePercent:18, chainCount:4,
  boardRowsMin:4, boardRowsMax:7, boardColsMin:6, boardColsMax:9, bufferLimit:5,
  generatorFlow:'old', targetCarCount:0 };

function band3(res){
  const ps=(res.pressureSamples||[]), tb=res.totalBoxes||0;
  let tot=0,ge=0,pk=0;
  for(const s of ps){const pr=tb?s.done/tb:0; if(pr<0.3||pr>0.8)continue; tot++; if(s.buf>=3)ge++; if(s.buf>pk)pk=s.buf;}
  return {band3: tot?Math.round(ge/tot*100):null, peak:pk};
}
function run(cfg, i){
  const c = Object.assign({}, cfg0, cfg, { seed: 1000 + i });
  let out=null;
  try { out = G.generateFromBlocks(blocks, c); } catch(e){ return {err:String(e&&e.message)}; }
  if(!out || !out.solveResult) return {err:'no solve'};
  const b = band3(out.solveResult);
  return { solved: !!out.solveResult.completed, band3:b.band3, peak:b.peak,
           cars: out.level && out.level.board ? out.level.board.cells.flat().filter(x=>x&&x.t==='box').length : null,
           rows: out.level && out.level.board ? out.level.board.rows : null, cols: out.level && out.level.board ? out.level.board.cols : null };
}
function group(name, cfg){
  const rows=[];
  for(let i=0;i<RUNS;i++) rows.push(run(cfg,i));
  const ok=rows.filter(r=>!r.err);
  const b3=ok.map(r=>r.band3).filter(x=>x!=null);
  const mean=b3.length?b3.reduce((a,b)=>a+b,0)/b3.length:null;
  const sd=b3.length>1?Math.sqrt(b3.reduce((a,b)=>a+(b-mean)*(b-mean),0)/(b3.length-1)):0;
  console.log('  '+name.padEnd(16)+' 可解 '+ok.filter(r=>r.solved).length+'/'+RUNS+
    '  band3 均值 '+(mean==null?'-':mean.toFixed(1))+'  sd '+sd.toFixed(1)+
    '  峰值 '+(b3.length?Math.max.apply(null,b3):'-')+
    '  盘 '+(ok[0]?(ok[0].rows+'x'+ok[0].cols):'-')+'  车 '+(ok[0]?ok[0].cars:'-'));
  return {mean,sd,b3};
}
console.log('图：'+path.basename(file)+'　跑 '+RUNS+' 次/组');
console.log('');
const off = group('通道 off', {});
const on1 = group('通道 on (入口0,k0)', {channelMode:true, channelEntryCol:0, channelK:0});
const on3 = group('通道 on (入口0,k3)', {channelMode:true, channelEntryCol:0, channelK:3});
const lc = group('层切 on', {cutMode:'layerCut2'});
const lcCh = group('层切+通道', {cutMode:'layerCut2', channelMode:true, channelEntryCol:0, channelK:0});
function paired(name, a, b){
  const d=[];
  for(let i=0;i<Math.min(a.b3.length,b.b3.length);i++) if(a.b3[i]!=null&&b.b3[i]!=null) d.push(b.b3[i]-a.b3[i]);
  if(!d.length){ console.log('  '+name+' 无配对'); return; }
  const mean=d.reduce((x,y)=>x+y,0)/d.length;
  const win=d.filter(x=>x>0).length, lose=d.filter(x=>x<0).length, tie=d.filter(x=>x===0).length;
  console.log('  '+name.padEnd(20)+' 配对差均值 '+mean.toFixed(1)+'  胜/负/平 '+win+'/'+lose+'/'+tie+'  ('+d.join(',')+')');
}
console.log('');
console.log('配对对比（同一 seed 下，正值=变好）：');
paired('层切 − off', off, lc);
paired('通道 − off', off, on1);
paired('层切+通道 − off', off, lcCh);
