import struct
data=open("/Users/red/Desktop/ParkPassenger.app/Contents/MacOS/ParkPassenger",'rb').read()
ncmds=struct.unpack_from('<I',data,16)[0]; off=32; segs=[]
for _ in range(ncmds):
    cmd,size=struct.unpack_from('<II',data,off)
    if cmd==0x19:
        segs.append((data[off+8:off+24].rstrip(b'\0').decode(),)+struct.unpack_from('<QQQQ',data,off+24))
    off+=size
T={0x10031a0b0:"std::sort<ElementCellData**,collectLimited$_0>",
   0x10034e0a0:"__introsort<collectLimited$_0>",
   0x10034e4e0:"collector$_0::operator()"}
res={t:[] for t in T}
for name,vmaddr,vmsize,vmo,fs in segs:
    if name!='__TEXT': continue
    buf=data[vmo:vmo+fs]; pos=0
    while True:
        i=buf.find(b'\xE8',pos)
        if i<0 or i+5>len(buf): break
        tgt=vmaddr+i+5+struct.unpack_from('<i',buf,i+1)[0]
        if tgt in res: res[tgt].append(vmaddr+i)
        pos=i+1
for t,n in T.items():
    print(f"{n}: {len(res[t])} xref ->",[hex(x) for x in res[t][:8]])
