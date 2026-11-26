# KnobPlan：best.json

> 意图：`fix-opening`；profile：`low-churn`；规则：`fourSide（四边出口）`；生成 35 个候选，检查 6 个。

## 1. 基线诊断

- 文件：`实验关/产线v3/正常关卡_试跑_20261110/G8_57/best.json`
- 难度分 D：**36.8**（mid-easy）
- 硬门：can=✓，peak=4，openM=6，layout hard=0
- 形状：mid=45%，tol=20/20
- 体验：C0@buf<5=1，F0@buf≥3=0，clickForced=Y，policy0=Y
- 选择空间：M=5.642857142857143，entropy=1.0702610762897888，fake=7，forced=6
- 19 项未过：最长连续免费≤5=15 步；玩家中段 45–80%=13 步（占比 45%）；中段最长低压≤5=16 步（buf≤1 连续）；象限并行度≤3.6=3.95（42 步）；容错 55–75%=20/20；最长连续没得选≤2=5 步；at4≥5=4

## 2. 候选排序

| # | 候选 | 类型 | 结论 | D | peak/mid/tol | openM | C0/F0 | clickForced/policy0 | H | 未过项 | 提示 |
|---:|---|---|---|---:|---|---:|---|---|---|---|---|
| 1 | `KP_relief_split_r0c5` | relief_split | ❌ 未过 | 29.8 | 4/43/20 | 7 | 1/0 | Y/Y | 1.18 | mid=43,C0=1 | tolLoose |
| 2 | `KP_relief_transfer_r0c5` | relief_transfer | ❌ 未过 | 32.3 | 4/45/20 | 7 | 1/0 | Y/Y | 1.16 | C0=1 | tolLoose |
| 3 | `KP_swap_r0c0_r1c1` | swap_top | ❌ 未过 | 36 | 4/45/20 | 6 | 1/0 | Y/Y | 1.08 | C0=1 | tolLoose |
| 4 | `KP_swap_r0c0_r1c3` | swap_top | ❌ 未过 | 36.8 | 4/45/19 | 6 | 1/0 | Y/Y | 1.06 | C0=1 | tolLoose |
| 5 | `KP_cap_1_big2small` | capacity_big2small | ❌ 未过 | 36.8 | 4/45/20 | 6 | 1/0 | Y/Y | 1.07 | C0=1 | tolLoose |
| 6 | `KP_swap_r0c0_r1c0` | swap_top | ❌ 未过 | 37.1 | 4/31/20 | 5 | 1/0 | Y/Y | 1.11 | mid=31,C0=1 | tolLoose |

## 3. 推荐候选

没有候选同时满足 profile 和“不压平”护栏。看上面未过项，优先修硬门，不要继续降难度。
## 4. 说明

- 这是“单旋钮”候选，不是自动最优解；每个候选只改一个 motif。
- `链组软化` 保留链结构，只降成员容量；`链组拆除` 默认不生成，需 `--allow-chain-remove`。
- 所有指标沿用现有模型：ArlCheck 19 项、点击结算 forced/policy、free-first OpeningCheck、ChoiceSpace、LayoutScore。`--player` 才额外跑 PlayerSim。
- **口径提醒**：默认的 `clickForced/policy0` 是点击结算口径；它不等于 PlayerSim 的 `forced/policy0`。L2/L7 的基线就是“点击结算 policy0=Y、PlayerSim policy0=N”的反例；要判真实玩家 0 复活，必须加 `--player`。
- `profile` 的 mid 区间和 `guards` 是防“降难度=压平”的护栏；D 降低但 mid/entropy 掉了，会被标成“合格但压平”。

## 5. 复现

```bash
node 03_工具/正式版/KnobPlan_v1.js 实验关/产线v3/正常关卡_试跑_20261110/G8_57/best.json --intent fix-opening --profile low-churn --top 6 --max-candidates 6
```