#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v13（在 v12 基础上）：数字冰【解锁那一刻】要把车上的数字换成该车容量。
根因：_refreshCapacity 里"角标已显示过(this+0x49d)"会直接早退，数字停在上一次的倒计时值。
修法：解冻桩在"倒计时归零"时给 cell+0x1c 打一次性标记(=1)；显示链路看到该标记就强制重画，
      于是那一刻画出的就是 cell+0x10（该车容量）。标记在下一步会被解冻桩自然清 0，不会反复重画。
字段：+0x10 容量 / +0x18 冰剩余 / +0x1c 备用字节(原代码只在本文件里被 refresh 抄进一个没人读的 view 字段)
      +0x20 数字冰(符号位=1，值=剩余球数)  +0x24 锁定元素  +0x2c 链条
"""
import struct, os

SRC = '/private/tmp/ParkPassenger.v10'
DST = '/private/tmp/ParkPassenger.v13'
VA = 0x100000000
b = bytearray(open(SRC, 'rb').read())
orig = bytes(b)

def rel32(nxt, tgt): return struct.pack('<i', tgt - nxt)
def jmp(here, tgt):  return b'\xe9' + rel32(here + 5, tgt)
def je6(here, tgt):  return b'\x0f\x84' + rel32(here + 6, tgt)
def call(here, tgt): return b'\xe8' + rel32(here + 5, tgt)
def jcc(op, here, tgt):
    d = tgt - (here + 2)
    assert -128 <= d <= 127, (hex(here), hex(tgt), d)
    return bytes([op, d & 0xff])
def put(va, data, expect=None):
    o = va - VA
    if expect is not None:
        got = bytes(b[o:o+len(expect)])
        assert got == expect, 'orig mismatch @0x%x: want %s got %s' % (va, expect.hex(), got.hex())
    b[o:o+len(data)] = data

NOP = b'\x90'
A_HIDE_CAP   = 0x1002b7780
A_ENSURE_CAP = 0x1002b82a0
A_PLAY_ENTER = 0x1002bc500
A_MOUNT_GET  = 0x1002be4e0
A_ATTACH     = 0x1002b66a0
A_CONT       = 0x1002b5c5f
A_HIDE_PATH  = 0x1002b5c51
A_RET        = 0x1002b5d30
A_DISP_ENTRY = 0x1002b5ca7
A_AFTER_ANIM = 0x1002b5d25
A_ENSURE_PATH= 0x1002b5cb6
VEC2_ZERO    = 0x102fe9930

HEAD_VA, DISP_VA, S3_VA, REP_VA = 0x100aa9e3d, 0x100aa9ea2, 0x100aa9f12, 0x100aa9f17
S4_VA, S5_VA = 0x100aa9f82, 0x100aa9fd2
TRAMP_VA = 0x100aa9fcb   # S5 前面 7 字节空隙：放一条'跳到显示判定'的跳板（短跳够不着 DISP）
FUNC_HEAD_VA = 0x1002b5c48

# ---------- ① HEAD：数字冰 / 刚解冻 / 链条 / 锁定元素 → 跳过闸门直接进显示判定 ----------
h = HEAD_VA
head  = b'\x48\x8b\x4d\xf0'                     # mov rcx,[rbp-0x10]
head += b'\x83\x79\x20\x00'                     # cmp dword [rcx+0x20],0
head += jcc(0x78, h+0x08, h+0x2e)               # js  .special
head += b'\xf6\x41\x1c\x01'                     # test byte [rcx+0x1c],1   ★刚解冻的标记
head += jcc(0x75, h+0x0e, h+0x2e)               # jne .special
head += b'\xf6\x41\x2c\x01'                     # test byte [rcx+0x2c],1   （链条）
head += jcc(0x75, h+0x14, h+0x2e)               # jne .special
head += b'\xf6\x41\x24\x01'                     # test byte [rcx+0x24],1   （锁定元素）
head += jcc(0x75, h+0x1a, h+0x2e)               # jne .special
head += b'\xf6\x80\x9e\x04\x00\x00\x01'         # test byte [rax+0x49e],1
head += je6(h+0x23, A_HIDE_PATH)
head += jmp(h+0x29, A_CONT)
assert len(head) == 0x2e, len(head)
head += b'\x48\x8b\x7d\xe0'                     # .special: mov rdi,[rbp-0x20]
head += call(h+0x32, A_ENSURE_CAP)
head += b'\x48\x8b\x45\xe0'                     # mov rax,[rbp-0x20]
head += b'\x48\x83\xb8\xb0\x03\x00\x00\x00'     # cmp qword [rax+0x3b0],0
head += je6(h+0x43, A_RET)
head += b'\x48\x8b\x4d\xf0'                     # mov rcx,[rbp-0x10]
head += b'\xf6\x41\x2c\x01'                     # test byte [rcx+0x2c],1
head += jcc(0x75, h+0x51, h+0x59)               # jne .rep
head += b'\xf6\x41\x24\x01'                     # test byte [rcx+0x24],1
head += jcc(0x74, h+0x57, h+0x5e)               # je  .disp
head += call(h+0x59, REP_VA)                    # .rep: 调用重挂桩
head += jmp(h+0x5e, A_DISP_ENTRY)               # .disp: 进显示判定
assert len(head) <= 101, len(head)
put(HEAD_VA, head, bytes(len(head)))

# ---------- ② DISP：数字冰(值>0)→倒计时；数字冰(值=0，已解冻)→容量；链条/锁定→容量；其余带冰→隐藏 ----------
d = DISP_VA
disp  = b'\x48\x8b\x45\xe0' + b'\x48\x8b\xb8\xb0\x03\x00\x00' + b'\x48\x8b\x4d\xf0'
disp += b'\x8b\x41\x20' + b'\x85\xc0' + bytes([0x78, 0x2a])         # 符号位=1（数字冰标记）→ .num
disp += b'\x8b\x41\x18' + b'\x85\xc0' + bytes([0x7e, 0x1e])         # 冰剩余≤0 → 显示容量
disp += b'\xf6\x41\x2c\x01' + bytes([0x75, 0x18])                  # 链条 → 显示容量
disp += b'\xf6\x41\x24\x01' + bytes([0x75, 0x12])                  # 锁定元素 → 显示容量
disp += b'\x48\x8b\x7d\xe0' + call(d+0x2d, A_HIDE_CAP) + jmp(d+0x32, A_RET)
disp += NOP * 4
disp += b'\x8b\x71\x10' + bytes([0xeb, 0x07])                      # .show: esi = 容量
disp += b'\x25\xff\xff\xff\x7f' + b'\x89\xc6'                      # .num: 去掉标记位
disp += call(d+0x47, A_PLAY_ENTER) + jmp(d+0x4c, A_AFTER_ANIM)
assert len(disp) == 0x51, len(disp)
put(DISP_VA, disp, None)

# ---------- ③ 旧桩3 → 跳 DISP；④ 重挂桩（把角标提到铁链上层）----------
put(S3_VA, jmp(S3_VA, DISP_VA) + NOP * 60, None)
r = REP_VA
rep  = b'\x48\x8b\x45\xe0'                       # mov rax,[rbp-0x20]
rep += b'\x48\x8b\x88\x18\x04\x00\x00'           # mov rcx,[rax+0x418]
rep += b'\x48\x85\xc9' + jcc(0x75, r+0x0e, r+0x29)
rep += b'\x48\x8b\xb8\x48\x03\x00\x00'           # mov rdi,[rax+0x348]
rep += b'\x48\x85\xff' + jcc(0x74, r+0x1a, r+0x48)
rep += call(r+0x1c, A_MOUNT_GET)
rep += b'\x48\x89\xc1' + b'\x48\x85\xc9' + jcc(0x74, r+0x27, r+0x48)
rep += b'\x48\x8b\x7d\xe0' + b'\x48\x8b\xb7\xb0\x03\x00\x00' + b'\x48\x89\xca'
rep += b'\xb9\x07\x00\x00\x00'                   # z=7（铁链是 6）
rep += b'\x4c\x8d\x05' + rel32(r+0x43, VEC2_ZERO)
rep += call(r+0x43, A_ATTACH) + b'\xc3'
assert len(rep) <= 0x6a, len(rep)
put(REP_VA, rep, None)

# ---------- ⑤ 解冻桩：倒计时归零那一步把 cell+0x1c 置 1（"刚解冻，请把数字换成容量"）----------
put(S4_VA + 0x34, b'\xc6\x40\x1c\x01', bytes.fromhex('c6401c00'))   # 0xaa9fb6: movb $1,0x1c(%rax)

# ---------- ⑥ 已显示过(f49d)分支：带标记 → 强制走显示判定 ----------
s = S5_VA
s5  = b'\x48\x8b\x45\xe0'                        # mov rax,[rbp-0x20]
s5 += b'\xf6\x80\x9d\x04\x00\x00\x01'            # test byte [rax+0x49d],1
s5 += je6(s+0x0b, A_ENSURE_PATH)                 # je → 原“还没显示过”路径
s5 += b'\x48\x8b\x4d\xf0'                        # mov rcx,[rbp-0x10]
s5 += b'\xf6\x41\x1c\x01' + jcc(0x75, s+0x19, TRAMP_VA)  # ★刚解冻 → 强制重画（jne 指令在 s+0x19）
s5 += b'\x83\x79\x20\x00' + jcc(0x78, s+0x1f, TRAMP_VA)  # 数字冰 → 重画倒计时
s5 += jmp(s+0x21, A_RET)
assert len(s5) <= 40, len(s5)
put(S5_VA, s5, None)
put(TRAMP_VA, jmp(TRAMP_VA, DISP_VA) + NOP * 2, None)   # 跳板

# ---------- ⑦ 函数头 → HEAD；⑧ 换 LC_UUID ----------
put(FUNC_HEAD_VA, jmp(FUNC_HEAD_VA, HEAD_VA) + NOP * 4, bytes.fromhex('f6809e04000001750e'))
new_uuid = os.urandom(16)
b[0xc38:0xc38+16] = new_uuid
open(DST, 'wb').write(bytes(b))

A2, B2 = orig, bytes(b)
assert len(A2) == len(B2)
runs = []; i = 0
while i < len(A2):
    if A2[i] != B2[i]:
        j = i
        while j < len(A2) and A2[j] != B2[j]: j += 1
        runs.append((i, j)); i = j
    else: i += 1
print('v13 rebuilt: %s' % DST)
for s_, e_ in runs: print('  0x%07x~0x%07x  %d bytes' % (s_, e_-1, e_-s_))
print('total = %d ; LC_UUID = %s' % (sum(e_-s_ for s_, e_ in runs), new_uuid.hex()))
