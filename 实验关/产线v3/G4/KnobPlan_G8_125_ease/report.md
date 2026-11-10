# KnobPlan：G8_bq_level_125.json

> 意图：`ease`；profile：`low-churn`；规则：`bottomOnly（仅底边出口）`；生成 42 个候选，检查 3 个。

## 1. 基线诊断

- 文件：`../正常关卡/G8_bq_level_125.json`
- 难度分 D：**60.6**（hard）
- 硬门：can=✓，peak=4，openM=5，layout hard=1
- 形状：mid=60%，tol=2/20
- 体验：C0@buf<5=2，F0@buf≥3=1，clickForced=Y，policy0=Y
- 选择空间：M=5.194444444444445，entropy=1.2359188554824658，fake=0，forced=4
- 19 项未过：玩家后20% at3≥2=1 步；玩家后20% 连续≥2=1；容错 55–75%=2/20；没得选≤一半=4/5；最长连续没得选≤2=4 步；at4≥5=2；容量守恒=1089/1225

## 2. 候选排序

| # | 候选 | 类型 | 结论 | D | peak/mid/tol | openM | C0/F0 | clickForced/policy0 | H | 未过项 | 提示 |
|---:|---|---|---|---:|---|---:|---|---|---|---|---|
| 1 | `KP_cap_26_big2small` | capacity_big2small | ❌ 未过 | 55.9 | 4/60/0 | 5 | 2/1 | Y/Y | 1.34 | layoutHard=1,tol=0,C0=2 | — |
| 2 | `KP_cap_21_big2small` | capacity_big2small | ❌ 未过 | 60 | 4/60/3 | 5 | 2/1 | Y/Y | 1.24 | layoutHard=1,C0=2 | — |
| 3 | `KP_ice75_r0c1` | ice75 | ❌ 未过 | 60.1 | 4/60/2 | 5 | 2/1 | Y/Y | 1.24 | layoutHard=1,C0=2 | — |

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
node 03_工具/正式版/KnobPlan_v1.js ../正常关卡/G8_bq_level_125.json --intent ease --profile low-churn --top 3 --max-candidates 3
```