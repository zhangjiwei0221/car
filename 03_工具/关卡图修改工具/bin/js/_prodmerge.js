// 临时合并：读 _parts/part_*.json 按全局序合并，复刻 app.finishBatch 产出：关卡/ + txt图/ + 关卡数据/(数据json+CSV+报告)。用后即删。
const vm = require('vm'), fs = require('fs'), path = require('path');
const ROOT = '/Users/red/Desktop/蚂蚁拿块游戏', jsDir = path.join(ROOT, 'bin/js');
const OUT = path.join(ROOT, '试验关卡/v93-生产_全部55像素'), partsDir = path.join(OUT, '_parts');
const files = ['utils.js', 'simulator.js', 'solver-strategy.js', 'solver.js', 'playersim.js', 'analysis.js', 'generator.js'];
const sandbox = { console: console, module: { exports: {} }, WeakMap: WeakMap, Map: Map, Set: Set, setTimeout: setTimeout, clearTimeout: clearTimeout };
vm.createContext(sandbox);
for (const f of files) vm.runInContext(fs.readFileSync(path.join(jsDir, f), 'utf8'), sandbox, { filename: f });
const A = sandbox.AntSolver;
const CONFIG = Object.assign({}, JSON.parse(fs.readFileSync(path.join(ROOT, '方案文件夹/方案_v91.json'), 'utf8')).config, { easyRatioPercent: 100 });
function safeName(n) { return String(n).replace(/\.txt$/i, '').replace(/[\\/:*?"<>|]/g, '_'); }
function blocksToTXT(b) { return b.map(r => r.map(v => v > 0 ? v : 0).join(' ')).join('\n'); }

let results = [];
fs.readdirSync(partsDir).filter(n => /^part_.*\.json$/.test(n)).forEach(f => { results = results.concat(JSON.parse(fs.readFileSync(path.join(partsDir, f), 'utf8'))); });
results.sort((a, b) => (a._gi || 0) - (b._gi || 0));

const dL = path.join(OUT, '关卡'), dT = path.join(OUT, 'txt图'), dD = path.join(OUT, '关卡数据');
[dL, dT, dD].forEach(d => fs.mkdirSync(d, { recursive: true }));

const passCount = results.filter(r => r.valid).length;
const hardCount = results.filter(r => r.audit && r.audit.tier === '困难合格').length;
const easyCount = results.filter(r => r.audit && r.audit.tier === '简单合格').length;
const fbTimeout = results.filter(r => r.fallback && r.fallbackType === 'timeout').length;
const fbExhausted = results.filter(r => r.fallback && r.fallbackType === 'exhausted').length;
const gradeCount = {}; results.forEach(r => { gradeCount[r.grade] = (gradeCount[r.grade] || 0) + 1; });
const gradeStr = Object.keys(gradeCount).map(g => g + ':' + gradeCount[g]).join(' ');

const used = {}, dataLevels = [];
const csv = ['关卡,尺寸,棋盘,盒数,可解,难度分,难度等级,障碍,峰值暂存,均暂存,50%后均暂,50%后峰窗,求解遍可通率,审核合格,合格档,是否兜底,兜底类型,生成诊断分,全知后期封锁,玩家后期封锁,玩家暂存峰,玩家通关,卡点@,前期峰窗,中期峰窗,后期峰窗,不合格原因'];
for (let i = 0; i < results.length; i++) {
  const r = results[i]; let base = safeName(r.name); if (used[base]) base = base + '_' + i; used[base] = true;
  const lv = r.level, pr = A.parseLevel(lv);
  fs.writeFileSync(path.join(dL, base + '.json'), JSON.stringify(A.toGameFormat(pr), null, 2));
  fs.writeFileSync(path.join(dT, base + '.txt'), r.txt || blocksToTXT(lv.blocks));
  dataLevels.push({
    name: r.name, valid: r.valid, difficulty: r.difficulty, grade: r.grade, bufferLimit: lv.bufferLimit,
    blocks: lv.blocks, board: lv.board, audit: r.audit || null,
    fallback: !!r.fallback, fallbackTier: r.fallbackTier != null ? r.fallbackTier : null,
    fallbackType: r.fallbackType || null, fallbackReason: r.fallbackReason || null,
    generationEval: r.generationEval || null, solve: r.solve || null
  });
  const pm = r.pm || { avgAll: 0, avg50: 0, maxWin: 0, completedRate: 0 };
  const au = r.audit || { pass: false, lateAt: null, earlyMax: 0, midMax: 0, lateMax: 0, reasons: [] };
  const ge = r.generationEval || { score: 0, omni: { preview: {} }, player: { preview: {}, peak: 0, won: false } };
  const gop = ge.omni.preview || {}, gpp = ge.player.preview || {};
  csv.push(['"' + r.name + '"', pr.rows + 'x' + pr.cols, (lv.board ? lv.board.rows + 'x' + lv.board.cols : ''), pr.totalBoxes,
    (r.valid ? '是' : '否'), r.difficulty, r.grade, '"' + (r.obstacleNames || '无') + '"',
    r.maxBuffer, pm.avgAll, pm.avg50, pm.maxWin, Math.round(pm.completedRate * 100) + '%',
    (au.pass ? '合格' : '不合格'), (au.tier || (au.pass ? '困难合格' : (au.easyPass ? '简单合格' : '不合格'))),
    (r.fallback ? '是' : '否'), (r.fallbackType || '-'), ge.score || 0,
    Math.round((gop.lateAvgLockRatio || 0) * 100) + '%', Math.round((gpp.lateAvgLockRatio || 0) * 100) + '%',
    ge.player.peak || 0, (ge.player.won ? '是' : '否'),
    (au.lateAt != null ? au.lateAt + '%' : '-'), au.earlyMax, au.midMax, au.lateMax, '"' + (au.reasons.join('；') || '') + '"'].join(','));
}
fs.writeFileSync(path.join(dD, '关卡数据.json'), JSON.stringify({ type: 'ant-level-data', exported: new Date().toISOString(), total: results.length, levels: dataLevels }, null, 2));
fs.writeFileSync(path.join(dD, '分析报告.csv'), '\ufeff' + csv.join('\n'));

const auditPass = results.filter(r => r.audit && r.audit.pass), bl = CONFIG.bufferLimit || 5;
let md = '# 生产报告\n\n';
md += '- 生成时间: ' + new Date().toLocaleString() + '\n';
md += '- 关卡总数: ' + results.length + ' · 可解: ' + passCount + ' · 审核合格: ' + auditPass.length + '\n';
md += '- 难度分布: ' + gradeStr + '\n';
md += '- 生产口径: 全部按【简单合格即可】(easyRatioPercent=100，不强制真卡点)，合格关必然满足前中期不过压\n';
md += '- 卡点审核标准(暂存上限 ' + bl + ')：高压阈值=' + (bl - 1.5) + '(上限−1.5) · 中压阈值=' + (bl - 2.5) + '(上限−2.5)\n';
md += '  - ①50%后至少1个10%窗口均值≥高压(卡点) ②前期0-20%无窗口≥中压 ③中期20-50%无窗口≥高压\n\n';
md += '## 生成参数\n```json\n' + JSON.stringify(CONFIG, null, 2) + '\n```\n\n';
md += '## 审核合格关卡（' + auditPass.length + '）\n';
if (auditPass.length) auditPass.forEach(r => { const a = r.audit; md += '- ' + r.name + '：难度' + r.difficulty + '[' + r.grade + '] 卡点@' + a.lateAt + '%(峰窗' + a.lateMax + ') · 前期' + a.earlyMax + ' 中期' + a.midMax + '\n'; });
else md += '（本批无合格关卡）\n';
const fbList = results.filter(r => r.fallback);
if (fbList.length) { md += '\n## 兜底关卡（' + fbList.length + '，非正常合格输出）\n'; fbList.forEach(r => { const t = r.fallbackType === 'timeout' ? '超时兜底' : '遍历完兜底'; const tr = r.fallbackTier === 1 ? '安全兜底(可通关未成卡点)' : '最接近标准(仍不合格)'; md += '- ' + r.name + '：[' + t + '·' + tr + '] ' + (r.fallbackReason || '') + '\n'; }); }
const auditFail = results.filter(r => r.valid && (!r.audit || !r.audit.pass) && !r.fallback);
if (auditFail.length) { md += '\n## 不合格明细（' + auditFail.length + '）\n'; auditFail.forEach(r => { const a = r.audit || { reasons: ['无审核数据'] }; md += '- ' + r.name + '：' + (a.reasons.join('；') || '不合格') + '\n'; }); }
fs.writeFileSync(path.join(dD, '生产报告.md'), md);

console.log('合并完成: 共 ' + results.length + ' 关 · 可解 ' + passCount + ' · 审核合格 ' + auditPass.length + '(困难' + hardCount + '/简单' + easyCount + ') · 兜底 ' + fbList.length + '(超时' + fbTimeout + '/穷尽' + fbExhausted + ') · 难度 ' + gradeStr);
