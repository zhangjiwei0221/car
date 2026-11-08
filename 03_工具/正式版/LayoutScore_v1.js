#!/usr/bin/env node
'use strict';
/**
 * LayoutScore_v1 —— 排版检查（用户 7 条口述的量化版）
 *
 * 硬否决：
 *   L1 碎车：任一辆 <5px；或 ≥3 辆 <8px 且该色总像素 ≥100
 *   L2 半成品：≥2 行/列「整行同色」（该行非空格全是同一色）
 *   L4 锁链不正交：链组成员不是正交相邻
 *   L5 目标图不可辨：某色 ≤2px 的碎片像素占比 > 20%
 *
 * 软分/警告：
 *   L3 单选题：黑墙最长连、黑块比例（真正的单选题需 Decision/ArlCheck 复核）
 *   L6 单格迷宫：黑块最长连/空格率
 *   车尺寸分布、同色连、同色连通块、障碍数量、问号在链组伙伴上
 *
 * 用法：node LayoutScore_v1.js <关卡.json | 目录> [--out report.json]
 */
const fs=require('fs'); const path=require('path');
const B=require('./Build006Thickness_v688');
const A=B.loadSolver('corner');
const arg=(k,d)=>{const i=process.argv.indexOf(k);return i>0?process.argv[i+1]:d;};
const input=process.argv[2]; if(!input){console.error('用法: node LayoutScore_v1.js <关卡.json | 目录> [--out report.json]');process.exit(2);}
const outFile=arg('--out',null);
function collect(p){const st=fs.statSync(p); if(st.isFile())return [p]; return fs.readdirSync(p).filter(f=>f.endsWith('.json')).sort().map(f=>path.join(p,f));}
function isLevel(g){return g&&g.toprow&&Array.isArray(g.blocks)&&Array.isArray(g.spools);}

