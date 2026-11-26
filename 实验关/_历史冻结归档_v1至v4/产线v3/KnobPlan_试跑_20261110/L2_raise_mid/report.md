# KnobPlan：G2_bq_level_2.json

> 意图：`raise-mid`；profile：`low-churn`；生成 18 个候选，检查 4 个。

## 1. 基线诊断

- 文件：`实验关/产线v3/G3/3B_保链/G2_bq_level_2.json`
- 难度分 D：**14.4**（easy）
- 硬门：can=✓，peak=4，openM=6，layout hard=0
- 形状：mid=21%，tol=9/20
- 体验：C0@buf<5=0，F0@buf≥3=0，clickForced=Y，policy0=Y
- 选择空间：M=5.680851063829787，entropy=1.4534526378406571，fake=2，forced=1
- 19 项未过：最长连续免费≤5=13 步；玩家中段 45–80%=4 步（占比 21%）；中段最长低压≤5=32 步（buf≤1 连续）；象限并行度≤3.6=3.83（47 步）；主体并行度≤65%=2.70/4，68%；全程最少未动主体≥1=最少 0，平均 1.30/4；容错 55–75%=9/20；最长连续没得选≤2=4 步；at4≥5=1

> ⚠️ 基线 mid=21% 已经低于 45：先修中段，不要用 ease 继续放水。

## 2. 候选排序

| # | 候选 | 类型 | 结论 | D | peak/mid/tol | openM | C0/F0 | clickForced/policy0 | H | 未过项 |
|---:|---|---|---|---:|---|---:|---|---|---|---|
| 1 | `KP_iceadd_r0c1_6` | ice_add | ❌ 未过 | 8.9 | 4/38/16 | 5 | 0/0 | Y/Y | 1.41 | tol=16 |
| 2 | `KP_iceadd_r0c1_4` | ice_add | ❌ 未过 | 19.9 | 4/37/3 | 5 | 0/0 | Y/Y | 1.45 | tol=3 |
| 3 | `KP_cap_13_small2big` | capacity_small2big | ❌ 未过 | 10.1 | 4/34/16 | 6 | 0/0 | Y/Y | 1.45 | tol=16 |
| 4 | `KP_cap_14_small2big` | capacity_small2big | ❌ 未过 | 5.6 | 4/21/9 | 6 | 0/0 | Y/Y | 1.54 | mid=21,midFlat=21,midNotUp |

## 3. 推荐候选

没有候选同时满足 profile 和“不压平”护栏。看上面未过项，优先修硬门，不要继续降难度。
## 4. 说明

- 这是“单旋钮”候选，不是自动最优解；每个候选只改一个 motif。
- `链组软化` 保留链结构，只降成员容量；`链组拆除` 默认不生成，需 `--allow-chain-remove`。
- 所有指标沿用现有模型：ArlCheck 19 项、点击结算 forced/policy、free-first OpeningCheck、ChoiceSpace、LayoutScore。`--player` 才额外跑 PlayerSim。
- `profile` 的 mid 区间和 `guards` 是防“降难度=压平”的护栏；D 降低但 mid/entropy 掉了，会被标成“合格但压平”。

## 5. 复现

```bash
node 03_工具/正式版/KnobPlan_v1.js 实验关/产线v3/G3/3B_保链/G2_bq_level_2.json --intent raise-mid --profile low-churn --top 4 --max-candidates 4
```