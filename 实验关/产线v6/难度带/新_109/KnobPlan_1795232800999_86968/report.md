# KnobPlan：关卡_ZC_109_guard0_rx.json

> 意图：`fix-opening`；profile：`low-churn`；规则：`fourSide（四边出口）`；生成 29 个候选，检查 7 个。

## 1. 基线诊断

- 文件：`实验关/产线v6/难度带/新_109/关卡_ZC_109_guard0_rx.json`
- 难度分 D：**52.5**（mid-hard）
- 硬门：can=✓，peak=2，openM=6，layout hard=0
- 形状：mid=76%，tol=17/20
- 体验：C0@buf<5=0，F0@buf≥3=2，clickForced=Y，policy0=Y
- 选择空间：M=4.181818181818182，entropy=1.1522077971129632，fake=0，forced=0
- 19 项未过：峰值=4=2；最长连续免费≤5=20 步；中段最长低压≤5=20 步（buf≤1 连续）；最长连续没得选≤2=3 步；at4≥5=0

## 2. 候选排序

| # | 候选 | 类型 | 结论 | D | peak/mid/tol | openM | C0/F0 | clickForced/policy0 | H | 未过项 | 提示 |
|---:|---|---|---|---:|---|---:|---|---|---|---|---|
| 1 | `KP_cap_28_big2small` | capacity_big2small | 🟡 合格但压平 | 53.1 | 2/76/16 | 6 | 0/2 | Y/Y | 1.15 | peak<3 | tolLoose |
| 2 | `KP_relief_transfer_r0c1` | relief_transfer | ❌ 未过 | 29.8 | 3/79/16 | 7 | 0/2 | Y/Y | 1.33 | peak=3 | Ddrop>15,tolLoose |
| 3 | `KP_swap_r0c0_r1c2` | swap_top | ❌ 未过 | 85.1 | 4/86/0 | 6 | 1/0 | N/Y | 0.98 | can=✗,peak=4,mid=86,tol=0,C0=1,clickForced=N | entropy<1 |
| 4 | `KP_openice_r0c1` | open_ice_remove | ❌ 未过 | 79 | 2/100/9 | 7 | 0/3 | Y/Y | 1.17 | mid=100,tol=9,F0=3,peak<3 | — |
| 5 | `KP_cap_26_big2small` | capacity_big2small | ❌ 未过 | 51.9 | 2/76/18 | 6 | 0/2 | Y/Y | 1.15 | tol=18,peak<3 | tolLoose |
| 6 | `KP_swap_r0c0_r1c0` | swap_top | ❌ 未过 | 56.7 | 2/79/13 | 6 | 1/0 | Y/Y | 0.96 | C0=1,peak<3 | entropy<1 |
| 7 | `KP_swap_r0c0_r1c1` | swap_top | ❌ 未过 | 39.3 | 2/79/20 | 5 | 0/1 | Y/Y | 1.28 | tol=20,peak<3 | tolLoose |

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
node 03_工具/正式版/KnobPlan_v1.js 实验关/产线v6/难度带/新_109/关卡_ZC_109_guard0_rx.json --intent fix-opening --profile low-churn --top 5 --max-candidates 10
```