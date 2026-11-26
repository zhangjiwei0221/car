#!/usr/bin/env node
'use strict';
/**
 * PrepImage_v1 —— 造关前的目标图预处理：拆掉「大背景 / 外圈顺手色」（2026-11-23）
 *
 * 背景：SplitLevel_v722 按 minRing 摆盘时，一圈纯色边框的所有车 minRing=0，
 *   会全部堆进第 0–1 排；玩家点掉这几辆就把整圈 27%+ 的像素一次清空 —— 白给层。
 *   摆盘层的「每色每排配额」治标，改图才是治本。
 *
 * 规则（全部写死、可复现）：
 *   1) 触发：外圈（距边 <=1）单色占比 >= --ring-thr（默认 0.40）
 *            或单色总占比 >= --total-thr（默认 0.22）
 *   2) 拆法：外圈按弧段交替改色（段长 --seg，默认 3 格）；
 *            若拆后仍超总占比阈值，再把该色最大的非外圈连通块整块改色（最多 3 次）
 *   3) 替代色：必须是图内已有色、与主色 RGB 距离 >= --min-dist（默认 100，防撞色）、
 *            且自身占比 < 20%
 *   4) 校验：色数不变、每色 >= 8px；打印改前/改后每色占比表
 *
 * 用法：
 *   node PrepImage_v1.js --target <图.txt> --out <新图.txt>
 *        [--seg 3] [--ring-thr 0.40] [--total-thr 0.22] [--min-dist 100]
 *        [--wall-band] [--giant-comp 70] [--band-max 8] [--band-bridge 0|1]
 *
 * 【2026-11-25 派工#006】--wall-band：零毁容「同色系阴影腰线」切纵向巨块
 *   v7 三面墙 + 策略 0 下，一整块纯色纵向巨块会被一吸到底（如 11.txt 的 136px 红块）。
 *   对「>= giant-comp px 且纵向跨度 >= 6 行」的四连通块，在其中腰两行（midR/midR+1）
 *   用「图内已有、同色系最近、占比<16%」的颜色画一条腰带，把巨块拦腰切成上下两块；
 *   不新增色号、不改轮廓，只多一条自然阴影线。--band-bridge 1（默认）会把中腰 <=2px
 *   的细隔断一并连成连续腰带，避免留下 <8px 碎块。
 */
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const TARGET = arg('--target', null);
const OUT = arg('--out', null);
const SEG = Number(arg('--seg', 3));
const RING_THR = Number(arg('--ring-thr', 0.40));
const TOTAL_THR = Number(arg('--total-thr', 0.22));
const MIN_DIST = Number(arg('--min-dist', 100));
const WALL_BAND = process.argv.includes('--wall-band');
const GIANT_COMP = Number(arg('--giant-comp', '70'));
const BAND_MAX = Number(arg('--band-max', '8'));
const BAND_BRIDGE = arg('--band-bridge', '1') !== '0';
if (!TARGET || !OUT) {
  console.error('用法: node PrepImage_v1.js --target <图.txt> --out <新图.txt> [--seg 3] [--ring-thr .40] [--total-thr .22]');
  process.exit(2);
}

// 34 色库 RGB（与 utils.js AntSolver.COLORS 一致）
const HEX = {
  1: '#FF3240', 2: '#FF269F', 3: '#FF5294', 4: '#DF2455', 5: '#FF98A3', 6: '#F63C3F',
  7: '#A073E7', 8: '#E749B6', 9: '#AD00AC', 10: '#C538C3', 11: '#A032DC', 12: '#C60174',
  13: '#00ACF6', 14: '#00E1EF', 15: '#256A85', 16: '#7074B6', 17: '#6F67DC', 18: '#6B5BBA',
  19: '#95E502', 20: '#01CC64', 21: '#00AEAD', 22: '#04DB01', 23: '#02CBA9', 24: '#018441',
  25: '#FFB900', 26: '#C15701', 27: '#FF9F6A', 28: '#FF8002', 29: '#F69602', 30: '#F9DA00',
  31: '#FDE8D6', 32: '#FFEAB2', 33: '#010101', 34: '#BBB6B7'
};
const rgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const colorDist = (a, b) => {
  if (!HEX[a] || !HEX[b]) return 0;
  const A = rgb(HEX[a]), B = rgb(HEX[b]);
  return Math.sqrt((A[0] - B[0]) ** 2 + (A[1] - B[1]) ** 2 + (A[2] - B[2]) ** 2);
};

