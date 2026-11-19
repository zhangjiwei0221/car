# KnobPlan：关卡_ZC_179_guard0_rx.json

> 意图：`fix-opening`；profile：`low-churn`；规则：`fourSide（四边出口）`；生成 32 个候选，检查 7 个。

## 1. 基线诊断

- 文件：`实验关/产线v6/难度带/试造_179/关卡_ZC_179_guard0_rx.json`
- 难度分 D：**60**（mid-hard）
- 硬门：can=✓，peak=4，openM=5，layout hard=0
- 形状：mid=32%，tol=19/20
- 体验：C0@buf<5=2，F0@buf≥3=1，clickForced=Y，policy0=Y
- 选择空间：M=4.7317073170731705，entropy=1.0369685919971183，fake=4，forced=3
- 19 项未过：最长连续免费≤5=10 步；玩家中段 45–80%=9 步（占比 32%）；中段最长低压≤5=7 步（buf≤1 连续）；玩家后20% 连续≥2=1；最长连续没得选≤2=5 步；at4≥5=1

> ⚠️ 基线 mid=32% 已经低于 45：先修中段，不要用 ease 继续放水。

## 2. 候选排序

| # | 候选 | 类型 | 结论 | D | peak/mid/tol | openM | C0/F0 | clickForced/policy0 | H | 未过项 | 提示 |
|---:|---|---|---|---:|---|---:|---|---|---|---|---|
| 1 | `KP_swap_r0c0_r1c2` | swap_top | ❌ 未过 | 79.8 | 4/46/6 | 6 | 5/3 | Y/Y | 0.90 | tol=6,C0=5,F0=3 | entropy<1 |
| 2 | `KP_relief_transfer_r0c0` | relief_transfer | ❌ 未过 | 82.5 | 4/0/1 | 6 | 3/3 | Y/Y | 0.92 | mid=0,tol=1,C0=3,F0=3,midDrop=32,midFlat=0 | entropy<1,baselineFlat |
| 3 | `KP_openice_r0c0` | open_ice_remove | ❌ 未过 | 86 | 4/0/1 | 6 | 2/1 | N/Y | 1.07 | can=✗,mid=0,tol=1,C0=2,clickForced=N,midDrop=32,midFlat=0 | baselineFlat |
| 4 | `KP_swap_r0c0_r1c0` | swap_top | ❌ 未过 | 98.5 | 4/0/0 | 6 | 2/2 | N/N | 0.91 | can=✗,mid=0,tol=0,C0=2,clickForced=N,policy0=N,midDrop=32,midFlat=0 | entropy<1,baselineFlat |
| 5 | `KP_cap_16_big2small` | capacity_big2small | ❌ 未过 | 58.8 | 4/29/20 | 5 | 2/1 | Y/Y | 1.05 | mid=29,tol=20,C0=2,midFlat=29 | tolLoose,baselineFlat |
| 6 | `KP_cap_15_big2small` | capacity_big2small | ❌ 未过 | 59 | 4/29/19 | 5 | 2/1 | Y/Y | 1.05 | mid=29,C0=2,midFlat=29 | tolLoose,baselineFlat |
| 7 | `KP_swap_r0c0_r1c1` | swap_top | ❌ 未过 | 60 | 4/29/19 | 5 | 2/1 | Y/Y | 1.04 | mid=29,C0=2,midFlat=29 | tolLoose,baselineFlat |

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
node 03_工具/正式版/KnobPlan_v1.js 实验关/产线v6/难度带/试造_179/关卡_ZC_179_guard0_rx.json --intent fix-opening --profile low-churn --top 5 --max-candidates 10
```