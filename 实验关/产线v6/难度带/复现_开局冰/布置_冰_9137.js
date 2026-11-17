'use strict';
// 布置：只把计划格改成数字冰（type 7 / param），拒绝任何非普通格。用法: node 布置_冰_9137.js <源关.json> <计划.json> <输出.json>
const fs=require('fs');
const [srcF,planF,outF]=process.argv.slice(2);
const g=JSON.parse(fs.readFileSync(srcF,'utf8'));
const plan=JSON.parse(fs.readFileSync(planF,'utf8'));
for(const e of plan){
  const cell=g.spools[e.r][e.c];
  if(!cell||!(cell.id>0)) throw new Error('not a car at '+e.r+','+e.c);
  if(cell.type!==0) throw new Error('cell type not 0 at '+e.r+','+e.c+' (type='+JSON.stringify(cell.type)+')');
  cell.type=7; cell.param=e.param;
  e.id=cell.id; e.count=cell.count; // 回填供自检
}
fs.writeFileSync(outF,JSON.stringify(g,null,2));
console.log('written',outF,'blocks',plan.length);
