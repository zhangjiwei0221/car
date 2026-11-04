#!/usr/bin/env node
'use strict';
/**
 * StagePlanCheck_v803 —— 阶段允许颜色 / 框车时机验证器
 *
 * 用法：
 *   node StagePlanCheck_v803.js <关卡.json> <阶段计划.json> [--out report.json]
 *
 * v803 在 v802 上增加：
 *   6. 债车释放必须晚于指定包围色完全消掉；
 *   7. 可校验释放瞬间的剩余像素数（如 31 包围里的 9px 白色口袋）。
 *
 * 验证口径：
 *   1. 用 Solver.runMinBuffer 的最小暂存路线逐步重放；
 *   2. 记录每个框色第一次进入可选池的步号；
 *   3. 当前阶段的未来框色不得在上一阶段达到门槛前进池；
 *   4. 门车不得被数字冰覆盖；
 *   5. 记录阶段门槛时的主体进度和未列入允许表的颜色。
 */
const fs = require('fs');
const path = require('path');
const B = require('./Build006Thickness_v688');
const { detect } = require('./SubjectDetect_v800');

const A = B.loadSolver('corner');
const levelFile = process.argv[2];
const planFile = process.argv[3];
const outIdx = process.argv.indexOf('--out');
const outFile = outIdx > 0 ? process.argv[outIdx + 1] : null;
if (!levelFile || !planFile) {
  console.error('用法: node StagePlanCheck_v803.js <关卡.json> <阶段计划.json> [--out report.json]');
  process.exit(2);
}

const g = B.readJson(levelFile);
const plan = B.readJson(planFile);
const lv = A.parseLevel(A.fromGameFormat(g));
const subjects = detect(g.blocks || []);
const min = A.Solver.runMinBuffer(lv, { depth: 3 });
const Sim = A.Simulator;
const state = Sim.enter(lv, { useSlotStart: true, instantChain: false });
const frameColors = new Set();
for (const st of plan.stages || []) frameColors.add(Number(st.frameColor));
const firstSelectable = {};
const trace = [];
const bufferEvents = [];
const targetColorTotal = {};
for (const row of (g.blocks || [])) for (const col of row) if (col > 0) targetColorTotal[col] = (targetColorTotal[col] || 0) + 1;
const releaseGateColors = new Set((plan.debtEvents || []).map(ev => Number(ev.releaseRequiresColor)).filter(Boolean));
const colorCompletedStep = {};
function recordColorCompletion(stepNo) {
  for (const col of releaseGateColors) {
    if (colorCompletedStep[col] != null) continue;
    let left = 0;
    for (let r = 0; r < (g.blocks || []).length; r++) for (let c = 0; c < (g.blocks[r] || []).length; c++) {
      if (g.blocks[r][c] === col && !state.eliminated[r][c]) left++;
    }
    if (left === 0) colorCompletedStep[col] = stepNo;
  }
}

function subjectProgress(subjectName) {
  const alias = subjectName === '香肠' ? '烤肠' : subjectName;
  const sub = subjects.find(x => String(x.name).includes(alias));
  if (!sub) return null;
  let done = 0, total = 0;
  for (const k of sub.cells) {
    const [r, c] = String(k).split(',').map(Number);
    if (!g.blocks[r] || !(g.blocks[r][c] > 0)) continue;
    total++;
    if (state.eliminated[r][c]) done++;
  }
  return { name: sub.name, done, total, pct: total ? +(done / total * 100).toFixed(1) : 0 };
}
function progressMap() {
  const out = {};
  for (const st of plan.stages || []) out[st.subject] = subjectProgress(st.subject);
  return out;
}
function isIced(cell) {
  const t = cell && cell.type;
  return Array.isArray(t) ? t.includes(7) : t === 7;
}
function locateDoor(stage) {
  const d = stage.doorCar;
  if (!d) return null;
  const [r, c] = d.position || [];
  const cell = g.spools && g.spools[r] && g.spools[r][c];
  return cell || null;
}

