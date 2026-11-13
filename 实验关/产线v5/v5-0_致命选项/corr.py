# v5-0：致命选项指标 × 分组2 线上（②列）相关性。用法：python3 corr.py
import json, csv, math, glob, os
D = os.path.dirname(os.path.abspath(__file__))
CSV = os.path.join(D, '../../../测试版本/2026_11_05/分组2-20261110-新指标.csv')
r = [x for x in csv.reader(open(CSV, encoding='utf-8-sig')) if x and x[0].strip()]
ix = {k: i for i, k in enumerate(r[0])}
on = {}
for row in r[1:]:
    try:
        L = int(row[0]); n = float(row[ix['进入人数②']])
        on[L] = dict(n=n, fail=float(row[ix['失败率②']].rstrip('%')), churn=float(row[ix['关流失②']].rstrip('%')), tries=float(row[ix['次数②']]))
    except Exception:
        pass
lv = {}
for f in glob.glob(os.path.join(D, 'L*_w8.json')):
    s = json.load(open(f))['summary']; L = int(os.path.basename(f)[1:].split('_')[0]); lv[L] = s
def corr(a, b):
    n = len(a); ma = sum(a)/n; mb = sum(b)/n
    da = math.sqrt(sum((x-ma)**2 for x in a)); db = math.sqrt(sum((y-mb)**2 for y in b))
    return float('nan') if da == 0 or db == 0 else sum((x-ma)*(y-mb) for x, y in zip(a, b))/(da*db)
def rk(v):
    o = sorted(range(len(v)), key=lambda i: v[i]); rr = [0]*len(v)
    i = 0
    while i < len(o):
        j = i
        while j+1 < len(o) and v[o[j+1]] == v[o[i]]: j += 1
        for k in range(i, j+1): rr[o[k]] = (i+j)/2
        i = j+1
    return rr
import sys
MINN = float(sys.argv[1]) if len(sys.argv) > 1 else 0
Ls = sorted(L for L in lv if L in on and on[L]["n"] >= MINN)
keys = ['fatalShare', 'hiddenShare', 'fatalHidden', 'stepsWithFatal', 'stepsWithHidden', 'baitSteps', 'baitHidden', 'onlyOneSafeSteps', 'pressureSteps', 'pressureFatalShare', 'firstHiddenStep']
print('关 进入 失败% 流失% | ' + ' '.join(keys))
for L in Ls:
    s = lv[L]; o = on[L]
    print(L, int(o['n']), o['fail'], o['churn'], '|', ' '.join(str(s.get(k)) for k in keys), '(doomed)' if s['doomed'] else '')
for target in ('fail', 'churn'):
    print(f'\n== vs {target}（n={len(Ls)}，Spearman / Pearson）')
    for k in keys:
        xs = [lv[L].get(k) if lv[L].get(k) is not None else 99 for L in Ls]; ys = [on[L][target] for L in Ls]
        print(f'  {k:20s} rho={corr(rk(xs), rk(ys)):+.2f}  r={corr(xs, ys):+.2f}')
