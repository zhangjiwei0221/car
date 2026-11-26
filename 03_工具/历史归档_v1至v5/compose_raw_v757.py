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

def patch_size(g):
    """主体的平均色块大小（越小越碎）"""
    H, W = len(g), len(g[0])
    cnt, comp = {}, {}
    seen = [[False] * W for _ in range(H)]
    for y in range(H):
        for x in range(W):
            c = g[y][x]
            if not c:
                continue
            cnt[c] = cnt.get(c, 0) + 1
            if seen[y][x]:
                continue
            comp[c] = comp.get(c, 0) + 1
            st = [(y, x)]
            seen[y][x] = True
            while st:
                cy, cx = st.pop()
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = cy + dy, cx + dx
                    if 0 <= ny < H and 0 <= nx < W and not seen[ny][nx] and g[ny][nx] == c:
                        seen[ny][nx] = True
                        st.append((ny, nx))
    cs = [c for c in cnt if cnt[c] >= 8]
    if not cs:
        return 18.0
    return sum(cnt[c] / comp[c] for c in cs) / len(cs)


def compose(subjects, bg, frames, subj=18, block=2, bg4=None, framew=1, fw4=None):
    # bg4: 每个象限一对背景色（让背景色也按象限独占）
    def bgpair(x, y):
        if bg4:
            q = (0 if y < CELL else 2) + (0 if x < CELL else 1)
            p = bg4[q]
            return p[((y // block) + (x // block)) % 2]
        return bg[((y // block) + (x // block)) % 2]
    canvas = [[bgpair(x, y) for x in range(CANVAS)] for y in range(CANVAS)]
    cells = [(0, 0), (0, CELL), (CELL, 0), (CELL, CELL)]
    for i, ((oy, ox), name) in enumerate(zip(cells, subjects)):
        g = load(os.path.join(SPR, name if name.endswith('.txt') else name + '.txt'))
        h, w = len(g), len(g[0])
        frame = frames[i % len(frames)]
        fw = fw4[i] if fw4 and i < len(fw4) else framew   # 按象限指定框厚
        for y in range(CELL):
            for x in range(CELL):
                if y < fw or y >= CELL - fw or x < fw or x >= CELL - fw:
                    canvas[oy + y][ox + x] = frame
        subj_eff = min(subj, CELL - 2 * fw)          # 框厚时自动收缩，避免越界
        off = max(0, (CELL - 2 * fw - subj_eff) // 2)
        for y in range(subj_eff):
            for x in range(subj_eff):
                sy = min(h - 1, int(y * h / subj_eff))
                sx = min(w - 1, int(x * w / subj_eff))
                v = g[sy][sx]
                if v != 0:                      # 保留原始色号
                    canvas[oy + fw + off + y][ox + fw + off + x] = v
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
    ap.add_argument('--bg4', default='', help='四象限各自背景色对，如 31,32;27,28;3,4;15,16')
    ap.add_argument('--frame', default='13,25,20,1')
    ap.add_argument('--subj', type=int, default=18)
    ap.add_argument('--frame-w', type=int, default=1)
    ap.add_argument('--fw4', default='', help='按象限框厚，顺序 tl,tr,bl,br，如 2,1,3,2')
    ap.add_argument('--order', default='', help='手动指定象限顺序（tl,tr,bl,br），留空=按碎度自动排')
    ap.add_argument('--no-auto', action='store_true', help='关闭自动排序，按 --subjects 原顺序 tl,tr,bl,br')
    ap.add_argument('--out', default='')
    ap.add_argument('--png', default='')
    a = ap.parse_args()
    subs = [s.strip() for s in a.subjects.split(',')]
    bg = [int(x) for x in a.bg.split(',')]
    fr = [int(x) for x in a.frame.split(',')]
    # 默认逻辑：按主体碎度自动落位
    #   最整 → 下左（最先被消）；次整 → 上左；次碎 → 下右；最碎 → 上右（最后被消）
    if not a.order and not a.no_auto:
        scored = []
        for nm in subs:
            g = load(os.path.join(SPR, nm if nm.endswith('.txt') else nm + '.txt'))
            scored.append((patch_size(g), nm))
        scored.sort(key=lambda t: -t[0])          # 整 → 碎
        slots = ['bl', 'tl', 'br', 'tr']
        subs = [scored[i][1] for i in range(min(4, len(scored)))]
        a.order = ','.join(slots[:len(subs)])
        print('自动排序（碎度 → 象限）：', ' '.join('%s=%.1f' % (n, p) for p, n in scored))
    if not a.order:
        a.order = 'tl,tr,bl,br'
    slot = {'tl': 0, 'tr': 1, 'bl': 2, 'br': 3}
    order = [slot[x.strip()] for x in a.order.split(',')]
    placed = [None] * 4
    for i, q in enumerate(order):
        if i < len(subs):
            placed[q] = subs[i]
    placed = [p if p else subs[i % len(subs)] for i, p in enumerate(placed)]
    bg4 = [[int(x) for x in pair.split(',')] for pair in a.bg4.split(';')] if a.bg4 else None
    fw4 = [int(x) for x in a.fw4.split(',')] if a.fw4 else None
    cv = compose(placed, bg, fr, a.subj, bg4=bg4, framew=a.frame_w, fw4=fw4)
    out = a.out or os.path.join(ROOT, '实验关/目标图_拼接/拼接_原始色_40x40.txt')
    png = a.png or os.path.join(ROOT, '实验关/renders/拼接_原始色.png')
    write_txt(cv, out); write_png(cv, png)
    cnt = collections.Counter(v for row in cv for v in row)
    print('色数=%d 像素=%d' % (len(cnt), sum(cnt.values())))
    print('色号:', ','.join(str(k) for k in sorted(cnt)))
    print('→', out)
