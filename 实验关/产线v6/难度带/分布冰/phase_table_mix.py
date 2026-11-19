#!/usr/bin/env python3
"""分布式混铺冰：墙相位汇总 —— 读 墙探针/probe_M*_<seed>.json，按格输出
碎冰步/进度、首可点步/进度、每局墙步数、视觉分布（行 1/2/3/6 块数）。
"""
import json, os, glob

ROOT = '/Users/red/Desktop/毛线汽车'
D = os.path.join(ROOT, '实验关/产线v6/难度带/分布冰')
VARIANTS = {
    'M1': '关卡_ZC_140_混铺-M1上短下长.json',
    'M2': '关卡_ZC_140_混铺-M2散点.json',
    'M3': '关卡_ZC_140_混铺-M3上短下长中点缀.json',
}

def mean(a):
    a = [x for x in a if x is not None]
    return sum(a) / len(a) if a else None

for name, fn in VARIANTS.items():
    game = json.load(open(os.path.join(D, fn)))
    params, rows, cols = {}, {}, {}
    for r in range(7):
        for c in range(7):
            sp = game['spools'][r][c]
            if sp.get('type') == 7:
                params['%d,%d' % (r, c)] = sp.get('param')
    probes = sorted(glob.glob(os.path.join(D, '墙探针', 'probe_%s_*.json' % name)))
    if not probes:
        print(name, 'NO PROBE'); continue
    for f in probes:
        d = json.load(open(f))
        for pk, agg in d['results'].items():
            for key, cs in agg['cells'].items():
                if not cs['wasIce']:
                    continue
                rec = rows.setdefault(key, [])
                rec.append((cs['brokenMed'], cs['brokenProgressMean'], cs['firstPickableMed'],
                            cs['firstPickableProgressMean'], cs['wallStepsMean'], cs['lostOptionsMean']))
    print('====', name, '(probes %d, seeds %s, p %s)' % (
        len(probes), sorted(d['seed'] for d in (json.load(open(f)) for f in probes)),
        ','.join(sorted(json.load(open(probes[0]))['results'].keys()))))
    print('cell param | broken步 进度 | 首可点步 进度 | 墙/局 丢选项/局')
    visual = {}
    for key in sorted(rows, key=lambda k: (int(k.split(',')[0]), int(k.split(',')[1]))):
        rec = rows[key]
        b_step = mean([x[0] for x in rec]); b_prog = mean([x[1] for x in rec])
        f_step = mean([x[2] for x in rec]); f_prog = mean([x[3] for x in rec])
        wall = mean([x[4] for x in rec]); lost = mean([x[5] for x in rec])
        r = int(key.split(',')[0])
        visual[r] = visual.get(r, 0) + 1
        print('(%-3s) p%-3s | %s %s | %s %s | %.2f %.2f' % (
            key, params.get(key, '?'),
            '%.0f' % b_step if b_step is not None else '-',
            '%.1f%%' % (b_prog * 100) if b_prog is not None else '-',
            '%.0f' % f_step if f_step is not None else '-',
            '%.1f%%' % (f_prog * 100) if f_prog is not None else '-',
            wall or 0, lost or 0))
    print('视觉分布（新增块/行）:', ' '.join('行%d:%d' % (r, visual[r]) for r in sorted(visual)),
          '| 行1/2/3/6:', [visual.get(x, 0) for x in (1, 2, 3, 6)])
    # 原 2 块冰
    print('原有表演冰: (5,4) p31 色14, (6,3) p33 色7（底座保留）')
