# KnobPlan：关卡_ZC_171_guard0_rx.json

> 意图：`fix-opening`；profile：`low-churn`；规则：`fourSide（四边出口）`；生成 31 个候选，检查 7 个。

## 1. 基线诊断

- 文件：`实验关/产线v6/难度带/新_171/关卡_ZC_171_guard0_rx.json`
- 难度分 D：**8.9**（easy）
- 硬门：can=✓，peak=4，openM=4，layout hard=0
- 形状：mid=32%，tol=20/20
- 体验：C0@buf<5=0，F0@buf≥3=0，clickForced=Y，policy0=Y
- 选择空间：M=7.318181818181818，entropy=1.4126166941022735，fake=7，forced=1
- 19 项未过：最长连续免费≤5=9 步；玩家中段 45–80%=10 步（占比 32%）；中段最长低压≤5=10 步（buf≤1 连续）；开局可点≥5=4 辆；at4≥5=1

> ⚠️ 基线 mid=32% 已经低于 45：先修中段，不要用 ease 继续放水。

## 2. 候选排序

| # | 候选 | 类型 | 结论 | D | peak/mid/tol | openM | C0/F0 | clickForced/policy0 | H | 未过项 | 提示 |
|---:|---|---|---|---:|---|---:|---|---|---|---|---|
| 1 | `KP_openice_r0c4` | open_ice_remove | ❌ 未过 | 9.9 | 3/23/20 | 5 | 0/0 | Y/Y | 1.41 | peak=3,mid=23,midFlat=23 | tolLoose,baselineFlat |
| 2 | `KP_relief_transfer_r0c4` | relief_transfer | ❌ 未过 | 15.4 | 3/23/19 | 5 | 0/1 | Y/Y | 1.37 | peak=3,mid=23,midFlat=23 | tolLoose,baselineFlat |
| 3 | `KP_swap_r0c1_r1c2` | swap_top | ❌ 未过 | 5.5 | 4/23/20 | 4 | 0/0 | Y/Y | 1.47 | openM=4,mid=23,midFlat=23 | tolLoose,baselineFlat |
| 4 | `KP_swap_r0c1_r1c3` | swap_top | ❌ 未过 | 6.8 | 4/29/19 | 4 | 0/0 | Y/Y | 1.45 | openM=4,mid=29,midFlat=29 | tolLoose,baselineFlat |
| 5 | `KP_cap_1_big2small` | capacity_big2small | ❌ 未过 | 9.7 | 3/26/20 | 4 | 0/0 | Y/Y | 1.42 | peak=3,openM=4,mid=26,midFlat=26 | tolLoose,baselineFlat |
| 6 | `KP_cap_14_big2small` | capacity_big2small | ❌ 未过 | 9.8 | 4/26/20 | 4 | 0/0 | Y/Y | 1.39 | openM=4,mid=26,midFlat=26 | tolLoose,baselineFlat |
| 7 | `KP_swap_r0c1_r1c1` | swap_top | ❌ 未过 | 8 | 3/13/20 | 3 | 0/0 | Y/Y | 1.46 | peak=3,openM=3,mid=13,midFlat=13 | tolLoose,baselineFlat |

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
node 03_工具/正式版/KnobPlan_v1.js 实验关/产线v6/难度带/新_171/关卡_ZC_171_guard0_rx.json --intent fix-opening --profile low-churn --top 5 --max-candidates 10
```