const fs = require('fs'), vm = require('vm'), path = require('path');
const ctx = { SS: {}, console, Object, Math, Array, JSON };
vm.createContext(ctx);
['colors.js', 'level-loader.js', 'engine.js', 'solver.js', 'analysis.js', 'player-solver.js', 'generator.js'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'js', f), 'utf8'), ctx, { filename: f });
});
const E = ctx.SS.Engine, L = ctx.SS.LevelLoader, S = ctx.SS.Solver, A = ctx.SS.Analysis, P = ctx.SS.PlayerSolver;
const dir = path.join(__dirname, '..', '0617_40关_难度10-87', '合格关卡');

function extractGenParams(st) {
  var K = st.colCount, H = st.rowCount;
  var ice = 0, rock = 0, cover = 0, fixed = 0, keylock = 0, surprise = 0;
  var iceDurs = [], dualBases = {}, topColors = {}, baseColors = {}, bombStepsArr = [];
  for (var c = 0; c < K; c++) {
    if (st.iceReq && st.iceReq[c] > 0) { ice++; iceDurs.push(st.iceReq[c]); }
    if (st.rockLocked && st.rockLocked[c]) rock++;
    if (st.coverReq && st.coverReq[c]) cover++;
    if (st.fixedColor && st.fixedColor[c]) fixed++;
    var col = st.columns[c];
    for (var i = 0; i < col.length; i++) {
      var cell = col[i]; if (!cell) continue;
      if (cell.kind === 'color' && cell.colorKey) baseColors[cell.colorKey] = 1;
      if (cell.kind === 'dual') { dualBases[cell.colorKey] = 1; if (cell.topColorKey) topColors[cell.topColorKey] = 1; }
      if (cell.bomb != null) bombStepsArr.push(cell.bomb);
      if (cell.features) { if (cell.features.indexOf('Surprise') !== -1) surprise++; if (cell.features.indexOf('Lock') !== -1) keylock++; }
    }
  }
  var links = (st.links && st.links.length) ? st.links.length : 0;
  var palette = {}; Object.keys(baseColors).forEach(k => palette[k] = 1); Object.keys(topColors).forEach(k => palette[k] = 1); Object.keys(dualBases).forEach(k => delete palette[k]);
  var colorCount = Math.max(2, Math.min(K, Object.keys(palette).length || K));
  var combo = {};
  if (surprise) combo.Surprise = surprise; if (ice) combo.Ice = ice; if (rock) combo.Rock = rock;
  if (fixed) combo.FixedColor = fixed; if (cover) combo.CoveredColor = cover; if (keylock) combo.KeyLock = keylock;
  if (links) combo.Linked = links; if (Object.keys(dualBases).length) combo.Dual = Object.keys(dualBases).length;
  return { H, K, colorCount, combo };
}
function levelKey(n) { var m = n.match(/第\s*(\d+)\s*关/); if (m) return +m[1]; var m2 = n.match(/(\d+)/); return m2 ? +m2[1] : 9e15; }

var files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, ''));
files.sort((a, b) => levelKey(a) - levelKey(b));
var recs = [];
files.forEach(function (nm) {
  ctx.SS.Colors.reset();
  var lvl = L.parse(JSON.parse(fs.readFileSync(path.join(dir, nm + '.json'), 'utf8')));
  var st = E.createState(lvl.boards[0], lvl.stepCount);
  if (!S.validateLevel(st).valid) { console.log(nm + ' 不合法'); return; }
  var info = extractGenParams(st);
  var obs = A.obstaclesFromState(st);
  var r = A.multiSolve(E.createState(lvl.boards[0], 999), 4, 20);
  info.score = r.best != null ? 50 : null;  // 简化
  info.sig = info.H + 'x' + info.K + 'x' + info.colorCount + '|' + Object.keys(info.combo).sort().map(k => k + ':' + info.combo[k]).join(',');
  recs.push(info);
});
console.log('recs=' + recs.length);
// 1-10 分组
var SIZE = 10;
for (var start = 0; start < recs.length; start += SIZE) {
  var members = recs.slice(start, start + SIZE);
  console.log('组 关' + (start + 1) + '-' + (start + members.length) + ' 代表sig=' + members[0].sig);
}
