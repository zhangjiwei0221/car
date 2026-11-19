#!/bin/bash
# at4 扫描（冰剂量实验，pid 662）：p0.1/0.2 ×100 局，seed 977（脚本内置）
set -u
ROOT=/Users/red/Desktop/毛线汽车
D="$ROOT/实验关/产线v6/难度带/冰剂量"
SC="$ROOT/实验关/产线v6/难度带/at4_扫描_v1.js"
declare -a NAMES=(base A B C D E)
declare -a FILES=(
  "$ROOT/实验关/产线v6/难度带/试造_140/关卡_ZC_140_final.json"
  "$D/关卡_ZC_140_冰A.json"
  "$D/关卡_ZC_140_冰B.json"
  "$D/关卡_ZC_140_冰C.json"
  "$D/关卡_ZC_140_冰D.json"
  "$D/关卡_ZC_140_冰E.json"
)
for i in "${!NAMES[@]}"; do
  echo "----- ${NAMES[$i]}"
  node "$SC" "${FILES[$i]}"
done
echo AT4_DONE
