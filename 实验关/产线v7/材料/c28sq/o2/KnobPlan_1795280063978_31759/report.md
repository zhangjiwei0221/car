# KnobPlan：关卡_ZC_C282_guard_s0_r6c5_rx.json

> 意图：`fix-opening`；profile：`low-churn`；规则：`fourSide（四边出口）`；生成 32 个候选，检查 8 个。

## 1. 基线诊断

- 文件：`实验关/产线v6/难度带/三面墙/c28sq/o2/关卡_ZC_C282_guard_s0_r6c5_rx.json`
- 难度分 D：**30**（mid-easy）
- 硬门：can=✓，peak=4，openM=3，layout hard=1
- 形状：mid=33%，tol=7/20
- 体验：C0@buf<5=0，F0@buf≥3=1，clickForced=Y，policy0=Y
- 选择空间：M=7.5476190476190474，entropy=1.2055735091916426，fake=13，forced=1
- 19 项未过：最长连续免费≤5=26 步；玩家中段 45–80%=1 步（占比 33%）；中段最长低压≤5=19 步（buf≤1 连续）；开局可点≥5=3 辆；at4≥5=3

> ⚠️ 基线 mid=33% 已经低于 45：先修中段，不要用 ease 继续放水。

## 2. 候选排序

| # | 候选 | 类型 | 结论 | D | peak/mid/tol | openM | C0/F0 | clickForced/policy0 | H | 未过项 | 提示 |
|---:|---|---|---|---:|---|---:|---|---|---|---|---|
| 1 | `KP_swap_r0c0_r1c1` | swap_top | ❌ 未过 | 11.5 | 4/34/16 | 4 | 0/0 | Y/Y | 1.33 | openM=4,layoutHard=1,tol=16 | Ddrop>15,tolLoose,baselineFlat |
| 2 | `KP_openice_r0c0` | open_ice_remove | ❌ 未过 | 21.7 | 4/38/13 | 4 | 0/1 | Y/Y | 1.28 | openM=4,layoutHard=1 | baselineFlat |
| 3 | `KP_relief_transfer_r0c5` | relief_transfer | ❌ 未过 | 23.6 | 3/55/13 | 4 | 0/1 | Y/Y | 1.21 | peak=3,openM=4,layoutHard=1 | — |
| 4 | `KP_swap_r0c0_r1c3` | swap_top | ❌ 未过 | 25.6 | 4/66/15 | 4 | 0/1 | Y/Y | 1.18 | openM=4,layoutHard=1 | — |
| 5 | `KP_openice_r0c4` | open_ice_remove | ❌ 未过 | 26.7 | 4/55/12 | 4 | 0/2 | Y/Y | 1.28 | openM=4,layoutHard=1 | — |
| 6 | `KP_swap_r0c0_r1c4` | swap_top | ❌ 未过 | 29.7 | 3/34/14 | 4 | 0/1 | Y/Y | 1.17 | peak=3,openM=4,layoutHard=1 | baselineFlat |
| 7 | `KP_cap_18_big2small` | capacity_big2small | ❌ 未过 | 23.1 | 4/62/18 | 3 | 0/1 | Y/Y | 1.21 | openM=3,layoutHard=1,tol=18 | tolLoose |
| 8 | `KP_cap_13_big2small` | capacity_big2small | ❌ 未过 | 30 | 4/33/7 | 3 | 0/1 | Y/Y | 1.21 | openM=3,layoutHard=1 | baselineFlat |

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
node 03_工具/正式版/KnobPlan_v1.js 实验关/产线v6/难度带/三面墙/c28sq/o2/关卡_ZC_C282_guard_s0_r6c5_rx.json --intent fix-opening --profile low-churn --top 5 --max-candidates 10
```