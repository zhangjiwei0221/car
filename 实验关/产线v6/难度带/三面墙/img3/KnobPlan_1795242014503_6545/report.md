# KnobPlan：关卡_ZC_W3_guard0_rx.json

> 意图：`fix-opening`；profile：`low-churn`；规则：`fourSide（四边出口）`；生成 12 个候选，检查 5 个。

## 1. 基线诊断

- 文件：`实验关/产线v6/难度带/三面墙/img3/关卡_ZC_W3_guard0_rx.json`
- 难度分 D：**57.5**（mid-hard）
- 硬门：can=✓，peak=4，openM=7，layout hard=0
- 形状：mid=83%，tol=20/20
- 体验：C0@buf<5=0，F0@buf≥3=1，clickForced=Y，policy0=Y
- 选择空间：M=3.25，entropy=0.7709210036834782，fake=1，forced=0
- 19 项未过：玩家中段 45–80%=25 步（占比 83%）；中段最长低压≤5=22 步（buf≤1 连续）；玩家后20% at3≥2=0 步；玩家后20% 连续≥2=0

## 2. 候选排序

| # | 候选 | 类型 | 结论 | D | peak/mid/tol | openM | C0/F0 | clickForced/policy0 | H | 未过项 | 提示 |
|---:|---|---|---|---:|---|---:|---|---|---|---|---|
| 1 | `KP_cap_19_big2small` | capacity_big2small | ✅ 推荐 | 57.5 | 4/83/20 | 7 | 0/1 | Y/Y | 0.77 | — | tolLoose,entropy<1 |
| 2 | `KP_swap_r0c0_r1c2` | swap_top | ✅ 推荐 | 58.8 | 4/80/18 | 7 | 0/2 | Y/Y | 0.68 | — | tolLoose,entropy<1 |
| 3 | `KP_swap_r0c0_r1c1` | swap_top | ✅ 推荐 | 27.5 | 4/73/18 | 6 | 0/1 | Y/Y | 1.08 | — | Ddrop>15,tolLoose,midCross80(D惩罚) |
| 4 | `KP_cap_15_big2small` | capacity_big2small | ❌ 未过 | 58.5 | 4/87/20 | 7 | 0/1 | Y/Y | 0.77 | mid=87 | tolLoose,entropy<1 |
| 5 | `KP_swap_r0c0_r1c0` | swap_top | ❌ 未过 | 60.5 | 4/90/18 | 7 | 0/2 | Y/Y | 0.85 | mid=90 | tolLoose,entropy<1 |

## 3. 推荐候选

### 1. `KP_cap_19_big2small`（capacity_big2small）

- 改法：颜色19：r0c5 30→25，r6c6 18→23
- 为什么：同色内把大车容量搬给小车上；总像素不变，债更分散
- 文件：`实验关/产线v6/难度带/三面墙/img3/KnobPlan_1795242014503_6545/candidates/KP_cap_19_big2small/KP_cap_19_big2small.json`
- 指标：D **57.5**（基线 57.5），peak/mid/tol=4/83/20，openM=7，C0/F0=0/1，clickForced=Y，policy0=Y，H=0.77
- 风险：touches-chain
- 提示：tolLoose、entropy<1

### 2. `KP_swap_r0c0_r1c2`（swap_top）

- 改法：换位 r0c0 ↔ r1c2（颜色1↔31）
- 为什么：整车互换，改变开局暴露顺序；冰随车走
- 文件：`实验关/产线v6/难度带/三面墙/img3/KnobPlan_1795242014503_6545/candidates/KP_swap_r0c0_r1c2/KP_swap_r0c0_r1c2.json`
- 指标：D **58.8**（基线 57.5），peak/mid/tol=4/80/18，openM=7，C0/F0=0/2，clickForced=Y，policy0=Y，H=0.68
- 风险：position
- 提示：tolLoose、entropy<1

### 3. `KP_swap_r0c0_r1c1`（swap_top）

- 改法：换位 r0c0 ↔ r1c1（颜色1↔30）
- 为什么：整车互换，改变开局暴露顺序；冰随车走
- 文件：`实验关/产线v6/难度带/三面墙/img3/KnobPlan_1795242014503_6545/candidates/KP_swap_r0c0_r1c1/KP_swap_r0c0_r1c1.json`
- 指标：D **27.5**（基线 57.5），peak/mid/tol=4/73/18，openM=6，C0/F0=0/1，clickForced=Y，policy0=Y，H=1.08
- 风险：moves-ice
- 提示：Ddrop>15、tolLoose、midCross80(D惩罚)

## 4. 说明

- 这是“单旋钮”候选，不是自动最优解；每个候选只改一个 motif。
- `链组软化` 保留链结构，只降成员容量；`链组拆除` 默认不生成，需 `--allow-chain-remove`。
- 所有指标沿用现有模型：ArlCheck 19 项、点击结算 forced/policy、free-first OpeningCheck、ChoiceSpace、LayoutScore。`--player` 才额外跑 PlayerSim。
- **口径提醒**：默认的 `clickForced/policy0` 是点击结算口径；它不等于 PlayerSim 的 `forced/policy0`。L2/L7 的基线就是“点击结算 policy0=Y、PlayerSim policy0=N”的反例；要判真实玩家 0 复活，必须加 `--player`。
- `profile` 的 mid 区间和 `guards` 是防“降难度=压平”的护栏；D 降低但 mid/entropy 掉了，会被标成“合格但压平”。

## 5. 复现

```bash
node 03_工具/正式版/KnobPlan_v1.js 实验关/产线v6/难度带/三面墙/img3/关卡_ZC_W3_guard0_rx.json --intent fix-opening --profile low-churn --top 5 --max-candidates 10
```