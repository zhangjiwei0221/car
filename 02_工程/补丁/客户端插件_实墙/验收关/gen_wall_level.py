#!/usr/bin/env python3
"""生成「三面墙」验收关：N×N，顶/底行、左/右列、中间各一色。"""
import json, sys
from collections import Counter
TOP, LEFT, RIGHT, BOT, MID = 1, 13, 22, 25, 9      # 红 蓝 绿 橙黄 紫
NAME = {1:"红",13:"蓝",22:"绿",25:"橙黄",9:"紫"}

def build(n, max_cap=160):
    g = [[MID]*n for _ in range(n)]
    for c in range(n): g[0][c] = TOP
    for c in range(n): g[n-1][c] = BOT
    for r in range(1, n-1):
        g[r][0] = LEFT; g[r][n-1] = RIGHT
    cnt = Counter(x for row in g for x in row)
    # 每色拆成若干辆车，单车容量 <= max_cap
    def split(c):
        k = (cnt[c] + max_cap - 1)//max_cap
        base = cnt[c]//k; extra = cnt[c] - base*k
        return [base+1]*extra + [base]*(k-extra)
    cars = []
    for c in (TOP, LEFT, RIGHT, BOT, MID):
        for v in split(c): cars.append({"id": c, "type": 0, "param": 0, "count": v})
    # 车池网格 6×8 = 48
    R, C = 6, 8
    empty = {"id":-1,"type":0,"param":0,"count":0}
    spools = []
    for r in range(R):
        row = []
        for c in range(C):
            i = r*C + c
            row.append(cars[i] if i < len(cars) else empty)
        spools.append(row)
    d = {"toprow": n, "blocks": g, "maprow": R, "mapcol": C, "spools": spools}
    return d, cnt, cars

if __name__ == "__main__":
    for n in (int(x) for x in sys.argv[1:] or ["10"]):
        d, cnt, cars = build(n)
        p = f"关卡_实墙_三面墙{n}x{n}.json"
        open(p, "w", encoding="utf-8").write(json.dumps(d, ensure_ascii=False, separators=(",", ":")))
        summary = ", ".join(f"{NAME[k]}={v}" for k, v in sorted(cnt.items()))
        print(f"{p}: {n}x{n} 共{sum(cnt.values())}格  {summary}  车数={len(cars)}")