// ---------- 读图 ----------
const rawLines = fs.readFileSync(TARGET, 'utf8').trim().split(/\r?\n/);
const hasHeader = rawLines[0].startsWith('像素');
const header = hasHeader ? rawLines[0] : null;
const mat = (hasHeader ? rawLines.slice(1) : rawLines)
  .filter(l => l.trim())
  .map(l => l.trim().split(/\s+/).map(Number));
const R = mat.length, C = mat[0].length;
const TOTAL = R * C;

// ---------- 统计 ----------
function colorStats(m) {
  const total = {}, ring = {};
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    const v = m[r][c]; if (v > 0) total[v] = (total[v] || 0) + 1;
  }
  const ringPath = [];
  for (let c = 0; c < C; c++) ringPath.push([0, c]);
  for (let r = 1; r < R; r++) ringPath.push([r, C - 1]);
  for (let c = C - 2; c >= 0; c--) ringPath.push([R - 1, c]);
  for (let r = R - 2; r >= 1; r--) ringPath.push([r, 0]);
  for (const [r, c] of ringPath) { const v = m[r][c]; if (v > 0) ring[v] = (ring[v] || 0) + 1; }
  return { total, ring, ringPath };
}
function printStats(m, label) {
  const { total, ring, ringPath } = colorStats(m);
  const rows = Object.entries(total)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `色${k}: ${(n / TOTAL * 100).toFixed(1)}% (环${((ring[k] || 0) / ringPath.length * 100).toFixed(0)}%)`);
  console.log(`  ${label} 色数=${Object.keys(total).length} | ${rows.join(' | ')}`);
  return { total, ring, ringPath };
}

// ---------- 连通块（4 邻接） ----------
function componentsOfColor(m, color) {
  const seen = m.map(row => row.map(() => false));
  const out = [];
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    if (seen[r][c] || m[r][c] !== color) continue;
    const stack = [[r, c]], cells = [];
    seen[r][c] = true;
    while (stack.length) {
      const [y, x] = stack.pop(); cells.push([y, x]);
      for (const [dy, dx] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ny = y + dy, nx = x + dx;
        if (ny >= 0 && nx >= 0 && ny < R && nx < C && !seen[ny][nx] && m[ny][nx] === color) {
          seen[ny][nx] = true; stack.push([ny, nx]);
        }
      }
    }
    out.push(cells);
  }
  return out.sort((a, b) => b.length - a.length);
}

// ---------- 主流程 ----------
const before = printStats(mat, '改前:');
const outMat = mat.map(row => row.slice());
const changes = [];

