#!/usr/bin/env node
/* G1：层切 + 按到期配冰，配对验证（同一 seed 下比较）。
   只读。用法：node 验证_按到期配冰.js <关卡json> [--runs 10] */
'use strict';
const vm = require('vm'), fs = require('fs'), path = require('path');
const BASE = path.join(__dirname, '..', '..', '02_工程', '完整主bin快照_20261012');
const FILES = ['utils.js','color-libs.js','simulator.js','solver-strategy.js','solver.js','playersim.js','analysis.js','generator.js'];
const sandbox = { console:{log(){},warn(){},error(){}}, module:{exports:{}}, WeakMap, Map, Set, setTimeout, clearTimeout, Infinity, Math, JSON, Date };
vm.createContext(sandbox);
for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BASE,'bin/js',f),'utf8'), sandbox, {filename:f});
const A = sandbox.AntSolver, G = A.Generator;

const file = process.argv[2];
const ri = process.argv.indexOf('--runs'); const RUNS = ri>0 ? (parseInt(process.argv[ri+1],10)||10) : 10;
const j = JSON.parse(fs.readFileSync(file,'utf8'));
const blocks = j.blocks;
const cfg0 = { boxSizeMin:30, boxSizeMax:60, blackPercent:13, icePercent:0, chainCount:4,
  boardRowsMin:4, boardRowsMax:7, boardColsMin:6, boardColsMax:9, bufferLimit:5,
  generatorFlow:'old', targetCarCount:0 };

function band3(res){
  const ps=(res.pressureSamples||[]), tb=res.totalBoxes||0;
  let tot=0,ge=0,pk=0;
  for(const s of ps){const pr=tb?s.done/tb:0; if(pr<0.3||pr>0.8)continue; tot++; if(s.buf>=3)ge++; if(s.buf>pk)pk=s.buf;}
  return {band3: tot?Math.round(ge/tot*100):null, peak:pk};
}
function run(cfg, i){
  const c = Object.assign({}, cfg0, cfg, { seed: 1000 + i, _seedOnce: true });
  let out=null;
  try { out = G.generateFromBlocks(blocks, c); } catch(e){ return {err:String(e&&e.message)}; }
  if(!out || !out.solveResult) return {err:'no solve'};
  const b = band3(out.solveResult);
  return { solved: !!out.solveResult.completed, band3:b.band3, peak:b.peak };
}
function group(name, cfg){
  const rows=[];
  for(let i=0;i<RUNS;i++) rows.push(run(cfg,i));
  const ok=rows.filter(r=>!r.err);
  const b3=rows.map(r=>r&&r.solved?r.band3:null);
  const vals=b3.filter(x=>x!=null);
  const mean=vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:null;
  const sd=vals.length>1?Math.sqrt(vals.reduce((a,b)=>a+(b-mean)*(b-mean),0)/(vals.length-1)):0;
  console.log('  '+name.padEnd(16)+' 可解 '+ok.filter(r=>r.solved).length+'/'+RUNS+
    '  band3 均值 '+(mean==null?'-':mean.toFixed(1))+'  sd '+sd.toFixed(1)+
    '  峰值 '+(vals.length?Math.max.apply(null,vals):'-'));
  return {name, b3, mean};
}
function paired(name, a, b){
  const d=[];
  for(let i=0;i<Math.min(a.b3.length,b.b3.length);i++) if(a.b3[i]!=null&&b.b3[i]!=null) d.push(b.b3[i]-a.b3[i]);
  if(!d.length){ console.log('  '+name+' 无配对'); return; }
  const mean=d.reduce((x,y)=>x+y,0)/d.length;
  console.log('  '+name.padEnd(22)+' 配对差 '+mean.toFixed(1)+'  胜/负/平 '+
    d.filter(x=>x>0).length+'/'+d.filter(x=>x<0).length+'/'+d.filter(x=>x===0).length+'  ('+d.join(',')+')');
}
console.log('图：'+path.basename(file)+'　seed 1000~'+(999+RUNS)+'（配对）');
console.log('');
const off = group('off(无冰)', {});
const lc = group('层切(无冰)', {cutMode:'layerCut2'});
const ic5 = group('层切+冰0.5', {cutMode:'layerCut2', iceByDue:0.5});
const ic10 = group('层切+冰1.0', {cutMode:'layerCut2', iceByDue:1.0});
console.log('');
console.log('配对对比（正值=变好）：');
paired('层切 − off', off, lc);
paired('冰0.5 − 层切', lc, ic5);
paired('冰1.0 − 层切', lc, ic10);
