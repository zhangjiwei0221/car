#!/usr/bin/env python3
"""暴露前冰：底座 vs 三变体逐格 diff（只看 spools 的 id/type/param/count，及 blocks）。
用法: python3 diff_cells_45579.py"""
import json, os, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
BASE = '/Users/red/Desktop/毛线汽车/实验关/产线v6/难度带/试造_140/关卡_ZC_140_final.json'
NAMES = ['E8', 'E10', 'E10-行6长冰']
FILES = {n: os.path.join(ROOT, f'关卡_ZC_140_暴露前-{n}.json') for n in NAMES}

base = json.load(open(BASE))
out_lines = []
ok_all = True
for name, path in FILES.items():
    var = json.load(open(path))
    diffs = []
    for r in range(len(base['spools'])):
        for c in range(len(base['spools'][r])):
            a, b = base['spools'][r][c], var['spools'][r][c]
            for k in ('id', 'type', 'param', 'count'):
                if a[k] != b[k]:
                    diffs.append((r, c, k, a[k], b[k]))
    other = []
    for k in ('blocks', 'toprow', 'maprow', 'mapcol'):
        if base[k] != var[k]:
            other.append(k)
    out_lines.append(f'== {name} ==')
    out_lines.append(f'changed fields: {len(diffs)}; by key: ' +
                     str({k: sum(1 for d in diffs if d[2] == k) for k in ('id', 'type', 'param', 'count')}))
    for d in diffs:
        out_lines.append(f'  ({d[0]},{d[1]}) {d[2]}: {d[3]} -> {d[4]}')
    out_lines.append(f'other keys changed: {other or "none"}')
    # 目标格 = type/param 变为冰的格；任何 id/count 变化都算异常
    bad = [d for d in diffs if d[2] in ('id', 'count') or (d[2] == 'type' and d[4] != 7)]
    if bad or other:
        ok_all = False
        out_lines.append(f'  !! UNEXPECTED: {bad}')
    else:
        out_lines.append('  OK: only type->7 / param on target cells, nothing else')
    out_lines.append('')

text = '\n'.join(out_lines)
os.makedirs(os.path.join(ROOT, '检查'), exist_ok=True)
open(os.path.join(ROOT, '检查', 'diff_格.txt'), 'w').write(text + '\n')
print(text)
sys.exit(0 if ok_all else 1)
