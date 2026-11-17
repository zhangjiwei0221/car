#!/bin/bash
# 用法: 跑检查_AE32D8BD.sh <变体json绝对路径> <输出目录> <标签>
set -u
ROOT="/Users/red/Desktop/毛线汽车"; TOOLS="$ROOT/03_工具/正式版"
F="$1"; D="$2"; T="$3"
mkdir -p "$D"
node "$TOOLS/Solvable_v1.js" "$F" --width 8 --out "$D/可通关_$T.json" > "$D/可通关_$T.txt" 2>&1; echo "[$T] Solvable exit=$? :: $(tail -1 "$D/可通关_$T.txt")"
node "$TOOLS/ChainRatchetCheck_v1.js" "$F" --out "$D/棘轮_$T.json" > "$D/棘轮_$T.txt" 2>&1; echo "[$T] Ratchet :: $(tail -3 "$D/棘轮_$T.txt" | tr '\n' ' ')"
node "$TOOLS/EscapeValveCheck_v1.js" "$F" --json --out "$D/逃生阀_$T.json" > "$D/逃生阀_$T.txt" 2>&1; echo "[$T] EscapeValve exit=$? :: $(tail -2 "$D/逃生阀_$T.txt" | tr '\n' ' ')"
node "$TOOLS/LayoutScore_v1.js" "$F" --out "$D/layout_$T.json" > "$D/layout_$T.txt" 2>&1; echo "[$T] Layout :: $(tail -2 "$D/layout_$T.txt" | tr '\n' ' ')"
node "$TOOLS/ArlCheck_v793.js" "$F" > "$D/arl_$T.txt" 2>&1; echo "[$T] ArlCheck :: $(grep -E '开局可点|无空格|容量守恒|FAIL' "$D/arl_$T.txt" | tr '\n' ' ')"
node "$ROOT/实验关/产线v6/难度带/复现_开局冰/守恒_9137.js" "$F" "$D/守恒_$T.json" > "$D/守恒_$T.txt" 2>&1; echo "[$T] 守恒 :: $(cat "$D/守恒_$T.txt")"
node "$ROOT/实验关/产线v6/难度带/管道研究/openprobe_27995.js" "$F" > "$D/开管探针_$T.txt" 2>&1; echo "[$T] 开管 :: $(cat "$D/开管探针_$T.txt")"
