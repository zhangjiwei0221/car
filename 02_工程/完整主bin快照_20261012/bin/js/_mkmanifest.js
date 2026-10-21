// 临时：汇总所有 55 像素 txt 图，按内容去重 + 尺寸过滤(~55) + 输出名去重，生成 manifest.json 供并行生产共享。用后即删。
const vm = require('vm'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = '/Users/red/Desktop/蚂蚁拿块游戏', jsDir = path.join(ROOT, 'bin/js'), TXT = path.join(ROOT, 'txt图');
const OUT = path.join(ROOT, '试验关卡/v93-生产_全部55像素'); fs.mkdirSync(OUT, { recursive: true });

const files = ['utils.js', 'simulator.js', 'solver-strategy.js', 'solver.js', 'playersim.js', 'analysis.js', 'generator.js'];
const sandbox = { console: console, module: { exports: {} }, WeakMap: WeakMap, Map: Map, Set: Set, setTimeout: setTimeout, clearTimeout: clearTimeout };
vm.createContext(sandbox);
for (const f of files) vm.runInContext(fs.readFileSync(path.join(jsDir, f), 'utf8'), sandbox, { filename: f });
const G = sandbox.AntSolver.Generator;

// 候选：4 个 55 像素文件夹全部 + 其它位置名字含"55像素"的
const folders = ['55*55txt图', '55像素合格txt', '26.7.21 55像素图60张', '55像素第二批20-80修改7.23'];
let cands = [];
function walk(dir) { fs.readdirSync(dir).forEach(n => { const p = path.join(dir, n); const st = fs.statSync(p); if (st.isDirectory()) walk(p); else if (/\.txt$/i.test(n)) cands.push(p); }); }
folders.forEach(d => { const p = path.join(TXT, d); if (fs.existsSync(p)) walk(p); });
// 其它文件夹里名字含 55像素 的
(function otherScan(dir) {
  fs.readdirSync(dir).forEach(n => {
    const p = path.join(dir, n), st = fs.statSync(p);
    if (st.isDirectory()) { if (!folders.includes(n)) otherScan(p); }
    else if (/\.txt$/i.test(n) && /55像素/.test(n)) cands.push(p);
  });
})(TXT);
cands = Array.from(new Set(cands)).sort();

const seenContent = {}, usedName = {}, manifest = [];
let dupContent = 0, badDim = 0;
for (const p of cands) {
  const txt = fs.readFileSync(p, 'utf8');
  const h = crypto.createHash('md5').update(txt).digest('hex');
  if (seenContent[h]) { dupContent++; continue; }
  seenContent[h] = 1;
  let blocks; try { blocks = G.blocksFromTXT(txt); } catch (e) { badDim++; continue; }
  const rows = blocks.length, cols = blocks.reduce((m, r) => Math.max(m, r.length), 0);
  if (rows < 50 || rows > 58 || cols < 50 || cols > 58) { badDim++; continue; }   // 只留 ~55 像素
  let base = path.basename(p).replace(/\.txt$/i, '').replace(/[\\/:*?"<>|]/g, '_');
  let name = base, k = 2; while (usedName[name]) { name = base + '_' + (k++); }
  usedName[name] = 1;
  manifest.push({ name: name, path: p, rows: rows, cols: cols });
}
manifest.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 0));
console.log('候选=' + cands.length + ' 内容重复=' + dupContent + ' 尺寸不符/解析失败=' + badDim + ' → 最终唯一55像素图=' + manifest.length);
const dimCount = {}; manifest.forEach(m => { const k = m.rows + 'x' + m.cols; dimCount[k] = (dimCount[k] || 0) + 1; });
console.log('尺寸分布: ' + JSON.stringify(dimCount));
