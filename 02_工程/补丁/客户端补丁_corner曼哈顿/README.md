# 客户端补丁：corner 包对齐需求文档（只改排序键）

> 对象：`~/Desktop/游戏版本/ParkPassenger_corner/ParkPassenger.app/Contents/MacOS/ParkPassenger`
> 目标文档：`01_项目文档/需求_消除逻辑_小车选像素小人_corner.md`
> 执行日期：2026-11-03　｜　改前 sha256 `8af9a0e1…a4ad0` → 改后 `4c844ac5…44054`（**只含排序键**；逐格重算那版崩了，见 §9）

## 1. 结论先说

corner 包原来（2026-10-30）的取用顺序不是曼哈顿，是**欧氏距离**：分数 `(r·A)² + (c·A)²`。
本补丁实际只保留**一处**（逐格重算那版已因闪退回退，见 §9）：

1. **排序键** → `r + c`（内部坐标，行 0 = 底行），平手规则（行升序 = 屏幕下方优先、列升序 = 左侧优先）
   原比较器自带、不动。改后与文档 10×10 验收用例**逐格一致（0/100 不符）**。
2. ~~**逐格重算**~~ → 试过，闪退，已回退（见 §9）。现在仍是"一次把一批挑完"。

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

## 3. 改法（两处 + 代码洞）

函数体（`0x1003f19c0`–`0x1003f1aa9`）整体换成：

```
8d 04 16     lea  eax, [rsi + rdx]     ; r + c
48 63 c0     movsxd rax, eax
c3           ret
（其余 0x90 nop）
```

同时**重换 `LC_UUID`**：Rosetta 按 UUID 复用翻译缓存，不换可能还跑旧代码。
（上一版 corner 包没换 UUID，与原始包 UUID 完全相同。）

**② 逐格重算**：把 `tryReceiveTargetElements` 里调用 `_findMatchedBlocks` 那一行
（`0x1003eeed3` 的 `lea -0xb8(%rbp),%rdi`）换成跳板，跳到 `__TEXT` 里一段全零区
（`0x100e8ef15`，前面是上一版留下的死桩）：

```
loop:  if (taken >= limit) goto done;
       findMatchedBlocks(out, this, X, Y, color, /*limit=*/1, bool);
       if (out.end == 上次的 out.end) goto done;   // 没挑到新的
       setElementState(*(out.end-16), 2);          // 选中即视为已消 → 下一轮可达图会把它当通路
       taken++; goto loop;
done:  jmp 回原流程
```

因为 `_isOpenPathCell` 把 `state==2` 当作"可通行"，所以标记之后下一轮 `_buildExitPathMap`
就会把它的邻居解锁 —— 这正是文档 §一.2 那句"被解锁的格子会立即参与下一次比较"。
每轮只挑 1 个，所以 `min(limit, 可达数)` 与"逐格重算"完全一致。

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

二进制层面：与改前 corner 包的差异是 **7 段共 387 字节** —— `LC_UUID`(16B) + 跳板(5B) +
打分函数(234B) + 代码洞里的循环(约 132B)；长度不变、无新增段。启动冒烟正常（46% CPU / 658MB RSS）。

## 6. 试过、被用户否决的改动（别再试）

**2026-11-03 13:38 试过：把候选集合钉成"全图同色格"**（`tryReceiveTargetElements` 里
传给 `_findMatchedBlocks` 的 `bool` → 1，10 字节等长替换），理由是"验收表里 `-` 只剩容量一种解释"。

用户当场否决：「怎么小人的逻辑忽略了阻挡关系」。**已全部回退**。

教训：验收表里的 `-` 只说明"容量不够"，不代表"没有阻挡"——
那张 10×10 图上，内部格（r8c1 等）正好在前一个格子被取走后露出来，所以**带阻挡的规则同样能复现全表**。

## 7. 逐格重算的验证边界

