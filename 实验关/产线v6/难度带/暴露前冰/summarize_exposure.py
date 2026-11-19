#!/usr/bin/env python3
"""暴露前冰实验：汇总 PInterp summary_all.json（--seeds 977,4242 单次运行）
→ 每种子随意/中间/认真 与对 base 的 Δ（两种子平均）。

base 数据：冰剂量/pinterp_base_977、pinterp_base_4242（同底座、同种子、同 11 档）。
死亡分布：从每个 p 的 perGame 重算；变体一次运行含两种子（每 p 200 局）。
"""
import glob, json, os, sys

ROOT = '/Users/red/Desktop/毛线汽车'
D = os.path.join(ROOT, '实验关/产线v6/难度带/暴露前冰')
BASE = {
    977: os.path.join(ROOT, '实验关/产线v6/难度带/冰剂量/pinterp_base_977/summary_all.json'),
    4242: os.path.join(ROOT, '实验关/产线v6/难度带/冰剂量/pinterp_base_4242/summary_all.json'),
}
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
        casual = sum(wr[p] for p in (0, 0.1, 0.2)) / 3
        mid = sum(wr[p] for p in (0.3, 0.4, 0.5, 0.6, 0.7)) / 5
        mid46 = sum(wr[p] for p in (0.4, 0.5, 0.6)) / 3
        serious = sum(wr[p] for p in (0.8, 0.9, 1.0)) / 3
        res[seed] = (casual, mid, mid46, serious)
    return res


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


base = {s: load_all(p) for s, p in BASE.items()}
base_seg = {s: seg_rows(base[s])[s] for s in (977, 4242)}
base_dist_c = {'lt10': 0, 'p10_25': 0, 'p25_50': 0, 'p50_90': 0, 'gt90': 0}
base_cas_c = {'lt10': 0, 'p10_25': 0, 'p25_50': 0, 'p50_90': 0, 'gt90': 0}
for s in (977, 4242):
    bd, bc = death_from_pergame(os.path.dirname(BASE[s]))
    for k in base_dist_c:
        base_dist_c[k] += bd[k]
        base_cas_c[k] += bc[k]

want = sys.argv[1:] or ['E8', 'E10', 'E10-行6长冰']
print('variant            seed  casual  mid.3-.7 mid.4-.6 serious | dCasual dMid dSerious | dMid46')
merged = {}
for name in want:
    rows = load_all(os.path.join(D, 'pinterp', name, 'summary_all.json'))
    srows = seg_rows(rows)
    rec = {}
    for s in (977, 4242):
        if s not in srows:
            print(name, s, 'MISSING')
            continue
        c, m, m46, sr = srows[s]
        b = base_seg[s]
        print('%-18s %-5s %.3f  %.3f  %.3f  %.3f | %+5.1f %+5.1f %+5.1f | %+5.1f' % (
            name, s, c, m, m46, sr,
            (c - b[0]) * 100, (m - b[1]) * 100, (sr - b[3]) * 100, (m46 - b[2]) * 100))
        rec[s] = (c, m, m46, sr, c - b[0], m - b[1], m46 - b[2], sr - b[3])
    if len(rec) == 2:
        a, b2 = rec[977], rec[4242]
        avg = [sum(x) / 2 for x in zip(a, b2)]
        baseline = [(base_seg[977][i] + base_seg[4242][i]) / 2 for i in range(4)]
        dcas = (avg[0] - baseline[0]) * 100
        dmid = (avg[1] - baseline[1]) * 100
        dmid46 = (avg[2] - baseline[2]) * 100
        dser = (avg[3] - baseline[3]) * 100
        print('%-18s 合并  %.3f  %.3f  %.3f  %.3f | %+5.1f %+5.1f %+5.1f | %+5.1f' % (
            name, avg[0], avg[1], avg[2], avg[3], dcas, dmid, dser, dmid46))
        dist, casual = death_from_pergame(os.path.join(D, 'pinterp', name))
        verdict = (abs(dcas) <= 5 and dser >= -3 and abs(dmid) <= 5)
        merged[name] = {
            'casual': avg[0], 'mid': avg[1], 'mid46': avg[2], 'serious': avg[3],
            'dCasual': dcas, 'dMid': dmid, 'dMid46': dmid46, 'dSerious': dser,
            'pass': verdict,
            'death': dist, 'death_casual': casual,
            'death_base': base_dist_c, 'death_base_casual': base_cas_c,
            'per_seed': {str(k): rec[k] for k in rec},
        }
        print('     判定: %s  (|Δ随意|=%.1f≤5? %s; Δ认真=%+.1f≥-3? %s; |Δ中间|=%.1f≤5? %s)' % (
            'PASS' if verdict else 'FAIL', abs(dcas), 'Y' if abs(dcas) <= 5 else 'N',
            dser, 'Y' if dser >= -3 else 'N', abs(dmid), 'Y' if abs(dmid) <= 5 else 'N'))
        print('     死亡(全程): %s | base: %s' % (dist, base_dist_c))
        print('     死亡(随意档 p0-.2): %s | base: %s' % (casual, base_cas_c))
print('base 977 seg:', [round(x, 3) for x in base_seg[977]])
print('base 4242 seg:', [round(x, 3) for x in base_seg[4242]])
out = os.path.join(D, 'pinterp', 'summary_exposure.json')
json.dump({'merged': merged, 'p': P}, open(out, 'w'), ensure_ascii=False, indent=1)
print('wrote', out)
