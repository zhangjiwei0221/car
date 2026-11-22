# KnobPlan：关卡_ZC_1029_guard_s1_r5c5_rx.json

> 意图：`fix-opening`；profile：`low-churn`；规则：`fourSide（四边出口）`；生成 28 个候选，检查 7 个。

## 1. 基线诊断

- 文件：`实验关/产线v6/难度带/三面墙/scan_1029/关卡_ZC_1029_guard_s1_r5c5_rx.json`
- 难度分 D：**30.1**（mid-easy）
- 硬门：can=✓，peak=4，openM=6，layout hard=1
- 形状：mid=52%，tol=20/20
- 体验：C0@buf<5=0，F0@buf≥3=2，clickForced=Y，policy0=Y
- 选择空间：M=5.358974358974359，entropy=1.1946220257929792，fake=3，forced=1
- 19 项未过：最长连续免费≤5=12 步；中段最长低压≤5=13 步（buf≤1 连续）；玩家后20% at3≥2=0 步；玩家后20% 连续≥2=0；最长连续没得选≤2=3 步；at4≥5=2

## 2. 候选排序

| # | 候选 | 类型 | 结论 | D | peak/mid/tol | openM | C0/F0 | clickForced/policy0 | H | 未过项 | 提示 |
|---:|---|---|---|---:|---|---:|---|---|---|---|---|
| 1 | `KP_relief_transfer_r0c3` | relief_transfer | ❌ 未过 | 32.8 | 3/48/20 | 7 | 0/0 | N/Y | 1.34 | can=✗,peak=3,layoutHard=1,clickForced=N | tolLoose |
| 2 | `KP_openice_r0c3` | open_ice_remove | ❌ 未过 | 40.8 | 3/52/19 | 7 | 0/2 | N/Y | 1.42 | can=✗,peak=3,layoutHard=1,clickForced=N | tolLoose |
| 3 | `KP_swap_r0c0_r1c2` | swap_top | ❌ 未过 | 23.4 | 4/48/19 | 6 | 0/1 | Y/Y | 1.23 | layoutHard=1 | tolLoose |
| 4 | `KP_cap_27_big2small` | capacity_big2small | ❌ 未过 | 28.2 | 4/52/20 | 6 | 0/2 | Y/Y | 1.23 | layoutHard=1 | tolLoose |
| 5 | `KP_cap_28_big2small` | capacity_big2small | ❌ 未过 | 30.1 | 4/52/20 | 6 | 0/2 | Y/Y | 1.19 | layoutHard=1 | tolLoose |
| 6 | `KP_swap_r0c0_r1c0` | swap_top | ❌ 未过 | 41.5 | 3/48/20 | 6 | 0/1 | N/Y | 1.25 | can=✗,peak=3,layoutHard=1,clickForced=N | tolLoose |
| 7 | `KP_swap_r0c0_r1c1` | swap_top | ❌ 未过 | 52.8 | 3/52/20 | 5 | 0/2 | N/Y | 1.17 | can=✗,peak=3,layoutHard=1,clickForced=N | tolLoose |

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
node 03_工具/正式版/KnobPlan_v1.js 实验关/产线v6/难度带/三面墙/scan_1029/关卡_ZC_1029_guard_s1_r5c5_rx.json --intent fix-opening --profile low-churn --top 5 --max-candidates 10
```