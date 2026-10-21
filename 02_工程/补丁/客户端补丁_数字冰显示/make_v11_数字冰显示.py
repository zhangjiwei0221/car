#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v11(修正版) 客户端补丁：① 数字冰一开始就显示倒计时 ② 有链条的车也显示容量
字段依据（在 _parseBoardConfig 里逐个核对过）：
  cell+0x0c 颜色id / +0x10 容量 / +0x14 冰标志 / +0x18 冰剩余层数
  cell+0x1d,+0x20 : 钥匙元素(type21-25)    ← 数字冰借用了 +0x20（最高位=1 标记）
  cell+0x24,+0x28 : 锁定元素(type31-35)
  cell+0x2c,+0x30 : ★链条(type5)：+0x2c bit0 = 有链条，+0x30 = 链组号
"""
import struct, os

SRC = '/private/tmp/ParkPassenger.v10'
DST = '/private/tmp/ParkPassenger.v11'
VA = 0x100000000

b = bytearray(open(SRC, 'rb').read())
orig = bytes(b)

def fo(va): return va - VA
def rel32(nxt, tgt): return struct.pack('<i', tgt - nxt)
def jmp(here, tgt):  return b'\xe9' + rel32(here + 5, tgt)
def je6(here, tgt):  return b'\x0f\x84' + rel32(here + 6, tgt)
def call(here, tgt): return b'\xe8' + rel32(here + 5, tgt)
def put(va, data, expect=None):
    o = fo(va)
    if expect is not None:
        got = bytes(b[o:o+len(expect)])
        assert got == expect, 'orig bytes mismatch @0x%x: want %s got %s' % (va, expect.hex(), got.hex())
    b[o:o+len(data)] = data

NOP = b'\x90'
ADDR_HIDE_CAP   = 0x1002b7780
ADDR_ENSURE_CAP = 0x1002b82a0
ADDR_PLAY_ENTER = 0x1002bc500
ADDR_CONT       = 0x1002b5c5f
ADDR_HIDE_PATH  = 0x1002b5c51
ADDR_RET        = 0x1002b5d30
ADDR_DISP_ENTRY = 0x1002b5ca7
ADDR_AFTER_ANIM = 0x1002b5d25
HEAD_VA = 0x100aa9e3d
DISP_VA = 0x100aa9ea2
S3_VA   = 0x100aa9f12
FUNC_HEAD_VA = 0x1002b5c48

# ---------- ① HEAD：数字冰 / 链条车 / 锁定元素 → 跳过所有闸门 ----------
h = HEAD_VA
head  = b'\x48\x8b\x4d\xf0'                      # mov rcx,[rbp-0x10]
head += b'\x83\x79\x20\x00'                      # cmp dword [rcx+0x20],0
head += bytes([0x78, 0x1e])                      # js  .special   (next=+0x0a → +0x28)
head += b'\xf6\x41\x2c\x01'                      # test byte [rcx+0x2c],1    ; 有链条？
head += bytes([0x75, 0x18])                      # jne .special   (next=+0x10 → +0x28)
head += b'\xf6\x41\x24\x01'                      # test byte [rcx+0x24],1    ; 锁定元素（顺手放过）
head += bytes([0x75, 0x12])                      # jne .special   (next=+0x16 → +0x28)
head += b'\xf6\x80\x9e\x04\x00\x00\x01'          # test byte [rax+0x49e],1   ; 原“允许显示容量”
head += je6(h + 0x1d, ADDR_HIDE_PATH)
head += jmp(h + 0x23, ADDR_CONT)
head += b'\x48\x8b\x7d\xe0'                      # .special: mov rdi,[rbp-0x20]
head += call(h + 0x2c, ADDR_ENSURE_CAP)          # call _ensureCapacityRedream
head += b'\x48\x8b\x45\xe0'                      # mov rax,[rbp-0x20]
head += b'\x48\x83\xb8\xb0\x03\x00\x00\x00'      # cmp qword [rax+0x3b0],0
head += je6(h + 0x3d, ADDR_RET)
head += jmp(h + 0x43, ADDR_DISP_ENTRY)
assert len(head) == 0x48, len(head)
put(HEAD_VA, head, bytes(0x48))

# ---------- ② DISP：显示判定 ----------
d = DISP_VA
disp  = b'\x48\x8b\x45\xe0'                      # mov rax,[rbp-0x20]
disp += b'\x48\x8b\xb8\xb0\x03\x00\x00'          # mov rdi,[rax+0x3b0]
disp += b'\x48\x8b\x4d\xf0'                      # mov rcx,[rbp-0x10]
disp += b'\x8b\x41\x20'                          # mov eax,[rcx+0x20]   ; 数字冰？
disp += b'\x85\xc0'                              # test eax,eax
disp += bytes([0x78, 0x2a])                      # js  .num  (next=+0x16 → +0x40)
disp += b'\x8b\x41\x18'                          # mov eax,[rcx+0x18]   ; 冰剩余
disp += b'\x85\xc0'                              # test eax,eax
disp += bytes([0x7e, 0x1e])                      # jle .show (next=+0x1d → +0x3b)
disp += b'\xf6\x41\x2c\x01'                      # test byte [rcx+0x2c],1 ; ★有链条 → 也显示容量
disp += bytes([0x75, 0x18])                      # jne .show (next=+0x23 → +0x3b)
disp += b'\xf6\x41\x24\x01'                      # test byte [rcx+0x24],1 ; ★锁定元素 → 也显示容量
disp += bytes([0x75, 0x12])                      # jne .show (next=+0x29 → +0x3b)
disp += b'\x48\x8b\x7d\xe0'                      # mov rdi,[rbp-0x20]
disp += call(d + 0x2d, ADDR_HIDE_CAP)            # call _hideCapacity   ; 只有“带冰且没链条”才隐藏
disp += jmp(d + 0x32, ADDR_RET)
disp += NOP * 4
disp += b'\x8b\x71\x10'                          # .show: mov esi,[rcx+0x10] ; 容量
disp += bytes([0xeb, 0x07])                      # jmp .anim
disp += b'\x25\xff\xff\xff\x7f'                  # .num: and eax,0x7fffffff  ; 去掉数字冰标记位
disp += b'\x89\xc6'                              # mov esi,eax
disp += call(d + 0x47, ADDR_PLAY_ENTER)          # .anim: call playEnterAnim(esi)
disp += jmp(d + 0x4c, ADDR_AFTER_ANIM)
assert len(disp) == 0x51, len(disp)
assert d + len(disp) <= 0x100aa9f12
put(DISP_VA, disp, None)

# ---------- ③ 旧桩3 → 跳 DISP ----------
s3 = jmp(S3_VA, DISP_VA) + NOP * 60
assert len(s3) == 65
put(S3_VA, s3, None)

# ---------- ④ 函数头 → 跳 HEAD ----------
hj = jmp(FUNC_HEAD_VA, HEAD_VA) + NOP * 4
assert len(hj) == 9
put(FUNC_HEAD_VA, hj, bytes.fromhex('f6809e04000001750e'))

# ---------- ⑤ 换 LC_UUID ----------
new_uuid = os.urandom(16)
b[0xc38:0xc38 + 16] = new_uuid

open(DST, 'wb').write(bytes(b))

A, B = orig, bytes(b)
assert len(A) == len(B)
runs = []
i = 0
while i < len(A):
    if A[i] != B[i]:
        j = i
        while j < len(A) and A[j] != B[j]:
            j += 1
        runs.append((i, j)); i = j
    else:
        i += 1
print('v11 rebuilt: %s' % DST)
for s, e in runs:
    print('  0x%07x~0x%07x  %d bytes' % (s, e - 1, e - s))
print('total changed = %d ; new LC_UUID = %s' % (sum(e - s for s, e in runs), new_uuid.hex()))
