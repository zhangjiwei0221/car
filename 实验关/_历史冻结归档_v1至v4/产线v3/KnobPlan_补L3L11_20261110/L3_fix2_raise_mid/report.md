# KnobPlan：L3_fix2.json

> 意图：`raise-mid`；profile：`low-churn`；生成 14 个候选，检查 6 个。

## 1. 基线诊断

- 文件：`../../../../tmp/l3l11_variants/L3_fix2.json`
- 难度分 D：**16.4**（easy）
- 硬门：can=✓，peak=3，openM=5，layout hard=0
- 形状：mid=32%，tol=20/20
- 体验：C0@buf<5=0，F0@buf≥3=0，clickForced=Y，policy0=Y
- 选择空间：M=5.170731707317073，entropy=1.3447013692819316，fake=0，forced=3
- 19 项未过：峰值=4=3；玩家中段 45–80%=9 步（占比 32%）；中段最长低压≤5=9 步（buf≤1 连续）；象限并行度≤3.6=3.76（41 步）；主体并行度≤65%=2.27/3，76%；全程最少未动主体≥1=最少 0，平均 0.73/3；容错 55–75%=20/20；at4≥5=0

> ⚠️ 基线 mid=32% 已经低于 45：先修中段，不要用 ease 继续放水。

## 2. 候选排序

| # | 候选 | 类型 | 结论 | D | peak/mid/tol | openM | C0/F0 | clickForced/policy0 | H | 未过项 | 提示 |
|---:|---|---|---|---:|---|---:|---|---|---|---|---|
| 1 | `KP_cap_2_small2big` | capacity_small2big | ✅ 推荐 | 23.7 | 3/43/17 | 5 | 0/0 | Y/Y | 1.21 | — | tolLoose,baselineFlat |
| 2 | `KP_pipe_r2c4_1_2` | pipe_order | ✅ 推荐 | 12.8 | 3/39/20 | 5 | 0/0 | Y/Y | 1.40 | — | tolLoose,baselineFlat |
| 3 | `KP_pipe_r2c4_0_1` | pipe_order | ❌ 未过 | 16.6 | 3/32/20 | 5 | 0/0 | Y/Y | 1.35 | mid=32,midNotUp | tolLoose,baselineFlat |
| 4 | `KP_cap_22_small2big` | capacity_small2big | ❌ 未过 | 15.1 | 3/29/20 | 5 | 0/0 | Y/Y | 1.33 | mid=29,midFlat=29,midNotUp | tolLoose,baselineFlat |
| 5 | `KP_iceadd_r0c0_4` | ice_add | ❌ 未过 | 62.2 | 4/29/2 | 4 | 2/2 | Y/Y | 1.36 | peak=4,openM=4,mid=29,tol=2,C0=2,midFlat=29,midNotUp | baselineFlat |
| 6 | `KP_iceadd_r0c0_6` | ice_add | ❌ 未过 | 82.2 | 4/29/4 | 4 | 2/2 | N/N | 1.34 | can=✗,peak=4,openM=4,mid=29,tol=4,C0=2,clickForced=N,policy0=N,midFlat=29,midNotUp | baselineFlat |

## 3. 推荐候选

### 1. `KP_cap_2_small2big`（capacity_small2big）

- 改法：颜色2：r2c0 22→11，r4c1 70→81
- 为什么：同色内把小车的容量并给大车；总像素不变，债更集中
- 文件：`实验关/产线v3/KnobPlan_补L3L11_20261110/L3_fix2_raise_mid/candidates/KP_cap_2_small2big/KP_cap_2_small2big.json`
- 指标：D **23.7**（基线 16.4），peak/mid/tol=3/43/17，openM=5，C0/F0=0/0，clickForced=Y，policy0=Y，H=1.21
- 风险：capacity
- 提示：tolLoose、baselineFlat

### 2. `KP_pipe_r2c4_1_2`（pipe_order）

- 改法：管道 r2c4 队列第 2↔3 项互换
- 为什么：只改晚段供给顺序；不改容量、不改位置
- 文件：`实验关/产线v3/KnobPlan_补L3L11_20261110/L3_fix2_raise_mid/candidates/KP_pipe_r2c4_1_2/KP_pipe_r2c4_1_2.json`
- 指标：D **12.8**（基线 16.4），peak/mid/tol=3/39/20，openM=5，C0/F0=0/0，clickForced=Y，policy0=Y，H=1.40
- 风险：pipe-order
- 提示：tolLoose、baselineFlat

## 4. 说明

- 这是“单旋钮”候选，不是自动最优解；每个候选只改一个 motif。
- `链组软化` 保留链结构，只降成员容量；`链组拆除` 默认不生成，需 `--allow-chain-remove`。
- 所有指标沿用现有模型：ArlCheck 19 项、点击结算 forced/policy、free-first OpeningCheck、ChoiceSpace、LayoutScore。`--player` 才额外跑 PlayerSim。
- **口径提醒**：默认的 `clickForced/policy0` 是点击结算口径；它不等于 PlayerSim 的 `forced/policy0`。L2/L7 的基线就是“点击结算 policy0=Y、PlayerSim policy0=N”的反例；要判真实玩家 0 复活，必须加 `--player`。
- `profile` 的 mid 区间和 `guards` 是防“降难度=压平”的护栏；D 降低但 mid/entropy 掉了，会被标成“合格但压平”。

## 5. 复现

```bash
node 03_工具/正式版/KnobPlan_v1.js ../../../../tmp/l3l11_variants/L3_fix2.json --intent raise-mid --profile low-churn --top 6 --max-candidates 6
```