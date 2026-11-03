#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
拼接 v779 —— 「四角贴图 + 黄粉井字底」模板（用户 2026-11-02 18:34 给的样子）

用户原话：
  「他的背景是白色，然后外边点缀着黄色和粉色，同时中间是黄色和粉色穿插成"井"，
    然后四个主体紧挨着铺上去。我觉得这种图就挺好的。」

从那张图（35×35）里量出来的结构：
  画布 35×35，底色米白 #FDE8D6（色 31）
  外圈：上/下边 5 格宽的黄色方块（#F9DA00）每 14 格一个；左/右边 5 格宽的粉色方块（#FF98A3）
  内部：黄色竖条 2 格宽（x=1-2, 16-17, 32-33）＋ 粉色横条 2 格宽（y=15-16, 29-30）
        —— 黄竖粉横交叉成「井」
  主体：4 个 18×18 靶图，分别贴四角（相邻两个重叠 1 行/列），主体透明处透出底纹

用法：
  python3 compose_well_v779.py --subjects "小冰箱-1,电视-1,单人沙发-1,洗衣机-1" --out a.txt --png a.png
"""
import argparse, collections, glob, os, re
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
LIBS = sorted(glob.glob(os.path.join(ROOT, '拼接图/主体图纸库*')))
CREAM, YELLOW, PINK = 31, 30, 5
N = 35


def load(p):
    lines = [l for l in open(p, encoding='utf-8').read().strip().splitlines() if l.strip()]
    if lines and lines[0].startswith('像素'):
        lines = lines[1:]
    return [[int(x) for x in l.split()] for l in lines]


def fit(g, n=18):
    """大于 18 的主体按最近邻缩到 18×18（库里 18×18 的保持原样）"""
    h, w = len(g), len(g[0])
    if h <= n and w <= n:
        return g
    out = []
    for y in range(n):
        sy = min(h - 1, int(y * h / n))
        out.append([g[sy][min(w - 1, int(x * w / n))] for x in range(n)])
    return out


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


TPL = (["...PPPPP..PPPPP..."] * 3 + ["YYYYYYYYYYYYYYYYYY"] * 5 +
       ["...PPPPP..PPPPP..."] * 2 + ["YYYYYYYYYYYYYYYYYY"] * 5 +
       ["...PPPPP..PPPPP..."] * 3)
TM = {'Y': 30, 'P': 5, '.': 31}   # 黄 / 粉 / 米白


def draw_bg(n=N):
    """内层：用户 18×18 模板（黄横条 + 粉方块）缩放到 1..n-2；外层：最外圈小黄条/小粉条"""
    cv = [[CREAM] * n for _ in range(n)]
    for y in range(1, n - 1):
        for x in range(1, n - 1):
            cv[y][x] = TM[TPL[min(17, (y - 1) * 18 // (n - 2))][min(17, (x - 1) * 18 // (n - 2))]]
    for k in range(3):
        c0 = 1 + 14 * k
        for x in range(c0, min(n - 1, c0 + 5)):
            cv[0][x] = YELLOW
            cv[n - 1][x] = YELLOW
        for y in range(c0, min(n - 1, c0 + 5)):
            cv[y][0] = PINK
            cv[y][n - 1] = PINK
    return cv


def compose(names):
    cv = draw_bg()
    offs = [(1, 1), (1, 16), (16, 1), (16, 16)]   # 内缩 1 格，给最外圈小黄条/粉条留位置
    for nm, (oy, ox) in zip(names, offs):
        g0 = find_sprite(nm)
        g = fit(g0)
        print('  %s %dx%d' % (nm, len(g0), len(g0[0])))
        for y in range(len(g)):
            for x in range(len(g[0])):
                if g[y][x] == 0:
                    continue          # 0 = 透明 → 透出底纹
                py, px = oy + y, ox + x
                if 0 <= py < N and 0 <= px < N:
                    cv[py][px] = g[y][x]
    return cv


def write_txt(cv, p):
    os.makedirs(os.path.dirname(p) or '.', exist_ok=True)
    with open(p, 'w', encoding='utf-8') as f:
        f.write('像素矩阵\n')
        for r in cv:
            f.write(' '.join(map(str, r)) + '\n')


def write_png(cv, p, pal, s=14):
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
    ap.add_argument('--subjects', default='小冰箱-1,电视-1,单人沙发-1,洗衣机-1')
    ap.add_argument('--out', default='')
    ap.add_argument('--png', default='')
    a = ap.parse_args()
    names = [s.strip() for s in a.subjects.split(',') if s.strip()]
    cv = compose(names)
    out = a.out or os.path.join(ROOT, '实验关/目标图_拼接/井_%s.txt' % names[0])
    png = a.png or os.path.join(ROOT, '实验关/renders/井_%s.png' % names[0])
    write_txt(cv, out)
    write_png(cv, png, palette())
    cnt = collections.Counter(v for r in cv for v in r)
    print('35x35 | 色数 %d | 主体 %s' % (len(cnt), '、'.join(names)))
    print('  →', out, '\n  预览:', png)
