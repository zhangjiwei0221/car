#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
目标图拼接器 v757 —— 保留主体原始颜色（不换色），背景用柔和色
画法：40×40，四个 20×20 象限；每象限 1px 外框 + 18×18 主体（原始色号直贴）；
      主体为 0 的地方露出背景（2px 棋盘 / 柔和两色）。

用法：
  python3 compose_raw_v757.py --subjects 三角饭团-1,草莓-1,煎蛋-1,单块披萨-1 \
      --bg 31,32 --frame 13,25,20,1 --out x.txt --png y.png
"""
import argparse, collections, os, re
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SPR = os.path.join(ROOT, '蚂蚁图库/拼接图/主体图纸库_50张')
CANVAS, CELL = 40, 20

def load(p):
    lines = [l for l in open(p, encoding='utf-8').read().strip().splitlines() if l.strip()]
    if lines and lines[0].startswith('像素'):
        lines = lines[1:]
    return [[int(x) for x in l.split()] for l in lines]

def compose(subjects, bg, frames, subj=18, block=2):
    canvas = [[bg[((y // block) + (x // block)) % 2] for x in range(CANVAS)] for y in range(CANVAS)]
    cells = [(0, 0), (0, CELL), (CELL, 0), (CELL, CELL)]
    for i, ((oy, ox), name) in enumerate(zip(cells, subjects)):
        g = load(os.path.join(SPR, name if name.endswith('.txt') else name + '.txt'))
        h, w = len(g), len(g[0])
        frame = frames[i % len(frames)]
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
                if v != 0:                      # 保留原始色号
                    canvas[oy + 1 + off + y][ox + 1 + off + x] = v
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
            v = canvas[y][x]
            c = pal[v] if v < len(pal) else (0, 0, 0)
            for dy in range(scale):
                for dx in range(scale):
                    px[x * scale + dx, y * scale + dy] = c
    img.save(path)

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--subjects', default='三角饭团-1,草莓-1,煎蛋-1,单块披萨-1')
    ap.add_argument('--bg', default='31,32')
    ap.add_argument('--frame', default='13,25,20,1')
    ap.add_argument('--subj', type=int, default=18)
    ap.add_argument('--order', default='tl,tr,bl,br', help='主体放到哪个象限：tl,tr,bl,br 顺序对应 --subjects')
    ap.add_argument('--out', default='')
    ap.add_argument('--png', default='')
    a = ap.parse_args()
    subs = [s.strip() for s in a.subjects.split(',')]
    bg = [int(x) for x in a.bg.split(',')]
    fr = [int(x) for x in a.frame.split(',')]
    # 按 --order 把主体摆到指定象限：tl/tr/bl/br
    slot = {'tl': 0, 'tr': 1, 'bl': 2, 'br': 3}
    order = [slot[x.strip()] for x in a.order.split(',')]
    placed = [None] * 4
    for i, q in enumerate(order):
        if i < len(subs):
            placed[q] = subs[i]
    placed = [p if p else subs[i % len(subs)] for i, p in enumerate(placed)]
    cv = compose(placed, bg, fr, a.subj)
    out = a.out or os.path.join(ROOT, '实验关/目标图_拼接/拼接_原始色_40x40.txt')
    png = a.png or os.path.join(ROOT, '实验关/renders/拼接_原始色.png')
    write_txt(cv, out); write_png(cv, png)
    cnt = collections.Counter(v for row in cv for v in row)
    print('色数=%d 像素=%d' % (len(cnt), sum(cnt.values())))
    print('色号:', ','.join(str(k) for k in sorted(cnt)))
    print('→', out)
