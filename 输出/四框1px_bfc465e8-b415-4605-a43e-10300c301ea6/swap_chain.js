'use strict';
const fs=require('fs');
const [,,inp,out,coordsArg,groupIdArg]=process.argv;
const g=JSON.parse(fs.readFileSync(inp,'utf8'));
const coords=coordsArg.split(';').map(s=>s.split(',').map(Number));
const groupId=Number(groupIdArg||100);
for(const [r,c] of coords){
  const s=g.spools[r][c];
  if(!s||!(s.id>0)) throw new Error('not a car '+r+','+c);
  const t=Array.isArray(s.type)?s.type.filter(x=>x!==0):[s.type||0];
  const p=Array.isArray(s.param)?s.param.slice():[s.param];
  if(!t.includes(5)){t.push(5);p.push(groupId);} else {p[t.indexOf(5)]=groupId;}
  s.type=t; s.param=p;
}
fs.writeFileSync(out,JSON.stringify(g,null,2));
console.log('chain',groupId,coords.map(([r,c])=>`${g.spools[r][c].id}@${r},${c}`).join(' + '));
