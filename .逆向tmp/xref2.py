import struct
path="/Users/red/Desktop/ParkPassenger.app/Contents/MacOS/ParkPassenger"
data=open(path,'rb').read()
ncmds=struct.unpack_from('<I',data,16)[0]
off=32; segs=[]
for _ in range(ncmds):
    cmd,size=struct.unpack_from('<II',data,off)
    if cmd==0x19:
        name=data[off+8:off+24].rstrip(b'\0').decode()
        vmaddr,vmsize,fileoff,filesize=struct.unpack_from('<QQQQ',data,off+24)
        segs.append((name,vmaddr,fileoff,filesize))
    off+=size

targets={0x10035c190:"findShortestPathWithAStar",0x10035caa0:"canReachTopEdge",
         0x10030ef60:"_buildMoveGrid",0x100311e60:"_collectLinkedGroupCells"}
res={t:[] for t in targets}
for name,vmaddr,fileoff,filesize in segs:
    if name!='__TEXT': continue
    buf=data[fileoff:fileoff+filesize]
    pos=0
    while True:
        i=buf.find(b'\xE8',pos)
        if i<0 or i+5>len(buf): break
        rel=struct.unpack_from('<i',buf,i+1)[0]
        tgt=vmaddr+i+5+rel
        if tgt in targets: res[tgt].append(vmaddr+i)
        pos=i+1
for t,n in targets.items():
    print(f"{n} @ {hex(t)}: {len(res[t])} xref")
    for h in res[t][:12]:
        print("   caller",hex(h))
