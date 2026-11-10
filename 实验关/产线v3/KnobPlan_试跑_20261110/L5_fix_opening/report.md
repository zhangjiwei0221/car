# KnobPlan：G2_bq_level_5.json

> 意图：`fix-opening`；profile：`low-churn`；生成 39 个候选，检查 4 个。

## 1. 基线诊断

- 文件：`实验关/产线v3/G3/3B_保链/G2_bq_level_5.json`
- 难度分 D：**7**（easy）
- 硬门：can=✓，peak=3，openM=3，layout hard=0
- 形状：mid=47%，tol=19/20
- 体验：C0@buf<5=0，F0@buf≥3=0，clickForced=Y，policy0=Y
- 选择空间：M=7.346938775510204，entropy=1.502587889901934，fake=7，forced=1
- 19 项未过：峰值=4=3；中段最长低压≤5=14 步（buf≤1 连续）；象限并行度≤3.6=3.69（49 步）；全程最少未动主体≥1=最少 0，平均 1.45/4；容错 55–75%=19/20；开局可点≥5=3 辆；at4≥5=0

## 2. 候选排序

| # | 候选 | 类型 | 结论 | D | peak/mid/tol | openM | C0/F0 | clickForced/policy0 | H | 未过项 |
|---:|---|---|---|---:|---|---:|---|---|---|---|
| 1 | `KP_relief_transfer_r0c6` | relief_transfer | ❌ 未过 | 3.3 | 3/21/20 | 4 | 0/0 | Y/Y | 1.60 | openM=4,mid=21,tol=20,midDrop=26,midFlat=21 |
| 2 | `KP_relief_transfer_r0c5` | relief_transfer | ❌ 未过 | 10.8 | 3/0/6 | 4 | 0/0 | Y/Y | 1.58 | openM=4,mid=0,tol=6,midDrop=47,midFlat=0 |
| 3 | `KP_swap_r0c1_r1c1` | swap_top | ❌ 未过 | 83.3 | 3/21/16 | 3 | 2/5 | Y/Y | 0.96 | openM=3,mid=21,C0=2,F0=5,midDrop=26,entropyDrop=0.55,midFlat=21 |
| 4 | `KP_swap_r0c1_r1c2` | swap_top | ❌ 未过 | 5 | 2/47/20 | 2 | 0/0 | Y/Y | 1.50 | peak=2,openM=2,tol=20,peak<3 |

## 3. 推荐候选

没有候选同时满足 profile 和“不压平”护栏。看上面未过项，优先修硬门，不要继续降难度。
## 4. 说明

- 这是“单旋钮”候选，不是自动最优解；每个候选只改一个 motif。
- `链组软化` 保留链结构，只降成员容量；`链组拆除` 默认不生成，需 `--allow-chain-remove`。
- 所有指标沿用现有模型：ArlCheck 19 项、点击结算 forced/policy、free-first OpeningCheck、ChoiceSpace、LayoutScore。`--player` 才额外跑 PlayerSim。
- `profile` 的 mid 区间和 `guards` 是防“降难度=压平”的护栏；D 降低但 mid/entropy 掉了，会被标成“合格但压平”。

## 5. 复现

```bash
node 03_工具/正式版/KnobPlan_v1.js 实验关/产线v3/G3/3B_保链/G2_bq_level_5.json --intent fix-opening --profile low-churn --top 4 --max-candidates 4
```