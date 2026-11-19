#!/usr/bin/env python3
"""长冰密度实验：汇总 PInterp summary_all.json → 随意/中间/认真 与对 base 的 Δ（两种子平均）。"""
import json, os, sys

ROOT = '/Users/red/Desktop/毛线汽车'
D = os.path.join(ROOT, '实验关/产线v6/难度带/长冰密度')
BASE = {
    '977': os.path.join(ROOT, '实验关/产线v6/难度带/冰剂量/pinterp_base_977/summary_all.json'),
    '4242': os.path.join(ROOT, '实验关/产线v6/难度带/冰剂量/pinterp_base_4242/summary_all.json'),
}
P = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]

def load(path):
    d = json.load(open(path))
    return {round(x['p'], 3): x for x in d}

def seg(rows):
    win = {p: rows[p]['winRate'] for p in P}
    casual = sum(win[p] for p in (0, 0.1, 0.2)) / 3
    mid = sum(win[p] for p in (0.3, 0.4, 0.5, 0.6, 0.7)) / 5
    mid_46 = sum(win[p] for p in (0.4, 0.5, 0.6)) / 3
    serious = sum(win[p] for p in (0.8, 0.9, 1.0)) / 3
    return casual, mid, mid_46, serious

def dist(rows, plist=P):
    d = {'lt10': 0, 'p10_25': 0, 'p25_50': 0, 'p50_90': 0, 'gt90': 0}
    for p in plist:
        for k in d:
            d[k] += rows[p]['deathDist'][k]
    return d

base = {s: load(p) for s, p in BASE.items()}
want = sys.argv[1:] or ['深晚', '深更晚', '深等']
print('variant seed  casual  mid.3-.7 mid.4-.6 serious | dCasual dMid dSerious | lt10 lt25 | p10_25 p25_50 p50_90 gt90 | 随意档<25% 25-50%')
for name in want:
    rows = {}
    for s in ('977', '4242'):
        f = os.path.join(D, 'pinterp/%s_%s/summary_all.json' % (name, s))
        if not os.path.exists(f):
            print('%s %s: MISSING' % (name, s)); continue
        cur = load(f)
        casual, mid, mid46, serious = seg(cur)
        b = seg(base[s])
        dd = dist(cur)
        ddc = dist(cur, (0, 0.1, 0.2))
        lt10 = dd['lt10']; lt25 = lt10 + dd['p10_25']
        rows[s] = (casual, mid, mid46, serious,
                   casual - b[0], mid - b[1], mid46 - b[2], serious - b[3],
                   lt10, lt25, dd['p10_25'], dd['p25_50'], dd['p50_90'], dd['gt90'],
                   ddc['lt10'] + ddc['p10_25'], ddc['p25_50'])
        print('%-4s %-5s %.3f  %.3f  %.3f  %.3f | %+5.1f %+5.1f %+5.1f | %d %d | %d %d %d %d | %d %d' % (
            name, s, casual, mid, mid46, serious,
            (casual - b[0]) * 100, (mid - b[1]) * 100, (serious - b[3]) * 100,
            lt10, lt25, dd['p10_25'], dd['p25_50'], dd['p50_90'], dd['gt90'],
            rows[s][14], rows[s][15]))
    if len(rows) == 2:
        a = rows['977']; b = rows['4242']
        avg = [sum(x) / 2 for x in zip(a, b)]
        dcas = (avg[0] - (seg(base['977'])[0] + seg(base['4242'])[0]) / 2) * 100
        dmid = (avg[1] - (seg(base['977'])[1] + seg(base['4242'])[1]) / 2) * 100
        dser = (avg[3] - (seg(base['977'])[3] + seg(base['4242'])[3]) / 2) * 100
        print('%-4s 合并  %.3f  %.3f  %.3f  %.3f | %+5.1f %+5.1f %+5.1f | lt10=%d lt25=%d' % (
            name, avg[0], avg[1], avg[2], avg[3], dcas, dmid, dser, a[8] + b[8], a[9] + b[9]))
print('base 977:', [round(x, 3) for x in seg(base['977'])],
      'casual<25/25-50:', dist(base['977'], (0, 0.1, 0.2))['lt10'] + dist(base['977'], (0, 0.1, 0.2))['p10_25'],
      dist(base['977'], (0, 0.1, 0.2))['p25_50'])
print('base 4242:', [round(x, 3) for x in seg(base['4242'])],
      'casual<25/25-50:', dist(base['4242'], (0, 0.1, 0.2))['lt10'] + dist(base['4242'], (0, 0.1, 0.2))['p10_25'],
      dist(base['4242'], (0, 0.1, 0.2))['p25_50'])
