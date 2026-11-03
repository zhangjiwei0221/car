#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
verify_corner_manhattan.py —— 用需求文档自带的验收用例，验证“改后”的排序口径。

做三件事：
1. 解析 `01_项目文档/需求_消除逻辑_小车选像素小人_corner.md` 里的 10×10 验收图与两张序号表；
2. 分别用【改前 corner 包】的公式（欧氏 r²+c²）与【改后】的公式（曼哈顿 r+c）模拟，
   逐格比对文档里的序号，打印不符的格数；
3. 若给出客户端可执行文件，检查补丁字节是否存在、并调用 selftest_score 实跑这 7 字节。

坐标约定（与客户端一致）：
  文档 r_disp：0 = 顶行；客户端内部 r_int = R-1-r_disp（blocks 从上到下解析后反向存储）
  文档 D = (R-1-r_disp) + c = r_int + c
  平手：r_int 升序（= 屏幕上靠下优先）、c 升序（= 靠左优先）—— 由原比较器自带。
"""

import re
import subprocess
import sys

DOC = "/Users/red/Desktop/毛线汽车/01_项目文档/需求_消除逻辑_小车选像素小人_corner.md"


def load_doc(path=DOC):
    text = open(path, encoding="utf-8").read()
    blocks = re.findall(r"```\n(.*?)```", text, re.S)
    grid = None
    tables = []
    for b in blocks:
        lines = [ln.rstrip() for ln in b.splitlines() if ln.strip()]
        if lines and all(re.fullmatch(r"[o.\s]+", ln) for ln in lines) and len(lines) == 10:
            grid = [ln.replace(" ", "") for ln in lines]
        elif lines and re.match(r"\s*[cC]0", lines[0]):
            tables.append(lines)
    if grid is None:
        raise SystemExit("文档里没解析到 10×10 验收图")
    return grid, tables


def parse_table(lines):
    rows = {}
    for ln in lines:
        m = re.match(r"\s*r(\d+)\s+(.*)$", ln)
        if not m:
            continue
        r = int(m.group(1))
        cells = m.group(2).split()
        rows[r] = cells
    return rows


def order_of(cells, mode):
    """cells: [(r_disp, c)]；返回按客户端比较器排出的顺序。"""
    R = 10

    def key(p):
        r_disp, c = p
        r_int = R - 1 - r_disp
        score = (r_int * r_int + c * c) if mode == "euc" else (r_int + c)
        return (score, r_int, c)

    return sorted(cells, key=key)


def render(grid, order, cap):
    R, C = len(grid), len(grid[0])
    rank = {p: i + 1 for i, p in enumerate(order)}
    out = []
    for r in range(R):
        row = []
        for c in range(C):
            if grid[r][c] != "o":
                row.append("·")
            else:
                n = rank[(r, c)]
                row.append(str(n) if n <= cap else "-")
        out.append(row)
    return out


def compare(table_rows, rendered):
    bad = 0
    detail = []
    for r, cells in table_rows.items():
        for c, want in enumerate(cells):
            got = rendered[r][c]
            if want != got:
                bad += 1
                detail.append((r, c, want, got))
    return bad, detail


def main():
    grid, tables = load_doc()
    cells = [(r, c) for r, row in enumerate(grid) for c, ch in enumerate(row) if ch == "o"]
    print("验收图: %d×%d，颜色 A 共 %d 个像素" % (len(grid), len(grid[0]), len(cells)))
    if len(cells) != 28:
        print("!! 文档图形不是 28 个 A 像素，解析可能不对")

    ok = True
    for mode, name in (("euc", "改前 corner 包（欧氏 r²+c²）"), ("man", "改后（曼哈顿 r+c）")):
        order = order_of(cells, mode)
        for rows in [parse_table(t) for t in tables]:
            cap = max(int(x) for cellsrow in rows.values() for x in cellsrow if x.isdigit())
            rendered = render(grid, order, cap)
            bad, detail = compare(rows, rendered)
            print("  %-28s 容量 %-3d → 与文档不符 %d / %d 格"
                  % (name, cap, bad, sum(len(v) for v in rows.values())))
            if bad:
                ok = ok and mode == "euc"   # 改前不符是预期
                if mode == "man":
                    ok = False
                for d in detail[:12]:
                    print("        r%d c%d 文档=%s 实算=%s" % d)
    if not ok:
        print("结论: 改后口径与文档不一致 ❌")
        return 1
    print("结论: 改后口径与文档逐格一致 ✅（改前不一致属预期）")

    if len(sys.argv) > 1:
        binpath = sys.argv[1]
        data = open(binpath, "rb").read()
        sig = bytes.fromhex("8d04164863c0c3")
        n = data.count(sig)
        print("\n二进制检查: 补丁特征 %s 出现 %d 次" % (sig.hex(), n))
        if n < 1:
            print("  !! 没找到补丁字节")
            return 1
        try:
            out = subprocess.run(["arch", "-x86_64", "/tmp/selftest_score", binpath],
                                 capture_output=True, text=True)
            print(out.stdout.strip() or out.stderr.strip())
            return out.returncode
        except FileNotFoundError:
            print("  (未找到 /tmp/selftest_score，跳过实跑；先编译 selftest_score.c)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
