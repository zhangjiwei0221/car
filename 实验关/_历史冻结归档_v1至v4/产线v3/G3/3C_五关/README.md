# 组3 · 3C_五关

> 组3 定稿候选：L2/L3/L4/L5/L7（L10 不计入组3）。
> L2/L4/L5/L7 = `3B_保链`；L3 = 用户认可的 `3C_试玩/G2_bq_level_3_flat`（peak3/mid32、can✓、PlayerSim p2Y）。

## 文件

- `G2_bq_level_2/3/4/5/7.json`
- `manifest.json`

## 指标

完整对比见 `../../G3_五关_vs_组2_20261110.md`。

关键结论：

- 平均 D 51.7→13.24，C0 3→0，F0 10→0，can 3/5→5/5，点击 forced 3/5→5/5；
- PlayerSim p0 仍 0/5；p2 由 3/5→4/5，**L5 从 Y 变 N**，L2/L3 从 N 变 Y；
- 可先上 A/B：L2/L3/L4/L7；**L5 先别换**，先修真实玩家 p2 退步。

## 复现

```bash
node 03_工具/正式版/RecoveryVariantCheck_v1.js 实验关/产线v3/G3/3C_五关 --out /tmp/g3_five/variants.json
node 03_工具/正式版/DifficultyScore_v1.js --results /tmp/g3_five/variants.json --out /tmp/g3_five/difficulty.json
node 03_工具/正式版/PlayerEngineCheck_v1.js 实验关/产线v3/G3/3C_五关 --out /tmp/g3_five/player.json --family
```
