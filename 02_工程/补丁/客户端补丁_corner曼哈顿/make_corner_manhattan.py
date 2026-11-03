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

2) 逐格重算：`TargetBoard::tryReceiveTargetElements` 原来一次调用
   `_findMatchedBlocks(..., limit)` 把一批挑完，可达图只建一次；改成
   「一次只挑 1 个 → 立刻置为已消（state=2）→ 再挑下一个」，最多挑 limit 个。
   这样同一批里先被选中的 A 小人会把它挡着的 A 邻居解锁，D 最短的就能在同一批里被选走
   （文档 §一.2「每确定一个，立刻视为已消除，重新计算可选集合」）。

注意：候选集合**不要动**。2026-11-03 试过把 `tryReceiveTargetElements` 传给
`_findMatchedBlocks` 的 bool 钉成 1（全图同色格、不管阻挡），用户当场否决：
「怎么小人的逻辑忽略了阻挡关系」。已全部回退，本脚本不再包含那一处。

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



# ---- 补丁 2：逐格重算 -----------------------------------------------------
CAVE_VA = 0x100E8EF15          # __TEXT 里一段全零区（前面是上一版留下的死桩）
HOST_HOOK_VA = 0x1003EEED3     # tryReceiveTargetElements 里 _findMatchedBlocks 调用前
OLD_STUB = bytes.fromhex(
    "4189cb4889f84c8b48504c2b48484c89c8489949c7c11800000049f7f983e801"
    "29f08945f4448955f044895dece98e2a56ff")
STUB_SIG = bytes.fromhex("415441554156")


def _build_stub(S):
    """在 S 处生成「每次只挑 1 个 + 选中即标记已消」的循环。"""
    c = bytearray()

    def emit(b):
        c.extend(b)

    def here():
        return S + len(c)

    emit(b"\x41\x54\x41\x55\x41\x56")                # push r12; r13; r14
    emit(b"\x48\x83\xec\x08")                          # sub rsp,8（放第 7 个参数 + 对齐）
    emit(b"\x45\x31\xe4")                                # xor r12d,r12d      taken=0
    emit(b"\x44\x8b\xad\x70\xff\xff\xff")            # mov r13d,[rbp-0x90] limit
    loop = here()
    emit(b"\x45\x39\xec")                                # cmp r13d,r12d
    jge = len(c); emit(b"\x7d\x00")
    emit(b"\x48\x8b\xb5\x80\xff\xff\xff")            # mov rsi,[rbp-0x80] this
    emit(b"\x8b\x95\x7c\xff\xff\xff")                  # mov edx,[rbp-0x84] X
    emit(b"\x8b\x8d\x78\xff\xff\xff")                  # mov ecx,[rbp-0x88] Y
    emit(b"\x44\x8b\x85\x74\xff\xff\xff")            # mov r8d,[rbp-0x8c] colorID
    emit(b"\x41\xb9\x01\x00\x00\x00")                  # mov r9d,1          limit=1
    emit(b"\x0f\xb6\x85\x67\xff\xff\xff")            # movzbl eax,[rbp-0x99] bool
    emit(b"\x83\xe0\x01")                                # and eax,1
    emit(b"\x89\x04\x24")                                # mov [rsp],eax      第7个参数
    emit(b"\x4c\x8b\xb5\x50\xff\xff\xff")            # mov r14,[rbp-0xb0] 旧 end
    emit(b"\x48\x8d\xbd\x48\xff\xff\xff")            # lea rdi,[rbp-0xb8] out
    call1 = len(c); emit(b"\xe8\x00\x00\x00\x00")
    emit(b"\x48\x8b\x85\x50\xff\xff\xff")            # mov rax,[rbp-0xb0] 新 end
    emit(b"\x4c\x39\xf0")                                # cmp r14,rax
    je1 = len(c); emit(b"\x74\x00")
    emit(b"\x48\x8b\x78\xf0")                            # mov rdi,[rax-0x10] 最后加入的 shared_ptr
    emit(b"\x48\x85\xff")                                # test rdi,rdi
    je2 = len(c); emit(b"\x74\x00")
    emit(b"\xbe\x02\x00\x00\x00")                      # mov esi,2
    call2 = len(c); emit(b"\xe8\x00\x00\x00\x00")
    emit(b"\x41\xff\xc4")                                # inc r12d
    jmp_loop = len(c); emit(b"\xeb\x00")
    done = here()
    emit(b"\x48\x83\xc4\x08")                          # add rsp,8
    emit(b"\x41\x5e\x41\x5d\x41\x5c")                # pop r14; r13; r12
    jmp_out = len(c); emit(b"\xe9\x00\x00\x00\x00")

    def rel8(at, target):
        v = target - (S + at + 2)
        assert -128 <= v <= 127, (at, v)
        c[at + 1] = v & 0xFF

    def rel32(at, target):
        struct.pack_into("<i", c, at + 1, target - (S + at + 5))

    rel8(jge, done)
    rel8(je1, done)
    rel8(je2, done)
    rel8(jmp_loop, loop)
    rel32(call1, 0x1003EF300)      # _findMatchedBlocks
    rel32(call2, 0x1003FD340)      # TargetBlockElement::setElementState
    rel32(jmp_out, 0x1003EEEE1)    # 回到原流程（out.empty() 检查）
    return bytes(c)


