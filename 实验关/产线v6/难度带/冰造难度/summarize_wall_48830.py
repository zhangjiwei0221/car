#!/usr/bin/env python3
"""冰造难度：汇总 probe_wall_phase 输出（两种子 × p0.1/0.2）→ 每格墙/相位/碎冰盒。
用法：python3 summarize_wall_48830.py <variant>   # 读 墙探针/wall_<variant>_{977,4242}.json
"""
import glob, json, os, sys

D = '/Users/red/Desktop/毛线汽车/实验关/产线v6/难度带/冰造难度'

def main():
    name = sys.argv[1]
    files = sorted(glob.glob(os.path.join(D, '墙探针', 'wall_%s_*.json' % name)))
    if not files:
        print('no files for', name); return
    agg = {}
    for f in files:
        d = json.load(open(f))
        for pkey, pr in d['results'].items():
            for key, cs in pr['cells'].items():
                a = agg.setdefault(key, {'n': 0, 'wall': 0.0, 'pick': 0.0, 'prog': 0.0,
                                         'broken': 0.0, 'bprog': 0.0, 'wasIce': 0})
                a['n'] += 1
                a['wall'] += cs['wallStepsMean']
                a['pick'] += cs['firstPickableMed']
                a['prog'] += cs['firstPickableProgressMean']
                a['broken'] += cs['brokenMed']
                a['bprog'] += cs['brokenProgressMed']
                a['wasIce'] += cs['wasIce']
    print('variant', name, 'files', len(files))
    print('cell   wall/局  首可点步  首可点进度  碎冰步  碎冰进度  冰中局%')
    for key in sorted(agg, key=lambda k: (int(k.split(',')[0]), int(k.split(',')[1]))):
        a = agg[key]; n = a['n']
        print('%-6s %8.2f %9.1f %11.2f %8.1f %9.2f %8.0f' % (
            key, a['wall']/n, a['pick']/n, a['prog']/n, a['broken']/n, a['bprog']/n, a['wasIce']/n))

if __name__ == '__main__':
    main()
