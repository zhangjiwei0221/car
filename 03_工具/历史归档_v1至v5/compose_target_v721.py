#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
目标图拼接器 v721（4 主体 · 14 色 · 每个主体一个独立外框）

规则：
  · 每个主体 = 一个 20×20 格子：1px 外框（独立颜色）+ 内部 18×18 主体
  · 主体只用 2 色（出现最多的两色 → 主体色 / 点缀色）
  · 背景 = 2 色棋盘（过渡色，会被切成很多小块 → “赌”的那部分）
  · 总颜色数 = 4 框 + 8 主体 + 2 背景 = 14
  · 14 色用“最远点采样”从 34 色库挑出，保证任意两色 RGB 距离 ≥85（不撞色）

用法：
  python3 compose_target_v721.py            # 用下面的默认配置
  python3 compose_target_v721.py --out x.txt --png y.png
改主体：改 SUBJECTS 里的 (文件, 主体色, 点缀色, 外框色)，色号用 34 色库编号。
"""
import argparse, collections, re, os
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SPRITE_DIR = os.path.join(ROOT, '蚂蚁图库/拼接图/主体图纸库151-200')

SUBJECTS = [
    ('宝箱-1.txt',   33, 27,  1),   # 深灰主体 / 浅橙点缀 / 红色外框
    ('地球仪-1.txt', 22, 12, 13),   # 青蓝主体 / 紫红点缀 / 天蓝外框
    ('帐篷-1.txt',    3, 19, 30),   # 粉红主体 / 浅黄点缀 / 棕色外框
    ('塔楼-1.txt',   28, 20, 11),   # 橙色主体 / 绿色点缀 / 深紫外框
]
BG = (15, 31)      # 深棕 + 浅灰 棋盘
CANVAS = 52
CELL = 20          # 1px 框 + 18px 主体

def load(p):
    lines = [l for l in open(p, encoding='utf-8').read().strip().splitlines() if l.strip()]
    if lines and lines[0].startswith('像素'):
        lines = lines[1:]
    return [[int(x) for x in l.split()] for l in lines]

def palette():
    src = open(os.path.join(ROOT, '02_工程/游戏主bin/bin/js/utils.js'), encoding='utf-8').read()
    pal = {}
    for m in re.finditer(r"{ name: '([^']+)',\s+hex: '#([0-9A-Fa-f]{6})' \}\s*,\s*// (\d+)", src):
        idx = int(m.group(3))
        if idx <= 34:
            pal[idx] = (m.group(1), '#' + m.group(2))
    return pal

def compose():
    W = CANVAS
    canvas = [[BG[((y // 6) + (x // 6)) % 2] for x in range(W)] for y in range(W)]
    margin = 2
    gap = 6
    cells = [(margin, margin), (margin, margin + CELL + gap),
             (margin + CELL + gap, margin), (margin + CELL + gap, margin + CELL + gap)]
    for (name, body, accent, frame), (oy, ox) in zip(SUBJECTS, cells):
        g = load(os.path.join(SPRITE_DIR, name))
        h, w = len(g), len(g[0])
        cnt = collections.Counter(v for row in g for v in row if v != 0)
        top2 = [c for c, _ in cnt.most_common(2)]
        mapping = {top2[0]: body}
        if len(top2) > 1:
            mapping[top2[1]] = accent
        for y in range(CELL):
            for x in range(CELL):
                if y in (0, CELL - 1) or x in (0, CELL - 1):
                    canvas[oy + y][ox + x] = frame
        for y in range(CELL - 2):
            for x in range(CELL - 2):
                sy = min(h - 1, int(y * h / (CELL - 2)))
                sx = min(w - 1, int(x * w / (CELL - 2)))
                v = g[sy][sx]
                if v != 0:
                    canvas[oy + 1 + y][ox + 1 + x] = mapping.get(v, body)
    return canvas

def write_txt(canvas, path):
    with open(path, 'w', encoding='utf-8') as f:
        f.write('像素矩阵\n')
        for row in canvas:
            f.write(' '.join(str(v) for v in row) + '\n')

def write_png(canvas, path, scale=11):
    pal = palette()
    W = len(canvas)
    img = Image.new('RGB', (W * scale, W * scale))
    px = img.load()
    for y in range(W):
        for x in range(W):
            h = pal[canvas[y][x]][1].lstrip('#')
            c = tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))
            for dy in range(scale):
                for dx in range(scale):
                    px[x * scale + dx, y * scale + dy] = c
    img.save(path)

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=os.path.join(ROOT, '实验关/目标图_拼接/拼接_四主体v4_52x52.txt'))
    ap.add_argument('--png', default=os.path.join(ROOT, '实验关/renders/拼接_四主体_v4.png'))
    a = ap.parse_args()
    cv = compose()
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    os.makedirs(os.path.dirname(a.png), exist_ok=True)
    write_txt(cv, a.out)
    write_png(cv, a.png)
    cnt = collections.Counter(v for row in cv for v in row)
    print('颜色数:', len(cnt), '总像素:', sum(cnt.values()))
    print('输出:', a.out)
    print('预览:', a.png)
