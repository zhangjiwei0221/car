'use strict';
const fs=require('fs');
const [srcF,outF,planF]=process.argv.slice(2);
const a=JSON.parse(fs.readFileSync(srcF,'utf8'));
const b=JSON.parse(fs.readFileSync(outF,'utf8'));
const plan=JSON.parse(fs.readFileSync(planF,'utf8'));
const planMap=new Map(plan.map(e=>[e.r+','+e.c,e]));
let errs=[];
for(const k of ['toprow','maprow','mapcol']) if(JSON.stringify(a[k])!==JSON.stringify(b[k])) errs.push(k+' changed');
if(JSON.stringify(a.blocks)!==JSON.stringify(b.blocks)) errs.push('blocks changed');
if(a.blocks.length!==b.blocks.length||a.blocks[0].length!==b.blocks[0].length) errs.push('size changed');
// 逐色总量
const tot=g=>{const m={};for(const row of g.spools)for(const s of row){if(!s||!(s.id>0))continue;m[s.id]=(m[s.id]||0)+s.count;}return m;};
const ta=tot(a),tb=tot(b);
for(const k of new Set([...Object.keys(ta),...Object.keys(tb)])) if(ta[k]!==tb[k]) errs.push('colorTotal '+k+' '+ta[k]+'->'+tb[k]);
// 逐格 diff
let diffs=[];
for(let r=0;r<a.spools.length;r++)for(let c=0;c<a.spools[0].length;c++){
  const x=a.spools[r][c],y=b.spools[r][c];
  const same=JSON.stringify(x)===JSON.stringify(y);
  if(!same){
    diffs.push(r+','+c);
    if(!planMap.has(r+','+c)) errs.push('unplanned diff at '+r+','+c);
    if(x.id!==y.id||x.count!==y.count) errs.push('id/count changed at '+r+','+c);
  }
}
// 计划里的格必须真的变了
for(const e of plan){ if(!diffs.includes(e.r+','+e.c)) errs.push('planned but unchanged '+e.r+','+e.c); }
// 链格四格逐字节一致
const chainCells=[[0,0],[0,1],[1,1],[1,2]];
for(const [r,c] of chainCells){
  if(JSON.stringify(a.spools[r][c])!==JSON.stringify(b.spools[r][c])) errs.push('chain cell changed '+r+','+c);
  const t=b.spools[r][c].type; if(!(Array.isArray(t)?t.includes(5):t===5)) errs.push('chain type lost '+r+','+c);
}
// 空格
let empty=0;for(const row of b.spools)for(const s of row) if(!s||!(s.id>0)) empty++;
if(empty!==0) errs.push('empty cells '+empty);
console.log('diff cells:',diffs.length,JSON.stringify(diffs));
console.log('errors:',errs.length?JSON.stringify(errs):'NONE');
process.exit(errs.length?1:0);
