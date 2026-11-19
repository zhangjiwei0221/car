#!/usr/bin/env python3
# 冰剂量实验汇总（2026-11-19，pid 662）。只读数据，打印 markdown。
import json, os

ROOT = '/Users/red/Desktop/毛线汽车'
D = os.path.join(ROOT, '实验关/产线v6/难度带/冰剂量')

def metrics(path):
    if not os.path.exists(path): return None
    d = json.load(open(path))
    win = {round(x['p'], 1): x['winRate'] for x in d}
    casual = sum(win[p] for p in (0, 0.1, 0.2)) / 3
    mid = sum(win[p] for p in (0.3, 0.4, 0.5, 0.6, 0.7)) / 5
    serious = sum(win[p] for p in (0.8, 0.9, 1)) / 3
    lt10 = sum(x['deathDist']['lt10'] for x in d)
    lt25 = sum(x['deathDist']['lt10'] + x['deathDist']['p10_25'] for x in d)
    return dict(win=win, casual=casual, mid=mid, serious=serious, lt10=lt10, lt25=lt25)

base977 = metrics(os.path.join(D, 'pinterp_base_977/summary_all.json'))
base4242 = metrics(os.path.join(ROOT, '实验关/产线v6/难度带/试造_140/pinterp_S3_CB_CD_冰_4242/summary_all.json'))
descr = {
 'base': ('—', '底座已有 2 块：(5,4) p31、(6,3) p33'),
 'A': ('3', '(1,0) p4、(1,4) p5、(2,1) p6（第1–2行）'),
 'B': ('3', '(4,0) p24、(4,1) p20、(5,1) p16（第4–5行）'),
 'C': ('2', '(3,4) 色24 p10、(6,1) 色34 p10（晚色）'),
 'D': ('6', 'A+B'),
 'E': ('5', '(4,0) p24、(4,1) p20、(4,4) p26、(4,5) p18、(5,1) p22'),
 'F': ('5', '对照：5 块异色 (4,0)p24/(4,1)p20/(4,5)p22/(5,1)p20/(5,5)p18'),
}
print('## 三段（977）')
print('| 变体 | 冰 | 位置/param | 随意 | 中间 | 认真 | Δ随意 | Δ认真 | lt10 | lt25 |')
print('|---|---:|---|---:|---:|---:|---:|---:|---:|---:|')
for n in ['base','A','B','C','D','E','F']:
    m = base977 if n == 'base' else metrics(os.path.join(D, f'pinterp_{n}_977/summary_all.json'))
    if not m: continue
    dc = (m['casual'] - base977['casual']) * 100
    ds = (m['serious'] - base977['serious']) * 100
    cnt, pos = descr[n]
    print(f"| {n} | {cnt} | {pos} | {m['casual']:.3f} | {m['mid']:.3f} | {m['serious']:.3f} | {dc:+.1f}pp | {ds:+.1f}pp | {m['lt10']} | {m['lt25']} |")
print()
print('## 三段（4242）')
print('| 变体 | 随意 | 中间 | 认真 | Δ随意 | Δ认真 | lt10 | lt25 |')
print('|---|---:|---:|---:|---:|---:|---:|---:|')
for n in ['base','A','B','C','D','E','F']:
    p = os.path.join(ROOT, '实验关/产线v6/难度带/试造_140/pinterp_S3_CB_CD_冰_4242/summary_all.json') if n == 'base' else os.path.join(D, f'pinterp_{n}_4242/summary_all.json')
    m = metrics(p)
    if not m: continue
    dc = (m['casual'] - base4242['casual']) * 100
    ds = (m['serious'] - base4242['serious']) * 100
    print(f"| {n} | {m['casual']:.3f} | {m['mid']:.3f} | {m['serious']:.3f} | {dc:+.1f}pp | {ds:+.1f}pp | {m['lt10']} | {m['lt25']} |")
print()
print('## at4（p0.1/0.2）')
at4 = {}
for line in open(os.path.join(D, 'at4_汇总_662.txt')):
    line = line.strip()
    if line.startswith('{'):
        o = json.loads(line); key = o['level'].replace('关卡_ZC_140_', '').replace('.json','')
        key = 'base' if key == 'final' else key.replace('冰', '', 1)
        at4.setdefault(key, []).append((o['p'], o['meanAt4'], o['winRate']))
for n in ['base','A','B','C','D','E','F']:
    if n in at4:
        a = at4[n]
        print(f"| {n} | " + ' | '.join(f"p{x[0]}: at4 {float(x[1]):.2f} / win {x[2]:.2f}" for x in a) + ' |')
print()
print('## 墙效应（seed 977，p0.1 / p0.2）')
for n in ['base','A','B','C','D','E','F']:
    p = os.path.join(D, f'probe_{n}_977.json')
    if not os.path.exists(p): continue
    d = json.load(open(p))
    print(f"### {n}")
    print('| 格 | 首次可点步 | 首次被拿步 | 破碎步 | 墙步数 | 组丢失选项 | p |')
    print('|---|---:|---:|---:|---:|---:|---:|')
    for pk, r in d['results'].items():
        for k, v in r['cells'].items():
            print(f"| {k} | {v['firstPickableMed']} | {v['firstPickMed']} | {v['brokenMed']} | {v['wallStepsMean']:.2f} | {v['lostOptionsMean']:.2f} | {pk} |")
    print(f"- 开前可点 {list(d['results'].values())[0]['opening']}；前10步均可用 {list(d['results'].values())[0]['meanAvailFirst10']:.2f} / {list(d['results'].values())[1]['meanAvailFirst10']:.2f}")
