# KnobPlan：G8_bq_level_121.json

> 意图：`ease`；profile：`low-churn`；规则：`bottomOnly（仅底边出口）`；生成 37 个候选，检查 3 个。

## 1. 基线诊断

- 文件：`../正常关卡/G8_bq_level_121.json`
- 难度分 D：**17.8**（easy）
- 硬门：can=✓，peak=4，openM=6，layout hard=0
- 形状：mid=69%，tol=20/20
- 体验：C0@buf<5=0，F0@buf≥3=1，clickForced=Y，policy0=Y
- 选择空间：M=6.157894736842105，entropy=1.319372319882329，fake=2，forced=1
- 19 项未过：最长连续免费≤5=6 步；中段最长低压≤5=6 步（buf≤1 连续）；象限并行度≤3.6=3.66（38 步）；玩家后20% at3≥2=1 步；玩家后20% 连续≥2=1；容错 55–75%=20/20；最长连续没得选≤2=5 步；at4≥5=1

## 2. 候选排序

| # | 候选 | 类型 | 结论 | D | peak/mid/tol | openM | C0/F0 | clickForced/policy0 | H | 未过项 | 提示 |
|---:|---|---|---|---:|---|---:|---|---|---|---|---|
| 1 | `KP_pipe_r3c2_0_1` | pipe_order | ✅ 推荐 | 15.8 | 4/69/20 | 6 | 0/1 | Y/Y | 1.37 | — | tolLoose |
| 2 | `KP_chain_soft_4` | chain_soften | 🟡 合格但压平 | 17.8 | 4/50/20 | 6 | 0/1 | Y/Y | 1.32 | DNotDown=17.8 | tolLoose |
| 3 | `KP_chain_soft_4,0` | chain_soften | 🟡 合格但压平 | 21.4 | 4/69/20 | 6 | 0/1 | Y/Y | 1.28 | DNotDown=21.4 | tolLoose |

## 3. 推荐候选

### 1. `KP_pipe_r3c2_0_1`（pipe_order）

- 改法：管道 r3c2 队列第 1↔2 项互换
- 为什么：只改晚段供给顺序；不改容量、不改位置
- 文件：`实验关/产线v3/G4/KnobPlan_G8_121_ease/candidates/KP_pipe_r3c2_0_1/KP_pipe_r3c2_0_1.json`
- 指标：D **15.8**（基线 17.8），peak/mid/tol=4/69/20，openM=6，C0/F0=0/1，clickForced=Y，policy0=Y，H=1.37
- 风险：pipe-order
- 提示：tolLoose

## 4. 说明

- 这是“单旋钮”候选，不是自动最优解；每个候选只改一个 motif。
- `链组软化` 保留链结构，只降成员容量；`链组拆除` 默认不生成，需 `--allow-chain-remove`。
- 所有指标沿用现有模型：ArlCheck 19 项、点击结算 forced/policy、free-first OpeningCheck、ChoiceSpace、LayoutScore。`--player` 才额外跑 PlayerSim。
- **口径提醒**：默认的 `clickForced/policy0` 是点击结算口径；它不等于 PlayerSim 的 `forced/policy0`。L2/L7 的基线就是“点击结算 policy0=Y、PlayerSim policy0=N”的反例；要判真实玩家 0 复活，必须加 `--player`。
- `profile` 的 mid 区间和 `guards` 是防“降难度=压平”的护栏；D 降低但 mid/entropy 掉了，会被标成“合格但压平”。

## 5. 复现

```bash
node 03_工具/正式版/KnobPlan_v1.js ../正常关卡/G8_bq_level_121.json --intent ease --profile low-churn --top 3 --max-candidates 3
```