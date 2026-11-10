# KnobPlan：G8_bq_level_98.json

> 意图：`fix-opening`；profile：`low-churn`；规则：`bottomOnly（仅底边出口）`；生成 37 个候选，检查 3 个。

## 1. 基线诊断

- 文件：`../正常关卡/G8_bq_level_98.json`
- 难度分 D：**24.6**（mid-easy）
- 硬门：can=✓，peak=4，openM=4，layout hard=0
- 形状：mid=39%，tol=12/20
- 体验：C0@buf<5=0，F0@buf≥3=0，clickForced=Y，policy0=Y
- 选择空间：M=5.976744186046512，entropy=1.2144976797036156，fake=2，forced=4
- 19 项未过：最长连续免费≤5=6 步；玩家中段 45–80%=9 步（占比 39%）；中段最长低压≤5=17 步（buf≤1 连续）；玩家后20% at3≥2=1 步；玩家后20% 连续≥2=1；开局可点≥5=4 辆；at4≥5=4；容量守恒=1432/1444

> ⚠️ 基线 mid=39% 已经低于 45：先修中段，不要用 ease 继续放水。

## 2. 候选排序

| # | 候选 | 类型 | 结论 | D | peak/mid/tol | openM | C0/F0 | clickForced/policy0 | H | 未过项 | 提示 |
|---:|---|---|---|---:|---|---:|---|---|---|---|---|
| 1 | `KP_relief_split_r0c1` | relief_split | ❌ 未过 | 50.4 | 4/40/15 | 5 | 0/3 | N/Y | 1.40 | can=✗,F0=3,clickForced=N | baselineFlat |
| 2 | `KP_relief_transfer_r0c1` | relief_transfer | ❌ 未过 | 50.7 | 4/78/2 | 5 | 0/4 | Y/Y | 1.32 | tol=2,F0=4 | — |
| 3 | `KP_relief_split_r0c5` | relief_split | ❌ 未过 | 16.3 | 3/16/15 | 5 | 0/0 | Y/Y | 1.39 | peak=3,mid=16,midDrop=23,midFlat=16 | baselineFlat |

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
node 03_工具/正式版/KnobPlan_v1.js ../正常关卡/G8_bq_level_98.json --intent fix-opening --profile low-churn --top 3 --max-candidates 3
```