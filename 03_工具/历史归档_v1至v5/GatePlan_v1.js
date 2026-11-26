#!/usr/bin/env node
'use strict';
/**
 * GatePlan_v1 —— 读 A1 v2 图分析 JSON，产出「卡点卡片草案」（T2 / B2，只读分析）
 *
 * 它做什么
 *   把“在哪一色、哪个进度放门”翻译成结构化卡片草案，交给策划修改。
 *   不造关、不切车、不切车盘；不依赖关卡 JSON，只读 ImageLayerMap_v2 的输出。
 *
 * 输入
 *   ImageLayerMap_v1.js（JSON 内 tool=ImageLayerMap_v2）产出的 图分析_<图名>.json。
 *   可以是单文件，也可以是目录（目录下直接子文件的 *.json；不递归）。
 *
 * 取法（暂定规则，B 阶段用数据校准）
 *   1) 候选只来自 gateCandidates（A1 的“需求峰 + 开局不可达 + 总量 ≥60px”）。
 *      峰窗口必须完整落在 --min-window .. --max-window（默认 0.20..0.85）。
 *   2) 同一颜色的相邻 5% 窗口（windowIndex 相差 ≤1）合并为一条“需求带”；
 *      每条带取得分最高的窗口作为候选。
 *      得分 = 峰在该窗口的占比 shareInWindow × 该色总像素 totalPx（任务书口径）。
 *   3) 按得分降序选门：一关最多 --max-gates（默认 2）个；两个门不能在同一 5% 窗口；
 *      默认同一颜色只放一个门，但同一颜色的“分开的需求带”（windowIndex 相差 ≥2）
 *      各算一个门——A1 的 91 只有色27 一个候选色，却有两段分开的峰；按验收要求
 *      91 必须出 ≥2 个门，故按“带”放宽。加 --strict-one-per-color 恢复字面规则。
 *   4) gateType（按优先级）：
 *        a. 该窗口该色需求 >120px                  → chain3
 *        b. 窗口起点 ≥0.75                          → chain2（后段优先两连）
 *        c. 窗口起点 <0.60 且需求 40–80px           → chain2
 *        d. 该色有 ≥2 段分开的峰                    → pipe（供给闸门）
 *        e. 其余                                     → ice
 *   5) priceCar：取该窗口之后 10% 内（两个 5% 窗口）需求最大的另一色；
 *      没有别的色则用门色自身，why 写“代价即本色的后半段”。
 *
 * 用法
 *   node 03_工具/正式版/GatePlan_v1.js <图分析.json|目录> --out <目录> \
 *        [--max-gates 2] [--min-window 0.20] [--max-window 0.85] [--strict-one-per-color]
 *
 * 输出
 *   <out>/卡点草案_<图名>.json，每图一个：
 *     tool/version/generatedAt/source/image/imageVerdict/gates[]/noGateReason/notes[]
 *   gates[] 的每张卡片字段：
 *     gateId, progressWindow, gateColor, demandPxInWindow, windowPx, gateType,
 *     keyCar{color,capacity,why}, priceCar{color,capacity,why},
 *     outsidePlan{maxOutsideCapacity,how}, alternativeRoute{type,color,iceSteps},
 *     rationale, draft
 *   控制台每图一行摘要。
 *
 * 卡片里 capacity（钥匙 40 / 代价 ≤30，按后续 10% 需求取 5 的倍数）是草案占位值，
 * 不是 S2 的最终切车结论。
 */

const fs = require('fs');
const path = require('path');

const VERSION = 'v1';
const FLOOR_COLOR_TOTAL_PX = 60; // 与 A1 门候补同口径
const KEY_CAR_CAPACITY = 40;     // 草案占位：钥匙车
const PRICE_CAR_CAPACITY = 30;   // 草案占位：代价车
const WINDOW_EPS = 1e-9;

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const has = k => process.argv.indexOf(k) > 0;

function round(x, n) {
  const p = Math.pow(10, n);
  return Math.round(x * p) / p;
}

