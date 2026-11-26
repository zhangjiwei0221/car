# KnobPlan：G4_lump_12_bm120_split19_80.json

> 意图：`raise-mid`；profile：`low-churn`；规则：`bottomOnly（仅底边出口）`；生成 6 个候选，检查 2 个。

## 1. 基线诊断

- 文件：`实验关/产线v3/G4/build_split/G4_lump_12_bm120_split19_80.json`
- 难度分 D：**22.4**（mid-easy）
- 硬门：can=✓，peak=4，openM=7，layout hard=0
- 形状：mid=40%，tol=11/20
- 体验：C0@buf<5=0，F0@buf≥3=0，clickForced=Y，policy0=Y
- 选择空间：M=5.666666666666667，entropy=1.2239644667403111，fake=1，forced=1
- 19 项未过：玩家中段 45–80%=4 步（占比 40%）；象限并行度≤3.6=3.87（15 步）；主体并行度≤65%=1.60/2，80%；全程最少未动主体≥1=最少 0，平均 0.40/2；玩家后20% at3≥2=0 步；玩家后20% 连续≥2=0；at4≥5=3

> ⚠️ 基线 mid=40% 已经低于 45：先修中段，不要用 ease 继续放水。

## 2. 候选排序

| # | 候选 | 类型 | 结论 | D | peak/mid/tol | openM | C0/F0 | clickForced/policy0 | H | 未过项 | 提示 |
|---:|---|---|---|---:|---|---:|---|---|---|---|---|
| 1 | `KP_iceadd_r1c1_4` | ice_add | ❌ 未过 | 22.1 | 4/40/11 | 7 | 0/0 | Y/Y | 1.24 | mid=40,midNotUp | baselineFlat |
| 2 | `KP_iceadd_r1c1_6` | ice_add | ❌ 未过 | 22.9 | 4/40/11 | 7 | 0/0 | Y/Y | 1.22 | mid=40,midNotUp | baselineFlat |

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
node 03_工具/正式版/KnobPlan_v1.js 实验关/产线v3/G4/build_split/G4_lump_12_bm120_split19_80.json --intent raise-mid --profile low-churn --top 3 --max-candidates 3
```