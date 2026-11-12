# KnobPlan：关卡_ZC_182_guard0_rx.json

> 意图：`fix-opening`；profile：`low-churn`；规则：`fourSide（四边出口）`；生成 11 个候选，检查 5 个。

## 1. 基线诊断

- 文件：`实验关/产线v5/C13_十关/182/关卡_ZC_182_guard0_rx.json`
- 难度分 D：**65**（hard）
- 硬门：can=✓，peak=4，openM=7，layout hard=0
- 形状：mid=93%，tol=18/20
- 体验：C0@buf<5=0，F0@buf≥3=2，clickForced=Y，policy0=Y
- 选择空间：M=2.6666666666666665，entropy=0.5421844271134462，fake=0，forced=4
- 19 项未过：玩家中段 45–80%=25 步（占比 93%）；玩家后20% 连续≥2=1；最长连续没得选≤2=3 步；at4≥5=1

## 2. 候选排序

| # | 候选 | 类型 | 结论 | D | peak/mid/tol | openM | C0/F0 | clickForced/policy0 | H | 未过项 | 提示 |
|---:|---|---|---|---:|---|---:|---|---|---|---|---|
| 1 | `KP_cap_14_big2small` | capacity_big2small | ✅ 推荐 | 65 | 4/93/18 | 7 | 0/2 | Y/Y | 0.54 | — | tolLoose,entropy<1 |
| 2 | `KP_cap_19_big2small` | capacity_big2small | ✅ 推荐 | 66 | 4/89/16 | 7 | 0/2 | Y/Y | 0.54 | — | tolLoose,entropy<1 |
| 3 | `KP_swap_r0c0_r1c3` | swap_top | ❌ 未过 | 73.8 | 4/100/4 | 7 | 0/2 | Y/Y | 0.60 | mid=100,tol=4 | entropy<1 |
| 4 | `KP_swap_r0c2_r1c3` | swap_top | ❌ 未过 | 73.8 | 4/100/4 | 7 | 0/2 | Y/Y | 0.63 | mid=100,tol=4 | entropy<1 |
| 5 | `KP_swap_r0c1_r1c3` | swap_top | ❌ 未过 | 84.8 | 4/89/19 | 7 | 0/2 | N/N | 0.56 | can=✗,tol=19,clickForced=N,policy0=N | tolLoose,entropy<1 |

## 3. 推荐候选

### 1. `KP_cap_14_big2small`（capacity_big2small）

- 改法：颜色14：r1c3 38→32，r6c3 25→31
- 为什么：同色内把大车容量搬给小车上；总像素不变，债更分散
- 文件：`实验关/产线v5/C13_十关/182/KnobPlan_1794480389134_47808/candidates/KP_cap_14_big2small/KP_cap_14_big2small.json`
- 指标：D **65**（基线 65），peak/mid/tol=4/93/18，openM=7，C0/F0=0/2，clickForced=Y，policy0=Y，H=0.54
- 风险：capacity
- 提示：tolLoose、entropy<1

### 2. `KP_cap_19_big2small`（capacity_big2small）

- 改法：颜色19：r0c1 47→40，r6c1 32→39
- 为什么：同色内把大车容量搬给小车上；总像素不变，债更分散
- 文件：`实验关/产线v5/C13_十关/182/KnobPlan_1794480389134_47808/candidates/KP_cap_19_big2small/KP_cap_19_big2small.json`
- 指标：D **66**（基线 65），peak/mid/tol=4/89/16，openM=7，C0/F0=0/2，clickForced=Y，policy0=Y，H=0.54
- 风险：capacity
- 提示：tolLoose、entropy<1

## 4. 说明

- 这是“单旋钮”候选，不是自动最优解；每个候选只改一个 motif。
- `链组软化` 保留链结构，只降成员容量；`链组拆除` 默认不生成，需 `--allow-chain-remove`。
- 所有指标沿用现有模型：ArlCheck 19 项、点击结算 forced/policy、free-first OpeningCheck、ChoiceSpace、LayoutScore。`--player` 才额外跑 PlayerSim。
- **口径提醒**：默认的 `clickForced/policy0` 是点击结算口径；它不等于 PlayerSim 的 `forced/policy0`。L2/L7 的基线就是“点击结算 policy0=Y、PlayerSim policy0=N”的反例；要判真实玩家 0 复活，必须加 `--player`。
- `profile` 的 mid 区间和 `guards` 是防“降难度=压平”的护栏；D 降低但 mid/entropy 掉了，会被标成“合格但压平”。

## 5. 复现

```bash
node 03_工具/正式版/KnobPlan_v1.js 实验关/产线v5/C13_十关/182/关卡_ZC_182_guard0_rx.json --intent fix-opening --profile low-churn --top 5 --max-candidates 10
```