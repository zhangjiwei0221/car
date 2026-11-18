# KnobPlan：关卡_ZC_190_new_guard0_rx.json

> 意图：`fix-opening`；profile：`low-churn`；规则：`fourSide（四边出口）`；生成 30 个候选，检查 5 个。

## 1. 基线诊断

- 文件：`实验关/产线v6/难度带/新关_190/关卡_ZC_190_new_guard0_rx.json`
- 难度分 D：**39.3**（mid-easy）
- 硬门：can=✓，peak=3，openM=7，layout hard=0
- 形状：mid=93%，tol=9/20
- 体验：C0@buf<5=0，F0@buf≥3=1，clickForced=Y，policy0=Y
- 选择空间：M=6.853658536585366，entropy=1.3690459049154364，fake=2，forced=1
- 19 项未过：峰值=4=3；最长连续免费≤5=15 步；玩家中段 45–80%=26 步（占比 93%）；中段最长低压≤5=16 步（buf≤1 连续）；at4≥5=0

## 2. 候选排序

| # | 候选 | 类型 | 结论 | D | peak/mid/tol | openM | C0/F0 | clickForced/policy0 | H | 未过项 | 提示 |
|---:|---|---|---|---:|---|---:|---|---|---|---|---|
| 1 | `KP_cap_14_big2small` | capacity_big2small | ✅ 推荐 | 38.8 | 3/93/11 | 7 | 0/1 | Y/Y | 1.35 | — | — |
| 2 | `KP_swap_r0c0_r1c1` | swap_top | ✅ 推荐 | 40.1 | 3/93/9 | 7 | 0/1 | Y/Y | 1.35 | — | — |
| 3 | `KP_cap_15_big2small` | capacity_big2small | ❌ 未过 | 36.7 | 3/96/8 | 7 | 0/1 | Y/Y | 1.36 | mid=96,tol=8 | — |
| 4 | `KP_swap_r0c0_r1c0` | swap_top | ❌ 未过 | 42.6 | 4/93/4 | 6 | 0/1 | Y/Y | 1.37 | peak=4,tol=4 | — |
| 5 | `KP_swap_r0c0_r1c2` | swap_top | ❌ 未过 | 46.2 | 4/96/5 | 6 | 0/0 | Y/Y | 1.20 | peak=4,mid=96,tol=5 | — |

## 3. 推荐候选

### 1. `KP_cap_14_big2small`（capacity_big2small）

- 改法：颜色14：r0c0 60→52，r4c1 43→51
- 为什么：同色内把大车容量搬给小车上；总像素不变，债更分散
- 文件：`实验关/产线v6/难度带/新关_190/KnobPlan_1795035922231_63138/candidates/KP_cap_14_big2small/KP_cap_14_big2small.json`
- 指标：D **38.8**（基线 39.3），peak/mid/tol=3/93/11，openM=7，C0/F0=0/1，clickForced=Y，policy0=Y，H=1.35
- 风险：touches-chain
- 提示：无

### 2. `KP_swap_r0c0_r1c1`（swap_top）

- 改法：换位 r0c0 ↔ r1c1（颜色14↔15）
- 为什么：整车互换，改变开局暴露顺序；冰随车走
- 文件：`实验关/产线v6/难度带/新关_190/KnobPlan_1795035922231_63138/candidates/KP_swap_r0c0_r1c1/KP_swap_r0c0_r1c1.json`
- 指标：D **40.1**（基线 39.3），peak/mid/tol=3/93/9，openM=7，C0/F0=0/1，clickForced=Y，policy0=Y，H=1.35
- 风险：position
- 提示：无

## 4. 说明

- 这是“单旋钮”候选，不是自动最优解；每个候选只改一个 motif。
- `链组软化` 保留链结构，只降成员容量；`链组拆除` 默认不生成，需 `--allow-chain-remove`。
- 所有指标沿用现有模型：ArlCheck 19 项、点击结算 forced/policy、free-first OpeningCheck、ChoiceSpace、LayoutScore。`--player` 才额外跑 PlayerSim。
- **口径提醒**：默认的 `clickForced/policy0` 是点击结算口径；它不等于 PlayerSim 的 `forced/policy0`。L2/L7 的基线就是“点击结算 policy0=Y、PlayerSim policy0=N”的反例；要判真实玩家 0 复活，必须加 `--player`。
- `profile` 的 mid 区间和 `guards` 是防“降难度=压平”的护栏；D 降低但 mid/entropy 掉了，会被标成“合格但压平”。

## 5. 复现

```bash
node 03_工具/正式版/KnobPlan_v1.js 实验关/产线v6/难度带/新关_190/关卡_ZC_190_new_guard0_rx.json --intent fix-opening --profile low-churn --top 5 --max-candidates 10
```