#!/bin/bash
# 用法: 跑检查_9137.sh <关目录> <变体文件> <标签>
set -u
D="/Users/red/Desktop/毛线汽车/实验关/产线v6/难度带/复现_开局冰/$1"
F="$D/$2"
T="${3:-$2}"
ROOT="/Users/red/Desktop/毛线汽车"
TOOLS="$ROOT/03_工具/正式版"
cd "$D" || exit 1
B=可通关_$T.json
node "$TOOLS/Solvable_v1.js" "$F" --width 8 --out "$D/$B" > "$D/可通关_$T.txt" 2>&1
echo "[$T] Solvable: $(cat "$D/可通关_$T.txt")"
node "$TOOLS/ChainRatchetCheck_v1.js" "$F" --out "$D/棘轮_$T.json" > "$D/棘轮_$T.txt" 2>&1
echo "[$T] Ratchet: $(tail -5 "$D/棘轮_$T.txt" | tr '\n' ' ')"
node "$TOOLS/EscapeValveCheck_v1.js" "$F" --json --out "$D/逃生阀_$T.json" > "$D/逃生阀_$T.txt" 2>&1
echo "[$T] EscapeValve exit=$? :: $(tail -3 "$D/逃生阀_$T.txt" | tr '\n' ' ')"
node "$TOOLS/LayoutScore_v1.js" "$F" --out "$D/layout_$T.json" > "$D/layout_$T.txt" 2>&1
echo "[$T] Layout: $(tail -3 "$D/layout_$T.txt" | tr '\n' ' ')"
node "$TOOLS/ArlCheck_v793.js" "$F" > "$D/arl_$T.txt" 2>&1
echo "[$T] ArlCheck: $(grep -E '开局可点|无空格|容量守恒|→' "$D/arl_$T.txt" | tr '\n' ' ')"
node "$ROOT/实验关/产线v6/难度带/复现_开局冰/守恒_9137.js" "$F" "$D/守恒_$T.json" > "$D/守恒_$T.txt" 2>&1
echo "[$T] 守恒: $(cat "$D/守恒_$T.txt")"
