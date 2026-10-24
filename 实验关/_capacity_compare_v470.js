const vm=require('vm'),fs=require('fs'),path=require('path');
const BIN='02_工程/完整主bin快照_20261012/bin/js';
const FILES=['utils.js','color-libs.js','simulator.js','solver-strategy.js','solver.js','playersim.js','analysis.js','generator.js'];
const sb={console:{log(){},warn(){},error(){}},module:{exports:{}},WeakMap,Map,Set,setTimeout,clearTimeout,Infinity,Math,JSON,Date};
vm.createContext(sb); for(const f of FILES) vm.runInContext(fs.readFileSync(path.join(BIN,f),'utf8'),sb,{filename:f});
const G=sb.AntSolver.Generator;
const images=[
 {name:'006', file:'实验关/35x35拼接图纸_006.txt'},
 {name:'好图', file:'实验关/好图_35x35_碎块_20261023.txt'}
];
const out='实验关/容量对比_v470.jsonl';
fs.writeFileSync(out,'');
for(const img of images){
  const blocks=G.blocksFromTXT(fs.readFileSync(img.file,'utf8'));
  const b=G.deriveCapacityBand(blocks);
  const band=b.band||[b.chosen,b.chosen];
  const lo=band[0], hi=band[1], mid=b.chosen||lo;
  const profiles=[
    {tag:'lo', cap:lo, cut:null},
    {tag:'mid', cap:mid, cut:null},
    {tag:'hi', cap:hi, cut:null},
    {tag:'mid_expose', cap:mid, cut:'exposeCut'},
    {tag:'mid_layer', cap:mid, cut:'layerCut2'}
  ];
  const seen={};
  for(const prof of profiles){
    if(seen[prof.tag]) continue; seen[prof.tag]=1;
    const cfg=Object.assign({},G.DEFAULT_CONFIG,{
      boxSizeMin:prof.cap,boxSizeMax:prof.cap,capNormMin:prof.cap,capNormMax:prof.cap,
      boardRowsMin:6,boardRowsMax:9,boardColsMin:6,boardColsMax:10,
      candidateCount:1,portfolioK:1,difficultyRounds:1,timeBudgetMs:60000,
      generatorFlow:'old',targetCarCount:0,hardOnly:true,acceptMode:'target',
      targetPeakMin:3.2,targetPeakMax:4.8,targetSteadyMin:0,targetSteadyMax:100,
      targetBand3Min:0,targetBand4Min:0,targetPlayerPassMin:0.2,targetPlayerPassMax:80,
      targetWMin:0,targetWLowMax:100,targetHiddenDeathMax:20,
      p7Repair:true,p7BaseCount:1,boardFirst:true,row0FreeMax:1,row0FreeIce:1,
      costlyAlt:false,semanticObstacles:false,semanticEarly:false,semanticRouteLock:false,
      fullTime:false,trapPost:false,cutMode:prof.cut||undefined,seed:1001
    });
    const t0=Date.now(); let r=null,err=null;
    try{ r=G.produce(blocks,cfg); }catch(e){ err=String(e&&e.message||e); }
    const pp=r&&r.goodV3&&r.goodV3.persist||{}, q=pp.quality||{}, fc=r&&r.goodV3&&r.goodV3.fillCurve||{};
    let cars=0,small=0;
    if(r&&r.level&&r.level.board){for(const row of r.level.board.cells)for(const x of row||[]){if(x&&x.t==='box'){cars++;if(x.count<prof.cap)small++;}}}
    const row={img:img.name,profile:prof.tag,cap:prof.cap,cut:prof.cut||'auto',ms:Date.now()-t0,valid:!!(r&&r.level),gate:G.goalStructPass(r),
      cars,small,carsSmallPct:cars?Math.round(small/cars*100):null,
      select:fc.selectMedian,full:fc.fullMedian2,forced:fc.forcedPct,partial:fc.partialStepPct,
      freeLow:fc.freeLowPct,freeRun:fc.freeRunMax,first:pp.playerPassPct,learned:pp.learnedPassPct,look:pp.lookaheadPassPct,T:q.T,R:q.R,
      board:r&&r.level&&r.level.board?r.level.board.rows+'x'+r.level.board.cols:null,
      p7ms:r&&r.p7&&r.p7.ms,err};
    fs.appendFileSync(out,JSON.stringify(row)+'\n');
    console.log(JSON.stringify(row));
  }
}
