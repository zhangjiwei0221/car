# 点击结算 forced 检查（2026-11-10）

> **2026-11-10 新 CSV 更新**：本文里的“高流失 5 关”是旧快照（进入 319）；`关卡数据/分组2-20261110-新指标.csv`（进入 384）的 >20% 关流失是 **7 关（2/3/4/5/7/10/11）**，L12 为 18.75%。新集合的 forced×流失尚未重算；旧“5 关”结论只当旧快照证据。
>
> 工具：`03_工具/正式版/ClickSettleEngineCheck_v1.js`（只读）
> 口径（用户 2026-11-10 明确）：点一次车 → 当前可达像素一次吃满（`Simulator.applyPick` → `autoReleaseBuffer`）；**暂存区最多 5**；锁链组入场需 N 个空位，`buffer+N>5` 即不可选；结算后满 5 且本步无车吃满 → 死；不存在“本步有车吃满可短暂超 5”。

## 1. 三张候选

| 候选 | solver | PlayerSim forced | 点击结算 forced | 点击 peak |
|---|---|---|---|---|
| 00045 v7 | Y(48) | Y(48,mm0) | **Y(48,mm0)** | 4 |
| 拼接006 `pin15_32+pipe53` | Y(48) | Y | **Y(48,mm0)** | 4 |
| F2 | Y(47) | **N(28)** | **Y(47,mm0)** | 4 |

**F2 的 forcedN 是 PlayerSim 模型差异**：在点击结算口径下，求解器最小路线 47 步可走完，peak4。v7 和拼接也全部 Y。

### 1.1 严格 ≤5 后，旧点击结算数字作废

旧的 `AnimClickSettle_v1` 允许“本步有车吃满时链组短暂超 5”。按用户规则改成严格 ≤5 后：

| 关卡 | 旧数字（允许短暂超 5） | 严格 ≤5（2026-11-10 重跑） |
|---|---|---|
| 00045 v7 | free 9/48、peak4 | **free 8/48、peak4** |
| 拼接 `pin15_32+pipe53` | free 24/47、peak6 | **free 14/48、peak4** |
| F2 | free 25/47、peak5 | free-first 贪心 + beam60 **找不到路线**；但 solver min 路线 **forced=Y(47,peak4)** |

- 旧拼接的峰值 6 必然依赖超额状态；F2 的旧峰值 5 虽未超额，但旧路线在严格口径下不再可复现（贪心/beam60 找不到）。两关旧点击结算数字都不能再用。
- F2 仍然可解（solver min 路线 Y），只是 `AnimClickSettle` 的自由贪心/束搜索没找到；需要把 solver 路线作为回退或加 `--from-solver`。

## 2. G2 2–13

| 关 | 流失② | solver | PlayerSim forced | 点击结算 forced | 点击死亡 |
|---:|---:|---|---|---|---|
| 2 | 45.77% | Y(45) | N(8) | **Y(45)** | — |
| 3 | 30.64% | **N(12)** | N(8) | N(12) | solver 无有效路线（修复后转 N） |
| 4 | 14.17% | Y(46) | Y | Y(46) | — |
| 5 | 36.89% | Y(47) | N(41) | **Y(47)** | — |
| 6 | 9.23% | Y(45) | Y | Y(45) | — |
| 7 | 20.34% | **N(39)** | N(35) | N(39) | solver 无有效路线 |
| 8 | 10.64% | Y(40) | N(6) | **Y(40)** | — |
| 9 | 7.14% | Y(45) | Y | Y(45) | — |
| 10 | 15.38% | Y(36) | N(19) | **Y(36)** | — |
| 11 | 9.09% | **N(13)** | N(13) | N(13) | solver 无有效路线（修复后转 N） |
| 12 | 20.00% | Y(43) | N(13) | **Y(43)** | — |
| 13 | 4.17% | Y(40) | Y | Y(40) | — |

**修复后汇总：12 关里 solver=Y 9 张、clickForced=Y 9 张、fail 0；solver=N 3 张（3/7/11）。所有 solver=Y 路线在点击结算下都走得通。**

- 高流失 5 关：L2/L5/L12 **Y**，L3/L7 N → **forced 仍不是干净分界**。
- PlayerSim forcedN 的 L2/L5/L8/L10 在点击结算下全部翻成 Y。
- L11 低流失（9.09%）但 solver=N；Policy0 仍 Y（换一条玩家路线能过）。

## 3. 已修复：`runMinBuffer` 忽略 overflow 导致 solver=Y 假阳性

修复前，L3/L11/L12 的点击结算死亡不是“关卡无解”，而是 **`runMinBuffer` 的最小路线本身越过了暂存上限**：

