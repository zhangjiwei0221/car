// 新指标：每次取车时，该颜色的「可及像素」分布在几个象限（mode a：四边入口）
const B=require('/Users/red/Desktop/毛线汽车/03_工具/正式版/Build006Thickness_v688');
const A=B.loadSolver('corner');
const f=process.argv[2];
const g=B.readJson(f);
const lv=A.parseLevel(A.fromGameFormat(g));
const o=A.Solver.runSolver(lv,0,1,false,false,{capturePreviewStats:true,instantChain:false});
const H=g.blocks.length, W=g.blocks[0].length;
const col=g.blocks.map(r=>r.slice());
const gone=g.blocks.map(r=>r.map(()=>false));
const quad=(y,x)=>(y<H/2?0:2)+(x<W/2?0:1);
function reachable(y,x){
  if(y===0||x===0||y===H-1||x===W-1) return true;
  return gone[y-1][x]||gone[y+1][x]||gone[y][x-1]||gone[y][x+1];
}
const stat=[];
const picks=o.pickOrder||[];
for(const p of picks){
  if(p.chainIndex>0) continue;
  const c=p.color;
  // 当前可及的该色像素
  const qs=new Set(); const list=[];
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    if(gone[y][x]||col[y][x]!==c) continue;
    if(!reachable(y,x)) continue;
    qs.add(quad(y,x)); list.push([ (H-1-y)+x, y, x ]);
  }
  stat.push({step:p.step, color:c, quadrants:qs.size});
  // 吃掉：按距离升序（简化：不看链/冰，只吃本次容量）
  list.sort((a,b)=>a[0]-b[0]);
  let n=0;
  for(const [d,y,x] of list){ if(n>=p.count) break; gone[y][x]=true; n++; }
}
const n=stat.length;
const avg=stat.reduce((s,x)=>s+x.quadrants,0)/n;
const one=stat.filter(x=>x.quadrants===1).length;
const multi=stat.filter(x=>x.quadrants>=2).length;
console.log(f.split('/').slice(-1)[0].padEnd(22),
  '取车次数='+n, '| 平均可及象限='+avg.toFixed(2),
  '| 只有1个象限='+Math.round(100*one/n)+'%', '| ≥2个象限='+Math.round(100*multi/n)+'%');
console.log('   分布:', [1,2,3,4].map(k=>k+'象限:'+stat.filter(x=>x.quadrants===k).length).join('  '));
