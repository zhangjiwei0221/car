# KnobPlan：关卡_ZC_154b_guard0_rx.json

> 意图：`fix-opening`；profile：`low-churn`；规则：`fourSide（四边出口）`；生成 17 个候选，检查 5 个。

## 1. 基线诊断

- 文件：`实验关/产线v5/C13_十关/154/关卡_ZC_154b_guard0_rx.json`
- 难度分 D：**32.2**（mid-easy）
- 硬门：can=✓，peak=4，openM=6，layout hard=0
- 形状：mid=93%，tol=20/20
- 体验：C0@buf<5=0，F0@buf≥3=1，clickForced=Y，policy0=Y
- 选择空间：M=7.069767441860465，entropy=1.3891466070120577，fake=5，forced=1
- 19 项未过：最长连续免费≤5=7 步；玩家中段 45–80%=28 步（占比 93%）；中段最长低压≤5=9 步（buf≤1 连续）；玩家后20% at3≥2=1 步；玩家后20% 连续≥2=1；at4≥5=1

## 2. 候选排序

| # | 候选 | 类型 | 结论 | D | peak/mid/tol | openM | C0/F0 | clickForced/policy0 | H | 未过项 | 提示 |
|---:|---|---|---|---:|---|---:|---|---|---|---|---|
| 1 | `KP_cap_31_big2small` | capacity_big2small | ✅ 推荐 | 32.2 | 4/93/20 | 6 | 0/1 | Y/Y | 1.39 | — | tolLoose |
| 2 | `KP_swap_r0c3_r1c2` | swap_top | ✅ 推荐 | 32.2 | 4/93/18 | 6 | 0/1 | Y/Y | 1.39 | — | tolLoose |
| 3 | `KP_cap_25_big2small` | capacity_big2small | ✅ 推荐 | 33.8 | 4/93/14 | 6 | 0/1 | Y/Y | 1.42 | — | — |
| 4 | `KP_swap_r0c3_r1c0` | swap_top | ✅ 推荐 | 40.5 | 4/93/20 | 6 | 0/1 | Y/Y | 1.24 | — | tolLoose |
| 5 | `KP_swap_r0c3_r1c1` | swap_top | ❌ 未过 | 58.5 | 4/50/0 | 6 | 1/2 | Y/Y | 1.10 | tol=0,C0=1,midDrop=43,entropyDrop=0.29 | midCross80(D惩罚) |

## 3. 推荐候选

### 1. `KP_cap_31_big2small`（capacity_big2small）

- 改法：颜色31：r2c4 49→42，r5c3 34→41
- 为什么：同色内把大车容量搬给小车上；总像素不变，债更分散
- 文件：`实验关/产线v5/C13_十关/154/KnobPlan_1794482124666_53949/candidates/KP_cap_31_big2small/KP_cap_31_big2small.json`
- 指标：D **32.2**（基线 32.2），peak/mid/tol=4/93/20，openM=6，C0/F0=0/1，clickForced=Y，policy0=Y，H=1.39
- 风险：touches-chain
- 提示：tolLoose

### 2. `KP_swap_r0c3_r1c2`（swap_top）

- 改法：换位 r0c3 ↔ r1c2（颜色27↔13）
- 为什么：整车互换，改变开局暴露顺序；冰随车走
- 文件：`实验关/产线v5/C13_十关/154/KnobPlan_1794482124666_53949/candidates/KP_swap_r0c3_r1c2/KP_swap_r0c3_r1c2.json`
- 指标：D **32.2**（基线 32.2），peak/mid/tol=4/93/18，openM=6，C0/F0=0/1，clickForced=Y，policy0=Y，H=1.39
- 风险：position
- 提示：tolLoose

### 3. `KP_cap_25_big2small`（capacity_big2small）

- 改法：颜色25：r0c0 50→42，r4c2 34→42
- 为什么：同色内把大车容量搬给小车上；总像素不变，债更分散
- 文件：`实验关/产线v5/C13_十关/154/KnobPlan_1794482124666_53949/candidates/KP_cap_25_big2small/KP_cap_25_big2small.json`
- 指标：D **33.8**（基线 32.2），peak/mid/tol=4/93/14，openM=6，C0/F0=0/1，clickForced=Y，policy0=Y，H=1.42
- 风险：touches-chain
- 提示：无

### 4. `KP_swap_r0c3_r1c0`（swap_top）

- 改法：换位 r0c3 ↔ r1c0（颜色27↔26）
- 为什么：整车互换，改变开局暴露顺序；冰随车走
- 文件：`实验关/产线v5/C13_十关/154/KnobPlan_1794482124666_53949/candidates/KP_swap_r0c3_r1c0/KP_swap_r0c3_r1c0.json`
- 指标：D **40.5**（基线 32.2），peak/mid/tol=4/93/20，openM=6，C0/F0=0/1，clickForced=Y，policy0=Y，H=1.24
- 风险：position
- 提示：tolLoose

## 4. 说明

- 这是“单旋钮”候选，不是自动最优解；每个候选只改一个 motif。
- `链组软化` 保留链结构，只降成员容量；`链组拆除` 默认不生成，需 `--allow-chain-remove`。
- 所有指标沿用现有模型：ArlCheck 19 项、点击结算 forced/policy、free-first OpeningCheck、ChoiceSpace、LayoutScore。`--player` 才额外跑 PlayerSim。
- **口径提醒**：默认的 `clickForced/policy0` 是点击结算口径；它不等于 PlayerSim 的 `forced/policy0`。L2/L7 的基线就是“点击结算 policy0=Y、PlayerSim policy0=N”的反例；要判真实玩家 0 复活，必须加 `--player`。
- `profile` 的 mid 区间和 `guards` 是防“降难度=压平”的护栏；D 降低但 mid/entropy 掉了，会被标成“合格但压平”。

## 5. 复现

```bash
node 03_工具/正式版/KnobPlan_v1.js 实验关/产线v5/C13_十关/154/关卡_ZC_154b_guard0_rx.json --intent fix-opening --profile low-churn --top 5 --max-candidates 10
```