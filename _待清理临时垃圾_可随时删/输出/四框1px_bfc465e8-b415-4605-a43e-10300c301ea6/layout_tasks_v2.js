'use strict';
const fs = require('fs');
const path = require('path');
const file = process.argv[2], imgFile = process.argv[3], out = process.argv[4], report = process.argv[5];
const FRAME_MAP = String(process.argv[6] || '1:下左,30:上左,28:上右,22:下右');
const ORDER = String(process.argv[7] || '下左,上左,上右,下右').split(',');
const DELAYS = String(process.argv[8] || '0,18,36,54').split(',').map(Number);
const DOOR_COUNTS = Object.fromEntries(String(process.argv[9] || '1:35,30:35,28:35,22:35').split(',').filter(Boolean).map(x=>x.split(':').map(Number)));
const TRAP_TARGET = Number(process.argv[10] || 50);

const lines = fs.readFileSync(imgFile, 'utf8').trim().split(/\r?\n/).filter(Boolean);
const img = lines.slice(1).map(x => x.trim().split(/\s+/).map(Number));
const H = img.length, W = img[0].length;
const g = JSON.parse(fs.readFileSync(file, 'utf8'));
const R = g.spools.length, C = g.spools[0].length;
const quad = (r,c) => (r >= R/2 ? '下' : '上') + (c < C/2 ? '左' : '右');
const qCoord = (y,x) => (y >= H/2 ? '下' : '上') + (x < W/2 ? '左' : '右');
const map = {};
for (const s of FRAME_MAP.split(',').filter(Boolean)) {
  const [c,q] = s.split(':');
  map[Number(c)] = q;
}
const edgeReach = {};
for (let y=0;y<H;y++) for (let x=0;x<W;x++) {
  if (y===0 || x===0 || y===H-1 || x===W-1) edgeReach[img[y][x]] = (edgeReach[img[y][x]]||0)+1;
}
// Target quadrant capacity (pixels), useful for report and balancing checks.
const qPix = {};
for (let y=0;y<H;y++) for (let x=0;x<W;x++) if (img[y][x]>0) qPix[qCoord(y,x)] = (qPix[qCoord(y,x)]||0)+1;
// collect cars, preserving their source cells if the meta split provided them.
const cars=[];
for (let r=0;r<R;r++) for (let c=0;c<C;c++) {
  const s=g.spools[r][c];
  if (!s || !(s.id>0)) continue;
  const t=Array.isArray(s.type)?s.type:[s.type||0];
  if (t.some(x=>x>=11&&x<=14)) continue;
  const sourceQ={};
  for (const k of (s.cells||[])) {
    const [y,x]=Array.isArray(k) ? k : k.split(',').map(Number);
    const q=qCoord(y,x);
    sourceQ[q]=(sourceQ[q]||0)+1;
  }
  const sourceList=Object.entries(sourceQ).sort((a,b)=>b[1]-a[1] || ORDER.indexOf(a[0])-ORDER.indexOf(b[0]));
  cars.push({s, oldR:r, oldC:c, sourceQ, preferred:sourceList[0] ? sourceList[0][0] : quad(r,c)});
}
// A door is the largest car of the explicit frame color that still fits the target border reach.
const doors={};
for (const [cs,q] of Object.entries(map)) {
  const col=Number(cs);
  const exact=DOOR_COUNTS[col];
  let candidates=cars.filter(x=>x.s.id===col && x.s.count <= (edgeReach[col]||0));
  if (exact) candidates=candidates.filter(x=>x.s.count===exact);
  candidates.sort((a,b)=>(b.sourceQ[q]||0)-(a.sourceQ[q]||0) || b.s.count-a.s.count);
  if (candidates[0]) doors[col]=candidates[0];
}
// One non-door car per task color is made into a debt/trap car by moving capacity
// from same-color cars. Color totals remain unchanged.
const trapCars={};
for (const [cs,q] of Object.entries(map)) {
  const col=Number(cs);
  const same=cars.filter(x=>x.s.id===col && x!==doors[col]);
  same.sort((a,b)=>(b.sourceQ[q]||0)-(a.sourceQ[q]||0) || b.s.count-a.s.count);
  const trap=same[0];
  if (!trap) continue;
  let need=Math.max(0, TRAP_TARGET-trap.s.count);
  const donors=same.filter(x=>x!==trap).sort((a,b)=>b.s.count-a.s.count);
  for (const d of donors) {
    if (need<=0) break;
    const can=Math.max(0,d.s.count-4);
    const take=Math.min(need,can);
    d.s.count-=take; trap.s.count+=take; need-=take;
  }
  trapCars[col]=trap;
}
// free board slots, keeping one corner/edge slot for each door when possible.
const free={};
for (const q of ORDER) free[q]=[];
for (let r=0;r<R;r++) for (let c=0;c<C;c++) free[quad(r,c)].push([r,c]);
const preferredDoorSlot = {'下左':[R-1,0], '上左':[0,0], '上右':[0,C-1], '下右':[R-1,C-1]};
const placed=new Map();
for (const [cs,q] of Object.entries(map)) {
  const car=doors[Number(cs)];
  if (!car) continue;
  let slot=preferredDoorSlot[q];
  if (!slot || !free[q].some(x=>x[0]===slot[0]&&x[1]===slot[1])) slot=free[q][0];
  if (!slot) continue;
  free[q]=free[q].filter(x=>x[0]!==slot[0]||x[1]!==slot[1]);
  placed.set(car,slot);
}
// Fill every remaining border cell with a car whose color has no target pixels
// on the target image border. Those cars are visible but cannot consume yet, so
// they become the early debt choices instead of free filler.
const doorSet=new Set(Object.values(doors));
const trapSet=new Set(Object.values(trapCars));
const isEdge=([r,c])=>r===0||c===0||r===R-1||c===C-1;
const borderSlots=[];
for (const q of ORDER) for (const slot of free[q]) if (isEdge(slot)) borderSlots.push({q,slot});
let borderDebtCars=cars.filter(x=>!doorSet.has(x)&&!trapSet.has(x)&&!(edgeReach[x.s.id]>0));
borderDebtCars.sort((a,b)=>(b.s.count-a.s.count));
const borderDebtSet=new Set();
for (const {q,slot} of borderSlots) {
  let idx=borderDebtCars.findIndex(x=>x.preferred===q);
  if (idx<0) idx=0;
  const car=borderDebtCars.splice(idx,1)[0];
  if (!car) break;
  borderDebtSet.add(car);
  free[q]=free[q].filter(x=>x[0]!==slot[0]||x[1]!==slot[1]);
  placed.set(car,slot);
}
// Put trap cars deep inside their own task quadrant, then place the rest.
for (const [cs,q] of Object.entries(map)) {
  const trap=trapCars[Number(cs)]; if (!trap) continue;
  const inner=free[q].filter(([r,c])=>!isEdge([r,c]));
  if (!inner.length) continue;
  const cy=q.startsWith('下')?(R-1):0, cx=q.endsWith('右')?(C-1):0;
  inner.sort((a,b)=>Math.abs(a[0]-cy)+Math.abs(a[1]-cx)-Math.abs(b[0]-cy)-Math.abs(b[1]-cx));
  const slot=inner[0];
  free[q]=free[q].filter(x=>x[0]!==slot[0]||x[1]!==slot[1]);
  placed.set(trap,slot);
}
const rest=cars.filter(x=>!doorSet.has(x)&&!trapSet.has(x)&&!borderDebtSet.has(x));
const qOrder=ORDER.slice();
for (const car of rest) {
  let q=car.preferred;
  if (!free[q] || !free[q].length) {
    const order2=qOrder.slice().sort((a,b)=>ORDER.indexOf(a)-ORDER.indexOf(b));
    q=order2.find(qq=>free[qq] && free[qq].length);
  }
  if (!q) throw new Error('棋盘槽位不足');
  const spot=free[q].shift();
  placed.set(car,spot);
}
// Rebuild the board, dropping the temporary cells metadata.
const board=Array.from({length:R},()=>Array(C).fill(null));
for (const [car,spot] of placed) {
  const s={...car.s};
  delete s.cells;
  board[spot[0]][spot[1]]=s;
}
for (let r=0;r<R;r++) for (let c=0;c<C;c++) {
  if (!board[r][c]) board[r][c]={id:-1,type:0,param:0,count:0};
}
// Ice future task colors. This freezes all cars of that frame color in its quadrant,
// which is necessary when the 1px frame color is also used by the subject body.
for (let i=1;i<ORDER.length;i++) {
  const q=ORDER[i], delay=DELAYS[i]||0, col=Number(Object.keys(map).find(c=>map[c]===q));
  if (!(delay>0) || !col) continue;
  const car=doors[col]; if (!car) continue;
  const spot=placed.get(car); if (!spot) continue;
  const s=board[spot[0]][spot[1]];
  if (s && s.id===col) { s.type=7; s.param=delay; }
}
g.spools=board;
fs.writeFileSync(out,JSON.stringify(g,null,2));
const rows=[];
for (let r=0;r<R;r++) for (let c=0;c<C;c++) {
  const s=board[r][c]; if (s.id>0) rows.push({id:s.id,count:s.count,r,c,q:quad(r,c),door:Object.values(doors).some(d=>d.s===s)});
}
const qcap={}, qcount={};
for (const x of rows) { qcap[x.q]=(qcap[x.q]||0)+x.count; qcount[x.q]=(qcount[x.q]||0)+1; }
const colorSum={}; for (const x of rows) colorSum[x.id]=(colorSum[x.id]||0)+x.count;
fs.writeFileSync(report,JSON.stringify({frameMap:map,order:ORDER,delays:DELAYS,edgeReach,doorCars:Object.fromEntries(Object.entries(doors).map(([c,d])=>[c,{count:d.s.count,sourceQ:d.sourceQ}])),trapTarget:TRAP_TARGET,trapCars:Object.fromEntries(Object.entries(trapCars).map(([c,d])=>[c,{count:d.s.count,sourceQ:d.sourceQ}])),borderDebtCars:[...borderDebtSet].map(x=>({id:x.s.id,count:x.s.count,preferred:x.preferred})),qPix,qcap,qcount,colorSum,cars:rows},null,2));
let cap=0; for (const x of rows) cap+=x.count;
console.log('归位完成 | 容量',cap,'/ 目标',H*W,'| 各象限车数',JSON.stringify(qcount),'| 各象限容量',JSON.stringify(qcap));
console.log('门车',Object.entries(doors).map(([c,d])=>`${c}:${d.s.count}@${placed.get(d)}`).join(' '));
