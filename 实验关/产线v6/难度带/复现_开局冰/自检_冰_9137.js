'use strict';
// 自检：与计划逐格 diff；只允许 type/param 变；链格/容量/目标图不动。用法: node 自检_冰_9137.js <源> <变体> <计划>
const fs=require('fs');
const [srcF,outF,planF]=process.argv.slice(2);
const a=JSON.parse(fs.readFileSync(srcF,'utf8'));
const b=JSON.parse(fs.readFileSync(outF,'utf8'));
const plan=JSON.parse(fs.readFileSync(planF,'utf8'));
const planMap=new Map(plan.map(e=>[e.r+','+e.c,e]));
let errs=[];
for(const k of ['toprow','maprow','mapcol']) if(JSON.stringify(a[k])!==JSON.stringify(b[k])) errs.push(k+' changed');
if(JSON.stringify(a.blocks)!==JSON.stringify(b.blocks)) errs.push('blocks changed');
if(a.spools.length!==b.spools.length||a.spools[0].length!==b.spools[0].length) errs.push('spool size changed');
const tot=g=>{const m={};for(const row of g.spools)for(const s of row){if(!s||!(s.id>0))continue;m[s.id]=(m[s.id]||0)+s.count;}return m;};
const ta=tot(a),tb=tot(b);
for(const k2 of new Set([...Object.keys(ta),...Object.keys(tb)])) if(ta[k2]!==tb[k2]) errs.push('colorTotal '+k2+' '+ta[k2]+'->'+tb[k2]);
let diffs=[];
for(let r=0;r<a.spools.length;r++)for(let c=0;c<a.spools[0].length;c++){
  const x=a.spools[r][c],y=b.spools[r][c];
  if(JSON.stringify(x)!==JSON.stringify(y)){
    diffs.push(r+','+c);
    if(!planMap.has(r+','+c)) errs.push('unplanned diff at '+r+','+c);
    if(x.id!==y.id||x.count!==y.count) errs.push('id/count changed at '+r+','+c);
    if(x.type!==0||y.type!==7) errs.push('type not 0->7 at '+r+','+c+' ('+JSON.stringify(x.type)+'->'+JSON.stringify(y.type)+')');
  }
}
for(const e of plan){ if(!diffs.includes(e.r+','+e.c)) errs.push('planned but unchanged '+e.r+','+e.c); }
// 所有链格逐字节一致
for(let r=0;r<a.spools.length;r++)for(let c=0;c<a.spools[0].length;c++){
  const t=a.spools[r][c].type, isChain=Array.isArray(t)?t.includes(5):t===5;
  if(isChain&&JSON.stringify(a.spools[r][c])!==JSON.stringify(b.spools[r][c])) errs.push('chain cell changed '+r+','+c);
}
let empty=0;for(const row of b.spools)for(const s of row) if(!s||!(s.id>0)) empty++;
if(empty!==0) errs.push('empty cells '+empty);
console.log('diff cells:',diffs.length,JSON.stringify(diffs));
console.log('errors:',errs.length?JSON.stringify(errs):'NONE');
process.exit(errs.length?1:0);
