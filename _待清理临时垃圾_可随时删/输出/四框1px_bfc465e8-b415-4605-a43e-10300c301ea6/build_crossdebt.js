'use strict';
const fs=require('fs');
const [,,inp,out]=process.argv;
const CROSS_TARGET=Number(process.argv[4]||126);
const OTHER32_ICE=Number(process.argv[5]||60);
const g=JSON.parse(fs.readFileSync(inp,'utf8'));
const R=g.spools.length,C=g.spools[0].length;
function find(id,count){for(let r=0;r<R;r++)for(let c=0;c<C;c++){const s=g.spools[r][c];if(s&&s.id===id&&s.count===count)return s;}throw new Error('missing '+id+':'+count);}
function pos(obj){for(let r=0;r<R;r++)for(let c=0;c<C;c++)if(g.spools[r][c]===obj)return [r,c];throw new Error('not found');}
function move(obj,tr,tc){const [r,c]=pos(obj);if(r===tr&&c===tc)return;const a=g.spools[r][c];g.spools[r][c]=g.spools[tr][tc];g.spools[tr][tc]=a;}
function inflate(obj,target){let need=target-obj.count;if(need<=0)return;const all=[];for(let r=0;r<R;r++)for(let c=0;c<C;c++){const s=g.spools[r][c];if(s&&s.id===obj.id&&s!==obj&&s.count>4)all.push(s);}all.sort((a,b)=>b.count-a.count);for(const d of all){if(need<=0)break;const take=Math.min(need,d.count-4);d.count-=take;obj.count+=take;need-=take;}if(need>0)throw new Error('cannot inflate '+obj.id);}

const redDoor=find(1,35), redTrap=find(1,50), redSmall=find(1,28);
const cross=find(32,62);
const d30=find(30,35), d28=find(28,35), d22=find(22,35);
// Current task: red door + red debt + red small. This chain clears and opens the first path.
move(redDoor,0,0); move(redTrap,0,1); move(redSmall,0,2);
// Cross-subject debt: sausage background 32, placed in the first path.
inflate(cross,CROSS_TARGET); move(cross,1,0);
// Future doors are lower on the board, not in the first row; ice keeps them locked.
move(d30,4,4); move(d28,5,6); move(d22,6,3);
// Current red chain.
for(const [r,c] of [[0,0],[0,1],[0,2]]){const s=g.spools[r][c];s.type=5;s.param=100;}
// Row-1 mixed debt chain: 32 cross-subject debt + two other colors.
for(const [r,c] of [[1,0],[1,1],[1,2]]){const s=g.spools[r][c];s.type=5;s.param=101;}
// Cross-subject debt: freeze every other 32 car so the 126px debt cannot be repaid early.
for(let r=0;r<R;r++)for(let c=0;c<C;c++){
  const s=g.spools[r][c];
  if(s&&s.id===32&&s!==cross){s.type=7;s.param=OTHER32_ICE;}
}
// Keep non-chain top-row cars out of the opening until the current task is underway.
for(let c=3;c<C;c++){const s=g.spools[0][c];if(s&&s.id>0&&!(s.type===5||(Array.isArray(s.type)&&s.type.includes(5)))){s.type=7;s.param=20;}}
// Future doors: lower board + ice.
for(const [obj,delay] of [[d30,20],[d28,32],[d22,44]]){const [r,c]=pos(obj);g.spools[r][c].type=7;g.spools[r][c].param=delay;}
fs.writeFileSync(out,JSON.stringify(g,null,2));
console.log('top',g.spools[0].map(s=>s.id>0?`${s.id}:${s.count}t${Array.isArray(s.type)?s.type.join('+'):s.type}`:'---').join(' '));
console.log('row1',g.spools[1].map(s=>s.id>0?`${s.id}:${s.count}t${Array.isArray(s.type)?s.type.join('+'):s.type}`:'---').join(' '));
console.log('future doors',[[d30,20],[d28,32],[d22,44]].map(([o,d])=>`${o.id}@${pos(o)} d${d}`).join(' '));
