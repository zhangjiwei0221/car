#!/usr/bin/env node
'use strict';
/**
 * C11_fillable —— 同色连通块“可填满度”指标
 *
 * 用户 2026-11-12：「19 没任何压力，纯色联通太大了。」
 * 车能不能吃满，取决于某颜色的连通块有多大，而不只是该颜色总像素。
 *
 * 指标（每色 c，4 连通）：
 *   bigPx(c)  = 落在 >=40px 连通块里的像素数（40 = 一辆车典型容量）
 *   fillable(c) = bigPx(c) / totalPx(c)
 * 关卡级：
 *   fillableWeighted = Σ bigPx / Σ totalPx（像素加权）
 *   fillableMean     = mean_c fillable(c)
 *   bigBlobShare     = 最大同色连通块像素 / 全图像素(H*W)
 *
 * 用法：
 *   node C11_fillable.js <输出.json>
 *
 * 输入路径写死为仓库内/桌面已知位置（见 SRC 常量），只读。
 * 只写一个结果 JSON；不生成中间文件。
 */
const fs = require('fs');
const path = require('path');

const MIN_BLOB = 40; // 一辆车典型容量

const TXT_DIR = '/Users/red/Desktop/正常关卡';
const TXT_NAMES = ['106', '91', '23', '18'];
const G2_DIR = '/Users/red/Desktop/毛线汽车/测试版本/2026_10_05/分组2';
const G2_LEVELS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];

// 已知量（L2–L13 顺序）
const RANDOM_PASS = {
  2: 0.17, 3: 0.03, 4: 0.27, 5: 0.41, 6: 0.46, 7: 0.68,
  8: 0.61, 9: 0.88, 10: 0.16, 11: 0.85, 12: 0.33, 13: 0.76,
};
const ONLINE_FAIL2 = {
  2: 65.4, 3: 63.9, 4: 46.5, 5: 60.2, 6: 46.8, 7: 49.2,
  8: 27.9, 9: 28.0, 10: 47.7, 11: 44.0, 12: 45.9, 13: 25.0,
};

// 与 03_工具/正式版/ImageDebtScan_v1.js 的 parse() 一致：跳过非数字行
function parseTxt(file) {
  const lines = fs.readFileSync(file, 'utf8').replace(/\r/g, '').trim().split('\n');
  const rows = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t || /[^\d\s]/.test(t)) continue;
    rows.push(t.split(/\s+/).map(Number));
  }
  return rows;
}

// 4 连通块
function components(grid, H, W) {
  const seen = Array.from({ length: H }, () => new Uint8Array(W));
  const comps = [];
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (seen[y][x]) continue;
      const v = grid[y][x];
      seen[y][x] = 1;
      if (!(v > 0)) continue; // 0 / -1 为空格，不参与
      const cells = [];
      const stack = [[y, x]];
      while (stack.length) {
        const [cy, cx] = stack.pop();
        cells.push([cy, cx]);
        for (const [dy, dx] of dirs) {
          const ny = cy + dy, nx = cx + dx;
          if (ny < 0 || ny >= H || nx < 0 || nx >= W) continue;
          if (seen[ny][nx]) continue;
          if (grid[ny][nx] !== v) continue;
          seen[ny][nx] = 1;
          stack.push([ny, nx]);
        }
      }
      comps.push({ color: v, size: cells.length });
    }
  }
  return comps;
}

function analyze(grid, name) {
  const H = grid.length, W = grid[0].length;
  const comps = components(grid, H, W);

  const byColor = new Map(); // color -> {totalPx, bigPx, maxBlob, blobCount, bigBlobCount}
  for (const { color, size } of comps) {
    const o = byColor.get(color) || { totalPx: 0, bigPx: 0, maxBlob: 0, blobCount: 0, bigBlobCount: 0 };
    o.totalPx += size;
    o.blobCount++;
    if (size >= MIN_BLOB) { o.bigPx += size; o.bigBlobCount++; }
    if (size > o.maxBlob) o.maxBlob = size;
    byColor.set(color, o);
  }
  const colors = [...byColor.keys()].sort((a, b) => a - b);
  const perColor = colors.map(c => {
    const o = byColor.get(c);
    return {
      color: c,
      totalPx: o.totalPx,
      bigPx: o.bigPx,
      fillable: o.totalPx ? o.bigPx / o.totalPx : 0,
      maxBlob: o.maxBlob,
      blobCount: o.blobCount,
      bigBlobCount: o.bigBlobCount,
    };
  });

  let sumTotal = 0, sumBig = 0, maxBlob = 0;
  for (const p of perColor) {
    sumTotal += p.totalPx;
    sumBig += p.bigPx;
    if (p.maxBlob > maxBlob) maxBlob = p.maxBlob;
  }
  const fillableWeighted = sumTotal ? sumBig / sumTotal : 0;
  const fillableMean = perColor.length
    ? perColor.reduce((a, p) => a + p.fillable, 0) / perColor.length : 0;
  const bigBlobShare = maxBlob / (H * W);

  return {
    name,
    size: `${H}x${W}`,
    totalPx: H * W,
    coloredPx: sumTotal,
    colorCount: perColor.length,
    fillableWeighted,
    fillableMean,
    bigBlobShare,
    perColor,
  };
}

