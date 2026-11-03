# 客户端补丁：corner 包对齐需求文档（只改排序键）

> 对象：`~/Desktop/游戏版本/ParkPassenger_corner/ParkPassenger.app/Contents/MacOS/ParkPassenger`
> 目标文档：`01_项目文档/需求_消除逻辑_小车选像素小人_corner.md`
> 执行日期：2026-11-03　｜　改前 sha256 `8af9a0e1…a4ad0` → 改后 `4c844ac5…44054`

## 1. 结论先说

corner 包原来（2026-10-30）的取用顺序不是曼哈顿，是**欧氏距离**：分数 `(r·A)² + (c·A)²`。
本补丁只改打分函数 → `r + c`（内部坐标，行 0 = 底行），平手规则（行升序 = 屏幕下方优先、
列升序 = 左侧优先）原比较器自带、不动。改后与文档 10×10 验收用例**逐格一致（0/100 不符）**。

**候选集合（阻挡关系）一个字没动**：`_findMatchedBlocks` 仍然只把"能通到边缘"的同色格
算作候选（`_canBlockReachExit`），被挡住的小人不会被取。

## 2. 为什么是 `r + c`

- 目标图 JSON 的 `blocks` 是**从上到下**，客户端解析时反向存（`TargetBoard::_parseBoardConfig`
  里 `rows - 1 - i_json`）→ **内部行 0 = 底行**。
- 屏幕行 `r_disp` 与内部行 `r_int`：`r_int = R-1-r_disp`。
- 文档 `D = |r_disp-(R-1)| + c`，代入即 `D = r_int + c`。

排序链路（全二进制只有这一条）：

```
std::partial_sort(..., lambda$_0 / lambda$_1)
  → TargetBoard::_isCandidateHigherPriority(a, b, X, Y)      // 0x1003f1af0
      → TargetBoard::_getCandidateScore(r, c, X, Y)          // 0x1003f19c0  ← 本补丁改这里
      → 分数相同 → pair(r,c)：行升序 → 列升序
```

`_getCandidateScore` 只有这 2 个调用点（都在上面的比较器里），没有别的用法。

## 3. 改法（一处，234 字节）

函数体（`0x1003f19c0`–`0x1003f1aa9`）整体换成：

```
8d 04 16     lea  eax, [rsi + rdx]     ; r + c
48 63 c0     movsxd rax, eax
c3           ret
（其余 0x90 nop）
```

同时**重换 `LC_UUID`**：Rosetta 按 UUID 复用翻译缓存，不换可能还跑旧代码。
（上一版 corner 包没换 UUID，与原始包 UUID 完全相同。）

改前那两处「把 X 强制成 0」（`0x1003f1b20` / `0x1003f1b41`）**保留不动**：X 已被完全忽略。

## 4. 用法

```bash
# 生成（不改原文件）
python3 make_corner_manhattan.py \
  ~/Desktop/游戏版本/ParkPassenger_corner/ParkPassenger.app/Contents/MacOS/ParkPassenger \
  -o /tmp/ParkPassenger_corner_manhattan

# 验证（解析需求文档里的验收用例 + 实跑补丁字节）
clang -arch x86_64 -O0 -o /tmp/selftest_score selftest_score.c
python3 verify_corner_manhattan.py /tmp/ParkPassenger_corner_manhattan

# 安装（先备份！）
cp /tmp/ParkPassenger_corner_manhattan \
  ~/Desktop/游戏版本/ParkPassenger_corner/ParkPassenger.app/Contents/MacOS/ParkPassenger
```

脚本幂等：已是补丁版时直接返回 0；长度变了拒绝写出；函数区间末尾不是 `c3`（原函数 ret）时
拒绝执行，防止版本漂移改错地方。对原始 corner 包跑一遍，输出应与现役二进制**逐字节一致**
（sha256 `4c844ac5…`）。

## 5. 验证记录

`verify_corner_manhattan.py` 直接解析文档里的 10×10 图与两张序号表：

| 口径 | 容量 15 | 容量 25 |
|---|---:|---:|
| 改前（欧氏 r²+c²） | **4 / 100 格不符** | **4 / 100 格不符** |
| 改后（曼哈顿 r+c） | **0 / 100 格** | **0 / 100 格** |

改前错在 D=2 / D=3 两组互换（`r9c2↔r8c1`、`r7c2↔r6c0`）。

`selftest_score.c` 把补丁后的 7 字节 mmap 成可执行页、用 121 组 `(r,c)` × 2 种 `(X,Y)` 真跑：
**242 次调用 0 次不符**（X/Y 故意传互相矛盾的垃圾值，验证起点确实不随槽位变化）。

二进制层面：与改前 corner 包的差异只有 **2 段共 250 字节** —— `LC_UUID`(16B) + 打分函数(234B)；
长度不变、无新增段。启动冒烟正常。

## 6. 试过、被用户否决的改动（别再试）

**2026-11-03 13:38 试过：把候选集合钉成"全图同色格"**（`tryReceiveTargetElements` 里
传给 `_findMatchedBlocks` 的 `bool` → 1，10 字节等长替换），理由是"验收表里 `-` 只剩容量一种解释"。

用户当场否决：「怎么小人的逻辑忽略了阻挡关系」。**已全部回退**。

教训：验收表里的 `-` 只说明"容量不够"，不代表"没有阻挡"——
那张 10×10 图上，内部格（r8c1 等）正好在前一个格子被取走后露出来，所以**带阻挡的规则同样能复现全表**。

## 7. 还差的一条（未做，需要真机确认）

文档 §一.2 要求"每确定一个，立刻视为已消除、重算可选集合，被解锁的格子马上参与下一次比较"。
客户端是"一次算出 N 个候选再一起播动画"：可达图在 `_findMatchedBlocks` 里只建一次。
若一辆车一次取多个，则"被自己的第一个小人让出来的格子"要等下一辆车。
这条要不要改、怎么改，取决于真机上一辆车到底是一次取一批还是一个一个取 —— **待确认**。

## 8. 回退

```bash
# 回到 2026-10-30 的欧氏版（什么都没改）
cp -p ~/Desktop/游戏版本/ParkPassenger_corner.bak_20261103/ParkPassenger.app/Contents/MacOS/ParkPassenger \
      ~/Desktop/游戏版本/ParkPassenger_corner/ParkPassenger.app/Contents/MacOS/ParkPassenger

# 回到最原始的游戏包（没有 corner 补丁）
cp -p ~/Desktop/游戏版本/ParkPassenger_corner.bak_20261030/ParkPassenger.app/Contents/MacOS/ParkPassenger \
      ~/Desktop/游戏版本/ParkPassenger_corner/ParkPassenger.app/Contents/MacOS/ParkPassenger
```

（`…bak_20261103b` = 现在这一版「曼哈顿 + 保留阻挡」的完整副本，与现役二进制逐字节相同，
`4c844ac5…`；那次被否决的"全图候选"实验版只留在 `/tmp`，没有再装回去。）
