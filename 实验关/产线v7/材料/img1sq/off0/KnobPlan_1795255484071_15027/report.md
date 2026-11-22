# KnobPlan：关卡_ZC_E0_guard0_rx.json

> 意图：`fix-opening`；profile：`low-churn`；规则：`fourSide（四边出口）`；生成 27 个候选，检查 5 个。

## 1. 基线诊断

- 文件：`实验关/产线v6/难度带/三面墙/img1sq/off0/关卡_ZC_E0_guard0_rx.json`
- 难度分 D：**9**（easy）
- 硬门：can=✓，peak=3，openM=7，layout hard=2
- 形状：mid=55%，tol=20/20
- 体验：C0@buf<5=0，F0@buf≥3=0，clickForced=Y，policy0=Y
- 选择空间：M=9.565217391304348，entropy=1.2751499687367092，fake=19，forced=1
- 19 项未过：峰值=4=3；最长连续免费≤5=29 步；中段最长低压≤5=24 步（buf≤1 连续）；玩家后20% at3≥2=0 步；玩家后20% 连续≥2=0；at4≥5=0

## 2. 候选排序

| # | 候选 | 类型 | 结论 | D | peak/mid/tol | openM | C0/F0 | clickForced/policy0 | H | 未过项 | 提示 |
|---:|---|---|---|---:|---|---:|---|---|---|---|---|
| 1 | `KP_cap_15_big2small` | capacity_big2small | ❌ 未过 | 7.6 | 3/58/20 | 7 | 0/0 | Y/Y | 1.31 | layoutHard=2 | tolLoose |
| 2 | `KP_swap_r0c0_r1c0` | swap_top | ❌ 未过 | 8 | 3/58/20 | 7 | 0/0 | Y/Y | 1.30 | layoutHard=2 | tolLoose |
| 3 | `KP_cap_14_big2small` | capacity_big2small | ❌ 未过 | 8.1 | 3/58/20 | 7 | 0/0 | Y/Y | 1.30 | layoutHard=2 | tolLoose |
| 4 | `KP_swap_r0c0_r1c1` | swap_top | ❌ 未过 | 8.3 | 3/55/20 | 7 | 0/0 | Y/Y | 1.29 | layoutHard=2 | tolLoose |
| 5 | `KP_swap_r0c0_r1c3` | swap_top | ❌ 未过 | 8.4 | 3/55/20 | 7 | 0/0 | Y/Y | 1.29 | layoutHard=2 | tolLoose |

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
node 03_工具/正式版/KnobPlan_v1.js 实验关/产线v6/难度带/三面墙/img1sq/off0/关卡_ZC_E0_guard0_rx.json --intent fix-opening --profile low-churn --top 5 --max-candidates 10
```