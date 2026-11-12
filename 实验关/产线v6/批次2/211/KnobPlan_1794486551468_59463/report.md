# KnobPlan：关卡_ZC_211_guard0_rx.json

> 意图：`fix-opening`；profile：`low-churn`；规则：`fourSide（四边出口）`；生成 11 个候选，检查 5 个。

## 1. 基线诊断

- 文件：`实验关/产线v6/批次2/211/关卡_ZC_211_guard0_rx.json`
- 难度分 D：**36.4**（mid-easy）
- 硬门：can=✓，peak=4，openM=7，layout hard=0
- 形状：mid=100%，tol=20/20
- 体验：C0@buf<5=0，F0@buf≥3=1，clickForced=Y，policy0=Y
- 选择空间：M=6.744186046511628，entropy=1.3097866638146154，fake=6，forced=1
- 19 项未过：玩家中段 45–80%=30 步（占比 100%）

## 2. 候选排序

| # | 候选 | 类型 | 结论 | D | peak/mid/tol | openM | C0/F0 | clickForced/policy0 | H | 未过项 | 提示 |
|---:|---|---|---|---:|---|---:|---|---|---|---|---|
| 1 | `KP_cap_3_big2small` | capacity_big2small | ✅ 推荐 | 35.1 | 4/100/20 | 7 | 0/1 | Y/Y | 1.32 | — | tolLoose |
| 2 | `KP_swap_r0c6_r1c2` | swap_top | ✅ 推荐 | 35.1 | 4/90/20 | 7 | 0/1 | Y/Y | 1.34 | — | tolLoose |
| 3 | `KP_swap_r0c6_r1c1` | swap_top | ✅ 推荐 | 35.8 | 4/90/20 | 7 | 0/1 | Y/Y | 1.32 | — | tolLoose |
| 4 | `KP_cap_28_big2small` | capacity_big2small | ✅ 推荐 | 36.4 | 4/100/20 | 7 | 0/1 | Y/Y | 1.31 | — | tolLoose |
| 5 | `KP_swap_r0c6_r1c0` | swap_top | ❌ 未过 | 36.1 | 3/93/20 | 7 | 0/1 | Y/Y | 1.34 | peak=3 | tolLoose |

## 3. 推荐候选

### 1. `KP_cap_3_big2small`（capacity_big2small）

- 改法：颜色3：r2c2 42→37，r2c3 31→36
- 为什么：同色内把大车容量搬给小车上；总像素不变，债更分散
- 文件：`实验关/产线v6/批次2/211/KnobPlan_1794486551468_59463/candidates/KP_cap_3_big2small/KP_cap_3_big2small.json`
- 指标：D **35.1**（基线 36.4），peak/mid/tol=4/100/20，openM=7，C0/F0=0/1，clickForced=Y，policy0=Y，H=1.32
- 风险：capacity
- 提示：tolLoose

### 2. `KP_swap_r0c6_r1c2`（swap_top）

- 改法：换位 r0c6 ↔ r1c2（颜色25↔31）
- 为什么：整车互换，改变开局暴露顺序；冰随车走
- 文件：`实验关/产线v6/批次2/211/KnobPlan_1794486551468_59463/candidates/KP_swap_r0c6_r1c2/KP_swap_r0c6_r1c2.json`
- 指标：D **35.1**（基线 36.4），peak/mid/tol=4/90/20，openM=7，C0/F0=0/1，clickForced=Y，policy0=Y，H=1.34
- 风险：position
- 提示：tolLoose

### 3. `KP_swap_r0c6_r1c1`（swap_top）

- 改法：换位 r0c6 ↔ r1c1（颜色25↔5）
- 为什么：整车互换，改变开局暴露顺序；冰随车走
- 文件：`实验关/产线v6/批次2/211/KnobPlan_1794486551468_59463/candidates/KP_swap_r0c6_r1c1/KP_swap_r0c6_r1c1.json`
- 指标：D **35.8**（基线 36.4），peak/mid/tol=4/90/20，openM=7，C0/F0=0/1，clickForced=Y，policy0=Y，H=1.32
- 风险：position
- 提示：tolLoose

### 4. `KP_cap_28_big2small`（capacity_big2small）

- 改法：颜色28：r4c3 54→48，r2c5 42→48
- 为什么：同色内把大车容量搬给小车上；总像素不变，债更分散
- 文件：`实验关/产线v6/批次2/211/KnobPlan_1794486551468_59463/candidates/KP_cap_28_big2small/KP_cap_28_big2small.json`
- 指标：D **36.4**（基线 36.4），peak/mid/tol=4/100/20，openM=7，C0/F0=0/1，clickForced=Y，policy0=Y，H=1.31
- 风险：capacity
- 提示：tolLoose

## 4. 说明

- 这是“单旋钮”候选，不是自动最优解；每个候选只改一个 motif。
- `链组软化` 保留链结构，只降成员容量；`链组拆除` 默认不生成，需 `--allow-chain-remove`。
- 所有指标沿用现有模型：ArlCheck 19 项、点击结算 forced/policy、free-first OpeningCheck、ChoiceSpace、LayoutScore。`--player` 才额外跑 PlayerSim。
- **口径提醒**：默认的 `clickForced/policy0` 是点击结算口径；它不等于 PlayerSim 的 `forced/policy0`。L2/L7 的基线就是“点击结算 policy0=Y、PlayerSim policy0=N”的反例；要判真实玩家 0 复活，必须加 `--player`。
- `profile` 的 mid 区间和 `guards` 是防“降难度=压平”的护栏；D 降低但 mid/entropy 掉了，会被标成“合格但压平”。

## 5. 复现

```bash
node 03_工具/正式版/KnobPlan_v1.js 实验关/产线v6/批次2/211/关卡_ZC_211_guard0_rx.json --intent fix-opening --profile low-churn --top 5 --max-candidates 10
```