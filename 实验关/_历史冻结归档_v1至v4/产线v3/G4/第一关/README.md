# G4 第一关：底边重排（2026-11-10）

> 源图：`/Users/red/Desktop/正常关卡/G8_bq_level_12.json`（35×35）。
> 规则：`bottomOnly`，上/左/右为墙，只有底边出口；棋盘 7×7。
> 生成：`G4Build_v1`，按底边消除轮次切车，再把同色大车合并、拆 19 色成链。

## 1. 生成命令

```bash
node 03_工具/正式版/G4Build_v1.js /Users/red/Desktop/正常关卡/G8_bq_level_12.json \
  --out 实验关/产线v3/G4/第一关/G4_第一关_底边重排.json \
  --rows 7 --cols 7 --box-min 20 --box-max 120 --lump \
  --split-colors 19 --split-max 80 --auto-chain 8
```

- 车 18 辆，自动成链 3 组；
- 底边轮次段 21 段，覆盖 1225/1225 像素。

## 2. 指标（`--bottom-only`）

| 项 | 值 | 判定 |
|---|---|---|
| 峰值 | 4 | ✅ |
| 玩家中段 | 40% | ❌ 差 45 下限 5 点（试行下限 40 可接受） |
| 容错 | 11/20 | ✅ |
| 开局可点 | 7 | ✅ |
| C0@buf<5 | 0 | ✅ |
| F0@buf≥3 | 0 | ✅ |
| 点击 forced / policy0 | Y / Y | ✅ |
| free-first 0 复活 | Y | ✅ |
| 排版 | hard0 | ✅ |
| 玩家后20% at3 | 0 | ❌ |
| at4 | 3 | ❌ 差 5 |
| 象限并行 | 3.87 | ❌ |
| 主体并行 | 80% | ❌ |
| 未动主体 | 0 | ❌ |

**19 项：不通过。** 但低流失关键项（peak4、tol11、open7、C0/F0=0、点击 policy0/ff）都过了；差的是中段 40 和“目标感/后段”软项。

PlayerSim：

- `solver=Y`、`forced=N`、`policy0=N`、`policy2=Y`。
- 真实玩家 0 复活仍不成立；点击结算口径比 PlayerSim 乐观，这是已知模型差异。

## 3. 结论

这是第一张“按底边重排”的可用骨架，不是成品：

- 底边轮次切车 + 同色大车 + 少量链，能把 peak 做到 4、tol11、open7；
- 中段 40 还差 5 点，后 20% 没有 at3，目标感项也弱；
- PlayerSim 0 复活仍 N，说明债的时序还不对，不能只看点击结算。

下一步优先补：中段/后段各加一组可恢复的债（不是简单加冰），再跑 `--bottom-only` + PlayerSim。

## 4. 文件

- 关卡：`G4/第一关/G4_第一关_底边重排.json`
- 完整检查：`G4/build_split/checks.json`
- 生成器：`03_工具/正式版/G4Build_v1.js`
