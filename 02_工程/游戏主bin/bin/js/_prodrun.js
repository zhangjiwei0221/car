// 临时生产(参数化)：argv=[startIdx,count,tag]。读 manifest.json，按 v91 参数(但 easyRatioPercent=100→全部只需简单合格即可、
// 早停更快、且合格关必然满足"前中期不过压")对每张图 produce()。结果写 _parts/part_<tag>.json。用后即删。
const vm = require('vm'), fs = require('fs'), path = require('path');
const ROOT = '/Users/red/Desktop/蚂蚁拿块游戏', jsDir = path.join(ROOT, 'bin/js');
const OUT = path.join(ROOT, '试验关卡/v93-生产_全部55像素');
const START = parseInt(process.argv[2], 10), COUNT = parseInt(process.argv[3], 10), TAG = process.argv[4];
const partsDir = path.join(OUT, '_parts'); fs.mkdirSync(partsDir, { recursive: true });
const PLOG = path.join(partsDir, '_prog_' + TAG + '.log'); fs.writeFileSync(PLOG, '');
function log(s) { fs.appendFileSync(PLOG, s + '\n'); }

const files = ['utils.js', 'simulator.js', 'solver-strategy.js', 'solver.js', 'playersim.js', 'analysis.js', 'generator.js'];
const sandbox = { console: console, module: { exports: {} }, WeakMap: WeakMap, Map: Map, Set: Set, setTimeout: setTimeout, clearTimeout: clearTimeout };
vm.createContext(sandbox);
for (const f of files) vm.runInContext(fs.readFileSync(path.join(jsDir, f), 'utf8'), sandbox, { filename: f });
const A = sandbox.AntSolver, G = A.Generator;

const scheme = JSON.parse(fs.readFileSync(path.join(ROOT, '方案文件夹/方案_v91.json'), 'utf8'));
const CONFIG = Object.assign({}, scheme.config, { easyRatioPercent: 100 });   // 全部按"简单合格即可"生产
const manifest = JSON.parse(fs.readFileSync(path.join(OUT, 'manifest.json'), 'utf8'));
const TOTAL = manifest.length;
// easySlot：easyRatioPercent=100 → 全 true → 全部 requireHardPass=false
const easyRatio = (CONFIG.easyRatioPercent != null ? CONFIG.easyRatioPercent : 30) / 100;
const easySlot = []; { let acc = 0; for (let i = 0; i < TOTAL; i++) { acc += easyRatio; if (acc >= 1) { easySlot[i] = true; acc -= 1; } else easySlot[i] = false; } }

function pmFromSamples(samples, totalBoxes, completed) {
  var N = totalBoxes || 1;
  if (!samples || !samples.length) return { avgAll: 0, avg50: 0, maxWin: 0, completedRate: completed ? 1 : 0, runs: 1 };
  var bufs = samples.map(x => x.buf);
  var avgAll = bufs.reduce((a, b) => a + b, 0) / bufs.length;
  var s50 = samples.filter(x => x.done / N >= 0.5).map(x => x.buf);
  var avg50 = s50.length ? s50.reduce((a, b) => a + b, 0) / s50.length : 0;
  var maxWin = 0;
  for (var w = 0.5; w < 0.999; w += 0.1) {
    var ws = samples.filter(x => { var pr = x.done / N; return pr >= w && pr < w + 0.1; }).map(x => x.buf);
    if (ws.length) { var a = ws.reduce((p, q) => p + q, 0) / ws.length; if (a > maxWin) maxWin = a; }
  }
  return { avgAll: +avgAll.toFixed(2), avg50: +avg50.toFixed(2), maxWin: +maxWin.toFixed(2), completedRate: completed ? 1 : 0, runs: 1 };
}
function genBuildRec(entry, result) {
  var parsed = A.parseLevel(result.level), sr = result.solveResult || {}, samples = sr.pressureSamples || [];
  var pm = pmFromSamples(samples, parsed.totalBoxes, !!sr.completed);
  var audit = result.audit || (A.Analysis ? A.Analysis.chokepointAudit(samples, parsed.totalBoxes, result.level.bufferLimit) : null);
  return {
    name: entry.name, txt: entry.txt || null, level: result.level, valid: result.valid,
    steps: sr.steps, maxBuffer: sr.maxBuffer, progress: sr.progress,
    difficulty: result.difficulty ? result.difficulty.score : 0,
    grade: result.difficulty ? result.difficulty.grade : '-',
    obstacleNames: result.difficulty ? result.difficulty.obstacleNames : '',
    pm: pm, audit: audit,
    fallback: !!result.fallback, fallbackTier: result.fallbackTier != null ? result.fallbackTier : null,
    fallbackType: result.fallbackType || null, fallbackReason: result.fallbackReason || null,
    generationEval: result.generationEval || null,
    solve: {
      completed: !!sr.completed, retryRound: sr.retryRound || 0, steps: sr.steps, maxBuffer: sr.maxBuffer,
      avgBuffer: sr.avgBuffer, progress: sr.progress, completedBoxes: sr.completedBoxes, totalBoxes: sr.totalBoxes,
      itemUses: sr.itemUses || 0, pickOrder: sr.pickOrder || [],
      stepStats: sr.stepStats || [],   // v113：与 app.js 落库/导出三处同口径（每 pick 的盒数与暂存三态）
      stepBufferHistory: sr.stepBufferHistory || [], pressureSamples: samples
    }
  };
}

const recs = [], partPath = path.join(partsDir, 'part_' + TAG + '.json');
log('tag=' + TAG + ' 范围=[' + START + ',' + (START + COUNT) + ') 总=' + TOTAL + ' 单关限时=' + ((CONFIG.timeBudgetMs || 300000) / 1000) + 's easyRatio=100 ' + new Date().toISOString());
for (let i = 0; i < COUNT && (START + i) < TOTAL; i++) {
  const gi = START + i, m = manifest[gi], name = m.name;
  const txt = fs.readFileSync(m.path, 'utf8');
  const isEasy = !!easySlot[gi];
  log('START\t' + (gi + 1) + '\t' + name + '\t' + new Date().toISOString());
  let blocks; try { blocks = G.blocksFromTXT(txt); } catch (e) { log('ERR-parse\t' + (gi + 1) + '\t' + name + '\t' + e.message); continue; }
  const cfg = Object.assign({}, CONFIG, { mapSize: blocks.length, requireHardPass: !isEasy });
  const t0 = Date.now(); let res;
  try { res = G.produce(blocks, cfg); } catch (e) { log('ERR-produce\t' + (gi + 1) + '\t' + name + '\t' + e.message); continue; }
  const rec = genBuildRec({ name: name, txt: txt }, res); rec._gi = gi;
  recs.push(rec);
  fs.writeFileSync(partPath, JSON.stringify(recs));
  const ms = Date.now() - t0, a = rec.audit;
  const tier = a && a.pass ? '困难合格' : (a && a.easyPass ? '简单合格' : (rec.fallback ? ('兜底/' + (rec.fallbackType || '')) : '?'));
  log('DONE\t' + (gi + 1) + '\t' + name + '\t' + (ms / 1000).toFixed(1) + 's\t' + tier + '\t难度' + rec.difficulty + '[' + rec.grade + ']');
}
log('RANGE-DONE\t' + TAG);
