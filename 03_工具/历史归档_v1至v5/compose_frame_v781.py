#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
拼接 v781 —— 「绿底 + 蓝方块/蓝框」底（用户 2026-11-02 20:0x 那张）

从那张图量出来：
  底     亮绿 #95E504（34%）
  主纹样 浅蓝 #06ACF6（12%）：大块矩形，4x7 ~ 10x9，其中约一半是**空心框**（只画一圈边）
  点缀   米白（3%）：零散小条
  四个 18x18 主体贴四角

用法：
  python3 compose_frame_v781.py --seed 2 --subjects "小冰箱-1,电视-1,单人沙发-1,洗衣机-1" --tag 框_01
"""
import argparse, collections, glob, os, random, re
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
LIBS = sorted(glob.glob(os.path.join(ROOT, '拼接图/主体图纸库*')))
N = 35
GREEN, BLUE, CREAM = 19, 13, 31     # 亮绿 / 天蓝 / 米白


def load(p):
    lines = [l for l in open(p, encoding='utf-8').read().strip().splitlines() if l.strip()]
    if lines and lines[0].startswith('像素'):
        lines = lines[1:]
    return [[int(x) for x in l.split()] for l in lines]


def find_sprite(name):
    for d in LIBS:
        p = os.path.join(d, name + '.txt')
        if os.path.exists(p):
            return load(p)
    raise SystemExit('找不到主体：' + name)


def palette():
    src = open(os.path.join(ROOT, '02_工程/游戏主bin/bin/js/color-libs.js'), encoding='utf-8').read()
    seg = src.split('colors: [')[1].split('],')[0]
    hexes = ['#000000'] + re.findall(r"hex:\s*'(#[0-9A-Fa-f]{6})'", seg)
    return [tuple(int(h[i:i + 2], 16) for i in (1, 3, 5)) for h in hexes]


def in_subject(y, x):
    """四角 18x18 主体区（贴上去会盖住）"""
    return (y < 18 and x < 18) or (y < 18 and x >= 17) or (y >= 17 and x < 18) or (y >= 17 and x >= 17)


def draw_rect(cv, y0, x0, h, w, color, hollow):
    for y in range(y0, y0 + h):
        for x in range(x0, x0 + w):
            if not (0 <= y < N and 0 <= x < N):
                continue
            if hollow and 0 < y - y0 < h - 1 and 0 < x - x0 < w - 1:
                continue
            cv[y][x] = color


def frame_bg(seed, n_rect=7):
    rnd = random.Random(seed)
    cv = [[GREEN] * N for _ in range(N)]
    placed = []          # (y0,x0,h,w)
    tries = 0
    while len(placed) < n_rect and tries < 3000:
        tries += 1
        h = rnd.choice([3, 4, 5, 6, 7, 8, 9, 10])
        w = rnd.choice([3, 4, 5, 6, 7, 8, 9, 10])
        y0 = rnd.randint(0, N - h)
        x0 = rnd.randint(0, N - w)
        # 别全落在主体底下（至少 55% 露在外面）
        # 故意允许压在主体底下：主体盖住一部分，露出来的那截才是画面里的蓝块
        # 别和已放的框粘在一起（留 1 格缝）
        bad = False
        for (a, b, hh, ww) in placed:
            if not (y0 + h + 1 <= a or a + hh + 1 <= y0 or x0 + w + 1 <= b or b + ww + 1 <= x0):
                bad = True
                break
        if bad:
            continue
        hollow = rnd.random() < 0.5
        draw_rect(cv, y0, x0, h, w, BLUE, hollow)
        placed.append((y0, x0, h, w))
    # 米白零散小条
    for _ in range(rnd.randint(3, 6)):
        y, x = rnd.randrange(N), rnd.randrange(N)
        L = rnd.randint(1, 3)
        for k in range(L):
            if rnd.random() < 0.5 and 0 <= y + k < N:
                cv[y + k][x] = CREAM
            elif 0 <= x + k < N:
                cv[y][x + k] = CREAM
    return cv


def compose(names, seed):
    cv = frame_bg(seed)
    for nm, (oy, ox) in zip(names, [(0, 0), (0, 17), (17, 0), (17, 17)]):
        g = find_sprite(nm)
        for y in range(18):
            for x in range(18):
                if g[y][x] == 0:
                    continue
                cv[oy + y][ox + x] = g[y][x]
    return cv


def write_txt(cv, p):
    os.makedirs(os.path.dirname(p) or '.', exist_ok=True)
    with open(p, 'w', encoding='utf-8') as f:
        f.write('像素矩阵\n')
        for r in cv:
            f.write(' '.join(map(str, r)) + '\n')


def write_png(cv, p, pal, s=20):
    img = Image.new('RGB', (N * s, N * s))
    px = img.load()
    for y in range(N):
        for x in range(N):
            v = cv[y][x]
            c = pal[v] if v < len(pal) else (255, 0, 255)
            for dy in range(s):
                for dx in range(s):
                    px[x * s + dx, y * s + dy] = c
    img.save(p)


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--seed', type=int, default=1)
    ap.add_argument('--rects', type=int, default=7)
    ap.add_argument('--subjects', default='小冰箱-1,电视-1,单人沙发-1,洗衣机-1')
    ap.add_argument('--tag', default='框_01')
    ap.add_argument('--bg-only', action='store_true')
    a = ap.parse_args()
    names = [s.strip() for s in a.subjects.split(',') if s.strip()]
    cv = frame_bg(a.seed, a.rects) if a.bg_only else compose(names, a.seed)
    out = os.path.join(ROOT, '实验关/目标图_拼接/%s.txt' % a.tag)
    png = os.path.join(ROOT, '实验关/renders/%s.png' % a.tag)
    write_txt(cv, out)
    write_png(cv, png, palette())
    cnt = collections.Counter(v for r in cv for v in r)
    print('%dx%d | 色数 %d | %s' % (N, N, len(cnt), '纯底' if a.bg_only else '、'.join(names)))
    print('  →', out, '\n  预览:', png)