这条**没有单元测试**：它依赖游戏对象（`TargetBlockElement` 的虚表、棋盘向量），
脱离游戏跑不起来。目前只做了：
- 反汇编逐条核对跳板/循环/返回地址（见 §3 的伪代码）；
- 与原包的差异段、长度校验；
- 启动冒烟（进程正常起来、不掉）。

**真机验证只能靠玩**：选一个颜色，车一次能吃 N 个时，看"刚被吃掉的那个所挡住的同色邻居"
会不会在同一批里跟着走。会 → 对；不会 → 退回 §8 的第三行。

## 8. 回退

```bash
# 回到「曼哈顿 + 保留旧的一批取完」（上一版，无逐格重算）
cp -p ~/Desktop/游戏版本/ParkPassenger_corner.bak_20261103b/ParkPassenger.app/Contents/MacOS/ParkPassenger \
      ~/Desktop/游戏版本/ParkPassenger_corner/ParkPassenger.app/Contents/MacOS/ParkPassenger

# 回到 2026-10-30 的欧氏版（什么都没改）
cp -p ~/Desktop/游戏版本/ParkPassenger_corner.bak_20261103/ParkPassenger.app/Contents/MacOS/ParkPassenger \
      ~/Desktop/游戏版本/ParkPassenger_corner/ParkPassenger.app/Contents/MacOS/ParkPassenger

# 回到最原始的游戏包（没有 corner 补丁）
cp -p ~/Desktop/游戏版本/ParkPassenger_corner.bak_20261030/ParkPassenger.app/Contents/MacOS/ParkPassenger \
      ~/Desktop/游戏版本/ParkPassenger_corner/ParkPassenger.app/Contents/MacOS/ParkPassenger
```

（`…bak_20261103b` = 「曼哈顿 + 旧的一批取完」版，`4c844ac5…`；现役是 `ae799229…`。
那次被否决的"全图候选"实验版只在 `/tmp`，没有留档、也不该再装。）

## 9. 试过、闪退的改动：逐格重算（2026-11-03 14:05）

**目标**：同一批里"先选中的人把被它挡住的同色邻居解锁"，即文档 §一.2。

**做法**：在 `tryReceiveTargetElements` 调用 `_findMatchedBlocks` 处挂钩，跳到代码洞里的循环：
每次只挑 1 个 → 立刻 `setElementState(ptr, 2)` → 再挑，最多 limit 个。

**结果**：进关卡、车开始接人时 **SIGSEGV 闪退**（两份 .ips：14:05:05 / 14:05:15）。
崩溃报告给出的关键信息：

```
EXC_BAD_ACCESS (SIGSEGV), KERN_INVALID_ADDRESS at 0x41a0000000000028
thread 0 栈（由内到外）：
  0  0x10ec75c68（无符号）
  1  ParkPassenger  +0xe8ef8d      ← 我们循环里的 inc %r12d（setElementState 的返回点）
  2  ParkPassengerBoard::tryReceiveTargetElements
  3  ...
  4  HoldingAreaBoard::onTargetElementReady()
  5  ParkPassengerBoard::onTargetElementsMoveEnd()
  6  TargetBoard::tryReceiveTargetElements::$_1::operator()(int)   ← 动画结束回调
寄存器：rax = 0x41a0000000000028，r13 = 0x28（= limit 40），rsi = 2
```

即：**上一辆车的动画结束回调里又调起了下一辆车的取人**（正常流程），在这次重入里我们标记
"已消"之后，取到的对象指针是坏的，`setElementState` 一解引用就崩。

**判断**：问题不在排序，在"提前把对象置成已消"这个手法——它和动画回调的重入撞上了。
要么改成不碰对象状态的做法（例如给 `_findMatchedBlocks` 传一份"本批已选"的掩码，
让它把已选的同色格当作可通行），要么在重入处加保护。前者要改函数签名/内部逻辑，后者要加锁。

**现状**：已回退到 `4c844ac5…`（曼哈顿 + 阻挡 + 一批取完），可正常游玩。
`make_corner_manhattan.py` 里的这段补丁**暂时用 `--per-pick` 开关关掉了**，别误开。
