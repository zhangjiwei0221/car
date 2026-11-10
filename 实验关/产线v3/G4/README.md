# 分组4：仅底边出口（2026-11-10）

> **机制**：目标图像的上/左/右三面是墙，只有底边（JSON `rows-1`）是出口。
> 像素只有在底边、或邻接已消格时才可选；贴着上/左/右的像素必须先等里面的邻居消掉、露出通往底边的通路。
> 棋盘取盒逻辑不变（仍按顶部暴露/暂存规则）。
>
> **实现**：JS 的 `Simulator/Solver/PlayerSim` 原本已有 `bottomOnly`；这次把它透传到 v3 检查：
> `ArlCheck`、`ClickSettleEngineCheck`、`ClickSettlePolicyCheck`、`OpeningCheck`、`ChoiceSpaceCheck`、`PlayerEngineCheck`、`RecoveryVariantCheck`、`KnobPlan` 都支持 `--bottom-only`。

## 1. 选关

- 源目录：`/Users/red/Desktop/正常关卡`（212 个 G8 关卡）。
- 用 `Solver.runMinBuffer({bottomOnly:true, depth:1})` 预筛：**93/212 可通**。
- 第一批 8 个（`G4/关卡`）：G4_9/12/22/54/67/103/129/144，覆盖 35×35～45×45、6×7～8×8。
- 第二批 4 个（`G4/第二批_筛后`）：G4_98/118/121/125，按底边 ArlCheck 硬指标筛出。

## 2. 第一批：正常关直搬

命令：

```bash
node 03_工具/正式版/RecoveryVariantCheck_v1.js 实验关/产线v3/G4/关卡 --bottom-only --limit 8 --out 实验关/产线v3/G4/checks_bottom.json
```

| 关 | peak | mid | tol | open | C0/F0 | policy0 | ff 0复活 | 19项 |
|---:|---:|---:|---:|---:|---|---|---|---|
| 9 | 4 | 40 | 0 | 5 | 3/3 | Y | N | ❌ |
| 12 | 4 | 4 | 6 | 3 | 0/1 | Y | Y | ❌ |
| 22 | 4 | 92 | 0 | 1 | 0/3 | N | N | ❌ can✗ |
| 54 | 4 | 58 | 10 | 3 | 0/0 | Y | Y | ❌ layout hard1 |
| 67 | 4 | 0 | 0 | 3 | 0/2 | Y | N | ❌ layout hard2 |
| 103 | 4 | 20 | 0 | 4 | 2/1 | Y | Y | ❌ |
| 129 | 3 | 50 | 10 | 3 | 0/1 | Y | Y | ❌ |
| 144 | 4 | 100 | 10 | 6 | 0/4 | Y | N | ❌ layout hard1 |

**结果：7/8 可通关，0/8 过 19 项。** 最接近的是 L54（mid58，但 open3/layout hard1）和 L129（mid50，但 peak3/open3）。

PlayerSim（底边）：

- L54：`forced=N / policy0=N / policy2=Y`；
- L129：`forced=Y / policy0=N / policy2=Y`；
- L144：`forced=N / policy0=N / policy2=Y`。

## 3. 第二批：筛后的 4 个

| 关 | peak | mid | tol | open | C0/F0 | policy0 | ff 0复活 | M/entropy | 19项 |
|---:|---:|---:|---:|---:|---|---|---|---|---|
| 98 | 4 | 39 | 12 | 4 | 0/0 | Y | Y | 5.98/1.21 | ❌ mid39/open4 |
| 118 | 4 | 23 | 14 | 5 | 2/1 | Y | Y | 4.97/1.16 | ❌ mid23/C0 |
| 121 | 4 | 69 | 20 | 6 | 0/1 | Y | Y | 6.16/1.32 | ❌ tol20 |
| 125 | 4 | 60 | 2 | 5 | 2/1 | Y | Y | 5.19/1.24 | ❌ tol2/layout1 |

