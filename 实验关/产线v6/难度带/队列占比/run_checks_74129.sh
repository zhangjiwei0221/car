#!/bin/bash
# run_checks_74129.sh —— 队列占比实验：单档全套硬门 + 测量
# 用法: bash run_checks_74129.sh <关卡.json> <输出目录>
# pid 74129；只读工具，产物写进输出目录。
set -u
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
LEVEL="$1"
OUT="$2"
mkdir -p "$OUT"
cd "$ROOT" || exit 1
T=03_工具/正式版
D=实验关/产线v6/难度带

echo "== 空块检查" | tee "$OUT/检查汇总.txt"
node $T/EmptyCheck_v760.js "$LEVEL" > "$OUT/空块检查.txt" 2>&1
echo "空块: $(tail -1 "$OUT/空块检查.txt")" | tee -a "$OUT/检查汇总.txt"

echo "== 可通关" | tee -a "$OUT/检查汇总.txt"
for w in 8 16 32; do
  node $T/Solvable_v1.js "$LEVEL" --width $w --timeout 120 --out "$OUT/可通关_w$w.json" >/dev/null 2>&1
  echo "w$w: $(cat "$OUT/可通关_w$w.json" | tr -d '\n' | head -c 200)" | tee -a "$OUT/检查汇总.txt"
done

echo "== 棘轮" | tee -a "$OUT/检查汇总.txt"
node $T/ChainRatchetCheck_v1.js "$LEVEL" --out "$OUT/棘轮.json" > "$OUT/棘轮.txt" 2>&1
python3 - "$OUT/棘轮.json" <<'PY' | tee -a "$OUT/检查汇总.txt"
import json,sys
try:
    d=json.load(open(sys.argv[1]))
    print(d.get('summary', d))
except Exception as e: print('棘轮读取失败',e)
PY

echo "== 逃生阀" | tee -a "$OUT/检查汇总.txt"
node $T/EscapeValveCheck_v1.js "$LEVEL" --json --out "$OUT/逃生阀.json" > "$OUT/逃生阀.txt" 2>&1
python3 - "$OUT/逃生阀.json" <<'PY' | tee -a "$OUT/检查汇总.txt"
import json,sys
d=json.load(open(sys.argv[1]))['results'][0]
print({'ok':d['ok'],'hits':len(d['hits']),'valves':len(d['valves'])})
PY

echo "== 守恒(含管道)" | tee -a "$OUT/检查汇总.txt"
node $D/闭环_靶向清理/守恒_含管道_v1.js "$LEVEL" "$OUT/守恒.json" | tee -a "$OUT/检查汇总.txt"

echo "== Layout" | tee -a "$OUT/检查汇总.txt"
node $T/LayoutScore_v1.js "$LEVEL" --out "$OUT/layout.json" > "$OUT/layout.txt" 2>&1
echo "$(tail -1 "$OUT/layout.txt" | head -c 200)" | tee -a "$OUT/检查汇总.txt"

echo "== 开管" | tee -a "$OUT/检查汇总.txt"
node $D/管道研究/openprobe_27995.js "$LEVEL" > "$OUT/openprobe.txt" 2>&1
cat "$OUT/openprobe.txt" | tee -a "$OUT/检查汇总.txt"
for s in 977 4242; do
  node $D/管道研究/pipeopen_random_27995.js "$LEVEL" --games 100 --seed $s > "$OUT/open_random_$s.txt" 2>&1
  echo "random $s: $(cat "$OUT/open_random_$s.txt" | tr '\n' ' ' | head -c 300)" | tee -a "$OUT/检查汇总.txt"
done

echo "== at4" | tee -a "$OUT/检查汇总.txt"
node $D/at4_扫描_v1.js "$LEVEL" > "$OUT/at4.txt" 2>&1
cat "$OUT/at4.txt" | tee -a "$OUT/检查汇总.txt"

echo "== pinterp" | tee -a "$OUT/检查汇总.txt"
for s in 977 4242; do
  node 实验关/产线v5/C9_插值玩家/PInterpPlayer.js "$LEVEL" \
    --p 0,0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1 --games 100 --seeds $s \
    --out "$OUT/pinterp_$s" > "$OUT/pinterp_$s.log" 2>&1
  node $D/闭环_靶向清理/汇总_v1.js "$OUT/pinterp_$s" | tee -a "$OUT/检查汇总.txt"
done
echo "done $OUT"
