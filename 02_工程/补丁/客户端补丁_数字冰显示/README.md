# 客户端补丁（数字冰显示 / 铁链车容量）—— 生成脚本留档

这三个脚本打的是**实机游戏的可执行文件**（`ParkPassenger.app` / `ParkPassenger_patched.app` 的 `Contents/MacOS/ParkPassenger`），
**不是** `02_工程/补丁/` 里那些给求解器（bin/）用的 diff。两者别搞混：

- 求解器侧改动 → `补丁_*.patch`（`patch -p1` 打到 `完整主bin快照_20261012/`）
- 客户端侧改动 → 本目录的脚本（直接改 124MB 可执行文件里的几十~两百字节）

## 怎么用

脚本以**官方原始二进制**为输入、输出一版新二进制（不改原文件）：

```bash
python3 make_v13_解锁后显示容量.py       # 读 /private/tmp/ParkPassenger.v10 → 写 /private/tmp/ParkPassenger.v13
```

> ⚠ 脚本里的 `SRC` 写的是 `/private/tmp/ParkPassenger.v10`（= 当时的"当前版本"）。重跑前先把它改成你要基于的那一版
> （原始二进制在 `ParkPassenger_bin备份_20261013/ParkPassenger_原始二进制_20261013`，v10~v12 的副本也在同一个备份目录）。

装进 app：把生成的二进制覆盖到 `…/Contents/MacOS/ParkPassenger`（覆盖前先备份），**然后必须重启游戏**才生效
（这包带 quarantine，macOS 会做 App Translocation）。

## 三版各改了什么（详细经过见 `01_交接文档/工作日志_20261012.md` 第十六节）

| 脚本 | 版本 | 改了什么 |
| --- | --- | --- |
| `make_v11_数字冰显示.py` | v11 | ①数字冰一开始就显示"还剩几个球"：在 `ElementCellView::_refreshCapacity` 开头加短路（`cell+0x20` 最高位=数字冰标记）跳过"允许显示/激活/已显示过"三道闸门；②有链条(`cell+0x2c`)/锁定元素(`cell+0x24`)的车也走同一条短路 |
| `make_v12_铁链车容量.py` | v12 | 铁链的图画（图集「特殊元素_圆点」54×54）正好盖住车体上放容量的位置 → 对这些车用游戏自己的 `_attachNodeToEffectRoot()` 把容量角标**重挂到 effectRoot、z=7**（铁链是 6），位置由该函数自带坐标换算保持不变 |
| `make_v13_解锁后显示容量.py` | v13 | 数字冰**解锁那一刻**要把数字换成该车容量：解冻桩在倒计时归零那一步把 `cell+0x1c` 置 1（1 字节标记），显示链路看到标记强制重画一次（画 `cell+0x10` 容量），下一步解冻桩自然清 0、不会反复重画 |

## 每次都必须做的事（脚本里已包含，改动时别漏）

1. **换 `LC_UUID`**（脚本自动）：Rosetta 会复用旧翻译缓存，不换 UUID 等于补丁没打。
2. **只改 `__TEXT` 内部字节**：不新增段、不移动段、文件长度不变（脚本会断言长度一致）。
3. **桩代码只放在函数的填充空隙里**（脚本里的 `HEAD/DISP/REP/S3/S5/跳板` 地址都是空隙；改逻辑时先确认那片空隙仍是全零）。
4. 生成后**用 objdump 逐条核对**新逻辑（尤其短跳的地址基准——v13 就踩过一次，落进跳板中间会闪退）。

## 回退

`ParkPassenger_bin备份_20261013/` 里有 `…_可执行_v10/v11/v12_备份_20261014` 与 `ParkPassenger_原始二进制_20261013`，
拷回 `Contents/MacOS/ParkPassenger` 即可（两个 app 各有一份同名备份）。
