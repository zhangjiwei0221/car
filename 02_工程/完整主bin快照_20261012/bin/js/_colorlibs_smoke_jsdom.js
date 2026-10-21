/**
 * 【色库 v154】浏览器端冒烟测试（jsdom）
 *   node js/_colorlibs_smoke_jsdom.js
 *
 * 需要 jsdom（本工程是纯静态页面，不带这个依赖）。三种找到它的方式：
 *   ① 当前 Node 环境能 require('jsdom')；
 *   ② 设环境变量 JSDOM_PATH 指到装了 jsdom 的 node_modules；
 *   ③ 临时装一份：mkdir -p /tmp/dsh-jsdom && cd /tmp/dsh-jsdom && npm i jsdom
 *      JSDOM_PATH=/tmp/dsh-jsdom/node_modules node js/_colorlibs_smoke_jsdom.js
 *   找不到 jsdom 时脚本打印上面这段并**正常退出**（不算失败），不会污染本工程目录。
 *
 * 真正把 bin/index.html 按浏览器的方式加载起来，然后：
 *   1) 页面 init 只跑一次、不报错，色库模块挂上；
 *   2) 导入一张**官方格式**（0-21，-1 空位）TXT：自动识别 → 转成老色库 → 0 号黄没被当空位；
 *   3) 色库面板：打开、对照表渲染、标出"本图用量"、"当前图色库"正确；
 *   4) 整批转换 官方→老→官方：提示与状态同步；
 *   5) 下载路径不崩；老格式（0 空位）TXT 仍按老色库读；
 *   6) 既有「导出JSON」流程未被弄坏。
 *
 * 注意（踩过的坑）：**不要手动 dispatch DOMContentLoaded** —— jsdom 自己会派发一次，
 *   手动再来一次会让 app.js 的 init() 跑两遍、事件绑两次，按钮点一下等于点两下，
 *   会得出"按钮失灵"的假结论。真实浏览器里 app.js 在解析期间加载，DOMContentLoaded 只来一次。
 */
'use strict';
const fs = require('fs');
const path = require('path');

// ---------- 找 jsdom（找不到就跳过，不算失败） ----------
function loadJsdom() {
  const tried = [];
  try { return require('jsdom'); } catch (e) { tried.push("require('jsdom')"); }
  const cands = [];
  if (process.env.JSDOM_PATH) cands.push(process.env.JSDOM_PATH);
  cands.push('/tmp/dsh-jsdom/node_modules', '/tmp/dsh-colorlib-test/node_modules');
  for (const c of cands) {
    try { return require(path.join(c, 'jsdom')); } catch (e) { tried.push(c); }
  }
  console.log('未找到 jsdom（已尝试：' + tried.join('、') + '）');
  console.log('本工程是纯静态页面、不带 jsdom 依赖。要跑这个冒烟测试请先：');
  console.log('  mkdir -p /tmp/dsh-jsdom && cd /tmp/dsh-jsdom && npm i jsdom');
  console.log('  JSDOM_PATH=/tmp/dsh-jsdom/node_modules node ' + path.relative(process.cwd(), __filename));
  console.log('（不跑也不影响功能：色库逻辑与端到端另有两个不依赖浏览器的测试）');
  process.exit(0);
}
const { JSDOM, VirtualConsole } = loadJsdom();

// 工程根：本脚本在 bin/js/ 下，往上一级就是 bin/
const BIN = path.join(__dirname, '..');
let fail = 0, warn = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.log('  ✗ ' + m); };
const warning = (m) => { warn++; console.log('  ! ' + m); };

const html = fs.readFileSync(path.join(BIN, 'index.html'), 'utf8');
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errors.push('jsdomError: ' + e.message));
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));
vc.on('warn', (...a) => { const s = a.join(' '); if (!/Not implemented/.test(s)) errors.push('console.warn: ' + s); });

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  resources: undefined,          // 不自动抓外部脚本：下面手动按顺序注入
  pretendToBeVisual: true,
  virtualConsole: vc,
  url: 'http://127.0.0.1:8000/'
});
const win = dom.window;

// jsdom 30 自带 FileReader，但它只接真正的 Blob/File；测试里用的是普通对象，
// 所以直接把 readAsText 换掉（保留 FileReader 类本身，app.js 里 new 出来的还是它）。
win.FileReader.prototype.readAsText = function (file) {
  const self = this;
  setTimeout(function () {
    // jsdom 的 result 是只读 getter，实例上重新定义一个可写的
    try { Object.defineProperty(self, 'result', { value: (file && file.__text != null) ? file.__text : '', writable: true, configurable: true }); }
    catch (e) { self._result = file && file.__text; }
    if (typeof self.onload === 'function') self.onload({ target: self });
  }, 0);
};

// 按 index.html 的顺序注入脚本
const order = ['zip.js', 'utils.js', 'color-libs.js', 'simulator.js', 'anchor-cut.js', 'solver-strategy.js',
               'solver.js', 'playersim.js', 'generator.js', 'analysis.js', 'level-editor.js', 'app.js'];