for (let pass = 0; pass < 6; pass++) {
  const { total, ring, ringPath } = colorStats(outMat);
  // 找出超标颜色：外圈占比 >= RING_THR，或全图总占比 >= TOTAL_THR
  let dom = null, domScore = 0;
  for (const k of Object.keys(total)) {
    const c = +k;
    const ringShare = (ring[c] || 0) / ringPath.length;
    const totalShare = total[c] / TOTAL;
    if (ringShare >= RING_THR || totalShare >= TOTAL_THR) {
      const score = ringShare * 2 + totalShare;
      if (score > domScore) { domScore = score; dom = c; }
    }
  }
  if (dom == null) break;

  // 选替代色：图内已有、RGB 距离够、自身占比 < TOTAL_THR - 0.03（优先喂给占比偏小的颜色，使各色车数均匀在 2~7 辆）
  const candidates = Object.keys(total).map(Number)
    .filter(c => c !== dom && total[c] / TOTAL < (TOTAL_THR - 0.03) && total[c] >= 8 && colorDist(c, dom) >= MIN_DIST)
    .sort((a, b) => (total[a] - total[b]) || (colorDist(b, dom) - colorDist(a, dom)));
  const rep = candidates[0];
  if (!rep) {
    console.log(`  ⚠ 色${dom} 超阈值，但图内找不到视觉可分辨（RGB距离>=${MIN_DIST}）的替代色，跳过`);
    break;
  }

  // 1) 外圈弧段轮流拆色：铁律——外圈只能用“本来就在外圈有暴露(ring[c]>0)”的其他外圈色互拆，
  //    严禁把原本藏在图中心(ring[c]===0)的纯内芯色涂到外边界上捅穿洋葱层！
  const ringShareBefore = (ring[dom] || 0) / ringPath.length;
  let ringChanged = 0;
  if (ringShareBefore >= RING_THR) {
    // 严格只从“本来就在外圈有暴露(ring[c]>0)”的颜色里选外圈替代色，绝不把 ring=0 的内芯色引到外边界！
    const ringCands = Object.keys(ring).map(Number)
      .filter(c => c !== dom && (ring[c] || 0) > 0 && (ring[c] || 0) / ringPath.length < 0.25 && colorDist(c, dom) >= 65)
      .sort((a, b) => (total[a] - total[b]) || (colorDist(b, dom) - colorDist(a, dom)));
    const useList = ringCands.length >= 1 ? ringCands : candidates;
    const palette = [dom].concat(useList.slice(0, 3));
    const K = Math.max(2, Math.min(palette.length, Math.ceil(1 / RING_THR)));
    for (let i = 0; i < ringPath.length; i++) {
      const segIdx = Math.floor(i / SEG);
      const useColor = palette[segIdx % K];
      const [r, c] = ringPath[i];
      if (outMat[r][c] === dom && useColor !== dom) { outMat[r][c] = useColor; ringChanged++; }
    }
  }
  changes.push({ pass: pass + 1, dom, rep, ringShareBefore: +(ringShareBefore * 100).toFixed(0), ringChanged });

  // 2) 若总占比仍超阈值，将内部连通块优先分给同样在内部(ring[c]===0)的内芯小色，强化洋葱内芯厚度！
  const st2 = colorStats(outMat);
  if ((st2.total[dom] || 0) / TOTAL >= TOTAL_THR) {
    const innerCands = candidates.filter(c => (ring[c] || 0) === 0);
    const innerList = innerCands.length >= 1 ? innerCands : candidates;
    const comps = componentsOfColor(outMat, dom);
    let moved = 0;
    const needCut = Math.ceil((st2.total[dom] || 0) - TOTAL_THR * TOTAL);
    for (let ci = 0; ci < comps.length && moved < needCut; ci++) {
      const comp = comps[ci];
      const useRep = innerList[ci % Math.min(3, innerList.length)] || rep;
      if (comp.length <= needCut - moved + 25) {
        for (const [y, x] of comp) {
          if (y === 0 || x === 0 || y === R - 1 || x === C - 1) continue; // 不涂到外边界
          outMat[y][x] = useRep;
          moved++;
        }
      } else {
        const sortedCells = comp.filter(([y, x]) => y > 0 && x > 0 && y < R - 1 && x < C - 1)
          .sort((a, b) => (b[0] - a[0]) || (b[1] - a[1]));
        const take = Math.min(Math.max(0, sortedCells.length - 15), needCut - moved);
        for (let i = 0; i < take; i++) {
          const [y, x] = sortedCells[i];
          outMat[y][x] = useRep;
          moved++;
        }
      }
    }
    if (moved) changes.push({ pass: pass + 1, dom, rep: innerList[0] || rep, note: `内部连通块增厚内芯色 ${moved}px` });
  }
}

