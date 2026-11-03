#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
make_corner_manhattan.py —— 把 ParkPassenger_corner 的“同色像素取用顺序”改成
需求文档口径：曼哈顿距离（固定起点 = 目标图左下角）。

改什么
------
客户端里决定“这一辆车先吃哪几个像素”的排序，全部走
    TargetBoard::_isCandidateHigherPriority(a, b, X, Y)
      → 分别调 TargetBoard::_getCandidateScore(r, c, X, Y) 取分
      → 分数相同再比 pair(r, c)：行号升序 → 列号升序
所以只要把 _getCandidateScore 的返回值改成“内部行 + 列”，
平手规则（行升序=屏幕上的下方优先、列升序=左侧优先）就是文档要求的那一条。

坐标
----
目标图 JSON 的 blocks 是“从上到下”，客户端解析时反过来存（internal row 0 = 底行，
见 TargetBoard::_parseBoardConfig 里 `rows - 1 - i_json`）。
屏幕行 r_disp 与内部行 r_int 的关系：r_int = R-1-r_disp。
文档 D = |r_disp-(R-1)| + c = r_int + c —— 所以内部直接算 r+c 就是文档的 D。

改前（2026-10-30 那版 corner 包）
--------------------------------
把 X 强制成 0，分数 = (r*A)^2 + (c*A)^2（A=max(1,Y)）≡ 欧氏距离 r²+c²，
不是曼哈顿：文档 10×10 验收图上有 4/28 个像素位次不同（D=3 那一组与 D=2 那组互换）。

改后
----
_getCandidateScore 返回 (int64)(r + c)；X、Y 被忽略（文档要求起点不随槽位变化）。
"""

import hashlib
import struct
import sys
import uuid

# ---- 已知目标 -------------------------------------------------------------
# _getCandidateScore 的函数体（改前，195 字节左右）开头 32 字节；全二进制唯一
ORIG_PREFIX = bytes.fromhex(
    "554889e54883ec5048897df88975f48955f0894dec448945e8"
    "488b7df8"
)
PATCHED_PREFIX = bytes.fromhex("8d0416" "4863c0" "c3")  # lea eax,[rsi+rdx]; movsxd rax,eax; ret

# 函数区间：0x1003f19c0 起，到 0x1003f1ab0（下一个函数）为止；中间 0x1003f1aaa 起是 nop 填充。
FUNC_LEN = 0x1003F1AAA - 0x1003F19C0  # 0xEA = 234


def parse_segments(data):
    magic = struct.unpack_from("<I", data, 0)[0]
    if magic != 0xFEEDFACF:
        raise SystemExit("不是 64 位 Mach-O")
    ncmds = struct.unpack_from("<I", data, 16)[0]
    off = 32
    segs = []
    uuid_cmd = None
    for _ in range(ncmds):
        cmd, size = struct.unpack_from("<II", data, off)
        if cmd == 0x19:  # LC_SEGMENT_64
            name = data[off + 8: off + 24].rstrip(b"\0").decode()
            vmaddr, vmsize, fileoff, filesize = struct.unpack_from("<QQQQ", data, off + 24)
            segs.append((name, vmaddr, vmsize, fileoff, filesize))
        elif cmd == 0x1B:  # LC_UUID
            uuid_cmd = off + 8
        off += size
    return segs, uuid_cmd


def va_to_off(segs, va):
    for name, vmaddr, vmsize, fileoff, filesize in segs:
        if vmaddr <= va < vmaddr + filesize:
            return fileoff + (va - vmaddr)
    raise SystemExit("VA 不在任何段里: %#x" % va)


def off_to_va(segs, off):
    for name, vmaddr, vmsize, fileoff, filesize in segs:
        if fileoff <= off < fileoff + filesize:
            return vmaddr + (off - fileoff)
    raise SystemExit("文件偏移不在任何段里: %#x" % off)


def main():
    if len(sys.argv) != 4 or sys.argv[2] != "-o":
        print(__doc__)
        print("用法: python3 make_corner_manhattan.py <输入可执行> -o <输出可执行>")
        return 2
    src, dst = sys.argv[1], sys.argv[3]
    data = bytearray(open(src, "rb").read())
    segs, uuid_off = parse_segments(bytes(data))

    hits = []
    i = data.find(ORIG_PREFIX)
    while i >= 0:
        hits.append(i)
        i = data.find(ORIG_PREFIX, i + 1)
    if len(hits) != 1:
        # 已经是补过的？
        p = data.find(PATCHED_PREFIX)
        if p >= 0 and data.find(PATCHED_PREFIX, p + 1) < 0:
            print("输入已经是曼哈顿版（找到补丁特征 @ %#x），不做改动" % p)
            return 0
        raise SystemExit("找不到唯一的 _getCandidateScore（命中 %d 处）" % len(hits))

    off = hits[0]
    va = off_to_va(segs, off)
    if data[off + FUNC_LEN - 1] != 0xC3:  # 区间末尾应正好是原函数的 ret
        raise SystemExit("函数区间校验失败：末尾字节应为 c3，实际 %#x"
                         % data[off + FUNC_LEN - 1])
    body = PATCHED_PREFIX + b"\x90" * (FUNC_LEN - len(PATCHED_PREFIX))
    before = bytes(data[off: off + FUNC_LEN])
    data[off: off + FUNC_LEN] = body

    # Rosetta 会按 LC_UUID 复用翻译缓存 —— 必须换 UUID，否则可能还跑旧代码
    if uuid_off is not None:
        newuuid = uuid.uuid5(uuid.NAMESPACE_URL,
                             "corner-manhattan:" + hashlib.sha256(bytes(data)).hexdigest())
        data[uuid_off: uuid_off + 16] = newuuid.bytes
        print("LC_UUID -> %s" % newuuid)
    else:
        print("警告: 没有 LC_UUID 命令")

    open(dst, "wb").write(bytes(data))
    print("函数 @ %#x（文件偏移 %#x），替换 %d 字节" % (va, off, FUNC_LEN))
    print("  改前: %s" % before[:16].hex())
    print("  改后: %s ... (nop 填充)" % PATCHED_PREFIX.hex())
    print("  sha256(输入) = %s" % hashlib.sha256(bytes(open(src, "rb").read())).hexdigest())
    print("  sha256(输出) = %s" % hashlib.sha256(bytes(data)).hexdigest())
    return 0


if __name__ == "__main__":
    sys.exit(main())
