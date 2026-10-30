# TargetStoryAtlas v0

> 当前进度：v8保留为首轮E1样板；v9数字冰为旁支；E2/E3/E4/E5已完成006；
> E6采用[20,40]，008、014与三图批量/停止/性能回归均已通过；
> v626生产UI已接入默认关闭的故事编译器注册表，006使用零冰开放开局v12。

## 用途

只读分析目标图 TXT，为「车接小人编辑器—正式版」生成：

- `target-atlas.json`：颜色、连通区域、区域相邻关系、参考消除序列、缺口和向内掏路径；
- `target-preview.png`：按工程 `ColorLibs` 自动识别色库后渲染的目标图；
- `capacity-board-feasibility.json`：容量区间、每色车数范围、棋盘候选和占位压力；
- `story-candidates.json`：目标序列上的债务、groupDebt 窗口和 reveal 候选；
- `story-preflight.md`：人类可读摘要。

它不会生成关卡、搜索随机 seed、修改生产生成器或客户端 `bin`。

## 命令

```bash
node 03_工具/正式版/TargetStoryAtlas_v632.js \
  --target 实验关/关卡6/35x35拼接图纸_006.txt \
  --out-dir 实验关/关卡6/分析_v632 \
  --caps auto,20-40,18-40,16-40 \
  --min-edge 6 \
  --max-edge 9 \
  --buffer 5 \
  --policy shortDebt
```

容量区间是用户输入。`auto` 只是现有预检建议，不是自动改写用户容量。

### 故事原子排名

```bash
node 03_工具/正式版/StoryAtomRanker_v635.js \
  --atlas 实验关/关卡6/分析_v632/target-atlas.json \
  --candidates 实验关/关卡6/分析_v632/story-candidates.json \
  --out-dir 实验关/关卡6/分析_v632 \
  --plan-label '20-40 / 7×7'
```

输出 `story-atom-ranking.json` 和 `story-atom-ranking.md`。排名只是候选自然度，
不是最终可玩性；`groupDebt` 默认是备选，不是必选机制。

### 构造一个可玩机械原型

```bash
node 03_工具/正式版/BuildPrototypeLevel_v636.js \
  --target 实验关/关卡6/35x35拼接图纸_006.txt \
  --out-dir 实验关/关卡6/原型_v1 \
  --cap-min 20 --cap-max 40 \
  --rows 7 --cols 7 --buffer 5 \
  --policy shortDebt
```

输出真实的 5 键客户端 JSON、路线数据、调试数据和报告。对应页面：

```text
http://127.0.0.1:8060/实验关/关卡6/原型_v1/play.html
```

当前页面是机械可玩原型。它不证明 StoryPlan v1 的 R2→R10、短债务或 reveal 已发生。

### 状态链回放

```bash
node 03_工具/正式版/StoryStateReplay_v637.js \
  --target 实验关/关卡6/35x35拼接图纸_006.txt \
  --atlas 实验关/关卡6/分析_v632/target-atlas.json \
  --out-dir 实验关/关卡6/分析_v632
```

输出 `story-state-replay-v1.json/md`，记录入口、R10、短债务和释放的真实目标状态变化。

### 构造受控故事棋盘 v2

```bash
node 03_工具/正式版/BuildStoryLevel_v2.js \
  --target 实验关/关卡6/35x35拼接图纸_006.txt \
  --out-dir 实验关/关卡6/原型_v2
```

输出 `关卡_实验_v2.json`、route、debug 和报告。对应页面：

```text
http://127.0.0.1:8060/实验关/关卡6/原型_v1/play.html?level=../原型_v2/关卡_实验_v2.json
```

该版把 `30/22 → 15/24 → 17/26欠10 → 31/30释放` 放在受控纵向入口链上。
它验证故事链可执行，但全知路线仍存在旁路。

收紧入口旁路的版本：

```bash
node 03_工具/正式版/BuildStoryLevel_v2.js \
  --target 实验关/关卡6/35x35拼接图纸_006.txt \
  --out-dir 实验关/关卡6/原型_v4 \
  --variant 4
```

v4 把两个黑块移到 B 车两侧，阻止 B 消除后从侧向打开其他分支。全知前四步已经严格走完整条故事链。

中段揭示证据：

```bash
node 03_工具/正式版/StoryRevealEvidence_v642.js \
  --level 实验关/关卡6/原型_v4/关卡_实验_v4.json \
  --atlas 实验关/关卡6/分析_v632/target-atlas.json \
  --out 实验关/关卡6/原型_v4/story-reveal-evidence-v1.json
```

v4 全知路线在第29步打开 R59，在第30步打开 R65。

第二段体验候选 v5：

