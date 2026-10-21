#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v14（在 v13 基础上）：数字冰只在**这辆车露出来(激活)之后**才开始扣倒计时。

用户 2026-10-14：「数字冰是只要场上的车子动了之后，它就会开始进行倒计时，而不是露出来的那一刻」
→ 即：被挡住的数字冰不该跟着全场一起走表。做法：数字冰分支开头加一道 `cell+0x14`(激活) 判断，
   没激活就整个跳过（保持倒计时与冻结状态不变）。

（沙盒文档原口径是"全局球数、与激活/暴露无关"；本次按用户裁决改成"露出来才开始扣"，属规则调整。）
"""
import struct, os

SRC = '/private/tmp/ParkPassenger.v13'      # 基于 v13（v13 已含 v10~v13 全部改动）
DST = '/private/tmp/ParkPassenger.v14'
VA = 0x100000000
b = bytearray(open(SRC, 'rb').read())
orig = bytes(b)

def rel32(nxt, tgt): return struct.pack('<i', tgt - nxt)
def put(va, data, expect=None):
    o = va - VA
    if expect is not None:
        got = bytes(b[o:o+len(expect)])
        assert got == expect, 'orig mismatch @0x%x: want %s got %s' % (va, expect.hex(), got.hex())
    b[o:o+len(data)] = data

NOP = b'\x90'
GUARD = 0x100aa9f60      # 用 v13 之后仍空着的一段（0xaa9f60~0xaa9f81，34 字节）
S4_NUM_BRANCH = 0x100aa9f8d   # 解冻桩里"数字冰分支"的第一条指令：and ecx,0x7fffffff
S4_NUM_CONT   = 0x100aa9f93   # and 之后继续的地方
S4_NUM_EXIT   = 0x100aa9fba   # 两支汇合后的出口 jmp（→ 0x10024d962）

# ---- ① 把"数字冰分支"的第一条指令改成跳到守卫块 ----
old = bytes.fromhex('81e1ffffff7f')            # and ecx,0x7fffffff
put(S4_NUM_BRANCH, b'\xe9' + rel32(S4_NUM_BRANCH + 5, GUARD) + NOP, old)

# ---- ② 守卫块：没激活就不扣；激活则照原样继续 ----
g = GUARD
guard  = b'\xf6\x40\x14\x01'                   # testb $1,0x14(%rax)    ; 这辆车露出来了吗
guard += bytes([0x74, 0x0b])                   # je  .skip   (g+0x06 → g+0x11)
guard += b'\x81\xe1\xff\xff\xff\x7f'           # and ecx,0x7fffffff     ; 去掉标记位 = 剩余球数
guard += b'\xe9' + rel32(g + 0x11, S4_NUM_CONT)  # jmp 回原流程
guard += b'\xe9' + rel32(g + 0x16, S4_NUM_EXIT)  # .skip: jmp 出口（不扣、不改状态）
assert len(guard) == 0x16, len(guard)
put(GUARD, guard, bytes(len(guard)))

# ---- ③ 换 LC_UUID ----
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
print('v14 rebuilt: %s' % DST)
for s_, e_ in runs: print('  0x%07x~0x%07x  %d bytes' % (s_, e_-1, e_-s_))
print('total = %d ; LC_UUID = %s' % (sum(e_-s_ for s_, e_ in runs), new_uuid.hex()))
