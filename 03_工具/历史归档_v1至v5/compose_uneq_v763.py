#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
目标图拼接器 v763 —— 不等分象限
画布 40×40，按 --split x,y 切成四块**不等大**的区域：
   上左(x<X, y<Y)  上右(x≥X, y<Y)
   下左(x<X, y≥Y)  下右(x≥X, y≥Y)
每块：外框(--fw 像素) + 内部主体（按块尺寸缩放）。
用途：让"最后消的那块"更大，从而后段有内容（等分时每块只有 25%）。

用法：
  python3 compose_uneq_v763.py --split 14,20 --subjects 煎蛋-1,小猫杯子-1,草莓-1,炒饭-1 \
      --order bl,tl,br,tr --bg 31,32 --frame 9,13,15,26 --fw 2 --out x.txt --png y.png
"""
import argparse, collections, os, re
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SPR = os.path.join(ROOT, '蚂蚁图库/拼接图/主体图纸库_50张')
CANVAS = 40

def load(p):
    lines = [l for l in open(p, encoding='utf-8').read().strip().splitlines() if l.strip()]
    if lines and lines[0].startswith('像素'):
        lines = lines[1:]
    return [[int(x) for x in l.split()] for l in lines]

def compose(subjects, bg, frames, split, fw, block=2):
    X, Y = split
    rects = [
        (0, 0, Y, X),          # tl
        (X, 0, CANVAS, Y),     # tr
        (0, Y, X, CANVAS),     # bl
        (X, Y, CANVAS, CANVAS) # br
    ]
    canvas = [[bg[((y // block) + (x // block)) % 2] for x in range(CANVAS)] for y in range(CANVAS)]
    for i, ((x0, y0, x1, y1), name) in enumerate(zip(rects, subjects)):
        g = load(os.path.join(SPR, name if name.endswith('.txt') else name + '.txt'))
        h, w = len(g), len(g[0])
        frame = frames[i % len(frames)]
        for y in range(y0, y1):
            for x in range(x0, x1):
                if y < y0 + fw or y >= y1 - fw or x < x0 + fw or x >= x1 - fw:
                    canvas[y][x] = frame
        iw, ih = x1 - x0 - 2 * fw, y1 - y0 - 2 * fw
        for yy in range(ih):
            for xx in range(iw):
                sy = min(h - 1, int(yy * h / ih))
                sx = min(w - 1, int(xx * w / iw))
                v = g[sy][sx]
                if v != 0:
                    canvas[y0 + fw + yy][x0 + fw + xx] = v
    return canvas

def write_txt(cv, path):
    os.makedirs(os.path.dirname(path) or '.', exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write('像素矩阵\n')
        for row in cv:
            f.write(' '.join(str(v) for v in row) + '\n')

def write_png(cv, path, scale=12):
    src = open(os.path.join(ROOT, '02_工程/游戏主bin/bin/js/color-libs.js'), encoding='utf-8').read()
    seg = src.split('CL.OLDER = {')[1].split('};')[0]
    hexes = ['#000000'] + re.findall(r"hex:\s*'(#[0-9A-Fa-f]{6})'", seg)
    pal = [tuple(int(h[i:i+2], 16) for i in (1, 3, 5)) for h in hexes]
    W = len(cv)
    img = Image.new('RGB', (W * scale, W * scale))
    px = img.load()
    for y in range(W):
        for x in range(W):
            v = cv[y][x]
            c = pal[v] if v < len(pal) else (0, 0, 0)
            for dy in range(scale):
                for dx in range(scale):
                    px[x * scale + dx, y * scale + dy] = c
    img.save(path)

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--split', default='14,20')
    ap.add_argument('--subjects', default='煎蛋-1,小猫杯子-1,草莓-1,炒饭-1')
    ap.add_argument('--order', default='tl,tr,bl,br')
    ap.add_argument('--bg', default='31,32')
    ap.add_argument('--frame', default='9,13,15,26')
    ap.add_argument('--fw', type=int, default=2)
    ap.add_argument('--out', default='')
    ap.add_argument('--png', default='')
    a = ap.parse_args()
    X, Y = [int(v) for v in a.split.split(',')]
    subs = [s.strip() for s in a.subjects.split(',')]
    slot = {'tl': 0, 'tr': 1, 'bl': 2, 'br': 3}
    order = [slot[x.strip()] for x in a.order.split(',')]
    placed = [None] * 4
    for i, q in enumerate(order):
        placed[q] = subs[i] if i < len(subs) else subs[i % len(subs)]
    placed = [p or subs[i % len(subs)] for i, p in enumerate(placed)]
    cv = compose(placed, [int(x) for x in a.bg.split(',')], [int(x) for x in a.frame.split(',')], (X, Y), a.fw)
    out = a.out or os.path.join(ROOT, '实验关/目标图_拼接/拼接_不等分_%dx%d.txt' % (X, Y))
    png = a.png or os.path.join(ROOT, '实验关/renders/拼接_不等分_%dx%d.png' % (X, Y))
    write_txt(cv, out); write_png(cv, png)
    cnt = collections.Counter(v for row in cv for v in row)
    area = [(Y*X), ((CANVAS-X)*Y), (X*(CANVAS-Y)), ((CANVAS-X)*(CANVAS-Y))]
    print('色数=%d | 四块面积(上左/上右/下左/下右)=%s' % (len(cnt), '/'.join(str(v) for v in area)))
    print('→', out); print('  预览:', png)