STUB = _build_stub(CAVE_VA)


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
    args = [a for a in sys.argv[1:] if a != "--per-pick"]
    per_pick = "--per-pick" in sys.argv
    if len(args) != 3 or args[1] != "-o":
        print(__doc__)
        print("用法: python3 make_corner_manhattan.py <输入可执行> -o <输出可执行> [--per-pick]")
        print("      --per-pick：逐格重算那版（**2026-11-03 试过会闪退，默认关闭，别开**）")
        return 2
    src, dst = args[0], args[2]
    data = bytearray(open(src, "rb").read())
    segs, uuid_off = parse_segments(bytes(data))
    CAVE_VA_OFF = va_to_off(segs, CAVE_VA)
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

    # 3) 逐格重算（一次只挑 1 个，选完立刻标记已消，再挑下一个）
    #    ⚠ 2026-11-03 试过：进关卡后车接人时 SIGSEGV 闪退（见 README §9），默认关闭
    if not per_pick:
        print("· 逐格重算：默认跳过（该版会闪退，需显式 --per-pick 才装）")
    elif bytes(data[CAVE_VA_OFF:CAVE_VA_OFF + 6]) == STUB_SIG:
        print("· 逐格重算已是补丁版，跳过")
    else:
        cur = bytes(data[CAVE_VA_OFF:CAVE_VA_OFF + len(OLD_STUB)])
        if cur != OLD_STUB:
            raise SystemExit("代码洞内容不是已知的死桩，拒绝写入（版本漂移？）")
        if any(data[CAVE_VA_OFF + len(OLD_STUB): CAVE_VA_OFF + len(STUB)]):
            raise SystemExit("代码洞剩余空间不是全零，拒绝写入")
        hook_off = va_to_off(segs, HOST_HOOK_VA)
        if data[hook_off] == 0xE9:
            raise SystemExit("挂钩点已是 jmp，拒绝重复改")
        if bytes(data[hook_off: hook_off + 7]) != b"\x48\x8d\xbd\x48\xff\xff\xff":
            raise SystemExit("挂钩点不是预期的 lea -0xb8(%rbp),%rdi")
        data[CAVE_VA_OFF: CAVE_VA_OFF + len(STUB)] = STUB
        rel = CAVE_VA - (HOST_HOOK_VA + 5)
        data[hook_off: hook_off + 5] = b"\xe9" + struct.pack("<i", rel)
        changed.append(("逐格重算 循环", hook_off, 5, "lea -0xb8(%rbp),%rdi", "jmp 代码洞"))

    # 2) LC_UUID
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
