# KnobPlan：关卡_ZC_61_guard0_build.json

> 意图：`fix-opening`；profile：`low-churn`；规则：`fourSide（四边出口）`；生成 25 个候选，检查 5 个。

## 1. 基线诊断

- 文件：`实验关/产线v5/C13_十关/61/关卡_ZC_61_guard0_build.json`
- 难度分 D：**27**（mid-easy）
- 硬门：can=✓，peak=4，openM=8，layout hard=0
- 形状：mid=100%，tol=20/20
- 体验：C0@buf<5=0，F0@buf≥3=1，clickForced=Y，policy0=Y
- 选择空间：M=11.27027027027027，entropy=1.4492662194457147，fake=17，forced=1
- 19 项未过：最长连续免费≤5=27 步；玩家中段 45–80%=25 步（占比 100%）；中段最长低压≤5=25 步（buf≤1 连续）；at4≥5=1；无空格=6；容量守恒=1397/1600

## 2. 候选排序

| # | 候选 | 类型 | 结论 | D | peak/mid/tol | openM | C0/F0 | clickForced/policy0 | H | 未过项 | 提示 |
|---:|---|---|---|---:|---|---:|---|---|---|---|---|
| 1 | `KP_swap_r0c0_r1c2` | swap_top | ✅ 推荐 | 26.4 | 4/100/20 | 8 | 0/1 | Y/Y | 1.47 | — | tolLoose |
| 2 | `KP_swap_r0c0_r1c1` | swap_top | ✅ 推荐 | 27 | 4/100/20 | 8 | 0/1 | Y/Y | 1.45 | — | tolLoose |
| 3 | `KP_swap_r0c0_r1c3` | swap_top | ✅ 推荐 | 27.6 | 4/100/20 | 8 | 0/1 | Y/Y | 1.44 | — | tolLoose |
| 4 | `KP_cap_1_big2small` | capacity_big2small | ✅ 推荐 | 27.9 | 4/100/20 | 8 | 0/1 | Y/Y | 1.43 | — | tolLoose |
| 5 | `KP_cap_14_big2small` | capacity_big2small | ✅ 推荐 | 28.2 | 4/100/20 | 8 | 0/1 | Y/Y | 1.42 | — | tolLoose |

## 3. 推荐候选

### 1. `KP_swap_r0c0_r1c2`（swap_top）

- 改法：换位 r0c0 ↔ r1c2（颜色5↔14）
- 为什么：整车互换，改变开局暴露顺序；冰随车走
- 文件：`实验关/产线v5/C13_十关/61/KnobPlan_1794480756262_49490/candidates/KP_swap_r0c0_r1c2/KP_swap_r0c0_r1c2.json`
- 指标：D **26.4**（基线 27），peak/mid/tol=4/100/20，openM=8，C0/F0=0/1，clickForced=Y，policy0=Y，H=1.47
- 风险：position
- 提示：tolLoose

### 2. `KP_swap_r0c0_r1c1`（swap_top）

- 改法：换位 r0c0 ↔ r1c1（颜色5↔8）
- 为什么：整车互换，改变开局暴露顺序；冰随车走
- 文件：`实验关/产线v5/C13_十关/61/KnobPlan_1794480756262_49490/candidates/KP_swap_r0c0_r1c1/KP_swap_r0c0_r1c1.json`
- 指标：D **27**（基线 27），peak/mid/tol=4/100/20，openM=8，C0/F0=0/1，clickForced=Y，policy0=Y，H=1.45
- 风险：position
- 提示：tolLoose

### 3. `KP_swap_r0c0_r1c3`（swap_top）

- 改法：换位 r0c0 ↔ r1c3（颜色5↔1）
- 为什么：整车互换，改变开局暴露顺序；冰随车走
- 文件：`实验关/产线v5/C13_十关/61/KnobPlan_1794480756262_49490/candidates/KP_swap_r0c0_r1c3/KP_swap_r0c0_r1c3.json`
- 指标：D **27.6**（基线 27），peak/mid/tol=4/100/20，openM=8，C0/F0=0/1，clickForced=Y，policy0=Y，H=1.44
- 风险：position
- 提示：tolLoose

### 4. `KP_cap_1_big2small`（capacity_big2small）

- 改法：颜色1：r1c3 34→30，r5c6 25→29
- 为什么：同色内把大车容量搬给小车上；总像素不变，债更分散
- 文件：`实验关/产线v5/C13_十关/61/KnobPlan_1794480756262_49490/candidates/KP_cap_1_big2small/KP_cap_1_big2small.json`
- 指标：D **27.9**（基线 27），peak/mid/tol=4/100/20，openM=8，C0/F0=0/1，clickForced=Y，policy0=Y，H=1.43
- 风险：touches-chain
- 提示：tolLoose

### 5. `KP_cap_14_big2small`（capacity_big2small）

- 改法：颜色14：r1c2 34→29，r6c4 21→26
- 为什么：同色内把大车容量搬给小车上；总像素不变，债更分散
- 文件：`实验关/产线v5/C13_十关/61/KnobPlan_1794480756262_49490/candidates/KP_cap_14_big2small/KP_cap_14_big2small.json`
- 指标：D **28.2**（基线 27），peak/mid/tol=4/100/20，openM=8，C0/F0=0/1，clickForced=Y，policy0=Y，H=1.42
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
node 03_工具/正式版/KnobPlan_v1.js 实验关/产线v5/C13_十关/61/关卡_ZC_61_guard0_build.json --intent fix-opening --profile low-churn --top 5 --max-candidates 10
```