#!/usr/bin/env node
'use strict';
/**
 * KnobPlan_v1 —— 输入关卡 + 意图，诊断并给出“单旋钮”候选，跑同一套检查后排序。
 *
 * 它不自动“反解”指标，而是把已验证的 motif 变成候选：
 *   冰 75/50       ：只动一个冰的 param
 *   链组软化       ：链组每辆车减一点容量，余量转给同色非链车（不拆链）
 *   链组拆除       ：仅 --allow-chain-remove 时出现（结构改动，默认不给）
 *   容量重分配     ：同色两辆车之间搬 px，总量不变
 *   开局换位       ：顶行 ↔ 第二行整车互换
 *   开局拆冰       ：row0 冰车拆成 12px 小车 + 余量藏黑格 / 转同色后排
 *   冰门           ：给普通车上冰 4/6/8
 *   管道顺序       ：相邻队列项互换
 *
 * 用法：
 *   node KnobPlan_v1.js <关卡.json | 目录> [--intent diagnose|ease|fix-opening|raise-mid|more-choice]
 *        [--profile low-churn|profile.json] [--top 5] [--max-candidates 10]
 *        [--out DIR] [--max-levels N]
 *        [--allow-chain-remove] [--allow-ice50] [--player]
 *
 * 输出：
 *   默认写到 实验关/产线v3/KnobPlan_<时间>_<pid>/
 *     report.md / report.json / candidates/*.json / checks/<id>/*.json
 *
 * 只读输入关卡，不改原文件。
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const B = require('./Build006Thickness_v688');

const ROOT = path.resolve(__dirname, '../..');
const TOOLS = path.join(ROOT, '03_工具', '正式版');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.indexOf(k) > 0;
const input = process.argv[2];
const intent = arg('--intent', 'diagnose');
const profileSpec = arg('--profile', 'low-churn');
const topN = Number(arg('--top', 5)) || 5;
const maxCandidates = Number(arg('--max-candidates', 10)) || 10;
const maxLevels = Number(arg('--max-levels', 0)) || 0;
const allowChainRemove = has('--allow-chain-remove');
const allowIce50 = has('--allow-ice50');
const runPlayer = has('--player');
const BOTTOM_ONLY = has('--bottom-only');
const EXTRA = BOTTOM_ONLY ? ['--bottom-only'] : [];
const outArg = arg('--out', null);

const INTENTS = new Set(['diagnose', 'ease', 'fix-opening', 'raise-mid', 'more-choice']);
if (!input || input.startsWith('--')) {
  console.error('用法: node KnobPlan_v1.js <关卡.json | 目录> [--intent diagnose|ease|fix-opening|raise-mid|more-choice] [--profile low-churn|profile.json] [--top 5] [--max-candidates 10] [--out DIR]');
  process.exit(2);
}
if (!INTENTS.has(intent)) {
  console.error('未知 --intent: ' + intent + '（可用：' + [...INTENTS].join('/') + '）');
  process.exit(2);
}

const DEFAULT_PROFILE = {
  name: 'low-churn',
  hard: { canPass: true, peak: 4, openMin: 5, layoutHard: 0 },
  shape: { mid: [45, 80], tol: [11, 15] },
  experience: { c0AtBufLt5: 0, f0AtBuf3Max: 2, clickForced: true, policy0: true },
  guards: { midDropMax: 20, entropyDropMax: 0.25, peakMin: 3 },
  objective: 'minD'
};
const PROFILES = {
  'low-churn': DEFAULT_PROFILE,
  ease: Object.assign({}, DEFAULT_PROFILE, { name: 'ease', objective: 'minD' }),
  'fix-opening': Object.assign({}, DEFAULT_PROFILE, { name: 'fix-opening', objective: 'maxOpen' }),
  'raise-mid': Object.assign({}, DEFAULT_PROFILE, { name: 'raise-mid', objective: 'maxMid' }),
  'more-choice': Object.assign({}, DEFAULT_PROFILE, { name: 'more-choice', objective: 'maxEntropy' })
};

function mergeDeep(base, extra) {
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return extra === undefined ? base : extra;
  const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
  for (const k of Object.keys(extra)) {
    const v = extra[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && base && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      out[k] = mergeDeep(base[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}
function loadProfile(spec) {
  if (spec && fs.existsSync(spec) && fs.statSync(spec).isFile()) {
    return mergeDeep(JSON.parse(JSON.stringify(DEFAULT_PROFILE)), JSON.parse(fs.readFileSync(spec, 'utf8')));
  }
  if (!PROFILES[spec]) throw new Error('未知 --profile: ' + spec + '（可用 low-churn/ease/fix-opening/raise-mid/more-choice 或 JSON 文件）');
  return mergeDeep(JSON.parse(JSON.stringify(DEFAULT_PROFILE)), PROFILES[spec]);
}
const profile = loadProfile(profileSpec);

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
function clone(g) { return JSON.parse(JSON.stringify(g)); }
function readJson(f) { return JSON.parse(fs.readFileSync(f, 'utf8')); }
function writeJson(f, j) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(j, null, 2)); }
function stamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
const OUT_DIR = outArg || path.join(ROOT, '实验关', '产线v3', `KnobPlan_${stamp()}_${process.pid}`);
fs.mkdirSync(OUT_DIR, { recursive: true });

function runTool(tool, args, timeout = 300000) {
  const r = spawnSync(process.execPath, [path.join(TOOLS, tool), ...args], {
    cwd: ROOT, encoding: 'utf8', timeout: timeout || 300000, maxBuffer: 64 * 1024 * 1024
  });
  return {
    out: r.stdout || '',
    err: r.stderr || '',
    status: r.status,
    error: r.error ? String(r.error.message || r.error) : null
  };
}
function extractJson(text) {
  try { return JSON.parse(text); } catch (e) { }
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(text.slice(a, b + 1)); } catch (e) { } }
  return null;
}
function tryReadJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } }

// ---------- 关卡结构 ----------
function isPipe(s) { return !!(s && typeof s.type === 'number' && s.type >= 11 && s.type <= 14); }
function isChain(s) { return !!(s && (s.type === 5 || (Array.isArray(s.type) && s.type.includes(5)))); }
function isIce(s) { return !!(s && (s.type === 7 || (Array.isArray(s.type) && s.type.includes(7)))); }
function isPlain(s) { return !!(s && s.id > 0 && s.type === 0 && !s.q); }
function isLevel(g) { return !!(g && g.toprow && Array.isArray(g.blocks) && Array.isArray(g.spools)); }
function eachCell(g, fn) {
  for (let r = 0; r < g.spools.length; r++) for (let c = 0; c < g.spools[r].length; c++) {
    const s = g.spools[r][c];
    if (s) fn(s, r, c);
  }
}
function cellLabel(r, c) { return `r${r}c${c}`; }
function pixelTotals(g) {
  const m = {};
  for (const row of g.blocks) for (const v of row) if (v > 0) m[v] = (m[v] || 0) + 1;
  return m;
}
function carTotals(g) {
  const m = {};
  for (const row of g.spools) for (const s of row) {
    if (!s) continue;
    if (isPipe(s)) {
      if (Array.isArray(s.param)) for (const q of s.param) if (q && q.id > 0) m[q.id] = (m[q.id] || 0) + (q.count || 0);
      continue;
    }
    if (s.id > 0) m[s.id] = (m[s.id] || 0) + (s.count || 0);
  }
  return m;
}
function validateLevel(g, ref) {
  const errs = [];
  if (!isLevel(g)) return ['不是关卡 JSON'];
  if (g.spools.length !== ref.spools.length) errs.push('spools 行数变了');
  for (let r = 0; r < ref.spools.length; r++) {
    if (!Array.isArray(g.spools[r]) || g.spools[r].length !== ref.spools[r].length) errs.push(`第${r}行列数变了`);
  }
  eachCell(g, (s, r, c) => {
    if (s.id > 0 && (!Number.isFinite(Number(s.count)) || Number(s.count) <= 0)) errs.push(`${cellLabel(r, c)} count=${s.count}`);
  });
  const px = pixelTotals(g), car = carTotals(g);
  for (const k of new Set([...Object.keys(px), ...Object.keys(car)])) {
    if ((px[k] || 0) !== (car[k] || 0)) errs.push(`颜色${k} 守恒 ${px[k] || 0}/${car[k] || 0}`);
  }
  return errs;
}
function chainGroups(g) {
  const groups = new Map();
  eachCell(g, (s, r, c) => {
    if (!isChain(s)) return;
    const k = String(s.param);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push({ r, c, s });
  });
  return [...groups.entries()].map(([param, members]) => ({ param, members }));
}

// ---------- 解析检查结果 ----------
function parseArlRules(out) {
  const rules = [];
  for (const line of out.split(/\r?\n/)) {
    const m = /^\s*([✅❌⚪])\s+(.+?)\s{2,}(.+)$/.exec(line);
    if (!m) continue;
    rules.push({ mark: m[1], name: m[2].trim(), value: m[3].trim(), soft: m[1] === '⚪', ok: m[1] === '✅' });
  }
  return rules;
}
function ruleValue(rules, name) {
  const r = rules.find(x => x.name === name || x.name.startsWith(name));
  return r ? r.value : null;
}
function parseArl(out) {
  const rules = parseArlRules(out);
  const num = (re) => { const m = re.exec(out); return m ? Number(m[1]) : -1; };
  const can = /可通关（最小路线）[\s\S]{0,80}?([✓✗])/.exec(out);
  return {
    peak: num(/峰值=4\s+(\d+)/),
    mid: num(/玩家中段 45–80%\s+\d+ 步（占比 (\d+)%）/),
    tol: num(/容错[^\n]*?(\d+)\/20/),
    open: num(/开局可点≥5\s+(\d+)/),
    at4: num(/at4≥5\s+(\d+)/),
    canPass: can ? can[1] : '?',
    rulesPass: /→\s*通过\s*$/m.test(out.trim()) && !/→\s*不通过/m.test(out),
    rules,
    failing: rules.filter(r => !r.soft && !r.ok).map(r => `${r.name}=${r.value}`)
  };
}
function parseClick(j) {
  const r = j && j.rows && j.rows[0] ? j.rows[0] : {};
  return {
    solverWon: !!r.solverWon,
    clickForcedWon: !!r.clickForcedWon,
    clickForcedSteps: r.clickForcedSteps,
    clickForcedDeathStep: r.clickForcedDeathStep,
    clickForcedDeathReason: r.clickForcedDeathReason,
    bufferPeak: r.bufferPeak
  };
}
function parsePolicy(j) {
  const r = j && j.rows && j.rows[0] ? j.rows[0] : {};
  const results = Array.isArray(r.results) ? r.results : [];
  return {
    policy0: !!r.policy0,
    policy2: !!r.policy2,
    win0: results.filter(x => x.cap === 0 && x.won).map(x => x.strategy),
    freeFirst0: results.some(x => x.cap === 0 && x.won && x.strategy === 'free-first')
  };
}
function parseOpening(j) {
  if (!j) return { error: 'no json' };
  const s = j.summary || {};
  const v = s.violations || {};
  return {
    pass: !!s.pass,
    openM: j.rows && j.rows[0] ? Number(j.rows[0].M) : null,
    c0AtBufLt5: Number(s.c0AtBufLt5 != null ? s.c0AtBufLt5 : (v.c0AtBufLt5 || 0)),
    f0AtBuf3: Number(v.f0AtBuf3 || 0),
    maxF0AtBuf3: Number(s.maxF0AtBuf3 || 0),
    f0RunAtBuf3Gt1: !!v.f0RunAtBuf3Gt1,
    steps: Number(s.steps || 0)
  };
}
function parseChoice(j) {
  const r = j && j.rows && j.rows[0] ? j.rows[0] : {};
  return {
    won: !!r.won,
    steps: Number(r.steps || 0),
    M: Number(r.avgM || 0),
    C: Number(r.avgC || 0),
    F: Number(r.avgF || 0),
    D: Number(r.avgD || 0),
    entropy: Number(r.avgEntropy || 0),
    distinct: Number(r.avgDistinct || 0),
    fake: Number(r.fakeChoiceSteps || 0),
    forced: Number(r.forcedSteps || 0),
    overload: Number(r.overloadSteps || 0)
  };
}
function parseLayout(out) {
  const h = /hard=(\d+)/.exec(out), w = /warn=(\d+)/.exec(out);
  return { hard: h ? Number(h[1]) : -1, warn: w ? Number(w[1]) : -1 };
}
function parsePlayer(j) {
  const r = j && j.rows && j.rows[0] ? j.rows[0] : {};
  const p0 = r.policy && r.policy['0'];
  return {
    solverWon: !!r.solverWon,
    forcedWon: !!r.forcedWon,
    forcedDeath: r.forcedDeath,
    forcedMismatch: r.forcedMismatch,
    policy0: !!(p0 && p0.won),
    playerSolvable2: !!r.playerSolvable2
  };
}

// ---------- 难度分（与 DifficultyScore_v1 同公式） ----------
function difficultyScore(m) {
  const a = m.arl || {}, o = m.opening || {}, c = m.choice || {};
  const C0 = Number(o.c0AtBufLt5 || 0);
  const F0 = Number(o.f0AtBuf3 || 0);
  const openM = Number(o.openM != null ? o.openM : 0);
  const M = Number(c.M != null ? c.M : 0);
  const H = Number(c.entropy != null ? c.entropy : 0);
  const peak = Number(a.peak != null ? a.peak : 0);
  const mid = Number(a.mid != null ? a.mid : 0);
  const tol = Number(a.tol != null ? a.tol : 0);
  const can = a.canPass;
  const s = {
    C0: clamp(C0 / 2, 0, 1), F0: clamp(F0 / 4, 0, 1),
    M: clamp((8 - M) / 5, 0, 1), H: clamp((1.5 - H) / 0.5, 0, 1),
    open: clamp((6 - openM) / 3, 0, 1), tol: clamp((18 - tol) / 16, 0, 1),
    midHigh: clamp((mid - 70) / 20, 0, 1)
  };
  let d = 100 * (0.25 * s.C0 + 0.20 * s.F0 + 0.15 * s.M + 0.20 * s.H + 0.05 * s.open + 0.10 * s.tol + 0.05 * s.midHigh);
  const penalties = [];
  if (can !== '✓') { d += 20; penalties.push('can✗+20'); }
  if (peak <= 2 && mid >= 70) { d += 15; penalties.push('flatLong+15'); }
  if (mid >= 80) { d += 15; penalties.push('mid>=80+15'); }
  d = clamp(d, 0, 100);
  return { D: +d.toFixed(1), band: d >= 60 ? 'hard' : d >= 40 ? 'mid-hard' : d >= 20 ? 'mid-easy' : 'easy', penalties };
}

// ---------- 跑一关的全部检查 ----------
function evaluateLevel(file, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const arlRun = runTool('ArlCheck_v793.js', [file, ...EXTRA], 300000);
  const arl = parseArl(arlRun.out);
  if (arlRun.error) arl.error = arlRun.error;

  const clickFile = path.join(dir, 'click.json');
  const clickRun = runTool('ClickSettleEngineCheck_v1.js', [file, '--out', clickFile, ...EXTRA], 300000);
  const click = parseClick(tryReadJson(clickFile));
  if (clickRun.error) click.error = clickRun.error;

  const routeDir = path.join(dir, 'routes');
  const policyFile = path.join(dir, 'policy.json');
  const policyRun = runTool('ClickSettlePolicyCheck_v1.js', [file, '--out', policyFile, '--route-dir', routeDir, ...EXTRA], 300000);
  const policy = parsePolicy(tryReadJson(policyFile));
  if (policyRun.error) policy.error = policyRun.error;

  const routeFile = path.join(routeDir, path.basename(file).replace(/\.json$/i, '') + '.freefirst.click.json');
  let opening = { error: 'no route' };
  if (fs.existsSync(routeFile)) {
    const oRun = runTool('OpeningCheck_v1.js', [file, '--click', routeFile, '--json', ...EXTRA], 120000);
    opening = parseOpening(extractJson(oRun.out));
    if (oRun.error) opening.error = oRun.error;
  }

  const choiceFile = path.join(dir, 'choice.json');
  const choiceRun = runTool('ChoiceSpaceCheck_v1.js', [file, '--out', choiceFile, ...EXTRA], 300000);
  const choice = parseChoice(tryReadJson(choiceFile));
  if (choiceRun.error) choice.error = choiceRun.error;

  const layoutRun = runTool('LayoutScore_v1.js', [file], 120000);
  const layout = parseLayout(layoutRun.out);

  let player = null;
  if (runPlayer) {
    const playerFile = path.join(dir, 'player.json');
    const pRun = runTool('PlayerEngineCheck_v1.js', [file, '--out', playerFile, '--family', ...EXTRA], 300000);
    player = parsePlayer(tryReadJson(playerFile));
    if (pRun.error) player.error = pRun.error;
  }

  return { file, arl, click, policy, opening, choice, layout, player };
}

// ---------- 候选生成 ----------
function candidate(id, kind, label, reason, targets, risk, level) {
  return { id, kind, label, reason, targets, risk: risk || [], level };
}
function addCandidate(list, seen, ref, id, kind, label, reason, targets, risk, g) {
  const errs = validateLevel(g, ref);
  if (errs.length) return false;
  const key = JSON.stringify(g.spools);
  if (seen.has(key)) return false;
  seen.add(key);
  list.push(candidate(id, kind, label, reason, targets, risk, g));
  return true;
}
function groupCarsByColor(g) {
  const by = new Map();
  eachCell(g, (s, r, c) => {
    if (s.id <= 0 || isPipe(s)) return;
    if (!by.has(s.id)) by.set(s.id, []);
    by.get(s.id).push({ r, c, s });
  });
  return by;
}

function generateCandidates(ref, base, mode) {
  const out = [];
  const seen = new Set();
  const add = (...a) => addCandidate(out, seen, ref, ...a);
  const wants = (kind) => {
    if (mode === 'diagnose') return true;
    if (mode === 'ease') return ['ice75', 'ice50', 'chain_soften', 'capacity_big2small', 'pipe_order', 'swap_top', 'relief_split', 'chain_remove_one'].includes(kind);
    if (mode === 'fix-opening') return ['swap_top', 'open_ice_remove', 'relief_split', 'relief_transfer', 'capacity_big2small'].includes(kind);
    if (mode === 'raise-mid') return ['ice_add', 'pipe_order', 'capacity_small2big'].includes(kind);
    if (mode === 'more-choice') return ['capacity_big2small', 'swap_top', 'relief_split', 'ice75', 'pipe_order'].includes(kind);
    return false;
  };

  // 冰 75% / 50%：单个冰 param
  eachCell(ref, (s, r, c) => {
    if (!isIce(s)) return;
    const p = Number(s.param);
    if (!Number.isFinite(p) || p < 4) return;
    if (wants('ice75')) {
      const np = Math.max(1, Math.round(p * 0.75));
      if (np !== p) {
        const g2 = clone(ref);
        g2.spools[r][c].param = np;
        add(`KP_ice75_${cellLabel(r, c)}`, 'ice75', `冰 ${cellLabel(r, c)} ${p}→${np}`, '只降低一个冰的延迟；不拆链、不改容量', ['peak', 'mid', 'tol'], ['touches-ice'], g2);
      }
    }
    if (allowIce50 && wants('ice50')) {
      const np = Math.max(1, Math.round(p * 0.5));
      if (np !== p) {
        const g2 = clone(ref);
        g2.spools[r][c].param = np;
        add(`KP_ice50_${cellLabel(r, c)}`, 'ice50', `冰 ${cellLabel(r, c)} ${p}→${np}`, '冰减半；比 ice75 更激进', ['peak', 'mid', 'tol'], ['touches-ice', 'aggressive'], g2);
      }
    }
  });

  // 链组软化：每个成员减 delta，余量按颜色还给同色非链车；链结构保留
  if (wants('chain_soften')) {
    const allCarPool = [];
    eachCell(ref, (s, r, c) => {
      if (s.id <= 0 || isPipe(s)) return;
      allCarPool.push({ r, c, s });
    });
    for (const grp of chainGroups(ref)) {
      const members = grp.members.filter(m => Number(m.s.count) > 8);
      if (!members.length) continue;
      const reduced = new Set(members.map(m => `${m.r},${m.c}`));
      const g2 = clone(ref);
      const byColor = new Map();
      const deltas = [];
      for (const m of members) {
        const cur = Number(g2.spools[m.r][m.c].count);
        const d = Math.min(6, Math.max(1, Math.round(cur * 0.1)), cur - 8);
        if (d <= 0) continue;
        g2.spools[m.r][m.c].count = cur - d;
        byColor.set(m.s.id, (byColor.get(m.s.id) || 0) + d);
        deltas.push(`${cellLabel(m.r, m.c)}-${d}`);
      }
      if (!byColor.size) continue;
      let ok = true;
      for (const [color, total] of byColor) {
        const donors = allCarPool
          .filter(x => x.s.id === color && !reduced.has(`${x.r},${x.c}`))
          .sort((a, b) => (isChain(a.s) ? 1 : 0) - (isChain(b.s) ? 1 : 0) || Number(b.s.count) - Number(a.s.count));
        if (!donors.length) { ok = false; break; }
        let left = total;
        for (const d of donors) {
          if (left <= 0) break;
          g2.spools[d.r][d.c].count = Number(g2.spools[d.r][d.c].count) + left;
          left = 0;
        }
        if (left > 0) { ok = false; break; }
      }
      if (!ok) continue;
      add(`KP_chain_soft_${grp.param}`, 'chain_soften',
        `链组 ${grp.param} 每车减容量（${deltas.join(' ')}），余量按颜色还给同色车`,
        '降低链组每辆车的债，但保留链组结构；不是拆链',
        ['peak', 'mid', 'tol'], ['touches-chain'], g2);
    }
  }

  // 链组拆除（仅显式允许；结构改动）
  if (allowChainRemove && wants('chain_remove_one')) {
    for (const grp of chainGroups(ref)) {
      const g2 = clone(ref);
      for (const m of grp.members) {
        const cell = g2.spools[m.r][m.c];
        if (Array.isArray(cell.type)) cell.type = cell.type.filter(t => t !== 5);
        else cell.type = 0;
        cell.param = 0;
      }
      add(`KP_chain_remove_${grp.param}`, 'chain_remove_one',
        `拆掉链组 ${grp.param}（${grp.members.length} 辆，容量不变）`,
        '结构改动：去掉一组链，不是全拆；会直接降低中段压力',
        ['mid', 'peak', 'tol'], ['structural-chain-remove'], g2);
    }
  }

  // 同色容量重分配
  if (wants('capacity_big2small') || wants('capacity_small2big')) {
    for (const [color, cars] of groupCarsByColor(ref)) {
      if (cars.length < 2) continue;
      const sorted = cars.slice().sort((a, b) => Number(b.s.count) - Number(a.s.count));
      const big = sorted[0], small = sorted[sorted.length - 1];
      const diff = Number(big.s.count) - Number(small.s.count);
      if (diff < 8) continue;
      const delta = Math.min(Math.max(4, Math.round(Number(big.s.count) * 0.15)), Math.floor(diff / 2));
      if (delta < 4) continue;
      if (wants('capacity_big2small')) {
        const g2 = clone(ref);
        g2.spools[big.r][big.c].count = Number(g2.spools[big.r][big.c].count) - delta;
        g2.spools[small.r][small.c].count = Number(g2.spools[small.r][small.c].count) + delta;
        add(`KP_cap_${color}_big2small`, 'capacity_big2small',
          `颜色${color}：${cellLabel(big.r, big.c)} ${big.s.count}→${Number(big.s.count) - delta}，${cellLabel(small.r, small.c)} ${small.s.count}→${Number(small.s.count) + delta}`,
          '同色内把大车容量搬给小车上；总像素不变，债更分散',
          ['peak', 'mid', 'can'], [isChain(big.s) || isChain(small.s) ? 'touches-chain' : 'capacity'], g2);
      }
      if (wants('capacity_small2big')) {
        const g2 = clone(ref);
        g2.spools[big.r][big.c].count = Number(g2.spools[big.r][big.c].count) + delta;
        g2.spools[small.r][small.c].count = Number(g2.spools[small.r][small.c].count) - delta;
        add(`KP_cap_${color}_small2big`, 'capacity_small2big',
          `颜色${color}：${cellLabel(small.r, small.c)} ${small.s.count}→${Number(small.s.count) - delta}，${cellLabel(big.r, big.c)} ${big.s.count}→${Number(big.s.count) + delta}`,
          '同色内把小车的容量并给大车；总像素不变，债更集中',
          ['peak', 'mid', 'can'], [isChain(big.s) || isChain(small.s) ? 'touches-chain' : 'capacity'], g2);
      }
    }
  }

  // 管道队列相邻互换
  if (wants('pipe_order')) {
    eachCell(ref, (s, r, c) => {
      if (!isPipe(s) || !Array.isArray(s.param) || s.param.length < 2) return;
      for (let i = 0; i + 1 < s.param.length; i++) {
        const g2 = clone(ref);
        const q = g2.spools[r][c].param;
        const t = q[i]; q[i] = q[i + 1]; q[i + 1] = t;
        add(`KP_pipe_${cellLabel(r, c)}_${i}_${i + 1}`, 'pipe_order',
          `管道 ${cellLabel(r, c)} 队列第 ${i + 1}↔${i + 2} 项互换`,
          '只改晚段供给顺序；不改容量、不改位置',
          ['mid', 'tol', 'route'], ['pipe-order'], g2);
      }
    });
  }

  // 开局换位：row0 ↔ row1，整车互换（冰随车走）
  if (wants('swap_top')) {
    const top = [], second = [];
    for (let c = 0; c < ref.spools[0].length; c++) {
      const s = ref.spools[0][c];
      if (s && s.id > 0 && !isPipe(s) && !isChain(s)) top.push({ r: 0, c, s });
    }
    for (let c = 0; c < ref.spools[1].length; c++) {
      const s = ref.spools[1][c];
      if (s && s.id > 0 && !isPipe(s) && !isChain(s)) second.push({ r: 1, c, s });
    }
    const pairs = [];
    for (const a of top) for (const b of second) {
      if (a.s.id === b.s.id) continue;
      let p = 0;
      if (isIce(a.s) !== isIce(b.s)) p += 4; // 冰车换普通车：典型的开局 relief
      if (Number(a.s.count) < Number(b.s.count)) p += 1;
      pairs.push({ a, b, p });
    }
    pairs.sort((x, y) => y.p - x.p);
    for (const { a, b } of pairs.slice(0, 24)) {
      const g2 = clone(ref);
      const t = g2.spools[a.r][a.c];
      g2.spools[a.r][a.c] = g2.spools[b.r][b.c];
      g2.spools[b.r][b.c] = t;
      add(`KP_swap_${cellLabel(a.r, a.c)}_${cellLabel(b.r, b.c)}`, 'swap_top',
        `换位 ${cellLabel(a.r, a.c)} ↔ ${cellLabel(b.r, b.c)}（颜色${a.s.id}↔${b.s.id}）`,
        '整车互换，改变开局暴露顺序；冰随车走',
        ['openM', 'C0', 'F0'], [isIce(a.s) || isIce(b.s) ? 'moves-ice' : 'position'], g2);
    }
  }

  // 只清一个 row0 冰（不拆车）
  if (wants('open_ice_remove')) {
    for (let c = 0; c < ref.spools[0].length; c++) {
      const s = ref.spools[0][c];
      if (!s || !isIce(s) || s.id <= 0) continue;
      const g2 = clone(ref);
      const cell = g2.spools[0][c];
      if (Array.isArray(cell.type)) cell.type = cell.type.filter(t => t !== 7);
      else cell.type = 0;
      cell.param = 0;
      add(`KP_openice_${cellLabel(0, c)}`, 'open_ice_remove',
        `清掉 ${cellLabel(0, c)} 的冰（${s.param}）`,
        '补开局最直接，但可能把大车直接暴露；M4.6 记录过会塌',
        ['openM', 'C0'], ['clears-ice', 'risk-collapse'], g2);
    }
  }

  // row0 冰车拆成 12px + 余量藏黑格
  if (wants('relief_split')) {
    const blacks = [];
    for (let r = 0; r < ref.spools.length; r++) for (let c = 0; c < ref.spools[r].length; c++) {
      const s = ref.spools[r][c];
      if (s && s.id > 0) continue;
      if (s && isPipe(s)) continue;
      blacks.push({ r, c, priority: r === 0 ? 2 : 0 });
    }
    blacks.sort((a, b) => a.priority - b.priority);
    for (let c = 0; c < ref.spools[0].length; c++) {
      const s = ref.spools[0][c];
      if (!s || !isIce(s) || s.id <= 0 || Number(s.count) < 20) continue;
      const b = blacks[0];
      if (!b) break;
      const g2 = clone(ref);
      const cell = g2.spools[0][c];
      const rem = Number(cell.count) - 12;
      cell.count = 12;
      if (Array.isArray(cell.type)) cell.type = cell.type.filter(t => t !== 7);
      else cell.type = 0;
      cell.param = 0;
      g2.spools[b.r][b.c] = { id: cell.id, type: 0, param: 0, count: rem };
      add(`KP_relief_split_${cellLabel(0, c)}`, 'relief_split',
        `${cellLabel(0, c)} 冰车拆 12px 上排 + ${rem}px 藏 ${cellLabel(b.r, b.c)}`,
        '开局多一个便宜选项，余量不直接暴露；会新增一辆车',
        ['openM', 'C0', 'F0'], ['adds-car', 'black-cell'], g2);
    }
  }

  // row0 冰车拆 12px + 余量转同色后排
  if (wants('relief_transfer')) {
    for (let c = 0; c < ref.spools[0].length; c++) {
      const s = ref.spools[0][c];
      if (!s || !isIce(s) || s.id <= 0 || Number(s.count) < 20) continue;
      const pool = [];
      for (let r = 1; r < ref.spools.length; r++) for (let cc = 0; cc < ref.spools[r].length; cc++) {
        const x = ref.spools[r][cc];
        if (!x || x.id !== s.id || isPipe(x) || isChain(x)) continue;
        pool.push({ r, c: cc, s: x });
      }
      if (!pool.length) continue;
      const target = pool.sort((a, b) => Number(b.s.count) - Number(a.s.count))[0];
      const g2 = clone(ref);
      const cell = g2.spools[0][c];
      const rem = Number(cell.count) - 12;
      cell.count = 12;
      if (Array.isArray(cell.type)) cell.type = cell.type.filter(t => t !== 7);
      else cell.type = 0;
      cell.param = 0;
      g2.spools[target.r][target.c].count = Number(g2.spools[target.r][target.c].count) + rem;
      add(`KP_relief_transfer_${cellLabel(0, c)}`, 'relief_transfer',
        `${cellLabel(0, c)} 拆 12px，${rem}px 转给同色 ${cellLabel(target.r, target.c)}`,
        '开局多一个便宜选项，余量留在同色后排；不新增黑格车',
        ['openM', 'C0', 'F0', 'mid'], ['touches-multi', 'capacity'], g2);
    }
  }

  // 给普通车加冰（抬中段 / 延迟暴露）
  if (wants('ice_add') && base.arl.mid >= 0 && base.arl.mid < 80) {
    const pool = [];
    for (let r = 0; r < Math.min(2, ref.spools.length); r++) for (let c = 0; c < ref.spools[r].length; c++) {
      const s = ref.spools[r][c];
      if (isPlain(s) && Number(s.count) >= 30) pool.push({ r, c, s });
    }
    pool.sort((a, b) => Number(b.s.count) - Number(a.s.count));
    for (const x of pool.slice(0, 2)) {
      for (const p of [4, 6, 8]) {
        const g2 = clone(ref);
        g2.spools[x.r][x.c].type = 7;
        g2.spools[x.r][x.c].param = p;
        add(`KP_iceadd_${cellLabel(x.r, x.c)}_${p}`, 'ice_add',
          `给 ${cellLabel(x.r, x.c)}（颜色${x.s.id}，${x.s.count}px）加冰 ${p}`,
          '把该车推迟 1–2 个窗口，抬中段；位置决定它是门还是节奏',
          ['mid', 'peak', 'tol'], ['adds-ice'], g2);
      }
    }
  }

  return out;
}

// ---------- 候选优先级 / profile / 排序 ----------
function candidatePriority(c, base, mode) {
  let s = 0;
  const hasKind = (...ks) => ks.includes(c.kind);
  if (base.opening && base.opening.openM != null && base.opening.openM < 5 &&
    hasKind('swap_top', 'relief_split', 'relief_transfer', 'open_ice_remove')) s += 12;
  if (base.opening && base.opening.c0AtBufLt5 > 0 &&
    hasKind('capacity_big2small', 'relief_split', 'relief_transfer', 'ice75', 'swap_top')) s += 8;
  if (base.opening && base.opening.f0AtBuf3 >= 3 &&
    hasKind('capacity_big2small', 'relief_split', 'relief_transfer', 'swap_top')) s += 8;
  if (base.arl.mid >= 0 && base.arl.mid < 45 &&
    hasKind('ice_add', 'pipe_order', 'capacity_small2big')) s += 10;
  if (base.arl.mid > 80 &&
    hasKind('ice75', 'chain_soften', 'pipe_order', 'capacity_big2small')) s += 10;
  if (base.arl.peak > 4 &&
    hasKind('ice75', 'chain_soften', 'capacity_big2small')) s += 8;
  if (base.arl.tol > 18 &&
    hasKind('ice_add', 'pipe_order', 'chain_soften')) s += 6;
  if (base.arl.tol >= 0 && base.arl.tol < 11 &&
    hasKind('ice75', 'capacity_big2small', 'relief_split', 'relief_transfer', 'swap_top')) s += 6;
  if (mode === 'ease' && hasKind('ice75', 'chain_soften', 'capacity_big2small', 'pipe_order')) s += 5;
  if (mode === 'fix-opening' && hasKind('swap_top', 'relief_split', 'relief_transfer', 'open_ice_remove')) s += 10;
  if (mode === 'raise-mid' && hasKind('ice_add', 'pipe_order', 'capacity_small2big')) s += 10;
  if (mode === 'more-choice' && hasKind('capacity_big2small', 'swap_top', 'relief_split', 'ice75')) s += 8;
  if (c.risk.includes('structural-chain-remove')) s -= 30;
  if (c.risk.includes('risk-collapse')) s -= 4;
  return s;
}
function takeDiverse(cands, base, mode, limit) {
  const sorted = cands.slice().sort((a, b) => (candidatePriority(b, base, mode) - candidatePriority(a, base, mode)) || a.id.localeCompare(b.id));
  const perKind = new Map();
  const out = [];
  for (const c of sorted) {
    const n = perKind.get(c.kind) || 0;
    const cap = c.kind === 'ice75' || c.kind === 'ice50' ? 3 : c.kind === 'swap_top' ? 3 : c.kind === 'pipe_order' ? 2 : 2;
    if (n >= cap) continue;
    perKind.set(c.kind, n + 1);
    out.push(c);
    if (out.length >= limit) break;
  }
  return out;
}
function effectiveProfile(p, base, mode) {
  const q = JSON.parse(JSON.stringify(p));
  if (mode === 'fix-opening') {
    // 修开局时，基线 mid/tol 可能本来就偏；目标是“别更差”，不是硬拉回 45/11。
    q.shape.mid = [Math.min(base.arl.mid, 45), Math.max(base.arl.mid, 80)];
    q.shape.tol = [Math.min(base.arl.tol, 11), Math.max(base.arl.tol, 15)];
    q.hard.peak = Math.min(base.arl.peak, 4);
  } else if (mode === 'ease') {
    q.shape.mid = [Math.min(base.arl.mid, 45), Math.max(base.arl.mid, 80)];
    q.shape.tol = [Math.min(base.arl.tol, 11), Math.max(base.arl.tol, 15)];
    // 基线已经 peak3 时，不再要求候选把峰值补回 4；ease 只负责“别更紧”。
    q.hard.peak = Math.min(base.arl.peak, 4);
  } else if (mode === 'more-choice') {
    q.shape.mid = [Math.min(base.arl.mid, 45), Math.max(base.arl.mid, 80)];
    q.shape.tol = [Math.min(base.arl.tol, 11), Math.max(base.arl.tol, 15)];
    q.hard.peak = Math.min(base.arl.peak, 4);
  } else if (mode === 'raise-mid') {
    q.shape.mid = [Math.min(base.arl.mid + 1, 45), 80];
    q.shape.tol = [Math.min(base.arl.tol, 11), Math.max(base.arl.tol, 15)];
    q.hard.peak = Math.min(base.arl.peak, 4);
  }
  return q;
}
function softWarnings(m, base, D, baseD) {
  const out = [];
  if (baseD - D > 15) out.push('Ddrop>15');
  if (m.arl.tol > 15) out.push('tolLoose');
  if (base.arl.mid >= 80 && m.arl.mid < 80) out.push('midCross80(D惩罚)');
  if (m.choice.entropy < 1.0) out.push('entropy<1');
  if (m.arl.mid >= 0 && m.arl.mid < 45 && base.arl.mid >= 0 && base.arl.mid < 45) out.push('baselineFlat');
  return out;
}
function checkProfile(m, p) {  const issues = [];
  const a = m.arl || {}, o = m.opening || {}, c = m.choice || {}, l = m.layout || {};
  if (p.hard.canPass && a.canPass !== '✓') issues.push('can=' + a.canPass);
  if (p.hard.peak != null && a.peak !== p.hard.peak) issues.push('peak=' + a.peak);
  if (o.openM == null) issues.push('openM=?');
  else if (o.openM < p.hard.openMin) issues.push('openM=' + o.openM);
  if (l.hard > p.hard.layoutHard) issues.push('layoutHard=' + l.hard);
  if (a.mid < p.shape.mid[0] || a.mid > p.shape.mid[1]) issues.push('mid=' + a.mid);
  if (a.tol < p.shape.tol[0] || a.tol > p.shape.tol[1]) issues.push('tol=' + a.tol);
  if (o.c0AtBufLt5 > p.experience.c0AtBufLt5) issues.push('C0=' + o.c0AtBufLt5);
  if (o.f0AtBuf3 > p.experience.f0AtBuf3Max) issues.push('F0=' + o.f0AtBuf3);
  if (p.experience.clickForced && !m.click.clickForcedWon) issues.push('clickForced=N');
  if (p.experience.policy0 && !m.policy.policy0) issues.push('policy0=N');
  if (runPlayer && m.player) {
    if (!m.player.forcedWon) issues.push('playerForced=N');
    if (!m.player.policy0) issues.push('playerPolicy0=N');
  }
  return { pass: issues.length === 0, issues };
}
function checkGuards(m, base, p, mode, D, baseD) {
  const issues = [];
  const a = m.arl || {};
  if (base.arl.mid >= 0 && a.mid >= 0 && base.arl.mid - a.mid > p.guards.midDropMax) issues.push(`midDrop=${base.arl.mid - a.mid}`);
  if (base.choice && m.choice && base.choice.entropy - m.choice.entropy > p.guards.entropyDropMax) issues.push(`entropyDrop=${(base.choice.entropy - m.choice.entropy).toFixed(2)}`);
  if (p.guards.peakMin != null && a.peak < p.guards.peakMin) issues.push('peak<' + p.guards.peakMin);
  if (a.mid >= 0 && a.mid < 30) issues.push('midFlat=' + a.mid);
  if (mode === 'raise-mid' && base.arl.mid >= 0 && a.mid <= base.arl.mid) issues.push('midNotUp');
  if (mode === 'ease' && D >= baseD) issues.push(`DNotDown=${D}`);
  return { pass: issues.length === 0, issues };
}
function rankScore(m, base, mode, profileResult, guardResult, D, warnings) {
  let s = 0;
  if (profileResult.pass) s += 1000;
  if (guardResult.pass) s += 200; else s -= 100;
  if (mode === 'ease') {
    s += (100 - D);
    // D 大降但跨过 mid=80 多半是公式惩罚，不是真的更简单；排序时降权，报告仍保留候选。
    for (const w of warnings || []) if (w === 'Ddrop>15' || w.startsWith('midCross80')) s -= 50;
  } else if (mode === 'fix-opening') s += (m.opening.openM || 0) * 10 - D * 0.1;
  else if (mode === 'raise-mid') s += (m.arl.mid || 0) * 2 - D * 0.1;
  else if (mode === 'more-choice') s += (m.choice.entropy || 0) * 100 - D * 0.1;
  else s += (100 - D);
  return s;
}

// ---------- 报告 ----------
function fmtMetric(m) {
  const a = m.arl || {}, o = m.opening || {}, c = m.choice || {};
  return { peak: a.peak, mid: a.mid, tol: a.tol, openM: o.openM, C0: o.c0AtBufLt5, F0: o.f0AtBuf3, M: c.M, H: c.entropy, D: difficultyScore(m).D };
}
function describeBase(file, m) {
  const a = m.arl || {}, o = m.opening || {}, c = m.choice || {}, l = m.layout || {};
  return [
    `- 文件：\`${path.relative(ROOT, file)}\``,
    `- 难度分 D：**${difficultyScore(m).D}**（${difficultyScore(m).band}）`,
    `- 硬门：can=${a.canPass}，peak=${a.peak}，openM=${o.openM}，layout hard=${l.hard}`,
    `- 形状：mid=${a.mid}%，tol=${a.tol}/20`,
    `- 体验：C0@buf<5=${o.c0AtBufLt5}，F0@buf≥3=${o.f0AtBuf3}，clickForced=${m.click.clickForcedWon ? 'Y' : 'N'}，policy0=${m.policy.policy0 ? 'Y' : 'N'}`,
    `- 选择空间：M=${c.M}，entropy=${c.entropy}，fake=${c.fake}，forced=${c.forced}`,
    `- 19 项未过：${a.failing && a.failing.length ? a.failing.join('；') : '无'}`
  ].join('\n');
}
function candidateLine(c, rank) {
  const m = c.metrics, D = c.D, p = c.profile, g = c.guards;
  const mark = p.pass && g.pass ? '✅ 推荐' : p.pass ? '🟡 合格但压平' : '❌ 未过';
  return `| ${rank} | \`${c.id}\` | ${c.kind} | ${mark} | ${D} | ${m.arl.peak}/${m.arl.mid}/${m.arl.tol} | ${m.opening.openM} | ${m.opening.c0AtBufLt5}/${m.opening.f0AtBuf3} | ${m.click.clickForcedWon ? 'Y' : 'N'}/${m.policy.policy0 ? 'Y' : 'N'} | ${m.choice.entropy.toFixed(2)} | ${(p.issues.concat(g.issues)).join(',') || '—'} | ${(c.warnings || []).join(',') || '—'} |`;
}

async function processLevel(file, levelOut) {
  fs.mkdirSync(levelOut, { recursive: true });
  console.log(`\n=== ${path.relative(ROOT, file)} ===`);
  const baseDir = path.join(levelOut, 'base');
  const base = evaluateLevel(file, baseDir);
  const baseD = difficultyScore(base).D;
  const effProfile = effectiveProfile(profile, base, intent);
  console.log(`基线 D=${baseD} peak=${base.arl.peak} mid=${base.arl.mid} tol=${base.arl.tol} open=${base.opening.openM} C0=${base.opening.c0AtBufLt5} F0=${base.opening.f0AtBuf3} clickForced=${base.click.clickForcedWon ? 'Y' : 'N'} policy0=${base.policy.policy0 ? 'Y' : 'N'}`);

  const all = generateCandidates(readJson(file), base, intent);
  const selected = takeDiverse(all, base, intent, intent === 'diagnose' ? Math.min(maxCandidates, 12) : maxCandidates);
  console.log(`候选生成 ${all.length} 个，取 ${selected.length} 个做检查。`);

  const rows = [];
  if (intent !== 'diagnose') {
    for (let i = 0; i < selected.length; i++) {
      const c = selected[i];
      const cdir = path.join(levelOut, 'candidates', c.id);
      const cfile = path.join(cdir, c.id + '.json');
      fs.mkdirSync(cdir, { recursive: true });
      fs.writeFileSync(cfile, JSON.stringify(c.level));
      console.log(`  [${i + 1}/${selected.length}] ${c.id} ...`);
      let metrics;
      try {
        metrics = evaluateLevel(cfile, path.join(cdir, 'checks'));
      } catch (e) {
        rows.push(Object.assign({}, c, { error: String(e.message || e) }));
        console.log(`    error: ${e.message || e}`);
        continue;
      }
      const D = difficultyScore(metrics).D;
      const p = checkProfile(metrics, effProfile);
      const g = checkGuards(metrics, base, effProfile, intent, D, baseD);
      const warnings = softWarnings(metrics, base, D, baseD);
      const rank = rankScore(metrics, base, intent, p, g, D, warnings);
      const row = {
        id: c.id, kind: c.kind, label: c.label, reason: c.reason, targets: c.targets, risk: c.risk,
        file: path.relative(ROOT, cfile), level: c.level, metrics, D,
        profile: p, guards: g, warnings, rank
      };
      rows.push(row);
      console.log(`    D=${D} peak=${metrics.arl.peak} mid=${metrics.arl.mid} tol=${metrics.arl.tol} open=${metrics.opening.openM} C0=${metrics.opening.c0AtBufLt5} F0=${metrics.opening.f0AtBuf3} ${p.pass && g.pass ? 'RECOMMEND' : 'not-pass'} ${p.issues.concat(g.issues).join(',')}${warnings.length ? ' warn=' + warnings.join(',') : ''}`);
    }
  }

  rows.sort((a, b) => (b.rank || 0) - (a.rank || 0));
  const recommended = rows.filter(r => r.profile && r.profile.pass && r.guards && r.guards.pass).slice(0, topN);
  const plan = selected.map(c => ({ id: c.id, kind: c.kind, label: c.label, reason: c.reason, targets: c.targets, risk: c.risk }));
  const baseWarn = base.arl.mid >= 0 && base.arl.mid < 45
    ? `基线 mid=${base.arl.mid}% 已经低于 45：先修中段，不要用 ease 继续放水。`
    : null;
  const md = [];
  md.push(`# KnobPlan：${path.basename(file)}`);
  md.push('');
  md.push(`> 意图：\`${intent}\`；profile：\`${effProfile.name}\`；规则：\`${BOTTOM_ONLY ? 'bottomOnly（仅底边出口）' : 'fourSide（四边出口）'}\`；生成 ${all.length} 个候选，检查 ${rows.length} 个。`);
  md.push('');
  md.push('## 1. 基线诊断');
  md.push('');
  md.push(describeBase(file, base));
  if (baseWarn) md.push(`\n> ⚠️ ${baseWarn}`);
  md.push('');
  md.push('## 2. 候选排序');
  md.push('');
  if (intent === 'diagnose') {
    md.push('| # | 候选 | 类型 | 改法 | 预期 |');
    md.push('|---:|---|---|---|---|');
    plan.forEach((p, i) => md.push(`| ${i + 1} | \`${p.id}\` | ${p.kind} | ${p.label} | ${p.targets.join('/')} |`));
  } else if (!rows.length) {
    md.push('（没有候选跑出结果）');
  } else {
    md.push('| # | 候选 | 类型 | 结论 | D | peak/mid/tol | openM | C0/F0 | clickForced/policy0 | H | 未过项 | 提示 |');
    md.push('|---:|---|---|---|---:|---|---:|---|---|---|---|---|');
    rows.forEach((r, i) => md.push(candidateLine(r, i + 1)));
  }
  md.push('');
  md.push('## 3. 推荐候选');
  md.push('');
  if (intent === 'diagnose') {
    md.push('`diagnose` 只诊断和列计划，不产生推荐；用 `--intent ease|fix-opening|raise-mid|more-choice` 才会真的生成并检查候选。');
  } else if (!recommended.length) {
    md.push('没有候选同时满足 profile 和“不压平”护栏。看上面未过项，优先修硬门，不要继续降难度。');
  } else {
    recommended.forEach((r, i) => {
      md.push(`### ${i + 1}. \`${r.id}\`（${r.kind}）`);
      md.push('');
      md.push(`- 改法：${r.label}`);
      md.push(`- 为什么：${r.reason}`);
      md.push(`- 文件：\`${r.file}\``);
      md.push(`- 指标：D **${r.D}**（基线 ${baseD}），peak/mid/tol=${r.metrics.arl.peak}/${r.metrics.arl.mid}/${r.metrics.arl.tol}，openM=${r.metrics.opening.openM}，C0/F0=${r.metrics.opening.c0AtBufLt5}/${r.metrics.opening.f0AtBuf3}，clickForced=${r.metrics.click.clickForcedWon ? 'Y' : 'N'}，policy0=${r.metrics.policy.policy0 ? 'Y' : 'N'}，H=${r.metrics.choice.entropy.toFixed(2)}`);
      md.push(`- 风险：${r.risk.length ? r.risk.join('、') : '无'}`);
      md.push(`- 提示：${r.warnings && r.warnings.length ? r.warnings.join('、') : '无'}`);
      md.push('');
    });
  }
  md.push('## 4. 说明');
  md.push('');
  md.push('- 这是“单旋钮”候选，不是自动最优解；每个候选只改一个 motif。');
  md.push('- `链组软化` 保留链结构，只降成员容量；`链组拆除` 默认不生成，需 `--allow-chain-remove`。');
  md.push('- 所有指标沿用现有模型：ArlCheck 19 项、点击结算 forced/policy、free-first OpeningCheck、ChoiceSpace、LayoutScore。`--player` 才额外跑 PlayerSim。');
  md.push('- **口径提醒**：默认的 `clickForced/policy0` 是点击结算口径；它不等于 PlayerSim 的 `forced/policy0`。L2/L7 的基线就是“点击结算 policy0=Y、PlayerSim policy0=N”的反例；要判真实玩家 0 复活，必须加 `--player`。');
  md.push('- `profile` 的 mid 区间和 `guards` 是防“降难度=压平”的护栏；D 降低但 mid/entropy 掉了，会被标成“合格但压平”。');
  md.push('');
  md.push('## 5. 复现');
  md.push('');
  md.push('```bash');
  md.push(`node 03_工具/正式版/KnobPlan_v1.js ${path.relative(ROOT, file)} --intent ${intent} --profile ${profileSpec} --top ${topN} --max-candidates ${maxCandidates}`);
  md.push('```');

  writeJson(path.join(levelOut, 'report.json'), {
    tool: 'KnobPlan_v1', input: path.relative(ROOT, file), intent, profile, effectiveProfile: effProfile, base, baseD,
    generated: all.length, checked: rows.length, plan,
    generatedCandidates: all.map(c => ({ id: c.id, kind: c.kind, label: c.label, targets: c.targets, risk: c.risk })),
    recommended: recommended.map(r => r.id), rows
  });
  fs.writeFileSync(path.join(levelOut, 'report.md'), md.join('\n'));
  console.log(`报告：${path.relative(ROOT, path.join(levelOut, 'report.md'))}`);
  return { file, baseD, base, all: all.length, rows, recommended: recommended.map(r => r.id) };
}

// ---------- 主流程 ----------
function collectFiles(p) {
  const st = fs.statSync(p);
  if (st.isFile()) return [p];
  return fs.readdirSync(p).filter(f => f.endsWith('.json')).sort().map(f => path.join(p, f)).filter(f => {
    try { return isLevel(readJson(f)); } catch (e) { return false; }
  });
}
(async () => {
  const files = collectFiles(input).slice(0, maxLevels || undefined);
  if (!files.length) { console.error('没有找到关卡 JSON'); process.exit(2); }
  const summary = [];
  for (const file of files) {
    const slug = path.basename(file, '.json').replace(/[^\w.-]+/g, '_');
    const levelOut = files.length === 1 ? OUT_DIR : path.join(OUT_DIR, slug);
    try {
      summary.push(await processLevel(file, levelOut));
    } catch (e) {
      console.error(`处理失败 ${file}: ${e.stack || e}`);
      summary.push({ file, error: String(e.message || e) });
    }
  }
  writeJson(path.join(OUT_DIR, 'summary.json'), { tool: 'KnobPlan_v1', intent, profile, files: summary });
  const lines = ['# KnobPlan 汇总', '', `- 输入：\`${path.relative(ROOT, input)}\``, `- 意图：\`${intent}\``, `- profile：\`${profile.name}\``, ''];
  for (const s of summary) {
    if (s.error) { lines.push(`- ❌ \`${path.relative(ROOT, s.file)}\`：${s.error}`); continue; }
    lines.push(`- ✅ \`${path.relative(ROOT, s.file)}\`：基线 D=${s.baseD}，候选 ${s.all} 个，推荐 ${s.recommended.length ? s.recommended.join(', ') : '无'}`);
  }
  fs.writeFileSync(path.join(OUT_DIR, 'summary.md'), lines.join('\n'));
  console.log(`\n汇总：${path.relative(ROOT, path.join(OUT_DIR, 'summary.md'))}`);
})();
