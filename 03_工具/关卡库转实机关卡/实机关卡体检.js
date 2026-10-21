// 实机关卡体检：读「官方 5 键」关卡 JSON，核对结构/守恒/障碍统计（只读，不改文件）
// 用法: node 实机关卡体检.js <关卡.json> [更多.json ...]
const fs = require('fs');
for (const p of process.argv.slice(2)) {
  const g = JSON.parse(fs.readFileSync(p, 'utf8'));
  const keys = Object.keys(g);
  const ok5 = ['toprow','blocks','maprow','mapcol','spools'].every(k => k in g);
  let boxes=0, blacks=0, pipes=0, chains=0, qs=0, numice=0, capSum=0, cells=0, bad=0;
  const groups = new Set();
  for (const row of g.spools || []) for (const sp of row) {
    cells++;
    if (!sp || typeof sp !== 'object' || !('id' in sp)) { bad++; continue; }
    const ts = Array.isArray(sp.type) ? sp.type : (sp.type ? [sp.type] : []);
    if (sp.id === -1) blacks++;
    else if (ts.some(t => t >= 11 && t <= 14)) { pipes++; for (const q of (Array.isArray(sp.param)?sp.param:[])) capSum += q.count || 0; }
    else if (sp.id > 0) { boxes++; capSum += sp.count || 0; }
    if (ts.includes(5)) { chains++; groups.add(Array.isArray(sp.param) ? sp.param[ts.indexOf(5)] : sp.param); }
    if (ts.includes(6)) qs++;
    if (ts.includes(7)) numice++;
  }
  let pixels=0; const colors=new Set();
  for (const row of g.blocks || []) for (const v of row) if (v > 0) { pixels++; colors.add(v); }
  console.log('【' + p + '】');
  console.log('  结构: 键 ' + keys.join(',') + (ok5 ? '  ✓ 是实机 5 键本体' : '  ✗ 不是实机本体（缺 ' + ['toprow','blocks','maprow','mapcol','spools'].filter(k=>!(k in g)).join('/') + '）'));
  console.log('  尺寸: 目标图 ' + g.toprow + ' 行 × ' + (g.blocks&&g.blocks[0]?g.blocks[0].length:0) + ' 列 | 车场 ' + g.maprow + '×' + g.mapcol + '（' + cells + ' 格' + (bad? '，异常格 '+bad : '') + '）');
  console.log('  构成: 盒 ' + boxes + ' / 黑块 ' + blacks + ' / 管道 ' + pipes + ' / 链格 ' + chains + '（' + groups.size + ' 组：' + [...groups].sort((a,b)=>a-b).join(',') + '）/ 问号 ' + qs + ' / 数字冰 ' + numice);
  console.log('  守恒: 车上载客 ' + capSum + ' vs 板上像素 ' + pixels + ' → ' + (capSum === pixels ? '✓ 一致' : '✗ 差 ' + (capSum - pixels)) + ' | 颜色数 ' + colors.size);
}
