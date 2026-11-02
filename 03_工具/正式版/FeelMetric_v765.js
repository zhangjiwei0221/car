// 感受指标：每一步，露出（可点）的车中，有多少辆"当前就能吃满"
const B=require('/Users/red/Desktop/毛线汽车/03_工具/正式版/Build006Thickness_v688');
const A=B.loadSolver('corner');
const f=process.argv[2];
const g=B.readJson(f);
const lv=A.parseLevel(A.fromGameFormat(g));
const o=A.Solver.runSolver(lv,0,1,false,false,{capturePreviewStats:true,instantChain:false});
const H=g.blocks.length,W=g.blocks[0].length;
const col=g.blocks.map(r=>r.slice());
const gone=g.blocks.map(r=>r.map(()=>false));
const rows=g.spools.length, cols=g.spools[0].length;
function exposed(r,c){
  if(r===0||c===0||r===rows-1||c===cols-1) return true;
  return !g.spools[r-1][c]||!g.spools[r+1][c]||!g.spools[r][c-1]||!g.spools[r][c+1]||
         (g.spools[r-1][c]&&g.spools[r-1][c].id<=0)||(g.spools[r+1][c]&&g.spools[r+1][c].id<=0)||
         (g.spools[r][c-1]&&g.spools[r][c-1].id<=0)||(g.spools[r][c+1]&&g.spools[r][c+1].id<=0);
}
function reach(y,x){ if(y===0||x===0||y===H-1||x===W-1) return true;
  return gone[y-1][x]||gone[y+1][x]||gone[y][x-1]||gone[y][x+1]; }
const picks=o.pickOrder||[];
const out=[];
for(const p of picks){
  if(p.chainIndex>0) continue;
  // 当前露出且未取的车
  const avail=[];
  for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){ const s=g.spools[r][c]; if(!s||!(s.id>0))continue; avail.push({r,c,s}); }
  // 可及像素计数
  const cnt={};
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){ if(gone[y][x])continue; if(!reach(y,x))continue; const c2=col[y][x]; cnt[c2]=(cnt[c2]||0)+1; }
  const canFill=avail.filter(a=>(cnt[a.s.id]||0) >= a.s.count).length;
  out.push({step:p.step, avail:avail.length, canFill, ratio: avail.length?canFill/avail.length:0});
  // 推进：吃掉这次的车
  const c=p.color; const list=[];
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){ if(gone[y][x]||col[y][x]!==c)continue; if(!reach(y,x))continue; list.push([(H-1-y)+x,y,x]); }
  list.sort((a,b)=>a[0]-b[0]);
  let n=0; for(const [d,y,x] of list){ if(n>=p.count)break; gone[y][x]=true; n++; }
  // 移除该车
  const cell=g.spools[p.r][p.c]; if(cell) cell.id=-99;
}
const N=out.length;
const seg=(a,b)=>{const s=out.slice(Math.floor(N*a),Math.floor(N*b));return s.length?(100*s.reduce((x,y)=>x+y.ratio,0)/s.length).toFixed(0):'-';};
console.log(f.split('/').slice(-1)[0].padEnd(24),
  '整体可吃满率='+(100*out.reduce((x,y)=>x+y.ratio,0)/N).toFixed(0)+'%',
  '| 前20%='+seg(0,0.2)+'%','中60%='+seg(0.2,0.8)+'%','后20%='+seg(0.8,1)+'%');
const mid=out.slice(Math.floor(N*0.45),Math.floor(N*0.55));
console.log('   45–55% 区间：平均可点 '+ (mid.reduce((s,x)=>s+x.avail,0)/mid.length).toFixed(1) +' 辆，其中能一口吃满 '+(mid.reduce((s,x)=>s+x.canFill,0)/mid.length).toFixed(1)+' 辆');