console.log('\n[A] 加载页面与脚本');
for (const f of order) {
  const code = fs.readFileSync(path.join(BIN, 'js', f), 'utf8');
  try {
    win.eval(code);
  } catch (e) {
    bad(f + ' 注入失败：' + e.message);
  }
}
if (win.AntSolver && win.AntSolver.ColorLibs) ok('AntSolver.ColorLibs 已挂上');
else bad('AntSolver.ColorLibs 未挂上');
if (typeof win.AntSolver.Generator.produce === 'function') ok('生成器可用');


const initErrs = errors.filter((e) => !/Not implemented|Could not parse CSS|localStorage/i.test(e));
if (initErrs.length) { bad('init 期间有报错：'); initErrs.slice(0, 5).forEach((e) => console.log('      ' + e)); }
else ok('init 期间没有报错');

// jsdom 没有 canvas 实现：给 getContext 一个够用的假 ctx（只记录调用，不做真实绘制）
(function stubCanvas() {
  const ctx = new Proxy({}, {
    get(t, k) {
      if (k === 'canvas') return null;
      if (k === 'measureText') return () => ({ width: 0 });
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
      if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
      if (typeof k === 'string') return t[k] !== undefined ? t[k] : function () {};
      return undefined;
    },
    set(t, k, v) { t[k] = v; return true; }
  });
  win.HTMLCanvasElement.prototype.getContext = function () { return ctx; };
  win.HTMLCanvasElement.prototype.toDataURL = function () { return 'data:image/png;base64,'; };
})();

// jsdom 不实现 URL.createObjectURL：全局打桩（导出/下载都会用）
win.URL.createObjectURL = function () { return 'blob:fake'; };
win.URL.revokeObjectURL = function () {};

const $ = (id) => win.document.getElementById(id);

// ---------- 构造两张测试 TXT ----------
// 官方格式：0 号色（黄）真的被用到，空位是 -1
const officialTxt = [
  '像素矩阵',
  '0 0 1 1 -1',
  '0 2 2 1 -1',
  '3 3 3 2 4',
  '3 -1 4 4 4'
].join('\n') + '\n';
// 老格式：0 = 空位
const legacyTxt = [
  '像素矩阵',
  '0 0 1 1 0',
  '0 2 2 1 0',
  '3 3 3 2 4',
  '3 0 4 4 4'
].join('\n') + '\n';

function importTxtFiles(list) {
  const input = $('txt-input');
  const files = list.map((x) => ({ name: x.name, __text: x.text }));
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  input.dispatchEvent(new win.Event('change', { bubbles: true }));
  // FileReader 的回调是 setTimeout，等两轮宏任务让读文件 + 第二遍解析都跑完
  return new Promise((res) => setTimeout(() => setTimeout(res, 0), 0));
}

