'use strict';
const fs=require('fs');
const [,,inp,out,src,dst,coordsArg,groupIdArg]=process.argv;
const g=JSON.parse(fs.readFileSync(inp,'utf8'));
const [sr,sc]=src.split(',').map(Number),[dr,dc]=dst.split(',').map(Number);
const a=g.spools[sr][sc],b=g.spools[dr][dc]; g.spools[sr][sc]=b; g.spools[dr][dc]=a;
const groupId=Number(groupIdArg||101);
for(const xy of coordsArg.split(';')){const [r,c]=xy.split(',').map(Number);const s=g.spools[r][c];const t=Array.isArray(s.type)?s.type.filter(x=>x!==0):(s.type?[s.type]:[]);const p=Array.isArray(s.param)?s.param.slice():[s.param];if(!t.includes(5)){t.push(5);p.push(groupId);}else p[t.indexOf(5)]=groupId;s.type=t;s.param=p;}
fs.writeFileSync(out,JSON.stringify(g,null,2));
console.log('swapped',src,'<->',dst,'chain',coordsArg);
