# KnobPlan：关卡_ZC_70_guard0_rx.json

> 意图：`fix-opening`；profile：`low-churn`；规则：`fourSide（四边出口）`；生成 24 个候选，检查 5 个。

## 1. 基线诊断

- 文件：`实验关/产线v6/难度带/探_70/关卡_ZC_70_guard0_rx.json`
- 难度分 D：**35.2**（mid-easy）
- 硬门：can=✓，peak=4，openM=7，layout hard=0
- 形状：mid=10%，tol=20/20
- 体验：C0@buf<5=1，F0@buf≥3=0，clickForced=Y，policy0=Y
- 选择空间：M=5.6976744186046515，entropy=1.1042870417973345，fake=5，forced=3
- 19 项未过：最长连续免费≤5=23 步；玩家中段 45–80%=3 步（占比 10%）；中段最长低压≤5=22 步（buf≤1 连续）；at4≥5=1

> ⚠️ 基线 mid=10% 已经低于 45：先修中段，不要用 ease 继续放水。

## 2. 候选排序

| # | 候选 | 类型 | 结论 | D | peak/mid/tol | openM | C0/F0 | clickForced/policy0 | H | 未过项 | 提示 |
|---:|---|---|---|---:|---|---:|---|---|---|---|---|
| 1 | `KP_swap_r0c0_r1c5` | swap_top | 🟡 合格但压平 | 17.9 | 4/10/20 | 7 | 0/0 | Y/Y | 1.17 | midFlat=10 | Ddrop>15,tolLoose,baselineFlat |
| 2 | `KP_cap_21_big2small` | capacity_big2small | ❌ 未过 | 32.3 | 4/27/20 | 7 | 1/0 | Y/Y | 1.16 | C0=1,midFlat=27 | tolLoose,baselineFlat |
| 3 | `KP_cap_19_big2small` | capacity_big2small | ❌ 未过 | 34.1 | 4/10/20 | 7 | 1/0 | Y/Y | 1.12 | C0=1,midFlat=10 | tolLoose,baselineFlat |
| 4 | `KP_swap_r0c0_r1c2` | swap_top | ❌ 未过 | 27.2 | 3/0/20 | 6 | 1/0 | Y/Y | 1.18 | peak=3,mid=0,C0=1,midFlat=0 | tolLoose,baselineFlat |
| 5 | `KP_swap_r0c0_r1c1` | swap_top | ❌ 未过 | 37.8 | 4/10/20 | 6 | 1/0 | Y/Y | 1.06 | C0=1,midFlat=10 | tolLoose,baselineFlat |

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
node 03_工具/正式版/KnobPlan_v1.js 实验关/产线v6/难度带/探_70/关卡_ZC_70_guard0_rx.json --intent fix-opening --profile low-churn --top 5 --max-candidates 10
```