**结果：0/4 过 19 项。** L121 中段最好（69），但 tol20 偏松；L125 中段 60，但 tol2 极脆；L98 差在 mid39/open4；L118 差在 mid23/C0。

## 4. KnobPlan（底边单旋钮）试跑

命令示例：

```bash
node 03_工具/正式版/KnobPlan_v1.js /Users/red/Desktop/正常关卡/G8_bq_level_121.json \
  --bottom-only --intent ease --max-candidates 3 --top 3 \
  --out 实验关/产线v3/G4/KnobPlan_G8_121_ease
```

- G8_121：`KP_pipe_r3c2_0_1`（管道相邻队列互换）D17.8→15.8、mid69、tol20、open6、C0/F0=0/1、clickForced/policy0=Y/Y；profile 过，但有 `tolLoose`。PlayerSim 仍 `policy0=N / policy2=Y`（基线也 N）。
- G8_98：`fix-opening` 3 个候选都未过；最好的 `relief_split_r0c5` open5，但 peak3/mid16。
- G8_118：`raise-mid` 3 个候选都未过；C0=2 和 mid 低没同时解决。
- G8_125：`ease` 3 个候选都未过；layout hard1/C0=2/tol2 是结构问题。

## 5. 第一关：底边重排

源图 G8_12，用 `G4Build_v1` 按底边轮次切车、合并同色大车、拆 19 色成链：

```bash
node 03_工具/正式版/G4Build_v1.js /Users/red/Desktop/正常关卡/G8_bq_level_12.json \
  --out 实验关/产线v3/G4/第一关/G4_第一关_底边重排.json \
  --rows 7 --cols 7 --box-min 20 --box-max 120 --lump \
  --split-colors 19 --split-max 80 --auto-chain 8
```

指标（`--bottom-only`）：peak4 / mid40 / tol11 / open7 / C0=0 / F0=0 / 点击 policy0=Y / free-first 0复活=Y / 排版 hard0。**19 项不通过**：mid40、后20% at3=0、at4=3、象限3.87、主体80%、未动主体0。PlayerSim：`solver=Y / forced=N / policy0=N / policy2=Y`。

这是第一张“底边重排骨架”，不是成品；详见 `第一关/README.md`。

## 6. 结论

1. **正常关卡不能直接搬到“仅底边出口”**：7/8 可通关，但 0/8 过 19 项；第二批 0/4。
2. 失败不是“完全不可玩”，而是**曲线/选项/容错同时偏**：底边入口改变了像素暴露顺序，原来的顶部车盘布局不再匹配。
3. 单旋钮只能救很小的一步：G8_121 的管道顺序能降 D 约 2 分，但 tol20、PlayerSim policy0 N 没变；G8_98/118/125 单旋钮不够。
4. 已按底边规则重排做出第一关（§5）：用 `blocks` 作目标图、按底边消除轮次切车/摆盘；详见 `第一关/README.md`。
5. 第一关是骨架，不是成品：peak4/mid40/tol11/open7/C0=F0=0 已成立，但 mid40、后20% at3=0、at4=3 未过，PlayerSim `forced=N/policy0=N`。下一步补中段/后段可恢复债，再谈上线。

## 7. 文件

- `G4/manifest.json`：第一批 8 关；
- `G4/关卡/`：第一批关卡副本（G4_bq_level_*.json）；
- `G4/checks_bottom.json`：第一批完整检查；
- `G4/第二批_筛后/`：第二批 4 关 + manifest；
- `G4/checks_bottom_second.json`：第二批完整检查；
- `G4/KnobPlan_G8_98_open/`、`G4/KnobPlan_G8_118_mid/`、`G4/KnobPlan_G8_121_ease/`、`G4/KnobPlan_G8_125_ease/`：底边单旋钮试跑；
- `G4/第一关/G4_第一关_底边重排.json`：第一张按底边重排的关卡；
- `G4/第一关/README.md`：第一关指标/PlayerSim/下一步；
- `03_工具/正式版/G4Build_v1.js`：底边轮次切车 + 同色大车 + 可选成链。
