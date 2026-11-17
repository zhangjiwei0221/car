#!/usr/bin/env node
'use strict';
/**
 * 解剖_死亡局_97478 —— 复现 103 低独占链的 13 局死亡并逐步记录。
 *
 * 口径与 实验关/产线v5/C9_插值玩家/PInterpPlayer.js 逐位同源：
 *   loadSolver('corner')、createState(useSlotStart:true, bottomOnly:false, instantChain:false)、
 *   同一个 LCG(seed)、p<=0 纯随机 / p>=1 纯贪心 / 0<p<1 每步先抽 rnd 决定端。
 *
 * 对每个 p（0,0.1,…,1）× 100 局（seed 977），只输出死亡局：
 *   - 死亡前 8 步：选中格/色/容量/组大小、每步后暂存（每车 color/progress/need/link/enterStep）、暂存数；
 *   - 链组第一次进场的步数与当时进度；死时链组两车的 progress/need；
 *   - 死亡瞬间：暂存内容 + 枚举全部可点选项（含 blocked）的模拟结果与死因。
 *
 * 用法：
 *   node 解剖_死亡局_97478.js <关卡.json> <out.json>
 */
const fs = require('fs');
const B = require('/Users/red/Desktop/毛线汽车/03_工具/正式版/Build006Thickness_v688');
const A = B.loadSolver('corner');
const Sim = A.Simulator, St = A.SolverStrategy;

const [levelFile, outFile] = process.argv.slice(2);
if (!levelFile || !outFile) {
  console.error('用法: node 解剖_死亡局_97478.js <关卡.json> <out.json>');
  process.exit(2);
}

const PLIST = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
const NGAMES = 100;
const SEED = 977;
const MAX_STEPS = 200;

const isWon = (s) => s.eliminatedPixels >= s.totalPixels;
const isDead = (s) => !!(s.overflow || s.buffer.length > s.bufferLimit || Sim.isDeadEnd(s));
const round = (x, n) => { const p = Math.pow(10, n); return Math.round(x * p) / p; };
function lcg(seed) {
  let rs = seed;
  return () => { rs = (rs * 1103515245 + 12345) & 0x7fffffff; return rs / 0x7fffffff; };
}

function bufView(s) {
  return s.buffer.map(b => ({
    color: b.color, progress: b.progress, need: b.need,
    remaining: b.need - b.progress, link: b.link || 0,
    enterStep: b.enterStep, key: b.key
  }));
}

function analyzeFinal(s) {
  const progress = round(s.eliminatedPixels / s.totalPixels, 6);
  const ms = Sim.listMoves(s);
  const options = ms.map(m => {
    const t = St.cloneState(s);
    const e0 = t.eliminatedPixels;
    const ok = Sim.applyPick(t, m.r, m.c);
    const won = isWon(t);
    const deadNow = !won && isDead(t);
    return {
      r: m.r, c: m.c, color: m.antBox.color, count: m.antBox.count,
      groupSize: m.groupSize, blocked: m.blocked,
      applied: ok, won, dead: deadNow,
      overflow: t.overflow,
      bufferAfter: t.buffer.length,
      buffer: bufView(t),
      completedDelta: t.completedBoxes - s.completedBoxes,
      gainedPx: t.eliminatedPixels - e0,
      progressAfter: round(t.eliminatedPixels / t.totalPixels, 6),
      isDeadEndAfter: Sim.isDeadEnd(t),
      reason: won ? 'win'
        : t.overflow ? (t.buffer.length > t.bufferLimit ? 'overflow(>limit)' : 'overflow(满且本步无完成)')
        : Sim.isDeadEnd(t) ? 'isDeadEnd(暂存无可吃且无路)' : 'alive'
    };
  });
  return {
    step: s.steps,
    progress,
    eliminatedPixels: s.eliminatedPixels,
    totalPixels: s.totalPixels,
    completedBoxes: s.completedBoxes,
    bufferLimit: s.bufferLimit,
    bufferCount: s.buffer.length,
    buffer: bufView(s),
    isDeadEndNow: Sim.isDeadEnd(s),
    legalMoveCount: ms.filter(m => !m.blocked).length,
    allMoveCount: ms.length,
    boardRemaining: s.cells.flat().filter(c => c && c.t === 'box').map(c => ({ color: c.color, count: c.count, chain: c.chain || 0 })),
    options
  };
}

