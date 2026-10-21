/**
 * 【v154】像素画工具（网页版）验证：色库切换 + 色板重建 + 官方色值与源文件一致
 *   JSDOM_PATH=/tmp/dsh-colorlib-test/node_modules node js_web_check.js
 *
 * 为什么需要它：网页版是**单文件内联 JS**，改错一个字符整页就废，而且它把 34 色色表硬编码在页面里。
 * 这里把页面真正解析起来，检查：
 *   1) 默认仍是老色库 34 色（改动前行为不变）；
 *   2) 切到官方 22 色后：色板重建为 22 个、内部色号 1..22、FIRST_ID 跟着变（不再越界）；
 *   3) 复位色板不会再去引用不存在的色号；
 *   4) 页面里硬编码的官方 22 色 **与 bin/参考/色库 的权威文件逐项一致**（防止抄错一个 hex）。
 */
'use strict';
const fs = require('fs');
const path = require('path');

function loadJsdom() {
  try { return require('jsdom'); } catch (e) {}
  const cands = [process.env.JSDOM_PATH, '/tmp/dsh-jsdom/node_modules', '/tmp/dsh-colorlib-test/node_modules'].filter(Boolean);
  for (const c of cands) { try { return require(path.join(c, 'jsdom')); } catch (e) {} }
  console.log('未找到 jsdom，跳过（不算失败）。装法见 js/_colorlibs_smoke_jsdom.js 头部说明。');
  process.exit(0);
}
const { JSDOM, VirtualConsole } = loadJsdom();

const TOOL = __dirname;
const HTML = path.join(TOOL, '图片转像素画.html');
const LIBDIR = path.join(TOOL, '..', '..', '02_工程', '完整主bin快照_20261012', 'bin', '参考', '色库');

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.log('  ✗ ' + m); };

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errors.push('jsdomError: ' + e.message));
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

const dom = new JSDOM(fs.readFileSync(HTML, 'utf8'), {
  runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, url: 'http://127.0.0.1/'
});
const win = dom.window;
const $ = (id) => win.document.getElementById(id);

