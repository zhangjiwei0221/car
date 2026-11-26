# KnobPlan：关卡_ZC_23_rx.json

> 意图：`fix-opening`；profile：`low-churn`；规则：`fourSide（四边出口）`；生成 26 个候选，检查 5 个。

## 1. 基线诊断

- 文件：`实验关/新组_正常关卡/ZC_23_auto/关卡_ZC_23_rx.json`
- 难度分 D：**60.7**（hard）
- 硬门：can=✗，peak=4，openM=7，layout hard=0
- 形状：mid=62%，tol=11/20
- 体验：C0@buf<5=2，F0@buf≥3=0，clickForced=N，policy0=Y
- 选择空间：M=8.170731707317072，entropy=1.2173793374830935，fake=13，forced=3
- 19 项未过：全程最少未动主体≥1=最少 0，平均 1.85/3；at4≥5=4；可通关（最小路线）=✗

## 2. 候选排序

| # | 候选 | 类型 | 结论 | D | peak/mid/tol | openM | C0/F0 | clickForced/policy0 | H | 未过项 | 提示 |
|---:|---|---|---|---:|---|---:|---|---|---|---|---|
| 1 | `KP_swap_r0c0_r1c3` | swap_top | ❌ 未过 | 46.2 | 3/75/6 | 7 | 3/0 | Y/Y | 1.19 | peak=3,tol=6,C0=3 | — |
| 2 | `KP_cap_30_big2small` | capacity_big2small | ❌ 未过 | 60.7 | 4/57/9 | 7 | 2/0 | N/Y | 1.25 | can=✗,tol=9,C0=2,clickForced=N | — |
| 3 | `KP_cap_15_big2small` | capacity_big2small | ❌ 未过 | 64.1 | 4/62/6 | 7 | 2/0 | N/Y | 1.21 | can=✗,tol=6,C0=2,clickForced=N | — |
| 4 | `KP_swap_r0c0_r1c1` | swap_top | ❌ 未过 | 67.9 | 4/79/5 | 7 | 3/0 | N/Y | 1.19 | can=✗,tol=5,C0=3,clickForced=N | — |
| 5 | `KP_swap_r0c0_r1c4` | swap_top | ❌ 未过 | 68.4 | 4/53/6 | 7 | 2/1 | N/Y | 1.25 | can=✗,tol=6,C0=2,clickForced=N | — |

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
node 03_工具/正式版/KnobPlan_v1.js 实验关/新组_正常关卡/ZC_23_auto/关卡_ZC_23_rx.json --intent fix-opening --profile low-churn --top 5 --max-candidates 10
```