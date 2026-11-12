#!/bin/sh
# $1=level json  $2=workdir  $3=outfile
F="$1"; W="$2"; OUT="$3"; mkdir -p "$W"
SOLV=$(node 03_工具/正式版/Solvable_v1.js "$F" --width 8 2>/dev/null | tail -1)
node 03_工具/正式版/PopulationSim_v1.js "$F" --random 100 --seeds 977,4242,31337 --no-mcfd --out "$W/sim" >/dev/null 2>&1
REL=$(node /tmp/p4b_*.js "$F" "$W/sim/routes_seed977.json" 2>/dev/null | tail -1)
CH=$(node 03_工具/正式版/ChoiceSpaceCheck_v1.js "$F" 2>/dev/null | head -1)
ARL=$(node 03_工具/正式版/ArlCheck_v793.js "$F" 2>&1)
python3 - "$F" "$SOLV" "$REL" "$CH" "$ARL" "$W/sim/summary.json" "$OUT" <<'PY'
import json,sys,re,os
F,SOLV,REL,CH,ARL,SUM,OUT=sys.argv[1:]
def j(s):
    try: return json.loads(s)
    except: return {}
solv=j(SOLV.strip().splitlines()[-1]) if SOLV.strip() else {}
rel=j(REL.strip().splitlines()[-1]) if REL.strip() else {}
ent=re.search(r'entropy=([0-9.]+)',CH); forced=re.search(r'forced=(\d+)',CH); fake=re.search(r'fake=(\d+)',CH); M=re.search(r'M=([0-9.]+)',CH)
op=re.search(r'开局可点≥5\s+(\d+)',ARL); can='可通关（最小路线）' in ARL and '✓' in ARL.split('可通关（最小路线）')[-1][:20]
emp=re.search(r'无空格\s+(\d+)',ARL); cons=re.search(r'容量守恒\s+(\d+)/(\d+)',ARL); tol=re.search(r'容错（参考）\s+(\d+)/20',ARL)
s=j(open(SUM).read()) if os.path.exists(SUM) else {}
row=dict(level=os.path.basename(F).replace('.json',''),
  solvable=solv.get('solvable'), solvSec=solv.get('sec'),
  win=(s.get('randomWinRate') or {}).get('mean'),
  perSeed=[x['winRate'] for x in (s.get('seeds') or [])],
  entropy=float(ent.group(1)) if ent else None, M=float(M.group(1)) if M else None,
  forced=int(forced.group(1)) if forced else None, fake=int(fake.group(1)) if fake else None,
  opening=int(op.group(1)) if op else None, empty=int(emp.group(1)) if emp else None,
  cons=(cons.group(1)==cons.group(2)) if cons else None, tol=int(tol.group(1)) if tol else None,
  reliefShare=rel.get('shareWithRelief'), maxDrop2=rel.get('shareMaxDrop2'))
open(OUT,'a').write(json.dumps(row,ensure_ascii=False)+'\n')
PY