function fmtPct(x) {
  return `${Math.round(x * 100)}%`;
}

/** 把同一颜色的峰按 windowIndex 合并成“需求带”：相邻（差 ≤1）算同一条带。 */
function buildBands(peaks) {
  const sorted = peaks.slice().sort((a, b) => a.windowIndex - b.windowIndex);
  const bands = [];
  for (const p of sorted) {
    const last = bands[bands.length - 1];
    if (last && p.windowIndex - last[last.length - 1].windowIndex <= 1) last.push(p);
    else bands.push([p]);
  }
  return bands;
}

/** 窗口是否完整落在 [minWindow, maxWindow]。 */
function inWindowRange(peak, minWindow, maxWindow) {
  return peak.from >= minWindow - WINDOW_EPS && peak.to <= maxWindow + WINDOW_EPS;
}

function pickPriceCar(analysis, gatePeak, gateColor) {
  const curve = analysis.demandCurve || [];
  const from = gatePeak.to - WINDOW_EPS;
  const to = gatePeak.to + 0.10 - WINDOW_EPS;
  const sums = new Map();
  let total = 0;
  for (const w of curve) {
    if (w.from < from || w.from >= to) continue;
    total += w.total || 0;
    for (const [c, n] of Object.entries(w.byColor || {})) {
      if (Number(c) === gateColor) continue;
      sums.set(Number(c), (sums.get(Number(c)) || 0) + n);
    }
  }
  let bestColor = null;
  let bestPx = -1;
  for (const [c, n] of sums) {
    if (n > bestPx || (n === bestPx && (bestColor === null || c < bestColor))) {
      bestColor = c;
      bestPx = n;
    }
  }
  if (bestColor === null || bestPx <= 0) {
    return {
      color: gateColor,
      capacity: PRICE_CAR_CAPACITY,
      why: '代价即本色的后半段（后续 10% 没有其他颜色可回收）',
    };
  }
  // 代价车容量不超过该色后续 10% 的实际需求，取 5 的倍数；上限 30（草案占位）。
  const capacity = Math.max(5, Math.min(PRICE_CAR_CAPACITY, Math.floor(bestPx / 5) * 5));
  return {
    color: bestColor,
    capacity,
    why: `代价：该色在后续 10%（${fmtPct(gatePeak.to)}–${fmtPct(gatePeak.to + 0.10)}）露出 ${bestPx}px，容量 ${capacity} 可回收`,
  };
}

/** gateType 规则（优先级见文件头）。 */
function pickGateType(gatePeak, bandCount) {
  const demand = gatePeak.pxInWindow;
  if (demand > 120) return 'chain3';
  if (gatePeak.from >= 0.75 - WINDOW_EPS) return 'chain2';
  if (gatePeak.from < 0.60 - WINDOW_EPS && demand >= 40 && demand <= 80) return 'chain2';
  if (bandCount >= 2) return 'pipe';
  return 'ice';
}

function makeCard(analysis, cand, gatePeak, bandCount, gateId) {
  const windowEntry = (analysis.demandCurve || [])[gatePeak.windowIndex] || {};
  const windowPx = windowEntry.total != null ? windowEntry.total : Math.round(gatePeak.pxInWindow / gatePeak.shareInWindow);
  const gateType = pickGateType(gatePeak, bandCount);
  const price = pickPriceCar(analysis, gatePeak, cand.color);
  const sharePct = Math.round((gatePeak.shareInWindow || 0) * 100);
  const bandNote = bandCount >= 2 && gateType === 'chain2'
    ? `该色共有 ${bandCount} 段分开的需求带，本卡片只是其中一段，需人工确认是否算独立门。`
    : '';
  return {
    gateId,
    progressWindow: [round(gatePeak.from, 4), round(gatePeak.to, 4)],
    gateColor: cand.color,
    demandPxInWindow: gatePeak.pxInWindow,
    windowPx,
    gateType,
    keyCar: {
      color: cand.color,
      capacity: KEY_CAR_CAPACITY,
      why: `进场当步应能吃满（窗口内该色可达 ${gatePeak.pxInWindow}px ≥ ${KEY_CAR_CAPACITY}px）`,
    },
    priceCar: price,
    outsidePlan: {
      maxOutsideCapacity: '≤ 窗口需求 × 0.4',
      how: '门外该色车容量合计不超过 40%',
    },
    alternativeRoute: {
      type: 'ice',
      color: cand.color,
      iceSteps: '比门晚 6–10 辆',
    },
    rationale: `色${cand.color} 在 ${gatePeak.window} 占该窗口 ${sharePct}% 需求（${gatePeak.pxInWindow}/${windowPx}px，该色共 ${cand.totalPx}px），是图上这一进度最主要的消耗色。${bandNote}`.trim(),
    draft: true,
  };
}

