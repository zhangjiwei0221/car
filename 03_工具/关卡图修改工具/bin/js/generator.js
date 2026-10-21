/**
 * 蚂蚁拿块 - 关卡生成器
 * 
 * 基于TXT目标图生成蚂蚁盒队列。
 * 
 * 生成流程：
 * 1. 导入TXT目标图（尺寸、颜色种类自动识别，不可调）
 * 2. 分析目标图的消除层次（从边界向内BFS分层）
 * 3. 按层次+颜色生成蚂蚁盒队列（容量自洽校验）
 * 4. 铺盒到棋盘 + 放置障碍/管道（全部在棋盘上）
 * 5. 运行求解器验证可解性 + 输出难度评分
 * 6. 解后【区域换球】：按求解进度%圈定区间换无障碍盒制造卡点，重解校验
 * 7. 输出关卡JSON
 * 
 * 可调参数：
 * - boxSizeMin/boxSizeMax: 蚂蚁盒容量范围（每盒的蚂蚁数上下限）
 * - queueCount: 队列数 (2~5)
 * - bufferLimit: 暂存上限 (3~7)
 * - swapRegionMin/Max: 卡点换球(B支)的后期区域进度区间(%)；基础阶段不换球
 * 注：难度非输入参数；关卡难度分由生产(可解)后的求解器表现反推计算(见 computeDifficulty→Analysis.difficulty)。
 * - icePercent: 冰块比例
 * - blackPercent: 黑块比例
 * - chainCount: 锁链对数
 * 
 * 蚂蚁盒容量自洽规则：
 * - 对每种颜色：总像素数 = 所有该色蚂蚁盒的count之和
 * - 按 boxSizeMin~boxSizeMax 均分，最后一盒不满则与前一盒求和均分
 */

var AntSolver = AntSolver || {};

AntSolver.Generator = (function() {

  var DEFAULT_CONFIG = {
    // 【默认参数基线：v95四方向消除统一默认参数】2026-07-31 起，以下标注「统一默认」的字段
    // 取自 方案文件夹/方案_v95四方向消除统一默认参数.json 的 config，作为四方向消除的统一默认口径。
    boxSizeMin: 35,     // 【统一默认】蚂蚁盒容量下限（原 25）
    boxSizeMax: 80,     // 【统一默认】蚂蚁盒容量上限（原 52）
    boxSizeMode: 'random', // 盒容量策略：random(区间内随机,默认)/max(接近满容量)/min(偏小)/polar(两极化,见 makeCapPicker)
    // polar 模式专用（其他模式忽略）：两端窄带的命中概率与窄带宽度占区间比例
    boxSizePolarBias: 0.7,
    boxSizePolarBandRatio: 0.25,
    // ===== 底部消除·多色并行吐球（v110，任务 ANT-GEN-BOTTOM-PARALLEL-V3-20260826）=====
    // 只作用于 bottomOnly 分支的盒切分（baseFillBoxesBottom），四方向分支不受影响。
    // 同时保持 P 个颜色在累积单盒进度，tick 轮询、装满即挤出 → 盒队列天然交错。
    //   null（默认）= 取 bufferLimit（暂存区上限，实为 5），语义是"手上同时能攒几种颜色"
    //   0           = 关闭，回退到旧的 eliminationOrder 单色批量路径
    //   >=1         = 指定并行路数
    boxParallelCount: null,
    // ===== 死亡边界救援兜底（用户 2026-08-04 指定；默认关闭，开启才生效）=====
    // 最终候选若"玩家版暂存峰值触达上限"(死亡边界，现行审核直接判不合格)，
    // 就在原关卡上做一轮障碍缩减尝试救援：拆 1~2 个冰块 + 解除 1 组锁链，
    // 且必须"全知仍通关 + 玩家仍通关 + 峰值降到上限以下"才采用，否则保留原关卡不掩盖问题。
    deathEdgeRescue: false,
    deathEdgeRescueIceCut: 2,      // 冰块最多拆几个（第1轮拆1个，第2轮拆到该上限）
    deathEdgeRescueChainCut: 1,    // 解除几组锁链
    // ===== 管道数量下限（用户 2026-08-04 指定：不低于 4 个）=====
    // 0 = 不约束（默认，原行为）。>0 时在选棋盘尺寸阶段反推格数上限来保证，见 chooseBoardDims。
    minPipes: 0,
    // ===== 管道队列深度参数化 + 管道不足兜底（任务 ANT-GEN-PIPE-DEPTH-FALLBACK-20260825）=====
    // 用户 2026-08-25：「可调管道队列深度，作为新参数」+「如果其他参数影响导致管道不够，
    //   则保底 2 个管道、深度 3」。
    //
    // pipeMaxDepth：单条管道最多排几个盒（原写死常量 MAX_PIPE_DEPTH=6）。默认 6 = 原行为。
    //   官方格式 spools[].param 是不限长的队列数组、simulator 也不校验队列长度，
    //   因此调这个值不触及求解器与游戏端格式，只改生成期的容量口径。
    // pipeMinFill：单条管道【最少】要排几个盒（原写死在 solveSpaceQuota 的 ⌊D/4⌋ 里）。默认 4 = 原行为。
    //   它决定「溢出盒 D 最多摊给几条管道」：P ≤ ⌊D/pipeMinFill⌋。
    //   ⚠ 这两个值与 minPipes 联立后有硬性算术约束：minPipes 条管道要求 D ≥ minPipes × pipeMinFill。
    //     实测教训（08-25，方案_v104）：minPipes=4 + pipeMinFill=4 需要 D≥16，而该批源图只能产出
    //     D=2~8 → 53 张过闸源图 0 产出，全灭于 usablePipeShort。故有下面的兜底。
    pipeMaxDepth: 6,
    pipeMinFill: 4,
    // 管道阶梯（用户 2026-08-25 两次裁决合并）。按顺序降级，每级都是【硬下限】：
    //   ① 主轮       minPipes 条 / 每管 ≥ pipeMinFill
    //   ② 兜底       pipeFallbackCount 条 / 每管 ≥ pipeFallbackDepth
    //   ③ 绝对下限   pipeFloorCount 条 / 每管 ≥ pipeFloorDepth  ← 用户：「最低 2 个管道 2 层深度」
    //   ④ 去除管道   连 ③ 都到不了 → P=0，管道格全让给盒 ← 用户：「低于这个下限就直接去除管道」
    // pipeFallbackCount = 0 关闭 ②；pipeFloorCount = 0 关闭 ③。
    // ④ 不可关：它是守恒兜底，且 D ≤ 0（棋盘本就装得下）时必须走它——否则只会得到装不满的空管道。
    // 守恒硬约束贯穿全阶梯：D ≤ P × pipeMaxDepth，且 P=0 时必须 D=0（靠少铺 D 个墙腾出格子）。
    pipeFallbackCount: 2,
    pipeFallbackDepth: 3,
    pipeFloorCount: 2,
    pipeFloorDepth: 2,
    // ===== 可用棋盘空间一致性（用户 2026-08-04）=====
    // 可用空间 = (总格 − 墙 − 管道占位) / 总格。设为 0 表示关闭（默认，原行为完全不变）。
    // 开启后：各候选尺寸都按该目标联立求解 (管道数, 黑块数)，只保留有解的尺寸并在其中随机选，
    // 从而让同一批像素图产出不同大小的棋盘、而可用空间保持一致。详见 solveSpaceQuota。
    usableSpaceTarget: 0,
    usableSpaceTolPp: 5,             // 可用空间允许偏离目标多少个百分点（结构层闸门按此淘汰候选）
    usableSpaceBlackTolPp: 5,        // 黑块比例基础容差（个百分点）
    usableSpaceBreachStepPp: 5,      // 每次突破放宽多少个百分点
    usableSpaceBreachBudget: 2,      // 突破预算次数（2 次 × 5pp = 最大突破 10 个百分点，用于保护小棋盘）
    // 注：基础阶段不换球(v86 起)；swapRegionMin/Max 仍保留——供【卡点B支】chokeSwap 定义"后期区域"起点用。
    swapRegionMin: 50,  // 卡点换球的后期区域进度下限(%)：chokeSwap 据此把 pickOrder 切成早/后两段
    swapRegionMax: 100, // (上限目前未在 chokeSwap 中使用，保留兼容旧方案JSON)
    queueCount: 3,
    bufferLimit: 5,     // 暂存上限（基线固定=5）

    icePercent: 15,       // 【统一默认】冰块比例(≥10)（原 18）
    blackPercent: 10,     // 【统一默认】黑块比例——指最终棋盘的黑块目标占比（原 13）
    chainCount: 3,        // 【统一默认】锁链对数(2-6)（原 4）
    chainInitialRatio: 0.5, // 【可调,预设0.5】基础棋盘只放此比例的锁链；剩余一半留【卡点阶段(P2)】按依赖定向补链
    questionPercent: 10,  // 【统一默认】问号比例（原 14）（软障碍，隐藏颜色；强制偶数生成）；可与冰块叠加；不在第0行
    topObstacleMaxPercent: 50, // 前2行(索引0/1)障碍密度上限(%)：障碍格(黑/管道/冰/锁链/问号) ÷ 实际占用格 ≤ 此值；另前2行最多1对锁链
    wallDisperse: 0.85,  // 墙(黑块)分散系数(0~1)：越大越优先选四邻无墙的孤立格分散铺墙——多余黑块打散避免堆成L形连续墙/关卡同质化；墙可现于2-3行，不现于首行
    pipeRowStart: 3,      // 管道最早出现行(默认第3行以后=索引>=3的第4行)；不在第0行/末行
    pipeRowBias: 0.35,    // 管道靠后偏置：起点再下压 rows×该比例(0=不偏置，越大越靠底部)
    // 【统一默认】棋盘行列范围（原 8-9 行 × 11-16 列）。
    // 新范围下满足「列>行 且 列-行∈{1,2}」的合法组合共 7 个：
    // 6×7、6×8、7×8、7×9、8×9、8×10、9×10，够用且不会因约束把候选压空。
    boardRowsMin: 6,
    boardRowsMax: 9,
    boardColsMin: 7,
    boardColsMax: 10,
    // 交错随机铺盒参数（对齐 bin 毛线生成器）
    singleColorExtractPercent: 5,   // 单色抽取比例（散布制造交错/暂存压力）
    firstRowRangeMultiplier: 1,     // 首行候选窗口倍数
    nextRowRangeMultiplier: 1.1,    // 后续行候选窗口倍数
    diffLevel: 2,         // 难度阶梯：1=默认 2=障碍偏后期 3=聚集/锁链覆冰（复用bin diffLevel思路）
    fillRatio: 1.0,       // 棋盘选尺寸时的填充率(<1 留空位余量；1.0=旧行为；packFull 时忽略)
    packFull: true,       // 【统一默认】填满棋盘：棋盘按盒数进一步缩小、多余盒进管道，尽量无空洞（原 false）
    onBoardFrac: 0.8,     // packFull 时目标上盘盒比例(其余走管道；盒越多棋盘越小)
    narrowPath: true,     // 【55×55基础参数】窄路卡点默认开：不规律锯齿墙(斜向/边缘锚定/连通楼梯)+缺口，制造唯一可达通道
    // 窄路出现概率（用户 2026-08-04：窄路必定出现，希望改为按概率出现）。
    // 1 = 必定出现（默认，与本参数引入前完全一致）；0.6 = 约六成关卡出现窄路。
    // 仅控制「本关是否建窄路墙」，窄路自身的形态与缺口数仍由 narrowPathGapsMin/Max 决定。
    // 注意：不影响可用空间一致性——窄路墙黑块本就计入黑块总目标(blackTarget)，
    // 窄路不出现时分散黑块会补足同样的数量，故 (墙+管道) 总量不变。
    narrowPathProb: 1,
    narrowPathGaps: 0,    // (兼容)固定活口数；>0 时覆盖下面的范围
    narrowPathGapsMin: 2, // 【统一默认】活口数范围下限（原 1）
    narrowPathGapsMax: 3, // 【55×55基础参数】活口数范围上限（范围内随机；约束1-4）
    narrowPathIce: true,  // 缺口盒加冰(临时锁路/临时连接窄路，需推进解冻)
    narrowPathChain: true, // 缺口处用斜向/三连锁链辅助阻拦
    narrowPathTrap: false, // 推理陷阱(早序盒调到墙下)：测试显示会破坏可解性，默认关闭
    narrowPathTrapFrac: 0.5, // 陷阱交换比例(仅 narrowPathTrap 开启时生效)
    maxRetries: 5,
    // ===== 两轮生产 =====
    candidateCount: 6,     // 候选数 K：每源图初生成几个候选(各过合法性门:结构+可解)
    chokeBranches: 3,      // 【P3】卡点树分支数 B：每变体每轮展开 B 个卡点制造分支
    rounds: 2,             // 【P3】卡点树轮数 N：不合格变体再分支的轮数；单候选叶子≤Bᴺ，1关合格即停
    chokeSwapCount: 12,    // 【卡点A】一次换球最多搬几处(越多卡点越强，可调)
    chainSwapCount: 4,     // 【卡点A·锁链定向】一次最多把几个前期锁链组换成图内部深色(逼组内成员长期滞留)
    timeBudgetMs: 300000,  // 【单关生产时间预算】默认5分钟；到点仍不合格→兜底输出树内已评估过的最接近标准的候选(0=不限时)
    requireHardPass: false, // 【批量比例控制用】true=只在"困难合格"(真实卡点)时早停；简单合格(趋势符合)不算数，继续找/直到超时兜底
    // ===== 基础填球（趋势分析 + 消除顺序标记）=====
    baseFillByElimOrder: true,   // 确定棋盘骨架后，基础填球按【目标图底→顶趋势=消除顺序】自顶向下顺序填入(先消除的盒放顶部先可达)；关=旧交错随机铺盒
    elimOrderScatterPercent: 5,  // 基础顺序填入【之后】的单色交错扰动比例：随机把富余色少量盒与远处盒【换位】(守恒,只换位置)制造暂存压力；0=纯顺序不打散
    // ===== 目标图消除入口模式（ANT-GEN-BOTTOM-ONLY-20260729）=====
    // false(默认)：四边入口——v95 既有行为，本字段引入前后完全一致。旧方案 JSON 无此字段时也按 false。
    // true ：仅底部入口——目标图上/左/右三边视作封闭，只能从底边开始向内消除。
    //   开启后本关【全链路同一口径】：底部依赖盒切分(baseFillBoxesBottom) → 候选筛选(1遍基础+3遍噪声)
    //   → 卡点分支重求解 → 三步前瞻可达 → 暂存自动释放 → 锁链滞留 → 管道推出后消除
    //   → 最终全知求解 → 玩家模拟 → 审核与难度。
    //   【棋盘取盒方向不改】：棋盘仍按原有暴露/障碍/管道/冰/锁链规则取盒，只有目标图消除入口变了。
    //   生产前会先跑 checkBottomEntryFeasibility 判源图在该规则下是否全图可达，不可达直接不进候选。
    bottomOnly: false,
    // ===== 第三种玩法模式：四方向瞬时连锁消除（需求 08.03，用户 2026-08-03 批准）=====
    // false(默认)：走原有两种模式，行为与本字段引入前完全一致；旧方案 JSON 无此字段时也按 false。
    // true ：四方向瞬时连锁消除。与 bottomOnly 互斥（本模式固定四方向可达，不接受底部单入口）。
    //   开启后本关【全链路同一口径】：四方向盒切分 → 候选筛选(1遍基础+3遍噪声) → 卡点分支重求解
    //   → 三步前瞻 → 暂存自动释放(严格先进先得) → 全知求解 → 玩家模拟 → 审核与难度。
    //   结算差异只在「怎么选像素」：每轮快照当前可达同色全集，按离该订单暂存起点的距离近优先，
    //   消到订单剩余容量为止，目标图整体刷新后再重扫下一轮（详见 simulator.instantChainEliminate）。
    instantChain: false,
    // ===== 生产前置碎色闸门（任务 ANT-GEN-FRAGMENT-GATE-20260824，用户 2026-08-24 批准）=====
    // fragmentMaxRate：目标图碎色率上限。**0 = 关闭**（默认，行为与本参数引入前完全一致）。
    //   >0 时在 produceFixed 生成候选【之前】判定：碎色率超过该值 → 直接跳过该源图，
    //   返回 level:null + lastFailReason:'fragmentGateBlocked'，不消耗时间预算、不造假关。
    // 标定依据（08-24 实测，上线 345 关按碎色率四等分）：
    //   Q1 上界 0.1516 → 好关率 38.5%（各档最高）、严重差关率 1.3%
    //   Q2 上界 0.1879 → 好关率 32.1%、严重差关率 11.5%
    //   Q3 上界 0.2253 → 好关率 23.1%      Q4 上界 0.3336 → 好关率 24.7%
    // ⚠ 取 0.1516 很严格：上线 345 关仅 24.8% 能过，200 新图仅 4.0%（8/200），347 修复批 15.3%。
    //   放宽到 0.1879 时：200 新图 18.5%、347 修复 33.4%。请按产能需要权衡。
    //
    // ⚠⚠ 【2026-08-25 口径变更：小色块 ≤10 → ≤7（用户「放宽给到小于8」）】
    //   上面那套四等分标定是在 smallMax=10 下做的，口径一变即失效。已按新口径重标定
    //   （`_kiro临时/08.25-碎色口径重标定/_重标定small7.js`，同一批 344 关、同一份线上好差关标签）：
    //
    //   分布：中位 0.1892 → 0.1453，平均下降 4.32 个百分点（判碎的像素变少）
    //   新口径四等分：Q1≤0.1147 好关率32.6%/严重差3.5% ← 好关率最高档
    //                 Q2≤0.1450 29.1%/9.3%   Q3≤0.1719 24.4%/11.6%   Q4≤0.2653 22.1%/12.8%
    //   新口径五等分：L1≤0.1054 33.8%/1.5%   L2≤0.1342 32.4%/8.8%   L3≤0.1557 27.9%/11.8%
    //                 L4≤0.1797 20.6%/10.3%  L5 20.8%/13.9%
    //   全样本基础率：好关 27.0% / 差关 31.7%
    //
    //   各阈值在【新口径】下的过闸率与过闸集表现（344 关）：
    //     15.16% → 55.5%（好关 30.4% / 差关 23.6% / 严重差 6.3%）｜旧口径同阈值仅 25.3%
    //     18.00% → 79.1%（好关 28.7% / 差关 27.9% / 严重差 8.1%）｜旧口径 43.0%   ← 当前采用
    //     20.47% → 91.3%（好关 27.7% / 差关 29.6% / 严重差 8.0%）｜旧口径 60.8%
    //   ⚠ 18% 过闸集的好关率 28.7% 已接近基础率 27.0%，说明**新口径下 18% 筛选力很弱**。
    //     要保持"好关率最高档上界"的原始设计强度，新口径对应值是 0.1147。
    //     这属于阈值裁决，未擅自改动——18% 是用户明确定的值。
    //
    // 【当前采用 0.18】用户 2026-08-25 裁决：「给到 18% 作为碎色率上限」。
    //   该值写在 UI 默认值（bin/index.html 的 #gen-frag-max = 18），**本字段仍是 0 = 闸门关闭**，
    //   阈值一律由调用方/UI 给，不在 DEFAULT_CONFIG 里硬开闸门（否则脚本调用会被意外过滤）。
    //   ⚠ 修图工具（关卡图修改工具/js/fragment.js）的碎色率检查用的是【同一个值、同一套口径】，
    //     改这里的口径或那边的默认阈值，两边必须一起改 —— 否则会出现
    //     「工具告诉美术已达标、生产端照样把图卡掉」。同步义务见 关卡图修改工具/bin/来源说明.md。
    fragmentMaxRate: 0,
    // 碎色口径参数——**改任一项都会使上面的阈值失效**，非必要不要动。
    // 【2026-08-25 变更】用户裁决：「把小色块要求放宽给到小于 8」→ fragmentSmallMax 10 → 7
    //   （"小于 8" 即像素数 ≤ 7）。这回到了用户 08-24 的原始定义
    //   「连通大于3小于8的色块定义为小色块……连通大于8的标记为正常色块」。
    //   ⚠ 该变更使 08-24 基于 smallMax=10 标定的阈值失效，已按新口径重新标定，见上方阈值段。
    fragmentIsoMax: 1,        // 孤立块：像素数 ≤ 此值
    fragmentSmallMax: 7,      // 小色块上限（"小于8"即 ≤7）；> 此值为正常块。簇总量 > 此值时整簇改判正常
    fragmentBarrierPx: 3,     // 隔断像素数上限（目标图填满，故与曼哈顿距离等价，差 ±1）
    fragmentBarrierKinds: 1,  // 隔断颜色种类上限；与 Px 取 AND：又杂又厚才算隔开
    // ===== 卡点体系类型化（ANT-GEN-CHOKE-TYPES-20260824，用户 2026-08-24 批准）=====
    // 改动前只有两个卡点分派分支（60% 换球 / 40% 增容），实测 344 关结构指纹仅 24 种、最常见 5 种占 65.7%。
    // 现在把卡点显式类型化，每关按配额抽取【互不重合】的若干类型；BOSS 与普通关分别配额。
    //
    // ⚠ 默认全部为 0 = 一个类型都不抽 → 各处走原有行为，与本功能引入前**完全一致**。
    //   要启用就把想用的类型权重调成 >0，并把下面两个数量设成 >0。
    chokeTypeCountNormal: 0,  // 普通关每关抽几种卡点类型（0=不启用类型化）
    chokeTypeCountBoss: 0,    // BOSS 关每关抽几种（用户要求③：BOSS 与普通关分别设定）
    // 各类型的抽取权重（0 或缺省 = 不参与抽取）。加权无放回抽样 → 同关内类型不重合（用户要求②）。
    chokeTypes: {
      iceCluster: 0,        // 冰块簇聚集（新）：同样数量的冰改为聚集铺，局部形成长时间锁死区
      chainCluster: 0,      // 锁链簇聚集（新）：允许锁链组之间 8-邻接，多组同时索要暂存空位
      questionCluster: 0,   // 问号聚集（新）：形成"一片看不清"的区域，只影响玩家判断不改可解性
      chainIce: 0,          // 冰叠锁链（新）：给锁链成员定向叠冰，空间锁 + 时间锁串联
      pipeChain: 0,         // 管道口叠锁链（新）：锁链锚在管道出口格，锁住管道吐球节奏
      narrowGapIce: 0,      // 窄路口叠冰（已有，默认恒开；仅 chokeGateNarrowByType=true 时按类型门控）
      narrowGapChain: 0,    // 窄路口叠锁链（同上）
      bigBox: 0,            // 超大盒（已有 chokeInflate，倍率见 bigBoxMul*）
      rareColorKey: 0,      // 稀有色占关键位（v104 已实现：在首次换球时把稀有色换入窄路口/锁链端/管道口）
      swap: 0,              // 换球/藏管道（现有手段，纳入类型体系以便统计与配额）
      inflate: 0            // 增容（现有手段，同上）
    },
    iceClusterSeeds: 0,       // 冰块簇的团数（0=按数量自适应 sqrt/1.5）
    questionClusterSeeds: 0,  // 问号簇的团数（同上）
    chainIcePerGroup: 1,      // chainIce：每个锁链组最多叠几个冰（叠满会让组几乎不可解，默认 1）
    chainIceGroups: null,     // chainIce：最多处理几组（null=一半的组）
    rareColorTopN: 3,         // rareColorKey：取最稀有的前 N 色作为换入源
    rareColorSwapCount: 3,    // rareColorKey：一次最多把几个关键位换成稀有色
    bigBoxMulMin: 1.5,        // 超大盒倍率下限（× boxSizeMax）；默认 1.5~2.0 = 参数化前的硬编码值
    bigBoxMulMax: 2.0,
    // 窄路口两项原本恒开（narrowPathIce/narrowPathChain 默认 true）。置 true 才改为「必须抽中对应类型」，
    // 默认 false 以保证向后兼容。
    chokeGateNarrowByType: false,
    // 由批量调度逐关透传：本关是否按 BOSS 规格生产。produce 是单关函数、自身不知批次位置。
    isBossSlot: false
  };

  /**
   * 从目标图生成关卡（主入口）
   * config._deadlineAt(内部用，由 produce() 透传，非 UI 参数)：绝对时间戳(ms)。
   *   每轮"建棋盘+6遍求解"本身不可中断，但重试循环(至多 maxRetries 轮)会在【每轮开始前】检查此
   *   deadline，一旦超时立即停止再开新一轮重试(至少已跑完1轮，不会一次都不跑)——避免单次调用
   *   把 produce() 的总时间预算顶爆到"5倍单轮耗时"那么多。
   */
  /* ── 生产性能埋点(阶段1，只计数不改策略) ────────────────────────────
   * 回答"单关慢在建盘、求解、玩家模拟还是分支数量"，供性能报告与后续提速决策(阶段6)用。
   * 纯累加计数/计时 + 停止原因，不参与任何候选选择、审核、难度或预算判定，行为完全等价。
   * 由 produce() 在每关开始时 resetGenPerf()，结束时把快照挂到返回结果的 perf 字段。
   */
  var GENPERF = newGenPerf();
  function newGenPerf() {
    return {
      generateCalls: 0,   // generateFromBlocks 调用次数(基础候选 + 压力调整重生成)
      boardBuilds: 0,     // 建盘次数(含内部重试)
      pipeRebuilds: 0,    // 管道深度超限重铺次数
      baseCandidates: 0,  // 基础候选数
      chokeVariants: 0,   // 卡点变体数
      regenVariants: 0,   // 走"压力调整重新建盘"的变体数
      evalCalls: 0,       // evaluateGeneration 次数(含玩家模拟)
      boardMs: 0,         // 建盘累计毫秒
      evalMs: 0,          // 生成评价累计毫秒(含玩家模拟)
      totalMs: 0,         // 单关 produce 总毫秒
      stopReason: ''      // 停止原因：pass_early_stop / budget_timeout / exhausted / no_candidate
    };
  }
  function resetGenPerf() { GENPERF = newGenPerf(); }
  function getGenPerf() { var o = {}; for (var k in GENPERF) o[k] = GENPERF[k]; return o; }

  function generateFromBlocks(blocks, config) {
    config = Object.assign({}, DEFAULT_CONFIG, config || {});
    GENPERF.generateCalls++;                       // 埋点：generateFromBlocks 调用次数(基础候选 + 压力调整重生成)
    var rows = blocks.length, cols = blocks[0].length;
    var deadlineAt = config._deadlineAt || 0;

    var lastLevel = null, lastResult = null, lastParsed = null, curCfg = config;
    for (var retry = 0; retry < config.maxRetries; retry++) {
      if (retry > 0 && deadlineAt && Date.now() >= deadlineAt) break;   // 超时：停止再开新一轮重试(已完成的轮次仍返回)
      // 1) 生成盒序列：默认按【目标图底→顶趋势=消除顺序】切分(baseFillBoxes)，
      //    关闭开关时回退旧的“贪心可达最多色”序(solverGuidedBoxes)。盒的 elimSeq=消除顺序下标。
      //    bottomOnly 时改走底部依赖流分支(baseFillBoxesBottom)——D2：旧流程一并对齐。
      var boxes = pickBoxSplit(blocks, curCfg);
      // 2) 确定棋盘骨架(尺寸+障碍/墙/管道) → 基础填球按消除顺序顺序填入 → 再执行后续铺盒扰动
      GENPERF.boardBuilds++;                       // 埋点：建盘次数(含每次重试)
      var _tb = Date.now();
      var board = buildBoard(boxes, curCfg);
      GENPERF.boardMs += Date.now() - _tb;
      // P1b 兜底：管道每管超过深度上限(容量错位，多因随机尺寸偏小→溢出过多而可达约束下放不下足够管道)。
      //   先重随机尺寸重试(buildBoard 内尺寸随机)；仍超则增大盒容量→减少盒数→减溢出。重新分盒仍守恒。
      //   只重铺盒(不含求解)，代价低；采用兜底后的配置供后续诊断/减负一致。
      //   深度上限原写死 6，现取 config.pipeMaxDepth（默认 6，等价原行为）。
      var pbCfg = curCfg, pbTry = 0;
      while (maxPipeDepth(board) > pipeDepthOf(pbCfg) && pbTry < 5) {
        pbTry++;
        GENPERF.pipeRebuilds++;                    // 埋点：管道深度超限触发的重铺次数
        if (pbTry >= 2) pbCfg = Object.assign({}, pbCfg, {
          boxSizeMin: (pbCfg.boxSizeMin || 40) + 3, boxSizeMax: (pbCfg.boxSizeMax || 56) + 3
        });
        var boxesR = pickBoxSplit(blocks, pbCfg);
        board = buildBoard(boxesR, pbCfg);
      }
      curCfg = pbCfg;

      var level = { blocks: blocks, bufferLimit: curCfg.bufferLimit, board: board };
      var parsed = AntSolver.parseLevel(level);
      var sdc = structuralDeadlockCheck(board);   // 结构性卡死检验(锁链可激活/盒可达)
      // 基础棋盘首解：6 遍求解(贪心×2→树×2→噪声×2, 任一遍解出即停)获得 pickOrder 与可解性确认。
      // 入口模式随 config 透传（D2：旧流程一并对齐底部模式）。
      var result = AntSolver.Solver.solve(parsed, { capturePreviewStats: true, bottomOnly: !!curCfg.bottomOnly, instantChain: !!curCfg.instantChain });
      lastLevel = level; lastResult = result; lastParsed = parsed;

      // 合格 = 结构无卡死 且 求解器可通关
      if (sdc.ok && result.completed) {
        // 注：基础阶段不做换球(v86 起)——基础候选到此直接采用；换球只在【卡点B支】(chokeSwap)定向执行，
        //   进入 produce() 的候选树后，未合格候选才会展开卡点分支。
        var generationEval = evaluateGeneration(result, parsed, curCfg);
        var difficulty = computeDifficulty(result, parsed, curCfg, generationEval);
        return {
          level: level, valid: true, solveResult: result, difficulty: difficulty,
          generationEval: generationEval, config: curCfg, retries: retry, structural: sdc
        };
      }
      // 未通关 → 重试减负。优先削【结构/压力】(窄路/黑块 = 真正的不可解元凶)，
      // 【尽量保住冰块/锁链】(轻障碍，一般不是不可解主因；玩家反馈冰块过少)：仅在后段retry才轻削。
      // 注：换球为解后处理，不参与重试削减。
      var late = retry >= 2;
      curCfg = Object.assign({}, curCfg, {
        blackPercent: late ? (curCfg.blackPercent || 0) * 0.85 : curCfg.blackPercent, // 结构：后段才削
        icePercent: late ? (curCfg.icePercent || 0) * 0.9 : curCfg.icePercent,          // 冰：后段轻削
        chainCount: late ? Math.floor((curCfg.chainCount || 0) * 0.85) : curCfg.chainCount, // 链：后段轻削
        // 窄路墙较早撤掉(结构性不可解主因)
        narrowPath: curCfg.narrowPath && retry < Math.max(1, Math.floor(config.maxRetries * 0.4))
      });
    }

    var difficulty2 = computeDifficulty(lastResult, lastParsed, curCfg);
    var sdc2 = lastLevel && lastLevel.board ? structuralDeadlockCheck(lastLevel.board) : { ok: false, reason: '无有效关卡' };
    return { level: lastLevel, valid: false, solveResult: lastResult, difficulty: difficulty2, config: curCfg, retries: config.maxRetries, structural: sdc2 };
  }

  /**
   * 生成随机目标图关卡（无TXT输入时使用）
   */
  function generate(config) {
    config = Object.assign({}, DEFAULT_CONFIG, config || {});
    var size = config.mapSize || 12;
    var colorCount = config.colorCount || 4;
    var blocks = generateTargetMap(size, colorCount, config.pattern || 'blob');
    return generateFromBlocks(blocks, config);
  }

  // ==================== 消除层次分析 ====================

  function analyzeEliminationLayers(blocks, rows, cols) {
    var layers = AntSolver.create2D(rows, cols, -1);
    var eliminated = AntSolver.create2D(rows, cols, false);
    var dirs = [[-1,0],[1,0],[0,-1],[0,1]];

    // 空格初始已消除
    for (var r = 0; r < rows; r++)
      for (var c = 0; c < cols; c++)
        if (blocks[r][c] <= 0) { eliminated[r][c] = true; layers[r][c] = 0; }

    var currentLayer = 1;
    var changed = true;

    while (changed) {
      changed = false;
      var layerCells = [];
      // 从底部向上扫描（与消除方向一致）
      for (var r = rows-1; r >= 0; r--) {
        for (var c = 0; c < cols; c++) {
          if (eliminated[r][c] || blocks[r][c] <= 0) continue;
          var reachable = (r === 0 || r === rows-1 || c === 0 || c === cols-1);
          if (!reachable) {
            for (var d = 0; d < dirs.length; d++) {
              var nr = r + dirs[d][0], nc = c + dirs[d][1];
              if (nr < 0 || nr >= rows || nc < 0 || nc >= cols || eliminated[nr][nc]) { reachable = true; break; }
            }
          }
          if (reachable) layerCells.push({r: r, c: c});
        }
      }
      if (layerCells.length > 0) {
        for (var i = 0; i < layerCells.length; i++) {
          eliminated[layerCells[i].r][layerCells[i].c] = true;
          layers[layerCells[i].r][layerCells[i].c] = currentLayer;
        }
        currentLayer++;
        changed = true;
      }
    }
    return { layers: layers, maxLayer: currentLayer - 1 };
  }

  // ==================== 蚂蚁盒队列生成（容量自洽） ====================

  function generateQueues(blocks, layerInfo, config) {
    // 采用"求解引导式"生成：模拟实际的贪心消除过程，记录真实的蚂蚁盒序列。
    // 这保证了生成的关卡必然可解（按序单队列消费时暂存区始终为空）。
    var allBoxes = solverGuidedBoxes(blocks, config);

    // 轮流分配到队列
    var queues = [];
    for (var q = 0; q < config.queueCount; q++) queues.push([]);
    for (var i = 0; i < allBoxes.length; i++) {
      queues[i % config.queueCount].push({ color: allBoxes[i].color, count: allBoxes[i].count });
    }
    return queues;
  }

  // ==================== 棋盘构建（元素区） ====================
  var MAX_PIPE_DEPTH = 6; // 复用 bin：管道最大深度（默认值；实际取值见 pipeDepthOf）

  // 管道容量口径取值（任务 ANT-GEN-PIPE-DEPTH-FALLBACK-20260825）。
  //   config 缺省或非法时回落到原常量，保证「不传参 = 原行为」。
  function pipeDepthOf(config) {
    var v = config && config.pipeMaxDepth != null ? parseInt(config.pipeMaxDepth, 10) : MAX_PIPE_DEPTH;
    if (!(v > 0)) v = MAX_PIPE_DEPTH;
    return v;
  }
  // 单管最少装几个盒（决定 P ≤ ⌊D/pipeMinFill⌋）。不得超过深度上限，否则区间必空。
  function pipeMinFillOf(config) {
    var v = config && config.pipeMinFill != null ? parseInt(config.pipeMinFill, 10) : 4;
    if (!(v > 0)) v = 1;
    var d = pipeDepthOf(config);
    return v > d ? d : v;
  }

  /**
   * 把有序盒序列(按消除顺序)铺到 9×(9-19) 棋盘，并放置障碍/管道。
   * 盒子自顶向下按消除顺序铺格 → 顶部解锁顺序天然匹配可解顺序（保证基础可解）。
   * 溢出盒 + 用户指定管道 → 底部管道(出口朝上)按顺序滴放。
   */
  /**
   * 在配置的行列范围内选能容纳 n 个盒的最小棋盘（行列均受控）；放不下则用最大尺寸(溢出走管道)。
   */
  // P1：在行列参数范围内【随机】选一个组合（尺寸参数应与目标图匹配）。
  // 溢出盒由管道守恒吸收(每管容量4~6)；若容量严重错位(装不下/空太多)，由上层盒容量兜底调整。
  // 注：n 保留为入参（供未来"随机但保容量下限"的兜底判断）。
  function chooseBoardDims(n, config) {
    var rMin = clampInt(config.boardRowsMin, AntSolver.BOARD_ROWS, 3, 20);
    var rMax = clampInt(config.boardRowsMax, AntSolver.BOARD_ROWS, rMin, 20);
    var cMin = clampInt(config.boardColsMin, AntSolver.BOARD_COLS_MIN, 3, 30);
    var cMax = clampInt(config.boardColsMax, AntSolver.BOARD_COLS_MAX, cMin, 30);
    var rows = rMin + Math.floor(Math.random() * (rMax - rMin + 1));
    var cols = cMin + Math.floor(Math.random() * (cMax - cMin + 1));
    // ===== 管道数量下限保证（用户 2026-08-04：管道太少，要确保不低于 4 个）=====
    // 管道数由守恒反推：溢出盒 D = 盒数 n − (格数 − 黑块)，管道数下界 = ⌈D/5⌉（每管容量 4~6）。
    // 因此「管道数 ≥ minPipes」等价于「D ≥ minPipes×5」，即棋盘格数有一个上限：
    //     格数 ≤ (n − minPipes×5) / (1 − 黑块占比)
    // 这正是用户说的「缩小基础棋盘来增加管道」——把它做成可计算的硬约束，而不是靠调参碰。
    // minPipes 默认 0（不约束），原两种模式行为完全不变。
    var minPipes = parseInt(config.minPipes, 10) || 0;
    if (minPipes > 0 && n > 0) {
      var blackFrac = Math.min(0.25, (config.blackPercent || 0) / 100);   // 黑块另有 25% 上限
      var maxCells = Math.floor((n - minPipes * 5) / (1 - blackFrac));
      var feasible = [];
      for (var rr = rMin; rr <= rMax; rr++) {
        for (var cc = cMin; cc <= cMax; cc++) {
          if (rr * cc <= maxCells) feasible.push({ rows: rr, cols: cc });
        }
      }
      if (feasible.length) {
        // 可行组合里随机取，保留原有的尺寸随机性，只是把过大的尺寸剔除
        var pickIdx = Math.floor(Math.random() * feasible.length);
        rows = feasible[pickIdx].rows; cols = feasible[pickIdx].cols;
      } else {
        // 参数范围内没有任何尺寸能满足下限（盒数太少或范围下限太大）→ 取范围内最小面积，尽力而为。
        // 这种情况说明「盒容量太大导致盒数不足」，需要调小容量而不是继续缩棋盘，交由上层与验证脚本暴露。
        rows = rMin; cols = cMin;
      }
    }
    return { rows: rows, cols: cols };
  }

  function clampInt(v, def, lo, hi) {
    v = parseInt(v, 10);
    if (isNaN(v)) v = def;
    if (v < lo) v = lo;
    if (v > hi) v = hi;
    return v;
  }

  /** 预留黑块后，检查所有空(未来盒)格是否仍从顶部可达（black/pipe 阻挡）。 */
  function nullCellsReachable(cells, rows, cols) {
    var vis = AntSolver.create2D(rows, cols, false);
    var q = [];
    function passable(cell) { return cell == null; } // 只有空格(未来盒)可通行
    for (var c = 0; c < cols; c++) if (passable(cells[0][c])) { vis[0][c] = true; q.push([0, c]); }
    var dirs = [[-1,0],[1,0],[0,-1],[0,1]];
    for (var h = 0; h < q.length; h++) {
      var r = q[h][0], cc = q[h][1];
      for (var d = 0; d < dirs.length; d++) {
        var nr = r + dirs[d][0], nc = cc + dirs[d][1];
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols || vis[nr][nc]) continue;
        if (passable(cells[nr][nc])) { vis[nr][nc] = true; q.push([nr, nc]); }
      }
    }
    for (var r2 = 0; r2 < rows; r2++) for (var c2 = 0; c2 < cols; c2++) {
      if (cells[r2][c2] == null && !vis[r2][c2]) return false;
    }
    return true;
  }

  function buildBoard(boxes, config) {
    var n = boxes.length;
    var dims = chooseBoardDims(n, config);
    var rows = dims.rows, cols = dims.cols;
    var cellCap = rows * cols;

    // ===== P1：管道数量由守恒反推 =====
    // 尺寸已在 chooseBoardDims 内随机。溢出盒数 D = 盒总量 − (格数 − 黑块) 由管道守恒吸收：
    // 每管最终容量 4~6 → 管道数 P∈[⌈D/5⌉,⌊D/3⌋]。

    // 空网格
    var cells = [];
    for (var r = 0; r < rows; r++) { var row = []; for (var c = 0; c < cols; c++) row.push(null); cells.push(row); }

    // 黑块（分散）目标数：占格；boxes 铺在其余格，溢出走管道（黑块与管道都减少普通格）
    var blackCount = Math.floor(cellCap * (config.blackPercent || 0) / 100);
    var blackCap = Math.floor(cellCap * 0.25);
    if (blackCount > blackCap) blackCount = blackCap;

    // ===== 窄路卡点：先在中后部行建黑块墙(留单一缺口)，制造"唯一可达"通道 =====
    // 墙体黑块是刻意结构，独立于分散黑块预算；缺口后续会加冰"临时锁路"。
    var narrowGaps = [];
    if (config.narrowPath && narrowPathHits(config)) narrowGaps = reserveNarrowWalls(cells, rows, cols, config);
    // 保护缺口【走廊】：管道/黑块不得占用缺口格及其正上/正下(唯一通道的咽喉)，否则活口开了也会被管道/黑块快速堵死。
    // 墙/管道共用窄路逻辑：管道也是墙(isWallAt 计入)，故管道既不能占走廊，其出口(吐球位)也不能落在走廊。
    var gapProtect = {};
    for (var wgi = 0; wgi < narrowGaps.length; wgi++) {
      var gr0 = narrowGaps[wgi].r, gc0 = narrowGaps[wgi].c;
      gapProtect[gr0 + ',' + gc0] = true;
      if (gr0 - 1 >= 0) gapProtect[(gr0 - 1) + ',' + gc0] = true; // 缺口正上(通道入口)
      if (gr0 + 1 < rows) gapProtect[(gr0 + 1) + ',' + gc0] = true; // 缺口正下(通道出口)
    }
    var wallBlacks = countCellsOfType(cells, 'black');

    // 分散黑块（补足到目标数之上；墙已占的算入总黑块，总黑块封顶 40% 格）
    var extraBlack = Math.max(0, blackCount - wallBlacks);
    var totalBlackCap = Math.floor(cellCap * 0.4);
    if (wallBlacks + extraBlack > totalBlackCap) extraBlack = Math.max(0, totalBlackCap - wallBlacks);

    // 管道数（守恒反推）：可用普通格 = cellCap - 总黑块；溢出盒 D=n-可用格 → 管道吸收(每管4~6)。
    var totalBlack = wallBlacks + extraBlack;
    var freeForBoxes = cellCap - totalBlack;
    var overflow = Math.max(0, n - freeForBoxes);   // D
    var pipeCount = pipeCountByConservation(overflow, config); // 每管最终容量 1+D/P ∈ [pipeMinFill, pipeMaxDepth]
    var maxPipes = Math.max(1, Math.floor((rows - 2) * cols / 3));
    if (pipeCount > maxPipes) pipeCount = maxPipes; // 超上限则 clamp（此时个别管道会略超深度上限，由兜底/P1b 精调）
    if (overflow > 0 && pipeCount < 1) pipeCount = 1; // 有溢出必须至少1个管道兜底，避免丢盒

    // 管道：分散在棋盘各处（非第0行、避开墙行），四方向随机(11上/12右/13下/14左)，出口须在盘内且为盒格。
    // 管道视作黑块永久占格（吐完球也不消失）。
    var pipeList = []; // [{r,c,dir}]
    var exitSet = {};  // 出口格 'r,c'
    if (pipeCount > 0) {
      // 管道靠后：候选行 [pStart, rows-2]。pStart = max(pipeRowStart默认3, round(rows×pipeRowBias)) → 偏底部。
      // 不在第0行/末行。小棋盘或候选不足时逐步上移 pStart 兜底(保证能放下目标管道数)。
      var pipeRowStart = clampInt(config.pipeRowStart, 3, 0, 30);
      var pipeBiasFrac = (typeof config.pipeRowBias === 'number') ? config.pipeRowBias : 0.35;
      var pStart = Math.max(pipeRowStart, Math.round(rows * pipeBiasFrac));
      if (pStart > rows - 2) pStart = rows - 2;
      if (pStart < 1) pStart = 1;
      function buildPipeCand(start) {
        var arr = [];
        for (var pr = start; pr < rows - 1; pr++) { for (var pcc = 0; pcc < cols; pcc++) { if (gapProtect[pr + ',' + pcc]) continue; arr.push({ r: pr, c: pcc }); } }
        return arr;
      }
      var pipeCand = buildPipeCand(pStart);
      while (pipeCand.length < pipeCount * 2 && pStart > 1) { pStart--; pipeCand = buildPipeCand(pStart); } // 候选不足则放宽起点
      var pipeSel = pickDispersed(pipeCand, pipeCount * 3, 2); // 多取候选，逐个验证方向/可达/形态
      for (var ps = 0; ps < pipeSel.length && pipeList.length < pipeCount; ps++) {
        var pcell = pipeSel[ps];
        if (cells[pcell.r][pcell.c] != null) continue;
        if (exitSet[pcell.r + ',' + pcell.c]) continue; // 管道格不可占用其他管道的出口
        if (wouldViolateWall(cells, rows, cols, pcell.r, pcell.c)) continue; // 管道也是墙，遵循形态约束
        var dir = choosePipeDir(cells, rows, cols, pcell.r, pcell.c, exitSet); // 出口去重
        if (dir < 0) continue;
        var dv = AntSolver.PIPE_DIRS[dir];
        var er = pcell.r + dv[0], ec = pcell.c + dv[1];
        if (gapProtect[er + ',' + ec]) continue; // 管道出口(吐球位)不得落在窄路走廊 → 避免持续吐球堵死活口
        cells[pcell.r][pcell.c] = { t: 'pipe', dir: dir, queue: [], next: 0 };
        if (!nullCellsReachable(cells, rows, cols)) { cells[pcell.r][pcell.c] = null; continue; }
        pipeList.push({ r: pcell.r, c: pcell.c, dir: dir });
        exitSet[er + ',' + ec] = true;
      }
    }

    // 黑块：分散预留（非第0行、非最后一行、非墙行、非管道格、非管道出口格），保证其余(未来盒)格顶部可达
    // 多余(分散)黑块尽量【远离已有墙/管道】：优先选四邻无墙的孤立格 → 避免贴着窄路墙堆叠、视觉上像刻意卡点。
    if (extraBlack > 0) {
      function wallNbrCount(r, c) {
        var n = 0, dd = [[-1,0],[1,0],[0,-1],[0,1]];
        for (var i = 0; i < 4; i++) if (isWallAt(cells, rows, cols, r + dd[i][0], c + dd[i][1])) n++;
        return n;
      }
      var looseCand = [], tightCand = [];
      for (var br = 1; br < rows - 1; br++) { for (var bc = 0; bc < cols; bc++) {
        if (cells[br][bc] == null && !exitSet[br + ',' + bc] && !gapProtect[br + ',' + bc]) {
          if (wallNbrCount(br, bc) === 0) looseCand.push({ r: br, c: bc }); // 四邻无墙=孤立(优先分散)
          else tightCand.push({ r: br, c: bc });                            // 贴墙(仅在孤立格不够时才用)
        }
      } }
      // 孤立格足够则只用孤立格(最大化分散、远离墙)；不足再补贴墙格
      // 分散系数：越大→越优先只用孤立(四邻无墙)格铺墙(更分散、避免堆成卡点线)。need 随系数降低。
      var wd = (typeof config.wallDisperse === 'number') ? Math.max(0, Math.min(1, config.wallDisperse)) : 0.6;
      var looseNeed = extraBlack * (2 - wd);   // wd=0→×2(原严格) wd=1→×1(尽量只用孤立格)
      var blackCand = (looseCand.length >= looseNeed) ? looseCand : looseCand.concat(tightCand);
      var blackSel = pickDispersed(blackCand, extraBlack * 2, 2);
      var placedBlack = 0;
      for (var bs = 0; bs < blackSel.length && placedBlack < extraBlack; bs++) {
        var bcell = blackSel[bs];
        if (cells[bcell.r][bcell.c] != null) continue;
        if (wouldViolateWall(cells, rows, cols, bcell.r, bcell.c)) continue; // 形态约束(2×2/直线>3)
        cells[bcell.r][bcell.c] = { t: 'black' };
        if (!nullCellsReachable(cells, rows, cols)) { cells[bcell.r][bcell.c] = null; continue; } // 破坏可达则撤销
        placedBlack++;
      }
    }

    // ===== 铺盒到棋盘骨架（此时尺寸/黑块/墙/管道骨架已就绪）=====
    // list：盒序列，_seq = 基础消除顺序(baseFillBoxes 的 elimSeq 优先，否则数组下标)。
    var list = [];
    for (var bi = 0; bi < boxes.length; bi++) list.push({ color: boxes[bi].color, count: boxes[bi].count, _seq: (boxes[bi].elimSeq != null ? boxes[bi].elimSeq : bi) });

    var singlePct = (typeof config.singleColorExtractPercent === 'number') ? config.singleColorExtractPercent : 5;
    var firstMult = (typeof config.firstRowRangeMultiplier === 'number') ? config.firstRowRangeMultiplier : 1;
    var nextMult = (typeof config.nextRowRangeMultiplier === 'number') ? config.nextRowRangeMultiplier : 1.1;

    function isEmptyPlaceable(r, c) { return cells[r][c] == null; }
    function placeBox(r, c, b) { cells[r][c] = { t: 'box', color: b.color, count: b.count, ice: 0, chain: 0, q: false, _seq: b._seq }; }

    if (config.baseFillByElimOrder !== false) {
      // ===== 基础填球：按消除顺序(_seq)逐行左→右【单扫】填入；每格只扫一遍 =====
      // elimSeq 小(消除趋势靠前=目标图底部先消)的盒放棋盘顶部/先可达处；蚂蚁从首行取 → 先放先取先消。
      // 遇空格/管道出口→放普通盒；遇【管道本体】→ 填入其队列 1 个(单扫每格1次，故每管首遍恰得1个，必不满)。
      list.sort(function (a, b) { return a._seq - b._seq; });
      var fi = 0;
      for (var frow = 0; frow < rows && fi < list.length; frow++) {
        for (var fcol = 0; fcol < cols && fi < list.length; fcol++) {
          var fcell = cells[frow][fcol];
          if (fcell == null) { placeBox(frow, fcol, list[fi++]); }
          else if (fcell.t === 'pipe') { fcell.queue.push({ color: list[fi].color, count: list[fi].count }); fi++; }
        }
      }
      list = list.slice(fi);   // 空位+管道各首遍1个后仍剩的盒 → 第二遍均匀填管道(下方)
      // 注：基础阶段不做任何换球/换位扰动(v86 起)——保持纯粹的消除顺序铺盒；换球只在【卡点B支】(chokeSwap)定向执行。
    } else {
      // ===== 旧：交错随机铺盒（对齐 bin 毛线 generateBaseElements）=====
      // 1) 单色抽取(~singlePct%)：把富余色的少量盒随机散布全盘 → 制造交错/暂存压力
      var colorCnt = {};
      for (var i0 = 0; i0 < list.length; i0++) colorCnt[list[i0].color] = (colorCnt[list[i0].color] || 0) + 1;
      var extract = [];
      for (var colorId in colorCnt) {
        if (colorCnt[colorId] <= 3) continue;
        var take = Math.ceil(colorCnt[colorId] * singlePct / 100);
        var idxs = [];
        for (var li = 0; li < list.length; li++) if (list[li].color === parseInt(colorId, 10)) idxs.push(li);
        for (var t = 0; t < take && idxs.length > 0; t++) {
          var pickI = Math.floor(Math.random() * idxs.length);
          var listIndex = idxs[pickI];
          extract.push(list[listIndex]);
          list.splice(listIndex, 1);
          idxs.splice(pickI, 1);
          for (var q = 0; q < idxs.length; q++) if (idxs[q] > listIndex) idxs[q]--;
        }
      }
      if (extract.length > 0) {
        shuffle(extract);
        var allEmpty = [];
        for (var er = 0; er < rows; er++) for (var ec = 0; ec < cols; ec++) if (isEmptyPlaceable(er, ec)) allEmpty.push({ r: er, c: ec });
        shuffle(allEmpty);
        while (extract.length > 0 && allEmpty.length > 0) { var pos = allEmpty.shift(); placeBox(pos.r, pos.c, extract.shift()); }
        while (extract.length > 0) list.push(extract.shift()); // 放不下退回 list
      }

      // 2) 逐行(自顶向下)从 list 前部候选窗口随机取盒放置；窗口随行放大(×mult)
      var prevRemainder = 0;
      for (var elRow = 0; elRow < rows && list.length > 0; elRow++) {
        var emptyPos = [];
        for (var cc = 0; cc < cols; cc++) if (isEmptyPlaceable(elRow, cc)) emptyPos.push({ r: elRow, c: cc });
        if (emptyPos.length === 0) { prevRemainder = 0; continue; }
        var range = elRow === 0 ? Math.ceil(emptyPos.length * firstMult)
                                : Math.ceil(emptyPos.length * nextMult) + prevRemainder;
        var pr = pickFromCandidateRange(list, range, emptyPos.length);
        prevRemainder = pr.remainder;
        shuffle(emptyPos);
        for (var pi = 0; pi < pr.picked.length; pi++) placeBox(emptyPos[pi].r, emptyPos[pi].c, pr.picked[pi]);
      }
    }

    // 3) 溢出盒 → 管道：按 _seq 升序【均匀】分配，每管上限6(首遍已各1)；全满仍剩则均匀超载(管道数不足的兜底)
    if (list.length > 0 && pipeList.length > 0) {
      list.sort(function (a, b) { return a._seq - b._seq; });
      var PIPE_CAP = 6, li2 = 0;
      // 阶段一：在 ≤PIPE_CAP 约束下均匀 round-robin（避免堆到少数管道 → 消除单管畸深）
      var guard2 = list.length + pipeList.length + 2;
      while (li2 < list.length && guard2-- > 0) {
        var anyRoom = false;
        for (var pj = 0; pj < pipeList.length && li2 < list.length; pj++) {
          var pq = cells[pipeList[pj].r][pipeList[pj].c].queue;
          if (pq.length < PIPE_CAP) { pq.push({ color: list[li2].color, count: list[li2].count }); li2++; anyRoom = true; }
        }
        if (!anyRoom) break;
      }
      // 阶段二：所有管道已达上限仍有剩 = 管道实际放置数 < 守恒目标 → 均匀超载，避免单管畸深
      var pj2 = 0;
      while (li2 < list.length) {
        cells[pipeList[pj2].r][pipeList[pj2].c].queue.push({ color: list[li2].color, count: list[li2].count });
        li2++; pj2 = (pj2 + 1) % pipeList.length;
      }
      list = []; // 已全部入管道，清空 → 避免 packFull(3.5) 重复入队导致球数翻倍
    } else if (list.length > 0) {
      // 无管道兜底：填任意空位
      for (var fr = rows - 1; fr >= 0 && list.length > 0; fr--)
        for (var fc = 0; fc < cols && list.length > 0; fc++)
          if (isEmptyPlaceable(fr, fc)) placeBox(fr, fc, list.shift());
    }

    // 3.5) 填满棋盘(packFull)：残余空格 → 先用剩余盒填，仍有空格则转黑块(校验可达)，消除空洞。
    if (config.packFull) {
      for (var qr = 0; qr < rows && list.length > 0; qr++)
        for (var qc = 0; qc < cols && list.length > 0; qc++)
          if (isEmptyPlaceable(qr, qc)) placeBox(qr, qc, list.shift());
      // 仍有盒(管道也满/无) → 尽量塞入任一管道队列，避免丢盒
      if (list.length > 0 && pipeList.length > 0) {
        for (var lk = 0; lk < list.length; lk++)
          cells[pipeList[lk % pipeList.length].r][pipeList[lk % pipeList.length].c].queue.push({ color: list[lk].color, count: list[lk].count });
        list = [];
      }
      // 残余空洞 → 黑块(遵循形态约束+不在第0/末行+不破坏可达)；封顶总黑块≤45%格。
      var blackCapFull = Math.floor(rows * cols * 0.45);
      for (var hr = 1; hr < rows - 1; hr++) for (var hc = 0; hc < cols; hc++) {
        if (cells[hr][hc] == null) {
          if (countCellsOfType(cells, 'black') >= blackCapFull) break;
          if (wouldViolateWall(cells, rows, cols, hr, hc)) continue;   // 形态约束(2×2/直线>3)
          cells[hr][hc] = { t: 'black' };
          if (!isAllBoxesReachable(cells, rows, cols)) cells[hr][hc] = null; // 破坏可达则保留为空(极少)
        }
      }
    }

    // ===== 窄路"推理陷阱"：把部分【早序】盒调到墙下(被 gated)区域 =====
    // 机制：墙下区域仅经缺口可达且缺口加冰锁住 → 早色所需的盒被暂时锁在墙下，
    // 玩家被迫先取墙上方的【晚序】盒(其色此刻多不可消) → 暂存累积 → 必须推理"先腾暂存/推进解冻再开缺口"。
    if (config.narrowPath && config.narrowPathTrap !== false && narrowGaps.length > 0) {
      applyNarrowTrap(cells, rows, cols, narrowGaps, config);
    }

    // 窄路缺口加冰(durability=3)：临时锁住唯一通道，玩家须先在墙上方腾挪(推进解冻)再下探。
    // 在 placeBoardObstacles 之前设置，使问号放置自动避开缺口(保持缺口语义清晰)。
    if (config.narrowPath && config.narrowPathIce !== false) {
      for (var ngi = 0; ngi < narrowGaps.length; ngi++) {
        var gcell = cells[narrowGaps[ngi].r][narrowGaps[ngi].c];
        if (gcell && gcell.t === 'box') gcell.ice = 3;
      }
    }

    // 缺口锁链(横竖/三连)：用锁链辅助阻拦喉口。成员只取【墙带及以上】(r<=缺口行)的盒，
    // 避免把锁链成员放到墙下(需先开缺口才能激活 → 死锁)。锁链组号用高位(90+)避免与常规链冲突。
    if (config.narrowPath && config.narrowPathChain !== false && narrowGaps.length > 0) {
      var dirs8 = [[-1,0],[0,-1],[0,1]]; // 正交(上/左/右)，不含斜向、不含正下(避免拉入墙下)
      var chGroup = 90, chained = {};
      for (var cgi = 0; cgi < narrowGaps.length; cgi++) {
        var g = narrowGaps[cgi];
        var gc0 = cells[g.r][g.c];
        if (!gc0 || gc0.t !== 'box' || chained[g.r + ',' + g.c]) continue;
        var members = [{ r: g.r, c: g.c }];
        var size = (Math.random() < 0.5) ? 3 : 2;
        var guard = 0;
        while (members.length < size && guard++ < 20) {
          var grew = false;
          for (var mi = 0; mi < members.length && !grew; mi++) {
            var order = shuffle(dirs8.slice());
            for (var d = 0; d < order.length; d++) {
              var nr = members[mi].r + order[d][0], nc = members[mi].c + order[d][1];
              if (nr < 0 || nr > g.r || nc < 0 || nc >= cols) continue;   // 只在墙带及以上
              var ncell = cells[nr][nc];
              if (!ncell || ncell.t !== 'box' || chained[nr + ',' + nc]) continue;
              var dup = false;
              for (var mm = 0; mm < members.length; mm++) if (members[mm].r === nr && members[mm].c === nc) { dup = true; break; }
              if (dup) continue;
              members.push({ r: nr, c: nc }); grew = true; break;
            }
          }
          if (!grew) break;
        }
        if (members.length >= 2 && !chainGroupConflict(cells, rows, cols, members, chGroup) && chainActivatable(cells, rows, cols, members)) { // 不同组不相邻 + 全成员可激活(防结构卡死)
          for (var mk = 0; mk < members.length; mk++) { cells[members[mk].r][members[mk].c].chain = chGroup; chained[members[mk].r + ',' + members[mk].c] = true; }
          chGroup++;
        }
      }
    }

    // ===== 输出前确保棋盘填满：未填满则强制减少最末行、多余球补充为管道 =====
    var ef = ensureBoardFull(cells, rows, cols, pipeList);
    rows = ef.rows; cols = ef.cols; cells = ef.cells;

    // 铺盒阶段的临时 _seq 标记清除（不写入关卡数据）
    for (var sr = 0; sr < rows; sr++) for (var sc = 0; sc < cols; sc++) {
      if (cells[sr][sc] && cells[sr][sc].t === 'box') delete cells[sr][sc]._seq;
    }

    placeBoardObstacles(cells, rows, cols, config);

    // 顶部 1-3 行(索引0/1/2)障碍密度封顶（默认≤20%）：优先清 问号→冰→锁链整组→黑块转空，管道不动
    enforceTopObstacleCap(cells, rows, cols, config);

    // 清除孤立锁链：chain 值仅 1 个成员的盒无互锁语义（求解器 chainGroups 只收≥2组，孤立会致 listMoves 崩）
    //   → 降级为普通盒；同时避免导出到程序端出现"单成员共链"歧义。
    var chainCnt = {};
    for (var ccr = 0; ccr < rows; ccr++) for (var ccc = 0; ccc < cols; ccc++) {
      var cbox = cells[ccr][ccc];
      if (cbox && cbox.t === 'box' && cbox.chain > 0) chainCnt[cbox.chain] = (chainCnt[cbox.chain] || 0) + 1;
    }
    for (var dcr = 0; dcr < rows; dcr++) for (var dcc = 0; dcc < cols; dcc++) {
      var dbox = cells[dcr][dcc];
      if (dbox && dbox.t === 'box' && dbox.chain > 0 && chainCnt[dbox.chain] < 2) dbox.chain = 0;
    }

    // 注：换球已移至 generateFromBlocks 的【解后处理】(applyRegionSwaps)——
    // 需先跑全知求解器得到 pickOrder(每步取的棋盘盒)才能按进度%圈定换球区域。

    return { rows: rows, cols: cols, cells: cells };
  }

  /* ==================================================================
   * ===== 纠偏版结构候选流程（R01-R07）=====
   * 本段为【新增】函数，上方旧函数(buildBoard/generateFromBlocks/produce/makeChokeVariant …)
   * 全部原样保留、不删不改，供新旧对照与回退。新版入口：produceFixed / generateFromBlocksFixed。
   *
   * 修正的调用顺序（需求 §二）：
   *   盒序列与盒总量预算 → 棋盘行列 → 窄路墙黑块 → 分散黑块(全部实际落位)
   *   → 按【实际剩余空间】算预算管道并落位 → 冰块预定位置 → 问号预定位置 → 锁链组预定位置
   *   → 不带球的结构候选 → 不依赖颜色的结构检查 → 按消除依赖顺序填球
   *   → 把预定冰/问号/锁链【绑定】到真实盒(不再随机重选) → 独立守恒检查 → 1+3 求解筛选
   * ================================================================== */

  // ---- R02：分散黑块真实落位（在管道之前执行，并返回真实落位统计） ----
  /**
   * @returns {{planned:number, placed:number, shapeRejected:number, reachRejected:number, coords:Array}}
   */
  function placeDispersedBlackReal(cells, rows, cols, extraBlack, gapProtect, config) {
    var stat = { planned: extraBlack, placed: 0, shapeRejected: 0, reachRejected: 0, coords: [] };
    if (extraBlack <= 0) return stat;
    function wallNbrCount(r, c) {
      var k = 0, dd = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      for (var i = 0; i < 4; i++) if (isWallAt(cells, rows, cols, r + dd[i][0], c + dd[i][1])) k++;
      return k;
    }
    var looseCand = [], tightCand = [];
    for (var br = 1; br < rows - 1; br++) for (var bc = 0; bc < cols; bc++) {
      if (cells[br][bc] == null && !gapProtect[br + ',' + bc]) {
        if (wallNbrCount(br, bc) === 0) looseCand.push({ r: br, c: bc });
        else tightCand.push({ r: br, c: bc });
      }
    }
    var wd = (typeof config.wallDisperse === 'number') ? Math.max(0, Math.min(1, config.wallDisperse)) : 0.6;
    var looseNeed = extraBlack * (2 - wd);
    var cand = (looseCand.length >= looseNeed) ? looseCand : looseCand.concat(tightCand);
    var sel = pickDispersed(cand, extraBlack * 2, 2);
    for (var s = 0; s < sel.length && stat.placed < extraBlack; s++) {
      var p = sel[s];
      if (cells[p.r][p.c] != null) continue;
      if (wouldViolateWall(cells, rows, cols, p.r, p.c)) { stat.shapeRejected++; continue; }
      cells[p.r][p.c] = { t: 'black' };
      if (!nullCellsReachable(cells, rows, cols)) { cells[p.r][p.c] = null; stat.reachRejected++; continue; }
      stat.placed++; stat.coords.push({ r: p.r, c: p.c });
    }
    return stat;
  }

  /** 把多余空格(盒不够填满时)转成黑块，保证结构候选本身就是满盘（避免填球后裁行使预定坐标失效）。 */
  function fillSurplusWithBlack(cells, rows, cols, surplus, gapProtect) {
    var stat = { need: surplus, filled: 0, coords: [] };
    if (surplus <= 0) return stat;
    var cap = Math.floor(rows * cols * 0.45);
    var cand = [];
    for (var r = 1; r < rows - 1; r++) for (var c = 0; c < cols; c++) {
      if (cells[r][c] == null && !gapProtect[r + ',' + c]) cand.push({ r: r, c: c });
    }
    var sel = pickDispersed(cand, cand.length, 2);
    for (var i = 0; i < sel.length && stat.filled < surplus; i++) {
      var p = sel[i];
      if (cells[p.r][p.c] != null) continue;
      if (countCellsOfType(cells, 'black') >= cap) break;
      if (wouldViolateWall(cells, rows, cols, p.r, p.c)) continue;
      cells[p.r][p.c] = { t: 'black' };
      if (!nullCellsReachable(cells, rows, cols)) { cells[p.r][p.c] = null; continue; }
      stat.filled++; stat.coords.push({ r: p.r, c: p.c });
    }
    return stat;
  }

  /**
   * 选棋盘行列（纠偏版）：先随机列，再在行范围内优先选【可用普通格 ≤ 盒总数】的行，
   * 使结构候选天然满盘并留出溢出给管道；无满足项则退回全行范围随机（由多余空格转黑块兜底）。
   */
  /**
   * 形态硬约束（2026-07-31）：棋盘必须【列数 > 行数】且【列-行 ∈ {1,2}】。
   * 不允许行列相等、行多于列、或列比行多 3 格及以上。
   */
  function boardShapeOk(rows, cols) {
    var d = cols - rows;
    return d >= 1 && d <= 2;
  }

  /**
   * 按【实际盒数 n】与【目标黑块比例】选棋盘（2026-07-31 重写）。
   *
   * 要解决的问题：原实现在「所有候选棋盘都比盒数需要的容量大」时，会退到全组合随机挑一个，
   * 多出来的空格随后被 fillSurplusWithBlack 全部补成黑块，导致最终黑块远超 blackPercent
   * （实测样例：57 盒选到 9×9 → 黑块 24/81 = 29.6%，而参数只要求 10%）。
   *
   * 现在的口径（ov = n - (cap - blackTarget)，即盒数相对「可放盒容量」的溢出）：
   *   ov >= 0 → 盒能填满棋盘，多出来的盒进管道，【不产生余格黑块】，最终黑块 ≈ blackPercent；
   *   ov <  0 → 棋盘偏大，|ov| 个余格会被补成黑块，最终黑块超标。
   * 因此选择顺序为：
   *   ① 形态合法且 ov 落在 [0, pipeRoom] 的候选（正好填满或小幅溢出进管道）——按 ov 小者优先，
   *      避免把几十个盒全丢进管道（管道单条深度有限，会撞 pipeCapacity 失败）；
   *   ② 形态合法且 ov > pipeRoom 的候选——溢出偏多，按 ov 小者优先；
   *   ③ 形态合法但 ov < 0 的候选——会产生余格黑块，按 |ov| 小者优先（黑块超标最少）；
   *   ④ 上述在【方案给定行列范围内】都不存在时，才允许【向下缩小】到范围外继续找，
   *      缩小候选同样必须满足形态硬约束；
   *   ⑤ 实在没有合法形态可用时，退回原行为（范围内随机），并置 shapeRelaxed 标记，
   *      由调用方与报告如实体现，不静默假装合规。
   *
   * 只改「选哪个棋盘」，不改障碍参数、不改盒容量、不在事后删黑块或裁棋盘。
   */
  /**
   * 可用棋盘空间一致性求解（用户 2026-08-04 定义）。
   *
   * 定义：可用空间 U = (总格 C − 墙B − 管道占位P) / C
   * 目的：同一批像素图能生成不同大小的棋盘，而各尺寸的可用空间保持一致（可上下浮动若干个百分点）。
   *
   * 联立推导（全部是守恒，不靠试错）：
   *   占用配额 K = B + P = round(C × (1 − U))        ← 由目标可用空间直接确定
   *   上盘盒格 = C − K，故溢出盒 D = n − (C − K) = n − C + K
   *   每条管道容量 pipeMinFill~pipeMaxDepth 个盒
   *     → P ∈ [⌈D/pipeMaxDepth⌉, ⌊D/pipeMinFill⌋]，同时受管道数下限 minPipes 约束
   *   黑块 B = K − P，需落在「障碍参数容差」内
   *
   * 降级顺序（用户指定）：优先保持障碍参数 → 不行则突破黑块比例，突破预算 2 次、每次 5 个百分点
   * （最大突破 10 个百分点，用于保护小棋盘：小棋盘必须靠突破黑块下限才能达到一致比例），
   * 硬上限 25% 始终生效。
   *
   * 【管道兜底】(任务 ANT-GEN-PIPE-DEPTH-FALLBACK-20260825，用户 2026-08-25 批准)
   *   上面这套联立里有一条容易被忽略的硬约束：minPipes 条管道要求 D ≥ minPipes × pipeMinFill。
   *   08-25 实测：方案_v104 的 minPipes=4 + pipeMinFill=4 需要 D≥16，而该批源图只产出 D=2~8，
   *   于是【每一个尺寸都无解】→ 53 张过闸源图 0 产出。
   *   因此按 minPipes 求不出解时，再用「保底 pipeFallbackCount 条管道、每管目标 pipeFallbackDepth 个盒」
   *   解一轮；命中则带 pipeFallback 标记返回，不静默。pipeFallbackCount=0 关闭兜底（回到原行为）。
   *   兜底路径同样受守恒硬约束 D ≤ P × pipeMaxDepth 限制，装不下仍返回 ok:false。
   *
   * 两轮都无解 → 返回 ok:false，由调用方淘汰该尺寸
   * （再往下就只能切分盒容量改变盒数，那属于参数层决策，不在本函数内偷偷做）。
   */
  function solveSpaceQuota(n, rows, cols, config) {
    var target = parseFloat(config.usableSpaceTarget);
    if (!(target > 0 && target < 1)) return null;          // 未开启 → 走原逻辑
    var C = rows * cols;
    var minPipes = Math.max(1, parseInt(config.minPipes, 10) || 1);
    var maxDepth = pipeDepthOf(config);
    var minFill = pipeMinFillOf(config);
    var center = (config.blackPercent || 0) / 100;
    var baseTolPp = (config.usableSpaceBlackTolPp != null) ? config.usableSpaceBlackTolPp : 5;
    var stepPp = (config.usableSpaceBreachStepPp != null) ? config.usableSpaceBreachStepPp : 5;
    var budget = (config.usableSpaceBreachBudget != null) ? config.usableSpaceBreachBudget : 2;
    var K = Math.round(C * (1 - target));
    var D = n - C + K;                                     // 溢出盒（守恒结果，可能 ≤0）

    // 一轮求解：给定「管道数下限 pMinReq」与「每管最少装 fill 个盒」，找可行 (P,B)。
    //   口径统一为 D ≥ P × fill（保守读法，与 P ≤ ⌊D/fill⌋ 同一件事）。
    //   不再有「放行更浅管道」的松弛——用户 2026-08-25 已给出绝对下限，见下面的阶梯。
    function trySolve(pMinReq, fill) {
      if (D <= 0) return null;            // 盒都装得下 → 不需要管道，由 P=0 分支处理
      for (var lvl = 0; lvl <= budget; lvl++) {
        var tol = (baseTolPp + stepPp * lvl) / 100;
        var bMin = Math.max(0, Math.ceil(C * (center - tol)));
        var bMax = Math.min(Math.floor(C * (center + tol)), Math.floor(C * 0.25));
        var pLo = Math.max(pMinReq, Math.ceil(D / maxDepth));
        var pHi = Math.floor(D / fill);
        for (var P = pLo; P <= pHi; P++) {
          var B = K - P;
          if (B < 0) continue;
          if (B >= bMin && B <= bMax) {
            return {
              ok: true, blackTarget: B, pipeWant: P, quota: K,
              overflow: Math.max(0, D), breachLevel: lvl,
              usable: (C - B - P) / C, blackPct: C > 0 ? B / C : 0,
              minFillUsed: fill
            };
          }
        }
      }
      return null;
    }

    // ── 无管道解（P=0）：把管道要占的格全让给盒 ──
    //   用户 2026-08-25：「如果低于这个下限就直接去除管道」。
    //   守恒推导：P=0 时上盘盒格 = C − B，要装下全部 n 个盒需 B ≤ C − n，即 B = K − D 恰好够
    //   （代回 D_new = n − (C − K + D) = 0，一个盒都不会掉）。
    //   代价是墙少了 D 个 → 可用空间比目标高 D/C；超过可用空间容差则不能用，如实返回无解。
    function trySolveNoPipe() {
      var uTolPp = (config.usableSpaceTolPp != null) ? config.usableSpaceTolPp : 5;
      // 墙数上界有两条：
      //   ① 全部盒必须上得了盘 → C − B ≥ n → B ≤ C − n；
      //   ② 黑块比例容差与 25% 硬上限 → B ≤ bMax（随突破级别放宽）。
      // 取尽量接近配额 K 的 B（偏差最小），但不得越过这两条上界。
      //   注意不能把 B 固定成 K−D：D≤0 时 K 可能本身就超过黑块 25% 硬上限
      //   （原先那 P 条管道占的是"非墙"的占位额度），固定 B=K 会让所有 D≤0 的尺寸全判无解。
      var Bcap = Math.min(K, C - n);
      if (Bcap < 0) return null;                        // 连墙全拆都装不下 → 该尺寸无解
      for (var lvl = 0; lvl <= budget; lvl++) {
        var tol = (baseTolPp + stepPp * lvl) / 100;
        var bMin = Math.max(0, Math.ceil(C * (center - tol)));
        var bMax = Math.min(Math.floor(C * (center + tol)), Math.floor(C * 0.25));
        var B = Math.min(Bcap, bMax);
        if (B < bMin) continue;                         // 墙太少、低于比例下限 → 放宽一级再试
        var devPp = Math.abs((C - B) / C - target) * 100;
        if (devPp > uTolPp) continue;                   // 可用空间偏离超容差 → 放宽一级再试
        return {
          ok: true, blackTarget: B, pipeWant: 0, quota: K,
          overflow: 0, breachLevel: lvl,
          usable: (C - B) / C, blackPct: C > 0 ? B / C : 0,
          minFillUsed: 0,
          pipeDropped: true, pipeDroppedDevPp: +devPp.toFixed(2),
          pipeDroppedBoxCells: C - B, pipeDroppedBoxNeed: n
        };
      }
      return null;
    }

    // ── 管道阶梯（用户 2026-08-25 两次裁决合并）──
    //   ① 主轮：minPipes 条 / 每管 ≥ pipeMinFill(默认4)
    //   ② 兜底：pipeFallbackCount 条(默认2) / 每管 ≥ pipeFallbackDepth(默认3)
    //   ③ 绝对下限：pipeFloorCount 条(默认2) / 每管 ≥ pipeFloorDepth(默认2)
    //   ④ 连绝对下限都到不了 → 【直接去除管道】(P=0)，管道格全让给盒
    //   D ≤ 0（棋盘本来就装得下所有盒）直接走 ④：硬塞管道只会得到装不满 2 层的空管道，
    //   按用户口径就该去掉。这一条改变了 v104 的行为（v104 会给 minPipes 条空管道）。
    var fbCount = (config.pipeFallbackCount != null) ? parseInt(config.pipeFallbackCount, 10) : 2;
    var fbDepth = (config.pipeFallbackDepth != null) ? parseInt(config.pipeFallbackDepth, 10) : 3;
    var flCount = (config.pipeFloorCount != null) ? parseInt(config.pipeFloorCount, 10) : 2;
    var flDepth = (config.pipeFloorDepth != null) ? parseInt(config.pipeFloorDepth, 10) : 2;
    if (!(fbDepth > 0)) fbDepth = 1;
    if (fbDepth > maxDepth) fbDepth = maxDepth;
    if (!(flDepth > 0)) flDepth = 1;
    if (flDepth > maxDepth) flDepth = maxDepth;

    // 【完整回退开关】两级降级都关掉（pipeFallbackCount=0 且 pipeFloorCount=0）时，
    //   连"去除管道"也不做，逐值回到 v104 及以前的行为——供复现旧批次用。
    //   旧行为的 D≤0 分支是「盒都装得下 → 管道取下限 minPipes 条」（会出现装不满的空管道）。
    var laddering = fbCount > 0 || flCount > 0;
    if (!laddering) {
      if (D <= 0) {
        for (var lv0 = 0; lv0 <= budget; lv0++) {
          var tol0 = (baseTolPp + stepPp * lv0) / 100;
          var bMin0 = Math.max(0, Math.ceil(C * (center - tol0)));
          var bMax0 = Math.min(Math.floor(C * (center + tol0)), Math.floor(C * 0.25));
          var B0 = K - minPipes;
          if (B0 >= 0 && B0 >= bMin0 && B0 <= bMax0) {
            return {
              ok: true, blackTarget: B0, pipeWant: minPipes, quota: K,
              overflow: 0, breachLevel: lv0,
              usable: (C - B0 - minPipes) / C, blackPct: C > 0 ? B0 / C : 0,
              minFillUsed: minFill
            };
          }
        }
      } else {
        var rL = trySolve(minPipes, minFill);
        if (rL) return rL;
      }
      return {
        ok: false, quota: K, overflow: D,
        reason: '两级管道降级均已关闭(pipeFallbackCount=0 且 pipeFloorCount=0，旧行为口径)；' +
          '守恒下限：' + minPipes + ' 条管道需溢出盒 D ≥ ' + (minPipes * minFill) + '，当前 D=' + D
      };
    }

    var r = trySolve(minPipes, minFill);
    if (r) return r;

    if (fbCount > 0 && fbCount <= minPipes) {
      var rf = trySolve(fbCount, fbDepth);
      if (rf) {
        rf.pipeFallback = true;
        rf.pipeFallbackFrom = minPipes;
        rf.pipeFallbackTo = fbCount;
        rf.pipeFallbackTier = 'fallback';
        return rf;
      }
    }
    if (flCount > 0) {
      var rl = trySolve(flCount, flDepth);
      if (rl) {
        rl.pipeFallback = true;
        rl.pipeFallbackFrom = minPipes;
        rl.pipeFallbackTo = flCount;
        rl.pipeFallbackTier = 'floor';      // 已用到绝对下限（默认 2 条 × 2 层）
        return rl;
      }
    }
    var rn = trySolveNoPipe();
    if (rn) return rn;

    return {
      ok: false, quota: K, overflow: D,
      reason: '管道阶梯全轮无解：主轮(' + minPipes + '条/每管≥' + minFill + ')' +
        (fbCount > 0 ? ' → 兜底(' + fbCount + '条/≥' + fbDepth + ')' : '') +
        (flCount > 0 ? ' → 绝对下限(' + flCount + '条/≥' + flDepth + ')' : '') +
        ' → 去除管道(P=0) 均不可行。' +
        '守恒下限：P 条管道需溢出盒 D ≥ P×每管最少；当前 D=' + D + '，配额 K=' + K +
        '；P=0 需墙降到 ' + (K - Math.max(0, D)) + ' 且可用空间偏差 ≤ ' +
        (config.usableSpaceTolPp != null ? config.usableSpaceTolPp : 5) + 'pp'
    };
  }

  function chooseBoardDimsFixed(n, config) {
    var rMin = clampInt(config.boardRowsMin, AntSolver.BOARD_ROWS, 3, 20);
    var rMax = clampInt(config.boardRowsMax, AntSolver.BOARD_ROWS, rMin, 20);
    var cMin = clampInt(config.boardColsMin, AntSolver.BOARD_COLS_MIN, 3, 30);
    var cMax = clampInt(config.boardColsMax, AntSolver.BOARD_COLS_MAX, cMin, 30);
    var bp = config.blackPercent || 0;
    // 允许进管道的溢出上限：管道条数未定时按经验给一个温和的窗口，
    // 目的只是「别把几十个盒全推进管道」，真正的管道容量仍由后续 pipeCapacity 检查把关。
    var pipeRoom = Math.max(3, Math.round(n * 0.25));
    // 管道数下限 → 溢出盒下限（按每管容量区间的中值反推；0 = 不约束，原行为）
    //   原为写死的 minPipes*5，5 是 (4+6)/2；深度参数化后改为按实际区间取中值，
    //   默认 pipeMinFill=4 / pipeMaxDepth=6 时结果仍是 5，与参数引入前等价。
    var minPipes = parseInt(config.minPipes, 10) || 0;
    var minOv = minPipes > 0 ? minPipes * Math.ceil((pipeMinFillOf(config) + pipeDepthOf(config)) / 2) : 0;
    // ===== 可用空间一致性优先（用户 2026-08-04）=====
    // 开启目标可用空间后，尺寸的取舍标准就变成「该尺寸能否解出满足目标比例的(管道,黑块)组合」，
    // 而不再是原来的「溢出多少」。在所有有解的尺寸里【随机取一个】——这正是用户要的
    // 「同一批像素图生成出不同大小的棋盘」；无解的尺寸直接排除，不做勉强适配。
    if (parseFloat(config.usableSpaceTarget) > 0) {
      var feasibleDims = [];
      for (var fr = rMin; fr <= rMax; fr++) {
        for (var fc = cMin; fc <= cMax; fc++) {
          if (!boardShapeOk(fr, fc)) continue;
          var q = solveSpaceQuota(n, fr, fc, config);
          if (q && q.ok) feasibleDims.push({ rows: fr, cols: fc, q: q });
        }
      }
      if (feasibleDims.length) {
        var fpick = feasibleDims[Math.floor(Math.random() * feasibleDims.length)];
        var fq = fpick.q, fcap = fpick.rows * fpick.cols;
        return {
          rows: fpick.rows, cols: fpick.cols,
          fitted: true, pipeBiased: fq.pipeWant >= 3,
          spaceQuota: fq,                       // 供结构候选层按配额落位黑块与管道
          boardPick: {
            tier: 'usableSpace', cap: fcap, boxCount: n,
            blackTarget: fq.blackTarget, surplusToBlack: 0,
            finalBlack: fq.blackTarget, finalBlackPct: Math.round(fq.blackPct * 1000) / 10,
            shrinkUsed: false, shapeRelaxed: false,
            shapeDiff: fpick.cols - fpick.rows,
            rangeGiven: { rowsMin: rMin, rowsMax: rMax, colsMin: cMin, colsMax: cMax },
            // 可用空间自适应的诊断信息（供报告与验证如实展示）
            usableTarget: parseFloat(config.usableSpaceTarget),
            usableActual: Math.round(fq.usable * 1000) / 10,
            quota: fq.quota, pipeWant: fq.pipeWant, overflow: fq.overflow,
            blackBreachLevel: fq.breachLevel,     // 0=未突破，1/2=用掉的突破预算次数
            feasibleDimCount: feasibleDims.length
          }
        };
      }
      // 一个可行尺寸都没有 → 落回原逻辑，并由结构候选层与验证脚本如实暴露（不静默假装达标）
    }

    function evalPair(rr, cc) {
      var cap = rr * cc;
      var bt = Math.min(Math.floor(cap * bp / 100), Math.floor(cap * 0.25));
      var ov = n - (cap - bt);
      var surplus = ov < 0 ? -ov : 0;
      return {
        rows: rr, cols: cc, cap: cap, blackTarget: bt, ov: ov, surplus: surplus,
        finalBlack: bt + surplus,
        finalBlackPct: cap > 0 ? (bt + surplus) / cap * 100 : 0
      };
    }

    // ---- 收集候选：先方案范围内，再（必要时）向下缩小 ----
    var inRange = [], shrunk = [], anyInRange = [];
    var rr, cc, e;
    for (rr = rMin; rr <= rMax; rr++) {
      for (cc = cMin; cc <= cMax; cc++) {
        e = evalPair(rr, cc);
        anyInRange.push(e);
        if (boardShapeOk(rr, cc)) inRange.push(e);
      }
    }
    // 向下缩小候选：行从 rMin-1 一直缩到 3，列只取 行+1 / 行+2（天然满足形态约束）
    for (rr = rMin - 1; rr >= 3; rr--) {
      for (var d = 1; d <= 2; d++) {
        cc = rr + d;
        if (cc < 3) continue;
        shrunk.push(evalPair(rr, cc));
      }
    }

    // ---- 分档挑选 ----
    function byOvAsc(a, b) { return a.ov - b.ov; }
    function bySurplusAsc(a, b) { return a.surplus - b.surplus || a.ov - b.ov; }
    function pickFrom(list) {
      // ===== 管道数量下限（用户 2026-08-04：管道太少，确保不低于 4 个）=====
      // 管道数由守恒反推：溢出盒 ov 对应管道数 P∈[⌈ov/5⌉,⌊ov/3⌋]，故「P ≥ minPipes」等价于「ov ≥ minPipes×5」。
      // 原逻辑总是在溢出窗口内挑 ov 最小的尺寸（byOvAsc 取首个），这正是管道偏少的原因——
      // 它刻意避免溢出。开启下限后改为：先在「溢出足够撑起 minPipes 条管道」的候选里挑 ov 最小的，
      // 即【刚好够、不过量】，这样既满足下限、又不会把大量盒推进管道破坏手感。
      // 找不到可行尺寸时不硬来，退回原逻辑，由调用方与验证脚本如实暴露（不静默假装达标）。
      if (minOv > 0) {
        var enough = list.filter(function (x) { return x.ov >= minOv; }).sort(byOvAsc);
        if (enough.length) return { e: enough[0], tier: 'minPipes' };
      }
      var good = list.filter(function (x) { return x.ov >= 0 && x.ov <= pipeRoom; }).sort(byOvAsc);
      if (good.length) return { e: good[0], tier: 'fitPipe' };
      var over = list.filter(function (x) { return x.ov > pipeRoom; }).sort(byOvAsc);
      if (over.length) return { e: over[0], tier: 'overflow' };
      var under = list.filter(function (x) { return x.ov < 0; }).sort(bySurplusAsc);
      if (under.length) return { e: under[0], tier: 'surplus' };
      return null;
    }

    var chosen = null, shrinkUsed = false, shapeRelaxed = false;

    // ①②③：方案范围内的合法形态
    var r1 = pickFrom(inRange);
    // 只有「范围内最好的结果仍会产生余格黑块」时，才尝试向下缩小
    if (r1 && r1.tier !== 'surplus') {
      chosen = r1;
    } else {
      var r2 = pickFrom(shrunk);
      if (r2 && r2.tier !== 'surplus') { chosen = r2; shrinkUsed = true; }
      else if (r1) { chosen = r1; }
      else if (r2) { chosen = r2; shrinkUsed = true; }
    }

    // ⑤ 没有任何合法形态可用 → 退回原行为并如实标记
    if (!chosen) {
      var fallback = anyInRange[Math.floor(Math.random() * anyInRange.length)];
      chosen = { e: fallback, tier: 'shapeRelaxed' };
      shapeRelaxed = true;
    }

    var pick = chosen.e;
    return {
      rows: pick.rows, cols: pick.cols,
      // 兼容原有返回字段语义
      fitted: pick.ov >= 0,
      pipeBiased: pick.ov >= 3,
      // 新增诊断字段：供生产报告如实展示「目标黑块 / 实际黑块 / 实际比例 / 是否缩小过棋盘」
      boardPick: {
        tier: chosen.tier, cap: pick.cap, boxCount: n,
        blackTarget: pick.blackTarget, surplusToBlack: pick.surplus,
        finalBlack: pick.finalBlack, finalBlackPct: Math.round(pick.finalBlackPct * 10) / 10,
        shrinkUsed: shrinkUsed, shapeRelaxed: shapeRelaxed,
        shapeDiff: pick.cols - pick.rows,
        rangeGiven: { rowsMin: rMin, rowsMax: rMax, colsMin: cMin, colsMax: cMax }
      }
    };
  }

  // ---- R01：结构阶段预定 iceSlots / questionSlots / chainGroups ----
  /**
   * 在【不带球】的结构候选上规划障碍预定位置。所有位置都指向 null 格(未来盒格)，
   * 不指向黑块/管道本体/盘外，且互斥规则(问号不与锁链叠加)在规划期即满足。
   * 注：此阶段 cells 内没有 box，chainActivatable() 会把所有非本组格当作"已移除"从而恒为 true，
   *     属方法学陷阱，故此处【不调用】它；锁链可激活性统一在绑定后由 structuralDeadlockCheck 把关。
   */
  // ==================== 卡点体系多样化（ANT-GEN-CHOKE-TYPES-20260824） ====================
  // 背景：改动前 applyOneChoke 只有两个分派分支（60% chokeSwap / 40% chokeInflate），
  //   窄路/冰/锁链/问号/管道都是建盘期固定比例铺设、不是卡点分支。实测 344 关结构指纹仅 24 种、
  //   最常见 5 种占 65.7%，问号 329/344 关恰好 4 个，冰块 100% 出现且集中 9~10 个 —— 高度同质。
  // 本轮把「卡点」显式类型化：每关按配额抽取【互不重合】的若干类型，BOSS 与普通关分别配额。
  // 所有类型默认关闭或维持原行为，不改变现有批次可复现性。

  /**
   * 稀有色识别（用户 2026-08-24 q4）。
   * 「稀有」= 该色在目标图上的像素总量占比小。稀有色被卡住时可替代方案最少，
   * 因此把稀有色放到关键位（窄路口/锁链端/管道口）比放常见色更能形成真卡点。
   * 与既有 gatewayColorRank(网关色) / interiorColorRank(埋深) 是**三个不同维度**：
   *   稀有=量少、网关=靠外先可达、埋深=被围在内部。
   * @returns {Array} [{color, pixels, ratio, rank}]，按像素占比升序（越前越稀有）
   */
  function rareColorRank(blocks) {
    if (!blocks || !blocks.length) return [];
    var cnt = {}, total = 0, r, c;
    for (r = 0; r < blocks.length; r++) for (c = 0; c < blocks[r].length; c++) {
      var v = blocks[r][c];
      if (v > 0) { cnt[v] = (cnt[v] || 0) + 1; total++; }
    }
    var out = [];
    for (var k in cnt) out.push({ color: parseInt(k, 10), pixels: cnt[k], ratio: total ? cnt[k] / total : 0 });
    out.sort(function (a, b) { return a.ratio - b.ratio; });
    for (var i = 0; i < out.length; i++) { out[i].rank = i + 1; out[i].ratio = +out[i].ratio.toFixed(5); }
    return out;
  }

  /**
   * 聚集选点：pickDispersed 的对立面。
   * pickDispersed 用"最大化最近距离"把点摊开；本函数先取少量种子（彼此分散），
   * 再在每个种子邻域内就近扩张，从而形成若干团簇。
   * 用于冰块簇/问号簇——同样的数量，聚集后会在局部形成长时间锁死区，压力形态与分散完全不同。
   * @param {Array} cands 候选格 [{r,c}]
   * @param {number} count 需要几个
   * @param {number} seeds 分成几团（<=0 时按 sqrt 自适应）
   */
  function pickClustered(cands, count, seeds) {
    if (count <= 0 || !cands || !cands.length) return [];
    count = Math.min(count, cands.length);
    if (!(seeds > 0)) seeds = Math.max(1, Math.round(Math.sqrt(count) / 1.5));
    seeds = Math.min(seeds, count);
    var seedPts = pickDispersed(cands, seeds, 2);
    if (!seedPts.length) return pickDispersed(cands, count, 1);
    var used = {}, picked = [];
    for (var s = 0; s < seedPts.length; s++) {
      var kk = seedPts[s].r + ',' + seedPts[s].c;
      if (used[kk]) continue;
      used[kk] = 1; picked.push(seedPts[s]);
    }
    // 按「到最近种子的切比雪夫距离」升序补齐 → 天然贴着种子成团
    var rest = [];
    for (var i = 0; i < cands.length; i++) {
      var p = cands[i], key = p.r + ',' + p.c;
      if (used[key]) continue;
      var best = 1e9;
      for (var j = 0; j < seedPts.length; j++) {
        var d = Math.max(Math.abs(p.r - seedPts[j].r), Math.abs(p.c - seedPts[j].c));
        if (d < best) best = d;
      }
      rest.push({ p: p, d: best, jitter: Math.random() });
    }
    rest.sort(function (a, b) { return (a.d - b.d) || (a.jitter - b.jitter); });
    for (var m = 0; m < rest.length && picked.length < count; m++) {
      var q = rest[m].p, k2 = q.r + ',' + q.c;
      if (used[k2]) continue;
      used[k2] = 1; picked.push(q);
    }
    return picked;
  }

  /**
   * 卡点类型清单。每项：key（配置名）、cn（中文名）、stage（作用阶段）。
   *   structure = 建盘/障碍规划期生效（planObstacleSlotsFixed）
   *   post      = 填球后的卡点变体期生效（applyOneChoke 分支）
   */
  var CHOKE_TYPE_LIST = [
    { key: 'iceCluster', cn: '冰块簇聚集', stage: 'structure' },
    { key: 'chainCluster', cn: '锁链簇聚集', stage: 'structure' },
    { key: 'questionCluster', cn: '问号聚集', stage: 'structure' },
    { key: 'chainIce', cn: '冰叠锁链', stage: 'structure' },
    { key: 'pipeChain', cn: '管道口叠锁链', stage: 'structure' },
    { key: 'narrowGapIce', cn: '窄路口叠冰', stage: 'structure' },
    { key: 'narrowGapChain', cn: '窄路口叠锁链', stage: 'structure' },
    { key: 'bigBox', cn: '超大盒', stage: 'post' },
    { key: 'rareColorKey', cn: '稀有色占关键位', stage: 'post' },
    { key: 'swap', cn: '换球/藏管道', stage: 'post' },
    { key: 'inflate', cn: '增容', stage: 'post' }
  ];

  /**
   * 按配额抽取本关使用的卡点类型（用户 2026-08-24 参数化三项要求）。
   *   ① 数量可配：chokeTypeCountNormal / chokeTypeCountBoss
   *   ② 类型不可重合：无放回抽样，同一关不会重复抽到同一类型
   *   ③ BOSS 与普通关分别配额：由 isBoss 选用哪个数量
   * chokeTypes[key] = 权重（0 或缺省 = 该类型不参与抽取）。
   * 全部权重为 0 时返回空数组 → 各处走原有行为，与本功能引入前完全一致。
   * @returns {object} { types:[key...], cn:[中文名...], count, isBoss, pool:候选类型数 }
   */
  function pickChokeTypes(config, isBoss) {
    config = config || {};
    var weights = config.chokeTypes || {};
    var pool = [];
    for (var i = 0; i < CHOKE_TYPE_LIST.length; i++) {
      var t = CHOKE_TYPE_LIST[i], w = weights[t.key];
      if (typeof w === 'number' && w > 0) pool.push({ key: t.key, cn: t.cn, w: w });
    }
    var want = isBoss
      ? (config.chokeTypeCountBoss != null ? config.chokeTypeCountBoss : 0)
      : (config.chokeTypeCountNormal != null ? config.chokeTypeCountNormal : 0);
    want = Math.max(0, Math.min(want, pool.length));
    var chosen = [];
    // 加权无放回抽样：抽中即从池中移除，保证类型不重合
    while (chosen.length < want && pool.length) {
      var sum = 0, j;
      for (j = 0; j < pool.length; j++) sum += pool[j].w;
      if (sum <= 0) break;
      var x = Math.random() * sum, hit = pool.length - 1;
      for (j = 0; j < pool.length; j++) { x -= pool[j].w; if (x <= 0) { hit = j; break; } }
      chosen.push(pool[hit]);
      pool.splice(hit, 1);
    }
    var keys = [], cns = [], map = {};
    for (var k = 0; k < chosen.length; k++) { keys.push(chosen[k].key); cns.push(chosen[k].cn); map[chosen[k].key] = true; }
    return { types: keys, cn: cns, has: map, count: keys.length, isBoss: !!isBoss, pool: keys.length + pool.length };
  }

  function planObstacleSlotsFixed(cells, rows, cols, config, narrowGaps, chokePlan, pipeExits) {
    var CK = (chokePlan && chokePlan.has) || {};
    var nullCells = [];
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) if (cells[r][c] == null) nullCells.push({ r: r, c: c });
    var boxTarget = nullCells.length;
    var iceKey = {}, qKey = {}, chainKey = {};
    var iceSlots = [], questionSlots = [], chainGroups = [];

    // ① 冰块预定位置（全棋盘可出现，含第0行）
    var iceCount = Math.floor(boxTarget * (config.icePercent || 0) / 100);
    if (iceCount > 0) {
      // 卡点类型 iceCluster：同样数量的冰块改为【聚集】铺设，在局部形成长时间锁死区。
      //   未选中该类型时仍走原来的 pickDispersed（主动分散，最小间距 2），行为不变。
      var iceSel = CK.iceCluster
        ? pickClustered(nullCells, iceCount, config.iceClusterSeeds || 0)
        : pickDispersed(nullCells, iceCount, 2);
      for (var i = 0; i < iceSel.length; i++) {
        var k = iceSel[i].r + ',' + iceSel[i].c;
        if (iceKey[k]) continue;
        iceKey[k] = 1; iceSlots.push({ r: iceSel[i].r, c: iceSel[i].c, durability: 3, src: 'base' });
      }
    }
    // 窄路缺口冰(临时锁路)：必须落在缺口格
    // 卡点类型 narrowGapIce：本项【原本恒开】(narrowPathIce 默认 true)。类型化后语义为——
    //   仍以 narrowPathIce 为总开关（保持向后兼容、默认行为不变）；
    //   仅当显式配置 chokeGateNarrowByType=true 时，才额外要求本关抽中 narrowGapIce 类型。
    var gateNarrowByType = !!config.chokeGateNarrowByType;
    if (config.narrowPath && config.narrowPathIce !== false && (!gateNarrowByType || CK.narrowGapIce) && narrowGaps && narrowGaps.length) {
      for (var g0 = 0; g0 < narrowGaps.length; g0++) {
        var gk = narrowGaps[g0].r + ',' + narrowGaps[g0].c;
        if (cells[narrowGaps[g0].r] && cells[narrowGaps[g0].r][narrowGaps[g0].c] == null && !iceKey[gk]) {
          iceKey[gk] = 1; iceSlots.push({ r: narrowGaps[g0].r, c: narrowGaps[g0].c, durability: 3, src: 'narrowGap' });
        }
      }
    }

    // ② 问号预定位置（不在第0行；可与冰叠加；不与锁链叠加——锁链在其后规划时会避开）
    var qCount = Math.floor(boxTarget * (config.questionPercent || 0) / 100);
    if (qCount % 2 === 1) qCount--;
    if (qCount >= 2) {
      var qPool = nullCells.filter(function (p) { return p.r !== 0; });
      // 卡点类型 questionCluster：问号改为聚集，形成"一片都看不清"的区域（只影响玩家判断，不改可解性）
      var qSel = CK.questionCluster
        ? pickClustered(qPool, qCount, config.questionClusterSeeds || 0)
        : pickDispersed(qPool, qCount, 2);
      if (qSel.length % 2 === 1) qSel.pop();
      for (var qi = 0; qi < qSel.length; qi++) {
        var qk = qSel[qi].r + ',' + qSel[qi].c;
        if (qKey[qk]) continue;
        qKey[qk] = 1; questionSlots.push({ r: qSel[qi].r, c: qSel[qi].c });
      }
      if (questionSlots.length % 2 === 1) { var drop = questionSlots.pop(); delete qKey[drop.r + ',' + drop.c]; }
    }

    // ③ 锁链组预定位置（2/3 连，正交相邻；不同组不 8-邻接；避开问号预定格）
    var dirs4 = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    var dirs8 = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]];
    function freeForChain(r, c) {
      if (r < 0 || r >= rows || c < 0 || c >= cols) return false;
      if (cells[r][c] != null) return false;                 // 必须是未来盒格
      var k = r + ',' + c;
      return !chainKey[k] && !qKey[k];                        // 不与问号/其他锁链叠加
    }
    function plannedConflict(members, group) {
      var mset = {};
      for (var m = 0; m < members.length; m++) mset[members[m].r + ',' + members[m].c] = 1;
      for (var i2 = 0; i2 < members.length; i2++) for (var d = 0; d < 8; d++) {
        var nr = members[i2].r + dirs8[d][0], nc = members[i2].c + dirs8[d][1];
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        if (mset[nr + ',' + nc]) continue;
        var og = chainKey[nr + ',' + nc];
        // 卡点类型 chainCluster：允许不同锁链组彼此 8-邻接，从而形成"锁链簇"——
        //   多组同时索要暂存空位，压力形态与分散的独立组完全不同。
        //   未选中该类型时保持原约束（组间禁止 8-邻接）。
        if (og && og !== group) { if (!CK.chainCluster) return true; }
      }
      return false;
    }
    /**
     * 结构阶段的锁链可激活性判定（与填球后 chainActivatable 拓扑等价）。
     * 关键点：直接调用 chainActivatable() 在本阶段会恒返回 true——因为本组成员此刻仍是 null 格，
     * 被 isEmptyLike 当成"空格可通行"，成员必然显得已暴露。这里显式把【本组预定成员】视作障碍、
     * 其余未来盒格视作"最终会被移除"(可通行)、黑块/管道视作墙，即完全复刻绑定后的最大激活态，
     * 从而在规划期就淘汰不可激活的组，而不是等到绑定阶段整个候选作废。
     */
    function plannedChainActivatable(members) {
      var mset = {};
      for (var m = 0; m < members.length; m++) mset[members[m].r + ',' + members[m].c] = 1;
      function passable(r, c) {
        if (mset[r + ',' + c]) return false;            // 本组成员=障碍
        var ce = cells[r][c];
        if (ce == null) return true;                     // 未来盒格：最终会被取走 → 可通行
        if (ce.t === 'black' || ce.t === 'pipe') return false;
        return true;
      }
      var vis = AntSolver.create2D(rows, cols, false), q = [];
      for (var c0 = 0; c0 < cols; c0++) if (passable(0, c0)) { vis[0][c0] = true; q.push([0, c0]); }
      for (var h = 0; h < q.length; h++) {
        var r1 = q[h][0], c1 = q[h][1];
        for (var d = 0; d < 4; d++) {
          var nr = r1 + dirs4[d][0], nc = c1 + dirs4[d][1];
          if (nr < 0 || nr >= rows || nc < 0 || nc >= cols || vis[nr][nc]) continue;
          if (passable(nr, nc)) { vis[nr][nc] = true; q.push([nr, nc]); }
        }
      }
      for (var mi2 = 0; mi2 < members.length; mi2++) {
        var mr = members[mi2].r, mc = members[mi2].c;
        if (mr === 0) continue;                          // 第0行默认可激活
        var exposed = false;
        for (var dd = 0; dd < 4; dd++) {
          var er = mr + dirs4[dd][0], ec = mc + dirs4[dd][1];
          if (er < 0 || er >= rows || ec < 0 || ec >= cols) continue;
          if (vis[er][ec]) { exposed = true; break; }
        }
        if (!exposed) return false;
      }
      return true;
    }
    function growGroup(seed, minRow, maxRow, group) {
      var members = [{ r: seed.r, c: seed.c }];
      var size = (Math.random() < 0.5) ? 3 : 2, guard = 0;
      while (members.length < size && guard++ < 30) {
        var grew = false;
        for (var mi = 0; mi < members.length && !grew; mi++) {
          var order = shuffle(dirs4.slice());
          for (var d = 0; d < order.length; d++) {
            var nr = members[mi].r + order[d][0], nc = members[mi].c + order[d][1];
            if (nr < minRow || nr > maxRow) continue;
            if (!freeForChain(nr, nc)) continue;
            var dup = false;
            for (var mm = 0; mm < members.length; mm++) if (members[mm].r === nr && members[mm].c === nc) { dup = true; break; }
            if (dup) continue;
            members.push({ r: nr, c: nc }); grew = true; break;
          }
        }
        if (!grew) break;
      }
      if (members.length < 2) return null;
      if (plannedConflict(members, group)) return null;
      if (!plannedChainActivatable(members)) return null;   // 规划期即排除不可激活的组
      return members;
    }
    var group = 1;
    function planBatch(count, minRow, tag) {
      var placed = 0;
      if (count <= 0) return;
      var pool = nullCells.filter(function (p) { return p.r >= minRow && freeForChain(p.r, p.c); });
      var cand = pickDispersed(pool, count * 4 + 6, 2);
      for (var ci = 0; ci < cand.length && placed < count; ci++) {
        if (!freeForChain(cand[ci].r, cand[ci].c)) continue;
        var members = growGroup(cand[ci], minRow, rows - 1, group);
        if (!members) continue;
        for (var mk = 0; mk < members.length; mk++) chainKey[members[mk].r + ',' + members[mk].c] = group;
        chainGroups.push({ group: group, size: members.length, type: members.length === 3 ? '三连' : '二连', src: tag, members: members });
        group++; placed++;
      }
    }
    var totalChains = Math.max(0, config.chainCount || 0);
    if (totalChains > 0) {
      var ratio = (typeof config.chainInitialRatio === 'number') ? config.chainInitialRatio : 0.5;
      var n1 = Math.round(totalChains * ratio);
      planBatch(n1, 0, 'batch1');
      planBatch(totalChains - n1, Math.floor(rows * 0.5), 'batch2');
    }
    // 窄路缺口锁链：成员只取【墙带及以上】(r<=缺口行)，组号高位 90+
    // 卡点类型 narrowGapChain：同 narrowGapIce 的兼容策略（默认恒开，chokeGateNarrowByType 才按类型门控）
    if (config.narrowPath && config.narrowPathChain !== false && (!gateNarrowByType || CK.narrowGapChain) && narrowGaps && narrowGaps.length) {
      var ng = 90;
      for (var gi2 = 0; gi2 < narrowGaps.length; gi2++) {
        var gp = narrowGaps[gi2];
        if (!freeForChain(gp.r, gp.c)) continue;
        var mem = null, size2 = (Math.random() < 0.5) ? 3 : 2, tries = 0;
        var acc = [{ r: gp.r, c: gp.c }];
        while (acc.length < size2 && tries++ < 20) {
          var grew2 = false;
          for (var ai = 0; ai < acc.length && !grew2; ai++) {
            var ord = shuffle([[-1, 0], [0, -1], [0, 1]]);
            for (var d2 = 0; d2 < ord.length; d2++) {
              var nr2 = acc[ai].r + ord[d2][0], nc2 = acc[ai].c + ord[d2][1];
              if (nr2 < 0 || nr2 > gp.r) continue;               // 只在墙带及以上
              if (!freeForChain(nr2, nc2)) continue;
              var dup2 = false;
              for (var m2 = 0; m2 < acc.length; m2++) if (acc[m2].r === nr2 && acc[m2].c === nc2) { dup2 = true; break; }
              if (dup2) continue;
              acc.push({ r: nr2, c: nc2 }); grew2 = true; break;
            }
          }
          if (!grew2) break;
        }
        if (acc.length >= 2 && !plannedConflict(acc, ng) && plannedChainActivatable(acc)) mem = acc;
        if (!mem) continue;
        for (var mk2 = 0; mk2 < mem.length; mk2++) chainKey[mem[mk2].r + ',' + mem[mk2].c] = ng;
        chainGroups.push({ group: ng, size: mem.length, type: mem.length === 3 ? '三连' : '二连', src: 'narrowGap', members: mem });
        ng++;
      }
    }

    // ④ 卡点类型 pipeChain：把锁链组锚在【管道出口格】上（用户 2026-08-24 q5）。
    //   管道口的盒本来"一吐出来就暴露"，是最容易取的位置；叠上锁链后它必须等组内伙伴一起激活，
    //   于是管道的吐球节奏被锁住 —— 与既有任何手段都不同（换球改色、增容改量，都不改取盒时序）。
    //   出口格由调用方经 pipeExits 传入（planObstacleSlotsFixed 自身看不到 exitSet）。
    var pipeChainStat = { attempted: false, placed: 0 };
    if (CK.pipeChain && pipeExits && pipeExits.length) {
      pipeChainStat.attempted = true;
      var pg = 80;   // 组号高位段：80~89 专用于管道口锁链，便于产物里区分来源
      for (var pe = 0; pe < pipeExits.length && pg < 90; pe++) {
        var ex = pipeExits[pe];
        if (!freeForChain(ex.r, ex.c)) continue;
        var pacc = [{ r: ex.r, c: ex.c }], psize = (Math.random() < 0.5) ? 3 : 2, ptry = 0;
        while (pacc.length < psize && ptry++ < 20) {
          var pgrew = false;
          for (var pi2 = 0; pi2 < pacc.length && !pgrew; pi2++) {
            var pord = shuffle(dirs4.slice());
            for (var pd = 0; pd < pord.length; pd++) {
              var pnr = pacc[pi2].r + pord[pd][0], pnc = pacc[pi2].c + pord[pd][1];
              if (!freeForChain(pnr, pnc)) continue;
              var pdup = false;
              for (var pm = 0; pm < pacc.length; pm++) if (pacc[pm].r === pnr && pacc[pm].c === pnc) { pdup = true; break; }
              if (pdup) continue;
              pacc.push({ r: pnr, c: pnc }); pgrew = true; break;
            }
          }
          if (!pgrew) break;
        }
        if (pacc.length < 2) continue;
        if (plannedConflict(pacc, pg)) continue;
        if (!plannedChainActivatable(pacc)) continue;     // 规划期即排除不可激活的组，避免整候选作废
        for (var pk = 0; pk < pacc.length; pk++) chainKey[pacc[pk].r + ',' + pacc[pk].c] = pg;
        chainGroups.push({ group: pg, size: pacc.length, type: pacc.length === 3 ? '三连' : '二连', src: 'pipeExit', members: pacc });
        pg++; pipeChainStat.placed++;
      }
    }

    // ⑤ 卡点类型 chainIce：给锁链成员定向叠冰（用户 2026-08-24 q3）。
    //   锁链要求【组内全员已激活且冰已解】才能取；叠冰后整组解锁被推迟 durability 步，
    //   期间已激活的伙伴只能干等 —— 把"空间锁"（锁链）和"时间锁"（冰）串起来。
    //   只叠在部分成员上（默认每组 1 个），叠满会让组几乎不可解。
    var chainIceStat = { attempted: false, added: 0 };
    if (CK.chainIce && chainGroups.length) {
      chainIceStat.attempted = true;
      var perGroup = config.chainIcePerGroup != null ? config.chainIcePerGroup : 1;
      var groupQuota = config.chainIceGroups != null ? config.chainIceGroups : Math.ceil(chainGroups.length / 2);
      var gOrder = shuffle(chainGroups.slice());
      for (var gi3 = 0; gi3 < gOrder.length && gi3 < groupQuota; gi3++) {
        var mem3 = gOrder[gi3].members || [], added = 0;
        var mOrder = shuffle(mem3.slice());
        for (var mi3 = 0; mi3 < mOrder.length && added < perGroup; mi3++) {
          var ik = mOrder[mi3].r + ',' + mOrder[mi3].c;
          if (iceKey[ik]) continue;                        // 已有冰则跳过，不重复计数
          iceKey[ik] = 1;
          iceSlots.push({ r: mOrder[mi3].r, c: mOrder[mi3].c, durability: 3, src: 'chainIce' });
          added++; chainIceStat.added++;
        }
      }
    }

    return {
      boxTarget: boxTarget, iceSlots: iceSlots, questionSlots: questionSlots, chainGroups: chainGroups,
      chokeStat: { pipeChain: pipeChainStat, chainIce: chainIceStat, iceClustered: !!CK.iceCluster, questionClustered: !!CK.questionCluster, chainClustered: !!CK.chainCluster }
    };
  }

  /**
   * R01+R02：构建【不带球】的结构候选。
   * 顺序：行列 → 窄路墙 → 分散黑块(真实落位) → 用实际剩余空间算管道并落位 → 障碍预定位置。
   * @returns {object} ok=false 时带 reason，调用方淘汰该候选
   */
  function buildStructureCandidateFixed(n, config, chokePlan) {
    var tStruct = Date.now();
    var dims = chooseBoardDimsFixed(n, config);
    var rows = dims.rows, cols = dims.cols, cellCap = rows * cols;
    var cells = [];
    for (var r = 0; r < rows; r++) { var row = []; for (var c = 0; c < cols; c++) row.push(null); cells.push(row); }

    // ① 窄路墙黑块（按 narrowPathProb 概率出现；默认 1 = 必定出现，与原行为一致）
    var narrowGaps = [];
    // 分两步记录，便于区分「概率没命中」与「命中了但墙建不出来」——
    // 后者是真实存在的情况：reserveNarrowWalls 在棋盘过小/过窄时会直接返回空，
    // 而本模式为增加管道把棋盘缩小了，必须能看出窄路到底有没有落地。
    var narrowHit = !!(config.narrowPath && narrowPathHits(config));
    if (narrowHit) narrowGaps = reserveNarrowWalls(cells, rows, cols, config);
    var narrowStat = { enabled: !!config.narrowPath, prob: (config.narrowPathProb != null ? parseFloat(config.narrowPathProb) : 1), hit: narrowHit, gaps: narrowGaps.length, applied: narrowGaps.length > 0 };
    var gapProtect = {};
    for (var wi = 0; wi < narrowGaps.length; wi++) {
      var gr = narrowGaps[wi].r, gc = narrowGaps[wi].c;
      gapProtect[gr + ',' + gc] = true;
      if (gr - 1 >= 0) gapProtect[(gr - 1) + ',' + gc] = true;
      if (gr + 1 < rows) gapProtect[(gr + 1) + ',' + gc] = true;
    }
    var wallBlacks = countCellsOfType(cells, 'black');

    // ② 分散黑块【全部实际落位】
    // 开启可用空间目标时，黑块数取配额求解结果（与管道数联立，见 solveSpaceQuota），
    // 不再单独按 blackPercent 推——否则黑块与管道各自为政，(墙+管道) 之和就对不上目标配额。
    var spaceQuota = dims.spaceQuota || null;
    var blackTarget = spaceQuota
      ? spaceQuota.blackTarget
      : Math.floor(cellCap * (config.blackPercent || 0) / 100);
    var blackCap = Math.floor(cellCap * 0.25);
    if (blackTarget > blackCap) blackTarget = blackCap;
    var extraBlack = Math.max(0, blackTarget - wallBlacks);
    var totalBlackCap = Math.floor(cellCap * 0.4);
    if (wallBlacks + extraBlack > totalBlackCap) extraBlack = Math.max(0, totalBlackCap - wallBlacks);
    var blackStat = placeDispersedBlackReal(cells, rows, cols, extraBlack, gapProtect, config);
    blackStat.wallBlacks = wallBlacks;
    blackStat.plannedTotal = wallBlacks + extraBlack;
    blackStat.actualTotal = countCellsOfType(cells, 'black');
    blackStat.missing = blackStat.plannedTotal - blackStat.actualTotal;
    blackStat.surplusFilled = 0;

    // ③ 盒不够填满 → 多余空格转黑块，保证结构候选满盘（不留待填球后裁行）
    var nullNow = 0;
    for (var r2 = 0; r2 < rows; r2++) for (var c2 = 0; c2 < cols; c2++) if (cells[r2][c2] == null) nullNow++;
    var surplusStat = { need: 0, filled: 0, coords: [] };
    if (nullNow > n) {
      surplusStat = fillSurplusWithBlack(cells, rows, cols, nullNow - n, gapProtect);
      blackStat.surplusFilled = surplusStat.filled;
      blackStat.actualTotal = countCellsOfType(cells, 'black');
      nullNow = 0;
      for (var r3 = 0; r3 < rows; r3++) for (var c3 = 0; c3 < cols; c3++) if (cells[r3][c3] == null) nullNow++;
      if (nullNow > n) {
        return { ok: false, reason: 'structSurplus', detail: '空格' + nullNow + ' > 盒数' + n + '，多余空格无法全部转黑块', structureBuildMs: Date.now() - tStruct, blackStat: blackStat };
      }
    }

    // ④ 管道：基于【实际黑块落位后】的剩余普通格重新计算预算
    var freeForBoxes = nullNow;                                     // 实际普通格容量(实测，非公式推导)
    var overflow = Math.max(0, n - freeForBoxes);                    // D：必须由管道吸收的盒
    // 开启可用空间目标时，管道条数同样取配额解（与黑块联立），而不是只按溢出量反推；
    // 这样 (墙 + 管道) 之和才等于目标配额，可用空间才能在各尺寸间保持一致。
    var pipeWant = spaceQuota ? spaceQuota.pipeWant : pipeCountByConservation(overflow, config);
    var maxPipes = Math.max(1, Math.floor((rows - 2) * cols / 3));
    if (pipeWant > maxPipes) pipeWant = maxPipes;
    if (overflow > 0 && pipeWant < 1) pipeWant = 1;
    var pipeList = [], exitSet = {};
    if (pipeWant > 0) {
      var pipeRowStart = clampInt(config.pipeRowStart, 3, 0, 30);
      var pipeBiasFrac = (typeof config.pipeRowBias === 'number') ? config.pipeRowBias : 0.35;
      var pStart = Math.max(pipeRowStart, Math.round(rows * pipeBiasFrac));
      if (pStart > rows - 2) pStart = rows - 2;
      if (pStart < 1) pStart = 1;
      var buildCand = function (start) {
        var arr = [];
        for (var pr = start; pr < rows - 1; pr++) for (var pc = 0; pc < cols; pc++) {
          if (gapProtect[pr + ',' + pc]) continue;
          if (cells[pr][pc] != null) continue;
          arr.push({ r: pr, c: pc });
        }
        return arr;
      };
      var cand = buildCand(pStart);
      while (cand.length < pipeWant * 2 && pStart > 1) { pStart--; cand = buildCand(pStart); }
      var sel = pickDispersed(cand, pipeWant * 3, 2);
      for (var ps = 0; ps < sel.length && pipeList.length < pipeWant; ps++) {
        var pc0 = sel[ps];
        if (cells[pc0.r][pc0.c] != null) continue;
        if (exitSet[pc0.r + ',' + pc0.c]) continue;
        if (wouldViolateWall(cells, rows, cols, pc0.r, pc0.c)) continue;
        var dir = choosePipeDir(cells, rows, cols, pc0.r, pc0.c, exitSet);
        if (dir < 0) continue;
        var dv = AntSolver.PIPE_DIRS[dir];
        var er = pc0.r + dv[0], ec = pc0.c + dv[1];
        if (gapProtect[er + ',' + ec]) continue;
        cells[pc0.r][pc0.c] = { t: 'pipe', dir: dir, queue: [], next: 0 };
        if (!nullCellsReachable(cells, rows, cols)) { cells[pc0.r][pc0.c] = null; continue; }
        pipeList.push({ r: pc0.r, c: pc0.c, dir: dir });
        exitSet[er + ',' + ec] = true;
      }
    }
    // 管道占格后普通格减少 → 重算实际溢出，并校验管道容量能否守恒吸收
    var boardBoxCells = 0;
    for (var r4 = 0; r4 < rows; r4++) for (var c4 = 0; c4 < cols; c4++) if (cells[r4][c4] == null) boardBoxCells++;
    var overflowReal = n - boardBoxCells;
    var pipeMaxDepth = pipeDepthOf(config);

    // ===== 管道绝对下限：不足则【直接去除管道】=====
    // 用户 2026-08-25：「突破下限管道数，最低为 2 个管道 2 层深度。如果低于这个下限就直接去除管道」。
    //   配额层已按阶梯给出 pipeWant，但落位环节仍可能放不满（走廊保护/出口唯一/可达性）。
    //   落位结果若达不到「floorCount 条 且 每管能装到 floorDepth 层」，就把已落位的管道全部撤掉、
    //   格子退回普通盒格 —— 留下 1 条或装不满 2 层的管道既不构成卡点、又白占格子。
    //   守恒前提：撤掉 P 条管道会让普通格 +P、溢出 −P；只有撤完后溢出 ≤ 0 才可以撤，
    //   否则撤了就会丢盒，此时保留管道并由后续 pipeCapacity / usablePipeShort 如实判定。
    //   撤管道只会移除障碍，不可能破坏「空格顶部可达」与墙体形态约束（2×2 / 直线 3 连），故无需重查。
    var floorCount = (config.pipeFloorCount != null) ? parseInt(config.pipeFloorCount, 10) : 2;
    var floorDepth = (config.pipeFloorDepth != null) ? parseInt(config.pipeFloorDepth, 10) : 2;
    if (!(floorCount > 0)) floorCount = 0;
    if (!(floorDepth > 0)) floorDepth = 1;
    if (floorDepth > pipeMaxDepth) floorDepth = pipeMaxDepth;
    var pipeDroppedStat = null;
    if (pipeList.length > 0 && floorCount > 0) {
      var belowFloorCount = pipeList.length < floorCount;
      var belowFloorDepth = overflowReal < pipeList.length * floorDepth;
      if (belowFloorCount || belowFloorDepth) {
        if (overflowReal - pipeList.length <= 0) {
          pipeDroppedStat = {
            dropped: pipeList.length,
            reason: belowFloorCount
              ? '落位 ' + pipeList.length + ' 条 < 绝对下限 ' + floorCount + ' 条'
              : '溢出 ' + overflowReal + ' 摊不到 ' + pipeList.length + ' 条×' + floorDepth + ' 层',
            floorCount: floorCount, floorDepth: floorDepth,
            overflowBefore: overflowReal
          };
          for (var dp = 0; dp < pipeList.length; dp++) cells[pipeList[dp].r][pipeList[dp].c] = null;
          pipeList = [];
          exitSet = {};
          boardBoxCells = 0;
          for (var r4b = 0; r4b < rows; r4b++) for (var c4b = 0; c4b < cols; c4b++) if (cells[r4b][c4b] == null) boardBoxCells++;
          overflowReal = n - boardBoxCells;
          pipeDroppedStat.overflowAfter = overflowReal;
        }
      }
    }
    var pipeStat = {
      want: pipeWant, placed: pipeList.length, overflowPlanned: overflow, overflowActual: overflowReal,
      capacityPerPipe: pipeMaxDepth, coords: pipeList.slice(),
      floorCount: floorCount, floorDepth: floorDepth
    };
    // 管道被撤（低于绝对下限）：如实记录，不静默——否则"这关为什么一条管道都没有"无从追溯
    if (pipeDroppedStat) {
      pipeStat.pipeDropped = true;
      pipeStat.pipeDroppedInfo = pipeDroppedStat;
    }
    // 配额层就判定不需要管道（P=0，含 D≤0 与去除管道解）也要标出来
    if (spaceQuota && spaceQuota.pipeDropped) pipeStat.quotaPipeDropped = true;
    if (overflowReal < 0) {
      return { ok: false, reason: 'structHoles', detail: '普通格' + boardBoxCells + ' > 盒数' + n, structureBuildMs: Date.now() - tStruct, blackStat: blackStat, pipeStat: pipeStat };
    }
    if (overflowReal > 0 && pipeList.length === 0) {
      return { ok: false, reason: 'pipeCapacity', detail: '溢出' + overflowReal + ' 但无管道落位' + (pipeDroppedStat ? '（管道已按绝对下限撤除：' + pipeDroppedStat.reason + '）' : ''), structureBuildMs: Date.now() - tStruct, blackStat: blackStat, pipeStat: pipeStat };
    }
    if (overflowReal > pipeList.length * pipeMaxDepth) {
      return { ok: false, reason: 'pipeCapacity', detail: '溢出' + overflowReal + ' > 管道容量' + (pipeList.length * pipeMaxDepth) + '(' + pipeList.length + '条×深度' + pipeMaxDepth + ')', structureBuildMs: Date.now() - tStruct, blackStat: blackStat, pipeStat: pipeStat };
    }
    var structureBuildMs = Date.now() - tStruct;

    // ⑤ 障碍预定位置（结构阶段，尚无球）
    var tSlot = Date.now();
    // 管道出口格清单（供卡点类型 pipeChain 把锁链锚在管道口）
    var pipeExitList = [];
    for (var ek in exitSet) { var ep = ek.split(','); pipeExitList.push({ r: parseInt(ep[0], 10), c: parseInt(ep[1], 10) }); }
    var slots = planObstacleSlotsFixed(cells, rows, cols, config, narrowGaps, chokePlan, pipeExitList);
    var obstacleSlotMs = Date.now() - tSlot;

    // ⑥ 不依赖颜色的结构检查：空(未来盒)格全部顶部可达 + 管道出口唯一合法
    if (!nullCellsReachable(cells, rows, cols)) {
      return { ok: false, reason: 'structReach', detail: '有未来盒格从顶部不可达', structureBuildMs: structureBuildMs, obstacleSlotMs: obstacleSlotMs, blackStat: blackStat, pipeStat: pipeStat };
    }
    var exitOwner = {};
    for (var pr2 = 0; pr2 < rows; pr2++) for (var pc2 = 0; pc2 < cols; pc2++) {
      var pcell = cells[pr2][pc2];
      if (!pcell || pcell.t !== 'pipe') continue;
      var dv2 = AntSolver.PIPE_DIRS[pcell.dir] || [1, 0];
      var er2 = pr2 + dv2[0], ec2 = pc2 + dv2[1];
      if (er2 < 0 || er2 >= rows || ec2 < 0 || ec2 >= cols) {
        return { ok: false, reason: 'structPipeExit', detail: '管道(' + pr2 + ',' + pc2 + ')出口越界', structureBuildMs: structureBuildMs, obstacleSlotMs: obstacleSlotMs, blackStat: blackStat, pipeStat: pipeStat };
      }
      var ek = er2 + ',' + ec2;
      if (exitOwner[ek]) {
        return { ok: false, reason: 'structPipeExit', detail: '管道共用出口(' + ek + ')', structureBuildMs: structureBuildMs, obstacleSlotMs: obstacleSlotMs, blackStat: blackStat, pipeStat: pipeStat };
      }
      exitOwner[ek] = pr2 + ',' + pc2;
    }

    // ===== 可用空间一致性 / 管道下限：结构层闸门（用户 2026-08-04）=====
    // 配额是算准的，但落位环节会偏离：窄路墙黑块数不受配额控制（可能挤占黑块份额），
    // 管道也可能因走廊保护与落位规则放不满想要的条数。实测偏差最多到 5.4pp、管道最少只落 3 条。
    // 因此在结构候选出口按【实际落位结果】复核一次，不达标就淘汰该候选，
    // 交由多候选筛选去收敛——这与现有「生成候选 + 筛选淘汰」的架构一致，不在事后偷偷补删格子。
    if (spaceQuota) {
      var realBlack = countCellsOfType(cells, 'black');
      var realPipe = pipeList.length;
      var realUsable = (cellCap - realBlack - realPipe) / cellCap;
      var uTarget = parseFloat(config.usableSpaceTarget);
      var uTolPp = (config.usableSpaceTolPp != null) ? config.usableSpaceTolPp : 5;
      var devPp = Math.abs(realUsable - uTarget) * 100;
      var needPipes = Math.max(1, parseInt(config.minPipes, 10) || 1);
      // 【管道阶梯】任务 ANT-GEN-PIPE-DEPTH-FALLBACK-20260825，用户 2026-08-25 两次裁决：
      //   ①「如果其他参数影响导致管道不够，则保底 2 个管道、深度 3」
      //   ②「突破下限管道数，最低为 2 个管道 2 层深度。如果低于这个下限就直接去除管道」
      //   配额层已按阶梯给出 pipeWant，但落位环节受走廊保护/出口唯一/可达性限制放不满（实测最少落 0 条）。
      //   本闸门按【实际落位】复核，判定顺序与阶梯一致：
      //     达到 minPipes → 正常；退到 fbCount → 标 fallback；退到 floorCount → 标 floor；
      //     低于 floorCount → 上游已把管道整体撤除(P=0)，此处放行不再判 minPipes；
      //     既没撤成、又不到 floorCount → 淘汰。
      var fbCount = (config.pipeFallbackCount != null) ? parseInt(config.pipeFallbackCount, 10) : 2;
      var fbDepth = (config.pipeFallbackDepth != null) ? parseInt(config.pipeFallbackDepth, 10) : 3;
      if (!(fbDepth > 0)) fbDepth = 1;
      if (fbDepth > pipeMaxDepth) fbDepth = pipeMaxDepth;
      // P=0 是【有意为之】的合法结果（配额层判定不需要管道，或落位不达绝对下限已整体撤除）：
      //   此时不再拿 minPipes 卡它——溢出盒已经全部上盘（上面的 pipeCapacity 检查保证了这点）。
      var intentionalZero = realPipe === 0 &&
        (pipeDroppedStat != null || (spaceQuota && spaceQuota.pipeDropped) || overflowReal === 0);
      if (intentionalZero) {
        pipeStat.noPipeAccepted = true;
        pipeStat.noPipeReason = pipeDroppedStat ? pipeDroppedStat.reason
          : ((spaceQuota && spaceQuota.pipeDropped) ? '配额层判定无需管道（溢出已全部上盘）' : '溢出为 0，无需管道');
      } else if (realPipe < needPipes) {
        // 分级判定：先看能否算「兜底档」，再看能否算「绝对下限档」
        var capacityOK = overflowReal <= realPipe * pipeMaxDepth;   // 守恒硬约束：装不下就不能放行
        var tier = null;
        if (fbCount > 0 && realPipe >= fbCount && overflowReal >= realPipe * fbDepth && capacityOK) tier = 'fallback';
        else if (floorCount > 0 && realPipe >= floorCount && overflowReal >= realPipe * floorDepth && capacityOK) tier = 'floor';
        if (!tier) {
          return {
            ok: false, reason: 'usablePipeShort',
            detail: '管道只落位 ' + realPipe + ' 条 < 下限 ' + needPipes + '（配额想要 ' + pipeWant + ' 条）' +
              '；兜底档(' + fbCount + '条/每管≥' + fbDepth + ')与绝对下限档(' + floorCount + '条/每管≥' + floorDepth +
              ')均不满足，且撤除管道会丢盒（溢出 ' + overflowReal + ' > 可腾出 ' + realPipe + ' 格）' +
              (capacityOK ? '' : '；管道容量 ' + (realPipe * pipeMaxDepth) + ' < 溢出 ' + overflowReal),
            structureBuildMs: structureBuildMs, obstacleSlotMs: obstacleSlotMs, blackStat: blackStat, pipeStat: pipeStat
          };
        }
        pipeStat.fallback = true;
        pipeStat.fallbackTier = tier;              // 'fallback' = 保底档 / 'floor' = 已用到绝对下限
        pipeStat.fallbackFrom = needPipes;
        pipeStat.fallbackMinCount = tier === 'floor' ? floorCount : fbCount;
        pipeStat.fallbackTargetDepth = tier === 'floor' ? floorDepth : fbDepth;
      }
      if (devPp > uTolPp) {
        return {
          ok: false, reason: 'usableSpaceDeviation',
          detail: '可用空间 ' + (realUsable * 100).toFixed(1) + '% 偏离目标 ' + (uTarget * 100).toFixed(0) +
            '% 达 ' + devPp.toFixed(1) + 'pp（容差 ' + uTolPp + 'pp）；实际墙' + realBlack + ' 管道' + realPipe + ' 配额' + spaceQuota.quota,
          structureBuildMs: structureBuildMs, obstacleSlotMs: obstacleSlotMs, blackStat: blackStat, pipeStat: pipeStat
        };
      }
      spaceQuota.realBlack = realBlack; spaceQuota.realPipe = realPipe; spaceQuota.realUsable = realUsable;
    }
    return {
      ok: true, rows: rows, cols: cols, cells: cells, pipeList: pipeList,
      spaceQuota: spaceQuota, narrowStat: narrowStat,
      narrowGaps: narrowGaps, gapProtect: gapProtect,
      boardBoxCells: boardBoxCells, overflow: overflowReal,
      blackStat: blackStat, pipeStat: pipeStat, surplusStat: surplusStat,
      iceSlots: slots.iceSlots, questionSlots: slots.questionSlots, chainGroups: slots.chainGroups,
      chokeStat: slots.chokeStat || null,   // 卡点类型落地统计需一路传到结果，否则统计不到多样性
      dimsFitted: dims.fitted,
      structureBuildMs: structureBuildMs, obstacleSlotMs: obstacleSlotMs
    };
  }

  // ---- R03：独立守恒基线与实况扫描（来源互不相同，禁止自证） ----
  /**
   * 填球【前】的独立基线：只来自原始盒序列 boxes 与目标图 blocks，与被检查的棋盘无任何数据关系。
   */
  function buildConservationBaseline(boxes, blocks) {
    var expectedBoxCount = boxes.length;
    var colorBoxCount = {}, colorCountSum = {}, totalCountSum = 0;
    for (var i = 0; i < boxes.length; i++) {
      var b = boxes[i];
      colorBoxCount[b.color] = (colorBoxCount[b.color] || 0) + 1;
      colorCountSum[b.color] = (colorCountSum[b.color] || 0) + b.count;
      totalCountSum += b.count;
    }
    var targetColorPixels = {}, targetTotalPixels = 0;
    for (var r = 0; r < blocks.length; r++) {
      var row = blocks[r];
      for (var c = 0; c < row.length; c++) {
        var v = row[c];
        if (v > 0) { targetColorPixels[v] = (targetColorPixels[v] || 0) + 1; targetTotalPixels++; }
      }
    }
    // 基线自身健康度：盒序列的分色总量必须等于目标图分色像素（若不等说明分盒环节即已损坏）
    var baselineIssues = [];
    for (var col in targetColorPixels) {
      if ((colorCountSum[col] || 0) !== targetColorPixels[col])
        baselineIssues.push('盒序列色' + col + '总量' + (colorCountSum[col] || 0) + '≠目标图像素' + targetColorPixels[col]);
    }
    for (var col2 in colorCountSum) {
      if (!targetColorPixels[col2]) baselineIssues.push('盒序列出现目标图不存在的色' + col2);
    }
    if (totalCountSum !== targetTotalPixels) baselineIssues.push('盒总量' + totalCountSum + '≠目标图非空像素' + targetTotalPixels);
    return {
      expectedBoxCount: expectedBoxCount, colorBoxCount: colorBoxCount, colorCountSum: colorCountSum,
      totalCountSum: totalCountSum, targetColorPixels: targetColorPixels, targetTotalPixels: targetTotalPixels,
      baselineIssues: baselineIssues
    };
  }

  /** 独立扫描棋盘实况：棋盘盒与管道盒【分开计数】，不产生任何"总数=分量之和"的派生字段。 */
  function scanBoardActual(board) {
    var rows = board.rows, cols = board.cols, cells = board.cells;
    var boardBoxCount = 0, pipeBoxCount = 0, pipeCount = 0, maxPipeQueue = 0;
    var colorBoxCount = {}, colorCountSum = {};
    function acc(color, count) {
      colorBoxCount[color] = (colorBoxCount[color] || 0) + 1;
      colorCountSum[color] = (colorCountSum[color] || 0) + count;
    }
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      var cell = cells[r][c];
      if (!cell) continue;
      if (cell.t === 'box') { boardBoxCount++; acc(cell.color, cell.count || 0); }
      else if (cell.t === 'pipe') {
        pipeCount++;
        var q = cell.queue || [];
        if (q.length > maxPipeQueue) maxPipeQueue = q.length;
        for (var i = 0; i < q.length; i++) { pipeBoxCount++; acc(q[i].color, q[i].count || 0); }
      }
    }
    return {
      boardBoxCount: boardBoxCount, pipeBoxCount: pipeBoxCount, pipeCount: pipeCount,
      maxPipeQueue: maxPipeQueue, colorBoxCount: colorBoxCount, colorCountSum: colorCountSum
    };
  }

  /**
   * R03：多点独立守恒比对。
   * 左侧全部来自 baseline(原始盒序列 + 目标图)，右侧全部来自 scanBoardActual(棋盘实测)，
   * 两侧数据来源完全独立，不存在"用 A=B+C 再验证 A=B+C"的恒等式。
   * pendingCount：填球尚未完成阶段仍在待放队列里的盒数(独立计数)，参与总量核对。
   */
  function verifyConservation(baseline, actual, stage, pendingCount) {
    var pending = pendingCount || 0;
    var reasons = [];
    var boxSum = actual.boardBoxCount + actual.pipeBoxCount + pending;
    if (boxSum !== baseline.expectedBoxCount)
      reasons.push('盒数不一致：棋盘' + actual.boardBoxCount + '+管道' + actual.pipeBoxCount + (pending ? '+待放' + pending : '') + '=' + boxSum + '，预期' + baseline.expectedBoxCount);
    if (pending === 0) {
      for (var col in baseline.colorBoxCount) {
        var ab = actual.colorBoxCount[col] || 0;
        if (ab !== baseline.colorBoxCount[col])
          reasons.push('色' + col + '盒数不一致：实际' + ab + '，预期' + baseline.colorBoxCount[col]);
      }
      for (var col2 in actual.colorBoxCount) {
        if (baseline.colorBoxCount[col2] == null)
          reasons.push('出现预期外颜色' + col2 + '(实际盒数' + actual.colorBoxCount[col2] + ')');
      }
      var totalSum = 0;
      for (var col3 in baseline.targetColorPixels) {
        var as = actual.colorCountSum[col3] || 0;
        if (as !== baseline.targetColorPixels[col3])
          reasons.push('色' + col3 + 'count总和不一致：实际' + as + '，目标图像素' + baseline.targetColorPixels[col3]);
      }
      for (var col4 in actual.colorCountSum) totalSum += actual.colorCountSum[col4];
      if (totalSum !== baseline.targetTotalPixels)
        reasons.push('全部count总和不一致：实际' + totalSum + '，目标图非空像素' + baseline.targetTotalPixels);
    }
    return { ok: reasons.length === 0, stage: stage, reasons: reasons };
  }

  // ---- R01：填球 + 只绑定预定障碍（不再随机重选） ----
  /**
   * @returns {object} { ok, reason, board, bindStat, conservation:[...] }
   */
  function fillStructureFixed(struct, boxes, baseline, config, timing) {
    var tFill = Date.now();
    var cells = struct.cells, rows = struct.rows, cols = struct.cols, pipeList = struct.pipeList;
    var conservation = [];

    var list = [];
    for (var bi = 0; bi < boxes.length; bi++)
      list.push({ color: boxes[bi].color, count: boxes[bi].count, _seq: (boxes[bi].elimSeq != null ? boxes[bi].elimSeq : bi) });
    list.sort(function (a, b) { return a._seq - b._seq; });

    // 单扫填球：空格→普通盒；管道本体→入队 1 个
    var fi = 0;
    for (var fr = 0; fr < rows && fi < list.length; fr++) {
      for (var fc = 0; fc < cols && fi < list.length; fc++) {
        var cell = cells[fr][fc];
        if (cell == null) {
          cells[fr][fc] = { t: 'box', color: list[fi].color, count: list[fi].count, ice: 0, chain: 0, q: false, _seq: list[fi]._seq };
          fi++;
        } else if (cell.t === 'pipe') {
          cell.queue.push({ color: list[fi].color, count: list[fi].count }); fi++;
        }
      }
    }
    var rest = list.slice(fi);
    timing.fillMs = Date.now() - tFill;
    // 检查点1：填球完成（rest 为独立待放计数）
    var board0 = { rows: rows, cols: cols, cells: cells };
    var cv1 = verifyConservation(baseline, scanBoardActual(board0), 'fill', rest.length);
    conservation.push(cv1);
    if (!cv1.ok) return { ok: false, reason: 'conservation', stage: 'fill', conservation: conservation };

    // 溢出盒 → 管道均匀入队（每管 ≤ pipeMaxDepth，可调参数，默认 6 = 原常量）
    var qMaxDepth = pipeDepthOf(config);
    var tPipe = Date.now();
    if (rest.length > 0) {
      if (pipeList.length === 0) return { ok: false, reason: 'pipeCapacity', stage: 'pipeQueue', detail: '仍剩' + rest.length + '盒但无管道', conservation: conservation };
      var ri = 0, guard = rest.length + pipeList.length + 2;
      while (ri < rest.length && guard-- > 0) {
        var anyRoom = false;
        for (var pj = 0; pj < pipeList.length && ri < rest.length; pj++) {
          var pq = cells[pipeList[pj].r][pipeList[pj].c].queue;
          if (pq.length < qMaxDepth) { pq.push({ color: rest[ri].color, count: rest[ri].count }); ri++; anyRoom = true; }
        }
        if (!anyRoom) break;
      }
      if (ri < rest.length) return { ok: false, reason: 'pipeCapacity', stage: 'pipeQueue', detail: '管道全满(每管' + qMaxDepth + ')仍剩' + (rest.length - ri) + '盒', conservation: conservation };
    }
    // 检查点2：管道入队完成
    var cv2 = verifyConservation(baseline, scanBoardActual(board0), 'pipeQueue', 0);
    conservation.push(cv2);
    if (!cv2.ok) return { ok: false, reason: 'conservation', stage: 'pipeQueue', conservation: conservation };
    // 管道深度合法性
    if (maxPipeDepth(board0) > qMaxDepth)
      return { ok: false, reason: 'pipeDepth', stage: 'pipeQueue', detail: '最深管道' + maxPipeDepth(board0) + ' > 上限' + qMaxDepth, conservation: conservation };

    // 结构候选已满盘 → ensureBoardFull 应为空操作；一旦裁行则预定坐标失效 → 淘汰候选
    var ef = ensureBoardFull(cells, rows, cols, pipeList);
    if (ef.rows !== rows) return { ok: false, reason: 'rowTrim', stage: 'boardFull', detail: '裁行 ' + rows + '→' + ef.rows + '，预定障碍坐标失效', conservation: conservation };
    cells = ef.cells; rows = ef.rows; cols = ef.cols;
    var board = { rows: rows, cols: cols, cells: cells };
    // 检查点3：补满/裁行完成
    var cv3 = verifyConservation(baseline, scanBoardActual(board), 'boardFull', 0);
    conservation.push(cv3);
    if (!cv3.ok) return { ok: false, reason: 'conservation', stage: 'boardFull', conservation: conservation };
    timing.pipeCheckMs = Date.now() - tPipe;

    // ===== 只绑定预定障碍（禁止再次随机选择位置）=====
    var tBind = Date.now();
    var bindStat = {
      ice: { planned: struct.iceSlots.length, bound: 0, failed: 0, reasons: [] },
      question: { planned: struct.questionSlots.length, bound: 0, failed: 0, reasons: [] },
      chain: { planned: struct.chainGroups.length, bound: 0, failed: 0, reasons: [], groups: [] }
    };
    function boxAt(r, c) {
      if (r < 0 || r >= rows || c < 0 || c >= cols) return null;
      var x = cells[r][c];
      return (x && x.t === 'box') ? x : null;
    }
    // 冰
    for (var ii = 0; ii < struct.iceSlots.length; ii++) {
      var sIce = struct.iceSlots[ii], bIce = boxAt(sIce.r, sIce.c);
      if (!bIce) { bindStat.ice.failed++; bindStat.ice.reasons.push('(' + sIce.r + ',' + sIce.c + ')无真实盒'); continue; }
      bIce.ice = sIce.durability || 3; bindStat.ice.bound++;
    }
    // 锁链（整组绑定，成员不足/不可激活/叠加冲突 → 该组失败）
    for (var gi = 0; gi < struct.chainGroups.length; gi++) {
      var grp = struct.chainGroups[gi], mem = grp.members, boxesOfGrp = [], missing = 0;
      for (var mi = 0; mi < mem.length; mi++) {
        var mb = boxAt(mem[mi].r, mem[mi].c);
        if (!mb) { missing++; continue; }
        boxesOfGrp.push({ box: mb, r: mem[mi].r, c: mem[mi].c });
      }
      if (missing > 0 || boxesOfGrp.length < 2) {
        bindStat.chain.failed++; bindStat.chain.reasons.push('组' + grp.group + '成员不足(缺' + missing + ')'); continue;
      }
      var occupied = false;
      for (var oi = 0; oi < boxesOfGrp.length; oi++) if (boxesOfGrp[oi].box.chain > 0 || boxesOfGrp[oi].box.q) { occupied = true; break; }
      if (occupied) { bindStat.chain.failed++; bindStat.chain.reasons.push('组' + grp.group + '成员已被其他障碍占用'); continue; }
      if (chainGroupConflict(cells, rows, cols, mem, grp.group)) {
        bindStat.chain.failed++; bindStat.chain.reasons.push('组' + grp.group + '与其他锁链组相邻'); continue;
      }
      for (var si = 0; si < boxesOfGrp.length; si++) boxesOfGrp[si].box.chain = grp.group;
      if (!chainActivatable(cells, rows, cols, mem)) {
        for (var ui = 0; ui < boxesOfGrp.length; ui++) boxesOfGrp[ui].box.chain = 0;
        bindStat.chain.failed++; bindStat.chain.reasons.push('组' + grp.group + '无法全部激活'); continue;
      }
      bindStat.chain.bound++;
      bindStat.chain.groups.push({ group: grp.group, type: grp.type, size: boxesOfGrp.length, src: grp.src, members: mem.slice() });
    }
    // 问号（不与锁链叠加）
    for (var qi2 = 0; qi2 < struct.questionSlots.length; qi2++) {
      var sQ = struct.questionSlots[qi2], bQ = boxAt(sQ.r, sQ.c);
      if (!bQ) { bindStat.question.failed++; bindStat.question.reasons.push('(' + sQ.r + ',' + sQ.c + ')无真实盒'); continue; }
      if (bQ.chain > 0) { bindStat.question.failed++; bindStat.question.reasons.push('(' + sQ.r + ',' + sQ.c + ')与锁链叠加'); continue; }
      bQ.q = true; bindStat.question.bound++;
    }
    timing.obstacleBindMs = Date.now() - tBind;
    // 任一预定项未能按计划绑定 → 淘汰整个结构候选（需求 §4.2）
    if (bindStat.ice.failed || bindStat.question.failed || bindStat.chain.failed ||
        bindStat.ice.bound !== bindStat.ice.planned ||
        bindStat.question.bound !== bindStat.question.planned ||
        bindStat.chain.bound !== bindStat.chain.planned) {
      return { ok: false, reason: 'bind', stage: 'obstacleBind', bindStat: bindStat, conservation: conservation };
    }

    // 顶部行障碍密度上限：纯减法后处理(只移除，不新增/不重选位置)
    var beforeTop = { ice: 0, q: 0, chain: 0, black: 0 };
    for (var tr = 0; tr < Math.min(2, rows); tr++) for (var tc = 0; tc < cols; tc++) {
      var tcell = cells[tr][tc];
      if (!tcell) continue;
      if (tcell.t === 'black') beforeTop.black++;
      else if (tcell.t === 'box') { if (tcell.ice > 0) beforeTop.ice++; if (tcell.q) beforeTop.q++; if (tcell.chain > 0) beforeTop.chain++; }
    }
    enforceTopObstacleCap(cells, rows, cols, config);
    var afterTop = { ice: 0, q: 0, chain: 0, black: 0 };
    for (var tr2 = 0; tr2 < Math.min(2, rows); tr2++) for (var tc2 = 0; tc2 < cols; tc2++) {
      var t2 = cells[tr2][tc2];
      if (!t2) continue;
      if (t2.t === 'black') afterTop.black++;
      else if (t2.t === 'box') { if (t2.ice > 0) afterTop.ice++; if (t2.q) afterTop.q++; if (t2.chain > 0) afterTop.chain++; }
    }
    bindStat.topCapRemoved = {
      ice: beforeTop.ice - afterTop.ice, question: beforeTop.q - afterTop.q,
      chainMembers: beforeTop.chain - afterTop.chain, black: beforeTop.black - afterTop.black
    };

    // 孤立锁链清理（顶部整组清除后可能残留单成员）
    var chainCnt = {};
    for (var cr = 0; cr < rows; cr++) for (var cc = 0; cc < cols; cc++) {
      var cb = cells[cr][cc];
      if (cb && cb.t === 'box' && cb.chain > 0) chainCnt[cb.chain] = (chainCnt[cb.chain] || 0) + 1;
    }
    for (var dr = 0; dr < rows; dr++) for (var dc = 0; dc < cols; dc++) {
      var db = cells[dr][dc];
      if (db && db.t === 'box' && db.chain > 0 && chainCnt[db.chain] < 2) db.chain = 0;
    }
    // 清除铺盒临时标记
    for (var sr = 0; sr < rows; sr++) for (var sc = 0; sc < cols; sc++) {
      if (cells[sr][sc] && cells[sr][sc].t === 'box') delete cells[sr][sc]._seq;
    }

    // 检查点4：障碍绑定完成
    var cv4 = verifyConservation(baseline, scanBoardActual(board), 'obstacleBind', 0);
    conservation.push(cv4);
    if (!cv4.ok) return { ok: false, reason: 'conservation', stage: 'obstacleBind', conservation: conservation, bindStat: bindStat };

    return { ok: true, board: board, bindStat: bindStat, conservation: conservation };
  }

  // ---- R04/R06：1 遍基础贪心 + 最多 3 遍噪声贪心，成功即停 ----
  var SCREEN_PASSES_FIXED = [
    { key: 'base', tag: 'base', mode: 'greedy', noise: 0, seed: 1, timingKey: 'baseSolveMs' },
    { key: 'noise1', tag: 'n1', mode: 'greedy', noise: 0.6, seed: 53, timingKey: 'noise1Ms' },
    { key: 'noise2', tag: 'n2', mode: 'greedy', noise: 1.0, seed: 211, timingKey: 'noise2Ms' },
    { key: 'noise3', tag: 'n3', mode: 'greedy', noise: 1.5, seed: 401, timingKey: 'noise3Ms' }
  ];
  /**
   * @param {boolean} [bottomOnly=false] 目标图消除入口模式，作为 runSolver 第 5 实参下传。
   *   必须与本关最终全知求解、玩家模拟、审核所用的值一致——否则会出现
   *   "候选按四边入口判可解、最终按底部入口审核"的口径分裂（原需求 §2.2 明令禁止）。
   */
  function screenCandidateFixed(parsed, timing, bottomOnly, instantChain) {
    bottomOnly = !!bottomOnly;
    // 候选筛选必须与最终审核同一消除口径，否则出现「按原口径判可解、按新口径审核」的分裂（需求 §七.2）
    instantChain = !!instantChain;
    if (instantChain) bottomOnly = false;
    var best = null, logs = [];
    for (var i = 0; i < SCREEN_PASSES_FIXED.length; i++) {
      var p = SCREEN_PASSES_FIXED[i], t0 = Date.now();
      var r = AntSolver.Solver.runSolver(parsed, p.noise, p.seed, false, bottomOnly, { mode: p.mode, capturePreviewStats: true, instantChain: instantChain });
      var ms = Date.now() - t0;
      timing[p.timingKey] = ms;
      r.retryRound = p.tag; r.time = ms;
      logs.push({
        pass: p.key, mode: p.mode, noise: p.noise, seed: p.seed, ms: ms,
        completed: !!r.completed, progress: r.progress, steps: r.steps,
        maxBuffer: r.maxBuffer, completedBoxes: r.completedBoxes, totalBoxes: r.totalBoxes
      });
      if (!best || r.eliminatedPixels > best.eliminatedPixels) best = r;
      if (r.completed) {
        return { ok: true, result: r, passKey: p.key, mode: p.mode, noise: p.noise, seed: p.seed, ms: ms, passIndex: i + 1, logs: logs };
      }
    }
    return { ok: false, result: best, passIndex: SCREEN_PASSES_FIXED.length, logs: logs };
  }

  // ---- R07：基准解显式字段 ----
  /** 管道推出顺序：出口格被取走即触发该管道吐球，按 pickOrder 命中出口的先后成序。 */
  function derivePipeReleaseOrder(board, pickOrder) {
    var exitMap = {}, out = [];
    for (var r = 0; r < board.rows; r++) for (var c = 0; c < board.cols; c++) {
      var cell = board.cells[r][c];
      if (!cell || cell.t !== 'pipe') continue;
      var dv = AntSolver.PIPE_DIRS[cell.dir] || [1, 0];
      exitMap[(r + dv[0]) + ',' + (c + dv[1])] = { r: r, c: c, dir: cell.dir, queueLen: (cell.queue || []).length, released: 0 };
    }
    for (var i = 0; i < (pickOrder || []).length; i++) {
      var p = pickOrder[i];
      if (!p || p.r == null) continue;
      var hit = exitMap[p.r + ',' + p.c];
      if (!hit) continue;
      hit.released++;
      out.push({
        order: out.length + 1, step: p.step != null ? p.step : i + 1,
        pipe: { r: hit.r, c: hit.c }, dir: hit.dir, exit: { r: p.r, c: p.c },
        releaseIndex: hit.released, queueLen: hit.queueLen
      });
    }
    return out;
  }
  /** 区域解锁顺序：以【棋盘行】为区域最小单位，按该行首次被取盒的步骤成序。 */
  function deriveRegionUnlockOrder(pickOrder) {
    var seen = {}, out = [];
    for (var i = 0; i < (pickOrder || []).length; i++) {
      var p = pickOrder[i];
      if (!p || p.r == null) continue;
      if (seen[p.r]) continue;
      seen[p.r] = 1;
      out.push({ order: out.length + 1, region: 'row' + p.r, row: p.r, firstStep: p.step != null ? p.step : i + 1, firstPick: { r: p.r, c: p.c } });
    }
    return out;
  }
  /** 冰/问号推进与锁链进入-滞留-释放：以求解前棋盘快照识别障碍格，再对 pickOrder 归因。 */
  function deriveObstacleProgress(board, pickOrder) {
    var iceSet = {}, qSet = {}, chainOf = {}, chainSize = {};
    for (var r = 0; r < board.rows; r++) for (var c = 0; c < board.cols; c++) {
      var cell = board.cells[r][c];
      if (!cell || cell.t !== 'box') continue;
      var k = r + ',' + c;
      if (cell.ice > 0) iceSet[k] = cell.ice;
      if (cell.q) qSet[k] = 1;
      if (cell.chain > 0) { chainOf[k] = cell.chain; chainSize[cell.chain] = (chainSize[cell.chain] || 0) + 1; }
    }
    var icePicks = [], questionPicks = [], chainMap = {};
    for (var i = 0; i < (pickOrder || []).length; i++) {
      var p = pickOrder[i];
      if (!p || p.r == null) continue;
      var key = p.r + ',' + p.c, step = p.step != null ? p.step : i + 1;
      if (iceSet[key]) icePicks.push({ step: step, r: p.r, c: p.c, durability: iceSet[key] });
      if (qSet[key]) questionPicks.push({ step: step, r: p.r, c: p.c });
      var g = chainOf[key];
      if (g) {
        // 口径说明：锁链组是【一次取整组同时离场】(simulator.applyPick 对 chain 组整体移除)，
        // 因此 pickOrder 里通常只出现【触发格】一条记录。不能用"全部成员都出现在 pickOrder"
        // 判定释放，否则 2/3 连组几乎永远被判成"未释放"（会得到严重失真的统计）。
        var s = chainMap[g] || (chainMap[g] = { group: g, size: chainSize[g], pickedCells: 0, triggerStep: step, cells: [] });
        s.pickedCells++; s.cells.push({ r: p.r, c: p.c, step: step });
        if (step < s.triggerStep) s.triggerStep = step;
      }
    }
    var chainStats = [];
    for (var gk in chainSize) {
      var m = chainMap[gk];
      chainStats.push(m
        ? {
            group: +gk, size: chainSize[gk],
            triggerStep: m.triggerStep,          // 整组被取（进入暂存）的步
            pickedCells: m.pickedCells,          // pickOrder 中命中的本组格数，正常为 1（整组同步离场）
            released: true,                      // 触发格已被取 → 整组已离场
            residenceSteps: null,                // 整组同一步离场；暂存内滞留需另采样，pickOrder 无法体现
            residenceNote: '整组同一步离场，暂存滞留不由 pickOrder 体现'
          }
        : {
            group: +gk, size: chainSize[gk],
            triggerStep: null, pickedCells: 0, released: false,
            residenceSteps: null, residenceNote: '本组在该解中始终未被取走'
          });
    }
    chainStats.sort(function (a, b) { return (a.triggerStep == null ? 1e9 : a.triggerStep) - (b.triggerStep == null ? 1e9 : b.triggerStep); });
    return {
      icePlanned: Object.keys(iceSet).length, icePicks: icePicks,
      questionPlanned: Object.keys(qSet).length, questionPicks: questionPicks,
      chainGroups: chainStats,
      chainFailed: chainStats.filter(function (x) { return !x.released; }).length
    };
  }
  /** 首轮基准解（卡点制造唯一依据）：pickOrder + 暂存变化 + 颜色首次可取 + 管道推出 + 区域解锁 + 障碍推进 + 遍次信息。 */
  function baselineSolutionFixed(board, parsed, result, screen) {
    var pickOrder = result.pickOrder || [];
    var colorFirstStep = {}, colorFirstOrder = [];
    for (var i = 0; i < pickOrder.length; i++) {
      var p = pickOrder[i];
      if (p.color == null || colorFirstStep[p.color] != null) continue;
      var st = p.step != null ? p.step : i + 1;
      colorFirstStep[p.color] = st;
      colorFirstOrder.push({ order: colorFirstOrder.length + 1, color: p.color, firstStep: st, at: { r: p.r, c: p.c } });
    }
    var obs = deriveObstacleProgress(board, pickOrder);
    return {
      pickOrder: pickOrder,
      bufferHistory: result.stepBufferHistory || [],
      maxBuffer: result.maxBuffer, avgBuffer: result.avgBuffer,
      pressureSamples: result.pressureSamples || [],
      colorFirstStep: colorFirstStep,
      colorFirstOrder: colorFirstOrder,
      pipeReleaseOrder: derivePipeReleaseOrder(board, pickOrder),
      regionUnlockOrder: deriveRegionUnlockOrder(pickOrder),
      iceProgress: { planned: obs.icePlanned, picks: obs.icePicks },
      questionProgress: { planned: obs.questionPlanned, picks: obs.questionPicks },
      chainProgress: { groups: obs.chainGroups, failed: obs.chainFailed },
      firstSuccess: {
        pass: screen.passKey, passIndex: screen.passIndex, mode: screen.mode,
        noise: screen.noise, seed: screen.seed, ms: screen.ms
      },
      screenLogs: screen.logs
    };
  }

  // ---- R05：完整候选成本计时 ----
  function newCandidateTiming() {
    return {
      boxBuildMs: 0, structureBuildMs: 0, obstacleSlotMs: 0, fillMs: 0, obstacleBindMs: 0,
      pipeCheckMs: 0, structuralCheckMs: 0, parseMs: 0, conservationCheckMs: 0,
      baseSolveMs: 0, noise1Ms: 0, noise2Ms: 0, noise3Ms: 0,
      candidatePrepareMs: 0, candidateBaseAttemptMs: 0, candidateTotalMs: 0
    };
  }

  /**
   * 单次候选尝试：结构候选 → 结构检查 → 填球 → 障碍绑定 → 守恒 → 1+3 求解筛选。
   * @returns {object} { ok, reason, timing, ... }
   */
  function buildOneCandidateAttempt(blocks, config, opts) {
    opts = opts || {};
    var timing = newCandidateTiming();
    var tAll = Date.now();

    // ① 盒序列与盒总量预算
    var tBox = Date.now();
    var boxes = pickBoxSplit(blocks, config);   // bottomOnly 时走底部依赖流分支
    timing.boxBuildMs = Date.now() - tBox;
    var n = boxes.length;

    // 独立守恒基线（来源：原始盒序列 + 目标图，与棋盘无关）
    var tCons = Date.now();
    var baseline = buildConservationBaseline(boxes, blocks);
    timing.conservationCheckMs += Date.now() - tCons;
    if (baseline.baselineIssues.length) {
      timing.candidatePrepareMs = Date.now() - tAll; timing.candidateTotalMs = timing.candidatePrepareMs;
      return { ok: false, reason: 'baseline', detail: baseline.baselineIssues.join('；'), timing: timing, boxCount: n };
    }

    // ② 结构候选（黑块全部落位 → 实际剩余空间算管道 → 障碍预定位置）
    //   卡点类型计划由 produceFixed 在【每关开始时抽一次】并经 config._chokePlan 透传下来。
    //   为什么不在这里抽：本函数会被 maxRetries 重试多次，每次重抽会让一关跨重试用到超过配额的类型，
    //   违背用户要求①「每关出现对应数量」。缺省时（被独立调用）才就地抽一次作兜底。
    var chokePlan = config._chokePlan || pickChokeTypes(config, !!config.isBossSlot);
    var struct = buildStructureCandidateFixed(n, config, chokePlan);
    timing.structureBuildMs = struct.structureBuildMs || 0;
    timing.obstacleSlotMs = struct.obstacleSlotMs || 0;
    if (!struct.ok) {
      timing.candidatePrepareMs = Date.now() - tAll; timing.candidateTotalMs = timing.candidatePrepareMs;
      return { ok: false, reason: struct.reason || 'struct', detail: struct.detail || '', timing: timing, boxCount: n, blackStat: struct.blackStat, pipeStat: struct.pipeStat };
    }

    // ③ 填球 + 只绑定预定障碍 + 分阶段守恒
    var fill = fillStructureFixed(struct, boxes, baseline, config, timing);
    if (!fill.ok) {
      timing.candidatePrepareMs = Date.now() - tAll; timing.candidateTotalMs = timing.candidatePrepareMs;
      return {
        ok: false, reason: fill.reason, stage: fill.stage, detail: fill.detail || '',
        conservation: fill.conservation, bindStat: fill.bindStat, timing: timing, boxCount: n,
        blackStat: struct.blackStat, pipeStat: struct.pipeStat
      };
    }
    var board = fill.board;
    // 诊断信息随 board 带出：窄路是否真的落地、可用空间配额解。
    // 只供生产报告与验证观测，不参与任何生成决策，也不进官方关卡格式（toGameFormat 只取协议字段）。
    board.narrowStat = struct.narrowStat || null;
    board.spaceQuota = struct.spaceQuota || null;
    // 管道落位与兜底状态（ANT-GEN-PIPE-DEPTH-FALLBACK-20260825）：want/placed/capacityPerPipe
    // 以及 fallback* 标记。兜底是行为变更，必须可观测——否则"管道为什么只有 2 条"无从追溯。
    board.pipeStat = struct.pipeStat || null;

    // ④ 结构性卡死检验（带球后的完整检查）
    var tSdc = Date.now();
    var sdc = structuralDeadlockCheck(board);
    timing.structuralCheckMs = Date.now() - tSdc;
    if (!sdc.ok) {
      timing.candidatePrepareMs = Date.now() - tAll; timing.candidateTotalMs = timing.candidatePrepareMs;
      return {
        ok: false, reason: 'structuralCheck', detail: sdc.reason, timing: timing, boxCount: n,
        blackStat: struct.blackStat, pipeStat: struct.pipeStat, bindStat: fill.bindStat, conservation: fill.conservation
      };
    }

    // ⑤ 解析
    var level = { blocks: blocks, bufferLimit: config.bufferLimit, board: board };
    var tParse = Date.now();
    var parsed = AntSolver.parseLevel(level);
    timing.parseMs = Date.now() - tParse;
    timing.candidatePrepareMs = Date.now() - tAll;

    // ⑥ 1 遍基础贪心 + 最多 3 遍噪声，成功即停
    var boardSnapshot = { rows: board.rows, cols: board.cols, cells: AntSolver.deepClone(board.cells) };
    var screen = screenCandidateFixed(parsed, timing, config.bottomOnly, config.instantChain);
    timing.candidateBaseAttemptMs = timing.candidatePrepareMs + timing.baseSolveMs;
    timing.candidateTotalMs = Date.now() - tAll;

    if (!screen.ok) {
      var failRec = {
        reason: 'screen', inputId: opts.inputId || null, candidateId: opts.candidateId || null,
        seedInfo: SCREEN_PASSES_FIXED.map(function (p) { return { pass: p.key, noise: p.noise, seed: p.seed }; }),
        board: boardSnapshot, bufferLimit: config.bufferLimit,
        screenLogs: screen.logs,
        bestProgress: screen.result ? screen.result.progress : 0,
        bestMaxBuffer: screen.result ? screen.result.maxBuffer : 0,
        obstacleSummary: {
          ice: fill.bindStat.ice, question: fill.bindStat.question, chain: fill.bindStat.chain,
          black: struct.blackStat, pipe: struct.pipeStat
        },
        timing: timing
      };
      if (typeof opts.onScreenFail === 'function') { try { opts.onScreenFail(failRec); } catch (e) {} }
      return { ok: false, reason: 'screen', timing: timing, boxCount: n, screen: screen, failedCandidate: failRec, blackStat: struct.blackStat, pipeStat: struct.pipeStat, bindStat: fill.bindStat, conservation: fill.conservation };
    }

    // ⑦ 首轮基准解（卡点制造唯一依据）
    var baselineSolution = baselineSolutionFixed(boardSnapshot, parsed, screen.result, screen);
    // 检查点：最终输出前
    var tCons2 = Date.now();
    var cvOut = verifyConservation(baseline, scanBoardActual(board), 'output', 0);
    timing.conservationCheckMs += Date.now() - tCons2;
    fill.conservation.push(cvOut);
    if (!cvOut.ok) {
      return { ok: false, reason: 'conservation', stage: 'output', conservation: fill.conservation, timing: timing, boxCount: n };
    }

    return {
      ok: true, level: level, parsed: parsed, board: board, solveResult: screen.result,
      structural: sdc, screen: screen, baselineSolution: baselineSolution,
      conservationBaseline: baseline, conservation: fill.conservation,
      blackStat: struct.blackStat, pipeStat: struct.pipeStat, bindStat: fill.bindStat,
      obstacleSlots: { ice: struct.iceSlots, question: struct.questionSlots, chain: struct.chainGroups },
      // 卡点类型计划与实际落地统计（只进生产侧记录，不入关卡本体）
      chokePlan: chokePlan, chokeStat: struct.chokeStat || null,
      timing: timing, boxCount: n
    };
  }

  function newFlowStats() {
    return {
      attempts: 0, success: 0,
      fail: { baseline: 0, struct: 0, structSurplus: 0, structHoles: 0, structReach: 0, structPipeExit: 0, pipeCapacity: 0, pipeDepth: 0, rowTrim: 0, bind: 0, conservation: 0, structuralCheck: 0, screen: 0 },
      passHits: { base: 0, noise1: 0, noise2: 0, noise3: 0 },
      timings: [], failedCandidates: [], conservationFailures: [], bindFailures: []
    };
  }
  function mergeFlowStats(dst, src) {
    if (!src) return dst;
    dst.attempts += src.attempts; dst.success += src.success;
    for (var k in src.fail) dst.fail[k] = (dst.fail[k] || 0) + src.fail[k];
    for (var p in src.passHits) dst.passHits[p] += src.passHits[p];
    dst.timings = dst.timings.concat(src.timings);
    dst.failedCandidates = dst.failedCandidates.concat(src.failedCandidates);
    dst.conservationFailures = dst.conservationFailures.concat(src.conservationFailures);
    dst.bindFailures = dst.bindFailures.concat(src.bindFailures);
    return dst;
  }
  function recordAttempt(stats, res) {
    stats.attempts++;
    stats.timings.push(res.timing);
    if (res.ok) {
      stats.success++;
      var pk = res.screen.passKey;
      if (stats.passHits[pk] != null) stats.passHits[pk]++;
      return;
    }
    var key = res.reason || 'struct';
    stats.fail[key] = (stats.fail[key] || 0) + 1;
    if (key === 'conservation') stats.conservationFailures.push({ stage: res.stage, reasons: (res.conservation || []).filter(function (x) { return !x.ok; }) });
    if (key === 'bind') stats.bindFailures.push(res.bindStat);
    if (res.failedCandidate) stats.failedCandidates.push(res.failedCandidate);
  }

  /**
   * 纠偏版单候选入口（对应旧 generateFromBlocks）：4 遍全败即【淘汰整个候选】重建，
   * 不在同一失败结构上无限换填球路线，也不在 4 遍失败后直接进入卡点制造。
   */
  function generateFromBlocksFixed(blocks, config, opts) {
    config = Object.assign({}, DEFAULT_CONFIG, config || {});
    opts = opts || {};
    GENPERF.generateCalls++;
    var deadlineAt = config._deadlineAt || 0;
    var maxRetries = Math.max(1, config.maxRetries || 5);
    var stats = newFlowStats();
    var last = null;
    // 【聚集类卡点的可解性回退】ANT-GEN-CHOKE-TYPES-20260824。
    //   聚集会显著提高结构失败率——实测 chainCluster（允许锁链组间 8-邻接）单开时产出率从 3/3 掉到 1/3，
    //   且 0.5s 内就失败，说明挂在结构阶段（组间贴死导致 plannedChainActivatable / structuralDeadlockCheck 不过）。
    //   因此：首次尝试用完整计划；一旦失败，后续重试【按风险从高到低逐个摘掉】聚集类型，
    //   最终退回无聚集的原行为，保证不会因为开了聚集就产不出关。
    //   摘掉的类型如实记进 chokeFallback，不静默吞掉。
    var RISK_ORDER = ['chainCluster', 'pipeChain', 'iceCluster', 'questionCluster', 'chainIce'];
    var basePlan = config._chokePlan || pickChokeTypes(config, !!config.isBossSlot);
    var chokeFallback = { dropped: [], attempts: [] };
    for (var attempt = 0; attempt < maxRetries; attempt++) {
      if (attempt > 0 && deadlineAt && Date.now() >= deadlineAt) break;
      // 第 attempt 次尝试：摘掉风险序列里前 attempt 个仍在计划中的聚集类型
      var attemptPlan = basePlan;
      if (attempt > 0 && basePlan && basePlan.types && basePlan.types.length) {
        var dropSet = {}, dropped = 0;
        for (var ri = 0; ri < RISK_ORDER.length && dropped < attempt; ri++) {
          if (basePlan.has[RISK_ORDER[ri]]) { dropSet[RISK_ORDER[ri]] = 1; dropped++; }
        }
        if (dropped > 0) {
          var keptK = [], keptCN = [], keptHas = {};
          for (var ti = 0; ti < basePlan.types.length; ti++) {
            if (dropSet[basePlan.types[ti]]) continue;
            keptK.push(basePlan.types[ti]); keptCN.push(basePlan.cn[ti]); keptHas[basePlan.types[ti]] = true;
          }
          attemptPlan = { types: keptK, cn: keptCN, has: keptHas, count: keptK.length, isBoss: basePlan.isBoss, pool: basePlan.pool };
          chokeFallback.dropped = Object.keys(dropSet);
        }
      }
      chokeFallback.attempts.push({ attempt: attempt + 1, types: attemptPlan.types.slice() });
      config = Object.assign({}, config, { _chokePlan: attemptPlan });
      GENPERF.boardBuilds++;
      var tb = Date.now();
      var res = buildOneCandidateAttempt(blocks, config, {
        inputId: opts.inputId || null,
        candidateId: (opts.candidateId || 'cand') + '-a' + (attempt + 1),
        onScreenFail: opts.onScreenFail
      });
      GENPERF.boardMs += Date.now() - tb;
      recordAttempt(stats, res);
      last = res;
      if (!res.ok) continue;
      var ge = evaluateGeneration(res.solveResult, res.parsed, config);
      var diff = computeDifficulty(res.solveResult, res.parsed, config, ge);
      return {
        level: res.level, valid: true, solveResult: res.solveResult, difficulty: diff,
        generationEval: ge, config: config, retries: attempt, structural: res.structural,
        flow: 'new_fixed', flowStats: stats, candidateTiming: res.timing,
        baselineSolution: res.baselineSolution, conservation: res.conservation,
        blackStat: res.blackStat, pipeStat: res.pipeStat, bindStat: res.bindStat,
        obstacleSlots: res.obstacleSlots,
        // 卡点类型计划与落地统计（只进生产侧记录，不入关卡本体）
        chokePlan: res.chokePlan || null, chokeStat: res.chokeStat || null,
        // 回退记录：哪些聚集类型因结构失败被摘掉（如实记录，便于统计"想开但开不起来"的类型）
        chokeFallback: chokeFallback.dropped.length ? chokeFallback : null
      };
    }
    return {
      level: null, valid: false, solveResult: last ? (last.screen ? last.screen.result : null) : null,
      difficulty: null, config: config, retries: maxRetries,
      structural: { ok: false, reason: last ? ('候选淘汰：' + last.reason + (last.detail ? '(' + last.detail + ')' : '')) : '无有效候选' },
      flow: 'new_fixed', flowStats: stats, candidateTiming: last ? last.timing : null,
      lastFailReason: last ? last.reason : null
    };
  }

  /**
   * 纠偏版卡点变体：只在首轮基准解成功后进入；round≥2 的重生成分支走纠偏版(不回退旧实现)。
   * 卡点完成后以【卡点前棋盘实况】为独立基线再做一次守恒比对——卡点手段只换色/量与容量，
   * 总盒数与分色总量必须不变，若变化必为缺陷。
   */
  function makeChokeVariantFixed(parent, blocks, config, round, flowStats) {
    if (round >= 2 && parent.audit && Math.random() < 0.3) {
      var pa = applyPressureAdjust(config, parent.audit, parent.level.bufferLimit);
      GENPERF.regenVariants++;
      var regen = generateFromBlocksFixed(blocks, Object.assign({}, pa.cfg, { maxRetries: 2, candidateCount: 1 }));
      if (flowStats && regen.flowStats) mergeFlowStats(flowStats, regen.flowStats);
      return regen.valid ? tagAudit(regen) : null;
    }
    var pb = parent.level.board;
    var preChoke = scanBoardActual(pb);   // 卡点前实况 = 本次比对的独立基线
    var level = { blocks: parent.level.blocks, bufferLimit: parent.level.bufferLimit, board: { rows: pb.rows, cols: pb.cols, cells: AntSolver.deepClone(pb.cells) } };
    // 诊断数据透传（沿用 obstacleSlots 的既有口径，用户 2026-08-03 已批准该模式）：
    //   卡点制造只改盒的 color/count，管道坐标、条数、深度上限一律不动，
    //   故父候选的 pipeStat/narrowStat/spaceQuota 对卡点后棋盘依然成立。
    //   不带下来的后果：约 36%~50% 的关最终 board 来自卡点变体，这些关的「管道落了几条、
    //   是否走了兜底」会全部丢失（§12.8 记录的 narrowStat 不可观测就是同一成因）。
    //   本轮新增的管道兜底是行为变更，必须可追溯，因此一并透传。只作观测，不参与任何生成决策。
    level.board.pipeStat = pb.pipeStat || null;
    level.board.narrowStat = pb.narrowStat || null;
    level.board.spaceQuota = pb.spaceQuota || null;
    var startFrac = (config.swapRegionMin != null ? config.swapRegionMin : 50) / 100;
    var basePick = (parent.baselineSolution && parent.baselineSolution.pickOrder) || (parent.solveResult && parent.solveResult.pickOrder) || [];
    if (!basePick.length) return null;                       // 无基准解不允许随机换球
    var targets = lateRouteBoxes(level.board, basePick, startFrac);
    if (!targets.length) return null;
    if (!applyOneChoke(level.board, targets, config, basePick, level.blocks)) return null;
    if (round >= 2) applyOneChoke(level.board, targets, config, basePick, level.blocks);
    // 检查点5：卡点制造完成（基线=卡点前实况，被检查对象=卡点后实况，来源独立）
    var postChoke = scanBoardActual(level.board);
    var chokeReasons = [];
    if (postChoke.boardBoxCount !== preChoke.boardBoxCount) chokeReasons.push('棋盘盒数 ' + preChoke.boardBoxCount + '→' + postChoke.boardBoxCount);
    if (postChoke.pipeBoxCount !== preChoke.pipeBoxCount) chokeReasons.push('管道盒数 ' + preChoke.pipeBoxCount + '→' + postChoke.pipeBoxCount);
    for (var col in preChoke.colorCountSum) {
      if ((postChoke.colorCountSum[col] || 0) !== preChoke.colorCountSum[col])
        chokeReasons.push('色' + col + 'count总和 ' + preChoke.colorCountSum[col] + '→' + (postChoke.colorCountSum[col] || 0));
    }
    for (var col2 in postChoke.colorCountSum) {
      if (preChoke.colorCountSum[col2] == null) chokeReasons.push('卡点后出现新颜色' + col2);
    }
    if (chokeReasons.length) {
      if (flowStats) { flowStats.fail.conservation++; flowStats.conservationFailures.push({ stage: 'choke', reasons: [{ ok: false, stage: 'choke', reasons: chokeReasons }] }); }
      return null;
    }
    if (!structuralDeadlockCheck(level.board).ok) return null;
    var parsed = AntSolver.parseLevel(level);
    // 卡点分支重求解必须与候选筛选/最终审核同一入口模式与消除口径，
    // 否则卡点是按一种规则制造的、审核却按另一种判。
    var r = AntSolver.Solver.solve(parsed, { capturePreviewStats: true, bottomOnly: !!config.bottomOnly, instantChain: !!config.instantChain });
    if (!r.completed) return null;
    var ge = evaluateGeneration(r, parsed, config);
    return {
      level: level, valid: true, solveResult: r, generationEval: ge, audit: ge.omni.audit,
      difficulty: computeDifficulty(r, parsed, config, ge), config: config,
      flow: 'new_fixed', chokeRound: round,
      baselineSolution: parent.baselineSolution,
      conservation: [{ ok: true, stage: 'choke', reasons: [] }],
      // 【2026-08-03 只透传诊断数据，不参与生成】把父候选的障碍预定位置（含冰块的 base/narrowGap 来源标记）
      // 原样带下来。依据：卡点制造只 clone 父棋盘后交换/搬移盒的 color 与 count（chokeSwap/chokeInflate
      // 只写 .color/.count，对 .ice/.q/.chain 仅作过滤条件读取、从不写入），障碍位置与属性完全不变，
      // 因此父候选的这份预定位置对卡点后的棋盘依然成立。
      // 不带出来的后果：下游（关卡图修改工具的障碍参数核对）无法区分「按比例设定的冰块」与
      // 「窄路缺口自带的冰块」，冰块一项只能标为不做判定。
      // 授权：Codex 复审 2026.08.03 §P2 建议 + 用户 2026-08-03 明确批准（只保留上游已有信息，
      // 不重算冰块、不改冰块位置、不改卡点制造、不改求解器）。
      obstacleSlots: parent.obstacleSlots || null,
      blackStat: parent.blackStat || null, pipeStat: parent.pipeStat || null, bindStat: parent.bindStat || null,
      // 【2026-08-24 同理透传卡点类型计划】卡点变体只 clone 父棋盘后改盒的 color/count，
      // 不动 ice/chain/q 的位置与属性，故父候选的结构类卡点（冰簇/链簇/问号簇/冰叠链/管道口叠链）依然成立。
      // 不带出来的后果：约 36%~50% 的最终 board 来自变体（与 narrowStat 丢失是同一原因），
      // 那些关就统计不到用了哪些卡点类型，多样性无法度量——这正是本轮要解决的问题，不能自己再制造一个盲区。
      chokePlan: parent.chokePlan || null, chokeStat: parent.chokeStat || null
    };
  }

  /**
   * 纠偏版生产总入口（对应旧 produce）。K 候选 × B 分支 × N 轮，合格即停，超时兜底。
   * 与旧版差异仅在候选生成与筛选路径；合格门、审核、难度、兜底口径完全复用同一套函数。
   */
  function produceFixed(blocks, config, opts) {
    config = Object.assign({}, DEFAULT_CONFIG, config || {});
    opts = opts || {};
    var K = Math.max(1, config.candidateCount || 1);
    var B = Math.max(1, config.chokeBranches || 3);
    var N = Math.max(0, config.rounds != null ? config.rounds : 2);
    var budget = config.timeBudgetMs != null ? config.timeBudgetMs : 300000;
    var requireHard = !!config.requireHardPass;
    var t0 = Date.now(), timedOut = false;
    // 【仅底部入口】生产前门：源图在底部规则下若有永久不可达像素，直接判"结构不适配"，
    //   不进入候选生成，也不消耗时间预算——避免把源图问题误报成生成器超时(原需求 §四)。
    // 瞬时连锁模式固定四方向，不存在「只与顶/左/右背景连通的空腔永远打不通」这个底部专有风险，
    // 因此不跑底部专用前门；同时强制关掉 bottomOnly，避免两个开关同时为真导致口径混乱。
    if (config.instantChain && config.bottomOnly) config = Object.assign({}, config, { bottomOnly: false });
    if (config.bottomOnly && !config.instantChain) {
      var feas = checkBottomEntryFeasibility(blocks);
      if (!feas.ok) {
        return {
          level: null, valid: false, flow: 'new_fixed',
          entryMode: 'bottomOnly',
          bottomEntryFeasibility: feas,
          timedOut: false, elapsedMs: Date.now() - t0, candidates: 0, treeEvaluated: 0,
          structural: { ok: false, reason: 'bottomEntryInfeasible：' + feas.detail },
          lastFailReason: 'bottomEntryInfeasible'
        };
      }
    }
    // 【碎色前置闸门】任务 ANT-GEN-FRAGMENT-GATE-20260824，用户 2026-08-24 批准。
    //   与上面的底部入口前门同一位置、同一模式：在生成候选【之前】判定源图是否适合生产，
    //   被卡的图直接返回、【不消耗时间预算】、不产出任何关卡结构（绝不造假关）。
    //   fragmentMaxRate<=0 时整段跳过，行为与本参数引入前完全一致。
    var fragGate = checkFragmentGate(blocks, config);
    if (!fragGate.ok) {
      return {
        level: null, valid: false, flow: 'new_fixed',
        entryMode: (config.instantChain ? 'fourSideInstantChain' : (config.bottomOnly ? 'bottomOnly' : 'fourSide')),
        fragmentGate: fragGate,
        timedOut: false, elapsedMs: Date.now() - t0, candidates: 0, treeEvaluated: 0,
        structural: { ok: false, reason: 'fragmentGateBlocked：' + fragGate.detail },
        lastFailReason: 'fragmentGateBlocked'
      };
    }
    // 【卡点类型计划】每关抽一次，经 config._chokePlan 透传给候选层与卡点变体层。
    //   在这里抽而不在候选层抽的理由：候选层会被 maxRetries 重试、K 个候选各跑一遍，
    //   逐次重抽会让同一关累计用到远超配额的类型，违背用户要求①（每关按数量）与②（不重合）。
    var levelChokePlan = pickChokeTypes(config, !!config.isBossSlot);
    config = Object.assign({}, config, { _chokePlan: levelChokePlan });
    resetGenPerf();
    if (AntSolver.Solver && AntSolver.Solver.resetPerf) AntSolver.Solver.resetPerf();
    if (AntSolver.PlayerSim && AntSolver.PlayerSim.resetPerf) AntSolver.PlayerSim.resetPerf();
    var deadlineAt = budget > 0 ? t0 + budget : 0;
    if (deadlineAt) config = Object.assign({}, config, { _deadlineAt: deadlineAt });
    function timeUp() { if (budget > 0 && (Date.now() - t0) >= budget) { timedOut = true; return true; } return false; }
    var flowStats = newFlowStats();
    var best = null, evaluated = 0;
    function consider(c) { if (c) { evaluated++; if (candBetter(c, best)) best = c; } return c; }
    function done(c) {
      if (c) { c.timedOut = timedOut; c.elapsedMs = Date.now() - t0; }
      GENPERF.totalMs = Date.now() - t0;
      if (!GENPERF.stopReason) {
        GENPERF.stopReason = timedOut ? 'budget_timeout' : (c ? (candPass(c, requireHard) ? 'pass_early_stop' : 'exhausted') : 'no_candidate');
      }
      var out = finalizeProduce(c, K, evaluated);
      if (!out) {
        return {
          level: null, valid: false, flow: 'new_fixed', flowStats: flowStats,
          timedOut: timedOut, elapsedMs: Date.now() - t0, candidates: K, treeEvaluated: evaluated,
          // 失败也要带出本关抽了哪些卡点类型——否则「开了类型后产不出关」时无从判断是哪种类型导致，
          // 会变成又一个观测盲区。
          chokePlan: levelChokePlan, lastFailReason: 'noCandidate',
          perf: getGenPerf()
        };
      }
      out.flow = 'new_fixed';
      if (!out.chokePlan) out.chokePlan = levelChokePlan;   // 变体分支未透传时兜底补上
      out.flowStats = flowStats;
      out.perf = getGenPerf();
      out.perf.solver = (AntSolver.Solver && AntSolver.Solver.getPerf) ? AntSolver.Solver.getPerf() : null;
      out.perf.playerSim = (AntSolver.PlayerSim && AntSolver.PlayerSim.getPerf) ? AntSolver.PlayerSim.getPerf() : null;
      out.perf.evaluatedPositions = evaluated;
      out.perf.config = { candidateCount: K, chokeBranches: B, rounds: N, timeBudgetMs: budget, requireHardPass: requireHard };
      return out;
    }
    for (var k = 0; k < K; k++) {
      if (timeUp()) break;
      GENPERF.baseCandidates++;
      var base = tagAudit(generateFromBlocksFixed(blocks, config, {
        inputId: opts.inputId || null, candidateId: 'K' + (k + 1), onScreenFail: opts.onScreenFail
      }));
      mergeFlowStats(flowStats, base.flowStats);
      if (!base.valid) continue;
      consider(base);
      if (candPass(base, requireHard)) return done(base);
      var layer = [base];
      for (var round = 1; round <= N && layer.length; round++) {
        if (timeUp()) break;
        var next = [];
        for (var li = 0; li < layer.length; li++) {
          if (timeUp()) break;
          for (var b = 0; b < B; b++) {
            if (timeUp()) break;
            GENPERF.chokeVariants++;
            var child = makeChokeVariantFixed(layer[li], blocks, config, round, flowStats);
            if (!child) continue;
            consider(child);
            if (candPass(child, requireHard)) return done(child);
            next.push(child);
          }
        }
        layer = next;
      }
      if (timeUp()) break;
    }
    return done(best);
  }

  function auditFor(solveResult, parsed, bufferLimit) {
    if (!AntSolver.Analysis || !AntSolver.Analysis.chokepointAudit) return null;
    return AntSolver.Analysis.chokepointAudit((solveResult && solveResult.pressureSamples) || [], parsed.totalBoxes, bufferLimit);
  }
  // 审核评分(越大越好)：后期高压封顶奖励 − 前中期越界惩罚 + 合格大奖；用于爬山接受判定
  function auditScoreOf(a, bufferLimit) {
    if (!a) return -1e9;
    var high = bufferLimit - 1.5, mid = bufferLimit - 2.5;
    var s = Math.min(a.lateMax, high);
    s -= Math.max(0, a.earlyMax - mid) * 3;
    s -= Math.max(0, a.midMax - high) * 3;
    // 暂存峰值触达上限=死亡边界(真人必死)：重罚，引导爬山把压力顶高但【留 ≥1 空位余量】
    if ((a.peakBuf || 0) >= bufferLimit) s -= 50;
    if (a.pass) s += 100;
    return s;
  }

  function averageSampleBuffer(samples) {
    if (!samples || !samples.length) return 0;
    var sum = 0;
    for (var i = 0; i < samples.length; i++) sum += samples[i].buf || 0;
    return +(sum / samples.length).toFixed(2);
  }

  /**
   * 生成专用统一诊断：对【完整棋盘】运行严格全知版和严格玩家版，合并暂存、封锁与结构来源。
   * 完整棋盘已经包含尺寸、冰/链/问号、换球、管道、分散黑块和窄路墙，因此这些结构的真实影响
   * 统一反映在两侧 pressureSamples / lockRatio 中；不修改 Analysis.difficulty 的既有权重。
   */
  function evaluateGeneration(solveResult, parsed, config) {
    GENPERF.evalCalls++;                           // 埋点：生成评价次数(内含玩家模拟)
    var _te = Date.now();
    try { return _evaluateGenerationInner(solveResult, parsed, config); }
    finally { GENPERF.evalMs += Date.now() - _te; }
  }
  function _evaluateGenerationInner(solveResult, parsed, config) {
    var totalBoxes = parsed.totalBoxes || 0, limit = parsed.bufferLimit || 5;
    var omniSamples = (solveResult && solveResult.pressureSamples) || [];
    var omniAudit = auditFor(solveResult, parsed, limit);
    var omniPreview = AntSolver.Analysis && AntSolver.Analysis.dynamicPreviewMetrics
      ? AntSolver.Analysis.dynamicPreviewMetrics(omniSamples, totalBoxes) : null;
    var playerResult = null;
    try {
      // 玩家模拟与全知求解必须同一入口模式与消除口径，否则"全知一套、玩家另一套"，审核与难度结论不可用。
      if (AntSolver.PlayerSim) playerResult = AntSolver.PlayerSim.run(parsed, { seed: 7, useItems: false, capturePreviewStats: true, bottomOnly: !!(config && config.bottomOnly), instantChain: !!(config && config.instantChain) });
    } catch (e) { playerResult = null; }
    var playerSamples = playerResult ? (playerResult.pressureSamples || []) : [];
    var playerAudit = AntSolver.Analysis && AntSolver.Analysis.chokepointAudit
      ? AntSolver.Analysis.chokepointAudit(playerSamples, totalBoxes, limit) : null;
    var playerPreview = AntSolver.Analysis && AntSolver.Analysis.dynamicPreviewMetrics
      ? AntSolver.Analysis.dynamicPreviewMetrics(playerSamples, totalBoxes) : null;
    var omniAvg = averageSampleBuffer(omniSamples), playerAvg = averageSampleBuffer(playerSamples);
    var obstacles = AntSolver.Analysis && AntSolver.Analysis.obstacleStats ? AntSolver.Analysis.obstacleStats(parsed) : {};
    var evaluation = {
      omni: {
        won: !!(solveResult && solveResult.completed), avgBuffer: omniAvg,
        peak: solveResult ? (solveResult.maxBuffer || 0) : 0,
        audit: omniAudit, preview: omniPreview, pressureSamples: omniSamples
      },
      player: {
        // avgBuffer 仍是【完成事件轴】均值（pressureSamples 口径），保留原语义——
        // 它与 pressureOffset、卡点审核同源，改动会牵动合格门。
        won: !!(playerResult && playerResult.won), avgBuffer: playerAvg,
        peak: playerResult ? (playerResult.bufferPeak || 0) : 0,
        audit: playerAudit, preview: playerPreview, pressureSamples: playerSamples,
        progress: playerResult ? playerResult.progress : 0,
        misjudge: playerResult ? playerResult.misjudge : 0,
        revives: playerResult ? (playerResult.revivesUsed || 0) : 0,
        reviveCap: playerResult ? (playerResult.reviveCap != null ? playerResult.reviveCap : 2) : 2,
        // ---- v4 难度评分口径（需求 §3/§4/§5）：操作 tick 轴，独立于上面的完成事件轴 ----
        avgBufferTick: playerResult ? (playerResult.playerAvgBuffer || 0) : 0,   // f1 源
        avgResidence: playerResult ? (playerResult.avgResidence || 0) : 0,        // f2 源
        effectiveTicks: playerResult ? (playerResult.effectiveTicks || 0) : 0,
        residenceCount: playerResult ? (playerResult.residenceCount || 0) : 0,
        stalledAtEnd: playerResult ? (playerResult.stalledAtEnd || 0) : 0,
        tickTrajectory: playerResult ? (playerResult.tickTrajectory || []) : [],
        reviveEvents: playerResult ? (playerResult.reviveEvents || []) : [],
        elimMode: playerResult ? (playerResult.elimMode || 'fourSide') : 'fourSide'
      },
      pressureOffset: +(Math.max(0, playerAvg - omniAvg)).toFixed(2),
      sources: {
        board: { rows: parsed.board.rows, cols: parsed.board.cols, area: parsed.board.rows * parsed.board.cols },
        obstacles: obstacles,
        walls: { blackPercent: config.blackPercent || 0, narrowPath: !!config.narrowPath, gapMin: config.narrowPathGapsMin || 0, gapMax: config.narrowPathGapsMax || 0 }
      }
    };
    // 合格 = 全知可解 + 玩家版≤2复活通关(player.won 已含 reviveCap=2) + 压力曲线可用 + 全知未触死亡边界。
    // 注：玩家峰值可触暂存上限(有复活道具兜底)，不再作为不合格条件。
    //
    // v104 合格门语义重置（ANT-GEN-AUDIT-RESET-20260824）：
    //   压力曲线可用 = audit.usable = curveOK(有实际卡点) || flatTrend(趋势过平但不过压)。
    //   与旧写法 (pass || easyPass) **逐关等价**（347 关求解数据实测 347/347 一致），故产能不变。
    //   档次字样改为「合格 / 简单关·趋势过平 / 不合格」——难易分档不再由审核给，交给难度分。
    var curveUsable = omniAudit ? (omniAudit.usable != null ? omniAudit.usable : (omniAudit.pass || omniAudit.easyPass)) : false;
    evaluation.pass = !!(evaluation.omni.won && evaluation.player.won && curveUsable &&
      evaluation.omni.peak < limit);
    evaluation.tier = omniAudit ? (omniAudit.tier || '不合格') : '不合格';
    // 是否占「简单关名额」：趋势过平的关卡仍可用，但归入简单关配额（用户 2026-08-24 纠正）
    evaluation.easyQuota = !!(omniAudit && (omniAudit.easyQuota != null ? omniAudit.easyQuota : omniAudit.easyPass));
    evaluation.hasEffectiveChoke = !!(omniAudit && omniAudit.pass);
    evaluation.score = generationScore(evaluation, limit);
    return evaluation;
  }

  /**
   * 生产选择分：原暂存审核仍是主项，动态封锁只奖励“后期形成、前期不过早”的结构；
   * 玩家失败或任一侧触达暂存上限会被重罚。该分数仅用于候选/强化排序，不写入难度权重。
   */
  function generationScore(evaluation, bufferLimit) {
    if (!evaluation) return -1e9;
    var op = evaluation.omni.preview || {}, pp = evaluation.player.preview || {};
    var score = auditScoreOf(evaluation.omni.audit, bufferLimit);
    score += (op.lateAvgLockRatio || 0) * 18 - (op.earlyAvgLockRatio || 0) * 12;
    score += (pp.lateAvgLockRatio || 0) * 22 - (pp.earlyAvgLockRatio || 0) * 16;
    score += Math.min(2, evaluation.pressureOffset || 0) * 4;
    // 玩家门：≤reviveCap(默认2)次复活通关即合格；合格里【复活次数越少越优】(0>1>2)，"最优一次就过"。
    if (evaluation.player.won) {
      var cap = evaluation.player.reviveCap != null ? evaluation.player.reviveCap : 2;
      var used = evaluation.player.revives || 0;
      score += 20 + Math.max(0, cap - used) * 10;   // 0次=+40 1次=+30 2次=+20
    } else {
      score -= 200;
    }
    if ((evaluation.omni.peak || 0) >= bufferLimit) score -= 80;
    if ((evaluation.player.peak || 0) >= bufferLimit) score -= 80;
    if (evaluation.pass) score += 120;
    return +score.toFixed(3);
  }
  // 后期[startFrac,1]被取的【无障碍普通盒】坐标(去重)——扰动目标集中在后期段制造卡点
  function lateRouteBoxes(board, pickOrder, startFrac) {
    var out = [], seen = {}, total = (pickOrder || []).length;
    for (var i = Math.floor(total * startFrac); i < total; i++) {
      var p = pickOrder[i]; if (!p || p.r == null) continue;
      var key = p.r + ',' + p.c; if (seen[key]) continue;
      var cell = board.cells[p.r] && board.cells[p.r][p.c];
      if (cell && cell.t === 'box' && !cell.ice && !cell.chain && !cell.q) { seen[key] = 1; out.push({ r: p.r, c: p.c }); }
    }
    return out;
  }
  // 增减压(第二轮修复)：据审核诊断调障碍基础参数——前/中期过压→减压(降障碍)，后期欠压(无高压卡点)→增压(升障碍)。
  //   每级 5%(锁链±1对)，调用方 clamp 累进至 ±3 级(总波动 30%)。返回 {cfg:调整后副本, dir:方向(-1减/0不动/+1增)}。
  function applyPressureAdjust(config, audit, bufferLimit) {
    if (!audit) return { cfg: config, dir: 0 };
    var high = bufferLimit - 1.5, mid = bufferLimit - 2.5, dir = 0;
    if ((audit.earlyMax || 0) >= mid || (audit.midMax || 0) >= high) dir = -1;   // 前/中期过压 → 减压
    else if ((audit.lateMax || 0) < high) dir = 1;                               // 后期欠压(无卡点) → 增压
    if (dir === 0) return { cfg: config, dir: 0 };
    var f = 1 + dir * 0.05, adj = Object.assign({}, config);
    ['icePercent', 'questionPercent', 'blackPercent'].forEach(function (k) {
      if (typeof adj[k] === 'number') adj[k] = Math.max(0, Math.round(adj[k] * f));
    });
    if (typeof adj.chainCount === 'number') adj.chainCount = Math.max(0, adj.chainCount + dir);
    if (typeof adj.swapRatio === 'number') adj.swapRatio = Math.max(0, Math.min(1, adj.swapRatio + dir * 0.05));
    return { cfg: adj, dir: dir };
  }


  /**
   * 生产主入口（P3 BxN 卡点树，取代老版爬山强化 `strengthenLevel`，已退役删除）：K 候选，每候选初生成(合法性门)
   * → 未合格则展开 B 分支 × N 轮 卡点制造树(换球/增容 + round≥2 增减压重生成)
   * → 任一变体审核合格即停输出；全程无合格则兜底输出最接近合格者。返回同 generateFromBlocks 形状 + {audit,candidates,treeEvaluated}。
   * 时间预算(config.timeBudgetMs，默认5分钟，0=不限时)：到点仍未合格 → 立即停止搜索，兜底输出树内已评估过的
   *   【最接近合格】候选(按 candScore 排序，同旧兜底逻辑)，并标记 timedOut=true。
   * 严格卡点门(config.requireHardPass，默认false)：true 时【简单合格(趋势符合，无实际卡点)】不算数、不早停，
   *   继续搜索直到拿到【困难合格(真实卡点)】或超时兜底——供批量生产按比例分配"简单/困难"关卡用。
   */
  function produce(blocks, config) {
    config = Object.assign({}, DEFAULT_CONFIG, config || {});
    var K = Math.max(1, config.candidateCount || 1);
    var B = Math.max(1, config.chokeBranches || 3);
    var N = Math.max(0, config.rounds != null ? config.rounds : 2);
    var budget = config.timeBudgetMs != null ? config.timeBudgetMs : 300000;   // 默认5分钟；0/负=不限时
    var requireHard = !!config.requireHardPass;
    var t0 = Date.now(), timedOut = false;
    // 【仅底部入口】生产前门（同 produceFixed；D2：旧流程一并对齐）。
    if (config.bottomOnly) {
      var feasOld = checkBottomEntryFeasibility(blocks);
      if (!feasOld.ok) {
        return {
          level: null, valid: false, flow: 'old',
          entryMode: 'bottomOnly',
          bottomEntryFeasibility: feasOld,
          timedOut: false, elapsedMs: Date.now() - t0, candidates: 0, treeEvaluated: 0,
          structural: { ok: false, reason: 'bottomEntryInfeasible：' + feasOld.detail },
          lastFailReason: 'bottomEntryInfeasible'
        };
      }
    }
    // 性能埋点(阶段1)：每关开始清零本关计数器（生成器/求解器/玩家模拟三处），收尾在 done() 里取快照。
    resetGenPerf();
    if (AntSolver.Solver && AntSolver.Solver.resetPerf) AntSolver.Solver.resetPerf();
    if (AntSolver.PlayerSim && AntSolver.PlayerSim.resetPerf) AntSolver.PlayerSim.resetPerf();
    var deadlineAt = budget > 0 ? t0 + budget : 0;
    if (deadlineAt) config = Object.assign({}, config, { _deadlineAt: deadlineAt });   // 透传给 generateFromBlocks 的内部重试循环，防止单次调用把总预算顶爆
    function timeUp() { if (budget > 0 && (Date.now() - t0) >= budget) { timedOut = true; return true; } return false; }
    var best = null, evaluated = 0;
    // 注：best===null 时也要能被首个候选替换掉——即便该候选分数是 -1e9(如完全不可解)，也比"什么都没有"强，
    //   否则超时/全程无候选可解时会兜底成 null(等价于交付空关卡)，而不是"最接近标准的那个"。
    // 兜底选择严格按【三档优先级】(candBetter 内 tierOf 分档，档内再用 candScore 排序)：
    //   ①困难合格(真实卡点) > ②简单合格(趋势符合) > ③安全兜底(至少双方可通关，不触死亡边界=最差也要像"简单关")。
    function consider(c) { if (c) { evaluated++; if (candBetter(c, best)) best = c; } return c; }
    // done()：收尾时补齐性能埋点快照(停止原因 + 总耗时 + 求解/玩家模拟计数)，挂到结果的 perf 字段。
    //   纯记录，不影响 finalizeProduce 的档次判定与兜底选择。
    function done(c) {
      if (c) { c.timedOut = timedOut; c.elapsedMs = Date.now() - t0; }
      GENPERF.totalMs = Date.now() - t0;
      if (!GENPERF.stopReason) {
        GENPERF.stopReason = timedOut ? 'budget_timeout' : (c ? (candPass(c, requireHard) ? 'pass_early_stop' : 'exhausted') : 'no_candidate');
      }
      var out = finalizeProduce(c, K, evaluated);
      if (out) {
        out.perf = getGenPerf();
        out.perf.solver = (AntSolver.Solver && AntSolver.Solver.getPerf) ? AntSolver.Solver.getPerf() : null;
        out.perf.playerSim = (AntSolver.PlayerSim && AntSolver.PlayerSim.getPerf) ? AntSolver.PlayerSim.getPerf() : null;
        out.perf.evaluatedPositions = evaluated;
        out.perf.config = { candidateCount: K, chokeBranches: B, rounds: N, timeBudgetMs: budget, requireHardPass: requireHard };
      }
      return out;
    }
    // K 个候选，各初生成(合法性门)；未合格则展开 B 分支 × N 轮 卡点制造树；任一变体合格即停；超时随时兜底退出。
    for (var k = 0; k < K; k++) {
      if (timeUp()) break;
      GENPERF.baseCandidates++;                    // 埋点：基础候选数
      var base = tagAudit(generateFromBlocks(blocks, config));
      consider(base);
      if (candPass(base, requireHard)) return done(base);   // 初生成即合格
      if (!base.valid) continue;                                        // 不可解候选不展开树
      var layer = [base];
      for (var round = 1; round <= N && layer.length; round++) {
        if (timeUp()) break;
        var next = [];
        for (var li = 0; li < layer.length; li++) {
          if (timeUp()) break;
          for (var b = 0; b < B; b++) {
            if (timeUp()) break;
            GENPERF.chokeVariants++;               // 埋点：卡点变体数
            var child = makeChokeVariant(layer[li], blocks, config, round);
            if (!child) continue;
            consider(child);
            if (candPass(child, requireHard)) return done(child);   // 合格即停
            next.push(child);
          }
        }
        layer = next;
      }
      if (timeUp()) break;
    }
    return done(best);   // 全程无合格/超时 → 兜底输出最接近合格者
  }

  // ---- P3 卡点树辅助 ----
  function candScore(c) { return (c && c.generationEval) ? c.generationEval.score : (c && c.audit ? auditScoreOf(c.audit, c.level.bufferLimit) : -1e9); }
  // 兜底/候选优先级分档(0=最差…3=最好)：只依据【审核压力曲线 tier + 双方是否可通关】，不掺难度分(难度分是独立的第二套指标，见 §生产审核评分体系.md)。
  //   3=困难合格(真实卡点) / 2=简单合格(趋势符合) / 1=安全兜底(全知+玩家均可通关、未触死亡边界，但压力曲线未达标——至少是能玩的关) / 0=其余(不可解/玩家打不通/触死亡边界)。
  // 3/2 档【同时要求】双方可通关(与 evaluateGeneration.pass 的门槛口径一致)——压力曲线再漂亮，玩家实际打不通就不算"合格"，只能降到 1 档兜底。
  function candTier(c) {
    if (!c || !c.valid) return 0;
    var ge = c.generationEval, a = c.audit;
    var deliverable = !!(ge && ge.omni && ge.omni.won && ge.player && ge.player.won && ge.omni.peak < c.level.bufferLimit);
    if (deliverable && a && a.pass) return 3;
    if (deliverable && a && a.easyPass) return 2;
    var safe = deliverable && (!a || a.safeEdge !== false);
    return safe ? 1 : 0;
  }
  // 候选 b 是否比当前 best a 更优：先比档次(tierOf)，同档再比 candScore(审核+封锁+玩家表现细分)。
  function candBetter(b, a) {
    if (a == null) return true;
    var tb = candTier(b), ta = candTier(a);
    if (tb !== ta) return tb > ta;
    return candScore(b) > candScore(a);
  }
  // requireHard=true 时只认【困难合格】(真实卡点，omniAudit.pass)；简单合格(趋势符合)不算早停条件，继续搜索。
  function candPass(c, requireHard) {
    if (!c || !c.generationEval || !c.generationEval.pass) return false;
    if (requireHard) return !!(c.audit && c.audit.pass);
    return true;
  }
  function tagAudit(c) { if (c && !c.audit && c.generationEval) c.audit = c.generationEval.omni.audit; return c; }
  // 通用：取 pickOrder 进度落在 [lo,hi) 的【普通盒】坐标(去重)
  function routeBoxesInRange(board, pickOrder, lo, hi) {
    var out = [], seen = {}, total = (pickOrder || []).length;
    for (var i = 0; i < total; i++) {
      var p = pickOrder[i]; if (!p || p.r == null) continue;
      var prog = total ? i / total : 0; if (prog < lo || prog >= hi) continue;
      var key = p.r + ',' + p.c; if (seen[key]) continue;
      var cell = board.cells[p.r] && board.cells[p.r][p.c];
      if (cell && cell.t === 'box') { seen[key] = 1; out.push({ r: p.r, c: p.c }); }
    }
    return out;
  }
  // ==== 卡点手段(实测精简为 2 种，见 生产器重构日志 P8/P10) ====
  // 目标图【网关色】排名：消掉某色的当前可达区后，新解锁的其他色像素越多=该色越关键(越该被延迟/搬走)。
  //   返回按"新解锁像素数"降序的 [{color, unlock}]。用于指定"能解锁目标图依赖的球"，而非随机撞。
  // 缓存按【入口模式】分开：同一张 blocks 在四边/仅底部两种口径下网关排名不同，
  //   若只以 blocks 作键，先跑过的模式会把结果串给另一模式（一批只用一种模式时不显形，混用时静默出错）。
  var _gatewayCache = (typeof WeakMap !== 'undefined') ? new WeakMap() : null;
  var _gatewayCacheBottom = (typeof WeakMap !== 'undefined') ? new WeakMap() : null;
  function gatewayColorRank(blocks, bottomOnly) {
    if (!blocks || !blocks.length || !blocks[0]) return [];
    bottomOnly = !!bottomOnly;
    var cache = bottomOnly ? _gatewayCacheBottom : _gatewayCache;
    if (cache && cache.has(blocks)) return cache.get(blocks);
    // 维度取【目标图本身】(blocks 是 55×55 目标图，非小棋盘)——此前误传棋盘维度只扫到图左上角，网关识别失效。
    var rows = blocks.length, cols = blocks[0].length;
    var DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    var base = AntSolver.outsideReachSeed(blocks, rows, cols, bottomOnly);
    function reachOther(elim, exclude) {
      var vis = new Uint8Array(rows * cols), st = [], cnt = 0;
      // edgeOpen 是本函数自有的可达判定，必须与入口模式一致：
      //   默认四边任一边界即开口；bottomOnly 只有底边(r=rows-1)开口，上/左/右视作墙。
      //   两种模式都保留"邻接已消除格即开口"。
      function edgeOpen(r, c) { if (bottomOnly) { if (r === rows - 1) return true; } else if (r === 0 || r === rows - 1 || c === 0 || c === cols - 1) return true; if (r > 0 && elim[r - 1][c]) return true; if (r < rows - 1 && elim[r + 1][c]) return true; if (c > 0 && elim[r][c - 1]) return true; if (c < cols - 1 && elim[r][c + 1]) return true; return false; }
      for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
        var id = r * cols + c; if (vis[id] || elim[r][c]) continue; var col = blocks[r][c]; if (col <= 0 || col === exclude) continue; if (!edgeOpen(r, c)) continue; vis[id] = 1; st.push(id);
        while (st.length) { var cur = st.pop(); cnt++; var cr = (cur / cols) | 0, cc = cur % cols; for (var d = 0; d < 4; d++) { var nr = cr + DIRS[d][0], nc = cc + DIRS[d][1]; if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue; var nid = nr * cols + nc; if (vis[nid] || elim[nr][nc] || blocks[nr][nc] !== col) continue; vis[nid] = 1; st.push(nid); } }
      }
      return cnt;
    }
    var colorSet = {}; for (var r0 = 0; r0 < rows; r0++) for (var c0 = 0; c0 < cols; c0++) { var cv = blocks[r0][c0]; if (cv > 0) colorSet[cv] = 1; }
    var rank = [];
    for (var cs in colorSet) {
      var col = +cs, before = reachOther(base, col);
      var elim = []; for (var r1 = 0; r1 < rows; r1++) elim.push(base[r1].slice());
      AntSolver.Simulator.floodFillEliminate(elim, blocks, rows, cols, col, Infinity, null, null, bottomOnly);
      rank.push({ color: col, unlock: reachOther(elim, col) - before });
    }
    rank.sort(function (a, b) { return b.unlock - a.unlock; });
    if (cache) cache.set(blocks, rank);
    return rank;
  }
  // 目标图【内部深度】排名：某色像素当前(仅靠外部连通)就能直接贴到的比例(exposed/total)越低=越深埋在内部，
  //   要等别的颜色先清开才可能摸到。用于把【早期锁链组】定向换成"图内部深色"——该组会因为这个深色成员迟迟
  //   摸不到而一直卡在暂存里，天然形成长期滞留(配合 solver-strategy.js 的锁链滞留周期奖励，求解器会优先设法
  //   促进/绕开它，产生更真实的后期压力)。返回按 ratio 升序(最内部优先) [{color,total,exposed,ratio}]。
  // 缓存同样按【入口模式】分开（理由见 gatewayColorRank 上方注释）。
  var _interiorCache = (typeof WeakMap !== 'undefined') ? new WeakMap() : null;
  var _interiorCacheBottom = (typeof WeakMap !== 'undefined') ? new WeakMap() : null;
  function interiorColorRank(blocks, bottomOnly) {
    if (!blocks || !blocks.length || !blocks[0]) return [];
    bottomOnly = !!bottomOnly;
    var cache = bottomOnly ? _interiorCacheBottom : _interiorCache;
    if (cache && cache.has(blocks)) return cache.get(blocks);
    var rows = blocks.length, cols = blocks[0].length;
    var DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    // 入口模式只体现在这颗种子上：bottomOnly 时初始外部空格只从底边连通区播种，
    //   于是"贴着上/左/右背景"的色块不再被算作已暴露，深埋比例自然按底部玩法重算。
    var base = AntSolver.outsideReachSeed(blocks, rows, cols, bottomOnly);
    var totalMap = {}, exposedMap = {};
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      var col = blocks[r][c]; if (col <= 0) continue;
      totalMap[col] = (totalMap[col] || 0) + 1;
      // 注：此处只看"邻接初始外部空格"，不把图边界本身算开口——这是本启发既有的宽松口径
      //   （它只用于卡点换球的目标挑选排序，不是可解性判定），两种模式沿用同一形状不做改动。
      var open = false;
      for (var d = 0; d < 4; d++) { var nr = r + DIRS[d][0], nc = c + DIRS[d][1]; if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue; if (base[nr][nc]) { open = true; break; } }
      if (open) exposedMap[col] = (exposedMap[col] || 0) + 1;
    }
    var rank = [];
    for (var k in totalMap) { var tt = totalMap[k], ex = exposedMap[k] || 0; rank.push({ color: +k, total: tt, exposed: ex, ratio: ex / tt }); }
    rank.sort(function (a, b) { return a.ratio - b.ratio; });   // 升序：ratio 越小越深埋
    if (cache) cache.set(blocks, rank);
    return rank;
  }
  // 锁链定向换球：把【前期段】锁链组(取一个代表成员即可，组内其余成员保持原样)的颜色量，
  //   与【当前持有图内部深色】的某个无障碍普通盒互换(色+量守恒)。换后该锁链组要等图内部深色区域
  //   被其他消除动作打开才摸得到 → 组内其他成员早消完也没用，整组长期滞留暂存，是"结构性"的卡点
  //   (不像换球/增容那样只是位置远/容量大，是真的要等依赖顺序满足)。一次最多处理 chainSwapCount 组。
  function chokeChainColorSwap(board, pickOrder, config, blocks, usedT) {
    if (!blocks) return 0;
    var cells = board.cells, rows = board.rows, cols = board.cols;
    var startFrac = (config.swapRegionMin != null ? config.swapRegionMin : 50) / 100;
    var early = routeBoxesInRange(board, pickOrder, 0, startFrac);
    // 前期段里的锁链组：按 chain 分组号去重，每组取一个代表成员
    var groupRep = {}, order = [];
    for (var i = 0; i < early.length; i++) {
      var p = early[i], cell = cells[p.r] && cells[p.r][p.c];
      if (!cell || cell.t !== 'box' || !(cell.chain > 0)) continue;
      if (groupRep[cell.chain]) continue;
      groupRep[cell.chain] = { r: p.r, c: p.c, box: cell }; order.push(cell.chain);
    }
    if (!order.length) return 0;
    var interior = interiorColorRank(blocks, config && config.bottomOnly);
    if (!interior.length) return 0;
    // 深色候选池：按内部深度升序取前若干种颜色，收集当前持有这些颜色的无障碍普通盒
    var deepColors = {}; for (var g = 0; g < Math.min(5, interior.length); g++) deepColors[interior[g].color] = interior[g].ratio;
    var pool = [];
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      var e = cells[r][c];
      if (e && e.t === 'box' && e.chain === 0 && !e.q && deepColors.hasOwnProperty(e.color)) pool.push({ r: r, c: c, box: e, ratio: deepColors[e.color] });
    }
    if (!pool.length) return 0;
    pool.sort(function (a, b) { return a.ratio - b.ratio; });   // 越深埋优先作为换入目标
    var quota = config.chainSwapCount != null ? config.chainSwapCount : 4;
    var did = 0;
    for (var k = 0; k < order.length && did < quota; k++) {
      var rep = groupRep[order[k]];
      var target = null;
      for (var pi = 0; pi < pool.length; pi++) {
        var tk = pool[pi].r + ',' + pool[pi].c;
        if (usedT[tk] || pool[pi].box === rep.box || pool[pi].box.color === rep.box.color) continue;
        target = pool[pi]; break;
      }
      if (!target) continue;
      var tb = target.box, tc = rep.box.color, tn = rep.box.count;
      rep.box.color = tb.color; rep.box.count = tb.count;
      tb.color = tc; tb.count = tn;
      usedT[target.r + ',' + target.c] = 1;
      did++;
    }
    return did;
  }
  // 卡点A · 换球/搬盒(定向·大跨度·多次)：把【能解锁目标图依赖的关键色盒】搬到离原位最远处(后期棋盘格或管道最深层)；
  //   并优先对【前期锁链组】做定向深色换入(chokeChainColorSwap，见上)——两种手段共享同一个"已用落点"去重集合。
  //   跨度=换后棋盘位置与原位曼哈顿距离；藏管道则 = 到管道距离 + 队列深度。守恒(仅换色量)。一次做多处(最多3)。
  //   (吸收原 D 锁链换球、E 关键色分散/藏管道)。
  /**
   * 稀有色落位（卡点类型 rareColorKey，用户 2026-08-24 q1）。
   *
   * 原理：「稀有」= 该色像素总量占比小（rareColorRank）。稀有色被卡住时可替代方案最少——
   *   常见色到处都有、堵一处无所谓；稀有色只有那么几片，一旦它的盒卡在关键位，
   *   玩家就只能等那个位置打开，没有别的路可走。
   *
   * 关键位（三类，按优先级）：
   *   ① 窄路缺口盒（narrowGap 组的锁链成员 / 缺口冰块位）—— 必经之路
   *   ② 锁链端（任意锁链组成员）—— 要等整组齐活
   *   ③ 管道口（管道出口格的盒）—— 吐球节奏被它决定
   *
   * 做法：把关键位现有盒的颜色/容量 与 当前持有稀有色的普通盒 **对换**（色与量成对交换，总量守恒）。
   *   只换 color/count，不动 ice/chain/q/管道结构 —— 与 chokeSwap/chokeInflate 同一约束。
   *
   * @returns {number} 实际完成的对换次数
   */
  function chokeRareColorKeyPlace(board, config, blocks, usedT) {
    if (!blocks || !board) return 0;
    var plan = config && config._chokePlan;
    if (!(plan && plan.has && plan.has.rareColorKey)) return 0;   // 未抽中该类型 → 不执行
    var cells = board.cells, rows = board.rows, cols = board.cols;
    var rare = rareColorRank(blocks);
    if (rare.length < 2) return 0;
    // 取最稀有的前若干色（默认 3，可配）
    var topN = config.rareColorTopN != null ? config.rareColorTopN : 3;
    var rareSet = {};
    for (var i = 0; i < Math.min(topN, rare.length); i++) rareSet[rare[i].color] = rare[i].rank;

    // —— 收集关键位（三类，带优先级）——
    var keySlots = [];
    function isPlain(c) { return c && c.t === 'box'; }
    // ① 窄路缺口盒 / ② 锁链端：锁链组号 90+ 为窄路缺口来源，80~89 为管道口来源（见 planObstacleSlotsFixed）
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      var cell = cells[r][c];
      if (!isPlain(cell)) continue;
      if (cell.chain > 0) {
        var pri = cell.chain >= 90 ? 1 : (cell.chain >= 80 ? 2 : 3);   // 窄路缺口 > 管道口 > 普通锁链
        keySlots.push({ r: r, c: c, box: cell, pri: pri });
      }
    }
    // ③ 管道出口格的盒
    for (var pr = 0; pr < rows; pr++) for (var pc = 0; pc < cols; pc++) {
      var pcell = cells[pr][pc];
      if (!pcell || pcell.t !== 'pipe') continue;
      var dv = AntSolver.PIPE_DIRS[pcell.dir] || [1, 0];
      var er = pr + dv[0], ec = pc + dv[1];
      if (er < 0 || er >= rows || ec < 0 || ec >= cols) continue;
      var ecell = cells[er][ec];
      if (isPlain(ecell)) keySlots.push({ r: er, c: ec, box: ecell, pri: 2 });
    }
    if (!keySlots.length) return 0;
    keySlots.sort(function (a, b) { return a.pri - b.pri; });

    // —— 当前持有稀有色的普通盒（无障碍，可安全换出）——
    var donors = [];
    for (var r2 = 0; r2 < rows; r2++) for (var c2 = 0; c2 < cols; c2++) {
      var d = cells[r2][c2];
      if (d && d.t === 'box' && d.chain === 0 && !d.q && rareSet[d.color]) {
        donors.push({ r: r2, c: c2, box: d, rank: rareSet[d.color] });
      }
    }
    if (!donors.length) return 0;
    donors.sort(function (a, b) { return a.rank - b.rank; });   // 越稀有越优先换入

    var quota = config.rareColorSwapCount != null ? config.rareColorSwapCount : 3;
    var did = 0, di = 0;
    for (var ki = 0; ki < keySlots.length && did < quota && di < donors.length; ki++) {
      var slot = keySlots[ki], tk = slot.r + ',' + slot.c;
      if (usedT && usedT[tk]) continue;                      // 该位已被别的换球手段占用
      if (rareSet[slot.box.color]) continue;                 // 已经是稀有色，无需换
      var donor = null;
      while (di < donors.length) {
        var cand = donors[di++];
        if (cand.r === slot.r && cand.c === slot.c) continue;
        var dk = cand.r + ',' + cand.c;
        if (usedT && usedT[dk]) continue;
        donor = cand; break;
      }
      if (!donor) break;
      // 成对交换 color+count → 分色总量与总盒数均守恒
      var sc = slot.box.color, sn = slot.box.count;
      slot.box.color = donor.box.color; slot.box.count = donor.box.count;
      donor.box.color = sc; donor.box.count = sn;
      if (usedT) { usedT[tk] = 1; usedT[donor.r + ',' + donor.c] = 1; }
      did++;
    }
    return did;
  }

  function chokeSwap(board, pickOrder, config, lateTargets, blocks) {
    var cells = board.cells, rows = board.rows, cols = board.cols;
    var startFrac = (config.swapRegionMin != null ? config.swapRegionMin : 50) / 100;
    var early = routeBoxesInRange(board, pickOrder, 0, startFrac);
    var late = (lateTargets && lateTargets.length) ? lateTargets : routeBoxesInRange(board, pickOrder, startFrac, 1.01);
    function plainAt(p) { var c = cells[p.r] && cells[p.r][p.c]; return (c && c.t === 'box' && c.chain === 0 && !c.q) ? c : null; }
    function span(r1, c1, r2, c2) { return Math.abs(r1 - r2) + Math.abs(c1 - c2); }
    var usedT = {};
    // 0) 锁链定向换球(优先)：前期锁链组代表成员 ↔ 图内部深色现持有盒
    var chainSwapped = chokeChainColorSwap(board, pickOrder, config, blocks, usedT);
    // 0b) 稀有色落位（用户 2026-08-24 q1：「实现稀有色落位，在初次换球时执行」）。
    //   放在这里=首次换球阶段，与锁链定向换球并列，先于网关色/后期段扰动。
    //   仅当抽中卡点类型 rareColorKey 时生效；未抽中则完全不执行，行为与本功能引入前一致。
    var rareSwapped = chokeRareColorKeyPlace(board, config, blocks, usedT);
    // 1) 网关色 → 关键盒(优先前期段属网关色的无障碍盒；不足则全盘找；再不足退回前期大盒 keystone)
    var rank = blocks ? gatewayColorRank(blocks, config && config.bottomOnly) : [];
    var keyColor = {}; for (var g = 0; g < Math.min(4, rank.length); g++) if (rank[g].unlock > 0) keyColor[rank[g].color] = 1;
    var keyBoxes = [], seenKey = {};
    function pushKey(r, c, b) { var k = r + ',' + c; if (seenKey[k]) return; seenKey[k] = 1; keyBoxes.push({ r: r, c: c, box: b }); }
    // 1) 前期段网关色盒(最优先)
    for (var i = 0; i < early.length; i++) { var b = plainAt(early[i]); if (b && keyColor[b.color]) pushKey(early[i].r, early[i].c, b); }
    // 2) 全盘网关色盒
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) { var e = cells[r][c]; if (e && e.t === 'box' && e.chain === 0 && !e.q && keyColor[e.color]) pushKey(r, c, e); }
    // 3) 补足：其余前期无障碍盒(按 count 降序)，使换球池足够多以支撑更大换球量
    var es = []; for (var i2 = 0; i2 < early.length; i2++) { var b2 = plainAt(early[i2]); if (b2 && !seenKey[early[i2].r + ',' + early[i2].c]) es.push({ r: early[i2].r, c: early[i2].c, box: b2 }); }
    es.sort(function (a, b) { return b.box.count - a.box.count; });
    for (var e3 = 0; e3 < es.length; e3++) pushKey(es[e3].r, es[e3].c, es[e3].box);
    if (!keyBoxes.length) return false;
    // 2) 落点候选(取最大跨度)：后期无障碍盒 / 管道最深层
    var latePos = []; for (var j = 0; j < late.length; j++) { var lb = plainAt(late[j]); if (lb) latePos.push({ r: late[j].r, c: late[j].c, box: lb }); }
    var pipes = []; for (var r3 = 0; r3 < rows; r3++) for (var c3 = 0; c3 < cols; c3++) { var pc = cells[r3][c3]; if (pc && pc.t === 'pipe' && pc.queue) pipes.push({ r: r3, c: c3, pipe: pc }); }
    var did = 0;   // 累计换球数量(不含 chainSwapped，最终以 did+chainSwapped>0 判定是否生效)
    var maxSwaps = config.chokeSwapCount || 12;   // 换球数量(可调，越多卡点越强)
    for (var k = 0; k < Math.min(keyBoxes.length, maxSwaps); k++) {
      var key = keyBoxes[k], best = -1, act = null;
      for (var li = 0; li < latePos.length; li++) { var tk = latePos[li].r + ',' + latePos[li].c; if (usedT[tk] || latePos[li].box === key.box) continue; var d = span(key.r, key.c, latePos[li].r, latePos[li].c); if (d > best) { best = d; act = { t: 'box', o: latePos[li] }; } }
      for (var pi = 0; pi < pipes.length; pi++) { if (!pipes[pi].pipe.queue.length) continue; var d2 = span(key.r, key.c, pipes[pi].r, pipes[pi].c) + pipes[pi].pipe.queue.length; if (d2 > best) { best = d2; act = { t: 'pipe', o: pipes[pi] }; } }
      if (!act) continue;
      if (act.t === 'box') { var tb = act.o.box, tc = key.box.color, tn = key.box.count; key.box.color = tb.color; key.box.count = tb.count; tb.color = tc; tb.count = tn; usedT[act.o.r + ',' + act.o.c] = 1; did++; }
      else { var q = act.o.pipe.queue[act.o.pipe.queue.length - 1], a1 = key.box.color, a2 = key.box.count; key.box.color = q.color; key.box.count = q.count; q.color = a1; q.count = a2; did++; }   // 与最深队列项互换=藏最深
    }
    return (did + chainSwapped) > 0;
  }
  // 卡点B · 增加容量：把某色容量向一个【后期盒(sink)】集中(抬到 ~1.5~2× boxSizeMax)，同色他盒(donor)降到 min。
  //   守恒(该色总量不变)；大盒取时难一次消完 → 滞留暂存 → 抬后期压力。
  function chokeInflate(board, targets, config) {
    var cells = board.cells, rows = board.rows, cols = board.cols, min = config.boxSizeMin || 2, max = config.boxSizeMax || 52;
    // 超大盒倍率参数化（用户 2026-08-24 q9）。默认 1.5~2.0 与参数引入前完全一致。
    var lo = config.bigBoxMulMin != null ? config.bigBoxMulMin : 1.5;
    var hi = config.bigBoxMulMax != null ? config.bigBoxMulMax : 2.0;
    if (hi < lo) hi = lo;
    var target = Math.round(max * (lo + Math.random() * (hi - lo)));
    var sinks = [];
    for (var i = 0; i < targets.length; i++) { var t = targets[i], c0 = cells[t.r] && cells[t.r][t.c]; if (c0 && c0.t === 'box' && c0.chain === 0 && !c0.q) sinks.push(c0); }
    if (!sinks.length) return false;
    var sink = sinks[(Math.random() * sinks.length) | 0], donors = [];
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) { var e = cells[r][c]; if (e && e.t === 'box' && e !== sink && e.color === sink.color && e.chain === 0) donors.push(e); }
    if (!donors.length) return false;
    var moved = false;
    for (var j = 0; j < donors.length && sink.count < target; j++) { var d = donors[j], take = Math.min(d.count - min, target - sink.count); if (take > 0) { d.count -= take; sink.count += take; moved = true; } }
    return moved;
  }
  // 卡点分派(2 手段)：A 换球/搬盒(定向大跨度, 60%) / B 增加容量(40%)
  function applyOneChoke(board, targets, config, pickOrder, blocks) {
    if (Math.random() < 0.6) return chokeSwap(board, pickOrder, config, targets, blocks);
    return chokeInflate(board, targets, config);
  }
  // 从父变体派生一个卡点变体：round≥2 少数分支用【增减压重生成】(据父审核诊断调障碍参数)；
  //   其余为【卡点制造】(clone 父 board + 后期段扰动)；重解+结构校验通过才返回，破坏可解则丢弃(null)。
  function makeChokeVariant(parent, blocks, config, round) {
    if (round >= 2 && parent.audit && Math.random() < 0.3) {
      var pa = applyPressureAdjust(config, parent.audit, parent.level.bufferLimit);
      GENPERF.regenVariants++;                     // 埋点：走"压力调整重新建盘"的变体数
      var regen = generateFromBlocks(blocks, Object.assign({}, pa.cfg, { maxRetries: 2, candidateCount: 1 }));
      return regen.valid ? tagAudit(regen) : null;
    }
    var pb = parent.level.board;
    var level = { blocks: parent.level.blocks, bufferLimit: parent.level.bufferLimit, board: { rows: pb.rows, cols: pb.cols, cells: AntSolver.deepClone(pb.cells) } };
    var startFrac = (config.swapRegionMin != null ? config.swapRegionMin : 50) / 100;
    var targets = lateRouteBoxes(level.board, (parent.solveResult && parent.solveResult.pickOrder) || [], startFrac);
    if (!targets.length) return null;
    var pickOrder = (parent.solveResult && parent.solveResult.pickOrder) || [];
    if (!applyOneChoke(level.board, targets, config, pickOrder, level.blocks)) return null;
    if (round >= 2) applyOneChoke(level.board, targets, config, pickOrder, level.blocks);   // 后续轮更强：再叠一次卡点
    if (!structuralDeadlockCheck(level.board).ok) return null;
    var parsed = AntSolver.parseLevel(level);
    // 旧流程同样对齐入口模式与消除口径（用户 2026-07-29 决定 D2：旧流程一并改，不做拒绝）。
    var r = AntSolver.Solver.solve(parsed, { capturePreviewStats: true, bottomOnly: !!config.bottomOnly, instantChain: !!config.instantChain });
    if (!r.completed) return null;                                  // 破坏可解 → 丢弃该分支
    var ge = evaluateGeneration(r, parsed, config);
    return { level: level, valid: true, solveResult: r, generationEval: ge, audit: ge.omni.audit, difficulty: computeDifficulty(r, parsed, config, ge), config: config };
  }
  // 收尾：设 audit.pass/playerWon/generationScore + 玩家失败/触上限原因 + 兜底标记，返回 produce 形状
  //
  // 【兜底标记】(v86 新增，需求见 codex助理 v84审查文档 §5)：区分"正常合格输出"与"兜底交付的关卡"，
  //   避免兜底关卡被误当合格关处理。判定只看候选的【三档档次】(candTier，与排序逻辑同一套口径)：
  //   档3/2(困难合格/简单合格) → fallback=false，正常输出。
  //   档1/0(安全兜底/其余)     → fallback=true，并按当时是否超时分 fallbackType：
  //     'timeout'   ：produce() 的单关时间预算(timeBudgetMs)到点、搜索被迫中止时选中的（cand.timedOut=true）。
  //     'exhausted' ：预算内已把候选数×分支×轮数全部遍历完，仍未找到合格候选，只能选最接近的一个。
  //   fallbackTier = candTier(cand) 的原始档次值(0或1)；fallbackReason = 供人读的一句话说明。
  /**
   * 死亡边界救援兜底（用户 2026-08-04 指定）。
   *
   * 触发条件：最终候选的【玩家版暂存峰值触达上限】——现行审核把这种关判为死亡边界、直接不合格。
   * 救援动作：不重新生成整关（保留已通过筛选的关卡结构），只在原关卡上做一轮【障碍缩减】：
   *   第 1 轮 拆 1 个冰块 + 解除 1 组锁链；第 2 轮 拆 2 个冰块 + 解除 1 组锁链。
   *   （拆冰块 = 把该盒 ice 耐久置 0；解除锁链 = 把该组所有成员的 chain 组号置 0，优先拆成员最少的组，代价最小。）
   * 采用条件：救援后必须【全知仍通关 + 玩家仍通关 + 峰值降到上限以下】三者同时成立，否则放弃该轮。
   *   两轮都救不回来就保留原关卡、按原结论走（不掩盖不合格）。
   *
   * 默认关闭（deathEdgeRescue: false），只有显式开启才生效，
   * 因此原四方向与底部消除两种模式的产出不受影响。
   */
  function rescueDeathEdge(cand) {
    var cfg = cand && cand.config, lv = cand && cand.level, ge = cand && cand.generationEval;
    if (!cfg || !cfg.deathEdgeRescue) return null;
    if (!lv || !ge || !ge.player) return null;
    var limit = lv.bufferLimit;
    if (!(ge.player.peak >= limit)) return null;          // 没触死亡边界 → 不需要救援
    var iceCut = (cfg.deathEdgeRescueIceCut != null) ? cfg.deathEdgeRescueIceCut : 2;
    var chainCut = (cfg.deathEdgeRescueChainCut != null) ? cfg.deathEdgeRescueChainCut : 1;
    var log = [];
    for (var attempt = 1; attempt <= 2; attempt++) {
      var nIce = (attempt === 1) ? Math.min(1, iceCut) : iceCut;   // 第1轮拆1个，第2轮拆到上限(默认2)
      var trial = JSON.parse(JSON.stringify(lv));
      var cells = trial.board.cells, rows = trial.board.rows, cols = trial.board.cols;
      // ① 拆冰块：耐久高的先拆（对可达性阻塞最重）
      var iced = [];
      for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
        var cl = cells[r] && cells[r][c];
        if (cl && cl.t === 'box' && cl.ice > 0) iced.push({ r: r, c: c, ice: cl.ice });
      }
      iced.sort(function (a, b) { return b.ice - a.ice; });
      var cutIce = 0;
      for (var i = 0; i < iced.length && cutIce < nIce; i++) { cells[iced[i].r][iced[i].c].ice = 0; cutIce++; }
      // ② 解除锁链组：成员最少的组优先（拆掉它对关卡结构改动最小）
      var groups = {};
      for (var r2 = 0; r2 < rows; r2++) for (var c2 = 0; c2 < cols; c2++) {
        var cl2 = cells[r2] && cells[r2][c2];
        if (cl2 && cl2.t === 'box' && cl2.chain > 0) (groups[cl2.chain] = groups[cl2.chain] || []).push({ r: r2, c: c2 });
      }
      var gKeys = Object.keys(groups).sort(function (a, b) { return groups[a].length - groups[b].length; });
      var cutChain = 0;
      for (var gi = 0; gi < gKeys.length && cutChain < chainCut; gi++) {
        groups[gKeys[gi]].forEach(function (p) { cells[p.r][p.c].chain = 0; });
        cutChain++;
      }
      if (cutIce === 0 && cutChain === 0) { log.push('第' + attempt + '轮：无冰块也无锁链可拆，放弃'); break; }
      // ③ 重跑全知 + 评估（必须与本关同一模式口径）
      var parsed2 = AntSolver.parseLevel(trial);
      var r2res = AntSolver.Solver.solve(parsed2, {
        capturePreviewStats: true, bottomOnly: !!cfg.bottomOnly, instantChain: !!cfg.instantChain
      });
      if (!r2res.completed) { log.push('第' + attempt + '轮(拆冰' + cutIce + '+链' + cutChain + ')：全知不再通关，放弃'); continue; }
      var ge2 = evaluateGeneration(r2res, parsed2, cfg);
      var newPeak = ge2.player ? ge2.player.peak : 999;
      var newWon = !!(ge2.player && ge2.player.won);
      if (newPeak < limit && newWon) {
        log.push('第' + attempt + '轮(拆冰' + cutIce + '+链' + cutChain + ')：救援成功，峰值 ' + ge.player.peak + '→' + newPeak);
        var before = { peak: ge.player.peak, playerWon: !!ge.player.won, tier: cand.audit && cand.audit.tier };
        cand.level = trial;
        cand.solveResult = r2res;
        cand.generationEval = ge2;
        cand.audit = ge2.omni.audit;
        cand.difficulty = computeDifficulty(r2res, parsed2, cfg, ge2);
        cand.rescue = { applied: true, attempt: attempt, iceCut: cutIce, chainCut: cutChain, before: before, afterPeak: newPeak, log: log };
        return cand.rescue;
      }
      log.push('第' + attempt + '轮(拆冰' + cutIce + '+链' + cutChain + ')：峰值 ' + newPeak + '、玩家通关' + (newWon ? '是' : '否') + '，未达成救援条件');
    }
    cand.rescue = { applied: false, log: log };
    return cand.rescue;
  }

  function finalizeProduce(cand, K, evaluated) {
    if (!cand) return cand;
    cand.candidates = K;
    cand.treeEvaluated = evaluated;
    // 死亡边界救援必须在算档次与改写 audit.pass 之前——救援会替换 level/solveResult/audit，
    // 之后的分档与结论都应基于救援后的关卡。默认关闭，原两种模式不受影响。
    try { rescueDeathEdge(cand); } catch (e) { if (cand) cand.rescue = { applied: false, error: String(e && e.message || e) }; }
    // 必须在改写 audit.pass 之前算档次——candTier() 读的是【原始】audit.pass(是否真困难合格)，
    // finalizeProduce 稍后会把 audit.pass 覆写成"整体合格"，届时语义已变，不能再用来分档。
    var tier = candTier(cand);
    cand.fallback = tier < 2;
    if (cand.fallback) {
      cand.fallbackTier = tier;
      cand.fallbackType = cand.timedOut ? 'timeout' : 'exhausted';
      cand.fallbackReason = tier === 1
        ? (cand.fallbackType === 'timeout' ? '超时兜底：已选安全候选(可通关但未形成合格卡点)' : '遍历完兜底：候选树穷尽仍无合格候选，已选安全候选(可通关但未形成合格卡点)')
        : (cand.fallbackType === 'timeout' ? '超时兜底：候选树内最接近标准的候选，仍不合格' : '遍历完兜底：候选树穷尽仍无合格候选，已选最接近标准的候选，仍不合格');
    } else {
      cand.fallbackTier = null; cand.fallbackType = null; cand.fallbackReason = null;
    }
    if (cand.audit && cand.generationEval) {
      // 注意：此处 audit.pass 被改写为【整体合格】(困难合格 或 简单合格，且双方可通关)，不再等于"困难合格"本身。
      //   要区分困难/简单合格，认 audit.tier(在 chokepointAudit 里已定好，此处不改写)：'困难合格'|'简单合格'|'不合格'。
      cand.audit.pass = !!cand.generationEval.pass;
      cand.audit.playerWon = !!cand.generationEval.player.won;
      cand.audit.playerRevives = cand.generationEval.player.revives || 0;
      cand.audit.playerReviveCap = cand.generationEval.player.reviveCap != null ? cand.generationEval.player.reviveCap : 2;
      cand.audit.generationScore = cand.generationEval.score;
      if (!cand.generationEval.player.won && cand.audit.reasons.indexOf('玩家版未通关(真人打不通)') < 0)
        cand.audit.reasons.push('玩家版未通关(真人打不通)');
      else if (cand.generationEval.player.won && cand.audit.playerRevives >= cand.audit.playerReviveCap && cand.audit.reasons.indexOf('玩家版险胜(用尽复活)') < 0)
        cand.audit.reasons.push('玩家版险胜(用尽复活)');
      if (cand.generationEval.player.peak >= cand.level.bufferLimit && cand.audit.reasons.indexOf('玩家版暂存触达上限(死亡边界)') < 0)
        cand.audit.reasons.push('玩家版暂存触达上限(死亡边界)');
      if (cand.timedOut && cand.audit.reasons.indexOf('超时兜底(已选树内最接近合格候选)') < 0)
        cand.audit.reasons.push('超时兜底(已选树内最接近合格候选)');
      if (cand.fallback && cand.audit.reasons.indexOf(cand.fallbackReason) < 0)
        cand.audit.reasons.push(cand.fallbackReason);
    }
    return cand;
  }

  /**
   * 窄路推理陷阱：将墙下(gated)区域的盒与墙上方的【早序】盒交换一部分，
   * 使墙下持有早色所需盒(被缺口冰锁住) → 制造"锁住关键盒"的推理压力。
   * frac 控制交换比例(0~1)；只交换 box 格，保序可解由外层求解器校验/重试兜底。
   */
  function applyNarrowTrap(cells, rows, cols, narrowGaps, config) {
    var frac = (typeof config.narrowPathTrapFrac === 'number') ? config.narrowPathTrapFrac : 0.5;
    if (frac <= 0) return;
    // 最深墙行(取所有墙行最大 r)以下为 gated 区
    var wallR = 0;
    for (var i = 0; i < narrowGaps.length; i++) wallR = Math.max(wallR, narrowGaps[i].r);
    var gated = [], above = [];
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      var cell = cells[r][c];
      if (!cell || cell.t !== 'box') continue;
      if (r > wallR) gated.push({ r: r, c: c }); else above.push({ r: r, c: c });
    }
    if (!gated.length || !above.length) return;
    // 墙上方按 _seq 升序(最早序在前)；gated 按 _seq 降序(最晚序在前)
    above.sort(function(a, b) { return (cells[a.r][a.c]._seq || 0) - (cells[b.r][b.c]._seq || 0); });
    gated.sort(function(a, b) { return (cells[b.r][b.c]._seq || 0) - (cells[a.r][a.c]._seq || 0); });
    var k = Math.min(above.length, gated.length, Math.max(1, Math.round(gated.length * frac)));
    for (var j = 0; j < k; j++) {
      var ga = gated[j], ab = above[j];
      if (cells[ga.r][ga.c]._seq <= cells[ab.r][ab.c]._seq) break; // 已无更早序可换入 → 停止
      var tmp = cells[ga.r][ga.c];
      cells[ga.r][ga.c] = cells[ab.r][ab.c];
      cells[ab.r][ab.c] = tmp;
    }
  }

  /** 统计棋盘上某类型 cell 的数量。 */
  function countCellsOfType(cells, type) {
    var n = 0;
    for (var r = 0; r < cells.length; r++)
      for (var c = 0; c < cells[r].length; c++)
        if (cells[r][c] && cells[r][c].t === type) n++;
    return n;
  }

  // ==================== 墙体形态约束（black/pipe 通用） ====================
  // 规则：① 不得组成 2×2 墙块(矩形)；② 任意直线最多 3 面墙相连；③ 棋盘边缘也视作墙、同样遵循以上规则。
  /** (r,c) 是否为"墙"（black/pipe）；越界视作墙(边缘=墙)。 */
  function isWallAt(cells, rows, cols, r, c) {
    if (r < 0 || r >= rows || c < 0 || c >= cols) return true; // 边缘视作墙
    var cell = cells[r][c];
    return !!(cell && (cell.t === 'black' || cell.t === 'pipe'));
  }
  /** 若在 (r,c) 放墙是否违反形态约束(2×2墙块 / 直线>3连；边缘计为墙)。 */
  function wouldViolateWall(cells, rows, cols, r, c) {
    function W(rr, cc) { if (rr === r && cc === c) return true; return isWallAt(cells, rows, cols, rr, cc); }
    // ① 2×2 墙块：四个含(r,c)的窗口
    var starts = [[r - 1, c - 1], [r - 1, c], [r, c - 1], [r, c]];
    for (var i = 0; i < starts.length; i++) {
      var tr = starts[i][0], tc = starts[i][1];
      if (W(tr, tc) && W(tr, tc + 1) && W(tr + 1, tc) && W(tr + 1, tc + 1)) return true;
    }
    // ② 水平直线连(触边缘则各 +1 计一段墙)
    var left = 0, cc = c - 1; while (cc >= 0 && W(r, cc)) { left++; cc--; }
    var right = 0; cc = c + 1; while (cc < cols && W(r, cc)) { right++; cc++; }
    var hlen = left + right + 1;
    if (c - left === 0) hlen++;
    if (c + right === cols - 1) hlen++;
    if (hlen > 3) return true;
    // ② 垂直直线连
    var up = 0, rr = r - 1; while (rr >= 0 && W(rr, c)) { up++; rr--; }
    var down = 0; rr = r + 1; while (rr < rows && W(rr, c)) { down++; rr++; }
    var vlen = up + down + 1;
    if (r - up === 0) vlen++;
    if (r + down === rows - 1) vlen++;
    if (vlen > 3) return true;
    return false;
  }

  /** 一组锁链候选成员是否与【其他锁链组】8-向相邻（两对不同锁链不能相邻）。 */
  function chainGroupConflict(cells, rows, cols, members, group) {
    var dirs8 = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];
    var mset = {};
    for (var i = 0; i < members.length; i++) mset[members[i].r + ',' + members[i].c] = true;
    for (var m = 0; m < members.length; m++) {
      for (var d = 0; d < 8; d++) {
        var nr = members[m].r + dirs8[d][0], nc = members[m].c + dirs8[d][1];
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        if (mset[nr + ',' + nc]) continue;             // 本组成员相邻允许
        var cell = cells[nr][nc];
        if (cell && cell.t === 'box' && cell.chain > 0 && cell.chain !== group) return true; // 邻到别组
      }
    }
    return false;
  }

  /**
   * 窄路卡点：在棋盘中后部选行，用黑块铺满整行（仅留【单一缺口】列）→ 缺口下方区域只能经缺口暴露。
   * 即"唯一可达不可绕路"的窄路。要求：
   *  - 墙行 ∈ [0.4,0.7]×rows，非第0行/末行（黑块不可在末行）；墙行之间不相邻。
   *  - 缺口列当前为空(未来盒格)，且其下方至少有一个空格(有盒可被 gated)。
   *  - 建墙后所有空(未来盒)格仍从顶部经空格可达(经缺口)；否则撤销该墙。
   * 在空网格(尚未铺盒)上操作；黑块占格 → 盒铺在其余格，溢出走管道。
   * @returns {Array} 缺口格 [{r,c},...]
   */
  function reserveNarrowWalls(cells, rows, cols, config) {
    if (cols < 4 || rows < 5) return []; // 太小/太窄无法形成有意义的窄路
    // 活口数：范围 [min,max] 内随机（向后兼容旧 narrowPathGaps>0 固定值）
    var gapWant;
    if (config.narrowPathGaps > 0) {
      gapWant = clampInt(config.narrowPathGaps, 1, 1, 6);
    } else {
      var gmin = clampInt(config.narrowPathGapsMin, 1, 1, 6);
      var gmax = clampInt(config.narrowPathGapsMax, 2, gmin, 6);
      gapWant = gmin + Math.floor(Math.random() * (gmax - gmin + 1));
    }

    // 尝试多次构造"不规律锯齿(斜向)+边缘锚定+连通楼梯"墙，直到形成合法窄路。
    for (var attempt = 0; attempt < 8; attempt++) {
      // 1) 基准行(中后部) + 逐列随机游走(步长≤1，约40%概率移动) → 平缓斜向/锯齿折线（不规律但墙体不厚）
      var baseR = Math.max(2, Math.min(rows - 3, Math.round(rows * (0.48 + Math.random() * 0.2))));
      var f = [baseR];
      for (var c = 1; c < cols; c++) {
        var step = [-1, 0, 0, 0, 1][Math.floor(Math.random() * 5)];
        var rr = f[c - 1] + step;
        if (rr < 1) rr = 1; if (rr > rows - 2) rr = rows - 2;
        f.push(rr);
      }
      // 2) 缺口列：内部列(非最边缘)随机取 gapWant 个，尽量拉开
      var inner = [];
      for (var ic = 1; ic < cols - 1; ic++) inner.push(ic);
      shuffle(inner);
      var gapCols = {};
      var chosen = [];
      for (var gi = 0; gi < inner.length && chosen.length < gapWant; gi++) {
        var ok = true;
        for (var cj = 0; cj < chosen.length; cj++) if (Math.abs(chosen[cj] - inner[gi]) <= 1) ok = false;
        if (ok) { chosen.push(inner[gi]); gapCols[inner[gi]] = true; }
      }
      if (chosen.length === 0) continue;

      // 3) 建连通楼梯墙：逐列在 f[c] 放黑；相邻列高度差用竖直连接补齐(两两连接)；缺口列断开。
      //    墙锚定左右边缘(边缘也是墙) → 除缺口外前后被完整分隔。
      var placed = [];
      var prevR = null;
      for (var cc = 0; cc < cols; cc++) {
        if (gapCols[cc]) { prevR = null; continue; }
        var a, b;
        if (prevR === null) { a = f[cc]; b = f[cc]; }
        else { a = Math.min(prevR, f[cc]); b = Math.max(prevR, f[cc]); }
        for (var rr2 = a; rr2 <= b; rr2++) {
          if (rr2 < 1 || rr2 > rows - 2) continue;      // 墙不在第0/末行
          if (cells[rr2][cc] != null) continue;
          if (wouldViolateWall(cells, rows, cols, rr2, cc)) continue; // 违反形态约束(2×2/直线>3)则跳过
          cells[rr2][cc] = { t: 'black' }; placed.push([rr2, cc]);
        }
        prevR = f[cc];
      }
      if (placed.length === 0) continue;

      // 4) 校验：所有空(未来盒)格仍从顶部经空格可达(必经缺口)。否则整墙撤销重试。
      if (!nullCellsReachable(cells, rows, cols)) {
        for (var p = 0; p < placed.length; p++) cells[placed[p][0]][placed[p][1]] = null;
        continue;
      }
      // 5) 缺口格 = 各缺口列在墙带高度(f)的盒格 → 后续加冰"临时锁路/临时连接窄路"
      var gaps = [];
      for (var k = 0; k < chosen.length; k++) {
        var gcCol = chosen[k];
        var gr = f[gcCol];
        if (gr < 0) gr = baseR;
        gaps.push({ r: gr, c: gcCol });
      }
      return gaps;
    }
    return [];
  }

  /**
   * 从 list 前 rangeSize 个候选中随机取 count 个（对齐 bin _pickFromCandidateRange）。
   * 返回 { picked, remainder }（remainder=窗口内未取走的剩余，供下一行累加）。
   */
  function pickFromCandidateRange(list, rangeSize, count) {
    var actualRange = Math.min(rangeSize, list.length);
    var actualCount = Math.min(count, actualRange);
    var picked = [];
    for (var i = 0; i < actualCount; i++) {
      var idx = Math.floor(Math.random() * actualRange);
      picked.push(list[idx]);
      list.splice(idx, 1);
      actualRange--;
    }
    return { picked: picked, remainder: Math.max(0, actualRange) };
  }

  /**
   * 为管道(r,c)随机选一个方向(11上/12右/13下/14左)，要求出口格在盘内且当前为空(未来盒格)。
   * 返回方向或 -1（无合法方向）。
   */
  function choosePipeDir(cells, rows, cols, r, c, exitSet) {
    var dirs = [11, 12, 13, 14];
    shuffle(dirs);
    for (var i = 0; i < dirs.length; i++) {
      var dv = AntSolver.PIPE_DIRS[dirs[i]];
      var er = r + dv[0], ec = c + dv[1];
      if (er < 0 || er >= rows || ec < 0 || ec >= cols) continue;
      if (er === 0) continue;               // 出口不落在第0行（第二行管道不可朝上）
      if (cells[er][ec] != null) continue;  // 出口须为空(未来盒格)
      if (exitSet && exitSet[er + ',' + ec]) continue; // 出口不可与其他管道共用同一格
      return dirs[i];
    }
    return -1;
  }

  /**
   * P1 守恒反推管道数：溢出盒 D 由 P 个管道吸收，每管最终容量 = 1 + D/P 需落在
   * [pipeMinFill, pipeMaxDepth]，故 P ∈ [⌈D/(maxDepth−1)⌉, ⌊D/(minFill−1)⌋]；
   * 取区间中部（目标每管容量约为两端均值）并夹到区间；D 极小时兜底单管（容量可低于 minFill）。
   * 口径：第一遍逐格单扫每管先进 1 个盒，第二遍把剩余 D 个盒均匀补入 → 每管 1+D/P。
   *
   * 深度参数化（ANT-GEN-PIPE-DEPTH-FALLBACK-20260825）：默认 minFill=4 / maxDepth=6 时
   * 区间为 [⌈D/5⌉, ⌊D/3⌋]、目标 ≈⌈D/4⌉，**与参数引入前逐值等价**。
   * 该函数只在 usableSpaceTarget 关闭时生效（开启时管道数由 solveSpaceQuota 联立给出）。
   */
  function pipeCountByConservation(D, config) {
    if (D <= 0) return 0;
    var maxDepth = pipeDepthOf(config), minFill = pipeMinFillOf(config);
    var hiDiv = Math.max(1, maxDepth - 1);   // 每管最多再补 maxDepth−1 个（首扫已占 1 格）
    var loDiv = Math.max(1, minFill - 1);    // 每管至少再补 minFill−1 个
    var pMin = Math.ceil(D / hiDiv), pMax = Math.floor(D / loDiv);
    if (pMax < pMin) pMax = pMin;            // D 极小：区间为空 → 兜底单管
    var p = Math.round(D / Math.max(1, Math.round((hiDiv + loDiv) / 2)));  // 目标每管容量取区间中部
    if (p < pMin) p = pMin;
    if (p > pMax) p = pMax;
    if (p < 1) p = 1;
    return p;
  }

  // 棋盘上管道队列的最大深度（P1b 兜底判据：超过 pipeMaxDepth 即容量错位，需重随机尺寸/增盒容量减盒）
  function maxPipeDepth(board) {
    var mx = 0;
    if (!board || !board.cells) return 0;
    for (var r = 0; r < board.cells.length; r++) {
      var row = board.cells[r];
      for (var c = 0; c < row.length; c++) {
        var cell = row[c];
        if (cell && cell.t === 'pipe' && cell.queue && cell.queue.length > mx) mx = cell.queue.length;
      }
    }
    return mx;
  }

  /**
   * 规划管道数量（历史函数：P1 起 buildBoard 改用 pipeCountByConservation；保留供参考/回退）。
   * 让 overflow 个溢出球以【每管 ballMin~ballMax 球】分布，
   * 数量尽量落入目标 [pMin,pMax]。返回管道数（round-robin 分配即得每管 3~6 球）。
   * - 目标数比可行范围多(需每管<ballMin) → 取可行上限(hi)
   * - 目标数比可行范围少(需每管>ballMax) → 取可行下限(lo)，即"降低6球管道、增开3-4球管道对齐数量"由 hi 侧实现
   */
  function planPipeCount(overflow, pMin, pMax, ballMin, ballMax) {
    if (overflow <= 0) return 0;
    var lo = Math.ceil(overflow / ballMax);          // 最少管道(每管装满 ballMax)
    var hi = Math.max(1, Math.floor(overflow / ballMin)); // 最多管道(每管 ballMin)
    if (hi < lo) hi = lo;                             // overflow<ballMin 边界
    var dMin = pMin > 0 ? pMin : lo;
    var dMax = pMax > 0 ? pMax : hi;
    var iLo = Math.max(lo, dMin), iHi = Math.min(hi, dMax);
    var count;
    if (iLo <= iHi) count = Math.round((iLo + iHi) / 2); // 交集内取中
    else if (dMax < lo) count = lo;                      // 想要更少但会超 ballMax → 用可行下限(保 ≤ballMax)
    else count = hi;                                     // 想要更多但会低于 ballMin → 用可行上限(尽量多管、少球)
    return Math.max(1, count);
  }

  /** 满盘版选管道方向：出口须为【盒格】(游戏内被消除后吐球)、非第0行、盘内。 */
  function choosePipeDirFull(cells, rows, cols, r, c, exitSet) {
    var dirs = [11, 12, 13, 14]; shuffle(dirs);
    for (var i = 0; i < dirs.length; i++) {
      var dv = AntSolver.PIPE_DIRS[dirs[i]];
      var er = r + dv[0], ec = c + dv[1];
      if (er < 0 || er >= rows || ec < 0 || ec >= cols) continue;
      if (er === 0) continue;
      if (exitSet && exitSet[er + ',' + ec]) continue; // 出口不可与其他管道共用
      var ecl = cells[er][ec];
      if (!ecl || ecl.t !== 'box') continue;
      return dirs[i];
    }
    return -1;
  }

  /** 满盘时新建一个管道：把某内部普通盒格转为管道(其盒进队列)，遵循墙形态约束+不破坏可达+出口不与现有管道共用。 */
  function createPipeOnFull(cells, rows, cols, pipeList) {
    // 现有管道出口集合(出口不可共用)
    var exitSet = {};
    for (var pj = 0; pj < pipeList.length; pj++) {
      var pp = pipeList[pj], dvp = AntSolver.PIPE_DIRS[pp.dir];
      if (dvp) exitSet[(pp.r + dvp[0]) + ',' + (pp.c + dvp[1])] = true;
    }
    var cand = [];
    for (var r = 1; r < rows - 1; r++) for (var c = 0; c < cols; c++) {
      var ce = cells[r][c];
      if (ce && ce.t === 'box' && !(ce.ice > 0) && !(ce.chain > 0) && !ce.q && !exitSet[r + ',' + c]) cand.push({ r: r, c: c }); // 跳过障碍/缺口盒/他管出口
    }
    shuffle(cand);
    for (var i = 0; i < cand.length; i++) {
      var r = cand[i].r, c = cand[i].c;
      if (wouldViolateWall(cells, rows, cols, r, c)) continue;      // 管道也是墙，遵循形态约束
      var dir = choosePipeDirFull(cells, rows, cols, r, c, exitSet);
      if (dir < 0) continue;
      var box = cells[r][c];
      cells[r][c] = { t: 'pipe', dir: dir, queue: [{ color: box.color, count: box.count }], next: 0 };
      if (!isAllBoxesReachable(cells, rows, cols)) { cells[r][c] = box; continue; } // 破坏可达则撤销
      var p = { r: r, c: c, dir: dir }; pipeList.push(p); return p;
    }
    return null;
  }

  /**
   * 输出前确保棋盘被填满：若存在空洞(null)，则【强制减少最末行】——末行的球转入管道队列，
   * 并用管道队列的球回填中部残洞；如无管道则新建。循环至无空洞或触底(保留≥3行)。
   * @returns {{rows:number, cols:number, cells:Array}}
   */
  function ensureBoardFull(cells, rows, cols, pipeList) {
    function hasNull() { for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) if (cells[r][c] == null) return true; return false; }
    var guard = rows + 2;
    while (hasNull() && rows > 3 && guard-- > 0) {
      // 1) 收集并移除最末行（末行按规则无黑/管道，仅盒或空）
      var last = rows - 1, surplus = [];
      for (var c = 0; c < cols; c++) { var ce = cells[last][c]; if (ce && ce.t === 'box') surplus.push({ color: ce.color, count: ce.count }); }
      cells.splice(last, 1); rows--;
      for (var pi = pipeList.length - 1; pi >= 0; pi--) if (pipeList[pi].r >= rows) pipeList.splice(pi, 1); // 理论上管道不在末行
      // 2) 多余球补充为管道队列（无管道则新建）
      if (surplus.length) {
        if (pipeList.length === 0) createPipeOnFull(cells, rows, cols, pipeList);
        if (pipeList.length > 0) {
          for (var s = 0; s < surplus.length; s++) { var p = pipeList[s % pipeList.length]; cells[p.r][p.c].queue.push(surplus[s]); }
        }
      }
      // 3) 中部残洞：从管道队列取球回填为盒（球无墙规则限制），尽量不额外裁行
      for (var r3 = 0; r3 < rows; r3++) for (var c3 = 0; c3 < cols; c3++) {
        if (cells[r3][c3] != null) continue;
        var got = null;
        for (var pk = 0; pk < pipeList.length; pk++) { var pc = cells[pipeList[pk].r][pipeList[pk].c]; if (pc.queue && pc.queue.length) { got = pc.queue.pop(); break; } }
        if (got) cells[r3][c3] = { t: 'box', color: got.color, count: got.count, ice: 0, chain: 0, q: false };
      }
    }
    return { rows: rows, cols: cols, cells: cells };
  }

  /**
   * 在 [0,cols) 上均匀取 n 列（历史遗留，管道现用分散放置）。
   */
  function spreadCols(cols, n) {
    if (n <= 0) return [];
    if (n === 1) return [Math.floor(cols / 2)];
    var res = [];
    for (var i = 0; i < n; i++) res.push(Math.round(i * (cols - 1) / (n - 1)));
    // 去重
    var seen = {}, out = [];
    for (var j = 0; j < res.length; j++) { if (!seen[res[j]]) { seen[res[j]] = 1; out.push(res[j]); } }
    // 不足则补空位
    for (var c = 0; out.length < n && c < cols; c++) if (!seen[c]) { seen[c] = 1; out.push(c); }
    return out.slice(0, n);
  }

  /**
   * 求解引导式蚂蚁盒生成
   * 
   * 模拟真实的蚂蚁消除：从边界向内，每次选一种颜色，用flood-fill消除一个盒容量的量。
   * 记录每次实际消除的 (颜色, 数量)，形成保证可解的盒序列。
   * 
   * 策略：每步选择"当前可达像素数最多"的颜色，按【盒容量策略】取一个容量消除。
   * 守恒原则：每种颜色的总像素 = 该色所有盒 count 之和（flood-fill 消到无剩为止，天然守恒）。
   * 容量策略 boxSizeMode：
   *   'random'(默认) 每盒在 [boxMin,boxMax] 内随机 → 制造容量大小差距(利于管道/卡点预期)
   *   'max'          每盒取 boxMax(旧行为，盒接近满容量)
   *   'min'          每盒取 boxMin(盒偏小、盒数多)
   * 后续可在此扩展"按卡点/管道预期"的定向策略。
   */
  /**
   * 盒容量采样器（三个铺盒函数共用一份，避免同一策略在三处各写一遍导致口径分裂）。
   *
   * mode 取值：
   *   'random'(默认) 区间内均匀随机——原行为，不动
   *   'max' / 'min'  取上界 / 下界——原行为，不动
   *   'polar'        【新增】两极化采样：以 boxSizePolarBias 的概率落进区间两端的窄带，
   *                  否则全区间均匀。用于「同色盒之间的容量差距要大、且差值大的占比要高」
   *                  （用户 2026-08-04 对四方向瞬时连锁生产逻辑的要求）。
   *
   * 为什么均匀随机不够：均匀分布在 [a,b] 上任取两值，差值期望只有 (b-a)/3。
   *   35~80 区间下期望差 15，中间值占多数，"大差距"是少数派。
   *   两极化把概率质量推到两端后，随机两盒的差值期望显著上升，且大差值成为多数。
   *
   * 参数：boxSizePolarBias 两端命中概率(默认 0.7)；boxSizePolarBandRatio 窄带宽度占区间比例(默认 0.25)。
   */
  /**
   * 本关是否建窄路墙（用户 2026-08-04：窄路必定出现，改为按概率 p 出现）。
   * narrowPathProb 缺省或 ≥1 时恒为 true，即与该参数引入前完全一致；≤0 时恒不出现。
   * 两个铺盒流程（旧 buildBoard 与新 buildStructureCandidateFixed）共用本判定，避免口径分裂。
   */
  function narrowPathHits(config) {
    var p = (config && config.narrowPathProb != null) ? parseFloat(config.narrowPathProb) : 1;
    if (!(p >= 0)) p = 1;                 // 非法值按默认必定出现处理
    if (p >= 1) return true;
    if (p <= 0) return false;
    return Math.random() < p;
  }

  function makeCapPicker(config) {
    var boxMin = config.boxSizeMin || 40;
    var boxMax = config.boxSizeMax || 56;
    if (boxMax < boxMin) { var t = boxMin; boxMin = boxMax; boxMax = t; }
    var mode = config.boxSizeMode || 'random';
    var span = boxMax - boxMin;
    var bias = (config.boxSizePolarBias != null) ? config.boxSizePolarBias : 0.7;
    var bandRatio = (config.boxSizePolarBandRatio != null) ? config.boxSizePolarBandRatio : 0.25;
    var band = Math.max(0, Math.round(span * bandRatio));
    function uniform(lo, hi) { return lo + Math.floor(Math.random() * (hi - lo + 1)); }
    return function pickCap() {
      if (mode === 'max') return boxMax;
      if (mode === 'min') return boxMin;
      if (mode === 'polar' && span > 0) {
        if (Math.random() < bias) {
          return (Math.random() < 0.5) ? uniform(boxMin, boxMin + band)   // 低端窄带
            : uniform(boxMax - band, boxMax);                              // 高端窄带
        }
        return uniform(boxMin, boxMax);                                    // 其余仍全区间均匀
      }
      return uniform(boxMin, boxMax);                                      // random(默认)：区间内均匀随机
    };
  }

  function solverGuidedBoxes(blocks, config) {
    var rows = blocks.length, cols = blocks[0].length;
    var boxMin = config.boxSizeMin || 40;
    var boxMax = config.boxSizeMax || 56;
    if (boxMax < boxMin) { var t = boxMin; boxMin = boxMax; boxMax = t; }
    var pickCap = makeCapPicker(config);   // 三处铺盒共用同一采样器（含 polar 两极化）

    var Sim = AntSolver.Simulator;
    var bottomOnly = !!config.bottomOnly;
    // 初始 eliminated：仅与外部连通的空格（对齐引擎 computeReach）；bottomOnly 时只从底边连通区播种
    var eliminated = AntSolver.outsideReachSeed(blocks, rows, cols, bottomOnly);

    var boxes = [];
    var guard = rows * cols + 100; // 安全上限

    while (guard-- > 0) {
      var cap = pickCap();
      // 统计每种颜色当前可达的像素数（用flood-fill模拟；上限用 boxMax 以正确比较各色规模）
      var colorReach = countReachableByColor(eliminated, blocks, rows, cols, boxMax, bottomOnly);
      var colors = Object.keys(colorReach);
      if (colors.length === 0) break; // 全部消除完毕

      // 选可达数最多的颜色
      var bestColor = null, bestReach = 0;
      for (var i = 0; i < colors.length; i++) {
        if (colorReach[colors[i]] > bestReach) {
          bestReach = colorReach[colors[i]];
          bestColor = parseInt(colors[i]);
        }
      }
      if (bestColor === null) break;

      // 消除一个盒容量的量（本盒随机容量 cap，守恒由循环持续消除保证）
      var consumed = Sim.floodFillEliminate(eliminated, blocks, rows, cols, bestColor, cap, null, null, bottomOnly);
      if (consumed <= 0) break; // 无法继续（不应发生）

      boxes.push({ color: bestColor, count: consumed });
    }

    // 合并每种颜色尾部过小的盒子（自洽规则：最后一盒不满则与前一盒求和均分）
    boxes = mergeSmallTailBoxes(boxes, boxMin, boxMax);

    return boxes;
  }

  /**
   * 趋势/消除顺序盒序列（生产端接入 utils 的趋势分析）。
   *
   * 以 AntSolver.bottomTrendPixels 得到【目标图底→顶、行内左→右】的趋势像素流——它表达视觉/依赖
   * 消除趋势(先消底部、颜色可交错)，正是消除顺序视图的同一口径。像素按趋势流到达时装入该色当前开箱，
   * 达到本盒容量即封箱；每盒容量按 boxSizeMode 独立采样，保留“区间内随机”造成的大小差距(守恒由持续分箱保证)。
   * 盒最终按 trendStart(消除趋势先后)排序，其数组下标即【基础消除顺序 elimSeq】，供 buildBoard 顺序填入。
   *
   * 返回的盒序列真实可解性仍由外层 Solver.solve 判定/重试；此处只负责“趋势=消除顺序”的盒切分与排序。
   */
  function baseFillBoxes(blocks, config) {
    var rows = blocks.length, cols = blocks[0].length;
    var boxMin = config.boxSizeMin || 40, boxMax = config.boxSizeMax || 56;
    if (boxMax < boxMin) { var t = boxMin; boxMin = boxMax; boxMax = t; }
    var pickCap = makeCapPicker(config);   // 三处铺盒共用同一采样器（含 polar 两极化）

    var pixels = AntSolver.bottomTrendPixels(blocks, rows, cols);
    var boxes = [], active = {}, perColor = {}, capOf = {};
    for (var i = 0; i < pixels.length; i++) {
      var p = pixels[i], box = active[p.color];
      if (!box) {
        box = { color: p.color, count: 0, trendStart: p.trend };
        active[p.color] = box; boxes.push(box);
        (perColor[p.color] = perColor[p.color] || []).push(box);
        capOf[p.color] = pickCap();               // 每盒独立容量→制造大小差距
      }
      box.count++;
      if (box.count >= capOf[p.color]) active[p.color] = null; // 封箱
    }
    // 同色尾盒不足下限：与前一同色盒合并平分(自洽)，两盒趋势位置不动 → 棋盘趋势排序稳定
    for (var color in perColor) {
      var group = perColor[color];
      if (group.length < 2) continue;
      var tail = group[group.length - 1], prev = group[group.length - 2];
      if (tail.count >= boxMin) continue;
      var total = prev.count + tail.count;
      prev.count = Math.ceil(total / 2); tail.count = Math.floor(total / 2);
    }
    boxes.sort(function (a, b) { return a.trendStart - b.trendStart; });
    for (var bi = 0; bi < boxes.length; bi++) { boxes[bi].elimSeq = bi; delete boxes[bi].trendStart; }
    return boxes;
  }

  /**
   * 【仅底部入口模式】的盒切分（ANT-GEN-BOTTOM-ONLY-20260729，用户决定 D3）。
   *
   * 与默认 baseFillBoxes 的唯一区别是【像素流来源】：
   *   - 默认(四边入口)：AntSolver.bottomTrendPixels —— 底→顶、行内左→右的【纯几何】趋势扫描，
   *     不含可达/依赖概念（四边都是开口，几何顺序已足够近似真实消除趋势）。
   *   - 底部入口：AntSolver.eliminationOrder(blocks, rows, cols, true).order —— 从【只有底边开口】的
   *     外部连通空格起，每轮选当前可达像素最多的颜色、一次消完其全部当前可达像素，逐轮向内推进。
   *     这就是用户 D3 要的"消除仍由底往上、仍包含依赖，只是可达区域开局少了三个方向"：
   *     几何扫描会把"贴着顶边/左右边、但底部模式下要等下方清开才摸得到"的像素排在前面，
   *     依赖流不会——它严格按真实可达闭包推进。
   *
   * 装箱规则与 baseFillBoxes 完全一致（同色累积到本盒容量即封箱、每盒独立采样容量制造大小差距、
   * 同色尾盒不足下限则与前一同色盒合并平分、最后按首次出现次序定 elimSeq）。
   * 【维护提示】本函数与 baseFillBoxes 的装箱规则是同一套；改其中一处时必须同步另一处。
   * 之所以不抽公共函数：用户明确本模式是"区别于当前生成器的分支"，且 baseFillBoxes 内 pickCap 依赖
   * Math.random 无法做逐字节回归，保持四边默认链路一行不动的风险最低。
   *
   * 前提：调用方应已通过 checkBottomEntryFeasibility 确认全图可达。若仍有永久不可达像素，
   * eliminationOrder 会在无可消时停止，此处产出的盒总量将【小于】目标图像素总数 —— 守恒基线
   * (buildConservationBaseline) 会因此判定失败并淘汰该候选，不会静默产出缺量关卡。
   */
  function baseFillBoxesBottom(blocks, config) {
    // v110：默认走【多色并行吐球】。boxParallelCount=0 时回退到下方的旧单色批量路径。
    var P = (config.boxParallelCount != null) ? config.boxParallelCount
      : ((config.bufferLimit != null) ? config.bufferLimit : 5);
    if (P > 0) return baseFillBoxesBottomParallel(blocks, config, P);

    var rows = blocks.length, cols = blocks[0].length;
    var boxMin = config.boxSizeMin || 40, boxMax = config.boxSizeMax || 56;
    if (boxMax < boxMin) { var t = boxMin; boxMin = boxMax; boxMax = t; }
    var pickCap = makeCapPicker(config);   // 三处铺盒共用同一采样器（含 polar 两极化）

    // 底部依赖流：order 已按真实消除先后排好，seq(1..N) 即全局消除序号，用作 trendStart 口径。
    var elim = AntSolver.eliminationOrder(blocks, rows, cols, true);
    var pixels = elim.order || [];
    var boxes = [], active = {}, perColor = {}, capOf = {};
    for (var i = 0; i < pixels.length; i++) {
      var p = pixels[i], box = active[p.color];
      if (!box) {
        box = { color: p.color, count: 0, trendStart: p.seq };
        active[p.color] = box; boxes.push(box);
        (perColor[p.color] = perColor[p.color] || []).push(box);
        capOf[p.color] = pickCap();               // 每盒独立容量→制造大小差距
      }
      box.count++;
      if (box.count >= capOf[p.color]) active[p.color] = null; // 封箱
    }
    // 同色尾盒不足下限：与前一同色盒合并平分(自洽)，两盒依赖位置不动 → 棋盘顺序稳定
    for (var color in perColor) {
      var group = perColor[color];
      if (group.length < 2) continue;
      var tail = group[group.length - 1], prev = group[group.length - 2];
      if (tail.count >= boxMin) continue;
      var total = prev.count + tail.count;
      prev.count = Math.ceil(total / 2); tail.count = Math.floor(total / 2);
    }
    boxes.sort(function (a, b) { return a.trendStart - b.trendStart; });
    for (var bi = 0; bi < boxes.length; bi++) { boxes[bi].elimSeq = bi; delete boxes[bi].trendStart; }
    return boxes;
  }

  /**
   * 【仅底部入口】多色并行吐球盒切分（v110，任务 `ANT-GEN-BOTTOM-PARALLEL-V3-20260826`）。
   *
   * ── 为什么要换掉旧路径 ──
   * 旧路径的像素流来自 `AntSolver.eliminationOrder(…, true)`，那是**按轮次批量**消除：
   * 每轮挑「当前可达像素最多」的【一个】颜色，一次 flood fill 消掉它全部可达像素。
   * 于是 order 是一段段单色长串（一段可达数百像素），装箱时同色连续累积成多个盒，
   * 且盒按【首个像素 seq】排序 → 同一段产出的盒在队列里连续 → 逐行左→右铺进棋盘就是一整排同色。
   * 实测（`输出文件/底部消除` 287 关合格关卡）：前 3 行最大同色簇中位 4 盒、极端 12 盒，
   * 最长横排同色 9 个，前 3 行只有 6 种颜色，水平同色对占比 87.9%。
   *
   * ── 本函数怎么做（用户 2026-08-26 口径）──
   *   1) 起点取底边最中心；每个颜色内部优先取「距起点最近」的可达像素 → 向左右和上方扩散
   *   2) 维持 P 个活跃槽位，每槽绑一个颜色和一个正在装的盒（容量由 makeCapPicker 独立采样）
   *   3) 每 tick 轮询各槽，每槽各积累 1 个像素；消除即揭露邻居，供所有颜色后续取用
   *   4) 某槽装满本盒 → 立刻挤出成队列里一个完整盒 → 该槽补新颜色，始终保持 P 路在扫
   *   5) 收尾：活跃槽 + 挂起槽的余量挤出；同色尾盒不足下限沿用「与前一同色盒合并平分」
   * 队列顺序即消除趋势顺序，`elimSeq` = 挤出下标。填棋盘规则与障碍/换球等后续逻辑均不变。
   *
   * ── 两个必须这样写的细节（都是实测踩出来的）──
   * ① **可达口径必须与 `simulator.js` 的 `reachable()` 一致**：`bottomOnly` 下【底行恒可达】，
   *    其余格靠「四邻中有已消除格」。部分图纸满图无背景（如 55×55 全彩 3025 像素），
   *    只用 `outsideReachSeed` 播种会得到**空前沿、产出 0 盒**。
   * ② **颜色可达像素暂时耗尽时必须【挂起保留进度】，不能就地挤出未满盒**。
   *    就地挤出会产生大量小盒：实测盒总数 61 → 99（p90 123、max 187），
   *    而棋盘可容纳约 62 盒（7×9 扣黑块/墙/管道格 ≈38 格 + 4 管×6 深 = 24），直接装不下。
   *    挂起后盒总数回到 60，与旧路径持平。用户口径也是「每满一个盒才挤出一个」。
   *
   * ── 实测效果（347 张图纸全量，与旧路径同参数对照）──
   * 队列同色 run 最长 5/7/16 → 2/3/5；前 3 行最大同色簇 5/8/16 → 2/3/4；同色对数 16/20/27 → 2/4/8；
   * 前 3 行色数 7 → 10；最大单色占比 25.9% → 22.2%；水平同色对占比 88.0% → 6.5%；
   * 「最大同色簇 ≤2」达标率 1.4% → 82.1%；盒总数 61 → 60；像素守恒 100%（两者皆是）。
   * 已追平/略优于四方向 v99 上线批次（簇 2/3/7、色数 10、单色 22.7%）。
   * 脚本：`_kiro临时/08.26-底部吐球重设计/_原型对比.js`。
   *
   * ── 已实测的代价 ──
   * 交错把压力从后期挪到前期：前期峰（5% 窗）0.33 → 1.83，`earlyOK` 10/10 → 7/10，
   * `trendOK` 7/10 → 4/10。可解率不受影响（10/10）。
   * 难度分的影响**测不出来**（三轮 10 关样本给出 65→82、72→87.5、73→76，无种子控制，噪声大于效应）。
   *
   * @param {number[][]} blocks 目标图
   * @param {object} config 生产参数
   * @param {number} P 并行槽位数（>=1；调用方已保证，0 走旧路径）
   * @returns {Array<{color:number,count:number,elimSeq:number}>} 盒队列，下标即消除趋势顺序
   */
  function baseFillBoxesBottomParallel(blocks, config, P) {
    var rows = blocks.length, cols = blocks[0].length;
    var boxMin = config.boxSizeMin || 40, boxMax = config.boxSizeMax || 56;
    if (boxMax < boxMin) { var t0 = boxMin; boxMin = boxMax; boxMax = t0; }
    var pickCap = makeCapPicker(config);   // 与另两处铺盒共用同一采样器（含 polar 两极化）

    // 已消除矩阵：先放入「从底边可达的背景连通区」。满图无背景时这里全 false，靠下面的底行播种起步。
    var elim = AntSolver.outsideReachSeed(blocks, rows, cols, true);

    var startR = rows - 1, startC = Math.floor((cols - 1) / 2);   // 底边最中心
    function distOf(r, c) { return Math.abs(r - startR) + Math.abs(c - startC); }
    // 同距离时：更靠底优先，再取离中心列更近的 → 「向左右和上方扩散」
    function cmpPix(a, b) {
      return (a.d - b.d) || (b.r - a.r) || (Math.abs(a.c - startC) - Math.abs(b.c - startC));
    }
    function makeHeap() {
      var a = [];
      return {
        size: function () { return a.length; },
        top: function () { return a[0]; },
        push: function (x) {
          a.push(x);
          var i = a.length - 1;
          while (i > 0) {
            var p = (i - 1) >> 1;
            if (cmpPix(a[i], a[p]) < 0) { var s = a[i]; a[i] = a[p]; a[p] = s; i = p; } else break;
          }
        },
        pop: function () {
          var top = a[0], last = a.pop();
          if (a.length) {
            a[0] = last;
            var i = 0;
            for (;;) {
              var l = 2 * i + 1, r = 2 * i + 2, m = i;
              if (l < a.length && cmpPix(a[l], a[m]) < 0) m = l;
              if (r < a.length && cmpPix(a[r], a[m]) < 0) m = r;
              if (m === i) break;
              var s2 = a[i]; a[i] = a[m]; a[m] = s2; i = m;
            }
          }
          return top;
        }
      };
    }

    var colorHeap = {};                                       // 色 → 该色的候选可达像素堆
    var queued = AntSolver.create2D(rows, cols, false);
    var DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    function expose(r, c) {
      if (r < 0 || r >= rows || c < 0 || c >= cols) return;
      if (elim[r][c] || queued[r][c]) return;
      var col = blocks[r][c];
      if (col <= 0) return;                                   // 背景不入盒
      queued[r][c] = true;
      if (!colorHeap[col]) colorHeap[col] = makeHeap();
      colorHeap[col].push({ r: r, c: c, d: distOf(r, c) });
    }
    // 初始前沿 —— 与 simulator.js floodFillEliminate 的 reachable() 同口径：
    for (var c0 = 0; c0 < cols; c0++) expose(rows - 1, c0);    // ① bottomOnly 下底行恒可达
    for (var r1 = 0; r1 < rows; r1++) {                        // ② 贴着已消除背景的
      for (var c1 = 0; c1 < cols; c1++) {
        if (!elim[r1][c1]) continue;
        for (var d1 = 0; d1 < 4; d1++) expose(r1 + DIRS[d1][0], c1 + DIRS[d1][1]);
      }
    }

    var totalPixels = 0;
    for (var ra = 0; ra < rows; ra++) for (var ca = 0; ca < cols; ca++) if (blocks[ra][ca] > 0) totalPixels++;

    var boxes = [], perColor = {}, taken = {};
    function freshTop(col) {                                   // 丢掉堆顶已被消除的陈旧节点
      var h = colorHeap[col];
      while (h && h.size()) {
        var tp = h.top();
        if (elim[tp.r][tp.c]) { h.pop(); continue; }
        return tp;
      }
      return null;
    }
    function pickColor() {                                     // 挑「有可达像素且未被占用」中最靠前的色
      var best = null, bestT = null;
      for (var k in colorHeap) {
        var col = parseInt(k, 10);
        if (taken[col]) continue;
        var tp = freshTop(col);
        if (!tp) continue;
        if (!bestT || cmpPix(tp, bestT) < 0) { bestT = tp; best = col; }
      }
      return best;
    }
    function openSlot() {
      var col = pickColor();
      if (col == null) return null;
      taken[col] = true;
      return { color: col, count: 0, cap: pickCap() };         // 每盒独立采样容量 → 制造大小差距
    }
    function emit(s) {
      var box = { color: s.color, count: s.count };
      boxes.push(box);
      if (!perColor[s.color]) perColor[s.color] = [];
      perColor[s.color].push(box);
    }

    var slots = [], parked = [];                               // parked：颜色暂无可达像素、挂起保留进度
    for (var i0 = 0; i0 < P; i0++) { var s0 = openSlot(); if (s0) slots.push(s0); else break; }

    var guard = totalPixels * 4 + 1000, guardN = 0;            // 死循环护栏
    while ((slots.length || parked.length) && guardN++ < guard) {
      var progressed = false;
      // 挂起槽复活：其颜色重新有可达像素就回到轮询（优先于开新色，避免半成品盒堆积）
      for (var pi = 0; pi < parked.length; pi++) {
        if (freshTop(parked[pi].color)) {
          slots.push(parked[pi]); parked.splice(pi, 1); pi--; progressed = true;
        }
      }
      for (var si = 0; si < slots.length; si++) {
        var s = slots[si], tp2 = freshTop(s.color);
        if (!tp2) {
          // 该色被别的颜色挡住、要等它先消 → 挂起，不挤出未满盒（见函数头注释②）
          parked.push(s); slots.splice(si, 1); si--;
          var nsA = openSlot();                                // 补一路，维持 P 路持续在扫
          if (nsA) { slots.push(nsA); progressed = true; }
          continue;
        }
        colorHeap[s.color].pop();
        elim[tp2.r][tp2.c] = true;
        s.count++;
        for (var d2 = 0; d2 < 4; d2++) expose(tp2.r + DIRS[d2][0], tp2.c + DIRS[d2][1]);
        progressed = true;
        if (s.count >= s.cap) {                                // 装满 → 立刻挤出一个完整盒
          emit(s);
          delete taken[s.color];
          var nsB = openSlot();
          if (nsB) slots[si] = nsB; else { slots.splice(si, 1); si--; }
        }
      }
      if (!progressed) break;
    }
    // 收尾：仍在装的槽 + 挂起槽把余量挤出（否则丢球，守恒基线会淘汰该候选）
    var rest = slots.concat(parked);
    for (var q0 = 0; q0 < rest.length; q0++) if (rest[q0] && rest[q0].count > 0) emit(rest[q0]);

    // 同色尾盒不足下限：与前一同色盒合并平分（沿用旧路径同一规则，不改盒在队列中的位置）
    for (var color2 in perColor) {
      var grp = perColor[color2];
      if (grp.length < 2) continue;
      var tailB = grp[grp.length - 1], prevB = grp[grp.length - 2];
      if (tailB.count >= boxMin) continue;
      var tot = prevB.count + tailB.count;
      prevB.count = Math.ceil(tot / 2); tailB.count = Math.floor(tot / 2);
    }
    // 挤出顺序即消除趋势顺序（旧路径靠 trendStart 排序，本路径天然有序，无需再排）
    for (var bi2 = 0; bi2 < boxes.length; bi2++) boxes[bi2].elimSeq = bi2;
    return boxes;
  }

  /**
   * 按当前 config 选择盒切分分支（唯一分发点，新旧流程共用）。
   *   bottomOnly=true  → baseFillBoxesBottom（底部依赖流）
   *   baseFillByElimOrder!==false → baseFillBoxes（默认：几何趋势流）
   *   否则 → solverGuidedBoxes（旧的"贪心可达最多色"序，其内部也已按 config.bottomOnly 取可达口径）
   */
  function pickBoxSplit(blocks, config) {
    // 瞬时连锁模式固定四方向：绝不走底部依赖流分支（需求 §七.3：不得继承底部单入口结构限制）。
    // 盒切分本身复用现有四方向口径，不新写第二套可达算法（需求 §十二）。
    if (config.instantChain) {
      return config.baseFillByElimOrder !== false ? baseFillBoxes(blocks, config) : solverGuidedBoxes(blocks, config);
    }
    if (config.bottomOnly) return baseFillBoxesBottom(blocks, config);
    return config.baseFillByElimOrder !== false ? baseFillBoxes(blocks, config) : solverGuidedBoxes(blocks, config);
  }

  /**
   * 【仅底部入口】生产前可达性检查（原需求 §四 / 方案 C1）。
   *
   * 为什么必须查：Simulator.floodFillEliminate 的 reachable() 只从【底边】与【已消除格】扩散，
   * 而空白格仅在 outsideReachSeed 初始播种时才会被标为已消除。底部模式只播"与底边连通"的空白，
   * 于是【只与顶/左/右背景连通的空腔】永远打不通，被它包围的色块永久摸不到。四边模式下这些空腔
   * 一开始就被播种了，所以这是底部模式独有的结构性风险，必须在进入高成本候选生成之前判掉，
   * 避免把"源图结构不适配"误报成"生成器超时"。
   *
   * 算法：复用现有可达逻辑，不引入新算法。从 outsideReachSeed(...,true) 起，反复对每种剩余颜色执行
   * floodFillEliminate(..., Infinity, ..., true)，直到某一轮 0 消除；此时仍未消除的彩色像素即永久不可达。
   *
   * @returns {object} { ok, total, left, byColor, positions, rows, cols }
   *   ok=true 表示全图可达；left 为不可达像素数；positions 最多记录前 50 个坐标供美术定位修改。
   */
  /**
   * ==================== 目标图碎色率（生产前置闸门用） ====================
   * 任务 ANT-GEN-FRAGMENT-GATE-20260824，用户 2026-08-24 批准。
   *
   * 「碎色」= 目标图上那些【自己不够大、附近同色也凑不够】的色块。它们迫使一个 35~80 容量的盒
   * 跨越许多互不相连的小片去吃饱，从而拉长订单滞留。本函数只读目标图，不涉及棋盘与障碍。
   *
   * 口径（与 08-24 标定完全一致，改任一项都会使阈值失效）：
   *   ① 同色 4-连通分块 —— 与游戏消除口径一致（floodFillEliminate 也是四方向）。
   *   ② 孤立块 size<=isoMax(1)；小色块 isoMax<size<=smallMax(10)；正常块 size>smallMax。
   *   ③ 簇扩展：两同色块之间的「隔断」= 夹着的异色像素数 px 与颜色种类数 kinds。
   *      因目标图完全填满(实测 344/345 关无背景)，px 与曼哈顿距离等价(差 ±1)。
   *      停止条件按 AND：kinds>barrierKinds(1) 且 px>barrierPx(3) 才判定隔开、不并簇。
   *      （AND 为用户原式；08-24 扫描显示其优于 OR，故保留。）
   *   ④ 长期隔断过滤：隔断色若【不会先于本色被消除】，则视为长期隔断、不并簇。
   *      本色/隔断色的消除先后取自 AntSolver.eliminationOrder 的真实轮次。
   *   ⑤ 簇总像素 > smallMax 时，整簇内的小/孤立块改判正常（被"救回"）。
   *   ⑥ 碎色率 = 最终仍为碎色的像素数 ÷ 目标图彩色像素总数。
   *
   * @param {Array<Array<number>>} blocks 目标图
   * @param {object} [cfg] 覆盖口径参数（fragmentIsoMax/fragmentSmallMax/fragmentBarrierPx/fragmentBarrierKinds）
   *                       另可传 fragmentDetail:true 索取块级明细（默认不返回，见下）
   * @returns {object} { rate, isoRate, smallRate, fragPixels, totalPixels, fragBlocks, blocks:块数,
   *                     maxColorRate:最碎单色碎色率, avgFragDepth:碎色平均消除轮次, rounds }
   *                   传 fragmentDetail 时【额外】带上（不传则这三个字段不存在）：
   *                     fragCells:[{r,c,color,size,iso}]  —— 碎色像素坐标，length === fragPixels
   *                     fragBlockList:[{color,size,iso,cells}] —— 碎色块，length === fragBlocks
   *                     perColorDetail:[{color,total,frag,rate}] —— 分色明细，按碎色率降序
   *                   明细是「并簇救回之后」的最终判定结果，与 rate 同口径 ——
   *                   这正是它存在的理由：调用方自己按块大小近似会把视觉上连续的条带误判为碎色。
   */
  function computeFragmentation(blocks, cfg) {
    cfg = cfg || {};
    var isoMax = cfg.fragmentIsoMax != null ? cfg.fragmentIsoMax : 1;
    var smallMax = cfg.fragmentSmallMax != null ? cfg.fragmentSmallMax : 7;
    var barPx = cfg.fragmentBarrierPx != null ? cfg.fragmentBarrierPx : 3;
    var barKinds = cfg.fragmentBarrierKinds != null ? cfg.fragmentBarrierKinds : 1;
    var empty = { rate: 0, isoRate: 0, smallRate: 0, fragPixels: 0, totalPixels: 0, fragBlocks: 0, blocks: 0, maxColorRate: 0, avgFragDepth: 0, rounds: 0 };
    if (!blocks || !blocks.length || !blocks[0]) return empty;
    var rows = blocks.length, cols = blocks[0].length;
    var DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

    // ① 同色 4-连通分块
    var lab = [], r, c, i;
    for (r = 0; r < rows; r++) { lab.push([]); for (c = 0; c < cols; c++) lab[r].push(-1); }
    var compColor = [], compSize = [], compCells = [];
    for (r = 0; r < rows; r++) for (c = 0; c < cols; c++) {
      var v = blocks[r][c];
      if (v > 0 && lab[r][c] < 0) {
        var id = compColor.length, stack = [[r, c]], cells = [];
        lab[r][c] = id;
        while (stack.length) {
          var cur = stack.pop(); cells.push(cur);
          for (var d = 0; d < 4; d++) {
            var ny = cur[0] + DIRS[d][0], nx = cur[1] + DIRS[d][1];
            if (ny < 0 || ny >= rows || nx < 0 || nx >= cols) continue;
            if (blocks[ny][nx] === v && lab[ny][nx] < 0) { lab[ny][nx] = id; stack.push([ny, nx]); }
          }
        }
        compColor.push(v); compSize.push(cells.length); compCells.push(cells);
      }
    }
    var N = compColor.length;
    if (!N) return empty;
    var totalPx = 0;
    for (i = 0; i < N; i++) totalPx += compSize[i];

    // 消除轮次（长期隔断判定 + 碎色深度）。失败则退化为不做长期隔断过滤，不阻断生产。
    var roundOf = null, roundsTotal = 0, colorFirst = {};
    try {
      var eo = AntSolver.eliminationOrder(blocks, rows, cols, false);
      roundOf = eo.round; roundsTotal = eo.rounds;
      for (r = 0; r < rows; r++) for (c = 0; c < cols; c++) {
        var rd = roundOf[r][c] || 0, cv = blocks[r][c];
        if (cv > 0 && rd) { if (colorFirst[cv] == null || rd < colorFirst[cv]) colorFirst[cv] = rd; }
      }
    } catch (e) { roundOf = null; }

    // 颜色索引（隔断种类掩码用）
    var colorIdx = {}, colorList = [], cnum = 0;
    for (i = 0; i < N; i++) if (colorIdx[compColor[i]] == null) { colorIdx[compColor[i]] = cnum++; colorList.push(compColor[i]); }

    // ③ 0-1 BFS 逐色求相邻同色块对的隔断，并按门限并簇
    var parent = [];
    for (i = 0; i < N; i++) parent.push(i);
    function find(x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
    function union(a, b) { var ra = find(a), rb = find(b); if (ra !== rb) parent[rb] = ra; }

    var byColor = {};
    for (i = 0; i < N; i++) { (byColor[compColor[i]] = byColor[compColor[i]] || []).push(i); }
    for (var ci = 0; ci < colorList.length; ci++) {
      var col = colorList[ci], ks = byColor[col];
      if (!ks || ks.length < 2) continue;
      var cost = [], mask = [], own = [];
      for (r = 0; r < rows; r++) {
        cost.push([]); mask.push([]); own.push([]);
        for (c = 0; c < cols; c++) { cost[r].push(1e9); mask[r].push(0); own[r].push(-1); }
      }
      var q = [], head = 0;
      for (i = 0; i < ks.length; i++) {
        var cc2 = compCells[ks[i]];
        for (var j = 0; j < cc2.length; j++) { cost[cc2[j][0]][cc2[j][1]] = 0; own[cc2[j][0]][cc2[j][1]] = ks[i]; q.push(cc2[j]); }
      }
      var seenPair = {};
      function tryPair(a, b, px, m) {
        if (a === b) return;
        var lo = a < b ? a : b, hi = a < b ? b : a, key = lo + '_' + hi;
        var prev = seenPair[key];
        if (prev != null && prev.px <= px) return;
        seenPair[key] = { px: px, mask: m };
      }
      while (head < q.length) {
        var p0 = q[head++], y0 = p0[0], x0 = p0[1];
        var cy = cost[y0][x0], my = mask[y0][x0], oy = own[y0][x0];
        for (var dd = 0; dd < 4; dd++) {
          var ny2 = y0 + DIRS[dd][0], nx2 = x0 + DIRS[dd][1];
          if (ny2 < 0 || ny2 >= rows || nx2 < 0 || nx2 >= cols) continue;
          var vv = blocks[ny2][nx2];
          if (vv === col) {
            var o2 = own[ny2][nx2];
            if (o2 >= 0 && o2 !== oy) tryPair(oy, o2, cy, my);
            continue;
          }
          if (vv <= 0 || colorIdx[vv] == null) continue;
          var nm = my | (1 << colorIdx[vv]), nc = cy + 1;
          if (nc < cost[ny2][nx2]) { cost[ny2][nx2] = nc; mask[ny2][nx2] = nm; own[ny2][nx2] = oy; q.push([ny2, nx2]); }
          else if (own[ny2][nx2] >= 0 && own[ny2][nx2] !== oy) tryPair(oy, own[ny2][nx2], nc + cost[ny2][nx2] - 1, nm | mask[ny2][nx2]);
        }
      }
      for (var key2 in seenPair) {
        var e = seenPair[key2], parts = key2.split('_');
        var kinds = 0, mm = e.mask;
        while (mm) { kinds += (mm & 1); mm >>>= 1; }
        if (kinds > barKinds && e.px > barPx) continue;              // AND：又杂又厚才算隔开
        if (roundOf) {                                              // ④ 长期隔断过滤
          var latest = 0, m2 = e.mask, bi = 0;
          while (m2) { if (m2 & 1) { var fr = colorFirst[colorList[bi]] || 0; if (fr > latest) latest = fr; } m2 >>>= 1; bi++; }
          var ownFirst = colorFirst[col] || 0;
          if (latest && ownFirst && latest >= ownFirst) continue;    // 隔断色不会先消掉 → 长期隔断
        }
        union(parseInt(parts[0], 10), parseInt(parts[1], 10));
      }
    }

    // ⑤⑥ 结算
    var clusterPx = {};
    for (i = 0; i < N; i++) { var rt = find(i); clusterPx[rt] = (clusterPx[rt] || 0) + compSize[i]; }
    var fragPx = 0, isoPx = 0, smallPx = 0, fragBlocks = 0, depthW = 0;
    var perColorFrag = {}, perColorTot = {};
    // 【可选块级明细】任务 ANT-GEN-FRAGMENT-DETAIL-20260825，用户 2026-08-25 批准。
    //   只有显式传 cfg.fragmentDetail 才收集；不传时下面两个数组恒为 null，
    //   返回值与本参数引入前【逐字段完全相同】。
    //
    // 为什么要加：修图工具需要把"哪些像素被判为碎色"高亮给美术看，而本函数原先只返回汇总指标。
    //   工具侧只能自己按"块自身大小"近似判定，拿不到下面这两个 continue 的并簇救回结果，
    //   于是把【视觉上连续的条带】也标成了碎色（实测 6 张图误标 608 块，其中与最近同色块
    //   只隔 1 像素的占 559 块、条带形状占 427 块）。用户实机发现并反馈。
    //   在工具侧复刻并簇逻辑等于再造一份算法，所以改为由本函数把内部已知的结果输出出去。
    //
    // 零计算改动：明细完全来自本循环已有的 compCells[i] 与既有的两个 continue 判据，
    //   不新增任何判断、不改任何阈值比较、不影响任何汇总字段。
    var wantDetail = !!(cfg && cfg.fragmentDetail);
    var detailCells = wantDetail ? [] : null;      // 碎色像素坐标 [{r,c,color,size,iso}]
    var detailBlocks = wantDetail ? [] : null;     // 碎色块 [{color,size,iso,cells:[[r,c],...]}]
    for (i = 0; i < N; i++) perColorTot[compColor[i]] = (perColorTot[compColor[i]] || 0) + compSize[i];
    for (i = 0; i < N; i++) {
      if (compSize[i] > smallMax) continue;
      if (clusterPx[find(i)] > smallMax) continue;
      fragPx += compSize[i]; fragBlocks++;
      var isIso = compSize[i] <= isoMax;
      if (isIso) isoPx += compSize[i]; else smallPx += compSize[i];
      perColorFrag[compColor[i]] = (perColorFrag[compColor[i]] || 0) + compSize[i];
      if (wantDetail) {
        var dc = compCells[i];
        detailBlocks.push({ color: compColor[i], size: compSize[i], iso: isIso, cells: dc });
        for (var dz = 0; dz < dc.length; dz++) {
          detailCells.push({ r: dc[dz][0], c: dc[dz][1], color: compColor[i], size: compSize[i], iso: isIso });
        }
      }
      if (roundOf) {
        var cl = compCells[i], sum = 0;
        for (var z = 0; z < cl.length; z++) sum += (roundOf[cl[z][0]][cl[z][1]] || 0);
        depthW += sum;
      }
    }
    var maxColorRate = 0;
    for (var cid in perColorTot) {
      if (!perColorTot[cid]) continue;
      var rr = (perColorFrag[cid] || 0) / perColorTot[cid];
      if (rr > maxColorRate) maxColorRate = rr;
    }
    var res = {
      rate: totalPx ? fragPx / totalPx : 0,
      isoRate: totalPx ? isoPx / totalPx : 0,
      smallRate: totalPx ? smallPx / totalPx : 0,
      fragPixels: fragPx, totalPixels: totalPx, fragBlocks: fragBlocks, blocks: N,
      maxColorRate: +maxColorRate.toFixed(4),
      avgFragDepth: fragPx ? +(depthW / fragPx).toFixed(2) : 0,
      rounds: roundsTotal
    };
    // 可选明细：只在 cfg.fragmentDetail 为真时挂上，否则返回体与本参数引入前完全一致。
    //   perColorDetail 也一并给出（按颜色汇总的正式碎色量），供工具告诉美术"先修哪个颜色"。
    if (wantDetail) {
      var pcd = [];
      for (var pcid in perColorTot) {
        pcd.push({
          color: parseInt(pcid, 10),
          total: perColorTot[pcid],
          frag: perColorFrag[pcid] || 0,
          rate: perColorTot[pcid] ? +((perColorFrag[pcid] || 0) / perColorTot[pcid]).toFixed(4) : 0
        });
      }
      pcd.sort(function (a, b) { return (b.rate - a.rate) || (b.frag - a.frag); });
      res.fragCells = detailCells;         // 长度恒等于 fragPixels
      res.fragBlockList = detailBlocks;    // 长度恒等于 fragBlocks
      res.perColorDetail = pcd;            // 分色明细，按碎色率降序
    }
    return res;
  }

  /**
   * 生产前置碎色闸门：碎色率超过 config.fragmentMaxRate 即判定该源图不适合生产。
   * fragmentMaxRate <= 0 表示关闭（默认关闭，行为与本参数引入前完全一致）。
   * @returns {object} { ok, rate, limit, frag, detail }
   */
  function checkFragmentGate(blocks, config) {
    var limit = (config && config.fragmentMaxRate != null) ? config.fragmentMaxRate : 0;
    if (!(limit > 0)) return { ok: true, rate: null, limit: 0, frag: null, detail: '闸门未启用' };
    var f = computeFragmentation(blocks, config || {});
    var ok = f.rate <= limit;
    return {
      ok: ok, rate: +f.rate.toFixed(4), limit: limit, frag: f,
      detail: ok
        ? ('碎色率 ' + (f.rate * 100).toFixed(2) + '% ≤ 上限 ' + (limit * 100).toFixed(2) + '%')
        : ('碎色率 ' + (f.rate * 100).toFixed(2) + '% 超过上限 ' + (limit * 100).toFixed(2) + '%'
           + '（碎色 ' + f.fragPixels + '/' + f.totalPixels + ' 像素，碎块 ' + f.fragBlocks + '/' + f.blocks + '，最碎单色 ' + (f.maxColorRate * 100).toFixed(1) + '%）')
    };
  }

  function checkBottomEntryFeasibility(blocks) {
    if (!blocks || !blocks.length || !blocks[0]) {
      return { ok: false, total: 0, left: 0, byColor: {}, positions: [], rows: 0, cols: 0, detail: '目标图为空' };
    }
    var Sim = AntSolver.Simulator;
    var rows = blocks.length, cols = blocks[0].length;
    var elim = AntSolver.outsideReachSeed(blocks, rows, cols, true);
    var total = 0;
    for (var r0 = 0; r0 < rows; r0++) for (var c0 = 0; c0 < cols; c0++) if (blocks[r0][c0] > 0) total++;
    var guard = rows * cols + 10;
    while (guard-- > 0) {
      var remain = {};
      for (var r1 = 0; r1 < rows; r1++) for (var c1 = 0; c1 < cols; c1++) {
        if (!elim[r1][c1] && blocks[r1][c1] > 0) remain[blocks[r1][c1]] = true;
      }
      var colors = Object.keys(remain);
      if (!colors.length) break;
      var moved = 0;
      for (var ci = 0; ci < colors.length; ci++) {
        moved += Sim.floodFillEliminate(elim, blocks, rows, cols, parseInt(colors[ci], 10), Infinity, null, null, true);
      }
      if (moved <= 0) break;      // 一轮无任何像素可消 → 剩下的都是永久不可达
    }
    var byColor = {}, positions = [], left = 0;
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      if (!elim[r][c] && blocks[r][c] > 0) {
        left++;
        byColor[blocks[r][c]] = (byColor[blocks[r][c]] || 0) + 1;
        if (positions.length < 50) positions.push({ r: r, c: c, color: blocks[r][c] });
      }
    }
    var out = { ok: left === 0, total: total, left: left, byColor: byColor, positions: positions, rows: rows, cols: cols };
    if (left > 0) {
      out.detail = '仅底部入口下有 ' + left + '/' + total + ' 个像素永久不可达（上/左/右封闭后，只与顶/左/右背景连通的空腔打不通）；'
        + '需美术修改目标图结构。首个不可达像素 (r' + positions[0].r + ',c' + positions[0].c + ',色' + positions[0].color + ')';
    }
    return out;
  }

  /**
   * 统计每种颜色当前可达的像素数（不修改eliminated）
   */
  function countReachableByColor(eliminated, blocks, rows, cols, maxPerColor, bottomOnly) {
    var Sim = AntSolver.Simulator;
    bottomOnly = !!bottomOnly;
    var result = {};
    // 先找出所有还有剩余的颜色
    var remainingColors = {};
    for (var r = 0; r < rows; r++)
      for (var c = 0; c < cols; c++)
        if (!eliminated[r][c] && blocks[r][c] > 0) remainingColors[blocks[r][c]] = true;

    for (var colorId in remainingColors) {
      // 复制eliminated，模拟消除该色
      var scratch = [];
      for (var r = 0; r < rows; r++) scratch.push(eliminated[r].slice());
      var reach = Sim.floodFillEliminate(scratch, blocks, rows, cols, parseInt(colorId), maxPerColor, null, null, bottomOnly);
      if (reach > 0) result[colorId] = reach;
    }
    return result;
  }

  /**
   * 合并每种颜色尾部过小的盒子
   * 规则：同色相邻盒中，若某盒 < boxMin，与前一同色盒合并后均分为2盒
   */
  function mergeSmallTailBoxes(boxes, boxMin, boxMax) {
    // 按颜色分组处理（保持原序中每色的相对顺序）
    var byColor = {};
    for (var i = 0; i < boxes.length; i++) {
      var col = boxes[i].color;
      if (!byColor[col]) byColor[col] = [];
      byColor[col].push(i); // 记录索引
    }

    // 对每种颜色的盒子序列，处理尾部小盒
    for (var col in byColor) {
      var idxs = byColor[col];
      if (idxs.length < 2) continue;
      // 检查最后一个盒
      var lastIdx = idxs[idxs.length - 1];
      var prevIdx = idxs[idxs.length - 2];
      if (boxes[lastIdx].count < boxMin) {
        var merged = boxes[lastIdx].count + boxes[prevIdx].count;
        var h1 = Math.ceil(merged / 2), h2 = merged - h1;
        boxes[prevIdx].count = h1;
        boxes[lastIdx].count = h2;
      }
    }
    return boxes;
  }

  /**
   * 容量自洽分盒算法
   * 规则：
   * 1. 目标盒容量 = (boxMin + boxMax) / 2 取整
   * 2. 按目标容量均分像素数
   * 3. 如果最后一盒 < boxMin，与前一盒合并后再均分为2盒
   * 4. 确保每盒都在 [boxMin, boxMax] 范围内
   * 5. 总和严格 = pixelCount
   */
  function splitIntoBoxes(pixelCount, boxMin, boxMax) {
    if (pixelCount <= 0) return [];
    if (pixelCount <= boxMax) return [pixelCount]; // 一盒搞定

    var target = Math.round((boxMin + boxMax) / 2);
    var numBoxes = Math.round(pixelCount / target);
    if (numBoxes < 1) numBoxes = 1;

    // 均分
    var base = Math.floor(pixelCount / numBoxes);
    var remainder = pixelCount - base * numBoxes;
    var boxes = [];
    for (var i = 0; i < numBoxes; i++) {
      boxes.push(base + (i < remainder ? 1 : 0));
    }

    // 检查最后一盒是否太小
    if (boxes.length >= 2) {
      var last = boxes[boxes.length - 1];
      if (last < boxMin) {
        // 与前一盒合并后均分为2盒
        var merged = last + boxes[boxes.length - 2];
        boxes.pop();
        boxes.pop();
        var half1 = Math.ceil(merged / 2);
        var half2 = merged - half1;
        boxes.push(half1);
        boxes.push(half2);
      }
    }

    // 最终校验：如果有盒超出范围，尝试重新均分
    var outOfRange = boxes.some(function(b) { return b < boxMin || b > boxMax; });
    if (outOfRange && pixelCount > boxMax) {
      // 强制重新计算盒数
      numBoxes = Math.ceil(pixelCount / boxMax);
      base = Math.floor(pixelCount / numBoxes);
      remainder = pixelCount - base * numBoxes;
      boxes = [];
      for (var i = 0; i < numBoxes; i++) {
        boxes.push(base + (i < remainder ? 1 : 0));
      }
    }

    // 验证自洽
    var sum = boxes.reduce(function(s,b){return s+b;}, 0);
    if (sum !== pixelCount) {
      // 修正最后一盒
      boxes[boxes.length-1] += (pixelCount - sum);
    }

    return boxes;
  }

  // ==================== 棋盘障碍放置 ====================
  // 全部障碍作用在棋盘 cells 上（不在目标图）。
  //  - ice：给盒子加冰(cell.ice=2|3)，需相邻盒被清除若干次解冻。
  //  - chain：相邻两盒配对(cell.chain=组号)，两端都暴露才可取。
  //  - question：盒子隐藏色(cell.q=true)，软障碍。
  //  - black：占据空格永久阻挡（保证所有盒仍顶部可达）。

  /** 判断所有盒子是否仍从顶部可达（black/pipe 阻挡，盒子视为可通过=最终会被取走）。 */
  function isAllBoxesReachable(cells, rows, cols) {
    var vis = AntSolver.create2D(rows, cols, false);
    var q = [];
    function passable(cell) { return !(cell && (cell.t === 'black' || cell.t === 'pipe')); }
    for (var c = 0; c < cols; c++) if (passable(cells[0][c])) { vis[0][c] = true; q.push([0, c]); }
    var dirs = [[-1,0],[1,0],[0,-1],[0,1]];
    for (var h = 0; h < q.length; h++) {
      var r = q[h][0], cc = q[h][1];
      for (var d = 0; d < dirs.length; d++) {
        var nr = r + dirs[d][0], nc = cc + dirs[d][1];
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols || vis[nr][nc]) continue;
        if (passable(cells[nr][nc])) { vis[nr][nc] = true; q.push([nr, nc]); }
      }
    }
    for (var r2 = 0; r2 < rows; r2++) for (var c2 = 0; c2 < cols; c2++) {
      if (cells[r2][c2] && cells[r2][c2].t && cells[r2][c2].t === 'box' && !vis[r2][c2]) return false;
    }
    return true;
  }

  /**
   * 锁链可激活性检验（防结构性卡死）：锁链需【全部成员同时激活】才能连体取。
   * 由于激活单调，最大激活态 = 移除所有【非本组】盒。若此时仍有成员未暴露(顶部经空格不可达其邻)，
   * 则该组【永远无法全部激活】→ 结构性死锁。
   *  - 把非本组 box 视作已移除(空)，黑/管道为墙，本组成员为障碍；从第0行经空格 BFS。
   *  - 成员暴露 = 位于第0行 或 邻接可达空格。
   * @returns {boolean} 全部成员可激活=true
   */
  function chainActivatable(cells, rows, cols, members) {
    var mset = {};
    for (var i = 0; i < members.length; i++) mset[members[i].r + ',' + members[i].c] = true;
    function isEmptyLike(r, c) {
      var ce = cells[r][c];
      if (!ce) return true;                                   // 空格
      if (ce.t === 'black' || ce.t === 'pipe') return false;  // 墙
      if (ce.t === 'box') return !mset[r + ',' + c];          // 非本组盒=视作已移除；本组盒=障碍
      return true;
    }
    var R = AntSolver.create2D(rows, cols, false), q = [];
    for (var c0 = 0; c0 < cols; c0++) if (isEmptyLike(0, c0)) { R[0][c0] = true; q.push([0, c0]); }
    var dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (var h = 0; h < q.length; h++) {
      var r = q[h][0], cc = q[h][1];
      for (var d = 0; d < 4; d++) {
        var nr = r + dirs[d][0], nc = cc + dirs[d][1];
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols || R[nr][nc]) continue;
        if (isEmptyLike(nr, nc)) { R[nr][nc] = true; q.push([nr, nc]); }
      }
    }
    for (var m = 0; m < members.length; m++) {
      var mr = members[m].r, mc = members[m].c;
      if (mr === 0) continue;                                 // 第0行默认可激活
      var exposed = false;
      for (var dd = 0; dd < 4; dd++) {
        var er = mr + dirs[dd][0], ec = mc + dirs[dd][1];
        if (er < 0 || er >= rows || ec < 0 || ec >= cols) continue;
        if (R[er][ec]) { exposed = true; break; }
      }
      if (!exposed) return false;                             // 该成员永不暴露 → 整组不可激活
    }
    return true;
  }

  /**
   * 结构性卡死 + 合法性检验（合法性门，不做求解）：production 必须逐关调用。
   *  ① 所有盒从顶部可达；② 每个锁链组全部成员可激活(chainActivatable)；
   *  ③ 管道出口合法：任意两管道不得【共用同一出口格】、出口不得越界(防管道共用出口的 bug)。
   * @returns {{ok:boolean, reason:string}}
   */
  function structuralDeadlockCheck(board) {
    var cells = board.cells, rows = board.rows, cols = board.cols;
    if (!isAllBoxesReachable(cells, rows, cols)) return { ok: false, reason: '有盒从顶部不可达' };
    var groups = {};
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      var ce = cells[r][c];
      if (ce && ce.t === 'box' && ce.chain > 0) (groups[ce.chain] = groups[ce.chain] || []).push({ r: r, c: c });
    }
    for (var g in groups) {
      if (groups[g].length >= 2 && !chainActivatable(cells, rows, cols, groups[g]))
        return { ok: false, reason: '锁链组' + g + '无法全部激活(结构性卡死)' };
    }
    // ③ 管道出口合法性检查
    var exitOwner = {};
    for (var pr = 0; pr < rows; pr++) for (var pc = 0; pc < cols; pc++) {
      var pcell = cells[pr][pc];
      if (!pcell || pcell.t !== 'pipe') continue;
      var dv = AntSolver.PIPE_DIRS[pcell.dir] || [1, 0];
      var er = pr + dv[0], ec = pc + dv[1];
      if (er < 0 || er >= rows || ec < 0 || ec >= cols) return { ok: false, reason: '管道(' + pr + ',' + pc + ')出口越界' };
      var ek = er + ',' + ec;
      if (exitOwner[ek]) return { ok: false, reason: '管道共用同一出口(' + ek + ')：' + exitOwner[ek] + ' 与 ' + pr + ',' + pc };
      exitOwner[ek] = pr + ',' + pc;
    }
    return { ok: true, reason: '' };
  }

  function placeBoardObstacles(cells, rows, cols, config) {
    var diffLevel = config.diffLevel || 2;
    var backRow = Math.floor(rows * 0.4);

    function boxCells(filterBack) {
      var arr = [];
      for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
        if (cells[r][c] && cells[r][c].t === 'box') {
          if (filterBack && r < backRow) continue;
          arr.push({ r: r, c: c });
        }
      }
      return arr;
    }
    function boxTotal() { return boxCells(false).length; }

    // 冰块（durability=3 固定：激活1次 + 全局3步解锁）——【全棋盘可出现】(含第0行=默认激活)
    if (config.icePercent > 0) {
      var iceCount = Math.floor(boxTotal() * config.icePercent / 100);
      var icePool = boxCells(false); // 全棋盘
      var iceSel = pickDispersed(icePool, iceCount, 2);
      for (var i = 0; i < iceSel.length; i++) {
        cells[iceSel[i].r][iceSel[i].c].ice = 3;
      }
    }

    // 锁链：每组2或3连，成员横/竖正交相邻(不可斜向)；三连可 L/反L；可与冰块叠加。
    // 【两批放置·均在建棋盘期】首批 chainInitialRatio(默认50%) 全盘随机；剩余一半也在此填入，但【限制在棋盘 50% 行数以后】(下半区)——
    //   把"锁链卡点"预置到后期区域(顺序依赖抬压)，而非留到 P2 补链。
    var dirs8 = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    function placeChainBatch(count, minRow, startGroup, chained) {
      var placed = 0, group = startGroup;
      var pool = boxCells(false).filter(function (p) { return p.r >= minRow; });
      var cand = pickDispersed(pool, count * 4 + 6, 2);
      for (var ci = 0; ci < cand.length && placed < count; ci++) {
        var sr = cand[ci].r, sc = cand[ci].c;
        if (chained[sr + ',' + sc] || cells[sr][sc].chain > 0) continue;
        var size = (Math.random() < 0.5) ? 3 : 2;
        var members = [{ r: sr, c: sc }];
        var guard = 0;
        while (members.length < size && guard++ < 30) {
          var grew = false;
          for (var mi = 0; mi < members.length && !grew; mi++) {
            var order = shuffle(dirs8.slice());
            for (var d = 0; d < order.length; d++) {
              var nr = members[mi].r + order[d][0], nc = members[mi].c + order[d][1];
              if (nr < minRow || nr >= rows || nc < 0 || nc >= cols) continue;   // 次批限制在 ≥minRow(下半区)
              if (!cells[nr][nc] || cells[nr][nc].t !== 'box') continue;
              if (chained[nr + ',' + nc] || cells[nr][nc].chain > 0) continue;
              var dup = false;
              for (var mm = 0; mm < members.length; mm++) if (members[mm].r === nr && members[mm].c === nc) { dup = true; break; }
              if (dup) continue;
              members.push({ r: nr, c: nc }); grew = true; break;
            }
          }
          if (!grew) break;
        }
        if (members.length >= 2 && !chainGroupConflict(cells, rows, cols, members, group) && chainActivatable(cells, rows, cols, members)) {
          for (var mk = 0; mk < members.length; mk++) { cells[members[mk].r][members[mk].c].chain = group; chained[members[mk].r + ',' + members[mk].c] = true; }
          group++; placed++;
        }
      }
      return group;
    }
    var totalChains = Math.max(0, config.chainCount || 0);
    if (totalChains > 0) {
      var ratio = (typeof config.chainInitialRatio === 'number') ? config.chainInitialRatio : 0.5;
      var n1 = Math.round(totalChains * ratio);       // 首批：全盘
      var n2 = totalChains - n1;                       // 次批：棋盘 50% 行以后
      var chainedMap = {}, grp = 1;
      grp = placeChainBatch(n1, 0, grp, chainedMap);
      grp = placeChainBatch(n2, Math.floor(rows * 0.5), grp, chainedMap);
    }

    // 问号（软障碍，偶数，分散）——【不在第0行】，其余全棋盘可出现；【可与冰块叠加】；不与锁链叠加保持清晰
    if (config.questionPercent > 0) {
      var qCount = Math.floor(boxTotal() * config.questionPercent / 100);
      if (qCount % 2 === 1) qCount--;
      if (qCount >= 2) {
        var qpool = boxCells(false).filter(function(p) {
          return p.r !== 0 && cells[p.r][p.c].chain === 0; // 问号不在第0行；可与冰叠加；仅不与锁链叠加
        });
        var qSel = pickDispersed(qpool, qCount, 2);
        if (qSel.length % 2 === 1) qSel.pop(); // 保持偶数
        for (var qi = 0; qi < qSel.length; qi++) cells[qSel[qi].r][qSel[qi].c].q = true;
      }
    }

    // 黑块已在 buildBoard 中分散预留放置（此处不再处理）
  }

  /**
   * 顶部行障碍约束（生产后处理，仅做减法 → 只会更易，不破坏可解性/可达性）：
   *  ① 前2行(索引0/1)障碍密度 ≤ topObstacleMaxPercent(默认50%)；密度 = 障碍格 / 实际占用格(非空)。
   *  ② 前2行最多 1 对锁链：含前2行成员的锁链组多于1个时，只保留1组，其余整组清标。
   *  障碍 = 黑块 / 管道 / 带冰或锁链或问号的盒。移除优先级：问号 → 冰 → 锁链整组 → 黑块转空。
   *  管道不移除(承载溢出队列，移除会丢盒)。
   */
  function enforceTopObstacleCap(cells, rows, cols, config) {
    var pct = (typeof config.topObstacleMaxPercent === 'number') ? config.topObstacleMaxPercent : 50;
    var topRows = Math.min(2, rows);   // 前2行
    if (topRows <= 0 || cols <= 0) return;

    function isObs(cell) {
      return cell && (cell.t === 'black' || cell.t === 'pipe' ||
        (cell.t === 'box' && ((cell.ice > 0) || (cell.chain > 0) || cell.q)));
    }
    function countTop() {
      var n = 0;
      for (var r = 0; r < topRows; r++) for (var c = 0; c < cols; c++) if (isObs(cells[r][c])) n++;
      return n;
    }
    function countOccupied() { // 实际占用格数(非空/非null) = 密度分母
      var n = 0;
      for (var r = 0; r < topRows; r++) for (var c = 0; c < cols; c++) if (cells[r][c] != null) n++;
      return n;
    }
    function overCap() { // 障碍占实际占用格比 > pct% ?  (整数比较：obs×100 > pct×occ)
      var occ = countOccupied();
      if (occ <= 0) return false;
      return countTop() * 100 > pct * occ;
    }
    function clearChainGroup(g) { // 清掉整组锁链标记（可能含非顶部成员），组员变普通盒
      for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
        var x = cells[r][c];
        if (x && x.t === 'box' && x.chain === g) x.chain = 0;
      }
    }

    // ② 前2行最多 1 对锁链：多于1个含前2行成员的锁链组 → 只保留第1组，其余整组清标
    var topGroups = [];
    for (var gr = 0; gr < topRows; gr++) for (var gc = 0; gc < cols; gc++) {
      var gcell = cells[gr][gc];
      if (gcell && gcell.t === 'box' && gcell.chain > 0 && topGroups.indexOf(gcell.chain) < 0) topGroups.push(gcell.chain);
    }
    for (var tg = 1; tg < topGroups.length; tg++) clearChainGroup(topGroups[tg]);

    // ① 前2行障碍密度 ≤ pct%
    var guard = 0;
    while (overCap() && guard++ < 800) {
      var acted = false;
      // 1) 问号
      for (var r1 = 0; r1 < topRows && !acted; r1++) for (var c1 = 0; c1 < cols && !acted; c1++) {
        var a = cells[r1][c1];
        if (a && a.t === 'box' && a.q) { a.q = false; acted = true; }
      }
      if (acted) continue;
      // 2) 冰
      for (var r2 = 0; r2 < topRows && !acted; r2++) for (var c2 = 0; c2 < cols && !acted; c2++) {
        var b = cells[r2][c2];
        if (b && b.t === 'box' && b.ice > 0) { b.ice = 0; acted = true; }
      }
      if (acted) continue;
      // 3) 锁链整组
      for (var r3 = 0; r3 < topRows && !acted; r3++) for (var c3 = 0; c3 < cols && !acted; c3++) {
        var d = cells[r3][c3];
        if (d && d.t === 'box' && d.chain > 0) { clearChainGroup(d.chain); acted = true; }
      }
      if (acted) continue;
      // 4) 黑块 → 空格（last resort）
      for (var r4 = 0; r4 < topRows && !acted; r4++) for (var c4 = 0; c4 < cols && !acted; c4++) {
        if (cells[r4][c4] && cells[r4][c4].t === 'black') { cells[r4][c4] = null; acted = true; }
      }
      if (!acted) break; // 顶部只剩管道等不可移除项（正常棋盘管道偏后不会出现在1-3行）
    }
  }

  /**
   * 分散选取（最远点采样 FPS）：随机起点，之后每次选"离已选点最远"的候选，
   * 使障碍最大化分散、避免连续聚集。（minDist 仅作历史签名保留，未使用。）
   */
  function pickDispersed(cands, count, minDist) {
    if (count <= 0 || !cands.length) return [];
    var pool = cands.slice();
    shuffle(pool); // 随机化：起点与并列打破都随机
    count = Math.min(count, pool.length);
    function cheby(a, b) { return Math.max(Math.abs(a.r - b.r), Math.abs(a.c - b.c)); }

    var picked = [pool[0]];
    var used = {}; used[pool[0].r + ',' + pool[0].c] = true;
    // 每个候选到"最近已选点"的距离，增量维护
    var mind = new Array(pool.length);
    for (var i = 0; i < pool.length; i++) mind[i] = cheby(pool[i], picked[0]);

    while (picked.length < count) {
      var best = -1, bestD = -1;
      for (var j = 0; j < pool.length; j++) {
        if (used[pool[j].r + ',' + pool[j].c]) continue;
        if (mind[j] > bestD) { bestD = mind[j]; best = j; }
      }
      if (best < 0) break;
      var chosen = pool[best];
      picked.push(chosen);
      used[chosen.r + ',' + chosen.c] = true;
      for (var k = 0; k < pool.length; k++) {
        var d = cheby(pool[k], chosen);
        if (d < mind[k]) mind[k] = d;
      }
    }
    return picked;
  }

  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // ==================== 难度评分 ====================

  /**
   * 难度评分（参考StackSort难度体系）
   * 
   * 总分 = 暂存压力×0.35 + 消除深度×0.25 + 洗牌偏移×0.20 + 规模×0.20
   * 范围 0~100
   */
  function computeDifficulty(solveResult, level, config, generationEval) {
    // 难度评分 v2 权重不变；如生成诊断已跑严格玩家版则直接复用，避免重复模拟。
    if (AntSolver.Analysis) {
      var playerStats = null;
      if (generationEval && generationEval.player) {
        // v4：f1 用【操作 tick 轴】均值 avgBufferTick，f2 用玩家平均滞留 avgResidence。
        // 兼容：老结果若没有 avgBufferTick（例如历史落库数据），退回完成事件轴的 avgBuffer 以免整关无分，
        //       并在 statsAxis 上如实标出用的是哪条轴，避免把两种口径混着比。
        var gpv = generationEval.player;
        var hasTickAxis = (gpv.avgBufferTick != null);
        playerStats = {
          won: !!gpv.won,
          avgBuffer: hasTickAxis ? (gpv.avgBufferTick || 0) : (gpv.avgBuffer || 0),
          statsAxis: hasTickAxis ? 'operationTick' : 'completionEvent(legacy)',
          peak: gpv.peak || 0,
          revives: gpv.revives || 0,
          avgResidence: gpv.avgResidence || 0,
          effectiveTicks: gpv.effectiveTicks || 0,
          residenceCount: gpv.residenceCount || 0,
          preview: gpv.preview || null
        };
      } else {
        try {
          if (AntSolver.PlayerSim) {
            // 难度分析的玩家兜底模拟同样按本关入口模式与消除口径跑（各模式的难度分必须来自该玩法的真实压力）。
            var pl = AntSolver.PlayerSim.run(level, { seed: 7, bottomOnly: !!(config && config.bottomOnly), instantChain: !!(config && config.instantChain) });
            // v4：直接用 PlayerSim 的统一口径输出，不再就地按 pressureSamples 手算
            // （那是完成事件轴，与需求 §3 要求的操作 tick 轴不同）。
            playerStats = {
              won: pl.won, avgBuffer: pl.playerAvgBuffer || 0, statsAxis: 'operationTick',
              peak: pl.bufferPeak || 0, revives: pl.revivesUsed || 0,
              avgResidence: pl.avgResidence || 0,
              effectiveTicks: pl.effectiveTicks || 0,
              residenceCount: pl.residenceCount || 0
            };
          }
        } catch (e) { playerStats = null; }
      }
      var diff = AntSolver.Analysis.difficulty(level, solveResult, playerStats);
      diff.playerStats = playerStats;
      if (generationEval) diff.generationScore = generationEval.score;
      return diff;
    }
    // 兜底（Analysis 未加载）：简化暂存压力评分
    var bufferPressure = solveResult.maxBuffer > 0
      ? Math.min(100, (solveResult.maxBuffer / (config.bufferLimit || 5)) * 100) : 0;
    var score = Math.round(bufferPressure * 0.6);
    var grade = score <= 30 ? '简单' : (score <= 60 ? '普通' : (score <= 80 ? '困难' : '极难'));
    return { score: score, grade: grade, parts: { buffer: Math.round(bufferPressure) }, bufferHistory: solveResult.stepBufferHistory || [] };
  }

  // ==================== 目标图生成（无TXT时） ====================

  function generateTargetMap(size, colorCount, pattern) {
    var colors = getColorPalette(colorCount);
    switch (pattern) {
      case 'rings': return generateRings(size, colors);
      case 'stripes': return generateStripes(size, colors);
      case 'blob': return generateBlob(size, colors);
      default: return generateRandom(size, colors);
    }
  }

  function generateRings(size, colors) {
    var blocks = AntSolver.create2D(size, size, 0);
    var cx = size/2, cy = size/2, maxD = size/2 - 1;
    for (var r = 0; r < size; r++) for (var c = 0; c < size; c++) {
      var d = Math.max(Math.abs(r-cy), Math.abs(c-cx));
      if (d <= maxD) blocks[r][c] = colors[Math.min(Math.floor(d*colors.length/(maxD+1)), colors.length-1)];
    }
    return blocks;
  }

  function generateStripes(size, colors) {
    var blocks = AntSolver.create2D(size, size, 0);
    var w = Math.max(2, Math.floor(size / colors.length));
    for (var r = 0; r < size; r++) for (var c = 0; c < size; c++) {
      blocks[r][c] = colors[Math.floor(r / w) % colors.length];
    }
    return blocks;
  }

  function generateBlob(size, colors) {
    var blocks = AntSolver.create2D(size, size, 0);
    var assigned = AntSolver.create2D(size, size, false);
    var total = size * size, perColor = Math.floor(total / colors.length);
    var dirs = [[-1,0],[1,0],[0,-1],[0,1]];
    for (var ci = 0; ci < colors.length; ci++) {
      var sr, sc, att = 0;
      do { sr = Math.floor(Math.random()*size); sc = Math.floor(Math.random()*size); att++; } while (assigned[sr][sc] && att < 100);
      var queue = [{r:sr,c:sc}], grown = 0;
      while (queue.length > 0 && grown < perColor) {
        var idx = Math.floor(Math.random()*queue.length);
        var cell = queue.splice(idx, 1)[0];
        if (assigned[cell.r][cell.c]) continue;
        assigned[cell.r][cell.c] = true; blocks[cell.r][cell.c] = colors[ci]; grown++;
        for (var d = 0; d < dirs.length; d++) {
          var nr = cell.r+dirs[d][0], nc = cell.c+dirs[d][1];
          if (nr >= 0 && nr < size && nc >= 0 && nc < size && !assigned[nr][nc]) queue.push({r:nr,c:nc});
        }
      }
    }
    for (var r = 0; r < size; r++) for (var c = 0; c < size; c++) if (!assigned[r][c]) blocks[r][c] = colors[Math.floor(Math.random()*colors.length)];
    return blocks;
  }

  function generateRandom(size, colors) {
    var blocks = AntSolver.create2D(size, size, 0);
    for (var r = 0; r < size; r++) for (var c = 0; c < size; c++) blocks[r][c] = colors[Math.floor(Math.random()*colors.length)];
    return blocks;
  }

  function getColorPalette(count) {
    var palette = [1, 4, 6, 3, 7, 8, 2, 5, 9, 10, 11, 12];
    return palette.slice(0, Math.min(count, palette.length));
  }

  // ==================== TXT解析 ====================

  function blocksFromTXT(txtContent) {
    var lines = txtContent.trim().split('\n');
    var startIdx = 0;
    for (var i = 0; i < lines.length; i++) {
      var trimmed = lines[i].trim();
      if (trimmed === '' || !/^\d/.test(trimmed)) { startIdx = i + 1; } else { break; }
    }
    var blocks = [];
    for (var i = startIdx; i < lines.length; i++) {
      var line = lines[i].trim();
      if (line === '') continue;
      var row = line.split(/\s+/).map(function(s) { var n = parseInt(s,10); return isNaN(n)?0:n; });
      if (row.length > 0) blocks.push(row);
    }
    return blocks;
  }

  /* ===== 正式默认流程开关（v95 发布）=====
   * v95 起 produce() 默认走纠偏版流程 produceFixed（R01-R07）。
   * 发布依据：348 张同源图新旧双侧全量对照——新 98.85%(344/348) vs 旧 96.26%(335/348)；
   *   总耗时 1:51:15 vs 3:49:33（快 2.06 倍）；331 张两侧都合格的图上后期峰窗差均 -0.07、
   *   难度分差均 -0.06（质量打平）；棋盘尺寸越出方案范围的关 旧 122 → 新 0。
   * 旧流程实现一行未删，三种回退方式任选：
   *   ① 全局回退：AntSolver.Generator.FLOW = 'old'
   *   ② 单次回退：produce(blocks, Object.assign({}, cfg, { generatorFlow: 'old' }))
   *   ③ 直接调用：AntSolver.Generator.produceLegacy(blocks, config)
   * 返回契约：两条流程都经 finalizeProduce 返回同一候选对象结构，
   *   纠偏版额外带 flow / flowStats 字段，调用方无需改动。
   */
  var DEFAULT_FLOW = 'new_fixed';
  function produceDispatch(blocks, config, opts) {
    var flow = (config && config.generatorFlow) ||
      (AntSolver.Generator && AntSolver.Generator.FLOW) || DEFAULT_FLOW;
    var out = flow === 'old' ? produce(blocks, config) : produceFixed(blocks, config, opts);
    // 唯一出口处统一标记本关的【目标图入口模式】，供批次记录 / CSV / 生产报告识别。
    // 只写在生产侧结果对象上，【不写入关卡本体】——关卡 JSON 协议保持不变(用户决定 D1)。
    // 三种模式互斥，出口只打一个标记（需求 §九：至少能区分原四方向 / 底部消除 / 四方向瞬时连锁）。
    if (out && !out.entryMode) {
      out.entryMode = (config && config.instantChain) ? 'fourSideInstantChain'
        : ((config && config.bottomOnly) ? 'bottomOnly' : 'fourSide');
    }
    return out;
  }
  return {
    generate: generate,
    generateFromBlocks: generateFromBlocks,
    // produce 为正式默认入口：v95 起分发到纠偏版；produceLegacy 是 v94 及以前的旧实现。
    produce: produceDispatch,
    produceLegacy: produce,
    FLOW: DEFAULT_FLOW,
    // ===== 纠偏版（R01-R07）入口与可单测的内部函数 =====
    // 旧版导出全部保留不动；新版通过 *Fixed 名称并列导出，生产脚本显式选择调用哪一套。
    produceFixed: produceFixed,
    generateFromBlocksFixed: generateFromBlocksFixed,
    buildStructureCandidateFixed: buildStructureCandidateFixed,
    planObstacleSlotsFixed: planObstacleSlotsFixed,
    fillStructureFixed: fillStructureFixed,
    buildOneCandidateAttempt: buildOneCandidateAttempt,
    buildConservationBaseline: buildConservationBaseline,
    scanBoardActual: scanBoardActual,
    verifyConservation: verifyConservation,
    screenCandidateFixed: screenCandidateFixed,
    // ===== 仅底部入口模式（ANT-GEN-BOTTOM-ONLY-20260729）=====
    baseFillBoxesBottom: baseFillBoxesBottom,               // 底部依赖流盒切分（bottomOnly 分支）
    pickBoxSplit: pickBoxSplit,                             // 盒切分分发点（新旧流程共用）
    checkBottomEntryFeasibility: checkBottomEntryFeasibility, // 生产前可达性检查（可独立调用做源图体检）
    // ===== 生产前置碎色闸门（ANT-GEN-FRAGMENT-GATE-20260824）=====
    computeFragmentation: computeFragmentation,               // 只算碎色率，可独立调用做源图体检
    checkFragmentGate: checkFragmentGate,                     // 闸门判定（fragmentMaxRate<=0 时恒放行）
    // ===== 管道深度参数化 + 兜底（ANT-GEN-PIPE-DEPTH-FALLBACK-20260825）=====
    pipeDepthOf: pipeDepthOf,                                 // 生效的管道队列深度上限
    pipeMinFillOf: pipeMinFillOf,                             // 生效的单管最少装盒数
    solveSpaceQuota: solveSpaceQuota,                         // 可用空间配额联立解（含管道兜底），可独立调用体检参数是否自相矛盾
    pipeCountByConservation: pipeCountByConservation,          // 守恒反推管道数（usableSpaceTarget 关闭时生效）
    // ===== 卡点体系类型化（ANT-GEN-CHOKE-TYPES-20260824）=====
    rareColorRank: rareColorRank,                             // 稀有色识别（按像素占比升序）
    pickClustered: pickClustered,                             // 聚集选点（pickDispersed 的对立面）
    pickChokeTypes: pickChokeTypes,                           // 按配额抽互不重合的卡点类型
    chokeRareColorKeyPlace: chokeRareColorKeyPlace,           // 稀有色落位（首次换球时执行）
    CHOKE_TYPE_LIST: CHOKE_TYPE_LIST,
    baseFillBoxes: baseFillBoxes,                           // 默认几何趋势流盒切分（对照用）
    baselineSolutionFixed: baselineSolutionFixed,
    derivePipeReleaseOrder: derivePipeReleaseOrder,
    deriveRegionUnlockOrder: deriveRegionUnlockOrder,
    deriveObstacleProgress: deriveObstacleProgress,
    makeChokeVariantFixed: makeChokeVariantFixed,
    SCREEN_PASSES_FIXED: SCREEN_PASSES_FIXED,
    analyzeEliminationLayers: analyzeEliminationLayers,
    generateQueues: generateQueues,
    buildBoard: buildBoard,
    chooseBoardDims: chooseBoardDims,
    reserveNarrowWalls: reserveNarrowWalls,
    placeBoardObstacles: placeBoardObstacles,
    structuralDeadlockCheck: structuralDeadlockCheck,
    chainActivatable: chainActivatable,
    splitIntoBoxes: splitIntoBoxes,
    computeDifficulty: computeDifficulty,
    evaluateGeneration: evaluateGeneration,
    generationScore: generationScore,
    generateTargetMap: generateTargetMap,
    blocksFromTXT: blocksFromTXT,
    getColorPalette: getColorPalette,
    DEFAULT_CONFIG: DEFAULT_CONFIG
  };
})();
