# 派工#003 · 任务 B：G4 10 关上线重排（含 6×6 速通 L1）

> 执行模型：`DeepSeek-V4.1-Flash（deepseek-v4.1-flash，DeepSeek Harness）`
> 施工窗口：2026-11-24 14:43 – 14:52（本机 CST）
> 只做任务 B；任务 A/C 未施工。所有改动已换装客户端，原件先备份。

## 1. 备份（B1）

- 目录：`实验关/产线v7/材料/客户端备份_20261124_G4_上线重排前/`
- 10 个原件 + `md5.txt`；原 L1..L10 md5：
  `ef0b3b63 / b8fb3997 / 67d053db / a154a506 / 328969fb / f0d1a58c / b6f069b0 / 3eb39a79 / 68026c49 / 4d5aa99f`

## 2. B2 补测与重排

测量命令（每关，备份原件）：
```bash
node 实验关/产线v5/C9_插值玩家/PInterpPlayer.js <关.json> \
  --bottom-only --instant-chain --human-casual \
  --p 0,0.1,0.2,0.5,0.8,0.9,1 --games 40 --seeds 977 --out <out>
```
`humCasual=(p0+p.1+p.2)/3`、`humMid=p0.5`、`humFair=(p.8+p.9+p1)/3`。

原始 9 关（详见 `B2_metrics/B2_summary.json`）：

| 原关 | humCasual | humMid | humFair | humWave[2] | randCasual |
|---|---|---|---|---|---|
| L2 | .650 | .775 | .983 | 2.53 | .600 |
| L3 | .683 | .950 | 1.000 | 1.53 | .475 |
| L4 | .525 | .750 | .958 | 1.18 | .508 |
| L5 | .333 | .775 | .992 | 1.02 | .575 |
| L6 | .583 | .875 | .992 | 1.73 | .392 |
| L7 | .708 | .775 | .950 | 1.73 | .558 |
| L8 | .592 | .950 | 1.000 | 1.25 | .467 |
| L9 | .425 | .925 | .975 | 1.27 | .475 |
| L10 | .300 | .700 | .942 | 1.08 | .558 |

重排后两处 >15pp 的「后关更容易」峰：
- 新 L3 `.775 →` 新 L4 `.950`（+17.5pp）
- 新 L7 `.750 →` 新 L8 `.925`（+17.5pp）

**处理**：严格保留总工表顺序，未对调；原因见任务单 §4.1。`humCasual` 整体 `.708→.300` 坡度正常。

## 3. 新 L1（6×6）

- 源图：`实验关/产线v7/材料/34_32并31/4.txt`（32 列 × 36 行、1152px、7 色、最小 52px、只有 31 无 32）。
- 下采样：`L1_src_24x24.txt`，24×24/576px、7 色、最小 24px、无 <8px、无 31+32。
- 切摆：`SplitLevel_v722 --target L1_src_24x24.txt --out L1_base.json --rows 6 --cols 6 --bottom-only --stagger-cap --no-first-test`
- 结果：6×6 / 36 车 / 576px，0 链 0 冰 0 管 0 黑 0 问号；逐色守恒 576/576。
- 验收：
  - `LayoutScore hard=0 warn=0 maxRun=3`，`<8px=0`；
  - `Solvable --width 8 --bottom-only --instant-chain`：`true / 36 步 / 576/576`；
  - `PInterpPlayer` 40 局 seed977：`randCasual=1.000`、`humCasual=1.000`、`humMid=1.000`、`humFair=1.000`、`randWave=[2.88,3.05,2.42]`、`humWave=[1.73,1.90,1.88]`；
  - `BaitLocator --early 0.1 --games 40`：`deathsTotal=0 / earlyDeaths=0 / earlyShare=0%`；
  - 格式：`toprow=24 / blocks=24×24 / maprow=mapcol=6 / spools=6×6`，脚本链路可直接解析。
- md5：`e093d157`。

## 4. 终稿与换装

- 终稿：`G4_上线重排终稿/G4_bq_level_1..10.json` + `md5.txt`。
- 客户端：`/Users/red/Desktop/分组4/ParkPassenger.app/Contents/Resources/bin/G4_bq_level_1..10.json` 已覆盖；10 个 md5 与终稿逐位一致。
- 终稿 L1..L10 md5（前 8）：
  `e093d157 / b6f069b0 / b8fb3997 / 67d053db / 3eb39a79 / f0d1a58c / a154a506 / 68026c49 / 328969fb / 4d5aa99f`

## 5. 遗留

1. B2 两处 `humMid` 峰未对调，待总工裁决；最小改动方案见任务单 §4.1。
2. 任务 A 未做，建造器尚不输出 `humMid`；B2 是用 `PInterpPlayer` 直接测的。
3. 任务 C 未做（无 `map_complexity.json`、无新版 C 档样板）。
4. 新 L1 的 `blocks` 是 24×24（像素图），`spools` 才是 6×6；客户端脚本链路已验证可解析，若 UI 有 `toprow=32` 硬编码需单独确认。
