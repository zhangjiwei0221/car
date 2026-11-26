#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
自由拼接 v775 —— 不做四象限，纯色背景 + 散装主体 + 点缀（点缀是"卡点素材"）

设计目的（用户 2026-11-02）：
  背景纯色；主体散落在画布上；再用"点缀"（1~2px 的点、短条）把某些颜色打散，
  这样这些颜色的车永远凑不满 → 制造卡点。

用法：
  python3 compose_free_v775.py --size 38 --bg 31 \
      --subjects "煎蛋-1@6,5;草莓-1@20,20;炒饭-1@8,24" \
      --dots "4:40;13:30" --out x.txt --png y.png
  说明：--subjects 用 主体名@y,x，可放多个；--dots 色号:数量，可多组。
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

def compose(size, bg, subjects, dot_specs, seed=7, bg2=None, bgmode='wave', choke=None):
    # bg2/bgmode: 背景分两块（wave=波浪斜分）
    # choke: [(色号, 数量)] 稀疏散布的"卡点色"
    import math
    rnd = random.Random(seed)
    cv = [[bg] * size for _ in range(size)]
    # 背景分色块：一条波浪线把画面分成上下两块
    if bg2:
        for y in range(size):
            for x in range(size):
                base = y / max(1, size - 1)
                wave = 0.06 * math.sin(x / size * 6.28 + seed)
                if base + wave > 0.5:
                    cv[y][x] = bg2
    # 1) 贴主体
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
    # 2) 点缀：随机撒点/短条（避开已有主体像素，只落在背景上）
    # 主体包围盒 + 2px 保护区：点缀/卡点色不许进这里，保证主体清楚
    occupied = set()
    guard = 2
    for name, (oy, ox), scale in subjects:
        for y in range(-guard, scale + guard):
            for x in range(-guard, scale + guard):
                occupied.add((oy + y, ox + x))
    for color, count in dot_specs:
        placed = 0; tries = 0
        while placed < count and tries < count * 60:
            tries += 1
            y = rnd.randrange(1, size - 1); x = rnd.randrange(1, size - 1)   # 不贴边
            if (y, x) in occupied: continue
            if cv[y][x] != bg: continue
            L = rnd.choice([1, 1, 1, 2, 3])       # 点或短条
            horiz = rnd.random() < 0.5
            ok = True
            for i in range(L):
                yy = y + (0 if horiz else i); xx = x + (i if horiz else 0)
                if not (0 <= yy < size and 0 <= xx < size) or (yy, xx) in occupied or cv[yy][xx] != bg:
                    ok = False; break
            if not ok: continue
            for i in range(L):
                yy = y + (0 if horiz else i); xx = x + (i if horiz else 0)
                cv[yy][xx] = color
            placed += 1
    # 卡点色：稀疏散布（每处 1 像素，尽量散开）
    if choke:
        for color, count in choke:
            placed = 0; tries = 0
            while placed < count and tries < count * 200:
                tries += 1
                y = rnd.randrange(1, size - 1); x = rnd.randrange(1, size - 1)   # 不贴边
                if (y, x) in occupied or cv[y][x] not in (bg, bg2 or bg): continue
                # 与其它同色点保持距离，保证"散"
                near = False
                for dy in range(-2, 3):
                    for dx in range(-2, 3):
                        yy, xx = y + dy, x + dx
                        if 0 <= yy < size and 0 <= xx < size and cv[yy][xx] == color: near = True
                if near: continue
                cv[y][x] = color; placed += 1
    return cv

def write_txt(cv, path):
    os.makedirs(os.path.dirname(path) or '.', exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write('像素矩阵\n')
        for row in cv:
            f.write(' '.join(str(v) for v in row) + '\n')

def write_png(cv, path, scale=12):
    src = open(os.path.join(ROOT, '02_工程/游戏主bin/bin/js/color-libs.js'), encoding='utf-8').read()
    seg = src.split('colors: [')[1].split('],')[0]
    hexes = ['#000000'] + re.findall(r"hex:\s*'(#[0-9A-Fa-f]{6})'", seg)
    pal = [tuple(int(h[i:i+2], 16) for i in (1, 3, 5)) for h in hexes]
    W = len(cv)
    img = Image.new('RGB', (W * scale, W * scale)); px = img.load()
    for y in range(W):
        for x in range(W):
            v = cv[y][x]; c = pal[v] if v < len(pal) else (0, 0, 0)
            for dy in range(scale):
                for dx in range(scale):
                    px[x * scale + dx, y * scale + dy] = c
    img.save(path)

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--size', type=int, default=38)
    ap.add_argument('--bg', type=int, default=31)
    ap.add_argument('--subjects', default='煎蛋-1@5,4;草莓-1@20,20;炒饭-1@5,22')
    ap.add_argument('--scale', type=int, default=14)
    ap.add_argument('--dots', default='4:40;13:30')
    ap.add_argument('--bg2', type=int, default=0, help='第二种背景色（0=不分块）')
    ap.add_argument('--bgmode', default='wave')
    ap.add_argument('--choke', default='', help='卡点色：色号:数量;...（稀疏散布、彼此间隔≥2）')
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
    dots = []
    for part in a.dots.split(';'):
        part = part.strip()
        if not part: continue
        c, n = part.split(':')
        dots.append((int(c), int(n)))
    choke = []
    for part in a.choke.split(';'):
        part = part.strip()
        if not part: continue
        c, n = part.split(':')
        choke.append((int(c), int(n)))
    cv = compose(a.size, a.bg, subs, dots, a.seed, a.bg2 or None, a.bgmode, choke)
    out = a.out or os.path.join(ROOT, '实验关/目标图_拼接/自由_%dx%d_s%d.txt' % (a.size, a.size, a.seed))
    png = a.png or os.path.join(ROOT, '实验关/renders/自由_%dx%d_s%d.png' % (a.size, a.size, a.seed))
    write_txt(cv, out); write_png(cv, png)
    cnt = collections.Counter(v for row in cv for v in row)
    print('尺寸 %dx%d | 色数 %d | 背景占比 %.0f%%' % (a.size, a.size, len(cnt), 100 * cnt[a.bg] / (a.size * a.size)))
    print('  色号:', ','.join(str(k) for k in sorted(cnt)))
    print('  →', out); print('  预览:', png)