function scoreLevel(g){
  const sp=g.spools, R=sp.length, C=sp[0].length;
  const cars=[]; for(let r=0;r<R;r++)for(let c=0;c<C;c++){const car=sp[r][c]; if(car&&car.id>0) cars.push({r,c,car});}
  const total={}; for(const row of g.blocks||[]) for(const x of row) if(x) total[x]=(total[x]||0)+1;
  const hard=[], warn=[];
  // L1
  const tiny=cars.filter(x=>x.car.count<=5);
  const small8=cars.filter(x=>x.car.count<8);
  const small8Big=small8.filter(x=>(total[x.car.id]||0)>=100);
  if(tiny.length) hard.push(`L1: ${tiny.length} cars <=5px`);
  if(small8.length>=3) hard.push(`L1: ${small8.length} cars <8px`);
  else if(small8Big.length) warn.push(`L1: ${small8Big.length} small cars in big colors`);
  // L2: full same-color rows/cols
  const fullRows=[], fullCols=[];
  for(let r=0;r<R;r++){const ids=sp[r].map(x=>x&&x.id>0?x.id:null); if(ids.every(x=>x!=null)&&ids.every(x=>x===ids[0])) fullRows.push({r,color:ids[0]});}
  for(let c=0;c<C;c++){const ids=[]; let ok=true, first=null; for(let r=0;r<R;r++){const x=sp[r][c]; if(!x||!(x.id>0)){ok=false;break;} if(first==null)first=x.id; if(x.id!==first){ok=false;break;} ids.push(x.id);} if(ok&&first!=null) fullCols.push({c,color:first});}
  // same-color runs
  let maxRun=0;
  for(let r=0;r<R;r++){let run=1; for(let c=1;c<C;c++){const a=sp[r][c-1],b=sp[r][c]; if(a&&b&&a.id>0&&a.id===b.id)run++;else{maxRun=Math.max(maxRun,run);run=1;}} maxRun=Math.max(maxRun,run);}
  for(let c=0;c<C;c++){let run=1; for(let r=1;r<R;r++){const a=sp[r-1][c],b=sp[r][c]; if(a&&b&&a.id>0&&a.id===b.id)run++;else{maxRun=Math.max(maxRun,run);run=1;}} maxRun=Math.max(maxRun,run);}
  if(fullRows.length+fullCols.length>=1) hard.push(`L2: ${fullRows.length+fullCols.length} full same-color row/col`);
  else if(maxRun>=6) hard.push(`L2: same-color run ${maxRun}`);
  else if(maxRun===5) warn.push(`L2: same-color run 5`);
  // L4 chains
  const chains={};
  for(const {r,c,car} of cars){const ts=Array.isArray(car.type)?car.type:[car.type||0]; if(ts.indexOf(5)>=0){const gid=Array.isArray(car.param)?car.param[ts.indexOf(5)]:car.param; (chains[gid]=chains[gid]||[]).push({r,c});}}
  const badChains=[];
  for(const [gid,members] of Object.entries(chains)){
    // connected via orthogonal adjacency?
    const seen=new Set([0]); const q=[0];
    while(q.length){const i=q.pop(); for(let j=0;j<members.length;j++){if(seen.has(j))continue; if(Math.abs(members[i].r-members[j].r)+Math.abs(members[i].c-members[j].c)===1){seen.add(j);q.push(j);}}}
    if(seen.size!==members.length) badChains.push(gid);
  }
  if(badChains.length) hard.push(`L4: ${badChains.length} chain groups not orthogonally connected`);
  // L5 tiny fragments by color
  const frag={};
  for(const color of Object.keys(total)){
    const seen2=Array.from({length:(g.blocks||[]).length},()=>[]);
    // BFS components per color
    const rows=(g.blocks||[]).length, cols=rows?g.blocks[0].length:0;
    const vis=Array.from({length:rows},()=>Array(cols).fill(false));
    let tinyPx=0, comps=0, maxComp=0;
    for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
      if(vis[r][c]||g.blocks[r][c]!==+color)continue;
      let size=0; const st=[[r,c]]; vis[r][c]=true;
      while(st.length){const [rr,cc]=st.pop(); size++; for(const [dr,dc] of [[1,0],[-1,0],[0,1],[0,-1]]){const nr=rr+dr,nc=cc+dc; if(nr<0||nr>=rows||nc<0||nc>=cols||vis[nr][nc]||g.blocks[nr][nc]!==+color)continue; vis[nr][nc]=true;st.push([nr,nc]);}}
      comps++; maxComp=Math.max(maxComp,size); if(size<=2)tinyPx+=size;
    }
    frag[color]={components:comps,maxComponent:maxComp,tinyPx,ratio:total[color]?+(tinyPx/total[color]).toFixed(3):0};
  }
  const badFrag=Object.entries(frag).filter(([k,v])=>(total[k]||0)>=100 && v.ratio>0.5 && v.maxComponent<10);
  if(badFrag.length) hard.push(`L5: ${badFrag.length} big colors (>=100px) shredded (>50% in ≤2px, max component <10)`);
  // black metrics
  let black=0,maxBlackRow=0,maxBlackCol=0;
  for(let r=0;r<R;r++){let run=0; for(let c=0;c<C;c++){const x=sp[r][c]; if(!x||!(x.id>0)){run++;black++;maxBlackRow=Math.max(maxBlackRow,run);}else run=0;}}
  for(let c=0;c<C;c++){let run=0; for(let r=0;r<R;r++){const x=sp[r][c]; if(!x||!(x.id>0)){run++;maxBlackCol=Math.max(maxBlackCol,run);}else run=0;}}
  // obstacles
  const obs={chain:0,ice:0,question:0,pipe:0};
  for(const {car} of cars){const ts=Array.isArray(car.type)?car.type:[car.type||0]; for(const t of ts){if(t===5)obs.chain++; else if(t===7)obs.ice++; else if(t===6)obs.question++; else if(t>=11&&t<=14)obs.pipe++;}}
  // q on chain partner
  let qOnChain=0;
  for(const [gid,members] of Object.entries(chains)) for(const m of members){const car=sp[m.r][m.c]; const ts=Array.isArray(car.type)?car.type:[car.type||0]; if(ts.indexOf(6)>=0) qOnChain++;}
  // car sizes
  const sizes=cars.map(x=>x.car.count).sort((a,b)=>a-b);
  return {hard, warn, maxRun, black, blackRatio:+(black/(R*C)).toFixed(3), maxBlackRow, maxBlackCol,
    chains:Object.keys(chains).length, obs, qOnChain,
    carSizes:{count:cars.length,min:sizes[0],median:sizes[Math.floor(sizes.length/2)],max:sizes[sizes.length-1],below8:sizes.filter(v=>v<8).length,above80:sizes.filter(v=>v>80).length},
    frag, tinyCars:tiny.map(x=>({r:x.r,c:x.c,color:x.car.id,count:x.car.count})), small8Cars:small8.map(x=>({r:x.r,c:x.c,color:x.car.id,count:x.car.count}))
  };
}

const files=collect(input); const rows=[];
for(const file of files){let g; try{g=B.readJson(file);}catch(e){rows.push({file,error:e.message});continue;} if(!isLevel(g)){rows.push({file,error:'not a level'});continue;}
  const s=scoreLevel(g); const r={file:path.basename(file),...s}; rows.push(r);
  console.log(`${r.file.padEnd(30)} hard=${r.hard.length} warn=${r.warn.length} maxRun=${r.maxRun} black=${r.black}(${r.blackRatio}) cars ${r.carSizes.min}/${r.carSizes.median}/${r.carSizes.max} <8:${r.carSizes.below8}${r.hard.length?'  ❌ '+r.hard.join(' | '):''}${r.warn.length?'  ⚠ '+r.warn.join(' | '):''}`);
}
if(outFile){fs.writeFileSync(outFile,JSON.stringify({tool:'LayoutScore_v1',rows},null,2));console.log('saved '+outFile);}
