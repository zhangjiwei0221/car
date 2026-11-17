#!/bin/bash
# 用法: 跑插值_9137.sh <关目录> <变体文件> <标签> [seeds]
set -u
ROOT="/Users/red/Desktop/毛线汽车"
D="$ROOT/实验关/产线v6/难度带/复现_开局冰/$1"
F="$D/$2"
T="${3:-$2}"
SEEDS="${4:-977}"
node "$ROOT/实验关/产线v5/C9_插值玩家/PInterpPlayer.js" "$F" \
  --p 0,0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1 --games 100 --seeds "$SEEDS" \
  --out "$D/pinterp_${T}_${SEEDS}" > "$D/pinterp_${T}_${SEEDS}.log" 2>&1
echo "[$1 $T seed$SEEDS] exit=$?"
node "$ROOT/实验关/产线v6/难度带/at4_扫描_v1.js" "$F" > "$D/at4_${T}.txt" 2>&1
echo "[$1 $T] at4: $(cat "$D/at4_${T}.txt" | tr '\n' ' ')"
