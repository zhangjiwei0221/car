#!/usr/bin/env python3
"""暴露前冰：墙相位表。每块冰的
  碎冰盒数（probe_boxes brokenBallsMed，p0.1/0.2 × 种子 977/4242 取均）
  暴露盒数（exposure_probe 变体上 20 局随机中位）
  首可点盒数（probe_boxes firstPickableBallsMed，同上均值）
  墙/局（probe_wall_662 wallStepsMean，同上均值）
  判定：碎冰盒数 < 暴露盒数（冰在车进入可选列表前就碎）→ 墙不在可用窗口内。
"""
import json, os

ROOT = '/Users/red/Desktop/毛线汽车'
D = os.path.join(ROOT, '实验关/产线v6/难度带/暴露前冰')
BASE = {'977': None, '4242': None}
MEAN = lambda a: sum(a) / len(a) if a else None

CELLS = {
    'E8': ['1,1', '2,0', '2,6', '3,1', '4,4', '5,0', '6,4', '6,6'],
    'E10': ['2,0', '2,6', '3,1', '3,5', '4,4', '4,5', '5,0', '5,3', '6,4', '6,6'],
    'E10-行6长冰': ['2,0', '2,6', '3,1', '3,5', '4,4', '4,5', '5,0', '5,3', '6,4', '6,6'],
}
BASE_ICE = ['5,4', '6,3']
PARAM = {
    'E8': {'1,1': 3, '2,0': 7, '2,6': 8, '3,1': 10, '4,4': 17, '5,0': 26, '6,4': 33, '6,6': 29,
           '5,4': 31, '6,3': 33},
    'E10': {'2,0': 7, '2,6': 8, '3,1': 10, '3,5': 11, '4,4': 17, '4,5': 15, '5,0': 26, '5,3': 22,
            '6,4': 33, '6,6': 29, '5,4': 31, '6,3': 33},
    'E10-行6长冰': {'2,0': 7, '2,6': 8, '3,1': 10, '3,5': 11, '4,4': 17, '4,5': 15, '5,0': 26,
                    '5,3': 22, '6,4': 28, '6,6': 28, '5,4': 31, '6,3': 33},
}

out = {}
for name in ['E8', 'E10', 'E10-行6长冰']:
    boxes = {s: json.load(open(os.path.join(D, 'probe', f'boxes_{name}_{s}.json'))) for s in ('977', '4242')}
    walls = {s: json.load(open(os.path.join(D, '墙探针', f'wall_{name}_{s}.json'))) for s in ('977', '4242')}
    expo = json.load(open(os.path.join(D, 'probe', f'exposure_{name}_977.json')))
    print('===== %s =====' % name)
    print('%-6s %-5s %-5s %10s %10s %12s %10s %8s  %s' % (
        '格', '色', 'param', '碎冰盒', '暴露盒', '首可点盒', '曝光率', '墙/局', '判定'))
    rows = []
    for key in CELLS[name] + BASE_ICE:
        bvals, fvals, brvals = [], [], []
        for s in ('977', '4242'):
            for p in ('p0.1', 'p0.2'):
                cs = boxes[s]['results'][p]['cells'][key]
                if cs['brokenBallsMed'] is not None:
                    brvals.append(cs['brokenBallsMed'])
                if cs['firstPickableBallsMed'] is not None:
                    fvals.append(cs['firstPickableBallsMed'])
        wvals = []
        for s in ('977', '4242'):
            for p in ('p0.1', 'p0.2'):
                cs = walls[s]['results'][p]['cells'][key]
                if cs['wallStepsMean'] is not None:
                    wvals.append(cs['wallStepsMean'])
        broken = MEAN(brvals)
        firstpk = MEAN(fvals)
        exposure = expo['cells'][key]['exposureBallsMed']
        exprate = expo['cells'][key]['exposedRate']
        wall = MEAN(wvals)
        margin = (exposure - broken) if (exposure is not None and broken is not None) else None
        ok = margin is not None and margin > 0
        rows.append({'cell': key, 'param': PARAM[name][key], 'brokenBalls': broken,
                     'exposureBalls': exposure, 'exposureRate': exprate,
                     'firstPickableBalls': firstpk, 'wallStepsMean': wall,
                     'marginExposureMinusBroken': margin, 'noWallInWindow': ok,
                     'isBaseIce': key in BASE_ICE})
        print('%-6s %-5s %-5d %10.1f %10.1f %12.1f %10.2f %8.2f  %s%s' % (
            key, '', PARAM[name][key], broken if broken is not None else float('nan'),
            exposure if exposure is not None else float('nan'),
            firstpk if firstpk is not None else float('nan'), exprate,
            wall if wall is not None else float('nan'),
            'OK' if ok else 'CHECK', ' (底座冰)' if key in BASE_ICE else ''))
    newrows = [r for r in rows if not r['isBaseIce']]
    print('新增冰：%d 块；全部“碎冰 < 暴露”：%s；最小余量 %.1f 盒' % (
        len(newrows), all(r['noWallInWindow'] for r in newrows),
        min(r['marginExposureMinusBroken'] for r in newrows)))
    out[name] = rows
    print()

json.dump(out, open(os.path.join(D, '墙探针', 'phase_table.json'), 'w'), ensure_ascii=False, indent=1)
print('wrote 墙探针/phase_table.json')
