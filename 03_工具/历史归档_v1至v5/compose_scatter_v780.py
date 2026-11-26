#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
拼接 v780 —— 「撒点」底（用户 2026-11-02 19:50 那张的样子）

从那张图量出来的特征：
  主色 1 个，占 ~34%，被点缀色切断成 23 块，最大块 113 格
  点缀色 2-3 个（浅蓝 12%、米白 3%），撒成 1-3 格的小簇，不成图案
  四个 18x18 主体贴四角，占 ~50%，不互相遮挡

和 v777/v779 的区别：不做井、不做横带，底就是「主色 + 乱撒的小块」。

用法：
  python3 compose_scatter_v780.py --main 19 --accents 14,31 --seed 3 \
      --subjects "草莓-1,甜虾寿司-1,布丁-1,奶酪-1" --out a.txt --png a.png
"""
import argparse, collections, glob, os, random, re
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
LIBS = sorted(glob.glob(os.path.join(ROOT, '拼接图/主体图纸库*')))
N = 35


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


def scatter_bg(n, main, accents, seed, acc_ratio=0.14):
    """主色打底，点缀色撒成 1-3 格的小簇（不彼此粘连）"""
    rnd = random.Random(seed)
    cv = [[main] * n for _ in range(n)]
    target = int(n * n * acc_ratio)
    placed = 0
    guard = 0
    while placed < target and guard < 4000:
        guard += 1
        c = accents[rnd.randrange(len(accents))]
        y, x = rnd.randrange(n), rnd.randrange(n)
        cells = [(y, x)]
        big = rnd.random() < 0.18                    # 18% 的簇长成 4-9 格的大块（像参考图里那种 10+ 格的块）
        steps = rnd.randint(3, 8) if big else (1 if rnd.random() >= 0.55 else 0)
        if steps:
            for _ in range(steps):
                dy, dx = rnd.choice([(1, 0), (0, 1), (-1, 0), (0, -1)])
                cells.append((y + dy, x + dx))
        # 防粘连：簇周围一圈必须是主色
        ok = True
        for (a, b) in cells:
            for da in (-1, 0, 1):
                for db in (-1, 0, 1):
                    na, nb = a + da, b + db
                    if 0 <= na < n and 0 <= nb < n and cv[na][nb] != main:
                        ok = False
        if not ok:
            continue
        for (a, b) in cells:
            if 0 <= a < n and 0 <= b < n:
                cv[a][b] = c
        placed += len([1 for a, b in cells if 0 <= a < n and 0 <= b < n])
    return cv


def compose(names, main, accents, seed):
    cv = scatter_bg(N, main, accents, seed)
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
    ap.add_argument('--main', type=int, default=19)          # 19 = 亮绿 #95E502
    ap.add_argument('--accents', default='14,31')            # 浅蓝 / 米白
    ap.add_argument('--acc-ratio', type=float, default=0.14)
    ap.add_argument('--seed', type=int, default=1)
    ap.add_argument('--subjects', default='草莓-1,甜虾寿司-1,布丁-1,奶酪-1')
    ap.add_argument('--tag', default='撒点_01')
    a = ap.parse_args()
    names = [s.strip() for s in a.subjects.split(',') if s.strip()]
    cv = compose(names, a.main, [int(x) for x in a.accents.split(',')], a.seed)
    out = os.path.join(ROOT, '实验关/目标图_拼接/%s.txt' % a.tag)
    png = os.path.join(ROOT, '实验关/renders/%s.png' % a.tag)
    write_txt(cv, out)
    write_png(cv, png, palette())
    cnt = collections.Counter(v for r in cv for v in r)
    print('%dx%d | 色数 %d | 主体 %s' % (N, N, len(cnt), '、'.join(names)))
    print('  →', out)
    print('  预览:', png)
