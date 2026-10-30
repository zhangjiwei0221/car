#!/usr/bin/env node
/** v556：验证目标体验显著释放配置包接入，并保护时间模式hash。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..', '..');
const BIN = path.join(ROOT, '02_工程', '游戏主bin', 'bin', 'js');
const FILES = ['utils.js', 'color-libs.js', 'simulator.js', 'solver-strategy.js', 'solver.js',
  'playersim.js', 'analysis.js', 'car-sequencer.js', 'solver-analysis.js', 'experience-goal.js',
  'capacity-tuner.js', 'instant-playout.js', 'generator.js', 'source-preflight.js'];
const IMAGE = '蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_007.txt';
const TIME_HASH = '0f5310dd5cbae645b8857bae89ccf28364708ee0b791a320f31d06bc157646de';
const CASES = [
  { seed: 1001, expectedHash: '0f72e44ee766c984259f16138bfa5ecde65be9d9edf28e3aed50cc429cb1132e', structuralPass: false },
  { seed: 1002, expectedHash: 'eeff5444341e501b56573fb996528ee7ffdd6355167bb7ffbda4bec9ee510551', structuralPass: true },
  { seed: 32677, expectedHash: '4e670942c6ab918a2c6c0e64bf6e00752c25db86c30477aeb59a1e5ca505c1ae', structuralPass: true }
];
const OUT = path.resolve(ROOT, '03_工具/好关评分/目标显著释放接入_v556.json');
const requestedOut = process.argv.find(x => x.startsWith('--out='));
const outPath = requestedOut ? path.resolve(ROOT, requestedOut.slice(6)) : OUT;

function load() {
  const sb = { console: { log() {}, warn() {}, error() {} }, module: { exports: {} },
    WeakMap, Map, Set, Date, Math, JSON, setTimeout, clearTimeout, Infinity };
  vm.createContext(sb);
  for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(BIN, f), 'utf8'), sb, { filename: f });
  return sb.AntSolver;
}
function hash(x) { return crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex'); }
function targetCfg(seed) {
  return {
    seed, ruleMode: 'instantChain', generatorFlow: 'new_fixed',
    boxSizeMin: 20, boxSizeMax: 40, capNormMin: 20, capNormMax: 40,
    boardRowsMin: 9, boardRowsMax: 9, boardColsMin: 7, boardColsMax: 7,
    boardHardRange: true, boardAuto: false, boardAllowSquare: true, boardFitGuard: 'warn',
    p7BaseCount: 0, p7Repair: false, trapPost: false, pool: 1,
    instantPlanPolicy: 'shortDebt', instantPlanTargetBuffer: 4,
    instantPlanMaxDebt: 40, instantPlanDebtEvery: 2,
    instantPlanBranchCount: 2, instantPlanBranchDebtRoots: true,
    instantPlanBranchPrefixDebts: 12,
    targetCarCount: 52, blackPercent: 10,
    experienceGoal: true, instantReleaseRoute: false,
    goalPerRoundMs: 20000, goalMaxMs: 30000, goalMaxRounds: 2,
    goalSharedBudget: true, candidateCount: 1, acceptMode: 'target',
    targetBand3Min: 0, targetBand4Min: 0, targetPlayerPassMin: 0
  };
}
function timeCfg(seed) {
  return {
    seed, ruleMode: 'instantChain', generatorFlow: 'new_fixed',
    boxSizeMin: 20, boxSizeMax: 40, capNormMin: 20, capNormMax: 40,
    boardRowsMin: 9, boardRowsMax: 9, boardColsMin: 7, boardColsMax: 7,
    boardHardRange: true, boardAuto: false, boardAllowSquare: true, boardFitGuard: 'warn',
    p7BaseCount: 0, p7Repair: false, trapPost: false, pool: 1,
    instantPlanPolicy: 'shortDebt', instantPlanTargetBuffer: 4,
    instantPlanMaxDebt: 40, instantPlanDebtEvery: 2,
    instantPlanBranchCount: 2, instantPlanBranchDebtRoots: true,
    instantPlanBranchPrefixDebts: 12,
    targetCarCount: 52, blackPercent: 10,
    experienceGoal: false, instantReleaseRoute: false,
    candidateCount: 1, rounds: 0, timeBudgetMs: 30000,
    acceptMode: 'time', targetBand3Min: 0, targetBand4Min: 0, targetPlayerPassMin: 0
  };
}
function runTarget(A, spec) {
  const G = A.Generator, blocks = G.blocksFromTXT(fs.readFileSync(path.join(ROOT, IMAGE), 'utf8'));
  const t0 = Date.now();
  let r = null;
  try { r = G.produceGoal(blocks, targetCfg(spec.seed)); }
  catch (e) { r = { level: null, valid: false, error: String((e && e.message) || e) }; }
  const level = r && r.level || null;
  if (!level) return { ...spec, valid: false, error: r && r.error || null, wallMs: Date.now() - t0 };
  const actualHash = hash(level), cfg = r.config || targetCfg(spec.seed);
  const ev = r._experienceFull || A.ExperienceGoal.evaluate(level, Object.assign({}, cfg, {
    solveResult: r.solveResult, decision: true, instantChain: true
  }));
  const rd = ev && ev.releaseDecision || {};
  const amplitude = rd.evidence && rd.evidence.releaseAmplitude;
  const rec = {
    seed: spec.seed, valid: !!r.valid, wallMs: Date.now() - t0,
    expectedHash: spec.expectedHash, actualHash, v547HashMatch: actualHash === spec.expectedHash,
    structuralPass: !!spec.structuralPass,
    config: {
      maxDecisionStates: cfg.maxDecisionStates,
      stateSampleMode: cfg.stateSampleMode,
      minReleaseAmplitude: cfg.minReleaseAmplitude
    },
    target: ev && ev.target ? ev.target : null,
    release: { status: rd.status, decisionsTried: rd.decisionsTried,
      alternativesTried: rd.alternativesTried, amplitude,
      step: rd.evidence && rd.evidence.referenceStep,
      finalReplayValid: rd.evidence && rd.evidence.finalReplayValid,
      sampling: rd.sampling || null },
    significantFound: !!(rd.status === 'found' && amplitude >= 2 && rd.evidence && rd.evidence.finalReplayValid),
    experiencePass: !!(ev && ev.pass),
    goalPass: !!G.goalResultExperiencePass(r, cfg),
    struct: !!G.goalStructPass(r),
    hash: actualHash
  };
  console.log(JSON.stringify({ seed: rec.seed, hashMatch: rec.v547HashMatch, config: rec.config,
    release: rec.release, significantFound: rec.significantFound, experiencePass: rec.experiencePass,
    goalPass: rec.goalPass, struct: rec.struct, wallMs: rec.wallMs }));
  return rec;
}
function runTime(A) {
  const G = A.Generator, blocks = G.blocksFromTXT(fs.readFileSync(path.join(ROOT, IMAGE), 'utf8'));
  const r = G.produceFixed(blocks, timeCfg(1001));
  const actualHash = r && r.level ? hash(r.level) : null;
  return {
    valid: !!(r && r.valid), hash: actualHash, expectedHash: TIME_HASH,
    hashMatch: actualHash === TIME_HASH,
    config: r && r.config ? {
      maxDecisionStates: r.config.maxDecisionStates,
      stateSampleMode: r.config.stateSampleMode,
      minReleaseAmplitude: r.config.minReleaseAmplitude
    } : null,
    elapsedMs: r && r.elapsedMs
  };
}

const A = load();
const targets = CASES.map(spec => runTarget(A, spec));
const time = runTime(A);
const configOk = targets.every(x => x.config && x.config.maxDecisionStates === 8 &&
  x.config.stateSampleMode === 'midStratified' && x.config.minReleaseAmplitude === 2);
const structuralRows = targets.filter(x => x.structuralPass);
const structuralFound = structuralRows.filter(x => x.significantFound);
const row1001 = targets.find(x => x.seed === 1001);
const summary = {
  targetRows: targets.length,
  targetValid: targets.filter(x => x.valid).length,
  configOk,
  v547HashMatches: targets.filter(x => x.v547HashMatch).map(x => x.seed),
  structuralSignificantFound: structuralFound.map(x => x.seed),
  sample1001Status: row1001 && row1001.release && row1001.release.status,
  wholeGoalPass: targets.filter(x => x.goalPass).map(x => x.seed),
  timeMode: time,
  pass: configOk && structuralFound.length === structuralRows.length &&
    row1001 && row1001.goalPass === false && time.hashMatch
};
summary.decision = summary.pass
  ? '目标体验配置包接入正确，两个结构样本达到完整目标通过；1001虽有显著释放但结构门未过、goalPass=false；时间模式hash不变。'
  : '接入保护未全部通过；不得宣称生产完成，需按失败项回退或修正。';
const report = { schema: 'goal-significant-release-integration-v556', date: '2026-10-26',
  preregistration: '目标显著释放接入_预登记_v556.md', summary, targets, timeMode: time };
fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ summary }, null, 2));
if (!summary.pass) process.exitCode = 1;
