#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
两侧量化回归：目标区需求特征 + 棋盘区结构特征 → band3Pct
只读。
用法：<bundled python3> 两侧量化_回归.py [--v2]
  --v2 额外加入目标区需求曲线特征（洋葱剥皮）
"""
import json, glob, os, sys, collections
import numpy as np
import pandas as pd

ROOT = "/Users/red/Desktop/毛线汽车/02_工程/完整主bin快照_20261012/输出文件"
V2 = "--v2" in sys.argv
DIRS = ((1,0),(-1,0),(0,1),(0,-1))

def exposed_by_color(blocks):
    R = len(blocks); C = len(blocks[0]); seen = [[False]*C for _ in range(R)]
    out = collections.Counter()
    for r in range(R):
        for c in range(C):
            if blocks[r][c] <= 0 or seen[r][c]: continue
            if not (r == 0 or r == R-1 or c == 0 or c == C-1): continue
            col = blocks[r][c]; q = [(r,c)]; seen[r][c] = True; n = 0
            while q:
                x, y = q.pop(); n += 1
                for dx, dy in DIRS:
                    nx, ny = x+dx, y+dy
                    if 0 <= nx < R and 0 <= ny < C and not seen[nx][ny] and blocks[nx][ny] == col:
                        seen[nx][ny] = True; q.append((nx,ny))
            out[col] += n
    return out

def ring_counts(blocks):
    R = len(blocks); C = len(blocks[0]); out = collections.Counter()
    for c in range(C):
        for r in (0, R-1):
            if blocks[r][c] > 0: out[blocks[r][c]] += 1
    for r in range(R):
        for c in (0, C-1):
            if blocks[r][c] > 0: out[blocks[r][c]] += 1
    return out

def onion_layers(blocks):
    """洋葱剥皮：每轮剥掉所有暴露的同色连通块，返回每轮 Counter(color->px)。"""
    R = len(blocks); C = len(blocks[0])
    removed = [[False]*C for _ in range(R)]
    total = sum(1 for r in range(R) for c in range(C) if blocks[r][c] > 0)
    done = 0; layers = []
    while done < total and len(layers) < 200:
        exposed = []
        for r in range(R):
            for c in range(C):
                if blocks[r][c] <= 0 or removed[r][c]: continue
                if r == 0 or r == R-1 or c == 0 or c == C-1: exposed.append((r,c)); continue
                for dx, dy in DIRS:
                    nx, ny = r+dx, c+dy
                    if 0 <= nx < R and 0 <= ny < C and removed[nx][ny]:
                        exposed.append((r,c)); break
        if not exposed: break
        cnt = collections.Counter()
        for (r,c) in exposed:
            if removed[r][c]: continue
            col = blocks[r][c]; q = [(r,c)]; removed[r][c] = True; n = 0
            while q:
                x, y = q.pop(); n += 1
                for dx, dy in DIRS:
                    nx, ny = x+dx, y+dy
                    if 0 <= nx < R and 0 <= ny < C and not removed[nx][ny] and blocks[nx][ny] == col:
                        removed[nx][ny] = True; q.append((nx,ny))
            cnt[col] += n; done += n
        layers.append(cnt)
    return layers

def demand_feats(blocks):
    layers = onion_layers(blocks)
    if not layers: return {}
    sizes = [sum(c.values()) for c in layers]
    tot = sum(sizes) or 1
    p = np.array(sizes, float) / tot
    ent = float(-(p * np.log(p + 1e-12)).sum())
    peak = int(np.argmax(sizes))
    late = sum(sizes[-max(1, len(sizes)//3):]) / tot
    color_span = collections.Counter()
    for L in layers:
        for col in L: color_span[col] += 1
    spans = list(color_span.values())
    return {
        "onionRounds": len(layers),
        "onionPeakPos": peak / max(1, len(layers)-1),
        "onionFirst": sizes[0] / tot,
        "onionLate": late,
        "onionEntropy": ent,
        "onionMaxShare": max(sizes) / tot,
        "colorSpanAvg": float(np.mean(spans)),
        "colorSpanMax": max(spans),
        "colorSpanCV": float(np.std(spans)/max(1e-9, np.mean(spans))),
    }

def board_feats(j):
    b = j["board"]; cells = b["cells"]; rows, cols = b["rows"], b["cols"]
    blocks = j["blocks"]
    D0 = exposed_by_color(blocks); ring = ring_counts(blocks)
    cars = []; black = pipe = 0; ice_cars = ice_steps = chain_cells = 0; row0 = []
    for r in range(rows):
        for c in range(cols):
            cell = cells[r][c]; t = cell.get("t")
            if t == "black": black += 1
            elif t == "pipe":
                pipe += 1
                for k, q in enumerate(cell.get("queue") or []):
                    cars.append((r + 0.5 + 0.1*k, q["color"], q["count"], "pipe"))
            elif t == "box":
                cars.append((r, cell["color"], cell["count"], "box"))
                if cell.get("numice", 0) > 0: ice_cars += 1; ice_steps += cell["numice"]
                if cell.get("chain", 0) > 0: chain_cells += 1
                if r == 0: row0.append(cell)
    n = len(cars); tot_cap = sum(x[2] for x in cars) or 1
    caps = [x[2] for x in cars]
    deep = sum(x[2] for x in cars if ring.get(x[1], 0) == 0)
    col_rows = collections.defaultdict(list)
    for x in cars: col_rows[x[1]].append(x[0])
    centers = [float(np.mean(v)) for v in col_rows.values()]
    return {
        "rows": rows, "cols": cols, "cells": rows*cols, "nCars": n,
        "fill": n/(rows*cols), "black": black, "pipe": pipe,
        "row0N": len(row0),
        "row0Deep": sum(1 for c in row0 if ring.get(c["color"], 0) == 0),
        "row0Mis": sum(1 for c in row0 if c["count"] > D0.get(c["color"], 0)),
        "freeRow0": sum(1 for c in row0 if c["count"] <= ring.get(c["color"], 0)),
        "pipeCars": sum(1 for x in cars if x[3] == "pipe"),
        "iceCars": ice_cars, "iceSteps": ice_steps, "chainCells": chain_cells,
        "capMean": float(np.mean(caps)), "capCV": float(np.std(caps)/max(1, np.mean(caps))),
        "supplyCenter": sum(x[0]*x[2] for x in cars)/tot_cap,
        "deepCapShare": deep/tot_cap,
        "colorCount": len(col_rows), "carsPerColor": n/max(1, len(col_rows)),
        "centerSpread": float(np.std(centers)) if len(centers) > 1 else 0.0,
        "centerRange": float(max(centers)-min(centers)) if len(centers) > 1 else 0.0,
    }

rows_out = []
for d in sorted(glob.glob(os.path.join(ROOT, "unnamed-*"))):
    for f in glob.glob(os.path.join(d, "生产文档", "关卡数据", "*.json")):
        try: j = json.load(open(f, encoding="utf-8"))
        except Exception: continue
        gv = (j.get("generationEval") or {}).get("goodV3") or {}
        b3 = (gv.get("persist") or {}).get("band3Pct")
        if b3 is None: continue
        try:
            ft = board_feats(j)
            if V2: ft.update(demand_feats(j["blocks"]))
        except Exception as e:
            continue
        ft.update({"band3": b3, "figure": os.path.basename(f).replace(".json",""),
                   "batch": os.path.basename(d), "mid": gv.get("midLateMax")})
        rows_out.append(ft)

df = pd.DataFrame(rows_out)
FEATS = ["row0Mis","row0Deep","freeRow0","supplyCenter","deepCapShare","capCV","centerSpread","centerRange",
         "pipeCars","iceCars","chainCells","black","fill","carsPerColor","nCars","colorCount"]
if V2: FEATS += ["onionRounds","onionPeakPos","onionFirst","onionLate","onionEntropy","onionMaxShare",
                 "colorSpanAvg","colorSpanMax","colorSpanCV"]

def spear(a,b):
    sa, sb = pd.Series(a), pd.Series(b)
    if sa.nunique() < 3 or sb.nunique() < 3: return np.nan
    return sa.rank().corr(sb.rank())
def perm_p(a,b,B=3000,seed=7):
    r0 = spear(a,b)
    if not np.isfinite(r0): return np.nan
    rng = np.random.default_rng(seed); b=np.asarray(b); c=0
    for _ in range(B):
        if abs(spear(a, rng.permutation(b))) >= abs(r0): c+=1
    return (c+1)/(B+1)
def ols(sub, feats, label):
    X = sub[feats].values.astype(float); y = sub.band3.values.astype(float)
    ok = np.isfinite(X).all(1) & np.isfinite(y)
    X, y = X[ok], y[ok]; n = len(y)
    if n < len(feats)+5: print("  %-24s 样本不足" % label); return None
    X = (X - X.mean(0))/(X.std(0)+1e-12)
    X1 = np.column_stack([np.ones(n), X])
    beta,*_ = np.linalg.lstsq(X1, y, rcond=None)
    pred = X1@beta
    r2 = 1-((y-pred)**2).sum()/((y-y.mean())**2).sum()
    loo = []
    for i in range(n):
        m = np.ones(n, bool); m[i]=False
        bb,*_ = np.linalg.lstsq(X1[m], y[m], rcond=None)
        loo.append(y[i]-X1[i]@bb)
    loo = np.array(loo); r2loo = 1-(loo**2).sum()/((y-y.mean())**2).sum()
    print("  %-24s n=%2d  R2=%.3f  LOO-R2=%+.3f  | %s" % (label, n, r2, r2loo,
          " ".join("%s=%+.1f" % (f, b) for f,b in zip(feats, beta[1:]))))
    return r2loo

print("样本 %d，图 %d，V2=%s" % (len(df), df.figure.nunique(), V2))
print(df.groupby("figure").band3.agg(["count","mean","std"]).round(1).head(8).to_string())
print()
tab = []
for f in FEATS:
    r = spear(df[f], df.band3); p = perm_p(df[f], df.band3)
    tab.append((f, r, p))
print("== 全样本 Spearman（n=%d，只列 |r| 前 12）==" % len(df))
for f,r,p in sorted(tab, key=lambda x: -abs(x[1]) if np.isfinite(x[1]) else 0)[:12]:
    print("  %-14s r=%+.3f  p=%.4f %s" % (f, r, p, "***" if p<0.01 else ("**" if p<0.05 else ("*" if p<0.1 else ""))))

print()
print("== 组内多变量（图 = 固定效应）==")
for fig in ["35x35拼接图纸_006", "40x40拼接图纸_016"]:
    sub = df[df.figure == fig]
    if len(sub) < 15: continue
    print(" [" + fig + " n=%d sd=%.1f]" % (len(sub), sub.band3.std()))
    ols(sub, ["iceCars","supplyCenter","carsPerColor"], "结构 TOP3")
    if V2:
        ols(sub, ["iceCars","supplyCenter","carsPerColor","onionLate","onionPeakPos","colorSpanCV"], "结构+需求 6")
        ols(sub, ["onionLate","onionPeakPos","onionEntropy","colorSpanCV","onionMaxShare"], "仅需求 5")
    else:
        ols(sub, ["iceCars","supplyCenter","carsPerColor","row0Mis","deepCapShare"], "结构 TOP5")

if V2:
    print()
    print("== 合并固定效应回归（组内去均值）==")
    sub = df[df.figure.isin(["35x35拼接图纸_006","40x40拼接图纸_016"])].copy()
    sub["y"] = sub.groupby("figure").band3.transform(lambda s: s-s.mean())
    for f in FEATS:
        sub["z_"+f] = sub.groupby("figure")[f].transform(lambda s: (s-s.mean())/(s.std()+1e-12))
    for feats in (["iceCars","supplyCenter","carsPerColor"],
                  ["iceCars","supplyCenter","carsPerColor","onionLate","onionPeakPos","colorSpanCV"]):
        X = np.column_stack([sub["z_"+f].values for f in feats])
        y = sub.y.values
        ok = np.isfinite(X).all(1)
        X, y = X[ok], y[ok]
        X1 = np.column_stack([np.ones(len(X)), X])
        beta,*_ = np.linalg.lstsq(X1, y, rcond=None)
        pred = X1@beta
        r2 = 1-((y-pred)**2).sum()/((y-y.mean())**2).sum()
        print("  within-R2=%.3f n=%d | %s" % (r2, len(y), " ".join("%s=%+.1f" % (f,b) for f,b in zip(feats,beta[1:]))))
