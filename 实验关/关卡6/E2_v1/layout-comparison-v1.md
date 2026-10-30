# 006 · E2 布局 A/B 对照

## 结论

两个布局满足E2核心约束，E2可以退出。

## 检查

- criticalColorsSame：通过
- capacityMultisetSame：通过
- movedAtLeast8：通过
- firstSixSame：通过
- bothNoPrematureConsume：通过
- bothCriticalRegionChecks：通过
- bothPlayerPathsPass：通过
- bothRevealR59R65：通过
- bothHaveFinale：通过

## 布局差异

- 非关键车辆移动格数：25
- 关键格颜色一致：是
- 容量多重集合一致：是
- 前六步一致：是

## 依赖规模

| 布局 | 消费边 | 揭示边 | 多车区域 | 跨车偿还 | 提前消费 |
|---|---:|---:|---:|---:|---:|
| A | 325 | 181 | 59 | 26 | 0 |
| B | 328 | 185 | 53 | 29 | 0 |

## 揭示与终局

- A：R59第30步，R65第31步。
- B：R59第30步，R65第31步。
- 两个布局均通过默认/0复活PlayerSim和终局债务释放。

