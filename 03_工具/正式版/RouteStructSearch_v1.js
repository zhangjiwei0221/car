#!/usr/bin/env node
'use strict';
/**
 * RouteStructSearch_v1 —— 路线关的结构搜索（对 RouteFirst 产出做局部优化）
 *
 * 三类移动（每步随机选一类）：
 *   1) 同色两车间挪容量 δ（容量守恒）
 *   2) 两格交换 颜色+容量+障碍（同色总量不变，改变颜色-槽位结构）
 *   3) 随机格加/去“派生冰”：param = 该色在该容量下的 ready 步 - 1
 * 评估：最小路线（峰值/at4）+ PlayerSim（中段）+ 10 条噪声路线（容错），按加权分数接受。
 *
 * 用法：node RouteStructSearch_v1.js <关卡.json> <迭代数> <输出.json> <目标图.txt>
 * 注意：每接受一次就覆盖输出文件，进程中断也能拿到当前最好结果。
 */
const B=require('./Build006Thickness_v688');
const A=B.loadSolver('corner');
const fs=require('fs');
const g0=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const N=+(process.argv[3]||100);
function parseTxt(file){const lines=fs.readFileSync(file,'utf8').replace(/\r/g,'').trim().split('\n');const rows=[];for(const l of lines){const t=l.trim();if(!t||/[^\d\s]/.test(t))continue;rows.push(t.split(/\s+/).map(Number));}return rows;}
function targetCurve(blocks,maxSteps){const H=blocks.length,W=blocks[0].length;const elim=Array.from({length:H},()=>Array(W).fill(false));const total={},reach={};for(let y=0;y<H;y++)for(let x=0;x<W;x++){const c=blocks[y][x];if(c>0)total[c]=(total[c]||0)+1;}
const reachable=(y,x)=>y===0||x===0||y===H-1||x===W-1||elim[y-1][x]||elim[y+1][x]||elim[y][x-1]||elim[y][x+1];
const scan=()=>{for(const c of Object.keys(total))reach[c]=0;for(let y=0;y<H;y++)for(let x=0;x<W;x++)if(!elim[y][x]&&reachable(y,x)&&blocks[y][x]>0)reach[blocks[y][x]]++;};
const rows=[];scan();rows.push({step:0,reach:{...reach}});
for(let step=1;step<=maxSteps;step++){let pc=null,pd=Infinity;for(let y=0;y<H;y++)for(let x=0;x<W;x++){if(elim[y][x]||blocks[y][x]<=0||!reachable(y,x))continue;const d=(H-1-y)+x;if(d<pd){pd=d;pc=blocks[y][x];}}if(pc==null)break;for(let y=0;y<H;y++)for(let x=0;x<W;x++)if(!elim[y][x]&&blocks[y][x]===pc&&reachable(y,x))elim[y][x]=true;scan();rows.push({step,reach:{...reach}});}return rows;}
const blocks=parseTxt(process.argv[5]);
const curve=targetCurve(blocks,40);
const reachAt=(c,s)=>(curve[Math.min(s,curve.length-1)]||{reach:{}}).reach[c]||0;
const readyStep=(c,cap)=>{for(let s=0;s<curve.length;s++)if(reachAt(c,s)>=cap)return s;return curve.length-1;};
function evalF(g){
  const lv=A.parseLevel(A.fromGameFormat(g));
  const mb=A.Solver.runMinBuffer(lv,{depth:3,instantChain:false});
  const hist=mb.stepBufferHistory||[];
  const peak=Math.max(0,...hist), at4=hist.filter(v=>v>=4).length;
  const pr=A.PlayerSim.run(lv,{seed:7,instantChain:false,reviveCap:2,capturePreviewStats:false});
  const picks=(pr.pickOrder||[]).filter(p=>p.chainIndex===0);
  const tl=pr.bufferTimeline||[];
  const ss=picks.map(p=>tl[p.tick]!=null?tl[p.tick]:0);
  const e2=Math.max(1,Math.round(ss.length*0.1)), t2=Math.floor(ss.length*0.8);
  const mid=ss.slice(e2,t2);
  const midRatio=mid.length?+(mid.filter(v=>v>=3).length/mid.length).toFixed(2):0;
  let tol=0;
  for(let i=0;i<10;i++){const nz=i===0?0:0.2+(i%5)*0.2;const oo=A.Solver.runSolver(lv,nz,1000+i*37,false,false,{capturePreviewStats:false,instantChain:false});if(oo.completed)tol++;}
  return {won:!!mb.won,peak,at4,pass:pr.won?1:0,midRatio,tol};
}
function score(e){
  if(!e.won) return -1000+e.peak;
  let s=500+(e.pass?80:0);
  s+=e.peak===4?60:e.peak===3?10:e.peak===5?-100:-20;
  s+=e.at4>=5?150:e.at4*10;
  s+=e.midRatio<=0.8&&e.midRatio>=0.45?100:-Math.round(Math.abs(e.midRatio-0.62)*200);
  s+=(e.tol>=6&&e.tol<=8)?90:(e.tol<=4?-30:(e.tol<=5?20:-60));
  return s;
}
const R=g=>g.spools.length, C=g=>g.spools[0].length;
function cells(g){const out=[];for(let r=0;r<R(g);r++)for(let c=0;c<C(g);c++){const s=g.spools[r][c];if(s&&s.id>0&&!(Array.isArray(s.type)?s.type:[s.type]).includes(7))out.push([r,c]);}return out;}
let cur=JSON.parse(JSON.stringify(g0)); let curEv=evalF(cur); let curS=score(curEv);
console.log('start',JSON.stringify(curEv),curS);
let best={g:JSON.parse(JSON.stringify(cur)),ev:curEv,s:curS};
fs.writeFileSync(process.argv[4],JSON.stringify(best.g));
for(let t=0;t<N;t++){
  const g=JSON.parse(JSON.stringify(cur));
  const kind=Math.random();
  if(kind<0.45){
    // 容量：同色两车挪 δ
    const by={},pairs=[];
    for(let r=0;r<R(g);r++)for(let c=0;c<C(g);c++){const s=g.spools[r][c];if(!s||!(s.id>0))continue;(by[s.id]=by[s.id]||[]).push([r,c]);}
    for(const id of Object.keys(by)){const l=by[id];for(let i=0;i<l.length;i++)for(let j=i+1;j<l.length;j++)pairs.push([l[i],l[j]]);}
    if(!pairs.length) continue;
    const [a,b]=pairs[Math.floor(Math.random()*pairs.length)];
    const d=[8,12,18,24,32][Math.floor(Math.random()*5)];
    const from=Math.random()<0.5?a:b, to=Math.random()<0.5?a:b;
    if(from[0]===to[0]&&from[1]===to[1]) continue;
    const sf=g.spools[from[0]][from[1]], st=g.spools[to[0]][to[1]];
    if(sf.count<=1+d) continue;
    sf.count-=d; st.count+=d;
  } else if(kind<0.8){
    // 结构：两格交换颜色+容量（同色总量不变）
    const cs=cells(g); if(cs.length<2) continue;
    const a=cs[Math.floor(Math.random()*cs.length)], b=cs[Math.floor(Math.random()*cs.length)];
    if(a[0]===b[0]&&a[1]===b[1]) continue;
    const sa=g.spools[a[0]][a[1]], sb=g.spools[b[0]][b[1]];
    if(sa.id===sb.id) continue;
    [sa.id,sb.id]=[sb.id,sa.id]; [sa.count,sb.count]=[sb.count,sa.count];
    const ta=sa.type,tb=sb.type; sa.type=tb; sb.type=ta;
    const pa=sa.param,pb=sb.param; sa.param=pb; sb.param=pa;
  } else {
    // 冰：随机格加/去派生冰（param=ready-1）
    const cs=cells(g); if(!cs.length) continue;
    const [r,c]=cs[Math.floor(Math.random()*cs.length)];
    const s=g.spools[r][c];
    const hp=readyStep(s.id,s.count)-1;
    if(hp<1) continue;
    if(Math.random()<0.6){ s.type=7; s.param=Math.max(1,Math.min(28,hp)); }
    else if(!Array.isArray(s.type)&&s.type===7){ s.type=0; s.param=0; }
    else continue;
  }
  const ev=evalF(g), s=score(ev);
  if(s>curS){cur=g;curEv=ev;curS=s;if(s>best.s){best={g:JSON.parse(JSON.stringify(g)),ev,s};fs.writeFileSync(process.argv[4],JSON.stringify(best.g));}console.log('t'+t,'accept',JSON.stringify(ev),s);}
  else if(t%20===0) console.log('t'+t,'reject',JSON.stringify(ev),s);
}
console.log('BEST',JSON.stringify(best.ev),best.s);
