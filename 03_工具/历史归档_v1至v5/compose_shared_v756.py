#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
目标图拼接器 v756（可控颜色共享）—— 用于「目标感 + 压力」实验
画法沿用 v721：20×20 格 = 1px 外框 + 18×18 主体；主体只取高频 2 色；背景 2 色棋盘（2px）。
差别：颜色按 --share 分三档共享，共享越多 → 同一颜色跨象限越多 → 越可能出现"跨区凑不满"。

用法：python3 compose_shared_v756.py --share high|mid|low --out x.txt --png y.png
"""
import argparse, collections, os, re
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SPR = os.path.join(ROOT, '蚂蚁图库/拼接图/主体图纸库_50张')

SUBJECTS = ['三角饭团-1.txt', '单块披萨-1.txt', '草莓-1.txt', '煎蛋-1.txt']
CANVAS, CELL = 40, 20
BG_BLOCK = 2

SCHEMES = {
    # 名称: (背景2色, 外框色列表(4个), 主体色列表(4个), 点缀色列表(4个))
    'high': ([33, 31], [2, 2, 2, 2], [1, 1, 13, 13], [25, 20, 25, 20]),   # 7 色
    'mid':  ([32, 31], [2, 13, 2, 13], [1, 1, 13, 13], [25, 20, 25, 20]),  # 9 色
    'low':  ([33, 32], [1, 13, 30, 20], [26, 25, 28, 29], [19, 24, 14, 3]),# 14 色
}

def load(p):
    lines = [l for l in open(p, encoding='utf-8').read().strip().splitlines() if l.strip()]
    if lines and lines[0].startswith('像素'):
        lines = lines[1:]
    return [[int(x) for x in l.split()] for l in lines]

def compose(share, subj=18, keep=False, pal_n=16, stride=2):
    bg, frames, bodies, accents = SCHEMES[share]
    canvas = [[bg[((y // BG_BLOCK) + (x // BG_BLOCK)) % 2] for x in range(CANVAS)] for y in range(CANVAS)]
    cells = [(0, 0), (0, CELL), (CELL, 0), (CELL, CELL)]
    for i, ((oy, ox), name) in enumerate(zip(cells, SUBJECTS)):
        g = load(os.path.join(SPR, name))
        h, w = len(g), len(g[0])
        cnt = collections.Counter(v for row in g for v in row if v != 0)
        if keep:
            keys = [c for c, _ in cnt.most_common()]
            base = [1, 13, 26, 20, 25, 28, 30, 19, 24, 14, 3, 29, 16, 34, 27, 21]
            mapping = {k: base[(i * stride + j) % pal_n] for j, k in enumerate(keys)}
        else:
            top2 = [c for c, _ in cnt.most_common(2)]
            mapping = {top2[0]: bodies[i]}
            if len(top2) > 1:
                mapping[top2[1]] = accents[i]
        frame = frames[i]
        for y in range(CELL):
            for x in range(CELL):
                if y in (0, CELL - 1) or x in (0, CELL - 1):
                    canvas[oy + y][ox + x] = frame
        off = (CELL - 2 - subj) // 2
        for y in range(subj):
            for x in range(subj):
                sy = min(h - 1, int(y * h / subj))
                sx = min(w - 1, int(x * w / subj))
                v = g[sy][sx]
                if v != 0:
                    canvas[oy + 1 + off + y][ox + 1 + off + x] = mapping.get(v, bodies[i])
    return canvas

def write_txt(canvas, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write('像素矩阵\n')
        for row in canvas:
            f.write(' '.join(str(v) for v in row) + '\n')

def write_png(canvas, path, scale=12):
    src = open(os.path.join(ROOT, '02_工程/游戏主bin/bin/js/color-libs.js'), encoding='utf-8').read()
    seg = src.split('CL.OLDER = {')[1].split('};')[0]
    hexes = ['#000000'] + re.findall(r"hex:\s*'(#[0-9A-Fa-f]{6})'", seg)
    pal = [tuple(int(h[i:i+2], 16) for i in (1, 3, 5)) for h in hexes]
    W = len(canvas)
    img = Image.new('RGB', (W * scale, W * scale))
    px = img.load()
    for y in range(W):
        for x in range(W):
            c = pal[canvas[y][x]] if canvas[y][x] < len(pal) else (0, 0, 0)
            for dy in range(scale):
                for dx in range(scale):
                    px[x * scale + dx, y * scale + dy] = c
    img.save(path)

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--share', default='high', choices=list(SCHEMES))
    ap.add_argument('--out', default='')
    ap.add_argument('--png', default='')
    ap.add_argument('--subj', type=int, default=18)
    ap.add_argument('--keep', action='store_true')
    ap.add_argument('--pal', type=int, default=16)
    ap.add_argument('--stride', type=int, default=2)
    a = ap.parse_args()
    out = a.out or os.path.join(ROOT, '实验关/目标图_拼接/拼接_共享_%s_s%d_40x40.txt' % (a.share, a.subj))
    png = a.png or os.path.join(ROOT, '实验关/renders/拼接_共享_%s_s%d.png' % (a.share, a.subj))
    cv = compose(a.share, a.subj, a.keep, a.pal, a.stride)
    write_txt(cv, out); write_png(cv, png)
    cnt = collections.Counter(v for row in cv for v in row)
    print('%s: 颜色数=%d 像素=%d' % (a.share, len(cnt), sum(cnt.values())))
    print('  色号:', ','.join(str(k) for k in sorted(cnt)))
    print('  →', out)
