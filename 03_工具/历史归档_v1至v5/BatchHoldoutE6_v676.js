#!/usr/bin/env node
'use strict';

/**
 * E6.5: offline batch, stop, determinism and latency regression for the three
 * frozen story levels (006, 008, 014).
 *
 * This tool validates client-ready JSON only. It does not compile or tune any
 * target image, and it never writes a level that failed validation.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '游戏主bin', 'bin', 'js');
const OUT = path.join(ROOT, '实验关/关卡6/E6_v1');
const REPEATS = 9;
const MODULES = [
  'utils.js',
  'color-libs.js',
  'simulator.js',
  'solver-strategy.js',
  'solver.js',
  'playersim.js',
  'analysis.js',
  'car-sequencer.js',
  'solver-analysis.js',
  'experience-goal.js',
  'capacity-tuner.js',
  'instant-playout.js',
  'generator.js'
];

function loadSolver() {
  const sandbox = {
    console,
    WeakMap,
    Map,
    Set,
    Date,
    Math,
    JSON,
    Object,
    Array,
    String,
    Number,
    isNaN,
    parseInt,
    parseFloat,
    isFinite,
    setTimeout,
    clearTimeout
  };
  sandbox.global = sandbox;
  vm.createContext(sandbox);
  for (const file of MODULES) {
    vm.runInContext(fs.readFileSync(path.join(BIN, file), 'utf8'), sandbox, { filename: file });
  }
  return sandbox.AntSolver;
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function stableDigest(value) {
  return sha256(Buffer.from(JSON.stringify(value)));
}

function uniquePicks(run) {
  const seen = new Set();
  const out = [];
  for (const pick of run.pickOrder || []) {
    if (seen.has(pick.step)) continue;
    seen.add(pick.step);
    out.push({ r: pick.r, c: pick.c, color: pick.color, count: pick.count });
  }
  return out;
}

function routeKey(picks) {
  return picks.map(pick => pick.r + ',' + pick.c).join('>');
}

function percentile(values, fraction) {
  const sorted = values.slice().sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = Math.max(0, Math.ceil(fraction * sorted.length) - 1);
  return Math.round(sorted[index] * 1000) / 1000;
}

function loadCase(A, spec) {
  const bytes = fs.readFileSync(spec.file);
  const raw = JSON.parse(bytes.toString('utf8'));
  const level = A.parseLevel(A.fromGameFormat(raw));
  const boxes = [];
  let black = 0;
  let minCapacity = Infinity;
  let maxCapacity = -Infinity;
  for (const row of level.board.cells) {
    for (const cell of row) {
      if (!cell) continue;
      if (cell.t === 'black') black++;
      if (cell.t === 'box') {
        boxes.push(cell);
        minCapacity = Math.min(minCapacity, cell.count);
        maxCapacity = Math.max(maxCapacity, cell.count);
      }
    }
  }
  return {
    spec,
    bytes,
    raw,
    level,
    counts: {
      boxes: boxes.length,
      black,
      capacitySum: boxes.reduce((sum, box) => sum + box.count, 0),
      minCapacity,
      maxCapacity
    }
  };
}

function validateOnce(A, spec) {
  const started = Date.now();
  const timing = {};

  let loadStart = Date.now();
  const data = loadCase(A, spec);
  timing.loadMs = Date.now() - loadStart;

  const fileSha256 = sha256(data.bytes);
  const fiveKeys = Object.keys(data.raw).sort().join(',') ===
    ['blocks', 'mapcol', 'maprow', 'spools', 'toprow'].sort().join(',');
  const staticChecks = {
    expectedHash: fileSha256 === spec.expectedSha256,
    fiveKeys,
    boxes: data.counts.boxes === spec.expectedBoxes,
    black: data.counts.black === spec.expectedBlack,
    capacitySum: data.counts.capacitySum === 1225,
    capacityRange: data.counts.minCapacity >= 20 && data.counts.maxCapacity <= 40
  };

  const solveStart = Date.now();
  const solve = A.Solver.solveInstantChain(data.level, { timeBudgetMs: 20000 });
  timing.solveMs = Date.now() - solveStart;
  const solvePicks = uniquePicks(solve);
  const required = spec.requiredPicks;
  const solveRouteMatches = spec.routeMode === 'full'
    ? routeKey(solvePicks) === routeKey(required)
    : routeKey(solvePicks.slice(0, required.length)) === routeKey(required);

  const playerStart = Date.now();
  const players = [];
  for (const reviveCap of [0, 2]) {
    for (const seed of [7, 1009, 2027]) {
      const run = A.PlayerSim.run(data.level, {
        seed,
        instantChain: true,
        reviveCap
      });
      const picks = uniquePicks(run);
      const routeMatches = spec.routeMode === 'full'
        ? routeKey(picks) === routeKey(required)
        : routeKey(picks.slice(0, required.length)) === routeKey(required);
      players.push({
        seed,
        reviveCap,
        won: run.won,
        progress: run.progress,
        bufferPeak: run.bufferPeak,
        revivesUsed: run.revivesUsed,
        routeMatches
      });
    }
  }
  timing.playersMs = Date.now() - playerStart;

  const roundtripStart = Date.now();
  const roundtrip = A.parseLevel(A.fromGameFormat(A.toGameFormat(data.level)));
  const roundtripSolve = A.Solver.solveInstantChain(roundtrip, {
    timeBudgetMs: 20000,
    greedyOnly: true
  });
  timing.roundtripMs = Date.now() - roundtripStart;
  timing.totalMs = Date.now() - started;

  const checks = {
    ...staticChecks,
    solveCompleted: solve.completed && solve.progress === 100,
    solveRouteMatches,
    playersPass: players.every(player =>
      player.won && player.progress === 100 && player.routeMatches),
    noRevivePass: players.filter(player => player.reviveCap === 0)
      .every(player => player.revivesUsed === 0),
    roundtripPass: roundtripSolve.completed === true
  };
  const passed = Object.values(checks).every(Boolean);
  const deterministicResult = {
    id: spec.id,
    inputSha256: fileSha256,
    counts: data.counts,
    solveRoute: routeKey(required),
    players,
    checks
  };
  return {
    id: spec.id,
    passed,
    file: spec.file,
    fileSha256,
    timing,
    counts: data.counts,
    solve: {
      completed: solve.completed,
      progress: solve.progress,
      bufferPeak: solve.maxBuffer,
      routeMatches: solveRouteMatches
    },
    players,
    roundtrip: {
      completed: roundtripSolve.completed,
      progress: roundtripSolve.progress
    },
    checks,
    deterministicDigest: stableDigest(deterministicResult)
  };
}

function validateRepeated(A, spec) {
  const runs = [];
  for (let i = 0; i < REPEATS; i++) runs.push(validateOnce(A, spec));
  const digests = runs.map(run => run.deterministicDigest);
  const allPassed = runs.every(run => run.passed);
  const deterministic = digests.every(digest => digest === digests[0]);
  const timings = runs.map(run => run.timing);
  return {
    id: spec.id,
    passed: allPassed && deterministic,
    allRunsPassed: allPassed,
    deterministic,
    repeats: REPEATS,
    uniqueDigests: [...new Set(digests)],
    result: runs[runs.length - 1],
    timing: {
      totalMs: timings.map(item => item.totalMs),
      loadMs: timings.map(item => item.loadMs),
      solveMs: timings.map(item => item.solveMs),
      playersMs: timings.map(item => item.playersMs),
      roundtripMs: timings.map(item => item.roundtripMs),
      p50Ms: percentile(timings.map(item => item.totalMs), 0.5),
      p90Ms: percentile(timings.map(item => item.totalMs), 0.9)
    }
  };
}

function writePassOnly(outputDir, id, result) {
  if (!result.passed) return null;
  fs.mkdirSync(outputDir, { recursive: true });
  const file = path.join(outputDir, id + '.json');
  fs.writeFileSync(file, JSON.stringify({
    id,
    passed: result.passed,
    fileSha256: result.fileSha256,
    deterministicDigest: result.deterministicDigest
  }, null, 2) + '\n');
  return file;
}

function runStopTest(A, specs) {
  const dir = path.join(OUT, 'stop-test-output');
  fs.mkdirSync(dir, { recursive: true });
  for (const entry of fs.readdirSync(dir)) {
    if (entry.endsWith('.json')) fs.unlinkSync(path.join(dir, entry));
  }

  const jobs = [
    { type: 'valid', spec: specs[0] },
    { type: 'invalid', file: path.join(OUT, '__missing_holdout__.json') },
    { type: 'valid', spec: specs[2] }
  ];
  const attempts = [];
  let status = 'COMPLETED';
  for (const job of jobs) {
    if (job.type === 'invalid') {
      attempts.push({ id: 'invalid-fixture', attempted: true, passed: false });
      status = 'STOPPED';
      break;
    }
    const result = validateOnce(A, job.spec);
    const output = writePassOnly(dir, job.spec.id, result);
    attempts.push({
      id: job.spec.id,
      attempted: true,
      passed: result.passed,
      output
    });
  }
  const files = fs.readdirSync(dir).filter(file => file.endsWith('.json')).sort();
  const checks = {
    stoppedAtFailure: status === 'STOPPED' && attempts.length === 2,
    skippedAfterFailure: files.length === 1 && files[0] === specs[0].id + '.json',
    failedJobNotWritten: !files.some(file => file.includes('invalid')),
    completedPassWritten: files[0] === specs[0].id + '.json'
  };
  return {
    status,
    abortOnFailure: true,
    attempts,
    outputDir: dir,
    outputFiles: files,
    checks,
    passed: Object.values(checks).every(Boolean)
  };
}

function main() {
  const A = loadSolver();
  const specs = [
    {
      id: '006',
      file: path.join(ROOT, '实验关/关卡6/E5_v1/006_E5_combined.json'),
      expectedSha256: '8e6d586edd50fe6bce803a003b76c98965f1fe0f7fa8302233d619ee8de1b92b',
      expectedBoxes: 47,
      expectedBlack: 2,
      routeMode: 'prefix',
      requiredPicks: [
        { r: 0, c: 2 },
        { r: 0, c: 1 },
        { r: 1, c: 0 },
        { r: 0, c: 3 },
        { r: 1, c: 3 }
      ]
    },
    {
      id: '008',
      file: path.join(ROOT, '实验关/关卡8/原型_v2/关卡_实验_008_v2.json'),
      debug: path.join(ROOT, '实验关/关卡8/原型_v2/关卡_实验_008_v2.debug.json'),
      expectedSha256: '3f855b9a29d186d11575ed411dfda7a0cba05e050b0e200cec2eb94ed8590944',
      expectedBoxes: 47,
      expectedBlack: 2,
      routeMode: 'full'
    },
    {
      id: '014',
      file: path.join(ROOT, '实验关/关卡14/原型_v1/关卡_实验_014_v1.json'),
      debug: path.join(ROOT, '实验关/关卡14/原型_v1/关卡_实验_014_v1.debug.json'),
      expectedSha256: '8f863e246ecbb0435a086a60cfbd57442458e90fe0fbb4b269042e192c13779e',
      expectedBoxes: 48,
      expectedBlack: 1,
      routeMode: 'full'
    }
  ];
  for (const spec of specs) {
    if (!spec.requiredPicks) {
      const debug = JSON.parse(fs.readFileSync(spec.debug, 'utf8'));
      spec.requiredPicks = debug.evidence.map(item => ({ r: item.r, c: item.c }));
    }
  }

  const batchStarted = Date.now();
  const results = specs.map(spec => validateRepeated(A, spec));
  const batchWallMs = Date.now() - batchStarted;
  const allTimings = results.flatMap(result => result.timing.totalMs);
  const stopTest = runStopTest(A, specs);
  const passed = results.every(result => result.passed) && stopTest.passed;

  const report = {
    schema: 'e6-batch-report-v1',
    status: passed ? 'E6_BATCH_PASS' : 'E6_BATCH_FAIL',
    generatedAt: new Date().toISOString(),
    scope: 'frozen client-ready validation only; no target compile or tuning',
    repeatsPerImage: REPEATS,
    batchWallMs,
    aggregateTiming: {
      samples: allTimings.length,
      p50Ms: percentile(allTimings, 0.5),
      p90Ms: percentile(allTimings, 0.9),
      minMs: Math.min(...allTimings),
      maxMs: Math.max(...allTimings)
    },
    cases: results.map(result => ({
      id: result.id,
      passed: result.passed,
      deterministic: result.deterministic,
      uniqueDigests: result.uniqueDigests,
      counts: result.result.counts,
      solve: result.result.solve,
      players: result.result.players,
      timing: result.timing
    })),
    stopTest
  };

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(
    path.join(OUT, 'e6-batch-report-v1.json'),
    JSON.stringify(report, null, 2) + '\n'
  );
  fs.writeFileSync(
    path.join(OUT, 'e6-batch-manifest-v1.json'),
    JSON.stringify({
      schema: 'e6-batch-manifest-v1',
      status: report.status,
      inputs: specs.map(spec => ({
        id: spec.id,
        file: spec.file,
        sha256: spec.expectedSha256,
        routeMode: spec.routeMode,
        requiredSteps: spec.requiredPicks.length
      }))
    }, null, 2) + '\n'
  );
  fs.writeFileSync(
    path.join(OUT, 'e6-batch-report-v1.md'),
    [
      '# E6.5 · 三图离线批量回归',
      '',
      '## 结论',
      '',
      passed ? '通过：006/008/014三图批量验收、重复确定性和失败停止均通过。'
        : '失败：保留批量证据，不进入生产UI接入。',
      '',
      '## 总耗时',
      '',
      `- ${REPEATS}次/图，共${allTimings.length}个样本；`,
      `- P50：${report.aggregateTiming.p50Ms}ms；`,
      `- P90：${report.aggregateTiming.p90Ms}ms；`,
      `- 批次墙钟：${batchWallMs}ms。`,
      '',
      '## 逐图',
      '',
      '| 图 | 结果 | hash稳定 | 全知 | PlayerSim | P50 | P90 |',
      '|---|---|---|---:|---|---:|---:|',
      ...results.map(result =>
        `| ${result.id} | ${result.passed ? '通过' : '失败'} | ` +
        `${result.deterministic ? '是' : '否'} | ${result.result.solve.progress}% | ` +
        `${result.result.players.filter(player => player.won).length}/6 | ` +
        `${result.timing.p50Ms}ms | ${result.timing.p90Ms}ms |`
      ),
      '',
      '## 失败停止',
      '',
      `- 状态：${stopTest.status}；`,
      `- 尝试任务：${stopTest.attempts.length}；`,
      `- 已落盘：${stopTest.outputFiles.join('、') || '无'}；`,
      `- 失败任务未落盘：${stopTest.checks.failedJobNotWritten ? '是' : '否'}；`,
      `- 失败后第三任务跳过：${stopTest.checks.skippedAfterFailure ? '是' : '否'}。`,
      ''
    ].join('\n') + '\n'
  );

  console.log(JSON.stringify({
    ok: passed,
    outDir: OUT,
    batchWallMs,
    aggregateTiming: report.aggregateTiming,
    cases: report.cases.map(item => ({
      id: item.id,
      passed: item.passed,
      deterministic: item.deterministic,
      solve: item.solve,
      p50Ms: item.timing.p50Ms,
      p90Ms: item.timing.p90Ms
    })),
    stopTest
  }, null, 2));
}

try {
  main();
} catch (err) {
  console.error(err && err.stack || err);
  process.exit(1);
}