```bash
node 03_工具/正式版/BuildStoryLevel_v2.js \
  --target 实验关/关卡6/35x35拼接图纸_006.txt \
  --out-dir 实验关/关卡6/原型_v5 \
  --variant 5
```

v5 在前四步链之后加入一辆 `30/22` 的第二拍候选，全知最大 buffer 提升到 3。

故事审计：

```bash
node 03_工具/正式版/StoryAudit_v646.js \
  --level 实验关/关卡6/原型_v5/关卡_实验_v5.json \
  --atlas 实验关/关卡6/分析_v632/target-atlas.json \
  --out-dir 实验关/关卡6/原型_v5
```

审计同时比较全知、默认 PlayerSim 和 `reviveCap=0` PlayerSim，并输出第一债务时刻
每个可点选项的可达数、分类、实际节拍和复活事件。它不会增加或修改障碍。

v5 审计结果是不通过：第一债务窗口有 8 个可点债务，其中 6 个当前死债；默认
PlayerSim 依靠 1 次复活通关，0 复活只到 13%；第二拍 `30/22` 一取即满。

### E6 008受控故事棋盘

第一段走廊：

```bash
node 03_工具/正式版/Build008ControlledBoard_v673.js
```

输出`实验关/关卡8/原型_v1/`。7×7、47车、2黑、13个冰14侧路车，
前14步为`7/26 → 33/22欠18 → 32/27释放 → 27色剥离揭示 → 3/29欠13 → 5/36释放`。

三段故事完整版：

```bash
node 03_工具/正式版/Build008ControlledBoard_v674.js
```

输出`实验关/关卡8/原型_v2/`。保留前14步，并在后半段加入：
`30/25欠5→释放`、`30/25欠17→缩到2→释放`、
`13/31+14/32双欠3→13先释放→14保持6手后释放`。
全知与默认/0复活6局PlayerSim均100%，47步完全一致。

014最终留出：

```bash
node 03_工具/正式版/Build014FinalHoldout_v675.js
```

输出`实验关/关卡14/原型_v1/`。固定故事为
`18/27欠23→29/24切入R69并偿还→33/25打开玉米→24/30欠10→15/24缩到4`，
末段以`31/30欠3→释放`收束。全知与6局PlayerSim均100%，48步完全一致。

三图批量、停止和性能：

```bash
node 03_工具/正式版/BatchHoldoutE6_v676.js
```

每图重复9次，共27个样本；输出`实验关/关卡6/E6_v1/`。
聚合P50 62ms、P90 130ms；停止测试确认失败项不落盘、失败后任务跳过。

生产UI注册表：

```bash
node 03_工具/正式版/GenerateStoryCompilerUiBundle_v616.js
```

生成`02_工程/游戏主bin/bin/js/story-compiler.js`。
当前内置006/008/014三张图，页面开关默认关闭；陌生图明确失败，不回退随机生成。

008双债务故事图：

```bash
node 03_工具/正式版/Build008StoryGraph_v677.js
```

输出`实验关/关卡8/原型_v3/`。起手后只在`33/22`轻债与`3/29`重债之间选择，
分别由`32/27`或`5/36`偿还，再汇合到第二枚`7/26`。棋盘只有6个冰门。

006双债务故事图：

```bash
node 03_工具/正式版/Build006StoryGraph_v678.js
```

输出`实验关/关卡6/原型_v10/`。教学`30/22`后只出现
`17/26欠10`与`34/25欠19`，两者共由`31/30`偿还。棋盘只有6个冰门。

006三分支故事图：

```bash
node 03_工具/正式版/Build006StoryGraph_v679.js
```

输出`实验关/关卡6/原型_v11/`。教学后同时显示安全`15/24`、
轻债`17/26欠10`、重债`34/25欠19`；冰只延迟重债偿还出口。

006零冰开放开局：

```bash
node 03_工具/正式版/Build006OpenStart_v680.js
```

输出`实验关/关卡6/原型_v12/`。顶层7个动作全部无冰、立即收满；
用于先修正“一个能点、其他全冰”的基础错误。

E1-R1 v7 候选：

```bash
node 03_工具/正式版/BuildE1R1Level_v648.js
node 03_工具/正式版/AuditE1R1_v649.js
```

输出 `实验关/关卡6/原型_v7/`。v7 保持 47 车、2 个结构黑块，新增语义障碍为 0；
PlayerSim 三个 seed 在默认/0复活下均走完六步核心链，R59/R65 进入真实玩家路线。
全知旁路仍未解决，因此仍处 E1。

E1-R2 v8 候选：

```bash
node 03_工具/正式版/BuildE1R1Level_v648.js --variant 8
node 03_工具/正式版/AuditE1R1_v649.js --variant 8
```

