'use strict';
// 从本目录的检查/pinterp/at4 产物生成 markdown 表格（stdout）
const fs=require('fs');
const R='/Users/red/Desktop/毛线汽车/实验关/产线v6/难度带/复现_开局冰';
const BASE={
 '194':{pinterp:R.replace('复现_开局冰','194')+'/pinterp_C2_早链',casual4242:'0.557'},
 '18':{pinterp:R.replace('复现_开局冰','18')+'/pinterp_C2_1112',casual4242:'0.670'},
 '205':{pinterp:R.replace('复现_开局冰','205')+'/pinterp_C1',casual4242:'0.487'},
};
function seg(dir){
  const all=JSON.parse(fs.readFileSync(dir+'/summary_all.json','utf8'));
  const byP={}; for(const r of all) byP[r.p]=r;
  const w=p=>byP[p]&&byP[p].winRate;
  const avg=a=>a.reduce((s,x)=>s+x,0)/a.length;
  const f=x=>+x.toFixed(3);
  return {curve:[0,0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1].map(p=>w(p)),
    casual:f(avg([0,0.1,0.2].map(w))), serious:f(avg([0.8,0.9,1].map(w))),
    gap:f(avg([0.8,0.9,1].map(w))-avg([0,0.1,0.2].map(w))),
    lt10:[0,0.1,0.2].map(p=>byP[p]&&byP[p].deathDist?byP[p].deathDist.lt10:null)};
}
function at4(file){
  if(!fs.existsSync(file)) return null;
  const lines=fs.readFileSync(file,'utf8').trim().split('\n').filter(Boolean).map(x=>JSON.parse(x));
  return lines.map(x=>'p'+x.p+' '+x.meanAt4+' ('+x.winRate+', steps '+x.meanSteps+')');
}
function j(p){return JSON.parse(fs.readFileSync(p,'utf8'));}
const levels=['194','18','205'];
const out=[];
out.push('### 主对照表（seed 977，100 局/p）');
out.push('');
out.push('| 关 | 变体 | 冰格与 param | 随意(p0/.1/.2) | 认真(p.8/.9/1) | gap | 倒序 | lt10 死亡局(p0/.1/.2) | at4 p.1/p.2 |');
out.push('|---|---|---|---:|---:|---:|---:|---|---|');
for(const L of levels){
  const bs=seg(BASE[L].pinterp);
  const ba=at4(R+'/at4_基线_'+L+'.txt');
  out.push(`| ${L} | 基线（原关） | — | ${bs.casual.toFixed(3)}（4242: ${BASE[L].casual4242}） | ${bs.serious.toFixed(3)} | +${bs.gap.toFixed(3)} | ${(()=>{let d=0,c=bs.curve;for(let i=1;i<c.length;i++)if(c[i]<c[i-1]-1e-9)d++;return d;})()} | ${bs.lt10.join('/')} | ${ba?ba.join(' ; '):'—'} |`);
  for(const T of ['A','B']){
    const dir=R+'/'+L+'/pinterp_'+T+'_977';
    const s=seg(dir);
    const plan=j(R+'/'+L+'/布置_'+T+'.json')[0];
    const cell=JSON.parse(fs.readFileSync(R+'/'+L+'/'+T+'_'+(T==='A'?'开局冰':'深行冰')+'.json','utf8')).spools[plan.r][plan.c];
    const a=at4(R+'/'+L+'/at4_'+T+'.txt');
    let desc=0; for(let i=1;i<s.curve.length;i++) if(s.curve[i]<s.curve[i-1]-1e-9) desc++;
    out.push(`| ${L} | ${T}（${T==='A'?'开局冰':'深行冰'}） | (${plan.r},${plan.c}) 色${cell.id}/${cell.count}，param ${plan.param} | ${s.casual.toFixed(3)} | ${s.serious.toFixed(3)} | ${s.gap>=0?'+':''}${s.gap.toFixed(3)} | ${desc} | ${s.lt10.join('/')} | ${a?a.join(' ; '):'—'} |`);
  }
}
out.push('');
out.push('### 逐 p 通关率');
out.push('');
out.push('| 关/变体 | p0 | .1 | .2 | .3 | .4 | .5 | .6 | .7 | .8 | .9 | 1 |');
out.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
for(const L of levels){
  const rows=[['基线',BASE[L].pinterp],['A 开局冰',R+'/'+L+'/pinterp_A_977'],['B 深行冰',R+'/'+L+'/pinterp_B_977']];
  for(const [name,dir] of rows){
    const s=seg(dir);
    out.push(`| ${L} ${name} | ${s.curve.map(x=>x===undefined?'—':x.toFixed(2)).join(' | ')} |`);
  }
}
out.push('');
out.push('### 硬门检查');
out.push('');
out.push('| 关/变体 | Solvable 宽8 | 棘轮 | 逃生阀 | 逐色守恒 | 无空格 | 开局可点 | Layout |');
out.push('|---|---|---|---|---|---:|---:|---|');
for(const L of levels){
  for(const T of ['A','B']){
    const sol=j(R+'/'+L+'/可通关_'+T+'.json');
    const rat=j(R+'/'+L+'/棘轮_'+T+'.json').summary;
    const ev=j(R+'/'+L+'/逃生阀_'+T+'.json').results[0];
    const cons=j(R+'/'+L+'/守恒_'+T+'.json');
    const lay=j(R+'/'+L+'/layout_'+T+'.json').rows[0];
    const arl=fs.readFileSync(R+'/'+L+'/arl_'+T+'.txt','utf8');
    const m=arl.match(/开局可点≥5\s+(\d+)/); const open=m?m[1]:'?';
    const es=arl.match(/无空格\s+(\d+)/); const empty=es?es[1]:'?';
    out.push(`| ${L} ${T} | ${sol.solvable?'true('+sol.steps+'步)':'false'} | ${rat.pass===1?'PASS('+rat.trapLevels+' trap)':'FAIL'} | ${ev.ok?'PASS(0 hit)':'FAIL'}${ev.valves&&ev.valves.length?' 阀'+ev.valves.length:' 阀0'} | ${cons.ok?cons.carTotal+'/'+cons.pxTotal+' ✓':'✗'} | ${empty} | ${open} | hard${lay.hard.length} warn${lay.warn.length} |`);
  }
}
console.log(out.join('\n'));
