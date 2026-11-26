'use strict';
const fs=require('fs');
const [,,inp,out]=process.argv;
const g=JSON.parse(fs.readFileSync(inp,'utf8'));
const R=g.spools.length,C=g.spools[0].length;
function posOf(obj){for(let r=0;r<R;r++)for(let c=0;c<C;c++)if(g.spools[r][c]===obj)return [r,c];throw new Error('car not found');}
function move(obj,tr,tc){const [r,c]=posOf(obj); if(r===tr&&c===tc)return; const a=g.spools[r][c]; g.spools[r][c]=g.spools[tr][tc]; g.spools[tr][tc]=a;}
function find(id,count){for(let r=0;r<R;r++)for(let c=0;c<C;c++){const s=g.spools[r][c]; if(s&&s.id===id&&s.count===count)return s;} throw new Error('missing '+id+':'+count);}
const redDoor=find(1,35), redTrap=find(1,50), redSmall=find(1,28);
const d30=find(30,35), d28=find(28,35), d22=find(22,35);
// Top row is the only initially accessible row.
move(redDoor,0,0); move(redTrap,0,1); move(redSmall,0,2);
move(d30,0,3); move(d28,0,4); move(d22,0,5);
// Current task: three red cars form one chain group. Future doors remain ice-gated.
const chainCells=[[0,0],[0,1],[0,2]];
for(const [r,c] of chainCells){const s=g.spools[r][c]; s.type=5; s.param=100;}
for(const [obj,delay] of [[d30,8],[d28,16],[d22,24]]){
  const [r,c]=posOf(obj); g.spools[r][c].type=7; g.spools[r][c].param=delay;
}
fs.writeFileSync(out,JSON.stringify(g,null,2));
console.log('top row',g.spools[0].map(s=>s.id>0?`${s.id}:${s.count}t${Array.isArray(s.type)?s.type.join('+'):s.type}`:'---').join(' '));
