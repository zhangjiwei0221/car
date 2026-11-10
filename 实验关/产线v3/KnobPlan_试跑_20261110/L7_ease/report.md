# KnobPlan：G2_bq_level_7.json

> 意图：`ease`；profile：`low-churn`；生成 34 个候选，检查 4 个。

## 1. 基线诊断

- 文件：`实验关/产线v3/G3/3B_保链/G2_bq_level_7.json`
- 难度分 D：**22.1**（mid-easy）
- 硬门：can=✓，peak=4，openM=6，layout hard=0
- 形状：mid=84%，tol=20/20
- 体验：C0@buf<5=0，F0@buf≥3=0，clickForced=Y，policy0=Y
- 选择空间：M=7.5227272727272725，entropy=1.444595728275975，fake=4，forced=1
- 19 项未过：最长连续免费≤5=34 步；玩家中段 45–80%=26 步（占比 84%）；中段最长低压≤5=31 步（buf≤1 连续）；象限并行度≤3.6=3.86（44 步）；主体并行度≤65%=3.27/4，82%；全程最少未动主体≥1=最少 0，平均 0.73/4；容错 55–75%=20/20；at4≥5=1

## 2. 候选排序

| # | 候选 | 类型 | 结论 | D | peak/mid/tol | openM | C0/F0 | clickForced/policy0 | H | 未过项 | 提示 |
|---:|---|---|---|---:|---|---:|---|---|---|---|---|
| 1 | `KP_ice75_r4c4` | ice75 | ✅ 推荐 | 21.2 | 4/81/20 | 6 | 0/0 | Y/Y | 1.44 | — | tolLoose |
| 2 | `KP_ice75_r0c1` | ice75 | ✅ 推荐 | 4.9 | 4/74/20 | 6 | 0/0 | Y/Y | 1.44 | — | Ddrop>15,tolLoose,midCross80(D惩罚) |
| 3 | `KP_cap_14_big2small` | capacity_big2small | ✅ 推荐 | 6.5 | 4/77/20 | 6 | 0/0 | Y/Y | 1.44 | — | Ddrop>15,tolLoose,midCross80(D惩罚) |
| 4 | `KP_cap_13_big2small` | capacity_big2small | ❌ 未过 | 19.7 | 3/84/20 | 6 | 0/0 | Y/Y | 1.50 | peak=3 | tolLoose |

## 3. 推荐候选

### 1. `KP_ice75_r4c4`（ice75）

- 改法：冰 r4c4 23→17
- 为什么：只降低一个冰的延迟；不拆链、不改容量
- 文件：`实验关/产线v3/KnobPlan_试跑_20261110/L7_ease/candidates/KP_ice75_r4c4/KP_ice75_r4c4.json`
- 指标：D **21.2**（基线 22.1），peak/mid/tol=4/81/20，openM=6，C0/F0=0/0，clickForced=Y，policy0=Y，H=1.44
- 风险：touches-ice
- 提示：tolLoose

### 2. `KP_ice75_r0c1`（ice75）

- 改法：冰 r0c1 15→11
- 为什么：只降低一个冰的延迟；不拆链、不改容量
- 文件：`实验关/产线v3/KnobPlan_试跑_20261110/L7_ease/candidates/KP_ice75_r0c1/KP_ice75_r0c1.json`
- 指标：D **4.9**（基线 22.1），peak/mid/tol=4/74/20，openM=6，C0/F0=0/0，clickForced=Y，policy0=Y，H=1.44
- 风险：touches-ice
- 提示：Ddrop>15、tolLoose、midCross80(D惩罚)

### 3. `KP_cap_14_big2small`（capacity_big2small）

- 改法：颜色14：r1c1 50→42，r3c0 21→29
- 为什么：同色内把大车容量搬给小车上；总像素不变，债更分散
- 文件：`实验关/产线v3/KnobPlan_试跑_20261110/L7_ease/candidates/KP_cap_14_big2small/KP_cap_14_big2small.json`
- 指标：D **6.5**（基线 22.1），peak/mid/tol=4/77/20，openM=6，C0/F0=0/0，clickForced=Y，policy0=Y，H=1.44
- 风险：capacity
- 提示：Ddrop>15、tolLoose、midCross80(D惩罚)

## 4. 说明

- 这是“单旋钮”候选，不是自动最优解；每个候选只改一个 motif。
- `链组软化` 保留链结构，只降成员容量；`链组拆除` 默认不生成，需 `--allow-chain-remove`。
- 所有指标沿用现有模型：ArlCheck 19 项、点击结算 forced/policy、free-first OpeningCheck、ChoiceSpace、LayoutScore。`--player` 才额外跑 PlayerSim。
- **口径提醒**：默认的 `clickForced/policy0` 是点击结算口径；它不等于 PlayerSim 的 `forced/policy0`。L2/L7 的基线就是“点击结算 policy0=Y、PlayerSim policy0=N”的反例；要判真实玩家 0 复活，必须加 `--player`。
- `profile` 的 mid 区间和 `guards` 是防“降难度=压平”的护栏；D 降低但 mid/entropy 掉了，会被标成“合格但压平”。

## 5. 复现

```bash
node 03_工具/正式版/KnobPlan_v1.js 实验关/产线v3/G3/3B_保链/G2_bq_level_7.json --intent ease --profile low-churn --top 4 --max-candidates 4
```