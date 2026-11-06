#!/usr/bin/env node
'use strict';
/**
 * StagePlanCheck_v801 —— 阶段允许颜色 / 框车时机验证器
 *
 * 用法：
 *   node StagePlanCheck_v801.js <关卡.json> <阶段计划.json> [--out report.json]
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
  console.error('用法: node StagePlanCheck_v801.js <关卡.json> <阶段计划.json> [--out report.json]');
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
  trace.push({ step: step + 1, pick: { color: p.color, count: p.count, r: p.r, c: p.c }, availableColors: colors, bufferBefore: state.buffer.length, progress: progressMap() });
  Sim.applyPick(state, p.r, p.c);
  step++;
}
// Final state progress.
const finalProgress = progressMap();

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

const report = {
  tool: 'StagePlanCheck_v801',
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
