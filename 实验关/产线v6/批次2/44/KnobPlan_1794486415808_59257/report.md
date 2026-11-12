# KnobPlan：关卡_ZC_44_guard0_rx.json

> 意图：`fix-opening`；profile：`low-churn`；规则：`fourSide（四边出口）`；生成 24 个候选，检查 4 个。

## 1. 基线诊断

- 文件：`实验关/产线v6/批次2/44/关卡_ZC_44_guard0_rx.json`
- 难度分 D：**27.8**（mid-easy）
- 硬门：can=✓，peak=3，openM=6，layout hard=0
- 形状：mid=79%，tol=6/20
- 体验：C0@buf<5=0，F0@buf≥3=1，clickForced=Y，policy0=Y
- 选择空间：M=6.097560975609756，entropy=1.3152817307357358，fake=3，forced=1
- 19 项未过：峰值=4=3；at4≥5=0

## 2. 候选排序

| # | 候选 | 类型 | 结论 | D | peak/mid/tol | openM | C0/F0 | clickForced/policy0 | H | 未过项 | 提示 |
|---:|---|---|---|---:|---|---:|---|---|---|---|---|
| 1 | `KP_cap_5_big2small` | capacity_big2small | ❌ 未过 | 29.3 | 3/79/3 | 6 | 0/1 | Y/Y | 1.35 | tol=3 | — |
| 2 | `KP_swap_r0c0_r1c0` | swap_top | ❌ 未过 | 43.9 | 3/85/7 | 6 | 0/1 | Y/Y | 1.31 | mid=85 | — |
| 3 | `KP_swap_r0c0_r1c1` | swap_top | ❌ 未过 | 48.6 | 4/85/5 | 6 | 0/2 | Y/Y | 1.36 | peak=4,mid=85,tol=5 | — |
| 4 | `KP_swap_r0c0_r1c4` | swap_top | ❌ 未过 | 46 | 3/20/0 | 6 | 0/2 | Y/Y | 1.08 | mid=20,tol=0,midDrop=59,midFlat=20 | — |

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
node 03_工具/正式版/KnobPlan_v1.js 实验关/产线v6/批次2/44/关卡_ZC_44_guard0_rx.json --intent fix-opening --profile low-churn --top 5 --max-candidates 10
```