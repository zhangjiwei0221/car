# 点击结算策略族（policy0/2）检查（2026-11-10）

> 工具：`03_工具/正式版/ClickSettlePolicyCheck_v1.js`（只读）
> 口径：点击结算（`Simulator.applyPick`，一次吃满当前可达像素）；暂存最多 5；链组 `buffer+N>5` 不可选；结算后满 5 且本步无车吃满 → 死。
> 策略族：`solver`（求解器最小路线，失效回退 free-first）、`free-first`（先拿能吃完的）、`max-eat`（先比吃得多）、`small-debt`（先比暂存少/剩余债少）。
> 复活：移除暂存里剩余最大的 2 辆车（暂存不足用棋盘残留盒补），无视可达性消掉剩余像素；与 `PlayerSim.revivePS` 同语义。`policy0/2` = 0/最多 2 次复活是否有策略通关。

## 1. 三张候选

| 候选 | policy0 | policy2 | 0 复活胜出的策略 | free-first 0 复活 |
|---|---|---|---|---|
| 00045 v7 | **Y** | **Y** | solver, free-first, max-eat, small-debt | **WON** |
| 拼接 `pin15_32+pipe53` | **Y** | **Y** | solver, free-first, max-eat, small-debt | **WON** |
| F2 | **Y** | **Y** | solver, small-debt | **N@46（85%）**；2 复活仍 N@48（95%） |

- v7 和拼接：**四种策略全部 0 复活通关**，是“选错也能救”的强候选。
- F2：policy0=Y 只靠 solver / small-debt；free-first 和 max-eat 在第 46 步死，用满 2 次复活也只到 95%。**F2 对“先拿免费车”的玩家是脆的**——这正是 v3-14 的 `preferSmallDebt` 场景。

## 2. G2 2–13

| 关 | 流失② | policy0 | policy2 | 0 复活胜出策略 | free-first 0 |
|---:|---:|---|---|---|---|
| 2 | 45.77% | Y | Y | solver | **N** |
| 3 | 30.64% | Y | Y | free-first, max-eat | Y |
| 4 | 14.17% | Y | Y | 全部 4 条 | Y |
| 5 | 36.89% | Y | Y | 全部 4 条 | **Y** |
| 6 | 9.23% | Y | Y | solver, free-first, max-eat | Y |
| 7 | 20.34% | Y | Y | free-first, max-eat | Y |
| 8 | 10.64% | Y | Y | 全部 4 条 | Y |
| 9 | 7.14% | Y | Y | 全部 4 条 | Y |
| 10 | 15.38% | Y | Y | solver, free-first, max-eat | Y |
| 11 | 9.09% | Y | Y | free-first, max-eat, small-debt | Y |
| 12 | 20.00% | Y | Y | solver, free-first, small-debt | Y |
| 13 | 4.17% | Y | Y | 全部 4 条 | Y |

**12/12 都是 policy0=Y、policy2=Y。**

## 3. 结论

1. **`policy0=Y` 在点击结算下不是区分高/低流失的门**：G2 2–13 全部通过。它只能证明“存在一条零复活路线”，不能证明玩家会走。
2. **策略广度有信号但不充分**：
   - L2（流失最高 45.8%）只有 solver 能过，free-first 0 复活失败——这是最像“选错没得救”的关；
   - L5（36.9%）四条策略全过，仍然高流失——说明还有别的原因（开局窄 3、容错 5/20，可能是前 1 分钟体验）；
   - 低流失 L6/10/11 只有 3 条策略过，也比 L5 稳。
3. **`free-first` 0 复活**是一个有用的“合理玩家”信号：L2 失败；但它不是充分条件（L5 通过）。
4. **候选排序**：v7/拼接 > F2。F2 的 policy0=Y 依赖 small-debt/solver，对 free-first 玩家是脆的；如果要低流失，优先 v7/拼接。
5. 下一步不是继续加策略，而是看**前 5–10 步**：对 `free-first` 路线跑 `OpeningCheck`（M/C/F/D、C0/F0），比较 L2/L5 和低流失关的差异。策略族只能告诉我们“最后能不能过”，不能告诉我们“第一分钟为什么走”。

## 4. 复现

```bash
node 03_工具/正式版/ClickSettlePolicyCheck_v1.js <关卡.json | 目录> [--out report.json] [--beam N]
```

G2 2–13 结果：`研究_总关卡分组2_2-13/click_policy_20261110.json`（只放 2–13 十二个文件）。