let step = 0;
for (const p of min.pickOrder || []) {
  if (p.chainIndex !== 0) continue;
  const moves = Sim.listMoves(state).filter(m => !m.blocked);
  const colors = [...new Set(moves.map(m => Number(m.antBox.color)).filter(Number.isFinite))];
  for (const fc of frameColors) {
    if (colors.includes(fc) && firstSelectable[fc] == null) firstSelectable[fc] = step + 1;
  }
  const curStep = step + 1;
  trace.push({ step: curStep, pick: { color: p.color, count: p.count, r: p.r, c: p.c }, availableColors: colors, bufferBefore: state.buffer.length, progress: progressMap() });
  const beforeBuf = new Map((state.buffer || []).map(b => [b.key, { ...b }]));
  Sim.applyPick(state, p.r, p.c);
  recordColorCompletion(curStep);
  const afterBuf = new Map((state.buffer || []).map(b => [b.key, { ...b }]));
  for (const [k, b] of afterBuf) if (!beforeBuf.has(k)) bufferEvents.push({ type: 'enter', step: curStep, key: k, color: b.color, need: b.need, progress: b.progress, remaining: b.need - b.progress });
  for (const [k, b] of beforeBuf) if (!afterBuf.has(k)) bufferEvents.push({ type: 'release', step: curStep, key: k, color: b.color, need: b.need, progress: b.progress, remaining: b.need - b.progress });
  step++;
}
// Final state progress. 也写入 trace，供最后阶段的 100% 门槛命中。
const finalProgress = progressMap();
if (step > 0) trace.push({ step, pick: null, availableColors: [], bufferBefore: state.buffer.length, progress: finalProgress });
recordColorCompletion(step);

const violations = [];
const stages = [];
let priorGateStep = null;
for (let i = 0; i < (plan.stages || []).length; i++) {
  const st = plan.stages[i];
  const fc = Number(st.frameColor);
  const entry = firstSelectable[fc] == null ? null : firstSelectable[fc];
  const gatePct = st.completionGate && st.completionGate.progressPct != null ? Number(st.completionGate.progressPct) : 100;
  const gateTrace = trace.find(x => {
    const pr = x.progress[st.subject];
    return pr && pr.pct >= gatePct;
  });
  const gateStep = gateTrace ? gateTrace.step : null;
  const door = locateDoor(st);
  const doorIced = isIced(door);
  const rec = {
    stage: i + 1, subject: st.subject, frameColor: fc,
    frameFirstSelectableStep: entry,
    completionGatePct: gatePct,
    gateReachedStep: gateStep,
    progressAtGate: gateTrace ? gateTrace.progress : null,
    doorIced,
    allowedFrameColors: st.allowedFrameColors || [],
    allowedNonFrameColors: st.allowedNonFrameColors || []
  };
  if (doorIced) violations.push(`stage${i + 1}: 门车 ${fc} 被数字冰覆盖`);
  if (i > 0) {
    if (priorGateStep == null) violations.push(`stage${i + 1}: 上一阶段门槛未达到`);
    if (entry != null && priorGateStep != null && entry < priorGateStep) {
      violations.push(`stage${i + 1}: 框车 ${fc} 在第${entry}步提前进入，上一阶段第${priorGateStep}步才达到门槛`);
    }
    // This stage's own frame must not be selectable before the previous stage gate.
    const early = trace.filter(x => priorGateStep != null && x.step < priorGateStep && x.availableColors.includes(fc));
    rec.forbiddenFramesBeforeGate = early.length ? [fc] : [];
    if (early.length) violations.push(`stage${i + 1}: 框车 ${fc} 在上一阶段门槛前已进入可选池`);
  } else {
    // Before the first stage gate, no later frame color may enter the selectable pool.
    const laterFrames = (plan.stages || []).slice(1).map(x => Number(x.frameColor));
    const early = trace.filter(x => gateStep != null && x.step < gateStep && x.availableColors.some(c => laterFrames.includes(c)));
    rec.forbiddenFramesBeforeGate = [...new Set(early.flatMap(x => x.availableColors.filter(c => laterFrames.includes(c))))];
    if (rec.forbiddenFramesBeforeGate.length) violations.push(`stage1: 后续框车在阶段门槛前提前进入 ${rec.forbiddenFramesBeforeGate.join(',')}`);
  }
  // Unlisted non-frame colors are warnings, not a hard fail yet.
  const allowed = new Set([...(st.allowedFrameColors || []), ...(st.allowedNonFrameColors || [])]);
  const unlisted = new Set();
  for (const x of trace) for (const c of x.availableColors) if (!frameColors.has(c) && !allowed.has(c)) unlisted.add(c);
  rec.unlistedColors = [...unlisted];
  stages.push(rec);
  if (gateStep != null) priorGateStep = gateStep;
}

