'use strict';
const fs=require('fs');
const [,,inp,out]=process.argv;
const g=JSON.parse(fs.readFileSync(inp,'utf8'));
const R=g.spools.length,C=g.spools[0].length;
const all=[];
for(let r=0;r<R;r++)for(let c=0;c<C;c++){const s=g.spools[r][c];if(s&&s.id>0)all.push(s);}
const byId=id=>all.filter(s=>s.id===id);
const find=(id,count)=>all.find(s=>s.id===id&&s.count===count);
// Split capacities by design, not by one giant car.
const reds=byId(1).sort((a,b)=>b.count-a.count); [35,30,30,25].forEach((n,i)=>{if(!reds[i])throw new Error('red missing');reds[i].count=n;});
const whites=byId(32).sort((a,b)=>b.count-a.count); [40,40,40,40,43].forEach((n,i)=>{if(!whites[i])throw new Error('white missing');whites[i].count=n;});
const redDoor=reds[0], redDebt1=reds[1], redDebt2=reds[2], redSmall=reds[3];
const white0=whites[0], white1=whites[1], white2=whites[2], white3=whites[3], white4=whites[4];
const d30=find(30,35), d28=find(28,35), d22=find(22,35);
if(!d30||!d28||!d22) throw new Error('door missing');
const roles=new Set([redDoor,redDebt1,redDebt2,redSmall,white0,white1,white2,white3,white4,d30,d28,d22]);
// Black cells form the corridor walls. Door cars are never ice-covered.
const blackSlots=[[0,3],[0,5],[0,6],[1,6],[3,4],[4,5],[6,1],[6,4],[4,6],[6,6]];
// Choose removable non-role cars with another same-color car to absorb capacity.
const candidates=all.filter(s=>!roles.has(s));
const blackCandidates=[];
for(const col of [13,13,33,33,24,24,26,26,19,19,7,14]){
  const list=candidates.filter(s=>s.id===col&&!blackCandidates.includes(s));
  if(!list.length)continue;
  blackCandidates.push(list[0]);
  if(blackCandidates.length>=blackSlots.length)break;
}
if(blackCandidates.length<blackSlots.length) throw new Error('not enough removable cars');
for(const victim of blackCandidates){
  const recipient=all.find(s=>s!==victim&&!blackCandidates.includes(s)&&s.id===victim.id&&s.count>0);
  if(!recipient) throw new Error('no recipient for color '+victim.id);
  recipient.count+=victim.count;
}
// Remove black cars from the pool.
const remaining=all.filter(s=>!blackCandidates.includes(s));
// Role placement: current task corridor, future doors lower, gate ice on non-door cars.
const roleSlots={
  '0,0':redDoor,'0,1':white0,'0,2':white1,
  '1,0':redDebt1,'1,1':white2,'1,2':white3,
  '2,0':redDebt2,'2,1':white4,'2,2':redSmall,
  '4,4':d30,'5,6':d28,'6,0':d22
};
// Gatekeepers: non-door cars only.
const gateCars=remaining.filter(s=>!roles.has(s)).slice(0,3);
const gateSlots={'4,3':gateCars[0],'5,5':gateCars[1],'5,0':gateCars[2]};
for(const [k,s] of Object.entries(gateSlots)){if(!s)throw new Error('gate missing');roles.add(s);}
const used=new Set([...Object.values(roleSlots),...Object.values(gateSlots),...blackCandidates]);
const pool=remaining.filter(s=>!used.has(s));
const board=Array.from({length:R},()=>Array(C).fill(null));
for(const [k,s] of Object.entries(roleSlots)){const [r,c]=k.split(',').map(Number);board[r][c]=s;}
for(const [k,s] of Object.entries(gateSlots)){const [r,c]=k.split(',').map(Number);board[r][c]=s;s.type=7;s.param=24;}
for(const [r,c] of blackSlots) board[r][c]={id:-1,type:0,param:0,count:0};
// Fill remaining slots with the remaining cars, keeping source metadata out of final.
let pi=0;
for(let r=0;r<R;r++)for(let c=0;c<C;c++){
  if(board[r][c])continue;
  const s=pool[pi++]; if(!s)throw new Error('car pool empty at '+r+','+c);
  board[r][c]={id:s.id,type:Array.isArray(s.type)?s.type.slice():(s.type||0),param:Array.isArray(s.param)?s.param.slice():(s.param||0),count:s.count};
}
if(pi!==pool.length)throw new Error('unplaced cars '+ (pool.length-pi));
// Doors must remain un-iced and visible.
for(const d of [redDoor,d30,d28,d22]){
  for(let r=0;r<R;r++)for(let c=0;c<C;c++) if(board[r][c]===d){board[r][c].type=0;board[r][c].param=0;}
}
g.spools=board;
fs.writeFileSync(out,JSON.stringify(g,null,2));
console.log('roles',Object.entries(roleSlots).map(([k,s])=>`${s.id}:${s.count}@${k}`).join(' '));
console.log('gates',Object.entries(gateSlots).map(([k,s])=>`${s.id}:${s.count}@${k}`).join(' '));
console.log('black',blackSlots.length,'cars',all.filter(s=>!blackCandidates.includes(s)).length);