输出 `实验关/关卡6/原型_v8/`。v8 修复了 v7 的全知旁路，全知和0复活 PlayerSim
走同一六步链；两个债务窗口各5个部分债务、0个死债。实验页的“自动演示故事”
可按玩家路线完整播放47步；当前只剩真人可读性评审。

E1-R3 v9 数字冰 gate：

```bash
node 03_工具/正式版/BuildE1R1Level_v648.js --variant 9
node 03_工具/正式版/AuditE1R1_v649.js --variant 9
node 03_工具/正式版/StoryIceAblation_v651.js
```

输出`实验关/关卡6/原型_v9/`。v9只增加4格数字冰，把第一/第二债务窗口从5/5个
可点选项收紧为1/2个；移除冰后路线与峰值不变，但可见选项恢复为5/5。

E2车辆—目标区域依赖图：

```bash
node 03_工具/正式版/TargetVehicleDependency_v652.js
```

输出`实验关/关卡6/E2_v1/dependency-graph-v1.json/md`，包含47个动作、
234个区域节点、325条消费边和181条揭示边。

摆车约束：

```bash
node 03_工具/正式版/DependencyConstraints_v653.js
```

输出`placement-constraints-v1.json/md`。包含181条“揭示先于消费”规则、
59个多车共同消费区域、26条跨车偿还边；消费早于揭示为0。

同色交换反事实：

```bash
node 03_工具/正式版/SameColorSwapProbe_v654.js
```

输出`same-color-swap-probe-v1.json/md`。26个同色单交换全部保持六步主线，
说明单次换位仍有容量余量；下一步做双交换与容量边界拉伸。

更完整的容量边界与异色探针：

```bash
node 03_工具/正式版/SameColorDoubleSwap_v655.js
node 03_工具/正式版/SameColorSixSwap_v656.js
node 03_工具/正式版/CellColorSwapProbe_v657.js
```

同色双交换260/260、六格全排列1620/1620保持主线。异色探针220个中196个破坏，
确认五个关键硬颜色格；第二释放格允许5/14/15/30/31。

E2第二布局与A/B对照：

```bash
node 03_工具/正式版/BuildE2LayoutB_v658.js
node 03_工具/正式版/CompareE2Layouts_v659.js
```

输出`E2_v1/layoutB/`和`layout-comparison-v1.json/md`。布局B移动25个非关键格，
与布局A共享六步主线、R59/R65和终局释放。

E3完整编译：

```bash
node 03_工具/正式版/BuildBoardConstraintSchema_v660.js
node 03_工具/正式版/E3BoardCompiler_v661.js
node 03_工具/正式版/FinalizeE3_v662.js
```

输出`E3_v1/`：Schema、两个自动生成布局、完整验证、负向测试、局部修复和
`e3-completion-report-v1.md`。

E4语义障碍：

```bash
node 03_工具/正式版/SemanticObstacleCompiler_v663.js
node 03_工具/正式版/ChainObstacleCompiler_v664.js
```

输出`E4_v1/`。数字冰把可见选项5/5收紧为1/2；二连锁形成15完成+17欠10，
31/30下一手释放。

管道与黑块：

```bash
node 03_工具/正式版/PipeRelevanceProbe_v665.js
node 03_工具/正式版/BlackShapeAblation_v666.js
```

当前关卡不生成管道；黑块移除会改变全知与玩家路线，shape语义成立。

E4综合：

```bash
node 03_工具/正式版/QuestionRelevanceProbe_v667.js
node 03_工具/正式版/CombinedObstacleVerifier_v668.js
node 03_工具/正式版/FinalizeE4_v669.js
```

输出`E4_v1/e4-completion-report-v1.md`。实际保留2黑块、4数字冰、1组2连锁；
管道/问号为0；组合布局全知和6局PlayerSim全部通过。

E5修复与交付：

```bash
node 03_工具/正式版/E5RepairAndDeliver_v670.js
node 03_工具/正式版/FinalizeE5_v671.js
```

输出`E5_v1/`：五键关卡、manifest、SHA-256、修复报告和完成报告。

E6.1 008/014预检：

```bash
node 03_工具/正式版/TargetStoryAtlas_v632.js \
  --target 蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_008.txt \
  --out-dir 实验关/关卡6/分析_008_v632 \
  --caps auto,27-27,20-40

node 03_工具/正式版/TargetStoryAtlas_v632.js \
  --target 蚂蚁图库/拼接图/拼接图图库/35x35拼接图纸_014.txt \
  --out-dir 实验关/关卡6/分析_014_v632 \
  --caps auto,31-31,20-40
```

历史容量带均不可精确拆色；`[20,40]`可行，但必须用户批准后才能继续。

008 StoryPlan：

```bash
node 03_工具/正式版/StoryPlan008_v672.js
```

