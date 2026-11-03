# 客户端补丁：corner 包对齐需求文档

> 对象：`~/Desktop/游戏版本/ParkPassenger_corner/ParkPassenger.app/Contents/MacOS/ParkPassenger`
> 目标文档：`01_项目文档/需求_消除逻辑_小车选像素小人_corner.md`
> 执行日期：2026-11-03　｜　改前 sha256 `8af9a0e1…a4ad0` → 改后 `a59b4c46…e329`

## 1. 结论先说

按文档的验收标准，模型只有三层：**候选 = 该颜色全部剩余像素；次序 = D 升序 + 平手行降序/列升序；
取前 N 个（容量截断）**。`-` 的唯一解释是容量，没有"够不着"这种状态。

corner 包原来（2026-10-30）有两处不符：

| # | 原来 | 文档要求 |
|---|---|---|
| ① 次序 | 把参数 X 归零后，公式退化成 `A²(r²+c²)` = **欧氏距离** | 曼哈顿 `D = r_int + c` |
| ② 候选 | 传 `bool=0` 的那条分支只收"能通到边缘"的格子 | 全图同色格 |

本补丁两处都改，改后与文档 10×10 验收用例**逐格一致（0/100 不符）**。

## 2. 为什么是 `r + c`

- 目标图 JSON 的 `blocks` 是**从上到下**，客户端解析时反向存（`TargetBoard::_parseBoardConfig`
  里 `rows - 1 - i_json`）→ **内部行 0 = 底行**。
- 屏幕行 `r_disp` 与内部行 `r_int`：`r_int = R-1-r_disp`。
- 文档 `D = |r_disp-(R-1)| + c`，代入即 `D = r_int + c`。所以内部算 `r+c` 就是文档的 D。

排序链路（全二进制只有这一条）：

```
std::partial_sort(..., lambda$_0 / lambda$_1)
  → TargetBoard::_isCandidateHigherPriority(a, b, X, Y)      // 0x1003f1af0
      → TargetBoard::_getCandidateScore(r, c, X, Y)          // 0x1003f19c0  ← 补丁 ①
      → 分数相同 → pair(r,c)：行升序 → 列升序
```

`_getCandidateScore` 只有这 2 个调用点（都在上面的比较器里），没有别的用法。

## 3. 改法（两处，共 244 字节）

**① 排序键**：函数体 234 字节（`0x1003f19c0`–`0x1003f1aa9`）整体换成：

```
8d 04 16     lea  eax, [rsi + rdx]     ; r + c
48 63 c0     movsxd rax, eax
c3           ret
（其余 0x90 nop）
```

**② 候选集合**：`TargetBoard::tryReceiveTargetElements`（`0x1003eeec4`）里传给
`_findMatchedBlocks` 的 `bool` 钉成 1：

```
0f b6 bd 67 ff ff ff 83 e7 01   movzbl -0x99(%rbp),%edi ; and $1,%edi
        ↓
bf 01 00 00 00 90 90 90 90 90   mov $1,%edi ; 5×nop（等长，10 字节）
```

于是无论上层传什么，都走"全图同色格"那条分支。

**③ 重换 `LC_UUID`**：Rosetta 按 UUID 复用翻译缓存，不换可能还跑旧代码。
（上一版 corner 包没换 UUID，与原始包 UUID 完全相同。）

改前那两处「把 X 强制成 0」（`0x1003f1b20` / `0x1003f1b41`）**保留不动**：
X 现在被完全忽略，留着不影响结果。

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

脚本幂等：两处都已是补丁版时直接返回 0，不重复改；长度变了拒绝写出；
函数区间末尾不是 `c3`（原函数 ret）时拒绝执行，防止版本漂移改错地方。

## 5. 验证记录（改前 / 改后）

`verify_corner_manhattan.py` 直接解析文档里的 10×10 图与两张序号表：

| 口径 | 容量 15 | 容量 25 |
|---|---:|---:|
| 改前（欧氏 r²+c²） | **4 / 100 格不符** | **4 / 100 格不符** |
| 改后（曼哈顿 r+c） | **0 / 100 格** | **0 / 100 格** |

改前错在 D=2 / D=3 两组互换（`r9c2↔r8c1`、`r7c2↔r6c0`）。
另一条独立佐证：文档两张表的切点正好是 D 阈值 —— 容量 15 ↔ `D≤8` 恰好 15 个，
容量 25 ↔ `D≤15` 恰好 25 个，`-` 的格子 D 全部在阈值之后。

`selftest_score.c` 把补丁后的 7 字节 mmap 成可执行页、用 121 组 `(r,c)` × 2 种 `(X,Y)` 真跑：
**242 次调用 0 次不符**（X/Y 故意传互相矛盾的垃圾值，验证起点确实不随槽位变化）。

二进制层面：与改前 corner 包的差异只有 **3 段共 260 字节** ——
`LC_UUID`(16B) + `bool` 钉死(10B) + 打分函数(234B)；长度不变、无新增段。
两次启动冒烟均正常（进程起来、40%+ CPU、无闪退）。

## 6. 没动、也没法用验收用例验的部分

- **同色多车争用**（剩余容量小者优先、暂存序号小者优先）：在车的调度层，不在这个函数里。
  文档 §一.3 那条本次**未验证**。
- **动画段**：候选一次算完再一起播（`startMoveBlocksToDestWorldPos`），这是表现层，不影响次序。
  改完"埋在里面的小人"也会被选中，出场路径由视图自己找 —— 观感要真机看一眼。

## 7. 回退

```bash
# 回退到「曼哈顿 + 只取露出来的」那一版（本次改动前）
cp -p ~/Desktop/游戏版本/ParkPassenger_corner.bak_20261103b/ParkPassenger.app/Contents/MacOS/ParkPassenger \
      ~/Desktop/游戏版本/ParkPassenger_corner/ParkPassenger.app/Contents/MacOS/ParkPassenger

# 回退到 2026-10-30 的欧氏版（什么都没改）
cp -p ~/Desktop/游戏版本/ParkPassenger_corner.bak_20261103/ParkPassenger.app/Contents/MacOS/ParkPassenger \
      ~/Desktop/游戏版本/ParkPassenger_corner/ParkPassenger.app/Contents/MacOS/ParkPassenger

# 回退到最原始的游戏包（没有 corner 补丁）
cp -p ~/Desktop/游戏版本/ParkPassenger_corner.bak_20261030/ParkPassenger.app/Contents/MacOS/ParkPassenger \
      ~/Desktop/游戏版本/ParkPassenger_corner/ParkPassenger.app/Contents/MacOS/ParkPassenger
```
