#!/usr/bin/env python3
"""长冰密度实验：从墙探针 JSON 汇总每块新冰的 param/碎冰步/碎冰进度/首可点/墙，算变体均值。"""
import json, os

D = '/Users/red/Desktop/毛线汽车/实验关/产线v6/难度带/长冰密度/墙探针'
SETS = {
    '深晚': [('4,2', 15), ('4,3', 17), ('5,0', 20), ('5,2', 20), ('5,3', 20), ('6,2', 24), ('6,4', 28)],
    '深更晚': [('5,0', 20), ('5,1', 18), ('5,2', 20), ('5,3', 20), ('6,2', 24), ('6,6', 28)],
    '深等': [('4,2', 21), ('4,3', 23), ('5,0', 28), ('5,2', 27), ('5,3', 27), ('6,2', 33), ('6,4', 38)],
}

for name, cells in SETS.items():
    print('##', name)
    phase_all = []
    wall_all = []
    for seed in ('977', '4242'):
        d = json.load(open(os.path.join(D, 'probe_%s_%s.json' % (name, seed))))
        for p in ('p0.1', 'p0.2'):
            r = d['results'][p]
            parts = []
            for key, param in cells:
                v = r['cells'][key]
                parts.append('%s p%d: 碎 b%s/步%s/%s%% · 首可点 步%s/%s%% · 墙%.2f' % (
                    key, param, v['brokenBallsMed'], v['brokenMed'],
                    ('%.0f' % (v['brokenProgressMean'] * 100)) if v['brokenProgressMean'] is not None else '-',
                    v['firstPickableMed'],
                    ('%.0f' % (v['firstPickableProgressMean'] * 100)) if v['firstPickableProgressMean'] is not None else '-',
                    v['wallStepsMean']))
            print('%s %s: %s' % (seed, p, ' | '.join(parts)))
        for p in ('p0.1', 'p0.2'):
            r = d['results'][p]
            for key, _ in cells:
                v = r['cells'][key]
                if v['brokenProgressMean'] is not None: phase_all.append(v['brokenProgressMean'])
                wall_all.append(v['wallStepsMean'])
    print('相位均值 %.1f%%（碎冰时进度）；墙合计均值 %.2f 步/局（p0.1+p0.2 两档平均）' % (
        100 * sum(phase_all) / len(phase_all), sum(wall_all) / len(wall_all)))
    print()
