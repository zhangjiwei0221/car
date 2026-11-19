#!/usr/bin/env python3
"""暴露前冰：汇总专用墙探针（wall_probe_45579.js）——墙是否落在可用窗口内。
两种子（977/4242）× p0.1/0.2 合并；每格给出暴露/碎冰/首次墙盒数、发生墙的局数、平均墙步。
判定：wallGames > 0 → 该块冰在部分局里挡住了“本可点”的选项（墙在可用窗口内）。
"""
import json, os

ROOT = '/Users/red/Desktop/毛线汽车'
D = os.path.join(ROOT, '实验关/产线v6/难度带/暴露前冰')
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
MEAN = lambda a: sum(a) / len(a) if a else None

out = {}
for name in ['E8', 'E10', 'E10-行6长冰']:
    runs = [json.load(open(os.path.join(D, '墙探针', f'wallour_{name}_{s}.json'))) for s in ('977', '4242')]
    print('===== %s =====' % name)
    print('%-6s %-5s %8s %8s %10s %10s %10s' % ('格', 'param', '暴露盒', '碎冰盒', '首次墙盒', '有墙局/200', '墙步/局'))
    rows = []
    for key in CELLS[name] + BASE_ICE:
        exp, br, fw, wg, ws = [], [], [], 0, []
        for d in runs:
            for p in ('p0.1', 'p0.2'):
                c = d['results'][p]['cells'][key]
                if c['exposureBallsMed'] is not None: exp.append(c['exposureBallsMed'])
                if c['brokenBallsMed'] is not None: br.append(c['brokenBallsMed'])
                if c['firstWallBallsMed'] is not None: fw.append(c['firstWallBallsMed'])
                wg += c['wallGames']
                ws.append(c['wallStepsMean'])
        rec = {'cell': key, 'param': PARAM[name][key], 'isBaseIce': key in BASE_ICE,
               'exposureBalls': MEAN(exp), 'brokenBalls': MEAN(br),
               'firstWallBalls': MEAN(fw), 'wallGames': wg, 'wallStepsMean': MEAN(ws),
               'wallInUsableWindow': wg > 0}
        rows.append(rec)
        print('%-6s %-5d %8.1f %8.1f %10.1f %10d %10.2f%s' % (
            key, rec['param'], rec['exposureBalls'] or float('nan'),
            rec['brokenBalls'] or float('nan'), rec['firstWallBalls'] or float('nan'),
            wg, rec['wallStepsMean'], ' (底座冰)' if rec['isBaseIce'] else ''))
    new = [r for r in rows if not r['isBaseIce']]
    print('新增冰 %d 块：发生墙 %d 块；合计墙步/局 %.2f；暴露−碎冰最小余量 %.1f' % (
        len(new), sum(1 for r in new if r['wallInUsableWindow']),
        sum(r['wallStepsMean'] for r in new),
        min((r['exposureBalls'] - r['brokenBalls']) for r in new)))
    out[name] = rows
    print()
json.dump(out, open(os.path.join(D, '墙探针', 'wall_summary.json'), 'w'), ensure_ascii=False, indent=1)
print('wrote 墙探针/wall_summary.json')
