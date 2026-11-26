# KnobPlan：best.json

> 意图：`more-choice`；profile：`low-churn`；规则：`fourSide（四边出口）`；生成 18 个候选，检查 6 个。

## 1. 基线诊断

- 文件：`实验关/产线v3/正常关卡_试跑_20261110/G8_43/best.json`
- 难度分 D：**46.5**（mid-hard）
- 硬门：can=✓，peak=4，openM=5，layout hard=0
- 形状：mid=79%，tol=20/20
- 体验：C0@buf<5=0，F0@buf≥3=2，clickForced=Y，policy0=Y
- 选择空间：M=3.8055555555555554，entropy=0.9625918903641835，fake=0，forced=3
- 19 项未过：中段最长低压≤5=12 步（buf≤1 连续）；象限并行度≤3.6=4.00（36 步）；主体并行度≤65%=1.75/2，88%；全程最少未动主体≥1=最少 0，平均 0.25/2；玩家后20% at3≥2=0 步；玩家后20% 连续≥2=0；容错 55–75%=20/20；最长连续没得选≤2=3 步

## 2. 候选排序

| # | 候选 | 类型 | 结论 | D | peak/mid/tol | openM | C0/F0 | clickForced/policy0 | H | 未过项 | 提示 |
|---:|---|---|---|---:|---|---:|---|---|---|---|---|
| 1 | `KP_ice75_r2c1` | ice75 | ✅ 推荐 | 46.3 | 4/79/20 | 5 | 0/2 | Y/Y | 0.98 | — | tolLoose,entropy<1 |
| 2 | `KP_ice75_r3c1` | ice75 | ✅ 推荐 | 46.4 | 4/79/20 | 5 | 0/2 | Y/Y | 0.97 | — | tolLoose,entropy<1 |
| 3 | `KP_cap_26_big2small` | capacity_big2small | ✅ 推荐 | 46.7 | 4/79/20 | 5 | 0/2 | Y/Y | 0.94 | — | tolLoose,entropy<1 |
| 4 | `KP_ice75_r1c4` | ice75 | 🟡 合格但压平 | 43.4 | 4/54/20 | 5 | 0/2 | Y/Y | 1.01 | midDrop=25 | tolLoose |
| 5 | `KP_cap_25_big2small` | capacity_big2small | ❌ 未过 | 78 | 3/83/5 | 5 | 0/3 | Y/Y | 0.68 | peak=3,mid=83,tol=5,F0=3,entropyDrop=0.29 | entropy<1 |
| 6 | `KP_swap_r0c0_r1c4` | swap_top | ❌ 未过 | 100 | 4/100/0 | 4 | 1/2 | N/N | 0.19 | can=✗,openM=4,mid=100,tol=0,C0=1,clickForced=N,policy0=N,entropyDrop=0.78 | entropy<1 |

## 3. 推荐候选

### 1. `KP_ice75_r2c1`（ice75）

- 改法：冰 r2c1 21→16
- 为什么：只降低一个冰的延迟；不拆链、不改容量
- 文件：`实验关/产线v3/正常关卡_试跑_20261110/G8_43/knobplan/candidates/KP_ice75_r2c1/KP_ice75_r2c1.json`
- 指标：D **46.3**（基线 46.5），peak/mid/tol=4/79/20，openM=5，C0/F0=0/2，clickForced=Y，policy0=Y，H=0.98
- 风险：touches-ice
- 提示：tolLoose、entropy<1

### 2. `KP_ice75_r3c1`（ice75）

- 改法：冰 r3c1 23→17
- 为什么：只降低一个冰的延迟；不拆链、不改容量
- 文件：`实验关/产线v3/正常关卡_试跑_20261110/G8_43/knobplan/candidates/KP_ice75_r3c1/KP_ice75_r3c1.json`
- 指标：D **46.4**（基线 46.5），peak/mid/tol=4/79/20，openM=5，C0/F0=0/2，clickForced=Y，policy0=Y，H=0.97
- 风险：touches-ice
- 提示：tolLoose、entropy<1

### 3. `KP_cap_26_big2small`（capacity_big2small）

- 改法：颜色26：r0c5 58→49，r5c0 14→23
- 为什么：同色内把大车容量搬给小车上；总像素不变，债更分散
- 文件：`实验关/产线v3/正常关卡_试跑_20261110/G8_43/knobplan/candidates/KP_cap_26_big2small/KP_cap_26_big2small.json`
- 指标：D **46.7**（基线 46.5），peak/mid/tol=4/79/20，openM=5，C0/F0=0/2，clickForced=Y，policy0=Y，H=0.94
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
node 03_工具/正式版/KnobPlan_v1.js 实验关/产线v3/正常关卡_试跑_20261110/G8_43/best.json --intent more-choice --profile low-churn --top 6 --max-candidates 6
```