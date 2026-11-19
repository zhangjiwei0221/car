#!/bin/bash
# 长冰密度实验 · 合法项检查（2026-11-20）
set -u
ROOT=/Users/red/Desktop/毛线汽车
D="$ROOT/实验关/产线v6/难度带/长冰密度"
T="$ROOT/03_工具/正式版"
OUT="$D/检查"
mkdir -p "$OUT"
for n in 深晚 深更晚 深等; do
  f="$D/关卡_ZC_140_长冰-${n}.json"
  echo "===== $n ($(basename "$f")) ====="
  echo "--- Solvable w8"
  node "$T/Solvable_v1.js" "$f" --width 8 --timeout 60 --out "$OUT/solvable_${n}.json" 2>&1 | tail -2
  echo "--- LayoutScore"
  node "$T/LayoutScore_v1.js" "$f" --out "$OUT/layout_${n}.json" 2>&1 | tail -3
  echo "--- ChainRatchetCheck"
  node "$T/ChainRatchetCheck_v1.js" "$f" --out "$OUT/ratchet_${n}.json" 2>&1 | tail -2
  echo "--- EscapeValveCheck"
  node "$T/EscapeValveCheck_v1.js" "$f" --json --out "$OUT/valve_${n}.json" 2>&1 | tail -2
  echo "--- ArlCheck (legal items)"
  node "$T/ArlCheck_v793.js" "$f" > "$OUT/arlcheck_${n}.txt" 2>&1
  grep -E "可通关|无空格|守恒|开局|→" "$OUT/arlcheck_${n}.txt" | head -10
done
echo DONE