(async function main() {
// 等 jsdom 自己派发 DOMContentLoaded（不要手动 dispatch：那样 init 会跑两次；
// 真实浏览器里 app.js 在解析期间加载，DOMContentLoaded 只来一次）
await new Promise((r) => {
  win.document.addEventListener('DOMContentLoaded', () => setTimeout(r, 0), { once: true });
  setTimeout(r, 80);
});
{
  const sel = $('colorlib-select');
  if (sel && sel.value === 'auto') ok('init() 已执行（读图色库下拉已初始化）');
  else bad('init() 似乎没执行（下拉值=' + (sel ? sel.value : '无元素') + '）');
}

console.log('\n[B] 导入官方格式 TXT（自动识别）');
await importTxtFiles([{ name: 'level_1.txt', text: officialTxt }]);
const hint = $('gen-colorlib-hint');
if (hint && /官方色库/.test(hint.textContent)) ok('提示行写明「已按官方色库读入并转成老色库 34 色」：' + hint.textContent.trim());
else bad('提示行没反映官方色库读入：' + (hint ? hint.textContent : '(无元素)'));

const listTxt = $('level-list');
if (listTxt && /level_1\.txt/.test(listTxt.textContent)) ok('关卡列表出现 level_1.txt');
else bad('关卡列表没有 level_1.txt');

const details = $('solve-details');
if (details && /官方色库 0-21 读入/.test(details.textContent)) ok('左栏说明显示按官方色库读入并转换');
else bad('左栏说明没显示色库信息：' + (details ? details.textContent.slice(0, 120) : '(无元素)'));

// 0 号色必须真的被当成黄色（== 转换后非空），-1 必须变空位
{
  const CL = win.AntSolver.ColorLibs;
  const raw = CL.parseTXT(officialTxt);
  const conv = CL.toSolver(raw);
  if (conv.matrix[0][0] !== 0 && conv.matrix[0][0] > 0) ok('官方 0 号色（黄）转换后是有效色（' + conv.matrix[0][0] + '），没被当成空位');
  else bad('官方 0 号色被当成空位了（正是要避免的 bug）');
  if (conv.matrix[0][4] === 0) ok('官方 -1 空位转换后是 0（求解器空位）');
  else bad('-1 没转成空位');
}

console.log('\n[C] 色库面板');
const panel = $('colorlib-panel');
if (panel.classList.contains('hidden')) ok('面板初始是收起的');
else bad('面板初始没收起');
$('btn-colorlib').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
if (!panel.classList.contains('hidden')) ok('点「🎨 色库转换」后面板打开');
else bad('点按钮后面板没打开');
await new Promise((r) => setTimeout(r, 0));   // 等面板渲染落定
const mapHtml = $('colorlib-map').innerHTML;
if (/<table/.test(mapHtml) && /源色号/.test(mapHtml) && /本图用量/.test(mapHtml))
  ok('色值对照表渲染出来了（' + ((mapHtml.match(/<tr/g) || []).length - 1) + ' 行映射 + 表头）');
else bad('对照表没渲染（innerHTML 长度 ' + mapHtml.length + '）开头：' + mapHtml.slice(0, 200).replace(/\n/g, ' '));
if (/colorlib-used/.test(mapHtml)) ok('对照表里标出了「本图用量」（高亮行）');
else bad('对照表没标出本图用量');
const curLibTxt = $('colorlib-current-lib').textContent;
if (/官方色库/.test(curLibTxt)) ok('「当前图色库」显示正确：' + curLibTxt.trim());
else bad('「当前图色库」显示不对：' + curLibTxt);

console.log('\n[D] 整批转换（官方 → 老 → 官方）');
// 注意：renderColorlibPanel() 每次都会把方向下拉设成「与当前图色库相反」，所以
// 每次转换前都要重新把方向显式设好 —— 这正是本次修掉的那个 bug（转换完再读方向会读到翻过的值）。
$('colorlib-scope').value = 'all';   // 'all' = 只改预览
$('colorlib-scope').value = 'all';
$('colorlib-direction').value = 'older';
$('colorlib-apply').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
let note = $('colorlib-note').textContent;
if (/老色库34色/.test(note)) ok('转换到老色库：' + note.trim());
else bad('转换到老色库没反馈：' + note);
if (/老色库 34 色/.test($('colorlib-current-lib').textContent)) ok('转换后「当前图色库」同步成了老色库 34 色');
else bad('转换后「当前图色库」没同步：' + $('colorlib-current-lib').textContent);

$('colorlib-direction').value = 'official';
$('colorlib-apply').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
note = $('colorlib-note').textContent;
if (/官方色库0-21/.test(note)) ok('转换回官方色库：' + note.trim());
else bad('转换回官方色库没反馈：' + note);

console.log('\n[E] 下载路径（download 模式）不崩');
{
  let clicked = 0;
  const origClick = win.HTMLAnchorElement.prototype.click;
  win.HTMLAnchorElement.prototype.click = function () { if (/blob:fake|\.txt$/.test(this.href || this.download || '')) clicked++; };
  $('colorlib-direction').value = 'older';
  $('colorlib-scope').value = 'download';
  let threw = false;
  try { $('colorlib-apply').dispatchEvent(new win.MouseEvent('click', { bubbles: true })); }
  catch (e) { threw = true; bad('download 模式抛异常：' + e.message); }
  win.HTMLAnchorElement.prototype.click = origClick;
  if (!threw) ok('download 模式走通，触发 ' + clicked + ' 次下载');
  $('colorlib-scope').value = 'all';
}

console.log('\n[F] 再导入老格式 TXT（0 空位）+ 改读图色库下拉');
await importTxtFiles([{ name: 'legacy.txt', text: legacyTxt }]);
{
  const d = $('solve-details').textContent;
  if (/老色库 34 色/.test(d)) ok('老格式 TXT 按老色库读入，说明正确');
  else bad('老格式 TXT 的说明不对：' + d.slice(0, 120));
}
$('colorlib-select').value = 'official';       // 手动指定按官方色库读老格式图
$('colorlib-select').dispatchEvent(new win.Event('change', { bubbles: true }));
if (errors.filter((e) => !/Not implemented|Could not parse CSS|localStorage/i.test(e)).length === 0)
  ok('改「读图色库」下拉触发重判，无报错');
else bad('改下拉后出现报错');
$('colorlib-select').value = 'auto';
$('colorlib-select').dispatchEvent(new win.Event('change', { bubbles: true }));

console.log('\n[G] 既有导出 JSON 流程未被破坏');
{
  let threw = false;
  try { $('btn-export').dispatchEvent(new win.MouseEvent('click', { bubbles: true })); }
  catch (e) { threw = true; bad('导出 JSON 抛异常：' + e.message); }
  if (!threw) ok('点「导出JSON」不抛异常');
}

console.log('\n[H] 汇总');
const leftover = errors.filter((e) => !/Not implemented|Could not parse CSS|localStorage|img|canvas/i.test(e));
if (leftover.length) { warning('仍有 ' + leftover.length + ' 条控制台输出：'); leftover.slice(0, 8).forEach((e) => console.log('      ' + e)); }
else ok('没有遗留控制台错误');

console.log('\n===== 冒烟测试：失败 ' + fail + ' 项，警告 ' + warn + ' 项 =====');
process.exit(fail ? 1 : 0);
})();
