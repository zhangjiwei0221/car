#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
拼接 v778 —— 多种主体 / 大小错落 / 允许轻微出血的拼图器

针对 v775/v777 的三个结构问题（2026-11-02 晚）：
  1) 永远是同一套 4 个主体摆成田字格，只换背景 → 11 版看起来是同一张图；
  2) 主体越界像素直接丢弃 → 被画布切边；
  3) 背景只有 2 色规则棋盘、占比 ~50% → 像"棋盘上贴了 4 张贴纸"。

规则：
  主体：从 50 张库里随机挑 N 个（按颜色重叠惩罚去重），每个独立缩放 10–18px，
        随机落位；允许压别人的角（前后遮挡），但要求"可辨认面积 ≥ 85%"（出画 ≤15%）。
  背景：2 色"砖块"（默认 4×5，逐行错位）—— 每个色块 20 格左右，同色只对角相接，
        天然碎成很多小岛（保留压力机制），但视觉上比整棋盘柔和。
  约束：色数 ≤ 18；主体覆盖 50–65%。

用法：
  python3 compose_v778.py --size 38 --n 6 --seed 3 --out a.txt --png a.png
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


def palette():
    src = open(os.path.join(ROOT, '02_工程/游戏主bin/bin/js/color-libs.js'), encoding='utf-8').read()
    seg = src.split('colors: [')[1].split('],')[0]
    hexes = ['#000000'] + re.findall(r"hex:\s*'(#[0-9A-Fa-f]{6})'", seg)
    return [tuple(int(h[i:i + 2], 16) for i in (1, 3, 5)) for h in hexes]


def brick_bg(size, cols, seed):
    """2 色砖块背景：4 高 × 5 宽，逐行错位 2 格 —— 同色只对角相接，碎成小岛。"""
    rnd = random.Random(seed)
    bh = rnd.choice([4, 5])
    bw = rnd.choice([4, 5, 6])
    a, b = cols
    cv = [[a] * size for _ in range(size)]
    for y in range(size):
        row = y // bh
        off = (row * 2) % (bw * 2)
        for x in range(size):
            k = ((x + off) // bw) % 2
            cv[y][x] = a if k == 0 else b
    # 10% 的格子做 1px 抖动，避免完全机械
    for _ in range(size * size // 10):
        y, x = rnd.randrange(size), rnd.randrange(size)
        cv[y][x] = b if cv[y][x] == a else a
    return cv


def sprite_colors(g):
    return set(v for row in g for v in row if v)


def pick_subjects(n, seed, max_colors=18):
    rnd = random.Random(seed)
    names = sorted(f[:-4] for f in os.listdir(SPR) if f.endswith('.txt'))
    rnd.shuffle(names)
    chosen, used = [], set()
    for nm in names:
        g = load(os.path.join(SPR, nm + '.txt'))
        cs = sprite_colors(g)
        if len(used | cs) > max_colors:
            continue
        # 颜色重叠太多（>60%）就跳过，保证主体之间颜色不同
        ov = len(cs & used) / max(1, len(cs))
        if ov > 0.6:
            continue
        chosen.append((nm, g))
        used |= cs
        if len(chosen) >= n:
            break
    return chosen


def fit(g, scale):
    """最近邻缩放（保持比例，18x18 库统一）"""
    h, w = len(g), len(g[0])
    out = []
    for y in range(scale):
        sy = min(h - 1, int(y * h / scale))
        out.append([g[sy][min(w - 1, int(x * w / scale))] for x in range(scale)])
    return out


def place(cv, spr, oy, ox, size):
    covered = 0
    for y, row in enumerate(spr):
        for x, v in enumerate(row):
            if v == 0:
                continue
            py, px = oy + y, ox + x
            if 0 <= py < size and 0 <= px < size:
                cv[py][px] = v
                covered += 1
    return covered


def overlap_ratio(a, b):
    """两个矩形面积重叠比（相对较小者）"""
    y0 = max(a[0], b[0]); y1 = min(a[0] + a[2], b[0] + b[2])
    x0 = max(a[1], b[1]); x1 = min(a[1] + a[3], b[1] + b[3])
    if y1 <= y0 or x1 <= x0:
        return 0.0
    inter = (y1 - y0) * (x1 - x0)
    return inter / min(a[2] * a[3], b[2] * b[3])


def compose(size, n, cols, seed):
    rnd = random.Random(seed)
    cv = brick_bg(size, cols, seed)
    subs = pick_subjects(n, seed)
    boxes, placed = [], 0
    for i, (nm, g) in enumerate(subs):
        scale = rnd.randint(10, 18)
        sp = fit(g, scale)
        best = None
        for _ in range(400):
            oy = rnd.randint(-2, size - scale + 2)
            ox = rnd.randint(-2, size - scale + 2)
            box = (oy, ox, scale, scale)
            if any(overlap_ratio(box, b) > 0.35 for b in boxes):
                continue
            # 可辨认率：不被画布切掉的部分 ≥ 85%（允许最多 2px 出血）
            oy2, ox2 = max(0, oy), max(0, ox)
            cut_area = scale * scale - (min(size, oy + scale) - oy2) * (min(size, ox + scale) - ox2)
            if cut_area / (scale * scale) > 0.15:
                continue
            best = (oy, ox, box)
            break
        if not best:
            continue
        oy, ox, box = best
        if place(cv, sp, oy, ox, size) > 0:
            boxes.append(box)
            placed += 1
    return cv, subs, placed


def write_txt(cv, path):
    os.makedirs(os.path.dirname(path) or '.', exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write('像素矩阵\n')
        for row in cv:
            f.write(' '.join(str(v) for v in row) + '\n')


def write_png(cv, path, pal, scale=14):
    W = len(cv)
    img = Image.new('RGB', (W * scale, W * scale))
    px = img.load()
    for y in range(W):
        for x in range(W):
            v = cv[y][x]
            c = pal[v] if v < len(pal) else (255, 0, 255)
            for dy in range(scale):
                for dx in range(scale):
                    px[x * scale + dx, y * scale + dy] = c
    img.save(path)


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--size', type=int, default=38)
    ap.add_argument('--n', type=int, default=6)
    ap.add_argument('--cols', default='32,34')
    ap.add_argument('--seed', type=int, default=1)
    ap.add_argument('--out', default='')
    ap.add_argument('--png', default='')
    a = ap.parse_args()
    pal = palette()
    cols = [int(x) for x in a.cols.split(',')]
    cv, subs, placed = compose(a.size, a.n, cols, a.seed)
    out = a.out or os.path.join(ROOT, '实验关/目标图_拼接/v778_%d.txt' % a.seed)
    png = a.png or os.path.join(ROOT, '实验关/renders/v778_%d.png' % a.seed)
    write_txt(cv, out)
    write_png(cv, png, pal)
    cnt = collections.Counter(v for row in cv for v in row)
    print('尺寸 %dx%d | 色数 %d | 主体 %d 个: %s' % (a.size, a.size, len(cnt), placed,
                                              ', '.join(nm for nm, _ in subs[:placed])))
    print('  →', out)
    print('  预览:', png)
