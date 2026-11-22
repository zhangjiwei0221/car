# KnobPlan：关卡_ZC_ac1c98a5e3_guard0_rx.json

> 意图：`fix-opening`；profile：`low-churn`；规则：`fourSide（四边出口）`；生成 33 个候选，检查 9 个。

## 1. 基线诊断

- 文件：`实验关/产线v6/难度带/三面墙/scan_ac1c98a5e3/关卡_ZC_ac1c98a5e3_guard0_rx.json`
- 难度分 D：**41.2**（mid-hard）
- 硬门：can=✓，peak=4，openM=4，layout hard=0
- 形状：mid=9%，tol=11/20
- 体验：C0@buf<5=1，F0@buf≥3=0，clickForced=Y，policy0=Y
- 选择空间：M=5.9，entropy=1.1315902453396736，fake=1，forced=3
- 19 项未过：最长连续免费≤5=21 步；玩家中段 45–80%=2 步（占比 9%）；中段最长低压≤5=13 步（buf≤1 连续）；玩家后20% at3≥2=1 步；玩家后20% 连续≥2=1；开局可点≥5=4 辆；at4≥5=1

> ⚠️ 基线 mid=9% 已经低于 45：先修中段，不要用 ease 继续放水。

## 2. 候选排序

| # | 候选 | 类型 | 结论 | D | peak/mid/tol | openM | C0/F0 | clickForced/policy0 | H | 未过项 | 提示 |
|---:|---|---|---|---:|---|---:|---|---|---|---|---|
| 1 | `KP_relief_transfer_r0c2` | relief_transfer | ❌ 未过 | 32.7 | 4/7/14 | 5 | 1/0 | Y/Y | 1.24 | mid=7,C0=1,midFlat=7 | baselineFlat |
| 2 | `KP_openice_r0c2` | open_ice_remove | ❌ 未过 | 33.5 | 3/7/10 | 5 | 1/0 | Y/Y | 1.29 | peak=3,mid=7,tol=10,C0=1,midFlat=7 | baselineFlat |
| 3 | `KP_relief_transfer_r0c3` | relief_transfer | ❌ 未过 | 35.3 | 4/7/12 | 5 | 1/0 | Y/Y | 1.24 | mid=7,C0=1,midFlat=7 | baselineFlat |
| 4 | `KP_openice_r0c0` | open_ice_remove | ❌ 未过 | 36.1 | 4/4/12 | 5 | 1/0 | Y/Y | 1.21 | mid=4,C0=1,midFlat=4 | baselineFlat |
| 5 | `KP_swap_r0c0_r1c2` | swap_top | ❌ 未过 | 36.5 | 4/11/15 | 5 | 1/0 | Y/Y | 1.14 | C0=1,midFlat=11 | baselineFlat |
| 6 | `KP_swap_r0c0_r1c1` | swap_top | ❌ 未过 | 38.6 | 3/14/9 | 5 | 1/0 | Y/Y | 1.19 | peak=3,tol=9,C0=1,midFlat=14 | baselineFlat |
| 7 | `KP_swap_r0c0_r1c3` | swap_top | ❌ 未过 | 66.3 | 0/0/0 | 5 | 0/0 | N/N | 0.50 | can=✗,peak=0,mid=0,tol=0,clickForced=N,policy0=N,entropyDrop=0.63,peak<3,midFlat=0 | entropy<1,baselineFlat |
| 8 | `KP_cap_14_big2small` | capacity_big2small | ❌ 未过 | 36.7 | 4/4/18 | 4 | 1/0 | Y/Y | 1.13 | openM=4,mid=4,tol=18,C0=1,midFlat=4 | tolLoose,baselineFlat |
| 9 | `KP_cap_13_big2small` | capacity_big2small | ❌ 未过 | 44.4 | 4/8/6 | 4 | 1/0 | Y/Y | 1.13 | openM=4,mid=8,tol=6,C0=1,midFlat=8 | baselineFlat |

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
node 03_工具/正式版/KnobPlan_v1.js 实验关/产线v6/难度带/三面墙/scan_ac1c98a5e3/关卡_ZC_ac1c98a5e3_guard0_rx.json --intent fix-opening --profile low-churn --top 5 --max-candidates 10
```