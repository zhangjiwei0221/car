#!/usr/bin/env node
/* 层切批量验证：10 张图，每组 4 个 seed 取最优（近似 portfolioK=4 取优）。
   只读。用法：node 验证_层切批量.js */
'use strict';
const vm = require('vm'), fs = require('fs'), path = require('path');
const BASE = path.join(__dirname, '..', '..', '02_工程', '完整主bin快照_20261012');
const FILES = ['utils.js','color-libs.js','simulator.js','solver-strategy.js','solver.js','playersim.js','analysis.js','generator.js'];
const sandbox = { console:{log(){},warn(){},error(){}}, module:{exports:{}}, WeakMap, Map, Set, setTimeout, clearTimeout, Infinity, Math, JSON, Date };
vm.createContext(sandbox);
for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BASE,'bin/js',f),'utf8'), sandbox, {filename:f});
const A = sandbox.AntSolver, G = A.Generator;
const ROOT = path.join(BASE, '输出文件');
const FILES_LV = [
  ['unnamed-10-21-26','40x40拼接图纸_016'], ['unnamed-10-21-19','35x35拼接图纸_006'],
  ['unnamed-10-20-89','35x35拼接图纸_015'], ['unnamed-10-21-13','40x40拼接图纸_018'],
  ['unnamed-10-20-88','40x40拼接图纸_023'], ['unnamed-10-20-131','40x40拼接图纸_017'],
  ['unnamed-10-20-133','35x35拼接图纸_009'], ['unnamed-10-20-147','level_288'],
  ['unnamed-10-20-148','level_272'], ['unnamed-10-20-152','level_45']
];
const cfg0 = { boxSizeMin:30, boxSizeMax:60, blackPercent:13, icePercent:18, chainCount:4,
  boardRowsMin:4, boardRowsMax:7, boardColsMin:6, boardColsMax:9, bufferLimit:5,
  generatorFlow:'old', targetCarCount:0 };
function band3(res){
  const ps=(res.pressureSamples||[]), tb=res.totalBoxes||0;
  let tot=0,ge=0;
  for(const s of ps){const pr=tb?s.done/tb:0; if(pr<0.3||pr>0.8)continue; tot++; if(s.buf>=3)ge++;}
  return tot?Math.round(ge/tot*100):null;
}
function best(cfg, blocks, seeds){
  let b=-1, solvedAny=false;
  for(const sd of seeds){
    const c=Object.assign({}, cfg0, cfg, {seed: sd, _seedOnce: true});
    let out=null;
    try{ out=G.generateFromBlocks(blocks, c); }catch(e){ continue; }
    if(!out||!out.solveResult||!out.solveResult.completed) continue;
    solvedAny=true;
    const v=band3(out.solveResult);
    if(v!=null && v>b) b=v;
  }
  return solvedAny ? b : null;
}
function rotate(blocks){
  // 模拟 v344 的 portfolio 轮换：默认 / 层切 / 默认 / 层切，取最优
  const seq=[{}, {cutMode:'layerCut2'}, {}, {cutMode:'layerCut2'}];
  const seeds=[1001,1002,1003,1004];
  let b=-1;
  for(let i=0;i<seq.length;i++){
    const c=Object.assign({}, cfg0, seq[i], {seed:seeds[i], _seedOnce:true});
    let out=null;
    try{ out=G.generateFromBlocks(blocks, c); }catch(e){ continue; }
    if(!out||!out.solveResult||!out.solveResult.completed) continue;
    const v=band3(out.solveResult);
    if(v!=null && v>b) b=v;
  }
  return b<0?null:b;
}
console.log('图'.padEnd(22)+'off最高  层切最高  轮换  差(轮换-off)');
let offPass=0, lcPass=0, rotPass=0, n=0;
for(const [dir,name] of FILES_LV){
  const f=path.join(ROOT,dir,'生产文档','关卡数据',name+'.json');
  if(!fs.existsSync(f)){ console.log(name.padEnd(22)+'缺文件'); continue; }
  const j=JSON.parse(fs.readFileSync(f,'utf8'));
  const blocks=j.blocks;
  const o=best({}, blocks, [1001,1002,1003,1004]);
  const l=best({cutMode:'layerCut2'}, blocks, [1001,1002,1003,1004]);
  const r=rotate(blocks);
  n++;
  if(o!=null&&o>=45) offPass++;
  if(l!=null&&l>=45) lcPass++;
  if(r!=null&&r>=45) rotPass++;
  console.log(name.padEnd(22)+String(o).padStart(6)+String(l).padStart(10)+String(r).padStart(6)+
    (o!=null&&r!=null?String(r-o>0?'+'+ (r-o):(r-o)).padStart(8):'       -'));
}
console.log('');
console.log('达标（band3≥45）：off '+offPass+'/'+n+'　层切 '+lcPass+'/'+n+'　轮换 '+rotPass+'/'+n);
