#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v12：① 数字冰一开始就显示倒计时  ② 被铁链锁住的车也显示容量（把容量角标提到铁链上面）
依据（反汇编+图集核对）：
  · 铁链图 = 图集里的「特殊元素_圆点」(54x54)+「特殊元素_线段」，挂在 cell 的 lock locator 上、z=6
  · 容量角标画在「容量挂点(mount)」里、z=7，但那个挂点在车体(container)内部 → 整体仍在铁链之下 → 数字被圆点盖住
  · 修法：对这些车调用 _attachNodeToEffectRoot 把角标重挂到 effectRoot、z=7（>6）→ 数字画在铁链上面
字段（ElementCellData，构造函数 0x100255e40 逐字段核对）：
  +0x0c 颜色  +0x10 容量  +0x14 冰标志  +0x18 冰剩余  +0x20 数字冰(符号位)
  +0x24 锁定元素  +0x2c 链条标志  +0x30 链组号
"""
import struct, os

SRC = '/private/tmp/ParkPassenger.v10'
DST = '/private/tmp/ParkPassenger.v12'
VA = 0x100000000
b = bytearray(open(SRC, 'rb').read())
orig = bytes(b)

def rel32(nxt, tgt): return struct.pack('<i', tgt - nxt)
def jmp(here, tgt):  return b'\xe9' + rel32(here + 5, tgt)
def je6(here, tgt):  return b'\x0f\x84' + rel32(here + 6, tgt)
def call(here, tgt): return b'\xe8' + rel32(here + 5, tgt)
def jcc8(op, here, tgt):  # 短跳 2 字节
    d = tgt - (here + 2)
    assert -128 <= d <= 127, (op, hex(here), hex(tgt), d)
    return bytes([op, d & 0xff])
def put(va, data, expect=None):
    o = va - VA
    if expect is not None:
        got = bytes(b[o:o+len(expect)])
        assert got == expect, 'orig mismatch @0x%x: want %s got %s' % (va, expect.hex(), got.hex())
    b[o:o+len(data)] = data

NOP = b'\x90'
A_HIDE_CAP   = 0x1002b7780   # _hideCapacity
A_ENSURE_CAP = 0x1002b82a0   # _ensureCapacityRedream
A_PLAY_ENTER = 0x1002bc500   # playEnterAnim(int)
A_MOUNT_GET  = 0x1002be4e0   # ElementContainerRedream::getCapacityMountNode()
A_ATTACH     = 0x1002b66a0   # _attachNodeToEffectRoot(node, refParent, z, pos)
A_CONT       = 0x1002b5c5f
A_HIDE_PATH  = 0x1002b5c51
A_RET        = 0x1002b5d30
A_DISP_ENTRY = 0x1002b5ca7
A_AFTER_ANIM = 0x1002b5d25
VEC2_ZERO    = 0x102fe9930   # cocos2d::Vec2::ZERO

HEAD_VA = 0x100aa9e3d
DISP_VA = 0x100aa9ea2
S3_VA   = 0x100aa9f12
REP_VA  = 0x100aa9f17        # 重挂桩：放在旧桩3 让出来的空隙里（S3 只剩 5 字节 jmp，其后到 0xaa9f81 全空）
FUNC_HEAD_VA = 0x1002b5c48

# ---------- 重挂桩：把容量角标挂到 effectRoot（z=7，高于铁链的 6）----------
r = REP_VA
rep  = b'\x48\x8b\x45\xe0'                       # mov rax,[rbp-0x20]         ; view
rep += b'\x48\x8b\x88\x18\x04\x00\x00'           # mov rcx,[rax+0x418]        ; 缓存挂点
rep += b'\x48\x85\xc9'                           # test rcx,rcx
rep += jcc8(0x75, r+0x0e, r+0x29)                # jne .go
rep += b'\x48\x8b\xb8\x48\x03\x00\x00'           # mov rdi,[rax+0x348]        ; container
rep += b'\x48\x85\xff'                           # test rdi,rdi
rep += jcc8(0x74, r+0x1a, r+0x48)                # je  .out
rep += call(r+0x1c, A_MOUNT_GET)                 # call getCapacityMountNode
rep += b'\x48\x89\xc1'                           # mov rcx,rax
rep += b'\x48\x85\xc9'                           # test rcx,rcx
rep += jcc8(0x74, r+0x27, r+0x48)                # je  .out
rep += b'\x48\x8b\x7d\xe0'                       # .go: mov rdi,[rbp-0x20]    ; this
rep += b'\x48\x8b\xb7\xb0\x03\x00\x00'           # mov rsi,[rdi+0x3b0]        ; node = 角标
rep += b'\x48\x89\xca'                           # mov rdx,rcx                ; refParent = 挂点
rep += b'\xb9\x07\x00\x00\x00'                   # mov ecx,7                  ; z = 7（铁链是 6）
rep += b'\x4c\x8d\x05' + rel32(r+0x43, VEC2_ZERO)  # lea r8,[rip+…]           ; &Vec2::ZERO
rep += call(r+0x43, A_ATTACH)                    # call _attachNodeToEffectRoot
rep += b'\xc3'                                   # .out: ret
assert len(rep) <= 0x6a, len(rep)

# ---------- HEAD：数字冰/链条/锁定元素 → 跳过闸门；链条类再调重挂桩 ----------
h = HEAD_VA
head  = b'\x48\x8b\x4d\xf0'                      # mov rcx,[rbp-0x10]
head += b'\x83\x79\x20\x00'                      # cmp dword [rcx+0x20],0
head += jcc8(0x78, h+0x08, h+0x28)               # js .special
head += b'\xf6\x41\x2c\x01'                      # test byte [rcx+0x2c],1
head += jcc8(0x75, h+0x0e, h+0x28)               # jne .special
head += b'\xf6\x41\x24\x01'                      # test byte [rcx+0x24],1
head += jcc8(0x75, h+0x14, h+0x28)               # jne .special
head += b'\xf6\x80\x9e\x04\x00\x00\x01'          # test byte [rax+0x49e],1
head += je6(h+0x1d, A_HIDE_PATH)
head += jmp(h+0x23, A_CONT)
# .special = h+0x28
head += b'\x48\x8b\x7d\xe0'                      # mov rdi,[rbp-0x20]
head += call(h+0x2c, A_ENSURE_CAP)
head += b'\x48\x8b\x45\xe0'                      # mov rax,[rbp-0x20]
head += b'\x48\x83\xb8\xb0\x03\x00\x00\x00'      # cmp qword [rax+0x3b0],0
head += je6(h+0x3d, A_RET)
head += b'\x48\x8b\x4d\xf0'                      # mov rcx,[rbp-0x10]
head += b'\xf6\x41\x2c\x01'                      # test byte [rcx+0x2c],1  ; 有链条？
head += jcc8(0x75, h+0x4b, h+0x53)               # jne .rep
head += b'\xf6\x41\x24\x01'                      # test byte [rcx+0x24],1  ; 锁定元素？
head += jcc8(0x74, h+0x51, h+0x58)               # je  .disp
head += call(h+0x53, REP_VA)                     # .rep: call 重挂桩
head += jmp(h+0x58, A_DISP_ENTRY)                # .disp: jmp 显示判定
assert len(head) <= 101, len(head)
put(HEAD_VA, head, bytes(len(head)))

# ---------- DISP：显示判定（数字冰→倒计时；链条/锁定→容量；其余带冰→隐藏）----------
d = DISP_VA
disp  = b'\x48\x8b\x45\xe0' + b'\x48\x8b\xb8\xb0\x03\x00\x00' + b'\x48\x8b\x4d\xf0'
disp += b'\x8b\x41\x20' + b'\x85\xc0' + bytes([0x78, 0x2a])
disp += b'\x8b\x41\x18' + b'\x85\xc0' + bytes([0x7e, 0x1e])
disp += b'\xf6\x41\x2c\x01' + bytes([0x75, 0x18])
disp += b'\xf6\x41\x24\x01' + bytes([0x75, 0x12])
disp += b'\x48\x8b\x7d\xe0' + call(d+0x2d, A_HIDE_CAP) + jmp(d+0x32, A_RET)
disp += NOP * 4
disp += b'\x8b\x71\x10' + bytes([0xeb, 0x07])
disp += b'\x25\xff\xff\xff\x7f' + b'\x89\xc6'
disp += call(d+0x47, A_PLAY_ENTER) + jmp(d+0x4c, A_AFTER_ANIM)
assert len(disp) == 0x51, len(disp)
put(DISP_VA, disp, None)

# ---------- 旧桩3 → 跳 DISP（先把这段写掉，后面的重挂桩才能安全落进它让出的空隙）----------
put(S3_VA, jmp(S3_VA, DISP_VA) + NOP * 60, None)
put(REP_VA, rep, None)

# ---------- 函数头 → 跳 HEAD ----------
put(FUNC_HEAD_VA, jmp(FUNC_HEAD_VA, HEAD_VA) + NOP * 4, bytes.fromhex('f6809e04000001750e'))

# ---------- 换 LC_UUID ----------
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
print('v12 rebuilt: %s' % DST)
for s, e in runs: print('  0x%07x~0x%07x  %d bytes' % (s, e-1, e-s))
print('total = %d ; LC_UUID = %s' % (sum(e-s for s, e in runs), new_uuid.hex()))