输出`实验关/关卡8/故事计划_v1.md`，记录两笔短债务、R125揭示和释放。

008受控棋盘：

```bash
node 03_工具/正式版/Build008ControlledBoard_v673.js
```

输出`实验关/关卡8/原型_v1/`。7×7、47车、2黑、13冰14，
前14步剧情走廊和客户端往返均通过。

006零冰开放开局与入口职责：

```bash
node 03_工具/正式版/Build006OpenStart_v680.js
node 03_工具/正式版/Build006RoleEntries_v681.js
node 03_工具/正式版/Search006Pressure_v682.js
node 03_工具/正式版/Build006PressureStory_v683.js
node 03_工具/正式版/Build006ChainCheckpoint_v684.js
node 03_工具/正式版/Build006CombinedObstacles_v687.js
node 03_工具/正式版/StoryRepair006_v685.js --inject=chain-removed
node 03_工具/正式版/StoryRepair006_v685.js --inject=key-swap
node 03_工具/正式版/StoryRepair006_v685.js --inject=pipe-removed
node 03_工具/正式版/StoryRepair006_v685.js --inject=capacity-shift --maxCapacity=320
node 03_工具/正式版/Analyze006BranchPayoff_v686.js
node 03_工具/正式版/GenerateStoryCompilerUiBundle_v616.js
```

- `Build006OpenStart_v680.js`输出v12：7×7、47车、2黑、0障碍，
  顶层7个动作全部立即收满；
- `Build006RoleEntries_v681.js`从v12只做6次车辆换位，输出v13：
  - 安全`30/22→15/24`；
  - 轻债`31/31→17/26欠10→31/31`；
  - 长债`30/23→34/25欠19→31/31`；
- v13保持容量多集、黑块和`[20,40]`合同不变，默认/0复活6局PlayerSim全部通关；
- v627生产UI注册表支持`roleGraph`，真实页面显示`7×7 / 47车 / 容量20~40`
  与`006 · 开放入口职责 / 47步契约 / 6/6`。
- `Search006Pressure_v682.js`固定角色锚点，只交换普通车位置；硬过滤开局零收益、
  角色路线破坏和PlayerSim失败；
- `Build006PressureStory_v683.js`输出v14：不开新语义障碍，三个零复活seed均出现
  两个`buffer 3/4`窗口；
- `Build006ChainCheckpoint_v684.js`输出v15二连锁；该版本因链格对角已降为反例；
- `Build006CombinedObstacles_v687.js`输出v17相邻三连锁 + 管道：
  三段压力、可见组债释放和管道queue延迟供车；
- `StoryRepair006_v685.js`按障碍、关键车、单色切分三层做有界修复；
  三连锁、管道、关键车、容量四类注入故障均在1层内恢复；
- `Analyze006BranchPayoff_v686.js`以同一贪心延续比较v17三条入口：
  重债/轻债/安全到R59/R65为26/29/31步；
- v630生产UI显示`006 · 三连锁与管道压力 / 47步契约 / 6/6 /
  0复活压力3窗 / 峰值4`。
- 真人审阅可打开
  `实验关/关卡6/原型_v1/play.html?level=../原型_v17/关卡_实验_006_v17.json`；
  页面按开放开局、两段压力、相邻三连锁、管道和收尾逐拍自动回放。

当前边界：v17机器压力验收已通过，但真人尚未确认三处压力、相邻三连锁与管道释放是否可读。

真实三连锁版本：

```bash
node 03_工具/正式版/BuildStoryLevel_v2.js \
  --target 实验关/关卡6/35x35拼接图纸_006.txt \
  --out-dir 实验关/关卡6/原型_v6 \
  --variant 6
```

v6 在 `(1,4)/(2,4)/(3,4)` 设置一个三连锁组，组内为 `30/22、15/24、17/25`。

预览会先调用 `AntSolver.ColorLibs.detect()`：

- 出现 `-1` 或编号符合官方 0～21 色库时按官方色库渲染；
- 出现大于 21 的编号时按工程旧 34 色库渲染；
- 判据不足时会在 `target-atlas.json` 的 `colorLibrary` 中标为存疑。

## 当前限制

- `groupDebt` 目前是从目标图参考序列中找出“2 辆可收满 + 1 辆收不满”的候选窗口；
- 这些窗口还必须重新做真实 3 连锁链整组入场模拟；
- `forcedGate` 需要棋盘布局才能判定，本工具不伪造；
- “缺口/掏路径”目前是区域相邻图候选，尚未保证棋盘入口和 Manhattan 消耗顺序；
- 区域图是目标图层面的分析，尚未包含最终棋盘车辆依赖；
- 报告中的“可执行”只表示 `InstantPlayout` 目标序列可走通，不表示棋盘和玩家体验已通过。
