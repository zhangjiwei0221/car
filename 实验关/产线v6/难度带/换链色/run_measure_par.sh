#!/bin/bash
# 换链色 · 并行测量：8 个 PInterp（变体×种子）同时跑，然后并行跑链账探针与 at4。
set -u
ROOT=/Users/red/Desktop/毛线汽车
D="$ROOT/实验关/产线v6/难度带/换链色"
P="$ROOT/实验关/产线v5/C9_插值玩家/PInterpPlayer.js"
PROBE="$D/链账探针.js"
AT4="$ROOT/实验关/产线v6/难度带/at4_扫描_v1.js"
declare -a NAMES=("C1_换链色" "C2_换链色去冰" "C3_原链去冰" "C4_原链")
mkdir -p "$D/at4"
PIDS=()
for n in "${NAMES[@]}"; do
  f="$D/关卡_ZC_140_${n}.json"
  for s in 977 4242; do
    node "$P" "$f" --p 0,0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1 --games 100 --seeds $s \
      --out "$D/pinterp_${n}_${s}" > "$D/pinterp_${n}_${s}.log" 2>&1 &
    PIDS+=($!)
  done
done
for pid in "${PIDS[@]}"; do wait "$pid"; done
echo PINTERP_ALL_DONE
PIDS=()
for n in "${NAMES[@]}"; do
  f="$D/关卡_ZC_140_${n}.json"
  node "$PROBE" "$f" --p 0,0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1 --games 100 --seeds 977,4242 \
    --out "$D/链账_${n}.json" > "$D/链账_${n}.log" 2>&1 &
  PIDS+=($!)
  node "$AT4" "$f" > "$D/at4/at4_${n}.txt" 2>&1 &
  PIDS+=($!)
done
for pid in "${PIDS[@]}"; do wait "$pid"; done
echo MEASURE_ALL_DONE