- L3：第 12 步 `bufferBefore=4 → bufferAfter=5`，本步无车完成 → 溢出；
- L11：第 9 步同样；
- L12：第 25 步同样。

代码原因：

- `applyPick` 在结算后满 5 且无完成时会置 `s.overflow = true`（[simulator.js:865](../../02_工程/游戏主bin/bin/js/simulator.js:865)、[simulator.js:894](../../02_工程/游戏主bin/bin/js/simulator.js:894)）；
- 但 `runMinBuffer` 只检查 `s2.gameOver`，没有检查 `s2.overflow`（[solver.js:331](../../02_工程/游戏主bin/bin/js/solver.js:331)）；
- `applyPick` 本身不置 `gameOver`，所以溢出被忽略，路线继续走完并报 `solver=Y`。

> 实现注意：`applyPick` 是低层函数，不做容量门；调用方必须先过 `Simulator.listMoves` 的 `blocked`（或编辑器 `pickCapacityOf`）。本工具和 `AnimClickSettle_v1` 已按此执行。

**修复（2026-11-10）**：`solver.js` 的 `runMinBuffer` 三处加检查：

1. 候选试算 `s2`：`s2.gameOver || s2.overflow || s2.buffer.length > limit` → 跳过；
2. rollout：同样条件 → 返回无效；
3. 主循环落地后：`state.overflow || state.buffer.length > limit` → `dead=true; break`。

**修复后验证**：

| 关 | solver 前 | solver 后 | 点击结算 forced | ArlCheck 可通关 |
|---|---|---|---|---|
| 3 | Y(40)（假阳性） | **N(12)** | N(12) | **✗**（原来假 ✓） |
| 11 | Y(41)（假阳性） | **N(13)** | N(13) | **✗**（原来假 ✓） |
| 12 | Y(43)（路线溢出） | **Y(43)** | **Y(43)** | ✓ |

- G2 2–13 修复后：solver=Y **9** 张、clickForced=Y **9** 张、fail **0**；solver=N 3 张（3/7/11）。
- **不变式：修复后 `solver=Y ⇒ clickForced=Y`**（求解器和点击结算现在是同一套 applyPick 口径）。
- L11 虽 solver=N，但 PlayerSim `policy0=Y` —— 关卡仍可通过另一条玩家路线通关；只是“最小路线”不成立。
- 三张候选（v7/拼接/F2）修复前后都是 clickForced=Y。

历史结果需要重读：`ArlCheck_v793` 之前对 L3/L11 的“可通关 ✓”是假阳性；19 项报告里这两关的通关项应改为 ✗。同一次重跑还纠正了指标：**L3/L7/L11/L12 的峰值 5→4**（旧峰值来自溢出路线），at4 也变化（L3 12→5、L11 7→1、L12 4→3）。详见 `研究_总关卡分组2_2-13/结果.md §8`。

## 4. 结论

1. **PlayerSim forcedN ≠ 点击结算 forcedN**；F2 就是反例（PlayerSim N，点击结算 Y）。
2. 点击结算口径下，v7/拼接/F2 三张候选的 solver 路线都走得通（peak4）。
3. G2 2–13 的点击结算 forced 仍不是干净分界；高流失 5 关里 L2/L5/L12 是 Y，L3/L7 是 N；低流失 L11 也是 N。
4. **`runMinBuffer` 的 overflow 检查已修**：L3/L11 从假阳性 solver=Y 转 N（ArlCheck 可通关改 ✗），L12 找到有效路线 Y；修复后 `solver=Y ⇒ clickForced=Y`，G2 2–13 的 9 张 solver=Y 全部 clickForced=Y。
5. 现有 `AnimClickSettle_v1` 的“链组本步有车吃满可短暂超 5”已删除：暂存区最多 5；链组点击前检查 `buffer+N>5`。严格口径重跑后，拼接 free 24→14、peak6→4；F2 贪心/beam 找不到路线但 solver 路线 Y；v7 free 9→8。旧点击结算数字作废。
6. 下一步：给 `AnimClickSettle` 加 `--from-solver` 回退，让 F2 这类“贪心找不到、solver 有解”的关能出动画；再补点击结算口径的 policy0/2。

## 5. 复现

```bash
node 03_工具/正式版/ClickSettleEngineCheck_v1.js <关卡.json | 目录> [--out report.json]
```

G2 2–13 的中间目录必须只放 2–13 这 12 个文件（总目录里有 100+ 关）；修复前结果 JSON：`click_forced_20261110.json`，修复后：`click_forced_20261110_after_solverfix.json`。
