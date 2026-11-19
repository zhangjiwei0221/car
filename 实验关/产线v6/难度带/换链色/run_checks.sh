#!/bin/bash
# 换链色 · 四变体合法项检查（2026-11-20）· 口径 corner
set -u
ROOT=/Users/red/Desktop/毛线汽车
D="$ROOT/实验关/产线v6/难度带/换链色"
T="$ROOT/03_工具/正式版"
CONS="$ROOT/实验关/产线v6/难度带/闭环_靶向清理/守恒_含管道_v1.js"
OUT="$D/检查"
mkdir -p "$OUT"
declare -a NAMES=("C1_换链色" "C2_换链色去冰" "C3_原链去冰" "C4_原链")
for n in "${NAMES[@]}"; do
  f="$D/关卡_ZC_140_${n}.json"
  echo "===== $n ($(basename "$f")) ====="
  echo "--- Solvable w8"
  node "$T/Solvable_v1.js" "$f" --width 8 --timeout 60 --out "$OUT/solvable_${n}.json" 2>&1 | tail -1
  echo "--- LayoutScore"
  node "$T/LayoutScore_v1.js" "$f" --out "$OUT/layout_${n}.json" 2>&1 | tail -2
  echo "--- ChainRatchetCheck"
  node "$T/ChainRatchetCheck_v1.js" "$f" --out "$OUT/ratchet_${n}.json" 2>&1 | tail -3
  echo "--- EscapeValveCheck"
  node "$T/EscapeValveCheck_v1.js" "$f" --json --out "$OUT/valve_${n}.json" 2>&1 | tail -1
  echo "--- 守恒_含管道"
  node "$CONS" "$f" "$OUT/conservation_${n}.json" 2>&1 | tail -1
  echo "--- ArlCheck 合法项"
  node "$T/ArlCheck_v793.js" "$f" > "$OUT/arlcheck_${n}.txt" 2>&1
  grep -E "可通关|无空格|容量守恒|开局可点" "$OUT/arlcheck_${n}.txt"
done
echo CHECKS_DONE
