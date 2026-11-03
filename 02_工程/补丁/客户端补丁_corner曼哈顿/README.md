# 客户端补丁：corner 包改成「曼哈顿」口径

> 对象：`~/Desktop/游戏版本/ParkPassenger_corner/ParkPassenger.app/Contents/MacOS/ParkPassenger`
> 目标文档：`01_项目文档/需求_消除逻辑_小车选像素小人_corner.md`
> 执行日期：2026-11-03　｜　改前 sha256 `8af9a0e1…a4ad0` → 改后 `4c844ac5…44054`

## 1. 结论先说

corner 包原来那版（2026-10-30）不是曼哈顿，是**欧氏距离**：分数 `(r·A)² + (c·A)²`。
本补丁把打分函数改成 `r + c`（内部坐标，行 0 = 底行），平手规则（行升序 = 屏幕下方优先、
列升序 = 左侧优先）原比较器自带、不动。改后与文档的 10×10 验收用例**逐格一致（0/100 不符）**。

## 2. 为什么是 `r + c`

- 目标图 JSON 的 `blocks` 是**从上到下**，客户端解析时反向存（`TargetBoard::_parseBoardConfig`
  里 `rows - 1 - i_json`）→ **内部行 0 = 底行**。
- 屏幕行 `r_disp` 与内部行 `r_int`：`r_int = R-1-r_disp`。
- 文档 `D = |r_disp-(R-1)| + c`，代入即 `D = r_int + c`。所以内部算 `r+c` 就是文档的 D。

排序链路（全二进制只有这一条）：

```
std::partial_sort(..., lambda$_0 / lambda$_1)
  → TargetBoard::_isCandidateHigherPriority(a, b, X, Y)      // 0x1003f1af0
      → TargetBoard::_getCandidateScore(r, c, X, Y)          // 0x1003f19c0  ← 本补丁改这里
      → 分数相同 → pair(r,c)：行升序 → 列升序
```

`_getCandidateScore` 只有这 2 个调用点（都在上面的比较器里），没有别的用法。

## 3. 改法

函数体 234 字节（`0x1003f19c0`–`0x1003f1aa9`）整体换成：

```
8d 04 16     lea  eax, [rsi + rdx]     ; r + c
48 63 c0     movsxd rax, eax
c3           ret
（其余 0x90 nop）
```

同时**重换 `LC_UUID`**：Rosetta 按 UUID 复用翻译缓存，不换可能还跑旧代码。
（上一版 corner 包没换 UUID，与原始包 UUID 完全相同。）

改前那两处「把 X 强制成 0」（`0x1003f1b20` / `0x1003f1b41`，`mov ecx,[rbp-0x24]` → `xor ecx,ecx;nop`）
**保留不动**：X 现在被完全忽略，留着不影响结果。

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

脚本幂等：输入已是补丁版时直接返回 0，不重复改。
函数区间末尾字节不是 `c3`（原函数 ret）时**拒绝执行**，防止版本漂移改错地方。

## 5. 验证记录（改前 / 改后）

`verify_corner_manhattan.py` 直接解析文档里的 10×10 图与两张序号表：

| 口径 | 容量 15 | 容量 25 |
|---|---:|---:|
| 改前（欧氏 r²+c²） | **4 / 100 格不符** | **4 / 100 格不符** |
| 改后（曼哈顿 r+c） | **0 / 100 格** | **0 / 100 格** |

改前错在 D=2 / D=3 两组互换（`r9c2↔r8c1`、`r7c2↔r6c0`）。

`selftest_score.c` 把补丁后的 7 字节 mmap 成可执行页、用 121 组 `(r,c)` × 2 种 `(X,Y)` 真跑：
**242 次调用 0 次不符**（X/Y 故意传互相矛盾的垃圾值，验证起点确实不随槽位变化）。

二进制层面：与原包的差异只有 **2 段共 250 字节** —— `LC_UUID`(16B) + 打分函数(234B)；
长度不变、无新增段。改后启动冒烟：进程正常起来（48% CPU / 314MB RSS，无闪退）。

## 6. 没动、也不该动的东西

- **可达过滤**（`_canBlockReachExit`）：`_findMatchedBlocks` 有两条分支（由上层传入的 `bool` 决定）：
  一条收集全图同色格，另一条只收"能通到边缘"的格子。**正常对局走哪条未确认**——
  IL2CPP 经 `MethodInfo` 间接调用，静态没追到唯一调用点。本补丁对两条分支的排序键都生效。
- **同色多车争用**（剩余容量小者优先、暂存序号小者优先）：在车的调度层，不在这个函数里。
  文档 §一.3 那条本次**未验证**。
- **一批之内逐格重算**：客户端是"一次算出 N 个候选再一起播动画"，
  与文档"每确定一个就重算可选集合"在**可达性变化**时仍有差别（排序键本身不受影响）。

## 7. 回退

```bash
cp -p ~/Desktop/游戏版本/ParkPassenger_corner.bak_20261103/ParkPassenger.app/Contents/MacOS/ParkPassenger \
      ~/Desktop/游戏版本/ParkPassenger_corner/ParkPassenger.app/Contents/MacOS/ParkPassenger
```

`…bak_20261103` = 本次动手前的完整副本（`8af9a0e1…`，即 2026-10-30 的欧氏版）。
更早的原始包在 `…ParkPassenger_corner.bak_20261030`（`34f8a7db…`，未打任何 corner 补丁）。
