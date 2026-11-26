# KnobPlan：G2_bq_level_12.json

> 意图：`raise-mid`；profile：`low-churn`；生成 18 个候选，检查 4 个。

## 1. 基线诊断

- 文件：`实验关/产线v3/G3/3B_保链/G2_bq_level_12.json`
- 难度分 D：**24.3**（mid-easy）
- 硬门：can=✓，peak=4，openM=6，layout hard=0
- 形状：mid=17%，tol=13/20
- 体验：C0@buf<5=0，F0@buf≥3=2，clickForced=Y，policy0=Y
- 选择空间：M=5.883720930232558，entropy=1.3802232052144183，fake=2，forced=1
- 19 项未过：玩家中段 45–80%=5 步（占比 17%）；中段最长低压≤5=7 步（buf≤1 连续）；象限并行度≤3.6=3.84（43 步）；全程最少未动主体≥1=最少 0，平均 2.07/4；at4≥5=3

> ⚠️ 基线 mid=17% 已经低于 45：先修中段，不要用 ease 继续放水。

## 2. 候选排序

| # | 候选 | 类型 | 结论 | D | peak/mid/tol | openM | C0/F0 | clickForced/policy0 | H | 未过项 |
|---:|---|---|---|---:|---|---:|---|---|---|---|
| 1 | `KP_cap_14_small2big` | capacity_small2big | ❌ 未过 | 21.1 | 4/23/20 | 6 | 0/2 | Y/Y | 1.38 | tol=20,midFlat=23 |
| 2 | `KP_iceadd_r0c0_4` | ice_add | ❌ 未过 | 21.9 | 4/17/14 | 5 | 0/2 | Y/Y | 1.45 | mid=17,midFlat=17,midNotUp |
| 3 | `KP_cap_13_small2big` | capacity_small2big | ❌ 未过 | 22.9 | 4/17/15 | 6 | 0/2 | Y/Y | 1.38 | mid=17,midFlat=17,midNotUp |
| 4 | `KP_iceadd_r0c0_6` | ice_add | ❌ 未过 | 20.3 | 4/13/16 | 5 | 0/2 | Y/Y | 1.46 | mid=13,tol=16,midFlat=13,midNotUp |

## 3. 推荐候选

没有候选同时满足 profile 和“不压平”护栏。看上面未过项，优先修硬门，不要继续降难度。
## 4. 说明

- 这是“单旋钮”候选，不是自动最优解；每个候选只改一个 motif。
- `链组软化` 保留链结构，只降成员容量；`链组拆除` 默认不生成，需 `--allow-chain-remove`。
- 所有指标沿用现有模型：ArlCheck 19 项、点击结算 forced/policy、free-first OpeningCheck、ChoiceSpace、LayoutScore。`--player` 才额外跑 PlayerSim。
- `profile` 的 mid 区间和 `guards` 是防“降难度=压平”的护栏；D 降低但 mid/entropy 掉了，会被标成“合格但压平”。

## 5. 复现

```bash
node 03_工具/正式版/KnobPlan_v1.js 实验关/产线v3/G3/3B_保链/G2_bq_level_12.json --intent raise-mid --profile low-churn --top 4 --max-candidates 4
```