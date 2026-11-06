'use strict';
const fs=require('fs');
const [,,inp,out,coordsArg,targetsArg]=process.argv;
const g=JSON.parse(fs.readFileSync(inp,'utf8'));
const coords=coordsArg.split(';').map(s=>s.split(',').map(Number));
const targets=Object.fromEntries(targetsArg.split(',').filter(Boolean).map(s=>s.split(':').map(Number)));
function allCars(){const a=[];for(let r=0;r<g.spools.length;r++)for(let c=0;c<g.spools[r].length;c++){const s=g.spools[r][c];if(s&&s.id>0)a.push({s,r,c});}return a;}
const cars=allCars();
for(const [r,c] of coords){
  const cell=g.spools[r][c], want=targets[cell.id]; if(!want||want<=cell.count)continue;
  let need=want-cell.count;
  const donors=cars.filter(x=>x.s!==cell&&x.s.id===cell.id&&x.s.count>4).sort((a,b)=>b.s.count-a.s.count);
  for(const d of donors){if(need<=0)break;const take=Math.min(need,d.s.count-4);d.s.count-=take;cell.count+=take;need-=take;}
  if(need>0) throw new Error(`color ${cell.id} cannot reach ${want}, short ${need}`);
}
fs.writeFileSync(out,JSON.stringify(g,null,2));
console.log('inflated',coords.map(([r,c])=>`${g.spools[r][c].id}:${g.spools[r][c].count}@${r},${c}`).join(' '));
