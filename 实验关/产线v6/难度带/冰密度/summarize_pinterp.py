#!/usr/bin/env python3
"""冰密度实验：汇总 PInterp summary_all.json → 随意/中间/认真 与对 base 的 Δ（两种子平均）。"""
import json, os, sys

ROOT = '/Users/red/Desktop/毛线汽车'
D = os.path.join(ROOT, '实验关/产线v6/难度带/冰密度')
BASE = {
    '977': os.path.join(ROOT, '实验关/产线v6/难度带/冰剂量/pinterp_base_977/summary_all.json'),
    '4242': os.path.join(ROOT, '实验关/产线v6/难度带/冰剂量/pinterp_base_4242/summary_all.json'),
}
P = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]

def load(path):
    d = json.load(open(path))
    return {round(x['p'], 3): x['winRate'] for x in d}

def seg(by):
    casual = sum(by[p] for p in (0, 0.1, 0.2)) / 3
    mid = sum(by[p] for p in (0.3, 0.4, 0.5, 0.6, 0.7)) / 5
    mid_46 = sum(by[p] for p in (0.4, 0.5, 0.6)) / 3
    serious = sum(by[p] for p in (0.8, 0.9, 1.0)) / 3
    return casual, mid, mid_46, serious

def lt(seed_summary):
    d = json.load(open(seed_summary))
    lt10 = sum(x['deathDist']['lt10'] for x in d)
    lt25 = sum(x['deathDist']['lt10'] + x['deathDist']['p10_25'] for x in d)
    return lt10, lt25

base = {s: load(p) for s, p in BASE.items()}
print('variant seed  casual  mid.3-.7 mid.4-.6 serious | dCasual dMid dSerious | lt10 lt25')
for name in sys.argv[1:]:
    rows = {}
    for s in ('977', '4242'):
        f = os.path.join(D, 'pinterp_%s_%s/summary_all.json' % (name, s))
        if not os.path.exists(f):
            print('%s %s: MISSING' % (name, s)); continue
        by = load(f)
        casual, mid, mid46, serious = seg(by)
        b = seg(base[s])
        l10, l25 = lt(f)
        rows[s] = (casual, mid, mid46, serious, casual - b[0], mid - b[1], mid46 - b[2], serious - b[3], l10, l25)
        print('%-4s %-5s %.3f  %.3f  %.3f  %.3f | %+5.1f %+5.1f %+5.1f | %d %d' % (
            name, s, casual, mid, mid46, serious,
            (casual - b[0]) * 100, (mid - b[1]) * 100, (serious - b[3]) * 100, l10, l25))
    if len(rows) == 2:
        a = rows['977']; b = rows['4242']
        avg = [sum(x) / 2 for x in zip(a, b)]
        print('%-4s 合并  %.3f  %.3f  %.3f  %.3f | %+5.1f %+5.1f %+5.1f' % (
            name, avg[0], avg[1], avg[2], avg[3], avg[4] * 100, avg[5] * 100, avg[7] * 100))
