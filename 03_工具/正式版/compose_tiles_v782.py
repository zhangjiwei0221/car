#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
拼接 v782 —— 「官方式 2×2 四格底板」（按 关卡/ 216 关的统计结果做）

结构（从官方关里量出来的）：
  画布 = 2×2 四格，每格 19–20 格
  每格 = 边框(1–2px，四边常不同色) + 底色(纯色/横条/竖条/格纹) 
  四格底色互不相同，边框色也基本不同

用法：
  python3 compose_tiles_v782.py --size 38 --pattern solid --seed 1 --tag 底板_纯色
  python3 compose_tiles_v782.py --size 38 --pattern stripe --seed 2 --tag 底板_条纹
  python3 compose_tiles_v782.py --size 38 --pattern check --seed 3 --tag 底板_格纹
"""
import argparse, collections, os, random, re
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))


def palette():
    src = open(os.path.join(ROOT, '02_工程/游戏主bin/bin/js/color-libs.js'), encoding='utf-8').read()
    seg = src.split('colors: [')[1].split('],')[0]
    hexes = ['#000000'] + re.findall(r"hex:\s*'(#[0-9A-Fa-f]{6})'", seg)
    return [tuple(int(h[i:i + 2], 16) for i in (1, 3, 5)) for h in hexes]


# 老色库高饱和色（边框/底色都用这批，1–34）
HOT = list(range(1, 31))          # 老色库 1-30（高饱和）；31 米白 / 32 浅黄 / 33 黑 / 34 灰都不用


def fill_panel(q, color, pattern, color2, rnd):
    h, w = len(q), len(q[0])
    for y in range(h):
        for x in range(w):
            q[y][x] = color
    if pattern == 'hstripe':
        period = rnd.choice([2, 2, 3])
        for y in range(h):
            if (y // period) % 2 == 1:
                for x in range(w):
                    q[y][x] = color2
    elif pattern == 'vstripe':
        period = rnd.choice([2, 2, 3])
        for x in range(w):
            if (x // period) % 2 == 1:
                for y in range(h):
                    q[y][x] = color2
    elif pattern == 'check':
        period = rnd.choice([2, 3, 4])
        for y in range(h):
            for x in range(w):
                if ((y // period) + (x // period)) % 2 == 1:
                    q[y][x] = color2


def frame_panel(q, top, right, bottom, left, thick):
    h, w = len(q), len(q[0])
    for t in range(thick):
        for x in range(w):
            q[t][x] = top
            q[h - 1 - t][x] = bottom
        for y in range(h):
            q[y][t] = left
            q[y][w - 1 - t] = right


def build(size, pattern, seed, thick=1):
    rnd = random.Random(seed)
    cv = [[0] * size for _ in range(size)]
    base = size // 2
    for (oy, ox) in [(0, 0), (0, base), (base, 0), (base, base)]:
        h = min(base, size - oy)
        w = min(base, size - ox)
        q = [[0] * w for _ in range(h)]
        c1 = rnd.choice(HOT)
        c2 = rnd.choice([c for c in HOT if c != c1])
        fill_panel(q, c1, pattern, c2, rnd)
        b = [rnd.choice([c for c in HOT if c not in (c1, c2)]) for _ in range(4)]
        frame_panel(q, b[0], b[1], b[2], b[3], thick)
        for y in range(h):
            for x in range(w):
                cv[oy + y][ox + x] = q[y][x]
    return cv


def write_txt(cv, p):
    os.makedirs(os.path.dirname(p) or '.', exist_ok=True)
    with open(p, 'w', encoding='utf-8') as f:
        f.write('像素矩阵\n')
        for r in cv:
            f.write(' '.join(map(str, r)) + '\n')


def write_png(cv, p, pal, s=16):
    n = len(cv)
    img = Image.new('RGB', (n * s, n * s))
    px = img.load()
    for y in range(n):
        for x in range(n):
            v = cv[y][x]
            c = pal[v] if v < len(pal) else (255, 0, 255)
            for dy in range(s):
                for dx in range(s):
                    px[x * s + dx, y * s + dy] = c
    img.save(p)


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--size', type=int, default=38)
    ap.add_argument('--pattern', default='solid', choices=['solid', 'hstripe', 'vstripe', 'check'])
    ap.add_argument('--seed', type=int, default=1)
    ap.add_argument('--thick', type=int, default=1)
    ap.add_argument('--tag', default='底板_纯色')
    a = ap.parse_args()
    cv = build(a.size, a.pattern, a.seed, a.thick)
    out = os.path.join(ROOT, '实验关/目标图_拼接/%s.txt' % a.tag)
    png = os.path.join(ROOT, '实验关/renders/%s.png' % a.tag)
    write_txt(cv, out)
    write_png(cv, png, palette())
    print('%dx%d | %s | 色数 %d' % (a.size, a.size, a.pattern, len({v for r in cv for v in r})))
    print('  →', out, '\n  预览:', png)
