#!/usr/bin/env node
'use strict';
// 冰+问号布置：只改选中格的 type/param；链格/颜色/容量/目标图不动。
// 用法: node 布置_v1_<pid>.js <src.json> <out.json> '<plan-json>'
// plan: [{"r":0,"c":2,"type":7,"param":5}, ...]
const fs=require('fs');
const [src,out,planStr]=process.argv.slice(2);
const g=JSON.parse(fs.readFileSync(src,'utf8'));
const plan=JSON.parse(planStr);
const key=new Set();
for(const e of plan){
  const {r,c,type,param}=e;
  if(r<0||r>=g.spools.length||c<0||c>=g.spools[r].length) throw new Error('out of range '+r+','+c);
  if(key.has(r+','+c)) throw new Error('dup '+r+','+c); key.add(r+','+c);
  const s=g.spools[r][c];
  if(!s||!(s.id>0)) throw new Error('not a car '+r+','+c);
  const ts=Array.isArray(s.type)?s.type:[s.type];
  if(ts.includes(5)) throw new Error('chain cell forbidden '+r+','+c);
  s.type=type; s.param=param;
  if(type===6) s.q=true; else delete s.q;
}
fs.writeFileSync(out,JSON.stringify(g,null,1));
console.log('wrote',out,'edits',plan.length);
