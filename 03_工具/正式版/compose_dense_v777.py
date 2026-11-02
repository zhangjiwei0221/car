#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
密集拼接 v777 —— 满画布：多色块背景 + 多个主体铺满

用户 2026-11-02：
  「背景不要一大片纯色；像参考图那样用不同色块拼背景，铺上一些主体；尺寸 30~40。」
  「挑有'包围色'的主体（一个颜色被另一个颜色围住）」

背景：把画布切成 N×N 的块，块与块之间交替用几种颜色（棋盘/条纹感），
      这样背景自身就是"很多小色块"，每种颜色都不成片 → 天然容易卡。
主体：从主体库挑（可按"包围度"排序），铺在画布上，尽量盖住。

用法：
  python3 compose_dense_v777.py --size 36 --blocks 6,32,34 --block-size 4 \
      --subjects "花-1@2,2;...;..." --scale 14 --out x.txt --png y.png
"""
import argparse, collections, os, random, re
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SPR = os.path.join(ROOT, '蚂蚁图库/拼接图/主体图纸库_50张')

def load(p):
    lines = [l for l in open(p, encoding='utf-8').read().strip().splitlines() if l.strip()]
    if lines and lines[0].startswith('像素'):
        lines = lines[1:]
    return [[int(x) for x in l.split()] for l in lines]

def make_patchwork(size, colors, seed, min_side=7, max_side=13):
    """拼布背景：用若干大色块矩形铺满，颜色多、块大、不规则"""
    rnd = random.Random(seed)
    cv = [[colors[0]] * size for _ in range(size)]
    covered = [[False] * size for _ in range(size)]
    tries = 0
    while tries < 4000:
        tries += 1
        w = rnd.randint(min_side, max_side); h = rnd.randint(min_side, max_side)
        y = rnd.randint(0, max(0, size - 1)); x = rnd.randint(0, max(0, size - 1))
        c = colors[rnd.randrange(len(colors))]
        for yy in range(y, min(size, y + h)):
            for xx in range(x, min(size, x + w)):
                cv[yy][xx] = c; covered[yy][xx] = True
        # 覆盖率够了就停
        unc = sum(row.count(False) for row in covered)
        if unc == 0: break
    return cv

def make_bg(size, colors, block, pattern, seed):
    rnd = random.Random(seed)
    if pattern == 'patchwork':
        return make_patchwork(size, colors, seed)
    cv = [[0] * size for _ in range(size)]
    for y in range(size):
        for x in range(size):
            bi, bj = y // block, x // block
            if pattern == 'grid':
                # 规律网格：(行*2 + 列) 取模，形成斜向重复的色带
                c = colors[(bi * 2 + bj) % len(colors)]
            elif pattern == 'checker':
                c = colors[(bi + bj) % len(colors)]
            elif pattern == 'stripe':
                c = colors[bi % len(colors)]
            elif pattern == 'vstripe':
                c = colors[bj % len(colors)]
            else:  # random
                rnd.seed(bi * 131 + bj * 17 + seed)
                c = colors[rnd.randrange(len(colors))]
            cv[y][x] = c
    return cv

def compose(size, bgcolors, block, pattern, subjects, seed=7):
    cv = make_bg(size, bgcolors, block, pattern, seed)
    for name, (oy, ox), scale in subjects:
        g = load(os.path.join(SPR, name if name.endswith('.txt') else name + '.txt'))
        h, w = len(g), len(g[0])
        for y in range(scale):
            for x in range(scale):
                sy = min(h - 1, int(y * h / scale)); sx = min(w - 1, int(x * w / scale))
                v = g[sy][sx]
                if v == 0: continue
                py, px = oy + y, ox + x
                if 0 <= py < size and 0 <= px < size:
                    cv[py][px] = v
    return cv

def write_txt(cv, path):
    os.makedirs(os.path.dirname(path) or '.', exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write('像素矩阵\n')
        for row in cv:
            f.write(' '.join(str(v) for v in row) + '\n')

def write_png(cv, path, scale=14):
    src = open(os.path.join(ROOT, '02_工程/游戏主bin/bin/js/color-libs.js'), encoding='utf-8').read()
    seg = src.split('colors: [')[1].split('],')[0]
    hexes = ['#000000'] + re.findall(r"hex:\s*'(#[0-9A-Fa-f]{6})'", seg)
    pal = [tuple(int(h[i:i+2], 16) for i in (1, 3, 5)) for h in hexes]
    W = len(cv); img = Image.new('RGB', (W * scale, W * scale)); px = img.load()
    for y in range(W):
        for x in range(W):
            v = cv[y][x]; c = pal[v] if v < len(pal) else (0, 0, 0)
            for dy in range(scale):
                for dx in range(scale):
                    px[x * scale + dx, y * scale + dy] = c
    img.save(path)

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--size', type=int, default=36)
    ap.add_argument('--blocks', default='6,32,34', help='背景用的色号，逗号分隔')
    ap.add_argument('--block-size', type=int, default=4)
    ap.add_argument('--pattern', default='patchwork', choices=['checker', 'stripe', 'vstripe', 'random', 'patchwork', 'grid'])
    ap.add_argument('--subjects', default='')
    ap.add_argument('--scale', type=int, default=14)
    ap.add_argument('--seed', type=int, default=7)
    ap.add_argument('--out', default='')
    ap.add_argument('--png', default='')
    a = ap.parse_args()
    subs = []
    for part in a.subjects.split(';'):
        part = part.strip()
        if not part: continue
        name, pos = part.split('@')
        y, x = [int(v) for v in pos.split(',')]
        subs.append((name.strip(), (y, x), a.scale))
    cv = compose(a.size, [int(x) for x in a.blocks.split(',')], a.block_size, a.pattern, subs, a.seed)
    out = a.out or os.path.join(ROOT, '实验关/目标图_拼接/密集_%dx%d.txt' % (a.size, a.size))
    png = a.png or os.path.join(ROOT, '实验关/renders/密集_%dx%d.png' % (a.size, a.size))
    write_txt(cv, out); write_png(cv, png)
    cnt = collections.Counter(v for row in cv for v in row)
    print('尺寸 %dx%d | 色数 %d' % (a.size, a.size, len(cnt)))
    print('  各色占比:', ', '.join('%d:%.0f%%' % (k, 100*v/(a.size*a.size)) for k, v in cnt.most_common(6)))
    print('  →', out); print('  预览:', png)
