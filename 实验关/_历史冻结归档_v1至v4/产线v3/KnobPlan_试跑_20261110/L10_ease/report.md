# KnobPlan：G2_bq_level_10.json

> 意图：`ease`；profile：`low-churn`；生成 32 个候选，检查 4 个。

## 1. 基线诊断

- 文件：`实验关/产线v3/G3/3B_保链/G2_bq_level_10.json`
- 难度分 D：**23.4**（mid-easy）
- 硬门：can=✓，peak=4，openM=4，layout hard=0
- 形状：mid=63%，tol=20/20
- 体验：C0@buf<5=0，F0@buf≥3=2，clickForced=Y，policy0=Y
- 选择空间：M=7.25，entropy=1.3057179162128225，fake=3，forced=2
- 19 项未过：最长连续免费≤5=6 步；中段最长低压≤5=9 步（buf≤1 连续）；全程最少未动主体≥1=最少 0，平均 1.56/4；容错 55–75%=20/20；开局可点≥5=4 辆；at4≥5=2

## 2. 候选排序

| # | 候选 | 类型 | 结论 | D | peak/mid/tol | openM | C0/F0 | clickForced/policy0 | H | 未过项 |
|---:|---|---|---|---:|---|---:|---|---|---|---|
| 1 | `KP_swap_r0c4_r1c2` | swap_top | ❌ 未过 | 24 | 4/63/20 | 4 | 0/2 | Y/Y | 1.29 | openM=4,DNotDown=24 |
| 2 | `KP_swap_r0c4_r1c1` | swap_top | ❌ 未过 | 24.3 | 4/63/20 | 3 | 0/2 | Y/Y | 1.32 | openM=3,DNotDown=24.3 |
| 3 | `KP_swap_r0c4_r1c3` | swap_top | ❌ 未过 | 35.2 | 4/63/15 | 4 | 0/1 | Y/Y | 1.06 | openM=4,DNotDown=35.2 |
| 4 | `KP_relief_split_r0c5` | relief_split | ❌ 未过 | 41.8 | 3/13/0 | 5 | 0/1 | Y/Y | 1.16 | peak=3,mid=13,tol=0,midDrop=50,midFlat=13,DNotDown=41.8 |

## 3. 推荐候选

没有候选同时满足 profile 和“不压平”护栏。看上面未过项，优先修硬门，不要继续降难度。
## 4. 说明

- 这是“单旋钮”候选，不是自动最优解；每个候选只改一个 motif。
- `链组软化` 保留链结构，只降成员容量；`链组拆除` 默认不生成，需 `--allow-chain-remove`。
- 所有指标沿用现有模型：ArlCheck 19 项、点击结算 forced/policy、free-first OpeningCheck、ChoiceSpace、LayoutScore。`--player` 才额外跑 PlayerSim。
- `profile` 的 mid 区间和 `guards` 是防“降难度=压平”的护栏；D 降低但 mid/entropy 掉了，会被标成“合格但压平”。

## 5. 复现

```bash
node 03_工具/正式版/KnobPlan_v1.js 实验关/产线v3/G3/3B_保链/G2_bq_level_10.json --intent ease --profile low-churn --top 4 --max-candidates 4
```