// Spearman：平均秩处理并列，再对秩做 Pearson
function rankAvg(arr) {
  const idx = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const ranks = new Array(arr.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[idx[k][1]] = r;
    i = j + 1;
  }
  return ranks;
}
function pearson(a, b) {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  if (da === 0 || db === 0) return NaN;
  return num / Math.sqrt(da * db);
}
function spearman(a, b) {
  return pearson(rankAvg(a), rankAvg(b));
}
// 两列秩无关时的 |ρ| 参考门槛（双尾 0.05，n=12 约 0.587）
function sigMark(rho, n) {
  const abs = Math.abs(rho);
  // t 检验近似：t = rho*sqrt((n-2)/(1-rho^2))，df=n-2；临界值 t(10,0.05)=2.228
  const t = abs * Math.sqrt((n - 2) / Math.max(1e-12, 1 - rho * rho));
  return t > 2.228 ? ' p<0.05' : '';
}

function fmt(x, d = 4) { return Number(x).toFixed(d); }

function main() {
  const outPath = process.argv[2];
  if (!outPath) {
    console.error('用法: node C11_fillable.js <输出.json>');
    process.exit(2);
  }

  const images = [];
  for (const nm of TXT_NAMES) {
    images.push(analyze(parseTxt(path.join(TXT_DIR, `${nm}.txt`)), `TXT_${nm}`));
  }
  const levels = [];
  for (const L of G2_LEVELS) {
    const d = JSON.parse(fs.readFileSync(path.join(G2_DIR, `G2_bq_level_${L}.json`), 'utf8'));
    levels.push(analyze(d.blocks, `G2_L${L}`));
  }

  const mv = levels.map(x => x.fillableWeighted);
  const mm = levels.map(x => x.fillableMean);
  const mb = levels.map(x => x.bigBlobShare);
  const rp = G2_LEVELS.map(L => RANDOM_PASS[L]);
  const of = G2_LEVELS.map(L => ONLINE_FAIL2[L]);

  const corr = [
    { metric: 'fillableWeighted', vs: 'randomPass', rho: spearman(mv, rp) },
    { metric: 'fillableMean', vs: 'randomPass', rho: spearman(mm, rp) },
    { metric: 'bigBlobShare', vs: 'randomPass', rho: spearman(mb, rp) },
    { metric: 'fillableWeighted', vs: 'onlineFail2', rho: spearman(mv, of) },
    { metric: 'fillableMean', vs: 'onlineFail2', rho: spearman(mm, of) },
    { metric: 'bigBlobShare', vs: 'onlineFail2', rho: spearman(mb, of) },
  ];
  for (const c of corr) c.sig = sigMark(c.rho, G2_LEVELS.length);

  const m106 = images.find(x => x.name === 'TXT_106');
  const m91 = images.find(x => x.name === 'TXT_91');
  const cmp = [];
  for (const c of m106.perColor) {
    const o = m91.perColor.find(x => x.color === c.color) || null;
    cmp.push({
      color: c.color,
      106: { totalPx: c.totalPx, bigPx: c.bigPx, fillable: c.fillable, maxBlob: c.maxBlob },
      91: o ? { totalPx: o.totalPx, bigPx: o.bigPx, fillable: o.fillable, maxBlob: o.maxBlob } : null,
    });
  }
  for (const o of m91.perColor) {
    if (!m106.perColor.some(x => x.color === o.color)) {
      cmp.push({
        color: o.color, 106: null,
        91: { totalPx: o.totalPx, bigPx: o.bigPx, fillable: o.fillable, maxBlob: o.maxBlob },
      });
    }
  }

  const result = {
    generatedAt: new Date().toISOString(),
    minBlobPx: MIN_BLOB,
    metricDef: {
      fillableWeighted: 'Σ bigPx(c) / Σ totalPx(c)',
      fillableMean: 'mean_c bigPx(c)/totalPx(c)',
      bigBlobShare: 'maxSameColor4ConnectedComponent / (H*W)',
    },
    images: images.map(({ perColor, ...rest }) => rest),
    levels: levels.map(({ perColor, ...rest }) => rest),
    perColor: { 106: m106.perColor, 91: m91.perColor },
    correlations: corr,
    txt106vs91: cmp,
  };
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n');

  // 控制台摘要
  const pad = (s, n) => String(s).padEnd(n);
  console.log('\n== 每图指标 ==');
  console.log(pad('图', 10) + pad('尺寸', 8) + pad('色数', 6) + pad('fillableW', 12) + pad('fillableMean', 14) + 'bigBlobShare');
  for (const x of [...images, ...levels]) {
    console.log(pad(x.name, 10) + pad(x.size, 8) + pad(x.colorCount, 6) +
      pad(fmt(x.fillableWeighted), 12) + pad(fmt(x.fillableMean), 14) + fmt(x.bigBlobShare));
  }
  console.log('\n== Spearman（n=12）==');
  for (const c of corr) console.log(pad(c.metric, 20) + pad('vs ' + c.vs, 18) + 'rho=' + fmt(c.rho) + c.sig);
  console.log('\n== 106 vs 91 逐色（按 106 fillable 升序）==');
  console.log(pad('色', 5) + pad('106 tot', 9) + pad('106 big', 9) + pad('106 fill', 10) + pad('106 max', 9) + pad('91 tot', 8) + pad('91 big', 8) + pad('91 fill', 9) + '91 max');
  const sorted = [...cmp].sort((a, b) => (a['106'] ? a['106'].fillable : 9) - (b['106'] ? b['106'].fillable : 9));
  for (const r of sorted) {
    const a = r['106'], b = r['91'];
    console.log(pad(r.color, 5) +
      pad(a ? a.totalPx : '-', 9) + pad(a ? a.bigPx : '-', 9) + pad(a ? fmt(a.fillable) : '-', 10) + pad(a ? a.maxBlob : '-', 9) +
      pad(b ? b.totalPx : '-', 8) + pad(b ? b.bigPx : '-', 8) + pad(b ? fmt(b.fillable) : '-', 9) + (b ? b.maxBlob : '-'));
  }
  console.log(`\n结果已写入 ${outPath}`);
}

main();
