#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
make_corner_manhattan.py —— 把 ParkPassenger_corner 的目标像素取用改成
需求文档 `需求_消除逻辑_小车选像素小人_corner.md` 的口径。

文档口径（验收标准反推）
----------------------
- 候选 = 该颜色的**全部**剩余像素（格内 `-` 的唯一解释是"容量不足"，没有"够不着"这种状态）；
- 次序 = D 升序，D = |r_disp-(R-1)| + c；同 D 时行号降序、列号升序；
- 取前 N 个（N = 这辆车这一次能吃几个），容量截断。

本脚本打两处补丁
----------------
1) 次序：`TargetBoard::_getCandidateScore`（0x1003f19c0，234 字节函数体）改成返回 r+c。
   客户端内部行 0 = 底行（`_parseBoardConfig` 里 `rows-1-i_json`），故 r_int+c 就是文档的 D；
   平手"行升序→列升序"由原比较器 `_isCandidateHigherPriority` 自带，不用改。
   改前那版 corner 包只把参数 X 归零，公式退化成 A²(r²+c²)（欧氏），不是曼哈顿。

2) 候选集合：`TargetBoard::tryReceiveTargetElements` 里传给 `_findMatchedBlocks` 的
   `bool` 钉成 1（全图同色格）。传 0 时那条分支只收"能通到任一边缘"的格子，
   会多出"够不着所以没消"这种文档里没有的状态。

另：重换 LC_UUID（Rosetta 按 UUID 复用翻译缓存，不换可能还跑旧代码）。
文件长度不变、无新增段。
"""

import hashlib
import struct
import sys
import uuid

# ---- 补丁 1：排序键 -------------------------------------------------------
SCORE_VA = 0x1003F19C0
SCORE_LEN = 0x1003F1AAA - SCORE_VA          # 234 字节函数体
SCORE_ORIG_PREFIX = bytes.fromhex(
    "554889e54883ec5048897df88975f48955f0894dec448945e8"
    "488b7df8"
)
SCORE_BODY = bytes.fromhex("8d0416" "4863c0" "c3")   # lea eax,[rsi+rdx]; movsxd rax,eax; ret

# ---- 补丁 2：候选集合 -----------------------------------------------------
# 原: movzbl -0x99(%rbp),%edi ; andl $1,%edi
BOOL_ORIG = bytes.fromhex("0fb6bd67ffffff83e701")
BOOL_NEW = bytes.fromhex("bf01000000" "9090909090")  # mov $1,%edi ; 5×nop（与原 10 字节等长）


def parse_segments(data):
    if struct.unpack_from("<I", data, 0)[0] != 0xFEEDFACF:
        raise SystemExit("不是 64 位 Mach-O")
    ncmds = struct.unpack_from("<I", data, 16)[0]
    off, segs, uuid_off = 32, [], None
    for _ in range(ncmds):
        cmd, size = struct.unpack_from("<II", data, off)
        if cmd == 0x19:
            name = data[off + 8: off + 24].rstrip(b"\0").decode()
            vmaddr, vmsize, fileoff, filesize = struct.unpack_from("<QQQQ", data, off + 24)
            segs.append((name, vmaddr, vmsize, fileoff, filesize))
        elif cmd == 0x1B:
            uuid_off = off + 8
        off += size
    return segs, uuid_off


def va_to_off(segs, va):
    for name, vmaddr, vmsize, fileoff, filesize in segs:
        if vmaddr <= va < vmaddr + filesize:
            return fileoff + (va - vmaddr)
    raise SystemExit("VA 不在任何段里: %#x" % va)


def main():
    if len(sys.argv) != 4 or sys.argv[2] != "-o":
        print(__doc__)
        print("用法: python3 make_corner_manhattan.py <输入可执行> -o <输出可执行>")
        return 2
    src, dst = sys.argv[1], sys.argv[3]
    data = bytearray(open(src, "rb").read())
    segs, uuid_off = parse_segments(bytes(data))
    changed = []

    # 1) 排序键
    off = va_to_off(segs, SCORE_VA)
    cur = bytes(data[off: off + SCORE_LEN])
    if cur.startswith(SCORE_ORIG_PREFIX):
        if cur[-1] != 0xC3:
            raise SystemExit("打分函数区间校验失败：末尾应为 ret(c3)")
        data[off: off + SCORE_LEN] = SCORE_BODY + b"\x90" * (SCORE_LEN - len(SCORE_BODY))
        changed.append(("排序键 _getCandidateScore", off, SCORE_LEN,
                        cur[:8].hex(), SCORE_BODY.hex()))
    elif cur.startswith(SCORE_BODY):
        print("· 排序键已是曼哈顿版，跳过")
    else:
        raise SystemExit("打分函数既不是原版也不是补丁版，拒绝改（版本漂移？）")

    # 2) 候选集合
    hits = []
    i = data.find(BOOL_ORIG)
    while i >= 0:
        hits.append(i)
        i = data.find(BOOL_ORIG, i + 1)
    if len(hits) == 1:
        off2 = hits[0]
        assert len(BOOL_NEW) == len(BOOL_ORIG)
        data[off2: off2 + len(BOOL_ORIG)] = BOOL_NEW
        changed.append(("候选集合 bool→1", off2, len(BOOL_ORIG),
                        BOOL_ORIG.hex(), BOOL_NEW.hex()))
    elif len(hits) == 0 and data.count(BOOL_NEW) == 1:
        print("· 候选集合已是全图版，跳过")
    else:
        raise SystemExit("候选集合法调用点命中 %d 处，拒绝改" % len(hits))

    # 3) LC_UUID
    if uuid_off is not None:
        newuuid = uuid.uuid5(uuid.NAMESPACE_URL,
                             "corner-manhattan:" + hashlib.sha256(bytes(data)).hexdigest())
        data[uuid_off: uuid_off + 16] = newuuid.bytes
        print("LC_UUID -> %s" % newuuid)
    else:
        print("警告: 没有 LC_UUID 命令")

    if len(data) != len(open(src, "rb").read()):
        raise SystemExit("长度变了，拒绝写出")
    open(dst, "wb").write(bytes(data))
    for name, o, n, b, a in changed:
        print("补丁 %-22s @ 文件偏移 %#x，%d 字节" % (name, o, n))
        print("      改前 %s" % b)
        print("      改后 %s" % a)
    if not changed:
        print("没有需要改的地方")
    print("  sha256(输入) = %s" % hashlib.sha256(open(src, "rb").read()).hexdigest())
    print("  sha256(输出) = %s" % hashlib.sha256(bytes(data)).hexdigest())
    return 0


if __name__ == "__main__":
    sys.exit(main())