// Map a replay step to the active stage: stage 1 starts at step 1; later stages
// start when their frame car first enters the selectable pool.
const stageStarts = (plan.stages || []).map((st, i) => i === 0 ? 1 : (firstSelectable[Number(st.frameColor)] || null));
function stageAtStep(stepNo) {
  let ans = null;
  for (let i = 0; i < stageStarts.length; i++) {
    if (stageStarts[i] != null && stageStarts[i] <= stepNo) ans = i + 1;
  }
  return ans;
}
const debtResults = [];
for (const ev of (plan.debtEvents || [])) {
  const entries = bufferEvents.filter(x => x.type === 'enter' && x.color === Number(ev.color) && (ev.need == null || x.need === Number(ev.need)));
  const entry = entries.find(x => ev.enterStage == null || stageAtStep(x.step) === Number(plan.stageOrder.indexOf(ev.enterStage) + 1)) || entries[0] || null;
  let release = null;
  if (entry) release = bufferEvents.find(x => x.type === 'release' && x.key === entry.key);
  const enterStage = entry ? stageAtStep(entry.step) : null;
  const releaseStage = release ? stageAtStep(release.step) : null;
  const holdSteps = entry && release ? release.step - entry.step : null;
  const gateColor = ev.releaseRequiresColor == null ? null : Number(ev.releaseRequiresColor);
  const gateStep = gateColor == null ? null : (colorCompletedStep[gateColor] == null ? null : colorCompletedStep[gateColor]);
  const gateOk = gateColor == null || (gateStep != null && release && release.step >= gateStep);
  const releaseRemaining = release ? release.remaining : null;
  const remainingOk = ev.expectedReleaseRemaining == null || (releaseRemaining != null && releaseRemaining === Number(ev.expectedReleaseRemaining));
  const expectedEnter = ev.enterStage != null ? Number(plan.stageOrder.indexOf(ev.enterStage) + 1) : null;
  const expectedRelease = ev.releaseStage != null ? Number(plan.stageOrder.indexOf(ev.releaseStage) + 1) : null;
  const ok = !!entry && !!release &&
    (expectedEnter == null || enterStage === expectedEnter) &&
    (expectedRelease == null || releaseStage === expectedRelease) &&
    (ev.minHoldSteps == null || holdSteps >= Number(ev.minHoldSteps)) &&
    gateOk && remainingOk;
  const rec = {
    id: ev.id || ('debt-' + ev.color), color: Number(ev.color), need: ev.need == null ? null : Number(ev.need),
    enterStep: entry ? entry.step : null, enterStage,
    releaseStep: release ? release.step : null, releaseStage,
    holdSteps, expectedEnterStage: ev.enterStage || null, expectedReleaseStage: ev.releaseStage || null,
    minHoldSteps: ev.minHoldSteps == null ? null : Number(ev.minHoldSteps),
    releaseRequiresColor: gateColor, colorCompletedStep: gateStep,
    expectedReleaseRemaining: ev.expectedReleaseRemaining == null ? null : Number(ev.expectedReleaseRemaining),
    releaseRemaining, pass: ok
  };
  debtResults.push(rec);
  if (!ok) violations.push(`debt ${rec.id}: 进入/释放阶段、持有步数、包围色释放条件或释放余量不符合计划`);
}

const report = {
  tool: 'StagePlanCheck_v803',
  level: levelFile,
  plan: planFile,
  minRoute: {
    completed: !!min.completed,
    steps: min.steps,
    maxBuffer: min.maxBuffer,
    completedBoxes: min.completedBoxes,
    totalBoxes: min.totalBoxes
  },
  stages,
  debtEvents: debtResults,
  bufferEvents: bufferEvents.filter(x => (plan.debtEvents || []).some(ev => Number(ev.color) === x.color)),
  finalProgress,
  violations,
  pass: violations.length === 0 && !!min.completed,
  note: '这是阶段结构验证，不等同于 ArlCheck 全量验收。'
};
const text = JSON.stringify(report, null, 2);
if (outFile) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, text);
  console.log('已写：' + outFile);
}
console.log(text);
process.exit(report.pass ? 0 : 1);
