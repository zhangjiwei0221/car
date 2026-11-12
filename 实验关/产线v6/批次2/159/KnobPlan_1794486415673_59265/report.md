# KnobPlan：关卡_ZC_159_guard0_build.json

> 意图：`fix-opening`；profile：`low-churn`；规则：`fourSide（四边出口）`；生成 30 个候选，检查 5 个。

## 1. 基线诊断

- 文件：`实验关/产线v6/批次2/159/关卡_ZC_159_guard0_build.json`
- 难度分 D：**11.9**（easy）
- 硬门：can=✓，peak=2，openM=7，layout hard=0
- 形状：mid=13%，tol=14/20
- 体验：C0@buf<5=0，F0@buf≥3=1，clickForced=Y，policy0=Y
- 选择空间：M=7.181818181818182，entropy=1.4512152078995344，fake=1，forced=1
- 19 项未过：峰值=4=2；最长连续免费≤5=23 步；玩家中段 45–80%=4 步（占比 13%）；中段最长低压≤5=29 步（buf≤1 连续）；最长连续没得选≤2=3 步；at4≥5=0；无空格=1；容量守恒=1982/2025

> ⚠️ 基线 mid=13% 已经低于 45：先修中段，不要用 ease 继续放水。

## 2. 候选排序

| # | 候选 | 类型 | 结论 | D | peak/mid/tol | openM | C0/F0 | clickForced/policy0 | H | 未过项 | 提示 |
|---:|---|---|---|---:|---|---:|---|---|---|---|---|
| 1 | `KP_cap_15_big2small` | capacity_big2small | 🟡 合格但压平 | 5.6 | 2/13/15 | 7 | 0/0 | Y/Y | 1.45 | peak<3,midFlat=13 | baselineFlat |
| 2 | `KP_cap_19_big2small` | capacity_big2small | ❌ 未过 | 2 | 3/13/15 | 7 | 0/0 | Y/Y | 1.54 | peak=3,midFlat=13 | baselineFlat |
| 3 | `KP_swap_r0c0_r1c0` | swap_top | ❌ 未过 | 12.4 | 4/10/14 | 7 | 0/1 | Y/Y | 1.46 | peak=4,mid=10,midFlat=10 | baselineFlat |
| 4 | `KP_swap_r0c0_r1c3` | swap_top | ❌ 未过 | 17 | 3/10/12 | 7 | 0/2 | Y/Y | 1.52 | peak=3,mid=10,midFlat=10 | baselineFlat |
| 5 | `KP_swap_r0c0_r1c1` | swap_top | ❌ 未过 | 30.6 | 4/7/13 | 7 | 0/1 | N/Y | 1.50 | can=✗,peak=4,mid=7,clickForced=N,midFlat=7 | baselineFlat |

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
node 03_工具/正式版/KnobPlan_v1.js 实验关/产线v6/批次2/159/关卡_ZC_159_guard0_build.json --intent fix-opening --profile low-churn --top 5 --max-candidates 10
```