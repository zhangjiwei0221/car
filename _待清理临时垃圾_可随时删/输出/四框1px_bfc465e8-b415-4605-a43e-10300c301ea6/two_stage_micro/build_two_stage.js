'use strict';
const fs=require('fs');
const [,,inp,out]=process.argv;
const g=JSON.parse(fs.readFileSync(inp,'utf8'));
const R=g.spools.length,C=g.spools[0].length;
const all=[];
for(let r=0;r<R;r++)for(let c=0;c<C;c++){const s=g.spools[r][c];if(s&&s.id>0)all.push(s);}
const byId=id=>all.filter(s=>s.id===id);
const door1=byId(1).find(s=>s.count===35), door15=byId(15).find(s=>s.count===35);
if(!door1||!door15)throw new Error('door missing');
const whites=byId(32).sort((a,b)=>b.count-a.count);
const reds=byId(1).filter(s=>s!==door1).sort((a,b)=>b.count-a.count);
const b15=byId(15).filter(s=>s!==door15);
const roles=new Set([door1,door15,...whites.slice(0,3),...reds.slice(0,2)]);
// Three black cells close the banana-door pocket.
const existingBlack=[];
for(let r=0;r<R;r++)for(let c=0;c<C;c++){const x=g.spools[r][c];if(x&&x.id===-1)existingBlack.push([r,c]);}
const newBlackSlots=[[3,4],[4,5],[6,4]];
const blackSlots=existingBlack.concat(newBlackSlots);
const candidates=all.filter(s=>!roles.has(s));
const blackCandidates=[];
for(const col of [13,33,24,26,19,30,22,32,15]){
  const list=candidates.filter(s=>s.id===col&&!blackCandidates.includes(s));
  if(!list.length)continue;
  blackCandidates.push(list[0]);
  if(blackCandidates.length>=newBlackSlots.length)break;
}
if(blackCandidates.length<newBlackSlots.length)throw new Error('not enough black candidates');
for(const victim of blackCandidates){
  const recipient=all.find(s=>s!==victim&&!blackCandidates.includes(s)&&s.id===victim.id);
  if(!recipient)throw new Error('no recipient '+victim.id);
  recipient.count+=victim.count;
}
const remaining=all.filter(s=>!blackCandidates.includes(s));
const roleSlots={
  '0,0':door1,
  '0,1':whites[0],'0,2':whites[1],'1,0':whites[2],
  '1,1':reds[0],'1,2':reds[1],
  '4,4':door15,
  '5,6':b15[0],'6,5':b15[1],'6,6':b15[2]
};
// Gate is a non-door car immediately before the banana door.
const gate=remaining.find(s=>!roles.has(s)&&s.id!==15);
if(!gate)throw new Error('gate missing');
roles.add(gate);
const used=new Set([...Object.values(roleSlots),...blackCandidates,gate]);
const pool=remaining.filter(s=>!used.has(s));
const board=Array.from({length:R},()=>Array(C).fill(null));
for(const [k,s] of Object.entries(roleSlots)){const [r,c]=k.split(',').map(Number);board[r][c]=s;}
board[4][3]=gate; gate.type=7; gate.param=18;
for(const [r,c] of blackSlots)board[r][c]={id:-1,type:0,param:0,count:0};
let pi=0;
for(let r=0;r<R;r++)for(let c=0;c<C;c++){
  if(board[r][c])continue;
  const s=pool[pi++];if(!s)throw new Error('pool empty');
  board[r][c]={id:s.id,type:Array.isArray(s.type)?s.type.slice():(s.type||0),param:Array.isArray(s.param)?s.param.slice():(s.param||0),count:s.count};
}
if(pi!==pool.length)throw new Error('unplaced '+ (pool.length-pi));
// Door cars must remain un-iced and visible.
for(const d of [door1,door15]){
  for(let r=0;r<R;r++)for(let c=0;c<C;c++)if(board[r][c]===d){board[r][c].type=0;board[r][c].param=0;}
}
g.spools=board;
fs.writeFileSync(out,JSON.stringify(g,null,2));
console.log('doors',door1.id+'@0,0',door15.id+'@4,4','gate',gate.id+':'+gate.count+'@4,3','black',blackSlots.length);
console.log('top',board[0].map(s=>s.id>0?`${s.id}:${s.count}`:'B').join(' '));
