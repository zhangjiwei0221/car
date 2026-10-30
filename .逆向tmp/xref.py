import struct, sys
path="/Users/red/Desktop/ParkPassenger.app/Contents/MacOS/ParkPassenger"
data=open(path,'rb').read()
magic=struct.unpack_from('<I',data,0)[0]
assert magic==0xfeedfacf, hex(magic)
ncmds=struct.unpack_from('<I',data,16)[0]
off=32
segs=[]
for _ in range(ncmds):
    cmd,cmdsize=struct.unpack_from('<II',data,off)
    if cmd==0x19:  # LC_SEGMENT_64
        name=data[off+8:off+24].rstrip(b'\0').decode()
        vmaddr,vmsize,fileoff,filesize=struct.unpack_from('<QQQQ',data,off+24)
        segs.append((name,vmaddr,vmsize,fileoff,filesize))
    off+=cmdsize
print("segments:",[(s[0],hex(s[1]),hex(s[2]),hex(s[3]),hex(s[4])) for s in segs if s[0] in('__TEXT','__DATA_CONST')])

# 建立 va->file offset 映射（取包含该 va 的段）
def find_in_seg(target):
    hits=[]
    for name,vmaddr,vmsize,fileoff,filesize in segs:
        if name not in ('__TEXT','__DATA_CONST','__DATA'): continue
        start=fileoff; end=fileoff+filesize
        buf=data[start:end]
        n=len(buf)
        for i in range(n-5):
            if buf[i]==0xE8:
                rel=struct.unpack_from('<i',buf,i+1)[0]
                va=vmaddr+i
                tgt=va+5+rel
                if tgt==target:
                    hits.append(va)
    return hits

for sym,addr in [("manhattanDistance",0x10035c160)]:
    hs=find_in_seg(addr)
    print(f"{sym} @ {hex(addr)}: {len(hs)} xref(s)")
    for h in hs: print("   caller:",hex(h))