function chainInfo(allHistory, finalState) {
  // 链组 = link>0 的暂存条目。找最早出现 link 的步（进场步）与当时进度。
  for (const h of allHistory) {
    const links = [...new Set(h.bufferAfter.filter(b => b.link > 0).map(b => b.link))];
    if (links.length) {
      const members = h.bufferAfter.filter(b => b.link === links[0]);
      return {
        link: links[0],
        enterStep: members[0].enterStep,
        enterAtProgress: round(h.progressBefore, 6),
        membersAtEntry: members.map(b => ({ color: b.color, need: b.need, progress: b.progress })),
        chainCarsAtDeath: bufView(finalState).filter(b => b.link > 0)
          .map(b => ({ color: b.color, progress: b.progress, need: b.need })),
        linkPresentAtDeath: finalState.buffer.some(b => b.link > 0)
      };
    }
  }
  return { link: null, note: '链组从未进入暂存' };
}

function playInstrumented(lv, p, rnd) {
  let s = Sim.createState(lv, { useSlotStart: true, bottomOnly: false, instantChain: false });
  let steps = 0;
  const allHistory = [];
  const pureRandom = p <= 0;
  const pureGreedy = p >= 1;

  while (!isWon(s) && steps < MAX_STEPS) {
    const progressBefore = s.eliminatedPixels / s.totalPixels;
    const ms = Sim.listMoves(s).filter(m => !m.blocked);
    const aliveT = (t) => !isDead(t) || isWon(t);

    let pick = null;
    const useGreedy = pureGreedy || (!pureRandom && rnd() < p);

    if (useGreedy) {
      const cand = [];
      for (const m of ms) {
        const t = St.cloneState(s);
        const e0 = t.eliminatedPixels;
        if (!Sim.applyPick(t, m.r, m.c)) continue;
        if (!aliveT(t)) continue;
        cand.push({ r: m.r, c: m.c, t, gain: t.eliminatedPixels - e0 });
      }
      if (cand.length) {
        let best = -Infinity;
        for (const o of cand) if (o.gain > best) best = o.gain;
        const tied = cand.filter(o => o.gain === best);
        pick = tied[Math.floor(rnd() * tied.length)];
      }
    } else {
      const idx = ms.map((_, i) => i);
      for (let i = idx.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        const x = idx[i]; idx[i] = idx[j]; idx[j] = x;
      }
      for (const k of idx) {
        const m = ms[k];
        const t = St.cloneState(s);
        if (!Sim.applyPick(t, m.r, m.c)) continue;
        if (aliveT(t)) { pick = { r: m.r, c: m.c, t, gain: t.eliminatedPixels - s.eliminatedPixels }; break; }
      }
    }

    if (!pick) {
      return {
        died: true,
        steps,
        p,
        deathProgress: round(progressBefore, 6),
        final: analyzeFinal(s),
        last8: allHistory.slice(-8),
        allSteps: allHistory.map(h => ({ step: h.step, picked: h.picked, bufferCount: h.bufferCount, progress: h.progress })),
        chain: chainInfo(allHistory, s)
      };
    }

    const m = ms.find(x => x.r === pick.r && x.c === pick.c);
    const prevBuf = s.buffer.length;
    s = pick.t;
    steps++;
    allHistory.push({
      step: steps,
      progressBefore: round(progressBefore, 6),
      picked: {
        r: m.r, c: m.c, color: m.antBox.color, count: m.antBox.count,
        groupSize: m.groupSize, isChain: m.groupSize > 1
      },
      bufBefore: prevBuf,
      lastPick: s.lastPick,
      bufferCount: s.buffer.length,
      bufferAfter: bufView(s),
      progress: round(s.eliminatedPixels / s.totalPixels, 6),
      completedBoxes: s.completedBoxes
    });
  }
  if (isWon(s)) return { died: false, steps };
  return { died: true, steps, p, deathProgress: round(s.eliminatedPixels / s.totalPixels, 6), final: analyzeFinal(s), last8: allHistory.slice(-8), allSteps: allHistory, chain: chainInfo(allHistory, s), note: 'hit MAX_STEPS' };
}

const game = JSON.parse(fs.readFileSync(levelFile, 'utf8'));
const lv = A.parseLevel(A.fromGameFormat(game));

const out = { tool: '解剖_死亡局_97478', level: levelFile, seed: SEED, gamesPerP: NGAMES, pRows: [] };
let totalDeaths = 0;
for (const p of PLIST) {
  const rnd = lcg(SEED);
  const deaths = [];
  let wins = 0;
  for (let g = 0; g < NGAMES; g++) {
    const r = playInstrumented(lv, p, rnd);
    if (r.died) deaths.push({ game: g, ...r });
    else wins++;
  }
  totalDeaths += deaths.length;
  out.pRows.push({ p, games: NGAMES, wins, deaths: deaths.length, deathList: deaths });
  console.log(`p=${p}  wins=${wins}/100  deaths=${deaths.length}`);
}
out.totalDeaths = totalDeaths;
fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
console.log(`总死亡 ${totalDeaths}；写入 ${outFile}`);
