#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""C8 三档差距分析：读 Solvable / C8_greedy / PopulationSim 的产物 + 线上 CSV。

用法：
  python3 -I analyze.py --solvable DIR --greedy DIR --random DIR \
      --csv 测试版本/2026_10_05/分组2-20261110-新指标.csv --out result.json

只读输入，不改任何现有文件。Spearman 用平均秩处理并列（不依赖 scipy）。
"""
import argparse, csv, json, os, sys

LEVELS = list(range(2, 14))


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
        return None, n
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
    return (None if den == 0 else num / den), n


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
        out[lv] = {
            'enter': num(r[idx['进入人数②']]),
            'churn': pct(r[idx['关流失②']]),
            'failRate': pct(r[idx['失败率②']]),
            'failChurn': pct(r[idx['失败流失②']]) if idx['失败流失②'] < len(r) else None,
        }
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--solvable', required=True)
    ap.add_argument('--greedy', required=True)
    ap.add_argument('--random', required=True)
    ap.add_argument('--csv', required=True)
    ap.add_argument('--out', required=True)
    a = ap.parse_args()

    csvdata = load_csv(a.csv)
    rows = []
    for lv in LEVELS:
        name = f'G2_bq_level_{lv}'
        sol = load_json(os.path.join(a.solvable, name + '.json'))
        gre = load_json(os.path.join(a.greedy, name, 'summary.json'))
        rnd = load_json(os.path.join(a.random, name, 'summary.json'))
        rgames = load_json(os.path.join(a.random, name, 'routes_seed977.json'))['games']

        gwin = gre['winRate']
        rwin = rnd['randomWinRate']['mean']
        omni = 1 if sol.get('solvable') else 0
        rd = [g['deathProgress'] for g in rgames if not g['won']]
        gd = [g['deathProgress'] for g in gre['perGame'] if not g['won']]
        c = csvdata.get(lv, {})
        rows.append({
            'level': lv,
            'omniscient': omni,
            'solvableReason': sol.get('timedOut'),
            'greedyWin': round(gwin, 4),
            'randomWin': round(rwin, 4),
            'gapGreedy': round(omni - gwin, 4),
            'gapRandom': round(gwin - rwin, 4),
            'failRate': c.get('failRate'),
            'churn': c.get('churn'),
            'failChurn': c.get('failChurn'),
            'enter': c.get('enter'),
            'greedyDeathDist': gre['deathDist'],
            'randomDeathN': len(rd),
            'greedyDeathN': len(gd),
            'randomDeathMean': round(sum(rd) / len(rd), 4) if rd else None,
            'greedyDeathMean': round(sum(gd) / len(gd), 4) if gd else None,
            'randomDeathMedian': round(sorted(rd)[len(rd) // 2], 4) if rd else None,
            'greedyDeathMedian': round(sorted(gd)[len(gd) // 2], 4) if gd else None,
        })

    def corr(field, target, subset=None):
        rr = [r for r in rows if subset is None or subset(r)]
        xs = [r[field] for r in rr]
        ys = [r[target] for r in rr]
        pairs = [(x, y) for x, y in zip(xs, ys) if x is not None and y is not None]
        if len(pairs) < 3:
            return {'rho': None, 'n': len(pairs)}
        rho, n = spearman([p[0] for p in pairs], [p[1] for p in pairs])
        r = pearson([p[0] for p in pairs], [p[1] for p in pairs])
        return {'rho': round(rho, 4) if rho is not None else None,
                'r': round(r, 4) if r is not None else None,
                'n': n}

    corrs = {}
    for f in ['omniscient', 'greedyWin', 'randomWin', 'gapGreedy', 'gapRandom']:
        corrs[f] = {
            'failRate': corr(f, 'failRate'),
            'churn': corr(f, 'churn'),
            'failChurn_n7': corr(f, 'failChurn'),
        }
    # 补充：贪心 vs 随机（两把尺子是否同向）、死亡位置差
    rho_gr, n_gr = spearman([r['greedyWin'] for r in rows], [r['randomWin'] for r in rows])
    corrs['greedyWin_vs_randomWin'] = {'rho': round(rho_gr, 4), 'n': n_gr}
    death = []
    for r in rows:
        if r['greedyDeathMean'] is not None and r['randomDeathMean'] is not None:
            death.append({'level': r['level'], 'greedy': r['greedyDeathMean'],
                          'random': r['randomDeathMean'],
                          'diff': round(r['greedyDeathMean'] - r['randomDeathMean'], 4)})
    both_win = [r['level'] for r in rows if r['greedyWin'] == 1 and r['randomWin'] == 1]

    out = {'rows': rows, 'correlations': corrs,
           'deathCompare': death, 'bothWinLevels': both_win,
           'greedyZeroLevels': [r['level'] for r in rows if r['greedyWin'] == 0],
           'greedyLessThanOneLevels': [r['level'] for r in rows if r['greedyWin'] < 1]}
    with open(a.out, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