// 页面加载（无外部资源、无图片，只需等脚本跑完）
setTimeout(() => {
  console.log('\n[A] 页面加载');
  const hard = errors.filter((e) => !/Not implemented|Could not parse CSS|canvas/i.test(e));
  if (hard.length) { bad('页面报错：'); hard.slice(0, 4).forEach((e) => console.log('      ' + e)); }
  else ok('页面脚本加载无报错');

  if (typeof win.setLib !== 'function') { bad('内置 JS 未按预期暴露（拿不到 setLib）'); return done(); }
  ok('页面内联脚本已执行');

  console.log('\n[B] 默认 = 老色库 34 色（改动前行为不变）');
  if (win.LIB === 'older') ok("默认 LIB = 'older'");
  else bad('默认 LIB = ' + win.LIB);
  if (win.PAL === win.PAL_OLDER && win.PAL.length === 34) ok('默认取色表 = 34 色');
  else bad('默认取色表长度 = ' + win.PAL.length);
  if (win.useIds.length === 34 && win.useIds[0] === 1 && win.useIds[33] === 34) ok('默认参与匹配色号 = 1..34');
  else bad('默认 useIds 异常：' + JSON.stringify(win.useIds.slice(0, 5)) + '…len=' + win.useIds.length);
  if ($('pal').children.length === 34) ok('色板渲染出 34 个色块');
  else bad('色板色块数 = ' + $('pal').children.length);
  if (win.FIRST_ID === 1) ok('兜底色号 FIRST_ID = ' + win.FIRST_ID);
  else bad('FIRST_ID = ' + win.FIRST_ID);

  console.log('\n[C] 切到官方 22 色');
  $('libMode').value = 'official';
  $('libMode').dispatchEvent(new win.Event('change', { bubbles: true }));
  if (win.LIB === 'official') ok("LIB 已切到 'official'");
  else bad('LIB = ' + win.LIB);
  if (win.PAL === win.PAL_OFFICIAL && win.PAL.length === 22) ok('取色表已换成官方 22 色');
  else bad('取色表长度 = ' + win.PAL.length);
  if ($('pal').children.length === 22) ok('色板已重建为 22 个色块（旧的 34 色色板已清掉）');
  else bad('色板色块数 = ' + $('pal').children.length + '（应 22；残留旧色号会越界）');
  if ($('pal').querySelectorAll('.sw[data-id="23"]').length === 0) ok('官方色板里没有 23 号（越界色号已清除）');
  else bad('官方色板里仍有 23 号色块 → 会越界');
  if (win.FIRST_ID === 1) ok('FIRST_ID 仍有效 = ' + win.FIRST_ID);
  else bad('FIRST_ID = ' + win.FIRST_ID);
  if (win.useIds.length === 22 && Math.max.apply(null, win.useIds) === 22) ok('参与匹配色号已复位为 1..22（不残留 23-34）');
  else bad('useIds 异常：max=' + Math.max.apply(null, win.useIds) + ' len=' + win.useIds.length);

  console.log('\n[D] 色板按钮在新色表下不越界');
  $('palNone').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  if (win.useIds.length === 1 && win.PAL[win.useIds[0] - 1]) ok('「全不选」后只留一个**存在**的色号（' + win.useIds[0] + '）');
  else bad('「全不选」留下的色号越界：' + JSON.stringify(win.useIds));
  $('palReset').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  if (win.useIds.length === 22) ok('「恢复默认」把 22 色全选回来');
  else bad('恢复默认后 useIds 长度 = ' + win.useIds.length);

  console.log('\n[E] 切回老色库');
  $('libMode').value = 'older';
  $('libMode').dispatchEvent(new win.Event('change', { bubbles: true }));
  if (win.PAL.length === 34 && $('pal').children.length === 34 && win.useIds.length === 34) ok('切回老色库后色表/色板/选色都回到 34 色');
  else bad('切回失败：PAL=' + win.PAL.length + ' 色块=' + $('pal').children.length + ' useIds=' + win.useIds.length);

  console.log('\n[F] 页面里硬编码的官方 22 色 vs 权威文件');
  {
    const file = path.join(LIBDIR, '标准色库', '标准色库_colors_0-21.txt');
    if (!fs.existsSync(file)) { bad('找不到权威色库文件：' + file); }
    else {
      const src = [];
      for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^\s*(#[0-9A-Fa-f]{6})\s*,\s*(\d+)\s*$/);
        if (m) src.push({ hex: m[1].toUpperCase(), id: +m[2] });
      }
      let badN = 0;
      win.PAL_OFFICIAL.forEach((p, i) => {
        const want = src[i];
        // 页面内部色号 = 官方色号 + 1
        if (!want || want.hex !== p.hex.toUpperCase() || p.id !== want.id + 1) {
          badN++;
          if (badN <= 3) console.log('      不一致：页面 ' + p.id + ' ' + p.hex + ' vs 文件 ' + (want ? want.id + ' ' + want.hex : '(缺)'));
        }
      });
      if (badN) bad(badN + ' 个官方色与权威文件不一致（抄错了）');
      else ok('页面内 22 个官方色与 标准色库_colors_0-21.txt 逐项一致（内部号 = 官方号 + 1）');
      if (src.length === 22) ok('权威文件解析出 22 色');
      else bad('权威文件解析出 ' + src.length + ' 色');
    }
  }

  console.log('\n[G] 老色库 34 色也没抄错');
  {
    const file = path.join(LIBDIR, '标准色库', '标准色库毛线真实.txt');
    if (!fs.existsSync(file)) bad('找不到 ' + file);
    else {
      const src = [];
      for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^\s*(#[0-9A-Fa-f]{6})\s*,\s*(\d+)\s*$/);
        if (m) src.push({ hex: m[1].toUpperCase(), id: +m[2] });
      }
      let badN = 0;
      win.PAL_OLDER.forEach((p, i) => {
        const want = src[i];
        if (!want || want.hex !== p.hex.toUpperCase() || p.id !== want.id) badN++;
      });
      if (badN) bad(badN + ' 个老色库色值不一致');
      else ok('页面内 34 个老色库色值与 标准色库毛线真实.txt 逐项一致');
    }
  }

  done();
}, 300);

function done() {
  console.log('\n===== 网页版色库验证：失败 ' + fail + ' 项 =====');
  process.exit(fail ? 1 : 0);
}
