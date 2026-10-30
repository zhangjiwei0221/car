# 006 · 有界修复验证 v1

## 修复顺序

```text
障碍绑定
→ 关键车位置
→ 单色容量切分
```

每层最多提交一个候选；候选必须提高同一故事合同评分。不进行 seed 搜索，
不重新生成整张棋盘。

## 注入故障

| 故障 | 注入后失败 | 接受层 | 修复动作 |
|---|---|---|---|
| 删除三连锁 | `chain-debt` | obstacles | 恢复 `5,1/5,2/5,3` 同组锁链 |
| 移除管道 | `pipe-queue` | obstacles | 恢复 `6,6` 朝上管道与`13/28`队列 |
| 交换关键入口 | 开局、角色、PlayerSim、压力、链组均失败 | key-cars | `0,0 ↔ 2,1` |
| 颜色31容量偏1 | PlayerSim在44%失败，锁链未释放 | capacity | 颜色14的 `3,1 +1 / 3,3 -1` |

四种场景均在1层内恢复；恢复后重新通过容量、开局、角色路径、全知、
PlayerSim、`buffer 3/4`压力、相邻三连锁和管道queue检查。

## 文件

- `repair-chain-removed.json`
- `repair-key-swap.json`
- `repair-pipe-removed.json`
- `repair-capacity-shift.json`
- 对应的 `repaired-*.json`

## 边界

- 当前修复器只覆盖006 v17故事合同；
- 容量层是有界邻域调整，不代表跨图通用重切；
- 真人可读性仍是未完成验收项。
