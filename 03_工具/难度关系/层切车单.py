#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""层切车单原型 v2：按（依赖层 × 颜色）切车，小层并入同色最大层，输出 (色,容量,层,τ)。
只读。用法：<py> 层切车单.py <关卡json> [--tiered]
  --tiered  分层容量上限：层0=35，层1-3=50，层4+=70（默认统一 70）
"""
import json, sys, math, collections

f = sys.argv[1]
j = json.load(open(f, encoding='utf-8'))
B = j['blocks']; R = len(B); C = len(B[0])
DIRS = ((1,0),(-1,0),(0,1),(0,-1))
LO, HI = 25, 70
TIERED = '--tiered' in sys.argv

removed = [[False]*C for _ in range(R)]
total = sum(1 for r in range(R) for c in range(C) if B[r][c] > 0)
done = 0; layers = []
while done < total and len(layers) < 200:
    exp = []
    for r in range(R):
        for c in range(C):
            if B[r][c] <= 0 or removed[r][c]: continue
            if r == 0 or r == R-1 or c == 0 or c == C-1: exp.append((r,c)); continue
            for dx,dy in DIRS:
                nx,ny = r+dx,c+dy
                if 0<=nx<R and 0<=ny<C and removed[nx][ny]: exp.append((r,c)); break
    if not exp: break
    cnt = collections.Counter()
    for (r,c) in exp:
        if removed[r][c]: continue
        col = B[r][c]; q=[(r,c)]; removed[r][c]=True; n=0
        while q:
            x,y=q.pop(); n+=1
            for dx,dy in DIRS:
                nx,ny=x+dx,y+dy
                if 0<=nx<R and 0<=ny<C and not removed[nx][ny] and B[nx][ny]==col:
                    removed[nx][ny]=True; q.append((nx,ny))
        cnt[col]+=n; done+=n
    layers.append(cnt)

# ---- 小层并入同色最大层 ----
per_color = collections.defaultdict(dict)
for li, L in enumerate(layers):
    for col, px in L.items(): per_color[col][li] = px
final = [collections.Counter() for _ in layers]
for col, d in per_color.items():
    big = {l:p for l,p in d.items() if p >= LO}
    small = {l:p for l,p in d.items() if p < LO}
    if not big:
        final[max(d, key=d.get)][col] += sum(d.values())
        continue
    tgt = max(big, key=big.get)
    for l,p in big.items(): final[l][col] += p
    for l,p in small.items(): final[tgt][col] += p

# ---- 每层累计（用于 τ）----
layer_px = [sum(L.values()) for L in final]
cum_before = [0]
for x in layer_px: cum_before.append(cum_before[-1]+x)

def cap_of(layer):
    if not TIERED: return HI
    if layer <= 0: return 35
    if layer <= 3: return 50
    return 70

cars = []
for li, L in enumerate(final):
    cap = cap_of(li)
    for col, px in sorted(L.items(), key=lambda x:-x[1]):
        n = max(1, math.ceil(px / cap))
        while n > 1 and px/n < LO: n -= 1
        base = px // n; rest = px - base*n
        off = 0
        for k in range(n):
            c = base + (1 if k < rest else 0)
            off += c
            tau = (cum_before[li] + off) / total
            cars.append({'color': col, 'count': c, 'layer': li, 'tau': round(tau, 3)})

print('文件:', f.split('/')[-1], '  层数:', len(final), '  切法:', ('分层上限 35/50/70' if TIERED else '统一上限 70'))
print('车数:', len(cars), '  总像素:', sum(c['count'] for c in cars), '(应=', total, ')')
print()
print('  层  像素  车数  容量范围     τ范围')
for li, L in enumerate(final):
    cs = [c for c in cars if c['layer'] == li]
    if not cs: continue
    caps=[c['count'] for c in cs]; taus=[c['tau'] for c in cs]
    print('  %2d  %4d  %3d   %3d~%-3d      %.2f~%.2f' % (li, sum(L.values()), len(cs), min(caps), max(caps), min(taus), max(taus)))
taus = sorted(c['tau'] for c in cars); caps = sorted(c['count'] for c in cars)
q = lambda a,p: a[min(len(a)-1,int(p*len(a)))]
print()
print('τ 分位: p10=%.2f p25=%.2f p50=%.2f p75=%.2f p90=%.2f' % (q(taus,.1),q(taus,.25),q(taus,.5),q(taus,.75),q(taus,.9)))
print('容量分位: p10=%d p25=%d p50=%d p75=%d p90=%d' % (q(caps,.1),q(caps,.25),q(caps,.5),q(caps,.75),q(caps,.9)))
print('容量<25 的车:', sum(1 for c in caps if c < LO), '/', len(caps))
bins=[0]*10
for t in taus: bins[min(9,int(t*10))]+=1
print('τ 直方(每0.1):', ' '.join(str(x) for x in bins))
