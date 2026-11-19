#!/usr/bin/env python3
"""冰造难度：从 per-p 目录重建 summary_all.json，并打印三段/倒序/死亡分布。
用于被提前停止的变体（没有 summary_all）。
用法：python3 collect_48830.py <pinterp子目录名> [...]
"""
import glob, json, os, sys

D = '/Users/red/Desktop/毛线汽车/实验关/产线v6/难度带/冰造难度/pinterp'
P = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]

def build(name):
    root = os.path.join(D, name)
    if os.path.exists(os.path.join(root, 'summary_all.json')):
        return json.load(open(os.path.join(root, 'summary_all.json')))
    rows = []
    for p in P:
        hits = glob.glob(os.path.join(root, 'p%.3f' % p, '*', 'summary.json'))
        if not hits:
            continue
        sm = json.load(open(hits[0]))
        rows.append({k: sm[k] for k in ('level', 'levelNo', 'p', 'games', 'seeds', 'winRate', 'deathMean', 'deathDist')})
    json.dump(rows, open(os.path.join(root, 'summary_all.json'), 'w'), ensure_ascii=False)
    return rows

for name in sys.argv[1:]:
    rows = build(name)
    wr = {}
    for x in rows:
        for s in x['seeds']:
            wr.setdefault(s['seed'], {})[round(x['p'], 3)] = s['winRate']
    print('==', name, 'p levels', sorted(wr[list(wr)[0]].keys()))
    for seed, curve in sorted(wr.items()):
        c = sum(curve[p] for p in (0, 0.1, 0.2)) / 3
        m = sum(curve[p] for p in (0.3, 0.4, 0.5, 0.6, 0.7) if p in curve) / max(1, sum(1 for p in (0.3,0.4,0.5,0.6,0.7) if p in curve))
        sr = sum(curve[p] for p in (0.8, 0.9, 1) if p in curve) / max(1, sum(1 for p in (0.8,0.9,1) if p in curve))
        seq = [curve[p] for p in sorted(curve)]
        inv = sum(1 for i in range(len(seq) - 1) if seq[i + 1] < seq[i])
        print(' seed %-5s casual %.3f mid %.3f serious %.3f inv %d curve %s' % (seed, c, m, sr, inv, seq))
