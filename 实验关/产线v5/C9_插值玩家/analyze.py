#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""C9 插值玩家分析：每个 p 的 12 关模拟通关率 vs 线上通关率（= 1 − 失败率②）。

用法：
  python3 -I analyze.py --data DIR [--data DIR2 ...] \
      --csv 测试版本/2026_10_05/分组2-20261110-新指标.csv --out 结果.json

输入：--data 目录下有 summary_all.json（PInterpPlayer.js 的输出）。
只读输入，不改任何现有文件。Spearman 用平均秩处理并列（不依赖 scipy）。
"""
import argparse, csv, json, math, os


def load_json(p):
    with open(p, encoding='utf-8') as f:
        return json.load(f)


def pearson(xs, ys):
    n = len(xs)
    if n < 3:
        return None
    mx, my = sum(xs) / n, sum(ys) / n
    num = sum((a - mx) * (b - my) for a, b in zip(xs, ys))
    den = (sum((a - mx) ** 2 for a in xs) * sum((b - my) ** 2 for b in ys)) ** 0.5
    return None if den == 0 else num / den


def spearman(xs, ys):
    n = len(xs)
    if n < 3:
        return None
    def ranks(v):
        order = sorted(range(n), key=lambda i: v[i])
        r = [0.0] * n
        i = 0
        while i < n:
            j = i
            while j + 1 < n and v[order[j + 1]] == v[order[i]]:
                j += 1
            avg = (i + j) / 2.0 + 1.0
            for k in range(i, j + 1):
                r[order[k]] = avg
            i = j + 1
        return r
    rx, ry = ranks(xs), ranks(ys)
    mx, my = sum(rx) / n, sum(ry) / n
    num = sum((a - mx) * (b - my) for a, b in zip(rx, ry))
    den = (sum((a - mx) ** 2 for a in rx) * sum((b - my) ** 2 for b in ry)) ** 0.5
    return None if den == 0 else num / den


def pct(s):
    if not s or not s.strip():
        return None
    try:
        return float(s.strip().replace('%', ''))
    except ValueError:
        return None


def load_csv(path):
    with open(path, encoding='utf-8-sig') as f:
        rows = list(csv.reader(f))
    h = rows[0]
    idx = {name: i for i, name in enumerate(h)}
    out = {}
    for r in rows[1:]:
        if not r:
            continue
        try:
            lv = int(r[0])
        except (ValueError, IndexError):
            continue
        def num(s):
            try:
                return float(s)
            except (TypeError, ValueError):
                return None
        fr = pct(r[idx['失败率②']])
        out[lv] = {
            'enter': num(r[idx['进入人数②']]),
            'failRate': fr,
            'onlineWin': None if fr is None else 1.0 - fr / 100.0,
        }
    return out


def rmse(pairs):
    return math.sqrt(sum((a - b) ** 2 for a, b in pairs) / len(pairs)) if pairs else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', action='append', required=True)
    ap.add_argument('--csv', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--seed', type=int, default=977, help='主口径种子，默认 977')
    a = ap.parse_args()

    csvdata = load_csv(a.csv)
    rows = []
    for d in a.data:
        rows.extend(load_json(os.path.join(d, 'summary_all.json')))
    if not rows:
        raise SystemExit('没有读到 summary_all.json 行')

    # 合并同 (p, level) 的种子行（不同目录可能各含一部分种子）
    merged = {}
    for r in rows:
        key = (round(r['p'], 6), r['levelNo'])
        if key not in merged:
            merged[key] = {'levelNo': r['levelNo'], 'p': r['p'],
                           'seeds': {}, 'deathDist': r.get('deathDist')}
        for s in r['seeds']:
            merged[key]['seeds'][s['seed']] = s

    plist = sorted({k[0] for k in merged})
    levels = sorted({k[1] for k in merged})
    seeds = sorted({s for k in merged for s in merged[k]['seeds']})

    online = {lv: csvdata[lv]['onlineWin'] for lv in levels}

    def sim_of(lv, p, seed):
        m = merged.get((round(p, 6), lv))
        if not m or seed not in m['seeds'] or online[lv] is None:
            return None
        return m['seeds'][seed]['winRate']

    # ---- 每个种子 × 每个 p 的指标 ----
    per_p = []
    for p in plist:
        row = {'p': p, 'bySeed': {}}
        for seed in seeds:
            pairs = [(sim_of(lv, p, seed), online[lv]) for lv in levels if sim_of(lv, p, seed) is not None]
            xs = [x for x, _ in pairs]
            ys = [y for _, y in pairs]
            row['bySeed'][str(seed)] = {
                'rmse': round(rmse(pairs), 4),
                'rmsePct': round(rmse(pairs) * 100, 2),
                'spearman': round(spearman(xs, ys), 4) if len(pairs) >= 3 else None,
                'pearson': round(pearson(xs, ys), 4) if len(pairs) >= 3 else None,
                'n': len(pairs),
            }
        per_p.append(row)

    # ---- 最优 p（主种子，RMSE 最小；并列取较小 p）----
    def best_p(seed):
        cand = [(r['p'], r['bySeed'][str(seed)]['rmse']) for r in per_p
                if str(seed) in r['bySeed'] and r['bySeed'][str(seed)]['rmse'] is not None]
        if not cand:
            return None
        mn = min(x[1] for x in cand)
        return min(p for p, v in cand if v == mn), mn

    best = {str(s): best_p(s) for s in seeds}
    bp, brmse = best[str(a.seed)]

    # ---- 主种子逐关对照 + 每关最佳 p ----
    per_level = []
    for lv in levels:
        vals = []
        bestErr = None
        bestPs = []
        for p in plist:
            sim = sim_of(lv, p, a.seed)
            if sim is None:
                continue
            err = abs(sim - online[lv])
            vals.append({'p': p, 'sim': round(sim, 4), 'diff': round(sim - online[lv], 4)})
            if bestErr is None or err < bestErr - 1e-12:
                bestErr = err
                bestPs = [p]
            elif abs(err - bestErr) <= 1e-12:
                bestPs.append(p)
        m = merged.get((round(bp, 6), lv), {})
        per_level.append({
            'level': lv,
            'online': round(online[lv], 4),
            'failRate': csvdata[lv]['failRate'],
            'simAtBestP': round(sim_of(lv, bp, a.seed), 4) if sim_of(lv, bp, a.seed) is not None else None,
            'diffAtBestP': round(sim_of(lv, bp, a.seed) - online[lv], 4) if sim_of(lv, bp, a.seed) is not None else None,
            'levelBestP': min(bestPs) if bestPs else None,
            'levelBestPsAll': bestPs,
            'levelBestErr': round(bestErr, 4) if bestErr is not None else None,
            'deathDistAtBestP': m.get('deathDist'),
            'perP': vals,
        })

    # 逐关各用最佳 p 时的“可达到”RMSE
    per_level_best_rmse = math.sqrt(
        sum(r['levelBestErr'] ** 2 for r in per_level if r['levelBestErr'] is not None) / len(per_level)
    ) if per_level else None

    mismatches = [r for r in per_level
                  if r['diffAtBestP'] is not None and abs(r['diffAtBestP']) > 0.15]

    controls = {}
    for p in (0.0, 1.0):
        row = next((r for r in per_p if abs(r['p'] - p) < 1e-9), None)
        if row:
            controls[str(p)] = row['bySeed']

    out = {
        'seed': a.seed,
        'levels': levels,
        'onlineWin': {str(k): round(v, 4) for k, v in online.items()},
        'perP': per_p,
        'bestPBySeed': {k: {'p': v[0], 'rmse': v[1]} if v else None for k, v in best.items()},
        'bestP': bp,
        'bestRmse': brmse,
        'perLevelAtBestP': per_level,
        'perLevelBestPMin': min(r['levelBestP'] for r in per_level if r['levelBestP'] is not None),
        'perLevelBestPMax': max(r['levelBestP'] for r in per_level if r['levelBestP'] is not None),
        'perLevelBestPRmse': round(per_level_best_rmse, 4) if per_level_best_rmse is not None else None,
        'mismatchesGt15pp': [{'level': r['level'], 'sim': r['simAtBestP'], 'online': r['online'],
                              'diff': r['diffAtBestP'], 'deathDist': r['deathDistAtBestP']}
                             for r in mismatches],
        'controls': controls,
    }
    with open(a.out, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    # ---- 控制台摘要 ----
    print(f'seed={a.seed}  最优 p={bp}  RMSE={brmse:.4f} ({brmse*100:.2f}pp)  '
          f"Spearman={next(r['bySeed'][str(a.seed)]['spearman'] for r in per_p if r['p'] == bp)}")
    print('p 扫描:')
    for r in per_p:
        m = r['bySeed'].get(str(a.seed))
        if m:
            print(f"  p={r['p']:.1f}  RMSE={m['rmse']:.4f} ({m['rmsePct']:.2f}pp)  rho={m['spearman']}")
    print(f'逐关最佳 p 范围: {out["perLevelBestPMin"]}–{out["perLevelBestPMax"]}; '
          f'逐关各用最佳 p 的 RMSE={out["perLevelBestPRmse"]} ({out["perLevelBestPRmse"]*100:.2f}pp)')
    print('逐关（最优 p 下）:')
    for r in per_level:
        print(f"  L{r['level']}: sim={r['simAtBestP']:.2f} online={r['online']:.2f} "
              f"diff={r['diffAtBestP']:+.2f}  levelBestP={r['levelBestP']} err={r['levelBestErr']:.2f}")
    if out['mismatchesGt15pp']:
        print('>15pp 的关:', [m['level'] for m in out['mismatchesGt15pp']])
    print(f'写入 {a.out}')


if __name__ == '__main__':
    main()