function noGateReason(analysis, minWindow, maxWindow) {
  const cands = analysis.gateCandidates || [];
  const peaks = analysis.demandPeaks || [];
  if (!cands.length) {
    if (!peaks.length) return '无门：图无需求峰';
    return '无门：没有门候补色（峰色开局可达或总像素 <60px）';
  }
  const anyInRange = cands.some(g => (g.peaks || []).some(p => inWindowRange(p, minWindow, maxWindow)));
  if (!anyInRange) return `无门：门候补的峰都不在 ${fmtPct(minWindow)}–${fmtPct(maxWindow)} 窗口`;
  const anyBigEnough = cands.some(g => (g.totalPx || 0) >= FLOOR_COLOR_TOTAL_PX);
  if (!anyBigEnough) return '无门：门候补色总量 <60px';
  return '无门：候选未通过选择规则';
}

function planOne(analysis, opts) {
  const cands = analysis.gateCandidates || [];
  const selectedWindows = new Set();
  const allCandidates = [];

  for (const cand of cands) {
    if ((cand.totalPx || 0) < FLOOR_COLOR_TOTAL_PX) continue;
    const peaks = (cand.peaks || []).filter(p => inWindowRange(p, opts.minWindow, opts.maxWindow));
    if (!peaks.length) continue;
    const bands = buildBands(peaks);
    for (const band of bands) {
      let best = band[0];
      for (const p of band) {
        if (p.shareInWindow > best.shareInWindow ||
            (p.shareInWindow === best.shareInWindow && p.pxInWindow > best.pxInWindow)) {
          best = p;
        }
      }
      allCandidates.push({
        color: cand.color,
        totalPx: cand.totalPx,
        peak: best,
        bandCount: bands.length,
        score: (best.shareInWindow || 0) * (cand.totalPx || 0),
      });
    }
  }

  allCandidates.sort((a, b) =>
    b.score - a.score ||
    a.peak.windowIndex - b.peak.windowIndex ||
    a.color - b.color);

  const chosen = [];
  const colorsUsed = new Set();
  for (const c of allCandidates) {
    if (chosen.length >= opts.maxGates) break;
    if (selectedWindows.has(c.peak.windowIndex)) continue;
    if (opts.strictOnePerColor && colorsUsed.has(c.color)) continue;
    chosen.push(c);
    selectedWindows.add(c.peak.windowIndex);
    colorsUsed.add(c.color);
  }

  const gates = chosen.map((c, i) => makeCard(analysis, c, c.peak, c.bandCount, i + 1));
  return {
    gates,
    candidates: allCandidates.map(c => ({
      color: c.color,
      window: c.peak.window,
      demandPxInWindow: c.peak.pxInWindow,
      score: round(c.score, 2),
      gateType: pickGateType(c.peak, c.bandCount),
    })),
    reason: gates.length ? null : noGateReason(analysis, opts.minWindow, opts.maxWindow),
  };
}

function loadAnalysis(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!data || !Array.isArray(data.demandCurve) || !Array.isArray(data.gateCandidates)) {
    throw new Error('不是 ImageLayerMap_v2 的输出（缺 demandCurve / gateCandidates）');
  }
  return data;
}

