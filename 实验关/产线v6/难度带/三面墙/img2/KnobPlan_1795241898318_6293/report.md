# KnobPlan：关卡_ZC_W2_guard0_rx.json

> 意图：`fix-opening`；profile：`low-churn`；规则：`fourSide（四边出口）`；生成 30 个候选，检查 7 个。

## 1. 基线诊断

- 文件：`实验关/产线v6/难度带/三面墙/img2/关卡_ZC_W2_guard0_rx.json`
- 难度分 D：**38.3**（mid-easy）
- 硬门：can=✓，peak=4，openM=6，layout hard=0
- 形状：mid=96%，tol=15/20
- 体验：C0@buf<5=0，F0@buf≥3=1，clickForced=Y，policy0=Y
- 选择空间：M=5.25，entropy=1.4208428693490183，fake=0，forced=0
- 19 项未过：最长连续免费≤5=6 步；玩家中段 45–80%=26 步（占比 96%）；中段最长低压≤5=12 步（buf≤1 连续）；玩家后20% at3≥2=1 步；玩家后20% 连续≥2=1；at4≥5=3

## 2. 候选排序

| # | 候选 | 类型 | 结论 | D | peak/mid/tol | openM | C0/F0 | clickForced/policy0 | H | 未过项 | 提示 |
|---:|---|---|---|---:|---|---:|---|---|---|---|---|
| 1 | `KP_openice_r0c1` | open_ice_remove | ✅ 推荐 | 38.6 | 4/96/12 | 7 | 0/1 | Y/Y | 1.38 | — | — |
| 2 | `KP_relief_transfer_r0c1` | relief_transfer | ❌ 未过 | 36 | 3/96/13 | 7 | 0/1 | Y/Y | 1.43 | peak=3 | — |
| 3 | `KP_swap_r0c0_r1c3` | swap_top | ❌ 未过 | 28.6 | 3/96/20 | 6 | 0/0 | Y/Y | 1.32 | peak=3,tol=20 | tolLoose |
| 4 | `KP_swap_r0c0_r1c1` | swap_top | ❌ 未过 | 37.6 | 4/96/18 | 6 | 0/1 | Y/Y | 1.43 | tol=18 | tolLoose |
| 5 | `KP_cap_14_big2small` | capacity_big2small | ❌ 未过 | 37.7 | 4/96/16 | 6 | 0/1 | Y/Y | 1.42 | tol=16 | tolLoose |
| 6 | `KP_cap_27_big2small` | capacity_big2small | ❌ 未过 | 46.4 | 4/100/0 | 6 | 0/1 | Y/Y | 1.42 | mid=100,tol=0 | — |
| 7 | `KP_swap_r0c0_r1c2` | swap_top | ❌ 未过 | 48.7 | 3/100/0 | 6 | 0/1 | Y/Y | 1.36 | peak=3,mid=100,tol=0 | — |

## 3. 推荐候选

### 1. `KP_openice_r0c1`（open_ice_remove）

- 改法：清掉 r0c1 的冰（21）
- 为什么：补开局最直接，但可能把大车直接暴露；M4.6 记录过会塌
- 文件：`实验关/产线v6/难度带/三面墙/img2/KnobPlan_1795241898318_6293/candidates/KP_openice_r0c1/KP_openice_r0c1.json`
- 指标：D **38.6**（基线 38.3），peak/mid/tol=4/96/12，openM=7，C0/F0=0/1，clickForced=Y，policy0=Y，H=1.38
- 风险：clears-ice、risk-collapse
- 提示：无

## 4. 说明

- 这是“单旋钮”候选，不是自动最优解；每个候选只改一个 motif。
- `链组软化` 保留链结构，只降成员容量；`链组拆除` 默认不生成，需 `--allow-chain-remove`。
- 所有指标沿用现有模型：ArlCheck 19 项、点击结算 forced/policy、free-first OpeningCheck、ChoiceSpace、LayoutScore。`--player` 才额外跑 PlayerSim。
- **口径提醒**：默认的 `clickForced/policy0` 是点击结算口径；它不等于 PlayerSim 的 `forced/policy0`。L2/L7 的基线就是“点击结算 policy0=Y、PlayerSim policy0=N”的反例；要判真实玩家 0 复活，必须加 `--player`。
- `profile` 的 mid 区间和 `guards` 是防“降难度=压平”的护栏；D 降低但 mid/entropy 掉了，会被标成“合格但压平”。

## 5. 复现

```bash
node 03_工具/正式版/KnobPlan_v1.js 实验关/产线v6/难度带/三面墙/img2/关卡_ZC_W2_guard0_rx.json --intent fix-opening --profile low-churn --top 5 --max-candidates 10
```