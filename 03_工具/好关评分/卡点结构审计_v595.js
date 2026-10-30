#!/usr/bin/env node
/** v595：对 v588～v594 全部 maxBuffer>=3 候选做同一口径的真实卡点结构审计。 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '游戏主bin', 'bin', 'js');
const OUT = path.join(__dirname, '卡点结构审计_v595.json');
const FILES = [
  'utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js',
  'playersim.js', 'analysis.js', 'car-sequencer.js', 'solver-analysis.js',
  'experience-goal.js', 'capacity-tuner.js', 'instant-playout.js', 'generator.js',
  'source-preflight.js'
];

function load() {
  const sb = {
    console: { log() {}, warn() {}, error() {} },
    module: { exports: {} },
    WeakMap, Map, Set, Date, Math, JSON, setTimeout, clearTimeout, Infinity
  };
  vm.createContext(sb);
  for (const f of FILES) {
    vm.runInContext(fs.readFileSync(path.join(BIN, f), 'utf8'), sb, { filename: f });
  }
  return sb.AntSolver;
}

const A = load();
const G = A.Generator;
const GATES = G.CHOKE_V2_GATES;

const SOURCES = [
  {
    version: 'v588', report: '债务策略AB_v588.json',
    levelDir: '债务策略AB_v588_shortDebt.levels', maxBufferFrom: 'shortDebt'
  },
  { version: 'v589', report: '短债单车交换_v589.json', levelDir: '短债单车交换_v589.levels' },
  { version: 'v590', report: '短债单车交换_第二轮_v590.json', levelDir: '短债单车交换_第二轮_v590.levels' },
  { version: 'v591', report: '短债单车交换_第三轮_v591.json', levelDir: '短债单车交换_第三轮_v591.levels' },
  { version: 'v592', report: '短债单车交换_受限穷举_v592.json', levelDir: '短债单车交换_受限穷举_v592.levels' },
  { version: 'v593', report: '短债单车交换_第四轮_v593.json', levelDir: '短债单车交换_第四轮_v593.levels' },
  { version: 'v594', report: '短债单车交换_第五轮_v594.json', levelDir: '短债单车交换_第五轮_v594.levels' }
];

function round(n, digits) {
  if (n == null || !Number.isFinite(+n)) return null;
  const p = Math.pow(10, digits == null ? 3 : digits);
  return Math.round(+n * p) / p;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function candidateRecords() {
  const out = [];
  for (const src of SOURCES) {
    const reportFile = path.join(__dirname, src.report);
    const report = readJson(reportFile);
    let rows;
    if (src.maxBufferFrom) {
      rows = report.rows.filter(x => x.policy === src.maxBufferFrom && x.maxBuffer >= 3);
    } else {
      rows = report.rows.filter(x => x.maxBuffer >= 3);
    }
    for (const row of rows) {
      const id = row.id || (src.version === 'v588' && row.policy === 'shortDebt' ? '1001' : row.policy);
      const levelFile = path.join(__dirname, src.levelDir, id + '.json');
      const routeFile = path.join(__dirname, src.levelDir, id + '.route.json');
      if (!fs.existsSync(levelFile) || !fs.existsSync(routeFile)) {
        out.push({
          version: src.version, id, missing: true,
          levelFile: path.relative(ROOT, levelFile), routeFile: path.relative(ROOT, routeFile),
          recorded: row
        });
        continue;
      }
      out.push({
        version: src.version, id, missing: false,
        levelFile, routeFile, recorded: row
      });
    }
  }
  return out;
}

function measureLine(parsed, order, opts) {
  const S = A.Simulator;
  if (!S || !S.enter || !S.listMoves || !S.applyPick || !order || !order.length) return null;
  let st;
  try {
    st = S.enter(parsed, Object.assign({ useSlotStart: true, instantChain: true }, opts || {}));
  } catch (e) {
    return { error: String(e && e.message || e) };
  }

  let n = 0, bridges = 0, run = 0, maxRun = 0, soft = 0;
  let minPick = 99, noGood = 0, earlySteps = 0, early34 = 0;
  let stepsBefore70 = 0, hiBefore70 = 0;
  const bridgeAt = [], r9At = [], samples = [];
  let lastDone = st.completedBoxes || 0;

  try {
    for (const p of order) {
      if (!p || p.r == null) continue;
      const moves = S.listMoves(st);
      const pickable = moves.length;
      let safe = 0, good = 0, traps = 0;
      for (const m of moves) {
        if (m.blocked) continue;
        safe++;
        if (m.canConsume) good++;
        else traps++;
      }

      const prog = st.totalBoxes ? st.completedBoxes / st.totalBoxes : 0;
      let leftBoxes = 0;
      for (let r = 0; r < st.boardRows; r++) {
        for (let c = 0; c < st.boardCols; c++) {
          const cell = st.cells[r][c];
          if (cell && cell.t === 'box') leftBoxes++;
        }
      }
      const tail = prog >= 0.90 || leftBoxes <= 3;
      const buf = st.buffer.length;
      const pc = Math.round(prog * 100);
      n++;

      if (prog < 0.30) {
        earlySteps++;
        if (buf >= 3 && buf <= 4) early34++;
      }
      if (prog < 0.70) {
        stepsBefore70++;
        if (buf >= 4) hiBefore70++;
      }
      if (pickable < minPick) minPick = pickable;
      if (pickable === 1) {
        if (!tail) {
          bridges++;
          bridgeAt.push(pc);
        }
        run++;
        if (run > maxRun) maxRun = run;
      } else {
        run = 0;
      }
      if (pickable >= 2 && safe === 1) soft++;
      if (pickable >= 2 && good === 1 && traps >= 1) r9At.push(pc);
      if (good === 0) noGood++;

      S.applyPick(st, p.r, p.c);
      if (st.completedBoxes !== lastDone) {
        lastDone = st.completedBoxes;
        samples.push({ done: lastDone, buf: st.buffer.length });
      }
      if (st.gameOver) break;
    }
  } catch (e) {
    return {
      error: String(e && e.message || e),
      partialSteps: n,
      completedBoxes: st.completedBoxes || 0,
      totalBoxes: st.totalBoxes || parsed.totalBoxes || 0
    };
  }

  if (!n) return null;
  const totalBoxes = st.totalBoxes || parsed.totalBoxes || 0;
  const bufferLimit = parsed.bufferLimit || st.bufferLimit || 5;
  const audit = A.Analysis && A.Analysis.chokepointAudit
    ? A.Analysis.chokepointAudit(samples, totalBoxes, bufferLimit)
    : null;
  const pressure = A.SolverAnalysis && A.SolverAnalysis.pressureFromSeries
    ? A.SolverAnalysis.pressureFromSeries(samples.map(s => ({
        buffer: s.buf,
        progress: totalBoxes ? s.done / totalBoxes : 0
      })), bufferLimit)
    : null;

  return {
    steps: n,
    completedBoxes: st.completedBoxes || 0,
    totalBoxes,
    won: !!(st.eliminatedPixels >= st.totalPixels || st.gameWon),
    bridges,
    bridgeAt,
    maxRun,
    soft,
    r9: r9At.length,
    r9At,
    minPick: minPick === 99 ? 0 : minPick,
    noGood,
    earlySteps,
    early34,
    early34Pct: earlySteps ? Math.round(early34 / earlySteps * 100) : 0,
    hiBefore70Pct: stepsBefore70 ? Math.round(hiBefore70 / stepsBefore70 * 100) : 0,
    midLatePeak: audit ? audit.lateMax : null,
    midLateAt: audit ? audit.lateAt : null,
    peakBuf: audit ? audit.peakBuf : null,
    significantReleases: pressure ? pressure.significantReleaseCount : null,
    maxReleaseAmplitude: pressure && pressure.releaseAmplitudes && pressure.releaseAmplitudes.length
      ? Math.max(...pressure.releaseAmplitudes) : 0
  };
}

function legacySamples(parsed, order) {
  const S = A.Simulator;
  if (!S || !S.enter || !S.applyPick || !order || !order.length) return [];
  const st = S.enter(parsed, { useSlotStart: true });
  const samples = [];
  let lastDone = st.completedBoxes || 0;
  try {
    for (const p of order) {
      if (!p || p.r == null) continue;
      S.applyPick(st, p.r, p.c);
      if (st.completedBoxes !== lastDone) {
        lastDone = st.completedBoxes;
        samples.push({ done: lastDone, buf: st.buffer.length });
      }
      if (st.gameOver) break;
    }
  } catch (e) {
    return samples;
  }
  return samples;
}

function releaseStats(samples, totalBoxes, bufferLimit) {
  if (!A.SolverAnalysis || !A.SolverAnalysis.pressureFromSeries) return null;
  const p = A.SolverAnalysis.pressureFromSeries((samples || []).map(s => ({
    buffer: s.buf,
    progress: totalBoxes ? s.done / totalBoxes : 0
  })), bufferLimit || 5);
  return {
    significantReleases: p.significantReleaseCount,
    maxReleaseAmplitude: p.releaseAmplitudes && p.releaseAmplitudes.length
      ? Math.max(...p.releaseAmplitudes) : 0,
    oscillationCount: p.oscillationCount
  };
}

function worstOf(omni, player) {
  if (!omni && !player) return null;
  const pick = (key, mode) => {
    const vals = [omni, player].filter(Boolean).map(x => x[key]).filter(x => x != null);
    if (!vals.length) return null;
    return mode === 'max' ? Math.max(...vals) : Math.min(...vals);
  };
  return {
    bridges: pick('bridges', 'max'),
    r9: pick('r9', 'min'),
    noGood: pick('noGood', 'max'),
    hiBefore70Pct: pick('hiBefore70Pct', 'max'),
    early34Pct: pick('early34Pct', 'min'),
    midLatePeak: pick('midLatePeak', 'min'),
    peakBuf: pick('peakBuf', 'min')
  };
}

function gateFailures(w) {
  const fails = [];
  if (!w) return ['无指标'];
  if (w.bridges > GATES.bridgeMax) fails.push('独木桥');
  if (w.r9 < GATES.r9Min) fails.push('预算判断点');
  if (w.noGood > GATES.noGoodMax) fails.push('无满解');
  if (w.hiBefore70Pct > GATES.hiBefore70PctMax) fails.push('70%前高压');
  if (w.early34Pct < GATES.early34MinPct) fails.push('前期限压');
  if (w.midLatePeak != null && w.midLatePeak < GATES.midLatePeakMin) fails.push('中后期峰窗');
  return fails;
}

function stripRecorded(row) {
  if (!row) return null;
  return {
    policy: row.policy || null,
    id: row.id || null,
    maxBuffer: row.maxBuffer,
    quality: row.quality || null,
    curve: row.curve || null,
    experiencePass: row.experiencePass == null ? null : !!row.experiencePass,
    levelHash: row.levelHash || null
  };
}

const files = candidateRecords();
const rows = [];
for (let i = 0; i < files.length; i++) {
  const rec = files[i];
  if (rec.missing) {
    rows.push({
      version: rec.version,
      id: rec.id,
      missing: true,
      raw: stripRecorded(rec.recorded),
      levelFile: rec.levelFile,
      routeFile: rec.routeFile
    });
    console.log('[v595]', rec.version, rec.id, 'missing level or route');
    continue;
  }

  const t0 = Date.now();
  const level = readJson(rec.levelFile);
  const route = readJson(rec.routeFile);
  const parsed = A.parseLevel(level);
  const capacities = [];
  for (const row of parsed.board.cells || []) {
    for (const cell of row || []) {
      if (cell && cell.t === 'box' && cell.count != null) capacities.push(cell.count);
    }
  }
  capacities.sort((a, b) => a - b);
  const obstacles = A.Analysis && A.Analysis.obstacleStats
    ? A.Analysis.obstacleStats(parsed) : null;
  const omniInstant = measureLine(parsed, route);
  const ps = A.PlayerSim && A.PlayerSim.run
    ? A.PlayerSim.run(parsed, { seed: 7, instantChain: true })
    : null;
  const playerInstant = ps ? measureLine(parsed, ps.pickOrder || []) : null;
  const greedyRun = G.chokeV2GreedyLine ? G.chokeV2GreedyLine(parsed) : null;
  const greedyInstant = greedyRun ? measureLine(parsed, greedyRun.pickOrder || []) : null;
  const omniSamples = legacySamples(parsed, route);
  const playerSamples = ps && ps.pressureSamples ? ps.pressureSamples : [];
  const greedySamples = greedyRun ? legacySamples(parsed, greedyRun.pickOrder || []) : [];
  const v2 = G.chokeV2Of(parsed, {
    pickOrder: route,
    pressureSamples: omniSamples
  }, ps ? {
    pickOrder: ps.pickOrder || [],
    pressureSamples: playerSamples
  } : null, true);
  const failures = v2 ? G.chokeV2Violations(v2.worst) : ['无指标'];
  const totalBoxes = parsed.totalBoxes || 0;
  const bufferLimit = parsed.bufferLimit || 5;
  const row = {
    version: rec.version,
    id: rec.id,
    missing: false,
    levelFile: path.relative(ROOT, rec.levelFile),
    routeFile: path.relative(ROOT, rec.routeFile),
    raw: stripRecorded(rec.recorded),
    structure: {
      board: parsed.board.rows + 'x' + parsed.board.cols,
      cars: capacities.length,
      capacityMin: capacities.length ? capacities[0] : null,
      capacityMax: capacities.length ? capacities[capacities.length - 1] : null,
      anchor40: capacities.filter(x => x >= 40).length,
      small6to18: capacities.filter(x => x >= 6 && x <= 18).length,
      obstacles
    },
    playerSim: ps ? {
      won: !!ps.won,
      coveragePct: ps.coveragePct,
      picks: ps.picks || (ps.pickOrder || []).length,
      pads: ps.pads,
      pipeBets: ps.pipeBets
    } : null,
    greedyRun: greedyRun ? {
      won: !!greedyRun.won,
      coveragePct: greedyRun.coveragePct,
      pads: greedyRun.pads,
      pipeBets: greedyRun.pipeBets
    } : null,
    reference: {
      pass: failures.length === 0,
      failures,
      gateCount: 6,
      passedGateCount: 6 - failures.length,
      omni: v2 ? v2.omni : null,
      player: v2 ? v2.player : null,
      greedy: v2 ? v2.greedy : null,
      greedyRun: v2 ? v2.greedyRun : null,
      worst: v2 ? v2.worst : null,
      release: {
        omni: releaseStats(omniSamples, totalBoxes, bufferLimit),
        player: releaseStats(playerSamples, totalBoxes, bufferLimit),
        greedy: releaseStats(greedySamples, totalBoxes, bufferLimit)
      }
    },
    instant: {
      omni: omniInstant,
      player: playerInstant,
      greedy: greedyInstant
    },
    elapsedMs: Date.now() - t0
  };
  rows.push(row);
  const p = row.reference.player || row.instant.player || {};
  const o = row.reference.omni || row.instant.omni || {};
  console.log('[v595]', rec.version, rec.id,
    'omni r9=' + o.r9 + ' early=' + o.early34Pct + ' noGood=' + o.noGood,
    '| player r9=' + p.r9 + ' early=' + p.early34Pct + ' noGood=' + p.noGood,
    '| worst peak=' + (row.reference.worst && row.reference.worst.midLatePeak),
    '| pass=' + row.reference.pass,
    'ms=' + row.elapsedMs);
}

const valid = rows.filter(x => !x.missing);
const byVersion = {};
for (const r of rows) {
  const b = byVersion[r.version] || (byVersion[r.version] = { total: 0, missing: 0, pass: 0 });
  b.total++;
  if (r.missing) b.missing++;
  else if (r.reference.pass) b.pass++;
}

valid.sort((a, b) => {
  if (a.reference.pass !== b.reference.pass) return a.reference.pass ? -1 : 1;
  const af = a.reference.failures.length, bf = b.reference.failures.length;
  if (af !== bf) return af - bf;
  const ar = a.reference.worst && a.reference.worst.r9 || 0;
  const br = b.reference.worst && b.reference.worst.r9 || 0;
  if (ar !== br) return br - ar;
  const ap = a.reference.worst && a.reference.worst.midLatePeak || 0;
  const bp = b.reference.worst && b.reference.worst.midLatePeak || 0;
  return bp - ap;
});

const best = valid[0] || null;
const byPlayerR9 = valid.slice().sort((a, b) =>
  ((b.reference.player && b.reference.player.r9) || 0) -
  ((a.reference.player && a.reference.player.r9) || 0))[0] || null;
const byPlayerPeak = valid.slice().sort((a, b) =>
  ((b.reference.worst && b.reference.worst.midLatePeak) || 0) -
  ((a.reference.worst && a.reference.worst.midLatePeak) || 0))[0] || null;
function compact(row) {
  if (!row) return null;
  return {
    version: row.version,
    id: row.id,
    maxBuffer: row.raw && row.raw.maxBuffer,
    failures: row.reference.failures,
    passedGateCount: row.reference.passedGateCount,
    worst: row.reference.worst,
    player: row.reference.player ? Object.assign({}, row.reference.player, {
      significantReleases: row.reference.release.player && row.reference.release.player.significantReleases,
      maxReleaseAmplitude: row.reference.release.player && row.reference.release.player.maxReleaseAmplitude
    }) : null
  };
}
const report = {
  schema: 'choke-structure-audit-v595',
  date: '2026-10-27',
  note: '只读审计；生产参考门沿用 CHOKE_V2_GATES，未修改 v575。',
  scope: {
    versions: SOURCES.map(x => x.version),
    sourceRule: 'all recorded maxBuffer>=3 candidates with saved level+route',
    candidates: rows.length,
    audited: valid.length,
    missing: rows.length - valid.length
  },
  gates: GATES,
  byVersion,
  summary: {
    referencePass: valid.filter(x => x.reference.pass).length,
    playerHasEarlyChoke: valid.filter(x => x.reference.player &&
      x.reference.player.early34Pct >= GATES.early34MinPct).length,
    playerHasMultiDecision: valid.filter(x => x.reference.player &&
      x.reference.player.r9 >= GATES.r9Min).length,
    playerHasMidLatePeak: valid.filter(x => x.reference.worst &&
      x.reference.worst.midLatePeak >= GATES.midLatePeakMin).length,
    playerHasRelease: valid.filter(x => x.reference.release.player &&
      x.reference.release.player.significantReleases > 0).length,
    playerHasEarlyAndMulti: valid.filter(x => x.reference.player &&
      x.reference.player.early34Pct >= GATES.early34MinPct &&
      x.reference.player.r9 >= GATES.r9Min).length,
    playerHasMultiAndPeak: valid.filter(x => x.reference.player && x.reference.worst &&
      x.reference.player.r9 >= GATES.r9Min &&
      x.reference.worst.midLatePeak >= GATES.midLatePeakMin).length,
    noObstacleCandidates: valid.filter(x => x.structure.obstacles &&
      Object.keys(x.structure.obstacles).length === 0).length,
    allSixPlayerGates: valid.filter(x => x.reference.player &&
      gateFailures(x.reference.player).length === 0).length,
    bestByPassedGates: compact(best),
    bestByPlayerR9: compact(byPlayerR9),
    bestByPlayerPeak: compact(byPlayerPeak),
    maxPlayerR9: valid.length
      ? Math.max(...valid.map(x => x.reference.player && x.reference.player.r9 || 0)) : null,
    maxPlayerMidLatePeak: valid.length
      ? Math.max(...valid.map(x => x.reference.worst && x.reference.worst.midLatePeak || 0)) : null
  },
  rows
};

fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({
  out: path.relative(ROOT, OUT),
  scope: report.scope,
  summary: report.summary,
  bestByPassedGates: report.summary.bestByPassedGates,
  bestByPlayerR9: report.summary.bestByPlayerR9,
  bestByPlayerPeak: report.summary.bestByPlayerPeak
}, null, 2));