function listJsonFiles(input) {
  const st = fs.statSync(input);
  if (st.isFile()) return [input];
  if (!st.isDirectory()) throw new Error(`不是文件或目录: ${input}`);
  return fs.readdirSync(input)
    .filter(f => f.toLowerCase().endsWith('.json'))
    .map(f => path.join(input, f))
    .sort();
}

function main() {
  const input = process.argv[2];
  if (!input || input.startsWith('--')) {
    console.error('用法: node GatePlan_v1.js <图分析.json|目录> --out <目录> [--max-gates 2] [--min-window 0.20] [--max-window 0.85] [--strict-one-per-color]');
    process.exit(2);
  }
  const outDir = arg('--out', null);
  if (!outDir) {
    console.error('缺少 --out <目录>');
    process.exit(2);
  }
  const maxGates = Math.max(0, Math.floor(Number(arg('--max-gates', 2)) || 0));
  const minWindow = Number(arg('--min-window', 0.20));
  const maxWindow = Number(arg('--max-window', 0.85));
  if (!(minWindow >= 0 && maxWindow <= 1 && minWindow < maxWindow)) {
    console.error('窗口范围不合法：需要 0 ≤ --min-window < --max-window ≤ 1');
    process.exit(2);
  }
  const opts = { maxGates, minWindow, maxWindow, strictOnePerColor: has('--strict-one-per-color') };

  fs.mkdirSync(outDir, { recursive: true });
  const files = listJsonFiles(input);
  if (!files.length) {
    console.error(`目录里没有 .json: ${input}`);
    process.exit(1);
  }

  let ok = 0, skipped = 0;
  const rows = [];
  for (const file of files) {
    let analysis;
    try {
      analysis = loadAnalysis(file);
    } catch (e) {
      if (files.length === 1) {
        console.error(`读取失败: ${file}: ${e.message}`);
        process.exit(1);
      }
      console.error(`跳过 ${path.basename(file)}: ${e.message}`);
      skipped++;
      continue;
    }
    const name = path.basename(file, path.extname(file));
    const plan = planOne(analysis, opts);
    const out = {
      tool: 'GatePlan_v1',
      version: VERSION,
      generatedAt: new Date().toISOString(),
      source: path.relative(process.cwd(), file),
      image: analysis.file || name,
      imageVerdict: (analysis.imageUpperBound && analysis.imageUpperBound.verdict) || null,
      options: opts,
      gateCandidates: (analysis.gateCandidates || []).map(g => ({
        color: g.color,
        totalPx: g.totalPx,
        peaks: (g.peaks || []).map(p => ({ window: p.window, pxInWindow: p.pxInWindow, shareInWindow: p.shareInWindow })),
      })),
      candidatesRanked: plan.candidates,
      gates: plan.gates,
      noGateReason: plan.reason,
      notes: [
        '草案由 GatePlan_v1 自动生成，draft=true；容量（钥匙 40 / 代价 ≤30，按后续 10% 需求取 5 的倍数）是占位值，不是 S2 最终切车结论。',
        '门类型、窗口、价格色的规则是暂定值，B 阶段有数据后校准。',
      ],
    };
    const outFile = path.join(outDir, `卡点草案_${name}.json`);
    fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
    ok++;

    const gateText = plan.gates.length
      ? plan.gates.map(g => `#${g.gateId} 色${g.gateColor}@${Math.round(g.progressWindow[0] * 100)}-${Math.round(g.progressWindow[1] * 100)}% ${g.demandPxInWindow}px ${g.gateType}`).join('; ')
      : `0 个门（${plan.reason}）`;
    const verdict = out.imageVerdict || '?';
    console.log(`[${name}] ${verdict} → ${gateText}`);
    rows.push({ name, verdict, gates: plan.gates.length, text: gateText });
  }

  console.log(`\n完成：${ok} 张图，跳过 ${skipped} 个文件；输出目录 ${outDir}`);
}

main();
