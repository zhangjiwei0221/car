#!/usr/bin/env python3
"""冰造难度实验：汇总 PInterp（--seeds 977,4242 单次运行）→ 每种子三段 + Δ + 死亡分布。
用法：
  python3 summarize_48830.py <base_name> <variant1> [<variant2> ...]
base_name 为 pinterp/<base_name> 目录名（A-base / B-base 等）。
随意=p0/0.1/0.2；中间=p0.3–.7（另报 .4–.6）；认真=p0.8/0.9/1.0。
"""
import glob, json, os, sys

ROOT = '/Users/red/Desktop/毛线汽车'
D = os.path.join(ROOT, '实验关/产线v6/难度带/冰造难度')
P = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]

def load_all(path):
    return {round(x['p'], 3): x for x in json.load(open(path))}

def seg_rows(rows):
    out = {}
    for p, x in rows.items():
        for s in x['seeds']:
            out.setdefault(s['seed'], {})[p] = s['winRate']
    res = {}
    for seed, wr in out.items():
        def avg(ps):
            got = [wr[p] for p in ps if p in wr]
            return sum(got) / len(got) if got else None
        casual = avg((0, 0.1, 0.2))
        mid = avg((0.3, 0.4, 0.5, 0.6, 0.7))
        mid46 = avg((0.4, 0.5, 0.6))
        serious = avg((0.8, 0.9, 1.0))
        res[seed] = (casual, mid, mid46, serious)
    return res

def curve(rows, seed):
    out = {}
    for p, x in rows.items():
        for s in x['seeds']:
            if s['seed'] == seed:
                out[p] = s['winRate']
    return [out[p] for p in P]

def death_from_pergame(root):
    dist = {'lt10': 0, 'p10_25': 0, 'p25_50': 0, 'p50_90': 0, 'gt90': 0}
    casual = {'lt10': 0, 'p10_25': 0, 'p25_50': 0, 'p50_90': 0, 'gt90': 0}
    for p in P:
        hits = glob.glob(os.path.join(root, 'p%.3f' % p, '*', 'summary.json'))
        if not hits:
            continue
        sm = json.load(open(hits[0]))
        for g in sm['perGame']:
            if g['won']:
                continue
            v = g['deathProgress'] * 100
            key = ('lt10' if v < 10 else 'p10_25' if v < 25 else 'p25_50' if v < 50
                   else 'p50_90' if v <= 90 else 'gt90')
            dist[key] += 1
            if p <= 0.2:
                casual[key] += 1
    return dist, casual

def main():
    want = sys.argv[1:]
    if len(want) < 2:
        print(__doc__); return
    base_name, variants = want[0], want[1:]
    bglob = os.path.join(D, 'pinterp', base_name, 'summary_all.json')
    b = load_all(bglob)
    bseg = seg_rows(b)
    bdist, bcas = death_from_pergame(os.path.join(D, 'pinterp', base_name))
    print('BASE', base_name, {s: [round(x, 3) for x in bseg[s]] for s in sorted(bseg)})
    print('BASE death', bdist, 'casual', bcas)
    out = {'base': base_name, 'variants': {}}
    for name in variants:
        rows = load_all(os.path.join(D, 'pinterp', name, 'summary_all.json'))
        srows = seg_rows(rows)
        rec = {}
        print('\n==', name)
        for s in sorted(srows):
            c, m, m46, sr = srows[s]
            bs = bseg.get(s)
            fmt = lambda v: 'NA' if v is None else '%.3f' % v
            dfmt = lambda v: 'NA' if v is None else '%+5.1f' % v
            if bs:
                print('  seed %-5s casual %s mid %s mid46 %s serious %s | dC %s dM %s dS %s' % (
                    s, fmt(c), fmt(m), fmt(m46), fmt(sr),
                    dfmt((c - bs[0]) * 100 if c is not None else None),
                    dfmt((m - bs[1]) * 100 if m is not None else None),
                    dfmt((sr - bs[3]) * 100 if sr is not None else None)))
            else:
                print('  seed %-5s casual %s mid %s mid46 %s serious %s' % (s, fmt(c), fmt(m), fmt(m46), fmt(sr)))
            rec[str(s)] = {'casual': c, 'mid': m, 'mid46': m46, 'serious': sr,
                           'dC': (c - bs[0]) if (bs and c is not None) else None,
                           'dM': (m - bs[1]) if (bs and m is not None) else None,
                           'dS': (sr - bs[3]) if (bs and sr is not None) else None,
                           'curve': curve(rows, s)}
        common = [s for s in srows if s in bseg]
        if common and all(all(v is not None for v in srows[s]) for s in common):
            avg = [sum(srows[s][i] for s in common) / len(common) for i in range(4)]
            bavg = [sum(bseg[s][i] for s in common) / len(common) for i in range(4)]
            print('  合并   casual %.3f mid %.3f mid46 %.3f serious %.3f | dC %+5.1f dM %+5.1f dS %+5.1f' % (
                avg[0], avg[1], avg[2], avg[3], (avg[0]-bavg[0])*100, (avg[1]-bavg[1])*100, (avg[3]-bavg[3])*100))
            dist, cas = death_from_pergame(os.path.join(D, 'pinterp', name))
            print('  death', dist, '| casual', cas)
            rec['merged'] = {'casual': avg[0], 'mid': avg[1], 'mid46': avg[2], 'serious': avg[3],
                             'dC': (avg[0]-bavg[0])*100, 'dM': (avg[1]-bavg[1])*100,
                             'dS': (avg[3]-bavg[3])*100, 'death': dist, 'death_casual': cas}
        out['variants'][name] = rec
    out['base_seg'] = {str(s): list(bseg[s]) for s in bseg}
    out['base_death'] = bdist
    out['base_death_casual'] = bcas
    path = os.path.join(D, 'pinterp', 'summary_%s.json' % base_name)
    json.dump(out, open(path, 'w'), ensure_ascii=False, indent=1)
    print('\nwrote', path)

if __name__ == '__main__':
    main()
