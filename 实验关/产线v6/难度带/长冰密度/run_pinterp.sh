#!/bin/bash
# 长冰密度实验 · 三段插值（PInterpPlayer，两种子 × 100 局/档）
set -u
ROOT=/Users/red/Desktop/毛线汽车
D="$ROOT/实验关/产线v6/难度带/长冰密度"
P="$ROOT/实验关/产线v5/C9_插值玩家/PInterpPlayer.js"
for n in 深晚 深更晚 深等; do
  for s in 977 4242; do
    node "$P" "$D/关卡_ZC_140_长冰-${n}.json" \
      --p 0,0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1 --games 100 --seeds $s \
      --out "$D/pinterp/${n}_${s}" > "$D/pinterp/${n}_${s}.log" 2>&1
    echo "done $n $s"
  done
done
echo PINTERP_ALL_DONE
