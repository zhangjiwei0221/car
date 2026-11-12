# KnobPlan：关卡_ZC_154_guard0_rx.json

> 意图：`fix-opening`；profile：`low-churn`；规则：`fourSide（四边出口）`；生成 32 个候选，检查 9 个。

## 1. 基线诊断

- 文件：`实验关/产线v5/C13_十关/154/关卡_ZC_154_guard0_rx.json`
- 难度分 D：**44.3**（mid-hard）
- 硬门：can=✓，peak=4，openM=4，layout hard=1
- 形状：mid=15%，tol=6/20
- 体验：C0@buf<5=1，F0@buf≥3=0，clickForced=Y，policy0=Y
- 选择空间：M=5.256410256410256，entropy=1.1804672210513492，fake=1，forced=2
- 19 项未过：玩家中段 45–80%=3 步（占比 15%）；中段最长低压≤5=7 步（buf≤1 连续）；玩家后20% 连续≥2=1；开局可点≥5=4 辆；at4≥5=1

> ⚠️ 基线 mid=15% 已经低于 45：先修中段，不要用 ease 继续放水。

## 2. 候选排序

| # | 候选 | 类型 | 结论 | D | peak/mid/tol | openM | C0/F0 | clickForced/policy0 | H | 未过项 | 提示 |
|---:|---|---|---|---:|---|---:|---|---|---|---|---|
| 1 | `KP_swap_r0c0_r1c2` | swap_top | ❌ 未过 | 16.2 | 4/37/11 | 3 | 0/0 | Y/Y | 1.33 | openM=3,layoutHard=1 | Ddrop>15,baselineFlat |
| 2 | `KP_openice_r0c2` | open_ice_remove | ❌ 未过 | 15 | 4/11/20 | 5 | 0/0 | Y/Y | 1.39 | layoutHard=1,mid=11,tol=20,midFlat=11 | Ddrop>15,tolLoose,baselineFlat |
| 3 | `KP_relief_transfer_r0c6` | relief_transfer | ❌ 未过 | 31.1 | 4/9/10 | 5 | 0/1 | Y/Y | 1.25 | layoutHard=1,mid=9,midFlat=9 | baselineFlat |
| 4 | `KP_relief_transfer_r0c5` | relief_transfer | ❌ 未过 | 40.5 | 4/13/4 | 5 | 1/0 | Y/Y | 1.24 | layoutHard=1,mid=13,tol=4,C0=1,midFlat=13 | baselineFlat |
| 5 | `KP_openice_r0c5` | open_ice_remove | ❌ 未过 | 41.1 | 4/8/3 | 5 | 1/0 | Y/Y | 1.24 | layoutHard=1,mid=8,tol=3,C0=1,midFlat=8 | baselineFlat |
| 6 | `KP_cap_31_big2small` | capacity_big2small | ❌ 未过 | 44.3 | 4/15/6 | 4 | 1/0 | Y/Y | 1.18 | openM=4,layoutHard=1,C0=1,midFlat=15 | baselineFlat |
| 7 | `KP_swap_r0c0_r1c0` | swap_top | ❌ 未过 | 45.5 | 4/19/4 | 4 | 1/0 | Y/Y | 1.18 | openM=4,layoutHard=1,tol=4,C0=1,midFlat=19 | baselineFlat |
| 8 | `KP_swap_r0c0_r1c1` | swap_top | ❌ 未过 | 45.6 | 4/15/4 | 4 | 1/0 | Y/Y | 1.18 | openM=4,layoutHard=1,tol=4,C0=1,midFlat=15 | baselineFlat |
| 9 | `KP_cap_25_big2small` | capacity_big2small | ❌ 未过 | 51.5 | 4/15/3 | 4 | 1/1 | Y/Y | 1.18 | openM=4,layoutHard=1,tol=3,C0=1,midFlat=15 | baselineFlat |

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
node 03_工具/正式版/KnobPlan_v1.js 实验关/产线v5/C13_十关/154/关卡_ZC_154_guard0_rx.json --intent fix-opening --profile low-churn --top 5 --max-candidates 10
```