// ---------- 【派工#006】零毁容「同色系阴影腰线」切纵向巨块（--wall-band） ----------
const bandLog = [];
if (WALL_BAND) {
  // 先对「当前图」做一次快照，找出所有巨型连通块，再逐个开刀（不级联二次切割，
  // 保证只在原巨块中腰加一条腰带；切完若仍 >80px 由外层的 --giant-comp 控制是否再跑）。
  const st0 = colorStats(outMat);
  const targets = [];
  for (const k of Object.keys(st0.total).map(Number)) {
    if ((st0.total[k] || 0) < 20) continue;
    for (const comp of componentsOfColor(outMat, k)) {
      if (comp.length < GIANT_COMP) continue;
      const ys = comp.map(p => p[0]);
      const minR = Math.min(...ys), maxR = Math.max(...ys);
      if (maxR - minR < 6) continue;
      targets.push({ k, comp, minR, maxR, midR: Math.floor((minR + maxR) / 2) });
    }
  }
  targets.sort((a, b) => b.comp.length - a.comp.length);
  for (const target of targets) {
    if (bandLog.length >= BAND_MAX) break;
    const { k, comp, minR, maxR, midR } = target;
    const total = colorStats(outMat).total;
    const paintRows = [midR, midR + 1].filter(r => r >= 0 && r < R);
    const onRows = comp.filter(([r]) => paintRows.includes(r));
    if (!onRows.length || (total[k] || 0) - onRows.length < 20) continue;

    const allCols = comp.map(p => p[1]);
    const cLo = Math.max(0, Math.min(...allCols) - 2), cHi = Math.min(C - 1, Math.max(...allCols) + 2);
    const rLo = Math.max(0, midR - 2), rHi = Math.min(R - 1, midR + 2);
    // 腰带色必须「图内已有」（色数不变）、占比 <16%、>=10px、不撞 31+32；
    // 优先不与该巨块在中腰附近共处一框的颜色，其次按 RGB 距离取同色系最近（阴影/过渡色）。
    const cands = Object.keys(total).map(Number)
      .filter(cand => cand !== k && (total[cand] || 0) >= 10 && total[cand] / TOTAL < 0.16 &&
        !((cand === 31 && k === 32) || (cand === 32 && k === 31)))
      .map(cand => {
        let near = 0;
        for (let r = rLo; r <= rHi; r++) for (let x = cLo; x <= cHi; x++) if (outMat[r][x] === cand) near++;
        return { cand, near, dist: colorDist(cand, k), n: total[cand] };
      })
      .sort((a, b) => ((a.near > 0) - (b.near > 0)) || (a.dist - b.dist) || (a.n - b.n));
    if (!cands.length) {
      console.log(`  ⚠ 巨块 色${k}(${comp.length}px) 找不到合格腰带色，跳过`);
      continue;
    }
    const band = cands[0].cand;
    let painted = 0;
    for (const r of paintRows) {
      const xs = comp.filter(([y]) => y === r).map(([, x]) => x).sort((a, b) => a - b);
      for (const x of xs) { if (outMat[r][x] !== band) { outMat[r][x] = band; painted++; } }
      // 平滑腰带：把中腰 <=2px 的细隔断一并连起来，避免切出 <8px 碎块
      if (BAND_BRIDGE) {
        for (let i = 1; i < xs.length; i++) {
          if (xs[i] - xs[i - 1] > 1 && xs[i] - xs[i - 1] <= 3) {
            for (let x = xs[i - 1] + 1; x < xs[i]; x++) {
              if (outMat[r][x] !== band) { outMat[r][x] = band; painted++; }
            }
          }
        }
      }
    }
    const after = componentsOfColor(outMat, k).map(pc => pc.length);
    const remain = colorStats(outMat).total[k] || 0;
    bandLog.push({
      color: k, comp: comp.length, rows: `${minR}..${maxR}`, midR,
      band, bandDist: +cands[0].dist.toFixed(1), painted,
      remain, maxCompAfter: Math.max(...after)
    });
    console.log(`  🩹 腰带: 色${k} ${comp.length}px(行${minR}..${maxR}) 中腰=${midR} → 腰带色${band}(距离${cands[0].dist.toFixed(1)}) 涂${painted}px | 该色剩余${remain}px 最大块=${Math.max(...after)}px`);
  }
}

// ---------- 校验 ----------
const after = colorStats(outMat);
const beforeColors = Object.keys(before.total).sort().join(',');
const afterColors = Object.keys(after.total).sort().join(',');
const minPx = Math.min(...Object.values(after.total));
const okColors = beforeColors === afterColors;
// 校验每色 >= 8px，或原图本就 < 8px 且未被削减（遵循 2026-11-22 规则：原图小色切成单车合规，只禁把大色削成 <8px 碎片）
const okMin = Object.keys(after.total).every(k => after.total[k] >= 8 || after.total[k] >= before.total[k]);

console.log('改后:', '');
printStats(outMat, '       ');
console.log('  改动明细:', JSON.stringify(changes));
if (WALL_BAND) console.log('  腰带明细:', JSON.stringify(bandLog));
console.log(`  ✅ 校验: 色数不变=${okColors}(${beforeColors} → ${afterColors}) | 每色>=8px=${okMin}(最小${minPx}px)`);
if (!okColors || !okMin) {
  console.error('  ❌ 校验失败，不写出');
  process.exit(1);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
const body = outMat.map(row => row.join('\t')).join('\n');
fs.writeFileSync(OUT, (header ? header + '\n' : '') + body + '\n');
console.log('已写：' + OUT);
